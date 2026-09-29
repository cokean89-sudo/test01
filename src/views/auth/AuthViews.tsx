import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ROLE_LABEL } from "../../../shared/types";
import { ApiError, authApi, teamApi } from "../../api";
import { Icon } from "../../components/icons";
import { Button, Field, Spinner } from "../../components/ui";
import { APP_VERSION, CHANGELOG, formatUpdateDate } from "../../lib/changelog";
import { navigate } from "../../lib/router";
import { useSession } from "../../store/session";
import { toast } from "../../store/toast";
import { useUpdates } from "../../store/updates";

const AFTER_KEY = "rb.after";

/** 로그인 후 돌아갈 주소 (초대 링크 등) */
export function rememberAfterLogin(hash: string) {
  sessionStorage.setItem(AFTER_KEY, hash);
}

function goAfterLogin() {
  const next = sessionStorage.getItem(AFTER_KEY);
  sessionStorage.removeItem(AFTER_KEY);
  location.hash = next && next.startsWith("#/") ? next : "#/library";
}

function queryParam(name: string): string | null {
  const q = location.hash.split("?")[1];
  return q ? new URLSearchParams(q).get(name) : null;
}

function AuthCard({ title, sub, children, footer }: { title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" />
          RefBoard
        </div>
        <h1>{title}</h1>
        {sub && <p className="auth-sub">{sub}</p>}
        {children}
        {footer && <div className="auth-footer">{footer}</div>}
      </div>
      <a className="auth-guide-link" href="#/guide">
        💡 처음이세요? 사용 가이드 먼저 보기
      </a>
    </div>
  );
}

function ErrorBox({ error }: { error: string | null }) {
  return error ? (
    <div className="error-box" role="alert">
      {error}
    </div>
  ) : null;
}

function passwordHints(pw: string, email: string): { ok: boolean; label: string }[] {
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  const id = email.split("@")[0].toLowerCase();
  return [
    { ok: pw.length >= 10, label: "10자 이상" },
    { ok: kinds >= 2, label: "영문 대/소문자·숫자·특수문자 중 2종류 이상" },
    { ok: !(id.length >= 4 && pw.toLowerCase().includes(id)), label: "메일 아이디 미포함" },
  ];
}

function PasswordHints({ password, email }: { password: string; email: string }) {
  if (!password) return null;
  return (
    <ul className="pw-hints">
      {passwordHints(password, email).map((h) => (
        <li key={h.label} className={h.ok ? "ok" : ""}>
          {h.label}
        </li>
      ))}
    </ul>
  );
}

/** 카카오 말풍선 심볼 — 카카오 로그인 디자인 가이드의 형태·색(#000000) */
function KakaoSymbol() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="#000000"
        d="M12 3.2C6.48 3.2 2 6.72 2 11.06c0 2.8 1.87 5.26 4.68 6.65-.15.53-.99 3.4-1.02 3.63 0 0-.02.17.09.24.11.06.24.01.24.01.31-.04 3.64-2.38 4.21-2.78.58.08 1.18.13 1.8.13 5.52 0 10-3.52 10-7.88S17.52 3.2 12 3.2z"
      />
    </svg>
  );
}

/** 네이버 N 로고 — 네이버 로그인 BI 가이드의 흰색 N */
function NaverSymbol() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path fill="#ffffff" d="M16.27 12.84 7.44 0H0v24h7.73V11.16L16.56 24H24V0h-7.73z" />
    </svg>
  );
}

/** 공식 버튼 디자인 가이드 기준의 카카오·네이버 로그인 버튼. remember: 로그인 상태 유지 선택을 함께 넘긴다 */
function SocialButtons({ remember = false }: { remember?: boolean }) {
  const providers = useSession((s) => s.providers);
  if (!providers?.kakao && !providers?.naver) return null;
  const q = remember ? "?remember=1" : "";
  const brand = providers.brand ?? {};
  return (
    <>
      <div className="auth-divider">
        <span>또는</span>
      </div>
      <div className="social">
        {providers.kakao && (
          <a className="social-btn kakao" href={"/api/auth/oauth/kakao/start" + q}>
            <span className="social-symbol">{brand.kakao ? <img src={brand.kakao} alt="" /> : <KakaoSymbol />}</span>
            <span className="social-label">카카오 로그인</span>
          </a>
        )}
        {providers.naver && (
          <a className="social-btn naver" href={"/api/auth/oauth/naver/start" + q}>
            <span className="social-symbol">{brand.naver ? <img src={brand.naver} alt="" /> : <NaverSymbol />}</span>
            <span className="social-label">네이버 로그인</span>
          </a>
        )}
      </div>
    </>
  );
}

