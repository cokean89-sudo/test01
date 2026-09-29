import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import {
  AI_PERSPECTIVES,
  AI_TONES,
  LAYOUT_MODES,
  PAGE_SIZES,
  ROLE_RANK,
  TEXT_ROLES,
  type CaptionPos,
  type DocSettings,
  type ImageElement,
  type PageElement,
  type AiPerspective,
  type AiTone,
  type AlignPos,
  type Page,
  type PageLayout,
  type PageSizeKey,
  type Rect,
  type ShapeElement,
  type TextElement,
  type TextStyle,
} from "../../../shared/types";
import { Icon } from "../../components/icons";
import { resolveStyle } from "../../components/PageView";
import { SmartImage } from "../../components/SmartImage";
import { fontsNote, MainColorPicker, TemplatePicker, TemplateThumbs, type TemplateChoice } from "../../components/TemplatePicker";
import { Button, ColorInput, ColorTokens, Field, Modal, NumberInput, Segmented, Select, Toggle } from "../../components/ui";
import { extractContent } from "../../layout/switchTemplate";
import { paletteOf, themeOf } from "../../layout/themes";
import { FOOTER_PRESETS, REPORT_TYPOGRAPHY, TYPOGRAPHY_PRESETS } from "../../lib/defaults";
import { useCurrentPage, useEditor } from "../../store/editor";
import { teamApi } from "../../api";
import { useLibrary } from "../../store/library";
import { useCurrentTeam } from "../../store/session";
import { toast } from "../../store/toast";
import {
  align,
  applyDocTemplate,
  changePageSize,
  deleteSelection,
  includeInLayout,
  patchElements,
  refreshToc,
  relayout,
  replaceDocSettings,
  setCompareItems,
  setDocMainColor,
  setArea,
  setCaptionsVisible,
  setTextFlow,
  shiftManaged,
  updatePage,
} from "./actions";
import { TypeControls } from "./TypeControls";

type Tab = "element" | "page" | "doc" | "type";

