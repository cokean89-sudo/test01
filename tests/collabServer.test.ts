// 실시간 공동 편집 서버 — WebSocket 로그인 · Origin · 권한, 실시간 전달, 보기 전용, 이미지 주소 검사, 담당자만 편집,
// 활동 기록 묶기, 버전 묶기, awareness(사용자 덮어쓰기 · 서버 시각), 다시 연결, HTTP 대체 경로, 페이지 맡기 권한, 복원

import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { applyDocDiff, yToContent, type DocContent } from "../shared/collab";
import { fromB64, MSG_AWARENESS, MSG_CONTROL, MSG_SYNC, toB64, type ControlMessage, type PeerState } from "../shared/collabProtocol";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "refboard-collab-"));
vi.spyOn(console, "log").mockImplementation(() => {});

let base = "";
let port = 0;
let close: () => void;

beforeAll(async () => {
  const { Database } = await import("../server/db");
  const { createApp } = await import("../server/app");
  const { attachCollab } = await import("../server/collab/ws");
  const created = createApp(new Database(":memory:"), { collab: { persistDelay: 30, persistMaxDelay: 200, unloadDelay: 60_000 } });
  const server = http.createServer(created.app);
  const wss = attachCollab(server, created.collab, created.repo);
  server.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  close = () => {
    for (const c of wss.clients) c.terminate();
    created.collab.close();
    server.close();
  };
});
afterAll(() => close?.());

class Client {
  cookies = new Map<string, string>();
  get cookie() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + url, {
      method,
      redirect: "manual",
      headers: { "content-type": "application/json", "x-refboard": "1", cookie: this.cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, v] = pair.split("=");
      this.cookies.set(k.trim(), v);
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }
  get = (u: string) => this.req("GET", u);
  post = (u: string, b?: unknown) => this.req("POST", u, b ?? {});
  put = (u: string, b?: unknown) => this.req("PUT", u, b ?? {});
  del = (u: string, b?: unknown) => this.req("DELETE", u, b ?? {});
}

const PW = "Refboard!2026";
let seq = 0;
async function signup(name: string) {
  (await import("../server/security")).limiter.clear();
  const c = new Client();
  const email = `co${++seq}-${Date.now()}@example.com`;
  const r = await c.post("/api/auth/signup", { email, password: PW, name });
  const token = String(r.json.devLink).split("/verify/")[1];
  const v = await c.post("/api/auth/verify", { token });
  expect(v.status).toBe(200);
  return { c, user: v.json.user as { id: string; name: string; profile: { color: string } } };
}

const page = (id: string, els: { id: string; text: string; role?: string }[]) => ({
  id,
  kind: "blank",
  layout: { mode: "grid", columns: 3, rows: 0, gap: 6, seed: 0 },
  area: { x: 0, y: 0, w: 100, h: 100 },
  elements: els.map((e) => ({ id: e.id, type: "text", role: e.role ?? "title", text: e.text, x: 0, y: 0, w: 10, h: 10 })),
});

/** 팀 하나 + 문서 하나, 다른 사람은 role 로 참여 */
async function setup(roles: ("editor" | "viewer" | "admin")[] = ["editor"]) {
  const owner = await signup("소유자");
  const t = await owner.c.post("/api/teams", { name: "공동팀" });
  const others = [];
  for (const [i, role] of roles.entries()) {
    const m = await signup(`팀원${i + 1}`);
    const inv = await owner.c.post(`/api/teams/${t.json.id}/invites/code`, { role: role === "admin" ? "admin" : role, password: "join-2026" });
    expect((await m.c.post("/api/invites/join", { code: inv.json.code, password: "join-2026" })).status).toBe(200);
    others.push(m);
  }
  const { defaultSettings } = await import("../src/lib/defaults");
  const doc = await owner.c.post(`/api/teams/${t.json.id}/documents`, {
    title: "공동 문서",
    settings: defaultSettings(),
    pages: [page("p1", [{ id: "t1", text: "제목" }, { id: "s1", text: "부제", role: "subtitle" }]), page("p2", [{ id: "t2", text: "둘째" }])],
  });
  return { owner, others, teamId: t.json.id as string, docId: doc.json.id as string };
}

