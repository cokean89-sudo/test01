import { useMemo, useState } from "react";
import type { Reference } from "../../../shared/types";
import { Icon } from "../../components/icons";
import { SmartImage } from "../../components/SmartImage";
import { Button, Modal } from "../../components/ui";
import { uid } from "../../lib/id";
import { searchRefs } from "../../lib/search";
import { useEditor } from "../../store/editor";
import { useLibrary } from "../../store/library";
import { addElement, addRefsToPage, replaceImage } from "./actions";

/** 라이브러리에서 이미지 추가/교체 */
export function ImagePicker({ mode, targetId }: { mode: "add" | "replace"; targetId?: string }) {
  const { refs, cases } = useLibrary();
  const setModal = useEditor((s) => s.setModal);
  const docQuery = useEditor((s) => s.doc?.query ?? "");
  const [query, setQuery] = useState(docQuery);
  const [picked, setPicked] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const hits = useMemo(() => searchRefs(refs, cases, query, "or", "relevance"), [refs, cases, query]);
  const close = () => setModal(null);

  const pick = (ref: Reference) => {
    if (mode === "replace" && targetId) {
      replaceImage(targetId, ref);
      close();
      return;
    }
    setPicked((p) => (p.includes(ref.id) ? p.filter((x) => x !== ref.id) : [...p, ref.id]));
  };
  const chosen = picked.map((id) => refs.find((r) => r.id === id)!).filter(Boolean);

  return (
    <Modal
      title={mode === "replace" ? "이미지 교체" : "이미지 추가"}
      onClose={close}
      wide
      footer={
        mode === "add" ? (
          <>
            <span className="muted">{picked.length}개 선택</span>
            <Button
              disabled={!picked.length}
              onClick={() => {
                addRefsToPage(chosen, false);
                close();
              }}
            >
              자유 배치로 추가
            </Button>
            <Button
              variant="primary"
              disabled={!picked.length}
              onClick={() => {
                addRefsToPage(chosen, true);
                close();
              }}
            >
              자동 레이아웃에 추가
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="picker">
        <div className="row">
          <div className="search" style={{ flex: 1 }}>
            <Icon name="search" size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="키워드로 라이브러리 검색" autoFocus />
          </div>
          {mode === "add" && (
            <div className="row">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="또는 이미지 URL 직접 입력" style={{ width: 260 }} />
              <Button
                disabled={!/^https?:\/\//.test(url.trim())}
                onClick={() => {
                  addElement({ id: uid("i"), type: "image", src: url.trim(), fit: "cover", x: 200, y: 150, w: 240, h: 180, captionPos: "none" });
                  close();
                }}
              >
                추가
              </Button>
            </div>
          )}
        </div>
        <div className="picker-grid">
          {hits.map(({ ref }) => {
            const idx = picked.indexOf(ref.id);
            return (
              <button key={ref.id} className={"picker-item" + (idx >= 0 ? " on" : "")} onClick={() => pick(ref)} title={ref.title}>
                <SmartImage src={ref.thumbUrl ?? ref.imageUrl} fit={ref.kind === "logo" ? "contain" : "cover"} />
                {idx >= 0 && <span className="pick-num">{idx + 1}</span>}
                <span className="picker-cap ellipsis">{ref.title || ref.tags.join(", ")}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
