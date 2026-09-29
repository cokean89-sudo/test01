// 의견 보내기 — 로그인 사용자만, 사용자당 전송 횟수 제한. DB 에 먼저 저장한 뒤 메일을 보낸다.
// 관리자(ADMIN_EMAILS)는 목록·상세·스크린샷을 보고 처리 상태를 바꿀 수 있다.

import express, { type Request, Router } from "express";
import { z } from "zod";
import { describeUserAgent, FEEDBACK_LIMITS, maskSensitiveUrl, safeFileName, sniffImage } from "../../shared/feedback";
import { requireUser } from "../context";
import { sendFeedbackMail } from "../mail";
import { isAdminUser, type Repo } from "../repo";
import { enforceLimit, HttpError } from "../security";

const HOUR = 60 * 60_000;
const MB = 1024 * 1024;

/** base64 는 원본의 4/3 — 장당 5MB 이미지가 들어갈 만큼만 허용 */
const DATA_URL_MAX = Math.ceil((FEEDBACK_LIMITS.fileBytes * 4) / 3) + 100;

const FeedbackInput = z.object({
  kind: z.enum(["bug", "idea", "other"]),
  message: z.string().trim().min(1, "내용을 적어 주세요.").max(FEEDBACK_LIMITS.messageMax, `내용은 ${FEEDBACK_LIMITS.messageMax.toLocaleString()}자까지 쓸 수 있어요.`),
  pageUrl: z.string().max(4000).default(""),
  viewport: z.string().max(40).optional(),
  screenshots: z
    .array(z.object({ name: z.string().max(300).default(""), dataUrl: z.string().max(DATA_URL_MAX, "스크린샷은 장당 5MB 이하만 첨부할 수 있어요.") }))
    .max(FEEDBACK_LIMITS.maxFiles, `스크린샷은 ${FEEDBACK_LIMITS.maxFiles}장까지 첨부할 수 있어요.`)
    .default([]),
});

function decodeScreenshot(s: { name: string; dataUrl: string }, index: number) {
  const m = /^data:([\w.+-]+\/[\w.+-]+)?;base64,([A-Za-z0-9+/=\s]+)$/.exec(s.dataUrl);
  if (!m) throw new HttpError(400, "스크린샷 형식이 올바르지 않아요.", "invalid_input");
  const data = Buffer.from(m[2], "base64");
  if (data.length === 0) throw new HttpError(400, "빈 이미지는 첨부할 수 없어요.", "invalid_input");
  if (data.length > FEEDBACK_LIMITS.fileBytes) throw new HttpError(400, "스크린샷은 장당 5MB 이하만 첨부할 수 있어요.", "file_too_large");
  const mime = sniffImage(data);
  if (!mime) throw new HttpError(400, "PNG · JPG · WebP · GIF 이미지만 첨부할 수 있어요.", "unsupported_file");
  return { name: safeFileName(s.name, mime, index), mime, data };
}

export function feedbackRouter(repo: Repo): Router {
  const r = Router();

  // 큰 본문을 읽기 전에 로그인·횟수부터 확인한다
  r.post(
    "/",
    (req, _res, next) => {
      const user = requireUser(req);
      enforceLimit(`feedback-try:${user.id}`, 30, HOUR); // 실패한 시도 포함 (큰 요청 반복 방지)
      if (repo.countFeedback(user.id, HOUR) >= FEEDBACK_LIMITS.perHour) {
        throw new HttpError(429, `의견은 한 시간에 ${FEEDBACK_LIMITS.perHour}번까지 보낼 수 있어요. 잠시 후 다시 보내 주세요.`, "rate_limited");
      }
      if (repo.countFeedback(user.id, 24 * HOUR) >= FEEDBACK_LIMITS.perDay) {
        throw new HttpError(429, `의견은 하루에 ${FEEDBACK_LIMITS.perDay}번까지 보낼 수 있어요. 내일 다시 보내 주세요.`, "rate_limited");
      }
      next();
    },
    express.json({ limit: `${Math.ceil((FEEDBACK_LIMITS.maxFiles * FEEDBACK_LIMITS.fileBytes * 4) / 3 / MB) + 4}mb` }),
    (req, res) => {
      const user = requireUser(req);
      const body = FeedbackInput.parse(req.body);
      const files = body.screenshots.map(decodeScreenshot);
      const userAgent = (req.get("user-agent") ?? "").slice(0, 500);
      const browser = [describeUserAgent(userAgent), body.viewport ? `화면 ${body.viewport.replace(/[^\d×x]/g, "")}` : ""].filter(Boolean).join(" · ");
      const input = {
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
        kind: body.kind,
        message: body.message,
        pageUrl: maskSensitiveUrl(body.pageUrl),
        browser,
        userAgent,
      };
      const id = repo.insertFeedback(input, files);
      repo.security("feedback_sent", user.id, req.ip, id);
      // 메일은 응답을 기다리게 하지 않는다 — 실패해도 DB 에 남아 관리 화면에서 볼 수 있다
      void deliver(repo, id, files);
      res.json({ ok: true, id });
    },
  );

  return r;
}

