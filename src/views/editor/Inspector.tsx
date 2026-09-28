import { useState, type ReactElement, type ReactNode } from "react";
import {
  LAYOUT_MODES,
  PAGE_SIZES,
  TEXT_ROLES,
  type CaptionPos,
  type DocSettings,
  type ImageElement,
  type PageElement,
  type PageSizeKey,
  type ShapeElement,
  type TextElement,
  type TextStyle,
} from "../../../shared/types";
import { Icon } from "../../components/icons";
import { resolveStyle } from "../../components/PageView";
import { SmartImage } from "../../components/SmartImage";
import { Button, ColorInput, Field, NumberInput, Segmented, Select, Toggle } from "../../components/ui";
import { FOOTER_PRESETS, REPORT_TYPOGRAPHY, TYPOGRAPHY_PRESETS } from "../../lib/defaults";
import { useCurrentPage, useEditor } from "../../store/editor";
import { useLibrary } from "../../store/library";
import {
  align,
  changePageSize,
  deleteSelection,
  includeInLayout,
  patchElements,
  relayout,
  setArea,
  setCaptionsVisible,
  shiftManaged,
  updatePage,
} from "./actions";
import { TypeControls } from "./TypeControls";

type Tab = "element" | "page" | "doc" | "type";

export function Inspector({ onAiPage }: { onAiPage: () => void }) {
  const [tab, setTab] = useState<Tab>("element");
  const selection = useEditor((s) => s.selection);
  const shown: Tab = tab === "element" && selection.length === 0 ? "page" : tab;
  return (
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
        <Field label="역할" hint="역할별 기본 스타일은 '타이포' 탭에서 문서 전체에 적용됩니다">
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
        {el.managed && <p className="muted small">드래그해서 다른 이미지 위에 놓으면 자리가 바뀝니다. 다른 곳에 놓으면 자유 배치로 전환됩니다.</p>}
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
          AI 로 이 페이지 분석 · 타이틀 작성
        </Button>
      </Section>

      <Section
        title={`자동 레이아웃 · 이미지 ${managed}장`}
        right={
          <span className="row">
            <Button size="sm" icon="shuffle" title="다른 배열 (모자이크)" onClick={() => relayout(page.id, { seed: L.seed + 1, mode: L.mode === "mosaic" ? "mosaic" : L.mode })} />
            <Button size="sm" icon="refresh" title="다시 배치" onClick={() => relayout(page.id)} />
          </span>
        }
      >
        <div className="layout-modes">
          {LAYOUT_MODES.map((m) => (
            <button key={m.key} className={L.mode === m.key ? "on" : ""} onClick={() => relayout(page.id, { mode: m.key })} title={m.hint}>
              <LayoutGlyph mode={m.key} />
              <span>{m.label}</span>
            </button>
          ))}
        </div>
        <div className="grid-2">
          {L.mode === "grid" && (
            <Field label="열(단) 수">
              <NumberInput value={L.columns} min={1} max={8} onChange={(columns) => relayout(page.id, { columns }, `cols:${page.id}`)} />
            </Field>
          )}
          {L.mode === "columns" && (
            <Field label="열 수 (0=자동)">
              <NumberInput value={L.columns} min={0} max={8} onChange={(columns) => relayout(page.id, { columns }, `cols:${page.id}`)} />
            </Field>
          )}
          {L.mode === "rows" && (
            <Field label="줄 수 (0=자동)">
              <NumberInput value={L.rows} min={0} max={8} onChange={(rows) => relayout(page.id, { rows }, `rows:${page.id}`)} />
            </Field>
          )}
          {L.mode === "mosaic" && (
            <Field label="배열 변형">
              <NumberInput value={L.seed} min={0} onChange={(seed) => relayout(page.id, { seed }, `seed:${page.id}`)} />
            </Field>
          )}
          <Field label="간격 (pt)">
            <NumberInput value={L.gap} min={0} max={60} step={0.5} onChange={(gap) => relayout(page.id, { gap }, `gap:${page.id}`)} />
          </Field>
        </div>
        <Field label="이미지 영역 (pt)" hint="점선 영역 — 헤더를 늘리거나 줄일 때 조정">
          <div className="grid-4">
            <NumberInput value={page.area.x} onChange={(x) => setArea(page.id, { x })} />
            <NumberInput value={page.area.y} onChange={(y) => setArea(page.id, { y })} />
            <NumberInput value={page.area.w} min={10} onChange={(w) => setArea(page.id, { w })} />
            <NumberInput value={page.area.h} min={10} onChange={(h) => setArea(page.id, { h })} />
          </div>
        </Field>
      </Section>

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
  };
  return (
    <svg width="44" height="26" viewBox="0 0 22 13" fill="currentColor">
      {shapes[mode]}
    </svg>
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
  return (
    <>
      <Section title="페이지">
        <Field label="크기">
          <Select value={s.pageSize} onChange={(v) => changePageSize(v)} options={Object.entries(PAGE_SIZES).map(([k, v]) => ({ value: k as PageSizeKey, label: `${v.label} (${v.w}×${v.h}pt)` }))} />
        </Field>
        <Field label="여백 (위 · 오른쪽 · 아래 · 왼쪽, pt)" hint="템플릿과 하단 태그라인 위치의 기준">
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
          <Field label="강조색">
            <ColorInput value={s.accent} onChange={(v) => set((x) => void (x.accent = v ?? "#c8102e"), "accent")} />
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
            <Field label="오른쪽">
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
            <p className="muted small">글꼴·크기·자간은 &lsquo;타이포&rsquo; 탭의 &lsquo;하단 태그라인&rsquo;에서 조정합니다.</p>
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

      <Section title="AI">
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
        <p className="muted small">역할별 스타일은 문서의 모든 페이지에 적용됩니다. 개별 요소에서 따로 바꾼 값은 유지됩니다.</p>
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
