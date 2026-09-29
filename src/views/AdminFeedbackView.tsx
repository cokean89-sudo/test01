// 관리자 — 받은 의견 목록. 메일이 실패했어도 여기에는 모두 남는다.

import { useCallback, useEffect, useState } from "react";
import { FEEDBACK_KINDS, type FeedbackItem } from "../../shared/feedback";
import { feedbackApi } from "../api";
import { Icon } from "../components/icons";
import { Button, Empty, Segmented, Spinner } from "../components/ui";
import { navigate } from "../lib/router";
import { useSession } from "../store/session";
import { toast } from "../store/toast";

type Filter = "open" | "done" | "all";

const MAIL_LABEL: Record<FeedbackItem["mailStatus"], string> = {
  sent: "메일 발송됨",
  skipped: "메일 미설정 (DB 에만 저장)",
  failed: "메일 실패",
  pending: "메일 보내는 중",
};

const kindLabel = (k: FeedbackItem["kind"]) => FEEDBACK_KINDS.find((x) => x.key === k)?.label ?? k;
const when = (t: number) => new Date(t).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });

export function AdminFeedbackView({ id }: { id?: string }) {
  const user = useSession((s) => s.user);
  const [filter, setFilter] = useState<Filter>("open");
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await feedbackApi.list(id ? "all" : filter);
      setItems(r.items);
      setOpenCount(r.open);
    } catch (err) {
      toast.error((err as Error).message);
      setItems([]);
    }
  }, [filter, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user?.isAdmin) {
    return (
      <div className="admin-page">
        <Empty emoji="🔒" title="관리자만 볼 수 있어요">
          <p>ADMIN_EMAILS 에 등록된 메일 계정으로 로그인하세요.</p>
        </Empty>
      </div>
    );
  }

  async function act(fb: FeedbackItem, fn: () => Promise<FeedbackItem>, done: string) {
    setBusy(fb.id);
    try {
      const next = await fn();
      setItems((prev) => prev?.map((x) => (x.id === next.id ? next : x)) ?? null);
      toast.success(done);
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const shown = id ? (items ?? []).filter((x) => x.id === id) : (items ?? []);

  return (
    <div className="admin-page">
      <div className="docs-head">
        {id && (
          <button className="icon-mini" onClick={() => navigate("admin/feedback")} aria-label="목록으로">
            <Icon name="chevronLeft" size={20} />
          </button>
        )}
        <h2>받은 의견</h2>
        <span className="muted small">처리할 의견 {openCount}건</span>
        <span className="spacer" />
        {!id && (
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "open", label: "처리 전" },
              { value: "done", label: "처리 완료" },
              { value: "all", label: "전체" },
            ]}
          />
        )}
        <Button icon="refresh" onClick={() => void load()} aria-label="새로고침" />
      </div>

      {items === null ? (
        <div className="center-msg">
          <Spinner size={20} />
        </div>
      ) : shown.length === 0 ? (
        <Empty emoji="📭" title={id ? "의견을 찾을 수 없어요" : filter === "open" ? "처리할 의견이 없어요" : "받은 의견이 없어요"} />
      ) : (
        <div className="fb-list">
          {shown.map((fb) => (
            <article key={fb.id} className={"panel fb-item" + (fb.status === "done" ? " done" : "")}>
              <header className="fb-head">
                <span className={`fb-kind fb-${fb.kind}`}>{kindLabel(fb.kind)}</span>
                <strong>{fb.userName}</strong>
                <span className="muted small">{fb.userEmail ?? "메일 없음"}</span>
                <span className="spacer" />
                <span className="muted small">{when(fb.createdAt)}</span>
              </header>
              <p className="fb-message">{fb.message}</p>
              {fb.files.length > 0 && (
                <div className="fb-shots">
                  {fb.files.map((f) => (
                    <a key={f.id} href={feedbackApi.fileUrl(fb.id, f.id)} target="_blank" rel="noreferrer" title={`${f.name} · ${(f.size / 1024 / 1024).toFixed(1)}MB`}>
                      <img src={feedbackApi.fileUrl(fb.id, f.id)} alt={f.name} loading="lazy" />
                    </a>
                  ))}
                </div>
              )}
              <dl className="fb-meta">
                <dt>페이지</dt>
                <dd className="ellipsis" title={fb.pageUrl}>
                  {fb.pageUrl || "—"}
                </dd>
                <dt>브라우저·OS</dt>
                <dd title={fb.userAgent}>{fb.browser || "—"}</dd>
                <dt>메일</dt>
                <dd className={fb.mailStatus === "failed" ? "danger" : ""} title={fb.mailError}>
                  {MAIL_LABEL[fb.mailStatus]}
                  {fb.mailError ? ` — ${fb.mailError}` : ""}
                </dd>
              </dl>
              <footer className="fb-actions">
                {!id && (
                  <button className="link-btn" onClick={() => navigate(`admin/feedback/${fb.id}`)}>
                    링크로 열기
                  </button>
                )}
                <span className="spacer" />
                {fb.mailStatus === "failed" && (
                  <Button size="sm" disabled={busy === fb.id} onClick={() => act(fb, () => feedbackApi.resend(fb.id), "메일을 다시 보냈어요")}>
                    메일 다시 보내기
                  </Button>
                )}
                {fb.status === "open" ? (
                  <Button size="sm" variant="primary" icon="check" disabled={busy === fb.id} onClick={() => act(fb, () => feedbackApi.setStatus(fb.id, "done"), "처리 완료로 표시했어요")}>
                    처리 완료
                  </Button>
                ) : (
                  <Button size="sm" disabled={busy === fb.id} onClick={() => act(fb, () => feedbackApi.setStatus(fb.id, "open"), "처리 전으로 되돌렸어요")}>
                    처리 전으로
                  </Button>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
