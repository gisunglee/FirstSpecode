/**
 * diff-test/renderer — PRD_CHANGE.md 생성
 *
 * 역할:
 *   - 4계층 노드의 before/after + 변경 모드를 받아서 단일 MD 문자열 생성
 *   - 계층형 인터리브: UW → PID → AR → FID 순서로 풀버전 + 변경 블록
 *
 * 주요 기술:
 *   - 외부 템플릿 엔진 없이 단순 문자열 빌더 (Phase 5에서 eta로 교체 가능)
 */

import type { NodeType, ChangeMode } from "./types";
import { buildUnifiedPatch, type LineDiffStats } from "./differ";

export type NodeRenderInput = {
  type: NodeType;
  label: string;             // "단위업무" 등
  beforeMd: string;
  afterMd: string;
  mode: ChangeMode;
  stats: LineDiffStats;
};

export type RenderInput = {
  targetTestSn: number;
  baseTestSn: number | null;
  sjNm: string | null;
  nodes: NodeRenderInput[];  // UW, PID, AR, FID 순서
};

const NODE_LABEL: Record<NodeType, string> = {
  UW: "단위업무",
  PID: "화면",
  AR: "영역",
  FID: "기능",
};

export function render(input: RenderInput): string {
  const lines: string[] = [];

  // ── 헤더 ──
  lines.push(`# PRD_CHANGE — Master #${input.targetTestSn}` +
    (input.baseTestSn != null ? ` vs #${input.baseTestSn}` : " (최초)"));
  lines.push("");
  if (input.sjNm) {
    lines.push(`> ${input.sjNm}`);
    lines.push("");
  }

  // ── AI 작업 지침 ──
  lines.push("## AI 작업 지침");
  lines.push("");
  lines.push("- 아래는 4계층 스펙(UW/PID/AR/FID)의 변경 사항입니다.");
  lines.push("- 각 노드는 변경 모드(NO_CHANGE/DIFF/FULL/REPLACE)에 따라 다르게 표시됩니다.");
  lines.push("- 변경된 노드만 작업 대상으로 삼고, NO_CHANGE 노드는 컨텍스트 참고용입니다.");
  lines.push("");
  lines.push("### diff 블록 표기 규칙");
  lines.push("");
  lines.push("- `- [삭제]` 로 시작하는 줄: 이전 버전에서 **삭제된** 줄");
  lines.push("- `+ [추가]` 로 시작하는 줄: 새 버전에 **추가된** 줄");
  lines.push("- 공백으로 시작하는 줄(라벨 없음): 변경 없는 **컨텍스트** (위아래 3줄)");
  lines.push("- `@@ 섹션: ... @@` : 변경이 발생한 마크다운 섹션의 위치");
  lines.push("- `@@ -X,Y +A,B @@` : git unified diff 형식의 라인 위치 정보");
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── 노드별 블록 ──
  for (const node of input.nodes) {
    lines.push(renderNode(node));
    lines.push("");
  }

  // ── 푸터 (금지선) ──
  lines.push("---");
  lines.push("");
  lines.push("## ⛔ 금지선");
  lines.push("");
  lines.push("- 위 변경 사항 외의 다른 영역은 수정하지 마세요.");
  lines.push("- NO_CHANGE 노드는 참고용입니다 (수정 금지).");

  return lines.join("\n");
}

function renderNode(n: NodeRenderInput): string {
  const lines: string[] = [];
  const label = NODE_LABEL[n.type];

  lines.push(`## ${n.type} — ${label}`);
  lines.push("");
  lines.push(`**모드:** \`${n.mode}\` · **변동률:** ${(n.stats.lineRatio * 100).toFixed(1)}% · ` +
    `추가 ${n.stats.added} · 삭제 ${n.stats.removed} · 유지 ${n.stats.kept}`);
  lines.push("");

  // ── 1단계: 풀버전 (모든 모드 공통, raw_md_cn 그대로) ──
  // 원본 무결성 보장 — parsed_json 재조립 금지, n.afterMd는 raw 그대로
  lines.push("### 현재 풀버전 (변경 후)");
  lines.push("");
  lines.push("```markdown");
  lines.push(n.afterMd);
  lines.push("```");
  lines.push("");

  // ── 2단계: 변경 블록 (NO_CHANGE 제외) ──
  if (n.mode === "NO_CHANGE") {
    lines.push("> ✅ 변경 없음 — 위 내용은 컨텍스트 참고용입니다.");
    return lines.join("\n");
  }

  // DIFF/FULL/REPLACE 공통 — git unified diff + 섹션 헤더 주입 + 한국어 라벨
  const rawPatch = buildUnifiedPatch(n.type, n.beforeMd, n.afterMd);
  const patch = addKoreanLabels(rawPatch);

  if (n.mode === "DIFF") {
    lines.push("### 변경 부분 (DIFF)");
    lines.push("");
    lines.push("아래는 직전 버전과의 차이점입니다. `@@ 섹션: ... @@` 라인은 변경이 발생한 위치를 표시합니다.");
    lines.push("");
    lines.push("```diff");
    lines.push(patch);
    lines.push("```");
  } else if (n.mode === "FULL") {
    lines.push("### 변경 부분 (FULL)");
    lines.push("");
    lines.push("변동량이 많아 변경 부분을 별도로 표시합니다. 위 풀버전을 기준으로 작업하세요.");
    lines.push("");
    lines.push("```diff");
    lines.push(patch);
    lines.push("```");
  } else if (n.mode === "REPLACE") {
    lines.push("### ⚠ 완전 교체 (REPLACE)");
    lines.push("");
    lines.push("> 이전 버전과 70% 이상 다릅니다. 이전 버전을 무시하고 위 풀버전으로 완전 대체합니다.");
    lines.push("");
    lines.push("**이전 버전과의 차이 (참고용)**");
    lines.push("");
    lines.push("```diff");
    lines.push(patch);
    lines.push("```");
  }

  return lines.join("\n");
}

/**
 * diff 텍스트의 변경 라인에 한국어 라벨을 추가한다.
 *
 * 변환 규칙:
 *   - `-` 로 시작 (단, `---` 제외) → `- [삭제] 원본내용`
 *   - `+` 로 시작 (단, `+++` 제외) → `+ [추가] 원본내용`
 *   - 그 외 라인(컨텍스트, @@, 빈 줄)은 그대로
 */
function addKoreanLabels(patchText: string): string {
  const lines = patchText.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    // 파일 헤더 보호
    if (line.startsWith("---") || line.startsWith("+++")) { result.push(line); continue; }
    // hunk/섹션 헤더 보호
    if (line.startsWith("@@")) { result.push(line); continue; }
    // 삭제 라인
    if (line.startsWith("-")) { result.push(`- [삭제]${line.substring(1)}`); continue; }
    // 추가 라인
    if (line.startsWith("+")) { result.push(`+ [추가]${line.substring(1)}`); continue; }
    // 그 외 (컨텍스트, 빈 줄)
    result.push(line);
  }

  return result.join("\n");
}
