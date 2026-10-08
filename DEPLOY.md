# Render 배포 가이드

GitHub 저장소를 Render 에 연결하면 `render.yaml`(Blueprint) 설정대로 RefBoard 웹 서비스가 만들어집니다.
Docker 없이 Node 22 런타임으로 실행되고, 데이터(SQLite)와 올린 이미지는 영구 디스크에 저장되어 재배포해도 남습니다.

| 항목 | 값 |
| --- | --- |
| 런타임 | Node 22 (`NODE_VERSION=22`, `.node-version`) |
| 인스턴스 | Starter (가장 저렴한 유료 인스턴스) |
| 리전 | Singapore (한국에서 가장 가까운 리전 — 서비스를 만든 뒤에는 바꿀 수 없어요) |
| 빌드 / 시작 | `npm ci && npm run build` / `npm start` |
| 헬스 체크 | `/api/health` |
| 영구 디스크 | `/var/data` 5GB → `DATA_DIR=/var/data` (데이터베이스 + 올린 이미지 `/var/data/uploads`. 나중에 늘릴 수는 있지만 줄일 수는 없어요) |

> 요금은 Render 요금표를 확인하세요. Starter 인스턴스 요금에 디스크 용량(GB)당 요금이 더해집니다.

---

## 1. 배포 순서

