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
import {
  BOARD_GEOMETRY,
  boardScaleAt,
  isTargetedMove,
  projectCellCenter,
  projectGoalCenter,
  projectPoint,
  targetForMove,
  unprojectPoint,
} from "./input";
import type { CanvasTarget, ClientAction, ClientMessage, ClientViewState } from "./types";

/** DOM에 표시할 값만 추린 상태 독립적인 표시 모델. */
export interface Presentation {
  scoreHome: number;
  scoreAway: number;
  turnText: string;
  status: string;
  showStart: boolean;
  showNewGame: boolean;
  /** 전술 선택 패널을 보여줄지 여부. 경기 시작 전과 종료 후에만 연다. */
  showTactics: boolean;
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
  /** 경기 시작 전 전술을 고르는 패널 요소. */
  tacticPanel: HTMLElement;
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
    showTactics:
      state.phase === "ready" ||
      state.phase === "finished" ||
      state.phase === "fatalError",
    showHold: isHumanTurn && state.canHold,
    showEndTurn: isHumanTurn && state.canEndTurn,
    visibleActions: isHumanTurn ? [...state.availableActions] : [],
    selectedAction: isHumanTurn ? state.selectedAction : null,
    inputLocked: !isHumanTurn,
    eventLines: state.events.slice(-EVENT_LINES_SHOWN).map(eventLine),
  };
}

/** 보드 칸의 바닥 중심 픽셀. 투영 계층의 이름을 렌더러 관례에 맞춰 재사용한다. */
function cellCenter(pos: Pos): { x: number; y: number } {
  return projectCellCenter(pos);
}

/** 해당 칸에 서 있는 기물 토큰의 화면 반지름. 멀수록 작아진다. */
export function tokenRadius(pos: Pos): number {
  return BOARD_GEOMETRY.cell * 0.35 * boardScaleAt(pos.y + 0.5);
}

/** 기물 토큰의 화면 중심. 바닥 중심에서 높이감만큼 띄운다. */
export function pieceTokenCenter(pos: Pos): { x: number; y: number } {
  const ground = projectCellCenter(pos);
  return { x: ground.x, y: ground.y - tokenRadius(pos) * 0.55 };
}

function targetCenter(target: CanvasTarget): { x: number; y: number } | null {
  if (target.kind === "cell") return cellCenter(target.pos);
  if (target.kind === "goal") return projectGoalCenter(target.side, target.row);
  return null;
}

/** 대상이 기물이 서 있는 칸이면 토큰 중심을, 아니면 바닥 중심을 반환한다. */
function targetScreenCenter(
  gameState: GameState,
  target: CanvasTarget,
): { x: number; y: number } | null {
  if (target.kind === "cell") {
    const occupant = gameState.pieces.find(
      (piece) => piece.pos.x === target.pos.x && piece.pos.y === target.pos.y,
    );
    return occupant ? pieceTokenCenter(occupant.pos) : cellCenter(target.pos);
  }
  return targetCenter(target);
}

/** 미리보기의 실제 수신자·차단자 ID를 Canvas 칸으로만 해석한다. */
function pieceTarget(gameState: GameState, pieceId: number): CanvasTarget | null {
  const piece = gameState.pieces.find((candidate) => candidate.id === pieceId);
  return piece ? { kind: "cell", pos: { ...piece.pos } } : null;
}

/** 논리 사각형(칸 단위)의 네 꼭짓점을 투영한 사다리꼴 경로를 만든다. */
function traceQuad(
  context: CanvasRenderingContext2D,
  fx0: number,
  fy0: number,
  fx1: number,
  fy1: number,
): void {
  const a = projectPoint(fx0, fy0);
  const b = projectPoint(fx1, fy0);
  const c = projectPoint(fx1, fy1);
  const d = projectPoint(fx0, fy1);
  context.beginPath();
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.lineTo(c.x, c.y);
  context.lineTo(d.x, d.y);
  context.lineTo(a.x, a.y);
}

