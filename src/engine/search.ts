/**
 * 합법 수를 미래로 전개해 현재 차례 팀에게 가장 유리한 수를 고르는 탐색 모듈.
 *
 * 각 후보에 `applyMove()`를 적용하고 제한 깊이까지 네가맥스로 재귀 탐색한 뒤, 말단
 * 상태를 전달받은 `EvalFn`으로 평가한다. 알파베타 가지치기로 결과를 바꾸지 못하는
 * 하위 가지를 생략하며, 강한 수를 일정한 규칙으로 먼저 보아 가지치기 효율을 높인다.
 *
 * 무작위 동점 처리를 사용하지 않으므로 같은 상태·깊이·평가 함수에는 같은 수와 점수를
 * 반환한다. 단, 실행 시간인 `ms`는 환경과 실행 시점에 따라 달라질 수 있다.
 */

import { applyMove, gameResult, legalMoves, sideToMove } from "./rules";
import { BOARD_W, type EvalFn, type GameState, type Move, type SearchResult } from "./types";

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
 * shoot Move의 궤적에서 슈터와 골라인 사이에 기물이 하나라도 있는지 검사한다.
 *
 * 이 함수는 슛 결과를 적용하지 않고 `moveRank()`가 열린 슛을 먼저 탐색하도록 돕기만
 * 한다. 합법적인 shoot Move가 들어온다는 전제라 슈터의 존재를 non-null assertion으로
 * 표현하며, 경로 위 기물은 팀과 역할에 관계없이 슛을 막는다.
 */
function shotIsBlocked(state: GameState, move: Extract<Move, { kind: "shoot" }>): boolean {
  const shooter = state.pieces.find((piece) => piece.id === move.pieceId)!;
  // home은 오른쪽 골라인, away는 왼쪽 골라인을 향한다.
  const directionX = shooter.team === "home" ? 1 : -1;
  const goalX = shooter.team === "home" ? BOARD_W : -1;
  const distanceToGoal = Math.abs(goalX - shooter.pos.x);

  // 슈터 다음 칸부터 골라인 직전까지 슛의 직선·대각선 궤적을 따라간다.
  for (let distance = 1; distance < distanceToGoal; distance++) {
    const x = shooter.pos.x + directionX * distance;
    const y = shooter.pos.y + move.dy * distance;
    if (state.pieces.some((piece) => piece.pos.x === x && piece.pos.y === y)) return true;
  }
  return false;
}

/**
 * Move가 좋아 보이는 정도가 아니라 탐색할 순서만 정하는 정렬용 점수를 반환한다.
 *
 * 열린 슛, 막힌 슛, 스틸, 패스, 일반 이동 순으로 먼저 살펴본다. 강제성이 큰 수에서
 * 높은 alpha를 일찍 확보하면 이후 후보의 알파베타 가지치기가 더 빨라질 수 있다.
 * 최종 최선 수는 이 rank가 아니라 재귀 탐색으로 얻은 실제 평가 점수로 결정한다.
 */
function moveRank(state: GameState, move: Move): number {
  switch (move.kind) {
    case "shoot":
      return shotIsBlocked(state, move) ? 60 : 100;
    case "steal":
      return 50;
    case "pass":
      return 30;
    case "move":
      return 0;
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
  // 루트 자체는 제외하고 negamax가 방문한 하위 상태 수를 센다.
  let nodes = 0;

  /**
   * `position`의 현재 차례 팀이 얻을 수 있는 최선의 점수를 재귀적으로 계산한다.
   *
   * 차례가 바뀔 때 관점도 반대가 되므로 자식의 최고 점수에 음수를 붙이면 현재 팀의
   * 점수가 된다. 이 부호 대칭을 이용해 최대화와 최소화를 하나의 함수로 표현한다.
   * alpha는 현재까지 보장된 하한, beta는 상대가 허용할 상한이며, 하한이 상한 이상이면
   * 나머지 수가 상위 결정에 영향을 줄 수 없어 탐색을 중단한다.
   */
  const negamax = (position: GameState, depth: number, alpha: number, beta: number): number => {
    nodes += 1;
    // 경기 종료 또는 깊이 소진 시 현재 차례 팀 관점으로 말단 상태를 평가한다.
    if (gameResult(position) !== null || depth === 0) {
      return options.evalFn(position, sideToMove(position));
    }

    const moves = orderedMoves(position);
    // 깊이가 남아도 합법 수가 없다면 더 전개할 수 없으므로 현재 상태를 평가한다.
    if (moves.length === 0) return options.evalFn(position, sideToMove(position));

    let best = -INF;
    // 매개변수 alpha를 보존하고 이 노드에서 발견한 새 하한을 별도 변수에 누적한다.
    let lowerBound = alpha;
    for (const move of moves) {
      // 자식은 상대 관점이므로 경계와 반환 점수의 부호를 모두 뒤집는다.
      const score = -negamax(applyMove(position, move), depth - 1, -beta, -lowerBound);
      best = Math.max(best, score);
      lowerBound = Math.max(lowerBound, score);
      // 이미 beta 이상을 보장하면 상위 노드는 이 가지를 선택하지 않으므로 나머지를 생략한다.
      if (lowerBound >= beta) break;
    }
    return best;
  };

  // 루트에서 탐색할 수 없는 두 경우에도 일관된 SearchResult 형태를 반환한다.
  if (gameResult(state) !== null || options.depth <= 0) {
    return {
      best: null,
      score: options.evalFn(state, sideToMove(state)),
      values: [],
      nodes,
      depth: options.depth,
      ms: now() - startedAt,
    };
  }

  // SearchResult의 필드 타입을 재사용해 후보 결과 객체의 형태가 따로 어긋나지 않게 한다.
  const values: SearchResult["values"] = [];
  let best: Move | null = null;
  let alpha = -INF;
  for (const move of orderedMoves(state)) {
    // 루트 수를 둔 뒤에는 상대 차례이므로 negamax 결과의 부호를 루트 관점으로 되돌린다.
    const score = -negamax(applyMove(state, move), options.depth - 1, -INF, -alpha);
    // 분석 UI가 최선 수와 다른 후보의 차이를 비교할 수 있도록 루트 후보를 모두 보존한다.
    values.push({ move, score });
    // 동점에는 먼저 정렬된 수를 유지하여 같은 입력의 best 선택을 결정적으로 만든다.
    if (score > alpha) {
      alpha = score;
      best = move;
    }
  }

  // 종료 조건 외의 이유로 합법 수가 하나도 없었던 상태도 자체 평가 점수를 돌려준다.
  if (best === null) alpha = options.evalFn(state, sideToMove(state));
  return {
    best,
    score: alpha,
    values,
    nodes,
    depth: options.depth,
    ms: now() - startedAt,
  };
}
