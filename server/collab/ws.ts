// 공동 편집 WebSocket — /api/collab/<문서 id>
//
// 연결할 때: Origin 이 이 서버와 같은지(다른 사이트가 로그인 쿠키로 몰래 연결하지 못하게 — 변경 요청의 CSRF 헤더 대신),
// 로그인 쿠키(세션), 그 문서 팀의 멤버인지, 연결 횟수 제한을 확인한다.
// 연결된 뒤에도 25초마다 세션 · 권한을 다시 확인하고(로그아웃 · 팀에서 내보내기 · 권한 변경), 응답 없는 연결은 끊는다.

import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { APP_ORIGIN } from "../config";
import { hasRole } from "../context";
import type { Repo } from "../repo";
import { enforceLimit, parseCookies, SESSION_COOKIE } from "../security";
import { makePeer, peerUserOf, sendControl, type CollabHub } from "./hub";

const PATH = /^\/api\/collab\/([A-Za-z0-9_-]{1,40})\/?(?:\?.*)?$/;
const CHECK_MS = 25_000;
export const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return u.origin === APP_ORIGIN || (!!host && u.host === host);
  } catch {
    return false;
  }
}

function refuse(socket: Duplex, status: number, text: string) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function attachCollab(server: Server, hub: CollabHub, repo: Repo): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const m = PATH.exec(req.url ?? "");
    if (!m) return; // 다른 업그레이드(개발 서버의 화면 새로 고침 등)는 건드리지 않는다
    if (!sameOrigin(req.headers.origin, req.headers.host)) return refuse(socket, 403, "Forbidden");
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const user = token ? repo.resolveSession(token) : undefined;
    if (!token || !user) return refuse(socket, 401, "Unauthorized");
    const docId = m[1];
    const teamId = repo.docTeam(docId);
    const role = teamId ? repo.getRole(teamId, user.id) : undefined;
    if (!teamId || !role || !hasRole(role, "viewer")) return refuse(socket, 404, "Not Found");
    try {
      enforceLimit(`collab-ws:${user.id}`, 300, 10 * 60_000);
    } catch {
      return refuse(socket, 429, "Too Many Requests");
    }
    const room = hub.room(docId);
    if (!room) return refuse(socket, 404, "Not Found");

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      const peer = makePeer({
        kind: "ws",
        user: peerUserOf(user),
        role,
        send: (msg) => {
          if (ws.readyState === ws.OPEN) ws.send(msg);
        },
        close: (code, reason) => ws.close(code, reason),
      });
      room.join(peer);
      room.greet(peer);
      let alive = true;
      ws.on("pong", () => (alive = true));
      ws.on("message", (data: Buffer, isBinary: boolean) => {
        if (!isBinary) return;
        try {
          room.onMessage(peer, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        } catch (err) {
          console.error("공동 편집 메시지 처리 실패", docId, (err as Error).message);
          ws.close(4400, "bad message");
        }
      });
      const check = setInterval(() => {
        // 응답 없는 연결 · 로그아웃 · 팀에서 나감 · 권한 변경
        if (!alive) return ws.terminate();
        alive = false;
        ws.ping();
        const nowRole = repo.sessionAlive(token) ? repo.getRole(teamId, user.id) : undefined;
        if (!nowRole) return ws.close(4401, "unauthorized");
        if (nowRole !== peer.role) {
          peer.role = nowRole;
          sendControl(peer, { t: "role", role: nowRole });
        }
      }, CHECK_MS);
      check.unref?.();
      ws.on("close", () => {
        clearInterval(check);
        room.leave(peer);
      });
    });
  });
  return wss;
}
