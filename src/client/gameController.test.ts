import { describe, expect, it } from "vitest";
import { createInitialState, legalMoves } from "../engine/rules";
import type { GameState, Move, SearchResult } from "../engine/types";
import type { EngineClient } from "./engineClient";
import { createGameController } from "./gameController";
import { isTargetedMove, targetForMove } from "./input";
import type { ClientViewState } from "./types";

/** 실제 Worker 탐색 대신 Controller가 요청하는 분석 경계만 제어하는 테스트 대역. */
class FakeEngineClient implements EngineClient {
  restartCalls = 0;
  disposed = false;
  analyzeCalls: Array<{ state: GameState; depth: number }> = [];
  analyzeImpl: (state: GameState, depth: number) => Promise<SearchResult> = () =>
    Promise.reject(new Error("예상하지 않은 봇 분석 요청입니다."));

  analyze(state: GameState, depth: number): Promise<SearchResult> {
    this.analyzeCalls.push({ state, depth });
    return this.analyzeImpl(state, depth);
  }

  restart(): void {
    this.restartCalls += 1;
  }

  dispose(): void {
    this.disposed = true;
  }
}

function createStealState(): GameState {
  const state = createInitialState();
  const homeMidfielder = state.pieces.find((piece) => piece.id === 3)!;
  homeMidfielder.pos = { x: 7, y: 5 };
  state.pieces.find((piece) => piece.id === 9)!.pos = { x: 8, y: 5 };
  state.ball = { kind: "held", pieceId: 9 };
  return state;
}

function createMultipleStealState(): GameState {
  const state = createInitialState();
  state.pieces.find((piece) => piece.id === 3)!.pos = { x: 7, y: 4 };
  state.pieces.find((piece) => piece.id === 5)!.pos = { x: 7, y: 6 };
  state.pieces.find((piece) => piece.id === 9)!.pos = { x: 8, y: 5 };
  state.ball = { kind: "held", pieceId: 9 };
  return state;
}

function createProtectedStealState(): GameState {
  const state = createStealState();
  state.stealProtection = {
    pieceId: 9,
    blockedTeam: "home",
    blockedActionsRemaining: 1,
  };
  return state;
}

function createSurroundedProtectedStealState(): GameState {
  const state = createMultipleStealState();
  state.stealProtection = {
    pieceId: 9,
    blockedTeam: "home",
    blockedActionsRemaining: 1,
  };
  return state;
}

function createShortMatch(maxTurns: number): GameState {
  const state = createInitialState();
  state.maxTurns = maxTurns;
  return state;
}

function createHomeWinningShotState(): GameState {
  const state = createInitialState();
  const shooter = state.pieces.find((piece) => piece.id === 3)!;
  shooter.pos = { x: 10, y: 4 };
  state.pieces.find((piece) => piece.id === 6)!.pos = { x: 12, y: 0 };
  state.pieces.find((piece) => piece.id === 11)!.pos = { x: 10, y: 1 };
  state.ball = { kind: "held", pieceId: shooter.id };
  state.score = { home: 2, away: 1 };
  return state;
}

