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

import { traceBallPath } from "./ballPath";
import {
  attackDirection,
  BASE_ZONE_INTERCEPT,
  passMaxBetween,
  passZoneInterceptChance,
  TACTICS,
} from "./tactics";
import type {
  GameResult,
  GameState,
  Move,
  MoveOutcome,
  MovePreview,
  Piece,
  Pos,
  Team,
  TeamStyle,
} from "./types";
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

// 패스 최대 거리는 팀 전술이 정한다. `tactics.ts`의 `passMaxBetween()`을 사용한다.

/** 공 소유자에서 상대 골라인까지 슛을 시도할 수 있는 최대 x 거리. */
export const SHOT_MAX = 7;

/** 팀마다 받을 행동 수와 한 기물의 팀 턴당 행동 상한. */
const ACTIONS_PER_TEAM_TURN = 3;
const ACTIONS_PER_PIECE = 2;

/**
 * M2.6B 확률 판정 상수. 모두 [실험 중]이며 밸런스 측정으로 조정한다.
 *
 * 판정은 무작위가 아니라 상태·수 해시 시드로 결과를 고르므로 같은 국면의 같은 수는
 * 언제나 같은 결과를 재현한다. 탐색은 결과를 미리 알지 못하도록 기대값으로 평가한다.
 */
/** 슛 경로 위에 서 있는 상대 필드 선수가 공을 차단할 확률. */
const SHOT_FIELD_BLOCK_CHANCE = 0.65;
/** 슛 경로 위에 서 있는 상대 GK가 공을 선방할 확률. */
const SHOT_GK_SAVE_CHANCE = 0.75;
/** 슛 정확도가 1을 유지하는 골라인까지의 최대 x거리. */
const SHOT_ACCURATE_RANGE = 3;
/** 정확 사거리를 넘는 칸마다 감소하는 슛 정확도. */
const SHOT_ACCURACY_FALLOFF = 0.15;
/** 장거리 슛 정확도의 하한. */
const SHOT_ACCURACY_FLOOR = 0.4;

/**
 * 슈터와 골라인 x거리에 따른 슛 정확도(과녁 안에 들어갈 확률).
 *
 * 3칸 이내는 1이고 이후 칸마다 0.15씩 감소해 7칸에서 0.4가 된다. 하프라인 저격 대신
 * 전진 빌드업을 강제하려는 [실험 중] 수치다. 빗나간 슛은 골킥으로 상대 GK가 소유한다.
 */
function shotAccuracy(distanceToGoal: number): number {
  return Math.max(
    SHOT_ACCURACY_FLOOR,
    Math.min(1, 1 - SHOT_ACCURACY_FALLOFF * (distanceToGoal - SHOT_ACCURATE_RANGE)),
  );
}
// 영향권 개입 확률: 슛은 tactics.ts의 BASE_ZONE_INTERCEPT를 그대로 쓰고,
// 패스는 양 팀 전술 보정을 합산한 passZoneInterceptChance()를 쓴다.

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
 * 현재 팀 턴의 실행 팀을 반환한다.
 */
