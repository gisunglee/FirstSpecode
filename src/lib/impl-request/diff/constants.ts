/**
 * diff-test/constants — Diff Prompt Test 설정값 상수
 *
 * 역할:
 *   - 변경 모드 결정 임계값, diff 컨텍스트 줄 수, 목록 크기 등
 *   - 비즈니스 로직에 사용되는 매직 넘버를 한 곳에서 관리
 */

/** DIFF 모드 임계값 — 변동률이 이 값 미만이면 DIFF (변경 부분만 표시) */
export const DIFF_RATIO_THRESHOLD = 0.2;

/** REPLACE 모드 임계값 — 변동률이 이 값 이상이면 REPLACE (완전 교체) */
export const REPLACE_RATIO_THRESHOLD = 0.7;

/** unified diff 생성 시 변경 라인 위아래 컨텍스트 줄 수 (git 기본값 3) */
export const DIFF_CONTEXT_LINES = 3;

/** master 목록 조회 시 최대 건수 */
export const MAX_LIST_SIZE = 50;
