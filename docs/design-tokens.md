# 디자인 토큰

앱 화면(문서 A4 페이지 제외)의 색 · 글꼴 · 크기 · 간격 · 모서리 · 그림자는 모두 토큰으로 관리한다.

| 파일 | 역할 |
| --- | --- |
| [`tokens.json`](../tokens.json) | **원본.** W3C Design Tokens(DTCG) 형식 — 컬러 · 타이포 · 간격 · 모서리 · 크기 그룹. Figma Variables로 가져온다 |
| [`src/tokens.css`](../src/tokens.css) | CSS 변수 파일 하나. 위쪽은 tokens.json에서 생성(`npm run tokens`), 아래쪽은 그림자 · z-index처럼 Figma 변수로 옮길 수 없는 값 |
| [`src/styles.css`](../src/styles.css) | 화면 스타일. 값은 직접 쓰지 않고 `var(--…)`만 쓴다 |

- 값을 바꿀 때: `tokens.json` 수정 → `npm run tokens` → 화면 확인. 그림자 · z-index는 `src/tokens.css` 아래쪽을 직접 고친다.
- `tests/tokens.test.ts`가 ① 생성 구간이 tokens.json과 같은지 ② styles.css에 색 · 글자 크기 · 굵기 · 간격 · 모서리 · 그림자 · z-index 값이 직접 들어가지 않았는지 ③ 쓰는 변수가 모두 정의돼 있는지 확인한다.

## 이름 규칙

tokens.json 경로를 `-`로 이은 것이 CSS 변수 이름이다.

| tokens.json | CSS 변수 | 값 |
| --- | --- | --- |
| `color.grey.100` | `--color-grey-100` | `#f2f4f6` |
| `color.text.default` | `--color-text` (`default` 생략) | `var(--color-grey-900)` |
| `color.overlay.72` | `--color-overlay-72` | `#191f28b8` → `rgba(25, 31, 40, 0.72)` |
| `typography.font-size.12-5` | `--font-size-12-5` | `12.5` → `12.5px` |
| `typography.line-height.150` | `--line-height-150` | `150`(%) → `1.5` |
| `typography.letter-spacing.snug` | `--letter-spacing-snug` | `-1`(%) → `-0.01em` |
| `spacing.8` | `--space-8` | `8` → `8px` |
| `radius.full` | `--radius-full` | `999` → `999px` |
| `size.control-md` | `--size-control-md` | `38` → `38px` |

- 원시 색(`blue` · `grey` …)과 역할 색(`bg` · `surface` · `border` · `text` · `accent` …)을 나눴다. 역할 색은 원시 색을 가리키는 별칭이라, 원시 색만 바꾸면 따라 바뀐다.
- 숫자는 Figma 변수(Number)로 그대로 들어가도록 단위 없이 적었다: 간격 · 모서리 · 크기 · 글자 크기 = px, 행간 · 자간 = %.
- 이전 변수 이름은 새 이름으로 바꿨다: `--grey-100` → `--color-grey-100`, `--panel` → `--color-surface`, `--line` → `--color-border`, `--text-2` → `--color-text-secondary`, `--muted` → `--color-text-muted`, `--faint` → `--color-text-faint`, `--radius` → `--radius-12`, `--shadow` → `--shadow-card`, `--shadow-lg` → `--shadow-modal`, `--ring` → `--shadow-focus-ring`.

## Figma로 옮기기

`tokens.json`은 DTCG 형식(`$type` · `$value` · `$description`, 별칭 `{color.grey.100}`)이라, DTCG JSON을 읽는 Figma 변수 가져오기나 Tokens Studio 같은 플러그인으로 불러올 수 있다. 최상위 그룹이 `color` / `typography` / `spacing` / `radius` / `size`로 나뉘어 있어 컬렉션 · 그룹을 그대로 만들 수 있다.

- 그림자는 Figma에서 변수가 아니라 Effect 스타일이라 JSON에 넣지 않았다 — `src/tokens.css`의 `--shadow-*` 값을 보고 Effect 스타일로 만든다.
- 동그라미 모서리(`--radius-circle: 50%`)도 Figma 변수로 옮길 수 없어 CSS에만 있다.

## 조사 결과 (토큰으로 바꾸기 전 styles.css)

