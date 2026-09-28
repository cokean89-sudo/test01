import { create } from "zustand";
import type { DocumentData, Page, PageElement } from "../../shared/types";
import { api } from "../api";

export type Tool = "select" | "text" | "rect" | "ellipse" | "line";

export type EditorModal =
  | { type: "picker"; mode: "add" | "replace"; targetId?: string }
  | { type: "ai"; pageIds: string[] }
  | null;

interface EditorState {
  doc: DocumentData | null;
  pageId: string | null;
  selection: string[];
  tool: Tool;
  editingId: string | null;
  past: DocumentData[];
  future: DocumentData[];
  saveState: "saved" | "saving" | "dirty" | "error";
  zoom: number | "fit";
  /** '맞춤' 배율 (캔버스가 계산) */
  fitScale: number;
  clipboard: PageElement[];
  txBase: DocumentData | null;
  lastKey: { key: string; at: number } | null;
  modal: EditorModal;

  open: (doc: DocumentData) => void;
  close: () => void;
  /** draft(깊은 복사본)를 수정하는 방식의 변경 — 실행 취소 기록이 남는다. key 가 같으면 연속 입력을 하나로 묶는다. */
  update: (recipe: (draft: DocumentData) => void, opts?: { key?: string }) => void;
  /** 드래그처럼 연속 변경의 시작/끝 — 끝날 때 한 번만 기록 */
  begin: () => void;
  end: () => void;
  patchTransient: (pageId: string, patches: Record<string, Partial<PageElement>>) => void;
  undo: () => void;
  redo: () => void;
  setPage: (id: string) => void;
  select: (ids: string[]) => void;
  setTool: (tool: Tool) => void;
  setEditing: (id: string | null) => void;
  setZoom: (zoom: number | "fit") => void;
  setFitScale: (scale: number) => void;
  setClipboard: (els: PageElement[]) => void;
  setModal: (modal: EditorModal) => void;
}

const HISTORY = 120;

export const useEditor = create<EditorState>((set, get) => ({
  doc: null,
  pageId: null,
  selection: [],
  tool: "select",
  editingId: null,
  past: [],
  future: [],
  saveState: "saved",
  zoom: "fit",
  fitScale: 1,
  clipboard: [],
  txBase: null,
  lastKey: null,
  modal: null,

  open(doc) {
    set({
      doc,
      pageId: doc.pages[0]?.id ?? null,
      selection: [],
      editingId: null,
      past: [],
      future: [],
      saveState: "saved",
      tool: "select",
      txBase: null,
      lastKey: null,
      modal: null,
    });
  },

  close() {
    set({ doc: null, pageId: null, selection: [], past: [], future: [] });
  },

  update(recipe, opts) {
    const { doc, past, txBase, lastKey } = get();
    if (!doc) return;
    const draft = structuredClone(doc);
    recipe(draft);
    shareUnchanged(draft, doc);
    const now = Date.now();
    const coalesce = !!opts?.key && lastKey?.key === opts.key && now - lastKey.at < 1500;
    const pushHistory = !txBase && !coalesce;
    // 현재 페이지가 삭제되었으면 가까운 페이지로 이동
    let pageId = get().pageId;
    if (!draft.pages.some((p) => p.id === pageId)) {
      const idx = doc.pages.findIndex((p) => p.id === pageId);
      pageId = draft.pages[Math.min(Math.max(idx, 0), draft.pages.length - 1)]?.id ?? null;
    }
    set({
      doc: draft,
      pageId,
      past: pushHistory ? [...past, doc].slice(-HISTORY) : past,
      future: txBase ? get().future : [],
      lastKey: opts?.key ? { key: opts.key, at: now } : null,
    });
  },

  begin() {
    const { doc } = get();
    if (doc) set({ txBase: doc });
  },

  end() {
    const { txBase, doc, past } = get();
    if (!txBase) return;
    set({ txBase: null, ...(doc !== txBase ? { past: [...past, txBase].slice(-HISTORY), future: [], lastKey: null } : {}) });
  },

  patchTransient(pageId, patches) {
    const { doc } = get();
    if (!doc) return;
    set({
      doc: {
        ...doc,
        pages: doc.pages.map((p) =>
          p.id !== pageId
            ? p
            : { ...p, elements: p.elements.map((e) => (patches[e.id] ? ({ ...e, ...patches[e.id] } as PageElement) : e)) },
        ),
      },
    });
  },

  undo() {
    const { past, doc, future } = get();
    if (!past.length || !doc) return;
    const prev = past[past.length - 1];
    set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future], selection: [], editingId: null, lastKey: null });
    ensurePage();
  },

  redo() {
    const { past, doc, future } = get();
    if (!future.length || !doc) return;
    const next = future[0];
    set({ doc: next, past: [...past, doc], future: future.slice(1), selection: [], editingId: null, lastKey: null });
    ensurePage();
  },

  setPage(id) {
    set({ pageId: id, selection: [], editingId: null });
  },
  select(ids) {
    set({ selection: ids, editingId: get().editingId && ids.includes(get().editingId!) ? get().editingId : null });
  },
  setTool(tool) {
    set({ tool, editingId: null });
  },
  setEditing(id) {
    set({ editingId: id, selection: id ? [id] : get().selection });
  },
  setZoom(zoom) {
    set({ zoom });
  },
  setFitScale(fitScale) {
    if (fitScale !== get().fitScale) set({ fitScale });
  },
  setClipboard(els) {
    set({ clipboard: els });
  },
  setModal(modal) {
    set({ modal });
  },
}));

