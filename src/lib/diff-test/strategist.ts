/**
 * diff-test/strategist — 변경 모드 결정
 *
 * 역할:
 *   - 변동률에 따라 NO_CHANGE / DIFF / FULL / REPLACE 모드 결정
 *
 * 모드 기준:
 *   - NO_CHANGE: 변경 없음 (hash 동일)
 *   - DIFF:      변동률 < 20%   → 변경 부분만 diff 표시
 *   - FULL:      변동률 < 70%   → 전체 풀버전 표시
 *   - REPLACE:   변동률 >= 70%  → 완전 교체 (이전 버전 무시)
 */

import type { ChangeMode } from "./types";
import type { LineDiffStats } from "./differ";

export function decideMode(stats: LineDiffStats, hashChanged: boolean): ChangeMode {
  if (!hashChanged) return "NO_CHANGE";
  if (stats.lineRatio < 0.2) return "DIFF";
  if (stats.lineRatio < 0.7) return "FULL";
  return "REPLACE";
}
