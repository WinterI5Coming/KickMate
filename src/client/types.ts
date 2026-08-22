/**
 * 브라우저 클라이언트가 대국 흐름과 화면 표시를 위해 사용하는 상태 계약.
 *
 * 게임 규칙 자체는 `src/engine/`의 타입과 함수가 소유한다. 이 모듈에는 선택된 기물,
 * 화면 단계, 안내 종류처럼 엔진 상태에는 들어갈 필요가 없는 UI 정보만 둔다.
 */

import type { GameState, Move, MovePreview, Pos, Team } from "../engine/types";

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
  | { kind: "chooseReceiver" }
  | { kind: "chooseGoal" }
  | { kind: "chooseStealer" }
  | { kind: "protectedCarrier" }
  | { kind: "pressuredCarrier" }
  | { kind: "exhaustedPiece" }
  | { kind: "invalidShot" }
  | { kind: "botRetry"; attempt: number; maxAttempts: number }
  | { kind: "fatalError" };

/**
 * 이벤트 로그에 남기는 공 관련 사건 하나.
 *
 * Controller가 의미만 기록하고 실제 한국어 문구는 Renderer가 `strings.json`으로
 * 조립한다. 일반 이동은 소음이 되므로 기록하지 않는다.
 */
export interface MatchEvent {
  team: Team;
  kind:
    | "pass"
    | "passIntercepted"
    | "shotGoal"
    | "shotSaved"
    | "shotBlocked"
    | "steal"
    | "hold";
  /** 실행 전 미리보기의 성공 확률(0..100 정수). 패스·슛에만 존재한다. */
  chancePercent?: number;
}

/** 득점 후 킥오프로 배치가 바뀌어도 직전 수를 다시 그릴 수 있는 기록. */
export interface LastMove {
  move: Move;
  from: Pos;
  target: CanvasTarget;
}

/** 하나의 합법 수와 그 수를 적용하기 전에 계산한 엔진 판정을 묶은 화면 후보. */
export interface CandidatePreview {
  move: Move;
  preview: MovePreview;
}

/** Controller가 Renderer에 한 번에 전달하는 전체 화면 상태. */
export interface ClientViewState {
  phase: GamePhase;
  gameState: GameState | null;
  /** 현재 상태에서 압박받은 공 소유자가 버티기를 실행할 수 있는지 여부. */
  canHold: boolean;
  /** 현재 팀이 한 행동 이상 수행해 턴을 조기 종료할 수 있는지 여부. */
  canEndTurn: boolean;
  selectedPieceId: number | null;
  selectedAction: ClientAction | null;
  availableActions: ClientAction[];
  candidateMoves: Move[];
  candidatePreviews: CandidatePreview[];
  /** 복수 스틸러 중 하나를 고르는 동안 선택된 상대 공 소유자 ID. */
  selectedStealTargetId: number | null;
  /** 사람 턴에 상대 공 소유자가 현재 위치에서 시도할 수 있는 슛 위협 미리보기. */
  threatShots: CandidatePreview[];
  /** 최근 공 관련 사건. 오래된 것이 앞에 온다. */
  events: MatchEvent[];
  lastMove: LastMove | null;
  botAttempt: number;
  message: ClientMessage | null;
}