| 종류 | 교체 전 | 토큰 |
| --- | --- | --- |
| 색 | 직접 쓴 색 56가지 · 157곳 + 기존 변수 42개(팔레트 25 · 역할 17) | 컬러 94개 (원시 77 · 역할 별칭 17) |
| 글꼴 | 글꼴 목록 2가지(본문 Pretendard, 숫자 · 코드용 모노) | `font-family` 2개 |
| 글자 크기 | 23가지 · 194곳 (9 ~ 44px) | `font-size` 23개 |
| 굵기 | 5가지 · 102곳 | `font-weight` 5개 (regular ~ extrabold) |
| 행간 | 11가지 · 38곳 | `line-height` 9개 (px로 적힌 2곳은 부품 전용이라 그대로) |
| 자간 | 5가지 · 7곳 | `letter-spacing` 5개 |
| 간격(패딩 · 마진 · gap) | 36가지 · 653곳 (음수 5가지 포함) | `spacing` 31개 (음수는 `calc(var(--space-4) * -1)`) |
| 모서리 | 17가지 · 163곳 | `radius` 16개 + `circle` |
| 컨트롤 높이 | 버튼 32 / 38 / 52px, 입력 칸 36px | `size` 4개 (이후 토글 스위치 40×24 · 손잡이 20, 모바일 터치 44 · 하단 탭 60, 프로필 지름 5개 · 크롭 280 추가 → 15개) |
| 그림자 | 40가지 · 56곳 | `--shadow-*` 38개 |
| 쌓임 순서(z-index) | 10가지 | `--z-*` 10개 |

바꾼 뒤 로그인 · 레퍼런스 · 태그 · 케이스 · 문서 · 편집기(요소 · 문서 양식 · 타이포 · 메뉴 · 보관함) · 팀 · 계정 · 가이드 · 의견 · 업데이트 기록 · 관리자 · 웹 뷰어 등 27개 화면에서 모든 요소의 계산된 스타일(색 · 글꼴 · 여백 · 모서리 · 그림자 · 크기 · 위치)을 교체 전과 비교해 차이가 없음을 확인했다(문서 카드의 저장 시각 글자만 달라 줄바꿈이 생긴 1곳 제외).

## 프로필 팔레트 · 크기 (0.12.0 추가)

- `color.profile.<키>`(진한 색, `--color-profile-<키>`)와 `color.profile.<키>.soft`(연한 색, `--color-profile-<키>-soft`) 12쌍 — 빨강 · 주황 · 노랑 · 연두 · 초록 · 청록 · 하늘 · 파랑 · 남색 · 보라 · 자주 · 분홍. 진한 색은 흰 글자(팀 기본 이미지)가 읽히는 밝기로 골랐다.
  - 키 목록은 `shared/profile.ts` 의 `PROFILE_COLORS` 와 같아야 한다 (`tests/profile.test.ts` 가 확인). DB 에는 색 값이 아니라 키만 저장하고, 화면은 `profileColorVar()` · `profileSoftVar()` 로 칠한다.
  - 진한 색은 **사용자 고유 색**이기도 하다 — 접속자 테두리, 이후 공동 작업의 선택 테두리 · 깃발 · 히스토리가 같은 토큰을 쓴다.
- `size.avatar-xs/sm/md/lg/xl`(22 · 28 · 32 · 44 · 96) — 프로필 이미지 지름, `size.crop`(280) — 원형 크롭 미리보기 지름.
- 그림자 `--shadow-crop-mask`(tokens.css 아래쪽) — 크롭 원 밖을 어둡게.

## 다음 업데이트 때 정리할 후보

화면을 그대로 두려고 지금은 값을 모두 살렸다. 새 디자인에서 줄이면 좋은 것들:

- **글자 크기** 23단계 → 0.5px 간격 값(10.5 · 11.5 · 12.5 · 13.5 · 14.5 · 15.5)을 정수로 합치면 12단계 안팎.
- **간격** 31단계 → 4의 배수(4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64) 중심으로. 1 · 3 · 5 · 7 · 9 · 11 · 46 · 90처럼 한두 곳만 쓰는 값은 가까운 값으로.
- **모서리** 16단계 → 4 · 8 · 12 · 16 · 24 · full 정도.
- **그림자** 38개 → 대부분 한 곳씩만 쓴다. 높이 단계(raised · card · popover · modal) 4개 + 테두리형(inset) 몇 개로.
- **회색** `grey-125` · `grey-150`은 `grey-100`과 `grey-200` 사이의 비슷한 값 — 하나로.
- **노랑 · 주황** 글자색(TIP 버튼 · 안내 · 경고)이 6가지 — 경고/안내 역할 색 2~3개로.
- **투명도 색** `overlay-*` 7단계(25 ~ 78%)와 `blue-alpha-*` 7단계 → 각각 3단계 정도로.
