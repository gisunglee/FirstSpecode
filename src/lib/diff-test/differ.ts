/**
 * diff-test/differ — 라인 단위 diff + 통계 계산
 *
 * 역할:
 *   - before/after MD를 라인 단위로 비교
 *   - 추가/삭제/유지 라인 수 통계 산출
 *   - 변동률 계산 (changed / total)
 *
 * 주요 기술:
 *   - 외부 라이브러리 없이 LCS 기반 간단 구현
 *   - jsdiff 도입은 Phase 5에서 (현재는 통계만 필요)
 */

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
