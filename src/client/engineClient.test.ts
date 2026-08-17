import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../engine/rules";
import type { SearchResult } from "../engine/types";
import type { WorkerRequest, WorkerResponse } from "../worker/protocol";
import { createEngineClient, type WorkerPort } from "./engineClient";

/** 실제 Web Worker 대신 요청과 응답 경계를 동기적으로 관찰하는 테스트 대역. */
class FakeWorker implements WorkerPort {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  sent: WorkerRequest[] = [];
  terminated = false;

  postMessage(message: WorkerRequest): void {
    this.sent.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(response: WorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>);
  }

  emitError(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

const analysisResult: SearchResult = {
  best: { kind: "move", pieceId: 0, to: { x: 1, y: 4 } },
  score: 12,
  nodes: 34,
  depth: 3,
  ms: 5,
  values: [{ move: { kind: "move", pieceId: 0, to: { x: 1, y: 4 } }, score: 12 }],
};

afterEach(() => {
  vi.useRealTimers();
});

describe("EngineClient", () => {
  it("requestId가 같은 analysis 응답으로 Promise를 완료한다", async () => {
    const workers: FakeWorker[] = [];
    const client = createEngineClient({
      timeoutMs: 5_000,
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });

    const pending = client.analyze(createInitialState(), 3);
    const request = workers[0]!.sent[0] as Extract<WorkerRequest, { type: "analyze" }>;
    workers[0]!.emit({ type: "analysis", requestId: request.requestId, result: analysisResult });

    await expect(pending).resolves.toEqual(analysisResult);
  });

  it("error 응답은 requestId가 같은 Promise만 거부한다", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const state = createInitialState();
    const first = client.analyze(state, 3);
    const second = client.analyze(state, 3);
    const firstRequest = worker.sent[0] as Extract<WorkerRequest, { type: "analyze" }>;
    const secondRequest = worker.sent[1] as Extract<WorkerRequest, { type: "analyze" }>;

    worker.emit({ type: "error", requestId: firstRequest.requestId, message: "탐색 실패" });
    worker.emit({ type: "analysis", requestId: secondRequest.requestId, result: analysisResult });

    await expect(first).rejects.toThrow("탐색 실패");
    await expect(second).resolves.toEqual(analysisResult);
  }, 100);

  it("제한 시간이 지나면 완료되지 않은 분석 요청을 거부한다", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = createEngineClient({ timeoutMs: 5_000, createWorker: () => worker });

    const pending = client.analyze(createInitialState(), 3);
    const rejection = expect(pending).rejects.toThrow("분석 시간이 초과되었습니다.");
    await vi.advanceTimersByTimeAsync(5_000);

    await rejection;
  }, 100);

  it("restart는 기존 Worker와 대기 요청을 종료한 뒤 새 Worker를 만든다", async () => {
    const workers: FakeWorker[] = [];
    const client = createEngineClient({
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const pending = client.analyze(createInitialState(), 3);
    const rejection = expect(pending).rejects.toThrow("Engine Worker가 재시작되었습니다.");

    client.restart();

    await rejection;
    expect(workers).toHaveLength(2);
    expect(workers[0]!.terminated).toBe(true);
    expect(workers[1]!.terminated).toBe(false);
  });

  it("교체된 Worker가 뒤늦게 보낸 응답은 새 요청을 완료하지 않는다", async () => {
    const workers: FakeWorker[] = [];
    const client = createEngineClient({
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const oldPending = client.analyze(createInitialState(), 3);
    const oldRejection = expect(oldPending).rejects.toThrow();
    client.restart();
    await oldRejection;

    const currentPending = client.analyze(createInitialState(), 3);
    const currentRequest = workers[1]!.sent[0] as Extract<WorkerRequest, { type: "analyze" }>;
    let settled = false;
    void currentPending.then(() => {
      settled = true;
    });

    workers[0]!.emit({
      type: "analysis",
      requestId: currentRequest.requestId,
      result: analysisResult,
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    workers[1]!.emit({
      type: "analysis",
      requestId: currentRequest.requestId,
      result: analysisResult,
    });
    await expect(currentPending).resolves.toEqual(analysisResult);
  });

  it("현재 Worker의 error event는 모든 대기 요청을 거부한다", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const first = client.analyze(createInitialState(), 3);
    const second = client.analyze(createInitialState(), 3);
    const firstRejection = expect(first).rejects.toThrow("Worker 오류: 탐색 프로세스 중단");
    const secondRejection = expect(second).rejects.toThrow("Worker 오류: 탐색 프로세스 중단");

    worker.emitError("탐색 프로세스 중단");

    await Promise.all([firstRejection, secondRejection]);
  }, 100);

  it("dispose는 Worker와 대기 요청을 종료하며 새 Worker를 만들지 않는다", async () => {
    const workers: FakeWorker[] = [];
    const client = createEngineClient({
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const pending = client.analyze(createInitialState(), 3);
    const rejection = expect(pending).rejects.toThrow("EngineClient가 종료되었습니다.");

    client.dispose();

    await rejection;
    expect(workers).toHaveLength(1);
    expect(workers[0]!.terminated).toBe(true);
  });

  it("dispose 이후 analyze는 Worker에 메시지를 보내지 않고 즉시 거부한다", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    client.dispose();

    await expect(client.analyze(createInitialState(), 3)).rejects.toThrow(
      "EngineClient가 종료되었습니다.",
    );
    expect(worker.sent).toEqual([]);
  }, 100);
});