/** 원근이 적용된 보드 칸 하나를 채운다. */
function fillCellQuad(context: CanvasRenderingContext2D, pos: Pos, color: string): void {
  traceQuad(context, pos.x, pos.y, pos.x + 1, pos.y + 1);
  context.fillStyle = color;
  context.fill();
}

/** 두 논리 좌표를 잇는 선을 투영해 그린다. */
function strokeBoardLine(
  context: CanvasRenderingContext2D,
  fx0: number,
  fy0: number,
  fx1: number,
  fy1: number,
): void {
  const from = projectPoint(fx0, fy0);
  const to = projectPoint(fx1, fy1);
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
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

/** 그라디언트·텍스처를 그릴 수 있는 실제 브라우저 컨텍스트인지 판별한다. 테스트 대역에서는 false다. */
function supportsFancyPaint(context: CanvasRenderingContext2D): boolean {
  return typeof context.createLinearGradient === "function";
}

/** 결정적 의사난수 생성기. 배경 텍스처가 매 실행 같은 모양이 되게 한다. */
function createRandom(seedInit: number): () => number {
  let seed = seedInit >>> 0;
  return () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 0x1_0000_0000;
  };
}

/** 관중석: 어두운 상하 그라디언트 위에 관중처럼 보이는 색 점을 흩뿌린다. */
function drawStands(
  context: CanvasRenderingContext2D,
  canvas: { width: number; height: number },
): void {
  context.fillStyle = theme.board.stadium;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!supportsFancyPaint(context)) return;

  const backdrop = context.createLinearGradient(0, 0, 0, canvas.height);
  backdrop.addColorStop(0, "rgba(58, 74, 46, 0.55)");
  backdrop.addColorStop(0.4, "rgba(20, 27, 14, 0.2)");
  backdrop.addColorStop(1, "rgba(0, 0, 0, 0.4)");
  context.fillStyle = backdrop;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // 경기장·골대 영역을 피해서 관중 점을 뿌린다.
  const random = createRandom(0x5eed);
  const crowdColors = ["#c9c2b4", "#8f9aa8", "#b08c6e", "#6f7d5a", "#a06a6a", "#5d6f8f"];
  for (let index = 0; index < 1600; index += 1) {
    const px = random() * canvas.width;
    const py = random() * canvas.height;
    const { fx, fy } = unprojectPoint(px, py);
    if (fx > -1.4 && fx < BOARD_W + 1.4 && fy > -0.4 && fy < BOARD_H + 0.4) continue;
    context.globalAlpha = 0.16 + random() * 0.2;
    context.fillStyle = crowdColors[Math.floor(random() * crowdColors.length)]!;
    context.fillRect(px, py, 2.4, 2.4);
  }
  context.globalAlpha = 1;
}

/** 잔디 결, 깎기 밴드, 원근 대기감을 잔디 위에 얹는다. 실제 브라우저에서만 그린다. */
function drawGrassDetail(context: CanvasRenderingContext2D): void {
  if (!supportsFancyPaint(context)) return;

  // 풀 결: 짧은 세로 획을 결정적 난수로 흩뿌린다. 가까울수록 길다.
  const random = createRandom(0x6ea55);
  for (let index = 0; index < 2400; index += 1) {
    const fx = random() * BOARD_W;
    const fy = random() * BOARD_H;
    const point = projectPoint(fx, fy);
    const scale = boardScaleAt(fy);
    context.globalAlpha = 0.05 + random() * 0.07;
    context.fillStyle = random() < 0.5 ? "#0c2e17" : "#a9e3bb";
    context.fillRect(point.x, point.y, 1.2, 2.6 * scale);
  }
  context.globalAlpha = 1;

  // 가로 깎기 밴드: 두 행마다 옅은 광택 띠를 얹어 기계로 깎은 잔디 느낌을 준다.
  for (let row = 0; row < BOARD_H; row += 2) {
    traceQuad(context, 0, row, BOARD_W, row + 1);
    context.fillStyle = "#ffffff";
    context.globalAlpha = 0.035;
    context.fill();
  }
  context.globalAlpha = 1;

  // 원근 대기감: 먼 쪽(위)은 어둡고 가까운 쪽은 살짝 밝아지는 세로 그라디언트.
  const depth = context.createLinearGradient(
    0,
    BOARD_GEOMETRY.originY,
    0,
    BOARD_GEOMETRY.originY + BOARD_H * BOARD_GEOMETRY.rowH,
  );
  depth.addColorStop(0, "rgba(6, 12, 6, 0.36)");
  depth.addColorStop(0.55, "rgba(6, 12, 6, 0.06)");
  depth.addColorStop(1, "rgba(255, 255, 255, 0.05)");
  traceQuad(context, 0, 0, BOARD_W, BOARD_H);
  context.fillStyle = depth;
  context.fill();
}