export function Inspector({ onAiPage }: { onAiPage: () => void }) {
  const [tab, setTab] = useState<Tab>("element");
  const selection = useEditor((s) => s.selection);
  const shown: Tab = tab === "element" && selection.length === 0 ? "page" : tab;
  const settings = useEditor((s) => s.doc!.settings);
  const tokens = useMemo(() => ({ ...paletteOf(settings), accent: settings.accent }), [settings]);
  return (
    <ColorTokens.Provider value={tokens}>
    <aside className="inspector">
      <div className="inspector-tabs">
        {(
          [
            ["element", "요소"],
            ["page", "페이지"],
            ["doc", "문서 양식"],
            ["type", "타이포"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} className={shown === k ? "on" : ""} onClick={() => setTab(k)} disabled={k === "element" && selection.length === 0}>
            {label}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        {shown === "element" && <ElementPanel />}
        {shown === "page" && <PagePanel onAiPage={onAiPage} />}
        {shown === "doc" && <DocPanel />}
        {shown === "type" && <TypePanel />}
      </div>
    </aside>
    </ColorTokens.Provider>
  );
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="insp-section">
      <header>
        <h5>{title}</h5>
        {right}
      </header>
      {children}
    </section>
  );
}

// ─── element ────────────────────────────────────────────────

function ElementPanel() {
  const page = useCurrentPage();
  const selection = useEditor((s) => s.selection);
  const els = page?.elements.filter((e) => selection.includes(e.id)) ?? [];
  if (!page || !els.length) return null;
  if (els.length > 1) {
    return (
      <Section title={`${els.length}개 선택`}>
        <div className="row wrap">
          <Button size="sm" icon="alignLeft" onClick={() => align("left")} />
          <Button size="sm" icon="alignCenter" onClick={() => align("hcenter")} />
          <Button size="sm" icon="alignRight" onClick={() => align("right")} />
          <Button size="sm" icon="alignTop" onClick={() => align("top")} />
          <Button size="sm" icon="alignMiddle" onClick={() => align("vcenter")} />
          <Button size="sm" icon="alignBottom" onClick={() => align("bottom")} />
        </div>
        {els.some((e) => e.type === "image" && !e.managed) && (
          <Button size="sm" icon="grid" onClick={() => includeInLayout(els.map((e) => e.id))}>
            선택 이미지를 자동 레이아웃에 포함
          </Button>
        )}
        <Toggle checked={els.every((e) => e.locked)} onChange={(locked) => patchElements(selection, { locked })} label="잠금" />
        <Button size="sm" variant="danger" icon="trash" onClick={deleteSelection}>
          삭제
        </Button>
      </Section>
    );
  }
  const el = els[0];
  return (
    <>
      {el.type === "text" && <TextPanel el={el} />}
      {el.type === "image" && <ImagePanel el={el} pageId={page.id} />}
      {el.type === "shape" && <ShapePanel el={el} />}
      <GeometryPanel el={el} />
    </>
  );
}

function GeometryPanel({ el }: { el: PageElement }) {
  const set = (patch: Partial<PageElement>) => patchElements([el.id], patch, `geo:${el.id}`);
  return (
    <Section title="위치 · 크기 (pt)" right={<Toggle checked={!!el.locked} onChange={(locked) => set({ locked })} label={<Icon name={el.locked ? "lock" : "unlock"} size={14} />} />}>
      <div className="grid-4">
        <Field label="X">
          <NumberInput value={el.x} onChange={(x) => set({ x })} />
        </Field>
        <Field label="Y">
          <NumberInput value={el.y} onChange={(y) => set({ y })} />
        </Field>
        <Field label="W">
          <NumberInput value={el.w} min={1} onChange={(w) => set({ w })} />
        </Field>
        <Field label="H">
          <NumberInput value={el.h} min={1} onChange={(h) => set({ h })} />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="회전 (°)">
          <NumberInput value={el.rotation ?? 0} min={-360} max={360} onChange={(rotation) => set({ rotation })} />
        </Field>
        <Field label="불투명도 (%)">
          <NumberInput value={Math.round((el.opacity ?? 1) * 100)} min={0} max={100} step={5} onChange={(p) => set({ opacity: p / 100 })} />
        </Field>
      </div>
    </Section>
  );
}

function TextPanel({ el }: { el: TextElement }) {
  const settings = useEditor((s) => s.doc!.settings);
  const update = useEditor((s) => s.update);
  const base = resolveStyle(settings, el.role);
  const setStyle = (patch: Partial<TextStyle>) =>
    patchElements([el.id], (cur) => ({ style: clean({ ...(cur as TextElement).style, ...patch }) }), `style:${el.id}`);
  return (
    <>
      <Section title="텍스트">
        <textarea
          rows={Math.min(8, Math.max(2, el.text.split("\n").length + 1))}
          value={el.text}
          onChange={(e) => patchElements([el.id], { text: e.target.value }, `text:${el.id}`)}
        />
        <Field label="역할" hint="역할별 기본 스타일은 '타이포' 탭에서 문서 전체에 적용돼요">
          <Select value={el.role} onChange={(role) => patchElements([el.id], { role })} options={TEXT_ROLES.map((r) => ({ value: r.key, label: r.label }))} />
        </Field>
      </Section>
      <Section
        title="스타일"
        right={
          el.style && Object.keys(el.style).length ? (
            <button className="link-btn" onClick={() => patchElements([el.id], { style: undefined })}>
              기본값으로
            </button>
          ) : null
        }
      >
        <TypeControls value={el.style ?? {}} base={base} onChange={setStyle} />
        {el.style && Object.keys(el.style).length > 0 && (
          <Button
            size="sm"
            onClick={() =>
              update((d) => {
                d.settings.typography[el.role] = { ...d.settings.typography[el.role], ...el.style };
                for (const p of d.pages) for (const x of p.elements) if (x.type === "text" && x.id === el.id) x.style = undefined;
              })
            }
            title="이 요소의 스타일을 같은 역할의 모든 텍스트에 적용"
          >
            이 스타일을 &lsquo;{TEXT_ROLES.find((r) => r.key === el.role)?.label}&rsquo; 기본값으로
          </Button>
        )}
      </Section>
    </>
  );
}

function ImagePanel({ el, pageId }: { el: ImageElement; pageId: string }) {
  const settings = useEditor((s) => s.doc!.settings);
  const setModal = useEditor((s) => s.setModal);
  const ref = useLibrary((s) => (el.refId ? s.refs.find((r) => r.id === el.refId) : undefined));
  const set = (patch: Partial<ImageElement>, key?: string) => patchElements([el.id], patch as Partial<PageElement>, key);
  const capBase = resolveStyle(settings, "caption");
  return (
    <>
      <Section title="이미지">
        <div className="insp-preview">
          <SmartImage src={el.src} fit="contain" />
        </div>
        <div className="row wrap">
          <Button size="sm" icon="swap" onClick={() => setModal({ type: "picker", mode: "replace", targetId: el.id })}>
            라이브러리에서 교체
          </Button>
          {(el.sourceUrl || ref?.sourceUrl) && (
            <a className="btn btn-default btn-sm" href={el.sourceUrl || ref?.sourceUrl} target="_blank" rel="noreferrer">
              <Icon name="external" size={14} /> 원본
            </a>
          )}
        </div>
        <Field label="이미지 URL">
          <input value={el.src} onChange={(e) => set({ src: e.target.value, refId: undefined, natW: undefined, natH: undefined }, `src:${el.id}`)} />
        </Field>
        <Field label="맞춤">
          <Segmented
            value={el.fit}
            onChange={(fit) => set({ fit })}
            options={[
              { value: "cover", label: "채우기(크롭)" },
              { value: "contain", label: "전체 보이기" },
            ]}
          />
        </Field>
        {el.fit === "cover" && (
          <div className="grid-2">
            <Field label="초점 가로 %">
              <input type="range" min={0} max={100} value={el.focusX ?? 50} onChange={(e) => set({ focusX: Number(e.target.value) }, `focus:${el.id}`)} />
            </Field>
            <Field label="초점 세로 %">
              <input type="range" min={0} max={100} value={el.focusY ?? 50} onChange={(e) => set({ focusY: Number(e.target.value) }, `focus:${el.id}`)} />
            </Field>
          </div>
        )}
        <Field label="모서리 (pt)">
          <NumberInput value={el.radius ?? 0} min={0} max={200} onChange={(radius) => set({ radius }, `radius:${el.id}`)} />
        </Field>
        {!el.logo && (
          <div className="row wrap">
            <Toggle
              checked={!!el.managed}
              onChange={(managed) => (managed ? includeInLayout([el.id]) : set({ managed: false }))}
              label="자동 레이아웃에 포함"
            />
            {el.managed && (
              <>
                <Button size="sm" icon="chevronLeft" onClick={() => shiftManaged(pageId, el.id, -1)} title="배치 순서 앞으로" />
                <Button size="sm" icon="chevronRight" onClick={() => shiftManaged(pageId, el.id, 1)} title="배치 순서 뒤로" />
              </>
            )}
          </div>
        )}
        {el.managed && <p className="muted small">드래그해서 다른 이미지 위에 놓으면 자리가 바뀌어요. 다른 곳에 놓으면 자유 배치로 전환돼요.</p>}
      </Section>
      <Section title="캡션">
        <textarea rows={2} value={el.caption ?? ""} placeholder="이미지 위/아래에 표시할 캡션" onChange={(e) => set({ caption: e.target.value }, `cap:${el.id}`)} />
        <Field label="위치">
          <Select<CaptionPos>
            value={el.captionPos ?? "none"}
            onChange={(captionPos) => set({ captionPos })}
            options={[
              { value: "none", label: "숨김" },
              { value: "overlay-bottom", label: "이미지 위 · 하단" },
              { value: "overlay-top", label: "이미지 위 · 상단" },
              { value: "below", label: "이미지 아래" },
            ]}
          />
        </Field>
        {el.captionPos && el.captionPos !== "none" && (
          <TypeControls value={el.captionStyle ?? {}} base={capBase} compact onChange={(patch) => set({ captionStyle: clean({ ...el.captionStyle, ...patch }) }, `capstyle:${el.id}`)} />
        )}
      </Section>
    </>
  );
}

function ShapePanel({ el }: { el: ShapeElement }) {
  const set = (patch: Partial<ShapeElement>, key?: string) => patchElements([el.id], patch as Partial<PageElement>, key);
  return (
    <Section title={el.shape === "line" ? "선" : "도형"}>
      {el.shape !== "line" && (
        <Field label="채우기">
          <ColorInput value={el.fill} onChange={(fill) => set({ fill }, `fill:${el.id}`)} allowAccent allowEmpty />
        </Field>
      )}
      <Field label={el.shape === "line" ? "색상" : "테두리"}>
        <ColorInput value={el.stroke} onChange={(stroke) => set({ stroke }, `stroke:${el.id}`)} allowAccent allowEmpty />
      </Field>
      <div className="grid-2">
        <Field label="두께 (pt)">
          <NumberInput value={el.strokeWidth ?? 0} min={0} max={40} step={0.25} onChange={(strokeWidth) => set({ strokeWidth }, `sw:${el.id}`)} />
        </Field>
        {el.shape === "rect" && (
          <Field label="모서리 (pt)">
            <NumberInput value={el.radius ?? 0} min={0} max={200} onChange={(radius) => set({ radius }, `r:${el.id}`)} />
          </Field>
        )}
      </div>
    </Section>
  );
}

// ─── page ───────────────────────────────────────────────────

function PagePanel({ onAiPage }: { onAiPage: () => void }) {
  const page = useCurrentPage();
  const caseName = useLibrary((s) => (page?.caseId ? s.cases.find((c) => c.id === page.caseId)?.name : undefined));
  if (!page) return null;
  const L = page.layout;
  const managed = page.elements.filter((e) => e.type === "image" && (e.managed || e.logo)).length;
  const images = page.elements.filter((e) => e.type === "image" && !e.logo) as ImageElement[];
  const capPos = images[0]?.captionPos ?? "none";
  return (
    <>
      <Section title="페이지">
        <Field label="그룹 / 이름">
          <input value={page.group ?? ""} onChange={(e) => updatePage(page.id, (p) => void (p.group = e.target.value), `group:${page.id}`)} />
        </Field>
        {caseName && <p className="muted small">연결된 케이스: {caseName}</p>}
        <Field label="배경색">
          <ColorInput value={page.background} onChange={(background) => updatePage(page.id, (p) => void (p.background = background), `bg:${page.id}`)} allowEmpty />
        </Field>
        <Toggle checked={!page.hideFooter} onChange={(v) => updatePage(page.id, (p) => void (p.hideFooter = !v))} label="하단 태그라인·페이지 번호 표시" />
        <Button icon="sparkle" variant="accent" onClick={onAiPage}>
          AI 글쓰기 — 타이틀·설명·캡션
        </Button>
      </Section>

      {page.flow && <TextFlowSection pageId={page.id} flow={page.flow} />}

      {page.kind === "compare" && (
        <Section title="경쟁사 · 상품 비교">
          <Field label="비교 항목 수">
            <Segmented<string>
              value={String(compareCount(page))}
              onChange={(v) => {
                const n = Number(v);
                if (n < compareCount(page) && !confirm(`항목을 ${n}개로 줄이면 오른쪽 항목 내용이 빠져요. 계속할까요? (Ctrl+Z 로 되돌리기)`)) return;
                setCompareItems(page.id, n);
              }}
              options={["2", "3", "4"].map((v) => ({ value: v, label: `${v}개` }))}
            />
          </Field>
          <p className="help-text">왼쪽 칸은 비교 기준(행), 항목마다 한 줄에 하나씩 적으면 행이 맞춰져요. 이미지는 더블클릭해서 바꿔요.</p>
        </Section>
      )}

      {page.kind === "toc" && (
        <Section title="목차">
          <Button size="sm" icon="refresh" onClick={() => (refreshToc(page.id), toast.success("간지 제목으로 목차를 다시 만들었어요"))}>
            목차 다시 만들기
          </Button>
          <p className="help-text">간지(섹션) 제목과 쪽 번호로 채워요. 간지가 없으면 케이스·레퍼런스·비교 페이지 제목으로 만들어요.</p>
        </Section>
      )}

      {(page.kind === "cover" || page.kind === "section" || page.kind === "toc" || page.kind === "compare" || page.kind === "closing") && managed === 0 ? (
        page.kind === "cover" || page.kind === "section" ? (
        <Section title={page.kind === "cover" ? "표지" : "간지"}>
          <p className="help-text">
            가운데 제목은 아래쪽, 설명은 위쪽에 붙어 있어서 줄이 늘어도 겹치지 않아요.
            {page.kind === "cover" && (
              <>
                <br />
                <b>{"{title}"}</b>은 문서 제목, <b>{"{dept}"}</b>는 부서명(하단 왼쪽 문구)으로 바뀌어 보여요.
              </>
            )}
          </p>
        </Section>
        ) : null
      ) : (
        <AutoLayoutSection pageId={page.id} layout={L} count={managed} area={page.area} />
      )}

      {images.length > 0 && (
        <Section title="캡션 일괄">
          <Select<CaptionPos>
            value={capPos}
            onChange={(pos) => setCaptionsVisible(page.id, pos)}
            options={[
              { value: "none", label: "모든 캡션 숨김" },
              { value: "overlay-bottom", label: "이미지 위 · 하단에 표시" },
              { value: "overlay-top", label: "이미지 위 · 상단에 표시" },
              { value: "below", label: "이미지 아래에 표시" },
            ]}
          />
        </Section>
      )}

      <Section title="메모 (발표자 노트)">
        <textarea rows={3} value={page.notes ?? ""} onChange={(e) => updatePage(page.id, (p) => void (p.notes = e.target.value), `notes:${page.id}`)} />
      </Section>
    </>
  );
}

function LayoutGlyph({ mode }: { mode: string }) {
  const r = (x: number, y: number, w: number, h: number, k: number) => <rect key={k} x={x} y={y} width={w} height={h} rx={0.8} />;
  const shapes: Record<string, ReactElement[]> = {
    grid: [r(1, 1, 6, 5, 1), r(8, 1, 6, 5, 2), r(15, 1, 6, 5, 3), r(1, 7, 6, 5, 4), r(8, 7, 6, 5, 5), r(15, 7, 6, 5, 6)],
    rows: [r(1, 1, 9, 5, 1), r(11, 1, 10, 5, 2), r(1, 7, 5, 5, 3), r(7, 7, 8, 5, 4), r(16, 7, 5, 5, 5)],
    columns: [r(1, 1, 6, 4, 1), r(1, 6, 6, 6, 2), r(8, 1, 6, 7, 3), r(8, 9, 6, 3, 4), r(15, 1, 6, 11, 5)],
    mosaic: [r(1, 1, 10, 7, 1), r(1, 9, 10, 3, 2), r(12, 1, 9, 4, 3), r(12, 6, 4, 6, 4), r(17, 6, 4, 6, 5)],
    report: [r(1, 1, 5, 3.3, 1), r(1, 5, 5, 3, 2), r(1, 9, 5, 3, 3), r(7, 1, 9, 6, 4), r(17, 1, 4, 11, 5), r(7, 8, 9, 4, 6)],
  };
  return (
    <svg width="36" height="22" viewBox="0 0 22 13" fill="currentColor">
      {shapes[mode]}
    </svg>
  );
}

const FLOW_OPTIONS: { value: "auto" | "header" | "side"; label: string; icon: "sparkle" | "heading" | "sidebar"; hint: string }[] = [
  { value: "auto", label: "자동", icon: "sparkle", hint: "글 길이를 보고 알아서 골라요" },
  { value: "header", label: "짧은 글", icon: "heading", hint: "제목 옆(3~5단)에 두고, 이미지는 전체 폭" },
  { value: "side", label: "긴 글", icon: "sidebar", hint: "왼쪽 단에 두고, 이미지는 2~5단" },
];

/** 글 배치 — 첨부 템플릿의 '짧은 텍스트 / 긴 텍스트' 구성 */
function TextFlowSection({ pageId, flow }: { pageId: string; flow: NonNullable<Page["flow"]> }) {
  const resolved = flow.resolved ?? "header";
  return (
    <Section title="글 배치">
      <div className="choice-row">
        {FLOW_OPTIONS.map((o) => (
          <button key={o.value} className={"choice" + (flow.mode === o.value ? " on" : "")} onClick={() => setTextFlow(pageId, o.value)} title={o.hint}>
            <Icon name={o.icon} size={18} />
            <span>{o.label}</span>
          </button>
        ))}
      </div>
      {flow.mode === "fixed" ? (
        <div className="note-box">
          글 상자를 직접 옮겨서 자동 배치가 꺼졌어요.
          <button className="link-btn" onClick={() => setTextFlow(pageId, "auto")}>
            다시 자동으로
          </button>
        </div>
      ) : (
        <p className="help-text">
          {flow.mode === "auto" ? `지금은 ${resolved === "header" ? "짧은 글 — 제목 옆에" : "긴 글 — 왼쪽 단에"} 두었어요. ` : ""}
          {FLOW_OPTIONS.find((o) => o.value === flow.mode)?.hint}
        </p>
      )}
    </Section>
  );
}

/** 이미지 영역 오토 레이아웃 — 피그마의 Auto layout 패널처럼 방향 · 간격 · 여백 · 크기 · 정렬을 한곳에서 */
function AutoLayoutSection({ pageId, layout: L, count, area }: { pageId: string; layout: PageLayout; count: number; area: Rect }) {
  const set = (patch: Partial<PageLayout>, key?: string) => relayout(pageId, patch, key);
  const sizing = L.sizing ?? "fill";
  const countField: { label: string; key: "rows" | "columns"; min: number; auto: boolean } | null =
    L.mode === "rows"
      ? { label: "줄 수", key: "rows", min: 0, auto: true }
      : L.mode === "columns"
        ? { label: "열 수", key: "columns", min: 0, auto: true }
        : L.mode === "grid"
          ? { label: "열 수", key: "columns", min: 1, auto: false }
          : null;
  const countValue = countField ? L[countField.key] : 0;
  return (
    <Section
      title="오토 레이아웃"
      right={
        <span className="row">
          <span className="muted small">이미지 {count}장</span>
          <Button size="sm" variant="ghost" icon="shuffle" title="다른 배열로 섞기" onClick={() => set({ seed: L.seed + 1 })} />
        </span>
      }
    >
      <div className="al-modes">
        {LAYOUT_MODES.map((m) => (
          <button key={m.key} className={L.mode === m.key ? "on" : ""} onClick={() => set({ mode: m.key })} title={m.hint}>
            <LayoutGlyph mode={m.key} />
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      <p className="help-text">{LAYOUT_MODES.find((m) => m.key === L.mode)?.hint}</p>

      <div className="al-grid">
        <AlignPad
          alignX={L.alignX ?? "center"}
          alignY={L.alignY ?? "center"}
          disabled={sizing === "fill"}
          onChange={(alignX, alignY) => set({ alignX, alignY, sizing: "fit" })}
        />
        <div className="al-fields">
          <label className="al-field" title="이미지 사이 간격 (pt)">
            <Icon name="gap" size={15} />
            <NumberInput value={L.gap} min={0} max={80} step={1} onChange={(gap) => set({ gap }, `gap:${pageId}`)} />
          </label>
          {countField ? (
            <div className="al-field al-stepper" title={countField.label + (countField.auto ? " (0 = 자동)" : "")}>
              <span className="al-field-label">{countField.label}</span>
              <button onClick={() => set({ [countField.key]: Math.max(countField.min, countValue - 1) })} aria-label="줄이기">
                −
              </button>
              <strong>{countField.auto && countValue === 0 ? "자동" : countValue}</strong>
              <button onClick={() => set({ [countField.key]: Math.min(8, countValue + 1) })} aria-label="늘리기">
                +
              </button>
            </div>
          ) : (
            <div className="al-field al-stepper" title="배열 변형">
              <span className="al-field-label">배열</span>
              <button onClick={() => set({ seed: Math.max(0, L.seed - 1) })} aria-label="이전 배열">
                ‹
              </button>
              <strong>{L.seed + 1}</strong>
              <button onClick={() => set({ seed: L.seed + 1 })} aria-label="다음 배열">
                ›
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="al-pads">
        <label className="al-field" title="좌우 안쪽 여백 (pt)">
          <Icon name="padX" size={15} />
          <NumberInput value={L.padX ?? 0} min={0} max={200} onChange={(padX) => set({ padX }, `padx:${pageId}`)} />
        </label>
        <label className="al-field" title="위아래 안쪽 여백 (pt)">
          <Icon name="padY" size={15} />
          <NumberInput value={L.padY ?? 0} min={0} max={200} onChange={(padY) => set({ padY }, `pady:${pageId}`)} />
        </label>
      </div>

      <div className="choice-row two">
        <button className={"choice" + (sizing === "fill" ? " on" : "")} onClick={() => set({ sizing: "fill" })} title="영역을 빈틈없이 채워요. 비율이 다르면 이미지 가장자리가 조금 잘려요">
          <Icon name="fill" size={18} />
          <span>꽉 채우기</span>
        </button>
        <button className={"choice" + (sizing === "fit" ? " on" : "")} onClick={() => set({ sizing: "fit" })} title="이미지를 자르지 않아요. 남는 공간은 정렬 위치에 따라 비워 둬요">
          <Icon name="fit" size={18} />
          <span>비율 유지</span>
        </button>
      </div>
      <p className="help-text">{sizing === "fill" ? "영역을 꽉 채워요 — 비율이 다르면 가장자리가 살짝 잘려요." : "자르지 않고 원본 비율 그대로 — 남는 공간은 위 3×3 정렬 칸으로 위치를 정해요."}</p>

      <details className="al-more">
        <summary>이미지 영역 직접 조정</summary>
        <div className="grid-4">
          <Field label="X">
            <NumberInput value={area.x} onChange={(x) => setArea(pageId, { x })} />
          </Field>
          <Field label="Y">
            <NumberInput value={area.y} onChange={(y) => setArea(pageId, { y })} />
          </Field>
          <Field label="W">
            <NumberInput value={area.w} min={10} onChange={(w) => setArea(pageId, { w })} />
          </Field>
          <Field label="H">
            <NumberInput value={area.h} min={10} onChange={(h) => setArea(pageId, { h })} />
          </Field>
        </div>
        <p className="help-text">편집 화면의 점선이 이미지 영역이에요. 단위 pt.</p>
      </details>
    </Section>
  );
}

const ALIGNS: AlignPos[] = ["start", "center", "end"];

/** 3×3 정렬 칸 (피그마 오토 레이아웃의 정렬 박스) */
function AlignPad({ alignX, alignY, disabled, onChange }: { alignX: AlignPos; alignY: AlignPos; disabled: boolean; onChange: (x: AlignPos, y: AlignPos) => void }) {
  return (
    <div className={"align-pad" + (disabled ? " disabled" : "")} title={disabled ? "‘비율 유지’일 때 남는 공간의 정렬 위치 (누르면 비율 유지로 바뀌어요)" : "정렬 위치"}>
      {ALIGNS.map((y) =>
        ALIGNS.map((x) => (
          <button key={x + y} className={!disabled && x === alignX && y === alignY ? "on" : ""} onClick={() => onChange(x, y)} aria-label={`정렬 ${x} ${y}`}>
            <span />
          </button>
        )),
      )}
    </div>
  );
}

// ─── doc format ─────────────────────────────────────────────

function useSettings(): [DocSettings, (fn: (s: DocSettings) => void, key?: string) => void] {
  const settings = useEditor((s) => s.doc!.settings);
  const update = useEditor((s) => s.update);
  return [settings, (fn, key) => update((d) => fn(d.settings), key ? { key } : undefined)];
}

const NUMBER_FORMATS = [
  { value: "{n}", label: "1" },
  { value: "{nn}", label: "01" },
  { value: "{n} / {total}", label: "1 / 12" },
  { value: "- {n} -", label: "- 1 -" },
  { value: "P. {n}", label: "P. 1" },
];

function DocPanel() {
  const [s, set] = useSettings();
  const f = s.footer;
  const team = useCurrentTeam();
  const isAdmin = !!team && ROLE_RANK[team.role] >= ROLE_RANK.admin;
  return (
    <>
      <Section title="팀 기본 양식">
        <p className="muted small">새 문서는 &lsquo;{team?.name}&rsquo; 팀의 기본 양식(부서명·하단 태그라인·타이포)으로 시작해요.</p>
        <div className="row wrap">
          <Button
            size="sm"
            onClick={async () => {
              if (!team) return;
              const d = await teamApi.detail(team.id);
              replaceDocSettings({ ...structuredClone(d.defaults), pageSize: s.pageSize });
              toast.success("팀 기본 양식을 이 문서에 적용했어요 (Ctrl+Z 로 되돌리기)");
            }}
          >
            팀 기본 양식 적용
          </Button>
          {isAdmin && (
            <Button
              size="sm"
              onClick={async () => {
                if (!team || !confirm(`이 문서의 양식을 '${team.name}' 팀의 기본값으로 저장할까요? 이후 새로 만드는 문서에 적용돼요.`)) return;
                try {
                  await teamApi.saveDefaults(team.id, s);
                  toast.success("팀 기본 양식으로 저장했어요");
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            >
              이 양식을 팀 기본값으로
            </Button>
          )}
        </div>
      </Section>
      <TemplateSection />
      <Section title="페이지">
        <Field label="크기">
          <Select value={s.pageSize} onChange={(v) => changePageSize(v)} options={Object.entries(PAGE_SIZES).map(([k, v]) => ({ value: k as PageSizeKey, label: `${v.label} (${v.w}×${v.h}pt)` }))} />
        </Field>
        <Field label="여백 (위 · 오른쪽 · 아래 · 왼쪽, pt)" hint="템플릿마다 기본 여백이 달라요 (1mm ≈ 2.83pt). 새로 추가하는 페이지부터 적용되고, 템플릿을 다시 적용하면 기본값으로 돌아가요">
          <div className="grid-4">
            {(["top", "right", "bottom", "left"] as const).map((k) => (
              <NumberInput key={k} value={s.margin[k]} min={0} max={200} onChange={(v) => set((x) => void (x.margin[k] = v), `margin:${k}`)} />
            ))}
          </div>
        </Field>
        <div className="grid-2">
          <Field label="배경색">
            <ColorInput value={s.background} onChange={(v) => set((x) => void (x.background = v ?? "#ffffff"), "bg")} />
          </Field>
          <Field label={themeOf(s).swatches ? "메인 컬러" : "강조색"}>
            <ColorInput value={s.accent} onChange={(v) => (themeOf(s).swatches ? setDocMainColor(v ?? themeOf(s).accent) : set((x) => void (x.accent = v ?? "#c8102e"), "accent"))} />
          </Field>
        </div>
      </Section>

      <Section title="하단 태그라인 · 페이지 번호">
        <Field label="양식 프리셋">
          <select
            value=""
            onChange={(e) => {
              const p = FOOTER_PRESETS.find((x) => x.key === e.target.value);
              if (p) set((x) => void (x.footer = { ...p.footer }));
            }}
          >
            <option value="">프리셋 적용…</option>
            {FOOTER_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Toggle checked={f.show} onChange={(v) => set((x) => void (x.footer.show = v))} label="하단 태그라인 표시" />
        {f.show && (
          <>
            <Field label="왼쪽">
              <input value={f.left} onChange={(e) => set((x) => void (x.footer.left = e.target.value), "f:left")} />
            </Field>
            <Field label="가운데">
              <input value={f.center} onChange={(e) => set((x) => void (x.footer.center = e.target.value), "f:center")} />
            </Field>
            <Field label="오른쪽" hint="{title} = 문서 제목">
              <input value={f.right} onChange={(e) => set((x) => void (x.footer.right = e.target.value), "f:right")} />
            </Field>
            <Toggle checked={f.pageNumber} onChange={(v) => set((x) => void (x.footer.pageNumber = v))} label="페이지 번호" />
            {f.pageNumber && (
              <>
                <Field label="번호 위치">
                  <Segmented
                    value={f.pageNumberPos}
                    onChange={(v) => set((x) => void (x.footer.pageNumberPos = v))}
                    options={[
                      { value: "left", label: "왼쪽" },
                      { value: "center", label: "가운데" },
                      { value: "right", label: "오른쪽" },
                    ]}
                  />
                </Field>
                <Field label="시작 번호" hint="표지를 빼고 세려면 0 으로">
                  <NumberInput value={s.pageNumberStart} min={0} onChange={(v) => set((x) => void (x.pageNumberStart = v), "pn-start")} />
                </Field>
                <Field label="번호 형식" hint="{n} 번호 · {nn} 두 자리 · {total} 전체">
                  <div className="row">
                    <input value={f.pageNumberFormat} onChange={(e) => set((x) => void (x.footer.pageNumberFormat = e.target.value), "pn-fmt")} />
                    <select value="" onChange={(e) => e.target.value && set((x) => void (x.footer.pageNumberFormat = e.target.value))}>
                      <option value="">예시…</option>
                      {NUMBER_FORMATS.map((n) => (
                        <option key={n.value} value={n.value}>
                          {n.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </Field>
              </>
            )}
            <Toggle checked={f.divider} onChange={(v) => set((x) => void (x.footer.divider = v))} label="구분선" />
            <p className="muted small">글꼴·크기·자간은 &lsquo;타이포&rsquo; 탭의 &lsquo;하단 태그라인&rsquo;에서 조정해요.</p>
          </>
        )}
      </Section>

      <Section title="상단 헤더">
        <Toggle checked={s.header.show} onChange={(v) => set((x) => void (x.header.show = v))} label="헤더 표시" />
        {s.header.show && (
          <>
            <div className="grid-2">
              <Field label="왼쪽">
                <input value={s.header.left} onChange={(e) => set((x) => void (x.header.left = e.target.value), "h:left")} />
              </Field>
              <Field label="오른쪽">
                <input value={s.header.right} onChange={(e) => set((x) => void (x.header.right = e.target.value), "h:right")} />
              </Field>
            </div>
            <Toggle checked={s.header.divider} onChange={(v) => set((x) => void (x.header.divider = v))} label="구분선" />
          </>
        )}
      </Section>

      <Section title="AI 글쓰기">
        <Field label="관점" hint={AI_PERSPECTIVES.find((p) => p.key === (s.aiPerspective ?? "design"))?.hint}>
          <Segmented<AiPerspective>
            value={s.aiPerspective ?? "design"}
            onChange={(v) => set((x) => void (x.aiPerspective = v))}
            options={AI_PERSPECTIVES.map((p) => ({ value: p.key, label: p.label.replace(" 관점", ""), title: p.hint }))}
          />
        </Field>
        <Field label="문체" hint={AI_TONES.find((t) => t.key === (s.aiTone ?? "report"))?.hint}>
          <Segmented<AiTone> value={s.aiTone ?? "report"} onChange={(v) => set((x) => void (x.aiTone = v))} options={AI_TONES.map((t) => ({ value: t.key, label: t.label }))} />
        </Field>
        <Field label="작성 언어">
          <Segmented
            value={s.aiLanguage}
            onChange={(v) => set((x) => void (x.aiLanguage = v))}
            options={[
              { value: "ko", label: "한국어" },
              { value: "en", label: "English" },
            ]}
          />
        </Field>
      </Section>
    </>
  );
}

// ─── typography ─────────────────────────────────────────────

function TypePanel() {
  const [s, set] = useSettings();
  const [open, setOpen] = useState<string>("title");
  return (
    <>
      <Section title="타이포 프리셋">
        <select
          value=""
          onChange={(e) => {
            const p = TYPOGRAPHY_PRESETS.find((x) => x.key === e.target.value);
            if (!p) return;
            set((x) => {
              x.typography = structuredClone(REPORT_TYPOGRAPHY);
              for (const [role, style] of Object.entries(p.apply)) Object.assign(x.typography[role as keyof typeof x.typography], style);
            });
          }}
        >
          <option value="">프리셋 적용…</option>
          {TYPOGRAPHY_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="muted small">역할별 스타일은 문서의 모든 페이지에 적용돼요. 개별 요소에서 따로 바꾼 값은 유지돼요.</p>
      </Section>
      {TEXT_ROLES.map((r) => {
        const st = resolveStyle(s, r.key);
        const isOpen = open === r.key;
        return (
          <section key={r.key} className={"insp-section role-section" + (isOpen ? " open" : "")}>
            <button className="role-head" onClick={() => setOpen(isOpen ? "" : r.key)}>
              <span className="role-sample" style={{ fontFamily: `'${st.fontFamily}', sans-serif`, fontWeight: st.fontWeight, color: st.color }}>
                Aa 가
              </span>
              <span className="role-name">{r.label}</span>
              <span className="muted small">
                {st.fontFamily} · {st.fontSize}pt
              </span>
            </button>
            {isOpen && (
              <TypeControls
                value={s.typography[r.key] ?? {}}
                base={REPORT_TYPOGRAPHY[r.key]}
                onChange={(patch) => set((x) => void (x.typography[r.key] = clean({ ...x.typography[r.key], ...patch })), `typo:${r.key}`)}
              />
            )}
          </section>
        );
      })}
    </>
  );
}

function clean<T extends object>(o: T): T {
  const out = { ...o } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === "") delete out[k];
  return out as T;
}

function compareCount(page: Page): number {
  return Object.keys(extractContent(page).texts).filter((k) => /^cmp-name-\d$/.test(k)).length || 3;
}

/** 문서 템플릿 — 지금 템플릿 · 바꾸기 · 톤온톤 메인 컬러 */
function TemplateSection() {
  const s = useEditor((st) => st.doc!.settings);
  const [open, setOpen] = useState(false);
  const theme = themeOf(s);
  return (
    <Section title="템플릿" right={<Button size="sm" onClick={() => setOpen(true)}>바꾸기</Button>}>
      <button className="tpl-current" onClick={() => setOpen(true)} title="템플릿 바꾸기">
        <TemplateThumbs id={theme.id} accent={s.accent} pageSize={s.pageSize} pages={1} />
        <span>
          <strong>{theme.name}</strong>
          <span className="muted small">{theme.description}</span>
        </span>
      </button>
      {theme.swatches && (
        <Field label="메인 컬러" hint="명암 단계가 자동으로 맞춰져요">
          <MainColorPicker value={s.accent} swatches={theme.swatches} onChange={setDocMainColor} />
        </Field>
      )}
      <p className="help-text">폰트: {fontsNote(theme.id)} — 모두 상업적 사용이 가능한 무료 폰트(OFL)</p>
      {open && <TemplateSwitchDialog current={{ id: theme.id, accent: s.accent }} onClose={() => setOpen(false)} />}
    </Section>
  );
}

function TemplateSwitchDialog({ current, onClose }: { current: TemplateChoice; onClose: () => void }) {
  const [choice, setChoice] = useState<TemplateChoice>(current);
  const pageSizeKey = useEditor((st) => st.doc!.settings.pageSize);
  const pages = useEditor((st) => st.doc!.pages.length);
  return (
    <Modal
      title="템플릿 바꾸기"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted small">{pages}페이지의 글 · 이미지는 그대로 두고 배치 · 색 · 폰트만 바꿔요. Ctrl+Z 로 되돌릴 수 있어요.</span>
          <span className="spacer" />
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="primary"
            onClick={() => {
              applyDocTemplate(choice.id, choice.accent);
              toast.success("템플릿을 바꿨어요 (Ctrl+Z 로 되돌리기)");
              onClose();
            }}
          >
            이 템플릿으로 바꾸기
          </Button>
        </>
      }
    >
      <TemplatePicker value={choice} onChange={setChoice} pageSize={pageSizeKey} />
    </Modal>
  );
}
