/**
 * diff-test/differ — 라인 단위 diff + 통계 계산 + unified patch 생성
 *
 * 역할:
 *   - diffLines: 추가/삭제/유지 통계 산출 (변동률 계산용)
 *   - buildUnifiedPatch: jsdiff createPatch 기반 git unified diff 생성
 *     + 각 hunk 헤더 앞에 "@@ 섹션: ... @@" 주입 (AI 위치 파악용)
 *
 * 주요 기술:
 *   - jsdiff (`diff` 패키지) — git unified diff 생성
 *   - 섹션 헤더 = 가장 가까운 상위 markdown heading 또는 **bold** 단독 라인
 */

import { createPatch } from "diff";
import { DIFF_CONTEXT_LINES } from "./constants";

export type LineDiffStats = {
  added: number;     // 새로 추가된 라인 수
  removed: number;   // 삭제된 라인 수
  kept: number;      // 양쪽에 동일하게 존재하는 라인 수
  totalBefore: number;
  totalAfter: number;
  /** 변동률 = (added + removed) / max(totalBefore, totalAfter, 1) */
  lineRatio: number;
};

/**
 * 라인 기반 diff — 단순 set 비교 (순서 무시 X, 단순 카운트)
 *
 * 정확한 LCS는 Phase 5에서 jsdiff로 대체.
 * 현재는 변경 감지/모드 결정용 통계만 필요하므로 충분.
 */
export function diffLines(beforeMd: string, afterMd: string): LineDiffStats {
  const beforeLines = beforeMd.split("\n").filter((l) => l.trim().length > 0);
  const afterLines = afterMd.split("\n").filter((l) => l.trim().length > 0);

  // 빈도 맵으로 카운트 — 같은 라인이 여러 번 나오면 각각 매칭
  const beforeMap = new Map<string, number>();
  beforeLines.forEach((l) => beforeMap.set(l, (beforeMap.get(l) ?? 0) + 1));

  let kept = 0;
  const afterMapRemain = new Map<string, number>(beforeMap);

  for (const line of afterLines) {
    const cnt = afterMapRemain.get(line) ?? 0;
    if (cnt > 0) {
      kept += 1;
      afterMapRemain.set(line, cnt - 1);
    }
  }

  const added = afterLines.length - kept;
  const removed = beforeLines.length - kept;
  const total = Math.max(beforeLines.length, afterLines.length, 1);
  const lineRatio = (added + removed) / total;

  return {
    added,
    removed,
    kept,
    totalBefore: beforeLines.length,
    totalAfter: afterLines.length,
    lineRatio: Math.min(lineRatio, 1),
  };
}

// ── unified diff + 섹션 헤더 주입 ────────────────────────────────────────────

/**
 * raw MD에서 주어진 라인 번호의 "가장 가까운 상위 섹션 헤더"를 찾는다.
 *
 * 섹션 헤더 후보:
 *   1. 마크다운 헤딩 (#, ##, ###, ...)
 *   2. 볼드 라벨 단독 라인 (**텍스트**)
 *
 * @param rawMd 전체 MD 문자열
 * @param targetLineNo 1-indexed 라인 번호
 * @returns 찾은 헤더 텍스트 (없으면 '(루트)')
 */
