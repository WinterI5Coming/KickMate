# FT&G-Inspired Match Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** KickMate의 현재 한 수 한 행동 경기를 팀 턴당 3행동, 선수당 최대 2행동, 압박·버티기, 팀 턴 단위 스틸 보호와 필드 슛 리바운드를 갖춘 결정론적 6대6 경기로 개편한다.

**Architecture:** 순수 엔진의 `GameState`가 행동 경제와 보호 만료를 소유하고 `legalMoves()`, `previewMove()`, `applyMove()`가 유일한 룰 판정 경계가 된다. 탐색은 같은 팀의 연속 행동을 처리하는 고정 관점 minimax로 바꾸며, Controller는 `sideToMove()`가 home으로 돌아올 때까지 봇 행동을 반복한다. 클라이언트는 엔진 상태와 미리보기를 표시할 뿐 압박·리바운드 규칙을 복제하지 않는다.

**Tech Stack:** TypeScript 5.6+, Vitest 3, Vite 6, Canvas 2D, Web Worker

**Spec:** [docs/superpowers/specs/2026-08-22-ftg-inspired-match-core-design.md](../specs/2026-08-22-ftg-inspired-match-core-design.md)

## Global Constraints

- `src/engine/`은 DOM, Worker 전역, 파일시스템과 브라우저 전용 API를 참조하지 않는다.
- 엔진에서 `Math.random()`을 사용하지 않고 같은 상태·옵션의 결과와 후보 순서를 재현한다.
- `applyMove(state, move)`는 입력 상태와 중첩 객체를 변경하지 않는다.
- 보드 크기 13×9, 6대6 배치, 3골 선취, 최대 60 원자 행동을 유지한다.
- 한 팀 턴은 행동 3개, 한 선수는 팀 턴당 최대 2개 행동을 사용한다.
- `endTurn`은 한 번 이상 행동한 뒤에만 합법이며 원자 행동 수를 증가시키지 않는다.
- 확률, 선수 스탯, 포인트 배분, 커리어와 특수 스킬은 이 계획에 포함하지 않는다.
- 새 의존성을 추가하지 않는다.
- `reference/`는 수정하지 않는다.
- 저장소 규칙에 따라 사용자가 별도로 요청하기 전에는 커밋하지 않는다. 각 Task는 테스트 통과와 diff 검토를 독립 검토 지점으로 사용한다.

---

## File Map

| 파일 | 책임 | 변경 요약 |
|---|---|---|
| `src/engine/types.ts` | 엔진 공개 상태·행동·미리보기 계약 | 팀 턴, 스틸 보호, `hold`, `endTurn`, 슛 결과 타입 추가 |
| `src/engine/rules.ts` | 합법 수·압박·보호·리바운드·상태 전이 | 팀 턴 전환과 새 규칙의 단일 구현 |
| `src/engine/rules.test.ts` | 엔진 행동 관찰 테스트 | 행동 경제, 압박, 보호, 슛, 종료 경계 추가 |
| `src/engine/search.ts` | 결정론적 탐색 | 연속 같은 팀 행동을 처리하는 minimax로 교체 |
| `src/client/types.ts` | 화면 상태 계약 | 버티기·턴 종료 가능 여부 추가 |
| `src/client/gameController.ts` | 사람·봇 팀 턴 흐름 | 사람 연속 행동, 봇 연속 분석·적용, 직접 버튼 행동 |
| `src/client/gameController.test.ts` | Controller 흐름 검증 | 사람 3행동, 조기 종료, 봇 전체 팀 턴, 종료 경계 추가 |
| `src/client/input.ts` | Canvas 대상 행동 변환 | 보드 대상 행동만 좁히는 타입 가드 추가 |
| `src/client/input.test.ts` | 입력 왕복 검증 | `hold`, `endTurn`이 Canvas 대상을 요구하지 않음을 검증 |
| `src/client/render.ts` | DOM·Canvas 표현 | 남은 행동, 압박, 버티기, 보호, 리바운드 예상 칸 표시 |
| `src/client/render.test.ts` | 표시 모델·Canvas 검증 | 새 버튼과 시각 상태 검증 |
| `src/client/main.ts` | DOM 이벤트 연결 | 버티기·턴 종료 버튼 연결 |
| `src/client/main.test.ts` | 브라우저 진입 통합 | 세 사람 행동 후 봇 팀 턴 전체 왕복 검증 |
| `index.html` | 정적 UI 골격 | 버티기·턴 종료 버튼과 제품 제목 갱신 |
| `content/strings.json` | 사용자 문구 | 새 행동과 압박·리바운드 문구 추가 |
| `content/theme.json` | Canvas 색상 | 압박·버티기·리바운드 색상 추가 |
| `docs/*.md` | 현재 상태·정책·로드맵 | 실제 구현·검증 결과만 완료 상태로 갱신 |

---

### Task 1: 팀 턴 상태와 3행동 경제

**Files:**
- Modify: `src/engine/types.ts`
- Modify: `src/engine/rules.ts`
- Test: `src/engine/rules.test.ts`

**Interfaces:**
- Produces: `StealProtection`, `GameState.activeTeam`, `actionsRemaining`, `actionCountByPiece`, `heldFirmPieceId`
- Produces: `Move`의 `{ kind: "hold"; pieceId: number }`, `{ kind: "endTurn" }`
- Produces: `sideToMove(state): Team`이 `activeTeam`을 반환
- Produces: `switchTeamTurn(state): void` 내부 헬퍼와 원자 행동 완료 규칙

- [ ] **Step 1: 초기 상태와 팀 턴 공개 계약의 실패 테스트를 추가한다**

