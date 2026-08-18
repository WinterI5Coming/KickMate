import { describe, expect, it } from "vitest";
import { traceBallPath } from "./ballPath";

describe("traceBallPath", () => {
  it("출발 칸과 보드 밖 목표를 제외하고 수평 경로를 반환한다", () => {
    expect(traceBallPath({ x: 10, y: 4 }, { x: 13, y: 4 })).toEqual([
      { distance: 1, cells: [{ x: 11, y: 4 }] },
      { distance: 2, cells: [{ x: 12, y: 4 }] },
    ]);
  });

  it("수직 경로를 출발점 다음 칸부터 도착 칸까지 반환한다", () => {
    expect(traceBallPath({ x: 4, y: 2 }, { x: 4, y: 5 })).toEqual([
      { distance: 1, cells: [{ x: 4, y: 3 }] },
      { distance: 2, cells: [{ x: 4, y: 4 }] },
      { distance: 3, cells: [{ x: 4, y: 5 }] },
    ]);
  });

  it("역방향에서도 출발점 다음 칸부터 정렬한다", () => {
    expect(traceBallPath({ x: 2, y: 4 }, { x: -1, y: 4 })).toEqual([
      { distance: 1, cells: [{ x: 1, y: 4 }] },
      { distance: 2, cells: [{ x: 0, y: 4 }] },
    ]);
  });

  it("모서리를 정확히 통과하면 같은 거리의 양쪽 칸과 다음 대각선 칸을 포함한다", () => {
    const path = traceBallPath({ x: 0, y: 0 }, { x: 2, y: 2 });

    expect(path[0]).toEqual({
      distance: 1,
      cells: [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
    });
  });

  it("임의 기울기에서 선분이 지나가는 칸을 빠짐없이 한 번씩 반환한다", () => {
    const cells = traceBallPath({ x: 1, y: 1 }, { x: 8, y: 4 }).flatMap(
      (step) => step.cells,
    );

    expect(cells).toEqual([
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
      { x: 4, y: 3 },
      { x: 5, y: 3 },
      { x: 6, y: 3 },
      { x: 7, y: 3 },
      { x: 7, y: 4 },
      { x: 8, y: 4 },
    ]);
    expect(new Set(cells.map((cell) => `${cell.x},${cell.y}`)).size).toBe(cells.length);
  });
});
