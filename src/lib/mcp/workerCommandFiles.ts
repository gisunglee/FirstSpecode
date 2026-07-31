/**
 * workerCommandFiles.ts — get_worker_command_files MCP 도구가 반환할 파일 콘텐츠
 *
 * 역할:
 *   - /run-ai-tasks 슬래시커맨드를 고객사 로컬 저장소에 "설치"할 수 있도록
 *     원본 커맨드와 결과·source snapshot·정합성 제출 helper를 그대로 읽어 반환
 *
 * 사본을 만들지 않고 fs로 원본을 직접 읽는 이유:
 *   내용을 문자열 상수로 복사해두면 커맨드 문서를 고칠 때마다 이 파일도
 *   같이 고쳐야 하고, 깜빡하면 고객에게 구버전이 나간다. 원본 하나만 두고
 *   요청 시점에 읽으면 항상 최신 상태가 보장된다.
 *
 * 배포 주의:
 *   Vercel 서버리스는 코드에서 import/require 하지 않는 파일은 빌드 트레이싱에서
 *   빠진다. 아래 파일들은 next.config.ts의 outputFileTracingIncludes로 명시
 *   포함시켜뒀다 — 경로를 바꾸면 그쪽도 같이 수정해야 함.
 */

import fs from "fs";
import path from "path";

const WORKER_COMMAND_FILE_PATHS = [
  ".claude/commands/run-ai-tasks.md",
  ".claude/commands/task_complete.mjs",
  ".claude/commands/source_snapshot.mjs",
  ".claude/commands/submit_implementation_receipt.mjs",
  ".claude/commands/sync-specode.md",
  ".claude/commands/prepare_specode_sync.mjs",
  ".claude/commands/submit_maintenance_receipt.mjs",
] as const;

export type WorkerCommandFile = { path: string; content: string };

/** 원본 커맨드 파일을 읽어 { path, content } 배열로 반환. path는 고객 로컬 프로젝트에 그대로 저장할 상대경로 */
export function getWorkerCommandFiles(): WorkerCommandFile[] {
  return WORKER_COMMAND_FILE_PATHS.map((relPath) => ({
    path:    relPath,
    // 파일 목록은 위 readonly 상수와 next.config tracing include로 고정돼 있다.
    // 동적 path로 오인해 프로젝트 전체를 trace하지 않도록 Turbopack에 경계를 알린다.
    content: fs.readFileSync(
      path.join(/* turbopackIgnore: true */ process.cwd(), relPath),
      "utf-8",
    ),
  }));
}

// 파일을 저장한 뒤 고객이 바로 이어서 해야 할 설정 — 도구 응답에 함께 실어 안내한다.
export const WORKER_COMMAND_SETUP_GUIDE = `
설치 후 설정:

1. 위 files 배열의 각 항목을 path 그대로 로컬 프로젝트 루트에 저장하세요.
   (예: files[0].path === ".claude/commands/run-ai-tasks.md" 라면
        {프로젝트 루트}/.claude/commands/run-ai-tasks.md 로 저장)

2. 프로젝트 루트의 .env.local 에 아래 두 값을 추가하세요.

   SPECODE_URL=https://www.specode.co.kr
   SPECODE_WORKER_KEY=spk_발급받은_워커키

   SPECODE_WORKER_KEY는 SPECODE 화면 → 우상단 프로필 → 설정 → MCP 키 관리에서
   "워커 (run-ai-tasks)" 용도로 새로 발급받아야 합니다. (지금 이 MCP 연결에 쓴
   키와는 다른 키 — 용도가 다르면 서버가 403으로 거부합니다.)

3. 설치가 끝나면 Claude Code 터미널에서 아래처럼 사용할 수 있습니다.

   /run-ai-tasks SPEC     — 구현(IMPLEMENT) 제외 전체 태스크 처리
   /run-ai-tasks IMP      — 구현(IMPLEMENT) 태스크만 처리
   /run-ai-tasks STATUS   — 처리 없이 본인 PENDING 큐 건수만 확인
   /sync-specode          — 마지막 정합성 확정점 이후 후속 수정 자동 제출
   /sync-specode UW-00036 — 지정 단위업무 하위를 우선 비교해 제출

   Node.js가 필요합니다. Python은 필요하지 않습니다.
   IMP는 source baseline이 섞이지 않도록 한 번에 구현 태스크 1건만 처리합니다.
   sync-specode는 미커밋 변경도 DRAFT로 분석하지만 baseline은 커밋/manifest 확정 후에만
   전진합니다.
`.trim();