/** 화면 가장자리를 어둡게 눌러 조명이 중앙에 모인 경기장 분위기를 만든다. */
function drawVignette(
  context: CanvasRenderingContext2D,
  canvas: { width: number; height: number },
): void {
  if (!supportsFancyPaint(context)) return;
  const vignette = context.createRadialGradient(600, 350, 250, 600, 380, 760);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.5)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, canvas.width, canvas.height);
}

/** 한쪽 골대를 세로 포스트, 크로스바, 뒤로 기울어진 그물과 함께 입체로 그린다. */
function drawGoal3D(context: CanvasRenderingContext2D, side: "left" | "right"): void {
  const front = side === "left" ? 0 : BOARD_W;
  const back = side === "left" ? -0.85 : BOARD_W + 0.85;
  const height = BOARD_GEOMETRY.cell * 0.8 * boardScaleAt(4.5);

  // 골문 바닥의 어두운 그물 영역
  context.globalAlpha = 0.55;
  traceQuad(context, Math.min(front, back), 3, Math.max(front, back), 6);
  context.fillStyle = theme.board.stadium;
  context.fill();
  context.globalAlpha = 1;

  const groundAt = (fy: number) => projectPoint(front, fy);
  const topAt = (fy: number) => {
    const point = projectPoint(front, fy);
    return { x: point.x, y: point.y - height };
  };

  // 그물: 크로스바에서 바닥 뒤편으로 흘러내리는 세로줄과 가로줄
  context.strokeStyle = theme.board.net;
  context.globalAlpha = 0.5;
  context.lineWidth = 1;
  for (let step = 0; step <= 6; step += 1) {
    const fy = 3 + step * 0.5;
    const top = topAt(fy);
    const backGround = projectPoint(back, fy);
    context.beginPath();
    context.moveTo(top.x, top.y);
    context.lineTo(backGround.x, backGround.y);
    context.stroke();
  }
  // 가로 그물: 크로스바와 바닥 사이를 일정 비율로 가로지르는 줄
  for (const ratio of [0.3, 0.55, 0.8]) {
    const leftTop = topAt(3);
    const rightTop = topAt(6);
    const leftBack = projectPoint(back, 3);
    const rightBack = projectPoint(back, 6);
    context.beginPath();
    context.moveTo(
      leftTop.x + (leftBack.x - leftTop.x) * ratio,
      leftTop.y + (leftBack.y - leftTop.y) * ratio,
    );
    context.lineTo(
      rightTop.x + (rightBack.x - rightTop.x) * ratio,
      rightTop.y + (rightBack.y - rightTop.y) * ratio,
    );
    context.stroke();
  }
  strokeBoardLine(context, back, 3, back, 6);
  context.globalAlpha = 1;

  // 포스트 두 개와 크로스바. 어두운 선을 살짝 어긋나게 먼저 그려 둥근 기둥의 음영을 만든다.
  for (const [color, offset, width] of [
    ["#1c231a", 2.5, 6],
    [theme.board.chalk, 0, 5],
  ] as const) {
    context.strokeStyle = color;
    context.lineWidth = width;
    for (const fy of [3, 6]) {
      const ground = groundAt(fy);
      const top = topAt(fy);
      context.beginPath();
      context.moveTo(ground.x + offset, ground.y);
      context.lineTo(top.x + offset, top.y);
      context.stroke();
    }
    const barLeft = topAt(3);
    const barRight = topAt(6);
    context.beginPath();
    context.moveTo(barLeft.x + offset, barLeft.y + offset);
    context.lineTo(barRight.x + offset, barRight.y + offset);
    context.stroke();
  }
}

