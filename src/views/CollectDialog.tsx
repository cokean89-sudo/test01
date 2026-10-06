// 레퍼런스 추가 창 — 링크 · 파일 · 스크린샷을 카드로 모아, 카드마다(또는 여러 장 한 번에) 태그 · 케이스를 정하고 저장한다.
//
//   · 카드 = 이미지 한 장. 올린 이미지 · 핀 · 이미지 링크는 처음부터 '담김', 웹페이지 후보는 고른 것만 담긴다.
//   · 카드마다 [저장] 하거나, 여러 장을 골라 [선택한 N장 저장], 남은 것은 [나머지 전체 저장].
//   · 저장한 카드는 '저장됨'으로 흐리게 남고, 선택 · 전체 저장 대상에서 빠진다. 창은 닫히지 않는다.
//   · 모두 저장하면 "12장을 저장했어요 (미분류 3장)" 화면, 저장 안 한 것이 남은 채 닫으면 확인을 받는다.

import { useEffect, useMemo, useRef, useState } from "react";
import { isUnclassified, UNCLASSIFIED } from "../../shared/tags";
import type { DuplicateInfo, Reference, RefSource, ScrapeResult, StorageUsage, StoredFile, TagSuggestResult } from "../../shared/types";
import { api, type RefInput } from "../api";
import { SmartImage } from "../components/SmartImage";
import { StorageMeter, storageState } from "../components/StorageMeter";
import { Icon } from "../components/icons";
import { TagSuggestions } from "../components/TagSuggestions";
import { Button, Field, Modal, Segmented, Spinner, TagInput, Toggle } from "../components/ui";
import { navigate } from "../lib/router";
import { normalizeTags } from "../lib/search";
import { ACCEPT_ATTR, checkFile, eachLimit, formatBytes, hasFiles, imageFilesFrom, titleFromName } from "../lib/uploads";
import { tagVocabulary, useLibrary } from "../store/library";
import { toast } from "../store/toast";
import { useUI } from "../store/ui";

interface Candidate {
  key: string;
  imageUrl: string;
  sourceUrl?: string;
  title: string;
  width?: number;
  height?: number;
  source: RefSource;
  /** 팀 라이브러리에 이미 있는 같은 이미지 */
  duplicate?: Reference;
  /** 내 컴퓨터에서 올린 이미지 */
  upload?: UploadState;
  fileId?: string;
  thumbUrl?: string;
  /** 이번에 올린 것 중 먼저 올린 같은 파일 */
  sameAs?: string;
  /** 저장할 목록에 담김 — 올린 이미지 · 핀 · 이미지 링크는 처음부터, 웹페이지 후보는 고른 것만 */
  picked: boolean;
  /** 여러 장에 한 번에 태그 · 케이스를 정하거나 골라서 저장할 때의 선택 */
  selected: boolean;
  tags: string[];
  /** "" = 케이스 없음 */
  caseId: string;
  saving?: boolean;
  saved?: SavedInfo;
}

interface SavedInfo {
  refId: string;
  /** 이미 있던 이미지라 새로 만들지 않고 태그만 더함 */
  duplicate: boolean;
  unclassified: boolean;
}

interface UploadState {
  status: "uploading" | "done" | "error";
  progress: number;
  error?: string;
  name: string;
  size: number;
  /** 올리는 동안 보여 줄 미리보기 (브라우저 안의 임시 주소) */
  preview?: string;
}

const COPY_KEY = "rb.copyLinks";
const readCopyPref = () => {
  try {
    return localStorage.getItem(COPY_KEY) === "1";
  } catch {
    return false;
  }
};

interface SourceBlock {
  url: string;
  status: "loading" | "done" | "error";
  error?: string;
  result?: ScrapeResult;
  items: Candidate[];
}

const SOURCE_OF: Record<ScrapeResult["kind"], RefSource> = {
  "pinterest-pin": "pinterest",
  "pinterest-board": "pinterest",
  webpage: "web",
  image: "image",
};

const KIND_LABEL: Record<ScrapeResult["kind"], string> = {
  "pinterest-pin": "Pinterest 핀",
  "pinterest-board": "Pinterest 보드",
  webpage: "웹페이지",
  image: "이미지 링크",
};

const isFailed = (c: Candidate) => c.upload?.status === "error";
/** 올리기가 끝났고(링크는 바로) 같은 파일이 아님 → 저장할 수 있는 상태 */
const isReady = (c: Candidate) => !c.sameAs && !isFailed(c) && (c.source !== "upload" || c.upload?.status === "done");
/** 담겼지만 아직 저장하지 않은 이미지 (올리는 중 포함) — 닫을 때 확인 · 모두 저장했는지 판단 */
const isUnsaved = (c: Candidate) => c.picked && !c.saved && !isFailed(c) && !c.sameAs;
/** 지금 저장할 수 있는 것 */
const canSave = (c: Candidate) => isUnsaved(c) && isReady(c) && !c.saving;

export function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s"'<>]+|(?:www\.|pin\.it\/)[^\s"'<>]+/gi) ?? [];
  return [...new Set(found.map((u) => u.replace(/[),.]+$/, "")))];
}

