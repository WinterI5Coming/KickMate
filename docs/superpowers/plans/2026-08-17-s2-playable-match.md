# S2 Playable Match Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 항상 home으로 플레이하고 깊이 3의 away 봇과 대국해 3골 선취 또는 전체 60 ply로 한 경기를 끝낸 뒤 즉시 새 경기를 시작할 수 있게 한다.

**Architecture:** 순수 엔진이 종료 판정을 제공하고, 클로저 기반 `GameController`가 지속되는 경기 및 UI 상태를 소유한다. 메인 스레드는 합법 수·상태 전이·종료 판정을 직접 수행하고, `EngineClient`를 통해 무거운 탐색만 Worker에 맡긴다. Renderer는 Controller가 전달한 `ClientViewState`만 읽어 Canvas와 HTML을 다시 그린다.

**Tech Stack:** TypeScript 5.6+, Vite 6, Vitest 3, Canvas 2D, HTML DOM, Web Worker

**Specification:** `reference/TASK-S2-client.md`

## Global Constraints

- 사용자는 항상 `home`, 봇은 항상 `away`다.
- 어느 팀이든 3골에 도달하면 즉시 종료하고, 그렇지 않으면 득점으로 초기화되지 않는 전체 60 ply에서 종료한다.
- 봇 탐색 깊이는 3, 요청당 제한 시간은 5초, 최초 요청을 포함한 최대 시도 횟수는 3이다.
- Worker 재시도 전 기존 Worker를 종료하고 새 Worker를 생성한다.
- 스틸 버튼은 만들지 않고, 선택된 home 기물이 스틸할 수 있는 away 볼 소유자를 클릭하면 즉시 실행한다.
- `reference/prototype.html`은 수정하거나 런타임 의존성으로 만들지 않는다.
- 새 런타임 또는 테스트 의존성을 추가하지 않는다.
- 엔진은 DOM, Canvas, Worker 전역과 파일시스템에 접근하지 않는다.
- 상태 전이는 입력 `GameState`를 변경하지 않는다.
- 실패하는 테스트를 먼저 확인한 뒤 최소 구현으로 통과시킨다.
- 각 Task 종료 후 파일별 역할, 데이터 흐름, 새 TypeScript 문법을 사용자에게 설명하고 다음 Task 진행 여부를 확인한다.
- 커밋은 사용자가 별도로 요청한 경우에만 수행한다. 요청받으면 아래 제안 메시지를 한국어로 사용한다.
- 최종 완료 전 `npm run check`, `npm run build`, `git diff --check`를 실행한다. 관리 환경의 `spawn EPERM`으로 빌드가 차단되면 사용자 터미널에서 다시 실행하고, 성공 증거 없이 완료로 표시하지 않는다.

---

## File Map

| 파일 | 변경 | 책임 |
|---|---|---|
| `src/engine/types.ts` | 수정 | 구조화된 `GameResult` 계약 |
| `src/engine/rules.ts` | 수정 | 3골·60 ply 종료 판정과 합법 수 차단 |
| `src/engine/search.ts` | 수정 | 모든 종료 상태에서 탐색 중단 |
| `src/engine/rules.test.ts` | 수정 | 종료 판정 회귀 테스트 |
| `src/client/types.ts` | 생성 | 화면 단계, 행동, 화면 상태 계약 |
| `src/client/input.ts` | 생성 | Canvas 좌표와 `Move` 목표 변환 |
| `src/client/input.test.ts` | 생성 | 좌표와 Move 매칭 테스트 |
| `src/client/engineClient.ts` | 생성 | Worker Promise API와 수명 관리 |
| `src/client/engineClient.test.ts` | 생성 | 응답·오류·타임아웃 테스트 |
| `src/client/gameController.ts` | 생성 | 지속 상태, 입력, 턴, 재시도 |
| `src/client/gameController.test.ts` | 생성 | 단계·입력·종료·재시도 테스트 |
| `src/client/render.ts` | 생성 | Canvas·HTML 렌더링과 표시 모델 |
| `src/client/render.test.ts` | 생성 | 버튼·문구·입력 잠금 테스트 |
| `src/client/main.ts` | 수정 | DOM 조회와 모듈 조립 |
| `index.html` | 수정 | HUD, 버튼, 골대 여백 Canvas |
| `content/strings.json` | 수정 | S2 화면 문구 |
| `content/theme.json` | 수정 | 선택·후보 표시 색상 |
| `tools/validate.ts` | 수정 | 새 콘텐츠 계약 검증 |
| `docs/current-state.md` | 완료 후 수정 | 실제 구현 및 검증 상태 |
| `docs/project-plan.md` | 완료 후 수정 | M2 진척과 다음 단계 |

---

### Task 1: 엔진의 단일 종료 판정

**Files:**
- Modify: `src/engine/types.ts`
- Modify: `src/engine/rules.ts`
- Modify: `src/engine/search.ts`
- Test: `src/engine/rules.test.ts`

**Interfaces:**
- Consumes: 기존 `GameState`, `Team`, `legalMoves()`, `search()`
- Produces: `WIN_SCORE`, `GameResult`, `gameResult(state): GameResult | null`

- [x] **Step 1: 종료 판정 실패 테스트 작성**

