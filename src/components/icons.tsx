// 작은 라인 아이콘 세트 (24x24, stroke)
import type { SVGProps } from "react";

const paths: Record<string, string> = {
  cursor: "M5 3l14 8-6 2-2 6z",
  text: "M5 5h14M12 5v14M9 19h6",
  rect: "M4 6h16v12H4z",
  ellipse: "M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z",
  line: "M4 20L20 4",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5a1.5 1.5 0 1 0 0-.01",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  copy: "M8 8h12v12H8zM4 16V4h12",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  front: "M8 8h12v12H8zM4 4h12v4M4 4v12h4",
  back: "M4 4h12v12H4zM20 8v12H8",
  alignLeft: "M4 4v16M8 7h12v4H8zM8 14h7v4H8z",
  alignCenter: "M12 4v16M5 7h14v4H5zM8 14h8v4H8z",
  alignRight: "M20 4v16M4 7h12v4H4zM9 14h7v4H9z",
  alignTop: "M4 4h16M7 8h4v12H7zM14 8h4v7h-4z",
  alignMiddle: "M4 12h16M7 5h4v14H7zM14 8h4v8h-4z",
  alignBottom: "M4 20h16M7 4h4v12H7zM14 9h4v7h-4z",
  distH: "M4 4v16M20 4v16M10 7h4v10h-4z",
  distV: "M4 4h16M4 20h16M7 10h10v4H7z",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  play: "M7 4l13 8-13 8z",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  download: "M12 4v12M6 11l6 6 6-6M4 20h16",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  x: "M6 6l12 12M18 6L6 18",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  tag: "M3 12V4h8l10 10-8 8zM7.5 7.5h.01",
  folder: "M3 6h6l2 2h10v11H3z",
  file: "M6 3h8l5 5v13H6zM14 3v5h5",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  unlock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.5-2",
  shuffle: "M4 7h3l10 10h3M4 17h3l3-3M14 10l3-3h3M18 4l3 3-3 3M18 14l3 3-3 3",
  refresh: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  check: "M5 12l5 5 9-10",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
  printer: "M6 9V3h12v6M6 17H4v-7h16v7h-2M7 14h10v7H7z",
  fullscreen: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  chevronLeft: "M15 5l-7 7 7 7",
  chevronRight: "M9 5l7 7-7 7",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  swap: "M7 7h13l-4-4M17 17H4l4 4",
  upload: "M12 20V8M6 13l6-6 6 6M4 4h16",
  arrowRight: "M4 12h15M13 6l6 6-6 6",
  arrowDown: "M12 4v15M6 13l6 6 6-6",
  arrowLeft: "M20 12H5M11 6l-6 6 6 6",
  gap: "M4 5v14M20 5v14M9 12h6M9 9v6M15 9v6",
  padX: "M3 4v16M21 4v16M7 8h10v8H7z",
  padY: "M4 3h16M4 21h16M8 7h8v10H8z",
  fill: "M4 4h16v16H4zM4 4l16 16M20 4L4 20",
  fit: "M4 7h16v10H4zM9 4v16M15 4v16",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01",
  textLeft: "M4 6h16M4 10h10M4 14h16M4 18h10",
  sidebar: "M4 4h16v16H4zM9 4v16",
  heading: "M4 4h16v6H4zM4 14h16M4 18h10",
  pin: "M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}
