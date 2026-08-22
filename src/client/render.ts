/**
 * Controller의 화면 상태를 HTML과 Canvas에 표현하는 Renderer.
 *
 * 상태를 변경하지 않고 전달받은 `ClientViewState`만 읽는다. 먼저 순수한
 * `Presentation`으로 문자·버튼 상태를 계산하고, 실제 DOM/Canvas 반영은 별도
 * Renderer가 담당한다.
 */

import strings from "../../content/strings.json";
import theme from "../../content/theme.json";
import { gameResult, isPressured, isStealProtected } from "../engine/rules";
import {
  BOARD_H,
  BOARD_W,
  type GameState,
  type MovePreview,
  type Pos,
} from "../engine/types";
import { BOARD_GEOMETRY, isTargetedMove, targetForMove } from "./input";
import type { CanvasTarget, ClientAction, ClientMessage, ClientViewState } from "./types";

/** DOM에 표시할 값만 추린 상태 독립적인 표시 모델. */
export interface Presentation {
  scoreHome: number;
  scoreAway: number;
  turnText: string;
  status: string;
  showStart: boolean;
  showNewGame: boolean;
  showHold: boolean;
  showEndTurn: boolean;
  visibleActions: ClientAction[];
  selectedAction: ClientAction | null;
  inputLocked: boolean;
  /** 이벤트 로그에 표시할 최근 사건 문구. 오래된 것이 앞에 온다. */
  eventLines: string[];
}

/** 이벤트 로그에 보여줄 최근 사건 수. */
const EVENT_LINES_SHOWN = 6;

/** 구조화된 경기 사건 하나를 로그 한 줄 문구로 바꾼다. */
function eventLine(event: ClientViewState["events"][number]): string {
  const team = event.team === "home" ? "HOME" : "AWAY";
  const chance = event.chancePercent !== undefined ? ` ${event.chancePercent}%` : "";
  switch (event.kind) {
    case "pass":
      return `${team} ${strings.match.pass}${chance} → ${strings.match.arrived}`;
    case "passIntercepted":
      return `${team} ${strings.match.pass}${chance} → ${strings.match.intercepted}`;
    case "shotGoal":
      return `${team} ${strings.match.shoot}${chance} → ${strings.match.goal}`;
    case "shotSaved":
      return `${team} ${strings.match.shoot}${chance} → ${strings.match.save}`;
    case "shotBlocked":
      return `${team} ${strings.match.shoot}${chance} → ${strings.match.blocked}`;
    case "steal":
      return `${team} ${strings.match.steal}`;
    case "hold":
      return `${team} ${strings.match.hold}`;
  }
}

/** Renderer가 갱신하는 Canvas와 HTML 요소 묶음. */
export interface RenderRefs {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  scoreHome: HTMLElement;
  scoreAway: HTMLElement;
  turnInfo: HTMLElement;
  statusMessage: HTMLElement;
  startButton: HTMLButtonElement;
  newGameButton: HTMLButtonElement;
  holdButton: HTMLButtonElement;
  endTurnButton: HTMLButtonElement;
  actionButtons: Record<ClientAction, HTMLButtonElement>;
  /** 최근 사건 문구를 줄바꿈으로 나열하는 이벤트 로그 요소. */
  eventLog: HTMLElement;
}

/** 구조화된 Controller 메시지를 실제 한국어 UI 문구로 변환한다. */
function messageText(message: ClientMessage): string {
  switch (message.kind) {
    case "selectOwn":
      return strings.match.selectOwn;
    case "cannotSteal":
      return strings.match.cannotSteal;
    case "chooseReceiver":
      return strings.match.chooseReceiver;
    case "chooseGoal":
      return strings.match.chooseGoal;
    case "chooseStealer":
      return strings.match.chooseStealer;
    case "protectedCarrier":
      return strings.match.protectedCarrier;
    case "pressuredCarrier":
      return strings.match.pressured;
    case "exhaustedPiece":
      return strings.match.exhaustedPiece;
    case "invalidShot":
      return strings.match.invalidShot;
    case "botRetry":
      return `${strings.match.botRetry} (${message.attempt}/${message.maxAttempts})`;
    case "fatalError":
      return strings.match.fatalError;
  }
}

