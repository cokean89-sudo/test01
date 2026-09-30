import { create } from "zustand";
import type { AppStatus, CaseStudy, DuplicateInfo, Reference } from "../../shared/types";
import { api, type BulkOp, type CaseInput, type RefInput, type RefPatch } from "../api";
import { useSession } from "./session";
import { toast } from "./toast";

interface LibraryState {
  refs: Reference[];
  cases: CaseStudy[];
  loaded: boolean;
  /** 불러온 라이브러리의 팀 */
  teamId: string;
  status: AppStatus | null;
  load: () => Promise<void>;
  reset: () => void;
  addRefs: (inputs: RefInput[]) => Promise<{ created: Reference[]; duplicates: DuplicateInfo[] }>;
  updateRef: (id: string, patch: RefPatch) => Promise<void>;
  bulk: (op: BulkOp) => Promise<void>;
  /** 링크 레퍼런스를 서버 사본으로 */
  copyRef: (id: string) => Promise<void>;
  renameTag: (from: string, to: string) => Promise<void>;
  mergeTags: (from: string[], to: string) => Promise<void>;
  deleteTags: (tags: string[]) => Promise<void>;
  createCase: (input: CaseInput) => Promise<CaseStudy>;
  updateCase: (id: string, patch: Partial<CaseInput>) => Promise<void>;
  deleteCase: (id: string) => Promise<void>;
}

export const useLibrary = create<LibraryState>((set, get) => ({
  refs: [],
  cases: [],
  loaded: false,
  teamId: "",
  status: null,

  async load() {
    const teamId = useSession.getState().teamId;
    if (!teamId) return;
    const [lib, status] = await Promise.all([api.library(), get().status ? Promise.resolve(get().status) : api.status().catch(() => null)]);
    // 불러오는 사이 팀을 바꿨으면 버린다
    if (useSession.getState().teamId !== teamId) return;
    set({ refs: lib.references, cases: lib.cases, status, loaded: true, teamId });
  },

  reset() {
    set({ refs: [], cases: [], loaded: false, teamId: "" });
  },

  async addRefs(inputs) {
    const result = await api.addRefs(inputs);
    const updated = new Map(result.duplicates.map((d) => [d.existing.id, d.existing]));
    set({ refs: [...result.created, ...get().refs.map((r) => updated.get(r.id) ?? r)] });
    return result;
  },

  async updateRef(id, patch) {
    // 낙관적 업데이트
    const prev = get().refs;
    set({
      refs: prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch } as Reference;
        if (patch.caseId === null) delete next.caseId;
        return next;
      }),
    });
    try {
      const saved = await api.updateRef(id, patch);
      set({ refs: get().refs.map((r) => (r.id === id ? saved : r)) });
    } catch (err) {
      set({ refs: prev });
      toast.error((err as Error).message);
    }
  },

  async bulk(op) {
    const { references } = await api.bulk(op);
    set({ refs: references });
  },

  async copyRef(id) {
    const saved = await api.copyRef(id);
    set({ refs: get().refs.map((r) => (r.id === id ? saved : r)) });
  },

  async mergeTags(from, to) {
    const { references, cases } = await api.mergeTags(from, to);
    set({ refs: references, cases });
  },

  async deleteTags(tags) {
    const { references, cases } = await api.deleteTags(tags);
    set({ refs: references, cases });
  },

  async renameTag(from, to) {
    const { references, cases } = await api.renameTag(from, to);
    set({ refs: references, cases });
  },

  async createCase(input) {
    const c = await api.createCase(input);
    set({ cases: [c, ...get().cases] });
    return c;
  },

  async updateCase(id, patch) {
    const c = await api.updateCase(id, patch);
    set({ cases: get().cases.map((x) => (x.id === id ? c : x)) });
  },

  async deleteCase(id) {
    await api.deleteCase(id);
    set({
      cases: get().cases.filter((c) => c.id !== id),
      refs: get().refs.map((r) => {
        if (r.caseId !== id) return r;
        const next = { ...r };
        delete next.caseId;
        return next;
      }),
    });
  },
}));

export function tagVocabulary(refs: Reference[], limit = 120): string[] {
  const freq = new Map<string, number>();
  for (const r of refs) for (const t of r.tags) freq.set(t, (freq.get(t) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([t]) => t);
}
