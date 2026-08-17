# GitHub Pages Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `main`의 검증된 KickMate Vite 빌드를 `https://winteri5coming.github.io/KickMate/`에 자동 배포한다.

**Architecture:** Vite가 모든 빌드 자산에 `/KickMate/` base를 붙인다. 기존 CI는 그대로 두고 별도의 Pages 워크플로가 검사·빌드한 `dist` artifact만 `github-pages` 환경에 배포한다.

**Tech Stack:** Vite 6, TypeScript, npm, GitHub Actions, GitHub Pages

## Global Constraints

- Pages 운영 경로는 정확히 `/KickMate/`다.
- Node.js는 저장소의 `engines.node >=22.6.0`을 만족하는 24를 사용한다.
- 배포 전에 `npm run check`와 `npm run build`를 모두 통과해야 한다.
- 배포 artifact는 `dist`만 포함한다.
- 기존 `.github/workflows/ci.yml`과 `reference/prototype.html`은 수정하지 않는다.
- 커밋 메시지는 한국어로 작성한다.

---

## File Structure

| 파일 | 변경 | 책임 |
|---|---|---|
| `vite.config.ts` | 생성 | GitHub Pages 프로젝트 경로를 Vite base로 지정 |
| `.github/workflows/deploy-pages.yml` | 생성 | main 검사·빌드·artifact 업로드·Pages 배포 |
| `docs/superpowers/specs/2026-08-17-github-pages-design.md` | 기존 신규 문서 | 승인된 배포 설계 기록 |
| `docs/superpowers/plans/2026-08-17-github-pages-deployment.md` | 신규 문서 | 실행 단계와 검증 기록 |

---

### Task 1: Vite GitHub Pages base 설정

**Files:**
- Create: `vite.config.ts`
- Verify generated: `dist/index.html`

**Interfaces:**
- Consumes: GitHub 저장소 이름 `KickMate`
- Produces: Vite `UserConfig`의 `base: "/KickMate/"`

- [x] **Step 1: 현재 빌드 자산 경로가 Pages 경로를 누락하는지 확인**

Run:

```powershell
Select-String -Path dist/index.html -Pattern 'src="/assets/'
```

Expected: 현재 빌드가 `src="/assets/..."`를 포함한다. 이 경로는
`https://winteri5coming.github.io/KickMate/`에서 저장소 접두사를 누락한다.

- [x] **Step 2: 최소 Vite 설정 작성**

Create `vite.config.ts`:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  base: "/KickMate/",
});
```

- [x] **Step 3: 정적 검사 실행**

Run:

```powershell
npm run check
```

Expected: TypeScript, 전체 Vitest, content 검증 PASS.

- [x] **Step 4: 프로덕션 빌드와 자산 경로 확인**

Run:

```powershell
npm run build
Select-String -Path dist/index.html -Pattern 'src="/KickMate/assets/'
```

Expected: Vite build exit 0, 생성된 script 경로가 `/KickMate/assets/`로 시작한다.
관리 환경에서 `spawn EPERM`이면 사용자 터미널에서 같은 두 명령을 실행해 확인한다.

- [x] **Step 5: Task 1 커밋**

```powershell
git add -- vite.config.ts
git commit -m "chore: GitHub Pages용 Vite 경로 설정"
```

Expected: 설정 파일만 포함한 커밋 1개.

---

### Task 2: GitHub Pages 배포 워크플로

**Files:**
- Create: `.github/workflows/deploy-pages.yml`
- Verify unchanged: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `npm ci`, `npm run check`, `npm run build`, `dist`
- Produces: GitHub Pages artifact와 `github-pages` deployment URL

- [x] **Step 1: Pages 워크플로 작성**

Create `.github/workflows/deploy-pages.yml`:

```yaml
name: Deploy GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - name: Set up Node
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
        with:
          node-version: 24
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Check
        run: npm run check
      - name: Build
        run: npm run build
      - name: Configure Pages
        uses: actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d # v6
      - name: Upload artifact
        uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5
        with:
          path: ./dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128 # v5
```

- [x] **Step 2: YAML 구조와 기존 CI 미변경 확인**

Run:

```powershell
git diff --check
git diff --exit-code -- .github/workflows/ci.yml
```

Expected: 공백 오류 0개, 기존 CI diff 없음.

- [x] **Step 3: 전체 로컬 검증**

Run:

```powershell
npm run check
npm run build
git diff --exit-code -- reference/prototype.html
```

Expected: check와 build exit 0, `prototype.html` diff 없음.

- [x] **Step 4: 설계·계획·워크플로 커밋**

```powershell
git add -- .github/workflows/deploy-pages.yml docs/superpowers/specs/2026-08-17-github-pages-design.md docs/superpowers/plans/2026-08-17-github-pages-deployment.md
git commit -m "ci: GitHub Pages 자동 배포 구성"
```

Expected: 배포 워크플로와 승인된 문서만 포함한 커밋 1개.

---

### Task 3: GitHub 설정과 외부 배포 검증

**Files:**
- No local file changes
- External: GitHub repository Settings, Actions, Pages URL

**Interfaces:**
- Consumes: `origin/main`의 Task 1~2 커밋
- Produces: 공개 KickMate Pages URL

- [x] **Step 1: 로컬 커밋을 GitHub에 push**

```powershell
git push origin main
```

Expected: `origin/main`이 로컬 `main`과 같은 커밋을 가리킨다.

- [x] **Step 2: GitHub Pages Source 설정**

GitHub 저장소에서 다음 메뉴를 연다.

```text
Settings → Pages → Build and deployment → Source → GitHub Actions
```

Expected: Pages Source가 GitHub Actions로 표시된다.

- [x] **Step 3: Actions 결과 확인**

GitHub의 `Actions` 탭에서 `Deploy GitHub Pages` 실행을 연다.

Expected:

```text
build  성공
deploy 성공
```

실패하면 실패한 step의 전체 로그를 보존하고 다음 step으로 진행하지 않는다.

- [x] **Step 4: 외부 URL 실제 플레이 확인**

Open:

```text
https://winteri5coming.github.io/KickMate/
```

확인 순서:

1. 페이지 새로고침 후 초기 화면이 열린다.
2. 게임 시작 버튼으로 home 차례가 시작된다.
3. home 기물을 선택하면 가능한 행동 버튼이 보인다.
4. 한 수를 두면 Worker 봇이 응수한다.
5. Console과 Network에 404 또는 Worker 로딩 오류가 없다.

- [x] **Step 5: 배포 완료 상태 기록**

`docs/current-state.md`의 GitHub Pages 상태를 완료로 바꾸고 실제 URL과 확인 날짜를 기록한다.

Run:

```powershell
npm run check
git diff --check
```

Expected: 모든 검사 PASS. 문서 변경은 이후 한국어 문서 커밋으로 별도 보존한다.