/** 비밀번호 입력 — 보기/숨기기 토글, Caps Lock 경고 */
function PasswordInput({ value, onChange, autoComplete, autoFocus }: { value: string; onChange: (v: string) => void; autoComplete: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const detect = (e: React.KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.("CapsLock") ?? false);
  return (
    <>
      <span className="pw-field">
        <input
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={detect}
          onKeyUp={detect}
          onBlur={() => setCaps(false)}
          required
          autoFocus={autoFocus}
          spellCheck={false}
        />
        <button type="button" className="pw-toggle" onClick={() => setShow((v) => !v)} aria-label={show ? "비밀번호 숨기기" : "비밀번호 보기"} title={show ? "숨기기" : "보기"}>
          <Icon name={show ? "eyeOff" : "eye"} size={18} />
        </button>
      </span>
      {caps && <span className="caps-warn">Caps Lock 이 켜져 있어요</span>}
    </>
  );
}

const SAVED_EMAIL = "rb.savedEmail";

function readSavedEmail(): string {
  try {
    return localStorage.getItem(SAVED_EMAIL) ?? "";
  } catch {
    return "";
  }
}

/** 로그인 오류를 이해하기 쉬운 말로 */
export function loginErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "서버에 연결할 수 없어요. 인터넷 연결을 확인하고 다시 시도해 주세요.";
  switch (err.code) {
    case "invalid_credentials":
      return "메일 주소 또는 비밀번호가 맞지 않아요. 다시 확인해 주세요.";
    case "unverified":
      return "메일 인증을 아직 마치지 않았어요. 가입할 때 받은 메일의 버튼을 눌러 주세요.";
    case "invalid_input":
      return "메일 주소 형식을 확인해 주세요.";
    case "locked":
    case "rate_limited":
      return err.message;
  }
  if (err.status >= 500) return "잠시 문제가 생겼어요. 조금 뒤 다시 시도해 주세요.";
  return err.message;
}

export function LoginView() {
  const apply = useSession((s) => s.apply);
  const saved = readSavedEmail();
  const [email, setEmail] = useState(saved);
  const [password, setPassword] = useState("");
  const [rememberEmail, setRememberEmail] = useState(!!saved);
  const [keep, setKeep] = useState(false);
  const [error, setError] = useState<string | null>(queryParam("error"));
  const [busy, setBusy] = useState(false);
  const [unverified, setUnverified] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setUnverified(false);
    try {
      const info = await authApi.login(email, password, keep);
      // 아이디 기억하기: 메일 주소만 저장 (비밀번호는 저장하지 않음)
      try {
        if (rememberEmail) localStorage.setItem(SAVED_EMAIL, email.trim());
        else localStorage.removeItem(SAVED_EMAIL);
      } catch {
        /* 저장소를 쓸 수 없는 브라우저 */
      }
      apply(info);
      goAfterLogin();
    } catch (err) {
      setError(loginErrorMessage(err));
      setUnverified(err instanceof ApiError && err.code === "unverified");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={
        <>
          다시 오셨네요!
          <br />
          로그인해 주세요
        </>
      }
      sub="케이스 스터디와 레퍼런스를 한곳에서 모으고, 팀과 함께 보고서로 만들어요."
      footer={
        <>
          계정이 없나요? <a href="#/signup">메일로 가입</a>
        </>
      }
    >
      {queryParam("verified") && <div className="notice">메일 인증이 완료됐어요. 로그인하세요.</div>}
      <form onSubmit={submit} className="auth-form">
        <Field label="메일 주소">
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!saved} />
        </Field>
        <Field label="비밀번호">
          <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" autoFocus={!!saved} />
        </Field>
        <div className="login-options">
          <label className="check">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            <span>로그인 상태 유지</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={rememberEmail}
              onChange={(e) => {
                setRememberEmail(e.target.checked);
                // 해제하면 저장된 메일 주소를 바로 지운다
                if (!e.target.checked) {
                  try {
                    localStorage.removeItem(SAVED_EMAIL);
                  } catch {
                    /* 무시 */
                  }
                }
              }}
            />
            <span>아이디 기억하기</span>
          </label>
        </div>
        <p className={"public-pc" + (keep ? " warn" : "")}>공용 PC에서는 &lsquo;로그인 상태 유지&rsquo;를 꺼 주세요.</p>
        <ErrorBox error={error} />
        {unverified && <ResendVerification email={email} />}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy && <Spinner size={14} />} 로그인
        </Button>
        <a className="link-btn center" href="#/forgot">
          비밀번호를 잊으셨나요?
        </a>
      </form>
      <SocialButtons remember={keep} />
    </AuthCard>
  );
}

