#!/usr/bin/env node
/** 공개 커맨드 인자를 검증한다. 파일 변경·환경변수 읽기·서버 호출은 하지 않는다. */
import { pathToFileURL } from "node:url";

const COMMANDS = new Set(["work", "dev", "status", "review", "sync", "onboard"]);
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function parseSpecodeArgs(tokens) {
  if (tokens.length === 0 || (tokens.length === 1 && ["help", "--help"].includes(tokens[0]))) {
    return { kind: "help" };
  }
  const [command, ...args] = tokens;
  const invalid = { kind: "help", command: COMMANDS.has(command) ? command : undefined, error: "인자를 확인하세요." };
  if (!COMMANDS.has(command)) return invalid;
  if (args.length === 1 && ["help", "--help"].includes(args[0])) return { kind: "help", command };
  if (command === "work") {
    if (args.length === 0) return { kind: "run", workflow: "run", args: ["SPEC"] };
    if (args.length === 1 && TASK_ID.test(args[0])) return { kind: "run", workflow: "run", args: ["TASK", args[0]] };
    return invalid;
  }
  if (["dev", "status", "onboard"].includes(command)) {
    if (args.length !== 0) return invalid;
    if (command === "onboard") return { kind: "run", workflow: "onboard", args: [] };
    return { kind: "run", workflow: "run", args: [command === "dev" ? "IMP" : "STATUS"] };
  }
  // UW는 하나만 허용한다. 번호 축약도 동일한 대상 ID로 정규화한다.
  const [rawUw, ...options] = args;
  const uw = /^\d{1,5}$/.test(rawUw ?? "") ? `UW-${rawUw.padStart(5, "0")}` : rawUw;
  if (!/^UW-\d{5}$/.test(uw ?? "") || uw === "UW-00000") return invalid;
  if (command === "review" && options.length !== 0) return invalid;
  if (command === "sync" && !(options.length === 0 || (options.length === 1 && options[0] === "--deep"))) return invalid;
  return { kind: "run", workflow: command, args: [uw, ...options] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(parseSpecodeArgs(process.argv.slice(2))));
}