/** 관중석, 원근 잔디 스트라이프, 석회 라인과 양쪽 입체 골문을 처음부터 그린다. */
function drawPitch(
  context: CanvasRenderingContext2D,
  canvas: { width: number; height: number },
): void {
  drawStands(context, canvas);

  // 잔디: 열마다 명암을 교차하는 사다리꼴 스트라이프
  for (let x = 0; x < BOARD_W; x += 1) {
    traceQuad(context, x, 0, x + 1, BOARD_H);
    context.fillStyle = x % 2 === 0 ? theme.board.grassLight : theme.board.grassDark;
    context.fill();
  }
  drawGrassDetail(context);

  // 게임 입력용 칸 경계는 아주 희미하게만 남긴다.
  context.strokeStyle = theme.board.chalk;
  context.globalAlpha = 0.08;
  context.lineWidth = 1;
  for (let x = 1; x < BOARD_W; x += 1) strokeBoardLine(context, x, 0, x, BOARD_H);
  for (let y = 1; y < BOARD_H; y += 1) strokeBoardLine(context, 0, y, BOARD_W, y);
  context.globalAlpha = 1;

  // 석회 라인: 외곽, 센터라인, 센터서클, 양쪽 페널티 박스(GK 박스 영역과 일치)
  context.strokeStyle = theme.board.chalk;
  context.globalAlpha = 0.8;
  context.lineWidth = 3;
  traceQuad(context, 0, 0, BOARD_W, BOARD_H);
  context.stroke();
  strokeBoardLine(context, BOARD_W / 2, 0, BOARD_W / 2, BOARD_H);
  // 센터서클은 논리 원을 촘촘한 선분으로 투영해 원근에 맞는 타원이 되게 한다.
  context.beginPath();
  for (let step = 0; step <= 32; step += 1) {
    const angle = (step / 32) * Math.PI * 2;
    const point = projectPoint(
      BOARD_W / 2 + Math.cos(angle) * 1.3,
      BOARD_H / 2 + Math.sin(angle) * 1.3,
    );
    if (step === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.stroke();
  traceQuad(context, 0, 2, 2, 7);
  context.stroke();
  traceQuad(context, BOARD_W - 2, 2, BOARD_W, 7);
  context.stroke();
  context.globalAlpha = 1;

  drawGoal3D(context, "left");
  drawGoal3D(context, "right");
  drawVignette(context, canvas);
}

/** 정적 배경을 오프스크린 캔버스에 한 번만 그려두고 매 프레임 복사한다. */
let staticBackground: HTMLCanvasElement | null = null;

function drawBackground(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  if (typeof document === "undefined" || typeof context.drawImage !== "function") {
    // 테스트 대역처럼 오프스크린을 만들 수 없는 환경에서는 직접 그린다.
    drawPitch(context, canvas);
    return;
  }
  if (!staticBackground) {
    const layer = document.createElement("canvas");
    layer.width = BOARD_GEOMETRY.canvasWidth;
    layer.height = BOARD_GEOMETRY.canvasHeight;
    const layerContext = layer.getContext("2d");
    if (!layerContext) {
      drawPitch(context, canvas);
      return;
    }
    drawPitch(layerContext, layer);
    staticBackground = layer;
  }
  context.drawImage(staticBackground, 0, 0);
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
  resolvedTarget: { x: number; y: number } | null,
  preview: Extract<MovePreview, { kind: "pass" | "shoot" }>,
  detailed: boolean,
): void {
  const chance = preview.kind === "pass" ? preview.arrivalChance : preview.goalChance;
  const successful = preview.kind === "pass" ? preview.reachesTarget : chance >= 1;
  const color = successful ? theme.board.pathSuccess : theme.board.pathBlocked;

  // 모든 후보를 한 번에 보여주는 기본 모드에서는 칸 채우기를 생략해 화면을 가볍게 유지한다.
  if (detailed) {
    context.globalAlpha = 0.22;
    for (const pos of preview.path) {
      fillCellQuad(context, pos, color);
    }
    context.globalAlpha = 1;
  }

  const from = pieceTokenCenter(actor);
  const to = resolvedTarget;
  if (!to) return;
  context.strokeStyle = color;
  context.setLineDash([]);
  context.lineWidth = detailed ? 5 : 3;
  context.globalAlpha = detailed ? 1 : 0.75;
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.globalAlpha = 1;
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

    // 득점 확률이 높은 위협 레인일수록 진하게 칠해 어디를 먼저 막을지 알 수 있게 한다.
    context.globalAlpha = 0.08 + preview.goalChance * 0.25;
    for (const pos of preview.path) {
      fillCellQuad(context, pos, theme.board.threat);
    }
    context.globalAlpha = 1;

    // away는 왼쪽 골문을 공격하므로 위협 확률은 왼쪽 골문 칸 옆에 표기한다.
    const label = projectGoalCenter("left", preview.goalRow);
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
    if (resolvedTarget) {
      drawPreviewPath(
        context,
        actor.pos,
        targetScreenCenter(gameState, resolvedTarget),
        preview,
        state.selectedAction !== null,
      );
    }
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
    const center = targetScreenCenter(gameState, target);
    if (!center) continue;

    if (move.kind === "steal") {
      const stealer =
        state.selectedStealTargetId === null
          ? null
          : gameState.pieces.find((piece) => piece.id === move.pieceId);
      const ringPos =
        stealer?.pos ?? (target.kind === "cell" ? target.pos : null);
      const ringCenter = stealer ? pieceTokenCenter(stealer.pos) : center;
      strokeCircle(
        context,
        ringCenter.x,
        ringCenter.y,
        ringPos ? tokenRadius(ringPos) + 6 : BOARD_GEOMETRY.cell * 0.4,
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
        tokenRadius(target.pos) + 6,
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
    const dotScale = target.kind === "cell" ? boardScaleAt(target.pos.y + 0.5) : 1;
    fillCircle(context, center.x, center.y, BOARD_GEOMETRY.cell * 0.13 * dotScale, color);
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
      const scale = boardScaleAt(preview.reboundPos.y + 0.5);
      strokeCircle(context, rebound.x, rebound.y, BOARD_GEOMETRY.cell * 0.24 * scale, theme.board.rebound, 5);
      strokeCircle(context, rebound.x, rebound.y, BOARD_GEOMETRY.cell * 0.32 * scale, theme.board.rebound, 3);
    }
    const pieceId =
      preview.kind === "pass"
        ? preview.receiverPieceId
        : preview.kind === "shoot" && preview.outcome !== "goal"
          ? preview.blockerPieceId
          : null;
    if (pieceId === null) continue;
    // 수신자·차단자 이중 강조는 행동을 좁혀 본 상세 모드에서만 그려 화면을 가볍게 유지한다.
    if (state.selectedAction === null) continue;
    const piece = gameState.pieces.find((candidate) => candidate.id === pieceId);
    if (!piece) continue;
    const center = pieceTokenCenter(piece.pos);
    const radius = tokenRadius(piece.pos);
    strokeCircle(context, center.x, center.y, radius + 7, theme.board.actualReceiver, 4);
    strokeCircle(context, center.x, center.y, radius + 12, theme.board.actualReceiver, 3);
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
    const center = pieceTokenCenter(carrier.pos);
    context.fillStyle = theme.board.protected;
    context.font = `bold ${Math.floor(BOARD_GEOMETRY.cell * 0.3)}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("◆", center.x, center.y - tokenRadius(carrier.pos) - 10);
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
  // 클래식 축구공 패턴: 가운데 오각형 점과 주변 다섯 점
  context.globalAlpha = 0.6;
  fillCircle(context, x, y, radius * 0.3, "#1d221c");
  for (let index = 0; index < 5; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / 5;
    fillCircle(
      context,
      x + Math.cos(angle) * radius * 0.72,
      y + Math.sin(angle) * radius * 0.72,
      radius * 0.18,
      "#1d221c",
    );
  }
  // 왼쪽 위 하이라이트
  context.globalAlpha = 0.5;
  fillCircle(context, x - radius * 0.32, y - radius * 0.32, radius * 0.22, "#ffffff");
  context.globalAlpha = 1;
}

/** 바닥 그림자를 납작한 타원으로 그린다. 타원을 지원하지 않는 환경에서는 원으로 대체한다. */
function fillGroundShadow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
): void {
  context.fillStyle = "#000000";
  context.beginPath();
  if (typeof context.ellipse === "function") {
    context.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
  } else {
    context.arc(x, y, radiusY, 0, Math.PI * 2);
  }
  context.fill();
}

/** 두 점을 잇는 굵은 선 하나. 팔·다리를 그리는 데 쓴다. */
function strokeLimb(
  context: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  color: string,
  width: number,
): void {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(fromX, fromY);
  context.lineTo(toX, toY);
  context.stroke();
}

/**
 * 머리·유니폼·반바지·팔다리를 갖춘 미니 선수 피규어를 절차적으로 그린다.
 *
 * `center`는 기존 원형 토큰과 같은 몸통 중심이고 `radius`는 전체 크기 기준이다.
 * 선택 링·◆ 같은 오버레이가 같은 중심·반지름을 계속 쓸 수 있도록 좌표 계약을 유지한다.
 * GK는 유니폼과 반바지 배색을 뒤집어 필드 선수와 구분한다.
 */
function drawPlayerFigure(
  context: CanvasRenderingContext2D,
  center: { x: number; y: number },
  radius: number,
  team: "home" | "away",
  role: string,
): void {
  const teamColor = team === "home" ? theme.team.home : theme.team.away;
  const darkColor = team === "home" ? theme.team.homeDark : theme.team.awayDark;
  const jersey = role === "GK" ? darkColor : teamColor;
  const shorts = role === "GK" ? teamColor : darkColor;
  const { x, y } = center;
  const baseAlpha = context.globalAlpha;

  // 다리: 허벅지는 살색, 무릎 아래는 팀 색 양말, 발끝은 검은 축구화
  strokeLimb(context, x - radius * 0.17, y + radius * 0.28, x - radius * 0.21, y + radius * 0.5, theme.board.skin, radius * 0.15);
  strokeLimb(context, x + radius * 0.17, y + radius * 0.28, x + radius * 0.21, y + radius * 0.5, theme.board.skin, radius * 0.15);
  strokeLimb(context, x - radius * 0.21, y + radius * 0.48, x - radius * 0.24, y + radius * 0.7, jersey, radius * 0.16);
  strokeLimb(context, x + radius * 0.21, y + radius * 0.48, x + radius * 0.24, y + radius * 0.7, jersey, radius * 0.16);
  fillCircle(context, x - radius * 0.26, y + radius * 0.74, radius * 0.11, "#15161a");
  fillCircle(context, x + radius * 0.26, y + radius * 0.74, radius * 0.11, "#15161a");

  // 반바지: 허리에서 허벅지까지의 사다리꼴과 양옆 흰 줄무늬
  context.fillStyle = shorts;
  context.beginPath();
  context.moveTo(x - radius * 0.34, y + radius * 0.08);
  context.lineTo(x + radius * 0.34, y + radius * 0.08);
  context.lineTo(x + radius * 0.3, y + radius * 0.38);
  context.lineTo(x - radius * 0.3, y + radius * 0.38);
  context.lineTo(x - radius * 0.34, y + radius * 0.08);
  context.fill();
  context.globalAlpha = baseAlpha * 0.7;
  strokeLimb(context, x - radius * 0.31, y + radius * 0.1, x - radius * 0.28, y + radius * 0.36, theme.board.chalk, 1.6);
  strokeLimb(context, x + radius * 0.31, y + radius * 0.1, x + radius * 0.28, y + radius * 0.36, theme.board.chalk, 1.6);
  context.globalAlpha = baseAlpha;

  // 팔: 어두운 윤곽 위에 유니폼 색 소매를 겹쳐 그리고 손은 살색 점으로 마감
  strokeLimb(context, x - radius * 0.42, y - radius * 0.3, x - radius * 0.58, y + radius * 0.1, "#15161a", radius * 0.2);
  strokeLimb(context, x + radius * 0.42, y - radius * 0.3, x + radius * 0.58, y + radius * 0.1, "#15161a", radius * 0.2);
  strokeLimb(context, x - radius * 0.42, y - radius * 0.3, x - radius * 0.58, y + radius * 0.1, jersey, radius * 0.15);
  strokeLimb(context, x + radius * 0.42, y - radius * 0.3, x + radius * 0.58, y + radius * 0.1, jersey, radius * 0.15);
  fillCircle(context, x - radius * 0.58, y + radius * 0.14, radius * 0.09, theme.board.skin);
  fillCircle(context, x + radius * 0.58, y + radius * 0.14, radius * 0.09, theme.board.skin);

  // 몸통(유니폼): 어깨가 넓고 허리가 좁은 사다리꼴 + 만화풍 외곽선
  context.fillStyle = jersey;
  context.beginPath();
  context.moveTo(x - radius * 0.46, y - radius * 0.38);
  context.lineTo(x + radius * 0.46, y - radius * 0.38);
  context.lineTo(x + radius * 0.34, y + radius * 0.14);
  context.lineTo(x - radius * 0.34, y + radius * 0.14);
  context.lineTo(x - radius * 0.46, y - radius * 0.38);
  context.fill();
  context.globalAlpha = baseAlpha * 0.55;
  context.strokeStyle = "#0d0f0c";
  context.lineWidth = 2;
  context.stroke();
  context.globalAlpha = baseAlpha;

  // 유니폼 음영: 오른쪽 절반을 살짝 어둡게 눌러 입체감을 만든다.
  context.globalAlpha = baseAlpha * 0.18;
  context.fillStyle = "#000000";
  context.beginPath();
  context.moveTo(x, y - radius * 0.38);
  context.lineTo(x + radius * 0.46, y - radius * 0.38);
  context.lineTo(x + radius * 0.34, y + radius * 0.14);
  context.lineTo(x, y + radius * 0.14);
  context.lineTo(x, y - radius * 0.38);
  context.fill();
  context.globalAlpha = baseAlpha;

  // 카라: 목선의 밝은 브이넥
  context.globalAlpha = baseAlpha * 0.8;
  strokeLimb(context, x - radius * 0.12, y - radius * 0.37, x, y - radius * 0.28, theme.board.chalk, 1.6);
  strokeLimb(context, x + radius * 0.12, y - radius * 0.37, x, y - radius * 0.28, theme.board.chalk, 1.6);
  context.globalAlpha = baseAlpha;

  // 머리: 살색 얼굴, 머리카락, 왼쪽 위 하이라이트
  fillCircle(context, x, y - radius * 0.62, radius * 0.28, theme.board.skin);
  context.globalAlpha = baseAlpha * 0.9;
  fillCircle(context, x - radius * 0.02, y - radius * 0.75, radius * 0.21, "#2b2119");
  context.globalAlpha = baseAlpha * 0.35;
  fillCircle(context, x - radius * 0.1, y - radius * 0.68, radius * 0.07, "#ffffff");
  context.globalAlpha = baseAlpha;

  // 가슴의 역할 문자
  context.fillStyle = theme.board.pieceText;
  context.font = `bold ${Math.floor(radius * 0.42)}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(role, x, y - radius * 0.12);
}

/** 기물, 역할 문자, 공과 현재 선택 테두리를 상태 위에 그린다. */
function drawPieces(
  context: CanvasRenderingContext2D,
  state: ClientViewState,
  overrides?: FrameOverrides,
): void {
  const gameState = state.gameState;
  if (!gameState) return;
  const centerOf = (piece: { id: number; pos: Pos }) =>
    overrides?.pieceCenters?.get(piece.id) ?? pieceTokenCenter(piece.pos);

  // 뒤(위쪽 행)부터 그려 앞의 기물이 자연스럽게 겹치게 한다.
  const painterOrder = [...gameState.pieces].sort(
    (left, right) => left.pos.y - right.pos.y || left.pos.x - right.pos.x,
  );

  for (const piece of painterOrder) {
    const center = centerOf(piece);
    const radius = tokenRadius(piece.pos);
    // 팀 턴 행동을 다 쓴 현재 팀 선수는 흐리게 그려 "선택해도 소용없음"을 보여준다.
    const usedActions = gameState.actionCountByPiece[piece.id] ?? 0;
    const isActiveTeam = piece.team === gameState.activeTeam;
    const exhausted = isActiveTeam && usedActions >= 2;
    const baseAlpha = exhausted ? 0.4 : 1;

    // 바닥 그림자 위에 미니 선수 피규어를 세운다.
    context.globalAlpha = 0.28 * baseAlpha;
    fillGroundShadow(context, center.x + 2, center.y + radius * 0.78, radius * 0.6, radius * 0.22);
    context.globalAlpha = baseAlpha;
    drawPlayerFigure(context, center, radius, piece.team, piece.role);
    context.globalAlpha = 1;

    // 현재 팀 턴에 이미 쓴 행동 수를 발밑 아래 작은 점으로 표시한다.
    if (isActiveTeam && usedActions > 0) {
      for (let dot = 0; dot < usedActions; dot += 1) {
        fillCircle(
          context,
          center.x - 6 + dot * 12,
          center.y + radius * 0.98,
          3.5,
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
        strokeCircle(context, center.x, center.y, radius + 4, stateColor, 5);
      }
    }
  }

  if (!overrides?.hideBall) {
    if (gameState.ball.kind === "loose") {
      const center = cellCenter(gameState.ball.pos);
      const scale = boardScaleAt(gameState.ball.pos.y + 0.5);
      drawBall(context, center.x, center.y - 6 * scale, BOARD_GEOMETRY.cell * 0.14 * scale);
    } else {
      const carrierId = gameState.ball.pieceId;
      const carrier = gameState.pieces.find((piece) => piece.id === carrierId);
      if (carrier) {
        const center = centerOf(carrier);
        const radius = tokenRadius(carrier.pos);
        drawBall(context, center.x + radius * 0.75, center.y + radius * 0.55, radius * 0.38);
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
      tokenRadius(selected.pos) + 8,
      theme.board.selected,
      6,
    );
  }
}

/** 현재 팀의 남은 행동 포인트를 그 팀 공격 진영 위쪽 모서리에 3개의 pip으로 표시한다. */
function drawActionPoints(context: CanvasRenderingContext2D, gameState: GameState): void {
  const x = gameState.activeTeam === "home" ? 42 : BOARD_GEOMETRY.canvasWidth - 42;
  const teamColor = gameState.activeTeam === "home" ? theme.team.home : theme.team.away;

  for (let index = 0; index < 3; index += 1) {
    const y = 30 + index * 32;
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
  drawBackground(context, refs.canvas);
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
    const center = projectPoint(BOARD_W / 2, BOARD_H / 2);
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
    // 이동 애니메이션은 토큰 중심(높이감 포함) 사이를 보간한다.
    return {
      durationMs: 200,
      kind: "pieceMove",
      pieceId: lastMove.move.pieceId,
      fromPx: pieceTokenCenter(lastMove.from),
      toPx: pieceTokenCenter(lastMove.move.to),
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
    refs.tacticPanel.hidden = !presentation.showTactics;
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
