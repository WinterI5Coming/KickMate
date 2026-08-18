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

import { traceBallPath, type PathStep } from "./ballPath";
import type { GameResult, GameState, Move, MovePreview, Piece, Pos, Team } from "./types";
import { BOARD_H, BOARD_W } from "./types";

/**
 * home 팀 여섯 기물의 역할과 기본 위치.
 *
 * 같은 역할이 여러 명이므로 역할 배열과 좌표 배열을 따로 두지 않고 한 객체로 묶는다.
 * away 배치는 이 좌표를 보드 중앙 기준으로 상하·좌우 미러링해서 계산한다.
 */
const HOME_START: ReadonlyArray<{ role: Piece["role"]; pos: Pos }> = [
  { role: "GK", pos: { x: 0, y: 4 } },
  { role: "DF", pos: { x: 2, y: 2 } },
  { role: "DF", pos: { x: 2, y: 6 } },
  { role: "MF", pos: { x: 4, y: 2 } },
  { role: "MF", pos: { x: 4, y: 6 } },
  { role: "FW", pos: { x: 5, y: 4 } },
];
/** 한 팀의 기물 수이자 ID에서 팀 내부 배치 인덱스를 구할 때 사용하는 나머지 기준. */
const PIECES_PER_TEAM = HOME_START.length;

/** 사용자가 직접 선택할 수 있는 상대 골문의 위·가운데·아래 행. */
const GOAL_ROWS = [3, 4, 5] as const;

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

/** 엔진 내부에서 반드시 존재해야 하는 기물을 찾고 잘못된 Move는 즉시 드러낸다. */
function requirePiece(state: GameState, pieceId: number): Piece {
  const piece = state.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece) throw new Error(`존재하지 않는 기물 ID입니다: ${pieceId}`);
  return piece;
}

/** 두 논리 좌표가 같은 보드 칸을 가리키는지 검사한다. */
function samePos(left: Pos, right: Pos): boolean {
  return left.x === right.x && left.y === right.y;
}

/**
 * 공 경로에서 가장 먼저 접촉하는 기물을 찾는다.
 *
 * 모서리를 통과하는 한 `PathStep`에는 여러 칸이 동시에 포함될 수 있다. 그 칸들에
 * 기물이 여럿 있으면 배열 순서와 무관하게 ID가 낮은 기물을 먼저 접촉한 것으로 정해
 * 같은 상태가 언제나 같은 결과를 내게 한다.
 */
function firstPieceOnPath(state: GameState, steps: PathStep[]): Piece | undefined {
  for (const step of steps) {
    const hits = state.pieces
      .filter((piece) => step.cells.some((cell) => samePos(cell, piece.pos)))
      .sort((left, right) => left.id - right.id);
    if (hits[0]) return hits[0];
  }
  return undefined;
}

/**
 * 행동을 적용하지 않고 예상 도착점·공 경로·첫 접촉 결과를 계산한다.
 *
 * 화면과 실제 상태 전이가 이 단일 판정을 공유한다. 따라서 차단 경로를 클라이언트나
 * `applyMove()`가 별도로 다시 계산해서 서로 다른 결과를 만들지 않는다.
 */
