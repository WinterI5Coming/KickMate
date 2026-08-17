/**
 * Web Worker의 메시지 기반 API를 Promise 기반 분석 API로 바꾸는 클라이언트.
 *
 * 호출자는 Worker의 `onmessage`를 직접 관리하지 않고 `analyze()`가 반환하는
 * Promise만 기다린다. 여러 요청의 응답은 `requestId`로 원래 Promise와 연결한다.
 */

import type { GameState, SearchResult } from "../engine/types";
import type { WorkerRequest, WorkerResponse } from "../worker/protocol";

/** GameController가 사용하는 봇 분석 및 Worker 수명 관리 계약. */
export interface EngineClient {
  /** 현재 상태를 지정 깊이까지 분석한다. Worker 응답 전까지 Promise는 대기한다. */
  analyze(state: GameState, depth: number): Promise<SearchResult>;
  /** 현재 Worker와 미완료 요청을 폐기하고 이후 분석을 처리할 새 Worker를 만든다. */
  restart(): void;
  /** 모든 미완료 요청을 거부하고 Worker를 영구 종료한다. */
  dispose(): void;
}

/** 브라우저 Worker와 테스트용 FakeWorker가 공통으로 만족해야 하는 최소 계약. */
export interface WorkerPort {
  /** Worker가 정상 응답을 보낼 때 호출되는 핸들러. */
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  /** Worker 실행 자체가 실패했을 때 호출되는 핸들러. */
  onerror: ((event: ErrorEvent) => void) | null;
  /** 구조화 복제 가능한 엔진 요청을 Worker에 전달한다. */
  postMessage(message: WorkerRequest): void;
  /** Worker 실행 환경을 즉시 종료한다. */
  terminate(): void;
}

/** Worker 생성 방식과 요청 제한 시간을 바꿀 수 있는 생성 옵션. */
export interface EngineClientOptions {
  /** 분석 응답을 기다리는 최대 시간. 생략하면 5초다. */
  timeoutMs?: number;
  /** 테스트 대역이나 다른 Worker 구현을 주입하는 factory. */
  createWorker?: () => WorkerPort;
}

/** 아직 Worker 응답을 받지 못한 analyze 호출 한 건의 완료 수단. */
interface PendingAnalysis {
  resolve: (result: SearchResult) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/** 실제 브라우저에서는 검색 전용 모듈 Worker를 만든다. */
function createDefaultWorker(): WorkerPort {
  return new Worker(new URL("../worker/engine.worker.ts", import.meta.url), { type: "module" });
}

/**
 * Worker 한 개를 소유하고 분석 요청과 응답을 연결하는 EngineClient를 만든다.
 * 테스트에서는 `createWorker`에 FakeWorker factory를 주입해 브라우저 없이 검증한다.
 */
export function createEngineClient(options: EngineClientOptions = {}): EngineClient {
  const workerFactory = options.createWorker ?? createDefaultWorker;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const pending = new Map<number, PendingAnalysis>();
  let nextRequestId = 1;
  let worker: WorkerPort;
  let disposed = false;

  function rejectAll(reason: Error): void {
    for (const request of pending.values()) {
      clearTimeout(request.timeoutId);
      request.reject(reason);
    }
    pending.clear();
  }

  function bindWorker(nextWorker: WorkerPort): void {
    nextWorker.onmessage = (event) => {
      // terminate() 직전에 이미 큐에 들어온 이전 Worker 응답은 새 요청에 적용하지 않는다.
      if (nextWorker !== worker) return;

      const response = event.data;
      if (response.type === "legalMoves") return;

      const request = pending.get(response.requestId);
      if (!request) return;

      pending.delete(response.requestId);
      clearTimeout(request.timeoutId);
      if (response.type === "analysis") {
        request.resolve(response.result);
      } else {
        request.reject(new Error(response.message));
      }
    };

    nextWorker.onerror = (event) => {
      if (nextWorker !== worker) return;
      rejectAll(new Error(`Worker 오류: ${event.message}`));
    };
  }

  worker = workerFactory();
  bindWorker(worker);

  return {
    analyze(state, depth) {
      if (disposed) {
        return Promise.reject(new Error("EngineClient가 종료되었습니다."));
      }

      const requestId = nextRequestId++;
      const result = new Promise<SearchResult>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error("분석 시간이 초과되었습니다."));
        }, timeoutMs);
        pending.set(requestId, { resolve, reject, timeoutId });
      });

      worker.postMessage({ type: "analyze", requestId, state, depth });
      return result;
    },
    restart() {
      rejectAll(new Error("Engine Worker가 재시작되었습니다."));
      worker.terminate();
      worker = workerFactory();
      bindWorker(worker);
    },
    dispose() {
      disposed = true;
      rejectAll(new Error("EngineClient가 종료되었습니다."));
      worker.terminate();
    },
  };
}
