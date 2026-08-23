/**
 * 한 경기의 엔진 상태와 브라우저 UI 상태를 함께 소유하는 Controller.
 *
 * 엔진은 `GameState → GameState` 계산만 담당한다. 이 모듈은 어떤 기물과 행동이
 * 선택됐는지, 지금 사람과 봇 중 누구의 차례인지, Renderer를 언제 다시 호출할지를
 * 결정한다.
 */

import {
  applyMove,
  createInitialState,
  gameResult,
  isPressured,
  isStealProtected,
  legalMoves,
  previewMove,
  SHOT_MAX,
  sideToMove,
} from "../engine/rules";
import type { GameState, Move, Team, TeamStyle } from "../engine/types";
import type { EngineClient } from "./engineClient";
import { isTargetedMove, moveMatchesTarget, targetForMove } from "./input";
import type { CanvasTarget, ClientAction, ClientViewState, MatchEvent } from "./types";

const BOT_DEPTH = 3;
const MAX_BOT_ATTEMPTS = 3;
/** 이벤트 로그에 보존하는 최대 사건 수. */
const EVENT_LIMIT = 30;

/** DOM 이벤트 연결 계층이 사용할 경기 제어 API. */
export interface GameController {
  /** 현재 Renderer 입력 상태의 스냅샷을 반환한다. */
  getViewState(): ClientViewState;
  /** ready 상태에서 선택한 팀 전술로 새 경기를 시작한다. 생략하면 balanced다. */
  startGame(styles?: Partial<Record<Team, TeamStyle>>): void;
  /** 현재 단계와 관계없이 새로운 경기를 즉시 시작한다. */
  restartGame(styles?: Partial<Record<Team, TeamStyle>>): void;
  /** 선택된 home 기물이 수행할 행동을 고른다. */
  selectAction(action: ClientAction): void;
  /** Canvas 클릭을 게임 공간의 대상으로 전달한다. */
  handleTarget(target: CanvasTarget): void;
  /** 현재 압박받은 공 소유자가 버티기를 실행한다. */
  holdBall(): void;
  /** 현재 팀의 남은 행동을 버리고 턴을 종료한다. */
  endTurn(): void;
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
  let candidatePreviews: ClientViewState["candidatePreviews"] = [];
  let selectedStealTargetId: number | null = null;
  let lastMove: ClientViewState["lastMove"] = null;
  let events: MatchEvent[] = [];
  let botAttempt = 0;
  let message: ClientViewState["message"] = null;
  let gameEpoch = 0;
  let disposed = false;

  /** 사람 턴에 봇 공 소유자가 지금 시도할 수 있는 슛 위협을 미리 계산한다. */
  function computeThreatShots(): ClientViewState["threatShots"] {
    if (phase !== "humanTurn" || !gameState || gameState.ball.kind !== "held") return [];
    const carrierId = gameState.ball.pieceId;
    const carrier = gameState.pieces.find((piece) => piece.id === carrierId);
    if (!carrier || carrier.team !== "away") return [];
    // away는 x가 감소하는 방향으로 공격하므로 위협 골라인은 x = -1이다.
    if (Math.abs(-1 - carrier.pos.x) > SHOT_MAX) return [];
    return ([3, 4, 5] as const).map((goalRow) => {
      const move = { kind: "shoot", pieceId: carrier.id, goalRow } as const;
      return { move, preview: previewMove(gameState!, move) };
    });
  }

  function snapshot(): ClientViewState {
    const moves = gameState ? legalMoves(gameState) : [];
    return {
      phase,
      gameState,
      canHold: moves.some((move) => move.kind === "hold"),
      canEndTurn: moves.some((move) => move.kind === "endTurn"),
      selectedPieceId,
      selectedAction,
      availableActions: [...availableActions],
      candidateMoves: [...candidateMoves],
      candidatePreviews: [...candidatePreviews],
      selectedStealTargetId,
      threatShots: computeThreatShots(),
      events: [...events],
      lastMove,
      botAttempt,
      message,
    };
  }

  function publish(): void {
    options.onChange(snapshot());
  }

  /** 합법 수와 동일한 시점의 엔진 미리보기를 항상 한 쌍으로 교체한다. */
  function setCandidates(moves: Move[]): void {
    candidateMoves = moves;
    candidatePreviews = gameState
      ? moves.map((move) => ({ move, preview: previewMove(gameState!, move) }))
      : [];
  }

  function beginNewGame(styles?: Partial<Record<Team, TeamStyle>>): void {
    gameEpoch += 1;
    phase = "humanTurn";
    // 테스트용 상태 factory가 주어지면 그것이 우선이고, 아니면 선택한 전술로 시작한다.
    gameState = options.createState ? createState() : createInitialState(styles);
    selectedPieceId = null;
    selectedAction = null;
    availableActions = [];
    setCandidates([]);
    selectedStealTargetId = null;
    lastMove = null;
    events = [];
    botAttempt = 0;
    message = null;
    publish();
  }

