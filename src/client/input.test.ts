import { describe, expect, it } from "vitest";
import { applyMove, createInitialState, gameResult, legalMoves } from "../engine/rules";
import { canvasPointToTarget, moveMatchesTarget, targetForMove } from "./input";

describe("Canvas 입력 변환", () => {
  it("경기장 왼쪽 위 내부 픽셀을 첫 번째 보드 칸으로 바꾼다", () => {
    expect(canvasPointToTarget(81, 1)).toEqual({
      kind: "cell",
      pos: { x: 0, y: 0 },
    });
  });

  it.each([
    [1, "left"],
    [1121, "right"],
  ] as const)("양쪽 골대 여백의 골문 행을 goal 대상으로 바꾼다", (x, side) => {
    expect(canvasPointToTarget(x, 321)).toEqual({
      kind: "goal",
      side,
      row: 4,
    });
  });

  it("골문 행 바깥의 여백은 경기 대상으로 취급하지 않는다", () => {
    expect(canvasPointToTarget(1, 1)).toEqual({ kind: "outside" });
  });

  it.each([-1, 1200])("Canvas 가로 경계 바깥은 골대로 취급하지 않는다", (x) => {
    expect(canvasPointToTarget(x, 321)).toEqual({ kind: "outside" });
  });

  it("일반 이동의 목적지 칸을 클릭 목표로 사용한다", () => {
    const state = createInitialState();
    const move = legalMoves(state).find(
      (candidate) =>
        candidate.kind === "move" &&
        candidate.pieceId === 0 &&
        candidate.to.x === 1 &&
        candidate.to.y === 4,
    );

    expect(move).toBeDefined();
    expect(targetForMove(state, move!)).toEqual({
      kind: "cell",
      pos: { x: 1, y: 4 },
    });
  });

  it("패스의 도착 칸을 클릭 목표로 사용한다", () => {
    const state = createInitialState();
    const pass = legalMoves(state).find(
      (candidate) =>
        candidate.kind === "pass" && candidate.to.x === 2 && candidate.to.y === 4,
    );

    expect(pass).toBeDefined();
    expect(targetForMove(state, pass!)).toEqual({
      kind: "cell",
      pos: { x: 2, y: 4 },
    });
  });

  it("home 직선 슛을 오른쪽 골대의 통과 행과 연결한다", () => {
    const state = createInitialState();
    const shoot = legalMoves(state).find(
      (candidate) =>
        candidate.kind === "shoot" && candidate.pieceId === 2 && candidate.dy === 0,
    );

    expect(shoot).toBeDefined();
    expect(targetForMove(state, shoot!)).toEqual({
      kind: "goal",
      side: "right",
      row: 4,
    });
  });

  it("골라인에서 세 칸 떨어진 중앙 기물은 직선 슛 하나만 골문을 통과한다", () => {
    const state = createInitialState();
    const shooter = state.pieces.find((piece) => piece.id === 2)!;
    shooter.pos = { x: 10, y: 4 };
    state.pieces.find((piece) => piece.id === 5)!.pos = { x: 12, y: 3 };
    state.ball = { kind: "held", pieceId: shooter.id };

    const shoots = legalMoves(state).filter(
      (move) => move.kind === "shoot" && move.pieceId === shooter.id,
    );

    expect(shoots).toEqual([{ kind: "shoot", pieceId: shooter.id, dy: 0 }]);
    expect(targetForMove(state, shoots[0]!)).toEqual({
      kind: "goal",
      side: "right",
      row: 4,
    });
  });

  it("away 대각선 슛을 왼쪽 골대의 통과 행과 연결한다", () => {
    const state = createInitialState();
    state.turn = 1;
    state.pieces.find((piece) => piece.id === 0)!.pos = { x: 0, y: 2 };
    state.pieces.find((piece) => piece.id === 6)!.pos = { x: 0, y: 4 };
    state.ball = { kind: "held", pieceId: 6 };
    const shoot = legalMoves(state).find(
      (candidate) =>
        candidate.kind === "shoot" && candidate.pieceId === 6 && candidate.dy === -1,
    );

    expect(shoot).toBeDefined();
    expect(targetForMove(state, shoot!)).toEqual({
      kind: "goal",
      side: "left",
      row: 3,
    });
  });

  it("스틸을 away 볼 소유자의 칸과 연결한다", () => {
    const state = createInitialState();
    state.pieces.find((piece) => piece.id === 3)!.pos = { x: 7, y: 5 };
    state.ball = { kind: "held", pieceId: 6 };
    const steal = legalMoves(state).find(
      (candidate) =>
        candidate.kind === "steal" &&
        candidate.pieceId === 3 &&
        candidate.targetPieceId === 6,
    );

    expect(steal).toBeDefined();
    expect(targetForMove(state, steal!)).toEqual({
      kind: "cell",
      pos: { x: 8, y: 5 },
    });
  });

  it("Move의 실제 목적지와 같은 Canvas 대상을 일치한다고 판정한다", () => {
    const state = createInitialState();
    const move = legalMoves(state).find(
      (candidate) =>
        candidate.kind === "move" &&
        candidate.pieceId === 0 &&
        candidate.to.x === 1 &&
        candidate.to.y === 4,
    );

    expect(move).toBeDefined();
    expect(
      moveMatchesTarget(state, move!, { kind: "cell", pos: { x: 1, y: 4 } }),
    ).toBe(true);
  });

  it("Move의 목적지와 다른 Canvas 대상은 일치하지 않는다고 판정한다", () => {
    const state = createInitialState();
    const move = legalMoves(state).find(
      (candidate) =>
        candidate.kind === "move" &&
        candidate.pieceId === 0 &&
        candidate.to.x === 1 &&
        candidate.to.y === 4,
    );

    expect(move).toBeDefined();
    expect(
      moveMatchesTarget(state, move!, { kind: "cell", pos: { x: 1, y: 5 } }),
    ).toBe(false);
  });

  it("슛이 통과하는 골대 side와 행이 모두 같을 때만 일치한다", () => {
    const state = createInitialState();
    const shoot = legalMoves(state).find(
      (candidate) =>
        candidate.kind === "shoot" && candidate.pieceId === 2 && candidate.dy === 0,
    );

    expect(shoot).toBeDefined();
    expect(
      moveMatchesTarget(state, shoot!, { kind: "goal", side: "right", row: 4 }),
    ).toBe(true);
    expect(
      moveMatchesTarget(state, shoot!, { kind: "goal", side: "right", row: 3 }),
    ).toBe(false);
  });

  it("Move가 존재하지 않는 기물을 가리키면 ID를 포함한 오류를 낸다", () => {
    const state = createInitialState();

    expect(() =>
      targetForMove(state, { kind: "shoot", pieceId: 999, dy: 0 }),
    ).toThrow("존재하지 않는 기물 ID입니다: 999");
  });

  it("32경기의 모든 합법 수가 클릭 가능한 단일 Canvas 대상으로 왕복된다", () => {
    for (let gameIndex = 0; gameIndex < 32; gameIndex += 1) {
      let state = createInitialState();
      let selector = gameIndex + 1;

      while (gameResult(state) === null) {
        const moves = legalMoves(state);
        const targetsByAction = new Map<string, Set<string>>();

        for (const move of moves) {
          const target = targetForMove(state, move);
          expect(target.kind).not.toBe("outside");
          expect(moveMatchesTarget(state, move, target)).toBe(true);

          if (target.kind === "outside") {
            throw new Error(`합법 수가 Canvas 바깥을 가리킵니다: ${JSON.stringify(move)}`);
          }

          const actionKey = `${move.pieceId}:${move.kind}`;
          const targetKey =
            target.kind === "cell"
              ? `cell:${target.pos.x},${target.pos.y}`
              : `goal:${target.side},${target.row}`;
          const usedTargets = targetsByAction.get(actionKey) ?? new Set<string>();
          expect(usedTargets.has(targetKey), `${actionKey} has duplicate ${targetKey}`).toBe(false);
          usedTargets.add(targetKey);
          targetsByAction.set(actionKey, usedTargets);
        }

        selector = (selector * 73 + 41) % 1_000_003;
        state = applyMove(state, moves[selector % moves.length]!);
      }
    }
  });
});
