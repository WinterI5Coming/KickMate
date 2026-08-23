import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialState, legalMoves, previewMove } from "../engine/rules";
import { projectCellCenter } from "./input";
import type { WorkerRequest, WorkerResponse } from "../worker/protocol";

class FakeElement {
  textContent: string | null = null;
  hidden = false;
  disabled = false;
  width = 0;
  height = 0;
  readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(listener);
    this.listeners.set(type, handlers);
  }

  dispatch(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class FakeContext {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  lineWidth = 1;
  globalAlpha = 1;
  font = "";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";
  fillRect(): void {}
  strokeRect(): void {}
  beginPath(): void {}
  arc(): void {}
  fill(): void {}
  stroke(): void {}
  moveTo(): void {}
  lineTo(): void {}
  setLineDash(_segments: number[]): void {}
  fillText(): void {}
}

class FakeCanvas extends FakeElement {
  width = 1200;
  height = 720;
  readonly context = new FakeContext();

  getContext(kind: string): CanvasRenderingContext2D | null {
    return kind === "2d" ? (this.context as unknown as CanvasRenderingContext2D) : null;
  }

  getBoundingClientRect(): DOMRect {
    return {
      left: 0,
      top: 0,
      width: 1200,
      height: 720,
      right: 1200,
      bottom: 720,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  }
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly sent: WorkerRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: WorkerRequest): void {
    this.sent.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(response: WorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>);
  }
}

function installBrowserFakes() {
  const elements = {
    board: new FakeCanvas(),
    "score-home": new FakeElement(),
    "score-away": new FakeElement(),
    "turn-info": new FakeElement(),
    "status-message": new FakeElement(),
    "start-game": new FakeElement(),
    "new-game": new FakeElement(),
    "action-move": new FakeElement(),
    "action-pass": new FakeElement(),
    "action-shoot": new FakeElement(),
    "action-hold": new FakeElement(),
    "end-turn": new FakeElement(),
    "event-log": new FakeElement(),
  };
  const bySelector = new Map(
    Object.entries(elements).map(([id, element]) => [`#${id}`, element]),
  );
  const documentFake = {
    title: "",
    querySelector: (selector: string) => bySelector.get(selector) ?? null,
    getElementById: (id: string) => bySelector.get(`#${id}`) ?? null,
  };
  const windowFake = new FakeElement();

  FakeWorker.instances = [];
  vi.stubGlobal("document", documentFake);
  vi.stubGlobal("window", windowFake);
  vi.stubGlobal("Worker", FakeWorker);
  return { elements, windowFake };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("브라우저 진입점", () => {
  it("직접 지정 패스와 조기 종료 뒤 봇의 전체 팀 턴을 왕복시킨다", async () => {
    const { elements } = installBrowserFakes();
    const initial = createInitialState();
    const pass = legalMoves(initial).find(
      (move) => move.kind === "pass" && move.pieceId === 3 && move.targetPieceId === 5,
    );
    if (!pass) throw new Error("킥오프 상태에서 FW를 목표로 한 패스를 찾지 못했습니다.");
    const passPreview = previewMove(initial, pass);
    if (passPreview.kind !== "pass") throw new Error("패스 미리보기 생성에 실패했습니다.");
    expect(passPreview.receiverPieceId).toBe(5);

    await import("./main");

    expect(elements["status-message"].textContent).toBe("게임을 시작하세요.");
    expect(elements["start-game"].hidden).toBe(false);

    elements["start-game"].dispatch("click");
    expect(elements["status-message"].textContent).toBe("내 차례입니다.");
    expect(elements["start-game"].hidden).toBe(true);

    // 킥오프 공 소유자(MF, 6·4)를 원근 투영된 중심 픽셀로 고르고 패스 모드에 들어간다.
    const carrierCenter = projectCellCenter({ x: 6, y: 4 });
    elements.board.dispatch("click", { clientX: carrierCenter.x, clientY: carrierCenter.y });
    expect(elements["action-pass"].hidden).toBe(false);
    elements["action-pass"].dispatch("click");
    expect(elements["status-message"].textContent).toContain("패스할 아군");

    // 목표 아군(FW, 5·4)을 직접 클릭한다.
    const receiverCenter = projectCellCenter({ x: 5, y: 4 });
    elements.board.dispatch("click", { clientX: receiverCenter.x, clientY: receiverCenter.y });

    const worker = FakeWorker.instances[0]!;
    expect(elements["status-message"].textContent).toBe("내 차례입니다.");
    expect(elements["turn-info"].textContent).toContain("HOME 2/3");
    expect(worker.sent).toHaveLength(0);

    elements["end-turn"].dispatch("click");
    expect(elements["status-message"].textContent).toBe("봇이 생각 중입니다.");
    expect(worker.sent).toHaveLength(1);

    const request = worker.sent[0] as Extract<WorkerRequest, { type: "analyze" }>;
    expect(request.state.turn).toBe(1);
    expect(request.state.ball).toEqual({
      kind: "held",
      pieceId: passPreview.receiverPieceId,
    });
    for (let index = 0; index < 3; index += 1) {
      const current = worker.sent[index] as Extract<WorkerRequest, { type: "analyze" }>;
      const best = legalMoves(current.state).find((move) => move.kind === "move")!;
      worker.emit({
        type: "analysis",
        requestId: current.requestId,
        result: { best, score: 0, nodes: 1, depth: 3, ms: 0, values: [] },
      });
      await flushPromises();
    }

    expect(elements["status-message"].textContent).toBe("내 차례입니다.");
    expect(elements["turn-info"].textContent).toBe("4 / 60 행동 · HOME 3/3");
  });
});
