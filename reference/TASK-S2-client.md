# S2 작업: 플레이 가능한 home 대 봇 경기

## 목표

브라우저에서 사용자가 항상 `home`, 봇이 항상 `away`를 맡아 한 경기를 시작하고 끝낼 수 있게 한다. 경기는 한 팀이 먼저 3골을 넣거나 전체 60 ply에 도달하면 종료되며, 종료 또는 복구 불가능한 봇 오류 뒤에는 새 경기를 즉시 시작할 수 있어야 한다.

S2는 대국 완주에 집중한다. 수 품질 판정, 경기 후 리뷰, 퍼즐, 셀프플레이, 난이도 선택은 범위에 포함하지 않는다. `reference/prototype.html`은 참고 자료로 그대로 보존하고 런타임 코드로 분리하거나 수정하지 않는다.

## 확정된 경기 정책

- 사용자는 항상 `home`, 봇은 항상 `away`다.
- 시작 점수는 0:0이고 home이 선공한다.
- 어느 팀이든 3골에 먼저 도달하면 해당 수를 적용한 직후 즉시 승리한다.
- 3골에 도달하지 않으면 득점 여부와 관계없이 경기 전체를 최대 60 ply로 제한한다. 득점 후 `turn`을 초기화하지 않는다.
- 60 ply에서 점수가 높은 팀이 승리하고 동점이면 무승부다.
- 종료 판정은 엔진의 순수 함수가 현재 `GameState`에서 계산한다. 판정 결과를 `GameState`에 중복 저장하지 않는다.
- 종료된 상태에서 `legalMoves()`는 빈 배열을 반환하고 `search()`는 최선 수를 반환하지 않는다.
- S2의 봇 탐색 깊이는 3으로 고정한다.

권장 판정 계약은 다음 의미를 표현해야 한다. 구체적인 타입 이름과 필드 배치는 구현 계획에서 정할 수 있지만, 승자와 종료 이유를 문자열 하나로 뭉개지 않는다.

```ts
type GameResult =
  | { kind: "win"; winner: Team; reason: "scoreLimit" | "turnLimit" }
  | { kind: "draw"; reason: "turnLimit" };

function gameResult(state: GameState): GameResult | null;
```

3골 기준은 S2의 엔진 규칙 상수로 둔다. 60 ply 기준은 기존 `GameState.maxTurns`를 사용한다.

## 클라이언트 책임 분리

S2 클라이언트는 다음 책임으로 분리한다.

| 파일 | 책임 |
|---|---|
| `src/client/types.ts` | 화면 단계, 선택 행동, 화면에 전달할 상태 등 클라이언트 전용 타입 |
| `src/client/gameController.ts` | 현재 경기와 UI 선택 상태 소유, 사람·봇 턴 전환, 종료 판정, 재시도 정책 |
| `src/client/engineClient.ts` | Worker 생성·종료, `requestId` 매칭, Promise 기반 분석 API, 타임아웃 처리 |
| `src/client/render.ts` | 전달받은 화면 상태를 Canvas와 HTML에 표현 |
| `src/client/input.ts` | Canvas 클릭 좌표를 보드 칸 또는 슛 목표로 변환 |
| `src/client/main.ts` | DOM 조회와 Controller·Renderer·EngineClient 조립 |
| `src/worker/engine.worker.ts` | 별도 스레드에서 엔진 탐색 실행 |

`GameController`는 클래스 대신 팩터리 함수와 클로저로 만든다. Controller는 구체적인 Renderer를 import하지 않고 `onChange(viewState)` 콜백을 받아 상태가 바뀔 때 호출한다.

```text
main.ts
  ├─ createEngineClient()
  ├─ createGameController({ engineClient, onChange: render })
  └─ DOM·Canvas 이벤트를 Controller에 전달
```

