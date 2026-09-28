import type {
  AnalyzeRequest,
  AnalyzeResult,
  AppStatus,
  CaseStudy,
  DocumentData,
  DocumentSummary,
  Reference,
  ScrapeResult,
  TagSuggestRequest,
  TagSuggestResult,
} from "../shared/types";

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `요청 실패 (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export type RefInput = Omit<Reference, "id" | "createdAt">;
export type RefPatch = Omit<Partial<RefInput>, "caseId"> & { caseId?: string | null };
export type CaseInput = Omit<CaseStudy, "id" | "createdAt">;

export interface BulkOp {
  ids: string[];
  addTags?: string[];
  removeTags?: string[];
  caseId?: string | null;
  kind?: "image" | "logo";
  delete?: boolean;
}

export const api = {
  status: () => request<AppStatus>("GET", "/api/status"),
  library: () => request<{ references: Reference[]; cases: CaseStudy[] }>("GET", "/api/library"),
  addRefs: (refs: RefInput[]) => request<{ created: Reference[]; merged: Reference[] }>("POST", "/api/references", refs),
  updateRef: (id: string, patch: RefPatch) => request<Reference>("PATCH", `/api/references/${id}`, patch),
  bulk: (op: BulkOp) => request<{ references: Reference[] }>("POST", "/api/references/bulk", op),
  renameTag: (from: string, to: string) =>
    request<{ references: Reference[]; cases: CaseStudy[] }>("POST", "/api/tags/rename", { from, to }),
  createCase: (c: CaseInput) => request<CaseStudy>("POST", "/api/cases", c),
  updateCase: (id: string, c: Partial<CaseInput>) => request<CaseStudy>("PATCH", `/api/cases/${id}`, c),
  deleteCase: (id: string) => request<{ ok: true }>("DELETE", `/api/cases/${id}`),
  documents: () => request<DocumentSummary[]>("GET", "/api/documents"),
  document: (id: string) => request<DocumentData>("GET", `/api/documents/${id}`),
  createDocument: (doc: Omit<DocumentData, "createdAt" | "updatedAt"> & Partial<DocumentData>) =>
    request<DocumentData>("POST", "/api/documents", doc),
  saveDocument: (doc: DocumentData) => request<{ updatedAt: number }>("PUT", `/api/documents/${doc.id}`, doc),
  duplicateDocument: (id: string) => request<DocumentSummary>("POST", `/api/documents/${id}/duplicate`),
  deleteDocument: (id: string) => request<{ ok: true }>("DELETE", `/api/documents/${id}`),
  scrape: (url: string) => request<ScrapeResult>("POST", "/api/scrape", { url }),
  analyze: (req: AnalyzeRequest) => request<AnalyzeResult>("POST", "/api/ai/analyze", req),
  suggestTags: (req: TagSuggestRequest) => request<TagSuggestResult>("POST", "/api/ai/tags", req),
  importBackup: (data: unknown, mode: "merge" | "replace") =>
    request<{ references: number; cases: number; documents: number }>("POST", "/api/backup", { data, mode }),
  loadSample: () => request<{ added: number }>("POST", "/api/sample"),
};

/** 외부 이미지 → 서버 프록시 URL (핫링크 차단/CORS 회피용). 같은 출처 경로는 그대로. */
export function proxied(src: string): string {
  if (!/^https?:\/\//i.test(src)) return src;
  return "/api/proxy?url=" + encodeURIComponent(src);
}
