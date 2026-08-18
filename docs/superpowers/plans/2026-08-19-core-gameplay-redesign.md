# KickMate Core Gameplay Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 4대4 규칙을 6대6, 직접 대상 패스·슛, 공통 선분 경로, 8방향 스틸과 실행 전 결과 미리보기를 갖춘 결정론적 봇 대국으로 개편한다.

**Architecture:** `src/engine/ballPath.ts`가 화면과 무관한 정확한 공 경로만 계산하고, `rules.ts`가 그 경로를 이용해 합법 수·미리보기·상태 전이를 단일 판정으로 제공한다. Controller는 엔진의 `MovePreview`와 복수 스틸러 선택 상태를 소유하고 Renderer는 그 결과를 Canvas와 한 줄 안내로 표현하며, Worker는 변경된 엔진 타입을 그대로 전달한다.

**Tech Stack:** TypeScript 5.6, Vite 6, Vitest 3, Canvas 2D, Web Worker, JSON content

**Spec:** [docs/superpowers/specs/2026-08-19-core-gameplay-redesign-design.md](../specs/2026-08-19-core-gameplay-redesign-design.md)

## Global Constraints

- 보드는 13×9, 사용자는 home, 봇은 away다.
- 한 ply에는 이동·패스·슛·스틸 중 하나만 수행한다.
- 승리 조건은 3골 선취 또는 전체 경기 60 ply다.
- 봇 탐색 깊이는 3, 분석 제한은 5초, 자동 재시도는 최대 3회다.
- 엔진은 순수하고 결정론적이어야 하며 입력 `GameState`를 변경하지 않는다.
- 패스와 슛은 동일한 경로 계산과 동일한 첫 충돌 판정을 사용한다.
- 경로 모서리 동시 충돌은 더 낮은 `pieceId`가 우선한다.
- 클라이언트는 경로·차단·수신 규칙을 다시 구현하지 않고 `previewMove()` 결과를 사용한다.
- 성공과 차단은 색상뿐 아니라 실선·기호·실제 수신자 강조로도 구분한다.
- `reference/prototype.html`은 참고 스냅샷이므로 수정하지 않는다.
- 로그라이크 성장, 역할별 아키타입, 확률 판정, 복수 행동은 이번 구현에서 만들지 않는다.
- 커밋은 사용자가 명시적으로 승인할 때만 하며, 승인 시 한국어 커밋 메시지를 사용한다.

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/engine/ballPath.ts` | 출발점과 목표점 사이의 supercover 경로 및 같은 거리 묶음 계산 | 생성 |
| `src/engine/ballPath.test.ts` | 수평·수직·임의 기울기·경계·모서리·역방향 경로 검증 | 생성 |
| `src/engine/types.ts` | 새 `Move`, `MovePreview`, 경로 충돌 타입 계약 | 수정 |
| `src/engine/rules.ts` | 6대6 배치, 공통 이동, 새 합법 수, 미리보기, 상태 전이 | 수정 |
| `src/engine/rules.test.ts` | 새 배치와 네 행동, 불변성, 종료 회귀 검증 | 수정 |
| `src/engine/search.ts` | `previewMove()` 기반 슛 정렬과 새 Move 계약 반영 | 수정 |
| `src/engine/eval/lv1.ts` | 직접 골문 행과 공통 경로를 사용하는 열린 슛 평가 | 수정 |
| `src/client/types.ts` | 미리보기와 복수 스틸러 선택을 포함한 화면 상태 | 수정 |
| `src/client/input.ts` | 아군 수신자, 골문 행, 상대 공 소유자 클릭 매핑 | 수정 |
| `src/client/input.test.ts` | 새 Move와 Canvas 대상의 결정론적 왕복 검증 | 수정 |
| `src/client/gameController.ts` | 후보 미리보기 생성, 복수 스틸러 선택, 상황 안내 | 수정 |
| `src/client/gameController.test.ts` | 패스·슛·단일/복수 스틸 조작과 기존 봇 흐름 회귀 | 수정 |
| `src/client/render.ts` | 성공·차단 경로, 수신자·차단자, 방패, 기호 렌더링 | 수정 |
| `src/client/render.test.ts` | 표시 모델과 Canvas draw call 검증 | 수정 |
| `src/client/main.test.ts` | 실제 DOM 이벤트에서 새 계약 왕복 검증 | 수정 |
| `content/strings.json` | 상황별 한 줄 안내 문구 | 수정 |
| `content/theme.json` | 성공·차단·수신자·보호 표시 색 | 수정 |
| `tools/validate.ts` | 새 문구와 색상 키 검증 | 수정 |
| `docs/game-policy.md` | 구현 후 승인 정책을 현재 확정 규칙으로 승격 | 수정 |
| `docs/current-state.md` | 구현·검증·플레이테스트 결과 기록 | 수정 |
| `docs/project-plan.md` | M2.5 체크박스와 측정 결과 갱신 | 수정 |

---

### Task 1: 공통 supercover 경로

**Files:**
- Create: `src/engine/ballPath.ts`
- Create: `src/engine/ballPath.test.ts`

**Interfaces:**
- Consumes: `Pos`, `BOARD_W`, `BOARD_H` from `src/engine/types.ts`
- Produces: `traceBallPath(from: Pos, target: Pos): PathStep[]`
- Produces: `PathStep = { distance: number; cells: Pos[] }`; 같은 `distance`의 `cells`는 동시에 닿은 칸이며 좌표순으로 안정 정렬한다.

- [x] **Step 1: 수평·수직·대각선 경로의 실패 테스트를 작성한다**

```ts
import { describe, expect, it } from "vitest";
import { traceBallPath } from "./ballPath";

