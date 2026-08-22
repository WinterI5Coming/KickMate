# Steal Recovery Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀 턴 전체 재스틸 금지를 모든 직접 소유권 획득에 일관되게 적용되는 1행동 회수 유예로 바꾸고, 보호 소유자 주변의 상대 2인 포위가 유예를 즉시 무시하게 한다.

**Architecture:** `src/engine/rules.ts`가 보호 생성·소비·포위 우회의 유일한 판정 경계가 된다. 보호는 생성 원인이 된 행동에는 소비되지 않고, 그 뒤 `blockedTeam`이 완료한 첫 원자 행동 또는 `endTurn`에만 사라진다. 클라이언트와 Lv.1 평가는 엔진이 공개한 보호 판정을 재사용해 실제 합법 수와 안내·위험 평가를 일치시킨다.

**Tech Stack:** TypeScript 5.6+, Vitest 3, Vite 6, Canvas 2D

**Spec:** [docs/superpowers/specs/2026-08-22-ftg-inspired-match-core-design.md](../specs/2026-08-22-ftg-inspired-match-core-design.md)

## Global Constraints

- `src/engine/`은 DOM, Worker 전역, 파일시스템과 브라우저 전용 API를 참조하지 않는다.
- 엔진에서 `Math.random()`을 사용하지 않는다.
- `applyMove(state, move)`는 입력 상태와 중첩 객체를 변경하지 않는다.
- 인접은 체비쇼프 거리 1이며 대각선을 포함한다.
- 스틸 성공은 M2.6A에서 계속 100% 결정론이다.
- 같은 팀의 일반 패스와 득점 뒤 킥오프에는 보호를 만들지 않는다.
- 새 의존성을 추가하거나 `reference/`를 수정하지 않는다.
- 사용자가 별도로 요청하기 전에는 커밋하지 않는다. 각 Task 종료 시 테스트 결과와 diff를 검토 지점으로 사용한다.

---

## File Map

| 파일 | 책임 | 변경 요약 |
|---|---|---|
| `src/engine/types.ts` | 공개 보호 상태 계약 | 팀 턴 만료 필드를 1행동 유예 필드로 교체 |
| `src/engine/rules.ts` | 보호 생성·소비·포위 판정 | 모든 소유권 획득 경로 통합, 2인 포위 우회 |
| `src/engine/rules.test.ts` | 엔진 관찰 동작 | 1행동 수명, 생성 행동 제외, 획득 경로, 포위 경계 테스트 |
| `src/engine/eval/lv1.ts` | 스틸 위험 평가 | 실제 보호·포위 판정 재사용 |
| `src/client/gameController.ts` | 클릭 안내 | 실제 보호 여부로 `protectedCarrier` 구분 |
| `src/client/gameController.test.ts` | 안내 회귀 | 1인 보호와 2인 포위 메시지·스틸 검증 |
| `src/client/render.ts` | 보호 표시 | 실제로 스틸을 막을 때만 `◆` 표시 |
| `src/client/render.test.ts` | Canvas 회귀 | 포위 시 보호 표시 제거 검증 |
| `docs/current-state.md` | 실제 구현 상태 | 통과한 테스트와 새 규칙 기록 |
| `docs/architecture.md` | 엔진 상태 설명 | 새 보호 필드와 소비 시점 기록 |
| `docs/game-policy.md` | 정책·구현 상태 | 승인·구현 전 표기를 실제 결과로 갱신 |
| `docs/project-plan.md` | 단계 현황 | M2.6A 스틸 회수 수정 상태 기록 |
| `docs/team-onboarding.md` | 팀 규칙 설명 | 1행동 유예와 2인 포위 설명 |

---

### Task 1: 1행동 보호 계약과 소비 시점

**Files:**
- Modify: `src/engine/types.ts`
- Modify: `src/engine/rules.ts`
- Test: `src/engine/rules.test.ts`

**Interfaces:**
- Produces: `StealProtection = { pieceId: number; blockedTeam: Team; blockedActionsRemaining: 1 }`
- Produces: `isStealProtected(state: GameState, carrierId: number, attackingTeam: Team): boolean`
- Invariant: 보호 생성 원인 행동은 새 보호를 소비하지 않는다.
- Invariant: 기존 보호만 그 행동 시작 시점의 `blockedTeam` 행동 또는 `endTurn`에 소비된다.

- [ ] **Step 1: 스틸 뒤 첫 차단 팀 행동까지만 보호하는 실패 테스트를 작성한다**

