import { describe, expect, it } from "vitest";
import { evalLv1 } from "./eval/lv1";
import {
  applyMove,
  applyMoveOutcomes,
  bestShotGoalChance,
  createInitialState,
  gameResult,
  inBounds,
  isPressured,
  legalMoves,
  previewMove,
  sideToMove,
} from "./rules";
import { search } from "./search";
import { BOARD_H, BOARD_W, type GameState, type Pos } from "./types";

function setPos(state: GameState, pieceId: number, pos: Pos): void {
  state.pieces.find((piece) => piece.id === pieceId)!.pos = pos;
}

/** 실제 6대6 배치를 보존한 채 슛에 필요한 기물만 재배치한다. */
function createShotState(reposition: (state: GameState) => void): GameState {
  const state = createInitialState();
  state.activeTeam = "home";
  state.actionsRemaining = 3;
  state.actionCountByPiece = {};
  state.heldFirmPieceId = null;
  state.stealProtection = null;
  setPos(state, 5, { x: 7, y: 4 });
  setPos(state, 6, { x: 12, y: 0 });
  setPos(state, 11, { x: 7, y: 7 });
  state.ball = { kind: "held", pieceId: 5 };
  reposition(state);

  expect(state.pieces).toHaveLength(12);
  expect(state.pieces.every((piece) => inBounds(piece.pos))).toBe(true);
  expect(new Set(state.pieces.map((piece) => `${piece.pos.x},${piece.pos.y}`)).size).toBe(12);
  return state;
}

describe("초기 국면", () => {
  it("첫 home 팀 턴을 3행동과 빈 선수별 사용 횟수로 시작한다", () => {
    const state = createInitialState();

    expect(sideToMove(state)).toBe("home");
    expect(state.actionsRemaining).toBe(3);
    expect(state.actionCountByPiece).toEqual({});
    expect(state.heldFirmPieceId).toBeNull();
    expect(state.stealProtection).toBeNull();
  });

  it("세 원자 행동 뒤 away의 새 3행동 팀 턴으로 넘어간다", () => {
    let state = createInitialState();
    for (let index = 0; index < 3; index += 1) {
      const move = legalMoves(state).find((candidate) => candidate.kind === "move")!;
      state = applyMove(state, move);
    }

    // 팀 턴 하나가 1수이므로 세 원자 행동 뒤 turn은 1이다.
    expect(state.turn).toBe(1);
    expect(sideToMove(state)).toBe("away");
    expect(state.actionsRemaining).toBe(3);
    expect(state.actionCountByPiece).toEqual({});
  });

  it("6대6 미러 배치에서 첫 home MF가 킥오프한다", () => {
    const state = createInitialState();

    expect(state.pieces).toHaveLength(12);
    expect(state.pieces.map((piece) => [piece.team, piece.role, piece.pos])).toEqual([
      ["home", "GK", { x: 0, y: 4 }],
      ["home", "DF", { x: 2, y: 2 }],
      ["home", "DF", { x: 2, y: 6 }],
      ["home", "MF", { x: 6, y: 4 }],
      ["home", "MF", { x: 4, y: 6 }],
      ["home", "FW", { x: 5, y: 4 }],
      ["away", "GK", { x: 12, y: 4 }],
      ["away", "DF", { x: 10, y: 6 }],
      ["away", "DF", { x: 10, y: 2 }],
      ["away", "MF", { x: 8, y: 6 }],
      ["away", "MF", { x: 8, y: 2 }],
      // 센터서클 규칙: home 킥오프이므로 away FW는 기본 (7,4)에서 한 칸 물러난다.
      ["away", "FW", { x: 8, y: 4 }],
    ]);
    expect(state.ball).toEqual({ kind: "held", pieceId: 3 });
    expect(sideToMove(state)).toBe("home");
  });

  it("모든 기물이 보드 안에 있고 같은 칸에 겹치지 않는다", () => {
    const state = createInitialState();
    const cells = state.pieces.map((piece) => `${piece.pos.x},${piece.pos.y}`);

    expect(state.pieces.every((piece) => inBounds(piece.pos))).toBe(true);
    expect(new Set(cells).size).toBe(cells.length);
    expect(state.pieces.filter((piece) => piece.team === "home")).toHaveLength(6);
    expect(state.pieces.filter((piece) => piece.team === "away")).toHaveLength(6);
  });

  it.each([
    [1, "DF"],
    [5, "FW"],
  ] as const)("home %s번 %s는 8방향 한 칸만 이동한다", (pieceId, role) => {
    const state = createInitialState();
    const piece = state.pieces.find((candidate) => candidate.id === pieceId)!;

    expect(piece).toMatchObject({ team: "home", role });
    const moves = legalMoves(state).filter(
      (move) => move.kind === "move" && move.pieceId === pieceId,
    );
    expect(moves.length).toBeGreaterThan(0);
    expect(
      moves.every(
        (move) =>
          move.kind === "move" &&
          Math.max(
            Math.abs(move.to.x - piece.pos.x),
            Math.abs(move.to.y - piece.pos.y),
          ) === 1,
      ),
    ).toBe(true);
  });

  it("GK는 8방향 한 칸을 유지하되 자기 골키퍼 박스 밖으로 나가지 않는다", () => {
    const state = createInitialState();
    const goalkeeper = state.pieces.find(
      (piece) => piece.team === "home" && piece.role === "GK",
    )!;
    const moves = legalMoves(state).filter(
      (move) => move.kind === "move" && move.pieceId === goalkeeper.id,
    );

    expect(moves.length).toBeGreaterThan(0);
    expect(
      moves.every(
        (move) =>
          move.kind === "move" &&
          move.to.x >= 0 &&
          move.to.x <= 1 &&
          move.to.y >= 2 &&
          move.to.y <= 6 &&
          Math.max(
            Math.abs(move.to.x - goalkeeper.pos.x),
            Math.abs(move.to.y - goalkeeper.pos.y),
          ) === 1,
      ),
    ).toBe(true);
  });

  it("초기 국면에 합법 수가 존재한다", () => {
    expect(legalMoves(createInitialState()).length).toBeGreaterThan(0);
  });

  it("모든 이동 목적지와 패스 대상 기물이 보드 안에 있다", () => {
    const state = createInitialState();
    const moves = legalMoves(state);
    const destinations = moves.flatMap((move) =>
      move.kind === "move"
        ? [move.to]
        : move.kind === "pass"
          ? [state.pieces.find((piece) => piece.id === move.targetPieceId)!.pos]
          : [],
    );

    expect(destinations.length).toBeGreaterThan(0);
    expect(destinations.every(inBounds)).toBe(true);
  });
});

