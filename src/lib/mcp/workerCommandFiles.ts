/**
 * 고객 저장소에 설치할 Claude Code 명령 파일의 단일 목록.
 * 요청 시 원본을 읽으므로 배포본과 저장소 명령이 서로 어긋나지 않는다.
 */

import fs from "fs";
import path from "path";

const WORKER_COMMAND_FILE_PATHS = [
  ".claude/commands/run-ai-tasks.md",
  ".claude/commands/task_complete.mjs",
  ".claude/commands/sync-specode.md",
  ".claude/commands/validate_specode_sync.mjs",
] as const;

export type WorkerCommandFile = { path: string; content: string };

export function getWorkerCommandFiles(): WorkerCommandFile[] {
  return WORKER_COMMAND_FILE_PATHS.map((relativePath) => ({
    path: relativePath,
    content: fs.readFileSync(
      path.join(/* turbopackIgnore: true */ process.cwd(), relativePath),
      "utf-8",
    ),
  }));
}

export const WORKER_COMMAND_SETUP_GUIDE = `
설치 후 설정:

1. files 배열의 각 항목을 path 그대로 고객 저장소 루트에 저장합니다.
2. .env.local에 다음 값을 설정합니다.

   SPECODE_URL=https://www.specode.co.kr
   SPECODE_WORKER_KEY=spk_발급받은_워커키

3. Claude Code에서 다음처럼 사용합니다.

   /run-ai-tasks SPEC
   /run-ai-tasks IMP
   /run-ai-tasks STATUS
   /sync-specode UW-00036

/sync-specode는 Git 기준선 없이 현재 UW 설계와 현재 관련 소스를 비교합니다.
기본 CHECK를 권장하며, 분석 결과의 실제 설계 반영은 SPECODE 웹에서 사람이 승인합니다.
`.trim();
