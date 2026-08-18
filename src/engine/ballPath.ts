/**
 * 패스와 슛이 공유하는 공의 이동 경로 계산.
 *
 * 출발 칸과 목표 칸의 중심을 직선으로 연결했을 때 선분이 지나가거나 경계에 닿는
 * 모든 보드 칸을 반환한다. Canvas나 기물 정보는 알지 못하므로 엔진 규칙과 화면이
 * 같은 기하 결과를 재사용할 수 있다.
 */

import { BOARD_H, BOARD_W, type Pos } from "./types";

/** 선분 진행 중 같은 시점에 닿은 보드 칸 묶음. */
export interface PathStep {
  /** 출발점에서 몇 번째로 만난 칸 묶음인지 나타내는 1부터 시작하는 순서. */
  distance: number;
  /** 같은 모서리에 동시에 닿을 수 있는 하나 이상의 보드 칸. */
  cells: Pos[];
}

/** 좌표가 실제 13×9 보드 안에 있는지 검사한다. */
function inBounds(pos: Pos): boolean {
  return pos.x >= 0 && pos.x < BOARD_W && pos.y >= 0 && pos.y < BOARD_H;
}

/** 같은 칸을 제거할 때 사용할 안정적인 문자열 키를 만든다. */
function cellKey(pos: Pos): string {
  return `${pos.x},${pos.y}`;
}

/**
 * `from` 칸 다음부터 `target` 방향으로 선분이 닿는 보드 칸을 순서대로 반환한다.
 *
 * 목표는 슛의 골문처럼 보드 밖일 수 있다. 결과에는 보드 안의 칸만 포함하며,
 * 선분이 모서리를 정확히 지나면 그 모서리에 닿은 양옆 칸과 다음 대각선 칸을 같은
 * `PathStep`으로 묶는다. 부동소수점 오차 없이 같은 입력에 같은 결과를 내기 위해
 * 정수 비교만 사용한다.
 */
export function traceBallPath(from: Pos, target: Pos): PathStep[] {
  const deltaX = target.x - from.x;
  const deltaY = target.y - from.y;
  const horizontalSteps = Math.abs(deltaX);
  const verticalSteps = Math.abs(deltaY);
  const directionX = Math.sign(deltaX);
  const directionY = Math.sign(deltaY);
  let horizontalIndex = 0;
  let verticalIndex = 0;
  let distance = 0;
  const path: PathStep[] = [];

  while (horizontalIndex < horizontalSteps || verticalIndex < verticalSteps) {
    const decision =
      (1 + 2 * horizontalIndex) * verticalSteps -
      (1 + 2 * verticalIndex) * horizontalSteps;
    const touched: Pos[] = [];

    if (decision === 0) {
      // 선분이 칸 모서리를 정확히 지나면 맞닿은 두 칸과 진입할 대각선 칸이 동시에 닿는다.
      touched.push(
        {
          x: from.x + (horizontalIndex + 1) * directionX,
          y: from.y + verticalIndex * directionY,
        },
        {
          x: from.x + horizontalIndex * directionX,
          y: from.y + (verticalIndex + 1) * directionY,
        },
      );
      horizontalIndex += 1;
      verticalIndex += 1;
      touched.push({
        x: from.x + horizontalIndex * directionX,
        y: from.y + verticalIndex * directionY,
      });
    } else if (decision < 0) {
      horizontalIndex += 1;
      touched.push({
        x: from.x + horizontalIndex * directionX,
        y: from.y + verticalIndex * directionY,
      });
    } else {
      verticalIndex += 1;
      touched.push({
        x: from.x + horizontalIndex * directionX,
        y: from.y + verticalIndex * directionY,
      });
    }

    // 보드 밖 목표와 모서리 처리에서 생긴 중복을 제거하고 순서를 고정한다.
    const cells = [
      ...new Map(
        touched.filter(inBounds).map((cell) => [cellKey(cell), cell] as const),
      ).values(),
    ].sort((left, right) => left.y - right.y || left.x - right.x);

    if (cells.length > 0) {
      distance += 1;
      path.push({ distance, cells });
    }
  }

  return path;
}