/** 메시지가 없을 때 화면 단계와 경기 결과에 맞는 기본 상태 문구를 계산한다. */
function phaseStatus(state: ClientViewState): string {
  switch (state.phase) {
    case "ready":
      return strings.match.ready;
    case "humanTurn":
      return strings.match.humanTurn;
    case "botThinking":
      return strings.match.botThinking;
    case "fatalError":
      return strings.match.fatalError;
    case "finished": {
      const result = state.gameState ? gameResult(state.gameState) : null;
      if (result?.kind === "draw") return strings.match.draw;
      if (result?.kind === "win") {
        return result.winner === "home" ? strings.match.homeWin : strings.match.awayWin;
      }
      return "";
    }
  }
}

/**
 * `ClientViewState`를 DOM에 바로 적용할 수 있는 값으로 변환한다.
 * 이 함수는 DOM과 Canvas에 접근하지 않으므로 모든 화면 단계를 빠르게 테스트할 수 있다.
 */
export function buildPresentation(state: ClientViewState): Presentation {
  const score = state.gameState?.score ?? { home: 0, away: 0 };
  const gameState = state.gameState;
  const turn = gameState?.turn ?? 0;
  const maxTurns = gameState?.maxTurns ?? 60;
  const isHumanTurn = state.phase === "humanTurn";
  const selectedUsage =
    gameState && state.selectedPieceId !== null
      ? ` · 선택 선수 ${gameState.actionCountByPiece[state.selectedPieceId] ?? 0}/2`
      : "";

  return {
    scoreHome: score.home,
    scoreAway: score.away,
    turnText: gameState
      ? `${turn} / ${maxTurns} 행동 · ${gameState.activeTeam.toUpperCase()} ${gameState.actionsRemaining}/3${selectedUsage}`
      : `${turn} / ${maxTurns} 행동`,
    status: state.message ? messageText(state.message) : phaseStatus(state),
    showStart: state.phase === "ready",
    showNewGame: state.phase === "finished" || state.phase === "fatalError",
    showHold: isHumanTurn && state.canHold,
    showEndTurn: isHumanTurn && state.canEndTurn,
    visibleActions: isHumanTurn ? [...state.availableActions] : [],
    selectedAction: isHumanTurn ? state.selectedAction : null,
    inputLocked: !isHumanTurn,
    eventLines: state.events.slice(-EVENT_LINES_SHOWN).map(eventLine),
  };
}

function cellCenter(pos: Pos): { x: number; y: number } {
  return {
    x: BOARD_GEOMETRY.originX + pos.x * BOARD_GEOMETRY.cell + BOARD_GEOMETRY.cell / 2,
    y: BOARD_GEOMETRY.originY + pos.y * BOARD_GEOMETRY.cell + BOARD_GEOMETRY.cell / 2,
  };
}

function targetCenter(target: CanvasTarget): { x: number; y: number } | null {
  if (target.kind === "cell") return cellCenter(target.pos);
  if (target.kind === "goal") {
    return {
      x:
        target.side === "left"
          ? BOARD_GEOMETRY.originX / 2
          : BOARD_GEOMETRY.boardRight + BOARD_GEOMETRY.originX / 2,
      y: target.row * BOARD_GEOMETRY.cell + BOARD_GEOMETRY.cell / 2,
    };
  }
  return null;
}

/** 미리보기의 실제 수신자·차단자 ID를 Canvas 칸으로만 해석한다. */
function pieceTarget(gameState: GameState, pieceId: number): CanvasTarget | null {
  const piece = gameState.pieces.find((candidate) => candidate.id === pieceId);
  return piece ? { kind: "cell", pos: { ...piece.pos } } : null;
}

function fillCircle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}

function strokeCircle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  width: number,
): void {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.stroke();
}

/** 한쪽 골대 여백에 골문 그물과 프레임을 그린다. */
function drawGoalMouth(context: CanvasRenderingContext2D, side: "left" | "right"): void {
  const { cell, originX, boardRight } = BOARD_GEOMETRY;
  const x0 = side === "left" ? 10 : boardRight + 6;
  const width = originX - 16;
  const y0 = 3 * cell;
  const height = 3 * cell;

  context.fillStyle = theme.board.stadium;
  context.globalAlpha = 0.6;
  context.fillRect(x0, y0, width, height);
  context.globalAlpha = 1;

  // 그물: 성긴 세로·가로 줄
  context.strokeStyle = theme.board.net;
  context.globalAlpha = 0.45;
  context.lineWidth = 1;
  for (let x = x0 + 12; x < x0 + width; x += 16) {
    context.beginPath();
    context.moveTo(x, y0);
    context.lineTo(x, y0 + height);
    context.stroke();
  }
  for (let y = y0 + 16; y < y0 + height; y += 16) {
    context.beginPath();
    context.moveTo(x0, y);
    context.lineTo(x0 + width, y);
    context.stroke();
  }
  context.globalAlpha = 1;

  // 골대 프레임
  context.strokeStyle = theme.board.chalk;
  context.lineWidth = 5;
  context.strokeRect(x0, y0, width, height);
}