async function deliver(repo: Repo, id: string, files: { name: string; mime: string; data: Buffer }[]) {
  const fb = repo.getFeedback(id);
  if (!fb) return;
  try {
    const r = await sendFeedbackMail({ ...fb, files });
    repo.setFeedbackMail(id, r.delivered ? "sent" : "skipped");
  } catch (err) {
    console.error("의견 메일 발송 실패:", (err as Error).message);
    repo.setFeedbackMail(id, "failed", (err as Error).message);
  }
}

function requireAdmin(req: Request) {
  const user = requireUser(req);
  if (!isAdminUser(user)) throw new HttpError(403, "관리자만 볼 수 있어요.", "forbidden");
  return user;
}

export function adminRouter(repo: Repo): Router {
  const r = Router();

  r.get("/feedback", (req, res) => {
    requireAdmin(req);
    const status = z.enum(["open", "done", "all"]).default("open").parse(req.query.status ?? undefined);
    res.json({ items: repo.listFeedback({ status: status === "all" ? undefined : status }), open: repo.countOpenFeedback() });
  });

  r.get("/feedback/:id", (req, res) => {
    requireAdmin(req);
    const fb = repo.getFeedback(String(req.params.id));
    if (!fb) throw new HttpError(404, "의견을 찾을 수 없어요.", "not_found");
    res.json(fb);
  });

  r.get("/feedback/:id/files/:fileId", (req, res) => {
    requireAdmin(req);
    const f = repo.getFeedbackFile(String(req.params.id), String(req.params.fileId));
    if (!f) throw new HttpError(404, "파일을 찾을 수 없어요.", "not_found");
    const data = Buffer.from(f.data);
    // 저장할 때 검사했지만, 보여줄 때도 실제 형식을 다시 확인한다
    const mime = sniffImage(data);
    if (!mime) throw new HttpError(415, "이미지 파일이 아니에요.");
    res.set({
      "content-type": mime,
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "same-origin",
      "cache-control": "private, no-store",
    });
    res.send(data);
  });

  r.patch("/feedback/:id", (req, res) => {
    const user = requireAdmin(req);
    const { status } = z.object({ status: z.enum(["open", "done"]) }).parse(req.body);
    if (!repo.setFeedbackStatus(String(req.params.id), status)) throw new HttpError(404, "의견을 찾을 수 없어요.", "not_found");
    repo.security("feedback_status", user.id, req.ip, `${req.params.id}:${status}`);
    res.json(repo.getFeedback(String(req.params.id)));
  });

  // 메일이 실패했을 때 다시 보내기
  r.post("/feedback/:id/resend", async (req, res) => {
    const user = requireAdmin(req);
    enforceLimit(`feedback-resend:${user.id}`, 20, HOUR);
    const id = String(req.params.id);
    const fb = repo.getFeedback(id);
    if (!fb) throw new HttpError(404, "의견을 찾을 수 없어요.", "not_found");
    const files = fb.files.map((f) => {
      const row = repo.getFeedbackFile(id, f.id)!;
      return { name: row.name, mime: row.mime, data: Buffer.from(row.data) };
    });
    await deliver(repo, id, files);
    res.json(repo.getFeedback(id));
  });

  return r;
}
