# KickMate 아키텍처

이 문서는 KickMate 코드베이스를 처음 읽는 사람이 전체 구조와 의존 방향을 먼저 이해할 수 있도록 설명한다. 구현 완료 여부와 다음 작업은 [current-state.md](./current-state.md)에서 관리한다.

> 현재 본문은 배포된 4대4 런타임 구조를 설명한다. 다음 변경으로 승인된 6대6 규칙과 엔진 계약은 [핵심 경기 규칙 개편 설계](./superpowers/specs/2026-08-19-core-gameplay-redesign-design.md)를 따르며, 구현 전까지 현재 코드의 사실과 구분한다.

## 한 문장으로 보는 구조

KickMate는 하나의 순수 게임 엔진을 브라우저 화면, Web Worker, 퍼즐 검산, 셀프플레이가 함께 사용하는 구조다.

```text
사용자
  ↓
브라우저 클라이언트
  ↓ 요청                 ↑ 응답
Web Worker 어댑터
  ↓
순수 게임 엔진
  ├─ 룰과 상태 전이
  ├─ 평가 함수
  └─ 최선 수 탐색
```

핵심 원칙은 게임 규칙을 화면 코드와 분리하는 것이다. 엔진은 Canvas나 DOM을 모르며 `GameState`를 입력받아 가능한 수, 새로운 상태, 평가값을 반환한다.

## 디렉터리 지도

```text
kickmate/
├─ src/
│  ├─ client/              브라우저 화면과 사용자 입력
│  ├─ worker/              클라이언트와 엔진 사이의 비동기 통신
│  └─ engine/              순수 게임 규칙, 평가, 탐색
├─ content/                문구, 색상, 퍼즐, 밸런스 데이터
├─ tools/                  콘텐츠 검증과 셀프플레이 도구
├─ reference/              검증된 프로토타입과 TASK 명세
├─ docs/                   구조와 현재 상태를 설명하는 문서
├─ index.html              브라우저 진입 HTML
└─ package.json            실행 명령과 개발 의존성
```

## 계층별 책임

### 브라우저 진입점

`index.html`은 화면에 Canvas를 만들고 `src/client/main.ts`를 ES module 진입점으로 실행한다. 게임 규칙은 포함하지 않는다.

```text
index.html
  ├─ <canvas id="board">
  └─ <script type="module" src="/src/client/main.ts">
```

### 클라이언트: `src/client/`

클라이언트는 사용자에게 보이는 것과 브라우저 입력을 담당한다.

- Canvas 및 HTML UI 렌더링
- 마우스·터치·키보드 입력
- 현재 게임 상태 보관
- 선택한 수를 엔진 상태에 적용
- Worker에 분석 요청
- 점수, 턴, 판정 결과 표시

클라이언트는 엔진의 공개 함수와 타입을 사용할 수 있지만 게임 규칙을 다시 구현하면 안 된다.

S2에서 확정한 다음 클라이언트 분리는 현재 구현돼 있다. 이후 규칙 개편도 이 책임 경계를 유지하며 실제 진행 상태는 [current-state.md](./current-state.md)를 따른다.

```text
main.ts
  ├─ gameController.ts  경기와 UI 상태, 턴 흐름
  ├─ engineClient.ts    Worker 요청·응답과 수명 관리
  ├─ input.ts           Canvas 클릭을 선택 후보로 변환
  ├─ render.ts          Canvas와 HTML 출력
  └─ types.ts           클라이언트 전용 상태 계약
```

Controller는 상태가 바뀔 때 `onChange(viewState)`를 호출하고 Renderer는 전달받은 상태만 그린다. `legalMoves()`, `applyMove()`, 종료 판정처럼 짧은 계산은 메인 스레드에서 직접 호출하고, 깊이 탐색만 Worker에 맡긴다. 상세 계약은 [TASK-S2-client.md](../reference/TASK-S2-client.md)를 참고한다.

### Worker 어댑터: `src/worker/`

Worker 계층은 무거운 탐색이 브라우저 UI를 멈추지 않도록 엔진 호출을 별도 스레드로 전달한다.

- `protocol.ts`: 요청과 응답의 TypeScript 타입
- `engine.worker.ts`: 메시지를 받아 `legalMoves()` 또는 `search()`를 호출하는 어댑터

Worker는 게임 규칙을 소유하지 않는다. 메시지를 변환하고 엔진 함수를 호출하는 역할만 한다.

### 엔진: `src/engine/`

엔진은 KickMate의 게임 규칙과 분석을 담당하는 순수 TypeScript 계층이다.

- `types.ts`: 상태, 기물, 공, 수, 탐색 결과 타입
- `rules.ts`: 초기 상태, 합법 수 생성, 상태 전이
- `eval/lv1.ts`: 한 국면을 숫자로 평가하는 휴리스틱
- `search.ts`: 네가맥스와 알파베타 가지치기로 최선 수 탐색
- `rules.test.ts`: 엔진의 주요 불변 조건과 상태 전이 검증

엔진에서는 DOM, Canvas, Web Worker 전역, 파일시스템에 접근하지 않는다. 같은 입력에는 같은 논리적 결과를 반환하며 무작위 호출을 사용하지 않는다.

### 콘텐츠: `content/`

콘텐츠는 코드 수정 없이 바꿀 수 있는 데이터를 보관한다.

- `theme.json`: 보드와 팀 색상
- `strings.json`: 사용자에게 표시할 문구
- `pieces.json`: 기물 이동과 룰 설정 데이터
- `puzzles/*.json`: 퍼즐 배치와 목표

