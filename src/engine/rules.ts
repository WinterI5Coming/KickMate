/**
 * KickMate의 초기 상태, 합법 수, 상태 전이를 구현하는 순수 룰 모듈.
 *
 * 이 파일은 `GameState → Move[]`와 `GameState + Move → GameState`라는 엔진의 핵심
 * 흐름을 담당한다. 같은 상태에는 항상 같은 순서의 수를 생성해야 탐색 결과와 블런더
 * 판정이 재현되므로 무작위 호출을 사용하지 않는다.
 *
 * DOM, Canvas, Worker, 파일시스템에는 접근하지 않는다. 브라우저 클라이언트와 Node.js
 * 셀프플레이가 동일한 규칙을 공유하기 위한 경계다.
 */

import type { GameResult, GameState, Move, Piece, Pos, Team } from "./types";
import { BOARD_H, BOARD_W } from "./types";

/**
 * home 팀의 역할별 기본 위치. 배열 인덱스는 `ROLES`와 맞물린다.
 *
 * 0: GK, 1: DF, 2: MF, 3: FW. away 배치는 이 좌표를 보드 중앙 기준으로 상하·좌우
 * 미러링해서 계산한다. 각 좌표는 기물에 할당할 때 spread로 복사해 상수가 경기 중
 * 위치 변경의 영향을 받지 않게 한다.
 */
const HOME_START: readonly Pos[] = [
  { x: 0, y: 4 },
  { x: 2, y: 4 },
  { x: 4, y: 3 },
  { x: 4, y: 5 },
];
/** `HOME_START`와 같은 인덱스를 사용하는 역할 순서. */
const ROLES: readonly Piece["role"][] = ["GK", "DF", "MF", "FW"];

/** 슛 레이가 골라인을 통과할 때 득점으로 인정되는 y 좌표 집합. */
const GOAL_ROWS = new Set([3, 4, 5]);

/** 한 방향의 패스가 진행할 수 있는 최대 칸 수. */
const PASS_MAX = 6;

/** 공 소유자에서 상대 골라인까지 슛을 시도할 수 있는 최대 x 거리. */
const SHOT_MAX = 7;

/** 한 팀이 이 점수에 먼저 도달하면 최대 ply 전에 경기를 끝낸다. */
export const WIN_SCORE = 3;

/**
 * 상하좌우와 네 대각선의 단위 변화량.
 *
 * `Pos` 타입을 재사용하지만 절대 위치가 아니라 현재 좌표에 더하는 방향 벡터다.
 * 앞의 네 원소는 직선 방향이라 DF 이동에서 `slice(0, 4)`로 재사용한다.
 */
const DIRS_8: readonly Pos[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];
/**
 * FW의 나이트 점프 변화량. 한 축으로 2칸, 다른 축으로 1칸 이동하며 중간 기물은
 * 검사하지 않고 목적지의 보드 범위와 점유 여부만 확인한다.
 */
const KNIGHT: readonly Pos[] = [
  { x: 1, y: 2 },
  { x: 2, y: 1 },
  { x: -1, y: 2 },
  { x: -2, y: 1 },
  { x: 1, y: -2 },
  { x: 2, y: -1 },
  { x: -1, y: -2 },
  { x: -2, y: -1 },
];

/**
 * 좌표가 13×9 보드의 실제 칸 안에 있는지 검사한다.
 *
 * `Pos` 타입은 x와 y가 숫자라는 사실만 보장하므로 이동 생성 시 이 런타임 검사가
 * 필요하다. 골라인 밖 x=-1, x=13은 슛 판정에만 쓰며 기물의 정상 위치는 아니다.
 */
export function inBounds(pos: Pos): boolean {
  return pos.x >= 0 && pos.x < BOARD_W && pos.y >= 0 && pos.y < BOARD_H;
}

/**
 * 지금까지 적용된 ply의 짝수·홀수로 현재 차례 팀을 계산한다.
 *
 * turn=0부터 시작해 짝수는 home, 홀수는 away다. 별도의 `currentTeam` 필드를 저장하지
 * 않아 두 상태값이 서로 어긋날 가능성을 제거한다.
 */