function createAwayWinningShotState(): GameState {
  const state = createInitialState();
  state.pieces.find((piece) => piece.id === 0)!.pos = { x: 0, y: 2 };
  const shooter = state.pieces.find((piece) => piece.id === 9)!;
  shooter.pos = { x: 2, y: 4 };
  state.ball = { kind: "held", pieceId: shooter.id };
  state.score = { home: 1, away: 2 };
  return state;
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("GameController", () => {
  it("ready에서 시작하고 게임 시작 후 새로운 humanTurn 상태를 발행한다", () => {
    const states: ClientViewState[] = [];
    const controller = createGameController({
      engineClient: new FakeEngineClient(),
      onChange: (state) => states.push(state),
    });

    expect(controller.getViewState().phase).toBe("ready");
    controller.startGame();

    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        phase: "humanTurn",
        gameState: expect.objectContaining({ turn: 0, score: { home: 0, away: 0 } }),
      }),
    );
    expect(states.at(-1)?.phase).toBe("humanTurn");
  });

  it("restartGame은 준비 화면을 거치지 않고 초기 경기로 즉시 교체한다", () => {
    const controller = createGameController({
      engineClient: new FakeEngineClient(),
      onChange: () => undefined,
    });

    controller.startGame();
    const firstGame = controller.getViewState().gameState;
    controller.restartGame();

    const restarted = controller.getViewState();
    expect(restarted.phase).toBe("humanTurn");
    expect(restarted.gameState).not.toBe(firstGame);
    expect(restarted.gameState).toEqual(
      expect.objectContaining({ turn: 0, score: { home: 0, away: 0 } }),
    );
  });

  it("home 기물의 칸을 클릭하면 해당 기물을 선택한다", () => {
    const controller = createGameController({
      engineClient: new FakeEngineClient(),
      onChange: () => undefined,
    });
    controller.startGame();
    const homePiece = controller.getViewState().gameState!.pieces.find(
      (piece) => piece.team === "home",
    )!;

    controller.handleTarget({ kind: "cell", pos: { ...homePiece.pos } });

    expect(controller.getViewState().selectedPieceId).toBe(homePiece.id);
  });

  it("압박받은 초기 공 소유자는 이동 없이 패스와 슛 버튼만 사용할 수 있다", () => {
    const controller = createGameController({
      engineClient: new FakeEngineClient(),
      onChange: () => undefined,
    });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const carrierId = state.ball.kind === "held" ? state.ball.pieceId : -1;
    const carrier = state.pieces.find((piece) => piece.id === carrierId)!;

    controller.handleTarget({ kind: "cell", pos: { ...carrier.pos } });

    expect(controller.getViewState().availableActions).toEqual(["pass", "shoot"]);
  });

  it("압박받은 공 소유자는 버티기 버튼으로 이동 허가를 얻고 home 턴을 유지한다", () => {
    const controller = createGameController({
      engineClient: new FakeEngineClient(),
      onChange: () => undefined,
      createState: () => {
        const state = createInitialState();
        const carrierId = state.ball.kind === "held" ? state.ball.pieceId : -1;
        const carrier = state.pieces.find((piece) => piece.id === carrierId)!;
        const defender = state.pieces.find(
          (piece) => piece.team === "away" && piece.role === "FW",
        )!;
        defender.pos = { x: carrier.pos.x + 1, y: carrier.pos.y };
        return state;
      },
    });
    controller.startGame();

    expect(controller.getViewState().canHold).toBe(true);
    controller.holdBall();

    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        phase: "humanTurn",
        gameState: expect.objectContaining({ actionsRemaining: 2 }),
        lastMove: null,
      }),
    );
  });

  it("행동을 선택하면 해당 종류의 합법 후보만 표시한다", () => {
    const controller = createGameController({
      engineClient: new FakeEngineClient(),
      onChange: () => undefined,
    });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const carrierId = state.ball.kind === "held" ? state.ball.pieceId : -1;
    const carrier = state.pieces.find((piece) => piece.id === carrierId)!;
    controller.handleTarget({ kind: "cell", pos: { ...carrier.pos } });

    controller.selectAction("pass");

    const view = controller.getViewState();
    expect(view.selectedAction).toBe("pass");
    expect(view.candidateMoves.length).toBeGreaterThan(0);
    expect(view.candidateMoves.every((move) => move.kind === "pass")).toBe(true);
  });

  it("패스 후보와 미리보기를 함께 발행하고 수신자 선택을 안내한다", () => {
    const controller = createGameController({
      engineClient: new FakeEngineClient(),
      onChange: () => undefined,
    });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const carrier = state.pieces.find(
      (piece) => state.ball.kind === "held" && piece.id === state.ball.pieceId,
    )!;
    controller.handleTarget({ kind: "cell", pos: { ...carrier.pos } });

    controller.selectAction("pass");

    const view = controller.getViewState();
    expect(view.message).toEqual({ kind: "chooseReceiver" });
    expect(view.candidatePreviews).toHaveLength(view.candidateMoves.length);
    expect(view.candidatePreviews.length).toBeGreaterThan(0);
    expect(
      view.candidatePreviews.every(
        ({ move, preview }) => move.kind === "pass" && preview.kind === "pass",
      ),
    ).toBe(true);
  });

  it("슛 행동은 골문 선택을 안내한다", () => {
    const controller = createGameController({
      engineClient: new FakeEngineClient(),
      onChange: () => undefined,
    });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const carrier = state.pieces.find(
      (piece) => state.ball.kind === "held" && piece.id === state.ball.pieceId,
    )!;
    controller.handleTarget({ kind: "cell", pos: { ...carrier.pos } });

    controller.selectAction("shoot");

    expect(controller.getViewState().message).toEqual({ kind: "chooseGoal" });
  });

  it("합법 패스 대상이 아닌 다른 home 기물을 클릭하면 선택을 전환한다", () => {
    const controller = createGameController({
      engineClient: new FakeEngineClient(),
      onChange: () => undefined,
    });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const carrier = state.pieces.find((piece) => piece.id === 2)!;
    const nextPiece = state.pieces.find((piece) => piece.id === 3)!;
    controller.handleTarget({ kind: "cell", pos: { ...carrier.pos } });
    controller.selectAction("pass");

    controller.handleTarget({ kind: "cell", pos: { ...nextPiece.pos } });

    expect(controller.getViewState()).toEqual(
      expect.objectContaining({ selectedPieceId: nextPiece.id, selectedAction: null }),
    );
  });

  it("공격 반대쪽 골대를 클릭하면 선택을 유지하고 슛 불가를 안내한다", () => {
    const controller = createGameController({
      engineClient: new FakeEngineClient(),
      onChange: () => undefined,
    });
    controller.startGame();
    const shotState = controller.getViewState().gameState!;
    const carrierId = shotState.ball.kind === "held" ? shotState.ball.pieceId : -1;
    const carrier = shotState.pieces.find((piece) => piece.id === carrierId)!;
    controller.handleTarget({ kind: "cell", pos: { ...carrier.pos } });
    controller.selectAction("shoot");

    controller.handleTarget({ kind: "goal", side: "left", row: 3 });

    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        selectedPieceId: carrier.id,
        selectedAction: "shoot",
        message: { kind: "invalidShot" },
      }),
    );
  });

  it("후보가 아닌 빈 칸을 클릭하면 기물과 행동 선택을 모두 해제한다", () => {
    const controller = createGameController({
      engineClient: new FakeEngineClient(),
      onChange: () => undefined,
    });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const carrierId = state.ball.kind === "held" ? state.ball.pieceId : -1;
    const carrier = state.pieces.find((piece) => piece.id === carrierId)!;
    controller.handleTarget({ kind: "cell", pos: { ...carrier.pos } });
    controller.selectAction("pass");

    controller.handleTarget({ kind: "cell", pos: { x: 5, y: 0 } });

    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        selectedPieceId: null,
        selectedAction: null,
        availableActions: [],
        candidateMoves: [],
      }),
    );
  });

  it("기물을 선택하지 않고 away 기물을 클릭하면 home 기물 선택을 안내한다", () => {
    const controller = createGameController({
      engineClient: new FakeEngineClient(),
      onChange: () => undefined,
    });
    controller.startGame();
    const awayPiece = controller.getViewState().gameState!.pieces.find(
      (piece) => piece.team === "away",
    )!;

    controller.handleTarget({ kind: "cell", pos: { ...awayPiece.pos } });

    expect(controller.getViewState().message).toEqual({ kind: "selectOwn" });
  });

  it("스틸할 수 없는 away 기물을 클릭하면 현재 선택을 유지하고 안내한다", () => {
    const controller = createGameController({
      engineClient: new FakeEngineClient(),
      onChange: () => undefined,
    });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const homePiece = state.pieces.find((piece) => piece.team === "home")!;
    const awayPiece = state.pieces.find((piece) => piece.team === "away")!;
    controller.handleTarget({ kind: "cell", pos: { ...homePiece.pos } });
    controller.selectAction("move");

    controller.handleTarget({ kind: "cell", pos: { ...awayPiece.pos } });

    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        selectedPieceId: homePiece.id,
        selectedAction: "move",
        message: { kind: "cannotSteal" },
      }),
    );
  });

  it("첫 home 행동 뒤 home 행동이 남으면 botThinking으로 바꾸지 않는다", () => {
    const engineClient = new FakeEngineClient();
    const controller = createGameController({ engineClient, onChange: () => undefined });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const move = legalMoves(state).find((candidate) => candidate.kind === "move")!;
    const actor = state.pieces.find((piece) => piece.id === move.pieceId)!;
    controller.handleTarget({ kind: "cell", pos: { ...actor.pos } });
    controller.selectAction("move");

    controller.handleTarget(targetForMove(state, move));

    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        phase: "humanTurn",
        gameState: expect.objectContaining({ turn: 1, actionsRemaining: 2 }),
        selectedPieceId: null,
        selectedAction: null,
        candidateMoves: [],
        lastMove: {
          move,
          from: actor.pos,
          target: targetForMove(state, move),
        },
      }),
    );
    expect(engineClient.analyzeCalls).toHaveLength(0);
  });

  it("턴 종료 버튼은 남은 행동을 버리고 봇 분석을 시작한다", () => {
    const engineClient = new FakeEngineClient();
    engineClient.analyzeImpl = () => new Promise<SearchResult>(() => undefined);
    const controller = createGameController({ engineClient, onChange: () => undefined });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const move = legalMoves(state).find((candidate) => candidate.kind === "move")!;
    const actor = state.pieces.find((piece) => piece.id === move.pieceId)!;
    controller.handleTarget({ kind: "cell", pos: { ...actor.pos } });
    controller.selectAction("move");

    controller.handleTarget(targetForMove(state, move));
    expect(controller.getViewState().canEndTurn).toBe(true);
    controller.endTurn();

    expect(controller.getViewState()).toEqual(
      expect.objectContaining({ phase: "botThinking", lastMove: null }),
    );
    expect(engineClient.analyzeCalls).toHaveLength(1);
  });

  it("패스 대상 home 기물 클릭은 선택 전환보다 패스를 우선 적용한다", () => {
    const engineClient = new FakeEngineClient();
    engineClient.analyzeImpl = () => new Promise<SearchResult>(() => undefined);
    const controller = createGameController({ engineClient, onChange: () => undefined });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const pass = legalMoves(state).find(
      (move): move is Extract<Move, { kind: "pass" }> =>
        move.kind === "pass" && move.targetPieceId === 5,
    )!;
    const passer = state.pieces.find((piece) => piece.id === pass.pieceId)!;
    controller.handleTarget({ kind: "cell", pos: { ...passer.pos } });
    controller.selectAction("pass");

    controller.handleTarget(targetForMove(state, pass));

    const next = controller.getViewState();
    const receiver = next.gameState!.pieces.find((piece) => piece.id === pass.targetPieceId)!;
    expect(next.gameState).toEqual(
      expect.objectContaining({ turn: 1, ball: { kind: "held", pieceId: receiver.id } }),
    );
    expect(next.selectedPieceId).toBeNull();
  });

  it("합법 스틸 대상은 다른 행동이 선택되어 있어도 클릭 즉시 스틸한다", () => {
    const engineClient = new FakeEngineClient();
    engineClient.analyzeImpl = () => new Promise<SearchResult>(() => undefined);
    const controller = createGameController({
      engineClient,
      onChange: () => undefined,
      createState: createStealState,
    });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const stealer = state.pieces.find((piece) => piece.id === 3)!;
    const carrier = state.pieces.find((piece) => piece.id === 9)!;
    controller.handleTarget({ kind: "cell", pos: { ...stealer.pos } });
    controller.selectAction("move");

    controller.handleTarget({ kind: "cell", pos: { ...carrier.pos } });

    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        phase: "humanTurn",
        gameState: expect.objectContaining({
          turn: 1,
          ball: { kind: "held", pieceId: stealer.id },
        }),
        lastMove: expect.objectContaining({ move: expect.objectContaining({ kind: "steal" }) }),
        selectedStealTargetId: null,
      }),
    );
  });

  it("스틸러가 하나면 상대 공 소유자 클릭만으로 즉시 스틸한다", () => {
    const engineClient = new FakeEngineClient();
    engineClient.analyzeImpl = () => new Promise<SearchResult>(() => undefined);
    const controller = createGameController({
      engineClient,
      onChange: () => undefined,
      createState: createStealState,
    });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const carrier = state.pieces.find((piece) => piece.id === 9)!;

    controller.handleTarget({ kind: "cell", pos: { ...carrier.pos } });

    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        phase: "humanTurn",
        gameState: expect.objectContaining({ ball: { kind: "held", pieceId: 3 } }),
        selectedStealTargetId: null,
      }),
    );
  });

  it("스틸러가 여러 명이면 상대 공 소유자 선택 후 스틸할 선수를 기다린다", () => {
    const engineClient = new FakeEngineClient();
    engineClient.analyzeImpl = () => new Promise<SearchResult>(() => undefined);
    const controller = createGameController({
      engineClient,
      onChange: () => undefined,
      createState: createMultipleStealState,
    });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const carrier = state.pieces.find((piece) => piece.id === 9)!;
    const stealer = state.pieces.find((piece) => piece.id === 5)!;

    controller.handleTarget({ kind: "cell", pos: { ...carrier.pos } });

    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        phase: "humanTurn",
        selectedStealTargetId: carrier.id,
        message: { kind: "chooseStealer" },
      }),
    );
    expect(controller.getViewState().candidateMoves).toEqual([
      { kind: "steal", pieceId: 3, targetPieceId: 9 },
      { kind: "steal", pieceId: 5, targetPieceId: 9 },
    ]);

    controller.handleTarget({ kind: "cell", pos: { ...stealer.pos } });

    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        phase: "humanTurn",
        gameState: expect.objectContaining({ ball: { kind: "held", pieceId: stealer.id } }),
        selectedStealTargetId: null,
      }),
    );
  });

  it("복수 스틸러 선택 중 빈 칸을 클릭하면 스틸 선택을 해제한다", () => {
    const controller = createGameController({
      engineClient: new FakeEngineClient(),
      onChange: () => undefined,
      createState: createMultipleStealState,
    });
    controller.startGame();
    const carrier = controller.getViewState().gameState!.pieces.find(
      (piece) => piece.id === 9,
    )!;
    controller.handleTarget({ kind: "cell", pos: { ...carrier.pos } });

    controller.handleTarget({ kind: "cell", pos: { x: 6, y: 0 } });

    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        selectedStealTargetId: null,
        candidateMoves: [],
        candidatePreviews: [],
      }),
    );
  });

  it("보호 중인 상대 공 소유자를 클릭하면 스틸 보호를 안내한다", () => {
    const controller = createGameController({
      engineClient: new FakeEngineClient(),
      onChange: () => undefined,
      createState: createProtectedStealState,
    });
    controller.startGame();
    const carrier = controller.getViewState().gameState!.pieces.find(
      (piece) => piece.id === 9,
    )!;

    controller.handleTarget({ kind: "cell", pos: { ...carrier.pos } });

    expect(controller.getViewState().message).toEqual({ kind: "protectedCarrier" });
  });

  it("보호 중이어도 두 명이 포위한 상대 공 소유자는 스틸러 선택으로 들어간다", () => {
    const controller = createGameController({
      engineClient: new FakeEngineClient(),
      onChange: () => undefined,
      createState: createSurroundedProtectedStealState,
    });
    controller.startGame();
    const carrier = controller.getViewState().gameState!.pieces.find(
      (piece) => piece.id === 9,
    )!;

    controller.handleTarget({ kind: "cell", pos: { ...carrier.pos } });

    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        selectedStealTargetId: carrier.id,
        message: { kind: "chooseStealer" },
      }),
    );
  });

  it("사람이 턴을 종료하면 봇의 전체 팀 턴 뒤 humanTurn으로 돌아온다", async () => {
    const states: ClientViewState[] = [];
    const engineClient = new FakeEngineClient();
    engineClient.analyzeImpl = async (state, depth) => ({
      best: legalMoves(state)[0] ?? null,
      score: 0,
      nodes: 1,
      depth,
      ms: 0,
      values: [],
    });
    const controller = createGameController({
      engineClient,
      onChange: (state) => states.push(state),
    });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const move = legalMoves(state).find((candidate) => candidate.kind === "move")!;
    const actor = state.pieces.find((piece) => piece.id === move.pieceId)!;
    controller.handleTarget({ kind: "cell", pos: { ...actor.pos } });
    controller.selectAction("move");

    controller.handleTarget(targetForMove(state, move));
    controller.endTurn();
    await flushPromises();

    expect(states.some((published) => published.phase === "botThinking")).toBe(true);
    expect(engineClient.analyzeCalls[0]?.depth).toBe(3);
    const finalView = controller.getViewState();
    const botActorId =
      finalView.lastMove && "pieceId" in finalView.lastMove.move
        ? finalView.lastMove.move.pieceId
        : undefined;
    expect(finalView).toEqual(
      expect.objectContaining({
        phase: "humanTurn",
        gameState: expect.objectContaining({ turn: 4 }),
        lastMove: expect.objectContaining({ move: expect.any(Object) }),
      }),
    );
    expect(finalView.gameState?.pieces.find((piece) => piece.id === botActorId)?.team).toBe(
      "away",
    );
  });

  it("봇은 away 행동이 남아 있는 동안 분석과 적용을 반복한다", async () => {
    const engineClient = new FakeEngineClient();
    const responses: Array<ReturnType<typeof deferred<SearchResult>>> = [];
    engineClient.analyzeImpl = () => {
      const response = deferred<SearchResult>();
      responses.push(response);
      return response.promise;
    };
    const controller = createGameController({ engineClient, onChange: () => undefined });
    controller.startGame();
    const home = controller.getViewState().gameState!;
    const homeMove = legalMoves(home).find((move) => move.kind === "move")!;
    const actor = home.pieces.find((piece) => piece.id === homeMove.pieceId)!;
    controller.handleTarget({ kind: "cell", pos: { ...actor.pos } });
    controller.selectAction("move");
    controller.handleTarget(targetForMove(home, homeMove));
    controller.endTurn();

    for (let index = 0; index < 3; index += 1) {
      const state = engineClient.analyzeCalls[index]!.state;
      const best = legalMoves(state).find((move) => move.kind !== "endTurn")!;
      responses[index]!.resolve({
        best,
        score: 0,
        nodes: 1,
        depth: 3,
        ms: 0,
        values: [{ move: best, score: 0 }],
      });
      await flushPromises();
    }

    expect(engineClient.analyzeCalls).toHaveLength(3);
    expect(controller.getViewState().phase).toBe("humanTurn");
    expect(controller.getViewState().gameState?.activeTeam).toBe("home");
  });

  it("성공한 봇 행동 뒤 다음 행동 분석은 재시도를 새로 시작하고 endTurn으로 끝낼 수 있다", async () => {
    const states: ClientViewState[] = [];
    const engineClient = new FakeEngineClient();
    let secondActionAttempts = 0;
    engineClient.analyzeImpl = async (state, depth) => {
      if (state.actionsRemaining === 2) {
        secondActionAttempts += 1;
        if (secondActionAttempts < 3) throw new Error("두 번째 봇 행동의 일시적 실패");
      }
      const best =
        state.actionsRemaining === 1
          ? legalMoves(state).find((move) => move.kind === "endTurn")!
          : legalMoves(state).find((move) => move.kind !== "endTurn")!;
      return { best, score: 0, nodes: 1, depth, ms: 0, values: [{ move: best, score: 0 }] };
    };
    const controller = createGameController({
      engineClient,
      onChange: (state) => states.push(state),
    });
    controller.startGame();
    const home = controller.getViewState().gameState!;
    const homeMove = legalMoves(home).find((move) => move.kind === "move")!;
    const actor = home.pieces.find((piece) => piece.id === homeMove.pieceId)!;
    controller.handleTarget({ kind: "cell", pos: { ...actor.pos } });
    controller.selectAction("move");
    controller.handleTarget(targetForMove(home, homeMove));
    controller.endTurn();
    await flushPromises();

    expect(engineClient.analyzeCalls).toHaveLength(5);
    expect(engineClient.restartCalls).toBe(2);
    expect(
      states
        .map((state) => state.message)
        .filter((message) => message?.kind === "botRetry"),
    ).toEqual([
      { kind: "botRetry", attempt: 2, maxAttempts: 3 },
      { kind: "botRetry", attempt: 3, maxAttempts: 3 },
    ]);
    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        phase: "humanTurn",
        gameState: expect.objectContaining({ activeTeam: "home", turn: 3 }),
        botAttempt: 0,
        lastMove: null,
      }),
    );
  });

  it("사람 수로 경기 제한에 도달하면 봇을 호출하지 않고 즉시 종료한다", () => {
    const engineClient = new FakeEngineClient();
    const controller = createGameController({
      engineClient,
      onChange: () => undefined,
      createState: () => createShortMatch(1),
    });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const move = legalMoves(state).find((candidate) => candidate.kind === "move")!;
    const actor = state.pieces.find((piece) => piece.id === move.pieceId)!;
    controller.handleTarget({ kind: "cell", pos: { ...actor.pos } });
    controller.selectAction("move");

    controller.handleTarget(targetForMove(state, move));

    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        phase: "finished",
        gameState: expect.objectContaining({ turn: 1 }),
      }),
    );
    expect(engineClient.analyzeCalls).toEqual([]);
  });

  it("사람의 세 번째 골 직후 즉시 종료하고 입력을 잠근 뒤 새 경기로 초기화한다", () => {
    const engineClient = new FakeEngineClient();
    let gameNumber = 0;
    const controller = createGameController({
      engineClient,
      onChange: () => undefined,
      createState: () => {
        gameNumber += 1;
        return gameNumber === 1 ? createHomeWinningShotState() : createInitialState();
      },
    });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const shooter = state.pieces.find((piece) => piece.id === 3)!;
    const shoot = legalMoves(state).find(
      (move) => move.kind === "shoot" && move.pieceId === shooter.id,
    )!;
    if (!isTargetedMove(shoot)) throw new Error("슛은 Canvas 대상 행동이어야 합니다.");
    controller.handleTarget({ kind: "cell", pos: { ...shooter.pos } });
    controller.selectAction("shoot");

    controller.handleTarget(targetForMove(state, shoot));

    const finished = controller.getViewState();
    expect(finished).toEqual(
      expect.objectContaining({
        phase: "finished",
        gameState: expect.objectContaining({ score: { home: 3, away: 1 } }),
        selectedPieceId: null,
        selectedAction: null,
        candidateMoves: [],
      }),
    );
    expect(engineClient.analyzeCalls).toEqual([]);

    controller.handleTarget({ kind: "cell", pos: { ...finished.gameState!.pieces[0]!.pos } });
    controller.selectAction("move");
    expect(controller.getViewState()).toEqual(finished);

    controller.restartGame();
    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        phase: "humanTurn",
        gameState: expect.objectContaining({ turn: 0, score: { home: 0, away: 0 } }),
        message: null,
      }),
    );
  });

  it("봇 수로 경기 제한에 도달하면 finished로 전환한다", async () => {
    const engineClient = new FakeEngineClient();
    engineClient.analyzeImpl = async (state, depth) => ({
      best: legalMoves(state)[0] ?? null,
      score: 0,
      nodes: 1,
      depth,
      ms: 0,
      values: [],
    });
    const controller = createGameController({
      engineClient,
      onChange: () => undefined,
      createState: () => createShortMatch(2),
    });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const move = legalMoves(state).find((candidate) => candidate.kind === "move")!;
    const actor = state.pieces.find((piece) => piece.id === move.pieceId)!;
    controller.handleTarget({ kind: "cell", pos: { ...actor.pos } });
    controller.selectAction("move");

    controller.handleTarget(targetForMove(state, move));
    controller.endTurn();
    await flushPromises();

    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        phase: "finished",
        gameState: expect.objectContaining({ turn: 2 }),
      }),
    );
    expect(engineClient.analyzeCalls).toHaveLength(1);
  });

  it("봇의 세 번째 골 직후 finished로 전환하고 사람 입력을 열지 않는다", async () => {
    const engineClient = new FakeEngineClient();
    engineClient.analyzeImpl = async (state, depth) => ({
      best:
        legalMoves(state).find(
          (move) => move.kind === "shoot" && move.pieceId === 9 && move.goalRow === 4,
        ) ?? null,
      score: 0,
      nodes: 1,
      depth,
      ms: 0,
      values: [],
    });
    const controller = createGameController({
      engineClient,
      onChange: () => undefined,
      createState: createAwayWinningShotState,
    });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const humanMove = legalMoves(state).find((move) => move.kind === "move")!;
    const actor = state.pieces.find((piece) => piece.id === humanMove.pieceId)!;
    controller.handleTarget({ kind: "cell", pos: { ...actor.pos } });
    controller.selectAction("move");

    controller.handleTarget(targetForMove(state, humanMove));
    controller.endTurn();
    await flushPromises();

    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        phase: "finished",
        gameState: expect.objectContaining({ score: { home: 1, away: 3 } }),
        selectedPieceId: null,
        selectedAction: null,
        candidateMoves: [],
      }),
    );
    expect(engineClient.analyzeCalls).toHaveLength(1);
  });

  it("봇 분석이 두 번 실패하면 Worker를 교체하고 세 번째 결과를 적용한다", async () => {
    const states: ClientViewState[] = [];
    const engineClient = new FakeEngineClient();
    let attempt = 0;
    engineClient.analyzeImpl = async (state, depth) => {
      attempt += 1;
      if (attempt < 3) throw new Error("일시적인 분석 실패");
      return {
        best: legalMoves(state)[0] ?? null,
        score: 0,
        nodes: 1,
        depth,
        ms: 0,
        values: [],
      };
    };
    const controller = createGameController({
      engineClient,
      onChange: (state) => states.push(state),
    });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const move = legalMoves(state).find((candidate) => candidate.kind === "move")!;
    const actor = state.pieces.find((piece) => piece.id === move.pieceId)!;
    controller.handleTarget({ kind: "cell", pos: { ...actor.pos } });
    controller.selectAction("move");

    controller.handleTarget(targetForMove(state, move));
    controller.endTurn();
    await flushPromises();

    expect(engineClient.restartCalls).toBe(2);
    expect(engineClient.analyzeCalls).toHaveLength(5);
    expect(
      states
        .map((published) => published.message)
        .filter((message) => message?.kind === "botRetry"),
    ).toEqual([
      { kind: "botRetry", attempt: 2, maxAttempts: 3 },
      { kind: "botRetry", attempt: 3, maxAttempts: 3 },
    ]);
    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        phase: "humanTurn",
        gameState: expect.objectContaining({ turn: 4 }),
      }),
    );
  });

  it("봇 분석이 세 번 모두 실패하면 fatalError가 되고 입력을 무시한다", async () => {
    const engineClient = new FakeEngineClient();
    engineClient.analyzeImpl = () => Promise.reject(new Error("분석 실패"));
    const controller = createGameController({ engineClient, onChange: () => undefined });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const move = legalMoves(state).find((candidate) => candidate.kind === "move")!;
    const actor = state.pieces.find((piece) => piece.id === move.pieceId)!;
    controller.handleTarget({ kind: "cell", pos: { ...actor.pos } });
    controller.selectAction("move");
    controller.handleTarget(targetForMove(state, move));
    controller.endTurn();
    await flushPromises();

    expect(engineClient.analyzeCalls).toHaveLength(3);
    expect(engineClient.restartCalls).toBe(2);
    const failed = controller.getViewState();
    expect(failed).toEqual(
      expect.objectContaining({ phase: "fatalError", message: { kind: "fatalError" } }),
    );

    controller.handleTarget({ kind: "cell", pos: { ...failed.gameState!.pieces[0]!.pos } });
    controller.selectAction("move");
    expect(controller.getViewState()).toEqual(failed);

    controller.restartGame();
    expect(engineClient.restartCalls).toBe(3);
    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        phase: "humanTurn",
        gameState: expect.objectContaining({ turn: 0, score: { home: 0, away: 0 } }),
        message: null,
      }),
    );
  });

  it("진행 중인 경기에서 봇이 best null을 반환하면 분석 실패로 재시도한다", async () => {
    const engineClient = new FakeEngineClient();
    engineClient.analyzeImpl = async (_state, depth) => ({
      best: null,
      score: 0,
      nodes: 0,
      depth,
      ms: 0,
      values: [],
    });
    const controller = createGameController({ engineClient, onChange: () => undefined });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const move = legalMoves(state).find((candidate) => candidate.kind === "move")!;
    const actor = state.pieces.find((piece) => piece.id === move.pieceId)!;
    controller.handleTarget({ kind: "cell", pos: { ...actor.pos } });
    controller.selectAction("move");

    controller.handleTarget(targetForMove(state, move));
    controller.endTurn();
    await flushPromises();

    expect(engineClient.analyzeCalls).toHaveLength(3);
    expect(engineClient.restartCalls).toBe(2);
    expect(controller.getViewState().phase).toBe("fatalError");
  });

  it("dispose는 EngineClient를 종료하고 대기 중이던 봇 응답을 무시한다", async () => {
    const pending = deferred<SearchResult>();
    const engineClient = new FakeEngineClient();
    engineClient.analyzeImpl = () => pending.promise;
    const controller = createGameController({ engineClient, onChange: () => undefined });
    controller.startGame();
    const state = controller.getViewState().gameState!;
    const humanMove = legalMoves(state).find((move) => move.kind === "move")!;
    const actor = state.pieces.find((piece) => piece.id === humanMove.pieceId)!;
    controller.handleTarget({ kind: "cell", pos: { ...actor.pos } });
    controller.selectAction("move");
    controller.handleTarget(targetForMove(state, humanMove));
    controller.endTurn();
    const stateAtBotTurn = controller.getViewState().gameState!;
    const botMove = legalMoves(stateAtBotTurn)[0]!;
    expect(engineClient.analyzeCalls).toHaveLength(1);

    controller.dispose();
    pending.resolve({
      best: botMove,
      score: 0,
      nodes: 1,
      depth: 3,
      ms: 0,
      values: [],
    });
    await flushPromises();

    expect(engineClient.disposed).toBe(true);
    expect(controller.getViewState().gameState?.turn).toBe(1);
  });

  it("새 게임 뒤 도착한 이전 경기의 봇 응답을 epoch로 무시한다", async () => {
    const pending = deferred<SearchResult>();
    const engineClient = new FakeEngineClient();
    engineClient.analyzeImpl = () => pending.promise;
    const controller = createGameController({ engineClient, onChange: () => undefined });
    controller.startGame();
    const oldState = controller.getViewState().gameState!;
    const humanMove = legalMoves(oldState).find((move) => move.kind === "move")!;
    const actor = oldState.pieces.find((piece) => piece.id === humanMove.pieceId)!;
    controller.handleTarget({ kind: "cell", pos: { ...actor.pos } });
    controller.selectAction("move");
    controller.handleTarget(targetForMove(oldState, humanMove));
    controller.endTurn();
    const oldBotState = controller.getViewState().gameState!;
    const oldBotMove = legalMoves(oldBotState)[0]!;
    expect(engineClient.analyzeCalls).toHaveLength(1);

    controller.restartGame();
    pending.resolve({
      best: oldBotMove,
      score: 0,
      nodes: 1,
      depth: 3,
      ms: 0,
      values: [],
    });
    await flushPromises();

    expect(controller.getViewState()).toEqual(
      expect.objectContaining({
        phase: "humanTurn",
        gameState: expect.objectContaining({ turn: 0, score: { home: 0, away: 0 } }),
        lastMove: null,
      }),
    );
  });
});

