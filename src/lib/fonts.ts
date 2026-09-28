// 문서에서 쓸 수 있는 폰트 — index.html 에서 웹폰트로 불러온다.
// 목록에 없는 이름을 입력하면 설치된 시스템 폰트로 시도한다.

export const FONT_FAMILIES: { name: string; stack: string; note: string }[] = [
  { name: "Pretendard", stack: "'Pretendard Variable', Pretendard", note: "한글 산세리프" },
  { name: "Noto Sans KR", stack: "'Noto Sans KR'", note: "한글 산세리프" },
  { name: "IBM Plex Sans KR", stack: "'IBM Plex Sans KR'", note: "한글 산세리프" },
  { name: "Noto Serif KR", stack: "'Noto Serif KR'", note: "한글 세리프" },
  { name: "Poppins", stack: "Poppins", note: "영문 지오메트릭" },
  { name: "Inter", stack: "Inter", note: "영문 산세리프" },
  { name: "Montserrat", stack: "Montserrat", note: "영문 디스플레이" },
  { name: "Playfair Display", stack: "'Playfair Display'", note: "영문 세리프" },
];

const FALLBACK = "'Pretendard Variable', Pretendard, 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

export function fontStack(name?: string): string {
  if (!name) return FALLBACK;
  const known = FONT_FAMILIES.find((f) => f.name === name);
  const head = known ? known.stack : `'${name.replace(/'/g, "")}'`;
  return `${head}, ${FALLBACK}`;
}

export const FONT_WEIGHTS = [
  { value: 200, label: "ExtraLight 200" },
  { value: 300, label: "Light 300" },
  { value: 400, label: "Regular 400" },
  { value: 500, label: "Medium 500" },
  { value: 600, label: "SemiBold 600" },
  { value: 700, label: "Bold 700" },
  { value: 800, label: "ExtraBold 800" },
  { value: 900, label: "Black 900" },
];
