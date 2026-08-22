/**
 * 합법 수를 미래로 전개해 현재 차례 팀에게 가장 유리한 수를 고르는 탐색 모듈.
 *
 * 각 후보에 `applyMove()`를 적용하고 제한 깊이까지 minimax로 재귀 탐색한 뒤, 말단
 * 상태를 전달받은 `EvalFn`으로 평가한다. 알파베타 가지치기로 결과를 바꾸지 못하는
 * 하위 가지를 생략하며, 강한 수를 일정한 규칙으로 먼저 보아 가지치기 효율을 높인다.
 *
 * 무작위 동점 처리를 사용하지 않으므로 같은 상태·깊이·평가 함수에는 같은 수와 점수를
 * 반환한다. 단, 실행 시간인 `ms`는 환경과 실행 시점에 따라 달라질 수 있다.
 */

import { applyMoveOutcomes, gameResult, legalMoves, previewMove, sideToMove } from "./rules";
import type { EvalFn, GameState, Move, SearchResult } from "./types";

/** `search()`를 호출할 때 정하는 탐색 깊이와 말단 상태 평가 방법. */
export interface SearchOptions {
  /** 현재 상태에서 앞으로 읽을 ply 수. 한 팀의 행동 한 번이 1 ply다. */
  depth: number;
  /** 제한 깊이 또는 종료 상태를 특정 팀의 관점에서 숫자로 바꾸는 함수. */
  evalFn: EvalFn;
}

/** 모든 정상 평가 점수보다 충분히 큰 알파베타 경계용 유한 값. */
const INF = 1_000_000_000;

/**
 * 브라우저와 Node.js 양쪽에서 사용할 수 있는 현재 시각을 밀리초로 반환한다.
 * 가능하면 정밀한 `performance.now()`를 사용하고, 없는 환경에서는 `Date.now()`로
 * 대체한다. 이 값은 탐색 결과의 선택이 아니라 성능 관찰에만 사용한다.
 */
function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

/**
 * Move가 좋아 보이는 정도가 아니라 탐색할 순서만 정하는 정렬용 점수를 반환한다.
 *
 * 열린 슛, 비득점 슛, 스틸, 패스, 일반 이동 순으로 먼저 살펴본다. 강제성이 큰 수에서
 * 높은 alpha를 일찍 확보하면 이후 후보의 알파베타 가지치기가 더 빨라질 수 있다.
 * 최종 최선 수는 이 rank가 아니라 재귀 탐색으로 얻은 실제 평가 점수로 결정한다.
 */
function moveRank(state: GameState, move: Move): number {
  switch (move.kind) {
    case "shoot": {
      const preview = previewMove(state, move);
      return preview.kind === "shoot" && preview.goalChance >= 1 ? 100 : 60;
    }
    case "steal":
      return 50;
    case "pass":
      return 30;
    case "move":
      return 0;
    case "hold":
      return 20;
    case "endTurn":
      return -10;
  }
}

/**
 * 현재 상태의 합법 수를 결정적인 우선순위로 정렬해 반환한다.
 *
 * rank가 큰 수를 먼저 두되 같은 rank에서는 `legalMoves()`가 만든 원래 인덱스를
 * 유지한다. 따라서 정렬 구현의 동점 처리에 의존하지 않고 탐색 결과를 재현할 수 있다.
 */
function orderedMoves(state: GameState): Move[] {
  return legalMoves(state)
    // 정렬 뒤에도 원래 순서를 복원할 수 있도록 Move에 index와 rank를 임시로 붙인다.
    .map((move, index) => ({ move, index, rank: moveRank(state, move) }))
    // `||` 오른쪽은 rank 차이가 0인 동점일 때만 원래 index의 오름차순을 적용한다.
    .sort((left, right) => right.rank - left.rank || left.index - right.index)
    // 정렬에만 필요했던 메타데이터를 제거하고 공개 타입인 Move[]로 되돌린다.
    .map(({ move }) => move);
}

/**
 * 현재 상태를 지정 깊이까지 탐색하여 최선 수와 모든 루트 후보의 분석 정보를 반환한다.
 *
 * 반환 점수는 항상 루트에서 현재 차례인 팀의 관점이다. 이미 종료된 경기이거나
 * `depth <= 0`이면 후보를 전개하지 않아 `best`는 null이고 현재 상태의 평가만 반환한다.
 * 입력 `state`는 `applyMove()`의 불변성 덕분에 탐색 전후로 변경되지 않는다.
 */