describe("수 적용", () => {
  it("같은 선수의 세 번째 행동은 만들지 않지만 다른 선수는 남은 행동을 쓴다", () => {
    let state = createInitialState();
    const actorId = 0;
    for (let index = 0; index < 2; index += 1) {
      const move = legalMoves(state).find(
        (candidate) => candidate.kind === "move" && candidate.pieceId === actorId,
      )!;
      state = applyMove(state, move);
    }

    expect(
      legalMoves(state).some((move) => "pieceId" in move && move.pieceId === actorId),
    ).toBe(false);
    expect(
      legalMoves(state).some((move) => "pieceId" in move && move.pieceId !== actorId),
    ).toBe(true);
  });

  it("한 행동 뒤 endTurn은 행동 수를 늘리지 않고 상대 팀으로 넘긴다", () => {
    const initial = createInitialState();
    expect(legalMoves(initial).some((move) => move.kind === "endTurn")).toBe(false);
    const moved = applyMove(initial, legalMoves(initial).find((move) => move.kind === "move")!);
    const ended = applyMove(moved, { kind: "endTurn" });

    expect(ended.turn).toBe(1);
    expect(sideToMove(ended)).toBe("away");
    expect(ended.actionsRemaining).toBe(3);
  });

  it("막힌 패스는 선택한 아군과 실제 첫 수신자를 함께 예고한다", () => {
    const state = createInitialState();
    const passer = state.pieces.find((piece) => piece.id === 3)!;
    const target = state.pieces.find((piece) => piece.id === 1)!;
    const interceptor = state.pieces.find((piece) => piece.id === 6)!;
    passer.pos = { x: 4, y: 4 };
    interceptor.pos = { x: 3, y: 4 };
    target.pos = { x: 2, y: 4 };
    state.ball = { kind: "held", pieceId: passer.id };

    expect(
      previewMove(state, {
        kind: "pass",
        pieceId: passer.id,
        targetPieceId: target.id,
      }),
    ).toMatchObject({
      kind: "pass",
      targetPieceId: target.id,
      receiverPieceId: interceptor.id,
      reachesTarget: false,
    });

    const intercepted = applyMove(state, {
      kind: "pass",
      pieceId: passer.id,
      targetPieceId: target.id,
    });
    expect(intercepted.stealProtection).toEqual({
      pieceId: interceptor.id,
      blockedTeam: "home",
      blockedActionsRemaining: 1,
    });
  });

  it("같은 팀 패스는 새 스틸 보호를 만들지 않는다", () => {
    const state = createInitialState();
    const pass = legalMoves(state).find((move) => move.kind === "pass")!;
    const preview = previewMove(state, pass);
    if (preview.kind !== "pass") throw new Error("패스 미리보기가 필요합니다.");

    const passed = applyMove(state, pass);

    expect(state.pieces.find((piece) => piece.id === preview.receiverPieceId)?.team).toBe("home");
    expect(passed.ball).toEqual({ kind: "held", pieceId: preview.receiverPieceId });
    expect(passed.stealProtection).toBeNull();
  });

  it("골문 행을 직접 겨냥하고 경로 첫 기물을 차단자로 예고한다", () => {
    const state = createInitialState();
    const shooter = state.pieces.find((piece) => piece.id === 3)!;
    const blocker = state.pieces.find((piece) => piece.id === 7)!;
    shooter.pos = { x: 9, y: 2 };
    blocker.pos = { x: 11, y: 3 };
    setPos(state, 8, { x: 10, y: 7 });
    state.ball = { kind: "held", pieceId: shooter.id };

    expect(previewMove(state, { kind: "shoot", pieceId: shooter.id, goalRow: 4 }))
      .toMatchObject({
        kind: "shoot",
        goalRow: 4,
        outcome: "fieldRebound",
        blockerPieceId: blocker.id,
      });
  });

  it("패스 경로 모서리에서 동시에 만난 기물 중 ID가 낮은 기물을 수신자로 고른다", () => {
    const state = createInitialState();
    const passer = state.pieces.find((piece) => piece.id === 3)!;
    const target = state.pieces.find((piece) => piece.id === 5)!;
    const lowerId = state.pieces.find((piece) => piece.id === 1)!;
    const higherId = state.pieces.find((piece) => piece.id === 8)!;
    passer.pos = { x: 2, y: 2 };
    lowerId.pos = { x: 3, y: 2 };
    higherId.pos = { x: 2, y: 3 };
    target.pos = { x: 4, y: 4 };
    state.pieces = [higherId, ...state.pieces.filter((piece) => piece.id !== higherId.id)];
    state.ball = { kind: "held", pieceId: passer.id };

    expect(
      previewMove(state, {
        kind: "pass",
        pieceId: passer.id,
        targetPieceId: target.id,
      }),
    ).toMatchObject({ receiverPieceId: lowerId.id, reachesTarget: false });
  });

  it("슛 경로 모서리에서 동시에 만난 기물 중 ID가 낮은 기물을 차단자로 고른다", () => {
    const state = createInitialState();
    const shooter = state.pieces.find((piece) => piece.id === 3)!;
    const lowerId = state.pieces.find((piece) => piece.id === 7)!;
    const higherId = state.pieces.find((piece) => piece.id === 8)!;
    // (11,3)→(13,5) 대각 슛의 첫 모서리에서 (12,3)과 (11,4)가 같은 시점에 닿는다.
    shooter.pos = { x: 11, y: 3 };
    lowerId.pos = { x: 12, y: 3 };
    higherId.pos = { x: 11, y: 4 };
    setPos(state, 6, { x: 12, y: 0 });
    state.pieces = [higherId, ...state.pieces.filter((piece) => piece.id !== higherId.id)];
    state.ball = { kind: "held", pieceId: shooter.id };

    expect(previewMove(state, { kind: "shoot", pieceId: shooter.id, goalRow: 5 }))
      .toMatchObject({ blockerPieceId: lowerId.id, outcome: "fieldRebound" });
  });

  it("입력 상태를 변경하지 않는다", () => {
    const state = createInitialState();
    const before = structuredClone(state);
    const move = legalMoves(state).find((candidate) => candidate.kind === "move")!;

    applyMove(state, move);

    expect(state).toEqual(before);
  });

  it("빈 경로 슛은 득점하고 실점 팀 킥오프로 초기 배치한다", () => {
    const state = createInitialState();
    setPos(state, 6, { x: 12, y: 0 });
    setPos(state, 11, { x: 10, y: 1 });
    // 정확 사거리(3칸) 안에서 완전히 열린 경로여야 결정론적 득점이 된다.
    setPos(state, 3, { x: 10, y: 4 });

    const shoot = legalMoves(state).find(
      (move) => move.kind === "shoot" && move.pieceId === 3 && move.goalRow === 4,
    );
    expect(shoot).toBeDefined();
    const before = structuredClone(state);

    const next = applyMove(state, shoot!);

    expect(state).toEqual(before);
    expect(next.score).toEqual({ home: 1, away: 0 });
    expect(next.turn).toBe(1);
    expect(sideToMove(next)).toBe("away");
    expect(next.actionsRemaining).toBe(3);
    expect(next.actionCountByPiece).toEqual({});
    expect(next.ball).toEqual({ kind: "held", pieceId: 9 });
    expect(next.stealProtection).toBeNull();
    expect(next.pieces.find((piece) => piece.id === 3)?.pos).toEqual({ x: 4, y: 2 });
    expect(next.pieces.find((piece) => piece.id === 9)?.pos).toEqual({ x: 6, y: 4 });
  });

  it("필드 슛 차단은 첫 기물 주변의 루즈볼로 전환한다", () => {
    const state = createInitialState();
    setPos(state, 6, { x: 12, y: 0 });
    setPos(state, 7, { x: 9, y: 4 });
    setPos(state, 11, { x: 10, y: 1 });

    const shoot = legalMoves(state).find(
      (move) => move.kind === "shoot" && move.pieceId === 3 && move.goalRow === 4,
    );
    expect(shoot).toBeDefined();

    // 확률 분기 중 필드 차단 결과에서 리바운드는 슈터에게서 먼 수비 진영 쪽으로 튄다.
    const outcomes = applyMoveOutcomes(state, shoot!);
    const rebound = outcomes.find((outcome) => outcome.tag === "fieldRebound")!;
    expect(rebound).toBeDefined();
    expect(rebound.state.score).toEqual({ home: 0, away: 0 });
    expect(rebound.state.ball).toEqual({ kind: "loose", pos: { x: 10, y: 3 } });
    expect(rebound.state.stealProtection).toBeNull();
    // 팀 턴이 아직 안 끝났으므로 수는 그대로 0이다.
    expect(rebound.state.turn).toBe(0);
    expect(outcomes.map((outcome) => outcome.state.ball)).toContainEqual(
      applyMove(state, shoot!).ball,
    );
  });

  it("GK가 슛을 막으면 공격 팀의 다음 행동 하나 동안 스틸을 보호한다", () => {
    const state = createInitialState();
    setPos(state, 3, { x: 11, y: 4 });

    const shoot = legalMoves(state).find(
      (move) => move.kind === "shoot" && move.pieceId === 3 && move.goalRow === 4,
    )!;
    const saved = applyMove(state, shoot);

    expect(saved.ball).toEqual({ kind: "held", pieceId: 6 });
    expect(saved.stealProtection).toEqual({
      pieceId: 6,
      blockedTeam: "home",
      blockedActionsRemaining: 1,
    });
    expect(legalMoves(saved)).not.toContainEqual({
      kind: "steal",
      pieceId: 3,
      targetPieceId: 6,
    });
  });

  it("대각선으로 인접한 두 상대 기물을 모두 스틸 후보로 만든다", () => {
    const state = createInitialState();
    state.activeTeam = "away";
    const carrier = state.pieces.find((piece) => piece.id === 3)!;
    carrier.pos = { x: 6, y: 4 };
    state.ball = { kind: "held", pieceId: carrier.id };
    setPos(state, 7, { x: 5, y: 3 });
    setPos(state, 8, { x: 5, y: 5 });
    setPos(state, 11, { x: 7, y: 7 });

    expect(legalMoves(state).filter((move) => move.kind === "steal")).toEqual([
      { kind: "steal", pieceId: 7, targetPieceId: 3 },
      { kind: "steal", pieceId: 8, targetPieceId: 3 },
    ]);
  });

  it("스틸도 행동 하나를 소비한다", () => {
    const state = createInitialState();
    state.activeTeam = "away";
    setPos(state, 11, { x: 7, y: 4 });

    const steal = legalMoves(state).find(
      (move) => move.kind === "steal" && move.pieceId === 11 && move.targetPieceId === 3,
    );
    expect(steal).toBeDefined();

    // FW의 스틸은 45% 확률이므로 성공·실패 두 결과로 나뉜다.
    const outcomes = applyMoveOutcomes(state, steal!);
    expect(outcomes.map((outcome) => outcome.tag)).toEqual(["stealSuccess", "stealFailed"]);
    expect(outcomes[0]!.probability).toBeCloseTo(0.45, 9);
    const next = outcomes[0]!.state;

    expect(next.ball).toEqual({ kind: "held", pieceId: 11 });
    // 실패 분기는 소유권을 바꾸지 않고 행동만 소모한다.
    expect(outcomes[1]!.state.ball).toEqual({ kind: "held", pieceId: 3 });
    expect(outcomes[1]!.state.actionsRemaining).toBe(2);
    expect(next.activeTeam).toBe("away");
    expect(next.actionsRemaining).toBe(2);
    expect(next.actionCountByPiece).toEqual({ 11: 1 });
    expect(legalMoves(next).some((move) => move.kind === "steal")).toBe(false);
  });

});

