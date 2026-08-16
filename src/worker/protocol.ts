/**
 * 클라이언트 ↔ 엔진 Worker 메시지 프로토콜.
 * 이 경계를 고정해 두면 Lv.1 → Lv.2 평가 함수 교체가 클라이언트에 보이지 않는다.
 */

import type { GameState, Move, SearchResult } from "../engine/types";

export type WorkerRequest =
  | { type: "analyze"; requestId: number; state: GameState; depth: number }
  | { type: "legalMoves"; requestId: number; state: GameState };

export type WorkerResponse =
  | { type: "analysis"; requestId: number; result: SearchResult }
  | { type: "legalMoves"; requestId: number; moves: Move[] }
  | { type: "error"; requestId: number; message: string };
