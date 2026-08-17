/**
 * 경기 상태를 한 팀의 관점에서 숫자 하나로 요약하는 Lv.1 휴리스틱 평가 모듈.
 *
 * 탐색기는 미래의 모든 수를 경기 종료까지 읽을 수 없으므로 제한 깊이에 도달한 상태를
 * 이 함수로 비교한다. 양수는 `perspective` 팀에게 유리하고, 음수는 상대 팀에게 유리하며,
 * 절댓값이 클수록 그 차이를 중요하게 본다는 뜻이다.
 *
 * 실제 득점, 공 소유, 열린 슛, 스틸 위험, loose 공까지의 거리, FW·MF의 전진도를
 * 프로토타입과 같은 가중치로 합산한다. 이것은 승패의 정답을 계산하는 규칙이 아니라
 * 탐색이 더 유망한 수를 먼저 선택하도록 돕는 빠른 근사치다.
 */

import { BOARD_W, type EvalFn, type GameState, type Piece } from "../types";

/** 열린 슛 후보로 인정할 공 소유자와 상대 골라인 사이의 최대 x 거리. */
const SHOT_MAX = 7;
/** 슛 궤적이 골라인을 통과할 때 득점 범위로 인정되는 y 좌표. */
const GOAL_ROWS = new Set([3, 4, 5]);

/** 지정한 좌표를 점유한 기물을 찾으며, 빈 칸이면 `undefined`를 반환한다. */
function pieceAt(state: GameState, x: number, y: number): Piece | undefined {
  return state.pieces.find((piece) => piece.pos.x === x && piece.pos.y === y);
}

/**
 * 공 소유자에게 골대 안으로 향하면서 중간 기물에 막히지 않는 슛이 하나라도 있는지 본다.
 *
 * `legalMoves()`와 같은 세 궤적(dy=-1, 0, 1)을 검사하지만 Move를 만들지는 않는다.
 * 평가 중 여러 번 호출될 수 있으므로 필요한 불리언 결과만 빠르게 계산한다. 경로 위의
 * 기물은 팀이나 역할과 관계없이 슛을 막으며, 골라인까지 7칸을 넘으면 슛할 수 없다.
 */
function hasOpenShot(state: GameState, carrier: Piece): boolean {
  // home은 x가 증가하는 오른쪽, away는 x가 감소하는 왼쪽으로 공격한다.
  const directionX = carrier.team === "home" ? 1 : -1;
  const goalX = carrier.team === "home" ? BOARD_W : -1;
  const distanceToGoal = Math.abs(goalX - carrier.pos.x);
  if (distanceToGoal > SHOT_MAX) return false;

  // -1은 위 대각선, 0은 직선, 1은 아래 대각선 궤적이다.
  for (const dy of [-1, 0, 1]) {
    const exitY = carrier.pos.y + dy * distanceToGoal;
    // 골라인을 통과하는 위치가 골대의 세 행 밖이면 그 방향은 유효한 슛이 아니다.
    if (!GOAL_ROWS.has(exitY)) continue;

    let blocked = false;
    // 슈터의 다음 칸부터 골라인 직전까지 훑어 첫 번째 장애물을 찾는다.
    for (let distance = 1; distance < distanceToGoal; distance++) {
      if (
        pieceAt(
          state,
          carrier.pos.x + directionX * distance,
          carrier.pos.y + dy * distance,
        )
      ) {
        blocked = true;
        break;
      }
    }
    // 세 후보 중 하나만 열려 있어도 현재 상태에 즉시 슛 위협이 있다고 평가한다.
    if (!blocked) return true;
  }
  return false;
}

/**
 * `state`를 `perspective` 팀의 관점에서 평가한다.
 *
 * 반환값의 부호는 항상 관점 팀을 기준으로 한다. 따라서 대칭적인 상태라면 home 관점의
 * 값과 away 관점의 값은 서로 반대 부호가 된다. `EvalFn` 타입을 명시했으므로 매개변수와
 * 반환 타입은 각각 `GameState`, `Team`, `number`로 문맥상 추론된다.
 */
