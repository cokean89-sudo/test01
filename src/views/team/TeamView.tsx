import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AI_PERSPECTIVES,
  AI_TONES,
  PAGE_SIZES,
  ROLE_LABEL,
  ROLE_RANK,
  type ActivityItem,
  type AiPerspective,
  type AiTone,
  type DocSettings,
  type InviteInfo,
  type PageSizeKey,
  type Role,
  type TeamDetail,
} from "../../../shared/types";
import { teamApi } from "../../api";
import { PageView } from "../../components/PageView";
import { Button, ColorInput, Empty, Field, Modal, NumberInput, Segmented, Select, Spinner, Toggle } from "../../components/ui";
import { createCasePage, createCoverPage, createReferencePage } from "../../layout/templates";
import { FOOTER_PRESETS, REPORT_TYPOGRAPHY, TYPOGRAPHY_PRESETS } from "../../lib/defaults";
import { navigate } from "../../lib/router";
import { useSession } from "../../store/session";
import { toast } from "../../store/toast";

type Tab = "members" | "invites" | "defaults" | "activity" | "settings";

const ROLE_HELP: Record<Role, string> = {
  owner: "모든 권한 + 팀 삭제·소유자 지정",
  admin: "초대·멤버 관리·문서 기본 설정",
  editor: "레퍼런스·케이스·문서 추가와 편집",
  viewer: "보기와 내보내기만",
};

const fmt = (t: number) => new Date(t).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });

export function TeamView() {
  const { teamId, user, ticks } = useSession();
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.hash.split("?")[1] ?? "").get("tab") as Tab | null) ?? "members");
  const [error, setError] = useState<string | null>(null);

  // #/team?tab=defaults 처럼 들어오면 해당 탭으로
  useEffect(() => {
    const onHash = () => {
      const t = new URLSearchParams(location.hash.split("?")[1] ?? "").get("tab") as Tab | null;
      if (t) setTab(t);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const reload = useCallback(() => {
    if (!teamId) return;
    teamApi.detail(teamId).then(setTeam, (err) => setError(err.message));
  }, [teamId]);
  useEffect(reload, [reload, ticks.team]);

  if (error) return <div className="center-msg error-box">{error}</div>;
  if (!team || !user) return <div className="center-msg"><Spinner size={22} /></div>;
  const isAdmin = ROLE_RANK[team.role] >= ROLE_RANK.admin;
  const tabs: [Tab, string][] = [
    ["members", `멤버 ${team.members.length}`],
    ...(isAdmin ? ([["invites", "초대"]] as [Tab, string][]) : []),
    ["defaults", "문서 기본 설정"],
    ["activity", "활동 기록"],
    ["settings", "팀 설정"],
  ];

  return (
    <div className="team-page">
      <header className="team-head">
        <div>
          <h2>{team.name}</h2>
          <span className="muted small">
            {team.personal ? "개인 작업공간" : "팀 프로젝트"} · 내 권한: {ROLE_LABEL[team.role]}
          </span>
        </div>
        <span className="spacer" />
        <JoinByCodeButton />
        <CreateTeamButton />
      </header>
      <nav className="team-tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="team-body">
        {tab === "members" && <MembersTab team={team} meId={user.id} onChange={setTeam} reload={reload} />}
        {tab === "invites" && isAdmin && <InvitesTab team={team} />}
        {tab === "defaults" && <DefaultsTab team={team} editable={isAdmin} onSaved={setTeam} />}
        {tab === "activity" && <ActivityTab teamId={team.id} />}
        {tab === "settings" && <SettingsTab team={team} onChange={setTeam} />}
      </div>
    </div>
  );
}

// ─── members ────────────────────────────────────────────────

function MembersTab({ team, meId, onChange, reload }: { team: TeamDetail; meId: string; onChange: (t: TeamDetail) => void; reload: () => void }) {
  const refreshTeams = useSession((s) => s.refreshTeams);
  const isAdmin = ROLE_RANK[team.role] >= ROLE_RANK.admin;
  const isOwner = team.role === "owner";
  return (
    <div className="panel">
      <table className="table">
        <thead>
          <tr>
            <th>이름</th>
            <th>메일</th>
            <th>권한</th>
            <th>참여일</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {team.members.map((m) => {
            const canEdit = isAdmin && m.userId !== meId && (isOwner || m.role !== "owner");
            const roles: Role[] = isOwner ? ["owner", "admin", "editor", "viewer"] : ["editor", "viewer", ...(m.role === "admin" ? (["admin"] as Role[]) : [])];
            return (
              <tr key={m.userId}>
                <td>
                  <strong>{m.name}</strong> {m.userId === meId && <span className="badge">나</span>}
                </td>
                <td className="muted">{m.email ?? "—"}</td>
                <td>
                  {canEdit ? (
                    <select
                      className="sm"
                      value={m.role}
                      onChange={async (e) => {
                        try {
                          onChange(await teamApi.setRole(team.id, m.userId, e.target.value as Role));
                          toast.success("권한을 바꿨어요");
                        } catch (err) {
                          toast.error((err as Error).message);
                        }
                      }}
                    >
                      {roles.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    ROLE_LABEL[m.role]
                  )}
                </td>
                <td className="muted small">{new Date(m.joinedAt).toLocaleDateString("ko-KR")}</td>
                <td className="right">
                  {m.userId === meId && !team.personal ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        if (!confirm(`'${team.name}' 팀에서 나갈까요?`)) return;
                        try {
                          await teamApi.removeMember(team.id, meId);
                          await refreshTeams();
                          navigate("library");
                        } catch (err) {
                          toast.error((err as Error).message);
                        }
                      }}
                    >
                      나가기
                    </Button>
                  ) : canEdit ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        if (!confirm(`${m.name} 님을 팀에서 내보낼까요?`)) return;
                        try {
                          await teamApi.removeMember(team.id, m.userId);
                          reload();
                        } catch (err) {
                          toast.error((err as Error).message);
                        }
                      }}
                    >
                      내보내기
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="role-help">
        {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
          <span key={r}>
            <strong>{ROLE_LABEL[r]}</strong> {ROLE_HELP[r]}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── invites ────────────────────────────────────────────────

function copy(text: string, label = "복사했어요") {
  navigator.clipboard.writeText(text).then(
    () => toast.success(label),
    () => toast.error("복사하지 못했어요. 직접 선택해 복사하세요."),
  );
}

function InvitesTab({ team }: { team: TeamDetail }) {
  const [invites, setInvites] = useState<InviteInfo[] | null>(null);
  const [email, setEmail] = useState("");
  const [emailRole, setEmailRole] = useState<Role>("editor");
  const [emailResult, setEmailResult] = useState<{ link: string; mailDelivered: boolean; email: string } | null>(null);
  const [codeRole, setCodeRole] = useState<Role>("editor");
  const [codePassword, setCodePassword] = useState("");
  const [days, setDays] = useState(7);
  const [maxUses, setMaxUses] = useState(10);
  const [codeResult, setCodeResult] = useState<{ code: string; password: string } | null>(null);
  const roles: Role[] = team.role === "owner" ? ["admin", "editor", "viewer"] : ["admin", "editor", "viewer"].filter((r) => ROLE_RANK[r as Role] <= ROLE_RANK[team.role]) as Role[];

  useEffect(() => {
    teamApi.invites(team.id).then(setInvites, (err) => toast.error(err.message));
  }, [team.id]);

  const codeText = codeResult
    ? `RefBoard '${team.name}' 팀 초대\n접속: ${location.origin}\n로그인 후 [팀 → 코드로 참여]에 입력하세요.\n초대 코드: ${codeResult.code.replace(/(.{5})/, "$1-")}\n비밀번호: ${codeResult.password}`
    : "";

  return (
    <div className="invite-grid">
      <section className="panel">
        <h4>메일로 초대</h4>
        <p className="muted small">초대 링크는 입력한 메일 주소의 계정으로만 수락할 수 있어요 (7일 유효, 1회용).</p>
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await teamApi.inviteEmail(team.id, email, emailRole);
              setInvites(r.invites);
              setEmailResult({ link: r.link, mailDelivered: r.mailDelivered, email });
              setEmail("");
              toast.success(r.mailDelivered ? "초대 메일을 보냈어요" : "초대를 만들었어요 — 링크를 직접 전달하세요");
            } catch (err) {
              toast.error((err as Error).message);
            }
          }}
        >
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" required />
          <Select value={emailRole} onChange={setEmailRole} options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
          <Button type="submit" variant="primary">
            초대
          </Button>
        </form>
        {emailResult && (
          <div className="notice">
            {emailResult.mailDelivered ? `${emailResult.email} 로 초대 메일을 보냈어요.` : "메일 서버가 설정되지 않았어요. 아래 링크를 메신저 등으로 직접 전달하세요."}
            <div className="copy-row">
              <input readOnly value={emailResult.link} onFocus={(e) => e.target.select()} />
              <Button size="sm" onClick={() => copy(emailResult.link)}>
                링크 복사
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <h4>초대 코드 + 비밀번호</h4>
        <p className="muted small">코드와 비밀번호를 모두 알아야 참여할 수 있는 비공개 방식이에요. 비밀번호가 10번 틀리면 코드가 잠겨요.</p>
        <div className="grid-2">
          <Field label="권한">
            <Select value={codeRole} onChange={setCodeRole} options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
          </Field>
          <Field label="비밀번호" hint="비우면 자동 생성 (6자 이상)">
            <input value={codePassword} onChange={(e) => setCodePassword(e.target.value)} placeholder="자동 생성" maxLength={100} />
          </Field>
          <Field label="유효 기간 (일)">
            <NumberInput value={days} min={1} max={30} onChange={setDays} />
          </Field>
          <Field label="최대 사용 인원">
            <NumberInput value={maxUses} min={1} max={200} onChange={setMaxUses} />
          </Field>
        </div>
        <Button
          variant="primary"
          onClick={async () => {
            try {
              const r = await teamApi.inviteCode(team.id, { role: codeRole, password: codePassword || undefined, expiresInDays: days, maxUses });
              setInvites(r.invites);
              setCodeResult({ code: r.code, password: r.password });
              setCodePassword("");
            } catch (err) {
              toast.error((err as Error).message);
            }
          }}
        >
          초대 코드 만들기
        </Button>
        {codeResult && (
          <div className="code-result">
            <div>
              <span className="muted small">초대 코드</span>
              <strong className="mono">{codeResult.code.replace(/(.{5})/, "$1-")}</strong>
            </div>
            <div>
              <span className="muted small">비밀번호</span>
              <strong className="mono">{codeResult.password}</strong>
            </div>
            <p className="muted small">비밀번호는 지금만 보여요. 서버에는 암호화된 값만 저장돼요.</p>
            <Button size="sm" onClick={() => copy(codeText, "초대 안내문을 복사했어요")}>
              초대 안내문 복사
            </Button>
          </div>
        )}
      </section>

      <section className="panel span-2">
        <h4>초대 목록</h4>
        {!invites ? (
          <Spinner />
        ) : invites.length === 0 ? (
          <p className="muted small">아직 만든 초대가 없어요.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>방식</th>
                <th>대상</th>
                <th>권한</th>
                <th>사용</th>
                <th>만료</th>
                <th>상태</th>
                <th>만든 사람</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.kind === "email" ? "메일" : "코드"}</td>
                  <td className="mono">{i.kind === "email" ? i.email : i.code?.replace(/(.{5})/, "$1-")}</td>
                  <td>{ROLE_LABEL[i.role]}</td>
                  <td>
                    {i.uses}/{i.maxUses}
                  </td>
                  <td className="muted small">{new Date(i.expiresAt).toLocaleDateString("ko-KR")}</td>
                  <td>
                    <span className={"badge status-" + i.status}>{{ active: "사용 가능", used: "사용됨", expired: "만료", revoked: "취소됨", locked: "잠김" }[i.status]}</span>
                  </td>
                  <td className="muted small">{i.createdByName}</td>
                  <td className="right">
                    {i.status === "active" && (
                      <Button
                        size="sm"
                        onClick={async () => {
                          try {
                            setInvites(await teamApi.revokeInvite(team.id, i.id));
                          } catch (err) {
                            toast.error((err as Error).message);
                          }
                        }}
                      >
                        취소
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// ─── document defaults ──────────────────────────────────────

function DefaultsTab({ team, editable, onSaved }: { team: TeamDetail; editable: boolean; onSaved: (t: TeamDetail) => void }) {
  const [s, setS] = useState<DocSettings>(team.defaults);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setS(team.defaults);
    setDirty(false);
  }, [team.defaults]);
  const set = (fn: (d: DocSettings) => void) => {
    const next = structuredClone(s);
    fn(next);
    setS(next);
    setDirty(true);
  };
  const previews = useMemo(
    () => [
      createCoverPage(s),
      createReferencePage(s, { title: "", images: [], placeholders: 5 }),
      createCasePage(s, { title: "", images: [], logos: [], placeholders: { images: 4, logos: 2 } }),
    ],
    [s],
  );

  return (
    <div className="defaults-grid">
      <section className="panel">
        <h4>새 문서에 적용되는 기본 양식</h4>
        <p className="muted small">
          이 팀에서 새로 만드는 문서(자동 생성·빈 문서)는 이 설정으로 시작해요. 이미 만든 문서는 각 문서의 &lsquo;문서 양식&rsquo; 탭에서 바꿔요.
          {!editable && " (관리자만 수정할 수 있어요)"}
        </p>
        <fieldset disabled={!editable} className="defaults-form">
          <Field label="부서명 (하단 왼쪽 · 표지의 PRESENTED BY)" hint="예: BRAND STRATEGY TEAM, EMART BRAND DIVISION">
            <input value={s.footer.left} onChange={(e) => set((d) => void (d.footer.left = e.target.value))} maxLength={80} />
          </Field>
          <div className="grid-2">
            <Field label="하단 가운데">
              <input value={s.footer.center} onChange={(e) => set((d) => void (d.footer.center = e.target.value))} maxLength={80} />
            </Field>
            <Field label="하단 오른쪽" hint="{title} = 문서 제목">
              <input value={s.footer.right} onChange={(e) => set((d) => void (d.footer.right = e.target.value))} maxLength={80} />
            </Field>
          </div>
          <div className="row wrap">
            <Toggle checked={s.footer.show} onChange={(v) => set((d) => void (d.footer.show = v))} label="하단 태그라인" />
            <Toggle checked={s.footer.pageNumber} onChange={(v) => set((d) => void (d.footer.pageNumber = v))} label="페이지 번호" />
            <Toggle checked={s.footer.divider} onChange={(v) => set((d) => void (d.footer.divider = v))} label="구분선" />
          </div>
          <div className="grid-2">
            <Field label="번호 위치">
              <Segmented
                value={s.footer.pageNumberPos}
                onChange={(v) => set((d) => void (d.footer.pageNumberPos = v))}
                options={[
                  { value: "left", label: "왼쪽" },
                  { value: "center", label: "가운데" },
                  { value: "right", label: "오른쪽" },
                ]}
              />
            </Field>
            <Field label="번호 형식">
              <Select
                value={s.footer.pageNumberFormat}
                onChange={(v) => set((d) => void (d.footer.pageNumberFormat = v))}
                options={["{n}", "{nn}", "{n} / {total}", "- {n} -", "P. {n}"].map((v) => ({ value: v, label: v.replace("{nn}", "01").replace("{n}", "1").replace("{total}", "12") }))}
              />
            </Field>
          </div>
          <div className="grid-2">
            <Field label="페이지 크기">
              <Select value={s.pageSize} onChange={(v) => set((d) => void (d.pageSize = v))} options={Object.entries(PAGE_SIZES).map(([k, v]) => ({ value: k as PageSizeKey, label: v.label }))} />
            </Field>
            <Field label="강조색">
              <ColorInput value={s.accent} onChange={(v) => set((d) => void (d.accent = v ?? "#c8102e"))} />
            </Field>
          </div>
          <div className="grid-2">
            <Field label="타이포 프리셋">
              <select
                value=""
                onChange={(e) => {
                  const p = TYPOGRAPHY_PRESETS.find((x) => x.key === e.target.value);
                  if (!p) return;
                  set((d) => {
                    d.typography = structuredClone(REPORT_TYPOGRAPHY);
                    for (const [role, style] of Object.entries(p.apply)) Object.assign(d.typography[role as keyof typeof d.typography], style);
                  });
                }}
              >
                <option value="">적용…</option>
                {TYPOGRAPHY_PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="하단 양식 프리셋">
              <select
                value=""
                onChange={(e) => {
                  const p = FOOTER_PRESETS.find((x) => x.key === e.target.value);
                  if (p) set((d) => void (d.footer = { ...p.footer, left: d.footer.left || p.footer.left }));
                }}
              >
                <option value="">적용…</option>
                {FOOTER_PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid-2">
            <Field label="AI 글쓰기 관점">
              <select value={s.aiPerspective ?? "design"} onChange={(e) => set((d) => void (d.aiPerspective = e.target.value as AiPerspective))}>
                {AI_PERSPECTIVES.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="AI 문체">
              <select value={s.aiTone ?? "report"} onChange={(e) => set((d) => void (d.aiTone = e.target.value as AiTone))}>
                {AI_TONES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label} ({t.hint.split(" — ")[0]})
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="AI 작성 언어">
            <Segmented
              value={s.aiLanguage}
              onChange={(v) => set((d) => void (d.aiLanguage = v))}
              options={[
                { value: "ko", label: "한국어" },
                { value: "en", label: "English" },
              ]}
            />
          </Field>
        </fieldset>
        {editable && (
          <div className="row">
            <Button
              variant="primary"
              disabled={!dirty}
              onClick={async () => {
                try {
                  onSaved(await teamApi.saveDefaults(team.id, s));
                  toast.success("팀 문서 기본 설정을 저장했어요");
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            >
              저장
            </Button>
            {dirty && (
              <Button onClick={() => (setS(team.defaults), setDirty(false))} variant="ghost">
                되돌리기
              </Button>
            )}
          </div>
        )}
      </section>
      <section className="defaults-preview">
        <h4>미리보기</h4>
        {previews.map((p, i) => (
          <div key={p.id} className="page-preview">
            <PageView page={p} settings={s} index={i} total={previews.length} docTitle="Untitled" />
          </div>
        ))}
      </section>
    </div>
  );
}

// ─── activity ───────────────────────────────────────────────

function ActivityTab({ teamId }: { teamId: string }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [more, setMore] = useState(true);
  const ticks = useSession((s) => s.ticks);
  useEffect(() => {
    teamApi.activity(teamId).then((r) => {
      setItems(r);
      setMore(r.length >= 100);
    });
  }, [teamId, ticks.team, ticks.docs]);
  if (!items) return <Spinner />;
  if (!items.length) return <Empty title="아직 기록이 없어요" />;
  return (
    <div className="panel">
      <ul className="activity">
        {items.map((a) => (
          <li key={a.id}>
            <span className="muted small">{fmt(a.createdAt)}</span>
            <strong>{a.userName}</strong>
            <span>{a.summary}</span>
            {a.targetType === "doc" && a.targetId && (
              <a className="link-btn" href={`#/edit/${a.targetId}`}>
                열기
              </a>
            )}
          </li>
        ))}
      </ul>
      {more && (
        <Button
          size="sm"
          onClick={async () => {
            const r = await teamApi.activity(teamId, items[items.length - 1].id);
            setItems([...items, ...r]);
            setMore(r.length >= 100);
          }}
        >
          더 보기
        </Button>
      )}
    </div>
  );
}

// ─── settings ───────────────────────────────────────────────

function SettingsTab({ team, onChange }: { team: TeamDetail; onChange: (t: TeamDetail) => void }) {
  const refreshTeams = useSession((s) => s.refreshTeams);
  const [name, setName] = useState(team.name);
  const isAdmin = ROLE_RANK[team.role] >= ROLE_RANK.admin;
  return (
    <div className="panel narrow">
      <Field label="팀 이름">
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} disabled={!isAdmin} />
          {isAdmin && (
            <Button
              disabled={!name.trim() || name === team.name}
              onClick={async () => {
                try {
                  onChange(await teamApi.rename(team.id, name));
                  await refreshTeams(team.id);
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            >
              저장
            </Button>
          )}
        </div>
      </Field>
      {isAdmin && (
        <p className="muted small">
          팀 데이터 백업: <a href={`/api/teams/${team.id}/backup`}>JSON 내려받기</a> (레퍼런스·케이스·문서 전체)
        </p>
      )}
      {team.role === "owner" && !team.personal && (
        <div className="danger-zone">
          <h4>팀 삭제</h4>
          <p className="muted small">팀의 레퍼런스·케이스·문서가 모두 삭제되며 되돌릴 수 없어요. 먼저 백업하세요.</p>
          <Button
            variant="danger"
            onClick={async () => {
              const typed = prompt(`삭제하려면 팀 이름 '${team.name}'을(를) 정확히 입력하세요.`);
              if (typed === null) return;
              try {
                await teamApi.remove(team.id, typed);
                await refreshTeams();
                toast.success("팀을 삭제했어요");
                navigate("library");
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}
          >
            팀 삭제
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── create / join ──────────────────────────────────────────

export function CreateTeamButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const { refreshTeams, switchTeam } = useSession();
  return (
    <>
      <Button icon="plus" onClick={() => setOpen(true)}>
        팀 만들기
      </Button>
      {open && (
        <Modal title="새 팀 프로젝트" onClose={() => setOpen(false)} width={440}>
          <form
            className="auth-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const t = await teamApi.create(name);
                await refreshTeams(t.id);
                switchTeam(t.id);
                setOpen(false);
                toast.success(`'${t.name}' 팀을 만들었어요. 문서 기본 설정과 초대를 진행하세요.`);
                location.hash = "#/team?tab=defaults";
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}
          >
            <Field label="팀 이름">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 브랜드전략팀 스타디움 TF" maxLength={60} required autoFocus />
            </Field>
            <Button type="submit" variant="primary">
              만들기
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}

export function JoinByCodeButton() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { refreshTeams, switchTeam } = useSession();
  return (
    <>
      <Button onClick={() => setOpen(true)}>코드로 참여</Button>
      {open && (
        <Modal title="초대 코드로 팀 참여" onClose={() => setOpen(false)} width={440}>
          <form
            className="auth-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                const r = await teamApi.joinByCode(code, password);
                await refreshTeams(r.teamId);
                switchTeam(r.teamId);
                setOpen(false);
                toast.success(r.already ? "이미 참여한 팀이에요" : "팀에 참여했어요");
                navigate("library");
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <Field label="초대 코드">
              <input className="mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXXX-XXXXX" required autoFocus autoComplete="off" />
            </Field>
            <Field label="비밀번호">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="off" />
            </Field>
            {error && <div className="error-box">{error}</div>}
            <Button type="submit" variant="primary">
              참여
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