```ts
it("스틸 보호는 공을 잃은 팀의 다음 행동 하나 뒤 해제된다", () => {
  const state = createInitialState();
  state.activeTeam = "away";
  const stolen = applyMove(
    state,
    legalMoves(state).find((move) => move.kind === "steal" && move.pieceId === 11)!,
  );
  const homeTurn = applyMove(stolen, { kind: "endTurn" });

  expect(legalMoves(homeTurn).some((move) => move.kind === "steal")).toBe(false);
  const setup = legalMoves(homeTurn).find(
    (move) => move.kind === "move" && move.pieceId !== 3,
  )!;
  const afterSetup = applyMove(homeTurn, setup);

  expect(afterSetup.stealProtection).toBeNull();
  expect(legalMoves(afterSetup).some((move) => move.kind === "steal")).toBe(true);
});
```

- [ ] **Step 2: 대상 테스트를 실행해 기존 팀 턴 보호 때문에 실패하는지 확인한다**

Run: `npm run test -- src/engine/rules.test.ts -t "다음 행동 하나"`

Expected: 첫 home 행동 뒤에도 `stealProtection`이 남아 FAIL.

- [ ] **Step 3: 보호 타입과 판정 함수를 최소 변경한다**

```ts
export interface StealProtection {
  pieceId: number;
  blockedTeam: Team;
  blockedActionsRemaining: 1;
}
```

`expiresAfterTeamTurn`을 제거하고 `rules.test.ts`, `gameController.test.ts`,
`render.test.ts`의 기존 보호 fixture도 `blockedActionsRemaining: 1`로 교체한다.
`isStealProtected()`는 우선 보호 대상과 차단 팀만 검사하며 Task 2 전까지 기존 인접
스틸을 막는다. 함수는 Lv.1 평가와 클라이언트가 같은 판정을 쓰도록 `export`한다.

- [ ] **Step 4: 생성 전 보호만 소비하는 전이를 구현한다**

`applyMove()` 시작에서 다음 스냅샷을 잡는다.

```ts
const protectionAtActionStart = state.stealProtection
  ? { ...state.stealProtection }
  : null;
```

행동의 공 전이와 새 보호 생성을 마친 뒤, 아래 조건을 모두 만족할 때만 보호를 `null`로
만든다.

```ts
const consumesExistingProtection =
  protectionAtActionStart?.blockedTeam === team &&
  next.stealProtection?.pieceId === protectionAtActionStart.pieceId &&
  next.stealProtection.blockedTeam === protectionAtActionStart.blockedTeam;
```

이 판정은 `completeAtomicAction()` 전후 어느 쪽에서도 가능하지만, 새로 생성된 보호를
지우지 않도록 반드시 행동 시작 스냅샷과 현재 보호를 함께 비교한다. `switchTeamTurn()`은
나가는 팀이 `blockedTeam`이면 기존 보호를 해제해 `endTurn`으로 유예를 이월하지 못하게
한다.

- [ ] **Step 5: 생성 행동 자체가 유예를 소비하지 않는 실패 테스트를 추가한다**

패스 차단 fixture에서 activeTeam의 첫 행동으로 상대가 공을 받게 만들고, 패스 적용 뒤
`stealProtection.blockedTeam`이 패스 팀이며 그대로 남아 있는지 단언한다. 같은 경계를
GK 선방에도 적용한다.

```ts
expect(intercepted.stealProtection).toEqual({
  pieceId: interceptorId,
  blockedTeam: "home",
  blockedActionsRemaining: 1,
});
```

- [ ] **Step 6: Task 1 테스트와 타입 검사를 통과시킨다**

Run: `npm run test -- src/engine/rules.test.ts -t "스틸 보호|다음 행동 하나|생성 행동"`

Run: `npm run typecheck`

Expected: 새 보호 수명 테스트 PASS, 런타임과 현재 테스트에 `expiresAfterTeamTurn` 참조 없음.

---

### Task 2: 모든 획득 경로의 보호와 2인 포위 우회

**Files:**
- Modify: `src/engine/rules.ts`
- Test: `src/engine/rules.test.ts`

**Interfaces:**
- Consumes: Task 1의 `StealProtection`, `isStealProtected()`
- Produces: 직접 소유권 획득에 공통으로 쓰는 내부 `protectNewCarrier()` 헬퍼
- Produces: 보호 소유자에게 `attackingTeam` 기물이 두 명 이상 인접하면 `false`를 반환하는 `isStealProtected()`

- [ ] **Step 1: 소유권 획득 경로별 실패 테스트를 작성한다**

각 fixture는 다음을 단언한다.

```ts
expect(next.stealProtection).toEqual({
  pieceId: expectedCarrierId,
  blockedTeam: expectedBlockedTeam,
  blockedActionsRemaining: 1,
});
```

독립 테스트로 다음 네 경로를 구성한다.

1. 상대 패스의 첫 접촉 기물이 가로채는 경우
2. 상대 GK가 슛을 선방하는 경우
3. 빈 리바운드 칸이 없어 상대 필드 차단자가 소유하는 경우
4. 기물이 루즈볼 칸으로 이동해 소유하는 경우