`rules.test.ts`의 import에 `gameResult`를 추가하고 다음 테스트를 작성한다.

```ts
describe("경기 종료", () => {
  it("home이 3골에 도달하면 즉시 승리하고 더는 수를 만들지 않는다", () => {
    const state = createInitialState();
    state.score.home = 3;

    expect(gameResult(state)).toEqual({
      kind: "win",
      winner: "home",
      reason: "scoreLimit",
    });
    expect(legalMoves(state)).toEqual([]);
    expect(search(state, { depth: 2, evalFn: evalLv1 }).best).toBeNull();
  });

  it.each([
    [{ home: 2, away: 1 }, { kind: "win", winner: "home", reason: "turnLimit" }],
    [{ home: 1, away: 2 }, { kind: "win", winner: "away", reason: "turnLimit" }],
    [{ home: 2, away: 2 }, { kind: "draw", reason: "turnLimit" }],
  ] as const)("60 ply 결과를 점수로 판정한다: %o", (score, expected) => {
    const state = createInitialState();
    state.turn = state.maxTurns;
    state.score = { ...score };

    expect(gameResult(state)).toEqual(expected);
    expect(legalMoves(state)).toEqual([]);
    expect(search(state, { depth: 2, evalFn: evalLv1 }).best).toBeNull();
  });

  it("3골과 60 ply에 도달하지 않으면 진행 중이다", () => {
    const state = createInitialState();
    state.turn = 59;
    state.score = { home: 2, away: 2 };

    expect(gameResult(state)).toBeNull();
    expect(legalMoves(state).length).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/rules.test.ts --configLoader native`

Expected: `gameResult` export가 없어 FAIL.

- [x] **Step 3: 결과 타입과 판정 함수 구현**

`types.ts`에 추가한다.

```ts
export type GameResult =
  | { kind: "win"; winner: Team; reason: "scoreLimit" | "turnLimit" }
  | { kind: "draw"; reason: "turnLimit" };
```

`rules.ts`에 추가한다.

```ts
export const WIN_SCORE = 3;

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
```

`legalMoves()`의 첫 조건을 `if (gameResult(state) !== null) return [];`로 교체한다. `search.ts`가 `gameResult`를 import하고 재귀와 루트의 `turn >= maxTurns` 조건을 각각 `gameResult(position) !== null`, `gameResult(state) !== null`로 교체한다.

- [x] **Step 4: 엔진 검증**

Run:

```powershell
npx vitest run src/engine/rules.test.ts --configLoader native
npm run typecheck
```

Expected: 엔진 테스트 PASS, TypeScript 오류 0개.

- [x] **Step 5: 학습 체크포인트**

`GameResult` 판별 유니온, 계산 상태와 저장 상태의 차이, `legalMoves()`와 `search()`가 같은 종료 함수를 쓰는 이유를 설명한다.

제안 커밋 메시지: `feat: 경기 종료 판정 추가`

---

### Task 2: 클라이언트 상태 계약과 Canvas 입력 변환

**Files:**
- Create: `src/client/types.ts`
- Create: `src/client/input.ts`
- Test: `src/client/input.test.ts`

**Interfaces:**
- Consumes: `GameState`, `Move`, `Pos`, `BOARD_W`, `BOARD_H`
- Produces: `GamePhase`, `ClientAction`, `ClientViewState`, `CanvasTarget`, `BOARD_GEOMETRY`, `canvasPointToTarget()`, `targetForMove()`, `moveMatchesTarget()`

- [x] **Step 1: 화면 상태 계약 작성**

```ts
import type { GameState, Move, Pos } from "../engine/types";

export type GamePhase =
  | "ready"
  | "humanTurn"
  | "botThinking"
  | "finished"
  | "fatalError";

export type ClientAction = "move" | "pass" | "shoot";

export type CanvasTarget =
  | { kind: "cell"; pos: Pos }
  | { kind: "goal"; side: "left" | "right"; row: number }
  | { kind: "outside" };

export type ClientMessage =
  | { kind: "selectOwn" }
  | { kind: "cannotSteal" }
  | { kind: "invalidShot" }
  | { kind: "botRetry"; attempt: number; maxAttempts: number }
  | { kind: "fatalError" };

export interface LastMove {
  move: Move;
  from: Pos;
  target: CanvasTarget;
}

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
```

`candidateMoves`에는 선택 행동의 후보와 직접 클릭 가능한 스틸 후보를 함께 담는다. `LastMove`는 득점 후 기물이 킥오프 위치로 이동해도 직전 수의 출발점과 화면 목표를 잃지 않게 한다. `ClientMessage`는 Controller가 한국어 문구를 직접 소유하지 않도록 의미만 전달한다.

- [x] **Step 2: 좌표 실패 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { createInitialState, legalMoves } from "../engine/rules";
import { BOARD_GEOMETRY, canvasPointToTarget, moveMatchesTarget, targetForMove } from "./input";

