/**
 * 동기화 snapshot과 적용 충돌 검사용 SHA-256 함수.
 *
 * exact hash는 원문을 정규화하지 않는다. 공백 변경도 다른 현재 값으로 취급해야
 * 승인 뒤 전체 필드를 덮어쓸 때 사용자의 편집을 잃지 않는다.
 */

import crypto from "node:crypto";

export function hashExactText(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashCanonicalValue(value: unknown): string {
  return hashExactText(stableStringify(value));
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}