콘텐츠의 구조는 `tools/validate.ts`가 검사한다. 콘텐츠가 실제 런타임에 연결된 정도는 [current-state.md](./current-state.md)를 참고한다.

### 개발 도구: `tools/`

- `validate.ts`: `content/` JSON의 형식과 기본 제약 검증
- `selfplay.ts`: 동일한 순수 엔진을 Node.js에서 반복 실행할 셀프플레이 진입점

도구는 브라우저 앱에 포함되지 않는다.

### 참고 자료: `reference/`

`reference/prototype.html`은 검증된 게임 동작의 참고 스냅샷이고, `TASK-*.md`는 특정 작업의 요구사항과 완료 기준이다. 제품 코드는 참고 파일을 import하지 않는다. 명시적인 요청이 없으면 참고 파일은 수정하거나 런타임 코드로 분리하지 않는다.

## 핵심 데이터 모델

엔진의 중심에는 `GameState`가 있다.

```ts
interface GameState {
  turn: number;
  maxTurns: number;
  pieces: Piece[];
  ball: BallState;
  noSteal: number;
  score: { home: number; away: number };
}
```

- `turn`: 지금까지 진행된 ply. 짝수는 home, 홀수는 away 차례다.
- `maxTurns`: 최대 ply 수다.
- `pieces`: 현재 4대4 런타임에서는 8개 기물의 팀, 역할, 좌표다. 승인된 다음 규칙에서는 12개로 늘어난다.
- `ball`: 특정 기물이 소유하거나 보드 위 루즈볼로 존재한다.
- `noSteal`: 선방·스틸 직후 재스틸을 막는 보호 카운터다.
- `score`: 양 팀 득점이다.

한 번의 행동은 `Move` 네 종류 중 하나다.

```text
move   기물 이동
pass   패스
shoot  슛
steal  스틸
```

### 승인된 다음 엔진 계약 `[구현 전]`

6대6 개편에서는 사용자의 의도를 좌표 기울기가 아니라 대상 자체로 표현한다.

```ts
type Move =
  | { kind: "move"; pieceId: number; to: Pos }
  | { kind: "pass"; pieceId: number; targetPieceId: number }
  | { kind: "shoot"; pieceId: number; goalRow: 3 | 4 | 5 }
  | { kind: "steal"; pieceId: number; targetPieceId: number };
```

엔진은 패스와 슛이 지나가는 공통 선분 경로를 계산하고 `previewMove(state, move)`로 실제 수신자·차단자·득점 여부를 상태 전이 전에 제공한다. `applyMove()`는 같은 내부 판정을 재사용해야 하며, 클라이언트는 경로 또는 차단 규칙을 복제하지 않고 엔진의 미리보기 결과만 표현한다.

## 상태 전이 흐름

게임 진행의 핵심 흐름은 다음과 같다.

```text
현재 GameState
  ↓ legalMoves(state)
가능한 Move[]
  ↓ 사용자가 하나 선택
선택한 Move
  ↓ applyMove(state, move)
새로운 GameState
  ↓ render(state)
새 화면
```

`applyMove()`는 입력 상태를 직접 변경하지 않는다. 기존 상태를 복제한 뒤 수를 적용한 새로운 상태를 반환한다.

```text
기존 상태 ──────────────── 그대로 유지
    └─ 복제 → 수 적용 → 새로운 상태
```

이 성질 덕분에 탐색이 하나의 상태에서 여러 후보 수를 안전하게 비교할 수 있다.

## 분석 흐름

봇이나 분석 기능은 다음 경로를 사용하도록 설계돼 있다.

```text
client
  ↓ analyze 요청: state + depth
worker/protocol.ts
  ↓
engine.worker.ts
  ↓ search(state, options)
search.ts
  ├─ legalMoves(state)
  ├─ applyMove(state, move)
  └─ evalLv1(state, perspective)
  ↓
SearchResult
  ├─ best
  ├─ score
  ├─ values
  ├─ nodes
  ├─ depth
  └─ ms
```

`values`에는 모든 루트 후보 수와 점수가 들어간다. 이를 이용하면 사용자가 둔 수가 최선 수보다 얼마나 나빴는지 계산할 수 있다.

## 의존 방향

허용되는 의존 방향은 바깥 계층에서 안쪽 엔진 계층으로 향한다.

```text
client ──→ worker ──→ engine
  │                    ↑
  └────────────────────┘

tools ────────────────→ engine
tests ────────────────→ engine
```

금지되는 방향은 다음과 같다.

```text
engine ─X→ client
engine ─X→ worker
engine ─X→ DOM / Canvas
engine ─X→ filesystem
```

이 규칙을 지키면 브라우저 없이도 엔진을 테스트하고 셀프플레이에 사용할 수 있다.

## 검증 경계

저장소의 기본 완료 명령은 다음과 같다.

```bash
npm run check
```

이 명령은 다음 세 단계를 순서대로 실행한다.

```text
TypeScript typecheck
  ↓
Vitest 엔진 테스트
  ↓
content JSON 검증
```

GitHub Actions에서는 여기에 배포 빌드 검증도 추가한다.

```bash
npm run build
```

## 새 기능을 추가할 때 확인할 것

1. 기능의 책임이 client, worker, engine, content 중 어디에 속하는지 먼저 정한다.
2. 게임 규칙을 client나 worker에 중복 구현하지 않는다.
3. 상태 변화는 `GameState → Move → GameState` 형태로 표현한다.
4. 엔진 동작 변경에는 실패하는 테스트를 먼저 추가한다.
5. 공개 타입이 바뀌면 worker 프로토콜과 호출자를 함께 확인한다.
6. 구현 후 `npm run check`를 실행한다.