export function sideToMove(state: GameState): Team {
  return state.activeTeam;
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

/** 공 소유자가 상대 기물의 주변 8칸 안에 있어 즉시 움직일 수 없는지 판정한다. */
export function isPressured(state: GameState, pieceId: number): boolean {
  const piece = requirePiece(state, pieceId);
  return state.pieces.some(
    (candidate) =>
      candidate.team !== piece.team &&
      Math.max(
        Math.abs(candidate.pos.x - piece.pos.x),
        Math.abs(candidate.pos.y - piece.pos.y),
      ) === 1,
  );
}

/** 두 칸의 8방향 인접 규칙과 같은 체비쇼프 거리를 계산한다. */
function chebyshevDistance(left: Pos, right: Pos): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

/** 현재 행동 팀이 지정 공 소유자에게서 공을 빼앗을 수 없도록 보호되었는지 판정한다. */
export function isStealProtected(
  state: GameState,
  carrierId: number,
  attackingTeam: Team,
): boolean {
  const carrier = requirePiece(state, carrierId);
  const adjacentAttackers = state.pieces.filter(
    (piece) =>
      piece.team === attackingTeam && chebyshevDistance(piece.pos, carrier.pos) === 1,
  ).length;
  return (
    state.stealProtection?.pieceId === carrierId &&
    state.stealProtection.blockedTeam === attackingTeam &&
    adjacentAttackers < 2
  );
}

/** 공이 보호 대상에게 남아 있지 않으면 더 이상 보호를 유지하지 않는다. */
function clearProtectionIfCarrierChanged(state: GameState): void {
  if (
    state.stealProtection &&
    (state.ball.kind !== "held" || state.ball.pieceId !== state.stealProtection.pieceId)
  ) {
    state.stealProtection = null;
  }
}

/** 상대에게서 직접 소유권을 얻은 기물에 한 행동의 회수 유예를 부여한다. */
function protectNewCarrier(state: GameState, pieceId: number, blockedTeam: Team): void {
  state.stealProtection = {
    pieceId,
    blockedTeam,
    blockedActionsRemaining: 1,
  };
}

/** 두 논리 좌표가 같은 보드 칸을 가리키는지 검사한다. */
function samePos(left: Pos, right: Pos): boolean {
  return left.x === right.x && left.y === right.y;
}

/**
 * 공 경로에 개입할 수 있는 한 번의 확률 관문.
 *
 * `onPath`는 공이 지나는 칸을 직접 점유한 상대의 강한 개입이고, `zone`은 경로 칸에
 * 8방향으로 인접한 상대의 약한 개입이다. 관문은 경로 진행 순서대로 평가하며, 한 기물은
 * 한 번의 공 이동에서 최대 한 번만 개입을 시도한다.
 */
interface BallGate {
  piece: Piece;
  chance: number;
  kind: "onPath" | "zone";
}

/** 패스·슛이 공유하는 경로 기하와 확률 관문 분석 결과. */
interface BallMoveAnalysis {
  path: Pos[];
  gates: BallGate[];
  /** 패스에서 경로가 처음 접촉하는 기물. 슛에서는 사용하지 않는다. */
  receiver: Piece | undefined;
}

/** 슛 경로 위 상대의 역할에 따른 차단 확률을 반환한다. */
function shotBlockChance(piece: Piece): number {
  return piece.role === "GK" ? SHOT_GK_SAVE_CHANCE : SHOT_FIELD_BLOCK_CHANCE;
}

/**
 * 공 이동 한 번의 경로 칸과 확률 관문을 진행 순서대로 수집한다.
 *
 * 각 `PathStep`에서 그 칸들에 인접한 상대의 영향권 개입을 먼저 두고, 이어서 칸을 직접
 * 점유한 기물을 처리한다. 패스는 팀과 무관한 첫 점유 기물이 수신자가 되어 경로가 끝나고,
 * 슛은 상대 점유자를 확률 관문으로 두고 아군은 통과한다. 같은 시점의 후보가 여럿이면
 * ID 오름차순으로 정렬해 같은 상태에 언제나 같은 관문 순서를 만든다.
 */
function analyzeBallMove(
  state: GameState,
  actor: Piece,
  move: Extract<Move, { kind: "pass" } | { kind: "shoot" }>,
): BallMoveAnalysis {
  const target =
    move.kind === "pass"
      ? requirePiece(state, move.targetPieceId).pos
      : { x: actor.team === "home" ? BOARD_W : -1, y: move.goalRow };
  const steps = traceBallPath(actor.pos, target);
  const path = steps.flatMap((step) => step.cells.map((cell) => ({ ...cell })));

  // 경로 칸을 직접 점유한 기물은 자기 칸에서 처리하므로 영향권 개입 후보에서 제외한다.
  const onPathIds = new Set<number>(
    state.pieces
      .filter((piece) => path.some((cell) => samePos(cell, piece.pos)))
      .map((piece) => piece.id),
  );
  const attempted = new Set<number>([actor.id]);
  const gates: BallGate[] = [];
  // 패스 영향권은 패서(티키타카 -5%)와 수비(게겐프레싱 +5%) 전술 보정을 합산한다.
  const zoneChance =
    move.kind === "pass"
      ? passZoneInterceptChance(
          state.teamStyles[actor.team],
          state.teamStyles[otherTeam(actor.team)],
        )
      : BASE_ZONE_INTERCEPT;

  for (const step of steps) {
    // 이 시점의 경로 칸에 인접한 상대의 영향권 개입을 점유 접촉보다 먼저 평가한다.
    const zonePieces = state.pieces
      .filter(
        (piece) =>
          piece.team !== actor.team &&
          !attempted.has(piece.id) &&
          !onPathIds.has(piece.id) &&
          step.cells.some((cell) => chebyshevDistance(cell, piece.pos) === 1),
      )
      .sort((left, right) => left.id - right.id);
    for (const piece of zonePieces) {
      attempted.add(piece.id);
      gates.push({ piece, chance: zoneChance, kind: "zone" });
    }

    const occupants = state.pieces
      .filter((piece) => step.cells.some((cell) => samePos(cell, piece.pos)))
      .sort((left, right) => left.id - right.id);
    if (move.kind === "pass") {
      // 패스는 팀·역할과 관계없이 처음 점유 기물이 공을 받으며 경로가 끝난다.
      if (occupants[0]) return { path, gates, receiver: occupants[0] };
      continue;
    }
    for (const piece of occupants) {
      // 슛은 아군을 통과하고 상대 점유자만 역할별 확률 관문이 된다.
      if (piece.team !== actor.team && !attempted.has(piece.id)) {
        attempted.add(piece.id);
        gates.push({ piece, chance: shotBlockChance(piece), kind: "onPath" });
      }
    }
  }
  return { path, gates, receiver: undefined };
}

/**
 * 필드 차단 뒤 슈터에게서 먼 빈 인접 칸을 결정적으로 고른다.
 *
 * 슛을 막은 팀이 세컨볼 회수에서 우위를 갖도록 공은 수비 진영 쪽으로 튄다.
 */
function reboundPosition(state: GameState, blocker: Piece, shooter: Piece): Pos | null {
  return (
    DIRS_8.map((direction) => ({
      x: blocker.pos.x + direction.x,
      y: blocker.pos.y + direction.y,
    }))
      .filter((pos) => inBounds(pos) && !pieceAt(state, pos))
      .sort((left, right) => {
        const leftDistance = (left.x - shooter.pos.x) ** 2 + (left.y - shooter.pos.y) ** 2;
        const rightDistance =
          (right.x - shooter.pos.x) ** 2 + (right.y - shooter.pos.y) ** 2;
        return rightDistance - leftDistance || left.y - right.y || left.x - right.x;
      })[0] ?? null
  );
}

/**
 * 탈취 관성: 소유권을 빼앗은 기물을 상대에게서 가장 멀어지는 인접 빈 칸으로 한 칸 밀어낸다.
 *
 * 공을 되찾은 직후 상대에게 인접해 압박·재포위당하는 문제를 줄인다. 행동을 소비하지
 * 않는 자동 이동이므로 결정론을 위해 후보 정렬(거리 내림차순, y, x)을 고정하고, 더
 * 멀어지는 칸이 없으면 움직이지 않는다. GK는 자기 박스 안에서만 밀려난다.
 */
function applyMomentumEscape(state: GameState, pieceId: number): void {
  const piece = requirePiece(state, pieceId);
  const opponents = state.pieces.filter((candidate) => candidate.team !== piece.team);
  if (opponents.length === 0) return;
  const nearestOpponent = (pos: Pos) =>
    Math.min(...opponents.map((opponent) => chebyshevDistance(pos, opponent.pos)));

  const current = nearestOpponent(piece.pos);
  const escape = DIRS_8.map((direction) => ({
    x: piece.pos.x + direction.x,
    y: piece.pos.y + direction.y,
  }))
    .filter(
      (pos) =>
        inBounds(pos) &&
        !pieceAt(state, pos) &&
        (piece.role !== "GK" || inGoalkeeperBox(piece.team, pos)),
    )
    .map((pos) => ({ pos, distance: nearestOpponent(pos) }))
    .filter((candidate) => candidate.distance > current)
    .sort(
      (left, right) =>
        right.distance - left.distance ||
        left.pos.y - right.pos.y ||
        left.pos.x - right.pos.x,
    )[0];
  if (escape) piece.pos = { ...escape.pos };
}

/**
 * 평가 함수 전용의 빠른 최고 슛 득점 확률.
 *
 * `previewMove()`와 같은 관문 규칙(정확도 × 경로 위 개입 × 영향권 개입)을 계산하지만,
 * 탐색 말단마다 호출되므로 경로 객체·정렬·집합 할당 없이 12비트 마스크와 격자 조회로
 * 처리한다. 반환값은 세 골문 행 중 가장 높은 득점 확률(0..1)이다.
 */
export function bestShotGoalChance(state: GameState, carrier: Piece): number {
  const goalX = carrier.team === "home" ? BOARD_W : -1;
  const distanceToGoal = Math.abs(goalX - carrier.pos.x);
  if (distanceToGoal > SHOT_MAX) return 0;
  const accuracy = shotAccuracy(distanceToGoal);

  // 칸 → 기물 인덱스 격자(없으면 -1). 한 호출에서 세 행이 공유한다.
  const grid = new Int8Array(BOARD_W * BOARD_H).fill(-1);
  for (let index = 0; index < state.pieces.length; index += 1) {
    const pos = state.pieces[index]!.pos;
    grid[pos.y * BOARD_W + pos.x] = index;
  }

  let best = 0;
  for (const goalRow of GOAL_ROWS) {
    // traceBallPath와 같은 정수 스텝으로 경로 칸을 수집한다(최대 여유 32칸).
    const cellXs: number[] = [];
    const cellYs: number[] = [];
    const deltaX = goalX - carrier.pos.x;
    const deltaY = goalRow - carrier.pos.y;
    const horizontalSteps = Math.abs(deltaX);
    const verticalSteps = Math.abs(deltaY);
    const directionX = Math.sign(deltaX);
    const directionY = Math.sign(deltaY);
    let horizontalIndex = 0;
    let verticalIndex = 0;
    while (horizontalIndex < horizontalSteps || verticalIndex < verticalSteps) {
      const decision =
        (1 + 2 * horizontalIndex) * verticalSteps -
        (1 + 2 * verticalIndex) * horizontalSteps;
      if (decision === 0) {
        cellXs.push(carrier.pos.x + (horizontalIndex + 1) * directionX);
        cellYs.push(carrier.pos.y + verticalIndex * directionY);
        cellXs.push(carrier.pos.x + horizontalIndex * directionX);
        cellYs.push(carrier.pos.y + (verticalIndex + 1) * directionY);
        horizontalIndex += 1;
        verticalIndex += 1;
      } else if (decision < 0) {
        horizontalIndex += 1;
      } else {
        verticalIndex += 1;
      }
      cellXs.push(carrier.pos.x + horizontalIndex * directionX);
      cellYs.push(carrier.pos.y + verticalIndex * directionY);
    }

    // 경로 점유 기물 마스크를 먼저 만들고(영향권 제외 대상), 관문을 곱한다.
    let onPathMask = 0;
    for (let cell = 0; cell < cellXs.length; cell += 1) {
      const x = cellXs[cell]!;
      const y = cellYs[cell]!;
      if (x < 0 || x >= BOARD_W || y < 0 || y >= BOARD_H) continue;
      const occupant = grid[y * BOARD_W + x]!;
      if (occupant >= 0) onPathMask |= 1 << occupant;
    }

    let through = accuracy;
    let attemptedMask = 1 << state.pieces.indexOf(carrier);
    for (let cell = 0; cell < cellXs.length; cell += 1) {
      const x = cellXs[cell]!;
      const y = cellYs[cell]!;
      if (x < 0 || x >= BOARD_W || y < 0 || y >= BOARD_H) continue;
      // 영향권: 이 칸에 인접한, 경로 밖의 상대 기물.
      for (let index = 0; index < state.pieces.length; index += 1) {
        const bit = 1 << index;
        if (attemptedMask & bit || onPathMask & bit) continue;
        const piece = state.pieces[index]!;
        if (piece.team === carrier.team) continue;
        if (
          Math.max(Math.abs(piece.pos.x - x), Math.abs(piece.pos.y - y)) === 1
        ) {
          attemptedMask |= bit;
          through *= 1 - BASE_ZONE_INTERCEPT;
        }
      }
      // 경로 위 점유 상대의 강한 개입.
      const occupant = grid[y * BOARD_W + x]!;
      if (occupant >= 0 && !(attemptedMask & (1 << occupant))) {
        const piece = state.pieces[occupant]!;
        if (piece.team !== carrier.team) {
          attemptedMask |= 1 << occupant;
          through *= 1 - shotBlockChance(piece);
        }
      }
    }
    if (through > best) best = through;
  }
  return best;
}

/**
 * 행동을 적용하지 않고 예상 도착점·공 경로·첫 접촉 결과를 계산한다.
 *
 * 화면과 실제 상태 전이가 이 단일 판정을 공유한다. 따라서 차단 경로를 클라이언트나
 * `applyMove()`가 별도로 다시 계산해서 서로 다른 결과를 만들지 않는다.
 */
export function previewMove(state: GameState, move: Move): MovePreview {
  if (move.kind === "hold") return { kind: "hold" };
  if (move.kind === "endTurn") return { kind: "endTurn" };
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
  const analysis = analyzeBallMove(state, actor, move);
  // 관문을 모두 통과할 확률은 각 개입 실패 확률의 곱이다.
  const throughChance = analysis.gates.reduce((acc, gate) => acc * (1 - gate.chance), 1);

  if (move.kind === "pass") {
    // 패스는 아군도 포함해 처음 만난 모든 기물에게 공이 닿는다.
    const receiverPieceId = analysis.receiver?.id ?? move.targetPieceId;
    return {
      kind: "pass",
      path: analysis.path,
      targetPieceId: move.targetPieceId,
      receiverPieceId,
      reachesTarget: receiverPieceId === move.targetPieceId,
      arrivalChance: throughChance,
    };
  }
  // 대표 차단 결과는 경로에서 가장 먼저 개입할 수 있는 상대가 만든다.
  const blocker = analysis.gates[0]?.piece;
  const reboundPos =
    blocker && blocker.role !== "GK" ? reboundPosition(state, blocker, actor) : null;
  // 득점 확률 = 거리 정확도 × 모든 개입 실패 확률.
  const accuracy = shotAccuracy(
    Math.abs((actor.team === "home" ? BOARD_W : -1) - actor.pos.x),
  );
  return {
    kind: "shoot",
    path: analysis.path,
    goalRow: move.goalRow,
    outcome:
      blocker === undefined
        ? "goal"
        : blocker.role === "GK"
          ? "goalkeeperSave"
          : reboundPos === null
            ? "fieldPossession"
            : "fieldRebound",
    blockerPieceId: blocker?.id ?? null,
    reboundPos,
    goalChance: accuracy * throughChance,
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
 * 공을 소유시킨다. 득점 뒤에는 실점 팀의 새 3행동 턴을 구성하므로 행동·보호 상태도
 * 함께 초기화한다.
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
  // 센터서클 규칙: 상대 FW는 킥오프 때 한 칸 물러난다. 킥오프 소유자가 시작부터
  // 압박당해 킥오프 자체가 불리해지는 선공 페널티를 없애기 위한 규칙이다.
  const opposingForward = state.pieces.find(
    (piece) => piece.team !== team && piece.role === "FW",
  )!;
  opposingForward.pos = {
    x: opposingForward.pos.x - attackDirection(opposingForward.team),
    y: opposingForward.pos.y,
  };
  // 소유 중인 공은 별도 좌표 대신 소유 기물 ID로 위치를 표현한다.
  state.ball = { kind: "held", pieceId: midfielder.id };
  state.activeTeam = team;
  state.actionsRemaining = ACTIONS_PER_TEAM_TURN;
  state.actionCountByPiece = {};
  state.heldFirmPieceId = null;
  state.stealProtection = null;
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
export function createInitialState(
  styles?: Partial<Record<Team, TeamStyle>>,
): GameState {
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
    activeTeam: "home",
    actionsRemaining: ACTIONS_PER_TEAM_TURN,
    actionCountByPiece: {},
    heldFirmPieceId: null,
    teamStyles: {
      home: styles?.home ?? "balanced",
      away: styles?.away ?? "balanced",
    },
    pieces,
    // 먼저 타입상 완전한 상태를 만든 뒤 아래 킥오프 함수가 held 상태로 교체한다.
    ball: { kind: "loose", pos: { x: 6, y: 4 } },
    stealProtection: null,
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
  if (gameResult(state) !== null || state.actionsRemaining === 0) return [];

  const team = sideToMove(state);
  const moves: Move[] = [];
  // loose 공에는 소유자가 없으므로 carrier도 undefined가 된다.
  const carrierId = state.ball.kind === "held" ? state.ball.pieceId : undefined;
  const carrier = state.pieces.find((piece) => piece.id === carrierId);

  // 공의 소유 여부와 무관하게 현재 팀의 모든 기물이 일반 이동을 할 수 있다.
  for (const piece of state.pieces) {
    if (piece.team !== team || (state.actionCountByPiece[piece.id] ?? 0) >= ACTIONS_PER_PIECE) {
      continue;
    }

    if (
      piece.id === carrierId &&
      isPressured(state, piece.id) &&
      state.heldFirmPieceId !== piece.id
    ) {
      continue;
    }

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

    // 전술 대시: 중간 칸과 목적지가 모두 비어 있어야 직선 2칸을 달릴 수 있다.
    const profile = TACTICS[state.teamStyles[team]];
    const dashDirections: Pos[] = [];
    if (profile.forwardDash && piece.role === "FW" && piece.id !== carrierId) {
      // 역습: 공이 없는 FW가 공격 방향(직진·전방 대각)으로 2칸 대시한다.
      const forwardX = attackDirection(team);
      for (const dy of [-1, 0, 1]) dashDirections.push({ x: forwardX, y: dy });
    }
    if (
      profile.pressDash &&
      carrier &&
      carrier.team !== team &&
      // 압박 대시는 캐리어 주변 4칸 이내의 선수만 쓴다. 공에서 먼 선수까지 대시하면
      // 탐색 분기가 폭발하고, 압박은 공 주변의 국지 행동이라는 의도와도 어긋난다.
      chebyshevDistance(piece.pos, carrier.pos) <= 4
    ) {
      // 게겐프레싱: 상대 공 소유자에게 가까워지는 방향으로만 2칸 대시한다.
      for (const direction of DIRS_8) dashDirections.push(direction);
    }
    for (const direction of dashDirections) {
      const mid = { x: piece.pos.x + direction.x, y: piece.pos.y + direction.y };
      const to = { x: piece.pos.x + direction.x * 2, y: piece.pos.y + direction.y * 2 };
      if (!inBounds(mid) || !inBounds(to) || pieceAt(state, mid) || pieceAt(state, to)) {
        continue;
      }
      if (
        profile.pressDash &&
        carrier &&
        carrier.team !== team &&
        chebyshevDistance(to, carrier.pos) >= chebyshevDistance(piece.pos, carrier.pos)
      ) {
        continue;
      }
      moves.push({ kind: "move", pieceId: piece.id, to });
    }
  }

  // 패스와 슛은 현재 차례의 팀이 공을 실제로 보유할 때만 선택할 수 있다.
  if (carrier?.team === team && (state.actionCountByPiece[carrier.id] ?? 0) < ACTIONS_PER_PIECE) {
    // 경로가 막혔더라도 거리 안의 아군은 직접 선택할 수 있고 실제 수신자는 preview가 정한다.
    // 최대 거리는 팀 전술과 패스 방향(역습의 전방 확장)에 따라 달라진다.
    for (const target of state.pieces) {
      if (target.team !== team || target.id === carrier.id) continue;
      const distance = Math.max(
        Math.abs(target.pos.x - carrier.pos.x),
        Math.abs(target.pos.y - carrier.pos.y),
      );
      if (distance <= passMaxBetween(state.teamStyles[team], carrier, target)) {
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

    if (
      isPressured(state, carrier.id) &&
      state.heldFirmPieceId === null &&
      (state.actionCountByPiece[carrier.id] ?? 0) < ACTIONS_PER_PIECE &&
      state.actionsRemaining >= 2
    ) {
      moves.push({ kind: "hold", pieceId: carrier.id });
    }
  }

  // 스틸은 상대가 공을 들고 있고 행동 유예가 끝났거나 2인 포위가 성립한 경우에만 후보가 될 수 있다.
  if (carrier && carrier.team !== team && !isStealProtected(state, carrier.id, team)) {
    for (const piece of state.pieces) {
      // 두 축 차이 중 큰 값이 1이면 상하좌우와 대각선을 포함한 주변 8칸이다.
      const distance = Math.max(
        Math.abs(piece.pos.x - carrier.pos.x),
        Math.abs(piece.pos.y - carrier.pos.y),
      );
      if (
        piece.team === team &&
        (state.actionCountByPiece[piece.id] ?? 0) < ACTIONS_PER_PIECE &&
        distance === 1
      ) {
        moves.push({
          kind: "steal",
          pieceId: piece.id,
          targetPieceId: carrier.id,
        });
      }
    }
  }

  if (state.actionsRemaining < ACTIONS_PER_TEAM_TURN) {
    moves.push({ kind: "endTurn" });
  }

  return moves;
}

/** 현재 팀 턴을 종료하고 상대 팀의 새 3행동 상태를 구성한다. */
function switchTeamTurn(state: GameState): void {
  const outgoing = state.activeTeam;
  if (state.stealProtection?.blockedTeam === outgoing) {
    state.stealProtection = null;
  }
  state.activeTeam = otherTeam(outgoing);
  state.actionsRemaining = ACTIONS_PER_TEAM_TURN;
  state.actionCountByPiece = {};
  state.heldFirmPieceId = null;
}

/** 원자 행동의 공통 행동 경제 갱신을 적용한다. */
function completeAtomicAction(
  state: GameState,
  pieceId: number,
  countsForPiece = true,
): void {
  state.turn += 1;
  state.actionsRemaining -= 1;
  if (countsForPiece) {
    state.actionCountByPiece[pieceId] = (state.actionCountByPiece[pieceId] ?? 0) + 1;
  }
  if (gameResult(state) === null && state.actionsRemaining === 0) switchTeamTurn(state);
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
    actionCountByPiece: { ...state.actionCountByPiece },
    teamStyles: { ...state.teamStyles },
    stealProtection: state.stealProtection ? { ...state.stealProtection } : null,
  };
}

/** 하나의 Move가 확률적으로 도달할 수 있는 결과 하나를 설명한다. */
interface ChanceResolution {
  probability: number;
  tag: MoveOutcome["tag"];
  /** 공을 멈춘 확률 관문. null이면 모든 관문을 통과했거나 결정론적 행동이다. */
  stopGate: BallGate | null;
}

/** 32비트 FNV-1a 해시. 확률 판정의 결정론적 시드를 만든다. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Move를 속성 순서에 의존하지 않는 안정적인 문자열로 요약한다. */
function encodeMove(move: Move): string {
  switch (move.kind) {
    case "move":
      return `m${move.pieceId}>${move.to.x},${move.to.y}`;
    case "pass":
      return `p${move.pieceId}>${move.targetPieceId}`;
    case "shoot":
      return `s${move.pieceId}>${move.goalRow}`;
    case "steal":
      return `t${move.pieceId}>${move.targetPieceId}`;
    case "hold":
      return `h${move.pieceId}`;
    case "endTurn":
      return "e";
  }
}

/**
 * 같은 상태의 같은 Move에 언제나 같은 값을 주는 0 이상 1 미만의 판정 롤.
 *
 * `Math.random()`을 금지하는 재현성 정책을 지키기 위해 상태의 게임 결정 요소와 Move를
 * 해시한다. 경기 기록만 있으면 모든 확률 판정을 그대로 다시 실행할 수 있다.
 */
function chanceRoll(state: GameState, move: Move): number {
  const pieces = state.pieces
    .map((piece) => `${piece.id}:${piece.pos.x},${piece.pos.y}`)
    .join(";");
  const ball =
    state.ball.kind === "held"
      ? `h${state.ball.pieceId}`
      : `l${state.ball.pos.x},${state.ball.pos.y}`;
  const key = `${state.turn}|${state.activeTeam}|${state.actionsRemaining}|${state.score.home},${state.score.away}|${ball}|${pieces}|${encodeMove(move)}`;
  return fnv1a(key) / 0x1_0000_0000;
}

/**
 * 한 Move의 가능한 결과와 확률을 관문 진행 순서대로 열거한다.
 *
 * 결과 i의 확률은 (앞선 관문을 모두 통과할 확률) × (관문 i의 개입 확률)이고, 마지막
 * 결과는 모든 관문을 통과한 득점·도착이다. 확률 합은 언제나 1이며 관문이 없는 행동은
 * 확률 1의 결정론적 결과 하나만 갖는다.
 */
function enumerateResolutions(state: GameState, move: Move): ChanceResolution[] {
  if (move.kind !== "pass" && move.kind !== "shoot") {
    return [{ probability: 1, tag: "deterministic", stopGate: null }];
  }

  const actor = requirePiece(state, move.pieceId);
  const { gates } = analyzeBallMove(state, actor, move);
  const resolutions: ChanceResolution[] = [];
  let residual = 1;
  if (move.kind === "shoot") {
    // 거리 정확도 판정: 수비 개입과 무관하게 먼저 빗나갈 수 있고, 빗나가면 골킥이다.
    const accuracy = shotAccuracy(
      Math.abs((actor.team === "home" ? BOARD_W : -1) - actor.pos.x),
    );
    if (accuracy < 1) {
      resolutions.push({ probability: 1 - accuracy, tag: "offTarget", stopGate: null });
      residual = accuracy;
    }
  }
  for (const gate of gates) {
    const tag: MoveOutcome["tag"] =
      move.kind === "pass"
        ? "zoneIntercept"
        : gate.piece.role === "GK"
          ? "goalkeeperSave"
          : reboundPosition(state, gate.piece, actor) === null
            ? "fieldPossession"
            : "fieldRebound";
    resolutions.push({ probability: residual * gate.chance, tag, stopGate: gate });
    residual *= 1 - gate.chance;
  }
  resolutions.push({
    probability: residual,
    tag: move.kind === "shoot" ? "goal" : "received",
    stopGate: null,
  });
  return resolutions;
}

/**
 * 확률 판정이 정해진 하나의 결과로 Move를 적용한 다음 상태를 반환한다.
 *
 * 호출자는 `legalMoves()`가 만든 수와 `enumerateResolutions()`가 만든 resolution을
 * 전달해야 한다. 이 함수는 존재하지 않는 기물, 잘못된 패스 대상 같은 불법 입력을 다시
 * 검증하지 않는다. 일반적인 전이에서는 마지막에 turn을 한 번 증가시키며, 득점은 킥오프
 * 초기화 뒤 조기 반환하여 중복 증가를 피한다.
 */
function applyResolvedMove(
  state: GameState,
  move: Move,
  resolution: ChanceResolution,
): GameState {
  const next = cloneState(state);
  const team = sideToMove(next);
  if (move.kind === "endTurn") {
    switchTeamTurn(next);
    return next;
  }
  const protectionAtActionStart = state.stealProtection
    ? { ...state.stealProtection }
    : null;

  if (move.kind === "move") {
    const piece = next.pieces.find((candidate) => candidate.id === move.pieceId)!;
    const picksUpLooseBall =
      next.ball.kind === "loose" &&
      next.ball.pos.x === move.to.x &&
      next.ball.pos.y === move.to.y;
    piece.pos = { ...move.to };
    // held 공은 좌표 대신 소유 기물 ID를 가리키므로 소유자가 움직이면 함께 이동한 셈이다.
    if (next.ball.kind === "held" && next.ball.pieceId === piece.id) {
      next.ball = { kind: "held", pieceId: piece.id };
    } else if (picksUpLooseBall) {
      // loose 공이 놓인 칸으로 이동한 기물은 즉시 공의 새 소유자가 된다.
      next.ball = { kind: "held", pieceId: piece.id };
      protectNewCarrier(next, piece.id, otherTeam(piece.team));
    }
  } else if (move.kind === "pass") {
    if (resolution.stopGate) {
      // 영향권 인터셉트에 성공한 상대가 자기 칸에서 공을 소유하고 회수 유예를 받는다.
      next.ball = { kind: "held", pieceId: resolution.stopGate.piece.id };
      protectNewCarrier(next, resolution.stopGate.piece.id, team);
      applyMomentumEscape(next, resolution.stopGate.piece.id);
    } else {
      const actor = requirePiece(next, move.pieceId);
      const receiver =
        analyzeBallMove(next, actor, move).receiver ?? requirePiece(next, move.targetPieceId);
      next.ball = { kind: "held", pieceId: receiver.id };
      if (receiver.team !== team) {
        protectNewCarrier(next, receiver.id, team);
        applyMomentumEscape(next, receiver.id);
      }
    }
  } else if (move.kind === "shoot") {
    if (resolution.tag === "offTarget") {
      // 빗나간 슛은 골킥: 상대 GK가 공을 소유하고 회수 유예를 받는다.
      const keeper = next.pieces.find(
        (piece) => piece.team !== team && piece.role === "GK",
      )!;
      next.ball = { kind: "held", pieceId: keeper.id };
      protectNewCarrier(next, keeper.id, team);
    } else if (resolution.stopGate === null) {
      // 정확도와 모든 개입을 뚫으면 득점하고 상대 팀이 센터에서 공을 갖도록 재배치한다.
      next.score[team] += 1;
      completeAtomicAction(next, move.pieceId);
      resetForKickoff(next, otherTeam(team));
      return next;
    } else {
      const blocker = requirePiece(next, resolution.stopGate.piece.id);
      if (blocker.role === "GK") {
        next.ball = { kind: "held", pieceId: blocker.id };
        protectNewCarrier(next, blocker.id, team);
        applyMomentumEscape(next, blocker.id);
      } else {
        const shooter = requirePiece(next, move.pieceId);
        const reboundPos = reboundPosition(next, blocker, shooter);
        if (reboundPos) {
          next.ball = { kind: "loose", pos: { ...reboundPos } };
          next.stealProtection = null;
        } else {
          next.ball = { kind: "held", pieceId: blocker.id };
          protectNewCarrier(next, blocker.id, team);
          applyMomentumEscape(next, blocker.id);
        }
      }
    }
  } else if (move.kind === "steal") {
    // 앞의 kind들을 제외하면 타입상 steal이며, 성공 확률 판정 없이 소유권이 이동한다.
    next.ball = { kind: "held", pieceId: move.pieceId };
    protectNewCarrier(next, move.pieceId, otherTeam(team));
    applyMomentumEscape(next, move.pieceId);
  } else {
    next.heldFirmPieceId = move.pieceId;
  }

  if (
    next.heldFirmPieceId !== null &&
    ((move.kind === "move" && next.heldFirmPieceId === move.pieceId) ||
      next.ball.kind !== "held" ||
      next.ball.pieceId !== next.heldFirmPieceId)
  ) {
    next.heldFirmPieceId = null;
  }
  clearProtectionIfCarrierChanged(next);
  if (
    protectionAtActionStart?.blockedTeam === team &&
    next.stealProtection?.pieceId === protectionAtActionStart.pieceId &&
    next.stealProtection.blockedTeam === protectionAtActionStart.blockedTeam
  ) {
    next.stealProtection = null;
  }
  // 티키타카의 MF 패스는 선수별 행동 상한에 세지 않아 연결 고리 역할을 이어갈 수 있다.
  const freePass =
    move.kind === "pass" &&
    TACTICS[next.teamStyles[team]].midfielderFreePass &&
    requirePiece(next, move.pieceId).role === "MF";
  completeAtomicAction(next, move.pieceId, move.kind !== "hold" && !freePass);
  return next;
}

/**
 * 하나의 Move가 만들 수 있는 모든 결과 상태와 확률 분포를 반환한다.
 *
 * 탐색은 이 분포의 기대값으로 수를 평가해야 실제 판정 결과를 미리 아는 부정을 막는다.
 * 결정론적 행동은 확률 1의 결과 하나를 반환하므로 호출자가 따로 분기할 필요가 없다.
 */
export function applyMoveOutcomes(state: GameState, move: Move): MoveOutcome[] {
  return enumerateResolutions(state, move).map((resolution) => ({
    probability: resolution.probability,
    tag: resolution.tag,
    state: applyResolvedMove(state, move, resolution),
  }));
}

/**
 * 하나의 합법 수를 적용한 다음 경기 상태를 반환하며 입력 상태는 변경하지 않는다.
 *
 * 확률 관문이 있는 패스·슛은 상태·수 해시 롤로 결과 하나를 결정적으로 선택한다.
 * 같은 상태의 같은 수는 언제나 같은 결과를 재현하므로 경기 기록과 분석이 어긋나지
 * 않는다. 호출자는 `legalMoves()`가 만든 수를 전달해야 한다.
 */
export function applyMove(state: GameState, move: Move): GameState {
  const resolutions = enumerateResolutions(state, move);
  if (resolutions.length === 1) return applyResolvedMove(state, move, resolutions[0]!);

  const roll = chanceRoll(state, move);
  let cumulative = 0;
  for (const resolution of resolutions) {
    cumulative += resolution.probability;
    if (roll < cumulative) return applyResolvedMove(state, move, resolution);
  }
  // 부동소수 합이 1에 아주 약간 못 미치는 경우 마지막 결과로 귀결시킨다.
  return applyResolvedMove(state, move, resolutions[resolutions.length - 1]!);
}
