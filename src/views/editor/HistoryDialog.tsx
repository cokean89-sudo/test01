import { useEffect, useMemo, useRef, useState } from "react";
import type { DocActivity, DocumentData, VersionInfo } from "../../../shared/types";
import { api } from "../../api";
import { UserAvatar } from "../../components/Avatar";
import { PageView } from "../../components/PageView";
import { Button, Modal, Segmented, Spinner } from "../../components/ui";
import { flushSave, useEditor } from "../../store/editor";
import { toast } from "../../store/toast";

type Tab = "activity" | "versions";

/** 문서 히스토리 — [활동] 누가 언제 몇 페이지의 무엇을 바꿨는지 · [버전] 저장 시점별 미리 보기 · 복원 */
export function HistoryDialog() {
  const modal = useEditor((s) => s.modal);
  const setModal = useEditor((s) => s.setModal);
  const [tab, setTab] = useState<Tab>(modal?.type === "history" && modal.tab ? modal.tab : "activity");
  const close = () => setModal(null);
  return (
    <Modal
      title={
        <span className="history-title">
          문서 히스토리
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "activity", label: "활동" },
              { value: "versions", label: "버전" },
            ]}
          />
        </span>
      }
      onClose={close}
      wide
    >
      {tab === "activity" ? <ActivityTab onClose={close} /> : <VersionsTab onClose={close} />}
    </Modal>
  );
}

// ─── 활동 ────────────────────────────────────────────────────

