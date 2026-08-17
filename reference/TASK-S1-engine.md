# S1 작업: 엔진 이식 (프로토타입 → src/engine)

`src/engine/`의 미구현 스텁을 `reference/prototype.html`의 **검증된 로직**으로 이식한다.
프로토타입의 `<script>` 블록이 로직의 원본이다: `genMoves`, `applyMove`, `evalS`, `negamax`/`searchRoot`, `newState`/`kickoff`.

## 룰 상수 (프로토타입 그대로)

- 보드 13×9. 골문은 y=3,4,5 (양쪽 골라인 밖 x=-1, x=13 칸)
- 4대4, 역할 GK/DF/MF/FW. 초기 배치 HOME0=[[0,4],[2,4],[4,3],[4,5]] (GK,DF,MF,FW 순), away는 x→12-x, y→8-y 미러
- 킥오프: 모든 기물 초기 배치로 리셋 후 킥오프 팀 MF가 센터(6,4)로 이동해 공 소유. 경기 시작은 home 킥오프, 득점 후에는 실점 팀 킥오프
- 이동 — GK: 박스 안(side0: x≤1, 2≤y≤6 / side1: x≥11) 전방향 1칸 / DF: 직선(상하좌우) 최대 2칸 슬라이드 / MF: 8방향 최대 2칸 슬라이드 / FW: 나이트 점프. 슬라이드는 기물에 막히면 그 방향 중단, 도착 칸은 비어 있어야 함
- 이동 시 공 소유자가 움직이면 공도 이동, 루즈볼 칸에 도착하면 소유 획득
- 패스: 소유자만, 8방향 직선 최대 6칸. 선상 첫 접촉이 동료면 연결, 상대면 그 방향 폐쇄, 아무도 없으면 마지막 빈 칸으로 루즈볼
- 슛: 소유자만, dy∈{-1,0,1} 레이가 골문 행(3,4,5)으로 골라인을 통과할 때. 골까지 x거리 최대 7. 경로(골라인 전까지)에 아무 기물이라도 있으면 첫 기물이 선방(소유권 이동 + noSteal=1), 비었으면 골 → 득점, 킥오프, 턴 전환
- 스틸: 상대 소유자와 맨해튼 거리 1(상하좌우)인 내 기물이 실행, 소유권 이동 + noSteal=1. noSteal>0이면 스틸 불가(매 수 적용 시 1 감소)
- 총 60수(ply) 제한, 다득점 승. 무작위 호출 0회 — 결정론 필수

## 구현 지시

1. **`src/engine/types.ts`** — 필요하면 수정해도 된다. 프로토타입과의 정합을 위해 `GameState`에 `noSteal: number` 추가, `Piece.protectedUntilTurn` 제거 등 자유. `SearchResult`에 루트 후보 수 목록(`values: {move, score}[]`)을 추가해라 — 블런더 판정(최선 대비 하락)에 필요하다
2. **`src/engine/rules.ts`** — `createInitialState`(킥오프 포함), `legalMoves`, `applyMove` 구현. `applyMove`는 순수 함수(새 상태 반환). 골 처리(득점→킥오프→턴 전환) 포함
3. **`src/engine/eval/lv1.ts`** — `evalS` 이식: 득점차 ×10000, 소유 보너스 140 + 전진도×9 + 슛코스 450 − 스틸위협 170, 루즈볼 접근성 (d상대−d내)×30, 위치 보너스(FW×3, MF×1.5 전진도)
4. **`src/engine/search.ts`** — 네가맥스+알파베타, 수 정렬(슛(노골 100/선방 60) > 스틸 50 > 패스 30 > 이동 0), 루트 탐색이 SearchResult 반환. `performance.now` 대신 Node·브라우저 겸용으로 (`globalThis.performance?.now?.() ?? Date.now()`)
5. **`src/engine/rules.test.ts`** — 새 초기 상태에 맞게 수정 + 추가 테스트: 초기 국면 합법 수 존재, 빈 경로 슛은 득점 및 킥오프 리셋, 선방 시 소유권 이동, 스틸 보호 동작, 같은 입력→같은 탐색 결과(결정론), 60수 종료
6. **`src/worker/engine.worker.ts`** — 시그니처가 바뀌면 맞춰 수정
7. 엔진은 순수 모듈 유지: DOM·파일시스템 접근 금지. `content/`, `src/client/`는 컴파일이 깨지지 않는 한 건드리지 않는다

## 완료 기준

`npm run check`(typecheck + vitest + validate)가 통과해야 한다. **커밋은 하지 마라.**
