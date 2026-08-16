/**
 * 룰: 초기 국면, 합법 수 생성, 수 적용.
 * 무작위 호출 0회 — 결정론은 이 게임의 룰 제약이다 (blunder 판정·수읽기의 전제).
 */

import type { GameState, Move, Piece, Pos, Team } from "./types";
import { BOARD_H, BOARD_W } from "./types";

export function inBounds(p: Pos): boolean {
  return p.x >= 0 && p.x < BOARD_W && p.y >= 0 && p.y < BOARD_H;
}

const MID_Y = Math.floor(BOARD_H / 2);

/** 4대4 초기 배치. 프로토타입(kickmate.html)의 배치를 기준으로 하되 플레이테스트로 조정한다. */
export function createInitialState(): GameState {
  const home: Array<[Piece["role"], Pos]> = [
    ["GK", { x: 0, y: MID_Y }],
    ["DF", { x: 3, y: MID_Y - 2 }],
    ["MF", { x: 4, y: MID_Y + 2 }],
    ["FW", { x: 5, y: MID_Y }],
  ];
  const away: Array<[Piece["role"], Pos]> = home.map(([role, p]) => [
    role,
    { x: BOARD_W - 1 - p.x, y: p.y },
  ]);

  const pieces: Piece[] = [...home, ...away].map(([role, pos], i) => ({
    id: i,
    team: i < home.length ? "home" : "away",
    role,
    pos,
    protectedUntilTurn: -1,
  }));

  return {
    turn: 0,
    maxTurns: 60,
    pieces,
    ball: { kind: "loose", pos: { x: Math.floor(BOARD_W / 2), y: MID_Y } },
    score: { home: 0, away: 0 },
  };
}

export function sideToMove(state: GameState): Team {
  return state.turn % 2 === 0 ? "home" : "away";
}

/**
 * TODO(S1): 프로토타입의 합법 수 생성 이식 —
 * 이동(역할별: GK 박스 1칸 / DF 직선 2 / MF 전방향 2 / FW 나이트),
 * 패스(8방향 직선, 상대 선상 차단), 슛(경로 차단 시 선방), 스틸(인접, 1턴 보호).
 */
export function legalMoves(state: GameState): Move[] {
  void state;
  throw new Error("legalMoves: not implemented yet (S1)");
}

/** TODO(S1): 수 적용 — 순수 함수로, 새 GameState를 반환한다. */
export function applyMove(state: GameState, move: Move): GameState {
  void state;
  void move;
  throw new Error("applyMove: not implemented yet (S1)");
}
