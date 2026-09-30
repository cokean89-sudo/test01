// 레퍼런스 지우기 전 확인 — 서버에 저장한 이미지는 함께 지워지고, 그 이미지를 쓰는 문서에서는 회색 박스가 된다

import { api } from "../api";

export async function confirmRefDelete(ids: string[], what: string): Promise<boolean> {
  const check = await api.deleteCheck(ids).catch(() => ({ files: 0, docs: [] as { title: string }[] }));
  const lines = [`${what}를 삭제할까요?`, ""];
  if (check.files) {
    lines.push(`올린 이미지 · 사본 ${check.files}개는 서버에서도 함께 지워져요.`);
    if (check.docs.length) {
      const names = check.docs
        .slice(0, 3)
        .map((d) => `'${d.title}'`)
        .join(", ");
      lines.push(`이 이미지를 쓰는 문서 ${check.docs.length}개(${names}${check.docs.length > 3 ? " 등" : ""})에서는 그 자리가 회색 박스로 바뀌어요.`);
    }
    if (check.files < ids.length) lines.push("링크로 저장한 이미지는 문서에 그대로 남아요.");
  } else {
    lines.push("문서에 이미 배치된 이미지는 그대로 남아요.");
  }
  return confirm(lines.join("\n"));
}
