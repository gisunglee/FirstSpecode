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
  ".claude/commands/sync_specode.mjs",
  ".claude/commands/spec_sync_local.mjs",
  ".claude/commands/onboard-asis.md",
  ".claude/commands/review-uw.md",
  ".claude/agents/prd-compliance-reviewer.md",
  ".claude/agents/code-quality-reviewer.md",
  ".claude/agents/ui-design-reviewer.md",
  ".claude/agents/_shared/report-format.md",
  ".claude/agents/_shared/severity-rules.md",
] as const;

/** 재설치 때만 제거할 폐기된 SPECODE 배포 파일. 이 목록 밖의 고객 파일은 건드리지 않는다. */
export const WORKER_COMMAND_REMOVE_PATHS = [
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
2. removePaths 배열의 파일이 기존 설치에 남아 있으면 해당 파일만 삭제합니다.
3. .env.local에 다음 값을 설정합니다.

   SPECODE_URL=https://www.specode.co.kr
   SPECODE_WORKER_KEY=spk_발급받은_워커키

4. Claude Code에서 다음처럼 사용합니다.

   /run-ai-tasks SPEC
   /run-ai-tasks IMP
   /run-ai-tasks STATUS
   /sync-specode UW-00036
   /onboard-asis
   /review-uw UW-00036

/sync-specode는 프로젝트 범위 WORKER 키의 프로젝트명·ID를 먼저 보여주고 확인받습니다.
Git 기준선 없이 현재 UW 설계와 현재 관련 소스를 비교하며, 정상 항목은 건수만 남기고
문제와 수정안만 제출합니다. 기본 CHECK를 권장하며 실제 설계 반영은 웹에서 사람이 승인합니다.

/onboard-asis는 2차 사업(기존 시스템 위 증축) 프로젝트에서, 1차 시스템 소스를 분석해
단위업무/화면/영역/기능/DB 테이블을 SPECODE에 등록합니다. 대량 작업이라 시간이 걸리며,
단계마다 확인을 받으며 진행합니다.

/review-uw는 SPECODE 서버의 현재 설계와 표준 가이드(공통 설계 > 표준 가이드)를 기준으로
특정 UW 구현 품질을 검토합니다. PRD 준수 관점은 항상 검토하고, 코드 품질·UI 디자인
관점은 해당 프로젝트에 등록된 표준 가이드가 있을 때만 검토합니다. 로컬 파일이나 사용자
확인 질문이 필요 없습니다 — SPECODE 웹의 공통 설계 > 표준 가이드에 UI/코드 품질 관련
문서를 등록해두면 실행할 때마다 자동으로 반영되고, 등록된 게 없으면 그 관점만 조용히
건너뜁니다. 서버에는 아무것도 저장하지 않는 즉석 리포트입니다.
`.trim();
