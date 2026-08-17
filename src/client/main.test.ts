import { afterEach, describe, expect, it, vi } from "vitest";
import { legalMoves } from "../engine/rules";
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
  it("시작·기물 선택·이동·봇 응답을 Controller와 Renderer로 왕복시킨다", async () => {
    const { elements } = installBrowserFakes();

    await import("./main");

    expect(elements["status-message"].textContent).toBe("게임을 시작하세요.");
    expect(elements["start-game"].hidden).toBe(false);

    elements["start-game"].dispatch("click");
    expect(elements["status-message"].textContent).toBe("내 차례입니다.");
    expect(elements["start-game"].hidden).toBe(true);

    elements.board.dispatch("click", { clientX: 120, clientY: 360 });
    expect(elements["action-move"].hidden).toBe(false);
    elements["action-move"].dispatch("click");
    elements.board.dispatch("click", { clientX: 200, clientY: 360 });

    expect(elements["status-message"].textContent).toBe("봇이 생각 중입니다.");
    const worker = FakeWorker.instances[0]!;
    const request = worker.sent[0] as Extract<WorkerRequest, { type: "analyze" }>;
    const best = legalMoves(request.state)[0]!;
    worker.emit({
      type: "analysis",
      requestId: request.requestId,
      result: { best, score: 0, nodes: 1, depth: 3, ms: 0, values: [] },
    });
    await flushPromises();

    expect(elements["status-message"].textContent).toBe("내 차례입니다.");
    expect(elements["turn-info"].textContent).toBe("2 / 60 ply");
  });
});
