// 공동 작업 화면 부품 — 다른 사람의 선택 테두리 · 이름표, 히스토리 하이라이트, 페이지 썸네일의 보는 사람 · 담당자 깃발,
// 페이지 맡기 동작, 문서 설정의 '담당자만 편집'.

import type { CSSProperties } from "react";
import { profileColorVar } from "../../../shared/profile";
import { ROLE_RANK, type Page, type Rect } from "../../../shared/types";
import { api } from "../../api";
import { UserAvatar } from "../../components/Avatar";
import { Icon } from "../../components/icons";
import { Toggle } from "../../components/ui";
import { isActive, serverNow, useEditor, type Peer } from "../../store/editor";
import { toast } from "../../store/toast";

/** 이 페이지에서 다른 사람이 선택한 요소 — 그 사람 고유 색 네모 테두리 + 이름표 (30초 입력이 없으면 흐리게 '자리 비움') */
export function RemoteSelections({ page, rectPx }: { page: Page; rectPx: (r: Rect) => CSSProperties }) {
  const peers = useEditor((s) => s.peers);
  const me = useEditor((s) => s.me);
  useEditor((s) => s.clock);
  const now = serverNow();
  const shown: { peer: Peer; el: Page["elements"][number] }[] = [];
  const seen = new Set<string>();
  for (const p of peers) {
    if (p.userId === me || p.page !== page.id) continue;
    for (const id of p.sel) {
      const el = page.elements.find((e) => e.id === id);
      const key = `${p.userId}:${id}`;
      if (el && !seen.has(key)) {
        seen.add(key);
        shown.push({ peer: p, el });
      }
    }
  }
  return (
    <>
      {shown.map(({ peer, el }) => {
        const color = profileColorVar(peer.color);
        const active = isActive(peer, now);
        return (
          <div
            key={peer.clientId + ":" + el.id}
            className={"remote-sel" + (active ? "" : " idle")}
            style={{ ...rectPx(el), borderColor: color }}
            data-remote-user={peer.userId}
            data-remote-el={el.id}
          >
            <span className="remote-tag" style={{ background: color }}>
              {peer.name}
              {peer.editing === el.id ? " · 입력 중" : !active ? " · 자리 비움" : ""}
            </span>
          </div>
        );
      })}
    </>
  );
}

/** 히스토리에서 고른 요소를 그 사람 색으로 2초 동안 */
export function HighlightOverlay({ page, rectPx }: { page: Page; rectPx: (r: Rect) => CSSProperties }) {
  const h = useEditor((s) => s.highlight);
  if (!h || h.pageId !== page.id) return null;
  const color = profileColorVar(h.color);
  const els = page.elements.filter((e) => h.ids.includes(e.id));
  // 남아 있는 요소는 그 자리에, 지워진 요소가 있으면 페이지 전체 테두리 + 안내
  return (
    <>
      {(h.deleted || !els.length) && (
        <div className="hl-page" style={{ borderColor: color }}>
          <span className="hl-note" style={{ background: color }}>
            {h.deleted ? "삭제된 요소예요" : "이 페이지에서 바뀌었어요"}
          </span>
        </div>
      )}
      {els.map((el) => (
        <div key={el.id} className="hl-box" style={{ ...rectPx(el), borderColor: color, color }} data-hl-el={el.id} />
      ))}
    </>
  );
}

/** 페이지 썸네일 — 그 페이지를 보고 있는 사람 (최대 3명 + 숫자) */
export function PageViewers({ pageId }: { pageId: string }) {
  const presence = useEditor((s) => s.presence);
  const here = presence.filter((p) => p.pageId === pageId);
  if (!here.length) return null;
  return (
    <span className="page-viewers" title={here.map((p) => p.name).join(", ") + " 님이 보는 중"}>
      {here.slice(0, 3).map((p) => (
        <UserAvatar key={p.userId} profile={p.profile} name={p.name} size="xs" ring />
      ))}
      {here.length > 3 && <span className="page-viewers-more">+{here.length - 3}</span>}
    </span>
  );
}

/** 페이지 썸네일 — 담당자 깃발(고유 색) + 프로필 */
export function AssigneeFlag({ pageId }: { pageId: string }) {
  const a = useEditor((s) => s.assign.assignments[pageId]);
  const me = useEditor((s) => s.me);
  if (!a) return null;
  return (
    <span className={"page-flag" + (a.userId === me ? " mine" : "")} title={`${a.name}님이 맡은 페이지`} data-assignee={a.userId}>
      <Icon name="flag" size={13} style={{ color: profileColorVar(a.profile.color) }} />
      <UserAvatar profile={a.profile} name={a.name} size="xs" />
    </span>
  );
}

/** 문서를 만든 사람 · 팀 관리자 (남의 깃발 해제 · 담당자만 편집 설정) */
export function useCanManageAssign(): boolean {
  const createdBy = useEditor((s) => s.doc?.createdBy);
  const me = useEditor((s) => s.me);
  const role = useEditor((s) => s.role);
  return createdBy === me || (!!role && ROLE_RANK[role] >= ROLE_RANK.admin);
}

export async function assignPage(pageId: string) {
  const { doc } = useEditor.getState();
  if (!doc?.teamId) return;
  try {
    useEditor.setState({ assign: await api.assignPage(doc.teamId, doc.id, pageId) });
    toast.success("이 페이지를 맡았어요");
  } catch (err) {
    toast.error((err as Error).message);
  }
}

export async function unassignPage(pageId: string) {
  const { doc } = useEditor.getState();
  if (!doc?.teamId) return;
  try {
    useEditor.setState({ assign: await api.unassignPage(doc.teamId, doc.id, pageId) });
    toast.success("맡기를 해제했어요");
  } catch (err) {
    toast.error((err as Error).message);
  }
}

/** 문서 설정 — 공동 작업 */
export function CollabSettings() {
  const strict = useEditor((s) => s.assign.strict);
  const doc = useEditor((s) => s.doc)!;
  const canManage = useCanManageAssign();
  return (
    <div className="collab-settings">
      <Toggle
        checked={strict}
        disabled={!canManage}
        label="담당자만 편집"
        onChange={async (on) => {
          if (!doc.teamId) return;
          try {
            useEditor.setState({ assign: await api.setAssignStrict(doc.teamId, doc.id, on) });
            toast.success(on ? "맡은 페이지는 담당자만 편집할 수 있어요" : "맡은 페이지도 확인 후 편집할 수 있어요");
          } catch (err) {
            toast.error((err as Error).message);
          }
        }}
      />
      <p className="muted small">
        {strict ? "다른 사람이 맡은 페이지는 담당자만 고칠 수 있어요." : "다른 사람이 맡은 페이지를 고치려 하면 한 번 확인해요."}
        {!canManage && " 문서를 만든 사람이나 팀 관리자가 바꿀 수 있어요."}
      </p>
    </div>
  );
}
