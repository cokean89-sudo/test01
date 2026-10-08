// 실시간 공동 편집 서버 — 문서마다 '방'(메모리의 Y.Doc + awareness)을 두고, 접속한 사람들의 변경을 바로 서로에게 전한다.
//
//  · 방은 처음 접속할 때 SQLite 에서 불러온다(Yjs 상태가 없으면 data_json 에서 만들어 바로 저장). 마지막 사람이 나가고 1분 뒤 내린다.
//  · 받은 변경은 0.8초씩 묶어(최대 4초) 저장한다 — Yjs 상태 + data_json(목록 · 뷰어 · 내보내기용) + 버전 기록.
//  · 사람이 보낸 변경마다: 이미지 주소 검사 → (담당자만 편집이면) 남의 페이지를 고쳤는지 확인 후 되돌리기 → 활동 기록.
//  · awareness 의 user 는 실제 로그인한 사람으로 덮어쓰고, 선택 · 입력 시각은 서버 시계로 찍는다.
// 서버 1대 기준(메모리). 여러 대로 늘릴 때는 문서 id 로 같은 서버에 보내거나(sticky) Redis 로 변경을 중계한다 — 이 클래스가 그 경계다.

import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { applyDocDiff, changesOf, contentToY, yPages, yRoots, yToContent, yTray, type ChangeRef, type DocContent } from "../../shared/collab";
import { fromB64, LOCK_IDLE_MS, MSG_AWARENESS, MSG_CONTROL, MSG_SYNC, toB64, type ControlMessage, type HttpSyncRequest, type HttpSyncResponse, type PeerState, type PeerUser } from "../../shared/collabProtocol";
import { SAFE_IMAGE_SRC } from "../../shared/files";
import { userProfileOf } from "../../shared/profile";
import { ROLE_RANK, type AssignmentState, type DocActivityItem, type Role } from "../../shared/types";
import { publish } from "../events";
import type { Repo, UserRow } from "../repo";
import { describeChanges, LabelIndex } from "./activity";

/** 접속 한 개 (WebSocket 또는 HTTP 대체 경로) */
export interface Peer {
  kind: "ws" | "http" | "system";
  user: PeerUser;
  role: Role;
  /** 이 접속이 쓰는 awareness clientID */
  clientIds: Set<number>;
  send(msg: Uint8Array): void;
  close(code: number, reason: string): void;
  lastSeen: number;
  /** HTTP: 다음 응답에 실을 서버 시각 · 거절 */
  stamp?: { selT?: number; actT?: number };
  rejected?: string;
}

const canEdit = (role: Role) => ROLE_RANK[role] >= ROLE_RANK.editor;

export function peerUserOf(u: UserRow): PeerUser {
  return { id: u.id, name: u.name, profile: userProfileOf(u.id, u) };
}

function controlMsg(m: ControlMessage): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MSG_CONTROL);
  encoding.writeVarString(e, JSON.stringify(m));
  return encoding.toUint8Array(e);
}

export const sendControl = (p: Peer, m: ControlMessage) => p.send(controlMsg(m));

/** awareness 업데이트 안의 clientID 목록 (적용 전에 주인 확인용) */
function awarenessClientIds(update: Uint8Array): number[] {
  const d = decoding.createDecoder(update);
  const n = decoding.readVarUint(d);
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(decoding.readVarUint(d));
    decoding.readVarUint(d);
    decoding.readVarString(d);
  }
  return ids;
}

export interface HubOptions {
  persistDelay?: number;
  persistMaxDelay?: number;
  unloadDelay?: number;
}

export class Room {
  readonly doc = new Y.Doc();
  readonly awareness: awarenessProtocol.Awareness;
  readonly peers = new Set<Peer>();
  private owner = new Map<number, Peer>();
  private stamps = new Map<number, { sel: string; selT: number; act: unknown; actT: number }>();
  private labels: LabelIndex;
  assign: AssignmentState;
  createdBy: string | null;
  private dirty = false;
  private lastEditor: string | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private firstDirtyAt = 0;
  private unloadTimer: ReturnType<typeof setTimeout> | null = null;
  private buffer: Uint8Array[] | null = null;
  private collect: { peer: Peer; changes: ChangeRef[] } | null = null;
  private lastPublish = 0;
  closed = false;