function ResendVerification({ email }: { email: string }) {
  const [sent, setSent] = useState<string | null>(null);
  return (
    <div className="notice">
      인증 메일을 받지 못했나요?{" "}
      <button
        type="button"
        className="link-btn"
        onClick={async () => {
          try {
            const r = await authApi.resend(email);
            setSent(r.devLink ?? "");
            toast.success("인증 메일을 다시 보냈어요");
          } catch (err) {
            toast.error((err as Error).message);
          }
        }}
      >
        인증 메일 다시 보내기
      </button>
      {sent && <DevLink href={sent} />}
    </div>
  );
}

function DevLink({ href }: { href: string }) {
  return (
    <div className="dev-link">
      <strong>개인 실행 모드</strong> — 메일 서버가 설정되지 않아 링크를 화면에 표시해요.{" "}
      <a href={href.slice(href.indexOf("#"))}>바로 열기</a>
    </div>
  );
}

export function SignupView() {
  const providers = useSession((s) => s.providers);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ delivered: boolean; devLink?: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("비밀번호 확인이 일치하지 않아요.");
    if (!passwordHints(password, email).every((h) => h.ok)) return setError("비밀번호 조건을 확인하세요.");
    setBusy(true);
    setError(null);
    try {
      const r = await authApi.signup({ name, email, password });
      setDone({ delivered: r.mailDelivered, devLink: r.devLink });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthCard title="메일을 확인하세요" footer={<a href="#/login">로그인으로 돌아가기</a>}>
        <p className="auth-text">
          <strong>{email}</strong> 로 인증 링크를 보냈어요. 메일의 버튼을 눌러 가입을 완료하세요. (24시간 유효)
        </p>
        {!done.delivered && !done.devLink && (
          <div className="notice">메일 서버가 아직 설정되지 않아, 인증 링크가 서버 실행 창(로그)에 출력됐어요. 관리자에게 링크를 받아 여세요.</div>
        )}
        {done.devLink && <DevLink href={done.devLink} />}
        <ResendVerification email={email} />
      </AuthCard>
    );
  }

  if (providers && !providers.signup) {
    return (
      <AuthCard title="가입" footer={<a href="#/login">로그인</a>}>
        <p className="auth-text">메일 가입이 비활성화되어 있어요. 관리자에게 초대를 요청하세요.</p>
        <SocialButtons />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={
        <>
          메일 주소로
          <br />
          간단하게 가입해요
        </>
      }
      sub="가입하면 나만의 작업공간이 생기고, 팀을 만들어 동료를 초대할 수 있어요."
      footer={
        <>
          이미 계정이 있나요? <a href="#/login">로그인</a>
        </>
      }
    >
      {providers?.signupDomains.length ? <div className="notice">가입 가능한 메일: {providers.signupDomains.map((d) => "@" + d).join(", ")}</div> : null}
      <form onSubmit={submit} className="auth-form">
        <Field label="이름">
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={40} autoFocus />
        </Field>
        <Field label="메일 주소" hint="이 메일로 인증 링크와 팀 초대를 받아요">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </Field>
        <Field label="비밀번호">
          <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
        </Field>
        <PasswordHints password={password} email={email} />
        <Field label="비밀번호 확인">
          <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" variant="primary" disabled={busy}>
          {busy && <Spinner size={14} />} 가입하고 인증 메일 받기
        </Button>
      </form>
      <SocialButtons />
    </AuthCard>
  );
}

/** 인증 토큰은 1회용 — 화면이 다시 그려져도 한 번만 보낸다 */
const verifying = new Set<string>();