describe("슛 차단과 리바운드", () => {
  it("슛 경로의 아군은 차단하지 않고 공이 통과한다", () => {
    const state = createShotState((shotState) => {
      setPos(shotState, 4, { x: 9, y: 4 });
    });
    const shoot = legalMoves(state).find(
      (move) => move.kind === "shoot" && move.pieceId === 5 && move.goalRow === 4,
    )!;

    expect(previewMove(state, shoot)).toMatchObject({
      kind: "shoot",
      outcome: "goal",
      blockerPieceId: null,
      reboundPos: null,
    });
  });

  it("상대 필드 차단은 슈터에게서 먼 수비 진영 쪽 빈 칸에 루즈볼을 만든다", () => {
    const state = createShotState((shotState) => {
      setPos(shotState, 7, { x: 10, y: 4 });
    });
    const shoot = legalMoves(state).find(
      (move) => move.kind === "shoot" && move.pieceId === 5 && move.goalRow === 4,
    )!;

    expect(previewMove(state, shoot)).toMatchObject({
      kind: "shoot",
      outcome: "fieldRebound",
      blockerPieceId: 7,
      reboundPos: { x: 11, y: 3 },
    });

    // 거리 6칸의 정확도 0.55가 먼저 적용되고 나머지가 차단·득점으로 나뉜다.
    const outcomes = applyMoveOutcomes(state, shoot);
    expect(outcomes.map((outcome) => outcome.tag)).toEqual([
      "offTarget",
      "fieldRebound",
      "goal",
    ]);
    expect(outcomes[0]!.probability).toBeCloseTo(0.45, 9);
    expect(outcomes[1]!.probability).toBeCloseTo(0.55 * 0.65, 9);
    expect(outcomes[1]!.state.ball).toEqual({ kind: "loose", pos: { x: 11, y: 3 } });
    expect(outcomes[2]!.probability).toBeCloseTo(0.55 * 0.35, 9);
    expect(outcomes[2]!.state.score).toEqual({ home: 1, away: 0 });
    expect(outcomes.map((outcome) => outcome.state.ball)).toContainEqual(
      applyMove(state, shoot).ball,
    );
  });

  it("상대 GK 차단은 보호된 공 소유로 전환한다", () => {
    const state = createShotState((shotState) => {
      setPos(shotState, 6, { x: 10, y: 4 });
    });
    const shoot = legalMoves(state).find(
      (move) => move.kind === "shoot" && move.pieceId === 5 && move.goalRow === 4,
    )!;

    expect(previewMove(state, shoot)).toMatchObject({
      kind: "shoot",
      outcome: "goalkeeperSave",
      blockerPieceId: 6,
      reboundPos: null,
    });

    const outcomes = applyMoveOutcomes(state, shoot);
    expect(outcomes.map((outcome) => outcome.tag)).toEqual([
      "offTarget",
      "goalkeeperSave",
      "goal",
    ]);
    expect(outcomes[1]!.probability).toBeCloseTo(0.55 * 0.75, 9);
    const saved = outcomes[1]!.state;
    expect(saved.ball).toEqual({ kind: "held", pieceId: 6 });
    expect(saved.stealProtection).toEqual({
      pieceId: 6,
      blockedTeam: "home",
      blockedActionsRemaining: 1,
    });
    expect(outcomes.map((outcome) => outcome.state.ball)).toContainEqual(
      applyMove(state, shoot).ball,
    );
  });

  it("필드 차단자 주변이 모두 차면 차단자를 한 행동 보호한다", () => {
    const state = createShotState((shotState) => {
      setPos(shotState, 0, { x: 9, y: 3 });
      setPos(shotState, 1, { x: 10, y: 3 });
      setPos(shotState, 2, { x: 11, y: 3 });
      setPos(shotState, 3, { x: 9, y: 4 });
      setPos(shotState, 4, { x: 11, y: 4 });
      setPos(shotState, 6, { x: 9, y: 5 });
      setPos(shotState, 7, { x: 10, y: 4 });
      setPos(shotState, 8, { x: 10, y: 5 });
      setPos(shotState, 9, { x: 11, y: 5 });
    });
    const shoot = legalMoves(state).find(
      (move) => move.kind === "shoot" && move.pieceId === 5 && move.goalRow === 4,
    )!;

    // 경로 인접 영향권이 있으면 대표 차단자는 가장 먼저 개입할 수 있는 상대가 된다.
    const preview = previewMove(state, shoot);
    if (preview.kind !== "shoot") throw new Error("슛 미리보기 종류 불일치");
    expect(preview.goalChance).toBeGreaterThan(0);
    expect(preview.goalChance).toBeLessThan(1);

    const outcomes = applyMoveOutcomes(state, shoot);
    const possession = outcomes.find((outcome) => outcome.tag === "fieldPossession");
    expect(possession).toBeDefined();
    const possessed = possession!.state;
    expect(possessed.ball).toEqual({ kind: "held", pieceId: 7 });
    expect(possessed.stealProtection).toEqual({
      pieceId: 7,
      blockedTeam: "home",
      blockedActionsRemaining: 1,
    });
  });

  it("루즈볼을 주운 기물을 상대 팀의 다음 행동 하나 동안 보호한다", () => {
    const state = createInitialState();
    state.ball = { kind: "loose", pos: { x: 5, y: 3 } };
    const pickup = legalMoves(state).find(
      (move) => move.kind === "move" && move.pieceId === 3 && move.to.x === 5 && move.to.y === 3,
    )!;

    const pickedUp = applyMove(state, pickup);

    expect(pickedUp.ball).toEqual({ kind: "held", pieceId: 3 });
    expect(pickedUp.stealProtection).toEqual({
      pieceId: 3,
      blockedTeam: "away",
      blockedActionsRemaining: 1,
    });
  });
});