export function sideToMove(state: GameState): Team {
  return state.turn % 2 === 0 ? "home" : "away";
}

/** 득점 팀의 반대편, 즉 다음 킥오프를 수행할 실점 팀을 구한다. */
function otherTeam(team: Team): Team {
  return team === "home" ? "away" : "home";
}

/**
 * 현재 상태가 끝난 경기인지 계산한다.
 *
 * 종료 결과는 상태에 별도로 저장하지 않는다. 점수와 턴이라는 원본 정보에서 매번
 * 계산하면 상태 전이 중 결과 필드만 갱신하지 않는 불일치를 피할 수 있다.
 */
export function gameResult(state: GameState): GameResult | null {
  if (state.score.home >= WIN_SCORE) {
    return { kind: "win", winner: "home", reason: "scoreLimit" };
  }
  if (state.score.away >= WIN_SCORE) {
    return { kind: "win", winner: "away", reason: "scoreLimit" };
  }
  if (state.turn < state.maxTurns) return null;
  if (state.score.home > state.score.away) {
    return { kind: "win", winner: "home", reason: "turnLimit" };
  }
  if (state.score.away > state.score.home) {
    return { kind: "win", winner: "away", reason: "turnLimit" };
  }
  return { kind: "draw", reason: "turnLimit" };
}

/**
 * 지정한 보드 칸을 점유한 첫 기물을 찾는다.
 *
 * 정상 `GameState`에서는 한 칸에 기물이 하나만 존재한다. 빈 칸이면 `undefined`를
 * 반환하며, 이동 경로 차단·패스 접촉·슛 선방 판정이 이 함수를 공유한다.
 */
function pieceAt(state: GameState, pos: Pos): Piece | undefined {
  return state.pieces.find((piece) => piece.pos.x === pos.x && piece.pos.y === pos.y);
}

/**
 * 좌표가 해당 팀의 골키퍼 박스 형태에 속하는지 검사한다.
 *
 * 공통 세로 범위는 y=2..6이고 home은 x≤1, away는 x≥11이다. 이 함수만으로는 x의
 * 보드 범위를 완전히 제한하지 않으므로 실제 GK 이동 생성에서는 `inBounds()`와 함께
 * 사용해야 한다.
 */
function inGoalkeeperBox(team: Team, pos: Pos): boolean {
  const inRows = pos.y >= 2 && pos.y <= 6;
  return inRows && (team === "home" ? pos.x <= 1 : pos.x >= 11);
}

/**
 * 전달받은 상태를 지정 팀의 킥오프 배치로 되돌린다.
 *
 * 모든 기물을 역할별 기본 위치로 복원한 뒤 킥오프 팀 MF를 센터 `(6,4)`로 옮기고
 * 공을 소유시킨다. 이전 수의 스틸 보호는 새 킥오프에 이어지지 않으므로 `noSteal`도
 * 0으로 초기화한다.
 *
 * 이 내부 함수는 전달받은 객체를 직접 수정한다. 외부 상태의 불변성은 호출자가 새로
 * 만든 상태 또는 `cloneState()`가 만든 복제본만 전달함으로써 지킨다.
 */
function resetForKickoff(state: GameState, team: Team): void {
  for (const piece of state.pieces) {
    // ID 0..3과 4..7이 같은 역할 순서를 공유하므로 나머지가 역할 인덱스가 된다.
    const start = HOME_START[piece.id % 4]!;
    piece.pos =
      piece.team === "home"
        // 초기 배치 객체를 기물과 공유하지 않도록 새 좌표로 복사한다.
        ? { ...start }
        // away는 유효한 최대 좌표 (12,8)를 기준으로 상하·좌우를 모두 뒤집는다.
        : { x: BOARD_W - 1 - start.x, y: BOARD_H - 1 - start.y };
  }

  // 정상 상태에는 각 팀 MF가 정확히 하나 존재한다는 룰 불변 조건에 의존한다.
  const midfielder = state.pieces.find((piece) => piece.team === team && piece.role === "MF")!;
  midfielder.pos = { x: 6, y: 4 };
  // 소유 중인 공은 별도 좌표 대신 소유 기물 ID로 위치를 표현한다.
  state.ball = { kind: "held", pieceId: midfielder.id };
  state.noSteal = 0;
}