export function VerifyView({ token }: { token: string }) {
  const apply = useSession((s) => s.apply);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (verifying.has(token)) return;
    verifying.add(token);
    authApi
      .verify(token)
      .then((info) => {
        apply(info);
        toast.success("메일 인증이 완료됐어요");
        goAfterLogin();
      })
      .catch((err) => setError(err.message));
  }, [token, apply]);
  return (
    <AuthCard title="메일 인증" footer={<a href="#/login">로그인</a>}>
      {error ? <ErrorBox error={error} /> : <Spinner size={22} />}
    </AuthCard>
  );
}

export function ForgotView() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ devLink?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthCard title="비밀번호 찾기" footer={<a href="#/login">로그인으로 돌아가기</a>}>
      {sent ? (
        <>
          <p className="auth-text">가입된 메일이라면 비밀번호 재설정 링크를 보냈어요. (1시간 유효)</p>
          {sent.devLink && <DevLink href={sent.devLink} />}
        </>
      ) : (
        <form
          className="auth-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              setSent(await authApi.forgot(email));
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <Field label="가입한 메일 주소">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <ErrorBox error={error} />
          <Button type="submit" variant="primary">
            재설정 링크 받기
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetView({ token }: { token: string }) {
  const apply = useSession((s) => s.apply);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthCard title="새 비밀번호 설정" footer={<a href="#/login">로그인</a>}>
      <form
        className="auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (password !== confirm) return setError("비밀번호 확인이 일치하지 않아요.");
          try {
            apply(await authApi.reset(token, password));
            toast.success("비밀번호를 바꿨어요. 다른 기기의 로그인은 모두 해제됐어요.");
            goAfterLogin();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <Field label="새 비밀번호">
          <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
        </Field>
        <PasswordHints password={password} email="" />
        <Field label="새 비밀번호 확인">
          <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" variant="primary">
          비밀번호 변경
        </Button>
      </form>
    </AuthCard>
  );
}

/** 메일 초대 수락 — 로그인이 안 되어 있으면 로그인 후 이 화면으로 돌아온다 */
export function InviteView({ token }: { token: string }) {
  const { status, user, refreshTeams, switchTeam, logout } = useSession();
  const [info, setInfo] = useState<Awaited<ReturnType<typeof teamApi.previewInvite>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "anonymous") rememberAfterLogin(`#/invite/${token}`);
    if (status !== "ready") return;
    teamApi.previewInvite(token).then(setInfo, (err) => setError(err.message));
  }, [status, token]);

  if (status === "anonymous") {
    return (
      <AuthCard title="팀 초대">
        <p className="auth-text">초대를 수락하려면 초대받은 메일 주소의 계정으로 로그인하세요. 계정이 없다면 같은 메일 주소로 가입하세요.</p>
        <div className="row">
          <Button variant="primary" onClick={() => navigate("login")}>
            로그인
          </Button>
          <Button onClick={() => navigate("signup")}>메일로 가입</Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="팀 초대" footer={<a href="#/library">홈으로</a>}>
      <ErrorBox error={error} />
      {!info && !error && <Spinner size={22} />}
      {info && (
        <>
          <p className="auth-text">
            <strong>{info.inviterName ?? "팀 관리자"}</strong> 님이 <strong>{info.teamName}</strong> 팀에 <strong>{ROLE_LABEL[info.role]}</strong>(으)로 초대했어요.
          </p>
          {info.alreadyMember ? (
            <Button variant="primary" onClick={() => navigate("library")}>
              이미 팀 멤버예요 — 열기
            </Button>
          ) : info.status !== "active" ? (
            <div className="error-box">{info.status === "expired" ? "만료된 초대예요." : "더 이상 사용할 수 없는 초대예요."} 관리자에게 다시 요청하세요.</div>
          ) : !info.emailMatches ? (
            <>
              <div className="error-box">
                이 초대는 <strong>{info.email}</strong> 계정용이에요. 지금은 {user?.email ?? "다른 계정"}(으)로 로그인되어 있어요.
              </div>
              <Button
                onClick={() => {
                  rememberAfterLogin(`#/invite/${token}`);
                  void logout();
                }}
              >
                로그아웃하고 다른 계정으로 로그인
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  const r = await teamApi.acceptInvite(token);
                  await refreshTeams(r.teamId);
                  switchTeam(r.teamId);
                  toast.success(`${info.teamName} 팀에 참여했어요`);
                  navigate("library");
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              초대 수락
            </Button>
          )}
        </>
      )}
    </AuthCard>
  );
}