```ts
it("첫 home 팀 턴을 3행동과 빈 선수별 사용 횟수로 시작한다", () => {
  const state = createInitialState();

  expect(sideToMove(state)).toBe("home");
  expect(state.actionsRemaining).toBe(3);
  expect(state.actionCountByPiece).toEqual({});
  expect(state.heldFirmPieceId).toBeNull();
});

it("세 원자 행동 뒤 away의 새 3행동 팀 턴으로 넘어간다", () => {
  let state = createInitialState();
  for (let index = 0; index < 3; index += 1) {
    const move = legalMoves(state).find((candidate) => candidate.kind === "move")!;
    state = applyMove(state, move);
  }

  expect(state.turn).toBe(3);
  expect(sideToMove(state)).toBe("away");
  expect(state.actionsRemaining).toBe(3);
  expect(state.actionCountByPiece).toEqual({});
});
```

- [ ] **Step 2: 엔진 테스트를 실행해 새 필드가 없어 실패하는지 확인한다**

Run: `npm run test -- src/engine/rules.test.ts`

Expected: `actionsRemaining`, `actionCountByPiece`, `heldFirmPieceId` 타입 또는 값 불일치로 FAIL.

- [ ] **Step 3: 상태와 행동 타입을 정확히 추가한다**

```ts
export interface StealProtection {
  pieceId: number;
  blockedTeam: Team;
  expiresAfterTeamTurn: Team;
}

export interface GameState {
  turn: number;
  maxTurns: number;
  activeTeam: Team;
  actionsRemaining: number;
  actionCountByPiece: Record<number, number>;
  heldFirmPieceId: number | null;
  pieces: Piece[];
  ball: BallState;
  stealProtection: StealProtection | null;
  score: { home: number; away: number };
}

export type Move =
  | { kind: "move"; pieceId: number; to: Pos }
  | { kind: "pass"; pieceId: number; targetPieceId: number }
  | { kind: "shoot"; pieceId: number; goalRow: 3 | 4 | 5 }
  | { kind: "steal"; pieceId: number; targetPieceId: number }
  | { kind: "hold"; pieceId: number }
  | { kind: "endTurn" };
```

기존 숫자형 `noSteal`은 제거한다. 초기 상태는 `activeTeam: "home"`,
`actionsRemaining: 3`, `actionCountByPiece: {}`, `heldFirmPieceId: null`,
`stealProtection: null`로 만든다. `cloneState()`는 `actionCountByPiece`와
`stealProtection`도 새 객체로 복제한다.

- [ ] **Step 4: 팀 턴 전환과 행동 완료 헬퍼를 구현한다**

```ts
const ACTIONS_PER_TEAM_TURN = 3;
const ACTIONS_PER_PIECE = 2;

export function sideToMove(state: GameState): Team {
  return state.activeTeam;
}

function switchTeamTurn(state: GameState): void {
  const outgoing = state.activeTeam;
  if (state.stealProtection?.expiresAfterTeamTurn === outgoing) {
    state.stealProtection = null;
  }
  state.activeTeam = otherTeam(outgoing);
  state.actionsRemaining = ACTIONS_PER_TEAM_TURN;
  state.actionCountByPiece = {};
  state.heldFirmPieceId = null;
}

function completeAtomicAction(state: GameState, pieceId: number): void {
  state.turn += 1;
  state.actionsRemaining -= 1;
  state.actionCountByPiece[pieceId] = (state.actionCountByPiece[pieceId] ?? 0) + 1;
  if (gameResult(state) === null && state.actionsRemaining === 0) switchTeamTurn(state);
}
```

`legalMoves()`는 `actionCountByPiece[piece.id] < 2`인 현재 팀 선수만 생성한다.
`endTurn`은 `actionsRemaining < 3`일 때 목록 끝에 한 번 추가한다. `applyMove(endTurn)`은
`turn`을 늘리지 않고 `switchTeamTurn()`만 호출한다. 득점은 원자 행동을 먼저 기록한
뒤 `resetForKickoff(next, otherTeam(team))`가 실점 팀의 새 3행동 턴을 구성한다.

- [ ] **Step 5: 선수당 2행동, 조기 종료, 득점·60행동 경계 테스트를 추가한다**

```ts
it("같은 선수의 세 번째 행동은 만들지 않지만 다른 선수는 남은 행동을 쓴다", () => {
  let state = createInitialState();
  const actorId = 0;
  for (let index = 0; index < 2; index += 1) {
    const move = legalMoves(state).find(
      (candidate) => candidate.kind === "move" && candidate.pieceId === actorId,
    )!;
    state = applyMove(state, move);
  }

  expect(legalMoves(state).some((move) => "pieceId" in move && move.pieceId === actorId)).toBe(false);
  expect(legalMoves(state).some((move) => "pieceId" in move && move.pieceId !== actorId)).toBe(true);
});

it("한 행동 뒤 endTurn은 행동 수를 늘리지 않고 상대 팀으로 넘긴다", () => {
  const initial = createInitialState();
  expect(legalMoves(initial).some((move) => move.kind === "endTurn")).toBe(false);
  const moved = applyMove(initial, legalMoves(initial).find((move) => move.kind === "move")!);
  const ended = applyMove(moved, { kind: "endTurn" });

  expect(ended.turn).toBe(1);
  expect(sideToMove(ended)).toBe("away");
  expect(ended.actionsRemaining).toBe(3);
});
```

기존 득점 테스트에는 `activeTeam === "away"`, `actionsRemaining === 3`을 추가하고,
60번째 행동 테스트에는 `gameResult()`와 `legalMoves() === []`를 유지한다.

- [ ] **Step 6: 엔진 행동 경제 테스트를 통과시킨다**

Run: `npm run test -- src/engine/rules.test.ts`

Expected: Task 1의 초기 상태, 3행동, 선수 제한, 조기 종료, 득점, 60행동 테스트 PASS.

- [ ] **Step 7: Task 1 diff를 독립 검토한다**

Run: `git diff --check`

