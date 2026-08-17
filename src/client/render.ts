/**
 * Controller의 화면 상태를 HTML과 Canvas에 표현하는 Renderer.
 *
 * 상태를 변경하지 않고 전달받은 `ClientViewState`만 읽는다. 먼저 순수한
 * `Presentation`으로 문자·버튼 상태를 계산하고, 실제 DOM/Canvas 반영은 별도
 * Renderer가 담당한다.
 */

import strings from "../../content/strings.json";
import theme from "../../content/theme.json";
import { gameResult } from "../engine/rules";
import { BOARD_H, BOARD_W, type GameState, type Pos } from "../engine/types";
import { BOARD_GEOMETRY, targetForMove } from "./input";
import type { CanvasTarget, ClientAction, ClientMessage, ClientViewState } from "./types";

/** DOM에 표시할 값만 추린 상태 독립적인 표시 모델. */
export interface Presentation {
  scoreHome: number;
  scoreAway: number;
  turnText: string;
  status: string;
  showStart: boolean;
  showNewGame: boolean;
  visibleActions: ClientAction[];
  selectedAction: ClientAction | null;
  inputLocked: boolean;
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
  actionButtons: Record<ClientAction, HTMLButtonElement>;
}

/** 구조화된 Controller 메시지를 실제 한국어 UI 문구로 변환한다. */
function messageText(message: ClientMessage): string {
  switch (message.kind) {
    case "selectOwn":
      return strings.match.selectOwn;
    case "cannotSteal":
      return strings.match.cannotSteal;
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
  const turn = state.gameState?.turn ?? 0;
  const maxTurns = state.gameState?.maxTurns ?? 60;
  const isHumanTurn = state.phase === "humanTurn";

  return {
    scoreHome: score.home,
    scoreAway: score.away,
    turnText: `${turn} / ${maxTurns} ply`,
    status: state.message ? messageText(state.message) : phaseStatus(state),
    showStart: state.phase === "ready",
    showNewGame: state.phase === "finished" || state.phase === "fatalError",
    visibleActions: isHumanTurn ? [...state.availableActions] : [],
    selectedAction: isHumanTurn ? state.selectedAction : null,
    inputLocked: !isHumanTurn,
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

/** 골대 여백, 경기장과 13×9 격자를 매 프레임 처음부터 다시 그린다. */
function drawPitch(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  const { cell, originX, originY, boardRight } = BOARD_GEOMETRY;
  context.fillStyle = theme.board.line;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = theme.board.grass;
  context.fillRect(originX, originY, BOARD_W * cell, BOARD_H * cell);

  context.strokeStyle = theme.board.line;
  context.lineWidth = 1;
  for (let x = 0; x < BOARD_W; x += 1) {
    for (let y = 0; y < BOARD_H; y += 1) {
      context.strokeRect(originX + x * cell, originY + y * cell, cell, cell);
    }
  }

  context.strokeStyle = theme.board.pieceText;
  context.lineWidth = 3;
  context.strokeRect(0, 3 * cell, originX, 3 * cell);
  context.strokeRect(boardRight, 3 * cell, originX, 3 * cell);
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

/** 선택된 행동 후보는 채운 원으로, 직접 클릭 스틸 후보는 붉은 테두리로 구분한다. */
function drawCandidates(
  context: CanvasRenderingContext2D,
  gameState: GameState,
  state: ClientViewState,
): void {
  for (const move of state.candidateMoves) {
    const target = targetForMove(gameState, move);
    const center = targetCenter(target);
    if (!center) continue;

    if (move.kind === "steal") {
      strokeCircle(
        context,
        center.x,
        center.y,
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

/** 기물, 역할 문자, 공과 현재 선택 테두리를 상태 위에 그린다. */
function drawPieces(context: CanvasRenderingContext2D, state: ClientViewState): void {
  const gameState = state.gameState;
  if (!gameState) return;

  for (const piece of gameState.pieces) {
    const center = cellCenter(piece.pos);
    fillCircle(
      context,
      center.x,
      center.y,
      BOARD_GEOMETRY.cell * 0.35,
      piece.team === "home" ? theme.team.home : theme.team.away,
    );
    context.fillStyle = theme.board.pieceText;
    context.font = `bold ${Math.floor(BOARD_GEOMETRY.cell * 0.28)}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(piece.role, center.x, center.y);
  }

  if (gameState.ball.kind === "loose") {
    const center = cellCenter(gameState.ball.pos);
    fillCircle(context, center.x, center.y, BOARD_GEOMETRY.cell * 0.14, theme.board.ball);
  } else {
    const carrierId = gameState.ball.pieceId;
    const carrier = gameState.pieces.find((piece) => piece.id === carrierId);
    if (carrier) {
      const center = cellCenter(carrier.pos);
      fillCircle(
        context,
        center.x + BOARD_GEOMETRY.cell * 0.24,
        center.y - BOARD_GEOMETRY.cell * 0.24,
        BOARD_GEOMETRY.cell * 0.13,
        theme.board.ball,
      );
    }
  }

  const selected = gameState.pieces.find((piece) => piece.id === state.selectedPieceId);
  if (selected) {
    const center = cellCenter(selected.pos);
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

function drawCanvas(refs: RenderRefs, state: ClientViewState): void {
  drawPitch(refs.context, refs.canvas);
  if (!state.gameState) return;
  drawLastMove(refs.context, state);
  drawCandidates(refs.context, state.gameState, state);
  drawPieces(refs.context, state);
}

/**
 * 상태를 소유하지 않는 Renderer 함수를 만든다.
 * 반환 함수는 호출될 때마다 Canvas 전체와 관련 DOM 속성을 현재 상태로 덮어쓴다.
 */
export function createRenderer(refs: RenderRefs): (state: ClientViewState) => void {
  return (state) => {
    const presentation = buildPresentation(state);

    refs.scoreHome.textContent = String(presentation.scoreHome);
    refs.scoreAway.textContent = String(presentation.scoreAway);
    refs.turnInfo.textContent = presentation.turnText;
    refs.statusMessage.textContent = presentation.status;
    refs.startButton.hidden = !presentation.showStart;
    refs.startButton.disabled = !presentation.showStart;
    refs.newGameButton.hidden = !presentation.showNewGame;
    refs.newGameButton.disabled = !presentation.showNewGame;

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

    drawCanvas(refs, state);
  };
}