describe("슛 위협 미리보기", () => {
  function createThreatState(): GameState {
    const state = createInitialState();
    // away MF 9가 슛 거리(골라인 x=-1에서 7칸) 안인 (5,5)에서 공을 잡은 사람 턴을 만든다.
    state.pieces.find((piece) => piece.id === 3)!.pos = { x: 7, y: 2 };
    state.pieces.find((piece) => piece.id === 9)!.pos = { x: 5, y: 5 };
    state.ball = { kind: "held", pieceId: 9 };
    return state;
  }

  it("사람 턴에 슛 거리 안의 away 공 소유자는 골문 세 행의 위협 미리보기를 노출한다", () => {
    const controller = createGameController({
      engineClient: new FakeEngineClient(),
      onChange: () => undefined,
      createState: createThreatState,
    });
    controller.startGame();

    const threats = controller.getViewState().threatShots;
    expect(threats.map(({ move }) => move)).toEqual([
      { kind: "shoot", pieceId: 9, goalRow: 3 },
      { kind: "shoot", pieceId: 9, goalRow: 4 },
      { kind: "shoot", pieceId: 9, goalRow: 5 },
    ]);
    for (const { preview } of threats) {
      expect(preview.kind).toBe("shoot");
      if (preview.kind !== "shoot") throw new Error("슛 미리보기 종류 불일치");
      expect(preview.goalChance).toBeGreaterThan(0);
      expect(preview.goalChance).toBeLessThanOrEqual(1);
    }
  });

  it("home이 공을 가지면 위협 미리보기를 만들지 않는다", () => {
    const controller = createGameController({
      engineClient: new FakeEngineClient(),
      onChange: () => undefined,
    });
    controller.startGame();

    expect(controller.getViewState().threatShots).toEqual([]);
  });

  it("away 공 소유자가 슛 거리 밖이면 위협 미리보기를 만들지 않는다", () => {
    const controller = createGameController({
      engineClient: new FakeEngineClient(),
      onChange: () => undefined,
      createState: createStealState,
    });
    controller.startGame();

    expect(controller.getViewState().threatShots).toEqual([]);
  });
});
