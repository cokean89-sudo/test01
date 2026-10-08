// 공동 편집 연결 — 서버의 문서 방과 Yjs 변경 · awareness 를 주고받는다.
//
//  · WebSocket(/api/collab/<id>) 이 기본. 끊기면 1 · 2 · 4 · 8 · 10초 간격으로 다시 연결하고, 다시 연결되면 서로의 상태 벡터를 비교해
//    빠진 변경만 주고받는다 (끊긴 동안의 내 수정은 Y.Doc 에 그대로 있다가 이때 올라간다).
//  · 한 번도 열리지 않고 3번 실패하면(회사망 · 프록시가 WebSocket 을 막는 경우) HTTP 로 1.5초마다 주고받는다.
//  · 서버가 반영했다는 확인(ack)을 세어 '저장 중 · 저장됨 · 오프라인 — 변경 N개 대기 중'을 보여 준다.

import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { fromB64, MSG_AWARENESS, MSG_CONTROL, MSG_SYNC, PING_MS, toB64, type ControlMessage, type HttpSyncResponse } from "../../shared/collabProtocol";

export type SyncStatus = "connecting" | "online" | "offline";

export interface ProviderEvents {
  status: (s: { status: SyncStatus; pending: number; transport: "ws" | "http" }) => void;
  control: (m: ControlMessage) => void;
}

const BACKOFF = [1000, 2000, 4000, 8000, 10_000];
const HTTP_EVERY = 1500;

export class CollabProvider {
  status: SyncStatus = "connecting";
  transport: "ws" | "http" = "ws";
  /** 서버에 아직 반영되지 않은 내 변경 수 */
  private sent = 0;
  private acked = 0;
  private queued = 0;
  private ws: WebSocket | null = null;
  private everOpened = false;
  private failures = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private pinger: ReturnType<typeof setInterval> | null = null;
  private lastMessage = 0;
  private destroyed = false;
  /** HTTP 대체 경로 */
  private serverSv: Uint8Array | null = null;
  private httpTimer: ReturnType<typeof setTimeout> | null = null;
  private httpBusy = false;
  private httpDirty = false;

  constructor(
    readonly docId: string,
    readonly doc: Y.Doc,
    readonly awareness: awarenessProtocol.Awareness,
    private on: ProviderEvents,
  ) {
    // 문제 확인용: localStorage 의 rb.collab 을 "http" 로 두면 처음부터 HTTP 대체 경로로
    try {
      if (localStorage.getItem("rb.collab") === "http") this.transport = "http";
    } catch {
      /* 저장소를 못 쓰면 기본(WebSocket) */
    }
    doc.on("update", this.onDocUpdate);
    awareness.on("update", this.onAwarenessUpdate);
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    this.connect();
  }

  get pending() {
    return this.queued + Math.max(0, this.sent - this.acked);
  }

  private emit() {
    this.on.status({ status: this.status, pending: this.pending, transport: this.transport });
  }

  private setStatus(s: SyncStatus) {
    this.status = s;
    this.emit();
  }