describe("Canvas 입력 변환", () => {
  it("보드 내부 픽셀을 보드 칸으로 바꾼다", () => {
    expect(canvasPointToTarget(BOARD_GEOMETRY.originX + 1, 1)).toEqual({
      kind: "cell",
      pos: { x: 0, y: 0 },
    });
  });

  it("오른쪽 골대 여백의 골문 행을 goal 대상으로 바꾼다", () => {
    expect(canvasPointToTarget(BOARD_GEOMETRY.boardRight + 1, 4 * 80 + 1)).toEqual({
      kind: "goal",
      side: "right",
      row: 4,
    });
  });

  it("골문 밖 여백은 outside로 처리한다", () => {
    expect(canvasPointToTarget(1, 0)).toEqual({ kind: "outside" });
  });

  it("이동 수를 동일한 cell 대상과 연결한다", () => {
    const state = createInitialState();
    const move = legalMoves(state).find((candidate) => candidate.kind === "move")!;
    const target = targetForMove(state, move);
    expect(moveMatchesTarget(state, move, target)).toBe(true);
  });
});
```

- [x] **Step 3: 실패 확인**

Run: `npx vitest run src/client/input.test.ts --configLoader native`

Expected: `./input` 모듈이 없어 FAIL.

- [x] **Step 4: 좌표 변환 구현**

```ts
import { BOARD_H, BOARD_W, type GameState, type Move } from "../engine/types";
import type { CanvasTarget } from "./types";

export const BOARD_GEOMETRY = {
  cell: 80,
  originX: 80,
  originY: 0,
  canvasWidth: 1200,
  canvasHeight: 720,
  boardRight: 80 + BOARD_W * 80,
} as const;

export function canvasPointToTarget(x: number, y: number): CanvasTarget {
  const { cell, originX, boardRight, canvasWidth, canvasHeight } = BOARD_GEOMETRY;
  if (x < 0 || x >= canvasWidth || y < 0 || y >= canvasHeight) return { kind: "outside" };
  const row = Math.floor(y / cell);
  if (row < 0 || row >= BOARD_H) return { kind: "outside" };
  if (x >= originX && x < boardRight) {
    return { kind: "cell", pos: { x: Math.floor((x - originX) / cell), y: row } };
  }
  if (row < 3 || row > 5) return { kind: "outside" };
  return { kind: "goal", side: x < originX ? "left" : "right", row };
}
```

같은 파일에 다음 함수를 추가한다.

```ts
function requirePiece(state: GameState, pieceId: number) {
  const piece = state.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece) throw new Error(`존재하지 않는 기물 ID입니다: ${pieceId}`);
  return piece;
}

export function targetForMove(state: GameState, move: Move): CanvasTarget {
  if (move.kind === "move" || move.kind === "pass") {
    return { kind: "cell", pos: { ...move.to } };
  }
  if (move.kind === "steal") {
    return { kind: "cell", pos: { ...requirePiece(state, move.targetPieceId).pos } };
  }
  const shooter = requirePiece(state, move.pieceId);
  const goalX = shooter.team === "home" ? BOARD_W : -1;
  const distanceToGoal = Math.abs(goalX - shooter.pos.x);
  return {
    kind: "goal",
    side: shooter.team === "home" ? "right" : "left",
    row: shooter.pos.y + move.dy * distanceToGoal,
  };
}

export function moveMatchesTarget(
  state: GameState,
  move: Move,
  target: CanvasTarget,
): boolean {
  const expected = targetForMove(state, move);
  if (expected.kind !== target.kind) return false;
  if (expected.kind === "outside" || target.kind === "outside") return true;
  if (expected.kind === "goal" && target.kind === "goal") {
    return expected.side === target.side && expected.row === target.row;
  }
  return (
    expected.kind === "cell" &&
    target.kind === "cell" &&
    expected.pos.x === target.pos.x &&
    expected.pos.y === target.pos.y
  );
}
```

- [x] **Step 5: 슛·스틸 테스트 추가 및 검증**

```ts
it("합법 슛을 올바른 골대 행과 연결한다", () => {
  const state = createInitialState();
  const shoot = legalMoves(state).find((move) => move.kind === "shoot")!;
  const target = targetForMove(state, shoot);
  expect(target.kind).toBe("goal");
  expect(moveMatchesTarget(state, shoot, target)).toBe(true);
});

it("스틸을 상대 볼 소유자의 칸과 연결한다", () => {
  const state = createInitialState();
  state.turn = 1;
  state.pieces.find((piece) => piece.id === 7)!.pos = { x: 7, y: 4 };
  const steal = legalMoves(state).find((move) => move.kind === "steal")!;
  const target = targetForMove(state, steal);
  expect(target).toEqual({ kind: "cell", pos: { x: 6, y: 4 } });
  expect(moveMatchesTarget(state, steal, target)).toBe(true);
});
```

Run:

```powershell
npx vitest run src/client/input.test.ts --configLoader native
npm run typecheck
```

Expected: 입력 테스트 PASS, TypeScript 오류 0개.

- [x] **Step 6: 학습 체크포인트**

Canvas 픽셀과 게임 좌표의 차이, 판별 유니온 `CanvasTarget`, `as const` 문법을 설명한다.

제안 커밋 메시지: `feat: 클라이언트 입력 좌표 계약 추가`

---

### Task 3: Promise 기반 Worker 클라이언트

**Files:**
- Create: `src/client/engineClient.ts`
- Test: `src/client/engineClient.test.ts`
- Reuse: `src/worker/protocol.ts`

**Interfaces:**
- Consumes: `WorkerRequest`, `WorkerResponse`, `GameState`, `SearchResult`
- Produces: `EngineClient`, `WorkerPort`, `createEngineClient(options?)`

- [x] **Step 1: 계약과 Fake Worker 실패 테스트 작성**

```ts
export interface EngineClient {
  analyze(state: GameState, depth: number): Promise<SearchResult>;
  restart(): void;
  dispose(): void;
}

