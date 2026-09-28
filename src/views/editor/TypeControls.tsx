import type { TextStyle } from "../../../shared/types";
import { Icon } from "../../components/icons";
import { ColorInput, Field, NumberInput, Segmented, Toggle } from "../../components/ui";
import { FONT_FAMILIES, FONT_WEIGHTS } from "../../lib/fonts";

/** 폰트·크기·자간·행간 등 세부 타이포 조정. value 는 덮어쓸 값, base 는 현재 적용값(placeholder). */
export function TypeControls({
  value,
  base,
  onChange,
  compact,
}: {
  value: TextStyle;
  base: TextStyle;
  onChange: (patch: Partial<TextStyle>) => void;
  compact?: boolean;
}) {
  const v = { ...base, ...value };
  return (
    <div className="type-controls">
      <Field label="폰트">
        <input
          list="rb-fonts"
          value={value.fontFamily ?? ""}
          placeholder={base.fontFamily}
          onChange={(e) => onChange({ fontFamily: e.target.value || undefined })}
        />
        <datalist id="rb-fonts">
          {FONT_FAMILIES.map((f) => (
            <option key={f.name} value={f.name}>
              {f.note}
            </option>
          ))}
        </datalist>
      </Field>
      <div className="grid-2">
        <Field label="크기 (pt)">
          <NumberInput value={v.fontSize} step={0.5} min={2} max={300} onChange={(fontSize) => onChange({ fontSize })} />
        </Field>
        <Field label="굵기">
          <select value={v.fontWeight ?? 400} onChange={(e) => onChange({ fontWeight: Number(e.target.value) })}>
            {FONT_WEIGHTS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid-2">
        <Field label="자간 (1/1000em)">
          <NumberInput value={v.tracking ?? 0} step={5} min={-200} max={800} onChange={(tracking) => onChange({ tracking })} />
        </Field>
        <Field label="행간 (%)">
          <NumberInput
            value={Math.round((v.lineHeight ?? 1.4) * 100)}
            step={5}
            min={60}
            max={400}
            onChange={(p) => onChange({ lineHeight: p / 100 })}
          />
        </Field>
      </div>
      <Field label="색상">
        <ColorInput value={v.color} onChange={(color) => onChange({ color })} allowAccent />
      </Field>
      <Field label="정렬">
        <Segmented
          value={v.align ?? "left"}
          onChange={(align) => onChange({ align })}
          options={[
            { value: "left", label: <Icon name="alignLeft" size={14} />, title: "왼쪽" },
            { value: "center", label: <Icon name="alignCenter" size={14} />, title: "가운데" },
            { value: "right", label: <Icon name="alignRight" size={14} />, title: "오른쪽" },
            { value: "justify", label: "양끝", title: "양끝 정렬" },
          ]}
        />
      </Field>
      {!compact && (
        <>
          <Field label="세로 정렬">
            <Segmented
              value={v.vAlign ?? "top"}
              onChange={(vAlign) => onChange({ vAlign })}
              options={[
                { value: "top", label: "위" },
                { value: "middle", label: "가운데" },
                { value: "bottom", label: "아래" },
              ]}
            />
          </Field>
          <div className="row wrap">
            <Toggle checked={!!v.italic} onChange={(italic) => onChange({ italic })} label="기울임" />
            <Toggle checked={!!v.uppercase} onChange={(uppercase) => onChange({ uppercase })} label="대문자" />
          </div>
          <Field label="배경">
            <ColorInput value={v.background} onChange={(background) => onChange({ background })} allowAccent allowEmpty />
          </Field>
          {v.background && (
            <div className="grid-2">
              <Field label="배경 방식">
                <Segmented
                  value={v.bgMode ?? "box"}
                  onChange={(bgMode) => onChange({ bgMode })}
                  options={[
                    { value: "box", label: "박스" },
                    { value: "inline", label: "글자 뒤" },
                  ]}
                />
              </Field>
              <Field label="여백 (pt)">
                <NumberInput value={v.padding ?? 0} step={0.5} min={0} max={60} onChange={(padding) => onChange({ padding })} />
              </Field>
            </div>
          )}
        </>
      )}
    </div>
  );
}
