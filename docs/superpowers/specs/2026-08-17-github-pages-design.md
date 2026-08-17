# KickMate GitHub Pages 배포 설계

작성일: 2026-08-17

## 목표

`main` 브랜치의 검증된 Vite 빌드 결과를 GitHub Pages에 무료로 배포한다.
운영 주소는 다음 프로젝트 사이트 경로를 사용한다.

```text
https://winteri5coming.github.io/KickMate/
```

## Vite 경로

저장소 이름을 포함한 절대 base를 사용한다.

```ts
import { defineConfig } from "vite";

export default defineConfig({
  base: "/KickMate/",
});
```

이 설정은 빌드된 HTML의 JS·Worker 자산 주소를 `/assets/...`가 아니라
`/KickMate/assets/...`로 만든다. 저장소 이름이나 호스팅 위치가 바뀌면 base도 함께
바꿔야 한다.

## 자동 배포 흐름

기존 `.github/workflows/ci.yml`은 검사 전용으로 유지한다. Pages 배포는 별도의
`.github/workflows/deploy-pages.yml`이 담당한다.

```text
main push 또는 수동 실행
  → 저장소 checkout
  → Node 설치와 npm 캐시 복원
  → npm ci
  → npm run check
  → npm run build
  → dist를 Pages artifact로 업로드
  → github-pages 환경에 배포
```

배포 job에는 `pages: write`, `id-token: write` 권한을 주고 build job이 성공한 뒤에만
실행한다. 동시 배포는 하나만 유지해 오래된 실행이 최신 결과를 덮어쓰지 않게 한다.

## 실패 처리

- `npm run check` 또는 `npm run build`가 실패하면 artifact를 배포하지 않는다.
- Pages 권한이나 Source 설정이 잘못되면 Actions 실행을 실패 상태로 남긴다.
- 배포 실패를 숨기는 별도 fallback은 두지 않고 Actions 로그에서 원인을 확인한다.
- `reference/prototype.html`은 빌드 입력이나 배포 설정을 위해 수정하지 않는다.

## 검증 기준

1. 로컬 `npm run check`가 통과한다.
2. 사용자 환경의 `npm run build`가 통과한다.
3. `dist/index.html`이 `/KickMate/assets/` 경로를 사용한다.
4. GitHub Actions의 build와 deploy job이 모두 성공한다.
5. 외부 Pages URL에서 게임 시작, 사용자 수, Worker 봇 응수를 확인한다.
6. 새로고침 후에도 같은 URL이 정상적으로 열린다.

## 범위 밖

- 사용자 도메인 연결
- 배포 미리보기 환경
- 서버 API와 데이터베이스
- Pages에서의 런타임 환경 변수
