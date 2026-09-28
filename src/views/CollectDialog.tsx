import { useEffect, useMemo, useState } from "react";
import type { DuplicateInfo, Reference, RefSource, ScrapeResult } from "../../shared/types";
import { api, type RefInput } from "../api";
import { SmartImage } from "../components/SmartImage";
import { Icon } from "../components/icons";
import { Button, Field, Modal, Segmented, Spinner, TagInput, Toggle } from "../components/ui";
import { normalizeTags } from "../lib/search";
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
}

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

export function CollectDialog({ initialUrls }: { initialUrls?: string }) {
  const close = useUI((s) => s.closeCollect);
  const { refs, cases, addRefs, createCase, updateRef, status } = useLibrary();
  const vocab = useMemo(() => tagVocabulary(refs), [refs]);

  const [input, setInput] = useState(initialUrls ?? "");
  const [blocks, setBlocks] = useState<SourceBlock[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [caseId, setCaseId] = useState<string>("");
  const [newCaseName, setNewCaseName] = useState("");
  const [kind, setKind] = useState<"image" | "logo">("image");
  const [logoLabel, setLogoLabel] = useState("");
  const [note, setNote] = useState("");
  const [aiTag, setAiTag] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ created: number; duplicates: DuplicateInfo[] } | null>(null);
  const setFocusRef = useUI((s) => s.setFocusRef);

  useEffect(() => {
    if (initialUrls) void fetchAll(initialUrls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  }

  function setAll(url: string, checked: boolean) {
    setBlocks((prev) => prev.map((b) => (b.url === url ? { ...b, items: b.items.map((i) => ({ ...i, checked })) } : b)));
  }

  const selected = blocks.flatMap((b) => b.items.filter((i) => i.checked));

  async function save() {
    if (!selected.length) return;
    setSaving(true);
    try {
      let targetCase = caseId;
      if (caseId === "__new" && newCaseName.trim()) {
        const c = await createCase({ name: newCaseName.trim(), tags: [] });
        targetCase = c.id;
      }
      const inputs: RefInput[] = selected.map((c) => ({
        imageUrl: c.imageUrl,
        sourceUrl: c.sourceUrl,
        title: c.title || undefined,
        note: note || undefined,
        tags: normalizeTags(tags),
        caseId: targetCase && targetCase !== "__new" ? targetCase : undefined,
        kind,
        logoLabel: kind === "logo" ? logoLabel || c.title || undefined : undefined,
        width: c.width,
        height: c.height,
        source: c.source,
      }));
      const { created, duplicates } = await addRefs(inputs);
      toast.success(`${created.length}개 저장${duplicates.length ? ` · 중복 ${duplicates.length}개는 기존 항목에 태그만 추가` : ""}`);
      if (aiTag && created.length) void autoTag(created.map((r) => r.id));
      if (duplicates.length) setResult({ created: created.length, duplicates });
      else close();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function autoTag(ids: string[]) {
    toast.info(`AI 태깅 시작 (${ids.length}개)…`);
    let done = 0;
    for (const id of ids) {
      const ref = useLibrary.getState().refs.find((r) => r.id === id);
      if (!ref) continue;
      try {
        const out = await api.suggestTags({
          imageUrl: ref.imageUrl,
          title: ref.title,
          note: ref.note,
          existingTags: ref.tags,
          vocabulary: tagVocabulary(useLibrary.getState().refs),
          language: "ko",
        });
        await updateRef(id, { tags: normalizeTags([...ref.tags, ...out.tags]), title: ref.title || out.title });
        done++;
      } catch (err) {
        toast.error(`AI 태깅 실패: ${(err as Error).message}`);
        break;
      }
    }
    if (done) toast.success(`AI 태깅 완료 (${done}개)`);
  }

  if (result) {
    return (
      <Modal title="저장 결과" onClose={close} width={640} footer={<Button variant="primary" onClick={close}>닫기</Button>}>
        <p>
          새로 저장 {result.created}개 · <strong>중복 이미지 {result.duplicates.length}개</strong>는 새로 만들지 않고 기존 항목에 태그만 더했어요.
        </p>
        <ul className="dup-list">
          {result.duplicates.map((d) => (
            <li key={d.existing.id}>
              <span className="mini-thumb">
                <SmartImage src={d.existing.imageUrl} />
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
                  close();
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
          <span className="muted">{selected.length ? `${selected.length}개를 골랐어요` : "저장할 이미지를 골라 주세요"} · 이미지는 링크로만 연결돼요</span>
          <Button onClick={close}>취소</Button>
          <Button variant="primary" onClick={save} disabled={!selected.length || saving}>
            {saving ? <Spinner /> : null} {selected.length ? `${selected.length}개 저장하기` : "저장하기"}
          </Button>
        </>
      }
    >
      <div className="collect">
        <div
          className="collect-input"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const text = [e.dataTransfer.getData("text/uri-list"), e.dataTransfer.getData("text/plain"), extractImgFromHtml(e.dataTransfer.getData("text/html"))].join("\n");
            void fetchAll(text);
          }}
        >
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
              <span className="howto-chip">이미지를 여기로 끌어다 놓기</span>
              <a
                className="link-btn blue"
                href="#/guide/pinterest"
                onClick={() => close()}
              >
                <Icon name="bulb" size={14} /> 자세히 보기
              </a>
            </div>
            <Button variant="primary" icon="link" onClick={() => fetchAll(input)} disabled={!input.trim()}>
              가져오기
            </Button>
          </div>
        </div>

        <div className="collect-grid">
          <div className="collect-sources">
            {blocks.length === 0 && <div className="empty-hint">링크를 붙여넣고 &lsquo;가져오기&rsquo;를 누르면 이미지 후보가 여기에 나와요.</div>}
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
            <Field label="키워드 태그" hint="검색·자동 그룹핑의 기준이 돼요">
              <TagInput value={tags} onChange={setTags} suggestions={vocab} />
            </Field>
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
                <input value={newCaseName} onChange={(e) => setNewCaseName(e.target.value)} placeholder="예: Allianz Arena" autoFocus />
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
                <input value={logoLabel} onChange={(e) => setLogoLabel(e.target.value)} placeholder="예: Stadium Logo / Team Logo" />
              </Field>
            )}
            <Field label="메모">
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="출처, 인사이트, 적용 아이디어 등" />
            </Field>
            <Toggle
              checked={aiTag}
              onChange={setAiTag}
              label={
                <>
                  저장 후 AI 로 태그·제목 자동 보강
                  {!status?.ai && <small className="muted"> (API 키 없으면 규칙 기반)</small>}
                </>
              }
            />
          </aside>
        </div>
      </div>
    </Modal>
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
