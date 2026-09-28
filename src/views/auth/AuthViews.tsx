import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ROLE_LABEL } from "../../../shared/types";
import { ApiError, authApi, teamApi } from "../../api";
import { Button, Field, Spinner } from "../../components/ui";
import { navigate } from "../../lib/router";
import { useSession } from "../../store/session";
import { toast } from "../../store/toast";

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

function SocialButtons() {
  const providers = useSession((s) => s.providers);
  if (!providers?.kakao && !providers?.naver) return null;
  return (
    <>
      <div className="auth-divider">
        <span>또는</span>
      </div>
      <div className="social">
        {providers.kakao && (
          <a className="social-btn kakao" href="/api/auth/oauth/kakao/start">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.9 5.3 4.7 6.7l-1 3.6c-.1.3.3.6.6.4l4.2-2.8c.5.1 1 .1 1.5.1 5.5 0 10-3.6 10-8S17.5 3 12 3z" />
            </svg>
            카카오로 로그인
          </a>
        )}
        {providers.naver && (
          <a className="social-btn naver" href="/api/auth/oauth/naver/start">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path fill="currentColor" d="M16.3 12.7 7.4 0H0v24h7.7V11.3L16.6 24H24V0h-7.7z" />
            </svg>
            네이버로 로그인
          </a>
        )}
      </div>
    </>
  );
}

export function LoginView() {
  const apply = useSession((s) => s.apply);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(queryParam("error"));
  const [busy, setBusy] = useState(false);
  const [unverified, setUnverified] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setUnverified(false);
    try {
      apply(await authApi.login(email, password));
      goAfterLogin();
    } catch (err) {
      setError((err as Error).message);
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
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="비밀번호">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorBox error={error} />
        {unverified && <ResendVerification email={email} />}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy && <Spinner size={14} />} 로그인
        </Button>
        <a className="link-btn center" href="#/forgot">
          비밀번호를 잊으셨나요?
        </a>
      </form>
      <SocialButtons />
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
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
        </Field>
        <PasswordHints password={password} email={email} />
        <Field label="비밀번호 확인">
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
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
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required autoFocus />
        </Field>
        <PasswordHints password={password} email="" />
        <Field label="새 비밀번호 확인">
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
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
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
            </Field>
          )}
          <Field label="새 비밀번호">
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
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
                  카카오 연결
                </a>
              ))}
            {providers.naver &&
              (user.providers.includes("naver") ? (
                <span className="badge badge-ok">네이버 연결됨</span>
              ) : (
                <a className="social-btn naver small" href="/api/auth/oauth/naver/start?mode=link">
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
    </div>
  );
}
