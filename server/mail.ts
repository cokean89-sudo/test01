// 메일 발송 — SMTP 가 설정되지 않았으면 서버 로그(실행 창)에 내용을 출력한다.

import nodemailer, { type Transporter } from "nodemailer";
import { APP_URL, mailConfigured, smtp } from "./config";

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
