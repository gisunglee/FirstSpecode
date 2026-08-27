/**
 * dbTableStatus — DB 테이블 "상태"(신규/기존/데디케이트) 공용 상수
 *
 * 2차 사업처럼 스키마가 계속 바뀌는 프로젝트에서, 이 테이블이 이번에 새로 생긴 건지
 * 원래 있던 건지 곧 정리할 건지를 사람이 직접 표시해두는 값. 자동 분류 없음 — 전부 수동 지정.
 */

export const DB_TABLE_STATUS_CODES = ["NEW", "EXISTING", "DEPRECATED"] as const;
export type DbTableStatusCode = (typeof DB_TABLE_STATUS_CODES)[number];

export const DB_TABLE_STATUS_LABEL: Record<DbTableStatusCode, string> = {
  NEW:        "신규",
  EXISTING:   "기존",
  DEPRECATED: "데디케이트",
};

export function isDbTableStatusCode(v: unknown): v is DbTableStatusCode {
  return typeof v === "string" && (DB_TABLE_STATUS_CODES as readonly string[]).includes(v);
}