Expected: 출력 없이 종료 코드 0. 커밋은 만들지 않는다.

---

### Task 2: 압박·버티기와 팀 턴 단위 스틸 보호

**Files:**
- Modify: `src/engine/types.ts`
- Modify: `src/engine/rules.ts`
- Test: `src/engine/rules.test.ts`
- Modify: `src/engine/eval/lv1.ts`

**Interfaces:**
- Consumes: Task 1의 팀 턴 상태와 `StealProtection`
- Produces: `isPressured(state: GameState, pieceId: number): boolean`
- Produces: 보호 판정 `isStealProtected(state, carrierId, attackingTeam): boolean` 내부 헬퍼
- Produces: `MovePreview`의 `hold`, `endTurn` 변형

- [ ] **Step 1: 압박 중 이동과 버티기 실패 테스트를 추가한다**

```ts
it("인접 상대에게 압박받는 공 소유자는 바로 이동하지 못한다", () => {
  const state = createInitialState();
  const carrierId = state.ball.kind === "held" ? state.ball.pieceId : -1;
  const carrier = state.pieces.find((piece) => piece.id === carrierId)!;
  const defender = state.pieces.find((piece) => piece.team === "away" && piece.role === "FW")!;
  defender.pos = { x: carrier.pos.x + 1, y: carrier.pos.y };

  expect(isPressured(state, carrier.id)).toBe(true);
  expect(legalMoves(state).some((move) => move.kind === "move" && move.pieceId === carrier.id)).toBe(false);
  expect(legalMoves(state)).toContainEqual({ kind: "hold", pieceId: carrier.id });
});

it("버티기 뒤 공 소유자의 다음 이동 한 번만 허용한다", () => {
  const pressured = createInitialState();
  const carrierId = pressured.ball.kind === "held" ? pressured.ball.pieceId : -1;
  const held = applyMove(pressured, { kind: "hold", pieceId: carrierId });

  expect(held.heldFirmPieceId).toBe(carrierId);
  const escape = legalMoves(held).find((move) => move.kind === "move" && move.pieceId === carrierId)!;
  const escaped = applyMove(held, escape);
  expect(escaped.heldFirmPieceId).toBeNull();
  expect(escaped.actionCountByPiece[carrierId]).toBe(2);
});
```

초기 상태는 home 공 소유자 `(6,4)`와 away FW `(7,4)`가 이미 인접하므로 별도 fixture를
추가하지 않는다.

- [ ] **Step 2: 압박 테스트의 실패를 확인한다**

Run: `npm run test -- src/engine/rules.test.ts -t "압박|버티기"`

Expected: `isPressured` 부재 또는 압박 이동이 생성되어 FAIL.

- [ ] **Step 3: 압박과 버티기 합법 수·상태 전이를 구현한다**

```ts
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
```

공 소유자의 이동 생성 조건은 `!isPressured(...) || state.heldFirmPieceId === piece.id`로
제한한다. `hold`는 현재 팀 공 소유자가 압박받고 아직 버티지 않았으며 선수 행동 횟수가
2 미만일 때 한 번만 생성한다. `applyMove(hold)`는 위치와 공을 바꾸지 않고
`heldFirmPieceId`를 설정한 뒤 원자 행동을 완료한다. 버틴 선수가 이동하거나 공이 다른
기물로 옮겨지거나 팀 턴이 끝나면 `heldFirmPieceId = null`로 만든다.

`previewMove()`에는 아래 값을 추가한다.

```ts
| { kind: "hold"; pieceId: number }
| { kind: "endTurn" };
```

- [ ] **Step 4: 이동 후 즉시 스틸과 보호 만료 실패 테스트를 추가한다**

```ts
it("수비수는 첫 행동으로 접근하고 두 번째 행동으로 스틸한다", () => {
  const state = createInitialState();
  state.activeTeam = "away";
  state.pieces.find((piece) => piece.id === 11)!.pos = { x: 8, y: 4 };
  const defenderId = 11;
  const approach = legalMoves(state).find(
    (move) =>
      move.kind === "move" &&
      move.pieceId === defenderId &&
      move.to.x === 7 &&
      move.to.y === 4,
  )!;
  const adjacent = applyMove(state, approach);
  const steal = legalMoves(adjacent).find(
    (move) => move.kind === "steal" && move.pieceId === defenderId,
  )!;
  const stolen = applyMove(adjacent, steal);

  expect(stolen.ball).toEqual({ kind: "held", pieceId: defenderId });
  expect(stolen.stealProtection).toEqual({
    pieceId: defenderId,
    blockedTeam: "home",
    expiresAfterTeamTurn: "home",
  });
});
```

현재 행동 팀이 스틸한 경우 `blockedTeam`은 상대 팀이고 상대의 다음 팀 턴 종료까지
보호한다. GK가 비행동 팀으로서 슛을 막은 경우 `blockedTeam`과
`expiresAfterTeamTurn`은 현재 공격 팀으로 두어 공격 팀의 남은 행동 동안만 보호한다.
보호 대상이 패스·슛·재스틸로 공을 잃으면 즉시 `null`로 만든다.

- [ ] **Step 5: 보호 판정과 팀 턴 만료를 구현한다**

```ts
function isStealProtected(state: GameState, carrierId: number, team: Team): boolean {
  return state.stealProtection?.pieceId === carrierId &&
    state.stealProtection.blockedTeam === team;
}

function clearProtectionIfCarrierChanged(state: GameState): void {
  if (
    state.stealProtection &&
    (state.ball.kind !== "held" || state.ball.pieceId !== state.stealProtection.pieceId)
  ) {
    state.stealProtection = null;
  }
}
```