같은 팀 일반 패스와 득점 뒤 킥오프는 `stealProtection === null`임을 별도 테스트한다.

- [ ] **Step 2: 획득 경로 테스트가 기존 불일치 때문에 실패하는지 확인한다**

Run: `npm run test -- src/engine/rules.test.ts -t "패스 차단 보호|선방 보호|필드 소유 보호|루즈볼 획득 보호|일반 패스 보호|킥오프 보호"`

Expected: 패스 차단·필드 소유·루즈볼 획득은 보호가 없어 FAIL하고 기존 GK fixture는 타입
필드 불일치로 FAIL.

- [ ] **Step 3: 공통 보호 생성 헬퍼를 구현한다**

```ts
function protectNewCarrier(state: GameState, pieceId: number, blockedTeam: Team): void {
  state.stealProtection = {
    pieceId,
    blockedTeam,
    blockedActionsRemaining: 1,
  };
}
```

`applyMove()`의 스틸, 상대 패스 차단, GK 선방, 필드 소유, 루즈볼 획득 분기에서 이
헬퍼를 호출한다. 패스는 actor와 실제 receiver의 팀이 다를 때만 생성한다. 같은 팀 패스는
기존 보호를 해제하고 새 보호를 만들지 않는다. 필드 리바운드는 공이 loose인 동안 보호를
두지 않고, 이후 누군가 이동해 획득할 때 그 기물을 다른 팀으로부터 보호한다.

- [ ] **Step 4: 1인 보호와 2인 포위 실패 테스트를 작성한다**

```ts
it("보호 소유자에게 상대가 한 명만 인접하면 스틸을 막는다", () => {
  const state = createInitialState();
  state.activeTeam = "away";
  state.ball = { kind: "held", pieceId: 3 };
  setPos(state, 11, { x: 7, y: 4 });
  setPos(state, 10, { x: 12, y: 8 });
  state.stealProtection = {
    pieceId: 3,
    blockedTeam: "away",
    blockedActionsRemaining: 1,
  };

  expect(legalMoves(state).some((move) => move.kind === "steal")).toBe(false);
});

it("보호 소유자에게 상대 두 명이 인접하면 즉시 스틸할 수 있다", () => {
  const state = createInitialState();
  state.activeTeam = "away";
  state.ball = { kind: "held", pieceId: 3 };
  setPos(state, 11, { x: 7, y: 4 });
  setPos(state, 10, { x: 7, y: 5 });
  state.stealProtection = {
    pieceId: 3,
    blockedTeam: "away",
    blockedActionsRemaining: 1,
  };

  expect(legalMoves(state).filter((move) => move.kind === "steal")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ pieceId: 11, targetPieceId: 3 }),
      expect.objectContaining({ pieceId: 10, targetPieceId: 3 }),
    ]),
  );
});
```

추가로 두 번째 인접 기물이 대각선에 있어도 포위로 세고, 거리가 2면 세지 않는 경계
테스트를 작성한다.

- [ ] **Step 5: 포위 수를 보호 판정에 반영한다**

```ts
function chebyshevDistance(left: Pos, right: Pos): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

function adjacentOpponentCount(state: GameState, carrier: Piece, team: Team): number {
  return state.pieces.filter(
    (piece) => piece.team === team && chebyshevDistance(piece.pos, carrier.pos) === 1,
  ).length;
}
```

`isStealProtected()`는 보호 대상·차단 팀이 일치해도 `adjacentOpponentCount >= 2`면
`false`를 반환한다. 압박 인원에는 이번 팀 턴의 행동 상한을 이미 쓴 기물도 포함한다.
포위는 공간 배치의 효과이고 실제 스틸 후보 생성에서만 각 기물의 행동 가능 여부를
따로 검사한다.

- [ ] **Step 6: 엔진 보호·포위 테스트 전체를 통과시킨다**

Run: `npm run test -- src/engine/rules.test.ts -t "보호|포위|스틸"`

Expected: 획득 경로, 1행동 만료, 한 명 보호, 두 명·대각 포위, 거리 경계 PASS.

---

### Task 3: 평가와 클라이언트 피드백 일치

**Files:**
- Modify: `src/engine/eval/lv1.ts`
- Modify: `src/client/gameController.ts`
- Modify: `src/client/render.ts`
- Test: `src/engine/rules.test.ts`
- Test: `src/client/gameController.test.ts`
- Test: `src/client/render.test.ts`

**Interfaces:**
- Consumes: Task 1의 `isStealProtected()`
- Invariant: 보호 `◆`와 `protectedCarrier` 안내는 실제로 스틸 후보를 막는 경우에만 나타난다.
- Invariant: 포위로 즉시 스틸 가능한 소유자는 Lv.1에서 인접 스틸 위험 `-170`을 받는다.

- [ ] **Step 1: 평가 실패 테스트를 작성한다**

