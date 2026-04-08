/**
 * diff-test/normalizer — MD 정규화 + SHA256 해시 계산
 *
 * 역할:
 *   - 공백 차이로 인한 false positive 변경 감지를 막기 위해 정규화
 *   - 정규화된 문자열 → SHA256 hash (변경 감지용)
 */

import crypto from "crypto";

/**
 * MD 텍스트 정규화
 * - 줄 단위 trim
 * - 빈 줄 압축 (연속된 빈 줄 → 1개)
 * - 끝 공백 제거
 */
export function normalize(md: string): string {
  return md
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 정규화된 문자열의 SHA256 해시 (hex, 64자)
 */
export function computeHash(normalized: string): string {
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

/**
 * raw MD → 정규화 + 해시 한 번에 계산
 */
export function hashOf(md: string): { normalized: string; hash: string } {
  const normalized = normalize(md);
  const hash = computeHash(normalized);
  return { normalized, hash };
}