스틸 생성 조건의 `state.noSteal === 0`을 `!isStealProtected(...)`로 교체한다.
`switchTeamTurn()`은 Task 1에 정의한 `expiresAfterTeamTurn` 비교로 보호를 해제한다.
`eval/lv1.ts`의 스틸 위협도 같은 `legalMoves()` 결과 또는 공개 보호 상태를 기준으로
계산하여 보호 중인 상대를 위험으로 잘못 감점하지 않게 한다.

- [ ] **Step 6: 압박·버티기·스틸 보호 테스트를 통과시킨다**

Run: `npm run test -- src/engine/rules.test.ts`

Expected: 압박 이동 금지, 버티기 탈출, 이동 후 스틸, 보호 팀과 만료 경계 PASS.

- [ ] **Step 7: Task 2 diff를 독립 검토한다**

Run: `git diff --check`

Expected: 출력 없이 종료 코드 0. 커밋은 만들지 않는다.

---

### Task 3: 아군 통과 슛과 결정론적 필드 리바운드

**Files:**
- Modify: `src/engine/types.ts`
- Modify: `src/engine/rules.ts`
- Test: `src/engine/rules.test.ts`
- Modify: `src/engine/eval/lv1.ts`

**Interfaces:**
- Consumes: Task 1의 원자 행동 완료와 Task 2의 보호 상태
- Produces: `ShootPreview` 판별 결과 `goal | goalkeeperSave | fieldRebound | fieldPossession`
- Produces: `reboundPos: Pos | null`

- [ ] **Step 1: 슛 결과 타입과 네 경계의 실패 테스트를 추가한다**

```ts
export interface ShootPreview {
  kind: "shoot";
  path: Pos[];
  goalRow: 3 | 4 | 5;
  outcome: "goal" | "goalkeeperSave" | "fieldRebound" | "fieldPossession";
  blockerPieceId: number | null;
  reboundPos: Pos | null;
}
```

테스트 파일에 작은 명시적 상태 생성기를 추가한다.

```ts
function createShotState(pieces: Piece[]): GameState {
  return {
    ...createInitialState(),
    activeTeam: "home",
    actionsRemaining: 3,
    actionCountByPiece: {},
    heldFirmPieceId: null,
    pieces: pieces.map((piece) => ({ ...piece, pos: { ...piece.pos } })),
    ball: { kind: "held", pieceId: 0 },
    stealProtection: null,
  };
}
```

```ts
it("슛 경로의 아군은 차단하지 않고 공이 통과한다", () => {
  const state = createShotState([
    { id: 0, team: "home", role: "FW", pos: { x: 7, y: 4 } },
    { id: 1, team: "home", role: "MF", pos: { x: 9, y: 4 } },
    { id: 2, team: "away", role: "GK", pos: { x: 12, y: 0 } },
  ]);
  const shot = legalMoves(state).find((move) => move.kind === "shoot" && move.goalRow === 4)!;
  expect(previewMove(state, shot)).toMatchObject({ kind: "shoot", outcome: "goal" });
});

it("상대 필드 차단은 슈터 쪽 우선순위의 빈 칸에 루즈볼을 만든다", () => {
  const state = createShotState([
    { id: 0, team: "home", role: "FW", pos: { x: 7, y: 4 } },
    { id: 1, team: "away", role: "DF", pos: { x: 10, y: 4 } },
    { id: 2, team: "away", role: "GK", pos: { x: 12, y: 0 } },
  ]);
  const shot = legalMoves(state).find((move) => move.kind === "shoot" && move.goalRow === 4)!;
  const preview = previewMove(state, shot);
  expect(preview).toMatchObject({
    kind: "shoot",
    outcome: "fieldRebound",
    reboundPos: { x: 9, y: 4 },
  });
  expect(applyMove(state, shot).ball).toEqual({ kind: "loose", pos: { x: 9, y: 4 } });
});
```

GK 차단 테스트는 id 1의 역할을 `GK`로 바꾸어 `goalkeeperSave`와 held 공을 기대한다.
빈 후보 예외 테스트는 `(10,4)` 주변 `(9..11,3..5)`의 나머지 8칸에 고유 ID의 기물을
배치해 `fieldPossession`과 차단자 held 공을 기대한다.

- [ ] **Step 2: 새 슛 결과 테스트가 기존 `blocked` 판정 때문에 실패하는지 확인한다**

Run: `npm run test -- src/engine/rules.test.ts -t "슛 경로의 아군|필드 차단|골키퍼"`

Expected: 기존 첫 기물 차단 또는 `blocked` 결과로 FAIL.

- [ ] **Step 3: 상대만 찾는 경로 판정과 리바운드 선택을 구현한다**

```ts
function firstPieceOnPath(
  state: GameState,
  steps: PathStep[],
  accepts: (piece: Piece) => boolean = () => true,
): Piece | undefined {
  for (const step of steps) {
    const hits = state.pieces
      .filter((piece) => accepts(piece) && step.cells.some((cell) => samePos(cell, piece.pos)))
      .sort((left, right) => left.id - right.id);
    if (hits[0]) return hits[0];
  }
  return undefined;
}

function reboundPosition(state: GameState, blocker: Piece, shooter: Piece): Pos | null {
  return DIRS_8
    .map((direction) => ({ x: blocker.pos.x + direction.x, y: blocker.pos.y + direction.y }))
    .filter((pos) => inBounds(pos) && !pieceAt(state, pos))
    .sort((left, right) => {
      const leftDistance = (left.x - shooter.pos.x) ** 2 + (left.y - shooter.pos.y) ** 2;
      const rightDistance = (right.x - shooter.pos.x) ** 2 + (right.y - shooter.pos.y) ** 2;
      return leftDistance - rightDistance || left.y - right.y || left.x - right.x;
    })[0] ?? null;
}
```

