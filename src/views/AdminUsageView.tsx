// 관리자 — 사용량 대시보드. 이번 달 AI 예상 비용과 예산 대비 비율, 기능별 비율, 상위 사용자, 사용자별 · 팀별 · 모델별 표.
// 사용자별 한도(AI 글쓰기 · 태그 제안 · 개인 저장 공간)를 여기서 올리거나 내린다.

import { useCallback, useEffect, useState } from "react";
import type { UsageDashboard, UsageLimits, UsageUserRow } from "../../shared/types";
import { usageState } from "../../shared/usage";
import { usageApi, type LimitPatch } from "../api";
import { Button, Empty, Modal, Select, Spinner } from "../components/ui";
import { formatBytes } from "../lib/uploads";
import { useSession } from "../store/session";
import { toast } from "../store/toast";

const n = (v: number) => v.toLocaleString("ko-KR");
const usd = (v: number) => (v === 0 ? "$0" : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4).replace(/0+$/, "")}`);
const compact = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 10_000 ? `${Math.round(v / 1000)}K` : n(v));
const monthLabel = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export function AdminUsageView() {
  const user = useSession((s) => s.user);
  const [month, setMonth] = useState<string>("");
  const [data, setData] = useState<UsageDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<UsageUserRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await usageApi.dashboard(month || undefined));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    if (user?.isAdmin) void load();
  }, [load, user?.isAdmin]);

  if (!user?.isAdmin) {
    return (
      <div className="admin-page">
        <Empty emoji="🔒" title="관리자만 볼 수 있어요">
          <p>ADMIN_EMAILS 에 등록된 메일 계정으로 로그인하세요.</p>
        </Empty>
      </div>
    );
  }

  return (
    <div className="admin-page usage-dash">
      <div className="docs-head">
        <h2>사용량</h2>
        <span className="muted small">베타 기간 사용 한도 · 매월 1일(한국 시간)에 초기화</span>
        <span className="spacer" />
        {data && (
          <Select<string> value={data.month} onChange={setMonth} options={data.months.map((m) => ({ value: m, label: monthLabel(m) }))} />
        )}
        <Button icon="refresh" onClick={() => void load()} aria-label="새로고침" />
      </div>

      {!data ? (
        <div className="center-msg">
          <Spinner size={20} />
        </div>
      ) : (
        <div className={"usage-dash-body" + (loading ? " stale" : "")}>
          <Kpis d={data} />
          <div className="usage-dash-grid">
            <FeatureShare d={data} />
            <TopUsers d={data} />
          </div>
          <UsersTable d={data} onEdit={setEditing} />
          <TeamsTable d={data} />
          <ModelsTable d={data} />
        </div>
      )}

      {editing && data && (
        <LimitDialog
          row={editing}
          defaults={data.defaults}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

// ─── 숫자 요약 ───────────────────────────────────────────

function Meter({ used, limit, label }: { used: number; limit: number; label: string }) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 1;
  return (
    <div className={`dash-meter ${usageState(used, limit)}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
      <i style={{ width: `${used ? Math.max(ratio * 100, 1) : 0}%` }} />
    </div>
  );
}