describe("압박, 버티기, 스틸 보호", () => {
  it("인접 상대에게 압박받는 공 소유자는 바로 이동하지 못한다", () => {
    const state = createInitialState();
    const carrierId = state.ball.kind === "held" ? state.ball.pieceId : -1;
    const carrier = state.pieces.find((piece) => piece.id === carrierId)!;
    const defender = state.pieces.find((piece) => piece.team === "away" && piece.role === "FW")!;
    defender.pos = { x: carrier.pos.x + 1, y: carrier.pos.y };

    expect(isPressured(state, carrier.id)).toBe(true);
    expect(legalMoves(state).some((move) => move.kind === "move" && move.pieceId === carrier.id)).toBe(false);
    expect(legalMoves(state)).toContainEqual({ kind: "hold", pieceId: carrier.id });
  });

  it("버티기는 팀 행동만 소비해 탈압박 이동 뒤 한 번 더 행동할 수 있다", () => {
    const pressured = createInitialState();
    const carrierId = pressured.ball.kind === "held" ? pressured.ball.pieceId : -1;
    const held = applyMove(pressured, { kind: "hold", pieceId: carrierId });

    expect(held.heldFirmPieceId).toBe(carrierId);
    const escape = legalMoves(held).find((move) => move.kind === "move" && move.pieceId === carrierId)!;
    const escaped = applyMove(held, escape);
    expect(escaped.heldFirmPieceId).toBeNull();
    expect(escaped.actionCountByPiece[carrierId]).toBe(1);
    expect(legalMoves(escaped).some((move) =>
      "pieceId" in move && move.pieceId === carrierId &&
      (move.kind === "pass" || move.kind === "shoot")
    )).toBe(true);
  });

  it("버티기 뒤 패스로 공이 다른 기물에게 가면 버티기 상태를 해제한다", () => {
    const state = createInitialState();
    const held = applyMove(state, { kind: "hold", pieceId: 3 });
    const pass = legalMoves(held).find(
      (move) => move.kind === "pass" && move.pieceId === 3 && move.targetPieceId === 5,
    )!;
    const passed = applyMove(held, pass);

    expect(passed.ball).toEqual({ kind: "held", pieceId: 5 });
    expect(passed.heldFirmPieceId).toBeNull();
  });

  it("버티기 뒤 슛이 막혀 공이 수비수에게 가면 버티기 상태를 해제한다", () => {
    const state = createInitialState();
    setPos(state, 3, { x: 9, y: 4 });
    setPos(state, 6, { x: 12, y: 0 });
    setPos(state, 7, { x: 10, y: 4 });
    setPos(state, 11, { x: 10, y: 1 });
    state.ball = { kind: "held", pieceId: 3 };

    const held = applyMove(state, { kind: "hold", pieceId: 3 });
    const shoot = legalMoves(held).find(
      (move) => move.kind === "shoot" && move.pieceId === 3 && move.goalRow === 4,
    )!;
    const blocked = applyMoveOutcomes(held, shoot).find(
      (outcome) => outcome.tag === "fieldRebound",
    )!.state;

    expect(blocked.ball).toEqual({ kind: "loose", pos: { x: 11, y: 3 } });
    expect(blocked.heldFirmPieceId).toBeNull();
  });

  it("버티기는 다음 이동을 약속할 행동 둘이 남아 있을 때만 만든다", () => {
    const state = createInitialState();
    setPos(state, 11, { x: 7, y: 4 });
    const carrierId = state.ball.kind === "held" ? state.ball.pieceId : -1;
    const firstAction = legalMoves(state).find(
      (move) => move.kind === "move" && move.pieceId !== carrierId,
    )!;
    const oneActionLeft = applyMove(state, firstAction);

    expect(oneActionLeft.actionsRemaining).toBe(2);
    expect(legalMoves(oneActionLeft)).toContainEqual({ kind: "hold", pieceId: carrierId });

    const secondAction = legalMoves(oneActionLeft).find(
      (move) => move.kind === "move" && move.pieceId !== carrierId,
    )!;
    const finalAction = applyMove(oneActionLeft, secondAction);
    expect(finalAction.actionsRemaining).toBe(1);
    expect(legalMoves(finalAction)).not.toContainEqual({ kind: "hold", pieceId: carrierId });
  });

  it("첫 행동을 이미 쓴 공 소유자도 버티기 뒤 마지막 선수 행동으로 이동할 수 있다", () => {
    const state = createInitialState();
    setPos(state, 11, { x: 7, y: 4 });
    const carrierId = state.ball.kind === "held" ? state.ball.pieceId : -1;
    state.actionsRemaining = 2;
    state.actionCountByPiece[carrierId] = 1;

    expect(isPressured(state, carrierId)).toBe(true);
    expect(legalMoves(state)).toContainEqual({ kind: "hold", pieceId: carrierId });
  });

  it("수비수는 첫 행동으로 접근하고 두 번째 행동으로 스틸한다", () => {
    const state = createInitialState();
    state.activeTeam = "away";
    state.pieces.find((piece) => piece.id === 11)!.pos = { x: 8, y: 4 };
    const defenderId = 11;
    const approach = legalMoves(state).find(
      (move) =>
        move.kind === "move" &&
        move.pieceId === defenderId &&
        move.to.x === 7 &&
        move.to.y === 4,
    )!;
    const adjacent = applyMove(state, approach);
    const steal = legalMoves(adjacent).find(
      (move) => move.kind === "steal" && move.pieceId === defenderId,
    )!;
    const stolen = applyMoveOutcomes(adjacent, steal).find(
      (outcome) => outcome.tag === "stealSuccess",
    )!.state;

    expect(stolen.ball).toEqual({ kind: "held", pieceId: defenderId });
    expect(stolen.stealProtection).toEqual({
      pieceId: defenderId,
      blockedTeam: "home",
      blockedActionsRemaining: 1,
    });
  });

  it("스틸 보호는 공을 잃은 팀의 다음 행동 하나 뒤 해제된다", () => {
    const state = createInitialState();
    state.activeTeam = "away";
    setPos(state, 11, { x: 7, y: 4 });
    const stolen = applyMoveOutcomes(
      state,
      legalMoves(state).find((move) => move.kind === "steal" && move.pieceId === 11)!,
    ).find((outcome) => outcome.tag === "stealSuccess")!.state;
    // 탈취 관성으로 새 소유자 11은 home 기물에서 가장 멀어지는 (8,3)으로 밀려난다.
    expect(stolen.pieces.find((piece) => piece.id === 11)!.pos).toEqual({ x: 8, y: 3 });
    const homeTurn = applyMove(stolen, { kind: "endTurn" });

    expect(legalMoves(homeTurn).some((move) => move.kind === "steal")).toBe(false);
    const setup = legalMoves(homeTurn).find(
      (move) => move.kind === "move" && move.pieceId !== 3,
    )!;
    const afterSetup = applyMove(homeTurn, setup);
    expect(afterSetup.stealProtection).toBeNull();

    // 보호가 풀린 뒤 홈 MF가 (7,3)으로 접근하면 스틸 후보가 다시 생긴다.
    const approach = legalMoves(afterSetup).find(
      (move) =>
        move.kind === "move" && move.pieceId === 3 && move.to.x === 7 && move.to.y === 3,
    )!;
    expect(approach).toBeDefined();
    const adjacent = applyMove(afterSetup, approach);
    expect(legalMoves(adjacent).some((move) => move.kind === "steal")).toBe(true);
  });

  it("보호 소유자를 상대 두 명이 포위하면 첫 행동부터 스틸할 수 있다", () => {
    const state = createInitialState();
    state.activeTeam = "away";
    state.ball = { kind: "held", pieceId: 3 };
    setPos(state, 7, { x: 7, y: 4 });
    setPos(state, 10, { x: 7, y: 5 });
    state.stealProtection = {
      pieceId: 3,
      blockedTeam: "away",
      blockedActionsRemaining: 1,
    };

    expect(legalMoves(state).filter((move) => move.kind === "steal")).toEqual(
      expect.arrayContaining([
        { kind: "steal", pieceId: 7, targetPieceId: 3 },
        { kind: "steal", pieceId: 10, targetPieceId: 3 },
      ]),
    );
  });

  it("두 번째 공격자가 두 칸 밖이면 포위로 세지 않아 보호가 유지된다", () => {
    const state = createInitialState();
    state.activeTeam = "away";
    state.ball = { kind: "held", pieceId: 3 };
    setPos(state, 10, { x: 8, y: 4 });
    state.stealProtection = {
      pieceId: 3,
      blockedTeam: "away",
      blockedActionsRemaining: 1,
    };

    expect(legalMoves(state).some((move) => move.kind === "steal")).toBe(false);
  });

  it("보호된 공 소유자는 인접한 상대가 있어도 Lv.1 스틸 위험 감점을 받지 않는다", () => {
    const threatened = createInitialState();
    threatened.activeTeam = "away";
    setPos(threatened, 11, { x: 7, y: 4 });
    const protectedState = structuredClone(threatened);
    protectedState.stealProtection = {
      pieceId: 3,
      blockedTeam: "away",
      blockedActionsRemaining: 1,
    };

    expect(evalLv1(protectedState, "home") - evalLv1(threatened, "home")).toBeCloseTo(170, 9);
  });

  it("두 명에게 포위된 공 소유자는 보호 상태여도 Lv.1 스틸 위험 감점을 받는다", () => {
    const threatened = createInitialState();
    setPos(threatened, 11, { x: 7, y: 4 });
    setPos(threatened, 10, { x: 7, y: 5 });
    const protectedState = structuredClone(threatened);
    protectedState.stealProtection = {
      pieceId: 3,
      blockedTeam: "away",
      blockedActionsRemaining: 1,
    };

    expect(evalLv1(protectedState, "home") - evalLv1(threatened, "home")).toBe(0);
  });
});