/** 관중석, 잔디 스트라이프, 석회 라인과 양쪽 골문을 매 프레임 처음부터 다시 그린다. */
function drawPitch(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  const { cell, originX, originY, boardRight } = BOARD_GEOMETRY;
  const pitchWidth = BOARD_W * cell;
  const pitchHeight = BOARD_H * cell;
  const centerX = originX + pitchWidth / 2;

  // 경기장 밖 관중석 어둠
  context.fillStyle = theme.board.stadium;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // 잔디: 열마다 명암을 교차하는 스트라이프
  for (let x = 0; x < BOARD_W; x += 1) {
    context.fillStyle = x % 2 === 0 ? theme.board.grassLight : theme.board.grassDark;
    context.fillRect(originX + x * cell, originY, cell, pitchHeight);
  }

  // 게임 입력용 칸 경계는 아주 희미하게만 남긴다.
  context.strokeStyle = theme.board.chalk;
  context.globalAlpha = 0.07;
  context.lineWidth = 1;
  for (let x = 0; x < BOARD_W; x += 1) {
    for (let y = 0; y < BOARD_H; y += 1) {
      context.strokeRect(originX + x * cell, originY + y * cell, cell, cell);
    }
  }
  context.globalAlpha = 1;

  // 석회 라인: 외곽, 센터라인, 센터서클, 양쪽 페널티 박스(GK 박스 영역과 일치)
  context.strokeStyle = theme.board.chalk;
  context.globalAlpha = 0.8;
  context.lineWidth = 3;
  context.strokeRect(originX, originY, pitchWidth, pitchHeight);
  context.beginPath();
  context.moveTo(centerX, originY);
  context.lineTo(centerX, originY + pitchHeight);
  context.stroke();
  strokeCircle(context, centerX, originY + pitchHeight / 2, cell * 1.35, theme.board.chalk, 3);
  context.strokeRect(originX, 2 * cell, 2 * cell, 5 * cell);
  context.strokeRect(boardRight - 2 * cell, 2 * cell, 2 * cell, 5 * cell);
  context.globalAlpha = 1;

  drawGoalMouth(context, "left");
  drawGoalMouth(context, "right");
}

/** 직전 수의 출발점과 도착점을 선으로 연결해 한 수 전의 변화를 보존한다. */
function drawLastMove(context: CanvasRenderingContext2D, state: ClientViewState): void {
  if (!state.lastMove) return;
  const from = cellCenter(state.lastMove.from);
  const target = targetCenter(state.lastMove.target);
  if (!target) return;

  context.strokeStyle = theme.board.lastMove;
  context.lineWidth = 7;
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(target.x, target.y);
  context.stroke();
}

/** 패스·슛 Preview가 이미 판정한 경로와 성공 여부를 색과 기호로 함께 표시한다. */
function drawPreviewPath(
  context: CanvasRenderingContext2D,
  actor: Pos,
  resolvedTarget: CanvasTarget,
  preview: Extract<MovePreview, { kind: "pass" | "shoot" }>,
): void {
  const chance = preview.kind === "pass" ? preview.arrivalChance : preview.goalChance;
  const successful = preview.kind === "pass" ? preview.reachesTarget : chance >= 1;
  const color = successful ? theme.board.pathSuccess : theme.board.pathBlocked;

  context.fillStyle = color;
  context.globalAlpha = 0.22;
  for (const pos of preview.path) {
    context.fillRect(
      BOARD_GEOMETRY.originX + pos.x * BOARD_GEOMETRY.cell,
      BOARD_GEOMETRY.originY + pos.y * BOARD_GEOMETRY.cell,
      BOARD_GEOMETRY.cell,
      BOARD_GEOMETRY.cell,
    );
  }
  context.globalAlpha = 1;

  const from = cellCenter(actor);
  const to = targetCenter(resolvedTarget);
  if (!to) return;
  context.strokeStyle = color;
  context.setLineDash([]);
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.fillStyle = color;
  context.font = `bold ${Math.floor(BOARD_GEOMETRY.cell * 0.32)}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  // 기하적으로 다른 기물이 먼저 받는 패스는 "!"로, 나머지는 실행 전 성공 확률로 안내한다.
  const label =
    preview.kind === "pass" && !preview.reachesTarget
      ? "!"
      : `${Math.round(chance * 100)}%`;
  context.fillText(label, to.x, to.y);
}

/** 사람 턴에 상대 공 소유자의 현재 슛 위협 경로와 득점 확률을 함께 표시한다. */
function drawThreatLanes(context: CanvasRenderingContext2D, state: ClientViewState): void {
  for (const { preview } of state.threatShots) {
    if (preview.kind !== "shoot") continue;

    context.fillStyle = theme.board.threat;
    // 득점 확률이 높은 위협 레인일수록 진하게 칠해 어디를 먼저 막을지 알 수 있게 한다.
    context.globalAlpha = 0.08 + preview.goalChance * 0.25;
    for (const pos of preview.path) {
      context.fillRect(
        BOARD_GEOMETRY.originX + pos.x * BOARD_GEOMETRY.cell,
        BOARD_GEOMETRY.originY + pos.y * BOARD_GEOMETRY.cell,
        BOARD_GEOMETRY.cell,
        BOARD_GEOMETRY.cell,
      );
    }
    context.globalAlpha = 1;

    // away는 왼쪽 골문을 공격하므로 위협 확률은 왼쪽 골문 칸 옆에 표기한다.
    const label = targetCenter({ kind: "goal", side: "left", row: preview.goalRow });
    if (!label) continue;
    context.fillStyle = theme.board.threat;
    context.font = `bold ${Math.floor(BOARD_GEOMETRY.cell * 0.26)}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(`${Math.round(preview.goalChance * 100)}%`, label.x, label.y);
  }
}

