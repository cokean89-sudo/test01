import { useEffect, useState } from "react";
import type { DocumentData, VersionInfo } from "../../../shared/types";
import { api } from "../../api";
import { PageView } from "../../components/PageView";
import { Button, Modal, Spinner } from "../../components/ui";
import { flushSave, useEditor } from "../../store/editor";
import { toast } from "../../store/toast";

/** 버전 기록 — 누가 언제 저장했는지 보고, 이전 버전을 미리 보거나 복원한다 */
export function HistoryDialog() {
  const doc = useEditor((s) => s.doc)!;
  const readOnly = useEditor((s) => s.readOnly);
  const setModal = useEditor((s) => s.setModal);
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

  const close = () => setModal(null);
  const current = versions?.[0]?.version;

  return (
    <Modal
      title="버전 기록"
      onClose={close}
      wide
      footer={
        <>
          <span className="muted">같은 사람이 10분 안에 이어서 저장한 내용은 하나로 묶어 보여줍니다.</span>
          <Button onClick={close}>닫기</Button>
          {!readOnly && (
            <Button
              variant="primary"
              disabled={!selected || selected === current || busy}
              onClick={async () => {
                if (!selected || !confirm(`v${selected} 버전으로 되돌릴까요? 현재 내용은 버전 기록에 남습니다.`)) return;
                setBusy(true);
                try {
                  await flushSave();
                  const restored = await api.restoreVersion(teamId, doc.id, selected);
                  useEditor.getState().open(restored);
                  toast.success(`v${selected} 버전으로 복원했습니다`);
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
        </>
      }
    >
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
    </Modal>
  );
}
