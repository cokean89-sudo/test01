import { create } from "zustand";
import { mergeDocuments } from "../../shared/merge";
import type { DocumentData, Page, PageElement, PresenceUser } from "../../shared/types";
import { api, ApiError } from "../api";
import { toast } from "./toast";

export type Tool = "select" | "text" | "rect" | "ellipse" | "line";

export type EditorModal =
  | { type: "picker"; mode: "add" | "replace"; targetId?: string }
  | { type: "ai"; pageIds: string[] }
  | { type: "history" }
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
  /** 서버에 저장된 버전 (동시 편집 병합 기준) */
  version: number;
  /** 보기 전용 권한이면 편집 불가 */
  readOnly: boolean;
  /** 같은 문서를 보고 있는 팀원 */
  presence: PresenceUser[];

  open: (doc: DocumentData, opts?: { readOnly?: boolean }) => void;
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
  version: 1,
  readOnly: false,
  presence: [],

  open(doc, opts) {
    serverDoc = doc;
    set({
      doc,
      version: doc.version ?? 1,
      readOnly: !!opts?.readOnly,
      presence: [],
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
    const { doc, past, txBase, lastKey, readOnly } = get();
    if (!doc || readOnly) return;
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
    const { doc, readOnly } = get();
    if (!doc || readOnly) return;
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

// ─── autosave & 동시 편집 ─────────────────────────────────────

/** 서버가 알고 있는 마지막 문서 상태 (state.version 에 해당) */
let serverDoc: DocumentData | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;

const meta = (d: DocumentData, from: DocumentData): DocumentData => ({ ...d, id: from.id, teamId: from.teamId, version: from.version });

/**
 * base 를 기준으로 만든 로컬 상태(현재 문서·실행 취소 기록)에 theirs(다른 사람 변경이 포함된 서버 문서)를 합친다.
 * 실행 취소 기록도 함께 옮겨서, 되돌리기를 해도 다른 사람의 변경은 사라지지 않게 한다.
 */
function rebaseOnto(base: DocumentData, theirs: DocumentData) {
  const st = useEditor.getState();
  if (!st.doc) return;
  const fix = (d: DocumentData) => (d === base ? theirs : meta(mergeDocuments(base, d, theirs).value, theirs));
  const doc = fix(st.doc);
  const pages = new Set(doc.pages.map((p) => p.id));
  const elements = new Set(doc.pages.flatMap((p) => p.elements.map((e) => e.id)));
  useEditor.setState({
    doc,
    past: st.past.slice(-30).map(fix),
    future: st.future.slice(0, 30).map(fix),
    txBase: st.txBase ? fix(st.txBase) : null,
    pageId: st.pageId && pages.has(st.pageId) ? st.pageId : (doc.pages[0]?.id ?? null),
    selection: st.selection.filter((id) => elements.has(id)),
    editingId: st.editingId && elements.has(st.editingId) ? st.editingId : null,
  });
}

function scheduleSave(delay = 700) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saving = doSave().finally(() => {
      saving = null;
    });
  }, delay);
}

async function doSave(): Promise<void> {
  const st = useEditor.getState();
  const snapshot = st.doc;
  if (!snapshot || st.readOnly) return;
  if (snapshot === serverDoc) {
    useEditor.setState({ saveState: "saved" });
    return;
  }
  // 드래그 중에는 끝난 뒤 저장
  if (st.txBase) {
    scheduleSave(400);
    return;
  }
  useEditor.setState({ saveState: "saving" });
  try {
    const res = await api.saveDocument(snapshot, st.version);
    if (useEditor.getState().doc?.id !== snapshot.id) return;
    if (res.merged && res.doc) {
      rebaseOnto(snapshot, res.doc);
      serverDoc = res.doc;
    } else {
      serverDoc = snapshot;
    }
    const now = useEditor.getState();
    useEditor.setState({ version: res.version, saveState: now.doc === serverDoc ? "saved" : "dirty" });
    if (now.doc !== serverDoc) scheduleSave(300);
  } catch (err) {
    useEditor.setState({ saveState: "error" });
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      useEditor.setState({ readOnly: true });
      toast.error("이 문서를 편집할 권한이 없어요: " + err.message);
    } else {
      // 네트워크 오류 등 — 잠시 후 다시 시도
      scheduleSave(5000);
    }
  }
}

export function flushSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saving = doSave().finally(() => {
      saving = null;
    });
  }
  return saving ?? Promise.resolve();
}

/** 다른 팀원이 저장했다는 알림을 받으면 최신 문서를 받아 내 편집과 합친다 */
export async function pullRemote(version: number, byName?: string) {
  const st = useEditor.getState();
  if (!st.doc || version <= st.version) return;
  if (saveTimer || saving || st.doc !== serverDoc) {
    // 내 저장할 변경이 있으면 저장하면서 서버가 병합한다
    await flushSave();
    if (useEditor.getState().version >= version) return;
  }
  const fresh = await api.document(st.doc.id);
  const cur = useEditor.getState();
  if (!cur.doc || cur.doc.id !== fresh.id || (fresh.version ?? 0) <= cur.version || !serverDoc) return;
  rebaseOnto(serverDoc, fresh);
  serverDoc = fresh;
  useEditor.setState({ version: fresh.version ?? cur.version });
  if (useEditor.getState().doc !== fresh) scheduleSave(300);
  if (byName) toast.info(`${byName} 님의 변경 사항을 반영했어요`);
}

useEditor.subscribe((state, prev) => {
  if (!state.doc || !prev.doc || state.doc === prev.doc || state.doc.id !== prev.doc.id || state.readOnly) return;
  if (state.doc === serverDoc) return;
  if (state.saveState !== "dirty" && state.saveState !== "saving") useEditor.setState({ saveState: "dirty" });
  scheduleSave();
});

window.addEventListener("beforeunload", (e) => {
  if (saveTimer || saving) {
    void flushSave();
    e.preventDefault();
  }
});
