// 공동 편집 HTTP 대체 경로 — WebSocket 이 막힌 회사망 · 프록시에서 1.5초마다 주고받는다.
//   POST /api/collab/:docId/sync  { sv, update?, awareness?, clientId } → { update, sv, awareness, assign, role, now }
// 같은 Yjs 방 · 같은 검사(권한 · 이미지 주소 · 담당자만 편집 · 활동 기록)를 거친다. 변경 요청이라 CSRF 헤더를 거친다.

import { Router } from "express";
import { z } from "zod";
import type { HttpSyncRequest } from "../../shared/collabProtocol";
import type { CollabHub } from "../collab/hub";
import { hasRole, requireUser } from "../context";
import type { Repo } from "../repo";
import { enforceLimit, HttpError } from "../security";

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function collabRouter(repo: Repo, collab: CollabHub): Router {
  const r = Router();
  r.post("/:docId/sync", (req, res) => {
    const user = requireUser(req);
    const docId = String(req.params.docId);
    const teamId = /^[A-Za-z0-9_-]{1,40}$/.test(docId) ? repo.docTeam(docId) : undefined;
    const role = teamId ? repo.getRole(teamId, user.id) : undefined;
    if (!teamId || !role || !hasRole(role, "viewer")) throw new HttpError(404, "문서를 찾을 수 없어요.");
    enforceLimit(`collab-http:${user.id}`, 3000, 10 * 60_000);
    const body = z
      .object({
        sv: z.string().max(1_000_000).regex(B64),
        update: z.string().max(12_000_000).regex(B64).optional(),
        awareness: z.string().max(200_000).regex(B64).optional(),
        clientId: z.number().int().nonnegative(),
      })
      .parse(req.body) as HttpSyncRequest;
    const out = collab.httpSync(docId, user, role, body);
    if (!out) throw new HttpError(404, "문서를 찾을 수 없어요.");
    res.json(out);
  });
  return r;
}