export function previewMove(state: GameState, move: Move): MovePreview {
  if (move.kind === "move") {
    return {
      kind: "move",
      destination: { ...move.to },
      picksUpLooseBall: state.ball.kind === "loose" && samePos(state.ball.pos, move.to),
    };
  }
  if (move.kind === "steal") {
    return { kind: "steal", targetPieceId: move.targetPieceId, protectedAfter: true };
  }

  const actor = requirePiece(state, move.pieceId);
  const target =
    move.kind === "pass"
      ? requirePiece(state, move.targetPieceId).pos
      : { x: actor.team === "home" ? BOARD_W : -1, y: move.goalRow };
  const steps = traceBallPath(actor.pos, target);
  const path = steps.flatMap((step) => step.cells.map((cell) => ({ ...cell })));
  const hit = firstPieceOnPath(state, steps);

  if (move.kind === "pass") {
    const receiverPieceId = hit?.id ?? move.targetPieceId;
    return {
      kind: "pass",
      path,
      targetPieceId: move.targetPieceId,
      receiverPieceId,
      reachesTarget: receiverPieceId === move.targetPieceId,
    };
  }
  return {
    kind: "shoot",
    path,
    goalRow: move.goalRow,
    outcome: hit ? "blocked" : "goal",
    blockerPieceId: hit?.id ?? null,
  };
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
    // 양 팀이 같은 여섯 칸 순서를 공유하므로 나머지가 팀 내부 배치 인덱스가 된다.
    const start = HOME_START[piece.id % PIECES_PER_TEAM]!.pos;
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
 * home과 away에 GK 1명, DF 2명, MF 2명, FW 1명을 생성하고 away 위치는 home
 * 기본 배치를 미러링한다. 임시로 유효한 GameState를 만든 뒤 공통
 * `resetForKickoff()`를 호출해 최종적으로 첫 home MF가 센터에서 공을 소유하는
 * 0:0 선공 상태를 반환한다.
 *
 * 반환할 때마다 새 기물·좌표·점수 객체를 만들므로 서로 다른 경기 상태가 내부 객체를
 * 공유하지 않는다.
 */
export function createInitialState(): GameState {
  const pieces: Piece[] = [];

  // `as const`로 반복 변수 team을 일반 string이 아닌 `"home" | "away"`로 유지한다.
  for (const team of ["home", "away"] as const) {
    for (const start of HOME_START) {
      pieces.push({
        // 현재 배열 길이를 사용해 home 0..5, away 6..11의 안정적인 ID를 부여한다.
        id: pieces.length,
        team,
        role: start.role,
        pos:
          team === "home"
            ? { ...start.pos }
            : {
                x: BOARD_W - 1 - start.pos.x,
                y: BOARD_H - 1 - start.pos.y,
              },
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

    // DF·MF·FW는 역할과 관계없이 8방향의 인접한 빈 칸으로 한 칸 이동한다.
    for (const direction of DIRS_8) {
      const to = {
        x: piece.pos.x + direction.x,
        y: piece.pos.y + direction.y,
      };
      if (inBounds(to) && !pieceAt(state, to)) {
        moves.push({ kind: "move", pieceId: piece.id, to });
      }
    }
  }

  // 패스와 슛은 현재 차례의 팀이 공을 실제로 보유할 때만 선택할 수 있다.
  if (carrier?.team === team) {
    // 경로가 막혔더라도 거리 안의 아군은 직접 선택할 수 있고 실제 수신자는 preview가 정한다.
    for (const target of state.pieces) {
      if (target.team !== team || target.id === carrier.id) continue;
      const distance = Math.max(
        Math.abs(target.pos.x - carrier.pos.x),
        Math.abs(target.pos.y - carrier.pos.y),
      );
      if (distance <= PASS_MAX) {
        moves.push({ kind: "pass", pieceId: carrier.id, targetPieceId: target.id });
      }
    }

    const goalX = team === "home" ? BOARD_W : -1;
    const distanceToGoal = Math.abs(goalX - carrier.pos.x);
    if (distanceToGoal <= SHOT_MAX) {
      for (const goalRow of GOAL_ROWS) {
        moves.push({ kind: "shoot", pieceId: carrier.id, goalRow });
      }
    }
  }

  // 스틸은 상대가 공을 들고 있고 보호 턴이 끝난 경우에만 후보가 될 수 있다.
  if (carrier && carrier.team !== team && state.noSteal === 0) {
    for (const piece of state.pieces) {
      // 두 축 차이 중 큰 값이 1이면 상하좌우와 대각선을 포함한 주변 8칸이다.
      const distance = Math.max(
        Math.abs(piece.pos.x - carrier.pos.x),
        Math.abs(piece.pos.y - carrier.pos.y),
      );
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
  const preview = previewMove(next, move);
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
    if (preview.kind !== "pass") throw new Error("패스 미리보기 종류가 일치하지 않습니다.");
    next.ball = { kind: "held", pieceId: preview.receiverPieceId };
  } else if (move.kind === "shoot") {
    if (preview.kind !== "shoot") throw new Error("슛 미리보기 종류가 일치하지 않습니다.");
    if (preview.outcome === "blocked") {
      // 궤적 위 첫 기물이 팀과 역할에 관계없이 공을 확보하고 즉시 스틸로부터 보호받는다.
      next.ball = { kind: "held", pieceId: preview.blockerPieceId! };
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
