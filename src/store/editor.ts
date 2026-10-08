import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { create } from "zustand";
import { applyDocDiff, DocMirror, orderKeys, same, yMeta, yPages, yRoots, ySettings, yTray } from "../../shared/collab";
import { fromB64, LOCK_IDLE_MS, type ControlMessage, type PeerState } from "../../shared/collabProtocol";
import type { ProfileColor, UserProfile } from "../../shared/profile";
import type { AssignmentState, CollabDoc, DocumentData, Page, PageElement, PresenceUser, Role } from "../../shared/types";
import { CollabProvider, type SyncStatus } from "../collab/provider";
import type { ClipboardData } from "../layout/imageMoves";
import { navigate } from "../lib/router";
import { toast } from "./toast";

export type Tool = "select" | "text" | "rect" | "ellipse" | "line";

export type EditorModal =
  | { type: "picker"; mode: "add" | "replace"; targetId?: string }
  | { type: "ai"; pageIds: string[] }
  | { type: "history"; tab?: "activity" | "versions" }
  | null;

/** 같은 문서를 보고 있는 다른 사람 (접속 하나 = 탭 하나) */
export interface Peer {
  clientId: number;
  userId: string;
  name: string;
  profile: UserProfile;
  color: ProfileColor;
  page?: string | null;
  sel: string[];
  editing?: string | null;
  /** 서버 시계 — 지금 선택을 시작한 시각 · 마지막 입력 시각 */
  selT?: number;
  actT?: number;
}

/** 히스토리에서 고른 요소를 잠깐 그 사람 색으로 */
export interface Highlight {
  pageId: string;
  ids: string[];
  color: ProfileColor;
  deleted: boolean;
  at: number;
}

export type SaveState = "saved" | "saving" | "offline" | "connecting";

interface EditorState {
  doc: DocumentData | null;
  pageId: string | null;
  selection: string[];
  tool: Tool;
  editingId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** 연결 · 저장 상태 */
  sync: { status: SyncStatus; pending: number; transport: "ws" | "http" };
  saveState: SaveState;
  zoom: number | "fit";
  /** '맞춤' 배율 (캔버스가 계산) */
  fitScale: number;
  /** ⌘C · ⌘X 로 담은 요소 — 문서 · 페이지를 넘나들며 붙여넣을 수 있다 */
  clipboard: ClipboardData | null;
  /** 끌기 등 연속 변경 중 — 시작 전 문서 (끝날 때 한 번에 공유) */
  txBase: DocumentData | null;
  lastKey: { key: string; at: number } | null;
  modal: EditorModal;
  /** 보기 전용 권한이면 편집 불가 */
  readOnly: boolean;
  role: Role | null;
  /** 나 (로그인한 사용자 id) */
  me: string;
  /** 같은 문서를 보고 있는 다른 사람들 (접속별) */
  peers: Peer[];
  /** 같은 문서를 보고 있는 팀원 (사람별 — 상단 표시) */
  presence: PresenceUser[];
  /** 잠금 30초 판단용 — 5초마다 올라간다 */
  clock: number;
  /** 페이지 맡기 */
  assign: AssignmentState;
  /** 페이지 목록: 내가 맡은 페이지만 */
  onlyMine: boolean;
  highlight: Highlight | null;

