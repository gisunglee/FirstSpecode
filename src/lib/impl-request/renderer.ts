/**
 * impl-request/renderer — 구현요청 전용 프롬프트 렌더러
 *
 * 역할:
 *   - collector가 수집한 4계층 LayerInfo를 기반으로 AI 프롬프트 생성
 *   - diff-test에서 검증된 원본 형식을 그대로 유지
 *     - 순수 마크다운 (XML 태그 미사용)
 *     - 풀버전은 ```markdown 펜스로 감싸서 설계 내용과 프롬프트 구조를 명확히 구분
 *     - 계층 헤더는 ## H2 + 약어(UW/PID/AR/FID)
 *     - 하단 ⛔ 금지선 블록 포함
 *
 * 구조:
 *   # PRD_CHANGE — 구현요청
 *   ## AI 작업 지침
 *   ---
 *   ## UW — 단위업무
 *   **모드:** `DIFF` · **변동률:** 6.1% ...
 *   ### 현재 풀버전 (변경 후)
 *   ```markdown ... ```
 *   ### 변경 부분 (DIFF)
 *   ```diff ... ```
 *   ---
 *   ## ⛔ 금지선
 */

import { buildUnifiedPatch } from "./diff/differ";
import type { LayerInfo } from "./collector";

/** 계층 타입 → 약어 (프롬프트 헤더용) */
const LAYER_ABBR: Record<string, string> = {
  unit_work: "UW",
  screen:    "PID",
  area:      "AR",
  function:  "FID",
};

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

  // ── 최상단 제목 ──
  lines.push("# PRD_CHANGE — 구현요청");
  lines.push("");

  // ── AI 작업 지침 ──
  lines.push("## AI 작업 지침");
  lines.push("");
  lines.push("- 아래는 4계층 스펙(UW/PID/AR/FID)의 변경 사항입니다.");
  lines.push("- 각 노드는 변경 모드(NO_CHANGE/DIFF/FULL/REPLACE)에 따라 다르게 표시됩니다.");
  lines.push("- 변경된 노드만 작업 대상으로 삼고, NO_CHANGE 노드는 컨텍스트 참고용입니다.");
  lines.push("");
  lines.push("### 변경 모드별 작업 지침");
  lines.push("");
  lines.push("- `NO_CHANGE`: 변경 없음 — 컨텍스트 참고만 하세요. 이 부분은 수정하지 마세요.");
  lines.push("- `DIFF`: 일부 변경 — 변경 부분(diff 블록)을 확인하고 해당 부분만 반영하세요.");
  lines.push("- `FULL`: 많은 변경 — 풀버전을 기준으로 전체적으로 반영하세요.");
  lines.push("- `REPLACE`: 완전 교체 — 이전 구현을 무시하고 새로 구현하세요.");
  lines.push("- `신규`: 최초 요청 — 전체 내용 기반으로 새로 구현하세요.");
  lines.push("");
  lines.push("### diff 블록 표기 규칙");
  lines.push("");
  lines.push("- `- [삭제]` 로 시작하는 줄: 이전 버전에서 **삭제된** 줄");
  lines.push("- `+ [추가]` 로 시작하는 줄: 새 버전에 **추가된** 줄");
  lines.push("- 공백으로 시작하는 줄(라벨 없음): 변경 없는 **컨텍스트** (위아래 3줄)");
  lines.push("- `@@ 섹션: ... @@` : 변경이 발생한 마크다운 섹션의 위치");
  lines.push("- `@@ -X,Y +A,B @@` : git unified diff 형식의 라인 위치 정보");
  lines.push("");

  // ── 사용자 코멘트 ──
  if (comentCn?.trim()) {
    lines.push("### 추가 지시사항");
    lines.push("");
    lines.push(comentCn.trim());
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  // ── 계층별 렌더링 ──
  for (const layer of layers) {
    lines.push(renderLayer(layer));
    lines.push("");
  }

  // ── 금지선 ──
  lines.push("## ⛔ 금지선");
  lines.push("");
  lines.push("- 위 변경 사항 외의 다른 영역은 수정하지 마세요.");
  lines.push("- NO_CHANGE 노드는 참고용입니다 (수정 금지).");

  return lines.join("\n");
}

