import { describe, expect, it } from "vitest";
import { evalLv1 } from "./eval/lv1";
import {
  applyMove,
  createInitialState,
  gameResult,
  inBounds,
  legalMoves,
  sideToMove,
} from "./rules";
import { search } from "./search";
import { BOARD_H, BOARD_W, type GameState, type Pos } from "./types";

function setPos(state: GameState, pieceId: number, pos: Pos): void {
  state.pieces.find((piece) => piece.id === pieceId)!.pos = pos;
}

describe("초기 국면", () => {
  it("4대4 기물을 프로토타입 배치에 두고 home MF가 킥오프한다", () => {
    const state = createInitialState();

    expect(state.pieces).toHaveLength(8);
    expect(state.pieces.map((piece) => [piece.team, piece.role, piece.pos])).toEqual([
      ["home", "GK", { x: 0, y: 4 }],
      ["home", "DF", { x: 2, y: 4 }],
      ["home", "MF", { x: 6, y: 4 }],
      ["home", "FW", { x: 4, y: 5 }],
      ["away", "GK", { x: 12, y: 4 }],
      ["away", "DF", { x: 10, y: 4 }],
      ["away", "MF", { x: 8, y: 5 }],
      ["away", "FW", { x: 8, y: 3 }],
    ]);
    expect(state.ball).toEqual({ kind: "held", pieceId: 2 });
    expect(state.noSteal).toBe(0);
    expect(sideToMove(state)).toBe("home");
  });

  it("모든 기물이 보드 안에 있고 같은 칸에 겹치지 않는다", () => {
    const state = createInitialState();
    const cells = state.pieces.map((piece) => `${piece.pos.x},${piece.pos.y}`);

    expect(state.pieces.every((piece) => inBounds(piece.pos))).toBe(true);
    expect(new Set(cells).size).toBe(cells.length);
    expect(state.pieces.filter((piece) => piece.team === "home")).toHaveLength(4);
    expect(state.pieces.filter((piece) => piece.team === "away")).toHaveLength(4);
  });

  it("초기 국면에 합법 수가 존재한다", () => {
    expect(legalMoves(createInitialState()).length).toBeGreaterThan(0);
  });

  it("모든 이동과 패스 도착점이 보드 안에 있다", () => {
    const moves = legalMoves(createInitialState());
    const destinations = moves.flatMap((move) =>
      move.kind === "move" || move.kind === "pass" ? [move.to] : [],
    );

    expect(destinations.length).toBeGreaterThan(0);
    expect(destinations.every(inBounds)).toBe(true);
  });
});

describe("수 적용", () => {
  it("입력 상태를 변경하지 않는다", () => {
    const state = createInitialState();
    const before = structuredClone(state);
    const move = legalMoves(state).find((candidate) => candidate.kind === "move")!;

    applyMove(state, move);

    expect(state).toEqual(before);
  });

  it("빈 경로 슛은 득점하고 실점 팀 킥오프로 초기 배치한다", () => {
    const state = createInitialState();
    setPos(state, 4, { x: 12, y: 0 });
    setPos(state, 5, { x: 10, y: 1 });

    const shoot = legalMoves(state).find(
      (move) => move.kind === "shoot" && move.pieceId === 2,
    );
    expect(shoot).toBeDefined();
    const before = structuredClone(state);

    const next = applyMove(state, shoot!);

    expect(state).toEqual(before);
    expect(next.score).toEqual({ home: 1, away: 0 });
    expect(next.turn).toBe(1);
    expect(sideToMove(next)).toBe("away");
    expect(next.ball).toEqual({ kind: "held", pieceId: 6 });
    expect(next.pieces.find((piece) => piece.id === 2)?.pos).toEqual({ x: 4, y: 3 });
    expect(next.pieces.find((piece) => piece.id === 6)?.pos).toEqual({ x: 6, y: 4 });
  });

  it("슛 경로의 첫 기물이 선방하고 공을 소유한다", () => {
    const state = createInitialState();
    setPos(state, 4, { x: 12, y: 0 });
    setPos(state, 5, { x: 9, y: 4 });

    const shoot = legalMoves(state).find(
      (move) => move.kind === "shoot" && move.pieceId === 2,
    );
    const next = applyMove(state, shoot!);

    expect(next.score).toEqual({ home: 0, away: 0 });
    expect(next.ball).toEqual({ kind: "held", pieceId: 5 });
    expect(next.noSteal).toBe(1);
    expect(next.turn).toBe(1);
  });

  it("스틸 직후 한 수 동안 재스틸을 막는다", () => {
    const state = createInitialState();
    state.turn = 1;
    setPos(state, 7, { x: 7, y: 4 });

    const steal = legalMoves(state).find(
      (move) => move.kind === "steal" && move.pieceId === 7 && move.targetPieceId === 2,
    );
    expect(steal).toBeDefined();

    const next = applyMove(state, steal!);

    expect(next.ball).toEqual({ kind: "held", pieceId: 7 });
    expect(next.noSteal).toBe(1);
    expect(legalMoves(next).some((move) => move.kind === "steal")).toBe(false);
  });
});