/** 후보 Move와 짝지어진 Preview만 사용해 실제 공 경로를 그린다. */
function drawPreviewPaths(
  context: CanvasRenderingContext2D,
  gameState: GameState,
  state: ClientViewState,
): void {
  for (const candidate of state.candidatePreviews) {
    const { move, preview } = candidate;
    if (preview.kind !== "pass" && preview.kind !== "shoot") continue;
    if (!isTargetedMove(move)) continue;
    const actor = gameState.pieces.find((piece) => piece.id === move.pieceId);
    if (!actor) continue;

    const resolvedTarget =
      preview.kind === "pass"
        ? pieceTarget(gameState, preview.receiverPieceId)
        : preview.outcome !== "goal" && preview.blockerPieceId !== null
          ? pieceTarget(gameState, preview.blockerPieceId)
          : targetForMove(gameState, move);
    if (resolvedTarget) drawPreviewPath(context, actor.pos, resolvedTarget, preview);
  }
}

/** 선택된 행동 후보는 채운 원으로, 직접 클릭 스틸 후보는 붉은 테두리로 구분한다. */
function drawCandidates(
  context: CanvasRenderingContext2D,
  gameState: GameState,
  state: ClientViewState,
): void {
  for (const move of state.candidateMoves) {
    if (!isTargetedMove(move)) continue;
    const target = targetForMove(gameState, move);
    const center = targetCenter(target);
    if (!center) continue;

    if (move.kind === "steal") {
      const stealer =
        state.selectedStealTargetId === null
          ? null
          : gameState.pieces.find((piece) => piece.id === move.pieceId);
      const stealCenter = stealer ? cellCenter(stealer.pos) : center;
      strokeCircle(
        context,
        stealCenter.x,
        stealCenter.y,
        BOARD_GEOMETRY.cell * 0.4,
        theme.board.stealTarget,
        6,
      );
      continue;
    }

    // 아군에게 연결되는 패스는 기물 원에 작은 후보 점이 가려지므로 바깥 테두리로 표시한다.
    if (
      move.kind === "pass" &&
      target.kind === "cell" &&
      gameState.pieces.some(
        (piece) => piece.pos.x === target.pos.x && piece.pos.y === target.pos.y,
      )
    ) {
      strokeCircle(
        context,
        center.x,
        center.y,
        BOARD_GEOMETRY.cell * 0.4,
        theme.board.passTarget,
        6,
      );
      continue;
    }

    const color =
      move.kind === "move"
        ? theme.board.moveTarget
        : move.kind === "pass"
          ? theme.board.passTarget
          : theme.board.shootTarget;
    fillCircle(context, center.x, center.y, BOARD_GEOMETRY.cell * 0.13, color);
  }
}