/**
 * 단일 계층 렌더링
 * - ## H2 헤더 + 약어 (UW/PID/AR/FID)
 * - 모드 정보 볼드+코드 강조
 * - 풀버전은 ```markdown 펜스로 감싸서 설계 내용과 프롬프트 구조 구분
 * - 변경 블록은 ```diff 펜스
 */
function renderLayer(layer: LayerInfo): string {
  const lines: string[] = [];
  const abbr = LAYER_ABBR[layer.type] ?? layer.type;
  const label = LAYER_LABELS[layer.type] ?? layer.type;
  const modeLabel = !layer.hasSnapshot ? "신규" : layer.mode;

  // ── 계층 헤더 — ## H2 + displayId ──
  lines.push(`## ${abbr}(${layer.displayId}) — ${label}`);
  lines.push("");

  // ── 모드 정보 ──
  if (layer.mode === "NO_CHANGE") {
    lines.push(`**모드:** \`${modeLabel}\` · 변경 없음`);
  } else {
    const ratio = (layer.lineRatio * 100).toFixed(1);
    lines.push(`**모드:** \`${modeLabel}\` · **변동률:** ${ratio}% · 추가 ${layer.stats.added} · 삭제 ${layer.stats.removed} · 유지 ${layer.stats.kept}`);
  }
  lines.push("");

  // ── 풀버전 — ````markdown 펜스로 감싸기 ──
  // 설계 내용 자체에 ``` 코드블록이 포함될 수 있으므로
  // 외부 펜스는 백틱 4개(````)로 감싸서 내부 ```과 충돌 방지
  if (layer.mode === "NO_CHANGE") {
    // NO_CHANGE는 컨텍스트 참고용이므로 간략하게 표시
    lines.push("### 현재 내용 (컨텍스트 참고용)");
    lines.push("");
    lines.push("````markdown");
    lines.push(layer.currentDc.trim() || "(내용 없음)");
    lines.push("````");
  } else {
    lines.push("### 현재 풀버전 (변경 후)");
    lines.push("");
    lines.push("````markdown");
    lines.push(layer.currentDc.trim() || "(내용 없음)");
    lines.push("````");
  }
  lines.push("");

  // ── 변경 블록 (NO_CHANGE 제외) ──
  if (layer.mode !== "NO_CHANGE" && layer.previousDc) {
    const patch = buildUnifiedPatch(layer.type, layer.previousDc, layer.currentDc);
    const labeled = addKoreanLabels(patch);

    if (layer.mode === "FULL" || layer.mode === "REPLACE") {
      // FULL/REPLACE — 변동량 많음 안내
      lines.push(`### 변경 부분 (${modeLabel})`);
      lines.push("");
      lines.push("변동량이 많아 변경 부분을 별도로 표시합니다. 위 풀버전을 기준으로 작업하세요.");
    } else {
      // DIFF — 직전 버전과의 차이
      lines.push(`### 변경 부분 (${modeLabel})`);
      lines.push("");
      lines.push("아래는 직전 버전과의 차이점입니다. `@@ 섹션: ... @@` 라인은 변경이 발생한 위치를 표시합니다.");
    }
    lines.push("");
    lines.push("````diff");
    lines.push(labeled);
    lines.push("````");
    lines.push("");
  }

  // 신규 (이전 스냅샷 없음) — diff 블록 없이 풀버전만 표시
  if (!layer.hasSnapshot && layer.mode !== "NO_CHANGE") {
    // 이미 풀버전이 위에 표시되었으므로 안내만 추가
    lines.push("> 최초 요청 — 이전 스냅샷이 없으므로 전체 내용 기반으로 작업하세요.");
    lines.push("");
  }

  lines.push("---");

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