/**
 * 새 경기의 완전한 초기 `GameState`를 만든다.
 *
 * home과 away에 GK/DF/MF/FW를 하나씩 생성하고 away 위치는 home 기본 배치를
 * 미러링한다. 임시로 유효한 GameState를 만든 뒤 공통 `resetForKickoff()`를 호출해
 * 최종적으로 home MF가 센터에서 공을 소유하는 0:0 선공 상태를 반환한다.
 *
 * 반환할 때마다 새 기물·좌표·점수 객체를 만들므로 서로 다른 경기 상태가 내부 객체를
 * 공유하지 않는다.
 */
export function createInitialState(): GameState {
  const pieces: Piece[] = [];

  // `as const`로 반복 변수 team을 일반 string이 아닌 `"home" | "away"`로 유지한다.
  for (const team of ["home", "away"] as const) {
    for (let roleIndex = 0; roleIndex < ROLES.length; roleIndex++) {
      const start = HOME_START[roleIndex]!;
      pieces.push({
        // 현재 배열 길이를 사용해 home 0..3, away 4..7의 안정적인 ID를 부여한다.
        id: pieces.length,
        team,
        role: ROLES[roleIndex]!,
        pos:
          team === "home"
            ? { ...start }
            : { x: BOARD_W - 1 - start.x, y: BOARD_H - 1 - start.y },
      });
    }
  }

  const state: GameState = {
    turn: 0,
    maxTurns: 60,
    pieces,
    // 먼저 타입상 완전한 상태를 만든 뒤 아래 킥오프 함수가 held 상태로 교체한다.
    ball: { kind: "loose", pos: { x: 6, y: 4 } },
    noSteal: 0,
    score: { home: 0, away: 0 },
  };

  // 경기 시작은 항상 home 킥오프다.
  resetForKickoff(state, "home");
  return state;
}

/**
 * 현재 차례의 팀이 선택할 수 있는 모든 합법 수를 일정한 순서로 생성한다.
 *
 * 이 함수는 상태를 변경하지 않으며, 같은 상태에는 항상 같은 순서의 수 목록을 반환한다.
 * 먼저 각 기물의 일반 이동을 만들고, 공을 가진 팀이라면 패스와 슛을, 상대가 공을
 * 가졌다면 조건에 맞는 스틸을 추가한다. 이 결정적인 순서는 탐색 결과와 테스트를
 * 재현할 수 있게 하는 엔진의 중요한 성질이다.
 *
 * 3골 선취 또는 `turn >= maxTurns`인 상태는 경기가 끝난 것으로 취급하므로 가능한 수가 없다.
 */