const timeOf = (t: number) => new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
function dayOf(t: number) {
  const d = new Date(t);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "오늘";
  if (d.toDateString() === y.toDateString()) return "어제";
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

/** "타이틀 수정 외 2개" */
export function activitySummary(a: Pick<DocActivity, "items">): string {
  const [first, ...rest] = a.items;
  if (!first) return "수정";
  const one = `${first.label} ${first.action}`;
  return rest.length ? `${one} 외 ${rest.length}개` : one;
}

function ActivityTab({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc)!;
  const [rows, setRows] = useState<DocActivity[] | null>(null);
  const [more, setMore] = useState(false);
  const [who, setWho] = useState("");
  const [where, setWhere] = useState("");
  const teamId = doc.teamId!;

  // 문서가 바뀌면 (내 · 다른 사람 변경) 잠시 뒤 다시 불러온다
  const load = useRef<() => void>(() => undefined);
  load.current = () =>
    api.docActivity(teamId, doc.id).then(
      (r) => {
        setRows(r);
        setMore(r.length >= 300);
      },
      (err) => toast.error((err as Error).message),
    );
  useEffect(() => {
    const t = setTimeout(() => load.current(), rows ? 1200 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  const pageNo = useMemo(() => new Map(doc.pages.map((p, i) => [p.id, i + 1])), [doc.pages]);
  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows ?? []) if (r.userId) m.set(r.userId, r.userName);
    return [...m];
  }, [rows]);
  const shown = (rows ?? []).filter((r) => (!who || r.userId === who) && (!where || (where === "doc" ? !r.pageId : r.pageId === where)));

  function open(r: DocActivity) {
    if (!r.pageId) return;
    const page = doc.pages.find((p) => p.id === r.pageId);
    if (!page) {
      toast.info("삭제된 페이지예요");
      return;
    }
    const els = r.items.map((i) => i.el).filter((x): x is string => !!x);
    const live = els.filter((id) => page.elements.some((e) => e.id === id));
    const ed = useEditor.getState();
    onClose();
    ed.setPage(page.id);
    const color = r.userProfile?.color ?? "blue";
    ed.setHighlight({ pageId: page.id, ids: live, color, deleted: live.length < els.length, at: Date.now() });
    setTimeout(() => {
      if (useEditor.getState().highlight?.pageId === page.id) useEditor.getState().setHighlight(null);
    }, 2200);
  }

  let lastDay = "";
  return (
    <div className="activity-panel">
      <div className="activity-filters">
        <select className="sm" value={who} onChange={(e) => setWho(e.target.value)} aria-label="사람별">
          <option value="">모든 사람</option>
          {people.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select className="sm" value={where} onChange={(e) => setWhere(e.target.value)} aria-label="페이지별">
          <option value="">모든 페이지</option>
          {doc.pages.map((p, i) => (
            <option key={p.id} value={p.id}>
              {i + 1}페이지
            </option>
          ))}
          <option value="doc">문서 전체 (제목 · 양식 · 보관함)</option>
        </select>
        <span className="muted small">같은 사람이 같은 페이지에서 2분 안에 한 수정은 한 줄로 묶어요.</span>
      </div>
      {!rows ? (
        <Spinner />
      ) : !shown.length ? (
        <p className="muted activity-empty">{rows.length ? "조건에 맞는 활동이 없어요" : "아직 기록된 활동이 없어요"}</p>
      ) : (
        <ul className="doc-activity">
          {shown.map((r) => {
            const day = dayOf(r.updatedAt);
            const head = day !== lastDay ? <li className="doc-activity-day">{day}</li> : null;
            lastDay = day;
            const n = r.pageId ? pageNo.get(r.pageId) : undefined;
            const where = !r.pageId ? "문서" : n ? `${n}페이지` : "삭제된 페이지";
            return (
              <FragmentRow key={r.id} head={head}>
                <li>
                  <button className={"doc-activity-row" + (r.pageId && n ? "" : " static")} onClick={() => open(r)} data-activity={r.id}>
                    <UserAvatar profile={r.userProfile} name={r.userName} size="sm" />
                    <span className="doc-activity-text">
                      <span>
                        <strong>{r.userName}</strong> · {timeOf(r.updatedAt)} · {where} · {activitySummary(r)}
                      </span>
                      {r.items.length > 1 && <small className="muted">{r.items.map((i) => `${i.label} ${i.action}`).join(" · ")}</small>}
                    </span>
                  </button>
                </li>
              </FragmentRow>
            );
          })}
        </ul>
      )}
      {more && rows && (
        <Button
          size="sm"
          onClick={async () => {
            const r = await api.docActivity(teamId, doc.id, rows[rows.length - 1].updatedAt);
            setRows([...rows, ...r]);
            setMore(r.length >= 300);
          }}
        >
          더 보기
        </Button>
      )}
    </div>
  );
}

function FragmentRow({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      {head}
      {children}
    </>
  );
}

// ─── 버전 ────────────────────────────────────────────────────

/** 버전 — 누가 언제 고쳤는지 보고, 이전 버전을 미리 보거나 복원한다 */
function VersionsTab({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc)!;
  const readOnly = useEditor((s) => s.readOnly);
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<DocumentData | null>(null);
  const [busy, setBusy] = useState(false);
  const teamId = doc.teamId!;

  useEffect(() => {
    void flushSave().then(() =>
      api.versions(teamId, doc.id).then(
        (v) => {
          setVersions(v);
          setSelected(v[0]?.version ?? null);
        },
        (err) => toast.error(err.message),
      ),
    );
  }, [teamId, doc.id]);

  useEffect(() => {
    if (selected === null) return;
    setPreview(null);
    api.version(teamId, doc.id, selected).then(setPreview, (err) => toast.error(err.message));
  }, [teamId, doc.id, selected]);

  const current = versions?.[0]?.version;

  return (
    <>
      <div className="history">
        <ul className="history-list">
          {!versions && <Spinner />}
          {versions?.map((v) => (
            <li key={v.version}>
              <button className={selected === v.version ? "on" : ""} onClick={() => setSelected(v.version)}>
                <strong>{new Date(v.updatedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</strong>
                <span>
                  {v.updatedByName} · {v.pageCount}페이지 · v{v.version}
                  {v.version === current && <span className="badge">현재</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="history-preview">
          {!preview ? (
            <Spinner />
          ) : (
            <div className="page-preview-grid">
              {preview.pages.map((p, i) => (
                <div key={p.id} className="page-preview">
                  <PageView page={p} settings={preview.settings} index={i} total={preview.pages.length} mode="thumb" docTitle={preview.title} />
                  <span>{i + 1}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="history-foot">
        <span className="muted small">같은 사람이 10분 안에 이어서 고친 내용은 하나로 묶어 보여 줘요.</span>
        <Button onClick={onClose}>닫기</Button>
        {!readOnly && (
          <Button
            variant="primary"
            disabled={!selected || selected === current || busy}
            onClick={async () => {
              if (!selected || !confirm(`v${selected} 버전으로 되돌릴까요? 지금 내용도 버전으로 남아요.`)) return;
              setBusy(true);
              try {
                await flushSave();
                // 서버가 공동 편집 방에 반영하면 이 화면과 다른 사람 화면에 바로 보인다
                await api.restoreVersion(teamId, doc.id, selected);
                toast.success(`v${selected} 버전으로 복원했어요`);
                onClose();
              } catch (err) {
                toast.error((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            이 버전으로 복원
          </Button>
        )}
      </div>
    </>
  );
}