export const evalLv1: EvalFn = (state, perspective) => {
  const opponent = perspective === "home" ? "away" : "home";
  // 실제 한 골은 위치상의 작은 이점보다 항상 우선하도록 10,000점의 가치를 준다.
  let evaluation = (state.score[perspective] - state.score[opponent]) * 10_000;

  if (state.ball.kind === "held") {
    const carrierId = state.ball.pieceId;
    // 정상 GameState의 held 공은 반드시 존재하는 기물 ID를 가리킨다는 불변 조건에 의존한다.
    const carrier = state.pieces.find((piece) => piece.id === carrierId)!;

    // 공을 가진 것 자체의 가치에 상대 골대를 향해 전진한 칸마다 9점을 더한다.
    let possessionValue = 140;
    possessionValue += (carrier.team === "home" ? carrier.pos.x : 12 - carrier.pos.x) * 9;

    // 당장 막히지 않은 슛을 할 수 있는 상태는 단순 소유보다 훨씬 크게 평가한다.
    if (hasOpenShot(state, carrier)) possessionValue += 450;

    // 맨해튼 거리 1은 공 소유자의 상하좌우 한 칸에 상대 기물이 있다는 뜻이다.
    const underStealThreat = state.pieces.some(
      (piece) =>
        piece.team !== carrier.team &&
        Math.abs(piece.pos.x - carrier.pos.x) + Math.abs(piece.pos.y - carrier.pos.y) === 1,
    );
    // 이 휴리스틱은 noSteal 보호 여부와 무관하게 인접 압박 자체를 위험으로 감점한다.
    if (underStealThreat) possessionValue -= 170;

    // 관점 팀이 공을 가졌으면 소유 가치를 더하고, 상대가 가졌으면 같은 값을 뺀다.
    evaluation += carrier.team === perspective ? possessionValue : -possessionValue;
  } else {
    // loose 공은 어느 팀의 가장 가까운 기물이 먼저 도달하기 쉬운지를 비교한다.
    let homeDistance = 99;
    let awayDistance = 99;
    for (const piece of state.pieces) {
      // 두 축의 차이 중 큰 값인 체비쇼프 거리를 빠른 접근성 근사치로 사용한다.
      // 역할별 실제 이동 규칙을 적용한 정확한 최단 수는 아니므로 휴리스틱에 해당한다.
      const distance = Math.max(
        Math.abs(piece.pos.x - state.ball.pos.x),
        Math.abs(piece.pos.y - state.ball.pos.y),
      );
      // 각 팀에서 공에 가장 가까운 기물 하나의 거리만 남긴다.
      if (piece.team === "home") homeDistance = Math.min(homeDistance, distance);
      else awayDistance = Math.min(awayDistance, distance);
    }

    // home이 더 가까우면 양수, away가 더 가까우면 음수가 되며 거리 한 칸은 30점이다.
    const homeAdvantage = (awayDistance - homeDistance) * 30;
    evaluation += perspective === "home" ? homeAdvantage : -homeAdvantage;
  }

  // 공과 별개로 공격 역할이 상대 골대 쪽으로 전진한 정도를 작은 위치 보너스로 반영한다.
  for (const piece of state.pieces) {
    const progress = piece.team === "home" ? piece.pos.x : 12 - piece.pos.x;
    // FW의 전진을 가장 중시하고 MF는 절반, DF와 GK의 전진에는 보너스를 주지 않는다.
    const weight = piece.role === "FW" ? 3 : piece.role === "MF" ? 1.5 : 0;
    // 내 팀의 전진은 더하고 상대 팀의 전진은 빼서 perspective 기준 부호를 유지한다.
    evaluation += (piece.team === perspective ? 1 : -1) * progress * weight;
  }

  return evaluation;
};