function Kpis({ d }: { d: UsageDashboard }) {
  const ai = d.features.filter((f) => f.key.startsWith("ai.")).reduce((a, f) => a + f.count, 0);
  const write = d.features.find((f) => f.key === "ai.write")?.count ?? 0;
  const tag = d.features.find((f) => f.key === "ai.tag")?.count ?? 0;
  const active = d.users.filter((u) => u.aiWrite + u.aiTag + u.aiOther + u.uploads + u.exports + u.docsCreated > 0).length;
  const budgetPct = pct(d.budget.spentUsd, d.budget.budgetUsd);
  return (
    <div className="dash-kpis">
      <section className="panel dash-kpi dash-kpi-hero">
        <span className="dash-kpi-label">이번 달 AI 예상 비용</span>
        <strong className="dash-hero">{usd(d.budget.spentUsd)}</strong>
        <Meter used={d.budget.spentUsd} limit={d.budget.budgetUsd} label="AI 예산 사용 비율" />
        <span className="dash-kpi-sub">
          월 예산 {usd(d.budget.budgetUsd)}의 {budgetPct}%
          {d.budget.paused && <span className="badge dash-paused">⏸ AI 쉬는 중</span>}
        </span>
      </section>
      <section className="panel dash-kpi">
        <span className="dash-kpi-label">AI 호출</span>
        <strong className="dash-value">{n(ai)}회</strong>
        <span className="dash-kpi-sub">
          글쓰기 {n(write)} · 태그 제안 {n(tag)}
        </span>
      </section>
      <section className="panel dash-kpi">
        <span className="dash-kpi-label">서비스 저장 공간</span>
        <strong className="dash-value">{formatBytes(d.storage.usedBytes)}</strong>
        <Meter used={d.storage.usedBytes} limit={d.storage.limitBytes} label="서비스 저장 공간 사용 비율" />
        <span className="dash-kpi-sub">
          전체 {formatBytes(d.storage.limitBytes)}의 {pct(d.storage.usedBytes, d.storage.limitBytes)}% · 팀당 {formatBytes(d.storage.teamLimitBytes)}
        </span>
      </section>
      <section className="panel dash-kpi">
        <span className="dash-kpi-label">이번 달 쓴 사람</span>
        <strong className="dash-value">{n(active)}명</strong>
        <span className="dash-kpi-sub">팀 {n(d.teams.length)}곳</span>
      </section>
    </div>
  );
}

// ─── 막대 (한 가지 색, 끝에 값) ─────────────────────────────

function BarList({ rows, empty }: { rows: { key: string; label: string; sub?: string; value: number; tip: string; valueLabel: string }[]; empty: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (!max) return <p className="muted small">{empty}</p>;
  return (
    <ul className="bar-list">
      {rows.map((r) => (
        <li key={r.key} className="bar-row" tabIndex={0} aria-label={r.tip}>
          <span className="bar-label ellipsis" title={r.sub ? `${r.label} · ${r.sub}` : r.label}>
            {r.label}
            {r.sub && <small className="muted"> {r.sub}</small>}
          </span>
          <span className="bar-track">
            <i style={{ width: `${r.value ? Math.max((r.value / max) * 100, 1) : 0}%` }} />
            <span className="bar-value">{r.valueLabel}</span>
          </span>
          <span className="bar-tip" role="tooltip">
            {r.tip}
          </span>
        </li>
      ))}
    </ul>
  );
}

function FeatureShare({ d }: { d: UsageDashboard }) {
  const total = d.features.reduce((a, f) => a + f.count, 0);
  const rows = [...d.features]
    .sort((a, b) => b.count - a.count)
    .map((f) => ({
      key: f.key,
      label: f.label,
      value: f.count,
      valueLabel: `${pct(f.count, total)}%`,
      tip: `${f.label}: ${n(f.count)}회 (${pct(f.count, total)}%)${f.costUsd ? ` · 예상 비용 ${usd(f.costUsd)}` : ""}`,
    }));
  return (
    <section className="panel dash-card">
      <h4>기능별 비율</h4>
      <p className="muted small">이번 달 사용 횟수 {n(total)}회 중</p>
      <BarList rows={rows} empty="아직 사용 기록이 없어요." />
    </section>
  );
}

function TopUsers({ d }: { d: UsageDashboard }) {
  const rows = [...d.users]
    .filter((u) => u.aiWrite + u.aiTag + u.aiOther > 0)
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 5)
    .map((u) => ({
      key: u.id,
      label: u.name,
      sub: u.email ?? undefined,
      value: u.costUsd,
      valueLabel: usd(u.costUsd),
      tip: `${u.name}: 예상 비용 ${usd(u.costUsd)} · 글쓰기 ${n(u.aiWrite)} · 태그 제안 ${n(u.aiTag)}`,
    }));
  return (
    <section className="panel dash-card">
      <h4>AI 상위 사용자</h4>
      <p className="muted small">예상 비용 순 · 상위 5명</p>
      <BarList rows={rows} empty="이번 달 AI 를 쓴 사람이 없어요." />
    </section>
  );
}

// ─── 표 ────────────────────────────────────────────────────

