// 메일 발송 — SMTP 가 설정되지 않았으면 서버 로그(실행 창)에 내용을 출력한다.

import nodemailer, { type Transporter } from "nodemailer";
import { APP_URL, FEEDBACK_EMAIL, mailConfigured, smtp } from "./config";

let transport: Transporter | null = null;

function getTransport(): Transporter | null {
  if (!mailConfigured) return null;
  transport ??= nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    requireTLS: !smtp.secure,
  });
  return transport;
}

export interface MailResult {
  delivered: boolean;
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function send(to: string, subject: string, lines: string[], link?: { url: string; label: string }): Promise<MailResult> {
  const text = [...lines, ...(link ? ["", `${link.label}: ${link.url}`] : []), "", "— RefBoard"].join("\n");
  const t = getTransport();
  if (!t) {
    console.log(`\n  ✉  [메일 미설정 — 아래 내용을 직접 전달하세요]\n  받는 사람: ${to}\n  제목: ${subject}\n  ${text.replace(/\n/g, "\n  ")}\n`);
    return { delivered: false };
  }
  const html = `<div style="font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:14px;line-height:1.6;color:#1b1b1b">
${lines.map((l) => `<p style="margin:0 0 8px">${escape(l)}</p>`).join("\n")}
${link ? `<p style="margin:20px 0"><a href="${escape(link.url)}" style="background:#151515;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${escape(link.label)}</a></p><p style="font-size:12px;color:#777">버튼이 동작하지 않으면 주소를 복사해 브라우저에 붙여넣으세요:<br>${escape(link.url)}</p>` : ""}
<p style="font-size:12px;color:#999;margin-top:24px">RefBoard · 본인이 요청하지 않았다면 이 메일을 무시하세요.</p></div>`;
  await t.sendMail({ from: smtp.from, to, subject, text, html });
  return { delivered: true };
}

export function sendVerifyMail(to: string, token: string) {
  return send(to, "[RefBoard] 메일 주소를 인증해 주세요", ["RefBoard 가입을 환영합니다.", "아래 버튼을 눌러 메일 주소 인증을 완료하세요. 링크는 24시간 동안 유효합니다."], {
    url: `${APP_URL}/#/verify/${token}`,
    label: "메일 인증하기",
  });
}

export function sendResetMail(to: string, token: string) {
  return send(to, "[RefBoard] 비밀번호 재설정", ["비밀번호 재설정 요청을 받았습니다.", "아래 버튼을 눌러 새 비밀번호를 설정하세요. 링크는 1시간 동안 유효합니다."], {
    url: `${APP_URL}/#/reset/${token}`,
    label: "비밀번호 재설정",
  });
}

export function sendExistingAccountMail(to: string) {
  return send(to, "[RefBoard] 이미 가입된 메일 주소입니다", [
    "이 메일 주소로 가입 요청이 있었지만 이미 가입된 계정이 있습니다.",
    "비밀번호가 기억나지 않으면 로그인 화면에서 '비밀번호 찾기'를 이용하세요.",
  ]);
}

export function sendInviteMail(to: string, teamName: string, inviterName: string, token: string) {
  return send(to, `[RefBoard] ${inviterName}님이 '${teamName}' 팀에 초대했습니다`, [
    `${inviterName}님이 RefBoard 팀 프로젝트 '${teamName}'에 초대했습니다.`,
    `이 초대는 ${to} 계정으로만 수락할 수 있습니다. 계정이 없다면 같은 메일 주소로 가입한 뒤 수락하세요.`,
    "초대 링크는 7일 동안 유효합니다.",
  ], {
    url: `${APP_URL}/#/invite/${token}`,
    label: "초대 수락하기",
  });
}

export interface FeedbackMail {
  id: string;
  kind: string;
  message: string;
  userEmail: string | null;
  userName: string;
  pageUrl: string;
  browser: string;
  userAgent: string;
  createdAt: number;
  files: { name: string; mime: string; data: Buffer }[];
}

const KIND_LABEL: Record<string, string> = { bug: "오류 신고", idea: "개선 요청", other: "기타" };

/** 의견 보내기 — 텍스트 메일 + 스크린샷 첨부. 메일이 설정되지 않았으면 로그로만 남긴다 */
export async function sendFeedbackMail(fb: FeedbackMail): Promise<MailResult> {
  const kind = KIND_LABEL[fb.kind] ?? fb.kind;
  const when = new Date(fb.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const subject = `[RefBoard 의견] ${kind} — ${fb.message.replace(/\s+/g, " ").slice(0, 40)}`;
  const text = [
    `유형: ${kind}`,
    `보낸 사람: ${fb.userName} <${fb.userEmail ?? "메일 없음(소셜 로그인)"}>`,
    `보낸 시각: ${when} (KST)`,
    `페이지: ${fb.pageUrl || "-"}`,
    `브라우저·OS·앱: ${fb.browser || "-"}`,
    `User-Agent: ${fb.userAgent || "-"}`,
    `스크린샷: ${fb.files.length}장`,
    `관리 화면: ${APP_URL}/#/admin/feedback/${fb.id}`,
    "",
    "── 내용 ──",
    fb.message,
  ].join("\n");
  const t = getTransport();
  if (!t) {
    console.log(`\n  ✉  [메일 미설정 — 의견이 DB 에만 저장됐어요]\n  받는 사람: ${FEEDBACK_EMAIL}\n  제목: ${subject}\n  ${text.replace(/\n/g, "\n  ")}\n`);
    return { delivered: false };
  }
  await t.sendMail({
    from: smtp.from,
    to: FEEDBACK_EMAIL,
    replyTo: fb.userEmail ?? undefined,
    subject,
    text,
    attachments: fb.files.map((f) => ({ filename: f.name, content: f.data, contentType: f.mime })),
  });
  return { delivered: true };
}

/** 이번 달 AI 예산 도달 — 관리자에게 한 번 */
export function sendBudgetAlertMail(to: string, a: { month: string; spentUsd: number; budgetUsd: number; resumes: string }) {
  return send(
    to,
    `[RefBoard] ${a.month} AI 예산 도달 — AI 기능이 멈췄어요`,
    [
      `${a.month} AI 예상 비용이 $${a.spentUsd.toFixed(2)} 로 월 예산 $${a.budgetUsd.toFixed(2)} 에 도달했어요.`,
      `모든 사용자의 AI 기능(글쓰기 · 태그 제안)이 ${a.resumes}까지 멈추고, 앱에는 'AI 쉬는 중' 안내가 보여요.`,
      "예산을 늘리려면 환경변수 AI_MONTHLY_BUDGET_USD 를 올리고 저장하세요 (재시작 후 바로 다시 켜져요).",
    ],
    { url: `${APP_URL}/#/admin/usage`, label: "사용량 대시보드 보기" },
  );
}
