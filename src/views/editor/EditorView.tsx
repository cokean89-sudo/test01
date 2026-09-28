import { useCallback, useEffect, useState } from "react";
import type { TextElement } from "../../../shared/types";
import { api } from "../../api";
import { Spinner } from "../../components/ui";
import { flushSave, useEditor } from "../../store/editor";
import { toast } from "../../store/toast";
import { PENDING_AI_KEY } from "../BuildDialog";
import { isDummyText } from "../../lib/dummy";
import { AI_FIELDS, analyzeRequestFor, applyAnalysis, contentImages, copySelection, deleteSelection, duplicateSelection, nudge, paste, reorder, type AiField } from "./actions";
import { AiDialog } from "./AiDialog";
import { Canvas } from "./Canvas";
import { ImagePicker } from "./ImagePicker";
import { Inspector } from "./Inspector";
import { PageList } from "./PageList";
import { Toolbar } from "./Toolbar";

export function EditorView({ id }: { id: string }) {
  const doc = useEditor((s) => s.doc);
  const modal = useEditor((s) => s.modal);
  const [error, setError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .document(id)
      .then((d) => {
        if (cancelled) return;
        useEditor.getState().open(d);
        if (sessionStorage.getItem(PENDING_AI_KEY) === d.id) {
          sessionStorage.removeItem(PENDING_AI_KEY);
          setTimeout(() => void runAiAll(), 300);
        }
      })
      .catch((err) => setError(err.message));
    return () => {
      cancelled = true;
      void flushSave().then(() => {
        if (useEditor.getState().doc?.id === id) useEditor.getState().close();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const aiPage = useCallback(() => {
    const { pageId, setModal } = useEditor.getState();
    if (pageId) setModal({ type: "ai", pageIds: [pageId] });
  }, []);

  /** 모든 페이지: 비어 있는 텍스트 칸과 캡션을 AI 로 채운다 (한 번의 실행 취소로 되돌릴 수 있음) */
  async function runAiAll() {
    const start = useEditor.getState().doc;
    if (!start) return;
    const targets = start.pages.filter((p) => (p.kind === "case" || p.kind === "reference") && contentImages(p).length > 0);
    if (!targets.length) {
      toast.info("분석할 이미지 페이지가 없습니다");
      return;
    }
    const ed = useEditor.getState();
    ed.begin();
    let notice: string | undefined;
    let done = 0;
    try {
      for (const [i, target] of targets.entries()) {
        setAiBusy(`${i + 1}/${targets.length}`);
        const cur = useEditor.getState().doc!;
        const page = cur.pages.find((p) => p.id === target.id);
        if (!page) continue;
        const result = await api.analyze(analyzeRequestFor(page, cur));
        notice ??= result.engine === "heuristic" ? result.notice : undefined;
        const textOf = (role: string) => page.elements.find((e): e is TextElement => e.type === "text" && e.role === role && !e.labelFor)?.text.trim() ?? "";
        const fields = new Set<AiField>();
        for (const f of AI_FIELDS) {
          if (!f.role) continue;
          const current = textOf(f.role);
          const autoTitle = f.key === "title" && page.kind === "reference" && current === (page.group ?? "");
          const autoSection = f.key === "sectionLabel" && /^Reference(\s*\(\d+\/\d+\))?$/.test(current);
          if (isDummyText(current) || autoTitle || autoSection) fields.add(f.key);
        }
        const filled = applyAnalysis(page, result, fields);
        // 캡션은 비어 있거나 더미(Lorem Ipsum)인 것만
        contentImages(filled).forEach((img, k) => {
          if (isDummyText(img.caption) && result.captions[k]) img.caption = result.captions[k];
        });
        useEditor.getState().update((d) => {
          const idx = d.pages.findIndex((p) => p.id === page.id);
          if (idx >= 0) d.pages[idx] = filled;
        });
        done++;
      }
      toast.success(notice ? `규칙 기반으로 ${done}페이지 작성 — ${notice}` : `AI 가 ${done}페이지의 빈 칸을 채웠습니다 (Ctrl+Z 로 되돌리기)`);
    } catch (err) {
      toast.error(`AI 작성 중단 (${done}/${targets.length}): ${(err as Error).message}`);
    } finally {
      useEditor.getState().end();
      setAiBusy(null);
    }
  }

  // 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (useEditor.getState().modal) return;
      const mod = e.metaKey || e.ctrlKey;
      const ed = useEditor.getState();
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) ed.redo();
        else ed.undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        ed.redo();
      } else if (mod && k === "d") {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && k === "c") {
        copySelection();
      } else if (mod && k === "v") {
        if (ed.clipboard.length) {
          e.preventDefault();
          paste();
        }
      } else if (mod && k === "a") {
        e.preventDefault();
        const page = ed.doc?.pages.find((p) => p.id === ed.pageId);
        if (page) ed.select(page.elements.map((x) => x.id));
      } else if (mod && (e.key === "]" || e.key === "[")) {
        e.preventDefault();
        reorder(e.key === "]" ? (e.shiftKey ? "front" : "forward") : e.shiftKey ? "back" : "backward");
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelection();
      } else if (e.key.startsWith("Arrow")) {
        if (ed.selection.length) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          nudge(e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0);
        } else if (ed.doc) {
          // 선택이 없으면 페이지 이동
          const idx = ed.doc.pages.findIndex((p) => p.id === ed.pageId);
          const next = ed.doc.pages[idx + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1)];
          if (next) {
            e.preventDefault();
            ed.setPage(next.id);
          }
        }
      } else if (e.key === "Escape") {
        ed.select([]);
        ed.setTool("select");
      } else if (e.key === "Enter" && ed.selection.length === 1) {
        const el = ed.doc?.pages.find((p) => p.id === ed.pageId)?.elements.find((x) => x.id === ed.selection[0]);
        if (el?.type === "text") {
          e.preventDefault();
          ed.setEditing(el.id);
        }
      } else if (!mod && !e.altKey) {
        const tools: Record<string, Parameters<typeof ed.setTool>[0]> = { v: "select", t: "text", r: "rect", o: "ellipse", l: "line" };
        if (tools[k]) ed.setTool(tools[k]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (error) return <div className="center-msg error-box">문서를 열 수 없습니다: {error}</div>;
  if (!doc || doc.id !== id) {
    return (
      <div className="center-msg">
        <Spinner size={22} />
      </div>
    );
  }

  return (
    <div className="editor">
      <Toolbar onAiPage={aiPage} onAiAll={runAiAll} aiBusy={aiBusy} />
      <div className="editor-body">
        <PageList />
        <Canvas />
        <Inspector onAiPage={aiPage} />
      </div>
      {modal?.type === "picker" && <ImagePicker mode={modal.mode} targetId={modal.targetId} />}
      {modal?.type === "ai" && <AiDialog pageId={modal.pageIds[0]} />}
    </div>
  );
}