패스는 기존처럼 모든 기물을 대상으로 한다. 슛만
`firstPieceOnPath(state, steps, piece => piece.team !== actor.team)`을 사용한다.
상대가 없으면 `goal`, GK면 `goalkeeperSave`, 필드 선수와 빈 후보가 있으면
`fieldRebound`, 빈 후보가 없으면 `fieldPossession`을 반환한다.

- [ ] **Step 4: 슛 상태 전이와 평가를 새 결과에 맞춘다**

`applyMove(shoot)`는 결과별로 다음만 수행한다.

```ts
switch (preview.outcome) {
  case "goal":
    next.score[team] += 1;
    completeAtomicAction(next, move.pieceId);
    resetForKickoff(next, otherTeam(team));
    return next;
  case "goalkeeperSave":
    next.ball = { kind: "held", pieceId: preview.blockerPieceId! };
    next.stealProtection = {
      pieceId: preview.blockerPieceId!,
      blockedTeam: team,
      expiresAfterTeamTurn: team,
    };
    break;
  case "fieldRebound":
    next.ball = { kind: "loose", pos: { ...preview.reboundPos! } };
    next.stealProtection = null;
    break;
  case "fieldPossession":
    next.ball = { kind: "held", pieceId: preview.blockerPieceId! };
    next.stealProtection = null;
    break;
}
```

`eval/lv1.ts`의 열린 슛은 새 미리보기에서 `outcome === "goal"`만 열린 슛으로 본다.

- [ ] **Step 5: 슛과 회귀 테스트를 통과시킨다**

Run: `npm run test -- src/engine/rules.test.ts src/engine/ballPath.test.ts`

Expected: 아군 통과, GK 선방, 필드 리바운드, 빈 후보 예외와 기존 경로 테스트 PASS.

- [ ] **Step 6: Task 3 diff를 독립 검토한다**

Run: `git diff --check`

Expected: 출력 없이 종료 코드 0. 커밋은 만들지 않는다.

---

### Task 4: 같은 팀 연속 행동을 처리하는 탐색

**Files:**
- Modify: `src/engine/search.ts`
- Test: `src/engine/rules.test.ts`

**Interfaces:**
- Consumes: `sideToMove()`, `legalMoves()`, `applyMove()`의 팀 턴 의미
- Preserves: `search(state, { depth, evalFn }): SearchResult`
- Preserves: `SearchResult.values` 점수는 루트 팀 관점

- [ ] **Step 1: 같은 팀 연속 행동에서 관점을 뒤집지 않는 실패 테스트를 추가한다**

```ts
it("같은 팀의 다음 행동에서는 평가 관점을 뒤집지 않는다", () => {
  const state = createInitialState();
  const result = search(state, {
    depth: 1,
    evalFn: (_position, perspective) => perspective === "home" ? 123 : -123,
  });

  expect(result.best).not.toBeNull();
  expect(result.score).toBe(123);
});
```

초기 상태의 첫 자식도 `activeTeam === "home"`이므로 기존 negamax는 말단의 home
관점 `123`을 무조건 반전해 `-123`을 반환한다. 새 minimax는 루트 home 관점을 유지해
`123`을 반환해야 한다. 기존 대칭 점수와 득점 우선 테스트가 상대 팀 최소화 회귀를
계속 보호한다.

- [ ] **Step 2: 기존 negamax가 같은 팀 자식의 부호를 잘못 뒤집어 실패하는지 확인한다**

Run: `npm run test -- src/engine/rules.test.ts -t "평가 관점|상대의 최선 응수"`

Expected: 점수가 `-123`으로 나와 FAIL.

- [ ] **Step 3: negamax를 루트 관점 minimax 알파베타로 교체한다**

```ts
const minimax = (
  position: GameState,
  depth: number,
  alpha: number,
  beta: number,
  perspective: Team,
): number => {
  nodes += 1;
  if (gameResult(position) !== null || depth === 0) {
    return options.evalFn(position, perspective);
  }

  const moves = orderedMoves(position);
  if (moves.length === 0) return options.evalFn(position, perspective);
  const maximizing = sideToMove(position) === perspective;
  let best = maximizing ? -INF : INF;

  for (const move of moves) {
    const score = minimax(applyMove(position, move), depth - 1, alpha, beta, perspective);
    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (alpha >= beta) break;
  }
  return best;
};
```

루트는 `const perspective = sideToMove(state)`를 한 번 정하고 모든 후보를
`minimax(child, depth - 1, -INF, INF, perspective)`로 평가한다. 루트 후보는 모두
기록해야 하므로 후보 간 alpha 경계를 공유하지 않는다. `moveRank()`에는
`hold: 20`, `endTurn: -10`을 추가하고 슛 결과는 `goal: 100`, GK 선방과 필드 차단은
`60`으로 정렬한다.

- [ ] **Step 4: 결정론·후보 점수·성능 회귀를 실행한다**

Run: `npm run test -- src/engine/rules.test.ts`

Expected: 같은 팀 관점, 상대 최소화, 동일 입력 후보 점수 결정론과 depth-3 5초 기준 PASS.

- [ ] **Step 5: Task 4 diff를 독립 검토한다**

Run: `git diff --check`

Expected: 출력 없이 종료 코드 0. 커밋은 만들지 않는다.

---

### Task 5: 사람과 봇의 전체 팀 턴 Controller 흐름

**Files:**
- Modify: `src/client/types.ts`
- Modify: `src/client/gameController.ts`
- Test: `src/client/gameController.test.ts`

**Interfaces:**
- Consumes: `sideToMove(state)`, `Move.hold`, `Move.endTurn`
- Produces: `GameController.holdBall(): void`, `GameController.endTurn(): void`
- Produces: `ClientViewState.canHold`, `ClientViewState.canEndTurn`
- Preserves: 분석 실패당 최대 3회 재시도와 `gameEpoch` 폐기

- [ ] **Step 1: 사람의 연속 행동과 직접 버튼 행동 실패 테스트를 추가한다**

