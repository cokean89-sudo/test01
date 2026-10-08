# RefBoard — 작업 규칙

레퍼런스(이미지 링크 + 키워드)를 모아 케이스 스터디 문서로 만드는 팀용 웹 서비스.
React 19 + Vite (`src/`) · Express + node:sqlite (`server/`) · 공용 타입과 병합 (`shared/`) · vitest (`tests/`).
자세한 구조와 실행 방법은 README.md, 배포는 DEPLOY.md.

## 업데이트 기록 (반드시 지킬 것)

**커밋마다 CHANGELOG.md에 개발 기록을 남기고, 사용자에게 보이는 기능 변화가 있을 때만 고객용 소식(RELEASE_NOTES.md)을 아래 규칙에 맞춰 추가한다.**

기록은 두 가지다.

| 파일 | 누가 보나 | 언제 쓰나 |
| --- | --- | --- |
| `CHANGELOG.md` | 개발 기록 — 앱에 싣지 않는다 | 코드를 고친 커밋마다 (버전도 함께 올린다) |
| `RELEASE_NOTES.md` | 고객용 소식 — 앱의 '업데이트 소식'(레퍼런스 화면 왼쪽 아래, 프로필 메뉴 → 업데이트 기록, 내 계정 → 앱 정보)이 이 파일만 읽는다 | 사용자에게 보이는 변화가 있을 때만 |

### 버전 · 개발 기록 (CHANGELOG.md)

- 버전은 `package.json`의 `version` 하나다. `npm version <새 버전> --no-git-tag-version`으로 올리면 package-lock.json도 같이 바뀐다.
- 새 기능 · 눈에 띄는 변화는 가운데 자리(0.8.0 → 0.9.0), 고침 · 다듬기 · 내부 정리는 끝자리(0.8.0 → 0.8.1)를 올린다.
- CHANGELOG.md 맨 위(`# 업데이트 기록` 소개 바로 아래)에 새 항목을 넣는다. 무엇을 왜 바꿨는지 자세히 쓴다 (설정 이름 · 동작 순서 등 운영에 필요한 내용 포함). 형식:

  ```
  ## 0.8.1 — 2026-09-30
  ### 한 줄 요약
  - 바뀐 점을 자세히
  ```

- `tests/changelog.test.ts`가 package.json 버전과 CHANGELOG 맨 위 버전이 같은지, 버전 · 날짜 순서가 맞는지 확인한다. 둘 중 하나만 바꾸면 테스트가 실패한다.
- 문서(README 등)만 고친 커밋은 항목을 추가하지 않아도 된다.

### 고객용 소식 (RELEASE_NOTES.md)

- 형식은 CHANGELOG와 같다 (`## 버전 — 날짜` / `### 제목` / `- 설명`). 버전 · 날짜는 CHANGELOG의 같은 버전과 맞춘다.
- 새 기능과 눈에 띄는 개선만 쓴다. 제목 1줄 + 설명 1~3줄.
- 자잘한 버그 수정은 "사용성과 안정성을 개선했어요" 한 줄로 묶는다 (버그 수정만 있는 버전은 이 문장을 제목으로만 쓴다).
- 내부 준비 작업, 서버 · 저장소 · 보안 구조, 디자인 도구 연동, 아직 공개하지 않은 기능은 노출하지 않는다.
- 서버, R2, HTML, 토큰 같은 기술 용어 대신 사용자 입장의 쉬운 말로 쓴다.
- 사용자에게 보이는 변화가 없는 버전은 소식을 올리지 않는다.
- `tests/releaseNotes.test.ts`가 형식 · 줄 수 · 쓰면 안 되는 말 · CHANGELOG와의 버전 · 날짜를 확인한다.

## 그 밖의 약속

- 커밋 전에 `npx tsc --noEmit -p .`, `npm test`, `npm run build`가 모두 통과해야 한다.
- 비밀 값(ANTHROPIC_API_KEY, SMTP_PASS 등)은 코드나 render.yaml에 적지 않는다 (`sync: false`).
- 비밀번호는 브라우저에 저장하지 않는다. '아이디 기억하기'는 메일 주소만 저장한다.
- 변경 요청은 CSRF 헤더(`x-refboard`)를 거치고, 이미지 주소는 http(s)만 받는다.
- 화면 문구는 쉬운 해요체.
- 프로필 기본 이모지는 Microsoft Fluent Emoji 3D(MIT)만 쓴다 (`public/emoji/`, 라이선스 전문 함께). 애플 이모지 이미지는 라이선스 문제로 쓰지 않는다.
- 프로필 이미지는 `src/components/Avatar.tsx`(UserAvatar · TeamAvatar)로만 보여 주고, 사용자 고유 색은 `profileColorVar()`(shared/profile.ts)로 쓴다.
- 문서 내용은 편집기에서 `useEditor().update()`로만 바꾼다 (안에서 Y.Doc 에 바뀐 곳만 쓴다). 서버에서 바꿀 때는 `CollabHub.applyContent`를 거친다 — 원본은 `documents.ydoc`이라 `data_json`만 직접 고치면 무시되거나 열려 있는 문서 방이 덮어쓴다. 실시간 공동 편집 구조는 README '실시간 공동 작업' · DEPLOY.md 5-E.
- 색 · 글꼴 · 크기 · 간격 · 모서리 · 그림자는 `src/styles.css`에 값을 직접 쓰지 않고 `src/tokens.css`의 토큰(`var(--…)`)만 쓴다. 새 토큰은 `tokens.json`(원본)에 추가하고 `npm run tokens`로 CSS를 다시 만든다 — 그림자 · z-index는 tokens.css 아래쪽에 직접. 자세한 규칙은 docs/design-tokens.md.
