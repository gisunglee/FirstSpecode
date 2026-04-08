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
import type { LineDiffStats } from "./differ";

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

  if (n.mode === "NO_CHANGE") {
    lines.push("> 변경 없음 (참고용 풀버전)");
    lines.push("");
    lines.push("```markdown");
    lines.push(n.afterMd);
    lines.push("```");
  } else if (n.mode === "DIFF") {
    lines.push("### 변경 부분 (DIFF)");
    lines.push("");
    lines.push("```diff");
    lines.push(simpleDiff(n.beforeMd, n.afterMd));
    lines.push("```");
  } else if (n.mode === "FULL") {
    lines.push("### 변경 후 풀버전 (FULL)");
    lines.push("");
    lines.push("```markdown");
    lines.push(n.afterMd);
    lines.push("```");
  } else if (n.mode === "REPLACE") {
    lines.push("### 완전 교체 (REPLACE)");
    lines.push("");
    lines.push("> 이전 버전과 70% 이상 다릅니다. 이전 버전을 무시하고 아래로 완전 대체.");
    lines.push("");
    lines.push("```markdown");
    lines.push(n.afterMd);
    lines.push("```");
  }

  return lines.join("\n");
}

/**
 * 라인 단위 단순 diff (+, -, 공백 prefix)
 * jsdiff 도입 전 임시 구현 — 정확하지 않을 수 있으나 가독성 위주
 */
function simpleDiff(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);

  const out: string[] = [];
  // 삭제된 라인
  for (const l of beforeLines) {
    if (!afterSet.has(l)) out.push(`- ${l}`);
  }
  // 추가된 라인
  for (const l of afterLines) {
    if (!beforeSet.has(l)) out.push(`+ ${l}`);
  }
  return out.join("\n");
}
