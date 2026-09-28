/** 배포 원본과 고객 설치 경로의 단일 목록. 빌드 tracing도 이 목록을 사용한다. */
export const WORKER_COMMAND_BUNDLE_VERSION = "2.0.0";

const commandNames = [
  "specode.md", "specode_route.mjs",
  "run-ai-tasks.md", "review-uw.md", "sync-specode.md", "onboard-asis.md",
  "task_complete.mjs", "sync_specode.mjs", "spec_sync_local.mjs",
];
const workflowNames = ["run.md", "review.md", "sync.md", "onboard.md"];
const agentNames = [
  "prd-compliance-reviewer.md", "code-quality-reviewer.md", "ui-design-reviewer.md",
  "_shared/report-format.md", "_shared/severity-rules.md",
];

export const WORKER_COMMAND_FILES = [
  ...commandNames.map((name) => ({ source: `resources/specode/commands/${name}`, path: `.claude/commands/${name}` })),
  ...workflowNames.map((name) => ({ source: `resources/specode/workflows/${name}`, path: `.claude/specode-workflows/${name}` })),
  ...agentNames.map((name) => ({ source: `resources/specode/agents/${name}`, path: `.claude/agents/${name}` })),
];

/** SPECODE가 과거 배포한 파일만 대상으로 한다. 기존 공개 명령은 호환용으로 유지한다. */
export const WORKER_COMMAND_REMOVE_PATHS = [".claude/commands/validate_specode_sync.mjs"];

export const WORKER_COMMAND_TRACING_PATHS = WORKER_COMMAND_FILES.map(({ source }) => `./${source}`);
