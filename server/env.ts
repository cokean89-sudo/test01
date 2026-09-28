// .env 파일이 있으면 가장 먼저 읽는다 (다른 모듈이 import 시점에 환경변수를 읽기 때문에 첫 import 로 둔다)
import fs from "node:fs";

if (fs.existsSync(".env")) process.loadEnvFile(".env");