export interface WorkerPort {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
}

export interface EngineClientOptions {
  timeoutMs?: number;
  createWorker?: () => WorkerPort;
}
```

`engineClient.test.ts`의 `FakeWorker`는 `sent`, `terminated`, `emit(response)`을 제공한다. 첫 테스트는 다음과 같다.

```ts
class FakeWorker implements WorkerPort {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  sent: WorkerRequest[] = [];
  terminated = false;

  postMessage(message: WorkerRequest): void {
    this.sent.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(response: WorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>);
  }
}
```

```ts
it("requestId가 같은 analysis 응답으로 Promise를 완료한다", async () => {
  const workers: FakeWorker[] = [];
  const client = createEngineClient({
    timeoutMs: 5_000,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  });
  const state = createInitialState();
  const pending = client.analyze(state, 3);
  const request = workers[0]!.sent[0] as Extract<WorkerRequest, { type: "analyze" }>;
  const result = search(state, { depth: 1, evalFn: evalLv1 });

  workers[0]!.emit({ type: "analysis", requestId: request.requestId, result });
  await expect(pending).resolves.toEqual(result);
});
```

추가 테스트:

- `error 응답은 해당 Promise만 reject한다`: 같은 `message`로 reject
- `5초가 지나면 요청을 reject한다`: fake timer 5,000ms 뒤 `분석 시간이 초과되었습니다.`
- `restart는 기존 Worker를 종료하고 대기 요청을 reject한다`: 첫 Worker 종료, Worker 수 2
- `교체된 Worker의 늦은 응답을 무시한다`: 이전 Worker 응답으로 새 요청이 완료되지 않음
- `dispose는 Worker를 종료하고 새 Worker를 만들지 않는다`

- [x] **Step 2: 실패 확인**

Run: `npx vitest run src/client/engineClient.test.ts --configLoader native`

Expected: `./engineClient` 모듈이 없어 FAIL.

- [x] **Step 3: Worker 수명과 요청 저장소 구현**

기본 Worker factory:

```ts
() => new Worker(new URL("../worker/engine.worker.ts", import.meta.url), { type: "module" })
```

구현 규칙:

1. `nextRequestId`를 1부터 증가시킨다.
2. `Map<number, { resolve; reject; timeoutId }>`에 요청을 저장한다.
3. `analysis`은 같은 ID를 resolve하고 timer를 해제한다.
4. `error`는 같은 ID를 `Error(message)`로 reject한다.
5. Worker 자체의 `error` event는 현재 Worker의 모든 대기 요청을 reject한다.
6. 응답 Worker가 현재 Worker와 다르면 무시한다.
7. `restart()`는 대기 요청을 reject하고 Worker를 종료한 뒤 새 Worker를 만든다.
8. `dispose()`는 대기 요청을 reject하고 종료하되 새 Worker를 만들지 않는다.
9. dispose 뒤 `analyze()`는 즉시 reject한다.

- [x] **Step 4: Worker 클라이언트 검증**

Run:

```powershell
npx vitest run src/client/engineClient.test.ts --configLoader native
npm run typecheck
```

Expected: EngineClient 테스트 PASS, TypeScript 오류 0개.

- [x] **Step 5: 학습 체크포인트**

Worker 메시지가 Promise로 바뀌는 과정, `requestId`, `Map`, resolve/reject, 타임아웃과 오래된 응답 차단을 설명한다.

제안 커밋 메시지: `feat: Worker 분석 클라이언트 추가`

---

### Task 4: 경기 상태와 턴을 소유하는 GameController

**Files:**
- Create: `src/client/gameController.ts`
- Test: `src/client/gameController.test.ts`
- Reuse: `src/client/types.ts`
- Reuse: `src/client/input.ts`
- Reuse: `src/client/engineClient.ts`

**Interfaces:**
- Consumes: `createInitialState()`, `legalMoves()`, `applyMove()`, `gameResult()`, `EngineClient`, `CanvasTarget`
- Produces: `GameController`, `createGameController(options)`

- [x] **Step 1: Controller 공개 계약 작성**

```ts
export interface GameController {
  getViewState(): ClientViewState;
  startGame(): void;
  restartGame(): void;
  selectAction(action: ClientAction): void;
  handleTarget(target: CanvasTarget): void;
  dispose(): void;
}