  // ─── 내 변경 → 서버 ─────────────────────────────────────

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return; // 서버에서 받은 것
    if (this.transport === "http") {
      this.httpDirty = true;
      this.queued++;
      this.emit();
      this.scheduleHttp(150);
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, MSG_SYNC);
      syncProtocol.writeUpdate(e, update);
      this.ws.send(encoding.toUint8Array(e));
      this.sent++;
    } else this.queued++;
    this.emit();
  };

  private onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === this) return;
    const mine = [...added, ...updated, ...removed].filter((id) => id === this.doc.clientID);
    if (!mine.length) return;
    if (this.transport === "http") return this.scheduleHttp(150);
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MSG_AWARENESS);
    encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(this.awareness, mine));
    this.ws.send(encoding.toUint8Array(e));
  };

  sendControl(m: ControlMessage) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MSG_CONTROL);
    encoding.writeVarString(e, JSON.stringify(m));
    this.ws.send(encoding.toUint8Array(e));
  }

  // ─── WebSocket ─────────────────────────────────────────

  private connect() {
    if (this.destroyed) return;
    if (this.transport === "http") return this.scheduleHttp(0);
    if (this.status !== "online") this.setStatus(this.everOpened ? "offline" : "connecting");
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/collab/${encodeURIComponent(this.docId)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return this.onClose();
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.everOpened = true;
      this.failures = 0;
      this.lastMessage = Date.now();
      // 내 상태 벡터 → 서버가 내가 모르는 변경을 보낸다. 서버도 자기 상태 벡터를 보내면 내 변경(끊긴 동안 것 포함)을 보낸다
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, MSG_SYNC);
      syncProtocol.writeSyncStep1(e, this.doc);
      ws.send(encoding.toUint8Array(e));
      if (this.awareness.getLocalState()) {
        const a = encoding.createEncoder();
        encoding.writeVarUint(a, MSG_AWARENESS);
        encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]));
        ws.send(encoding.toUint8Array(a));
      }
      this.setStatus("online");
      if (this.pinger) clearInterval(this.pinger);
      this.pinger = setInterval(() => {
        // 응답이 오래 없으면 끊긴 것으로 보고 다시 연결
        if (Date.now() - this.lastMessage > PING_MS * 2 + 5000) ws.close();
        else this.sendControl({ t: "ping" });
      }, PING_MS);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.lastMessage = Date.now();
      this.onMessage(new Uint8Array(ev.data as ArrayBuffer), ws);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      // 권한이 없어졌거나 문서가 지워졌으면 다시 연결하지 않는다
      if (ev.code === 4401 || ev.code === 4403 || ev.code === 4404) {
        this.destroyed = true;
        this.setStatus("offline");
        return;
      }
      this.onClose();
    };
  }

  private onClose() {
    if (this.pinger) clearInterval(this.pinger);
    this.pinger = null;
    // 확인받지 못한 변경은 다시 연결할 때 상태 벡터 비교로 다시 올라간다
    this.queued += Math.max(0, this.sent - this.acked);
    this.sent = this.acked = 0;
    // 다른 사람 표시는 지운다 (다시 연결하면 새로 받는다)
    const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID);
    if (others.length) awarenessProtocol.removeAwarenessStates(this.awareness, others, this);
    if (this.destroyed) return;
    this.failures++;
    if (!this.everOpened && this.failures >= 3) {
      this.transport = "http";
      this.setStatus("connecting");
      return this.scheduleHttp(0);
    }
    this.setStatus(this.everOpened ? "offline" : "connecting");
    this.scheduleRetry();
  }

  private scheduleRetry() {
    if (this.retry) clearTimeout(this.retry);
    const wait = BACKOFF[Math.min(this.failures - 1, BACKOFF.length - 1)] ?? 1000;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect();
    }, wait);
  }

  private onOnline = () => {
    if (this.transport === "http") return this.scheduleHttp(0);
    if (!this.ws) {
      if (this.retry) clearTimeout(this.retry);
      this.retry = null;
      this.connect();
    }
  };

  private onOffline = () => {
    if (this.transport === "ws") this.ws?.close();
    this.setStatus("offline");
  };

  private onMessage(data: Uint8Array, ws: WebSocket) {
    const d = decoding.createDecoder(data);
    const type = decoding.readVarUint(d);
    if (type === MSG_SYNC) {
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, MSG_SYNC);
      const sub = syncProtocol.readSyncMessage(d, e, this.doc, this);
      if (encoding.length(e) > 1) {
        ws.send(encoding.toUint8Array(e));
        // 서버의 상태 벡터에 대한 답 = 서버가 모르는 내 변경 (끊긴 동안 쌓인 것) — 이제 확인만 기다린다
        if (sub === syncProtocol.messageYjsSyncStep1) {
          this.queued = 0;
          this.sent++;
          this.emit();
        }
      }
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(d), this);
    } else if (type === MSG_CONTROL) {
      const m = JSON.parse(decoding.readVarString(d)) as ControlMessage;
      if (m.t === "ack") {
        this.acked++;
        this.emit();
      }
      this.on.control(m);
    }
  }

  // ─── HTTP 대체 경로 ────────────────────────────────────

  private scheduleHttp(delay: number) {
    if (this.destroyed || this.transport !== "http") return;
    if (this.httpTimer) clearTimeout(this.httpTimer);
    this.httpTimer = setTimeout(() => void this.httpRound(), delay);
  }

  private async httpRound() {
    if (this.httpBusy || this.destroyed) return;
    this.httpBusy = true;
    const sentQueued = this.queued;
    this.httpDirty = false;
    try {
      const body = {
        clientId: this.doc.clientID,
        sv: toB64(Y.encodeStateVector(this.doc)),
        ...(this.serverSv && sentQueued ? { update: toB64(Y.encodeStateAsUpdate(this.doc, this.serverSv)) } : {}),
        ...(this.awareness.getLocalState() ? { awareness: toB64(awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID])) } : {}),
      };
      const res = await fetch(`/api/collab/${encodeURIComponent(this.docId)}/sync`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-refboard": "1" },
        body: JSON.stringify(body),
      });
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        this.destroyed = true;
        this.setStatus("offline");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const out = (await res.json()) as HttpSyncResponse;
      Y.applyUpdate(this.doc, fromB64(out.update), this);
      this.serverSv = fromB64(out.sv);
      // 첫 요청은 서버 상태 벡터를 몰라 내 변경을 싣지 못했다 → 바로 한 번 더
      if (!body.update && sentQueued) this.httpDirty = true;
      else this.queued = Math.max(0, this.queued - sentQueued);
      const awareness = fromB64(out.awareness);
      const present = new Set<number>();
      if (awareness.length > 1) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, awareness, this);
        const dd = decoding.createDecoder(awareness);
        const n = decoding.readVarUint(dd);
        for (let i = 0; i < n; i++) {
          present.add(decoding.readVarUint(dd));
          decoding.readVarUint(dd);
          decoding.readVarString(dd);
        }
      }
      const gone = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID && !present.has(id));
      if (gone.length) awarenessProtocol.removeAwarenessStates(this.awareness, gone, this);
      this.on.control({ t: "pong", now: out.now });
      this.on.control({ t: "assign", assign: out.assign });
      this.on.control({ t: "role", role: out.role });
      if (out.stamp) this.on.control({ t: "stamp", ...out.stamp, now: out.now });
      if (out.rejected) this.on.control({ t: "rejected", reason: out.rejected });
      this.failures = 0;
      this.setStatus("online");
    } catch {
      this.failures++;
      this.setStatus("offline");
    } finally {
      this.httpBusy = false;
      if (!this.destroyed) {
        const wait = this.status === "offline" ? (BACKOFF[Math.min(this.failures - 1, BACKOFF.length - 1)] ?? 1000) : this.httpDirty ? 0 : HTTP_EVERY;
        this.scheduleHttp(wait);
      }
    }
  }

  // ─── 정리 ──────────────────────────────────────────────

  /** 서버에 다 반영될 때까지 (오프라인이면 바로) — 문서 히스토리 열기 · 내보내기 전에 */
  async flush(timeoutMs = 4000): Promise<void> {
    if (this.transport === "http" && this.pending) this.scheduleHttp(0);
    const end = Date.now() + timeoutMs;
    while (this.pending > 0 && this.status === "online" && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  }

  destroy() {
    this.destroyed = true;
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    if (this.retry) clearTimeout(this.retry);
    if (this.pinger) clearInterval(this.pinger);
    if (this.httpTimer) clearTimeout(this.httpTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, "closed");
  }
}