interface Conn {
  ws: WebSocket;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  controls: ControlMessage[];
  closed: Promise<number>;
  edit: (fn: (c: DocContent) => void) => void;
  content: () => DocContent;
  close: () => void;
}

/** 브라우저 편집기처럼: 문서를 ?collab=1 로 받아 Y.Doc 을 만들고 WebSocket 으로 붙는다 */
async function connect(c: Client, docId: string, opts: { origin?: string; doc?: Y.Doc } = {}): Promise<Conn> {
  let doc = opts.doc;
  if (!doc) {
    const r = await c.get(`/api/documents/${docId}?collab=1`);
    expect(r.status).toBe(200);
    doc = new Y.Doc();
    Y.applyUpdate(doc, fromB64(r.json.ystate), "init");
  }
  const d = doc;
  const awareness = new awarenessProtocol.Awareness(d);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/collab/${docId}`, { headers: { cookie: c.cookie, origin: opts.origin ?? base } });
  const controls: ControlMessage[] = [];
  const REMOTE = { remote: true };
  const send = (b: Uint8Array) => ws.readyState === ws.OPEN && ws.send(b);
  d.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return;
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MSG_SYNC);
    syncProtocol.writeUpdate(e, u);
    send(encoding.toUint8Array(e));
  });
  awareness.on("update", ({ added, updated }: { added: number[]; updated: number[] }, origin: unknown) => {
    if (origin === REMOTE) return;
    const ids = [...added, ...updated].filter((id) => id === d.clientID);
    if (!ids.length) return;
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MSG_AWARENESS);
    encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(awareness, ids));
    send(encoding.toUint8Array(e));
  });
  ws.on("message", (raw: Buffer) => {
    const dec = decoding.createDecoder(new Uint8Array(raw));
    const type = decoding.readVarUint(dec);
    if (type === MSG_SYNC) {
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, MSG_SYNC);
      syncProtocol.readSyncMessage(dec, e, d, REMOTE);
      if (encoding.length(e) > 1) send(encoding.toUint8Array(e));
    } else if (type === MSG_AWARENESS) awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(dec), REMOTE);
    else if (type === MSG_CONTROL) controls.push(JSON.parse(decoding.readVarString(dec)));
  });
  const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => {
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, MSG_SYNC);
      syncProtocol.writeSyncStep1(e, d);
      send(encoding.toUint8Array(e));
      resolve();
    });
    ws.once("unexpected-response", (_req, res) => reject(new Error(String(res.statusCode))));
    ws.once("error", reject);
  });
  return {
    ws,
    doc: d,
    awareness,
    controls,
    closed,
    edit: (fn) => {
      const before = yToContent(d);
      const after = structuredClone(before);
      fn(after);
      d.transact(() => applyDocDiff(d, before, after), "me");
    },
    content: () => yToContent(d),
    close: () => ws.close(),
  };
}

async function until(fn: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("기다렸지만 조건이 맞지 않았어요");
    await new Promise((r) => setTimeout(r, 15));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const textOf = (c: DocContent, pageIdx: number, elIdx = 0) => (c.pages[pageIdx].elements[elIdx] as { text: string }).text;

/** 연결 거절 상태 코드 */
async function refusedWith(c: Client, docId: string, origin?: string): Promise<string> {
  try {
    const conn = await connect(c, docId, { origin, doc: new Y.Doc() });
    conn.close();
    return "open";
  } catch (err) {
    return (err as Error).message;
  }
}

describe("WebSocket 연결 확인", () => {
  it("로그인 · 같은 출처 · 팀 멤버만 연결된다", async () => {
    const { owner, docId } = await setup([]);
    expect(await refusedWith(new Client(), docId)).toBe("401");
    expect(await refusedWith(owner.c, docId, "https://evil.example.com")).toBe("403");
    const stranger = await signup("외부인");
    expect(await refusedWith(stranger.c, docId)).toBe("404");
    expect(await refusedWith(owner.c, docId)).toBe("open");
    // 문서 JSON 으로 받아도 다른 팀 사람은 못 본다
    expect((await stranger.c.get(`/api/documents/${docId}?collab=1`)).status).toBe(404);
  });
});

describe("실시간 동기화", () => {
  it("한 사람이 고치면 다른 사람에게 바로 오고, 저장된다", async () => {
    const { owner, others, docId } = await setup(["editor"]);
    const a = await connect(owner.c, docId);
    const b = await connect(others[0].c, docId);
    const t0 = Date.now();
    a.edit((x) => ((x.pages[0].elements[0] as { text: string }).text = "제목 (실시간)"));
    await until(() => textOf(b.content(), 0) === "제목 (실시간)");
    expect(Date.now() - t0).toBeLessThan(1000);
    await until(() => a.controls.some((m) => m.t === "ack"));
    // 0.03초 묶음 뒤 저장 — 목록 · 뷰어가 읽는 JSON 도
    await sleep(120);
    const got = await owner.c.get(`/api/documents/${docId}`);
    expect(got.json.pages[0].elements[0].text).toBe("제목 (실시간)");
    a.close();
    b.close();
  });

  it("같은 글 상자를 동시에 고쳐도 글자 단위로 합쳐진다", async () => {
    const { owner, others, docId } = await setup(["editor"]);
    const a = await connect(owner.c, docId);
    const b = await connect(others[0].c, docId);
    a.edit((x) => ((x.pages[0].elements[0] as { text: string }).text = "제목 A"));
    b.edit((x) => ((x.pages[0].elements[0] as { text: string }).text = "B 제목"));
    await until(() => textOf(a.content(), 0) === textOf(b.content(), 0) && textOf(a.content(), 0).length === "B 제목 A".length);
    expect(textOf(a.content(), 0)).toBe("B 제목 A");
    a.close();
    b.close();
  });

  it("끊긴 동안 고친 것은 다시 연결하면 올라간다", async () => {
    const { owner, others, docId } = await setup(["editor"]);
    const a = await connect(owner.c, docId);
    const b = await connect(others[0].c, docId);
    a.close();
    await a.closed;
    a.edit((x) => ((x.pages[1].elements[0] as { text: string }).text = "오프라인에서 고침"));
    await sleep(100);
    expect(textOf(b.content(), 1)).toBe("둘째");
    const again = await connect(owner.c, docId, { doc: a.doc });
    await until(() => textOf(b.content(), 1) === "오프라인에서 고침");
    again.close();
    b.close();
  });

  it("보기 전용은 받기만 — 보낸 변경은 반영되지 않는다", async () => {
    const { owner, others, docId } = await setup(["viewer"]);
    const a = await connect(owner.c, docId);
    const v = await connect(others[0].c, docId);
    v.edit((x) => ((x.pages[1].elements[0] as { text: string }).text = "몰래 고친 글"));
    await until(() => v.controls.some((m) => m.t === "ack"));
    await sleep(80);
    expect(textOf(a.content(), 1)).toBe("둘째");
    a.edit((x) => (x.title = "소유자가 바꾼 제목"));
    await until(() => v.content().title === "소유자가 바꾼 제목");
    a.close();
    v.close();
  });

  it("이미지 주소는 http(s) · 앱 이미지만 — 다른 주소는 서버가 바로 지운다", async () => {
    const { owner, others, docId } = await setup(["editor"]);
    const a = await connect(owner.c, docId);
    const b = await connect(others[0].c, docId);
    a.edit((x) =>
      x.pages[0].elements.push({ id: "img1", type: "image", src: "javascript:alert(1)", fit: "cover", x: 0, y: 0, w: 5, h: 5, sourceUrl: "data:text/html,x" } as never),
    );
    await until(() => b.content().pages[0].elements.some((e) => e.id === "img1"));
    await until(() => (a.content().pages[0].elements.find((e) => e.id === "img1") as { src: string }).src === "");
    const img = b.content().pages[0].elements.find((e) => e.id === "img1") as { src: string; sourceUrl?: string };
    await until(() => (b.content().pages[0].elements.find((e) => e.id === "img1") as { src: string }).src === "");
    expect(img.sourceUrl).toBeUndefined();
    a.close();
    b.close();
  });
});

describe("awareness", () => {
  it("이름 · 프로필은 서버가 실제 로그인한 사람으로 덮고, 선택 · 입력 시각을 서버 시계로 찍는다", async () => {
    const { owner, others, docId } = await setup(["editor"]);
    const a = await connect(owner.c, docId);
    const b = await connect(others[0].c, docId);
    a.awareness.setLocalState({ user: { id: "가짜", name: "가짜 이름" }, page: "p1", sel: ["t1"], act: 1 } as unknown as PeerState);
    await until(() => [...b.awareness.getStates().values()].some((s) => (s as PeerState).sel?.includes("t1")));
    const st = [...b.awareness.getStates().values()].find((s) => (s as PeerState).sel?.includes("t1")) as PeerState;
    expect(st.user?.name).toBe("소유자");
    expect(typeof st.selT).toBe("number");
    expect(typeof st.actT).toBe("number");
    await until(() => a.controls.some((m) => m.t === "stamp"));
    // 선택을 바꾸지 않고 입력만 하면 선택 시각은 그대로
    const selT = st.selT;
    a.awareness.setLocalState({ page: "p1", sel: ["t1"], act: 2 } as PeerState);
    await until(() => ([...b.awareness.getStates().values()].find((s) => (s as PeerState).act === 2) as PeerState | undefined) !== undefined);
    const st2 = [...b.awareness.getStates().values()].find((s) => (s as PeerState).act === 2) as PeerState;
    expect(st2.selT).toBe(selT);
    // 나가면 사라진다
    a.close();
    await until(() => ![...b.awareness.getStates().values()].some((s) => (s as PeerState).sel?.includes("t1")));
    b.close();
  });
});

describe("페이지 맡기 · 담당자만 편집", () => {
  it("맡기 · 해제 권한: 맡은 사람, 문서를 만든 사람, 팀 관리자", async () => {
    const { owner, others, teamId, docId } = await setup(["editor", "editor", "admin"]);
    const [b, c, admin] = others;
    const D = `/api/teams/${teamId}/documents/${docId}`;
    const r = await b.c.post(`${D}/pages/p1/assign`);
    expect(r.status).toBe(200);
    expect(r.json.assignments.p1).toMatchObject({ userId: b.user.id, name: "팀원1" });
    // 남이 맡은 페이지는 맡을 수 없고, 해제도 못 한다
    expect((await c.c.post(`${D}/pages/p1/assign`)).status).toBe(409);
    expect((await c.c.del(`${D}/pages/p1/assign`)).status).toBe(403);
    // 팀 관리자 · 문서를 만든 사람은 해제할 수 있다
    expect((await admin.c.del(`${D}/pages/p1/assign`)).json.assignments.p1).toBeUndefined();
    await b.c.post(`${D}/pages/p1/assign`);
    expect((await owner.c.del(`${D}/pages/p1/assign`)).json.assignments.p1).toBeUndefined();
    // 없는 페이지
    expect((await b.c.post(`${D}/pages/nope/assign`)).status).toBe(404);
    // 담당자만 편집은 문서를 만든 사람 · 관리자만
    expect((await c.c.put(`${D}/assign-strict`, { strict: true })).status).toBe(403);
    expect((await admin.c.put(`${D}/assign-strict`, { strict: true })).json.strict).toBe(true);
  });

  it("담당자만 편집이면 남이 맡은 페이지를 고친 변경은 서버가 되돌린다 — 다른 페이지는 그대로", async () => {
    const { owner, others, teamId, docId } = await setup(["editor"]);
    const D = `/api/teams/${teamId}/documents/${docId}`;
    const a = await connect(owner.c, docId);
    const b = await connect(others[0].c, docId);
    await owner.c.post(`${D}/pages/p1/assign`);
    await until(() => b.controls.some((m) => m.t === "assign" && !!m.assign.assignments.p1));
    // 엄격 모드가 아니면 고칠 수 있다
    b.edit((x) => ((x.pages[0].elements[1] as { text: string }).text = "부제 (허용)"));
    await until(() => textOf(a.content(), 0, 1) === "부제 (허용)");
    await owner.c.put(`${D}/assign-strict`, { strict: true });
    await until(() => b.controls.some((m) => m.t === "assign" && m.assign.strict));
    b.edit((x) => ((x.pages[0].elements[1] as { text: string }).text = "부제 (거절)"));
    await until(() => b.controls.some((m) => m.t === "rejected"));
    await until(() => textOf(b.content(), 0, 1) === "부제 (허용)");
    await sleep(80);
    expect(textOf(a.content(), 0, 1)).toBe("부제 (허용)");
    // 맡지 않은 페이지는 그대로 된다
    b.edit((x) => ((x.pages[1].elements[0] as { text: string }).text = "둘째 (허용)"));
    await until(() => textOf(a.content(), 1) === "둘째 (허용)");
    // 남이 맡은 페이지 삭제도 거절
    b.edit((x) => x.pages.splice(0, 1));
    await until(() => b.controls.filter((m) => m.t === "rejected").length >= 2);
    await until(() => b.content().pages.length === 2);
    a.close();
    b.close();
  });

  it("팀에서 나가면 맡은 페이지가 풀리고 연결이 끊긴다", async () => {
    const { owner, others, teamId, docId } = await setup(["editor"]);
    const b = others[0];
    const D = `/api/teams/${teamId}/documents/${docId}`;
    await b.c.post(`${D}/pages/p2/assign`);
    const conn = await connect(b.c, docId);
    await owner.c.del(`/api/teams/${teamId}/members/${b.user.id}`);
    expect(await conn.closed).toBe(4403);
    expect((await owner.c.get(`/api/documents/${docId}?collab=1`)).json.assign.assignments.p2).toBeUndefined();
  });
});

describe("활동 기록 · 버전", () => {
  it("요소 단위로 남기고, 같은 사람 · 같은 페이지 2분 안의 수정은 한 줄로 묶는다", async () => {
    const { owner, others, teamId, docId } = await setup(["editor"]);
    const D = `/api/teams/${teamId}/documents/${docId}`;
    const a = await connect(owner.c, docId);
    a.edit((x) => ((x.pages[0].elements[0] as { text: string }).text = "제목 1"));
    a.edit((x) => ((x.pages[0].elements[0] as { text: string }).text = "제목 12"));
    a.edit((x) => Object.assign(x.pages[0].elements[1], { x: 40 }));
    await until(() => a.controls.filter((m) => m.t === "ack").length >= 3);
    let act = (await owner.c.get(`${D}/activity`)).json;
    expect(act).toHaveLength(1);
    expect(act[0]).toMatchObject({ userId: owner.user.id, pageId: "p1" });
    expect(act[0].items).toEqual([
      { el: "s1", label: "서브타이틀", action: "위치 변경" },
      { el: "t1", label: "타이틀", action: "수정" },
    ]);
    // 다른 페이지 → 새 줄, 다른 사람 → 새 줄
    a.edit((x) => x.pages[1].elements.splice(0, 1));
    const b = await connect(others[0].c, docId);
    b.edit((x) => ((x.pages[0].elements[0] as { text: string }).text = "제목 B"));
    await until(() => b.controls.some((m) => m.t === "ack"));
    await until(() => a.controls.filter((m) => m.t === "ack").length >= 4);
    act = (await owner.c.get(`${D}/activity`)).json;
    expect(act.map((r: { pageId: string; userName: string }) => `${r.userName}:${r.pageId}`)).toEqual(["팀원1:p1", "소유자:p2", "소유자:p1"]);
    expect(act[1].items).toEqual([{ el: "t2", label: "타이틀", action: "삭제" }]);
    a.close();
    b.close();
  });

  it("요소를 다른 페이지로 옮기면 양쪽 페이지에 '옮김'으로 남는다", async () => {
    const { owner, teamId, docId } = await setup([]);
    const a = await connect(owner.c, docId);
    a.edit((x) => {
      const [el] = x.pages[0].elements.splice(1, 1);
      x.pages[1].elements.push(el);
    });
    await until(() => a.controls.some((m) => m.t === "ack"));
    const act = (await owner.c.get(`/api/teams/${teamId}/documents/${docId}/activity`)).json as { pageId: string; items: { action: string }[] }[];
    expect(act.find((r) => r.pageId === "p1")!.items[0].action).toBe("다른 페이지로 옮김");
    expect(act.find((r) => r.pageId === "p2")!.items[0].action).toBe("옮겨 옴");
    a.close();
  });

  it("버전 기록: 같은 사람이 1분 안에 이어서 고치면 한 버전, 복원은 모두에게 바로 보인다", async () => {
    const { owner, others, teamId, docId } = await setup(["editor"]);
    const D = `/api/teams/${teamId}/documents/${docId}`;
    const a = await connect(owner.c, docId);
    const b = await connect(others[0].c, docId);
    a.edit((x) => (x.title = "v2 제목"));
    await sleep(120);
    a.edit((x) => (x.title = "v2 제목 계속"));
    await sleep(120);
    const versions = (await owner.c.get(`${D}/versions`)).json as { version: number }[];
    expect(versions[0].version).toBe(2);
    b.edit((x) => (x.title = "다른 사람 제목"));
    await sleep(150);
    expect((await owner.c.get(`${D}/versions`)).json[0].version).toBe(3);
    // v1 로 복원 → 연결된 두 사람 모두 바로
    const r = await owner.c.post(`${D}/versions/1/restore`);
    expect(r.json.title).toBe("공동 문서");
    await until(() => a.content().title === "공동 문서" && b.content().title === "공동 문서");
    const act = (await owner.c.get(`${D}/activity`)).json as { items: { action: string }[] }[];
    expect(act[0].items[0].action).toBe("v1 버전으로 복원");
    a.close();
    b.close();
  });
});

describe("HTTP 대체 경로", () => {
  it("WebSocket 없이도 변경 · awareness 를 주고받는다", async () => {
    const { owner, others, docId } = await setup(["editor"]);
    const a = await connect(owner.c, docId);
    a.awareness.setLocalState({ page: "p2", sel: [], act: 1 } as PeerState);
    // HTTP 로 참여하는 사람
    const r0 = await others[0].c.get(`/api/documents/${docId}?collab=1`);
    const hd = new Y.Doc();
    Y.applyUpdate(hd, fromB64(r0.json.ystate));
    const before = yToContent(hd);
    const after = structuredClone(before);
    (after.pages[0].elements[0] as { text: string }).text = "HTTP 로 고침";
    const sv = Y.encodeStateVector(hd);
    hd.transact(() => applyDocDiff(hd, before, after));
    const res = await others[0].c.post(`/api/collab/${docId}/sync`, { clientId: hd.clientID, sv: toB64(Y.encodeStateVector(hd)), update: toB64(Y.encodeStateAsUpdate(hd, sv)) });
    expect(res.status).toBe(200);
    await until(() => textOf(a.content(), 0) === "HTTP 로 고침");
    // 다른 사람 awareness 도 받는다
    const aw = new awarenessProtocol.Awareness(new Y.Doc());
    awarenessProtocol.applyAwarenessUpdate(aw, fromB64(res.json.awareness), "x");
    expect([...aw.getStates().values()].some((s) => (s as PeerState).page === "p2" && (s as PeerState).user?.name === "소유자")).toBe(true);
    // CSRF 헤더 없으면 거절
    expect((await others[0].c.req("POST", `/api/collab/${docId}/sync`, { clientId: 1, sv: "" }, { "x-refboard": "" })).status).toBe(403);
    a.close();
  });
});
