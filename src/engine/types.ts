/**
 * 엔진 공용 타입. 이 모듈은 순수해야 한다 — DOM·Worker·파일시스템에 의존하지 않는다.
 * (브라우저 Web Worker와 Node 헤드리스 셀프플레이가 같은 코드를 공유하기 위한 전제)
 */

export const BOARD_W = 13;
export const BOARD_H = 9;

export type Team = "home" | "away";

/** 역할별 이동 규칙은 content/pieces.json이 원본이고, 엔진은 그 수치를 주입받는다. */
export type Role = "GK" | "DF" | "MF" | "FW";

export interface Pos {
  x: number; // 0..BOARD_W-1, home 골대가 x=0 쪽
  y: number; // 0..BOARD_H-1
}

export interface Piece {
  id: number;
  team: Team;
  role: Role;
  pos: Pos;
  /** 스틸 직후 1턴 보호 등 상태 플래그 자리 */
  protectedUntilTurn: number;
}

export type BallState =
  | { kind: "held"; pieceId: number }
  | { kind: "loose"; pos: Pos };

export interface GameState {
  turn: number; // 0부터, 짝수 = home 차례 (교대 턴제)
  maxTurns: number; // 60수 제한 (프로토타입 룰)
  pieces: Piece[];
  ball: BallState;
  score: { home: number; away: number };
}

export type Move =
  | { kind: "move"; pieceId: number; to: Pos }
  | { kind: "pass"; pieceId: number; to: Pos }
  | { kind: "shoot"; pieceId: number }
  | { kind: "steal"; pieceId: number; targetPieceId: number };

/** 평가 함수 인터페이스 — Lv.1(수제)과 Lv.2(학습)를 갈아끼우는 지점 */
export type EvalFn = (state: GameState, perspective: Team) => number;

export interface SearchResult {
  best: Move | null;
  /** perspective 기준 평가치. 승률 표시용 시그모이드 매핑은 클라이언트가 한다. */
  score: number;
  nodes: number;
  depth: number;
}
