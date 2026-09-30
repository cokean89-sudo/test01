// 업데이트 소식(RELEASE_NOTES.md) — 어떤 소식을 봤는지는 사용자별로 이 브라우저에 기억한다 (버전 번호만 저장)

import { create } from "zustand";
import { unseenVersions } from "../lib/changelog";
import { RELEASE_NOTES } from "../lib/releaseNotes";

const key = (userId: string) => `rb.updatesSeen.${userId}`;

function readSeen(userId: string): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(userId)) ?? "null");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

interface UpdatesState {
  userId: string | null;
  unseen: Set<string>;
  /** 전체 보기 창 (focus = 먼저 보여 줄 버전) */
  open: boolean;
  focus: string | null;
  init: (user: { id: string; createdAt?: number } | null) => void;
  markSeen: (versions: string[]) => void;
  openAll: (focus?: string) => void;
  close: () => void;
}

export const useUpdates = create<UpdatesState>((set, get) => ({
  userId: null,
  unseen: new Set(),
  open: false,
  focus: null,
  init(user) {
    if (!user) return set({ userId: null, unseen: new Set(), open: false });
    set({ userId: user.id, unseen: unseenVersions(RELEASE_NOTES, readSeen(user.id), user.createdAt) });
  },
  markSeen(versions) {
    const { userId, unseen } = get();
    if (!userId || !versions.some((v) => unseen.has(v))) return;
    const next = new Set([...unseen].filter((v) => !versions.includes(v)));
    set({ unseen: next });
    try {
      // 본 것 = 전체 - 안 본 것. 다음 버전이 나오면 그 버전만 새 소식이 된다
      localStorage.setItem(key(userId), JSON.stringify(RELEASE_NOTES.map((e) => e.version).filter((v) => !next.has(v))));
    } catch {
      /* 저장 못 해도 이번 화면에서는 읽음으로 보인다 */
    }
  },
  openAll(focus) {
    set({ open: true, focus: focus ?? null });
  },
  close() {
    // 전체 기록을 열어 봤으면 모두 읽음
    get().markSeen(RELEASE_NOTES.map((e) => e.version));
    set({ open: false, focus: null });
  },
}));