  open: (doc: CollabDoc, opts: { me: string }) => void;
  close: () => void;
  /** draft(깊은 복사본)를 수정하는 방식의 변경 — 실행 취소 기록이 남는다. key 가 같으면 연속 입력을 하나로 묶는다. */
  update: (recipe: (draft: DocumentData) => void, opts?: { key?: string }) => void;
  /** 드래그처럼 연속 변경의 시작/끝 — 끝날 때 한 번만 기록 · 공유 */
  begin: () => void;
  end: () => void;
  /** 연속 변경 취소 — 시작 전 상태로 되돌리고 기록을 남기지 않는다 */
  cancelTx: () => void;
  /** 실행 취소에 남기지 않는 변경 (끄는 중 위치, 이미지 원본 크기 기록) */
  patchTransient: (pageId: string, patches: Record<string, Partial<PageElement>>) => void;
  undo: () => void;
  redo: () => void;
  setPage: (id: string) => void;
  select: (ids: string[]) => void;
  setTool: (tool: Tool) => void;
  setEditing: (id: string | null) => void;
  setZoom: (zoom: number | "fit") => void;
  setFitScale: (scale: number) => void;
  setClipboard: (clip: ClipboardData | null) => void;
  setModal: (modal: EditorModal) => void;
  setOnlyMine: (on: boolean) => void;
  setHighlight: (h: Highlight | null) => void;
}

/** 실행 취소 대상인 내 변경 */
export const LOCAL = { origin: "local" };
/** 공유는 하지만 실행 취소에는 넣지 않는 변경 */
export const SILENT = { origin: "silent" };

const OFFLINE_SYNC = { status: "connecting" as SyncStatus, pending: 0, transport: "ws" as const };

// ─── 공동 편집 세션 (열린 문서 하나) ────────────────────────────

class Session {
  readonly doc = new Y.Doc();
  readonly mirror: DocMirror;
  readonly um: Y.UndoManager;
  readonly awareness: Awareness;
  readonly provider: CollabProvider;
  meta: Omit<DocumentData, "title" | "query" | "settings" | "pages" | "tray">;
  /** 끄는 중에 받은 다른 사람 변경 — 끝난 뒤 화면에 */
  deferred = false;
  /** 서버 시계 - 내 시계 */
  offset = 0;
  /** 내 지금 선택에 서버가 찍은 시각 */
  mySelT: number | null = null;
  /** 맡은 사람에게 '그래도 편집' 확인을 받은 페이지 (그 페이지를 떠나면 다시 묻는다) */
  confirmed = new Set<string>();
  actCount = 0;
  lastAct = 0;
  private timer: ReturnType<typeof setInterval>;

  constructor(cd: CollabDoc) {
    Y.applyUpdate(this.doc, fromB64(cd.ystate), "init");
    const { ystate: _y, assign: _a, role: _r, title: _t, query: _q, settings: _s, pages: _p, tray: _tr, ...meta } = cd;
    this.meta = meta;
    this.mirror = new DocMirror(this.doc);
    yPages(this.doc).observeDeep((e) => this.mirror.invalidate("pages", e));
    ySettings(this.doc).observeDeep((e) => this.mirror.invalidate("settings", e));
    yTray(this.doc).observeDeep((e) => this.mirror.invalidate("tray", e));
    yMeta(this.doc).observeDeep((e) => this.mirror.invalidate("meta", e));
    this.doc.on("afterTransaction", (tr: Y.Transaction) => {
      if (tr.changed.size) onDocChanged();
    });
    this.um = new Y.UndoManager(yRoots(this.doc), { trackedOrigins: new Set([LOCAL]), captureTimeout: 1500 });
    const flags = () => useEditor.setState({ canUndo: this.um.canUndo(), canRedo: this.um.canRedo() });
    this.um.on("stack-item-added", flags);
    this.um.on("stack-item-popped", flags);
    this.um.on("stack-cleared", flags);
    this.awareness = new Awareness(this.doc);
    this.awareness.on("change", () => onPeersChanged());
    this.provider = new CollabProvider(cd.id, this.doc, this.awareness, {
      status: (s) => useEditor.setState({ sync: s, saveState: saveStateOf(s.status, s.pending) }),
      control: onControl,
    });
    // 잠금 30초 · 자리 비움 표시는 시간이 지나야 바뀐다
    this.timer = setInterval(() => useEditor.setState({ clock: Date.now() }), 5000);
  }