function Used({ used, limit, fmt = n }: { used: number; limit: number | null; fmt?: (v: number) => string }) {
  const state = limit === null ? "ok" : usageState(used, limit);
  return (
    <span className={`dash-used ${state}`}>
      {fmt(used)}
      {limit !== null && <small> / {fmt(limit)}</small>}
      {state === "full" && <span className="sr-only"> (한도 도달)</span>}
    </span>
  );
}

function UsersTable({ d, onEdit }: { d: UsageDashboard; onEdit: (u: UsageUserRow) => void }) {
  return (
    <section className="panel dash-card">
      <h4>사용자별</h4>
      {d.users.length === 0 ? (
        <p className="muted small">이 달에는 기록이 없어요.</p>
      ) : (
        <div className="table-scroll">
          <table className="table dash-table">
            <thead>
              <tr>
                <th>사용자</th>
                <th className="right">AI 글쓰기</th>
                <th className="right">AI 태그 제안</th>
                <th className="right">토큰 (입력 / 출력)</th>
                <th className="right">예상 비용</th>
                <th className="right">올린 이미지</th>
                <th className="right">저장 공간</th>
                <th className="right">새 문서</th>
                <th className="right">내보내기</th>
                <th>한도</th>
              </tr>
            </thead>
            <tbody>
              {d.users.map((u) => {
                const lim = (v: number) => (u.isAdmin ? null : v);
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="dash-user">
                        <strong className="ellipsis">{u.name}</strong>
                        <span className="muted small ellipsis">{u.email ?? "소셜 로그인"}</span>
                      </div>
                    </td>
                    <td className="right">
                      <Used used={u.aiWrite} limit={lim(u.limits.aiWriteMonthly)} />
                    </td>
                    <td className="right">
                      <Used used={u.aiTag} limit={lim(u.limits.aiTagMonthly)} />
                    </td>
                    <td className="right num">
                      {compact(u.inputTokens)} / {compact(u.outputTokens)}
                    </td>
                    <td className="right num">{usd(u.costUsd)}</td>
                    <td className="right num">
                      {n(u.uploads)}
                      {u.uploadBytes > 0 && <small className="muted"> · {formatBytes(u.uploadBytes)}</small>}
                    </td>
                    <td className="right">
                      <Used used={u.storageBytes} limit={lim(u.limits.userStorageBytes)} fmt={formatBytes} />
                    </td>
                    <td className="right num">{n(u.docsCreated)}</td>
                    <td className="right num">{n(u.exports)}</td>
                    <td>
                      {u.isAdmin ? (
                        <span className="badge">관리자 · 한도 없음</span>
                      ) : (
                        <div className="row">
                          {u.overrides && <span className="badge badge-accent">조정됨</span>}
                          <Button size="sm" onClick={() => onEdit(u)}>
                            조정
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TeamsTable({ d }: { d: UsageDashboard }) {
  return (
    <section className="panel dash-card">
      <h4>팀별</h4>
      {d.teams.length === 0 ? (
        <p className="muted small">이 달에는 기록이 없어요.</p>
      ) : (
        <div className="table-scroll">
          <table className="table dash-table">
            <thead>
              <tr>
                <th>팀</th>
                <th className="right">멤버</th>
                <th className="right">AI 호출</th>
                <th className="right">예상 비용</th>
                <th className="right">올린 이미지</th>
                <th className="right">저장 공간</th>
                <th className="right">문서 (전체 · 새로)</th>
                <th className="right">내보내기</th>
              </tr>
            </thead>
            <tbody>
              {d.teams.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong className="ellipsis">{t.name}</strong>
                  </td>
                  <td className="right num">{n(t.members)}</td>
                  <td className="right num">{n(t.aiCalls)}</td>
                  <td className="right num">{usd(t.costUsd)}</td>
                  <td className="right num">
                    {n(t.uploads)}
                    {t.uploadBytes > 0 && <small className="muted"> · {formatBytes(t.uploadBytes)}</small>}
                  </td>
                  <td className="right">
                    <Used used={t.storageBytes} limit={d.storage.teamLimitBytes} fmt={formatBytes} />
                  </td>
                  <td className="right num">
                    {n(t.docsTotal)} · {n(t.docsCreated)}
                  </td>
                  <td className="right num">{n(t.exports)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ModelsTable({ d }: { d: UsageDashboard }) {
  const total = d.models.reduce((a, m) => a + m.costUsd, 0);
  return (
    <section className="panel dash-card">
      <h4>모델별 AI 사용</h4>
      <p className="muted small">예상 비용은 모델별 단가 × 토큰 수로 계산한 값이에요 (실제 청구 금액과 조금 다를 수 있어요).</p>
      {d.models.length === 0 ? (
        <p className="muted small">이 달에는 AI 를 쓴 기록이 없어요.</p>
      ) : (
        <div className="table-scroll">
          <table className="table dash-table">
            <thead>
              <tr>
                <th>모델</th>
                <th className="right">호출</th>
                <th className="right">입력 토큰</th>
                <th className="right">출력 토큰</th>
                <th className="right">캐시 토큰</th>
                <th className="right">예상 비용</th>
                <th className="right">비율</th>
              </tr>
            </thead>
            <tbody>
              {d.models.map((m) => (
                <tr key={m.model}>
                  <td>
                    <code>{m.model}</code>
                  </td>
                  <td className="right num">{n(m.calls)}</td>
                  <td className="right num">{n(m.inputTokens)}</td>
                  <td className="right num">{n(m.outputTokens)}</td>
                  <td className="right num">{n(m.cacheTokens)}</td>
                  <td className="right num">{usd(m.costUsd)}</td>
                  <td className="right num">{pct(m.costUsd, total)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── 사용자별 한도 조정 ─────────────────────────────────────

const LIMIT_FIELDS: { key: keyof LimitPatch; label: string; unit: string; def: (l: UsageLimits) => number }[] = [
  { key: "aiWriteMonthly", label: "AI 글쓰기 · 한 달", unit: "회", def: (l) => l.aiWriteMonthly },
  { key: "aiWriteDaily", label: "AI 글쓰기 · 하루", unit: "회", def: (l) => l.aiWriteDaily },
  { key: "aiTagMonthly", label: "AI 태그 제안 · 한 달", unit: "회", def: (l) => l.aiTagMonthly },
  { key: "aiTagDaily", label: "AI 태그 제안 · 하루", unit: "회", def: (l) => l.aiTagDaily },
  { key: "userStorageMb", label: "개인 저장 공간", unit: "MB", def: (l) => Math.round(l.userStorageBytes / 1024 ** 2) },
];

function LimitDialog({ row, defaults, onClose, onSaved }: { row: UsageUserRow; defaults: UsageLimits; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, row.overrides?.[f.key] !== undefined ? String(row.overrides[f.key]) : ""])),
  );
  const [saving, setSaving] = useState(false);

  async function save(reset = false) {
    const patch: LimitPatch = {};
    for (const f of LIMIT_FIELDS) {
      const raw = reset ? "" : values[f.key].trim();
      if (raw !== "" && !/^\d+$/.test(raw)) return toast.error(`${f.label}에는 0 이상의 정수를 적어 주세요.`);
      patch[f.key] = raw === "" ? null : Number(raw);
    }
    setSaving(true);
    try {
      await usageApi.setUserLimits(row.id, patch);
      toast.success(reset ? `${row.name} 님의 한도를 기본값으로 되돌렸어요` : `${row.name} 님의 한도를 바꿨어요`);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`${row.name} 님의 한도`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={() => void save(true)} disabled={saving || !row.overrides}>
            기본값으로 되돌리기
          </Button>
          <span className="spacer" />
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            저장
          </Button>
        </>
      }
    >
      <p className="muted small">비워 두면 베타 기간 기본값을 써요. 0 으로 두면 그 기능을 쓸 수 없어요.</p>
      <div className="limit-form">
        {LIMIT_FIELDS.map((f) => (
          <label key={f.key} className="limit-field">
            <span>{f.label}</span>
            <span className="limit-input">
              <input
                inputMode="numeric"
                value={values[f.key]}
                placeholder={`기본 ${n(f.def(defaults))}`}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                aria-label={f.label}
              />
              <small className="muted">{f.unit}</small>
            </span>
          </label>
        ))}
      </div>
    </Modal>
  );
}