export interface GameControllerOptions {
  engineClient: EngineClient;
  onChange: (state: ClientViewState) => void;
  createState?: () => GameState;
}
```

`createState` 기본값은 `createInitialState`다. 테스트가 종료 직전 상태를 주입할 때만 교체한다.

- [x] **Step 2: 초기 단계 실패 테스트 작성**

```ts
it("ready에서 시작하고 시작 후 humanTurn이 된다", () => {
  const states: ClientViewState[] = [];
  const controller = createGameController({
    engineClient: fakeEngineClient,
    onChange: (state) => states.push(state),
  });

  expect(controller.getViewState().phase).toBe("ready");
  controller.startGame();

  expect(controller.getViewState()).toEqual(
    expect.objectContaining({
      phase: "humanTurn",
      gameState: expect.objectContaining({ turn: 0, score: { home: 0, away: 0 } }),
    }),
  );
  expect(states.at(-1)?.phase).toBe("humanTurn");
});
```

새 게임 테스트는 `finished` 또는 `fatalError` 상태에서 `restartGame()`이 `turn: 0`, 0:0, `humanTurn`을 즉시 발행하는지 검증한다.

- [x] **Step 3: 사용자 입력 우선순위 실패 테스트 작성**

다음 동작을 각각 독립 테스트로 작성한다.

- home 기물 칸 클릭 → 해당 ID 선택
- 다른 home 기물 클릭 → 선택 전환과 행동 초기화
- 후보가 아닌 빈 칸 클릭 → 선택·행동·후보 해제
- 미선택 상태에서 away 클릭 → 상태 유지와 `{ kind: "selectOwn" }`
- 행동 선택 → 해당 행동 후보와 같은 기물의 스틸 후보를 `candidateMoves`에 포함
- 패스 선택 후 합법 패스 대상 home 클릭 → 선택 전환이 아니라 패스 적용
- 합법 스틸 대상 away 클릭 → 다른 행동 선택 여부와 무관하게 스틸 적용
- 스틸 불가능 away 클릭 → 기존 선택·행동 유지와 `{ kind: "cannotSteal" }`

테스트는 실제 `legalMoves()`에서 후보를 찾아 `targetForMove()`로 클릭 대상을 만든다.

- [x] **Step 4: 실패 확인**

Run: `npx vitest run src/client/gameController.test.ts --configLoader native`

Expected: `./gameController` 모듈이 없어 FAIL.

- [x] **Step 5: 선택과 후보 계산 구현**

Controller 내부에는 화면 상태 필드와 오래된 비동기 응답을 구분할 `gameEpoch`를 둔다. `publish()`는 배열을 복사한 `ClientViewState`를 `onChange`에 전달한다.

```ts
const pieceMoves = legalMoves(gameState).filter(
  (move) => move.pieceId === selectedPieceId,
);

availableActions = (["move", "pass", "shoot"] as const).filter((action) =>
  pieceMoves.some((move) => move.kind === action),
);

candidateMoves = pieceMoves.filter(
  (move) => move.kind === "steal" || move.kind === selectedAction,
);
```

`handleTarget()` 순서:

1. `phase !== "humanTurn"`이면 반환
2. 선택 기물의 합법 스틸과 target이 맞으면 즉시 적용
3. 선택 행동의 합법 후보와 target이 맞으면 즉시 적용
4. cell의 home 기물이면 선택 또는 선택 전환
5. cell의 away 기물이면 상황별 안내를 설정하고 선택 유지
6. 빈 cell 또는 outside이면 선택 해제
7. 유효하지 않은 goal이면 선택 유지와 슛 불가 안내

수를 적용하는 공통 helper는 적용 전 상태에서 마지막 수 정보를 만든다.

```ts
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
```

사람 수와 봇 수 모두 이 helper를 사용한다. 수 적용 직후 `selectedPieceId`, `selectedAction`, `availableActions`, `candidateMoves`, `message`를 초기화한다.

- [x] **Step 6: 사람 수 이후 봇 전환 실패 테스트 작성**

Fake `analyze()`가 전달받은 away 상태의 `legalMoves(state)[0]`을 `best`로 resolve하게 한다. 사용자의 합법 이동 뒤 다음을 검증한다.

```ts
expect(states.some((state) => state.phase === "botThinking")).toBe(true);
await flushPromises();
expect(controller.getViewState().phase).toBe("humanTurn");
expect(controller.getViewState().gameState?.turn).toBe(2);
expect(controller.getViewState().lastMove?.move).toEqual(expect.objectContaining({ pieceId: 4 }));
```

```ts
const flushPromises = () => new Promise<void>((resolve) => queueMicrotask(resolve));
```

- [x] **Step 7: 봇 실행과 종료 전환 구현**

사용자 수와 봇 수 직후 모두 `gameResult(nextState)`를 호출한다. 결과가 있으면 `finished`, 없으면 각각 `botThinking` 또는 `humanTurn`으로 전환한다.

봇 실행은 현재 `gameEpoch`를 캡처한다. 완료 시 epoch가 다르거나 dispose됐다면 응답을 적용하지 않는다.

```ts
const BOT_DEPTH = 3;
const MAX_BOT_ATTEMPTS = 3;