describe("평가와 탐색", () => {
  it("대칭 국면의 1점 차를 관점에 따라 반대 부호로 평가한다", () => {
    const state = createInitialState();
    setPos(state, 2, { x: 4, y: 3 });
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

  it("60수에 도달하면 합법 수와 최선 수가 없다", () => {
    const state = createInitialState();
    state.turn = state.maxTurns - 1;
    const lastMove = legalMoves(state)[0]!;
    const finished = applyMove(state, lastMove);

    expect(finished.turn).toBe(60);
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
  ] as const)("60 ply 결과를 점수로 판정한다: %o", (score, expected) => {
    const state = createInitialState();
    state.turn = state.maxTurns;
    state.score = { ...score };

    expect(gameResult(state)).toEqual(expected);
    expect(legalMoves(state)).toEqual([]);
    expect(search(state, { depth: 2, evalFn: evalLv1 }).best).toBeNull();
  });

  it("3골과 60 ply에 도달하지 않으면 진행 중이다", () => {
    const state = createInitialState();
    state.turn = 59;
    state.score = { home: 2, away: 2 };

    expect(gameResult(state)).toBeNull();
    expect(legalMoves(state).length).toBeGreaterThan(0);
  });
});

describe("완주 시뮬레이션", () => {
  it("서로 다른 합법 수 선택으로 진행한 64경기가 상태 불변식을 지키며 종료된다", () => {
    for (let gameIndex = 0; gameIndex < 64; gameIndex += 1) {
      let state = createInitialState();
      let selector = gameIndex + 1;

      while (gameResult(state) === null) {
        const moves = legalMoves(state);
        expect(moves.length, `game ${gameIndex}, ply ${state.turn}`).toBeGreaterThan(0);

        selector = (selector * 73 + 41) % 1_000_003;
        const move = moves[selector % moves.length]!;
        const previous = state;
        state = applyMove(state, move);

        expect(state.turn).toBe(previous.turn + 1);
        expect(state.turn).toBeLessThanOrEqual(state.maxTurns);
        expect(state.pieces).toHaveLength(8);
        expect(new Set(state.pieces.map((piece) => piece.id)).size).toBe(8);
        expect(new Set(state.pieces.map((piece) => `${piece.pos.x},${piece.pos.y}`)).size).toBe(8);
        expect(state.pieces.every((piece) => inBounds(piece.pos))).toBe(true);
        expect(state.noSteal === 0 || state.noSteal === 1).toBe(true);

        const previousGoals = previous.score.home + previous.score.away;
        const currentGoals = state.score.home + state.score.away;
        expect(currentGoals - previousGoals === 0 || currentGoals - previousGoals === 1).toBe(true);

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
  });
});