  function selectPiece(pieceId: number): void {
    if (!gameState) return;
    const pieceMoves = legalMoves(gameState).filter(
      (move) => "pieceId" in move && move.pieceId === pieceId,
    );

    selectedPieceId = pieceId;
    selectedAction = null;
    selectedStealTargetId = null;
    availableActions = (["move", "pass", "shoot"] as const).filter((action) =>
      pieceMoves.some((move) => move.kind === action),
    );
    // 선택 즉시 이 기물의 모든 대상 후보를 보여줘 버튼 없이 한 번의 클릭으로 실행하게 한다.
    setCandidates(pieceMoves.filter(isTargetedMove));
    // 클릭이 왜 행동으로 이어지지 않는지 이유를 함께 안내한다.
    const usedActions = gameState.actionCountByPiece[pieceId] ?? 0;
    const isCarrier = gameState.ball.kind === "held" && gameState.ball.pieceId === pieceId;
    message =
      pieceMoves.length === 0 && usedActions >= 2
        ? { kind: "exhaustedPiece" }
        : isCarrier &&
            isPressured(gameState, pieceId) &&
            !pieceMoves.some((move) => move.kind === "move")
          ? { kind: "pressuredCarrier" }
          : null;
    publish();
  }

  function clearSelection(): void {
    selectedPieceId = null;
    selectedAction = null;
    selectedStealTargetId = null;
    availableActions = [];
    setCandidates([]);
    message = null;
    publish();
  }

  /** 공 관련 사건만 골라 실행 전 확률과 실제 결과를 이벤트 로그에 남긴다. */
  function recordEvent(before: GameState, move: Move, after: GameState): void {
    const team = sideToMove(before);
    let event: MatchEvent | null = null;

    if (move.kind === "steal") {
      event = { team, kind: "steal" };
    } else if (move.kind === "hold") {
      event = { team, kind: "hold" };
    } else if (move.kind === "pass" || move.kind === "shoot") {
      const preview = previewMove(before, move);
      const carrier =
        after.ball.kind === "held"
          ? after.pieces.find(
              (piece) => after.ball.kind === "held" && piece.id === after.ball.pieceId,
            )
          : undefined;
      if (preview.kind === "pass") {
        event = {
          team,
          kind: carrier && carrier.team !== team ? "passIntercepted" : "pass",
          chancePercent: Math.round(preview.arrivalChance * 100),
        };
      } else if (preview.kind === "shoot") {
        event = {
          team,
          kind:
            after.score[team] > before.score[team]
              ? "shotGoal"
              : carrier?.role === "GK"
                ? "shotSaved"
                : "shotBlocked",
          chancePercent: Math.round(preview.goalChance * 100),
        };
      }
    }

    if (event) events = [...events.slice(-(EVENT_LIMIT - 1)), event];
  }

  function applyTrackedMove(move: Move): GameState {
    if (!gameState) throw new Error("진행 중인 경기가 없습니다.");
    if (!isTargetedMove(move)) {
      lastMove = null;
      const next = applyMove(gameState, move);
      recordEvent(gameState, move, next);
      return next;
    }
    const actor = gameState.pieces.find((piece) => piece.id === move.pieceId);
    if (!actor) throw new Error(`존재하지 않는 기물 ID입니다: ${move.pieceId}`);

    lastMove = {
      move,
      from: { ...actor.pos },
      target: targetForMove(gameState, move),
    };
    const next = applyMove(gameState, move);
    recordEvent(gameState, move, next);
    return next;
  }

  function applyHumanMove(move: Move): void {
    gameState = applyTrackedMove(move);
    selectedPieceId = null;
    selectedAction = null;
    selectedStealTargetId = null;
    availableActions = [];
    setCandidates([]);
    message = null;
    phase =
      gameResult(gameState) !== null
        ? "finished"
        : sideToMove(gameState) === "home"
          ? "humanTurn"
          : "botThinking";
    publish();
    if (phase === "botThinking") void runBotTurn(gameEpoch);
  }