  build(): DocumentData {
    return { ...this.meta, ...this.mirror.build() } as DocumentData;
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  destroy() {
    clearInterval(this.timer);
    this.provider.destroy();
    this.um.destroy();
    this.awareness.destroy();
    this.doc.destroy();
  }
}

let session: Session | null = null;

const saveStateOf = (status: SyncStatus, pending: number): SaveState => (status === "offline" ? "offline" : status === "connecting" ? "connecting" : pending ? "saving" : "saved");

export const useEditor = create<EditorState>((set, get) => ({
  doc: null,
  pageId: null,
  selection: [],
  tool: "select",
  editingId: null,
  canUndo: false,
  canRedo: false,
  sync: OFFLINE_SYNC,
  saveState: "connecting",
  zoom: "fit",
  fitScale: 1,
  clipboard: null,
  txBase: null,
  lastKey: null,
  modal: null,
  readOnly: false,
  role: null,
  me: "",
  peers: [],
  presence: [],
  clock: Date.now(),
  assign: { assignments: {}, strict: false },
  onlyMine: false,
  highlight: null,

  open(cd, opts) {
    session?.destroy();
    session = new Session(cd);
    const doc = session.build();
    const readOnly = cd.role === "viewer";
    set({
      doc,
      me: opts.me,
      role: cd.role ?? null,
      readOnly,
      assign: cd.assign,
      peers: [],
      presence: [],
      pageId: doc.pages[0]?.id ?? null,
      selection: [],
      editingId: null,
      canUndo: false,
      canRedo: false,
      sync: OFFLINE_SYNC,
      saveState: "connecting",
      tool: "select",
      txBase: null,
      lastKey: null,
      modal: null,
      onlyMine: false,
      highlight: null,
    });
    publishMyState();
  },

  close() {
    session?.destroy();
    session = null;
    set({ doc: null, pageId: null, selection: [], peers: [], presence: [], canUndo: false, canRedo: false });
  },

  update(recipe, opts) {
    const { doc, txBase, lastKey, readOnly } = get();
    if (!doc || readOnly || !session) return;
    const draft = structuredClone(doc);
    recipe(draft);
    // 끄는 중: 내 화면에만 (놓는 순간 한 번에 공유)
    if (txBase) {
      set({ doc: draft });
      return;
    }
    if (!guardEdit(doc, draft)) return;
    const now = Date.now();
    const coalesce = !!opts?.key && lastKey?.key === opts.key && now - lastKey.at < 1500;
    if (!coalesce) session.um.stopCapturing();
    const s = session;
    s.doc.transact(() => applyDocDiff(s.doc, doc, draft), LOCAL);
    set({ lastKey: opts?.key ? { key: opts.key, at: now } : null });
  },

  begin() {
    const { doc } = get();
    if (doc) set({ txBase: doc });
  },

  end() {
    const { txBase, doc } = get();
    if (!txBase) return;
    set({ txBase: null });
    if (session && doc && doc !== txBase && !get().readOnly && guardEdit(txBase, doc)) {
      const s = session;
      s.um.stopCapturing();
      s.doc.transact(() => applyDocDiff(s.doc, txBase, doc), LOCAL);
      set({ lastKey: null });
    }
    // 끄는 동안 받은 다른 사람 변경 · 거절된 변경까지 Y 기준으로 맞춘다
    applyFromY();
  },

  cancelTx() {
    if (!get().txBase) return;
    set({ txBase: null });
    applyFromY();
  },

  patchTransient(pageId, patches) {
    const { doc, readOnly, txBase } = get();
    if (!doc || readOnly) return;
    const next: DocumentData = {
      ...doc,
      pages: doc.pages.map((p) =>
        p.id !== pageId ? p : { ...p, elements: p.elements.map((e) => (patches[e.id] ? ({ ...e, ...patches[e.id] } as PageElement) : e)) },
      ),
    };
    if (txBase || !session) {
      set({ doc: next });
      return;
    }
    // 이미지 원본 크기처럼 끄기 밖에서 오는 값은 공유하되 실행 취소에는 넣지 않는다
    const s = session;
    s.doc.transact(() => applyDocDiff(s.doc, doc, next), SILENT);
  },

  undo() {
    if (!session || get().readOnly) return;
    session.um.stopCapturing();
    session.um.undo();
    set({ selection: [], editingId: null, lastKey: null });
  },

  redo() {
    if (!session || get().readOnly) return;
    session.um.redo();
    set({ selection: [], editingId: null, lastKey: null });
  },

  setPage(id) {
    // 맡은 사람 확인은 그 페이지를 떠나면 다시 묻는다
    session?.confirmed.clear();
    set({ pageId: id, selection: [], editingId: null });
  },
  select(ids) {
    const allowed = withoutLocked(ids, true);
    if (session && !same(allowed, get().selection)) session.mySelT = null;
    set({ selection: allowed, editingId: get().editingId && allowed.includes(get().editingId!) ? get().editingId : null });
  },
  setTool(tool) {
    set({ tool, editingId: null });
  },
  setEditing(id) {
    if (id) {
      if (withoutLocked([id], true).length === 0) return;
      const pageId = pageOfElement(id);
      if (pageId && !confirmPage(pageId)) return;
    }
    set({ editingId: id, selection: id ? [id] : get().selection });
  },
  setZoom(zoom) {
    set({ zoom });
  },
  setFitScale(fitScale) {
    if (fitScale !== get().fitScale) set({ fitScale });
  },
  setClipboard(clipboard) {
    set({ clipboard });
  },
  setModal(modal) {
    set({ modal });
  },
  setOnlyMine(onlyMine) {
    set({ onlyMine });
  },
  setHighlight(highlight) {
    set({ highlight });
  },
}));

// ─── Y → 화면 ────────────────────────────────────────────────

function onDocChanged() {
  if (!session) return;
  if (useEditor.getState().txBase) {
    session.deferred = true;
    return;
  }
  applyFromY();
}

/** Y 의 지금 상태를 화면 문서로 — 지워진 페이지 · 요소는 선택 · 편집에서 뺀다 */
function applyFromY() {
  if (!session) return;
  session.deferred = false;
  const st = useEditor.getState();
  const doc = session.build();
  if (doc === st.doc) return;
  const pages = new Set(doc.pages.map((p) => p.id));
  let pageId = st.pageId;
  if (!pageId || !pages.has(pageId)) {
    const idx = st.doc?.pages.findIndex((p) => p.id === pageId) ?? 0;
    pageId = doc.pages[Math.min(Math.max(idx, 0), doc.pages.length - 1)]?.id ?? null;
  }
  const page = doc.pages.find((p) => p.id === pageId);
  const live = new Set(page?.elements.map((e) => e.id) ?? []);
  const selection = st.selection.filter((id) => live.has(id));
  useEditor.setState({
    doc,
    pageId,
    selection: selection.length === st.selection.length ? st.selection : selection,
    editingId: st.editingId && live.has(st.editingId) ? st.editingId : null,
  });
}

// ─── 작업자 현황 · 잠금 ─────────────────────────────────────────

function onPeersChanged() {
  if (!session) return;
  const me = useEditor.getState().me;
  const peers: Peer[] = [];
  for (const [clientId, raw] of session.awareness.getStates()) {
    if (clientId === session.doc.clientID) continue;
    const st = raw as PeerState;
    if (!st.user) continue;
    peers.push({
      clientId,
      userId: st.user.id,
      name: st.user.name,
      profile: st.user.profile,
      color: st.user.profile.color,
      page: st.page,
      sel: st.sel ?? [],
      editing: st.editing,
      selT: st.selT,
      actT: st.actT,
    });
  }
  // 사람별로 하나 (같은 사람이 탭 여러 개면 가장 최근에 움직인 탭)
  const byUser = new Map<string, Peer>();
  for (const p of peers) {
    if (p.userId === me) continue;
    const cur = byUser.get(p.userId);
    if (!cur || (p.actT ?? 0) > (cur.actT ?? 0)) byUser.set(p.userId, p);
  }
  const presence: PresenceUser[] = [...byUser.values()].map((p) => ({ userId: p.userId, name: p.name, profile: p.profile, pageId: p.page ?? undefined }));
  useEditor.setState({ peers, presence });
  resolveConflicts();
}

/** 30초 안에 입력이 있었던 사람만 잠금을 가진다 */
export function isActive(p: Peer, now = session?.serverNow() ?? Date.now()): boolean {
  return p.actT !== undefined && now - p.actT < LOCK_IDLE_MS;
}

/** 이 요소를 지금 다른 사람이 선택하고 있으면 그 사람 */
export function lockOwner(elementId: string): Peer | null {
  const { peers, me } = useEditor.getState();
  return peers.find((p) => p.userId !== me && p.sel.includes(elementId) && isActive(p)) ?? null;
}

let lastLockToast = 0;
function lockToast(p: Peer) {
  const now = Date.now();
  if (now - lastLockToast < 2500) return;
  lastLockToast = now;
  toast.info(`${p.name}님이 편집 중이에요`);
}

/** 다른 사람이 선택 중인 요소는 고를 수 없다 */
function withoutLocked(ids: string[], notify: boolean): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const owner = lockOwner(id);
    if (owner) {
      if (notify) lockToast(owner);
    } else out.push(id);
  }
  return out;
}

