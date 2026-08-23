import { BOARD_H, BOARD_W, type GameState, type Move, type Pos } from "../engine/types";
import type { CanvasTarget } from "./types";

/** Canvas 위치를 직접 선택해 실행하는 행동. */
export type TargetedMove = Exclude<Move, { kind: "hold" } | { kind: "endTurn" }>;

/** 버튼 전용 행동을 Canvas 대상 행동에서 제외한다. */
export function isTargetedMove(move: Move): move is TargetedMove {
  return move.kind !== "hold" && move.kind !== "endTurn";
}

/**
 * 축구 중계 시점의 2.5D 원근 배치.
 *
 * 보드는 13×9칸이다. 세로는 `rowH` 픽셀로 균일하게 압축하고, 가로는 화면 위쪽(멀리)일수록
 * 좁아지는 스케일을 곱해 사다리꼴 원근을 만든다. 세로가 균일하므로 픽셀→칸 역변환이
 * 행 먼저, 그 행의 스케일로 열을 푸는 순서로 정확하게 성립한다.
 */
export const BOARD_GEOMETRY = {
  /** 스케일 1에서의 논리 칸 폭(px). 기물·글자 크기의 기준이다. */
  cell: 80,
  /** 화면상 한 행의 세로 높이(px). */
  rowH: 62,
  /** 보드 맨 윗변의 y 픽셀. */
  originY: 70,
  /** 원근 소실점이 놓이는 화면 가로 중심. */
  centerX: 600,
  /** 맨 윗행(fy=0)의 가로 스케일. */
  scaleTop: 0.76,
  /** 아래로 한 행 내려올 때마다 커지는 가로 스케일. */
  scaleGain: 0.03,
  canvasWidth: 1200,
  canvasHeight: 720,
} as const;

/** 세로 논리 좌표(칸 단위 연속값)에서의 가로 원근 스케일. */
export function boardScaleAt(fy: number): number {
  return BOARD_GEOMETRY.scaleTop + BOARD_GEOMETRY.scaleGain * fy;
}

/** 논리 좌표(칸 단위 연속값, 칸 왼쪽 위가 정수)를 원근이 적용된 Canvas 픽셀로 투영한다. */
export function projectPoint(fx: number, fy: number): { x: number; y: number } {
  const scale = boardScaleAt(fy);
  return {
    x: BOARD_GEOMETRY.centerX + (fx - BOARD_W / 2) * BOARD_GEOMETRY.cell * scale,
    y: BOARD_GEOMETRY.originY + fy * BOARD_GEOMETRY.rowH,
  };
}

/** `projectPoint`의 역변환. 보드 밖 픽셀도 논리 좌표로 계산해 골대 판정에 쓴다. */
export function unprojectPoint(px: number, py: number): { fx: number; fy: number } {
  const fy = (py - BOARD_GEOMETRY.originY) / BOARD_GEOMETRY.rowH;
  const scale = boardScaleAt(fy);
  return {
    fx: (px - BOARD_GEOMETRY.centerX) / (BOARD_GEOMETRY.cell * scale) + BOARD_W / 2,
    fy,
  };
}

/** 보드 칸의 바닥 중심을 투영한 픽셀. */
export function projectCellCenter(pos: Pos): { x: number; y: number } {
  return projectPoint(pos.x + 0.5, pos.y + 0.5);
}

/** 골대 여백 한 행의 바닥 중심을 투영한 픽셀. */
export function projectGoalCenter(side: "left" | "right", row: number): { x: number; y: number } {
  return projectPoint(side === "left" ? -0.5 : BOARD_W + 0.5, row + 0.5);
}

/** Canvas 픽셀 좌표를 보드 칸 또는 골대 같은 게임 입력 대상으로 변환한다. */
export function canvasPointToTarget(x: number, y: number): CanvasTarget {
  const { canvasWidth, canvasHeight } = BOARD_GEOMETRY;
  if (x < 0 || x >= canvasWidth || y < 0 || y >= canvasHeight) {
    return { kind: "outside" };
  }

  const { fx, fy } = unprojectPoint(x, y);
  if (fy < 0 || fy >= BOARD_H) return { kind: "outside" };
  const row = Math.floor(fy);

  if (fx >= 0 && fx < BOARD_W) {
    return { kind: "cell", pos: { x: Math.floor(fx), y: row } };
  }

  // 보드 좌우로 한 칸 폭의 골대 여백 중 실제 골문에 해당하는 세 행만 슛 입력으로 인정한다.
  if (row < 3 || row > 5) return { kind: "outside" };
  if (fx >= -1 && fx < 0) return { kind: "goal", side: "left", row };
  if (fx >= BOARD_W && fx < BOARD_W + 1) return { kind: "goal", side: "right", row };
  return { kind: "outside" };
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
