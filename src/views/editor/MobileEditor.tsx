// 휴대폰의 문서 화면 — 보기 + 글 고치기만. 페이지를 세로로 넘겨 보고, 글을 누르면 아래에서 올라오는 창에서 고친다.
// 배치 · 이미지 · 페이지 편집은 PC 편집기에서 한다. 고친 글은 PC 편집기와 같은 방식으로 자동 저장된다.

import { useState } from "react";
import type { TextElement } from "../../../shared/types";
import { Icon } from "../../components/icons";
import { PageView } from "../../components/PageView";
import { Button, Modal } from "../../components/ui";
import { navigate } from "../../lib/router";
import { useEditor } from "../../store/editor";
import { Presence } from "./Toolbar";
import { toast } from "../../store/toast";

const SAVE_LABEL = { saved: "저장됨", saving: "저장 중…", dirty: "저장 대기", error: "저장 실패" } as const;

export function MobileEditor() {
  const doc = useEditor((s) => s.doc)!;
  const readOnly = useEditor((s) => s.readOnly);
  const saveState = useEditor((s) => s.saveState);
  const [editing, setEditing] = useState<{ pageId: string; elId: string; text: string } | null>(null);

  /** 페이지 안의 글을 누르면 고치기 창 */
  const onTap = (pageId: string) => (e: React.MouseEvent) => {
    if (readOnly) return;
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-el-id]")?.dataset.elId;
    const el = doc.pages.find((p) => p.id === pageId)?.elements.find((x): x is TextElement => x.id === id && x.type === "text");
    if (!el) return;
    if (el.locked) return toast.info("잠긴 글이에요. PC 편집기에서 잠금을 풀 수 있어요.");
    setEditing({ pageId, elId: el.id, text: el.text });
  };

  const save = () => {
    if (!editing) return;
    useEditor.getState().update((d) => {
      const el = d.pages.find((p) => p.id === editing.pageId)?.elements.find((x) => x.id === editing.elId);
      if (el?.type === "text") el.text = editing.text;
    });
    setEditing(null);
    toast.success("글을 고쳤어요");
  };

  return (
    <div className="mobile-doc">
      <header className="mobile-doc-bar">
        <button className="icon-mini" onClick={() => navigate("docs")} aria-label="문서 목록으로">
          <Icon name="chevronLeft" size={20} />
        </button>
        <strong className="ellipsis">{doc.title || "제목 없는 문서"}</strong>
        {!readOnly && <span className={"mobile-save " + saveState}>{SAVE_LABEL[saveState]}</span>}
        <Presence />
        <Button size="sm" icon="play" onClick={() => navigate(`view/${doc.id}?present`)}>
          발표
        </Button>
      </header>
      <p className="mobile-doc-note">
        <Icon name="help" size={14} />
        {readOnly ? "보기 전용이에요." : "휴대폰에서는 보기와 글 고치기만 할 수 있어요. 글을 누르면 고쳐요. 배치 · 이미지 편집은 PC에서 해 주세요."}
      </p>
      <div className="mobile-pages">
        {doc.pages.map((p, i) => (
          <div key={p.id} className={"mobile-page" + (readOnly ? "" : " tappable")} onClick={onTap(p.id)}>
            <PageView page={p} settings={doc.settings} index={i} total={doc.pages.length} docTitle={doc.title} />
            <span className="viewer-num">{i + 1}</span>
          </div>
        ))}
      </div>
      {editing && (
        <Modal
          title="글 고치기"
          onClose={() => setEditing(null)}
          width={520}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>취소</Button>
              <Button variant="primary" onClick={save}>
                저장
              </Button>
            </>
          }
        >
          <textarea className="mobile-text" rows={6} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} autoFocus aria-label="글" />
        </Modal>
      )}
    </div>
  );
}
