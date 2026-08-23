/**
 * 브라우저 진입점.
 *
 * 이 파일은 게임 규칙을 직접 구현하지 않는다. HTML 요소를 찾고 Renderer,
 * EngineClient, GameController를 조립한 뒤 사용자 입력을 Controller에 전달한다.
 */

import strings from "../../content/strings.json";
import { createEngineClient } from "./engineClient";
import { createGameController } from "./gameController";
import { canvasPointToTarget } from "./input";
import { createRenderer, type RenderRefs } from "./render";
import type { ClientAction } from "./types";

/**
 * CSS 선택자에 해당하는 필수 HTML 요소를 가져온다.
 *
 * `T`는 호출하는 쪽이 기대하는 구체적인 요소 타입이다. 예를 들어
 * `requireElement<HTMLCanvasElement>("#board")`의 반환값은 Canvas 전용 API를
 * 사용할 수 있는 타입이 된다. 요소가 빠진 경우에는 뒤늦게 알 수 없는 오류를
 * 내는 대신 앱 시작 시점에 원인이 드러나는 오류를 발생시킨다.
 */
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`필수 DOM 요소가 없습니다: ${selector}`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#board");
const context = canvas.getContext("2d");
if (!context) throw new Error("Canvas 2D context를 사용할 수 없습니다.");

const actionButtons: Record<ClientAction, HTMLButtonElement> = {
  move: requireElement<HTMLButtonElement>("#action-move"),
  pass: requireElement<HTMLButtonElement>("#action-pass"),
  shoot: requireElement<HTMLButtonElement>("#action-shoot"),
};

const refs: RenderRefs = {
  canvas,
  context,
  scoreHome: requireElement<HTMLElement>("#score-home"),
  scoreAway: requireElement<HTMLElement>("#score-away"),
  turnInfo: requireElement<HTMLElement>("#turn-info"),
  statusMessage: requireElement<HTMLElement>("#status-message"),
  startButton: requireElement<HTMLButtonElement>("#start-game"),
  newGameButton: requireElement<HTMLButtonElement>("#new-game"),
  holdButton: requireElement<HTMLButtonElement>("#action-hold"),
  endTurnButton: requireElement<HTMLButtonElement>("#end-turn"),
  actionButtons,
  eventLog: requireElement<HTMLElement>("#event-log"),
  tacticPanel: requireElement<HTMLElement>("#tactic-panel"),
};

// 전술 선택: 팀별 4버튼 중 하나를 토글하고 게임 시작 시 엔진에 전달한다.
const TEAM_STYLES = ["balanced", "tikitaka", "counter", "gegenpress"] as const;
type TeamStyleChoice = (typeof TEAM_STYLES)[number];
const selectedStyles: Record<"home" | "away", TeamStyleChoice> = {
  home: "balanced",
  away: "balanced",
};
const tacticButtons: Record<"home" | "away", Record<TeamStyleChoice, HTMLButtonElement>> = {
  home: Object.fromEntries(
    TEAM_STYLES.map((style) => [style, requireElement<HTMLButtonElement>(`#tactic-home-${style}`)]),
  ) as Record<TeamStyleChoice, HTMLButtonElement>,
  away: Object.fromEntries(
    TEAM_STYLES.map((style) => [style, requireElement<HTMLButtonElement>(`#tactic-away-${style}`)]),
  ) as Record<TeamStyleChoice, HTMLButtonElement>,
};

function selectTactic(team: "home" | "away", style: TeamStyleChoice): void {
  selectedStyles[team] = style;
  for (const candidate of TEAM_STYLES) {
    tacticButtons[team][candidate].setAttribute(
      "aria-pressed",
      String(candidate === style),
    );
  }
}

for (const team of ["home", "away"] as const) {
  for (const style of TEAM_STYLES) {
    tacticButtons[team][style].addEventListener("click", () => selectTactic(team, style));
  }
}

document.title = strings.app.title;

// Controller의 상태 변경 알림이 곧 한 번의 화면 갱신이 되도록 연결한다.
// 실제 브라우저에서는 직전 수(이동·패스·슛·득점)를 짧은 애니메이션으로 연출한다.
const render = createRenderer(refs, { animate: true });
const engineClient = createEngineClient({ timeoutMs: 5_000 });
const controller = createGameController({ engineClient, onChange: render });

// Controller 생성 직후에는 상태 변경이 없으므로 ready 화면을 한 번 직접 그린다.
render(controller.getViewState());

refs.startButton.addEventListener("click", () => controller.startGame({ ...selectedStyles }));
refs.newGameButton.addEventListener("click", () => controller.restartGame({ ...selectedStyles }));
refs.holdButton.addEventListener("click", () => controller.holdBall());
refs.endTurnButton.addEventListener("click", () => controller.endTurn());

for (const action of Object.keys(actionButtons) as ClientAction[]) {
  actionButtons[action].addEventListener("click", () => controller.selectAction(action));
}

canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();

  // CSS로 Canvas가 확대·축소되어도 내부 픽셀 좌표로 보정한다.
  const canvasX = (event.clientX - rect.left) * (canvas.width / rect.width);
  const canvasY = (event.clientY - rect.top) * (canvas.height / rect.height);

  controller.handleTarget(canvasPointToTarget(canvasX, canvasY));
});

// 페이지를 떠날 때 대기 중인 요청과 Worker도 함께 정리한다.
window.addEventListener("beforeunload", () => controller.dispose());
