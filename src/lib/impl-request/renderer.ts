/**
 * impl-request/renderer — 구현요청 전용 프롬프트 렌더러
 *
 * 역할:
 *   - collector가 수집한 4계층 LayerInfo를 기반으로 AI 프롬프트 생성
 *   - 각 계층별 변경 모드(NO_CHANGE/DIFF/FULL/REPLACE)에 따라 차등 렌더링
 *   - diff-test에서 검증된 구조/태그/라벨 방식을 그대로 적용
 *     - 풀버전 항상 포함 (AI가 전체 맥락 파악 가능)
 *     - 변경된 계층은 unified diff + 섹션 헤더 + 한국어 라벨
 *     - NO_CHANGE 계층은 컨텍스트 참고용 안내
 *
 * 구조:
 *   <impl_request>
 *     <request_prompt>구현 지시사항</request_prompt>
 *     <instruction>사용자 코멘트</instruction>
 *     ---
 *     > 단위업무: UW-00019 ...   [모드]
 *     > 화면: PID-00040 ...       [모드]
 *     > 영역: AR-00059 ...        [모드]
 *     > 기능: FN-00193 ...        [모드 + diff]
 *   </impl_request>
 */

import { buildUnifiedPatch } from "./diff/differ";
import type { LayerInfo } from "./collector";

/** 계층 타입 → 한글명 */
const LAYER_LABELS: Record<string, string> = {
  unit_work: "단위업무",
  screen:    "화면",
  area:      "영역",
  function:  "기능",
};

/**
 * 4계층 LayerInfo 배열로 구현요청 프롬프트 생성
 *
 * @param layers collector.collectLayers() 결과
 * @param comentCn 사용자 AI 지시사항 (선택)
 * @returns 프롬프트 마크다운 문자열
 */
export function renderImplPrompt(layers: LayerInfo[], comentCn?: string): string {
  const lines: string[] = [];

  lines.push("<impl_request>");
  lines.push("");

  // ── 요청 프롬프트 ──
  lines.push("<request_prompt>");
  lines.push("당신은 소프트웨어 구현 전문가입니다.");
  lines.push("아래 4계층 설계서(단위업무 → 화면 → 영역 → 기능)를 기반으로 구현하세요.");
  lines.push("");
  lines.push("## 변경 모드별 작업 지침");
  lines.push("- `NO_CHANGE`: 변경 없음 — 컨텍스트 참고만 하세요. 이 부분은 수정하지 마세요.");
  lines.push("- `DIFF`: 일부 변경 — 변경 부분(diff 블록)을 확인하고 해당 부분만 반영하세요.");
  lines.push("- `FULL`: 많은 변경 — 풀버전을 기준으로 전체적으로 반영하세요.");
  lines.push("- `REPLACE`: 완전 교체 — 이전 구현을 무시하고 새로 구현하세요.");
  lines.push("- `신규`: 최초 요청 — 전체 내용 기반으로 새로 구현하세요.");
  lines.push("");
  lines.push("## diff 블록 표기 규칙");
  lines.push("- `- [삭제]` 로 시작하는 줄: 이전 버전에서 삭제된 줄");
  lines.push("- `+ [추가]` 로 시작하는 줄: 새 버전에 추가된 줄");
  lines.push("- 공백으로 시작하는 줄: 변경 없는 컨텍스트 (위아래 3줄)");
  lines.push("- `@@ 섹션: ... @@`: 변경이 발생한 마크다운 섹션 위치");
  lines.push("</request_prompt>");
  lines.push("");

  // ── 사용자 코멘트 ──
  if (comentCn?.trim()) {
    lines.push("<instruction>");
    lines.push(comentCn.trim());
    lines.push("</instruction>");
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  // ── 계층별 렌더링 ──
  for (const layer of layers) {
    lines.push(renderLayer(layer));
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push("</impl_request>");

  return lines.join("\n");
}

/**
 * 단일 계층 렌더링
 * - 인용 블록으로 계층 라벨 표시
 * - 모드에 따라 풀버전 + diff 블록 차등 출력
 */
function renderLayer(layer: LayerInfo): string {
  const lines: string[] = [];
  const label = LAYER_LABELS[layer.type] ?? layer.type;
  const modeLabel = !layer.hasSnapshot ? "신규" : layer.mode;

  // 계층 헤더 — 인용 블록
  lines.push(`> ${label}: ${layer.displayId} ${layer.name}`);
  lines.push("");

  // 모드 표시
  if (layer.mode === "NO_CHANGE") {
    lines.push(`[${modeLabel} — 컨텍스트 참고용]`);
  } else {
    const ratio = (layer.lineRatio * 100).toFixed(0);
    lines.push(`[${modeLabel} — 변동률 ${ratio}% · 추가 ${layer.stats.added} · 삭제 ${layer.stats.removed} · 유지 ${layer.stats.kept}]`);
  }
  lines.push("");

  // 풀버전 (모든 모드 공통)
  if (layer.currentDc.trim()) {
    lines.push(layer.currentDc);
  } else {
    lines.push("(내용 없음)");
  }
  lines.push("");

  // 변경 블록 (NO_CHANGE 제외)
  if (layer.mode !== "NO_CHANGE" && layer.previousDc) {
    const patch = buildUnifiedPatch(layer.type, layer.previousDc, layer.currentDc);
    const labeled = addKoreanLabels(patch);

    lines.push("[변경 부분]");
    lines.push("```diff");
    lines.push(labeled);
    lines.push("```");
  }

  return lines.join("\n");
}

/**
 * diff 텍스트에 한국어 라벨 추가
 * - `-` → `- [삭제]`
 * - `+` → `+ [추가]`
 * - `@@`, `---`, `+++` 헤더는 보호
 */
function addKoreanLabels(patchText: string): string {
  return patchText
    .split("\n")
    .map((line) => {
      if (line.startsWith("---") || line.startsWith("+++")) return line;
      if (line.startsWith("@@")) return line;
      if (line.startsWith("-")) return `- [삭제]${line.substring(1)}`;
      if (line.startsWith("+")) return `+ [추가]${line.substring(1)}`;
      return line;
    })
    .join("\n");
}