/** 바뀌지 않은 페이지/설정은 이전 객체를 재사용 — 썸네일 등의 불필요한 리렌더를 막는다 */
function shareUnchanged(draft: DocumentData, prev: DocumentData) {
  const prevPages = new Map(prev.pages.map((p) => [p.id, p]));
  draft.pages = draft.pages.map((p) => {
    const old = prevPages.get(p.id);
    return old && JSON.stringify(old) === JSON.stringify(p) ? old : p;
  });
  if (JSON.stringify(draft.settings) === JSON.stringify(prev.settings)) draft.settings = prev.settings;
}

function ensurePage() {
  const { doc, pageId } = useEditor.getState();
  if (doc && !doc.pages.some((p) => p.id === pageId)) useEditor.setState({ pageId: doc.pages[0]?.id ?? null });
}

export function currentPage(): Page | undefined {
  const { doc, pageId } = useEditor.getState();
  return doc?.pages.find((p) => p.id === pageId);
}

export function useCurrentPage(): Page | undefined {
  return useEditor((s) => s.doc?.pages.find((p) => p.id === s.pageId));
}

/** draft 안에서 페이지를 찾아 수정 */
export function withPage(draft: DocumentData, pageId: string, fn: (page: Page, index: number) => Page | void): void {
  const idx = draft.pages.findIndex((p) => p.id === pageId);
  if (idx < 0) return;
  const out = fn(draft.pages[idx], idx);
  if (out) draft.pages[idx] = out;
}

// ─── autosave ───────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;

async function doSave(): Promise<void> {
  const { doc } = useEditor.getState();
  if (!doc) return;
  useEditor.setState({ saveState: "saving" });
  try {
    await api.saveDocument(doc);
    if (useEditor.getState().doc === doc) useEditor.setState({ saveState: "saved" });
    else useEditor.setState({ saveState: "dirty" });
  } catch {
    useEditor.setState({ saveState: "error" });
  }
}

export function flushSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saving = doSave();
  }
  return saving ?? Promise.resolve();
}

useEditor.subscribe((state, prev) => {
  if (!state.doc || !prev.doc || state.doc === prev.doc || state.doc.id !== prev.doc.id) return;
  if (state.saveState !== "dirty") useEditor.setState({ saveState: "dirty" });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saving = doSave();
  }, 700);
});

window.addEventListener("beforeunload", (e) => {
  if (saveTimer || useEditor.getState().saveState === "saving") {
    void flushSave();
    e.preventDefault();
  }
});