async function runBotTurn(epoch: number): Promise<void> {
  for (let attempt = 1; attempt <= MAX_BOT_ATTEMPTS; attempt += 1) {
    const stateAtRequest = gameState;
    if (!stateAtRequest || phase !== "botThinking") return;

    botAttempt = attempt;
    message = attempt === 1
      ? null
      : { kind: "botRetry", attempt, maxAttempts: MAX_BOT_ATTEMPTS };
    publish();

    try {
      const result = await engineClient.analyze(stateAtRequest, BOT_DEPTH);
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
        engineClient.restart();
        continue;
      }
    }
  }

  phase = "fatalError";
  message = { kind: "fatalError" };
  publish();
}
```

- [x] **Step 8: 재시도와 오류 테스트 작성 및 검증**

두 테스트를 작성한다.

1. 앞의 두 `analyze()`는 reject, 세 번째는 정상 → `restart()` 2회, 최종 `humanTurn`, `(2/3)`과 `(3/3)` 발행
2. 세 요청 모두 reject → `restart()` 2회, 최종 `fatalError`, Canvas 입력 후 상태 변화 없음

Run:

```powershell
npx vitest run src/client/gameController.test.ts --configLoader native
npm run typecheck
```

Expected: Controller 테스트 PASS, TypeScript 오류 0개.

- [x] **Step 9: 학습 체크포인트**

클로저가 `GameState`를 기억하는 방식, `onChange`, 동기 사용자 수와 비동기 봇 수, epoch가 오래된 Promise 응답을 막는 원리를 설명한다.

제안 커밋 메시지: `feat: 사용자와 봇의 경기 흐름 구현`

---

### Task 5: 표시 모델, Canvas Renderer와 HTML UI

**Files:**
- Create: `src/client/render.ts`
- Test: `src/client/render.test.ts`
- Modify: `index.html`
- Modify: `content/strings.json`
- Modify: `content/theme.json`
- Modify: `tools/validate.ts`

**Interfaces:**
- Consumes: `ClientViewState`, `BOARD_GEOMETRY`, `gameResult()`, theme, strings
- Produces: `RenderRefs`, `Presentation`, `buildPresentation()`, `createRenderer()`

- [x] **Step 1: S2 콘텐츠 계약 확장**

`strings.json`의 `match`에 다음 키를 추가한다.

```json
{
  "start": "게임 시작",
  "newGame": "새 게임",
  "move": "이동",
  "pass": "패스",
  "shoot": "슛",
  "ready": "게임을 시작하세요.",
  "humanTurn": "내 차례입니다.",
  "botThinking": "봇이 생각 중입니다.",
  "botRetry": "봇 분석을 다시 시도합니다.",
  "homeWin": "승리했습니다!",
  "awayWin": "봇이 승리했습니다.",
  "draw": "무승부입니다.",
  "selectOwn": "먼저 내 기물을 선택하세요.",
  "cannotSteal": "이 기물은 스틸할 수 없습니다.",
  "invalidShot": "선택한 방향으로 슛할 수 없습니다.",
  "fatalError": "봇 분석에 실패했습니다. 새 게임을 시작해 주세요."
}
```

기존 `goal`, `save`, `steal`, `turnLimit`은 유지한다. `theme.json`의 `board`에 추가한다.

```json
{
  "selected": "#ffd166",
  "moveTarget": "#8ecae6",
  "passTarget": "#90be6d",
  "shootTarget": "#ffb703",
  "stealTarget": "#ff4d6d",
  "lastMove": "#bdb2ff"
}
```

`validate.ts`가 위 색상 키와 S2 문구 키 각각의 존재 및 형식을 검사하게 한다.

- [x] **Step 2: 단계별 표시 모델 실패 테스트 작성**

DOM 없이 순수 `buildPresentation()`을 테스트한다.

```ts
const readyState: ClientViewState = {
  phase: "ready",
  gameState: null,
  selectedPieceId: null,
  selectedAction: null,
  availableActions: [],
  candidateMoves: [],
  lastMove: null,
  botAttempt: 0,
  message: null,
};

const humanState: ClientViewState = {
  ...readyState,
  phase: "humanTurn",
  gameState: createInitialState(),
};
```

```ts
it("ready에서는 시작 버튼만 표시한다", () => {
  const presentation = buildPresentation(readyState);
  expect(presentation.showStart).toBe(true);
  expect(presentation.showNewGame).toBe(false);
  expect(presentation.inputLocked).toBe(true);
  expect(presentation.visibleActions).toEqual([]);
});

it("humanTurn에서는 가능한 행동 버튼만 표시한다", () => {
  const presentation = buildPresentation({
    ...humanState,
    availableActions: ["move", "pass"],
  });
  expect(presentation.visibleActions).toEqual(["move", "pass"]);
  expect(presentation.inputLocked).toBe(false);
});

it("finished에서는 결과와 새 게임 버튼을 표시한다", () => {
  const finished = createInitialState();
  finished.score.home = 3;
  const presentation = buildPresentation({ ...humanState, phase: "finished", gameState: finished });
  expect(presentation.status).toBe("승리했습니다!");
  expect(presentation.showNewGame).toBe(true);
  expect(presentation.inputLocked).toBe(true);
});
```

`botThinking`의 시도 1과 재시도 2/3, `fatalError`, 60 ply 무승부도 각각 검증한다.

- [x] **Step 3: 실패 확인**

Run: `npx vitest run src/client/render.test.ts --configLoader native`

Expected: `./render` 모듈이 없어 FAIL.

- [x] **Step 4: HTML 구조 작성**

```html
<main id="app">
  <section id="match-info" aria-live="polite">
    <span>HOME <strong id="score-home">0</strong></span>
    <span>AWAY <strong id="score-away">0</strong></span>
    <span id="turn-info">0 / 60 ply</span>
  </section>
  <p id="status-message" role="status"></p>
  <canvas id="board" width="1200" height="720" aria-label="KickMate 경기장"></canvas>
  <section id="actions" aria-label="기물 행동">
    <button id="action-move" type="button">이동</button>
    <button id="action-pass" type="button">패스</button>
    <button id="action-shoot" type="button">슛</button>
  </section>
  <button id="start-game" type="button">게임 시작</button>
  <button id="new-game" type="button">새 게임</button>
