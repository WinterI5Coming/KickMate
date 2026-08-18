import { describe, expect, it } from "vitest";
import { evalLv1 } from "./eval/lv1";
import {
  applyMove,
  createInitialState,
  gameResult,
  inBounds,
  legalMoves,
  previewMove,
  sideToMove,
} from "./rules";
import { search } from "./search";
import { BOARD_H, BOARD_W, type GameState, type Pos } from "./types";

function setPos(state: GameState, pieceId: number, pos: Pos): void {
  state.pieces.find((piece) => piece.id === pieceId)!.pos = pos;
}

describe("초기 국면", () => {
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
      ["away", "FW", { x: 7, y: 4 }],
    ]);
    expect(state.ball).toEqual({ kind: "held", pieceId: 3 });
    expect(state.noSteal).toBe(0);
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
    [3, "MF"],
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
        outcome: "blocked",
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
    const lowerId = state.pieces.find((piece) => piece.id === 1)!;
    const higherId = state.pieces.find((piece) => piece.id === 8)!;
    shooter.pos = { x: 9, y: 2 };
    lowerId.pos = { x: 10, y: 2 };
    higherId.pos = { x: 9, y: 3 };
    state.pieces = [higherId, ...state.pieces.filter((piece) => piece.id !== higherId.id)];
    state.ball = { kind: "held", pieceId: shooter.id };

    expect(previewMove(state, { kind: "shoot", pieceId: shooter.id, goalRow: 5 }))
      .toMatchObject({ blockerPieceId: lowerId.id, outcome: "blocked" });
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
    expect(next.ball).toEqual({ kind: "held", pieceId: 9 });
    expect(next.pieces.find((piece) => piece.id === 3)?.pos).toEqual({ x: 4, y: 2 });
    expect(next.pieces.find((piece) => piece.id === 9)?.pos).toEqual({ x: 6, y: 4 });
  });

  it("슛 경로의 첫 기물이 선방하고 공을 소유한다", () => {
    const state = createInitialState();
    setPos(state, 6, { x: 12, y: 0 });
    setPos(state, 7, { x: 9, y: 4 });
    setPos(state, 11, { x: 10, y: 1 });

    const shoot = legalMoves(state).find(
      (move) => move.kind === "shoot" && move.pieceId === 3 && move.goalRow === 4,
    );
    expect(shoot).toBeDefined();
    const next = applyMove(state, shoot!);

    expect(next.score).toEqual({ home: 0, away: 0 });
    expect(next.ball).toEqual({ kind: "held", pieceId: 7 });
    expect(next.noSteal).toBe(1);
    expect(next.turn).toBe(1);
  });

  it("대각선으로 인접한 두 상대 기물을 모두 스틸 후보로 만든다", () => {
    const state = createInitialState();
    state.turn = 1;
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

  it("스틸 직후 한 수 동안 재스틸을 막는다", () => {
    const state = createInitialState();
    state.turn = 1;

    const steal = legalMoves(state).find(
      (move) => move.kind === "steal" && move.pieceId === 11 && move.targetPieceId === 3,
    );
    expect(steal).toBeDefined();

    const next = applyMove(state, steal!);

    expect(next.ball).toEqual({ kind: "held", pieceId: 11 });
    expect(next.noSteal).toBe(1);
    expect(legalMoves(next).some((move) => move.kind === "steal")).toBe(false);
  });

  it("스틸 보호는 다음 상대 수만 막고 이후 인접한 재스틸을 다시 허용한다", () => {
    const state = createInitialState();
    state.turn = 1;
    const steal = legalMoves(state).find(
      (move) => move.kind === "steal" && move.pieceId === 11 && move.targetPieceId === 3,
    )!;

    const protectedState = applyMove(state, steal);
    expect(protectedState.noSteal).toBe(1);
    expect(legalMoves(protectedState).some((move) => move.kind === "steal")).toBe(false);

    const homeMove = legalMoves(protectedState).find(
      (move) => move.kind === "move" && move.pieceId === 0,
    )!;
    const protectionExpired = applyMove(protectedState, homeMove);
    expect(protectionExpired.noSteal).toBe(0);

    const awayMove = legalMoves(protectionExpired).find(
      (move) => move.kind === "move" && move.pieceId === 6,
    )!;
    const homeTurn = applyMove(protectionExpired, awayMove);
    expect(legalMoves(homeTurn)).toContainEqual({
      kind: "steal",
      pieceId: 3,
      targetPieceId: 11,
    });
  });
});

describe("평가와 탐색", () => {
  it("대각선 스틸 위협도 상하좌우 위협과 같은 170점 위험으로 평가한다", () => {
    const threatened = createInitialState();
    setPos(threatened, 7, { x: 5, y: 3 });
    setPos(threatened, 11, { x: 7, y: 7 });
    const safe = structuredClone(threatened);
    setPos(safe, 7, { x: 5, y: 2 });

    expect(evalLv1(safe, "home") - evalLv1(threatened, "home")).toBe(170);
  });

  it("대칭 국면의 1점 차를 관점에 따라 반대 부호로 평가한다", () => {
    const state = createInitialState();
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

  it(
    "초기 6대6 국면의 깊이 3 탐색이 5초 안에 끝난다",
    () => {
      const result = search(createInitialState(), { depth: 3, evalFn: evalLv1 });

      expect(result.best).not.toBeNull();
      expect(result.depth).toBe(3);
      expect(result.ms).toBeLessThan(5_000);
    },
    10_000,
  );

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

              const applied = applyMove(state, candidate);
              expect(applied.ball).toEqual({
                kind: "held",
                pieceId: preview.receiverPieceId,
              });
              expect(applied.score).toEqual(state.score);
            } else if (candidate.kind === "shoot") {
              expect([3, 4, 5]).toContain(candidate.goalRow);

              const preview = previewMove(state, candidate);
              expect(preview.kind).toBe("shoot");
              if (preview.kind !== "shoot") throw new Error("슛 미리보기 종류 불일치");

              const applied = applyMove(state, candidate);
              if (preview.outcome === "blocked") {
                expect(preview.blockerPieceId).not.toBeNull();
                expect(applied.ball).toEqual({
                  kind: "held",
                  pieceId: preview.blockerPieceId,
                });
                expect(applied.score).toEqual(state.score);
              } else {
                const expectedScore = { ...state.score };
                expectedScore[actingPiece!.team] += 1;
                expect(preview.blockerPieceId).toBeNull();
                expect(applied.score).toEqual(expectedScore);
              }
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

          expect(state.turn).toBe(previous.turn + 1);
          expect(state.turn).toBeLessThanOrEqual(state.maxTurns);
          expect(state.pieces).toHaveLength(12);
          expect(new Set(state.pieces.map((piece) => piece.id)).size).toBe(12);
          expect(
            new Set(state.pieces.map((piece) => `${piece.pos.x},${piece.pos.y}`)).size,
          ).toBe(12);
          expect(state.pieces.every((piece) => inBounds(piece.pos))).toBe(true);
          expect(state.noSteal === 0 || state.noSteal === 1).toBe(true);

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
    10_000,
  );
});
