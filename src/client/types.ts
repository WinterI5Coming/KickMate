/**
 * 브라우저 클라이언트가 대국 흐름과 화면 표시를 위해 사용하는 상태 계약.
 *
 * 게임 규칙 자체는 `src/engine/`의 타입과 함수가 소유한다. 이 모듈에는 선택된 기물,
 * 화면 단계, 안내 종류처럼 엔진 상태에는 들어갈 필요가 없는 UI 정보만 둔다.
 */

import type { GameState, Move, Pos } from "../engine/types";

/** 사용자가 보고 있는 대국 화면의 생명주기 단계. */
export type GamePhase =
  | "ready"
  | "humanTurn"
  | "botThinking"
  | "finished"
  | "fatalError";

/** HTML 버튼으로 선택하는 행동. 스틸은 상대 기물을 직접 클릭하므로 포함하지 않는다. */
export type ClientAction = "move" | "pass" | "shoot";

/** Canvas 클릭이 가리키는 게임 공간상의 대상. */
export type CanvasTarget =
  | { kind: "cell"; pos: Pos }
  | { kind: "goal"; side: "left" | "right"; row: number }
  | { kind: "outside" };

/** Controller가 구체적인 한국어 문구 대신 Renderer에 전달하는 안내의 의미. */
export type ClientMessage =
  | { kind: "selectOwn" }
  | { kind: "cannotSteal" }
  | { kind: "invalidShot" }
  | { kind: "botRetry"; attempt: number; maxAttempts: number }
  | { kind: "fatalError" };

/** 득점 후 킥오프로 배치가 바뀌어도 직전 수를 다시 그릴 수 있는 기록. */
export interface LastMove {
  move: Move;
  from: Pos;
  target: CanvasTarget;
}

/** Controller가 Renderer에 한 번에 전달하는 전체 화면 상태. */
export interface ClientViewState {
  phase: GamePhase;
  gameState: GameState | null;
  selectedPieceId: number | null;
  selectedAction: ClientAction | null;
  availableActions: ClientAction[];
  candidateMoves: Move[];
  lastMove: LastMove | null;
  botAttempt: number;
  message: ClientMessage | null;
}