엔진의 가벼운 함수인 `legalMoves()`, `applyMove()`, `gameResult()`는 브라우저 메인 스레드에서 Controller가 직접 호출한다. 계산량이 큰 `search()`만 Worker에서 실행한다. 두 경로 모두 사용자의 브라우저에서 동작하며 백엔드는 사용하지 않는다.

## 클라이언트 화면 상태

Controller는 최소한 다음 정보를 보관한다.

- 현재 화면 단계
- 현재 `GameState` 또는 시작 전의 `null`
- 선택된 home 기물 ID
- 선택된 행동: `move`, `pass`, `shoot` 중 하나 또는 선택 없음
- 현재 화면에 표시할 후보 `Move` 목록
- 마지막으로 적용된 `Move`
- 현재 봇 분석 시도 횟수
- 사용자 안내 또는 오류 메시지

점수, 현재 차례, 남은 ply와 경기 결과는 `GameState`에서 계산한다. 같은 사실을 별도 필드로 중복 저장하지 않는다.

화면 단계는 다음 다섯 가지다.

```ts
type GamePhase = "ready" | "humanTurn" | "botThinking" | "finished" | "fatalError";
```

```text
ready
  → 게임 시작
humanTurn
  → 사용자 수 적용
  → 종료면 finished
  → 계속이면 botThinking
botThinking
  → 봇 수 적용
  → 종료면 finished
  → 계속이면 humanTurn
```

- 최초 진입은 `ready`이며 HTML의 `게임 시작` 버튼을 표시한다.
- `finished`와 `fatalError`에는 `새 게임` 버튼을 표시한다.
- 새 게임 버튼은 중간 준비 화면으로 돌아가지 않고 즉시 새 `GameState`를 만들어 `humanTurn`을 시작한다.
- `botThinking`, `finished`, `fatalError`에서는 Canvas 경기 입력을 잠근다.

## 사용자 입력 규칙

### 공통 선택

- home 기물을 클릭하면 해당 기물을 선택한다.
- 다른 home 기물을 클릭하면 선택을 전환하고 기존 행동 선택을 초기화한다. 단, 아래의 합법 패스 대상 우선 규칙이 먼저 적용된다.
- 후보가 아닌 빈 칸을 클릭하면 기물, 행동, 후보 표시를 모두 해제한다.
- 한 수가 적용되면 기물, 행동, 후보 선택을 모두 초기화한다.
- home 기물을 선택하지 않은 상태에서 away 기물을 클릭하면 `먼저 내 기물을 선택하세요.`와 같은 안내를 표시한다.

### 이동·패스·슛

- HTML 행동 버튼은 `이동`, `패스`, `슛`만 제공한다.
- 선택한 기물에서 가능한 행동 버튼만 표시한다.
- 행동 버튼을 선택하면 그 종류에 해당하는 합법 후보만 Canvas에 표시한다.
- 이동은 강조된 빈 목적지 칸을 클릭하면 실행한다.
- 패스는 강조된 아군 또는 빈 목적지 칸을 클릭하면 실행한다. 아군이면 공 소유권이 이전되고 빈 칸이면 루즈볼이 된다.
- 슛은 골대 쪽에 표시한 합법 방향을 클릭하면 실행한다. `dy = -1`, `0`, `1`은 각각 위 대각선, 직선, 아래 대각선이다.

패스와 기물 선택이 충돌할 때는 다음 우선순위를 사용한다.

1. `패스`가 선택되어 있고 클릭한 home 기물이 합법 패스 대상이면 즉시 패스한다.
2. 그렇지 않으면 클릭한 home 기물로 선택을 전환한다.

### 스틸

- 스틸 버튼은 만들지 않는다.
- 선택한 home 기물로 스틸할 수 있는 away 볼 소유자는 다른 후보와 구분되는 색이나 테두리로 항상 강조한다.
- 강조된 상대 기물을 클릭하면 선택된 다른 행동이 있어도 스틸을 우선해 즉시 실행한다.
- 스틸할 수 없는 away 기물을 클릭하면 현재 home 기물과 행동 선택을 유지하고 안내만 표시한다.

