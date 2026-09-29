// 팀 프로젝트: 멤버·권한, 초대(메일 / 코드+비밀번호), 문서 기본 설정, 활동 기록, 실시간 이벤트

import { Router } from "express";
import { z } from "zod";
import { ROLE_LABEL, ROLE_RANK, type DocSettings, type Role } from "../../shared/types";
import { APP_URL } from "../config";
import { requireUser, teamRole } from "../context";
import { disconnectUser, publish, subscribe, updatePresence } from "../events";
import { sendInviteMail } from "../mail";
import { INVITE_MAX_FAILURES, inviteStatus, type Repo } from "../repo";
import { enforceLimit, hashPassword, HttpError, isCommonPassword, randomCode, verifyPassword } from "../security";

const DAY = 24 * 60 * 60 * 1000;
const role = z.enum(["owner", "admin", "editor", "viewer"]);
const teamName = z.string().trim().min(1, "팀 이름을 입력하세요.").max(60);

/** 문서 기본 설정 — 구조는 느슨하게, 크기는 엄격하게 검사 */
const defaultsSchema = z
  .object({
    pageSize: z.enum(["a4-landscape", "a4-portrait", "a3-landscape", "wide-16-9"]),
    margin: z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() }),
    background: z.string().max(30),
    accent: z.string().max(30),
    footer: z.record(z.string(), z.unknown()),
    header: z.record(z.string(), z.unknown()),
    pageNumberStart: z.number(),
    typography: z.record(z.string(), z.record(z.string(), z.unknown())),
    aiLanguage: z.enum(["ko", "en"]),
    aiPerspective: z.enum(["design", "planning", "fact"]).optional(),
    aiTone: z.enum(["report", "sentence"]).optional(),
  })
  .passthrough();

