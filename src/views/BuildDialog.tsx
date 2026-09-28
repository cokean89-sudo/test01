import { useEffect, useMemo, useState } from "react";
import { LAYOUT_MODES, PAGE_SIZES, type PageSizeKey } from "../../shared/types";
import { api } from "../api";
import { PageView } from "../components/PageView";
import { SmartImage } from "../components/SmartImage";
import { Button, Field, Modal, NumberInput, Segmented, Select, Toggle } from "../components/ui";
import { buildDocument, buildGroups, type BuildOptions, type GroupBy } from "../layout/autobuild";
import { DEFAULT_LAYOUT, defaultSettings, FOOTER_PRESETS, REPORT_TYPOGRAPHY, TYPOGRAPHY_PRESETS } from "../lib/defaults";
import { useTeamDefaults } from "../store/teamDefaults";
import { navigate } from "../lib/router";
import { useLibrary } from "../store/library";
import { toast } from "../store/toast";
import { useUI } from "../store/ui";

export const PENDING_AI_KEY = "rb.pendingAi";

export function BuildDialog({ preset }: { preset?: Partial<BuildOptions> }) {
  const close = useUI((s) => s.closeBuild);
  const { refs, cases, status } = useLibrary();
  const initialQuery = preset?.query ?? sessionStorage.getItem("rb.query") ?? "";
  const [opts, setOpts] = useState<BuildOptions>({
    title: preset?.title ?? (initialQuery ? `${initialQuery} — Reference` : "Case Study"),
    query: initialQuery,
    matchMode: preset?.matchMode ?? "or",
    groupBy: preset?.groupBy ?? (cases.length ? "case" : "tag"),
    layout: { ...DEFAULT_LAYOUT, ...preset?.layout },
    layoutAuto: preset?.layoutAuto ?? !preset?.layout,
    maxPerPage: preset?.maxPerPage ?? 9,
    cover: preset?.cover ?? true,
    sections: preset?.sections ?? false,
    minGroupSize: preset?.minGroupSize ?? 2,
    refIds: preset?.refIds,
  });
  const [pageSize, setPageSize] = useState<PageSizeKey>("a4-landscape");
  // 기본값은 팀 문서 기본 설정 (부서명·양식·타이포)
  const teamDefaults = useTeamDefaults();
  const [footerKey, setFooterKey] = useState("team");
  const [typoKey, setTypoKey] = useState("team");
  const [overrides, setOverrides] = useState<Record<string, { label?: string; excluded?: boolean }>>({});
  const [runAi, setRunAi] = useState(false);
  const [creating, setCreating] = useState(false);

  const [titleTouched, setTitleTouched] = useState(!!preset?.title);
  const set = <K extends keyof BuildOptions>(key: K, value: BuildOptions[K]) =>
    setOpts((o) => {
      const next = { ...o, [key]: value };
      // 제목을 직접 고치기 전까지는 키워드를 따라간다
      if (key === "query" && !titleTouched) next.title = String(value).trim() ? `${String(value).trim()} — Reference` : "Case Study";
      return next;
    });

  const settings = useMemo(() => {
    const s = structuredClone(teamDefaults ?? defaultSettings());
    s.pageSize = pageSize;
    if (footerKey !== "team") s.footer = { ...FOOTER_PRESETS.find((f) => f.key === footerKey)!.footer, left: s.footer.left || "" };
    if (typoKey !== "team") {
      const typo = TYPOGRAPHY_PRESETS.find((t) => t.key === typoKey)!;
      s.typography = structuredClone(REPORT_TYPOGRAPHY);
      for (const [role, style] of Object.entries(typo.apply)) Object.assign(s.typography[role as keyof typeof s.typography], style);
    }
    return s;
  }, [teamDefaults, pageSize, footerKey, typoKey]);
  useEffect(() => {
    if (teamDefaults) setPageSize(teamDefaults.pageSize);
  }, [teamDefaults]);

  const rawGroups = useMemo(() => buildGroups(refs, cases, opts), [refs, cases, opts]);
  const groups = useMemo(
    () => rawGroups.filter((g) => !overrides[g.key]?.excluded).map((g) => ({ ...g, label: overrides[g.key]?.label ?? g.label })),
    [rawGroups, overrides],
  );
  const preview = useMemo(() => buildDocument(refs, cases, settings, opts, groups), [refs, cases, settings, opts, groups]);
  const total = groups.reduce((a, g) => a + g.refs.length, 0);

  async function create() {
    setCreating(true);
    try {
      const doc = await api.createDocument({ title: preview.title, query: preview.query, settings: preview.settings, pages: preview.pages });
      if (runAi) sessionStorage.setItem(PENDING_AI_KEY, doc.id);
      close();
      navigate("edit/" + doc.id);
      toast.success(`${doc.pages.length}페이지 문서를 만들었어요`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      title="어떤 키워드로 문서를 만들까요?"
      onClose={close}
      wide
      footer={
        <>
          <span className="muted">
            {groups.length}개 그룹 · 이미지 {total}장 → {preview.pages.length}페이지
          </span>
          <Button onClick={close}>취소</Button>
          <Button variant="primary" onClick={create} disabled={!groups.length || creating}>
            {preview.pages.length ? `${preview.pages.length}페이지 만들기` : "문서 만들기"}
          </Button>
        </>
      }
    >
      <div className="build">
        <div className="build-options">
          <Field label="문서 제목">
            <input
              value={opts.title}
              onChange={(e) => {
                setTitleTouched(true);
                set("title", e.target.value);
              }}
            />
          </Field>
          {opts.refIds ? (
            <p className="muted small">라이브러리에서 선택한 {opts.refIds.length}개 레퍼런스로 만들어요.</p>
          ) : (
            <>
              <Field label="키워드" hint="공백으로 구분 · #태그 정확히 · -제외">
                <input value={opts.query} onChange={(e) => set("query", e.target.value)} placeholder="예) 조형물 야간조명 굿즈샵" autoFocus />
              </Field>
              <Field label="매칭">
                <Segmented
                  value={opts.matchMode}
                  onChange={(v) => set("matchMode", v)}
                  options={[
                    { value: "or", label: "하나라도 포함" },
                    { value: "and", label: "모두 포함" },
                  ]}
                />
              </Field>
            </>
          )}
          <Field label="페이지 구성 기준">
            <Segmented<GroupBy>
              value={opts.groupBy}
              onChange={(v) => set("groupBy", v)}
              options={[
                { value: "case", label: "케이스별", title: "케이스 스터디 페이지 (로고 패널 + 설명)" },
                { value: "tag", label: "태그별", title: "태그 그룹마다 레퍼런스 페이지" },
                { value: "none", label: "묶지 않음" },
              ]}
            />
          </Field>
          <div className="grid-2">
            <Field label="페이지당 최대 이미지">
              <NumberInput value={opts.maxPerPage} min={1} max={30} onChange={(v) => set("maxPerPage", v)} />
            </Field>
            {opts.groupBy === "tag" && (
              <Field label="최소 그룹 크기" hint="이보다 작으면 '기타'">
                <NumberInput value={opts.minGroupSize} min={1} max={10} onChange={(v) => set("minGroupSize", v)} />
              </Field>
            )}
          </div>
          <Toggle checked={opts.cover} onChange={(v) => set("cover", v)} label="표지 페이지 넣기" />
          <Toggle checked={opts.sections} onChange={(v) => set("sections", v)} label="그룹마다 간지(섹션) 페이지 넣기" />
          <details className="al-more">
            <summary>배치 · 양식 세부 설정</summary>
            <div className="build-options" style={{ paddingBottom: 6 }}>
              <Field label="이미지 배치">
                <Select<string>
                  value={opts.layoutAuto ? "auto" : opts.layout.mode}
                  onChange={(mode) =>
                    mode === "auto"
                      ? setOpts((o) => ({ ...o, layoutAuto: true }))
                      : setOpts((o) => ({ ...o, layoutAuto: false, layout: { ...o.layout, mode: mode as typeof o.layout.mode } }))
                  }
                  options={[
                    { value: "auto", label: "템플릿 기본 (가로 줄 · 높이 맞춤)" },
                    ...LAYOUT_MODES.map((m) => ({ value: m.key, label: m.label })),
                  ]}
                />
              </Field>
              <div className="grid-2">
                {opts.layoutAuto ? (
                  <Field label="배열 변형">
                    <NumberInput value={opts.layout.seed} min={0} onChange={(seed) => set("layout", { ...opts.layout, seed })} />
                  </Field>
                ) : opts.layout.mode === "grid" || opts.layout.mode === "columns" ? (
                  <Field label={opts.layout.mode === "grid" ? "열(단) 수" : "열 수 (0=자동)"}>
                    <NumberInput value={opts.layout.columns} min={0} max={8} onChange={(columns) => set("layout", { ...opts.layout, columns })} />
                  </Field>
                ) : opts.layout.mode === "rows" ? (
                  <Field label="줄 수 (0=자동)">
                    <NumberInput value={opts.layout.rows} min={0} max={8} onChange={(rows) => set("layout", { ...opts.layout, rows })} />
                  </Field>
                ) : (
                  <Field label="배열 변형">
                    <NumberInput value={opts.layout.seed} min={0} onChange={(seed) => set("layout", { ...opts.layout, seed })} />
                  </Field>
                )}
                <Field label="간격 (pt)">
                  <NumberInput value={opts.layout.gap} min={0} max={40} step={0.5} onChange={(gap) => set("layout", { ...opts.layout, gap })} />
                </Field>
              </div>
              <Field label="페이지 크기">
                <Select value={pageSize} onChange={setPageSize} options={Object.entries(PAGE_SIZES).map(([k, v]) => ({ value: k as PageSizeKey, label: v.label }))} />
              </Field>
              <Field label="문서 양식 (하단 태그라인)">
                <Select value={footerKey} onChange={setFooterKey} options={[{ value: "team", label: `팀 기본 설정${teamDefaults?.footer.left ? ` (${teamDefaults.footer.left})` : ""}` }, ...FOOTER_PRESETS.map((f) => ({ value: f.key, label: f.label }))]} />
              </Field>
              <Field label="타이포 프리셋">
                <Select value={typoKey} onChange={setTypoKey} options={[{ value: "team", label: "팀 기본 설정" }, ...TYPOGRAPHY_PRESETS.map((t) => ({ value: t.key, label: t.label }))]} />
              </Field>
            </div>
          </details>
          <Toggle
            checked={runAi}
            onChange={setRunAi}
            label={
              <>
                만든 뒤 AI 로 타이틀·설명·캡션 채우기
                {!status?.ai && <small className="muted"> (API 키 없음 → 규칙 기반)</small>}
              </>
            }
          />
        </div>

        <div className="build-preview">
          <h4>이렇게 묶을게요</h4>
          {rawGroups.length === 0 && <p className="muted">키워드와 일치하는 레퍼런스가 없어요.</p>}
          <div className="group-list">
            {rawGroups.map((g) => {
              const ov = overrides[g.key] ?? {};
              return (
                <div key={g.key} className={"group-row" + (ov.excluded ? " excluded" : "")}>
                  <input
                    type="checkbox"
                    checked={!ov.excluded}
                    onChange={(e) => setOverrides({ ...overrides, [g.key]: { ...ov, excluded: !e.target.checked } })}
                  />
                  <span className={"badge" + (g.kind === "case" ? " badge-accent" : "")}>{g.kind === "case" ? "케이스" : "태그"}</span>
                  <input className="group-label" value={ov.label ?? g.label} onChange={(e) => setOverrides({ ...overrides, [g.key]: { ...ov, label: e.target.value } })} />
                  <span className="count">{g.refs.length + g.logos.length}</span>
                  <div className="group-thumbs">
                    {[...g.logos, ...g.refs].slice(0, 8).map((r) => (
                      <span key={r.id} className="mini-thumb">
                        <SmartImage src={r.imageUrl} fit={r.kind === "logo" ? "contain" : "cover"} />
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <h4>미리보기</h4>
          <div className="page-preview-grid">
            {preview.pages.slice(0, 24).map((p, i) => (
              <div key={p.id} className="page-preview">
                <PageView page={p} settings={settings} index={i} total={preview.pages.length} mode="thumb" docTitle={opts.title} />
                <span>{i + 1}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
