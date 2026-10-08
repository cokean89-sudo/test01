// 실시간 알림 (Server-Sent Events) — 팀원이 추가·수정한 레퍼런스 · 문서 목록 · 팀 정보를 즉시 전달한다.
// 문서 편집 중의 변경 · 접속자 · 선택은 공동 편집(server/collab, WebSocket)이 맡는다.
// 단일 서버 프로세스 기준(메모리). 여러 대로 확장하려면 Redis pub/sub 등으로 바꿔야 한다.

import type { Request, Response } from "express";

interface Client {
  res: Response;
  userId: string;
}

const teams = new Map<string, Set<Client>>();

function send(c: Client, event: string, data: unknown) {
  c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function publish(teamId: string, event: string, data: unknown, exceptUserId?: string) {
  for (const c of teams.get(teamId) ?? []) if (c.userId !== exceptUserId) send(c, event, data);
}

/**
 * 실시간 연결을 연다. `stillAllowed` 는 주기적으로 다시 확인해, 로그아웃·세션 만료·팀에서 내보내기 등으로
 * 권한이 사라진 연결이 계속 데이터를 받지 않게 끊는다.
 */
export function subscribe(req: Request, res: Response, teamId: string, userId: string, stillAllowed: () => boolean) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // Nginx 버퍼링 끄기
  });
  res.write("retry: 3000\n\n");
  const client: Client = { res, userId };
  if (!teams.has(teamId)) teams.set(teamId, new Set());
  teams.get(teamId)!.add(client);
  let closed = false;
  const drop = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    teams.get(teamId)?.delete(client);
  };
  const ping = setInterval(() => {
    if (!stillAllowed()) {
      drop();
      res.end();
      return;
    }
    res.write(": ping\n\n");
  }, 25_000);
  req.on("close", drop);
}

/** 팀에서 내보낸 사용자의 실시간 연결을 끊는다 */
export function disconnectUser(teamId: string, userId: string) {
  for (const c of [...(teams.get(teamId) ?? [])]) {
    if (c.userId === userId) {
      send(c, "removed", { teamId });
      c.res.end();
      teams.get(teamId)?.delete(c);
    }
  }
}
