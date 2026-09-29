# Render 배포 가이드

GitHub 저장소를 Render 에 연결하면 `render.yaml`(Blueprint) 설정대로 RefBoard 웹 서비스가 만들어집니다.
Docker 없이 Node 22 런타임으로 실행되고, 데이터(SQLite)는 영구 디스크에 저장되어 재배포해도 남습니다.

| 항목 | 값 |
| --- | --- |
| 런타임 | Node 22 (`NODE_VERSION=22`, `.node-version`) |
| 인스턴스 | Starter (가장 저렴한 유료 인스턴스) |
| 리전 | Singapore (한국에서 가장 가까운 리전 — 서비스를 만든 뒤에는 바꿀 수 없어요) |
| 빌드 / 시작 | `npm ci && npm run build` / `npm start` |
| 헬스 체크 | `/api/health` |
| 영구 디스크 | `/var/data` 1GB → `DATA_DIR=/var/data` (나중에 늘릴 수는 있지만 줄일 수는 없어요) |

> 요금은 Render 요금표를 확인하세요. Starter 인스턴스 요금에 디스크 용량(GB)당 요금이 더해집니다.

---

## 1. 배포 순서

1. **코드를 배포할 브랜치에 올리기** — Blueprint 는 한 브랜치를 따라갑니다. 보통 `main` 에 합친 뒤 연결하세요.
2. [Render 대시보드](https://dashboard.render.com) → **New +** → **Blueprint** 를 누릅니다.
3. GitHub 계정을 연결하고 이 저장소를 고릅니다. 저장소 루트의 `render.yaml` 을 자동으로 읽어요.
4. 만들어질 서비스(`refboard`, Starter, 디스크 1GB)를 확인합니다.
5. **환경변수 입력 칸**이 나옵니다 (`render.yaml` 에서 `sync: false` 로 둔 비밀값). 아래 [2-B 표](#2-b-render-화면에서-입력할-값-sync-false)를 보고 채우세요.
   필요 없는 항목(예: 소셜 로그인을 안 쓰면 카카오·네이버 키)은 비워 두면 됩니다.
6. **Apply** → 첫 빌드와 배포에 몇 분 걸립니다. 완료되면 `https://refboard.onrender.com` 같은 주소가 생겨요.
   (이름이 이미 쓰이고 있으면 뒤에 임의 문자가 붙습니다 — 서비스 화면 상단에서 확인)
7. 그 주소로 들어가 **관리자 계정부터 가입**하세요. `FEEDBACK_EMAIL`(또는 `ADMIN_EMAILS`)과 같은 메일로 가입하고
   메일 인증을 마치면 프로필 메뉴에 **받은 의견 (관리자)** 가 보입니다.

이후에는 연결한 브랜치에 `git push` 할 때마다 자동으로 다시 빌드·배포됩니다.

> `sync: false` 값은 **Blueprint 를 처음 만들 때만** 입력 칸이 나옵니다.
> 나중에 바꾸거나 추가하려면 서비스 → **Environment** 탭에서 수정하고 저장하세요 (저장하면 자동으로 재시작).

---

## 2. 환경변수

### 2-A. `render.yaml` 이 자동으로 넣는 값 (입력할 필요 없음)

| 변수 | 값 | 의미 |
| --- | --- | --- |
| `NODE_VERSION` | `22` | Node.js 버전. 내장 SQLite 를 쓰려면 22 이상이 필요해요 |
| `HOST` | `0.0.0.0` | 외부(Render 로드밸런서)에서 접속할 수 있도록 모든 주소에서 대기 |
| `DATA_DIR` | `/var/data` | 데이터베이스 저장 폴더 = 영구 디스크 경로. 바꾸면 데이터가 재배포 때 사라져요 |
| `TRUST_PROXY` | `1` | Render 로드밸런서 1단계 뒤에서 실행 — 사용자 실제 IP 로 요청 제한·보안 로그를 남기기 위해 필요 |
| `PORT` | Render 가 지정 | 서버 포트. Render 가 자동으로 넣어 줍니다 (직접 넣지 마세요) |
| `RENDER_EXTERNAL_URL` | Render 가 지정 | 서비스 기본 주소. `APP_URL` 을 비우면 이 주소를 씁니다 |

### 2-B. Render 화면에서 입력할 값 (`sync: false`)

| 변수 | 필요 여부 | 의미 | 예시 |
| --- | --- | --- | --- |
| `APP_URL` | 선택 | 사용자가 접속하는 공개 주소. 비우면 `https://<서비스이름>.onrender.com` 을 자동 사용. **내 도메인을 연결했을 때만** 입력하세요. 메일 링크·소셜 로그인 콜백·요청 출처 검사·쿠키 보안에 쓰여요 | `https://refboard.example.com` |
| `ANTHROPIC_API_KEY` | 권장 | Claude API 키. 없으면 AI 글쓰기는 규칙 기반 초안만, AI 태그 제안은 'AI 연결 후 사용 가능' 안내만 나와요. [Anthropic Console](https://console.anthropic.com) → API Keys 에서 발급 | `sk-ant-...` |
| `SMTP_HOST` | **사실상 필수** | 메일 서버 주소. 가입 인증·비밀번호 재설정·팀 초대·의견 메일에 쓰여요. 비우면 메일이 나가지 않아 **새 사용자가 메일 인증을 할 수 없어요** (링크는 Render Logs 에만 찍힘) | `smtp.gmail.com` |
| `SMTP_USER` | SMTP 쓸 때 필수 | 메일 계정 아이디 | `refboard.noreply@gmail.com` |
| `SMTP_PASS` | SMTP 쓸 때 필수 | 메일 비밀번호. Gmail 은 **2단계 인증을 켠 뒤 만든 앱 비밀번호(16자리)** 를 넣어야 해요 | `abcd efgh ijkl mnop` |
| `MAIL_FROM` | 선택 | 받는 사람에게 보이는 보낸 사람. 비우면 `SMTP_USER` | `RefBoard <refboard.noreply@gmail.com>` |
| `KAKAO_CLIENT_ID` | 선택 | 카카오 로그인 — Kakao Developers → 내 애플리케이션 → 앱 키의 **REST API 키** | `1a2b3c...` |
| `KAKAO_CLIENT_SECRET` | 선택 | 카카오 로그인 → 보안 → **Client Secret** (사용 설정 '사용함') | |
| `NAVER_CLIENT_ID` | 선택 | 네이버 로그인 — NAVER Developers → 내 애플리케이션 → **Client ID** | |
| `NAVER_CLIENT_SECRET` | 선택 | 같은 화면의 **Client Secret** | |
| `FEEDBACK_EMAIL` | 선택 | '의견 보내기' 내용을 받을 메일. 비우면 `cokean89@gmail.com` | `cokean89@gmail.com` |
| `ADMIN_EMAILS` | 선택 | 받은 의견 목록(`#/admin/feedback`)을 볼 수 있는 계정 메일, 쉼표로 여러 개. 비우면 `FEEDBACK_EMAIL`. 메일 인증을 마친 계정만 관리자로 인정돼요 | `a@team.com,b@team.com` |

### 2-C. 필요할 때만 Environment 탭에서 추가하는 값

| 변수 | 기본값 | 의미 |
| --- | --- | --- |
| `SMTP_PORT` | `587` | 메일 서버 포트. 네이버 메일처럼 465 를 쓰면 `465` |
| `SMTP_SECURE` | 포트가 465 면 켜짐 | SSL 로 바로 접속할지 (`true`/`false`). 587 은 STARTTLS 로 자동 암호화 |
| `ALLOW_SIGNUP` | `true` | `false` 면 메일 가입을 막고 초대받은 사람·소셜 로그인만 허용 |
| `SIGNUP_EMAIL_DOMAINS` | 제한 없음 | 가입 가능한 메일 도메인 (쉼표 구분). 예: `shinsegae.com,emart.com` |
| `SESSION_DAYS` | `14` | '로그인 상태 유지'를 켰을 때, 마지막 활동 후 며칠 동안 로그인 유지 |
| `SESSION_MAX_DAYS` | `30` | '로그인 상태 유지'를 켰을 때 최대 수명(일). 끄고 로그인하면 브라우저를 닫을 때 로그아웃 |
| `CLAUDE_WRITING_MODEL` | `claude-opus-5-5` | AI 글쓰기(타이틀·설명·캡션)에 쓸 모델 |
| `CLAUDE_TAG_MODEL` | `claude-haiku-4-5` | AI 태그 제안처럼 가벼운 작업에 쓸 모델 |
| `DISABLE_AI` | 꺼짐 | `1` 이면 API 키가 있어도 AI 기능을 끔 |

### 2-D. 넣으면 안 되는 값

| 변수 | 이유 |
| --- | --- |
| `NODE_ENV=production` | `npm ci` 가 빌드 도구(vite)를 설치하지 않아 **빌드가 실패**해요. 운영 모드는 `npm start`(`--prod`)로 이미 켜집니다 |
| `ALLOW_PRIVATE_FETCH` | 켜면 링크 스크랩으로 서버 내부망에 접근할 수 있게 돼요 (SSRF). 공개 서버에서는 절대 켜지 마세요 |
| `PORT` | Render 가 정한 포트와 달라지면 헬스 체크가 실패해요 |

---

## 3. 소셜 로그인 콜백 주소 등록

소셜 로그인을 쓰면 각 개발자 콘솔에 아래 주소를 **정확히** 등록하세요. `<주소>` 는 `APP_URL`(비웠다면 onrender.com 주소)입니다.
(콘솔 메뉴 이름은 각 사 개편에 따라 조금 다를 수 있어요.)

| 서비스 | 등록할 곳 | 값 |
| --- | --- | --- |
| 카카오 | 내 애플리케이션 → 플랫폼 → Web → 사이트 도메인 | `<주소>` |
| 카카오 | 카카오 로그인 → Redirect URI | `<주소>/api/auth/oauth/kakao/callback` |
| 카카오 | 카카오 로그인 → 동의항목 | 닉네임, 카카오계정(이메일) |
| 네이버 | 애플리케이션 → API 설정 → 서비스 URL | `<주소>` |
| 네이버 | 애플리케이션 → API 설정 → Callback URL | `<주소>/api/auth/oauth/naver/callback` |
| 네이버 | 애플리케이션 → 제공 정보 | 이름(또는 별명), 이메일 |

공식 로그인 버튼 심볼 파일을 쓰려면 `public/brand/README.md` 를 보세요 (파일을 넣고 push 하면 다시 빌드될 때 적용).

## 4. 내 도메인 연결 (선택)

1. 서비스 → **Settings → Custom Domains** 에 도메인 추가 → 안내대로 DNS(CNAME) 설정. HTTPS 인증서는 Render 가 자동 발급해요.
2. **Environment** 에 `APP_URL=https://내도메인` 추가.
3. 소셜 로그인 콘솔의 사이트 주소·콜백 주소도 새 도메인으로 바꿉니다.

## 5. 데이터와 백업

- 데이터는 `/var/data/refboard.sqlite` 파일 하나입니다. 영구 디스크에 있어서 재배포·재시작해도 그대로 남아요.
- Render 는 디스크 스냅샷을 자동으로 만들어 둡니다 (서비스 → **Disks** 에서 복원).
- 직접 백업: 서비스 → **Shell** 탭에서 `npm run backup` → `/var/data/backups/` 에 스냅샷 파일이 생겨요.
  서버 밖에 보관하려면 Render SSH(`scp`)로 내려받으세요.
- **영구 디스크를 붙인 서비스의 특성**
  - 인스턴스는 1대만 쓸 수 있어요 (SQLite 는 한 서버에서만 씁니다).
  - 재배포할 때 이전 서버를 먼저 끄고 새 서버를 켜서, 수십 초 정도 접속이 끊길 수 있어요.

## 6. 문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| 빌드 실패: `vite: not found` | Environment 에 `NODE_ENV` 가 있으면 지우세요 |
| 로그인하면 "허용되지 않은 출처의 요청" / 로그인이 유지되지 않음 | `APP_URL` 이 실제 접속 주소(https 포함)와 같은지 확인. 도메인을 안 쓰면 `APP_URL` 을 비우세요 |
| 가입 인증 메일이 안 옴 | `SMTP_*` 값 확인. Gmail 은 앱 비밀번호 필요. 서비스 → **Logs** 에 발송 오류나 (메일 미설정 시) 인증 링크가 찍혀요 |
| 소셜 로그인 후 오류 | 콘솔에 등록한 콜백 주소가 `APP_URL` 기준 주소와 한 글자라도 다른지 확인 |
| 상단에 'AI 꺼짐' | `ANTHROPIC_API_KEY` 확인. 마우스를 올리면 이유가 보여요 |
| 헬스 체크 실패로 배포가 멈춤 | **Logs** 에서 시작 오류 확인. `DATA_DIR` 과 디스크 경로(`/var/data`)가 같은지 확인 |