function findNearestSectionHeader(rawMd: string, targetLineNo: number): string {
  const lines = rawMd.split("\n");

  // targetLineNo는 1-indexed, 배열은 0-indexed
  for (let i = targetLineNo - 1; i >= 0; i--) {
    // trim() 안 함 — 정규식이 prefix(인용블록 등)를 직접 처리
    const line = lines[i] ?? "";

    // 마크다운 헤딩 — 인용블록(>) prefix 허용
    // 매칭: "## 제목", "> ## 제목", ">## 제목" 모두 인식
    const headingMatch = line.match(/^>?\s*(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) return headingMatch[2].trim();

    // 볼드 라벨 단독 라인 — trim 후 매칭 (인용블록 안에는 없다고 가정)
    const boldMatch = line.trim().match(/^\*\*(.+?)\*\*\s*$/);
    if (boldMatch) return boldMatch[1].trim();
  }

  return "(루트)";
}

/**
 * createPatch 결과의 각 hunk 헤더(@@ -X,Y +A,B @@) 앞에
 * "@@ 섹션: <찾은 헤더> @@" 라인을 주입한다.
 *
 * 핵심: hunk의 시작 라인(컨텍스트 포함)이 아닌, 첫 번째 실제 변경(+) 라인의
 * 위치로 역추적해야 정확한 섹션 헤더를 찾는다.
 * 예) 컨텍스트 3줄이 이전 표의 마지막 행이고, 변경은 **처리 로직** 아래에 있을 때
 *     시작 라인으로 역추적하면 **Output** 을 잡지만,
 *     첫 + 라인으로 역추적하면 **처리 로직** 을 정확히 잡는다.
 */
function injectSectionHeaders(patchText: string, afterRawMd: string): string {
  const patchLines = patchText.split("\n");
  const result: string[] = [];

  for (let i = 0; i < patchLines.length; i++) {
    const line = patchLines[i];
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);

    if (hunkMatch) {
      const newStartLine = parseInt(hunkMatch[1], 10);

      // hunk 내부를 스캔하여 첫 번째 + 라인의 실제 라인 번호 계산
      // (context 라인은 new file 기준으로 +1, 삭제(-) 라인은 카운트 안 함)
      let lineOffset = 0;
      let firstChangeLineNo = newStartLine; // fallback
      for (let j = i + 1; j < patchLines.length; j++) {
        const pl = patchLines[j];
        if (pl.startsWith("@@") || pl === "\\ No newline at end of file") break;
        if (pl.startsWith("+")) {
          firstChangeLineNo = newStartLine + lineOffset;
          break;
        }
        if (pl.startsWith("-")) continue;  // 삭제 라인은 new file에 없음
        lineOffset++;  // context 라인 (" " prefix)
      }

      const sectionHeader = findNearestSectionHeader(afterRawMd, firstChangeLineNo);
      result.push(`@@ 섹션: ${sectionHeader} @@`);
      result.push(line);
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

/**
 * createPatch + injectSectionHeaders 결과를 한 단계 더 정밀화한다.
 *
 * 한 hunk 안에서 변경 라인(+/-)을 순회하며, 각 변경 라인의 "현재 라인 번호"를
 * 추적하여 소속 섹션이 바뀌는 지점마다 @@ 섹션: ... @@ 라인을 추가로 주입한다.
 *
 * 알고리즘:
 *   1. 패치 텍스트를 줄 단위로 순회
 *   2. hunk 헤더(@@ -X,Y +A,B @@)를 만나면 newLineCursor = A 로 초기화
 *   3. 변경/유지 라인을 만날 때마다:
 *      - 공백 시작(컨텍스트) → newLineCursor++
 *      - + 시작(추가) → 섹션 확인, 바뀌면 헤더 주입. newLineCursor++
 *      - - 시작(삭제) → 섹션은 현재 cursor 기준으로 판단. cursor 변경 없음
 */
function injectSectionHeadersInline(
  patchText: string,
  beforeRawMd: string,
  afterRawMd: string
): string {
  const lines = patchText.split("\n");
  const result: string[] = [];

  let oldLineCursor = 0;        // Before 기준 현재 라인 번호 (1-indexed)
  let newLineCursor = 0;        // After 기준 현재 라인 번호 (1-indexed)
  let lastInjectedHeader = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 섹션 헤더 라인 (@@ 섹션: ... @@) → 그대로 출력, lastInjectedHeader 갱신
    const sectionMatch = line.match(/^@@ 섹션: (.+) @@$/);
    if (sectionMatch) {
      result.push(line);
      lastInjectedHeader = sectionMatch[1];
      continue;
    }

    // hunk 헤더 라인 → cursor 두 개 모두 초기화
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      oldLineCursor = parseInt(hunkMatch[1], 10);
      newLineCursor = parseInt(hunkMatch[2], 10);
      result.push(line);
      continue;
    }

    // 추가 라인 (+ 시작, +++ 제외) → afterRawMd에서 섹션 찾기
    if (line.startsWith("+") && !line.startsWith("+++")) {
      const currentSection = findNearestSectionHeader(afterRawMd, newLineCursor);
      if (currentSection !== lastInjectedHeader) {
        result.push(`@@ 섹션: ${currentSection} @@`);
        lastInjectedHeader = currentSection;
      }
      result.push(line);
      newLineCursor++;
      // oldLineCursor는 증가 안 함 (before에 없는 라인)
      continue;
    }

    // 삭제 라인 (- 시작, --- 제외) → beforeRawMd에서 섹션 찾기
    if (line.startsWith("-") && !line.startsWith("---")) {
      // 핵심: 삭제 라인은 before 기준으로 섹션을 찾는다
      const currentSection = findNearestSectionHeader(beforeRawMd, oldLineCursor);
      if (currentSection !== lastInjectedHeader) {
        result.push(`@@ 섹션: ${currentSection} @@`);
        lastInjectedHeader = currentSection;
      }
      result.push(line);
      oldLineCursor++;
      // newLineCursor는 증가 안 함 (after에 없는 라인)
      continue;
    }

    // 컨텍스트 라인 (공백 시작) → 양쪽 cursor 모두 증가
    if (line.startsWith(" ")) {
      result.push(line);
      oldLineCursor++;
      newLineCursor++;
      continue;
    }

    // 그 외 (빈 라인, "\ No newline" 등)
    result.push(line);
  }

  return result.join("\n");
}

/**
 * before/after MD로 git unified diff 생성 + 섹션 헤더 주입 (2단계)
 *
 * @param nodeType 파일명 자리 (표시용, 'UW' 등)
 * @param beforeRawMd 이전 raw MD
 * @param afterRawMd 현재 raw MD
 * @returns 섹션 헤더가 주입된 unified diff 문자열
 */
export function buildUnifiedPatch(nodeType: string, beforeRawMd: string, afterRawMd: string): string {
  // 1. createPatch로 unified diff 생성
  const patch = createPatch(nodeType, beforeRawMd, afterRawMd, "", "", { context: DIFF_CONTEXT_LINES });

  // 2. 첫 4줄(Index, ===, ---, +++) 제거
  const cleanedPatch = patch.split("\n").slice(4).join("\n");

  // 3. 1차: hunk 시작 기준 섹션 헤더 주입
  const withHunkHeaders = injectSectionHeaders(cleanedPatch, afterRawMd);

  // 4. 2차: hunk 내부에서 섹션이 바뀌는 지점마다 추가 헤더 주입
  //    삭제 라인은 beforeRawMd 기준, 추가 라인은 afterRawMd 기준으로 섹션 탐색
  return injectSectionHeadersInline(withHunkHeaders, beforeRawMd, afterRawMd);
}