describe("평가와 탐색", () => {
  it.each([0, 1, 2] as const)(
    "home 팀 턴의 %i번째 행동 뒤에도 루트 home 관점 점수를 유지한다",
    (appliedActions) => {
      let state = createInitialState();
      for (let index = 0; index < appliedActions; index += 1) {
        const move = legalMoves(state).find((candidate) => candidate.kind !== "endTurn")!;
        state = applyMove(state, move);
      }

      expect(state.activeTeam).toBe("home");
      const nextAtomicMove = legalMoves(state).find((candidate) => candidate.kind !== "endTurn")!;
      if (appliedActions === 2) {
        expect(applyMove(state, nextAtomicMove).activeTeam).toBe("away");
      }

      const result = search(state, {
        depth: 1,
        evalFn: (_state, perspective) => (perspective === "home" ? 123 : -123),
      });

      expect(result.best).not.toBeNull();
      // 확률 분기의 기대값 합산에서 생기는 부동소수 오차만 허용한다.
      expect(result.score).toBeCloseTo(123, 9);
    },
  );

  it("대각선 스틸 위협도 상하좌우 위협과 같은 170점 위험으로 평가한다", () => {
    const threatened = createInitialState();
    setPos(threatened, 7, { x: 5, y: 3 });
    setPos(threatened, 11, { x: 7, y: 7 });
    const safe = structuredClone(threatened);
    setPos(safe, 7, { x: 5, y: 2 });

    expect(evalLv1(safe, "home") - evalLv1(threatened, "home")).toBeCloseTo(170, 9);
  });

  it("대칭 국면의 1점 차를 관점에 따라 반대 부호로 평가한다", () => {
    const state = createInitialState();
    // 킥오프로 물러난 away FW를 기본 미러 위치로 되돌려 완전 대칭을 만든다.
    setPos(state, 11, { x: 7, y: 4 });
    setPos(state, 3, { x: 4, y: 2 });
    state.ball = { kind: "loose", pos: { x: 6, y: 4 } };
    state.score.home = 1;

    expect(evalLv1(state, "home")).toBe(10_000);
    expect(evalLv1(state, "away")).toBe(-10_000);
  });

  it("같은 입력은 루트 후보 점수까지 같은 탐색 결과를 낸다", () => {
    const state = createInitialState();
    const options = { depth: 2, evalFn: evalLv1 };

    const first = search(state, options);
    const second = search(state, options);

    expect({ ...first, ms: 0 }).toEqual({ ...second, ms: 0 });
    expect(first.ms).toBeGreaterThanOrEqual(0);
    expect(first.best).not.toBeNull();
    expect(first.values.length).toBeGreaterThan(0);
    expect(first.values[0]).toEqual(expect.objectContaining({ move: expect.any(Object) }));
  });

  it("루트 후보 뒤 상대 팀 차례에서는 루트 관점의 최솟값을 선택한다", () => {
    const state = createInitialState();
    setPos(state, 11, { x: 7, y: 4 });
    state.actionsRemaining = 1;
    const rootMove = legalMoves(state).find(
      (move) => move.kind === "move" && move.pieceId === 1,
    )!;
    if (rootMove.kind !== "move") throw new Error("루트 이동 수가 없습니다.");
    const afterRoot = applyMove(state, rootMove);

    expect(afterRoot.activeTeam).toBe("away");
    const evalFn = (position: GameState) =>
      position.ball.kind === "held" && position.ball.pieceId < 6 ? 10 : -10;
    // 확률 수(스틸 등)는 결과 분포의 기대값으로 평가된다.
    const opponentScores = legalMoves(afterRoot).map((move) =>
      applyMoveOutcomes(afterRoot, move).reduce(
        (sum, outcome) => sum + outcome.probability * evalFn(outcome.state),
        0,
      ),
    );
    const result = search(state, { depth: 2, evalFn });
    const rootValue = result.values.find(
      (value) => value.move.kind === "move" && value.move.pieceId === rootMove.pieceId &&
        value.move.to.x === rootMove.to.x && value.move.to.y === rootMove.to.y,
    );

    expect(opponentScores).toContain(10);
    expect(Math.min(...opponentScores)).toBeLessThan(10);
    expect(rootValue?.score).toBeCloseTo(Math.min(...opponentScores), 9);
  });

  it("슛 네 결과와 hold/endTurn을 결정적인 우선순위로 정렬한다", () => {
    const initial = createInitialState();
    setPos(initial, 11, { x: 7, y: 4 });
    initial.actionsRemaining = 2;
    const initialResult = search(initial, { depth: 1, evalFn: () => 0 });
    const initialKinds = initialResult.values.map(({ move }) => move.kind);

    expect(initialKinds.slice(0, 3)).toEqual(["shoot", "shoot", "shoot"]);
    expect(initialKinds.indexOf("pass")).toBeLessThan(initialKinds.indexOf("hold"));
    expect(initialKinds.indexOf("hold")).toBeLessThan(initialKinds.indexOf("move"));
    expect(initialKinds.at(-1)).toBe("endTurn");
    const expectedInitialMoves = legalMoves(initial).filter((move) => move.kind === "move");
    const actualInitialMoves = initialResult.values
      .map(({ move }) => move)
      .filter((move) => move.kind === "move");
    expect(expectedInitialMoves.length).toBeGreaterThan(1);
    expect(actualInitialMoves).toEqual(expectedInitialMoves);

    const outcomeCases = ["goal", "goalkeeperSave", "fieldRebound", "fieldPossession"] as const;
    const observedOutcomes = new Set<string>();
    for (const expectedOutcome of outcomeCases) {
      const state = createShotState((shotState) => {
        if (expectedOutcome === "goalkeeperSave") {
          setPos(shotState, 6, { x: 10, y: 4 });
        } else if (expectedOutcome === "fieldRebound") {
          setPos(shotState, 7, { x: 10, y: 4 });
        } else if (expectedOutcome === "fieldPossession") {
          setPos(shotState, 0, { x: 9, y: 3 });
          setPos(shotState, 1, { x: 10, y: 3 });
          setPos(shotState, 2, { x: 11, y: 3 });
          setPos(shotState, 3, { x: 9, y: 4 });
          setPos(shotState, 4, { x: 11, y: 4 });
          setPos(shotState, 6, { x: 9, y: 5 });
          setPos(shotState, 7, { x: 10, y: 4 });
          setPos(shotState, 8, { x: 10, y: 5 });
          setPos(shotState, 9, { x: 11, y: 5 });
        }
      });
      const first = search(state, { depth: 1, evalFn: () => 0 });
      const second = search(state, { depth: 1, evalFn: () => 0 });
      const shootMoves = first.values
        .map(({ move }) => move)
        .filter((move) => move.kind === "shoot");
      // 확률 판정에서 슛 결과 종류는 가능한 결과 분포의 tag로 확인한다.
      const shootTags = shootMoves.flatMap((move) =>
        applyMoveOutcomes(state, move).map((outcome) => outcome.tag),
      );
      const shootChances = shootMoves.map((move) => {
        const preview = previewMove(state, move);
        if (preview.kind !== "shoot") throw new Error("슛 미리보기 종류 불일치");
        return preview.goalChance;
      });

      expect(shootTags).toContain(expectedOutcome);
      for (const tag of shootTags) {
        if (tag !== "deterministic" && tag !== "zoneIntercept" && tag !== "received") {
          observedOutcomes.add(tag);
        }
      }
      // 확률 1의 열린 슛(rank 100)은 개입이 남은 슛(rank 60)보다 먼저 정렬된다.
      const goalIndexes = shootChances.flatMap((chance, index) =>
        chance >= 1 ? [index] : [],
      );
      const blockedIndexes = shootChances.flatMap((chance, index) =>
        chance >= 1 ? [] : [index],
      );
      if (goalIndexes.length > 0 && blockedIndexes.length > 0) {
        expect(Math.max(...goalIndexes)).toBeLessThan(Math.min(...blockedIndexes));
      }
      const expectedRank60Shots = legalMoves(state).filter((move) => {
        if (move.kind !== "shoot") return false;
        const preview = previewMove(state, move);
        return preview.kind === "shoot" && preview.goalChance < 1;
      });
      const actualRank60Shots = shootMoves.filter((move) => {
        const preview = previewMove(state, move);
        return preview.kind === "shoot" && preview.goalChance < 1;
      });
      if (expectedRank60Shots.length >= 2) {
        expect(actualRank60Shots).toEqual(expectedRank60Shots);
      }
      expect(first.values.map(({ move }) => move)).toEqual(second.values.map(({ move }) => move));
      expect(first.values.slice(0, 2).every(({ move }) => move.kind === "shoot")).toBe(true);
    }
    expect(observedOutcomes).toEqual(
      new Set(["goal", "goalkeeperSave", "fieldRebound", "fieldPossession", "offTarget"]),
    );
  });

  it("수비 국면에서도 합법 steal을 실제 낮은 순위 수보다 먼저 정렬한다", () => {
    const state = createInitialState();
    setPos(state, 11, { x: 7, y: 4 });
    state.activeTeam = "away";
    state.actionsRemaining = 2;
    state.actionCountByPiece = {};
    state.heldFirmPieceId = null;
    state.stealProtection = null;

    const carrier = state.pieces.find((piece) => piece.id === 3)!;
    const defender = state.pieces.find((piece) => piece.id === 11)!;
    expect(state.pieces).toHaveLength(12);
    expect(state.pieces.every((piece) => inBounds(piece.pos))).toBe(true);
    expect(new Set(state.pieces.map((piece) => `${piece.pos.x},${piece.pos.y}`)).size).toBe(12);
    expect(state.ball).toEqual({ kind: "held", pieceId: carrier.id });
    expect(carrier.team).toBe("home");
    expect(defender.team).toBe("away");
    expect(Math.max(Math.abs(carrier.pos.x - defender.pos.x), Math.abs(carrier.pos.y - defender.pos.y))).toBe(1);
    expect(state.stealProtection).toBeNull();

    const legal = legalMoves(state);
    const lowerKinds = ["pass", "hold", "move", "endTurn"] as const;
    expect(legal.some((move) => move.kind === "steal")).toBe(true);
    expect(legal.some((move) => move.kind === "move")).toBe(true);
    expect(legal.some((move) => move.kind === "endTurn")).toBe(true);

    const result = search(state, { depth: 1, evalFn: () => 0 });
    const orderedKinds = result.values.map(({ move }) => move.kind);
    const stealIndex = orderedKinds.indexOf("steal");

    expect(stealIndex).toBeGreaterThanOrEqual(0);
    for (const lowerKind of lowerKinds) {
      const lowerIndex = orderedKinds.indexOf(lowerKind);
      if (lowerIndex >= 0) expect(stealIndex).toBeLessThan(lowerIndex);
    }
  });

  it("동일 rank 이동 후보는 legalMoves 원래 순서를 보존한다", () => {
    const state = createInitialState();
    state.activeTeam = "away";
    state.actionsRemaining = 2;
    state.actionCountByPiece = {};
    state.heldFirmPieceId = null;
    state.stealProtection = null;

    const expectedMoves = legalMoves(state).filter((move) => move.kind === "move");
    expect(expectedMoves.length).toBeGreaterThan(1);

    const result = search(state, { depth: 1, evalFn: () => 0 });
    const actualMoves = result.values
      .map(({ move }) => move)
      .filter((move) => move.kind === "move");

    expect(actualMoves).toEqual(expectedMoves);
  });

  it(
    "초기 6대6 국면의 깊이 3 탐색이 5초 안에 끝난다",
    () => {
      const result = search(createInitialState(), { depth: 3, evalFn: evalLv1 });

      expect(result.best).not.toBeNull();
      expect(result.depth).toBe(3);
      expect(result.ms).toBeLessThan(5_000);
    },
    40_000,
  );

  it(
    "압박과 슛 선택이 함께 있는 국면의 깊이 3 탐색이 5초 안에 끝난다",
    () => {
      const state = createShotState((shotState) => {
        setPos(shotState, 9, { x: 8, y: 4 });
      });
      expect(isPressured(state, 5)).toBe(true);

      const result = search(state, { depth: 3, evalFn: evalLv1 });

      expect(result.best).not.toBeNull();
      expect(result.depth).toBe(3);
      expect(result.ms).toBeLessThan(5_000);
    },
    40_000,
  );

  it("수 한도에 도달하면 합법 수와 최선 수가 없다", () => {
    const state = createInitialState();
    state.turn = state.maxTurns - 1;
    state.actionsRemaining = 1;
    const lastMove = legalMoves(state)[0]!;
    const finished = applyMove(state, lastMove);

    expect(finished.turn).toBe(finished.maxTurns);
    expect(legalMoves(finished)).toEqual([]);
    expect(search(finished, { depth: 2, evalFn: evalLv1 }).best).toBeNull();
  });
});

