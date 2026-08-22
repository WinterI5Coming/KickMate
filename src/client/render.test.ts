import { describe, expect, it } from "vitest";
import { createInitialState, legalMoves, previewMove } from "../engine/rules";
import { buildPresentation, createRenderer, type RenderRefs } from "./render";
import { targetForMove } from "./input";
import type { ClientViewState } from "./types";

const readyState: ClientViewState = {
  phase: "ready",
  gameState: null,
  canHold: false,
  canEndTurn: false,
  selectedPieceId: null,
  selectedAction: null,
  availableActions: [],
  candidateMoves: [],
  candidatePreviews: [],
  selectedStealTargetId: null,
  threatShots: [],
  lastMove: null,
  botAttempt: 0,
  message: null,
};

const humanState: ClientViewState = {
  ...readyState,
  phase: "humanTurn",
  gameState: createInitialState(),
};

class FakeElement {
  textContent: string | null = null;
  hidden = false;
}

class FakeButton extends FakeElement {
  disabled = false;
  attributes = new Map<string, string>();

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class RecordingContext {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  lineWidth = 1;
  globalAlpha = 1;
  font = "";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";
  readonly fillRects: Array<[number, number, number, number]> = [];
  readonly texts: string[] = [];
  readonly fillTextRecords: Array<{ text: string; x: number; y: number; color: string }> = [];
  readonly arcs: Array<[number, number, number]> = [];
  readonly strokes: Array<[number, number, number]> = [];
  readonly circleStrokes: Array<{
    x: number;
    y: number;
    radius: number;
    color: string;
    width: number;
  }> = [];
  readonly lines: Array<{
    from: [number, number];
    to: [number, number];
    color: string;
    width: number;
  }> = [];
  strokeCalls = 0;
  private currentArc: [number, number, number] | null = null;
  private currentFrom: [number, number] | null = null;
  private currentTo: [number, number] | null = null;

  fillRect(x: number, y: number, width: number, height: number): void {
    this.fillRects.push([x, y, width, height]);
  }

  strokeRect(): void {}
  beginPath(): void {
    this.currentArc = null;
    this.currentFrom = null;
    this.currentTo = null;
  }
  fill(): void {}
  stroke(): void {
    this.strokeCalls += 1;
    if (this.currentArc) {
      this.strokes.push(this.currentArc);
      this.circleStrokes.push({
        x: this.currentArc[0],
        y: this.currentArc[1],
        radius: this.currentArc[2],
        color: String(this.strokeStyle),
        width: this.lineWidth,
      });
    }
    if (this.currentFrom && this.currentTo) {
      this.lines.push({
        from: this.currentFrom,
        to: this.currentTo,
        color: String(this.strokeStyle),
        width: this.lineWidth,
      });
    }
  }
  moveTo(x: number, y: number): void {
    this.currentFrom = [x, y];
  }
  lineTo(x: number, y: number): void {
    this.currentTo = [x, y];
  }
  save(): void {}
  restore(): void {}
  setLineDash(_segments: number[]): void {}

  arc(x: number, y: number, radius: number): void {
    this.arcs.push([x, y, radius]);
    this.currentArc = [x, y, radius];
  }

  fillText(text: string, x = 0, y = 0): void {
    this.texts.push(text);
    this.fillTextRecords.push({ text, x, y, color: String(this.fillStyle) });
  }
}

function createRenderRefs(): {
  refs: RenderRefs;
  context: RecordingContext;
  buttons: Record<"move" | "pass" | "shoot", FakeButton>;
  startButton: FakeButton;
  newGameButton: FakeButton;
  holdButton: FakeButton;
  endTurnButton: FakeButton;
} {
  const context = new RecordingContext();
  const buttons = {
    move: new FakeButton(),
    pass: new FakeButton(),
    shoot: new FakeButton(),
  };
  const startButton = new FakeButton();
  const newGameButton = new FakeButton();
  const holdButton = new FakeButton();
  const endTurnButton = new FakeButton();
  return {
    context,
    buttons,
    startButton,
    newGameButton,
    holdButton,
    endTurnButton,
    refs: {
      canvas: { width: 1200, height: 720 } as HTMLCanvasElement,
      context: context as unknown as CanvasRenderingContext2D,
      scoreHome: new FakeElement() as HTMLElement,
      scoreAway: new FakeElement() as HTMLElement,
      turnInfo: new FakeElement() as HTMLElement,
      statusMessage: new FakeElement() as HTMLElement,
      startButton: startButton as unknown as HTMLButtonElement,
      newGameButton: newGameButton as unknown as HTMLButtonElement,
      holdButton: holdButton as unknown as HTMLButtonElement,
      endTurnButton: endTurnButton as unknown as HTMLButtonElement,
      actionButtons: {
        move: buttons.move as unknown as HTMLButtonElement,
        pass: buttons.pass as unknown as HTMLButtonElement,
        shoot: buttons.shoot as unknown as HTMLButtonElement,
      },
    },
  };
}

describe("buildPresentation", () => {
  it("ready에서는 시작 버튼만 표시하고 경기 입력을 잠근다", () => {
    const presentation = buildPresentation(readyState);

    expect(presentation).toEqual(
      expect.objectContaining({
        scoreHome: 0,
        scoreAway: 0,
        turnText: "0 / 60 행동",
        status: "게임을 시작하세요.",
        showStart: true,
        showNewGame: false,
        visibleActions: [],
        selectedAction: null,
        inputLocked: true,
      }),
    );
  });

  it("humanTurn에서는 현재 기물에 가능한 행동만 표시하고 입력을 연다", () => {
    const presentation = buildPresentation({
      ...humanState,
      selectedAction: "move",
      availableActions: ["move", "pass"],
    });

    expect(presentation.status).toBe("내 차례입니다.");
    expect(presentation.visibleActions).toEqual(["move", "pass"]);
    expect(presentation.selectedAction).toBe("move");
    expect(presentation.inputLocked).toBe(false);
  });

  it("사람 팀 턴의 남은 행동과 선택 선수 사용 횟수를 표시한다", () => {
    const gameState = createInitialState();
    gameState.actionsRemaining = 2;
    gameState.actionCountByPiece[3] = 1;

    const presentation = buildPresentation({
      ...humanState,
      gameState,
      selectedPieceId: 3,
    });

    expect(presentation.turnText).toBe("0 / 60 행동 · HOME 2/3 · 선택 선수 1/2");
  });

  it("합법 상태에서 버티기와 턴 종료 버튼만 표시한다", () => {
    const presentation = buildPresentation({
      ...humanState,
      canHold: true,
      canEndTurn: true,
    });

    expect(presentation.showHold).toBe(true);
    expect(presentation.showEndTurn).toBe(true);
  });

  it("finished에서는 승리 결과와 새 게임 버튼을 표시한다", () => {
    const finished = createInitialState();
    finished.score.home = 3;

    const presentation = buildPresentation({
      ...humanState,
      phase: "finished",
      gameState: finished,
    });

    expect(presentation.status).toBe("승리했습니다!");
    expect(presentation.showStart).toBe(false);
    expect(presentation.showNewGame).toBe(true);
    expect(presentation.visibleActions).toEqual([]);
    expect(presentation.inputLocked).toBe(true);
  });

  it("botThinking 첫 시도에는 기본 생각 중 문구를 표시한다", () => {
    const presentation = buildPresentation({
      ...humanState,
      phase: "botThinking",
      botAttempt: 1,
    });

    expect(presentation.status).toBe("봇이 생각 중입니다.");
    expect(presentation.inputLocked).toBe(true);
  });

  it("재시도 메시지는 기본 단계 문구보다 우선하며 횟수를 포함한다", () => {
    const presentation = buildPresentation({
      ...humanState,
      phase: "botThinking",
      botAttempt: 2,
      message: { kind: "botRetry", attempt: 2, maxAttempts: 3 },
    });

    expect(presentation.status).toBe("봇 분석을 다시 시도합니다. (2/3)");
  });

  it("fatalError에서는 오류 문구와 새 게임 버튼을 표시한다", () => {
    const presentation = buildPresentation({
      ...humanState,
      phase: "fatalError",
      message: { kind: "fatalError" },
    });

    expect(presentation.status).toBe("봇 분석에 실패했습니다. 새 게임을 시작해 주세요.");
    expect(presentation.showNewGame).toBe(true);
    expect(presentation.inputLocked).toBe(true);
  });

  it("60 ply 동점 종료는 무승부로 표시한다", () => {
    const draw = createInitialState();
    draw.turn = 60;
    draw.score = { home: 2, away: 2 };

    const presentation = buildPresentation({
      ...humanState,
      phase: "finished",
      gameState: draw,
    });

    expect(presentation.turnText).toBe("60 / 60 행동 · HOME 3/3");
    expect(presentation.status).toBe("무승부입니다.");
  });

  it("away 승리는 봇 승리로 표시한다", () => {
    const finished = createInitialState();
    finished.score.away = 3;

    const presentation = buildPresentation({
      ...humanState,
      phase: "finished",
      gameState: finished,
    });

    expect(presentation.status).toBe("봇이 승리했습니다.");
  });

  it.each([
    [{ kind: "selectOwn" }, "먼저 내 기물을 선택하세요."],
    [{ kind: "cannotSteal" }, "이 기물은 스틸할 수 없습니다."],
    [{ kind: "invalidShot" }, "선택한 방향으로 슛할 수 없습니다."],
    [
      { kind: "chooseReceiver" },
      "패스할 아군을 선택하세요. ! 경로는 다른 선수가 먼저 받습니다.",
    ],
    [
      { kind: "chooseGoal" },
      "골문의 위·가운데·아래를 선택하세요. ! 경로는 수비에게 막힙니다.",
    ],
    [{ kind: "chooseStealer" }, "공을 빼앗을 내 선수를 선택하세요."],
    [
      { kind: "protectedCarrier" },
      "◆ 다른 행동을 하나 완료할 때까지 이 공 소유자를 스틸할 수 없습니다.",
    ],
  ] as const)("입력 안내 메시지 %o를 문구로 표시한다", (message, expected) => {
    const presentation = buildPresentation({ ...humanState, message });

    expect(presentation.status).toBe(expected);
  });
});

describe("createRenderer", () => {
  it("표시 모델을 점수·상태·버튼 DOM 속성에 반영한다", () => {
    const { refs, buttons, startButton, newGameButton } = createRenderRefs();
    const render = createRenderer(refs);

    render({
      ...humanState,
      selectedAction: "pass",
      availableActions: ["move", "pass"],
    });

    expect(refs.scoreHome.textContent).toBe("0");
    expect(refs.scoreAway.textContent).toBe("0");
    expect(refs.turnInfo.textContent).toBe("0 / 60 행동 · HOME 3/3");
    expect(refs.statusMessage.textContent).toBe("내 차례입니다.");
    expect(startButton.hidden).toBe(true);
    expect(newGameButton.hidden).toBe(true);
    expect(buttons.move.hidden).toBe(false);
    expect(buttons.move.disabled).toBe(false);
    expect(buttons.pass.attributes.get("aria-pressed")).toBe("true");
    expect(buttons.shoot.hidden).toBe(true);
  });

  it("경기 상태가 있으면 경기장과 열두 기물 역할 및 공을 Canvas에 그린다", () => {
    const { refs, context } = createRenderRefs();
    const render = createRenderer(refs);

    render(humanState);

    expect(context.fillRects).toContainEqual([0, 0, 1200, 720]);
    expect(context.texts).toEqual([
      "GK", "DF", "DF", "MF", "MF", "FW",
      "GK", "DF", "DF", "MF", "MF", "FW",
    ]);
    expect(context.arcs.length).toBeGreaterThanOrEqual(13);
  });

  it("직전 수, 행동 후보와 선택 기물을 현재 프레임에 함께 표시한다", () => {
    const { refs, context } = createRenderRefs();
    const gameState = createInitialState();
    const move = legalMoves(gameState).find((candidate) => candidate.kind === "move")!;
    const actor = gameState.pieces.find((piece) => piece.id === move.pieceId)!;
    const render = createRenderer(refs);

    render({
      ...humanState,
      gameState,
      selectedPieceId: actor.id,
      selectedAction: "move",
      availableActions: ["move"],
      candidateMoves: [move],
      lastMove: {
        move,
        from: { ...actor.pos },
        target: targetForMove(gameState, move),
      },
    });

    expect(context.arcs).toHaveLength(16);
    expect(context.strokeCalls).toBe(3);
  });

  it("아군 기물에 연결되는 패스 후보는 기물 밖에서도 보이는 테두리로 표시한다", () => {
    const { refs, context } = createRenderRefs();
    const gameState = createInitialState();
    const passer = gameState.pieces.find((piece) => piece.id === 3)!;
    const pass = legalMoves(gameState).find(
      (move) =>
        move.kind === "pass" &&
        move.pieceId === passer.id &&
        move.targetPieceId === 5,
    )!;
    const render = createRenderer(refs);

    render({
      ...humanState,
      gameState,
      selectedPieceId: passer.id,
      selectedAction: "pass",
      availableActions: ["pass"],
      candidateMoves: [pass],
    });

    expect(context.strokes).toContainEqual([520, 360, 32]);
  });

  it("성공 패스 경로는 초록 선과 도착 확률을 그리고 실제 수신자를 이중 강조한다", () => {
    const { refs, context } = createRenderRefs();
    const gameState = createInitialState();
    const pass = legalMoves(gameState).find(
      (move) => move.kind === "pass" && move.pieceId === 3 && move.targetPieceId === 5,
    )!;
    const preview = previewMove(gameState, pass);
    const render = createRenderer(refs);

    render({
      ...humanState,
      gameState,
      selectedPieceId: 3,
      selectedAction: "pass",
      availableActions: ["pass"],
      candidateMoves: [pass],
      candidatePreviews: [{ move: pass, preview }],
    });

    expect(context.texts).toContain("100%");
    expect(context.texts.indexOf("100%")).toBeGreaterThan(context.texts.lastIndexOf("FW"));
    expect(context.lines).toContainEqual({
      from: [600, 360],
      to: [520, 360],
      color: "#39d98a",
      width: 5,
    });
    expect(
      context.circleStrokes.filter(
        (stroke) => stroke.x === 520 && stroke.y === 360 && stroke.color === "#f6c453",
      ),
    ).toHaveLength(2);
    expect(context.globalAlpha).toBe(1);
  });

  it("차단 슛은 빨간 선과 득점 확률을 그리고 실제 차단자를 이중 강조한다", () => {
    const { refs, context } = createRenderRefs();
    const gameState = createInitialState();
    gameState.pieces.find((piece) => piece.id === 3)!.pos = { x: 9, y: 2 };
    gameState.pieces.find((piece) => piece.id === 7)!.pos = { x: 11, y: 3 };
    gameState.pieces.find((piece) => piece.id === 8)!.pos = { x: 10, y: 7 };
    gameState.ball = { kind: "held", pieceId: 3 };
    const shoot = legalMoves(gameState).find(
      (move) => move.kind === "shoot" && move.pieceId === 3 && move.goalRow === 4,
    )!;
    const preview = previewMove(gameState, shoot);
    const render = createRenderer(refs);

    render({
      ...humanState,
      gameState,
      selectedPieceId: 3,
      selectedAction: "shoot",
      availableActions: ["shoot"],
      candidateMoves: [shoot],
      candidatePreviews: [{ move: shoot, preview }],
    });

    // 관문 확률(필드 0.65 차단, GK 0.75 선방)을 모두 뚫을 확률 0.35×0.25는 9%로 표시된다.
    expect(context.texts).toContain("9%");
    expect(context.lines).toContainEqual({
      from: [840, 200],
      to: [1000, 280],
      color: "#ff5c5c",
      width: 5,
    });
    expect(
      context.circleStrokes.filter(
        (stroke) => stroke.x === 1000 && stroke.y === 280 && stroke.color === "#f6c453",
      ),
    ).toHaveLength(2);
    expect(context.globalAlpha).toBe(1);
  });

  it("압박받는 공 소유자와 버틴 상태를 서로 다른 테두리로 그린다", () => {
    const pressuredRefs = createRenderRefs();
    const gameState = createInitialState();

    createRenderer(pressuredRefs.refs)({ ...humanState, gameState });
    expect(
      pressuredRefs.context.circleStrokes.some((stroke) => stroke.color === "#ff9f43"),
    ).toBe(true);

    const heldRefs = createRenderRefs();
    gameState.heldFirmPieceId = gameState.ball.kind === "held" ? gameState.ball.pieceId : null;
    createRenderer(heldRefs.refs)({ ...humanState, gameState });
    expect(heldRefs.context.circleStrokes.some((stroke) => stroke.color === "#4dd0e1")).toBe(
      true,
    );
    expect(heldRefs.context.circleStrokes.some((stroke) => stroke.color === "#ff9f43")).toBe(
      false,
    );
  });

  it("필드 차단 슛은 예상 루즈볼 칸을 리바운드 색으로 표시한다", () => {
    const { refs, context } = createRenderRefs();
    const gameState = createInitialState();
    gameState.pieces.find((piece) => piece.id === 3)!.pos = { x: 9, y: 2 };
    gameState.pieces.find((piece) => piece.id === 7)!.pos = { x: 11, y: 3 };
    gameState.pieces.find((piece) => piece.id === 8)!.pos = { x: 10, y: 7 };
    gameState.ball = { kind: "held", pieceId: 3 };
    const shoot = legalMoves(gameState).find(
      (move) => move.kind === "shoot" && move.pieceId === 3 && move.goalRow === 4,
    )!;
    const preview = previewMove(gameState, shoot);
    expect(preview).toMatchObject({ kind: "shoot", outcome: "fieldRebound" });

    createRenderer(refs)({
      ...humanState,
      gameState,
      candidateMoves: [shoot],
      candidatePreviews: [{ move: shoot, preview }],
    });

    expect(context.circleStrokes.filter((stroke) => stroke.color === "#ffd166")).toHaveLength(2);
  });

  it("스틸 보호 중인 공 소유자 위에 보라색 ◆를 표시한다", () => {
    const { refs, context } = createRenderRefs();
    const gameState = createInitialState();
    gameState.stealProtection = {
      pieceId: 3,
      blockedTeam: "away",
      blockedActionsRemaining: 1,
    };
    const render = createRenderer(refs);

    render({ ...humanState, gameState });

    expect(context.fillTextRecords).toContainEqual({
      text: "◆",
      x: 600,
      y: 336,
      color: "#d8b4fe",
    });
  });

  it("보호 소유자를 상대 두 명이 포위하면 보라색 ◆를 표시하지 않는다", () => {
    const { refs, context } = createRenderRefs();
    const gameState = createInitialState();
    gameState.pieces.find((piece) => piece.id === 10)!.pos = { x: 7, y: 5 };
    gameState.stealProtection = {
      pieceId: 3,
      blockedTeam: "away",
      blockedActionsRemaining: 1,
    };
    const render = createRenderer(refs);

    render({ ...humanState, gameState });

    expect(context.fillTextRecords.some(({ text }) => text === "◆")).toBe(false);
  });

  it("복수 스틸러 선택 중에는 상대 공 소유자가 아니라 후보 home 기물을 강조한다", () => {
    const { refs, context } = createRenderRefs();
    const gameState = createInitialState();
    gameState.pieces.find((piece) => piece.id === 3)!.pos = { x: 7, y: 4 };
    gameState.pieces.find((piece) => piece.id === 5)!.pos = { x: 7, y: 6 };
    gameState.pieces.find((piece) => piece.id === 9)!.pos = { x: 8, y: 5 };
    gameState.ball = { kind: "held", pieceId: 9 };
    const steals = legalMoves(gameState).filter(
      (move) => move.kind === "steal" && move.targetPieceId === 9,
    );
    const render = createRenderer(refs);

    render({
      ...humanState,
      gameState,
      candidateMoves: steals,
      candidatePreviews: steals.map((move) => ({ move, preview: previewMove(gameState, move) })),
      selectedStealTargetId: 9,
    });

    expect(context.circleStrokes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ x: 680, y: 360, color: "#ff4d6d" }),
        expect.objectContaining({ x: 680, y: 520, color: "#ff4d6d" }),
      ]),
    );
    expect(
      context.circleStrokes.some(
        (stroke) => stroke.x === 760 && stroke.y === 440 && stroke.color === "#ff4d6d",
      ),
    ).toBe(false);
  });
});