/** 실제 공을 받을 기물과 스틸 보호 상태를 기물 위에 덧그린다. */
function drawOutcomeHighlights(
  context: CanvasRenderingContext2D,
  gameState: GameState,
  state: ClientViewState,
): void {
  for (const { preview } of state.candidatePreviews) {
    if (preview.kind === "shoot" && preview.outcome === "fieldRebound" && preview.reboundPos) {
      const rebound = cellCenter(preview.reboundPos);
      strokeCircle(context, rebound.x, rebound.y, BOARD_GEOMETRY.cell * 0.24, theme.board.rebound, 5);
      strokeCircle(context, rebound.x, rebound.y, BOARD_GEOMETRY.cell * 0.32, theme.board.rebound, 3);
    }
    const pieceId =
      preview.kind === "pass"
        ? preview.receiverPieceId
        : preview.kind === "shoot" && preview.outcome !== "goal"
          ? preview.blockerPieceId
          : null;
    if (pieceId === null) continue;
    const piece = gameState.pieces.find((candidate) => candidate.id === pieceId);
    if (!piece) continue;
    const center = cellCenter(piece.pos);
    strokeCircle(
      context,
      center.x,
      center.y,
      BOARD_GEOMETRY.cell * 0.43,
      theme.board.actualReceiver,
      4,
    );
    strokeCircle(
      context,
      center.x,
      center.y,
      BOARD_GEOMETRY.cell * 0.49,
      theme.board.actualReceiver,
      3,
    );
  }

  if (
    gameState.ball.kind === "held" &&
    gameState.stealProtection?.pieceId === gameState.ball.pieceId &&
    isStealProtected(
      gameState,
      gameState.ball.pieceId,
      gameState.stealProtection.blockedTeam,
    )
  ) {
    const carrierId = gameState.ball.pieceId;
    const carrier = gameState.pieces.find((piece) => piece.id === carrierId);
    if (!carrier) return;
    const center = cellCenter(carrier.pos);
    context.fillStyle = theme.board.protected;
    context.font = `bold ${Math.floor(BOARD_GEOMETRY.cell * 0.3)}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("◆", center.x, center.y - BOARD_GEOMETRY.cell * 0.3);
  }
}

/** 애니메이션 프레임이 기본 상태 위에 덧씌우는 임시 표시. RAF가 없는 환경에서는 사용하지 않는다. */
interface FrameOverrides {
  /** 이동 중인 기물의 화면상 중심 좌표. */
  pieceCenters?: Map<number, { x: number; y: number }>;
  /** 공이 비행 중이라 정적 공 표시를 숨겨야 하는지 여부. */
  hideBall?: boolean;
  /** 비행 중인 공을 그릴 화면 좌표. */
  flyingBall?: { x: number; y: number } | null;
  /** 득점 연출 강도. 0이면 표시하지 않는다. */
  goalFlash?: number;
  /** 판정 결과(차단·선방·인터셉트·스틸)를 띄우는 플로팅 문구. */
  eventLabel?: { text: string; x: number; y: number; alpha: number } | null;
}

/** 공을 입체감 있는 축구공 토큰으로 그린다. */
function drawBall(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
): void {
  context.globalAlpha = 0.3;
  fillCircle(context, x + radius * 0.2, y + radius * 0.35, radius, "#000000");
  context.globalAlpha = 1;
  fillCircle(context, x, y, radius, theme.board.ball);
  context.globalAlpha = 0.55;
  fillCircle(context, x, y, radius * 0.34, theme.board.stadium);
  context.globalAlpha = 1;
}

/** 기물, 역할 문자, 공과 현재 선택 테두리를 상태 위에 그린다. */
function drawPieces(
  context: CanvasRenderingContext2D,
  state: ClientViewState,
  overrides?: FrameOverrides,
): void {
  const gameState = state.gameState;
  if (!gameState) return;
  const radius = BOARD_GEOMETRY.cell * 0.35;
  const centerOf = (piece: { id: number; pos: Pos }) =>
    overrides?.pieceCenters?.get(piece.id) ?? cellCenter(piece.pos);

  for (const piece of gameState.pieces) {
    const center = centerOf(piece);
    // 팀 턴 행동을 다 쓴 현재 팀 선수는 흐리게 그려 "선택해도 소용없음"을 보여준다.
    const usedActions = gameState.actionCountByPiece[piece.id] ?? 0;
    const isActiveTeam = piece.team === gameState.activeTeam;
    const exhausted = isActiveTeam && usedActions >= 2;
    const baseAlpha = exhausted ? 0.4 : 1;

    // 그림자 → 유니폼 → 어두운 테두리 → 상단 하이라이트 순으로 입체감을 만든다.
    context.globalAlpha = 0.3 * baseAlpha;
    fillCircle(context, center.x + 3, center.y + 7, radius * 0.95, "#000000");
    context.globalAlpha = baseAlpha;
    fillCircle(
      context,
      center.x,
      center.y,
      radius,
      piece.team === "home" ? theme.team.home : theme.team.away,
    );
    context.globalAlpha = 0.35 * baseAlpha;
    strokeCircle(context, center.x, center.y, radius, "#000000", 3);
    context.globalAlpha = 0.16 * baseAlpha;
    fillCircle(context, center.x - radius * 0.25, center.y - radius * 0.3, radius * 0.6, "#ffffff");
    context.globalAlpha = baseAlpha;

    context.fillStyle = theme.board.pieceText;
    context.font = `bold ${Math.floor(BOARD_GEOMETRY.cell * 0.28)}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(piece.role, center.x, center.y);
    context.globalAlpha = 1;

    // 현재 팀 턴에 이미 쓴 행동 수를 토큰 아래 작은 점으로 표시한다.
    if (isActiveTeam && usedActions > 0) {
      for (let dot = 0; dot < usedActions; dot += 1) {
        fillCircle(
          context,
          center.x - 7 + dot * 14,
          center.y + radius + 9,
          4,
          theme.board.chalk,
        );
      }
    }

    if (gameState.ball.kind === "held" && gameState.ball.pieceId === piece.id) {
      const stateColor =
        gameState.heldFirmPieceId === piece.id
          ? theme.board.heldFirm
          : isPressured(gameState, piece.id)
            ? theme.board.pressured
            : null;
      if (stateColor) {
        strokeCircle(context, center.x, center.y, BOARD_GEOMETRY.cell * 0.39, stateColor, 5);
      }
    }
  }

  if (!overrides?.hideBall) {
    if (gameState.ball.kind === "loose") {
      const center = cellCenter(gameState.ball.pos);
      drawBall(context, center.x, center.y, BOARD_GEOMETRY.cell * 0.14);
    } else {
      const carrierId = gameState.ball.pieceId;
      const carrier = gameState.pieces.find((piece) => piece.id === carrierId);
      if (carrier) {
        const center = centerOf(carrier);
        drawBall(
          context,
          center.x + BOARD_GEOMETRY.cell * 0.24,
          center.y - BOARD_GEOMETRY.cell * 0.24,
          BOARD_GEOMETRY.cell * 0.13,
        );
      }
    }
  }

  const selected = gameState.pieces.find((piece) => piece.id === state.selectedPieceId);
  if (selected) {
    const center = centerOf(selected);
    strokeCircle(
      context,
      center.x,
      center.y,
      BOARD_GEOMETRY.cell * 0.42,
      theme.board.selected,
      6,
    );
  }
}

