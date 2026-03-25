/**
 * api.ts — API 공통 타입 정의
 *
 * 역할:
 *   - API Route 응답 구조의 TypeScript 타입
 *   - 클라이언트에서 apiFetch 호출 시 타입 안전성 보장
 */

// ─── 성공 응답 ────────────────────────────────────────────────────────────────
export type ApiSuccess<T> = {
  data: T;
};

// ─── 에러 응답 ────────────────────────────────────────────────────────────────
export type ApiErrorResponse = {
  code: string;
  message: string;
};

// ─── 페이지네이션 ──────────────────────────────────────────────────────────────
export type Pagination = {
  page:       number;
  pageSize:   number;
  total:      number;
  totalPages: number;
};

// ─── 목록 응답 (페이지네이션 포함) ────────────────────────────────────────────
export type PagedResponse<T> = {
  data:       T[];
  pagination: Pagination;
};