export function CollectDialog({ initialUrls, initialFiles }: { initialUrls?: string; initialFiles?: File[] }) {
  const closeDialog = useUI((s) => s.closeCollect);
  const setFocusRef = useUI((s) => s.setFocusRef);
  const { refs, cases, addRefs, createCase, status } = useLibrary();
  const vocab = useMemo(() => tagVocabulary(refs), [refs]);

  const [input, setInput] = useState(initialUrls ?? "");
  const [blocks, setBlocks] = useState<SourceBlock[]>([]);
  const [uploads, setUploads] = useState<Candidate[]>([]);
  // 여러 장에 한 번에
  const [bulkTags, setBulkTags] = useState<string[]>([]);
  const [bulkCase, setBulkCase] = useState("");
  const [newCaseName, setNewCaseName] = useState("");
  const [creatingCase, setCreatingCase] = useState(false);
  const [suggest, setSuggest] = useState<TagSuggestResult | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  // 저장할 때 모든 이미지에 함께
  const [kind, setKind] = useState<"image" | "logo">("image");
  const [logoLabel, setLogoLabel] = useState("");
  const [note, setNote] = useState("");
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [copyLinks, setCopyLinksState] = useState(readCopyPref);
  const [dragging, setDragging] = useState(false);
  const [copying, setCopying] = useState<{ done: number; total: number } | null>(null);
  // 이번 창에서 저장한 결과 (완료 화면)
  const [summary, setSummary] = useState<{ created: string[]; unclassified: number; duplicates: DuplicateInfo[] }>({ created: [], unclassified: 0, duplicates: [] });
  const [done, setDone] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const cards = useMemo(() => [...uploads, ...blocks.flatMap((b) => b.items)], [uploads, blocks]);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const setCopyLinks = (v: boolean) => {
    setCopyLinksState(v);
    try {
      localStorage.setItem(COPY_KEY, v ? "1" : "0");
    } catch {
      /* 기억 못 해도 이번 창에서는 동작 */
    }
  };

  /** 저장하지 않은 채 올려 둔 파일은 지운다 (서버는 레퍼런스가 쓰는 파일은 지우지 않는다) */
  const discardUnsavedFiles = () => {
    const kept = new Set(cardsRef.current.filter((c) => c.saved && c.fileId).map((c) => c.fileId));
    for (const c of cardsRef.current) if (c.fileId && !c.saved && !c.duplicate && !kept.has(c.fileId)) void api.deleteUpload(c.fileId).catch(() => undefined);
  };

  /** 닫기 — 저장하지 않은 이미지가 남았으면 먼저 묻는다 */
  const close = () => {
    const unsaved = cardsRef.current.filter(isUnsaved).length;
    if (unsaved && !confirm(`저장하지 않은 이미지 ${unsaved}장이 사라져요. 닫을까요?`)) return;
    discardUnsavedFiles();
    closeDialog();
  };

  // 창이 닫히면 미리보기용 임시 주소 정리
  useEffect(() => () => cardsRef.current.forEach((u) => u.upload?.preview && URL.revokeObjectURL(u.upload.preview)), []);

  useEffect(() => {
    if (initialUrls) void fetchAll(initialUrls);
    if (initialFiles?.length) void addFiles(initialFiles);
    api.storage().then(setUsage, () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⌘V / Ctrl+V: 스크린샷 등 이미지는 올리고, 입력 칸 밖에서 붙여넣은 링크는 가져온다
  const actions = useRef({ addFiles, fetchAll });
  actions.current = { addFiles, fetchAll };
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = imageFilesFrom(e.clipboardData);
      if (files.length) {
        e.preventDefault();
        void actions.current.addFiles(files);
        return;
      }
      const t = e.target as HTMLElement;
      if (t?.closest?.("input, textarea, [contenteditable]")) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (extractUrls(text).length) {
        e.preventDefault();
        void actions.current.fetchAll(text);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // ─── 카드 상태 ───────────────────────────────────────────

  function patchCards(pred: (c: Candidate) => boolean, patch: Partial<Candidate> | ((c: Candidate) => Partial<Candidate>)) {
    const apply = (c: Candidate) => (pred(c) ? { ...c, ...(typeof patch === "function" ? patch(c) : patch) } : c);
    setUploads((prev) => prev.map(apply));
    setBlocks((prev) => prev.map((b) => ({ ...b, items: b.items.map(apply) })));
  }
  const updateCard = (key: string, patch: Partial<Candidate>) => patchCards((c) => c.key === key, patch);

  /** 이미지 파일 올리기 — 3장씩 동시에, 한 장씩 진행률 · 실패 이유 표시 */
  async function addFiles(files: File[]) {
    setDone(false);
    const full = storageState(usage) === "full";
    const stamp = Date.now();
    const items: Candidate[] = files.map((f, i) => {
      const problem = full ? "팀 저장 공간이 가득 찼어요" : checkFile(f);
      return {
        key: `upload-${stamp}-${i}`,
        imageUrl: "",
        title: titleFromName(f.name),
        source: "upload",
        picked: true,
        selected: false,
        tags: [],
        caseId: "",
        upload: { status: problem ? "error" : "uploading", progress: 0, error: problem ?? undefined, name: f.name || "붙여넣은 이미지", size: f.size, preview: problem ? undefined : URL.createObjectURL(f) },
      };
    });
    setUploads((prev) => [...prev, ...items]);
    const jobs = items.map((c, i) => ({ c, f: files[i] })).filter((j) => j.c.upload!.status === "uploading");
    await eachLimit(jobs, 3, async ({ c, f }) => {
      const patchUpload = (u: Partial<UploadState>) => setUploads((prev) => prev.map((x) => (x.key === c.key ? { ...x, upload: { ...x.upload!, ...u } } : x)));
      try {
        const { file, usage: next } = await api.uploadFile(f, f.name || "clipboard.png", (progress) => patchUpload({ progress }));
        setUsage(next);
        // 같은 이미지가 이미 라이브러리에 있으면 알려 준다
        const dup = (await api.checkDuplicates([file.url]).catch(() => [] as DuplicateInfo[]))[0]?.existing;
        setUploads((prev) => {
          // 이번에 같은 파일을 두 번 올렸으면 두 번째는 '같은 파일'로 표시하고 담지 않는다
          const same = prev.find((x) => x.key !== c.key && x.fileId === file.id);
          return prev.map((x) =>
            x.key === c.key ? { ...x, ...fromStored(file), duplicate: dup, sameAs: same?.key, picked: !dup && !same, selected: false, upload: { ...x.upload!, status: "done", progress: 1 } } : x,
          );
        });
      } catch (err) {
        patchUpload({ status: "error", error: (err as Error).message });
      }
    });
  }

  function removeUpload(key: string) {
    const u = uploads.find((x) => x.key === key);
    if (u?.upload?.preview) URL.revokeObjectURL(u.upload.preview);
    // 같은 파일을 쓰는 다른 카드가 있으면 파일은 남긴다
    const shared = uploads.some((x) => x.key !== key && x.fileId === u?.fileId);
    if (u?.fileId && !u.duplicate && !shared) void api.deleteUpload(u.fileId).then((r) => setUsage(r.usage), () => undefined);
    setUploads((prev) => prev.filter((x) => x.key !== key).map((x) => (x.sameAs === key ? { ...x, sameAs: undefined, picked: !x.duplicate } : x)));
  }

  async function fetchAll(text: string) {
    const urls = extractUrls(text).filter((u) => !blocks.some((b) => b.url === u));
    if (!urls.length) {
      toast.error("링크를 찾지 못했어요. http(s):// 로 시작하는 주소를 붙여넣으세요.");
      return;
    }
    setDone(false);
    setInput("");
    setBlocks((prev) => [...prev, ...urls.map((url) => ({ url, status: "loading" as const, items: [] }))]);
    await Promise.all(
      urls.map(async (url) => {
        try {
          const result = await api.scrape(url);
          const single = result.kind !== "webpage";
          const items: Candidate[] = result.items.map((it, i) => ({
            key: url + "#" + i,
            imageUrl: it.imageUrl,
            sourceUrl: it.sourceUrl ?? (result.kind === "image" ? undefined : result.url),
            title: it.title ?? result.title ?? "",
            picked: single || i < 6,
            selected: false,
            tags: [],
            caseId: "",
            width: it.width,
            height: it.height,
            source: SOURCE_OF[result.kind],
          }));
          // 팀 라이브러리에 이미 있는 이미지인지 확인 (누가 언제 추가했는지)
          const dups = await api.checkDuplicates(items.map((i) => i.imageUrl)).catch(() => [] as DuplicateInfo[]);
          const dupMap = new Map(dups.map((d) => [d.imageUrl, d.existing]));
          for (const it of items) {
            const d = dupMap.get(it.imageUrl);
            if (d) {
              it.duplicate = d;
              it.picked = false;
            }
          }
          setBlocks((prev) => prev.map((b) => (b.url === url ? { ...b, status: "done", result, items } : b)));
        } catch (err) {
          setBlocks((prev) => prev.map((b) => (b.url === url ? { ...b, status: "error", error: (err as Error).message } : b)));
        }
      }),
    );
  }

  const uploading = uploads.filter((u) => u.upload?.status === "uploading").length;
  const unsaved = cards.filter(isUnsaved);
  const savable = cards.filter(canSave);
  const selectedCards = cards.filter((c) => c.selected && isUnsaved(c));
  const selectedSavable = selectedCards.filter(canSave);
  const savedCount = cards.filter((c) => c.saved).length;
  const saving = cards.some((c) => c.saving);
  const full = storageState(usage) === "full";
  const caseName = (id: string) => cases.find((c) => c.id === id)?.name;

  // ─── 여러 장에 한 번에 ───────────────────────────────────

  const selectAll = () => patchCards(isUnsaved, { selected: true });
  const clearSelection = () => patchCards(() => true, { selected: false });

  function applyTags(target: "selected" | "all") {
    if (!bulkTags.length) return;
    const pred = target === "selected" ? (c: Candidate) => c.selected && isUnsaved(c) : isUnsaved;
    const n = cards.filter(pred).length;
    patchCards(pred, (c) => ({ tags: normalizeTags([...c.tags, ...bulkTags]) }));
    toast.success(`${target === "selected" ? "선택한 " : ""}${n}장에 태그를 붙였어요`);
  }

  function applyCase(target: "selected" | "all") {
    if (bulkCase === "__new") return;
    const pred = target === "selected" ? (c: Candidate) => c.selected && isUnsaved(c) : isUnsaved;
    const n = cards.filter(pred).length;
    patchCards(pred, { caseId: bulkCase });
    toast.success(bulkCase ? `${target === "selected" ? "선택한 " : ""}${n}장을 '${caseName(bulkCase)}' 케이스로 정했어요` : `${n}장의 케이스를 비웠어요`);
  }

  /** 새 케이스 — 이름만 넣으면 바로 만들고 골라 둔다 */
  async function makeCase() {
    const name = newCaseName.trim();
    if (!name) return;
    setCreatingCase(true);
    try {
      const c = await createCase({ name, tags: [] });
      setBulkCase(c.id);
      setNewCaseName("");
      toast.success(`'${c.name}' 케이스를 만들었어요`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreatingCase(false);
    }
  }

  // ─── 저장 ────────────────────────────────────────────────

  async function saveCards(list: Candidate[]) {
    const targets = list.filter(canSave);
    if (!targets.length) return;
    const keys = new Set(targets.map((c) => c.key));
    patchCards((c) => keys.has(c.key), { saving: true });
    try {
      // '사본 저장'을 켰으면 링크 이미지를 먼저 서버에 저장한다 (실패한 것은 링크로)
      const copies = new Map<string, StoredFile>();
      const copyErrors: string[] = [];
      const toCopy = copyLinks && !full ? targets.filter((c) => c.source !== "upload" && !c.duplicate) : [];
      if (toCopy.length) {
        setCopying({ done: 0, total: toCopy.length });
        await eachLimit(toCopy, 3, async (c) => {
          try {
            const { file, usage: next } = await api.copyFromUrl(c.imageUrl);
            copies.set(c.key, file);
            setUsage(next);
          } catch (err) {
            copyErrors.push((err as Error).message);
          }
          setCopying((p) => p && { ...p, done: p.done + 1 });
        });
      }
      const inputs: RefInput[] = targets.map((c) => ({
        imageUrl: copies.get(c.key)?.url ?? c.imageUrl,
        originalUrl: copies.has(c.key) ? c.imageUrl : undefined,
        sourceUrl: c.sourceUrl,
        title: c.title || undefined,
        note: note || undefined,
        tags: normalizeTags(c.tags),
        caseId: c.caseId || undefined,
        kind,
        logoLabel: kind === "logo" ? logoLabel || c.title || undefined : undefined,
        width: copies.get(c.key)?.width ?? c.width,
        height: copies.get(c.key)?.height ?? c.height,
        source: c.source,
      }));
      const { created, duplicates } = await addRefs(inputs);
      // 서버는 보낸 순서대로 새로 만들고, 이미 있던 이미지는 duplicates 로 돌려준다 → 카드마다 결과를 맞춘다
      const queue = [...created];
      const results = new Map<string, SavedInfo>();
      const dupHits: DuplicateInfo[] = [];
      const createdIds: string[] = [];
      let unclassified = 0;
      inputs.forEach((inp, i) => {
        const c = targets[i];
        if (queue[0] && queue[0].imageUrl === inp.imageUrl) {
          const ref = queue.shift()!;
          const un = ref.tags.every(isUnclassified);
          if (un) unclassified++;
          createdIds.push(ref.id);
          results.set(c.key, { refId: ref.id, duplicate: false, unclassified: un });
          return;
        }
        const d = duplicates.find((x) => x.imageUrl === inp.imageUrl || (inp.originalUrl && x.imageUrl === inp.originalUrl));
        if (d) {
          dupHits.push(d);
          results.set(c.key, { refId: d.existing.id, duplicate: true, unclassified: false });
        }
      });
      patchCards((c) => keys.has(c.key), (c) => ({ saving: false, selected: false, saved: results.get(c.key) }));
      setSummary((s) => ({ created: [...s.created, ...createdIds], unclassified: s.unclassified + unclassified, duplicates: [...s.duplicates, ...dupHits] }));
      if (copyErrors.length) toast.error(`${copyErrors.length}장은 사본을 만들지 못해 링크로만 저장했어요 — ${copyErrors[0]}`);
      // 남은 게 없으면 완료 화면, 있으면 짧게 알리고 계속
      const remaining = cardsRef.current.filter((c) => !keys.has(c.key) && isUnsaved(c)).length;
      if (!remaining) setDone(true);
      else
        toast.success(
          `${createdIds.length}장 저장했어요${copies.size ? ` · 사본 ${copies.size}장` : ""}${dupHits.length ? ` · 중복 ${dupHits.length}장은 기존 항목에 태그만 더했어요` : ""} · 남은 이미지 ${remaining}장`,
        );
    } catch (err) {
      patchCards((c) => keys.has(c.key), { saving: false });
      toast.error((err as Error).message);
    } finally {
      setCopying(null);
    }
  }

  /** 고른 이미지(없으면 첫 장)를 보고 축별 태그를 제안 — 채택한 것은 '한 번에 붙일 태그'로 */
  async function aiSuggest() {
    const first = selectedCards.find(isReady) ?? savable[0];
    if (!first) return;
    setSuggesting(true);
    setSuggest(null);
    try {
      setSuggest(await api.suggestTags({ imageUrl: first.imageUrl, title: first.title, existingTags: [...first.tags, ...bulkTags], vocabulary: vocab, language: "ko" }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSuggesting(false);
    }
  }

  // ─── 완료 화면 ───────────────────────────────────────────

  if (done) {
    const n = summary.created.length;
    const showIds = [...summary.created, ...summary.duplicates.map((d) => d.existing.id)];
    return (
      <Modal
        title="저장했어요"
        onClose={() => {
          discardUnsavedFiles();
          closeDialog();
        }}
        width={600}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDone(false)}>
              계속 모으기
            </Button>
            <span className="spacer" />
            <Button
              onClick={() => {
                discardUnsavedFiles();
                closeDialog();
              }}
            >
              닫기
            </Button>
            <Button
              variant="primary"
              icon="grid"
              disabled={!showIds.length}
              onClick={() => {
                discardUnsavedFiles();
                closeDialog();
                useUI.getState().resetLibrary(showIds);
                navigate("library");
              }}
            >
              라이브러리에서 보기
            </Button>
          </>
        }
      >
        <div className="collect-done">
          <span className="collect-done-icon">
            <Icon name="check" size={28} />
          </span>
          <p className="collect-done-title">
            {n}장을 저장했어요{summary.unclassified ? ` (미분류 ${summary.unclassified}장)` : ""}
          </p>
          {summary.unclassified > 0 && (
            <p className="muted small">태그 없이 저장한 이미지는 &lsquo;{UNCLASSIFIED}&rsquo; 태그가 붙어요. 태그 목록 맨 위에서 모아 보고 정리할 수 있어요.</p>
          )}
        </div>
        {summary.duplicates.length > 0 && (
          <>
            <p className="small">
              <strong>중복 이미지 {summary.duplicates.length}장</strong>은 새로 만들지 않고 기존 항목에 태그만 더했어요.
            </p>
            <ul className="dup-list">
              {summary.duplicates.map((d) => (
                <li key={d.existing.id}>
                  <span className="mini-thumb">
                    <SmartImage src={d.existing.thumbUrl ?? d.existing.imageUrl} />
                  </span>
                  <div>
                    <strong>{d.existing.title || "(제목 없음)"}</strong>
                    <DupWho existing={d.existing} />
                    <div className="ref-tags">
                      {d.existing.tags.map((t) => (
                        <span key={t} className="tag tag-sm">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setFocusRef(d.existing.id);
                      discardUnsavedFiles();
                      closeDialog();
                    }}
                  >
                    열어서 편집
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Modal>
    );
  }

  const statusText = copying
    ? `링크 이미지 사본 저장 중 ${copying.done}/${copying.total}`
    : uploading
      ? `이미지 올리는 중 ${uploading}장 남음`
      : unsaved.length
        ? `저장 안 한 이미지 ${unsaved.length}장${savedCount ? ` · 저장됨 ${savedCount}장` : ""}${
            unsaved.some((c) => c.source !== "upload") ? (copyLinks && !full ? " · 링크 이미지도 사본을 저장해요" : " · 링크 이미지는 링크로 연결돼요") : ""
          }`
        : savedCount
          ? `저장됨 ${savedCount}장`
          : "저장할 이미지를 담아 주세요";

  return (
    <Modal
      title="어떤 레퍼런스를 모을까요?"
      onClose={close}
      wide
      footer={
        <>
          <span className="muted collect-status">{statusText}</span>
          <Button onClick={close}>닫기</Button>
          {selectedSavable.length > 0 && (
            <Button onClick={() => saveCards(selectedSavable)} disabled={saving}>
              선택한 {selectedSavable.length}장 저장
            </Button>
          )}
          <Button variant="primary" onClick={() => saveCards(savable)} disabled={!savable.length || saving}>
            {saving ? <Spinner /> : null} {savedCount ? "나머지 전체 저장" : "전체 저장"}
            {savable.length ? ` (${savable.length}장)` : ""}
          </Button>
        </>
      }
    >
      <div
        className={"collect" + (dragging ? " dragging" : "")}
        onDragEnter={(e) => hasFiles(e.dataTransfer) && setDragging(true)}
        onDragOver={(e) => {
          e.preventDefault();
          if (hasFiles(e.dataTransfer)) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const files = imageFilesFrom(e.dataTransfer);
          if (files.length) {
            void addFiles(files);
            return;
          }
          // 다른 탭의 이미지를 끌어 오면 파일이 아니라 링크로 들어온다
          const text = [e.dataTransfer.getData("text/uri-list"), e.dataTransfer.getData("text/plain"), extractImgFromHtml(e.dataTransfer.getData("text/html"))].join("\n");
          if (text.trim()) void fetchAll(text);
        }}
      >
        {dragging && (
          <div className="collect-drop" aria-hidden="true">
            <Icon name="upload" size={28} />
            <strong>여기에 놓으면 올려요</strong>
            <span>JPG · PNG · WebP · GIF, 파일당 20MB까지 · 여러 장 한 번에</span>
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT_ATTR}
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) void addFiles(files);
          }}
        />
        <div className="collect-input">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={"여기에 링크를 붙여넣어 주세요 (여러 개는 줄을 바꿔서)\n\n예) https://pin.it/3xAbCdE — 핀터레스트 공유 → 링크 복사\n     https://i.pinimg.com/originals/… — 이미지 우클릭 → 이미지 주소 복사\n     https://www.pinterest.com/아이디/보드이름/ — 보드 전체"}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void fetchAll(input);
            }}
          />
          <div className="collect-input-actions">
            <div className="collect-howto">
              <span className="howto-chip">
                <b>핀터레스트</b> 공유 → 링크 복사
              </span>
              <span className="howto-chip">
                이미지 우클릭 → <b>이미지 주소 복사</b>
              </span>
              <span className="howto-chip">
                이미지 파일 <b>끌어다 놓기</b>
              </span>
              <span className="howto-chip">
                스크린샷 <b>⌘V · Ctrl+V</b>
              </span>
              <a className="link-btn blue" href="#/guide/pinterest" onClick={() => close()}>
                <Icon name="bulb" size={14} /> 자세히 보기
              </a>
            </div>
            <Button icon="upload" onClick={() => fileInput.current?.click()} disabled={full} title={full ? "팀 저장 공간이 가득 찼어요" : "JPG · PNG · WebP · GIF, 파일당 20MB까지"}>
              파일 선택
            </Button>
            <Button variant="primary" icon="link" onClick={() => fetchAll(input)} disabled={!input.trim()}>
              가져오기
            </Button>
          </div>
        </div>

        <div className="collect-grid">
          <div className="collect-sources">
            {blocks.length === 0 && uploads.length === 0 && (
              <div className="empty-hint">링크를 붙여넣고 &lsquo;가져오기&rsquo;를 누르거나, 이미지 파일을 끌어다 놓으면 카드가 여기에 나와요. 카드마다 태그 · 케이스를 정해 따로 저장할 수 있어요.</div>
            )}
            {uploads.length > 0 && (
              <section className="source-block">
                <header>
                  {uploading > 0 && <Spinner />}
                  <span className="badge">내 파일</span>
                  <strong className="ellipsis">올린 이미지 {uploads.length}장</strong>
                  <span className="muted ellipsis">{uploading ? `올리는 중 · ${uploads.length - uploading}/${uploads.length}` : "크기를 줄여 WebP 로 저장했어요 · 위치 정보 등은 지웠어요"}</span>
                </header>
                <div className="candidates">
                  {uploads.map((c) => (
                    <CandidateCard
                      key={c.key}
                      c={c}
                      vocab={vocab}
                      cases={cases}
                      onPatch={(p) => updateCard(c.key, p)}
                      onSave={() => saveCards([c])}
                      onRemove={() => removeUpload(c.key)}
                      onOpenExisting={(id) => {
                        setFocusRef(id);
                        close();
                      }}
                    />
                  ))}
                </div>
              </section>
            )}
            {blocks.map((b) => (
              <section key={b.url} className="source-block">
                <header>
                  {b.status === "loading" && <Spinner />}
                  {b.result && <span className="badge">{KIND_LABEL[b.result.kind]}</span>}
                  <strong className="ellipsis">{b.result?.title || b.url}</strong>
                  <a className="muted ellipsis" href={b.url} target="_blank" rel="noreferrer">
                    {b.url}
                  </a>
                  {b.items.length > 1 && (
                    <span className="source-actions">
                      <button className="link-btn" onClick={() => patchCards((c) => b.items.some((i) => i.key === c.key) && !c.saved, { picked: true })}>
                        모두 담기
                      </button>
                      <button className="link-btn" onClick={() => patchCards((c) => b.items.some((i) => i.key === c.key) && !c.saved, { picked: false, selected: false })}>
                        모두 빼기
                      </button>
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="x"
                    aria-label="이 링크 빼기"
                    disabled={b.items.some((i) => i.saving)}
                    onClick={() => {
                      const left = b.items.filter(isUnsaved).length;
                      if (left && !confirm(`이 링크에서 담은 이미지 ${left}장을 뺄까요?`)) return;
                      setBlocks((p) => p.filter((x) => x.url !== b.url));
                    }}
                  />
                </header>
                {b.status === "error" && <div className="error-box">{b.error}</div>}
                <div className="candidates">
                  {b.items.map((c) => (
                    <CandidateCard
                      key={c.key}
                      c={c}
                      vocab={vocab}
                      cases={cases}
                      onPatch={(p) => updateCard(c.key, p)}
                      onSave={() => saveCards([c])}
                      onRemove={() => updateCard(c.key, { picked: false, selected: false })}
                      onOpenExisting={(id) => {
                        setFocusRef(id);
                        close();
                      }}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          <aside className="collect-meta">
            <section className="bulk-panel" aria-label="여러 장에 한 번에">
              <div className="bulk-panel-head">
                <strong>{selectedCards.length ? `선택한 ${selectedCards.length}장` : "여러 장에 한 번에"}</strong>
                <span className="spacer" />
                <button className="link-btn blue" onClick={selectAll} disabled={!unsaved.length}>
                  전체 선택
                </button>
                {selectedCards.length > 0 && (
                  <button className="link-btn" onClick={clearSelection}>
                    선택 해제
                  </button>
                )}
              </div>
              <p className="muted small">카드 왼쪽 위 동그라미로 여러 장을 고른 뒤 태그 · 케이스를 한 번에 정해요. 저장한 카드는 빠져요.</p>
              <Field label="태그">
                <TagInput value={bulkTags} onChange={setBulkTags} suggestions={vocab} placeholder="붙일 태그 입력 후 Enter" />
              </Field>
              {vocab.length > 0 && (
                <div className="tag-suggest">
                  {vocab
                    .filter((t) => !bulkTags.includes(t))
                    .slice(0, 10)
                    .map((t) => (
                      <button key={t} className="tag tag-ghost" onClick={() => setBulkTags(normalizeTags([...bulkTags, t]))}>
                        + {t}
                      </button>
                    ))}
                </div>
              )}
              {status?.ai ? (
                <Button icon="sparkle" variant="accent" size="sm" onClick={aiSuggest} disabled={suggesting || !savable.length} title="고른 이미지(없으면 첫 장)를 보고 제안해요">
                  AI 태그 제안 받기
                </Button>
              ) : (
                <div className="note-box">{status?.aiPaused ? status.aiReason : "AI 태그 제안은 AI 연결 후 사용할 수 있어요."}</div>
              )}
              {(suggesting || suggest) && <TagSuggestions result={suggest} loading={suggesting} current={bulkTags} onAdopt={(t) => setBulkTags(normalizeTags([...bulkTags, ...t]))} />}
              <div className="bulk-apply">
                <Button size="sm" onClick={() => applyTags("selected")} disabled={!bulkTags.length || !selectedCards.length}>
                  선택한 {selectedCards.length || ""}장에 붙이기
                </Button>
                <Button size="sm" variant="ghost" onClick={() => applyTags("all")} disabled={!bulkTags.length || !unsaved.length}>
                  모두에 붙이기
                </Button>
              </div>
              <Field label="케이스">
                <select value={bulkCase} onChange={(e) => setBulkCase(e.target.value)}>
                  <option value="">(케이스 없음)</option>
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="__new">+ 새 케이스 만들기</option>
                </select>
              </Field>
              {bulkCase === "__new" && (
                <form
                  className="new-case"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void makeCase();
                  }}
                >
                  <input value={newCaseName} onChange={(e) => setNewCaseName(e.target.value)} placeholder="새 케이스 이름 (예: 모닝루틴 성수 팝업)" maxLength={200} autoFocus aria-label="새 케이스 이름" />
                  <Button size="sm" type="submit" variant="primary" disabled={!newCaseName.trim() || creatingCase}>
                    만들기
                  </Button>
                </form>
              )}
              <div className="bulk-apply">
                <Button size="sm" onClick={() => applyCase("selected")} disabled={bulkCase === "__new" || !selectedCards.length}>
                  선택한 {selectedCards.length || ""}장에 적용
                </Button>
                <Button size="sm" variant="ghost" onClick={() => applyCase("all")} disabled={bulkCase === "__new" || !unsaved.length}>
                  모두에 적용
                </Button>
              </div>
            </section>

            <section className="save-common" aria-label="저장할 때 함께">
              <h5>저장할 때 함께</h5>
              <Field label="유형">
                <Segmented
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: "image", label: "이미지" },
                    { value: "logo", label: "로고" },
                  ]}
                />
              </Field>
              {kind === "logo" && (
                <Field label="로고 라벨">
                  <input value={logoLabel} onChange={(e) => setLogoLabel(e.target.value)} placeholder="예: Brand Logo / Partner Logo" />
                </Field>
              )}
              <Field label="메모">
                <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="출처, 인사이트, 적용 아이디어 등" />
              </Field>
              <div className="copy-option">
                <Toggle checked={copyLinks} onChange={setCopyLinks} label="링크 이미지도 서버에 사본 저장" />
                <p className="muted small">원본 사이트에서 이미지가 지워져도 깨지지 않아요. 팀 저장 공간을 써요.</p>
              </div>
              <StorageMeter usage={usage} compact />
            </section>
          </aside>
        </div>
      </div>
    </Modal>
  );
}

function fromStored(f: StoredFile): Partial<Candidate> {
  return { imageUrl: f.url, thumbUrl: f.thumbUrl, fileId: f.id, width: f.width, height: f.height };
}

/**
 * 카드 한 장 — 올리는 중(진행률) · 실패(이유) · 담기 전 후보 · 담김(제목 · 태그 · 케이스 · 저장) · 저장됨(흐리게)
 */
function CandidateCard({
  c,
  vocab,
  cases,
  onPatch,
  onSave,
  onRemove,
  onOpenExisting,
}: {
  c: Candidate;
  vocab: string[];
  cases: { id: string; name: string }[];
  onPatch: (p: Partial<Candidate>) => void;
  onSave: () => void;
  onRemove: () => void;
  onOpenExisting: (refId: string) => void;
}) {
  const u = c.upload;
  const failed = isFailed(c);
  const isUploading = u?.status === "uploading";
  const ready = isReady(c);
  const open = isUnsaved(c);
  const candidateOnly = !c.picked && !c.saved && !failed && !c.sameAs;
  const toggleSelect = () => open && onPatch({ selected: !c.selected });
  const caseName = cases.find((x) => x.id === c.caseId)?.name;

  return (
    <div
      className={
        "candidate" +
        (c.source === "upload" ? " upload" : "") +
        (c.picked ? " picked" : "") +
        (c.selected ? " selected" : "") +
        (c.saved ? " saved" : "") +
        (failed ? " failed" : "") +
        (candidateOnly ? " unpicked" : "")
      }
      data-key={c.key}
    >
      <div className="candidate-thumb" onClick={candidateOnly ? () => onPatch({ picked: true }) : toggleSelect} title={u?.name ?? c.title}>
        {u && !ready && !c.sameAs ? (
          u.preview ? (
            <img src={u.preview} alt="" className="upload-preview" />
          ) : (
            <span className="upload-icon">
              <Icon name="image" size={22} />
            </span>
          )
        ) : (
          <SmartImage src={c.thumbUrl ?? c.imageUrl} fit="contain" onNatural={c.source === "upload" ? undefined : (w, h) => !c.width && onPatch({ width: w, height: h })} />
        )}
        {open && (
          <button
            type="button"
            className="cand-check"
            role="checkbox"
            aria-checked={c.selected}
            aria-label="선택"
            onClick={(e) => {
              e.stopPropagation();
              toggleSelect();
            }}
          >
            {c.selected ? <Icon name="check" size={12} /> : null}
          </button>
        )}
        {c.saved ? (
          <span className="cand-saved">
            <Icon name="check" size={11} /> {c.saved.duplicate ? "기존 항목에 더함" : "저장됨"}
          </span>
        ) : c.duplicate ? (
          <span className="dup-badge">중복</span>
        ) : c.sameAs ? (
          <span className="dup-badge">같은 파일</span>
        ) : null}
        {ready && c.width && c.height ? (
          <span className="dims">
            {c.width}×{c.height}
          </span>
        ) : null}
        {isUploading && (
          <span className="upload-progress" aria-label={`올리는 중 ${Math.round(u!.progress * 100)}%`}>
            <i style={{ width: `${Math.max(4, u!.progress * 100)}%` }} />
          </span>
        )}
        {candidateOnly && (
          <span className="cand-pick">
            <Icon name="plus" size={13} /> 담기
          </span>
        )}
      </div>
      {!c.saved && !c.saving && (c.source === "upload" || c.picked) && (
        <button type="button" className="upload-remove" onClick={onRemove} aria-label="빼기" title="빼기">
          <Icon name="x" size={12} />
        </button>
      )}

      {failed ? (
        <div className="upload-error" role="alert">
          <strong className="ellipsis">{u!.name}</strong>
          <span>{u!.error}</span>
        </div>
      ) : isUploading ? (
        <div className="upload-status muted small ellipsis">
          {u!.name} · {formatBytes(u!.size)}
        </div>
      ) : c.sameAs ? (
        <div className="dup-note">
          <span className="dup-who">방금 올린 것과 같은 파일이에요</span>
        </div>
      ) : c.saved ? (
        <div className="cand-body">
          {c.title && <div className="cand-title ellipsis">{c.title}</div>}
          <div className="ref-tags">
            {caseName && <span className="tag tag-case">{caseName}</span>}
            {(c.tags.length ? c.tags : c.saved.duplicate ? [] : [UNCLASSIFIED]).map((t) => (
              <span key={t} className={"tag tag-sm" + (isUnclassified(t) ? " tag-unclassified" : "")}>
                {t}
              </span>
            ))}
          </div>
          <button type="button" className="link-btn" onClick={() => onOpenExisting(c.saved!.refId)}>
            열어서 편집
          </button>
        </div>
      ) : !c.picked ? (
        c.duplicate ? (
          <div className="dup-note">
            <DupWho existing={c.duplicate} />
            <button type="button" className="link-btn" onClick={() => onOpenExisting(c.duplicate!.id)}>
              기존 항목 편집
            </button>
            <span className="muted small">담으면 태그만 기존 항목에 더해져요</span>
          </div>
        ) : null
      ) : (
        <div className="cand-body">
          <input className="cand-title-input" value={c.title} placeholder="제목" onChange={(e) => onPatch({ title: e.target.value })} aria-label="제목" />
          <div className="cand-tags">
            <TagInput value={c.tags} onChange={(tags) => onPatch({ tags })} suggestions={vocab} placeholder="태그 + Enter" />
            {!c.tags.length && <span className="cand-hint">태그 없이 저장하면 &lsquo;{UNCLASSIFIED}&rsquo;</span>}
          </div>
          <div className="cand-row">
            <select value={c.caseId} onChange={(e) => onPatch({ caseId: e.target.value })} aria-label="케이스">
              <option value="">케이스 없음</option>
              {cases.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <Button size="sm" variant="primary" onClick={onSave} disabled={!ready || !!c.saving}>
              {c.saving ? <Spinner size={12} /> : "저장"}
            </Button>
          </div>
          {c.duplicate && <span className="muted small">이미 있는 이미지 — 저장하면 태그만 더해져요</span>}
        </div>
      )}
    </div>
  );
}

function extractImgFromHtml(html: string): string {
  if (!html) return "";
  return [...html.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((m) => m[1]).join("\n");
}

/** 중복 이미지: 누가 언제 추가했는지 */
export function DupWho({ existing }: { existing: Reference }) {
  return (
    <span className="dup-who">
      {existing.createdByName ?? "팀원"} · {new Date(existing.createdAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })} 추가
    </span>
  );
}