export function search(state: GameState, options: SearchOptions): SearchResult {
  const startedAt = now();
  // 루트 자체는 제외하고 minimax가 방문한 하위 상태 수를 센다.
  let nodes = 0;
  const perspective = sideToMove(state);

  /**
   * 루트 팀 관점으로 현재 국면의 최선 점수를 계산한다.
   *
   * 한 팀은 최대 세 원자 행동을 연속으로 수행하므로, 현재 행동 팀이 루트 팀일 때만
   * 최대화하고 상대 팀일 때 최소화한다. 모든 말단을 같은 `perspective`로 평가해
   * 같은 팀의 연속 행동에서 점수 부호가 뒤집히지 않게 한다.
   */
  const minimax = (position: GameState, depth: number, alpha: number, beta: number): number => {
    nodes += 1;
    // 경기 종료 또는 깊이 소진 시 고정한 루트 팀 관점으로 말단 상태를 평가한다.
    if (gameResult(position) !== null || depth === 0) {
      return options.evalFn(position, perspective);
    }

    const moves = orderedMoves(position);
    // 깊이가 남아도 합법 수가 없다면 더 전개할 수 없으므로 현재 상태를 평가한다.
    if (moves.length === 0) return options.evalFn(position, perspective);

    const maximizing = sideToMove(position) === perspective;
    let best = maximizing ? -INF : INF;
    for (const move of moves) {
      const score = expectedScore(position, move, depth, alpha, beta);
      if (maximizing) {
        best = Math.max(best, score);
        alpha = Math.max(alpha, best);
      } else {
        best = Math.min(best, score);
        beta = Math.min(beta, best);
      }
      if (alpha >= beta) break;
    }
    return best;
  };

  /**
   * 하나의 Move를 확률 결과 분포의 기대값으로 평가한다.
   *
   * 실제 판정이 상태·수 해시로 결정돼 있어도 탐색이 그 결과를 미리 사용하면 봇이
   * “확률을 이미 아는” 부정이 된다. 그래서 탐색은 `applyMove()` 대신 모든 결과를
   * 확률 가중으로 합산한다. 결과가 하나뿐인 결정론적 수는 기존 알파베타 창을 그대로
   * 물려주고, 확률 분기가 있는 수는 각 분기를 전체 창으로 정확히 평가한다.
   */
  function expectedScore(
    position: GameState,
    move: Move,
    depth: number,
    alpha: number,
    beta: number,
  ): number {
    const outcomes = applyMoveOutcomes(position, move);
    if (outcomes.length === 1) {
      return minimax(outcomes[0]!.state, depth - 1, alpha, beta);
    }
    let expectation = 0;
    for (const outcome of outcomes) {
      expectation += outcome.probability * minimax(outcome.state, depth - 1, -INF, INF);
    }
    return expectation;
  }

  // 루트에서 탐색할 수 없는 두 경우에도 일관된 SearchResult 형태를 반환한다.
  if (gameResult(state) !== null || options.depth <= 0) {
    return {
      best: null,
      score: options.evalFn(state, perspective),
      values: [],
      nodes,
      depth: options.depth,
      ms: now() - startedAt,
    };
  }

  // SearchResult의 필드 타입을 재사용해 후보 결과 객체의 형태가 따로 어긋나지 않게 한다.
  const values: SearchResult["values"] = [];
  let best: Move | null = null;
  let bestScore = -INF;
  for (const move of orderedMoves(state)) {
    // 루트 후보는 모두 기록해야 하므로 후보 사이에 alpha 경계를 공유하지 않는다.
    const score = expectedScore(state, move, options.depth, -INF, INF);
    // 분석 UI가 최선 수와 다른 후보의 차이를 비교할 수 있도록 루트 후보를 모두 보존한다.
    values.push({ move, score });
    // 동점에는 먼저 정렬된 수를 유지하여 같은 입력의 best 선택을 결정적으로 만든다.
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }

  // 종료 조건 외의 이유로 합법 수가 하나도 없었던 상태도 자체 평가 점수를 돌려준다.
  if (best === null) bestScore = options.evalFn(state, perspective);
  return {
    best,
    score: bestScore,
    values,
    nodes,
    depth: options.depth,
    ms: now() - startedAt,
  };
}
