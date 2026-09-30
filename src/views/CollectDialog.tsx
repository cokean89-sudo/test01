import { useEffect, useMemo, useRef, useState } from "react";
import type { DuplicateInfo, Reference, RefSource, ScrapeResult, StorageUsage, StoredFile, TagSuggestResult } from "../../shared/types";
import { api, type RefInput } from "../api";
import { SmartImage } from "../components/SmartImage";
import { StorageMeter, storageState } from "../components/StorageMeter";
import { Icon } from "../components/icons";
import { TagSuggestions } from "../components/TagSuggestions";
import { Button, Field, Modal, Segmented, Spinner, TagInput, Toggle } from "../components/ui";
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
  checked: boolean;
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

export function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s"'<>]+|(?:www\.|pin\.it\/)[^\s"'<>]+/gi) ?? [];
  return [...new Set(found.map((u) => u.replace(/[),.]+$/, "")))];
}

export function CollectDialog({ initialUrls, initialFiles }: { initialUrls?: string; initialFiles?: File[] }) {
  const closeDialog = useUI((s) => s.closeCollect);
  const { refs, cases, addRefs, createCase, status } = useLibrary();
  const vocab = useMemo(() => tagVocabulary(refs), [refs]);

  const [input, setInput] = useState(initialUrls ?? "");
  const [blocks, setBlocks] = useState<SourceBlock[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [suggest, setSuggest] = useState<TagSuggestResult | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [caseId, setCaseId] = useState<string>("");
  const [newCaseName, setNewCaseName] = useState("");
  const [kind, setKind] = useState<"image" | "logo">("image");
  const [logoLabel, setLogoLabel] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ created: number; duplicates: DuplicateInfo[] } | null>(null);
  const setFocusRef = useUI((s) => s.setFocusRef);
  const [uploads, setUploads] = useState<Candidate[]>([]);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [copyLinks, setCopyLinksState] = useState(readCopyPref);
  const [dragging, setDragging] = useState(false);
  const [copying, setCopying] = useState<{ done: number; total: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const saved = useRef(false);
  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;

  const setCopyLinks = (v: boolean) => {
    setCopyLinksState(v);
    try {
      localStorage.setItem(COPY_KEY, v ? "1" : "0");
    } catch {
      /* 기억 못 해도 이번 창에서는 동작 */
    }
  };

  /** 닫기 — 올려 두고 저장하지 않은 파일은 지운다 (서버는 레퍼런스가 쓰는 파일은 지우지 않는다) */
  const close = () => {
    if (!saved.current) for (const u of uploadsRef.current) if (u.fileId && !u.duplicate) void api.deleteUpload(u.fileId).catch(() => undefined);
    closeDialog();
  };

  // 창이 닫히면 미리보기용 임시 주소 정리
  useEffect(() => () => uploadsRef.current.forEach((u) => u.upload?.preview && URL.revokeObjectURL(u.upload.preview)), []);

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

  /** 이미지 파일 올리기 — 3장씩 동시에, 한 장씩 진행률 · 실패 이유 표시 */
  async function addFiles(files: File[]) {
    const full = storageState(usage) === "full";
    const stamp = Date.now();
    const items: Candidate[] = files.map((f, i) => {
      const problem = full ? "팀 저장 공간이 가득 찼어요" : checkFile(f);
      return {
        key: `upload-${stamp}-${i}`,
        imageUrl: "",
        title: titleFromName(f.name),
        checked: false,
        source: "upload",
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
          // 이번에 같은 파일을 두 번 올렸으면 두 번째는 '같은 파일'로 표시하고 고르지 않는다
          const same = prev.find((x) => x.key !== c.key && x.fileId === file.id);
          return prev.map((x) =>
            x.key === c.key
              ? { ...x, ...fromStored(file), duplicate: dup, sameAs: same?.key, checked: !dup && !same, upload: { ...x.upload!, status: "done", progress: 1 } }
              : x,
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
    // 같은 파일을 쓰는 다른 후보가 있으면 파일은 남긴다
    const shared = uploads.some((x) => x.key !== key && x.fileId === u?.fileId);
    if (u?.fileId && !u.duplicate && !shared) void api.deleteUpload(u.fileId).then((r) => setUsage(r.usage), () => undefined);
    setUploads((prev) => prev.filter((x) => x.key !== key).map((x) => (x.sameAs === key ? { ...x, sameAs: undefined } : x)));
  }

  async function fetchAll(text: string) {
    const urls = extractUrls(text).filter((u) => !blocks.some((b) => b.url === u));
    if (!urls.length) {
      toast.error("링크를 찾지 못했어요. http(s):// 로 시작하는 주소를 붙여넣으세요.");
      return;
    }
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
            checked: single || i < 6,
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
              it.checked = false;
            }
          }
          setBlocks((prev) => prev.map((b) => (b.url === url ? { ...b, status: "done", result, items } : b)));
        } catch (err) {
          setBlocks((prev) => prev.map((b) => (b.url === url ? { ...b, status: "error", error: (err as Error).message } : b)));
        }
      }),
    );
  }

  function updateItem(key: string, patch: Partial<Candidate>) {
    setBlocks((prev) => prev.map((b) => ({ ...b, items: b.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) })));
    setUploads((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  function setAll(url: string, checked: boolean) {
    setBlocks((prev) => prev.map((b) => (b.url === url ? { ...b, items: b.items.map((i) => ({ ...i, checked })) } : b)));
  }

  const readyUploads = uploads.filter((u) => u.upload?.status === "done");
  const uploading = uploads.filter((u) => u.upload?.status === "uploading").length;
  const selected = [...readyUploads.filter((i) => i.checked), ...blocks.flatMap((b) => b.items.filter((i) => i.checked))];
  const linkCount = selected.filter((c) => c.source !== "upload").length;
  const full = storageState(usage) === "full";

  async function save() {
    if (!selected.length) return;
    setSaving(true);
    try {
      let targetCase = caseId;
      if (caseId === "__new" && newCaseName.trim()) {
        const c = await createCase({ name: newCaseName.trim(), tags: [] });
        targetCase = c.id;
      }
      // '사본 저장'을 켰으면 링크 이미지를 먼저 서버에 저장한다 (실패한 것은 링크로)
      const copies = new Map<string, StoredFile>();
      const copyErrors: string[] = [];
      const toCopy = copyLinks && !full ? selected.filter((c) => c.source !== "upload" && !c.duplicate) : [];
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
      const inputs: RefInput[] = selected.map((c) => ({
        imageUrl: copies.get(c.key)?.url ?? c.imageUrl,
        originalUrl: copies.has(c.key) ? c.imageUrl : undefined,
        sourceUrl: c.sourceUrl,
        title: c.title || undefined,
        note: note || undefined,
        tags: normalizeTags(tags),
        caseId: targetCase && targetCase !== "__new" ? targetCase : undefined,
        kind,
        logoLabel: kind === "logo" ? logoLabel || c.title || undefined : undefined,
        width: copies.get(c.key)?.width ?? c.width,
        height: copies.get(c.key)?.height ?? c.height,
        source: c.source,
      }));
      const { created, duplicates } = await addRefs(inputs);
      saved.current = true;
      toast.success(`${created.length}개 저장${copies.size ? ` · 사본 ${copies.size}개 저장` : ""}${duplicates.length ? ` · 중복 ${duplicates.length}개는 기존 항목에 태그만 추가` : ""}`);
      if (copyErrors.length) toast.error(`${copyErrors.length}개는 사본을 만들지 못해 링크로만 저장했어요 — ${copyErrors[0]}`);
      if (duplicates.length) setResult({ created: created.length, duplicates });
      else closeDialog();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
      setCopying(null);
    }
  }

  /** 고른 이미지 중 첫 장을 보고 축별 태그를 제안 — 채택한 것만 태그에 들어간다 */
  async function aiSuggest() {
    const first = selected[0];
    if (!first) return;
    setSuggesting(true);
    setSuggest(null);
    try {
      setSuggest(await api.suggestTags({ imageUrl: first.imageUrl, title: first.title, existingTags: tags, vocabulary: vocab, language: "ko" }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSuggesting(false);
    }
  }

  if (result) {
    return (
      <Modal title="저장 결과" onClose={closeDialog} width={640} footer={<Button variant="primary" onClick={closeDialog}>닫기</Button>}>
        <p>
          새로 저장 {result.created}개 · <strong>중복 이미지 {result.duplicates.length}개</strong>는 새로 만들지 않고 기존 항목에 태그만 더했어요.
        </p>
        <ul className="dup-list">
          {result.duplicates.map((d) => (
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
                  closeDialog();
                }}
              >
                열어서 편집
              </Button>
            </li>
          ))}
        </ul>
      </Modal>
    );
  }

  return (
    <Modal
      title="어떤 레퍼런스를 모을까요?"
      onClose={close}
      wide
      footer={
        <>
          <span className="muted">
            {copying
              ? `링크 이미지 사본 저장 중 ${copying.done}/${copying.total}`
              : uploading
                ? `이미지 올리는 중 ${uploading}장 남음`
                : selected.length
                  ? `${selected.length}개를 골랐어요 · ${linkCount ? (copyLinks && !full ? "링크 이미지도 사본을 저장해요" : "링크 이미지는 링크로만 연결돼요") : "올린 이미지는 서버에 저장돼요"}`
                  : "저장할 이미지를 골라 주세요"}
          </span>
          <Button onClick={close}>취소</Button>
          <Button variant="primary" onClick={save} disabled={!selected.length || saving || uploading > 0}>
            {saving ? <Spinner /> : null} {selected.length ? `${selected.length}개 저장하기` : "저장하기"}
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
              <a
                className="link-btn blue"
                href="#/guide/pinterest"
                onClick={() => close()}
              >
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
              <div className="empty-hint">링크를 붙여넣고 &lsquo;가져오기&rsquo;를 누르거나, 이미지 파일을 끌어다 놓으면 후보가 여기에 나와요.</div>
            )}
            {uploads.length > 0 && (
              <section className="source-block">
                <header>
                  {uploading > 0 && <Spinner />}
                  <span className="badge">내 파일</span>
                  <strong className="ellipsis">올린 이미지 {uploads.length}장</strong>
                  <span className="muted ellipsis">{uploading ? `올리는 중 · ${uploads.length - uploading}/${uploads.length}` : "크기를 줄여 WebP 로 저장했어요 · 위치 정보 등은 지웠어요"}</span>
                  {readyUploads.length > 1 && (
                    <span className="source-actions">
                      <button className="link-btn" onClick={() => setUploads((p) => p.map((i) => (i.upload?.status === "done" ? { ...i, checked: true } : i)))}>
                        모두 선택
                      </button>
                      <button className="link-btn" onClick={() => setUploads((p) => p.map((i) => ({ ...i, checked: false })))}>
                        해제
                      </button>
                    </span>
                  )}
                </header>
                <div className="candidates">
                  {uploads.map((c) => (
                    <UploadCandidate
                      key={c.key}
                      c={c}
                      onToggle={() => updateItem(c.key, { checked: !c.checked })}
                      onTitle={(title) => updateItem(c.key, { title })}
                      onRemove={() => removeUpload(c.key)}
                      onOpenDuplicate={() => {
                        setFocusRef(c.duplicate!.id);
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
                      <button className="link-btn" onClick={() => setAll(b.url, true)}>
                        모두 선택
                      </button>
                      <button className="link-btn" onClick={() => setAll(b.url, false)}>
                        해제
                      </button>
                    </span>
                  )}
                  <Button size="sm" variant="ghost" icon="x" onClick={() => setBlocks((p) => p.filter((x) => x.url !== b.url))} />
                </header>
                {b.status === "error" && <div className="error-box">{b.error}</div>}
                <div className="candidates">
                  {b.items.map((c) => (
                    <div key={c.key} className={"candidate" + (c.checked ? " on" : "")}>
                      <button className="candidate-thumb" onClick={() => updateItem(c.key, { checked: !c.checked })}>
                        <SmartImage src={c.imageUrl} fit="contain" onNatural={(w, h) => updateItem(c.key, { width: w, height: h })} />
                        <span className="check">{c.checked ? "✓" : ""}</span>
                        {c.duplicate && <span className="dup-badge">중복</span>}
                        {c.width && c.height ? <span className="dims">{c.width}×{c.height}</span> : null}
                      </button>
                      {c.duplicate ? (
                        <div className="dup-note">
                          <DupWho existing={c.duplicate} />
                          <button
                            className="link-btn"
                            onClick={() => {
                              setFocusRef(c.duplicate!.id);
                              close();
                            }}
                          >
                            기존 항목 편집
                          </button>
                          {c.checked && <span className="muted small">선택하면 태그만 기존 항목에 추가돼요</span>}
                        </div>
                      ) : (
                        <input value={c.title} placeholder="제목" onChange={(e) => updateItem(c.key, { title: e.target.value })} />
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <aside className="collect-meta">
            <StorageMeter usage={usage} compact />
            <div className="copy-option">
              <Toggle checked={copyLinks} onChange={setCopyLinks} label="링크 이미지도 서버에 사본 저장" />
              <p className="muted small">원본 사이트에서 이미지가 지워져도 깨지지 않아요. 팀 저장 공간을 써요.</p>
            </div>
            <Field label="키워드 태그" hint="검색·자동 그룹핑의 기준이 돼요">
              <TagInput value={tags} onChange={setTags} suggestions={vocab} />
            </Field>
            {status?.ai ? (
              <Button icon="sparkle" variant="accent" size="sm" onClick={aiSuggest} disabled={suggesting || !selected.length} title="고른 이미지 중 첫 장을 보고 제안해요">
                AI 태그 제안 받기
              </Button>
            ) : (
              <div className="note-box">{status?.aiPaused ? status.aiReason : "AI 태그 제안은 AI 연결 후 사용할 수 있어요."}</div>
            )}
            {(suggesting || suggest) && (
              <TagSuggestions
                result={suggest}
                loading={suggesting}
                current={tags}
                onAdopt={(t) => setTags(normalizeTags([...tags, ...t]))}
              />
            )}
            {vocab.length > 0 && (
              <div className="tag-suggest">
                {vocab
                  .filter((t) => !tags.includes(t))
                  .slice(0, 14)
                  .map((t) => (
                    <button key={t} className="tag tag-ghost" onClick={() => setTags(normalizeTags([...tags, t]))}>
                      + {t}
                    </button>
                  ))}
              </div>
            )}
            <Field label="케이스">
              <select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
                <option value="">(없음)</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="__new">+ 새 케이스…</option>
              </select>
            </Field>
            {caseId === "__new" && (
              <Field label="새 케이스 이름">
                <input value={newCaseName} onChange={(e) => setNewCaseName(e.target.value)} placeholder="예: 모닝루틴 성수 팝업" autoFocus />
              </Field>
            )}
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
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="출처, 인사이트, 적용 아이디어 등" />
            </Field>
          </aside>
        </div>
      </div>
    </Modal>
  );
}

function fromStored(f: StoredFile): Partial<Candidate> {
  return { imageUrl: f.url, thumbUrl: f.thumbUrl, fileId: f.id, width: f.width, height: f.height };
}

/** 올린 이미지 한 장 — 올리는 중(진행률) · 실패(이유) · 완료(선택 · 제목) */
function UploadCandidate({ c, onToggle, onTitle, onRemove, onOpenDuplicate }: { c: Candidate; onToggle: () => void; onTitle: (t: string) => void; onRemove: () => void; onOpenDuplicate: () => void }) {
  const u = c.upload!;
  const done = u.status === "done";
  return (
    <div className={"candidate upload" + (c.checked ? " on" : "") + (u.status === "error" ? " failed" : "")}>
      <button className="candidate-thumb" onClick={done ? onToggle : undefined} disabled={!done} title={u.name}>
        {done ? (
          <SmartImage src={c.thumbUrl ?? c.imageUrl} fit="contain" />
        ) : u.preview ? (
          <img src={u.preview} alt="" className="upload-preview" />
        ) : (
          <span className="upload-icon">
            <Icon name="image" size={22} />
          </span>
        )}
        {done && <span className="check">{c.checked ? "✓" : ""}</span>}
        {c.duplicate ? <span className="dup-badge">중복</span> : c.sameAs ? <span className="dup-badge">같은 파일</span> : null}
        {done && c.width && c.height ? <span className="dims">{c.width}×{c.height}</span> : null}
        {u.status === "uploading" && (
          <span className="upload-progress" aria-label={`올리는 중 ${Math.round(u.progress * 100)}%`}>
            <i style={{ width: `${Math.max(4, u.progress * 100)}%` }} />
          </span>
        )}
      </button>
      <button className="upload-remove" onClick={onRemove} aria-label="빼기" title="빼기">
        <Icon name="x" size={12} />
      </button>
      {u.status === "error" ? (
        <div className="upload-error" role="alert">
          <strong className="ellipsis">{u.name}</strong>
          <span>{u.error}</span>
        </div>
      ) : u.status === "uploading" ? (
        <div className="upload-status muted small ellipsis">
          {u.name} · {formatBytes(u.size)}
        </div>
      ) : c.duplicate ? (
        <div className="dup-note">
          <DupWho existing={c.duplicate} />
          <button className="link-btn" onClick={onOpenDuplicate}>
            기존 항목 편집
          </button>
        </div>
      ) : c.sameAs ? (
        <div className="dup-note">
          <span className="dup-who">방금 올린 것과 같은 파일이에요</span>
        </div>
      ) : (
        <input value={c.title} placeholder="제목" onChange={(e) => onTitle(e.target.value)} />
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
