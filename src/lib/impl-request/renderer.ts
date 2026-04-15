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
 * 4계층 LayerInfo 배열로 구현요청 본문 생성 (구현요청서 내용)
 *
 * 주의: AI 작업 지침/변경 모드/diff 규칙은 tb_ai_prompt_template에 저장된 시스템 프롬프트로 주입되고,
 *       사용자 코멘트는 submit API에서 `<코멘트>` 블록으로 별도 래핑됩니다.
 *       이 함수는 `<구현요청서>` 내부에 들어갈 계층 본문만 생성합니다.
 *
 * @param layers collector.collectLayers() 결과
 * @returns 계층 본문 마크다운 문자열 (UW/PID/AR/FID ~ 금지선 X)
 */
export function renderImplPrompt(layers: LayerInfo[]): string {
  const lines: string[] = [];

  // ── 계층별 렌더링만 (시스템 프롬프트는 submit API에서 tb_ai_prompt_template로 주입) ──
  for (const layer of layers) {
    lines.push(renderLayer(layer));
    lines.push("");
  }

  return lines.join("\n").trim();
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
