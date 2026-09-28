// 가장 먼저 실행되는 모듈 (다른 모듈이 import 시점에 환경변수를 읽기 때문에 첫 import 로 둔다)
import fs from "node:fs";

// .env 파일이 있으면 읽는다
if (fs.existsSync(".env")) process.loadEnvFile(".env");

// Node 내장 SQLite 의 '실험적 기능' 경고는 숨긴다 (동작에는 영향 없음)
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const msg = typeof warning === "string" ? warning : warning.message;
  if (/SQLite is an experimental feature/.test(msg)) return;
  return (emitWarning as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;