describe("경기 종료", () => {
  it("home이 3골에 도달하면 즉시 승리하고 더는 수를 만들지 않는다", () => {
    const state = createInitialState();
    state.score.home = 3;

    expect(gameResult(state)).toEqual({
      kind: "win",
      winner: "home",
      reason: "scoreLimit",
    });
    expect(legalMoves(state)).toEqual([]);
    expect(search(state, { depth: 2, evalFn: evalLv1 }).best).toBeNull();
  });

  it("away가 3골에 도달하면 즉시 승리한다", () => {
    const state = createInitialState();
    state.score.away = 3;

    expect(gameResult(state)).toEqual({
      kind: "win",
      winner: "away",
      reason: "scoreLimit",
    });
  });

  it.each([
    [{ home: 2, away: 1 }, { kind: "win", winner: "home", reason: "turnLimit" }],
    [{ home: 1, away: 2 }, { kind: "win", winner: "away", reason: "turnLimit" }],
    [{ home: 2, away: 2 }, { kind: "draw", reason: "turnLimit" }],
  ] as const)("수 한도 결과를 점수로 판정한다: %o", (score, expected) => {
    const state = createInitialState();
    state.turn = state.maxTurns;
    state.score = { ...score };

    expect(gameResult(state)).toEqual(expected);
    expect(legalMoves(state)).toEqual([]);
    expect(search(state, { depth: 2, evalFn: evalLv1 }).best).toBeNull();
  });

  it("3골과 수 한도에 도달하지 않으면 진행 중이다", () => {
    const state = createInitialState();
    state.turn = state.maxTurns - 1;
    state.score = { home: 2, away: 2 };

    expect(gameResult(state)).toBeNull();
    expect(legalMoves(state).length).toBeGreaterThan(0);
  });
});

