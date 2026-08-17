/**
 * 한 경기의 엔진 상태와 브라우저 UI 상태를 함께 소유하는 Controller.
 *
 * 엔진은 `GameState → GameState` 계산만 담당한다. 이 모듈은 어떤 기물과 행동이
 * 선택됐는지, 지금 사람과 봇 중 누구의 차례인지, Renderer를 언제 다시 호출할지를
 * 결정한다.
 */

import { applyMove, createInitialState, gameResult, legalMoves } from "../engine/rules";
import type { GameState, Move } from "../engine/types";
import type { EngineClient } from "./engineClient";
import { moveMatchesTarget, targetForMove } from "./input";
import type { CanvasTarget, ClientAction, ClientViewState } from "./types";

const BOT_DEPTH = 3;
const MAX_BOT_ATTEMPTS = 3;

/** DOM 이벤트 연결 계층이 사용할 경기 제어 API. */
export interface GameController {
  /** 현재 Renderer 입력 상태의 스냅샷을 반환한다. */
  getViewState(): ClientViewState;
  /** ready 상태에서 새 경기를 시작한다. */
  startGame(): void;
  /** 현재 단계와 관계없이 새로운 경기를 즉시 시작한다. */
  restartGame(): void;
  /** 선택된 home 기물이 수행할 행동을 고른다. */
  selectAction(action: ClientAction): void;
  /** Canvas 클릭을 게임 공간의 대상으로 전달한다. */
  handleTarget(target: CanvasTarget): void;
  /** 비동기 작업과 Worker를 폐기한다. */
  dispose(): void;
}

/** Controller가 의존하는 외부 경계와 테스트용 상태 factory. */
export interface GameControllerOptions {
  engineClient: EngineClient;
  onChange: (state: ClientViewState) => void;
  createState?: () => GameState;
}