  constructor(
    readonly docId: string,
    readonly teamId: string,
    private hub: CollabHub,
    private repo: Repo,
    init: { ydoc: Uint8Array | null; content: DocContent; createdBy: string | null },
  ) {
    if (init.ydoc) Y.applyUpdate(this.doc, init.ydoc, "load");
    else {
      // 처음 여는 문서 — JSON 에서 만들고 바로 저장해서, 모든 사람이 같은 출발점(같은 Yjs 기록)을 쓰게 한다
      contentToY(this.doc, init.content, "load");
      repo.saveYState(docId, Y.encodeStateAsUpdate(this.doc));
    }
    this.createdBy = init.createdBy;
    this.assign = repo.assignments(docId);
    this.labels = new LabelIndex(this.doc);
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);

    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      this.markDirty(origin);
      if (this.buffer) this.buffer.push(update);
      else this.broadcastSync(update, isPeer(origin) ? origin : null);
    });
    this.doc.on("afterTransaction", (tr: Y.Transaction) => {
      if (this.collect && tr.origin === this.collect.peer) this.collect.changes.push(...changesOf(this.doc, tr));
    });
    this.awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = [...added, ...updated, ...removed];
      if (isPeer(origin)) this.stampAwareness(origin, [...added, ...updated]);
      for (const id of removed) this.stamps.delete(id);
      if (!changed.length) return;
      const msg = this.awarenessMsg(changed);
      for (const p of this.peers) if (p !== origin && p.kind === "ws") p.send(msg);
    });
  }

  // ─── 접속 ──────────────────────────────────────────────

  join(peer: Peer) {
    if (this.unloadTimer) clearTimeout(this.unloadTimer);
    this.unloadTimer = null;
    this.peers.add(peer);
  }

  leave(peer: Peer) {
    if (!this.peers.delete(peer)) return;
    const ids = [...peer.clientIds];
    for (const id of ids) this.owner.delete(id);
    if (ids.length) awarenessProtocol.removeAwarenessStates(this.awareness, ids, "leave");
    if (!this.peers.size) this.scheduleUnload();
  }

  scheduleUnload() {
    if (this.unloadTimer) clearTimeout(this.unloadTimer);
    this.unloadTimer = setTimeout(() => {
      if (!this.peers.size) this.hub.unload(this.docId);
    }, this.hub.opts.unloadDelay);
    this.unloadTimer.unref?.();
  }

  /** WebSocket 연결 직후: 인사 · 내 상태 벡터(빠진 것 달라는 요청) · 다른 사람 awareness · 페이지 맡기 */
  greet(peer: Peer) {
    sendControl(peer, { t: "hello", now: Date.now(), role: peer.role, userId: peer.user.id });
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MSG_SYNC);
    syncProtocol.writeSyncStep1(e, this.doc);
    peer.send(encoding.toUint8Array(e));
    const states = [...this.awareness.getStates().keys()];
    if (states.length) peer.send(this.awarenessMsg(states));
    sendControl(peer, { t: "assign", assign: this.assign });
  }

  private awarenessMsg(ids: number[]): Uint8Array {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MSG_AWARENESS);
    encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids));
    return encoding.toUint8Array(e);
  }

  private broadcastSync(update: Uint8Array, except: Peer | null) {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MSG_SYNC);
    syncProtocol.writeUpdate(e, update);
    const msg = encoding.toUint8Array(e);
    for (const p of this.peers) if (p !== except && p.kind === "ws") p.send(msg);
  }

  broadcastControl(m: ControlMessage) {
    const msg = controlMsg(m);
    for (const p of this.peers) if (p.kind === "ws") p.send(msg);
  }

  // ─── 메시지 ────────────────────────────────────────────

  onMessage(peer: Peer, data: Uint8Array) {
    peer.lastSeen = Date.now();
    const d = decoding.createDecoder(data);
    const type = decoding.readVarUint(d);
    if (type === MSG_SYNC) {
      const sub = decoding.readVarUint(d);
      if (sub === syncProtocol.messageYjsSyncStep1) {
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, MSG_SYNC);
        syncProtocol.readSyncStep1(d, e, this.doc);
        peer.send(encoding.toUint8Array(e));
      } else if (sub === syncProtocol.messageYjsSyncStep2 || sub === syncProtocol.messageYjsUpdate) {
        const update = decoding.readVarUint8Array(d);
        // 보기 전용은 받기만 — 보낸 변경은 반영하지 않는다
        if (canEdit(peer.role)) {
          const { rejected } = this.applyFromPeer(peer, () => Y.applyUpdate(this.doc, update, peer));
          if (rejected) sendControl(peer, { t: "rejected", reason: rejected });
        }
        sendControl(peer, { t: "ack" });
      }
    } else if (type === MSG_AWARENESS) {
      this.applyAwareness(peer, decoding.readVarUint8Array(d));
    } else if (type === MSG_CONTROL) {
      const m = JSON.parse(decoding.readVarString(d)) as ControlMessage;
      if (m.t === "ping") sendControl(peer, { t: "pong", now: Date.now() });
    }
  }

  /** 다른 접속의 clientID 를 흉내 내는 awareness 는 버린다 */
  applyAwareness(peer: Peer, update: Uint8Array) {
    let ids: number[];
    try {
      ids = awarenessClientIds(update);
    } catch {
      return;
    }
    for (const id of ids) {
      const o = this.owner.get(id);
      if (o && o !== peer) return;
    }
    for (const id of ids) {
      this.owner.set(id, peer);
      peer.clientIds.add(id);
    }
    awarenessProtocol.applyAwarenessUpdate(this.awareness, update, peer);
  }

  /** 받은 awareness 에 진짜 사용자 정보 · 서버 시각을 넣는다 */
  private stampAwareness(peer: Peer, ids: number[]) {
    const now = Date.now();
    const states = this.awareness.getStates();
    for (const id of ids) {
      const st = states.get(id) as PeerState | undefined;
      if (!st || this.owner.get(id) !== peer) continue;
      const prev = this.stamps.get(id);
      const sel = (st.sel ?? []).join(",");
      const acted = !prev || prev.act !== st.act;
      // 30초 넘게 입력이 없다가 돌아오면 잠금이 이미 풀렸던 것이므로, 그 선택은 지금 새로 한 것으로 본다
      const resumed = !!prev && acted && now - prev.actT > LOCK_IDLE_MS;
      const s = {
        sel,
        selT: prev && prev.sel === sel && !resumed ? prev.selT : now,
        act: st.act,
        actT: acted ? now : prev!.actT,
      };
      this.stamps.set(id, s);
      st.user = peer.user;
      st.selT = s.selT;
      st.actT = s.actT;
      if (!prev || prev.selT !== s.selT || prev.actT !== s.actT) {
        if (peer.kind === "ws") sendControl(peer, { t: "stamp", selT: s.selT, actT: s.actT, now });
        else peer.stamp = { selT: s.selT, actT: s.actT };
      }
    }
  }

  /**
   * 사람이 보낸 변경 반영 — 이미지 주소 검사, 담당자만 편집 확인(어기면 되돌림), 활동 기록.
   * 그동안 나온 변경은 모아 두었다가 한 번에 다른 사람에게 보낸다 (되돌린 변경이 잠깐 보이지 않게).
   */
  applyFromPeer(peer: Peer, apply: () => void, opts: { bypassStrict?: boolean; activity?: { pageId: string | null; items: DocActivityItem[] } } = {}): { rejected?: string } {
    this.buffer = [];
    this.collect = { peer, changes: [] };
    const um = this.assign.strict && !opts.bypassStrict ? new Y.UndoManager(yRoots(this.doc), { trackedOrigins: new Set([peer]), captureTimeout: 0 }) : null;
    let rejected: string | undefined;
    let fixed = false;
    try {
      apply();
      const changes = this.collect.changes;
      if (changes.length) {
        const blocked = um ? this.strictViolation(changes, peer.user.id) : null;
        if (blocked) {
          um!.undo();
          rejected = blocked;
        } else {
          fixed = this.sanitize(changes);
          if (opts.activity) this.repo.recordDocActivity(this.docId, this.teamId, peer.user.id, opts.activity.pageId, opts.activity.items);
          else this.recordActivity(peer.user.id, changes);
        }
        this.labels.refresh(changes);
      }
    } finally {
      um?.destroy();
      const ups = this.buffer;
      this.buffer = null;
      this.collect = null;
      // 서버가 되돌리거나 고친 게 있으면 보낸 사람에게도 보낸다
      if (ups.length) this.broadcastSync(ups.length === 1 ? ups[0] : Y.mergeUpdates(ups), rejected || fixed ? null : peer);
    }
    if (rejected && peer.kind === "http") peer.rejected = rejected;
    return { rejected };
  }

  private strictViolation(changes: ChangeRef[], userId: string): string | null {
    const pages = new Set(changes.map((c) => c.pageId).filter((x): x is string => !!x));
    for (const id of pages) {
      const a = this.assign.assignments[id];
      if (a && a.userId !== userId) return `${a.name}님이 맡은 페이지예요. 담당자만 편집할 수 있어요.`;
    }
    return null;
  }

  /** http(s) · 앱 이미지 주소만 — 그 밖의 주소(javascript: 등)는 바로 지운다 */
  private sanitize(changes: ChangeRef[]): boolean {
    const pages = yPages(this.doc);
    const fixes: (() => void)[] = [];
    const checkEl = (el: Y.Map<unknown>) => {
      if (el.get("type") !== "image") return;
      const src = el.get("src");
      if (typeof src === "string" && src && !SAFE_IMAGE_SRC.test(src)) fixes.push(() => el.set("src", ""));
      const s = el.get("sourceUrl");
      if (s !== undefined && !(typeof s === "string" && /^https?:\/\//i.test(s))) fixes.push(() => el.delete("sourceUrl"));
    };
    for (const c of changes) {
      if (!c.pageId) continue;
      const yp = pages.get(c.pageId);
      const els = yp?.get("elements") as Y.Map<Y.Map<unknown>> | undefined;
      if (!els) continue;
      if (c.kind === "page" && !c.key) for (const el of els.values()) checkEl(el);
      else if (c.kind === "element" && c.elementId && (!c.key || c.key === "src" || c.key === "sourceUrl")) {
        const el = els.get(c.elementId);
        if (el) checkEl(el);
      }
    }
    if (changes.some((c) => c.kind === "tray")) {
      const tray = yTray(this.doc);
      for (const [id, v] of tray.entries()) {
        const src = String(v.src ?? "");
        if (!SAFE_IMAGE_SRC.test(src) || src.startsWith("/samples/")) fixes.push(() => tray.delete(id));
        else if (v.sourceUrl !== undefined && !/^https?:\/\//i.test(String(v.sourceUrl))) {
          const { sourceUrl: _s, ...rest } = v;
          fixes.push(() => tray.set(id, rest));
        }
      }
    }
    if (fixes.length) this.doc.transact(() => fixes.forEach((f) => f()), "server");
    return fixes.length > 0;
  }

  private recordActivity(userId: string, changes: ChangeRef[]) {
    for (const [pageId, items] of describeChanges(this.doc, changes, this.labels)) this.repo.recordDocActivity(this.docId, this.teamId, userId, pageId, items);
  }

  // ─── 저장 ──────────────────────────────────────────────

  private markDirty(origin: unknown) {
    if (origin === "load") return;
    if (isPeer(origin)) this.lastEditor = origin.user.id;
    if (!this.dirty) this.firstDirtyAt = Date.now();
    this.dirty = true;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    const wait = Math.max(0, Math.min(this.hub.opts.persistDelay!, this.firstDirtyAt + this.hub.opts.persistMaxDelay! - Date.now()));
    this.persistTimer = setTimeout(() => this.persist(), wait);
    this.persistTimer.unref?.();
  }

  /** 지금 상태를 저장하고 문서 버전을 돌려준다 */
  persist(opts: { forceVersion?: boolean } = {}): number | undefined {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    if (!this.dirty || this.closed) return undefined;
    this.dirty = false;
    const content = yToContent(this.doc);
    const version = this.repo.persistCollab(this.docId, content, Y.encodeStateAsUpdate(this.doc), this.lastEditor, opts);
    // 없어진 페이지의 담당 정리
    const live = new Set(content.pages.map((p) => p.id));
    if (Object.keys(this.assign.assignments).some((id) => !live.has(id))) {
      this.repo.pruneAssignments(this.docId, live);
      this.refreshAssign();
    }
    // 문서 목록 화면 새로 고침 (너무 자주 보내지 않게)
    const now = Date.now();
    if (version !== undefined && now - this.lastPublish > 3000) {
      this.lastPublish = now;
      publish(this.teamId, "doc", { docId: this.docId, version });
    }
    return version;
  }

  refreshAssign() {
    this.assign = this.repo.assignments(this.docId);
    this.broadcastControl({ t: "assign", assign: this.assign });
  }

  // ─── HTTP 대체 경로 ────────────────────────────────────

  httpSync(peer: Peer, body: HttpSyncRequest): HttpSyncResponse {
    peer.lastSeen = Date.now();
    if (body.update && canEdit(peer.role)) {
      const update = fromB64(body.update);
      this.applyFromPeer(peer, () => Y.applyUpdate(this.doc, update, peer));
    }
    if (body.awareness) this.applyAwareness(peer, fromB64(body.awareness));
    const others = [...this.awareness.getStates().keys()].filter((id) => !peer.clientIds.has(id));
    const res: HttpSyncResponse = {
      update: toB64(Y.encodeStateAsUpdate(this.doc, fromB64(body.sv))),
      sv: toB64(Y.encodeStateVector(this.doc)),
      awareness: toB64(awarenessProtocol.encodeAwarenessUpdate(this.awareness, others)),
      assign: this.assign,
      role: peer.role,
      now: Date.now(),
      ...(peer.stamp ? { stamp: peer.stamp } : {}),
      ...(peer.rejected ? { rejected: peer.rejected } : {}),
    };
    peer.stamp = undefined;
    peer.rejected = undefined;
    return res;
  }

  destroy() {
    this.closed = true;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    if (this.unloadTimer) clearTimeout(this.unloadTimer);
    this.awareness.destroy();
    this.doc.destroy();
  }
}

const PEER = Symbol("peer");
function isPeer(x: unknown): x is Peer {
  return !!x && typeof x === "object" && (x as Record<symbol, unknown>)[PEER] === true;
}
export function makePeer(p: Omit<Peer, "clientIds" | "lastSeen">): Peer {
  return Object.assign(p, { clientIds: new Set<number>(), lastSeen: Date.now(), [PEER]: true }) as Peer;
}

export class CollabHub {
  readonly rooms = new Map<string, Room>();
  readonly opts: Required<HubOptions>;
  private httpPeers = new Map<string, { room: Room; peer: Peer }>();
  private sweeper: ReturnType<typeof setInterval>;

  constructor(
    private repo: Repo,
    opts: HubOptions = {},
  ) {
    this.opts = { persistDelay: 800, persistMaxDelay: 4000, unloadDelay: 60_000, ...opts };
    // HTTP 대체 경로로 들어온 사람이 20초 동안 소식이 없으면 나간 것으로
    this.sweeper = setInterval(() => {
      const now = Date.now();
      for (const [key, { room, peer }] of this.httpPeers) {
        if (now - peer.lastSeen > 20_000) {
          room.leave(peer);
          this.httpPeers.delete(key);
        }
      }
    }, 5000);
    this.sweeper.unref?.();
  }

  /** 문서 방 (없으면 불러온다). 문서가 없으면 undefined */
  room(docId: string): Room | undefined {
    let r = this.rooms.get(docId);
    if (r) return r;
    const info = this.repo.docForCollab(docId);
    if (!info) return undefined;
    r = new Room(docId, info.teamId, this, this.repo, { ydoc: info.ydoc, content: info.content, createdBy: info.createdBy });
    this.rooms.set(docId, r);
    return r;
  }

  /** 편집기를 열 때 — Yjs 상태와 같은 시점의 내용 */
  snapshot(docId: string): { state: Uint8Array; content: DocContent; assign: AssignmentState } | undefined {
    const r = this.room(docId);
    if (!r) return undefined;
    if (!r.peers.size) r.scheduleUnload();
    return { state: Y.encodeStateAsUpdate(r.doc), content: yToContent(r.doc), assign: r.assign };
  }

  /** 방이 열려 있으면 지금 내용 (뷰어 · 인쇄가 0.8초 저장 지연 없이 최신을 보게) */
  liveContent(docId: string): DocContent | undefined {
    const r = this.rooms.get(docId);
    return r ? yToContent(r.doc) : undefined;
  }

  /**
   * JSON 으로 들어온 변경을 방에 반영 (예전 방식 저장 · 버전 복원) — base → next 차이만 얹으므로 그 사이 다른 사람 변경은 남는다.
   * 바로 저장하고 새 버전을 만든다.
   */
  applyContent(
    docId: string,
    user: PeerUser,
    role: Role,
    base: DocContent,
    next: DocContent,
    opts: { restore?: number } = {},
  ): { version: number; rejected?: string } | undefined {
    const r = this.room(docId);
    if (!r) return undefined;
    const peer = makePeer({ kind: "system", user, role, send: () => undefined, close: () => undefined });
    const res = r.applyFromPeer(peer, () => r.doc.transact(() => applyDocDiff(r.doc, base, next), peer), {
      bypassStrict: opts.restore !== undefined,
      activity: opts.restore !== undefined ? { pageId: null, items: [{ label: "문서", action: `v${opts.restore} 버전으로 복원` }] } : undefined,
    });
    const version = r.persist({ forceVersion: true }) ?? this.repo.docForCollab(docId)?.version ?? 1;
    if (!r.peers.size) r.scheduleUnload();
    return { version, rejected: res.rejected };
  }

  // ─── 접속 ──────────────────────────────────────────────

  httpSync(docId: string, user: UserRow, role: Role, body: HttpSyncRequest): HttpSyncResponse | undefined {
    const room = this.room(docId);
    if (!room) return undefined;
    const key = `${docId}:${user.id}:${body.clientId}`;
    let entry = this.httpPeers.get(key);
    if (!entry || entry.room !== room) {
      const peer = makePeer({ kind: "http", user: peerUserOf(user), role, send: () => undefined, close: () => undefined });
      room.join(peer);
      entry = { room, peer };
      this.httpPeers.set(key, entry);
    }
    entry.peer.role = role;
    return room.httpSync(entry.peer, body);
  }

  /** 페이지 맡기가 바뀌면 그 문서를 보는 사람들에게 */
  assignChanged(docId: string) {
    this.rooms.get(docId)?.refreshAssign();
  }

  /** 문서를 지웠을 때 — 접속을 끊고 저장하지 않고 내린다 */
  drop(docId: string) {
    const r = this.rooms.get(docId);
    if (!r) return;
    r.broadcastControl({ t: "deleted" });
    for (const p of [...r.peers]) p.close(4404, "deleted");
    r.destroy();
    this.rooms.delete(docId);
  }

  /** 팀에서 나간 사람 — 그 팀 문서의 접속을 끊는다 */
  kick(teamId: string, userId: string) {
    for (const r of this.rooms.values()) {
      if (r.teamId !== teamId) continue;
      for (const p of [...r.peers]) if (p.user.id === userId) p.close(4403, "removed");
    }
  }

  unload(docId: string) {
    const r = this.rooms.get(docId);
    if (!r || r.peers.size) return;
    r.persist();
    r.destroy();
    this.rooms.delete(docId);
  }

  /** 서버를 끌 때 — 남은 변경 저장 */
  flushAll() {
    for (const r of this.rooms.values()) r.persist();
  }

  close() {
    clearInterval(this.sweeper);
    this.flushAll();
    for (const r of this.rooms.values()) r.destroy();
    this.rooms.clear();
  }
}