</main>
```

CSS는 HTML에 유지하고 작은 화면에서 Canvas가 가로폭을 넘지 않게 한다. `[hidden] { display: none; }`를 둔다. `prototype.html`의 스타일이나 script는 복사하지 않는다.

- [x] **Step 5: 표시 모델과 Renderer 구현**

```ts
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

export function createRenderer(refs: RenderRefs): (state: ClientViewState) => void;
```

`buildPresentation()`은 phase와 `gameResult(gameState)`로 값을 계산한다. `message`가 있으면 phase 문구보다 우선하며 다음처럼 콘텐츠 문구로 변환한다.

```ts
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
```

Canvas는 매 호출마다 다음 순서로 전체를 그린다.

1. 양쪽 80px 골대 여백과 13×9 경기장
2. `LastMove.from`과 `LastMove.target`을 사용한 직전 수 표시
3. 선택 행동의 이동·패스·슛 후보
4. 스틸 후보 away 기물의 빨간 테두리
5. 기물과 역할 문자
6. held 공은 소유 기물 오른쪽 위, loose 공은 칸 중앙
7. 선택 기물의 노란 테두리

슛 후보는 `targetForMove()`가 반환한 골대 행 중앙에 원으로 그린다. DOM은 `Presentation`에 따라 `textContent`, `hidden`, `aria-pressed`, `disabled`를 갱신한다.

- [x] **Step 6: 표시·콘텐츠 검증**

Run:

```powershell
npx vitest run src/client/render.test.ts --configLoader native
npm run validate
npm run typecheck
```

Expected: 표시 모델 테스트 PASS, 콘텐츠 검증 PASS, TypeScript 오류 0개.

- [x] **Step 7: 학습 체크포인트**

Canvas와 DOM의 역할 차이, Renderer가 상태를 소유하지 않는 이유, `Record<ClientAction, HTMLButtonElement>`를 설명한다.

제안 커밋 메시지: `feat: 대국 화면과 상태 표시 구현`

---

### Task 6: main.ts 조립과 브라우저 대국 연결

**Files:**
- Modify: `src/client/main.ts`
- Create: `src/client/main.test.ts`
- Reuse: `src/client/input.ts`
- Reuse: `src/client/engineClient.ts`
- Reuse: `src/client/gameController.ts`
- Reuse: `src/client/render.ts`

**Interfaces:**
- Consumes: Task 2~5의 클라이언트 공개 API
- Produces: 브라우저 이벤트에서 완전한 S2 흐름으로 이어지는 진입점

- [x] **Step 1: 정적 렌더링 제거와 DOM 조회 헬퍼 작성**

기존 `createInitialState()` 호출과 직접 Canvas 그리기를 제거한다.

```ts
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`필수 DOM 요소가 없습니다: ${selector}`);
  return element;
}
```

Canvas 2D context도 null이면 명시적인 Error를 던진다.

- [x] **Step 2: 모듈 조립**

```ts
const render = createRenderer(refs);
const engineClient = createEngineClient({ timeoutMs: 5_000 });
const controller = createGameController({ engineClient, onChange: render });
```

Controller 생성 시 초기 `ready`를 발행하거나 생성 직후 한 번 render한다. 두 방식을 동시에 쓰지 않는다.

- [x] **Step 3: 이벤트 연결**

```ts
startButton.addEventListener("click", () => controller.startGame());
newGameButton.addEventListener("click", () => controller.restartGame());
moveButton.addEventListener("click", () => controller.selectAction("move"));
passButton.addEventListener("click", () => controller.selectAction("pass"));
shootButton.addEventListener("click", () => controller.selectAction("shoot"));

canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (canvas.width / rect.width);
  const y = (event.clientY - rect.top) * (canvas.height / rect.height);
  controller.handleTarget(canvasPointToTarget(x, y));
});