/** 현재 팀의 남은 행동 포인트를 그 팀 골대 쪽 여백에 3개의 pip으로 표시한다. */
function drawActionPoints(context: CanvasRenderingContext2D, gameState: GameState): void {
  const { originX, boardRight } = BOARD_GEOMETRY;
  const x = gameState.activeTeam === "home" ? originX / 2 : boardRight + originX / 2;
  const teamColor = gameState.activeTeam === "home" ? theme.team.home : theme.team.away;

  for (let index = 0; index < 3; index += 1) {
    const y = 36 + index * 34;
    if (index < gameState.actionsRemaining) {
      fillCircle(context, x, y, 11, teamColor);
      context.globalAlpha = 0.5;
      strokeCircle(context, x, y, 11, theme.board.chalk, 2);
      context.globalAlpha = 1;
    } else {
      // 이미 소모한 행동은 빈 테두리로 남긴다.
      context.globalAlpha = 0.3;
      strokeCircle(context, x, y, 11, theme.board.chalk, 2);
      context.globalAlpha = 1;
    }
  }
}

function drawCanvas(refs: RenderRefs, state: ClientViewState, overrides?: FrameOverrides): void {
  const context = refs.context;
  drawPitch(context, refs.canvas);
  if (!state.gameState) return;
  drawActionPoints(context, state.gameState);
  drawThreatLanes(context, state);
  drawLastMove(context, state);
  drawCandidates(context, state.gameState, state);
  drawPieces(context, state, overrides);
  drawPreviewPaths(context, state.gameState, state);
  drawOutcomeHighlights(context, state.gameState, state);

  if (overrides?.flyingBall) {
    drawBall(context, overrides.flyingBall.x, overrides.flyingBall.y, BOARD_GEOMETRY.cell * 0.15);
  }
  if (overrides?.goalFlash && overrides.goalFlash > 0) {
    const center = {
      x: BOARD_GEOMETRY.originX + (BOARD_W * BOARD_GEOMETRY.cell) / 2,
      y: (BOARD_H * BOARD_GEOMETRY.cell) / 2,
    };
    context.globalAlpha = Math.min(1, overrides.goalFlash);
    context.fillStyle = theme.board.selected;
    context.font = `bold ${Math.floor(BOARD_GEOMETRY.cell * 1.4)}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("GOAL!", center.x, center.y);
    context.globalAlpha = 1;
  }
  if (overrides?.eventLabel && overrides.eventLabel.alpha > 0) {
    const label = overrides.eventLabel;
    context.globalAlpha = Math.min(1, label.alpha);
    context.font = `bold ${Math.floor(BOARD_GEOMETRY.cell * 0.38)}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    // 잔디 위에서도 읽히도록 어두운 그림자 위에 밝은 글자를 겹쳐 그린다.
    context.fillStyle = "#000000";
    context.fillText(label.text, label.x + 2, label.y + 2);
    context.fillStyle = theme.board.selected;
    context.fillText(label.text, label.x, label.y);
    context.globalAlpha = 1;
  }
}