export function legalMoves(state: GameState): Move[] {
  if (gameResult(state) !== null) return [];

  const team = sideToMove(state);
  const moves: Move[] = [];
  // loose 공에는 소유자가 없으므로 carrier도 undefined가 된다.
  const carrierId = state.ball.kind === "held" ? state.ball.pieceId : undefined;
  const carrier = state.pieces.find((piece) => piece.id === carrierId);

  // 공의 소유 여부와 무관하게 현재 팀의 모든 기물이 일반 이동을 할 수 있다.
  for (const piece of state.pieces) {
    if (piece.team !== team) continue;

    if (piece.role === "GK") {
      // GK는 8방향 한 칸 중 자기 골키퍼 박스 안의 빈 칸으로만 이동한다.
      for (const direction of DIRS_8) {
        const to = { x: piece.pos.x + direction.x, y: piece.pos.y + direction.y };
        if (inBounds(to) && inGoalkeeperBox(team, to) && !pieceAt(state, to)) {
          moves.push({ kind: "move", pieceId: piece.id, to });
        }
      }
      continue;
    }

    if (piece.role === "FW") {
      // FW는 체스의 나이트처럼 뛰므로 중간 칸의 기물은 이동을 막지 않는다.
      for (const direction of KNIGHT) {
        const to = { x: piece.pos.x + direction.x, y: piece.pos.y + direction.y };
        if (inBounds(to) && !pieceAt(state, to)) {
          moves.push({ kind: "move", pieceId: piece.id, to });
        }
      }
      continue;
    }

    // DF는 직선 4방향, MF는 대각선을 포함한 8방향으로 최대 두 칸 미끄러진다.
    const directions = piece.role === "DF" ? DIRS_8.slice(0, 4) : DIRS_8;
    for (const direction of directions) {
      for (let distance = 1; distance <= 2; distance++) {
        const to = {
          x: piece.pos.x + direction.x * distance,
          y: piece.pos.y + direction.y * distance,
        };
        // 미끄러지는 기물은 보드 밖이나 다른 기물을 뛰어넘을 수 없다.
        if (!inBounds(to) || pieceAt(state, to)) break;
        moves.push({ kind: "move", pieceId: piece.id, to });
      }
    }
  }

  // 패스와 슛은 현재 차례의 팀이 공을 실제로 보유할 때만 선택할 수 있다.
  if (carrier?.team === team) {
    for (const direction of DIRS_8) {
      // 해당 방향에서 아무 기물도 만나지 않았을 때 공이 도달할 마지막 빈 칸이다.
      let lastEmpty: Pos | undefined;
      let contacted = false;
      for (let distance = 1; distance <= PASS_MAX; distance++) {
        const to = {
          x: carrier.pos.x + direction.x * distance,
          y: carrier.pos.y + direction.y * distance,
        };
        if (!inBounds(to)) break;
        const hit = pieceAt(state, to);
        if (hit) {
          // 가장 먼저 만난 아군에게만 패스할 수 있다. 상대 기물은 패스 길을 막는다.
          if (hit.team === team) {
            moves.push({ kind: "pass", pieceId: carrier.id, to: { ...to } });
          }
          contacted = true;
          break;
        }
        lastEmpty = to;
      }
      // 제한 거리 안에 기물이 전혀 없다면 마지막 빈 칸으로 loose 패스를 보낼 수 있다.
      if (!contacted && lastEmpty) {
        moves.push({ kind: "pass", pieceId: carrier.id, to: lastEmpty });
      }
    }

    const goalX = team === "home" ? BOARD_W : -1;
    const distanceToGoal = Math.abs(goalX - carrier.pos.x);
    if (distanceToGoal <= SHOT_MAX) {
      // dy는 슛 궤적의 세로 변화량이다: -1은 위 대각선, 0은 직선, 1은 아래 대각선.
      for (const dy of [-1, 0, 1] as const) {
        const exitY = carrier.pos.y + dy * distanceToGoal;
        // 골라인을 통과하는 y가 골대의 세 행 중 하나일 때만 유효한 슛이다.
        if (GOAL_ROWS.has(exitY)) {
          moves.push({ kind: "shoot", pieceId: carrier.id, dy });
        }
      }
    }
  }

  // 스틸은 상대가 공을 들고 있고 보호 턴이 끝난 경우에만 후보가 될 수 있다.
  if (carrier && carrier.team !== team && state.noSteal === 0) {
    for (const piece of state.pieces) {
      // 맨해튼 거리 1은 대각선을 제외한 상하좌우 한 칸 인접을 뜻한다.
      const distance =
        Math.abs(piece.pos.x - carrier.pos.x) + Math.abs(piece.pos.y - carrier.pos.y);
      if (piece.team === team && distance === 1) {
        moves.push({
          kind: "steal",
          pieceId: piece.id,
          targetPieceId: carrier.id,
        });
      }
    }
  }

  return moves;
}

/**
 * 상태 전이 중 원본 `GameState`를 건드리지 않도록 변경 가능한 내부 객체까지 복제한다.
 *
 * 최상위 spread만 사용하면 `pieces`, 각 `piece.pos`, loose 공의 `pos`, `score`가 원본과
 * 공유된다. `applyMove()`가 이 값을 수정하므로 해당 단계까지 새 객체로 만들어야 한다.
 * 숫자와 문자열, held 공의 `pieceId`처럼 원시 값만 담은 부분은 얕은 복제로 충분하다.
 */