한 명에게만 인접한 보호 fixture는 보호 없는 fixture보다 home 소유 관점에서 170점 높고,
두 명에게 포위된 fixture는 보호 유무에 따른 점수 차이가 0인지 단언한다.

```ts
expect(evalLv1(singleProtected, "home") - evalLv1(singleUnprotected, "home")).toBe(170);
expect(evalLv1(doubleProtected, "home") - evalLv1(doubleUnprotected, "home")).toBe(0);
```

- [ ] **Step 2: Controller와 Renderer 실패 테스트를 작성한다**

1인 보호 상태의 상대 소유자를 클릭하면 `{ kind: "protectedCarrier" }`를 발행한다.
같은 상태에 두 번째 home 기물을 인접시킨 뒤 클릭하면 스틸을 즉시 적용하거나 복수 스틸러
선택 상태로 들어가며 `protectedCarrier`를 발행하지 않는다.

Renderer는 1인 보호 fixture에서 `◆`를 그리고, 2인 포위 fixture에서는 그리지 않는지
`RecordingContext.fillTexts`로 검증한다.

- [ ] **Step 3: 새 테스트가 기존 상태 필드 직접 검사 때문에 실패하는지 확인한다**

Run: `npm run test -- src/engine/rules.test.ts src/client/gameController.test.ts src/client/render.test.ts -t "보호|포위"`

Expected: 포위 fixture에서 평가·메시지·보호 마크가 실제 합법 스틸과 불일치해 FAIL.

- [ ] **Step 4: 모든 소비자가 엔진 판정을 재사용하게 한다**

`eval/lv1.ts`는 직접 `stealProtection` 필드를 비교하지 않고 각 인접 상대 팀에 대해
`isStealProtected(state, carrier.id, piece.team)`를 호출한다. Controller는 보호 안내를
정할 때 `gameState.stealProtection` 존재 여부가 아니라 같은 함수를 사용한다. Renderer도
보호의 `blockedTeam`을 전달해 실제 보호가 유효할 때만 `◆`를 그린다.

- [ ] **Step 5: 엔진·클라이언트 집중 테스트를 통과시킨다**

Run: `npm run test -- src/engine/rules.test.ts src/client/gameController.test.ts src/client/render.test.ts`

Expected: 세 파일의 모든 테스트 PASS.

---

### Task 4: 회귀 검증과 현재 문서 갱신

**Files:**
- Modify: `docs/current-state.md`
- Modify: `docs/architecture.md`
- Modify: `docs/game-policy.md`
- Modify: `docs/project-plan.md`
- Modify: `docs/team-onboarding.md`

**Interfaces:**
- Consumes: Task 1~3에서 실제 통과한 타입·동작·테스트 결과
- Produces: 현재 코드와 일치하는 스틸 회수 규칙 설명

- [ ] **Step 1: 보호의 오래된 팀 턴 필드와 설명을 검색한다**

Run: `rg -n "expiresAfterTeamTurn|다음 팀 턴|팀 턴 경계의 스틸|보호 턴" src docs`

Expected: 런타임 소스에는 0건. 이전 완료 계획과 역사적 설계 문서는 변경하지 않고, 현재
정책·상태·온보딩 문서의 오래된 표현만 목록화한다.

- [ ] **Step 2: 현재 문서만 실제 구현 결과로 갱신한다**

다섯 문서에 다음을 동일하게 기록한다.

- 보호는 차단 팀의 다음 행동 하나에만 유효하다.
- 보호 생성 행동 자체는 그 한 행동으로 세지 않는다.
- 차단 팀 두 명 이상이 보호 소유자에게 인접하면 즉시 보호를 무시한다.
- 직접 소유권 획득 경로는 같은 보호 생성 규칙을 사용한다.
- 같은 팀 패스와 킥오프는 보호를 만들지 않는다.

`docs/current-state.md`의 테스트 수와 날짜는 실제 `npm run check` 출력만 사용한다.

- [ ] **Step 3: 전체 검증을 실행한다**

Run: `npm run check`

Expected: typecheck, 전체 Vitest, content 검증 PASS.

- [ ] **Step 4: 빌드와 변경 무결성을 확인한다**

Run: `npm run build`

Run: `git diff --check`

Run: `rg -n "Math\\.random|document\\.|window\\.|WorkerGlobalScope|node:fs" src/engine`

Expected: 빌드 PASS, `git diff --check` 출력 없음, 엔진 금지 의존성 출력 없음.

- [ ] **Step 5: 변경 범위를 검토한다**

Run: `git status --short`

Run: `git diff --stat`

Expected: 기존 M2.6A 미커밋 변경을 보존하고, 이번 작업은 File Map에 적힌 소스·테스트와
현재 문서 갱신으로 제한됨. 커밋은 만들지 않음.