/** 두 픽셀 좌표 사이를 진행률만큼 보간한다. */
function lerp(from: { x: number; y: number }, to: { x: number; y: number }, t: number) {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** 직전 수 하나를 짧게 연출하기 위한 계획. RAF가 있는 브라우저에서만 실행한다. */
interface AnimationPlan {
  durationMs: number;
  kind: "pieceMove" | "ballFlight";
  pieceId: number | null;
  fromPx: { x: number; y: number };
  toPx: { x: number; y: number };
  goal: boolean;
  /** 비행이 끝난 지점에 띄울 판정 문구. 없으면 null. */
  label: string | null;
}

/** 새 상태의 직전 수를 보고 연출할 애니메이션을 계산한다. 연출이 없으면 null. */
function planAnimation(
  previous: ClientViewState | null,
  state: ClientViewState,
): AnimationPlan | null {
  const gameState = state.gameState;
  const lastMove = state.lastMove;
  if (!gameState || !lastMove || !previous?.gameState) return null;
  // lastMove 객체는 새 수가 적용될 때만 새로 만들어지므로 참조 비교로 새 수를 식별한다.
  if (previous.lastMove === lastMove) return null;

  const fromPx = cellCenter(lastMove.from);
  const finalCarrier =
    gameState.ball.kind === "held"
      ? gameState.pieces.find(
          (piece) => gameState.ball.kind === "held" && piece.id === gameState.ball.pieceId,
        )
      : undefined;

  if (lastMove.move.kind === "move") {
    return {
      durationMs: 200,
      kind: "pieceMove",
      pieceId: lastMove.move.pieceId,
      fromPx,
      toPx: cellCenter(lastMove.move.to),
      goal: false,
      label: null,
    };
  }
  if (lastMove.move.kind === "steal") {
    // 공이 상대에게서 스틸러에게 넘어가는 짧은 비행과 함께 스틸 판정을 띄운다.
    const victim = targetCenter(lastMove.target) ?? fromPx;
    return {
      durationMs: 220,
      kind: "ballFlight",
      pieceId: null,
      fromPx: victim,
      toPx: finalCarrier ? cellCenter(finalCarrier.pos) : fromPx,
      goal: false,
      label: strings.match.steal,
    };
  }
  if (lastMove.move.kind !== "pass" && lastMove.move.kind !== "shoot") return null;

  const mover = previous.gameState.pieces.find(
    (piece) => "pieceId" in lastMove.move && piece.id === lastMove.move.pieceId,
  );
  const scored =
    gameState.score.home + gameState.score.away >
    previous.gameState.score.home + previous.gameState.score.away;
  const toPx = scored
    ? (targetCenter(lastMove.target) ?? fromPx)
    : finalCarrier
      ? cellCenter(finalCarrier.pos)
      : gameState.ball.kind === "loose"
        ? cellCenter(gameState.ball.pos)
        : fromPx;
  // 소유권이 상대에게 넘어간 결과에만 판정 문구를 띄운다. 성공 패스는 조용히 지나간다.
  const label = scored
    ? null
    : lastMove.move.kind === "shoot"
      ? finalCarrier?.role === "GK"
        ? strings.match.save
        : strings.match.blocked
      : mover && finalCarrier && finalCarrier.team !== mover.team
        ? strings.match.intercepted
        : null;
  return {
    durationMs: scored ? 850 : label ? 500 : 300,
    kind: "ballFlight",
    pieceId: null,
    fromPx,
    toPx,
    goal: scored,
    label,
  };
}

/** 진행률에 맞는 프레임 덧씌우기를 계산한다. */
function frameOverrides(plan: AnimationPlan, progress: number): FrameOverrides {
  if (plan.kind === "pieceMove") {
    const eased = easeOutCubic(progress);
    return {
      pieceCenters: new Map([[plan.pieceId!, lerp(plan.fromPx, plan.toPx, eased)]]),
    };
  }
  // 공 비행: 득점·판정 연출은 앞 40%에 비행을 끝내고 남은 시간에 문구를 보여준다.
  const flightEnd = plan.goal || plan.label ? 0.4 : 1;
  const flight = Math.min(1, progress / flightEnd);
  const remainder = progress >= flightEnd ? (progress - flightEnd) / (1 - flightEnd) : 0;
  return {
    hideBall: progress < flightEnd,
    flyingBall: progress < flightEnd ? lerp(plan.fromPx, plan.toPx, easeOutCubic(flight)) : null,
    goalFlash: plan.goal && progress >= flightEnd ? 1 - remainder : 0,
    eventLabel:
      plan.label && progress >= flightEnd
        ? {
            text: plan.label,
            x: plan.toPx.x,
            // 판정 문구는 위로 살짝 떠오르며 사라진다.
            y: plan.toPx.y - BOARD_GEOMETRY.cell * (0.7 + remainder * 0.4),
            alpha: 1 - remainder,
          }
        : null,
  };
}

/** Renderer 생성 옵션. */
export interface RendererOptions {
  /** true이고 requestAnimationFrame이 있으면 직전 수를 짧게 연출한다. */
  animate?: boolean;
}

/**
 * 상태를 소유하지 않는 Renderer 함수를 만든다.
 * 반환 함수는 호출될 때마다 Canvas 전체와 관련 DOM 속성을 현재 상태로 덮어쓴다.
 * 애니메이션은 표시 연출일 뿐이며 마지막 프레임은 항상 현재 상태와 일치한다.
 */
export function createRenderer(
  refs: RenderRefs,
  options: RendererOptions = {},
): (state: ClientViewState) => void {
  let previousView: ClientViewState | null = null;
  let activeFrame: number | null = null;

  return (state) => {
    const presentation = buildPresentation(state);

    refs.scoreHome.textContent = String(presentation.scoreHome);
    refs.scoreAway.textContent = String(presentation.scoreAway);
    refs.turnInfo.textContent = presentation.turnText;
    refs.statusMessage.textContent = presentation.status;
    refs.eventLog.textContent = presentation.eventLines.join("\n");
    refs.eventLog.hidden = presentation.eventLines.length === 0;
    refs.startButton.hidden = !presentation.showStart;
    refs.startButton.disabled = !presentation.showStart;
    refs.newGameButton.hidden = !presentation.showNewGame;
    refs.newGameButton.disabled = !presentation.showNewGame;
    refs.holdButton.hidden = !presentation.showHold;
    refs.holdButton.disabled = !presentation.showHold;
    refs.endTurnButton.hidden = !presentation.showEndTurn;
    refs.endTurnButton.disabled = !presentation.showEndTurn;

    for (const action of ["move", "pass", "shoot"] as const) {
      const button = refs.actionButtons[action];
      const visible = presentation.visibleActions.includes(action);
      button.hidden = !visible;
      button.disabled = presentation.inputLocked || !visible;
      button.setAttribute(
        "aria-pressed",
        String(visible && presentation.selectedAction === action),
      );
    }

    // 새 상태가 오면 진행 중이던 연출은 즉시 버리고 최신 상태 기준으로 다시 시작한다.
    if (activeFrame !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(activeFrame);
      activeFrame = null;
    }
    const plan =
      options.animate && typeof requestAnimationFrame === "function"
        ? planAnimation(previousView, state)
        : null;
    previousView = state;

    if (!plan) {
      drawCanvas(refs, state);
      return;
    }

    const startedAt = globalThis.performance?.now?.() ?? Date.now();
    const frame = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / plan.durationMs);
      drawCanvas(refs, state, frameOverrides(plan, progress));
      activeFrame = progress < 1 ? requestAnimationFrame(frame) : null;
    };
    drawCanvas(refs, state, frameOverrides(plan, 0));
    activeFrame = requestAnimationFrame(frame);
  };
}