describe("완주 시뮬레이션", () => {
  it(
    "서로 다른 합법 수 선택으로 진행한 64경기가 상태 불변식을 지키며 종료된다",
    () => {
      for (let gameIndex = 0; gameIndex < 64; gameIndex += 1) {
        let state = createInitialState();
        let selector = gameIndex + 1;

        while (gameResult(state) === null) {
          const moves = legalMoves(state);
          expect(moves.length, `game ${gameIndex}, ply ${state.turn}`).toBeGreaterThan(0);

          for (const candidate of moves) {
            if (candidate.kind === "endTurn") {
              expect(previewMove(state, candidate)).toEqual({ kind: "endTurn" });
              continue;
            }
            const actingPiece = state.pieces.find((piece) => piece.id === candidate.pieceId);
            expect(actingPiece, `존재하지 않는 실행 기물: ${JSON.stringify(candidate)}`)
              .toBeDefined();

            if (candidate.kind === "pass") {
              const target = state.pieces.find(
                (piece) => piece.id === candidate.targetPieceId,
              );
              expect(target, `존재하지 않는 패스 대상: ${JSON.stringify(candidate)}`)
                .toBeDefined();
              expect(target!.team).toBe(actingPiece!.team);

              const preview = previewMove(state, candidate);
              expect(preview.kind).toBe("pass");
              if (preview.kind !== "pass") throw new Error("패스 미리보기 종류 불일치");
              expect(
                state.pieces.some((piece) => piece.id === preview.receiverPieceId),
              ).toBe(true);
              expect(preview.arrivalChance).toBeGreaterThan(0);
              expect(preview.arrivalChance).toBeLessThanOrEqual(1);

              const outcomes = applyMoveOutcomes(state, candidate);
              expect(
                outcomes.reduce((sum, outcome) => sum + outcome.probability, 0),
              ).toBeCloseTo(1, 9);
              // 모든 영향권을 통과한 마지막 결과에서 미리보기의 첫 수신자가 공을 받는다.
              expect(outcomes[outcomes.length - 1]!.state.ball).toEqual({
                kind: "held",
                pieceId: preview.receiverPieceId,
              });

              const applied = applyMove(state, candidate);
              expect(outcomes.map((outcome) => outcome.state.ball)).toContainEqual(
                applied.ball,
              );
              expect(applied.score).toEqual(state.score);
            } else if (candidate.kind === "shoot") {
              expect([3, 4, 5]).toContain(candidate.goalRow);

              const preview = previewMove(state, candidate);
              expect(preview.kind).toBe("shoot");
              if (preview.kind !== "shoot") throw new Error("슛 미리보기 종류 불일치");
              expect(preview.goalChance).toBeGreaterThan(0);
              expect(preview.goalChance).toBeLessThanOrEqual(1);
              // 거리 정확도 때문에 차단자가 없어도 확률이 1 미만일 수 있다.
              if (preview.goalChance >= 1) expect(preview.blockerPieceId).toBeNull();

              const outcomes = applyMoveOutcomes(state, candidate);
              expect(
                outcomes.reduce((sum, outcome) => sum + outcome.probability, 0),
              ).toBeCloseTo(1, 9);
              // 모든 개입을 통과한 마지막 결과는 항상 득점이다.
              const goalOutcome = outcomes[outcomes.length - 1]!;
              expect(goalOutcome.tag).toBe("goal");
              const expectedScore = { ...state.score };
              expectedScore[actingPiece!.team] += 1;
              expect(goalOutcome.state.score).toEqual(expectedScore);

              const applied = applyMove(state, candidate);
              expect(
                outcomes.map((outcome) => ({
                  ball: outcome.state.ball,
                  score: outcome.state.score,
                })),
              ).toContainEqual({ ball: applied.ball, score: applied.score });
            } else if (candidate.kind === "steal") {
              const target = state.pieces.find(
                (piece) => piece.id === candidate.targetPieceId,
              );
              expect(target, `존재하지 않는 스틸 대상: ${JSON.stringify(candidate)}`)
                .toBeDefined();
              expect(target!.team).not.toBe(actingPiece!.team);
              expect(
                Math.max(
                  Math.abs(target!.pos.x - actingPiece!.pos.x),
                  Math.abs(target!.pos.y - actingPiece!.pos.y),
                ),
              ).toBe(1);
            }
          }

          selector = (selector * 73 + 41) % 1_000_003;
          const move = moves[selector % moves.length]!;
          const previous = state;
          state = applyMove(state, move);

          // 수는 팀 턴이 끝날 때(팀 교대·득점)만 1 증가한다.
          expect(state.turn).toBe(
            previous.turn + (state.activeTeam !== previous.activeTeam ? 1 : 0),
          );
          expect(state.turn).toBeLessThanOrEqual(state.maxTurns);
          expect(state.pieces).toHaveLength(12);
          expect(new Set(state.pieces.map((piece) => piece.id)).size).toBe(12);
          expect(
            new Set(state.pieces.map((piece) => `${piece.pos.x},${piece.pos.y}`)).size,
          ).toBe(12);
          expect(state.pieces.every((piece) => inBounds(piece.pos))).toBe(true);

          const previousGoals = previous.score.home + previous.score.away;
          const currentGoals = state.score.home + state.score.away;
          expect(
            currentGoals - previousGoals === 0 || currentGoals - previousGoals === 1,
          ).toBe(true);

          const ball = state.ball;
          if (ball.kind === "held") {
            expect(state.pieces.some((piece) => piece.id === ball.pieceId)).toBe(true);
          } else {
            expect(inBounds(ball.pos)).toBe(true);
            expect(
              state.pieces.some(
                (piece) => piece.pos.x === ball.pos.x && piece.pos.y === ball.pos.y,
              ),
            ).toBe(false);
          }
        }

        expect(gameResult(state)).not.toBeNull();
        expect(legalMoves(state)).toEqual([]);
      }
    },
    40_000,
  );
});