export function teamsRouter(repo: Repo): Router {
  const r = Router();

  r.get("/", (req, res) => {
    res.json(repo.listTeams(requireUser(req).id));
  });

  r.post("/", (req, res) => {
    const user = requireUser(req);
    enforceLimit(`team-create:${user.id}`, 20, DAY);
    const { name } = z.object({ name: teamName }).parse(req.body);
    const id = repo.createTeam(name, user.id);
    repo.log(id, user.id, "team.create", `팀 '${name}' 생성`);
    res.json(repo.teamDetail(id, "owner"));
  });

  r.get("/:teamId", teamRole(repo, "viewer"), (req, res) => {
    res.json(repo.teamDetail(req.teamId!, req.role!));
  });

  r.patch("/:teamId", teamRole(repo, "admin"), (req, res) => {
    const { name } = z.object({ name: teamName }).parse(req.body);
    repo.renameTeam(req.teamId!, name);
    repo.log(req.teamId!, req.user!.id, "team.rename", `팀 이름을 '${name}'(으)로 변경`);
    publish(req.teamId!, "team", {});
    res.json(repo.teamDetail(req.teamId!, req.role!));
  });

  r.delete("/:teamId", teamRole(repo, "owner"), (req, res) => {
    const team = repo.getTeam(req.teamId!)!;
    if (team.personal) throw new HttpError(400, "개인 작업공간은 삭제할 수 없어요.");
    const { confirm } = z.object({ confirm: z.string() }).parse(req.body ?? {});
    if (confirm !== team.name) throw new HttpError(400, "확인을 위해 팀 이름을 정확히 입력하세요.");
    publish(req.teamId!, "removed", { teamId: req.teamId });
    repo.deleteTeam(req.teamId!);
    repo.security("team_deleted", req.user!.id, req.ip, team.name);
    res.json({ ok: true });
  });

  r.put("/:teamId/defaults", teamRole(repo, "admin"), (req, res) => {
    const defaults = defaultsSchema.parse(req.body?.defaults) as unknown as DocSettings;
    if (JSON.stringify(defaults).length > 100_000) throw new HttpError(413, "설정이 너무 커요.");
    repo.setDefaults(req.teamId!, defaults);
    repo.log(req.teamId!, req.user!.id, "team.defaults", "문서 기본 설정 변경");
    publish(req.teamId!, "team", {});
    res.json(repo.teamDetail(req.teamId!, req.role!));
  });

  // ─── members ──────────────────────────────────────────────

  r.patch("/:teamId/members/:userId", teamRole(repo, "admin"), (req, res) => {
    const teamId = req.teamId!;
    const me = req.user!;
    const targetId = String(req.params.userId);
    const { role: next } = z.object({ role }).parse(req.body);
    const current = repo.getRole(teamId, targetId);
    if (!current) throw new HttpError(404, "멤버를 찾을 수 없어요.");
    const iAmOwner = req.role === "owner";
    if (!iAmOwner && (current === "owner" || next === "owner" || (next === "admin" && current !== "admin"))) {
      throw new HttpError(403, "소유자만 소유자·관리자 권한을 바꿀 수 있어요.");
    }
    if (current === "owner" && next !== "owner" && repo.ownerCount(teamId) <= 1) throw new HttpError(400, "팀에는 소유자가 최소 한 명 있어야 해요.");
    repo.setRole(teamId, targetId, next);
    const target = repo.getUser(targetId);
    repo.log(teamId, me.id, "member.role", `${target?.name ?? "멤버"} 권한: ${ROLE_LABEL[current]} → ${ROLE_LABEL[next]}`);
    repo.security("role_changed", me.id, req.ip, `${teamId}:${targetId}:${current}->${next}`);
    publish(teamId, "team", {});
    res.json(repo.teamDetail(teamId, req.role!));
  });

  r.delete("/:teamId/members/:userId", teamRole(repo, "viewer"), (req, res) => {
    const teamId = req.teamId!;
    const me = req.user!;
    const targetId = String(req.params.userId);
    const self = targetId === me.id;
    const current = repo.getRole(teamId, targetId);
    if (!current) throw new HttpError(404, "멤버를 찾을 수 없어요.");
    const team = repo.getTeam(teamId)!;
    if (self && team.personal) throw new HttpError(400, "개인 작업공간에서는 나갈 수 없어요.");
    if (!self && ROLE_RANK[req.role!] < ROLE_RANK.admin) throw new HttpError(403, "멤버를 내보낼 권한이 없어요.");
    if (!self && current === "owner" && req.role !== "owner") throw new HttpError(403, "소유자는 다른 소유자만 내보낼 수 있어요.");
    if (current === "owner" && repo.ownerCount(teamId) <= 1) throw new HttpError(400, "마지막 소유자는 나갈 수 없어요. 먼저 다른 멤버를 소유자로 지정하세요.");
    const target = repo.getUser(targetId);
    repo.removeMember(teamId, targetId);
    repo.log(teamId, me.id, self ? "member.leave" : "member.remove", self ? `${me.name} 님이 팀을 나감` : `${target?.name ?? "멤버"} 님을 내보냄`);
    repo.security(self ? "team_left" : "member_removed", me.id, req.ip, `${teamId}:${targetId}`);
    disconnectUser(teamId, targetId);
    publish(teamId, "team", {});
    res.json({ ok: true });
  });

  // ─── invites ──────────────────────────────────────────────

  /** 초대 권한: 관리자 이상, 자기보다 높은 권한으로는 초대 불가, 소유자 초대는 불가 */
  const inviteRole = (requester: Role, wanted: Role) => {
    if (wanted === "owner") throw new HttpError(400, "소유자 권한으로는 초대할 수 없어요. 가입 후 권한을 변경하세요.");
    if (ROLE_RANK[wanted] > ROLE_RANK[requester]) throw new HttpError(403, "자신보다 높은 권한으로 초대할 수 없어요.");
    return wanted;
  };

  r.get("/:teamId/invites", teamRole(repo, "admin"), (req, res) => {
    res.json(repo.listInvites(req.teamId!));
  });

  r.post("/:teamId/invites/email", teamRole(repo, "admin"), async (req, res) => {
    const me = req.user!;
    enforceLimit(`invite:${me.id}`, 50, DAY, "하루 초대 한도를 넘었어요.");
    const body = z.object({ email: z.string().trim().toLowerCase().email("올바른 메일 주소가 아니에요.").max(254), role: role.default("editor") }).parse(req.body);
    const wanted = inviteRole(req.role!, body.role);
    const existing = repo.findUserByEmail(body.email);
    if (existing && repo.getRole(req.teamId!, existing.id)) throw new HttpError(409, "이미 팀 멤버예요.");
    const team = repo.getTeam(req.teamId!)!;
    const { id, token } = repo.createEmailInvite(req.teamId!, body.email, wanted, me.id);
    const mail = await sendInviteMail(body.email, team.name, me.name, token);
    repo.log(req.teamId!, me.id, "invite.email", `${body.email} 초대 (${ROLE_LABEL[wanted]})`);
    // 링크는 해당 메일 계정으로만 수락할 수 있으므로 관리자에게 보여줘도 안전하다 (메신저로 직접 전달용)
    res.json({ id, link: `${APP_URL}/#/invite/${token}`, mailDelivered: mail.delivered, invites: repo.listInvites(req.teamId!) });
  });

  r.post("/:teamId/invites/code", teamRole(repo, "admin"), async (req, res) => {
    const me = req.user!;
    enforceLimit(`invite:${me.id}`, 50, DAY, "하루 초대 한도를 넘었어요.");
    const body = z
      .object({
        role: role.default("editor"),
        password: z.string().max(100).optional(),
        expiresInDays: z.number().int().min(1).max(30).default(7),
        maxUses: z.number().int().min(1).max(200).default(10),
      })
      .parse(req.body);
    const wanted = inviteRole(req.role!, body.role);
    const password = body.password?.trim() || randomCode(8);
    if (password.length < 6) throw new HttpError(400, "초대 비밀번호는 6자 이상이어야 해요.");
    if (isCommonPassword(password)) throw new HttpError(400, "너무 흔한 비밀번호예요.");
    const code = randomCode(10);
    const id = repo.createCodeInvite(req.teamId!, {
      code,
      passwordHash: await hashPassword(password),
      role: wanted,
      by: me.id,
      expiresAt: Date.now() + body.expiresInDays * DAY,
      maxUses: body.maxUses,
    });
    repo.log(req.teamId!, me.id, "invite.code", `초대 코드 발급 (${ROLE_LABEL[wanted]}, ${body.maxUses}명, ${body.expiresInDays}일)`);
    // 비밀번호는 이 응답에서만 보여주고 서버에는 해시만 남긴다
    res.json({ id, code, password, invites: repo.listInvites(req.teamId!) });
  });

  r.delete("/:teamId/invites/:inviteId", teamRole(repo, "admin"), (req, res) => {
    if (!repo.revokeInvite(req.teamId!, String(req.params.inviteId))) throw new HttpError(404, "초대를 찾을 수 없어요.");
    repo.log(req.teamId!, req.user!.id, "invite.revoke", "초대 취소");
    res.json(repo.listInvites(req.teamId!));
  });

  // ─── activity / realtime ──────────────────────────────────

  r.get("/:teamId/activity", teamRole(repo, "viewer"), (req, res) => {
    const before = req.query.before ? Number(req.query.before) : undefined;
    res.json(repo.activity(req.teamId!, 100, Number.isFinite(before) ? before : undefined));
  });

  r.get("/:teamId/events", teamRole(repo, "viewer"), (req, res) => {
    const docId = typeof req.query.doc === "string" && /^[\w-]{1,40}$/.test(req.query.doc) ? req.query.doc : undefined;
    if (docId && repo.docTeam(docId) !== req.teamId) throw new HttpError(404, "문서를 찾을 수 없어요.");
    const token = req.sessionToken!;
    const teamId = req.teamId!;
    const userId = req.user!.id;
    subscribe(req, res, teamId, { id: userId, name: req.user!.name }, docId, () => repo.sessionAlive(token) && !!repo.getRole(teamId, userId));
  });

  r.post("/:teamId/presence", teamRole(repo, "viewer"), (req, res) => {
    const body = z.object({ docId: z.string().max(40), pageId: z.string().max(40).optional() }).parse(req.body);
    updatePresence(req.teamId!, req.user!.id, body.docId, body.pageId);
    res.json({ ok: true });
  });

  return r;
}