  async function analyzeWithRetry(
    stateAtRequest: GameState,
    epoch: number,
  ): Promise<import("../engine/types").SearchResult | null> {
    for (let attempt = 1; attempt <= MAX_BOT_ATTEMPTS; attempt += 1) {
      if (disposed || epoch !== gameEpoch || phase !== "botThinking") return null;

      botAttempt = attempt;
      message =
        attempt === 1
          ? null
          : { kind: "botRetry", attempt, maxAttempts: MAX_BOT_ATTEMPTS };
      publish();

      try {
        const result = await options.engineClient.analyze(stateAtRequest, BOT_DEPTH);
        if (disposed || epoch !== gameEpoch || phase !== "botThinking") return null;
        if (result.best === null) {
          if (gameResult(stateAtRequest) !== null) {
            phase = "finished";
            publish();
            return null;
          }
          throw new Error("봇이 합법 수를 반환하지 않았습니다.");
        }

        return result;
      } catch {
        if (disposed || epoch !== gameEpoch) return null;
        if (attempt < MAX_BOT_ATTEMPTS) {
          options.engineClient.restart();
        }
      }
    }

    if (!disposed && epoch === gameEpoch && phase === "botThinking") {
      phase = "fatalError";
      message = { kind: "fatalError" };
      publish();
    }
    return null;
  }

  async function runBotTurn(epoch: number): Promise<void> {
    while (
      !disposed &&
      epoch === gameEpoch &&
      phase === "botThinking" &&
      gameState &&
      gameResult(gameState) === null &&
      sideToMove(gameState) === "away"
    ) {
      const result = await analyzeWithRetry(gameState, epoch);
      if (!result || result.best === null) return;

      gameState = applyTrackedMove(result.best);
      botAttempt = 0;
      message = null;
      publish();
    }

    if (!gameState || disposed || epoch !== gameEpoch || phase !== "botThinking") return;
    phase = gameResult(gameState) === null ? "humanTurn" : "finished";
    publish();
  }

  return {
    getViewState: snapshot,
    startGame: beginNewGame,
    restartGame(styles) {
      // 실패한 분석 Worker나 진행 중인 요청을 새 경기에 넘기지 않는다.
      if (phase === "fatalError" || phase === "botThinking") {
        options.engineClient.restart();
      }
      beginNewGame(styles);
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
        (move) => "pieceId" in move && move.pieceId === selectedPieceId,
      );
      selectedAction = action;
      selectedStealTargetId = null;
      setCandidates(pieceMoves.filter((move) => move.kind === selectedAction));
      message =
        action === "pass"
          ? { kind: "chooseReceiver" }
          : action === "shoot"
            ? { kind: "chooseGoal" }
            : null;
      publish();
    },
    handleTarget(target) {
      if (phase !== "humanTurn" || !gameState) return;

      if (selectedStealTargetId !== null) {
        const steal = candidateMoves.find(
          (move) =>
            move.kind === "steal" &&
            target.kind === "cell" &&
            gameState!.pieces.some(
              (piece) =>
                piece.id === move.pieceId &&
                piece.pos.x === target.pos.x &&
                piece.pos.y === target.pos.y,
            ),
        );
        if (steal) {
          applyHumanMove(steal);
          return;
        }
        if (target.kind === "outside" || target.kind === "cell") {
          clearSelection();
        }
        return;
      }

      // 행동 버튼은 필터일 뿐이다. 선택하지 않았다면 종류가 서로 겹치지 않는 대상
      // (이동=빈 칸, 패스=아군, 슛=골문, 스틸=상대 소유자)을 바로 실행한다.
      const actionMove = candidateMoves.find(
        (move) =>
          isTargetedMove(move) &&
          (selectedAction === null || move.kind === selectedAction) &&
          moveMatchesTarget(gameState!, move, target),
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
        const isCarrier =
          gameState.ball.kind === "held" && gameState.ball.pieceId === piece.id;
        if (isCarrier) {
          const steals = legalMoves(gameState).filter(
            (move): move is Extract<Move, { kind: "steal" }> =>
              move.kind === "steal" && move.targetPieceId === piece.id,
          );
          if (steals.length === 1) {
            applyHumanMove(steals[0]!);
          } else if (steals.length > 1) {
            selectedPieceId = null;
            selectedAction = null;
            selectedStealTargetId = piece.id;
            availableActions = [];
            setCandidates(steals);
            message = { kind: "chooseStealer" };
            publish();
          } else {
            message = {
              kind: isStealProtected(gameState, piece.id, sideToMove(gameState))
                ? "protectedCarrier"
                : "cannotSteal",
            };
            publish();
          }
          return;
        }
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
    holdBall() {
      if (phase !== "humanTurn" || !gameState) return;
      const hold = legalMoves(gameState).find(
        (move): move is Extract<Move, { kind: "hold" }> => move.kind === "hold",
      );
      if (hold) applyHumanMove(hold);
    },
    endTurn() {
      if (phase !== "humanTurn" || !gameState) return;
      const endTurn = legalMoves(gameState).find(
        (move): move is Extract<Move, { kind: "endTurn" }> => move.kind === "endTurn",
      );
      if (endTurn) applyHumanMove(endTurn);
    },
    dispose() {
      disposed = true;
      gameEpoch += 1;
      options.engineClient.dispose();
    },
  };
}