1. **코드를 배포할 브랜치에 올리기** — Blueprint 는 한 브랜치를 따라갑니다. 보통 `main` 에 합친 뒤 연결하세요.
2. [Render 대시보드](https://dashboard.render.com) → **New +** → **Blueprint** 를 누릅니다.
3. GitHub 계정을 연결하고 이 저장소를 고릅니다. 저장소 루트의 `render.yaml` 을 자동으로 읽어요.
4. 만들어질 서비스(`refboard`, Starter, 디스크 5GB)를 확인합니다.
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
| `STORAGE_DRIVER` | `disk` | 올린 이미지 저장 위치. `disk` = 영구 디스크의 `/var/data/uploads`. R2 · S3 로 옮길 때 `s3` ([5-B](#5-b-cloudflare-r2--aws-s3-로-옮기기)) |
| `TEAM_STORAGE_LIMIT_GB` | `2` | 팀별 저장 공간 (올린 이미지 + 링크 사본). 팀 설정 화면에 '사용 중 1.2GB / 2GB'로 보이고, 가득 차면 올리기가 막히며 안내가 나와요 |
| `USER_STORAGE_LIMIT_MB` · `TOTAL_STORAGE_LIMIT_GB` | `500` · `8` | 개인별(올린 사람 기준) · 서비스 전체 저장 공간 ([2-E](#2-e-사용-한도와-ai-예산)) |
| `AI_WRITE_MONTHLY` · `AI_WRITE_DAILY` · `AI_TAG_MONTHLY` · `AI_TAG_DAILY` | `50` · `15` · `300` · `80` | 한 사람의 AI 글쓰기 · 태그 제안 횟수 한도 (월 · 하루) ([2-E](#2-e-사용-한도와-ai-예산)) |
| `AI_MONTHLY_BUDGET_USD` | `20` | 서비스 전체 월 AI 예산(달러). 넘으면 이달 말까지 AI 기능이 쉬어요 ([2-E](#2-e-사용-한도와-ai-예산)) |
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
| `ADMIN_EMAILS` | 선택 | 관리자(서비스 운영자) 계정 메일, 쉼표로 여러 개. 받은 의견(`#/admin/feedback`)과 사용량 대시보드(`#/admin/usage`)를 보고, 개인 사용 한도에서 빠지며, AI 예산 도달 알림 메일을 받아요. 비우면 `FEEDBACK_EMAIL`. 메일 인증을 마친 계정만 관리자로 인정돼요 | `a@team.com,b@team.com` |

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
| `STORAGE_RESERVE_MB` | `300` | 디스크 저장 시 늘 비워 둘 공간(MB). 디스크 남은 공간이 이보다 적어지면 업로드를 막고 "서버 저장 공간이 부족해요"라고 안내 — 데이터베이스가 쓸 자리를 지켜요 |
| `UPLOADS_DIR` | `DATA_DIR/uploads` | 디스크 저장 폴더를 따로 정할 때 (보통 그대로 두세요) |
| `S3_BUCKET` · `S3_ENDPOINT` · `S3_REGION` | — | `STORAGE_DRIVER=s3` 일 때 버킷 · 주소 · 리전. R2 는 `S3_ENDPOINT=https://<계정ID>.r2.cloudflarestorage.com`, `S3_REGION=auto`. AWS 는 `S3_ENDPOINT` 를 비우고 `S3_REGION=ap-northeast-2` 처럼 |
| `S3_ACCESS_KEY_ID` · `S3_SECRET_ACCESS_KEY` | — | 버킷 읽기 · 쓰기 권한 키 (**비밀값 — render.yaml 에 적지 말고 Environment 탭에만**) |
| `S3_FORCE_PATH_STYLE` | R2 · MinIO 는 켜짐 | `https://주소/버킷/파일` 형식으로 부를지. 보통 그대로 |
| `AI_PRICES_FILE` · `AI_PRICES` | `ai-prices.json` | AI 예상 비용을 계산할 모델별 단가 — 다른 파일 경로 · JSON 문자열로 바꿀 때 ([2-E](#2-e-사용-한도와-ai-예산)) |

### 2-D. 넣으면 안 되는 값

| 변수 | 이유 |
| --- | --- |
| `NODE_ENV=production` | `npm ci` 가 빌드 도구(vite)를 설치하지 않아 **빌드가 실패**해요. 운영 모드는 `npm start`(`--prod`)로 이미 켜집니다 |
| `ALLOW_PRIVATE_FETCH` | 켜면 링크 스크랩으로 서버 내부망에 접근할 수 있게 돼요 (SSRF). 공개 서버에서는 절대 켜지 마세요 |
| `PORT` | Render 가 정한 포트와 달라지면 헬스 체크가 실패해요 |

### 2-E. 사용 한도와 AI 예산

베타 기간 동안 한 사람 · 팀 · 서비스 전체가 쓸 수 있는 양을 정해 둡니다. 값은 `render.yaml` 에 기본값으로 적혀 있고, Render **Environment 탭에서 바꾸면 재시작 없이 다음 요청부터** 적용돼요.

| 한도 | 변수 (기본값) | 누구에게 | 넘으면 |
| --- | --- | --- | --- |
| AI 글쓰기 | `AI_WRITE_MONTHLY` (50) · `AI_WRITE_DAILY` (15) | 한 사람 | "이번 달 AI 글쓰기를 모두 사용했어요 … 10월 1일에 다시 채워져요" 안내 |
| AI 태그 제안 | `AI_TAG_MONTHLY` (300) · `AI_TAG_DAILY` (80) | 한 사람 | 같은 방식 안내 |
| 개인 저장 공간 | `USER_STORAGE_LIMIT_MB` (500) | 올린 사람 기준 (팀이 달라도 합산) | 올리기 · 사본 저장이 막히고 안내 |
| 팀 저장 공간 | `TEAM_STORAGE_LIMIT_GB` (2) | 팀 | 같은 방식 |
| 서비스 전체 저장 공간 | `TOTAL_STORAGE_LIMIT_GB` (8) | 모두 (관리자 포함) | 같은 방식. 영구 디스크(5GB)에 저장하는 동안은 디스크가 먼저 차므로 `STORAGE_RESERVE_MB` 가 디스크를 지켜요 — 디스크를 늘리거나 R2 · S3 로 옮기면 이 값이 전체 상한이 돼요 |
| 월 AI 예산 | `AI_MONTHLY_BUDGET_USD` (20) | 모두 (관리자 포함) | 이달 말까지 모든 AI 기능이 쉬어요 — 글쓰기는 규칙 기반 초안, 태그 제안은 안내만, 상단에 'AI 쉬는 중'. 관리자(`ADMIN_EMAILS`)에게 한 달에 한 번 메일 |

- **월간 사용량은 한국 시간 매월 1일 0시에 새로 시작**해요. 하루 한도는 한국 시간 자정에 초기화돼요.
- **관리자(`ADMIN_EMAILS`)는 개인 한도(AI 글쓰기 · 태그 제안 · 개인 저장 공간)에서 빠져요.** 팀 · 전체 저장 공간과 월 예산은 관리자에게도 적용돼요.
- **특정 사용자만 올리거나 내리려면** 프로필 메뉴 → `사용량 (관리자)`(`#/admin/usage`) → 사용자별 표의 `조정`. 비워 두면 기본값, 0 이면 그 기능을 막아요. 바꾼 기록은 보안 기록에 남아요.
- **AI 예상 비용**은 모델이 알려 준 토큰 수 × 모델별 단가(`ai-prices.json`, [공식 가격표](https://platform.claude.com/docs/en/about-claude/pricing) 기준)로 계산해 저장해요. 실제 청구서와 조금 다를 수 있어요. 단가를 바꾸려면 `ai-prices.json` 을 고치거나, `AI_PRICES_FILE`(다른 파일 경로) 또는 `AI_PRICES`(예: `{"claude-opus-5-5":{"input":4,"cacheWrite5m":5,"cacheWrite1h":8,"cacheRead":0.2,"output":20}}`)를 넣으세요. 표에 없는 모델은 비싼 기본 단가로 계산해요.
- 사용량 기록에는 **횟수와 수치만** 남아요 (사람 · 팀 · 기능 · 모델 · 토큰 수 · 예상 비용 · 파일 크기). 쓴 글이나 이미지 내용은 저장하지 않아요.
- 한도 확인은 `server/limits.ts` 한 곳에서 해요. 나중에 요금제별 한도를 만들려면 `PLANS` 에 요금제를 추가하고 `planOf()` 가 사용자 정보를 보고 고르게 바꾸면 돼요.

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

- 데이터베이스는 `/var/data/refboard.sqlite` 파일 하나, 올린 이미지는 `/var/data/uploads/<팀>/` 폴더, 프로필 사진은 `/var/data/uploads/avatars/` 폴더입니다. 영구 디스크에 있어서 재배포·재시작해도 그대로 남아요.
- Render 는 디스크 스냅샷을 자동으로 만들어 둡니다 (서비스 → **Disks** 에서 복원) — 데이터베이스와 올린 이미지가 함께 들어가요.
- 직접 백업: 서비스 → **Shell** 탭에서 `npm run backup` → `/var/data/backups/` 에 데이터베이스 스냅샷 파일이 생겨요.
  서버 밖에 보관하려면 Render SSH(`scp`)로 내려받으세요. 올린 이미지까지 받으려면 `/var/data/uploads` 폴더도 함께.
- 팀 설정의 **JSON 백업**에는 레퍼런스 · 문서 내용만 들어가고 이미지 파일은 들어가지 않아요. 같은 팀에 다시 가져오면 이미지도 그대로 연결되지만, 다른 팀으로 가져오면 올린 이미지는 빠져요.
- **영구 디스크를 붙인 서비스의 특성**
  - 인스턴스는 1대만 쓸 수 있어요 (SQLite 는 한 서버에서만 씁니다).
  - 재배포할 때 이전 서버를 먼저 끄고 새 서버를 켜서, 수십 초 정도 접속이 끊길 수 있어요.

### 5-A. 이미지 저장 공간 늘리기

올린 이미지는 서버에서 긴 변 2000px WebP 로 줄여서 저장해요 (보통 한 장 150KB ~ 1MB, 목록용 썸네일 포함). 5GB 면 대략 5천 ~ 3만 장입니다.
팀 설정 → **팀 설정** 탭에서 팀별 사용량('사용 중 1.2GB / 2GB')을 볼 수 있고, 90% 를 넘으면 경고, 가득 차면 업로드가 막히며 안내가 나와요. 개인 · 서비스 전체 한도는 [2-E](#2-e-사용-한도와-ai-예산), 전체 사용량은 관리자 화면 `사용량`에서 볼 수 있어요.

1. Render 대시보드 → 서비스 → **Disks** → 크기(Size)를 늘리고 저장합니다. (또는 `render.yaml` 의 `sizeGB` 를 올려 push — Blueprint 가 반영)
   - **늘리기만 되고 줄일 수는 없어요.** 디스크 요금은 GB 단위로 붙으니 Render 요금표를 확인하세요.
2. 서비스 → **Environment** 에서 `TEAM_STORAGE_LIMIT_GB` 를 새 한도로 바꿉니다 (예: 디스크 20GB → `18`). 팀이 여러 개면 팀 한도 × 팀 수가 디스크보다 클 수 있으니, 디스크가 먼저 차면 "서버 저장 공간이 부족해요" 안내가 나와요.
3. 쓰지 않는 레퍼런스를 지우면 그 이미지 파일도 함께 지워져 공간이 생겨요. 올려 두고 저장하지 않은 파일은 6시간 뒤 자동으로 정리돼요.

### 5-B. Cloudflare R2 · AWS S3 로 옮기기

이미지가 많아지면 디스크 대신 R2(내보내기 요금 없음) · S3 에 저장할 수 있어요. 앱 안의 이미지 주소(`/api/files/…`, 프로필 사진 `/api/avatars/…`)는 저장소와 상관없이 같아서 **문서 · 레퍼런스를 고칠 필요가 없고**, 팀원만 볼 수 있는 권한 확인도 그대로예요.

1. 버킷 만들기 — **공개(public) 접근은 끈 채로** 둡니다. 서버가 키로 읽어서 전달해요.
   - R2: Cloudflare 대시보드 → R2 → Create bucket → R2 API 토큰 관리에서 그 버킷의 *Object Read & Write* 토큰 발급 (Access Key ID · Secret Access Key, 계정 ID 확인 — 메뉴 이름은 Cloudflare 개편에 따라 조금 다를 수 있어요)
   - S3: 버킷 생성(서울 `ap-northeast-2`) → IAM 사용자에게 그 버킷의 `s3:GetObject` · `s3:PutObject` · `s3:DeleteObject` 권한 → 액세스 키 발급
2. 서비스 → **Environment** 에 추가 (아직 `STORAGE_DRIVER` 는 `disk` 그대로):
   `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`(R2 는 `auto`), R2 는 `S3_ENDPOINT=https://<계정ID>.r2.cloudflarestorage.com`
3. 서비스 → **Shell** 에서 기존 파일 복사:
   ```
   STORAGE_DRIVER=s3 npm run storage:migrate -- --dry-run   # 옮길 파일 수 확인
   STORAGE_DRIVER=s3 npm run storage:migrate                # 복사 (프로필 사진 avatars/ 포함, 디스크 파일은 지우지 않음)
   ```
4. **Environment** 에서 `STORAGE_DRIVER=s3` 로 바꾸고 저장 → 재시작 후 이미지가 잘 보이는지 확인.
5. 문제가 없으면 Shell 에서 `/var/data/uploads` 를 지워 디스크를 비웁니다. (데이터베이스는 계속 디스크에 있어요 — 디스크는 줄일 수 없으니 그대로 둡니다.)

되돌릴 때는 `STORAGE_DRIVER=disk` 로 바꾸면 돼요 (그 사이 R2 · S3 에만 올라간 파일은 직접 내려받아 `/var/data/uploads` 에 넣어야 해요).

## 5-C. 휴대폰 홈 화면 앱 · 공유 메뉴

따로 설정할 것은 없어요. 빌드에 `manifest.webmanifest` · `sw.js` · `icons/` 가 함께 들어가고, Render 주소는 HTTPS 라서 바로 동작해요.

- 휴대폰 브라우저로 접속 → 메뉴의 **홈 화면에 추가**(안드로이드는 '앱 설치'). 아이폰은 사파리 공유 → 홈 화면에 추가.
- 안드로이드에서 홈 화면에 추가한 뒤에는 사진 · 링크의 **공유 → RefBoard** 로 바로 레퍼런스를 모을 수 있어요. 아이폰은 이 기능(Web Share Target)을 지원하지 않아요.
- 서비스 워커(`/sw.js`)는 공유 받기만 처리하고 화면 · API 를 캐시하지 않아요. 서버는 `sw.js` · `manifest.webmanifest` 를 `Cache-Control: no-cache` 로 보내서 새로 배포하면 바로 바뀌어요.
- 아이콘을 바꾸려면 `tokens.json` 의 파란색을 고친 뒤 `npm run icons` → 커밋.

## 5-D. 프로필 사진 · 기본 이모지

따로 설정할 것은 없어요.

- 팀 · 개인 프로필 사진은 올린 이미지와 같은 저장소(`STORAGE_DRIVER`)의 `avatars/<id>.webp` 에 512px WebP 로 저장돼요. **팀 · 개인 · 서비스 저장 공간 한도 계산에는 들어가지 않아요** (한 장 수십 KB, 사람 · 팀마다 한 장만 남고 바꾸면 이전 사진은 바로 지워져요).
- 처음 배포하면 서버가 시작할 때 기존 계정 · 팀에 기본 이모지 · 배경색 · 내 색 · 팀 색을 무작위로 채워요 (DB v7, 이미 있는 값은 그대로).
- 기본 이모지 그림은 빌드에 함께 들어가요 (`public/emoji/`, Microsoft Fluent Emoji 3D · MIT 라이선스 — 라이선스 전문 `public/emoji/LICENSE` 를 지우지 마세요).

## 5-E. 실시간 공동 편집

따로 설정할 것은 없어요. Render 웹 서비스는 WebSocket 을 그대로 지원해요.

- **연결**: 편집기는 `wss://<주소>/api/collab/<문서 id>` 로 서버의 '문서 방'에 붙어요. 로그인 쿠키 · 팀 권한(보기 전용은 받기만) · `Origin`(= `APP_URL` 또는 접속 주소)을 확인하고, 연결된 동안 25초마다 권한을 다시 확인해서 팀에서 빠진 사람은 바로 끊어요. 한 사람당 연결 시도 10분에 300번까지.
- **WebSocket 이 막힌 경우**: 한 번도 연결되지 않고 3번 실패하면 브라우저가 자동으로 HTTP(`POST /api/collab/<문서 id>/sync`, 1.5초 간격)로 바꿔요. 문제를 확인할 때는 브라우저 개발자 도구 콘솔에서 `localStorage.setItem("rb.collab", "http")` 후 새로고침하면 처음부터 HTTP 로 연결해요 (되돌리기: `localStorage.removeItem("rb.collab")`).
- **저장**: 문서 방은 서버 메모리에 Y.Doc 을 두고, 변경이 생기면 0.8초 동안 모아서(계속 바뀌어도 최대 4초) 데이터베이스(`documents.ydoc` + 기존 `data_json`)에 저장해요. 같은 사람이 1분 안에 이어서 고친 내용은 한 버전에 덮어 쓰고(버전 탭은 10분 단위로 묶어 보여 줘요), 복원 · 예전 방식 저장(PUT)은 항상 새 버전이에요. 마지막 사람이 나가고 1분 뒤 방을 메모리에서 내려요.
- **재배포 · 재시작**: 서버가 꺼질 때(SIGTERM) 모든 방을 먼저 저장해요. 브라우저는 1 · 2 · 4 · 8 · 10초 간격으로 다시 연결하고, 끊긴 동안 고친 내용(화면에 '오프라인 — 변경 N개 대기 중')을 다시 연결되면 올려요. 탭을 닫으면 올리지 못한 변경은 사라지므로 그때는 경고가 떠요.
- **데이터베이스 v8** (처음 배포할 때 자동): `documents` 에 `ydoc` · `assign_strict` 칸, `page_assignments`(페이지 맡기) · `doc_activity`(활동 기록) 표가 생겨요. 기존 문서는 처음 열 때 Y.Doc 으로 바뀌어 저장돼요. 활동 기록은 90일이 지나면 1시간마다 도는 정리 작업이 지워요.
- **인스턴스 1대 기준**이에요. 문서 방이 서버 메모리에 있어서 서버를 여러 대로 늘리려면 ① 같은 문서는 같은 서버로 보내기(문서 id 기준 라우팅) 또는 ② 서버 사이에 변경을 전달하는 Redis pub/sub 를 붙이고, 데이터베이스를 SQLite 에서 옮겨야 해요. 방 · 저장 · 전달이 `server/collab/hub.ts` 한 곳에 모여 있어서 그 부분만 바꾸면 돼요.
- 직접 서버(Nginx 등) 뒤에 둘 때는 WebSocket 업그레이드를 넘겨 주세요 (README '직접 서버' 참고). Docker 의 Caddy 는 따로 설정하지 않아도 넘겨요.

## 6. 문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| 빌드 실패: `vite: not found` | Environment 에 `NODE_ENV` 가 있으면 지우세요 |
| 로그인하면 "허용되지 않은 출처의 요청" / 로그인이 유지되지 않음 | `APP_URL` 이 실제 접속 주소(https 포함)와 같은지 확인. 도메인을 안 쓰면 `APP_URL` 을 비우세요 |
| 가입 인증 메일이 안 옴 | `SMTP_*` 값 확인. Gmail 은 앱 비밀번호 필요. 서비스 → **Logs** 에 발송 오류나 (메일 미설정 시) 인증 링크가 찍혀요 |
| 소셜 로그인 후 오류 | 콘솔에 등록한 콜백 주소가 `APP_URL` 기준 주소와 한 글자라도 다른지 확인 |
| 상단에 'AI 꺼짐' | `ANTHROPIC_API_KEY` 확인. 마우스를 올리면 이유가 보여요 |
| 헬스 체크 실패로 배포가 멈춤 | **Logs** 에서 시작 오류 확인. `DATA_DIR` 과 디스크 경로(`/var/data`)가 같은지 확인. `STORAGE_DRIVER=s3` 인데 `S3_*` 값이 빠지면 시작하지 않고 어떤 값이 없는지 알려 줘요 |
| 이미지 올리기가 "팀 저장 공간이 가득 찼어요" | 팀 설정에서 사용량 확인 → 안 쓰는 레퍼런스 정리 또는 [5-A](#5-a-이미지-저장-공간-늘리기) |
| 이미지 올리기가 "서버 저장 공간이 부족해요" | 디스크 자체가 거의 찼어요 → 디스크 늘리기([5-A](#5-a-이미지-저장-공간-늘리기)) 또는 R2 · S3 로 옮기기([5-B](#5-b-cloudflare-r2--aws-s3-로-옮기기)) |
| 편집기 상단이 계속 '연결 중…' · 다른 사람 수정이 늦게 보임 | `APP_URL` 이 실제 접속 주소와 같은지 확인 (WebSocket 은 `Origin` 을 확인해요). 프록시가 WebSocket 을 막으면 1.5초 간격 HTTP 로 동작해서 조금 느려요 — [5-E](#5-e-실시간-공동-편집) |