/** 동시에 같은 요소를 골랐으면 먼저 고른 사람(서버 시각, 같으면 접속 번호) 이 갖는다 */
function resolveConflicts() {
  if (!session) return;
  const { selection, peers, me, editingId } = useEditor.getState();
  if (!selection.length) return;
  const mine = session.mySelT ?? session.serverNow();
  const myId = session.doc.clientID;
  let winner: Peer | null = null;
  const lost = selection.filter((id) =>
    peers.some((p) => {
      if (p.userId === me || !isActive(p) || !p.sel.includes(id)) return false;
      const theirs = p.selT ?? Number.POSITIVE_INFINITY;
      const wins = theirs < mine || (theirs === mine && p.clientId < myId);
      if (wins) winner = p;
      return wins;
    }),
  );
  if (!lost.length) return;
  const keep = selection.filter((id) => !lost.includes(id));
  useEditor.setState({ selection: keep, editingId: editingId && keep.includes(editingId) ? editingId : null });
  if (winner) toast.info(`${(winner as Peer).name}님이 먼저 선택했어요`);
}

/** 내 상태(보는 페이지 · 선택 · 편집 중 · 입력) 알리기 */
function publishMyState() {
  if (!session) return;
  const { pageId, selection, editingId } = useEditor.getState();
  const cur = (session.awareness.getLocalState() ?? {}) as PeerState;
  const next: PeerState = { page: pageId, sel: selection, editing: editingId, act: session.actCount };
  if (cur.page === next.page && same(cur.sel, next.sel) && cur.editing === next.editing && cur.act === next.act) return;
  session.awareness.setLocalState(next);
}