describe("traceBallPath", () => {
  it("출발 칸과 보드 밖 목표를 제외하고 수평 경로를 반환한다", () => {
    expect(traceBallPath({ x: 10, y: 4 }, { x: 13, y: 4 })).toEqual([
      { distance: 1, cells: [{ x: 11, y: 4 }] },
      { distance: 2, cells: [{ x: 12, y: 4 }] },
    ]);
  });

  it("역방향에서도 출발점 다음 칸부터 정렬한다", () => {
    expect(traceBallPath({ x: 2, y: 4 }, { x: -1, y: 4 })).toEqual([
      { distance: 1, cells: [{ x: 1, y: 4 }] },
      { distance: 2, cells: [{ x: 0, y: 4 }] },
    ]);
  });

  it("모서리를 정확히 통과하면 같은 거리의 양쪽 칸과 다음 대각선 칸을 포함한다", () => {
    const path = traceBallPath({ x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path[0]).toEqual({
      distance: 1,
      cells: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
    });
  });
});
```

- [x] **Step 2: 경로 테스트가 함수 부재로 실패하는지 확인한다**

Run: `npm run test -- src/engine/ballPath.test.ts`

Expected: FAIL because `./ballPath` does not exist.

- [x] **Step 3: 정수 비교 기반 supercover 계산을 구현한다**

```ts
import { BOARD_H, BOARD_W, type Pos } from "./types";

export interface PathStep {
  distance: number;
  cells: Pos[];
}

const inside = ({ x, y }: Pos) => x >= 0 && x < BOARD_W && y >= 0 && y < BOARD_H;
const key = ({ x, y }: Pos) => `${x},${y}`;

export function traceBallPath(from: Pos, target: Pos): PathStep[] {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const nx = Math.abs(dx);
  const ny = Math.abs(dy);
  const signX = Math.sign(dx);
  const signY = Math.sign(dy);
  let ix = 0;
  let iy = 0;
  let distance = 0;
  const steps: PathStep[] = [];

  while (ix < nx || iy < ny) {
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    const touched: Pos[] = [];
    if (decision === 0) {
      const horizontal = { x: from.x + (ix + 1) * signX, y: from.y + iy * signY };
      const vertical = { x: from.x + ix * signX, y: from.y + (iy + 1) * signY };
      ix += 1;
      iy += 1;
      touched.push(horizontal, vertical, {
        x: from.x + ix * signX,
        y: from.y + iy * signY,
      });
    } else if (decision < 0) {
      ix += 1;
      touched.push({ x: from.x + ix * signX, y: from.y + iy * signY });
    } else {
      iy += 1;
      touched.push({ x: from.x + ix * signX, y: from.y + iy * signY });
    }

    const unique = [...new Map(touched.filter(inside).map((cell) => [key(cell), cell])).values()]
      .sort((left, right) => left.y - right.y || left.x - right.x);
    if (unique.length > 0) steps.push({ distance: ++distance, cells: unique });
  }
  return steps;
}
```

- [x] **Step 4: 임의 기울기와 중복 없는 보드 범위 테스트를 추가한다**

```ts
it("임의 기울기의 모든 결과 칸은 보드 안이며 중복되지 않는다", () => {
  const cells = traceBallPath({ x: 1, y: 1 }, { x: 8, y: 4 }).flatMap((step) => step.cells);
  expect(cells.every(({ x, y }) => x >= 0 && x < 13 && y >= 0 && y < 9)).toBe(true);
  expect(new Set(cells.map(({ x, y }) => `${x},${y}`)).size).toBe(cells.length);
  expect(cells).toContainEqual({ x: 4, y: 2 });
});
```

- [x] **Step 5: 경로 테스트와 타입 검사를 통과시킨다**

Run: `npm run test -- src/engine/ballPath.test.ts`

Expected: all `traceBallPath` tests PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: 승인된 경우에만 체크포인트를 커밋한다**

Suggested commit: `feat: 공통 공 경로 계산 추가`

---

### Task 2: 6대6 배치와 공통 이동

**Files:**
- Modify: `src/engine/rules.ts:22-338`
- Modify: `src/engine/rules.test.ts:14-55`
- Modify: `src/engine/types.ts:54-105` (설명 주석의 기물 수)

**Interfaces:**
- Consumes: 기존 `createInitialState()`, `legalMoves()`
- Produces: 팀별 ID 순서 `GK, DF, DF, MF, MF, FW`; home `0..5`, away `6..11`
- Produces: 모든 필드 선수의 8방향 한 칸 이동과 기존 GK 박스 제한

- [x] **Step 1: 새 초기 배치 실패 테스트를 작성한다**

```ts
it("6대6 미러 배치에서 첫 home MF가 킥오프한다", () => {
  const state = createInitialState();
  expect(state.pieces).toHaveLength(12);
  expect(state.pieces.map((piece) => [piece.team, piece.role, piece.pos])).toEqual([
    ["home", "GK", { x: 0, y: 4 }],
    ["home", "DF", { x: 2, y: 2 }],
    ["home", "DF", { x: 2, y: 6 }],
    ["home", "MF", { x: 6, y: 4 }],
    ["home", "MF", { x: 4, y: 6 }],
    ["home", "FW", { x: 5, y: 4 }],
    ["away", "GK", { x: 12, y: 4 }],
    ["away", "DF", { x: 10, y: 6 }],
    ["away", "DF", { x: 10, y: 2 }],
    ["away", "MF", { x: 8, y: 6 }],
    ["away", "MF", { x: 8, y: 2 }],
    ["away", "FW", { x: 7, y: 4 }],
  ]);
  expect(state.ball).toEqual({ kind: "held", pieceId: 3 });
});
```

- [x] **Step 2: 역할과 무관한 필드 이동 실패 테스트를 작성한다**

```ts
it.each([1, 3, 5])("필드 기물 %i는 8방향 한 칸만 이동한다", (pieceId) => {
  const state = createInitialState();
  const piece = state.pieces.find((candidate) => candidate.id === pieceId)!;
  const moves = legalMoves(state).filter(
    (move) => move.kind === "move" && move.pieceId === pieceId,
  );
  expect(moves.every((move) =>
    Math.max(Math.abs(move.to.x - piece.pos.x), Math.abs(move.to.y - piece.pos.y)) === 1,
  )).toBe(true);
});
```

- [x] **Step 3: 기존 4대4/역할별 이동 테스트의 실패를 확인한다**

Run: `npm run test -- src/engine/rules.test.ts`

Expected: FAIL at 4대4 length, old role positions, and role-specific movement assertions.

- [x] **Step 4: 배치 상수와 킥오프 ID 계산을 6명 단위로 바꾼다**

```ts
const HOME_START: readonly Array<{ role: Piece["role"]; pos: Pos }> = [
  { role: "GK", pos: { x: 0, y: 4 } },
  { role: "DF", pos: { x: 2, y: 2 } },
  { role: "DF", pos: { x: 2, y: 6 } },
  { role: "MF", pos: { x: 4, y: 2 } },
  { role: "MF", pos: { x: 4, y: 6 } },
  { role: "FW", pos: { x: 5, y: 4 } },
];
const PIECES_PER_TEAM = HOME_START.length;
```

`resetForKickoff()`는 `piece.id % PIECES_PER_TEAM`으로 기본 좌표를 복원하고, `find()`가 반환하는 첫 번째 해당 팀 MF를 `(6,4)`로 옮긴다. `createInitialState()`는 위 배열의 `role`과 `pos`를 사용해 12개 기물을 만든다.

기존 테스트 fixture의 역할 참조 ID도 새 순서에 맞게 옮긴다: home MF `2→3`, home FW `3→5`, away GK `4→6`, away DF `5→7`, away MF `6→9`, away FW `7→11`. 숫자만 치환하지 말고 각 fixture에서 `role`과 `team`을 함께 단언해 잘못된 기물을 움직이는 테스트가 통과하지 않게 한다.

- [x] **Step 5: 필드 이동 생성을 단일 8방향 루프로 교체한다**

```ts
if (piece.role === "GK") {
  // 기존 GK 박스 제한 루프 유지
} else {
  for (const direction of DIRS_8) {
    const to = { x: piece.pos.x + direction.x, y: piece.pos.y + direction.y };
    if (inBounds(to) && !pieceAt(state, to)) {
      moves.push({ kind: "move", pieceId: piece.id, to });
    }
  }
}
```

- [x] **Step 6: 불변 조건의 기대 기물 수와 ID 수를 12로 바꾼다**

`rules.test.ts` 완주 시뮬레이션에서 `toHaveLength(8)`과 고유 ID·좌표의 `8`을 모두 `12`로 바꾸고 팀별 6명, 역할별 `1/2/2/1`도 단언한다.

- [x] **Step 7: 엔진 회귀 테스트를 통과시킨다**

Run: `npm run test -- src/engine/rules.test.ts`

Expected: 초기 배치·이동·기존 상태 전이 테스트 PASS.

- [ ] **Step 8: 승인된 경우에만 체크포인트를 커밋한다**

Suggested commit: `feat: 6대6 배치와 공통 이동 적용`

---

### Task 3: 새 Move와 MovePreview 계약

**Files:**
- Modify: `src/engine/types.ts:129-148`
- Modify: `src/engine/rules.ts:229-428`
- Modify: `src/engine/rules.test.ts`
- Modify: `src/engine/search.ts:42-82`
- Modify: `src/engine/eval/lv1.ts:16-69`
- Modify: `src/client/input.ts:49-99`
- Modify: `src/client/input.test.ts`
- Modify: `src/client/gameController.test.ts`
- Modify: `src/client/render.test.ts`

**Interfaces:**
- Produces: 승인된 `Move` union의 `targetPieceId`와 `goalRow`
- Produces: `previewMove(state: GameState, move: Move): MovePreview`
- Consumes: `traceBallPath()` from Task 1
- Invariant: `applyMove()`는 `previewMove()`를 호출해 같은 판정 결과를 사용하며 경로 충돌을 다시 계산하지 않는다.

- [x] **Step 1: 공개 계약을 정확히 선언한다**

```ts
export type Move =
  | { kind: "move"; pieceId: number; to: Pos }
  | { kind: "pass"; pieceId: number; targetPieceId: number }
  | { kind: "shoot"; pieceId: number; goalRow: 3 | 4 | 5 }
  | { kind: "steal"; pieceId: number; targetPieceId: number };

export type MovePreview =
  | { kind: "move"; destination: Pos; picksUpLooseBall: boolean }
  | {
      kind: "pass";
      path: Pos[];
      targetPieceId: number;
      receiverPieceId: number;
      reachesTarget: boolean;
    }
  | {
      kind: "shoot";
      path: Pos[];
      goalRow: 3 | 4 | 5;
      outcome: "goal" | "blocked";
      blockerPieceId: number | null;
    }
  | { kind: "steal"; targetPieceId: number; protectedAfter: true };
```

- [x] **Step 2: 패스 미리보기의 실패 테스트를 작성한다**

```ts
it("막힌 패스는 선택한 아군과 실제 첫 수신자를 함께 예고한다", () => {
  const state = createInitialState();
  const passer = state.pieces.find((piece) => piece.id === 3)!;
  const target = state.pieces.find((piece) => piece.id === 1)!;
  const interceptor = state.pieces.find((piece) => piece.id === 6)!;
  passer.pos = { x: 4, y: 4 };
  interceptor.pos = { x: 3, y: 4 };
  target.pos = { x: 2, y: 4 };
  state.ball = { kind: "held", pieceId: passer.id };

  expect(previewMove(state, {
    kind: "pass", pieceId: passer.id, targetPieceId: target.id,
  })).toMatchObject({
    kind: "pass", targetPieceId: target.id,
    receiverPieceId: interceptor.id, reachesTarget: false,
  });
});
```

- [x] **Step 3: 슛 미리보기와 모서리 동점 실패 테스트를 작성한다**

```ts
it("골문 행을 직접 겨냥하고 경로 첫 기물을 차단자로 예고한다", () => {
  const state = createInitialState();
  const shooter = state.pieces.find((piece) => piece.id === 3)!;
  const blocker = state.pieces.find((piece) => piece.id === 7)!;
  shooter.pos = { x: 9, y: 2 };
  blocker.pos = { x: 11, y: 3 };
  state.ball = { kind: "held", pieceId: shooter.id };

  expect(previewMove(state, { kind: "shoot", pieceId: shooter.id, goalRow: 4 }))
    .toMatchObject({ kind: "shoot", goalRow: 4, outcome: "blocked", blockerPieceId: 7 });
});
```

모서리의 같은 `PathStep`에 두 기물을 놓은 별도 테스트에서는 배열 순서와 관계없이 더 낮은 ID가 `receiverPieceId` 또는 `blockerPieceId`가 되는지 단언한다.

- [x] **Step 4: 새 테스트의 컴파일 실패를 확인한다**

Run: `npm run typecheck`

Expected: FAIL at old `to`/`dy` references and missing `MovePreview`/`previewMove`.

- [x] **Step 5: 공통 충돌 판정과 미리보기를 구현한다**

```ts
function firstPieceOnPath(state: GameState, steps: PathStep[]): Piece | undefined {
  for (const step of steps) {
    const hits = state.pieces
      .filter((piece) => step.cells.some((cell) => samePos(cell, piece.pos)))
      .sort((left, right) => left.id - right.id);
    if (hits[0]) return hits[0];
  }
  return undefined;
}

export function previewMove(state: GameState, move: Move): MovePreview {
  if (move.kind === "move") {
    return {
      kind: "move",
      destination: { ...move.to },
      picksUpLooseBall: state.ball.kind === "loose" && samePos(state.ball.pos, move.to),
    };
  }
  if (move.kind === "steal") {
    return { kind: "steal", targetPieceId: move.targetPieceId, protectedAfter: true };
  }

  const actor = requirePiece(state, move.pieceId);
  const target = move.kind === "pass"
    ? requirePiece(state, move.targetPieceId).pos
    : { x: actor.team === "home" ? BOARD_W : -1, y: move.goalRow };
  const steps = traceBallPath(actor.pos, target);
  const path = steps.flatMap((step) => step.cells);
  const hit = firstPieceOnPath(state, steps);

  if (move.kind === "pass") {
    return {
      kind: "pass", path, targetPieceId: move.targetPieceId,
      receiverPieceId: hit?.id ?? move.targetPieceId,
      reachesTarget: (hit?.id ?? move.targetPieceId) === move.targetPieceId,
    };
  }
  return {
    kind: "shoot", path, goalRow: move.goalRow,
    outcome: hit ? "blocked" : "goal",
    blockerPieceId: hit?.id ?? null,
  };
}
```

`requirePiece()`와 `samePos()`는 `rules.ts` 내부 헬퍼로 둔다. 합법 패스는 항상 존재하는 아군을 목표로 하므로 `hit`이 없을 때 목표 아군을 수신자로 사용한다.

- [x] **Step 6: 합법 패스와 슛 생성을 새 의도로 교체한다**

```ts
for (const target of state.pieces) {
  if (target.team !== team || target.id === carrier.id) continue;
  const distance = Math.max(
    Math.abs(target.pos.x - carrier.pos.x),
    Math.abs(target.pos.y - carrier.pos.y),
  );
  if (distance <= PASS_MAX) {
    moves.push({ kind: "pass", pieceId: carrier.id, targetPieceId: target.id });
  }
}

const goalX = team === "home" ? BOARD_W : -1;
if (Math.abs(goalX - carrier.pos.x) <= SHOT_MAX) {
  for (const goalRow of [3, 4, 5] as const) {
    moves.push({ kind: "shoot", pieceId: carrier.id, goalRow });
  }
}
```

- [x] **Step 7: 상태 전이가 미리보기 결과를 그대로 적용하게 한다**

`applyMove()` 시작 시 `const preview = previewMove(next, move)`를 계산한다. 패스는 `preview.receiverPieceId`, 막힌 슛은 `preview.blockerPieceId`, 열린 슛은 기존 득점·킥오프 분기를 사용한다. 패스에는 `noSteal` 보호를 부여하지 않고 슛 차단에는 기존처럼 `1`을 부여한다.

- [x] **Step 8: 탐색과 평가의 독자적인 옛 슛 궤적을 제거한다**

```ts
function moveRank(state: GameState, move: Move): number {
  switch (move.kind) {
    case "shoot":
      return previewMove(state, move).outcome === "goal" ? 100 : 60;
    case "steal": return 50;
    case "pass": return 30;
    case "move": return 0;
  }
}
```

`eval/lv1.ts`의 `hasOpenShot()`은 `legalMoves(state)`를 부르지 말고 세 `goalRow`에 대해 `previewMove()`를 호출해 하나라도 `outcome === "goal"`인지 검사한다. 순환 import가 생기지 않도록 `rules.ts`는 평가 모듈을 import하지 않는 현재 방향을 유지한다.

- [x] **Step 9: 클라이언트의 옛 타입 참조를 기계적으로 새 필드에 맞춘다**

`targetForMove()`는 pass의 `targetPieceId` 기물 위치와 shoot의 `goalRow`를 사용한다. 기존 테스트 fixture의 `{ to }` 패스와 `{ dy }` 슛을 각각 `{ targetPieceId }`, `{ goalRow }`로 교체해 전체 타입 검사가 다시 녹색이 되게 한다. 이 단계에서는 화면 경로 표현을 아직 추가하지 않는다.

- [x] **Step 10: 새 계약과 전체 회귀를 검증한다**

Run: `npm run typecheck`

Expected: PASS with no old pass `to` or shoot `dy` reference.

Run: `npm run test -- src/engine/ballPath.test.ts src/engine/rules.test.ts src/client/input.test.ts`

Expected: PASS.

- [ ] **Step 11: 승인된 경우에만 체크포인트를 커밋한다**

Suggested commit: `feat: 직접 대상 패스와 슛 미리보기 구현`

---

### Task 4: 8방향 스틸과 보호 규칙

**Files:**
- Modify: `src/engine/rules.ts:322-335`
- Modify: `src/engine/rules.test.ts`
- Modify: `src/engine/eval/lv1.ts` (스틸 위협 거리)

**Interfaces:**
- Consumes: 기존 `Move`의 steal variant
- Produces: 체비쇼프 거리 1의 모든 현재 팀 기물에 대한 steal Move
- Invariant: `noSteal === 1`이면 다음 상대 ply 동안 steal Move가 하나도 없다.

- [x] **Step 1: 대각선 및 복수 스틸러 실패 테스트를 작성한다**

```ts
it("대각선으로 인접한 두 아군을 모두 스틸 후보로 만든다", () => {
  const state = createInitialState();
  state.turn = 1;
  const carrier = state.pieces.find((piece) => piece.id === 3)!;
  carrier.pos = { x: 6, y: 4 };
  state.ball = { kind: "held", pieceId: carrier.id };
  setPos(state, 7, { x: 5, y: 3 });
  setPos(state, 8, { x: 5, y: 5 });

  expect(legalMoves(state).filter((move) => move.kind === "steal")).toEqual([
    { kind: "steal", pieceId: 7, targetPieceId: 3 },
    { kind: "steal", pieceId: 8, targetPieceId: 3 },
  ]);
});
```

- [x] **Step 2: 보호 턴의 정확한 수명 테스트를 작성한다**

스틸 직후 상대의 합법 수에는 steal이 없고, 상대가 일반 이동을 한 다음 원래 팀 차례에는 `noSteal`이 0이며 조건이 맞으면 steal이 다시 생기는 상태를 구성해 단언한다.

- [x] **Step 3: 기존 맨해튼 거리 구현에서 실패를 확인한다**

Run: `npm run test -- src/engine/rules.test.ts`

Expected: diagonal steal assertion FAIL.

- [x] **Step 4: 거리 계산을 체비쇼프 거리로 바꾼다**

```ts
const distance = Math.max(
  Math.abs(piece.pos.x - carrier.pos.x),
  Math.abs(piece.pos.y - carrier.pos.y),
);
if (piece.team === team && distance === 1) {
  moves.push({ kind: "steal", pieceId: piece.id, targetPieceId: carrier.id });
}
```

`eval/lv1.ts`의 `underStealThreat`도 같은 체비쇼프 거리 1을 사용해 합법 수와 평가가 어긋나지 않게 한다.

- [x] **Step 5: 스틸과 전체 엔진 테스트를 통과시킨다**

Run: `npm run test -- src/engine/rules.test.ts`

Expected: diagonal, multiple candidates, protection, prior finish tests PASS.

- [ ] **Step 6: 승인된 경우에만 체크포인트를 커밋한다**

Suggested commit: `feat: 8방향 스틸과 보호 규칙 적용`

---

### Task 5: Canvas 입력과 복수 스틸러 선택 상태

**Files:**
- Modify: `src/client/types.ts`
- Modify: `src/client/input.ts`
- Modify: `src/client/input.test.ts`
- Modify: `src/client/gameController.ts`
- Modify: `src/client/gameController.test.ts`

**Interfaces:**
- Consumes: `previewMove()` and `MovePreview`
- Produces: `selectedStealTargetId: number | null`, `candidatePreviews: Array<{ move: Move; preview: MovePreview }>`
- Produces: `ClientMessage` variants `chooseReceiver`, `chooseGoal`, `chooseStealer`, `protectedCarrier`

- [x] **Step 1: 화면 상태 계약을 새 선택 흐름으로 확장한다**

```ts
export interface CandidatePreview {
  move: Move;
  preview: MovePreview;
}

export interface ClientViewState {
  // 기존 필드 유지
  candidateMoves: Move[];
  candidatePreviews: CandidatePreview[];
  selectedStealTargetId: number | null;
}
```

`ClientMessage`에는 `{ kind: "chooseReceiver" }`, `{ kind: "chooseGoal" }`, `{ kind: "chooseStealer" }`, `{ kind: "protectedCarrier" }`를 추가한다.

- [x] **Step 2: 입력 매핑 실패 테스트를 새 의도 기준으로 작성한다**

```ts
it("패스는 선택한 아군 기물의 칸과 연결된다", () => {
  const state = createInitialState();
  const pass = legalMoves(state).find((move) => move.kind === "pass")!;
  const receiver = state.pieces.find((piece) => piece.id === pass.targetPieceId)!;
  expect(targetForMove(state, pass)).toEqual({ kind: "cell", pos: receiver.pos });
});

it("슛은 goalRow 자체를 공격 방향 골대 클릭으로 바꾼다", () => {
  const state = createInitialState();
  const shoot = legalMoves(state).find(
    (move) => move.kind === "shoot" && move.goalRow === 3,
  )!;
  expect(targetForMove(state, shoot)).toEqual({ kind: "goal", side: "right", row: 3 });
});
```

- [x] **Step 3: 단일 스틸러는 즉시 적용되는 Controller 테스트를 작성한다**

상대 공 소유자를 클릭했을 때 steal 후보가 하나뿐인 fixture를 사용한다. 클릭 직후 `phase === "botThinking"`, 공 소유자가 해당 스틸러, `selectedStealTargetId === null`인지 단언한다.

- [x] **Step 4: 복수 스틸러는 두 번째 선택을 기다리는 테스트를 작성한다**

```ts
controller.handleTarget(targetForMove(state, steals[0]!));
expect(controller.getViewState()).toMatchObject({
  phase: "humanTurn",
  selectedStealTargetId: carrier.id,
  message: { kind: "chooseStealer" },
});

controller.handleTarget({ kind: "cell", pos: stealerB.pos });
expect(controller.getViewState().gameState?.ball).toEqual({
  kind: "held", pieceId: stealerB.id,
});
```

- [x] **Step 5: Controller가 후보와 미리보기를 한 번에 발행하게 한다**

```ts
function setCandidates(moves: Move[]): void {
  candidateMoves = moves;
  candidatePreviews = moves.map((move) => ({ move, preview: previewMove(gameState!, move) }));
}
```

선택·행동 변경·새 게임·수 적용 시 `candidateMoves`와 `candidatePreviews`를 함께 설정하거나 함께 비운다. `snapshot()`은 두 배열과 `selectedStealTargetId`를 복사해 반환한다.

- [x] **Step 6: 상대 공 소유자 클릭 분기를 후보 수에 따라 나눈다**

```ts
const steals = legalMoves(gameState).filter(
  (move): move is Extract<Move, { kind: "steal" }> =>
    move.kind === "steal" && move.targetPieceId === piece.id,
);
if (steals.length === 1) applyHumanMove(steals[0]!);
else if (steals.length > 1) {
  selectedStealTargetId = piece.id;
  setCandidates(steals);
  message = { kind: "chooseStealer" };
  publish();
} else {
  message = { kind: gameState.noSteal > 0 ? "protectedCarrier" : "cannotSteal" };
  publish();
}
```

`selectedStealTargetId`가 있을 때는 후보 아군 칸 클릭만 해당 steal을 적용하고, 빈 칸 클릭은 선택을 해제한다.

- [x] **Step 7: 행동별 상황 안내를 연결한다**

`selectAction("pass")`는 `chooseReceiver`, `selectAction("shoot")`는 `chooseGoal`을 설정한다. 이동은 기존 기본 안내를 유지하고 후보 실행 직후 메시지를 비운다.

- [x] **Step 8: 입력과 Controller 테스트를 통과시킨다**

Run: `npm run test -- src/client/input.test.ts src/client/gameController.test.ts`

Expected: target round-trip, pass/shot direct selection, single/multiple steal, protected carrier, bot flow PASS.

- [ ] **Step 9: 승인된 경우에만 체크포인트를 커밋한다**

Suggested commit: `feat: 직접 대상 입력과 복수 스틸 선택 구현`

---

### Task 6: 경로·수신자·보호 피드백 렌더링

**Files:**
- Modify: `src/client/render.ts`
- Modify: `src/client/render.test.ts`
- Modify: `content/strings.json`
- Modify: `content/theme.json`
- Modify: `tools/validate.ts`

**Interfaces:**
- Consumes: `ClientViewState.candidatePreviews`, `selectedStealTargetId`, `GameState.noSteal`
- Produces: 성공 경로와 `✓`, 차단 경로와 `!`, 실제 수신자·차단자 테두리, 보호 `◆`

- [x] **Step 1: 문구와 색상 검증의 실패 테스트 역할을 `npm run validate`로 만든다**

`tools/validate.ts`의 필수 키에 다음을 먼저 추가한다.

```ts
const BOARD_COLORS = [
  // 기존 키
  "pathSuccess", "pathBlocked", "actualReceiver", "protected",
] as const;

const MATCH_STRINGS = [
  // 기존 키
  "chooseReceiver", "chooseGoal", "chooseStealer", "protectedCarrier",
] as const;
```

Run: `npm run validate`

Expected: FAIL listing all missing JSON keys.

- [x] **Step 2: 사용자 문구와 테마 값을 추가한다**

```json
"chooseReceiver": "패스할 아군을 선택하세요. ! 경로는 다른 선수가 먼저 받습니다.",
"chooseGoal": "골문의 위·가운데·아래를 선택하세요. ! 경로는 수비에게 막힙니다.",
"chooseStealer": "공을 빼앗을 내 선수를 선택하세요.",
"protectedCarrier": "◆ 보호 중인 공 소유자는 이번 차례에 스틸할 수 없습니다."
```

```json
"pathSuccess": "#39d98a",
"pathBlocked": "#ff5c5c",
"actualReceiver": "#f6c453",
"protected": "#d8b4fe"
```

- [x] **Step 3: 표시 모델의 상황 안내 테스트를 작성한다**

각 새 `ClientMessage`를 가진 `ClientViewState`에 `buildPresentation()`을 호출해 위 JSON 문구와 정확히 일치하는지 단언한다.

- [x] **Step 4: Canvas 기록 대역에 경로와 기호 API를 기록하게 한다**

`render.test.ts`의 `RecordingContext`가 `moveTo`, `lineTo`, `setLineDash`, `fillText`의 좌표·문자·현재 strokeStyle을 보존하게 확장한다. 브라우저 `FakeContext`와 실제 Canvas 호환을 위해 렌더 코드에서는 표준 Canvas API만 사용한다.
테스트 대역에는 `globalAlpha = 1`도 추가해 경로 셀의 반투명 채우기 후 값이 복원되는지 확인한다.

- [x] **Step 5: 후보 미리보기 경로를 그리는 함수를 구현한다**

```ts
function drawPreviewPath(
  context: CanvasRenderingContext2D,
  actor: Pos,
  resolvedTarget: CanvasTarget,
  preview: Extract<MovePreview, { kind: "pass" | "shoot" }>,
): void {
  const successful = preview.kind === "pass"
    ? preview.reachesTarget
    : preview.outcome === "goal";
  const color = successful ? theme.board.pathSuccess : theme.board.pathBlocked;

  context.fillStyle = color;
  context.globalAlpha = 0.22;
  for (const pos of preview.path) {
    context.fillRect(
      BOARD_GEOMETRY.originX + pos.x * BOARD_GEOMETRY.cell,
      BOARD_GEOMETRY.originY + pos.y * BOARD_GEOMETRY.cell,
      BOARD_GEOMETRY.cell,
      BOARD_GEOMETRY.cell,
    );
  }
  context.globalAlpha = 1;

  const from = cellCenter(actor);
  const to = targetCenter(resolvedTarget);
  if (!to) return;
  context.strokeStyle = color;
  context.setLineDash([]);
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.fillText(successful ? "✓" : "!", to.x, to.y);
}
```

`resolvedTarget`은 성공 pass면 목표 기물, 차단 pass면 `receiverPieceId`, 차단 shoot면 `blockerPieceId`, 열린 shoot면 `targetForMove(state, move)`의 골문이다. 이 ID들은 모두 미리보기에서 받고 Renderer는 해당 기물 좌표만 조회하므로 충돌 규칙을 재구현하지 않는다. `globalAlpha`는 함수 종료 전에 항상 `1`로 복원한다.

- [x] **Step 6: 실제 수신자·차단자와 보호 소유자를 강조한다**

pass는 `receiverPieceId`, blocked shoot는 `blockerPieceId`의 기물에 `actualReceiver` 이중 테두리를 그린다. `noSteal > 0`이고 공이 held이면 소유자 위에 `◆`를 `protected` 색으로 그린다. 복수 스틸러 선택 중에는 `candidateMoves`의 `pieceId`들만 home 기물 테두리로 강조한다.

- [x] **Step 7: 색상 외 신호를 테스트한다**

성공 패스 fixture에서는 `✓`, 차단 슛 fixture에서는 `!`, 보호 fixture에서는 `◆`가 `RecordingContext.fillTexts`에 포함되는지 단언한다. 차단자 ID의 중심에 이중 stroke가 기록되고 성공·차단 경로의 stroke 색이 다른지도 함께 확인한다.

- [x] **Step 8: 렌더·content 검증을 통과시킨다**

Run: `npm run test -- src/client/render.test.ts`

Expected: presentation, candidates, symbols, receiver/blocker/protection tests PASS.

Run: `npm run validate`

Expected: `✓ content 검증 통과`.

- [ ] **Step 9: 승인된 경우에만 체크포인트를 커밋한다**

Suggested commit: `feat: 패스와 슛 결과 미리보기 표시`

---

### Task 7: 브라우저 진입점과 Worker 회귀

**Files:**
- Modify: `src/client/main.test.ts`
- Modify: `src/client/engineClient.test.ts` only if fixtures contain old Move fields
- Verify: `src/client/main.ts`
- Verify: `src/worker/protocol.ts`
- Verify: `src/worker/engine.worker.ts`

**Interfaces:**
- Consumes: unchanged `EngineClient.analyze(state, depth)` and Worker `SearchResult`
- Produces: no new production interface; proves the new Move contract crosses DOM and Worker boundaries.

- [x] **Step 1: Fake Canvas에 새 렌더 API를 추가한다**

```ts
class FakeContext {
  // 기존 필드와 메서드 유지
  globalAlpha = 1;
  setLineDash(): void {}
}
```

- [x] **Step 2: DOM 왕복 테스트를 직접 대상 패스로 바꾼다**

게임 시작 후 kickoff MF를 클릭하고 패스 버튼을 누른 뒤 합법 pass의 `targetPieceId` 기물 중심 픽셀을 클릭한다. Worker 요청의 `state.turn === 1`과 공 소유자가 선택한 패스의 미리보기 수신자와 같은지 확인한다.

- [x] **Step 3: Worker 봇 응답이 새 Move를 적용하는지 확인한다**

기존처럼 요청 상태의 `legalMoves(request.state)[0]`을 `analysis.result.best`로 돌려주고, 두 ply 뒤 UI가 `humanTurn`, `2 / 60 ply`가 되는지 단언한다.

- [x] **Step 4: 브라우저 경계 테스트를 통과시킨다**

Run: `npm run test -- src/client/main.test.ts src/client/engineClient.test.ts`

Expected: DOM event, Worker request/response, timeout/restart tests PASS.

- [x] **Step 5: Worker 파일에 옛 Move 필드가 없는지 확인한다**

Run: `rg -n "\.dy\b|kind:\s*[\"']pass[\"'][^\n]*\bto\b" src`

Expected: no production-code matches. Test descriptions explaining removed behavior must also be renamed.

- [ ] **Step 6: 승인된 경우에만 체크포인트를 커밋한다**

Suggested commit: `test: 새 경기 규칙의 브라우저 왕복 검증`

---

### Task 8: 결정론적 완주와 탐색 성능

**Files:**
- Modify: `src/engine/rules.test.ts`
- Modify: `src/client/input.test.ts`
- Modify: `src/engine/search.ts` only when measurement proves necessary

**Interfaces:**
- Consumes: `legalMoves()`, `applyMove()`, `previewMove()`, `search()`
- Produces: 64-game invariant regression and a fixed depth-3 benchmark scenario

- [x] **Step 1: 완주 시뮬레이션의 새 불변 조건을 강화한다**

각 ply에서 모든 pass는 존재하는 같은 팀 `targetPieceId`, 모든 shoot는 `goalRow` 3·4·5, 모든 steal은 체비쇼프 거리 1인지 확인한다. 각 pass/shoot에 대해 `previewMove(previous, move)`의 수신자·차단자와 `applyMove()` 뒤 공·점수가 일치하는지도 단언한다.

- [x] **Step 2: Canvas 왕복 시뮬레이션에서 중복 의도만 금지한다**

같은 `pieceId + kind` 안에서 pass는 `targetPieceId`, shoot는 `goalRow`, steal은 `targetPieceId`, move는 목적지 좌표가 고유한지 검사한다. 서로 다른 아군 목표가 같은 실제 차단자에게 연결되는 것은 합법이므로 미리보기 결과를 중복 금지 키로 사용하지 않는다.

- [x] **Step 3: 고정 상태 depth-3 성능 테스트를 작성한다**

```ts
it("초기 6대6 국면의 깊이 3 탐색이 기준 장치에서 5초 안에 끝난다", () => {
  const result = search(createInitialState(), { depth: 3, evalFn: evalLv1 });
  expect(result.best).not.toBeNull();
  expect(result.depth).toBe(3);
  expect(result.ms).toBeLessThan(5_000);
});
```

이 테스트는 실제 Worker timeout보다 느슨한 단위 경계가 아니라 동일한 5초 제품 제한을 기록한다. CI 장치 변동으로 불안정하면 자동 실패 기준은 10초로 완화하고 5초는 별도 출력·브라우저 검증으로 유지하되, 사용자 승인 없이 깊이를 2로 내리지 않는다.

- [x] **Step 4: 엔진·입력 시뮬레이션을 실행한다**

Run: `npm run test -- src/engine/rules.test.ts src/client/input.test.ts`

Expected: 64 engine games and 32 Canvas round-trip games finish without invariant failure.

- [x] **Step 5: 느린 경우 측정 순서대로 최소 최적화한다**

먼저 `legalMoves()` 한 상태당 후보 수, `search().nodes`, `search().ms`를 기록한다. 그 다음에만 다음 순서로 변경하고 각 변경 전후 수치를 비교한다.

1. `moveRank()`가 이미 계산한 `previewMove()` 결과를 같은 루트 정렬에서 재사용한다.
2. 한 `legalMoves()` 호출 안에서 piece ID/좌표 lookup Map을 한 번만 만든다.
3. 동일 pass/shoot의 `traceBallPath()` 결과를 해당 상태의 preview와 apply 사이에서 재사용한다.

각 최적화 후 결정론 테스트에서 `ms`를 제외한 전체 `SearchResult`가 이전과 같은지 확인한다.

측정 결과: 초기 6대6 depth-3 탐색은 44ms로 5초 기준을 충분히 만족해 최적화를
적용하지 않았다. 따라서 이번 Task에서는 `src/engine/search.ts`를 변경하지 않았다.

- [x] **Step 6: 전체 자동 검증을 통과시킨다**

Run: `npm run check`

Expected: typecheck, all Vitest tests, content validation PASS.

- [ ] **Step 7: 승인된 경우에만 체크포인트를 커밋한다**

Suggested commit: `test: 6대6 완주와 탐색 성능 검증`

---

### Task 9: 빌드·실제 세 경기·문서 승격

**Files:**
- Modify: `docs/game-policy.md`
- Modify: `docs/current-state.md`
- Modify: `docs/project-plan.md`
- Verify unchanged: `reference/prototype.html`

**Interfaces:**
- Consumes: 완성된 M2.5 런타임과 설계서의 여섯 플레이테스트 기준
- Produces: 재현 가능한 검증 기록과 현재 규칙 문서

- [x] **Step 1: 프로덕션 빌드를 확인한다**

Run: `npm run build`

Expected: Vite build PASS and both main bundle and `engine.worker` bundle emitted.

- [x] **Step 2: 참고 프로토타입이 변하지 않았는지 확인한다**

Run: `git diff --exit-code -- reference/prototype.html`

Expected: exit code 0 and no diff.

- [x] **Step 3: 로컬 브라우저에서 첫 경기를 패스 중심으로 플레이한다**

확인 기록:

- 설명 문서 없이 아군을 직접 골라 패스할 수 있다.
- 초록 `✓`와 빨강 `!` 경로의 실행 결과가 미리보기와 일치한다.
- 중간 아군 또는 상대가 먼저 닿으면 강조된 그 기물이 실제 공을 받는다.

- [ ] **Step 4: 두 번째 경기를 슛과 차단 중심으로 플레이한다**

확인 기록:

- 같은 위치에서 home과 away 모두 골문 3행을 선택할 수 있다.
- 정확히 경로 위에 둔 기물만 슛을 막는다.
- 막힌 슛도 클릭 가능하고 강조된 차단자가 실제 공을 가진다.

- [ ] **Step 5: 세 번째 경기를 스틸과 성능 중심으로 플레이한다**

확인 기록:

- 한 경기 안에서 최소 한 번 스틸 기회를 발견한다.
- 단일 스틸러는 즉시, 복수 스틸러는 선택 후 적용된다.
- 보호 방패가 보이는 상대 턴에는 재스틸할 수 없다.
- 모든 깊이 3 봇 응수가 5초 안에 완료된다.
- 이전 4대4 버전보다 다시 플레이하고 싶은지 사용자 판단을 기록한다.

- [ ] **Step 6: 살아 있는 문서를 구현 완료 상태로 승격한다**

`game-policy.md`의 `[승인·구현 전]` 절을 `[확정]`으로 바꾸고 3장 이후의 4대4 배치·역할별 이동·옛 패스·`dy` 슛·4방향 스틸 설명을 실제 6대6 규칙으로 교체한다. `current-state.md`에는 새 파일, 테스트 수, build 결과, 세 경기 결과와 알려진 제한을 기록한다. `project-plan.md`의 M2.5 체크박스는 실제 확인된 항목만 `[x]`로 바꾼다.

- [ ] **Step 7: 최종 검증을 다시 실행한다**

Run: `npm run check`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git diff --exit-code -- reference/prototype.html`

Expected: no changes.

- [ ] **Step 8: 승인된 경우에만 최종 체크포인트를 커밋한다**

Suggested commit: `feat: 핵심 경기 규칙 6대6 개편`