```ts
it("첫 사람 행동 뒤 home 행동이 남으면 botThinking으로 바꾸지 않는다", () => {
  const engineClient = new FakeEngineClient();
  const controller = createGameController({ engineClient, onChange: () => {} });
  controller.startGame();
  const state = controller.getViewState().gameState!;
  const move = legalMoves(state).find((candidate) => candidate.kind === "move")!;
  const actor = state.pieces.find((piece) => piece.id === move.pieceId)!;
  controller.handleTarget({ kind: "cell", pos: actor.pos });
  controller.selectAction("move");
  controller.handleTarget(targetForMove(state, move));

  expect(controller.getViewState().phase).toBe("humanTurn");
  expect(controller.getViewState().gameState?.actionsRemaining).toBe(2);
  expect(engineClient.analyzeCalls).toHaveLength(0);
});

it("턴 종료 버튼은 남은 행동을 버리고 봇 분석을 시작한다", () => {
  const engineClient = new FakeEngineClient();
  const controller = createGameController({ engineClient, onChange: () => {} });
  controller.startGame();
  const state = controller.getViewState().gameState!;
  const move = legalMoves(state).find((candidate) => candidate.kind === "move")!;
  const actor = state.pieces.find((piece) => piece.id === move.pieceId)!;
  controller.handleTarget({ kind: "cell", pos: actor.pos });
  controller.selectAction("move");
  controller.handleTarget(targetForMove(state, move));
  controller.endTurn();

  expect(controller.getViewState().phase).toBe("botThinking");
  expect(engineClient.analyzeCalls).toHaveLength(1);
});
```

압박 fixture를 주입한 Controller에서는 `canHold === true`, `holdBall()` 뒤
`actionsRemaining === 2`, phase가 계속 `humanTurn`인지 검증한다.

- [ ] **Step 2: 기존 Controller가 한 행동 뒤 바로 봇을 호출해 실패하는지 확인한다**

Run: `npm run test -- src/client/gameController.test.ts -t "home 행동|턴 종료 버튼|버티기"`

Expected: 첫 행동 직후 `botThinking` 또는 새 메서드 부재로 FAIL.

- [ ] **Step 3: 화면 상태와 Controller API를 확장한다**

```ts
export interface ClientViewState {
  // 기존 필드 유지
  canHold: boolean;
  canEndTurn: boolean;
}

export interface GameController {
  // 기존 메서드 유지
  holdBall(): void;
  endTurn(): void;
}
```

`snapshot()`은 현재 `legalMoves(gameState)`에서 `hold`, `endTurn` 존재 여부를 계산한다.
`applyHumanMove()`는 적용 후 경기 종료가 아니면 `sideToMove(gameState) === "home"`일 때
`humanTurn`, away일 때 `botThinking`을 선택한다. `holdBall()`과 `endTurn()`은 각각 현재
합법 수에서 정확한 kind 한 개를 찾아 `applyHumanMove()`에 전달한다.

`applyTrackedMove()`는 `hold`, `endTurn`에 Canvas 궤적이 없으므로 `lastMove = null`로
두고, 나머지 네 행동만 기존 `from`과 `target`을 기록한다.

- [ ] **Step 4: 봇이 away 팀 턴 전체를 수행하는 실패 테스트를 추가한다**

```ts
it("봇은 away 행동이 남아 있는 동안 분석과 적용을 반복한다", async () => {
  const engineClient = new FakeEngineClient();
  const responses: Array<ReturnType<typeof deferred<SearchResult>>> = [];
  engineClient.analyzeImpl = () => {
    const response = deferred<SearchResult>();
    responses.push(response);
    return response.promise;
  };
  const controller = createGameController({ engineClient, onChange: () => {} });
  controller.startGame();
  const home = controller.getViewState().gameState!;
  const homeMove = legalMoves(home).find((move) => move.kind === "move")!;
  const actor = home.pieces.find((piece) => piece.id === homeMove.pieceId)!;
  controller.handleTarget({ kind: "cell", pos: actor.pos });
  controller.selectAction("move");
  controller.handleTarget(targetForMove(home, homeMove));
  controller.endTurn();

  for (let index = 0; index < 3; index += 1) {
    const state = engineClient.analyzeCalls[index]!.state;
    const best = legalMoves(state).find((move) => move.kind !== "endTurn")!;
    responses[index]!.resolve({
      best,
      score: 0,
      nodes: 1,
      depth: 3,
      ms: 0,
      values: [{ move: best, score: 0 }],
    });
    await flushPromises();
  }

  expect(engineClient.analyzeCalls).toHaveLength(3);
  expect(controller.getViewState().phase).toBe("humanTurn");
  expect(controller.getViewState().gameState?.activeTeam).toBe("home");
});
```

- [ ] **Step 5: `runBotTurn()`을 팀 턴 루프로 변경한다**

```ts
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

  if (!gameState || disposed || epoch !== gameEpoch) return;
  phase = gameResult(gameState) === null ? "humanTurn" : "finished";
  publish();
}
```

기존 재시도 `for` 블록은 `analyzeWithRetry(state, epoch): Promise<SearchResult | null>`로
추출한다. 각 원자 행동은 최대 3회 재시도하며 성공하면 다음 봇 행동의 시도 횟수는
1부터 다시 시작한다. 경기 종료, 재시작 epoch 변경, dispose는 루프를 즉시 끝낸다.

- [ ] **Step 6: Controller 전체 테스트를 통과시킨다**

Run: `npm run test -- src/client/gameController.test.ts`

Expected: 사람 연속 행동, 조기 종료, 버티기, 봇 3행동, 득점·60행동 종료, 재시도와 epoch 테스트 PASS.

- [ ] **Step 7: Task 5 diff를 독립 검토한다**

Run: `git diff --check`