export function AccountView() {
  const { user, apply, providers, logout } = useSession();
  const [name, setName] = useState(user?.name ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;
  const linked = queryParam("linked");
  return (
    <div className="account">
      <h2>내 계정</h2>
      {linked && <div className="notice">{linked === "kakao" ? "카카오" : "네이버"} 계정을 연결했어요.</div>}
      <section className="panel">
        <h4>프로필</h4>
        <Field label="이름">
          <div className="row">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            <Button
              disabled={!name.trim() || name === user.name}
              onClick={async () => {
                try {
                  apply(await authApi.profile(name));
                  toast.success("이름을 바꿨어요");
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            >
              저장
            </Button>
          </div>
        </Field>
        <Field label="메일">
          <div className="row">
            <input value={user.email ?? "(소셜 로그인 계정 — 메일 없음)"} readOnly />
            {user.email && <span className={"badge" + (user.emailVerified ? " badge-ok" : "")}>{user.emailVerified ? "인증됨" : "미인증"}</span>}
          </div>
        </Field>
      </section>
      <section className="panel">
        <h4>{user.hasPassword ? "비밀번호 변경" : "비밀번호 설정"}</h4>
        <form
          className="auth-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await authApi.changePassword(user.hasPassword ? current : undefined, next);
              toast.success("비밀번호를 바꿨어요. 다른 기기의 로그인은 해제됐어요.");
              setCurrent("");
              setNext("");
              apply(await authApi.me());
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          {user.hasPassword && (
            <Field label="현재 비밀번호">
              <PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" />
            </Field>
          )}
          <Field label="새 비밀번호">
            <PasswordInput value={next} onChange={setNext} autoComplete="new-password" />
          </Field>
          <PasswordHints password={next} email={user.email ?? ""} />
          <ErrorBox error={error} />
          <Button type="submit">변경</Button>
        </form>
      </section>
      {(providers?.kakao || providers?.naver) && (
        <section className="panel">
          <h4>소셜 로그인 연결</h4>
          <div className="row wrap">
            {providers.kakao &&
              (user.providers.includes("kakao") ? (
                <span className="badge badge-ok">카카오 연결됨</span>
              ) : (
                <a className="social-btn kakao small" href="/api/auth/oauth/kakao/start?mode=link">
                  <span className="social-symbol">
                    <KakaoSymbol />
                  </span>
                  카카오 연결
                </a>
              ))}
            {providers.naver &&
              (user.providers.includes("naver") ? (
                <span className="badge badge-ok">네이버 연결됨</span>
              ) : (
                <a className="social-btn naver small" href="/api/auth/oauth/naver/start?mode=link">
                  <span className="social-symbol">
                    <NaverSymbol />
                  </span>
                  네이버 연결
                </a>
              ))}
          </div>
        </section>
      )}
      <section className="panel">
        <h4>로그인 관리</h4>
        <p className="muted small">공용 PC 등 다른 곳에서 로그아웃을 잊었다면 이 기기를 뺀 모든 로그인을 끊을 수 있어요.</p>
        <div className="row wrap">
          <Button
            onClick={async () => {
              try {
                const r = await authApi.logoutOthers();
                toast.success(r.removed ? `다른 기기 ${r.removed}곳의 로그인을 해제했어요` : "다른 기기의 로그인이 없어요");
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}
          >
            다른 기기 모두 로그아웃
          </Button>
          <Button variant="danger" onClick={() => void logout()}>
            로그아웃
          </Button>
        </div>
      </section>
      <AppInfo />
    </div>
  );
}

/** 앱 정보 — 현재 버전 · 업데이트 기록 */
function AppInfo() {
  const unseen = useUpdates((s) => s.unseen.size);
  const current = CHANGELOG.find((e) => e.version === APP_VERSION);
  return (
    <section className="panel app-info">
      <h4>앱 정보</h4>
      <div className="app-info-row">
        <div>
          <strong className="app-info-version">RefBoard v{APP_VERSION}</strong>
          {current && (
            <p className="muted small">
              {formatUpdateDate(current.date)} 업데이트 · {current.title}
            </p>
          )}
        </div>
        <Button icon="bell" onClick={() => useUpdates.getState().openAll()}>
          업데이트 기록{unseen > 0 ? ` (새 소식 ${unseen})` : ""}
        </Button>
      </div>
    </section>
  );
}
