import { describe, expect, it } from "vitest";
import { createInitialState, inBounds, sideToMove } from "./rules";
import { BOARD_H, BOARD_W } from "./types";

describe("초기 국면", () => {
  it("4대4, 총 8기물", () => {
    const s = createInitialState();
    expect(s.pieces).toHaveLength(8);
    expect(s.pieces.filter((p) => p.team === "home")).toHaveLength(4);
    expect(s.pieces.filter((p) => p.team === "away")).toHaveLength(4);
  });

  it("팀마다 GK 1명", () => {
    const s = createInitialState();
    for (const team of ["home", "away"] as const) {
      expect(s.pieces.filter((p) => p.team === team && p.role === "GK")).toHaveLength(1);
    }
  });

  it("모든 기물이 보드 안, 같은 칸 중복 없음", () => {
    const s = createInitialState();
    const seen = new Set<string>();
    for (const p of s.pieces) {
      expect(inBounds(p.pos)).toBe(true);
      const key = `${p.pos.x},${p.pos.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("공은 센터 루즈볼, 선공은 home", () => {
    const s = createInitialState();
    expect(s.ball).toEqual({
      kind: "loose",
      pos: { x: Math.floor(BOARD_W / 2), y: Math.floor(BOARD_H / 2) },
    });
    expect(sideToMove(s)).toBe("home");
  });

  it("배치는 좌우 대칭 (선공 이점 외 구조적 편향 없음)", () => {
    const s = createInitialState();
    const homes = s.pieces.filter((p) => p.team === "home");
    const aways = s.pieces.filter((p) => p.team === "away");
    for (const h of homes) {
      const mirror = aways.find(
        (a) => a.role === h.role && a.pos.x === BOARD_W - 1 - h.pos.x && a.pos.y === h.pos.y,
      );
      expect(mirror, `${h.role} 대칭 기물 없음`).toBeDefined();
    }
  });
});