export function invitesRouter(repo: Repo): Router {
  const r = Router();

  r.get("/preview", (req, res) => {
    const user = requireUser(req);
    enforceLimit(`invite-preview:${user.id}`, 60, 60 * 60_000);
    const token = String(req.query.token ?? "");
    const inv = token.length >= 10 && token.length <= 200 ? repo.inviteByToken(token) : undefined;
    if (!inv) throw new HttpError(404, "초대를 찾을 수 없어요.");
    const team = repo.getTeam(inv.team_id);
    const inviter = inv.created_by ? repo.getUser(inv.created_by) : undefined;
    res.json({
      teamName: team?.name,
      inviterName: inviter?.name,
      email: inv.email,
      role: inv.role,
      status: inviteStatus(inv),
      emailMatches: !!user.email && user.email.toLowerCase() === inv.email?.toLowerCase(),
      alreadyMember: !!repo.getRole(inv.team_id, user.id),
    });
  });

  r.post("/accept", (req, res) => {
    const user = requireUser(req);
    enforceLimit(`invite-accept:${user.id}`, 20, 60 * 60_000);
    const { token } = z.object({ token: z.string().min(10).max(200) }).parse(req.body);
    const inv = repo.inviteByToken(token);
    if (!inv) throw new HttpError(404, "초대를 찾을 수 없어요.");
    if (repo.getRole(inv.team_id, user.id)) return res.json({ teamId: inv.team_id, already: true });
    const status = inviteStatus(inv);
    if (status !== "active") throw new HttpError(410, status === "expired" ? "만료된 초대예요. 다시 초대를 요청하세요." : "더 이상 사용할 수 없는 초대예요.");
    if (!user.email || user.email.toLowerCase() !== inv.email?.toLowerCase()) {
      throw new HttpError(403, `이 초대는 ${inv.email} 계정으로만 수락할 수 있어요.`, "email_mismatch");
    }
    if (!user.email_verified_at) throw new HttpError(403, "메일 인증을 먼저 완료하세요.", "unverified");
    if (!repo.useInvite(inv.id)) throw new HttpError(410, "더 이상 사용할 수 없는 초대예요.");
    repo.addMember(inv.team_id, user.id, inv.role);
    repo.log(inv.team_id, user.id, "member.join", `${user.name} 님이 메일 초대로 참여 (${ROLE_LABEL[inv.role]})`);
    repo.security("invite_accepted", user.id, req.ip, inv.team_id);
    publish(inv.team_id, "team", {});
    res.json({ teamId: inv.team_id });
  });

  r.post("/join", async (req, res) => {
    const user = requireUser(req);
    enforceLimit(`invite-join:${user.id}`, 10, 15 * 60_000, "시도가 너무 많아요. 15분 후 다시 시도하세요.");
    enforceLimit(`invite-join:${req.ip}`, 30, 15 * 60_000, "시도가 너무 많아요. 15분 후 다시 시도하세요.");
    const body = z.object({ code: z.string().trim().min(4).max(40), password: z.string().min(1).max(100) }).parse(req.body);
    const inv = repo.inviteByCode(body.code);
    // 코드가 없거나 비밀번호가 틀려도 같은 메시지 (코드 존재 여부 노출 방지)
    const invalid = new HttpError(400, "초대 코드 또는 비밀번호가 올바르지 않아요.", "invalid_invite");
    const ok = await verifyPassword(body.password, inv?.password_hash);
    if (!inv) throw invalid;
    if (repo.getRole(inv.team_id, user.id) && ok) return res.json({ teamId: inv.team_id, already: true });
    const status = inviteStatus(inv);
    if (status === "locked") throw new HttpError(423, "비밀번호 오류가 반복되어 이 초대 코드는 잠겼어요. 관리자에게 새 코드를 요청하세요.");
    if (!ok) {
      repo.inviteFailed(inv.id);
      repo.security("invite_join_failed", user.id, req.ip, inv.id);
      if (inv.failed_attempts + 1 >= INVITE_MAX_FAILURES) repo.log(inv.team_id, null, "invite.locked", "초대 코드가 비밀번호 오류 반복으로 잠김");
      throw invalid;
    }
    if (status !== "active") throw new HttpError(410, status === "expired" ? "만료된 초대 코드예요." : "더 이상 사용할 수 없는 초대 코드예요.");
    if (!repo.useInvite(inv.id)) throw new HttpError(410, "더 이상 사용할 수 없는 초대 코드예요.");
    repo.addMember(inv.team_id, user.id, inv.role);
    repo.log(inv.team_id, user.id, "member.join", `${user.name} 님이 초대 코드로 참여 (${ROLE_LABEL[inv.role]})`);
    repo.security("invite_joined", user.id, req.ip, inv.team_id);
    publish(inv.team_id, "team", {});
    res.json({ teamId: inv.team_id });
  });

  return r;
}