useEditor.subscribe((s, prev) => {
  if (s.pageId !== prev.pageId || s.selection !== prev.selection || s.editingId !== prev.editingId) publishMyState();
  if (s.selection !== prev.selection) resolveConflicts();
});

/** 편집기에서 입력이 있을 때 (5초에 한 번만 알린다) — 30초 잠금 판단용 */
export function bumpActivity() {
  if (!session) return;
  const now = Date.now();
  if (now - session.lastAct < 5000) return;
  session.lastAct = now;
  session.actCount++;
  publishMyState();
}

function onControl(m: ControlMessage) {
  if (!session) return;
  switch (m.t) {
    case "hello":
    case "pong":
      session.offset = m.now - Date.now();
      if (m.t === "hello") useEditor.setState({ role: m.role, readOnly: m.role === "viewer" });
      break;
    case "stamp":
      session.offset = m.now - Date.now();
      if (m.selT !== undefined) session.mySelT = m.selT;
      resolveConflicts();
      break;
    case "assign":
      useEditor.setState({ assign: m.assign });
      break;
    case "role":
      useEditor.setState({ role: m.role, readOnly: m.role === "viewer" });
      if (m.role === "viewer") toast.info("보기 전용 권한으로 바뀌었어요");
      break;
    case "rejected":
      toast.error(m.reason);
      break;
    case "deleted":
      toast.error("이 문서가 삭제됐어요");
      navigate("docs");
      break;
  }
}

