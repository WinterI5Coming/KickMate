# KickMate — 축구의 chess.com

교대 턴제 축구 보드게임 + 자체 엔진 기반 분석(최적수·블런더·승률).
OpenAI Game Builders Seoul 해커톤 출품작 (Track 1 제출: 2026-08-26, 웹 빌드).

## 게임 모드 (우선순위 순)

1. **봇전** — 엔진과 대국, 경기 후 블런더 리뷰 (게임의 본체)
2. **핫시트 2인** — 한 기기에서 번갈아 두기
3. **퍼즐** — "N턴 안에 골" (온보딩)
4. 온라인 대전 — 로드맵

## 시작하기

```bash
npm install
npm run dev      # 개발 서버 (브라우저로 열림)
npm run check    # 타입체크 + 테스트 + content 검증 — 이게 초록이면 안전
```

## 구조

| 폴더 | 내용 | 주로 만지는 사람 |
|---|---|---|
| `src/engine/` | 순수 TS 엔진 — 룰·탐색·평가 (무작위 없음, 결정론) | 개발 리드 |
| `src/worker/` | 엔진의 Web Worker 어댑터 | 개발 리드 |
| `src/client/` | Canvas 렌더·입력·분석 UI | 개발 리드 (+소품은 누구나) |
| `content/` | **JSON 콘텐츠 — 퍼즐, 기물 수치, 문구, 테마** | **팀 전원** |
| `tools/` | 셀프플레이 하네스, content 검증기 | 개발 리드 |
| `data/` | Python — xT·선수 원형 추출 (런타임 미포함, 예정) | 개발 리드 |

## 비개발자 참여 가이드

`content/`의 JSON이 여러분의 작업 공간입니다. 코드를 깨뜨릴 걱정 없이:

1. 브랜치를 만든다 (`git switch -c puzzle/내-퍼즐`)
2. Codex에게 시킨다 — 예: *"content/puzzles/pack-001.json 형식을 보고 '2턴 안에 골' 퍼즐 3개를 새 파일로 만들어줘"*
3. `npm run check`를 돌린다 (Codex에게 "check 돌리고 빨간불 고쳐줘"라고 해도 됨)
4. 초록불이면 PR을 올린다 — CI가 한 번 더 확인해 준다

만질 수 있는 것: `content/puzzles/`(퍼즐), `content/pieces.json`(기물 밸런스 — 바꾸면 `npm run selfplay`로 승률 변화 확인), `content/strings.json`(모든 문구), `content/theme.json`(색).

## 규칙

- **Codex 활용은 해커톤 규정상 필수** — 작업 시 Codex 사용 기록(세션·커밋)을 남긴다
- `main` 직접 푸시 금지, PR + CI 초록 후 머지
- 엔진은 순수 모듈 유지 — DOM·Worker 의존 금지 (셀프플레이가 같은 코드를 씀)