Expected: 출력 없이 종료 코드 0. 커밋은 만들지 않는다.

---

### Task 6: 입력·DOM·Canvas 표현

**Files:**
- Modify: `src/client/input.ts`
- Test: `src/client/input.test.ts`
- Modify: `src/client/render.ts`
- Test: `src/client/render.test.ts`
- Modify: `src/client/main.ts`
- Test: `src/client/main.test.ts`
- Modify: `index.html`
- Modify: `content/strings.json`
- Modify: `content/theme.json`

**Interfaces:**
- Consumes: Task 3의 `ShootPreview`, Task 5의 `canHold`, `canEndTurn`
- Produces: `TargetedMove`, `isTargetedMove(move): move is TargetedMove`
- Produces: `RenderRefs.holdButton`, `RenderRefs.endTurnButton`
- Produces: `Presentation.showHold`, `showEndTurn`

- [ ] **Step 1: Canvas 대상이 있는 행동을 타입으로 분리한다**

```ts
export type TargetedMove = Exclude<Move, { kind: "hold" } | { kind: "endTurn" }>;

export function isTargetedMove(move: Move): move is TargetedMove {
  return move.kind !== "hold" && move.kind !== "endTurn";
}

export function targetForMove(state: GameState, move: TargetedMove): CanvasTarget {
  // 기존 네 행동 변환을 유지한다.
}
```

`moveMatchesTarget()`도 `TargetedMove`만 받는다. Controller와 Renderer는 후보를 Canvas에
그리기 전에 `isTargetedMove()`로 좁힌다. 입력 왕복 완주 테스트는 합법 수 중 targeted
행동만 Canvas 왕복 대상으로 검사하고 `hold`, `endTurn`은 직접 버튼 행동임을 별도
assert한다.

- [ ] **Step 2: 입력 테스트를 실행한다**

Run: `npm run test -- src/client/input.test.ts`

Expected: 네 Canvas 행동과 두 직접 버튼 행동의 타입·왕복 테스트 PASS.

- [ ] **Step 3: 표시 모델과 정적 버튼의 실패 테스트를 추가한다**

```ts
it("사람 팀 턴의 남은 행동과 선택 선수 사용 횟수를 표시한다", () => {
  const gameState = createInitialState();
  gameState.actionsRemaining = 2;
  gameState.actionCountByPiece[3] = 1;
  const presentation = buildPresentation({ ...humanState, gameState, selectedPieceId: 3 });

  expect(presentation.turnText).toBe("1 / 60 행동 · HOME 2/3 · 선택 선수 1/2");
});

it("합법 상태에서 버티기와 턴 종료 버튼만 표시한다", () => {
  const presentation = buildPresentation({
    ...humanState,
    canHold: true,
    canEndTurn: true,
  });
  expect(presentation.showHold).toBe(true);
  expect(presentation.showEndTurn).toBe(true);
});
```

`index.html`의 action section에 다음 버튼을 추가한다.

```html
<button id="action-hold" type="button" hidden>버티기</button>
<button id="end-turn" type="button" hidden>턴 종료</button>
```

`main.ts`는 각각 `controller.holdBall()`과 `controller.endTurn()`에 연결한다.

- [ ] **Step 4: 제품 문구와 화면 색상을 content에 추가한다**

```json
{
  "app": { "title": "KickMate — 3행동 턴제 축구" },
  "match": {
    "hold": "버티기",
    "endTurn": "턴 종료",
    "pressured": "압박 중입니다. 패스·슛 또는 버티기를 선택하세요.",
    "fieldRebound": "필드 차단 후 루즈볼이 생깁니다."
  }
}
```

기존 JSON 키는 유지하면서 위 키를 병합한다. `theme.board`에는 기존 팔레트와 구분되는
`pressured: "#ff9f43"`, `heldFirm: "#4dd0e1"`, `rebound: "#ffd166"`을 추가한다.
`index.html`의 `<title>`도 `KickMate — 3행동 턴제 축구`로 맞춘다.

- [ ] **Step 5: 압박·버티기·리바운드 Canvas 실패 테스트를 추가한다**

```ts
it("압박받는 공 소유자와 버틴 상태를 서로 다른 테두리로 그린다", () => {
  const { refs, context } = createRenderRefs();
  const gameState = createInitialState();
  createRenderer(refs)({ ...humanState, gameState });
  expect(context.circleStrokes.some((stroke) => stroke.color === theme.board.pressured)).toBe(true);

  gameState.heldFirmPieceId = gameState.ball.kind === "held" ? gameState.ball.pieceId : null;
  createRenderer(refs)({ ...humanState, gameState });
  expect(context.circleStrokes.some((stroke) => stroke.color === theme.board.heldFirm)).toBe(true);
});

it("필드 차단 슛은 차단자와 예상 루즈볼 칸을 함께 표시한다", () => {
  const { refs, context } = createRenderRefs();
  const gameState = createInitialState();
  const shooter = gameState.pieces.find((piece) => piece.id === 3)!;
  shooter.pos = { x: 7, y: 4 };
  gameState.pieces.find((piece) => piece.id === 11)!.pos = { x: 10, y: 4 };
  gameState.ball = { kind: "held", pieceId: shooter.id };
  const shot = legalMoves(gameState).find(
    (move) => move.kind === "shoot" && move.goalRow === 4,
  )!;
  createRenderer(refs)({
    ...humanState,
    gameState,
    candidateMoves: [shot],
    candidatePreviews: [{ move: shot, preview: previewMove(gameState, shot) }],
  });
  expect(context.circleStrokes.some((stroke) => stroke.color === theme.board.rebound)).toBe(true);
});
```