## 렌더링 책임

Canvas에는 공간적 정보만 그린다.

- 경기장과 격자
- 기물과 역할
- held 또는 loose 상태의 공
- 선택된 기물
- 현재 행동 후보
- 스틸 가능한 상대 기물
- 마지막 수

HTML DOM에는 조작과 문자 정보를 둔다.

- 게임 시작 및 새 게임 버튼
- 이동, 패스, 슛 버튼
- 점수
- 현재 차례
- 남은 ply
- 봇 생각 중 및 재시도 상태
- 경기 결과와 오류·입력 안내 메시지

`render()`는 상태를 생성하거나 변경하지 않는다. Controller가 전달한 화면 상태만 읽어 Canvas와 HTML을 매번 다시 그린다.

## Worker 분석과 오류 복구

- Controller는 봇 차례에 `engineClient.analyze(state, 3)`을 호출한다.
- 한 번의 분석 제한 시간은 5초다.
- 최초 요청을 포함해 최대 3회 자동으로 시도한다.
- 오류 또는 시간 초과가 발생하면 기존 Worker를 종료하고 새 Worker를 만든 뒤 재시도한다.
- 재시도 중에는 `봇 분석을 다시 시도합니다 (2/3)`처럼 현재 시도를 표시한다.
- 종료된 경기 상태가 아닌데 `best === null`이면 분석 실패로 취급한다.
- 종료되거나 교체된 Worker에서 늦게 도착한 응답은 무시한다.
- 세 번 모두 실패하면 `fatalError`로 전환하고 입력을 잠근 뒤 새 게임 버튼을 제공한다. 수동 재시도 버튼은 만들지 않는다.

## 테스트 요구사항

### 엔진

- 한 팀이 3골에 도달하면 즉시 승리로 판정한다.
- 60 ply에서 점수에 따라 home 승리, away 승리, 무승부를 판정한다.
- 3골 또는 60 ply로 종료된 상태에서는 합법 수와 최선 수가 없다.
- 득점 후에도 전체 `turn`이 초기화되지 않는다.

### Controller

- `ready → humanTurn → botThinking → humanTurn` 흐름을 검증한다.
- 사용자 수와 봇 수를 적용한 직후 각각 종료 판정을 수행한다.
- 새 게임이 완전히 새로운 상태로 즉시 시작되는지 검증한다.
- 봇 분석이 최대 세 번 자동 재시도되고 매번 Worker가 교체되는지 검증한다.
- 세 번째 실패 후 `fatalError`와 입력 잠금이 적용되는지 검증한다.

### 입력과 화면 상태

- 빈 공간 클릭 시 선택 해제
- home 기물 선택과 선택 전환
- 이동·패스·슛 후보 선택
- away 볼 소유자 직접 클릭을 통한 스틸
- 패스 행동 중 합법한 home 대상 클릭 시 패스 우선
- 단계별 버튼, 메시지와 입력 잠금 상태

## 완료 기준

- 브라우저에서 게임 시작 버튼으로 home 대 away 봇 경기를 시작할 수 있다.
- 이동, 패스, 세 방향 슛, 직접 클릭 스틸을 합법 수 범위에서 수행할 수 있다.
- 사람의 수 뒤에 봇이 깊이 3으로 응수하며 탐색 중 화면이 멈추지 않는다.
- 3골 선취 또는 전체 60 ply에서 정확한 결과를 표시하고 종료한다.
- 종료 또는 치명적 봇 오류 뒤 새 게임을 즉시 시작할 수 있다.
- 자동 재시도 횟수와 오류 상태가 사용자에게 표시된다.
- `reference/prototype.html`은 변경되지 않는다.
- `npm run check`가 통과한다.
- `npm run build`가 통과한다.

커밋은 사용자가 별도로 요청할 때만 수행한다.

세부 작업 순서와 테스트 절차는 [S2 구현 계획](../docs/superpowers/plans/2026-08-17-s2-playable-match.md)을 따른다.