window.addEventListener("beforeunload", () => controller.dispose());
```

- [x] **Step 4: 정적 통합 검증**

Run:

```powershell
npm run typecheck
npm run check
```

Expected: TypeScript 오류 0개, 전체 Vitest PASS, 콘텐츠 검증 PASS.

- [x] **Step 5: 개발 서버 기본 흐름 확인**

Run: `npm run dev`

브라우저에서 확인한다.

1. 최초 화면에는 게임 시작 버튼만 보인다.
2. 시작 후 home 기물 선택 시 가능한 행동 버튼만 보인다.
3. 이동·패스·슛 후보가 행동별로 표시된다.
4. 스틸 가능한 away 볼 소유자 직접 클릭으로 스틸된다.
5. 사람 수 뒤 입력이 잠기고 봇 응수 뒤 다시 열린다.
6. 점수, ply, held/loose 공이 상태와 일치한다.

개발 서버 실행이 차단되면 사용자 터미널에서 같은 명령으로 확인한다.

2026-08-17 관리 환경에서는 Vite가 의존성 스캔 중 자식 프로세스를 생성하지 못해
`spawn EPERM`으로 차단되었다. 자동화는 `src/client/main.test.ts`로 검증했고, 사용자가
자신의 개발 서버에서 게임 시작, 기물·행동 선택, 사람 수와 봇 응수를 직접 확인했다.

- [x] **Step 6: 학습 체크포인트**

`main.ts`가 객체를 조립하는 방식과 DOM 이벤트가 Controller, 엔진, Renderer를 거쳐 화면으로 돌아오는 순환을 설명한다.

제안 커밋 메시지: `feat: 브라우저 봇 대국 흐름 연결`

---

### Task 7: 종료·오류 시나리오와 최종 문서 동기화

**Files:**
- Modify if a missing regression is found: `src/engine/rules.test.ts`
- Modify if a missing regression is found: `src/client/gameController.test.ts`
- Modify: `docs/current-state.md`
- Modify: `docs/project-plan.md`
- Modify: `docs/game-policy.md`
- Verify unchanged: `reference/prototype.html`

**Interfaces:**
- Consumes: 완성된 S2 대국 흐름
- Produces: 재현 가능한 완료 증거와 실제 상태 문서

- [x] **Step 1: 3골 조기 종료 확인**

Controller 테스트의 `createState` 주입으로 2골 상태를 만들고 다음 골 직후를 검증한다.

- 봇을 호출하지 않음
- `finished`, 결과 문구, 새 게임 표시
- Canvas와 행동 입력 잠금

- [x] **Step 2: 60 ply 승·패·무와 새 게임 확인**

`turn: 59` 상태에서 마지막 수 뒤 home 우세, away 우세, 동점을 각각 검증한다. 모든 결과에서 `restartGame()` 후 `turn: 0`, 0:0, `humanTurn`인지 확인한다.

- [x] **Step 3: Worker 세 번 실패 확인**

Fake EngineClient가 세 번 reject하도록 하고 다음을 확인한다.

- 시도 2와 3 전에 `restart()` 호출
- `(2/3)`, `(3/3)` 발행
- 세 번째 실패 뒤 `fatalError`
- Canvas 입력 무시
- 새 게임 즉시 시작

- [x] **Step 4: 전체 자동 검증**

Run: `npm run check`

Expected: typecheck PASS, 모든 Vitest PASS, content 검증 PASS.

- [x] **Step 5: 빌드와 diff 검증**

Run:

```powershell
npm run build
git diff --check
git diff --exit-code -- reference/prototype.html
```

Expected: Vite build exit 0, 공백 오류 0개, `prototype.html` diff 없음. 관리 환경의 `spawn EPERM`이면 사용자 터미널에서 빌드 exit 0을 확인하기 전에는 완료 처리하지 않는다.

2026-08-17 사용자 터미널에서 Vite 12개 모듈과 Worker 번들을 변환해 233ms에 빌드했고,
Codex 환경에서는 `git diff --check`와 `prototype.html` 미변경을 별도로 확인했다.

- [x] **Step 6: 실제 상태 문서 갱신**

검증이 끝난 뒤에만 반영한다.

- `docs/current-state.md`: S2를 구현 완료로 이동하고 실제 테스트 수와 검증 날짜 기록
- `docs/project-plan.md`: M2 체크와 상태를 완료로 바꾸고 다음 우선순위를 M3로 이동
- `docs/game-policy.md`: 3골 선취와 깊이 3을 `[승인]`에서 코드·테스트 근거가 있는 `[확정]`으로 승격

실행하지 않은 테스트나 확인하지 않은 브라우저 동작은 완료로 기록하지 않는다.

- [x] **Step 7: 최종 학습 체크포인트**

```text
index.html 이벤트
  → main.ts 조립
  → GameController 입력 해석
  → engine legalMoves/applyMove/gameResult
  → EngineClient와 Worker search
  → 새 ClientViewState
  → render.ts가 Canvas와 DOM 갱신
```

변경 파일, 테스트 결과, 남은 제한을 설명하고 사용자 검토 전에는 커밋하지 않는다.

제안 커밋 메시지: `feat: S2 봇 대국 완주 기능 완성`

---

## Final Acceptance Checklist

- [ ] 사용자가 home, 봇이 away로 고정된다.
- [ ] 최초 시작과 종료·오류 후 즉시 새 게임이 동작한다.
- [ ] 이동·패스·슛 버튼은 가능한 행동만 표시한다.
- [ ] 스틸은 버튼 없이 away 볼 소유자 직접 클릭으로 실행된다.
- [ ] 빈 공간 선택 해제, home 선택 전환, 패스 우선순위가 동작한다.
- [ ] 봇은 Worker에서 깊이 3으로 탐색한다.
- [ ] 5초 제한과 최대 3회 자동 재시도, Worker 교체가 동작한다.
- [ ] 3골 선취 또는 전체 60 ply에서 정확한 결과로 종료한다.
- [ ] 종료 상태에서 합법 수와 봇 탐색이 진행되지 않는다.
- [ ] held·loose 공, 점수, 턴, 남은 ply, 후보와 마지막 수가 표시된다.
- [ ] `reference/prototype.html`에 변경이 없다.
- [ ] `npm run check`가 통과한다.
- [ ] `npm run build`가 통과한다.
- [ ] `git diff --check`가 통과한다.
- [ ] 사용자가 요청하지 않은 커밋이 없다.