/** 클로저 안에 지속되는 경기와 선택 상태를 만든다. */
export function createGameController(options: GameControllerOptions): GameController {
  const createState = options.createState ?? createInitialState;
  let phase: ClientViewState["phase"] = "ready";
  let gameState: GameState | null = null;
  let selectedPieceId: number | null = null;
  let selectedAction: ClientAction | null = null;
  let availableActions: ClientAction[] = [];
  let candidateMoves: ClientViewState["candidateMoves"] = [];
  let lastMove: ClientViewState["lastMove"] = null;
  let botAttempt = 0;
  let message: ClientViewState["message"] = null;
  let gameEpoch = 0;
  let disposed = false;

  function snapshot(): ClientViewState {
    return {
      phase,
      gameState,
      selectedPieceId,
      selectedAction,
      availableActions: [...availableActions],
      candidateMoves: [...candidateMoves],
      lastMove,
      botAttempt,
      message,
    };
  }

  function publish(): void {
    options.onChange(snapshot());
  }

  function beginNewGame(): void {
    gameEpoch += 1;
    phase = "humanTurn";
    gameState = createState();
    selectedPieceId = null;
    selectedAction = null;
    availableActions = [];
    candidateMoves = [];
    lastMove = null;
    botAttempt = 0;
    message = null;
    publish();
  }

  function selectPiece(pieceId: number): void {
    if (!gameState) return;
    const pieceMoves = legalMoves(gameState).filter((move) => move.pieceId === pieceId);

    selectedPieceId = pieceId;
    selectedAction = null;
    availableActions = (["move", "pass", "shoot"] as const).filter((action) =>
      pieceMoves.some((move) => move.kind === action),
    );
    candidateMoves = pieceMoves.filter((move) => move.kind === "steal");
    message = null;
    publish();
  }

  function clearSelection(): void {
    selectedPieceId = null;
    selectedAction = null;
    availableActions = [];
    candidateMoves = [];
    message = null;
    publish();
  }

  function applyTrackedMove(move: Move): GameState {
    if (!gameState) throw new Error("진행 중인 경기가 없습니다.");
    const actor = gameState.pieces.find((piece) => piece.id === move.pieceId);
    if (!actor) throw new Error(`존재하지 않는 기물 ID입니다: ${move.pieceId}`);

    lastMove = {
      move,
      from: { ...actor.pos },
      target: targetForMove(gameState, move),
    };
    return applyMove(gameState, move);
  }

  function applyHumanMove(move: Move): void {
    gameState = applyTrackedMove(move);
    selectedPieceId = null;
    selectedAction = null;
    availableActions = [];
    candidateMoves = [];
    message = null;
    phase = gameResult(gameState) === null ? "botThinking" : "finished";
    publish();
    if (phase === "botThinking") void runBotTurn(gameEpoch);
  }

  async function runBotTurn(epoch: number): Promise<void> {
    for (let attempt = 1; attempt <= MAX_BOT_ATTEMPTS; attempt += 1) {
      const stateAtRequest = gameState;
      if (!stateAtRequest || phase !== "botThinking") return;

      botAttempt = attempt;
      message =
        attempt === 1
          ? null
          : { kind: "botRetry", attempt, maxAttempts: MAX_BOT_ATTEMPTS };
      publish();

      try {
        const result = await options.engineClient.analyze(stateAtRequest, BOT_DEPTH);
        if (disposed || epoch !== gameEpoch || phase !== "botThinking") return;
        if (result.best === null) {
          if (gameResult(stateAtRequest) !== null) {
            phase = "finished";
            publish();
            return;
          }
          throw new Error("봇이 합법 수를 반환하지 않았습니다.");
        }

        gameState = stateAtRequest;
        gameState = applyTrackedMove(result.best);
        botAttempt = 0;
        message = null;
        phase = gameResult(gameState) === null ? "humanTurn" : "finished";
        publish();
        return;
      } catch {
        if (disposed || epoch !== gameEpoch) return;
        if (attempt < MAX_BOT_ATTEMPTS) {
          options.engineClient.restart();
        }
      }
    }

    phase = "fatalError";
    message = { kind: "fatalError" };
    publish();
  }

  return {
    getViewState: snapshot,
    startGame: beginNewGame,
    restartGame() {
      // 실패한 분석 Worker나 진행 중인 요청을 새 경기에 넘기지 않는다.
      if (phase === "fatalError" || phase === "botThinking") {
        options.engineClient.restart();
      }
      beginNewGame();
    },
    selectAction(action) {
      if (
        phase !== "humanTurn" ||
        !gameState ||
        selectedPieceId === null ||
        !availableActions.includes(action)
      ) {
        return;
      }

      const pieceMoves = legalMoves(gameState).filter(
        (move) => move.pieceId === selectedPieceId,
      );
      selectedAction = action;
      candidateMoves = pieceMoves.filter(
        (move) => move.kind === "steal" || move.kind === selectedAction,
      );
      message = null;
      publish();
    },
    handleTarget(target) {
      if (phase !== "humanTurn" || !gameState) return;

      const steal = candidateMoves.find(
        (move) => move.kind === "steal" && moveMatchesTarget(gameState!, move, target),
      );
      if (steal) {
        applyHumanMove(steal);
        return;
      }

      const actionMove = candidateMoves.find(
        (move) =>
          move.kind === selectedAction && moveMatchesTarget(gameState!, move, target),
      );
      if (actionMove) {
        applyHumanMove(actionMove);
        return;
      }

      if (target.kind === "outside") {
        clearSelection();
        return;
      }
      if (target.kind === "goal") {
        message = { kind: "invalidShot" };
        publish();
        return;
      }
      const piece = gameState.pieces.find(
        (candidate) =>
          candidate.pos.x === target.pos.x && candidate.pos.y === target.pos.y,
      );
      if (!piece) {
        clearSelection();
        return;
      }
      if (piece.team === "away") {
        if (selectedPieceId === null) {
          message = { kind: "selectOwn" };
          publish();
        } else {
          message = { kind: "cannotSteal" };
          publish();
        }
        return;
      }

      selectPiece(piece.id);
    },
    dispose() {
      disposed = true;
      gameEpoch += 1;
      options.engineClient.dispose();
    },
  };
}