// ─── 페이지 맡기 확인 ──────────────────────────────────────────

function pageOfElement(elId: string): string | undefined {
  return useEditor.getState().doc?.pages.find((p) => p.elements.some((e) => e.id === elId))?.id;
}

/** 다른 사람이 맡은 페이지 — 엄격 모드면 막고, 아니면 한 번 묻는다 */
function confirmPage(pageId: string): boolean {
  const { assign, me } = useEditor.getState();
  const a = assign.assignments[pageId];
  if (!a || a.userId === me || session?.confirmed.has(pageId)) return true;
  if (assign.strict) {
    toast.error(`${a.name}님이 맡은 페이지예요. 담당자만 편집할 수 있어요.`);
    return false;
  }
  if (!confirm(`${a.name}님이 맡은 페이지예요. 그래도 편집할까요?`)) return false;
  session?.confirmed.add(pageId);
  return true;
}

/** 이 페이지를 지금 내가 고칠 수 있는지 (엄격 모드의 남의 페이지는 끄기 · 편집 시작 전에 막는다) */
export function canEditPage(pageId: string): boolean {
  const { assign, me, readOnly } = useEditor.getState();
  if (readOnly) return false;
  const a = assign.assignments[pageId];
  return !a || a.userId === me || !assign.strict;
}

/** 바뀐 페이지 — 내용이 바뀌었거나, 추가 · 삭제됐거나, 순서가 옮겨진 페이지 */
export function touchedPages(prev: DocumentData, next: DocumentData): string[] {
  const before = new Map(prev.pages.map((p) => [p.id, p]));
  const out = new Set<string>();
  for (const p of next.pages) {
    const b = before.get(p.id);
    if (!b || (b !== p && !same(b, p))) out.add(p.id);
  }
  for (const id of before.keys()) if (!next.pages.some((p) => p.id === id)) out.add(id);
  // 순서: 가장 긴 그대로인 순서에서 빠진 페이지만 '옮긴 것'
  const prevIds = prev.pages.map((p) => p.id);
  const nextIds = next.pages.map((p) => p.id).filter((id) => before.has(id));
  if (!same(prevIds.filter((id) => nextIds.includes(id)), nextIds)) {
    const keys = new Map(prevIds.map((id, i) => [id, String(i).padStart(6, "0") + "1"]));
    for (const [id, k] of orderKeys(nextIds, keys)) if (keys.get(id) !== k) out.add(id);
  }
  return [...out];
}

function guardEdit(prev: DocumentData, next: DocumentData): boolean {
  const { assign } = useEditor.getState();
  if (!Object.keys(assign.assignments).length) return true;
  for (const id of touchedPages(prev, next)) if (!confirmPage(id)) return false;
  return true;
}

// ─── 저장 ──────────────────────────────────────────────────────

/** 서버에 다 반영될 때까지 기다린다 (오프라인이면 바로) — 문서 히스토리 열기 · 내보내기 전에 */
export function flushSave(): Promise<void> {
  return session?.provider.flush() ?? Promise.resolve();
}

window.addEventListener("beforeunload", (e) => {
  if (session && session.provider.pending > 0) e.preventDefault();
});

// ─── 도우미 ────────────────────────────────────────────────────

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

/** 서버 시각 기준 지금 (잠금 · 자리 비움 표시) */
export function serverNow(): number {
  return session?.serverNow() ?? Date.now();
}