Renderer는 `isPressured()`를 호출해 현재 공 소유자만 압박 테두리로 표시하고,
`heldFirmPieceId`가 같으면 버티기 색상을 우선한다. `fieldRebound` 후보는
`preview.reboundPos` 중심에 리바운드 색상의 이중 원을 그린다. 보호 표시는
`stealProtection?.pieceId`와 현재 공 소유자가 같을 때만 `◆`를 그린다.

- [ ] **Step 6: 브라우저 진입 통합 테스트를 3행동 흐름으로 갱신한다**

`main.test.ts`의 Fake DOM에 `action-hold`, `end-turn`을 추가한다. 기존 한 사람 패스 뒤
즉시 Worker 요청을 기대하는 테스트는 사람 행동 후 `end-turn` 클릭까지 Worker 요청이
없고, 클릭 뒤 away의 세 분석 응답을 순서대로 적용한 다음 home `3/3`으로 돌아오는지
검증한다.

```ts
expect(worker.sent).toHaveLength(0);
elements["end-turn"].dispatch("click");
expect(worker.sent).toHaveLength(1);
// 세 away 응답을 적용한 뒤
expect(elements["status-message"].textContent).toBe("내 차례입니다.");
expect(elements["turn-info"].textContent).toContain("HOME 3/3");
```

- [ ] **Step 7: 클라이언트 테스트를 통과시킨다**

Run: `npm run test -- src/client/input.test.ts src/client/render.test.ts src/client/main.test.ts`

Expected: 입력 타입, 버튼 표시, 압박·리바운드 Canvas와 전체 DOM 왕복 PASS.

- [ ] **Step 8: Task 6 diff를 독립 검토한다**

Run: `git diff --check`

Expected: 출력 없이 종료 코드 0. 커밋은 만들지 않는다.

---

### Task 7: 전체 회귀·성능·문서 완료 상태 갱신

**Files:**
- Modify: `docs/current-state.md`
- Modify: `docs/project-plan.md`
- Modify: `docs/game-policy.md`
- Modify: `docs/architecture.md`
- Modify: `docs/team-onboarding.md`
- Verify only: `reference/prototype.html`

**Interfaces:**
- Consumes: Tasks 1~6의 실제 코드와 테스트 결과
- Produces: 코드 사실과 일치하는 M2.6A 구현 상태 및 플레이테스트 체크리스트

- [ ] **Step 1: 가장 좁은 테스트부터 전체 클라이언트 테스트까지 실행한다**

Run: `npm run test -- src/engine/rules.test.ts src/engine/ballPath.test.ts`

Expected: 엔진 테스트 전부 PASS.

Run: `npm run test -- src/client/gameController.test.ts src/client/input.test.ts src/client/render.test.ts src/client/main.test.ts src/client/engineClient.test.ts`

Expected: 클라이언트와 Worker 경계 테스트 전부 PASS.

- [ ] **Step 2: 통합 게이트와 프로덕션 빌드를 실행한다**

Run: `npm run check`

Expected: typecheck, Vitest, content 검증 모두 PASS.

Run: `npm run build`

Expected: Vite 프로덕션 빌드 PASS.

- [ ] **Step 3: 탐색 성능을 대표 국면에서 기록한다**

기존 `rules.test.ts`의 초기 depth-3 5초 테스트와 압박 fixture의 depth-3 5초 테스트를
실행한다.

Run: `npm run test -- src/engine/rules.test.ts -t "5초"`

Expected: 두 국면 모두 5,000ms 미만이며 `best !== null`.

- [ ] **Step 4: 금지 의존성과 S1 스텁을 검사한다**

Run: `rg -n "Math\.random|document\.|window\.|Canvas|Worker|node:fs|from ['\"]fs['\"]" src/engine`

Expected: 실행 의존성 일치가 없어야 한다. 문서 주석에서 발견된 `Canvas`, `Worker` 언급은 허용한다.

Run: `rg -n "throw new Error\(|return undefined|return null|stub|미구현" src/engine tools/selfplay.ts`

Expected: 새 M2.6A 경로에 자리표시자가 없어야 한다. 기존 `tools/selfplay.ts` 미구현은 현재 알려진 제한으로만 남긴다.

- [ ] **Step 5: reference가 바뀌지 않았는지 확인한다**

Run: `git diff --exit-code -- reference/prototype.html`

Expected: 출력 없이 종료 코드 0.

- [ ] **Step 6: 문서를 실제 검증 결과로 갱신한다**

`current-state.md`에는 실제 테스트 개수, build 결과, depth-3 시간과 아직 수행하지 않은
브라우저 세 경기를 구분해 기록한다. `project-plan.md`의 M2.6A 체크박스는 코드와 자동
검증으로 확인한 항목만 `[x]`로 바꾼다. `game-policy.md`의 M2.6A는 자동 검증 완료·실제
플레이 검증 전으로 표시하고, 3장의 현재 턴 규칙과 상태 모델을 실제 코드 필드로
교체한다. `architecture.md`와 `team-onboarding.md`도 더 이상 한 수 한 행동을 현재
런타임으로 설명하지 않게 갱신한다.

- [ ] **Step 7: 최종 diff와 변경 파일을 검토한다**

Run: `git diff --check`

Expected: 출력 없이 종료 코드 0.

Run: `git status --short`

Expected: M2.6A에 필요한 엔진·클라이언트·content·HTML·테스트·문서 파일만 표시되고
`reference/` 변경은 없어야 한다. 커밋은 만들지 않는다.

- [ ] **Step 8: 브라우저 플레이테스트를 사용자 확인 항목으로 남긴다**

같은 빌드로 세 경기를 진행하며 경기별 총 슛, 득점, 필드 리바운드, 리바운드 후 공방,
이동 후 스틸, 버티기 후 이동, 6행동 이상 장기 소유, 경기 시간과 재경기 의향을
`docs/current-state.md`에 기록한다. 실제로 플레이하지 않았다면 완료로 표시하지 않는다.
