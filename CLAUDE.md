# RefBoard — 작업 규칙

레퍼런스(이미지 링크 + 키워드)를 모아 케이스 스터디 문서로 만드는 팀용 웹 서비스.
React 19 + Vite (`src/`) · Express + node:sqlite (`server/`) · 공용 타입과 병합 (`shared/`) · vitest (`tests/`).
자세한 구조와 실행 방법은 README.md, 배포는 DEPLOY.md.

## 업데이트 기록 (반드시 지킬 것)

**코드를 수정해 커밋할 때마다 CHANGELOG.md에 항목을 추가하고 버전을 올린다.**

- 버전은 `package.json`의 `version` 하나다. `npm version <새 버전> --no-git-tag-version`으로 올리면 package-lock.json도 같이 바뀐다.
- 새 기능 · 눈에 띄는 변화는 가운데 자리(0.8.0 → 0.9.0), 고침 · 다듬기 · 내부 정리는 끝자리(0.8.0 → 0.8.1)를 올린다.
- CHANGELOG.md 맨 위(`# 업데이트 기록` 소개 바로 아래)에 새 항목을 넣는다. 형식:

  ```
  ## 0.8.1 — 2026-09-30
  ### 한 줄 요약 (사용자에게 무엇이 좋아졌는지)
  - 바뀐 점을 사용자가 이해할 쉬운 말로. 내부 이름 · 파일 이름 · 기술 용어는 쓰지 않는다
  ```

- 이 파일은 앱의 '업데이트 소식'(레퍼런스 화면 왼쪽 아래, 프로필 메뉴 → 업데이트 기록)에 그대로 보인다.
- `npm test`의 `tests/changelog.test.ts`가 package.json 버전과 CHANGELOG 맨 위 버전이 같은지, 버전 · 날짜 순서가 맞는지 확인한다. 둘 중 하나만 바꾸면 테스트가 실패한다.
- 문서(README 등)만 고친 커밋은 항목을 추가하지 않아도 된다.

## 그 밖의 약속

- 커밋 전에 `npx tsc --noEmit -p .`, `npm test`, `npm run build`가 모두 통과해야 한다.
- 비밀 값(ANTHROPIC_API_KEY, SMTP_PASS 등)은 코드나 render.yaml에 적지 않는다 (`sync: false`).
- 비밀번호는 브라우저에 저장하지 않는다. '아이디 기억하기'는 메일 주소만 저장한다.
- 변경 요청은 CSRF 헤더(`x-refboard`)를 거치고, 이미지 주소는 http(s)만 받는다.
- 화면 문구는 쉬운 해요체.
- 색 · 글꼴 · 크기 · 간격 · 모서리 · 그림자는 `src/styles.css`에 값을 직접 쓰지 않고 `src/tokens.css`의 토큰(`var(--…)`)만 쓴다. 새 토큰은 `tokens.json`(원본)에 추가하고 `npm run tokens`로 CSS를 다시 만든다 — 그림자 · z-index는 tokens.css 아래쪽에 직접. 자세한 규칙은 docs/design-tokens.md.
