import { BOARD_H, BOARD_W, type GameState, type Move } from "../engine/types";
import type { CanvasTarget } from "./types";

/** Canvas 위치를 직접 선택해 실행하는 행동. */
export type TargetedMove = Exclude<Move, { kind: "hold" } | { kind: "endTurn" }>;

/** 버튼 전용 행동을 Canvas 대상 행동에서 제외한다. */
export function isTargetedMove(move: Move): move is TargetedMove {
  return move.kind !== "hold" && move.kind !== "endTurn";
}

/**
 * Canvas 안에서 보드와 양쪽 골대가 차지하는 고정 픽셀 배치.
 *
 * 보드는 13×9칸이며 한 칸은 80px이다. x축 양쪽의 80px 여백은 슛 목표를 클릭하는
 * 골대 영역이므로 실제 보드는 `originX=80`에서 시작한다.
 */
export const BOARD_GEOMETRY = {
  cell: 80,
  originX: 80,
  originY: 0,
  canvasWidth: 1200,
  canvasHeight: 720,
  boardRight: 80 + BOARD_W * 80,
} as const;

/** Canvas 픽셀 좌표를 보드 칸 또는 골대 같은 게임 입력 대상으로 변환한다. */
export function canvasPointToTarget(x: number, y: number): CanvasTarget {
  const { cell, originX, originY, boardRight, canvasWidth, canvasHeight } = BOARD_GEOMETRY;
  if (x < 0 || x >= canvasWidth || y < 0 || y >= canvasHeight) {
    return { kind: "outside" };
  }

  const row = Math.floor((y - originY) / cell);
  if (row < 0 || row >= BOARD_H) return { kind: "outside" };

  if (x >= originX && x < boardRight) {
    return {
      kind: "cell",
      pos: { x: Math.floor((x - originX) / cell), y: row },
    };
  }

  // 골대 여백에서도 실제 골문에 해당하는 세 행만 슛 입력으로 인정한다.
  if (row < 3 || row > 5) return { kind: "outside" };
  return { kind: "goal", side: x < originX ? "left" : "right", row };
}

/** Move가 참조하는 기물이 상태에 없으면 잘못된 클라이언트 입력으로 즉시 실패시킨다. */
function requirePiece(state: GameState, pieceId: number) {
  const piece = state.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece) throw new Error(`존재하지 않는 기물 ID입니다: ${pieceId}`);
  return piece;
}

/** 엔진의 합법 수 하나를 Canvas에서 사용자가 클릭해야 할 대상으로 바꾼다. */
export function targetForMove(state: GameState, move: TargetedMove): CanvasTarget {
  if (move.kind === "move") {
    return { kind: "cell", pos: { ...move.to } };
  }
  if (move.kind === "pass") {
    const target = requirePiece(state, move.targetPieceId);
    return { kind: "cell", pos: { ...target.pos } };
  }
  if (move.kind === "steal") {
    const target = requirePiece(state, move.targetPieceId);
    return { kind: "cell", pos: { ...target.pos } };
  }
  if (move.kind === "shoot") {
    const shooter = requirePiece(state, move.pieceId);
    return {
      kind: "goal",
      side: shooter.team === "home" ? "right" : "left",
      row: move.goalRow,
    };
  }

  const unsupportedMove: never = move;
  throw new Error(`지원하지 않는 행동입니다: ${JSON.stringify(unsupportedMove)}`);
}

/** Canvas 대상이 특정 Move를 실행하기 위해 클릭할 위치인지 판정한다. */
export function moveMatchesTarget(
  state: GameState,
  move: TargetedMove,
  target: CanvasTarget,
): boolean {
  const expected = targetForMove(state, move);
  if (expected.kind !== target.kind) return false;
  if (expected.kind === "outside" || target.kind === "outside") return true;
  if (expected.kind === "goal" && target.kind === "goal") {
    return expected.side === target.side && expected.row === target.row;
  }
  return (
    expected.kind === "cell" &&
    target.kind === "cell" &&
    expected.pos.x === target.pos.x &&
    expected.pos.y === target.pos.y
  );
}