function cloneState(state: GameState): GameState {
  return {
    ...state,
    pieces: state.pieces.map((piece) => ({ ...piece, pos: { ...piece.pos } })),
    ball:
      state.ball.kind === "held"
        ? { ...state.ball }
        : { kind: "loose", pos: { ...state.ball.pos } },
    score: { ...state.score },
  };
}

/**
 * 하나의 합법 수를 적용한 다음 경기 상태를 반환하며 입력 상태는 변경하지 않는다.
 *
 * 호출자는 `legalMoves()`가 만든 수를 전달해야 한다. 이 함수는 존재하지 않는 기물,
 * 잘못된 패스 대상 같은 불법 입력을 다시 검증하지 않는다. 일반적인 전이에서는 마지막에
 * turn을 한 번 증가시키며, 득점은 킥오프 초기화 뒤 조기 반환하여 중복 증가를 피한다.
 */
export function applyMove(state: GameState, move: Move): GameState {
  const next = cloneState(state);
  const team = sideToMove(next);
  // 직전 스틸이나 선방으로 생긴 보호 턴은 한 차례가 적용될 때마다 소모된다.
  next.noSteal = Math.max(0, next.noSteal - 1);

  if (move.kind === "move") {
    const piece = next.pieces.find((candidate) => candidate.id === move.pieceId)!;
    piece.pos = { ...move.to };
    // held 공은 좌표 대신 소유 기물 ID를 가리키므로 소유자가 움직이면 함께 이동한 셈이다.
    if (next.ball.kind === "held" && next.ball.pieceId === piece.id) {
      next.ball = { kind: "held", pieceId: piece.id };
    } else if (
      next.ball.kind === "loose" &&
      next.ball.pos.x === move.to.x &&
      next.ball.pos.y === move.to.y
    ) {
      // loose 공이 놓인 칸으로 이동한 기물은 즉시 공의 새 소유자가 된다.
      next.ball = { kind: "held", pieceId: piece.id };
    }
  } else if (move.kind === "pass") {
    // 기물이 있는 목적지는 소유권 이전, 빈 목적지는 좌표를 가진 loose 공이 된다.
    const receiver = pieceAt(next, move.to);
    next.ball = receiver
      ? { kind: "held", pieceId: receiver.id }
      : { kind: "loose", pos: { ...move.to } };
  } else if (move.kind === "shoot") {
    const shooter = next.pieces.find((piece) => piece.id === move.pieceId)!;
    const directionX = team === "home" ? 1 : -1;
    const goalX = team === "home" ? BOARD_W : -1;
    const distanceToGoal = Math.abs(goalX - shooter.pos.x);
    let saver: Piece | undefined;
    // 슈터 다음 칸부터 골라인 직전까지 궤적을 훑어 가장 먼저 만난 기물을 찾는다.
    for (let distance = 1; distance < distanceToGoal; distance++) {
      saver = pieceAt(next, {
        x: shooter.pos.x + directionX * distance,
        y: shooter.pos.y + move.dy * distance,
      });
      if (saver) break;
    }

    if (saver) {
      // 궤적 위 첫 기물이 팀과 역할에 관계없이 공을 확보하고 즉시 스틸로부터 보호받는다.
      next.ball = { kind: "held", pieceId: saver.id };
      next.noSteal = 1;
    } else {
      // 아무도 막지 못하면 득점하고 상대 팀이 센터에서 공을 갖도록 재배치한다.
      next.score[team] += 1;
      next.turn += 1;
      resetForKickoff(next, otherTeam(team));
      return next;
    }
  } else {
    // 앞의 kind들을 제외하면 타입상 steal이며, 성공 확률 판정 없이 소유권이 이동한다.
    next.ball = { kind: "held", pieceId: move.pieceId };
    // 바로 다음 상대 차례에는 방금 빼앗긴 공을 즉시 재스틸할 수 없다.
    next.noSteal = 1;
  }

  next.turn += 1;
  return next;
}
