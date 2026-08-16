/**
 * 탐색: 네가맥스 + 알파베타. 엔진은 봇 상대이자 분석기다(같은 코드).
 * TODO(S1): 프로토타입 탐색 이식. 깊이·시간 제한은 호출자가 준다.
 */

import type { EvalFn, GameState, SearchResult } from "./types";

export interface SearchOptions {
  depth: number;
  evalFn: EvalFn;
}

export function search(state: GameState, options: SearchOptions): SearchResult {
  void state;
  void options;
  throw new Error("search: not implemented yet (S1)");
}
