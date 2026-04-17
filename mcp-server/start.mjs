/**
 * start.mjs — MCP 서버 디버깅 래퍼
 * 모든 stderr를 로그 파일에 기록하고, 에러 발생 시 원인을 남김
 */
import { writeFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const logFile = resolve(__dirname, "mcp-debug.log");

// 로그 초기화
writeFileSync(logFile, `[${new Date().toISOString()}] MCP server starting...\n`);
appendFileSync(logFile, `  cwd: ${process.cwd()}\n`);
appendFileSync(logFile, `  __dirname: ${__dirname}\n`);
appendFileSync(logFile, `  node: ${process.version}\n`);
appendFileSync(logFile, `  argv: ${JSON.stringify(process.argv)}\n`);
appendFileSync(logFile, `  env.PATH: ${process.env.PATH?.substring(0, 200)}\n`);

// uncaught 에러 잡기
process.on("uncaughtException", (err) => {
  appendFileSync(logFile, `[${new Date().toISOString()}] UNCAUGHT: ${err.stack}\n`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  appendFileSync(logFile, `[${new Date().toISOString()}] UNHANDLED: ${reason}\n`);
  process.exit(1);
});

try {
  appendFileSync(logFile, `[${new Date().toISOString()}] importing dist/stdio.js...\n`);
  await import("./dist/stdio.js");
  appendFileSync(logFile, `[${new Date().toISOString()}] server connected OK\n`);
} catch (err) {
  appendFileSync(logFile, `[${new Date().toISOString()}] IMPORT ERROR: ${err.stack}\n`);
  process.exit(1);
}