describe("팀 전술", () => {
  it("기본 전술은 balanced이며 현행 규칙과 같은 패스 6칸을 준다", () => {
    const state = createInitialState();
    expect(state.teamStyles).toEqual({ home: "balanced", away: "balanced" });

    // 캐리어를 (4,4)로 옮기면 (6,8)은 거리 4로 가능, (12,8)은 거리 8로 불가하다.
    setPos(state, 3, { x: 4, y: 4 });
    setPos(state, 1, { x: 6, y: 8 });
    setPos(state, 2, { x: 12, y: 8 });
    state.ball = { kind: "held", pieceId: 3 };
    const targets = legalMoves(state)
      .filter((move) => move.kind === "pass")
      .map((move) => (move.kind === "pass" ? move.targetPieceId : -1));
    expect(targets).toContain(1);
    expect(targets).not.toContain(2);
  });

  it("티키타카는 패스 5칸, 영향권 인터셉트 12%, MF 무료 패스를 준다", () => {
    const state = createInitialState({ home: "tikitaka" });
    // 캐리어 (6,4)에서 (6,8)은 거리 4로 가능, (12,8)은 거리 6으로 한도 5를 넘는다.
    setPos(state, 1, { x: 6, y: 8 });
    setPos(state, 2, { x: 12, y: 8 });
    const targets = legalMoves(state)
      .filter((move) => move.kind === "pass")
      .map((move) => (move.kind === "pass" ? move.targetPieceId : -1));
    expect(targets).toContain(1);
    expect(targets).not.toContain(2);

    // (5,5)의 away MF가 (6,4)→(5,4) 패스 경로에 인접하면 인터셉트 확률이 12%다.
    setPos(state, 10, { x: 5, y: 5 });
    const pass = { kind: "pass", pieceId: 3, targetPieceId: 5 } as const;
    const outcomes = applyMoveOutcomes(state, pass);
    expect(outcomes[0]!.tag).toBe("zoneIntercept");
    expect(outcomes[0]!.probability).toBeCloseTo(0.12, 9);

    // MF의 패스는 팀 행동은 소비하지만 선수별 상한에는 세지 않는다.
    const passed = applyMove(state, pass);
    expect(passed.actionsRemaining).toBe(2);
    expect(passed.actionCountByPiece[3] ?? 0).toBe(0);
  });

  it("역습축구는 전방 7칸·후방 5칸 패스와 FW의 2칸 전진 대시를 준다", () => {
    const state = createInitialState({ home: "counter" });
    // 캐리어를 (6,2)로 옮긴다. (12,3)은 전방 거리 6으로 가능(한도 7),
    // (0,2)는 후방 거리 6으로 불가(한도 5)다.
    setPos(state, 3, { x: 6, y: 2 });
    setPos(state, 1, { x: 12, y: 3 });
    setPos(state, 2, { x: 0, y: 2 });
    setPos(state, 11, { x: 7, y: 7 });
    const targets = legalMoves(state)
      .filter((move) => move.kind === "pass")
      .map((move) => (move.kind === "pass" ? move.targetPieceId : -1));
    expect(targets).toContain(1);
    expect(targets).not.toContain(2);

    // 공이 없는 FW(5,4)는 중간 (6,4)와 목적지 (7,4)가 비어 있으면 2칸 대시할 수 있다.
    const dash = legalMoves(state).find(
      (move) => move.kind === "move" && move.pieceId === 5 && move.to.x === 7 && move.to.y === 4,
    );
    expect(dash).toBeDefined();

    // 중간 칸이 막히면 같은 대시가 사라진다.
    const blocked = createInitialState({ home: "counter" });
    setPos(blocked, 3, { x: 6, y: 0 });
    setPos(blocked, 11, { x: 6, y: 4 });
    expect(
      legalMoves(blocked).some(
        (move) => move.kind === "move" && move.pieceId === 5 && move.to.x === 7 && move.to.y === 4,
      ),
    ).toBe(false);
  });

  it("게겐프레싱은 상대 공 소유자에게 가까워지는 2칸 대시와 25% 인터셉트를 준다", () => {
    const state = createInitialState({ home: "gegenpress" });
    // away MF 9가 (9,4)에서 공을 잡았고, home MF 3은 캐리어 4칸 안인 (5,4)에 둔다.
    setPos(state, 3, { x: 5, y: 4 });
    setPos(state, 5, { x: 5, y: 7 });
    setPos(state, 9, { x: 9, y: 4 });
    state.ball = { kind: "held", pieceId: 9 };

    // 캐리어 쪽 (7,4)로는 2칸 대시가 생기고, 멀어지는 (3,4)로는 생기지 않는다.
    const moves = legalMoves(state).filter(
      (move) => move.kind === "move" && move.pieceId === 3,
    );
    expect(moves).toContainEqual({ kind: "move", pieceId: 3, to: { x: 7, y: 4 } });
    expect(moves).not.toContainEqual({ kind: "move", pieceId: 3, to: { x: 3, y: 4 } });

    // 게겐프레싱 팀을 상대로 한 away의 패스는 영향권 인터셉트가 25%로 오른다.
    const defending = createInitialState({ home: "gegenpress" });
    defending.activeTeam = "away";
    setPos(defending, 9, { x: 9, y: 4 });
    setPos(defending, 10, { x: 5, y: 2 });
    setPos(defending, 3, { x: 7, y: 5 });
    defending.ball = { kind: "held", pieceId: 9 };
    const outcomes = applyMoveOutcomes(defending, {
      kind: "pass",
      pieceId: 9,
      targetPieceId: 10,
    });
    expect(outcomes[0]!.tag).toBe("zoneIntercept");
    expect(outcomes[0]!.probability).toBeCloseTo(0.25, 9);
  });
});

describe("탈취 관성", () => {
  it("패스 인터셉트에 성공한 기물도 상대에게서 멀어지는 칸으로 밀려난다", () => {
    const state = createInitialState();
    // (6,4)→(2,4) 패스 경로 위 (4,4)에 away DF가 정면으로 서 있다. 경로의 홈 FW는 비켜 둔다.
    setPos(state, 1, { x: 2, y: 4 });
    setPos(state, 5, { x: 5, y: 7 });
    setPos(state, 8, { x: 4, y: 4 });
    setPos(state, 11, { x: 7, y: 7 });
    const intercepted = applyMove(state, { kind: "pass", pieceId: 3, targetPieceId: 1 });

    expect(intercepted.ball.kind).toBe("held");
    if (intercepted.ball.kind !== "held") throw new Error("공 소유 상태가 아닙니다.");
    const interceptor = intercepted.pieces.find(
      (piece) => intercepted.ball.kind === "held" && piece.id === intercepted.ball.pieceId,
    )!;
    expect(interceptor.team).toBe("away");
    // 원래 서 있던 칸에서 벗어나 home 기물과의 최소 거리가 늘어났다.
    const nearestHome = (pos: Pos) =>
      Math.min(
        ...intercepted.pieces
          .filter((piece) => piece.team === "home")
          .map((piece) => Math.max(Math.abs(piece.pos.x - pos.x), Math.abs(piece.pos.y - pos.y))),
      );
    expect(nearestHome(interceptor.pos)).toBeGreaterThan(1);
  });

  it("밀려날 빈 칸이 없으면 제자리에서 공을 지킨다", () => {
    const state = createInitialState();
    state.activeTeam = "away";
    // 스틸러 11을 (7,4)에 두고 주변 8칸을 모두 채운다.
    setPos(state, 11, { x: 7, y: 4 });
    setPos(state, 3, { x: 6, y: 4 });
    setPos(state, 0, { x: 6, y: 3 });
    setPos(state, 1, { x: 6, y: 5 });
    setPos(state, 2, { x: 7, y: 3 });
    setPos(state, 4, { x: 7, y: 5 });
    setPos(state, 5, { x: 8, y: 3 });
    setPos(state, 9, { x: 8, y: 4 });
    setPos(state, 10, { x: 8, y: 5 });
    state.ball = { kind: "held", pieceId: 3 };

    const stolen = applyMoveOutcomes(state, {
      kind: "steal",
      pieceId: 11,
      targetPieceId: 3,
    }).find((outcome) => outcome.tag === "stealSuccess")!.state;

    expect(stolen.ball).toEqual({ kind: "held", pieceId: 11 });
    expect(stolen.pieces.find((piece) => piece.id === 11)!.pos).toEqual({ x: 7, y: 4 });
  });
});

describe("빠른 슛 확률 계산", () => {
  it("bestShotGoalChance는 previewMove의 세 행 최고 득점 확률과 일치한다", () => {
    const states = [
      createInitialState(),
      createShotState(() => undefined),
      createShotState((shotState) => setPos(shotState, 7, { x: 10, y: 4 })),
      createShotState((shotState) => setPos(shotState, 6, { x: 10, y: 4 })),
      createShotState((shotState) => {
        setPos(shotState, 6, { x: 11, y: 3 });
        setPos(shotState, 8, { x: 9, y: 5 });
      }),
    ];
    for (const state of states) {
      if (state.ball.kind !== "held") throw new Error("held 상태가 필요합니다.");
      const carrier = state.pieces.find(
        (piece) => state.ball.kind === "held" && piece.id === state.ball.pieceId,
      )!;
      const expected = Math.max(
        ...([3, 4, 5] as const).map((goalRow) => {
          const preview = previewMove(state, {
            kind: "shoot",
            pieceId: carrier.id,
            goalRow,
          });
          return preview.kind === "shoot" ? preview.goalChance : 0;
        }),
      );
      expect(bestShotGoalChance(state, carrier)).toBeCloseTo(expected, 12);
    }
  });
});
