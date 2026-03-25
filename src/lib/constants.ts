/**
 * constants — 애플리케이션 전역 상수
 *
 * 역할:
 *   - 마법 숫자/문자열 제거 (변경 시 이 파일 하나만 수정)
 *   - 비즈니스 규칙을 코드로 명문화
 *
 * 원칙:
 *   - 숫자나 문자열 리터럴을 코드에 직접 쓰지 말 것
 *   - 의도가 불명확한 값은 반드시 이름 있는 상수로 선언
 */

// ─── 페이지네이션 ──────────────────────────────────────────────────────────────
// 목록 페이지당 기본 표시 개수
export const PAGE_SIZE_DEFAULT = 20;

// ─── 논리삭제 ──────────────────────────────────────────────────────────────────
// DB에서 실제로 삭제하지 않고 useYn 컬럼으로 논리삭제 처리
// 목록 조회 시 반드시 useYn: "Y" 필터를 포함해야 함
export const USE_YN = {
  ACTIVE:  "Y",
  DELETED: "N",
} as const;

// ─── HTTP 상태 코드 ────────────────────────────────────────────────────────────
export const HTTP_STATUS = {
  OK:                  200,
  CREATED:             201,
  BAD_REQUEST:         400,
  UNAUTHORIZED:        401,
  FORBIDDEN:           403,
  NOT_FOUND:           404,
  INTERNAL_SERVER_ERROR: 500,
} as const;

// ─── API 에러 코드 ─────────────────────────────────────────────────────────────
// 클라이언트에서 에러 종류별 분기 처리에 사용
export const API_ERROR_CODE = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND:        "NOT_FOUND",
  UNAUTHORIZED:     "UNAUTHORIZED",
  FORBIDDEN:        "FORBIDDEN",
  INTERNAL_ERROR:   "INTERNAL_ERROR",
} as const;
