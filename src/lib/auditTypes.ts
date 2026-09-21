/**
 * auditTypes — 감사 로그 액션·대상 상수와 표시 라벨 (순수 상수, Prisma 없음)
 *
 * 왜 audit.ts 와 분리했나:
 *   audit.ts 는 Prisma 를 import 해 서버 전용이다. 감사 화면(클라이언트)이 필터 드롭다운 라벨을 자기
 *   파일에 따로 적어 두다 보니 새 액션을 추가할 때 두 곳을 고쳐야 했고, 결제 액션 5개가 화면에서
 *   빠져 있었다(2026-09-21). 이 파일 한 곳에 상수와 라벨을 두고 서버·화면이 같이 쓴다.
 *
 * 새 액션 추가 절차: AUDIT_ACTION_TYPES 에 코드, AUDIT_ACTION_LABEL 에 라벨 — 두 줄. 라벨을 빠뜨리면
 * 타입 에러가 난다(Record<AuditActionType, string>).
 */

export const AUDIT_ACTION_TYPES = [
  "SUPPORT_SESSION_OPEN",
  "SUPPORT_SESSION_END",
  "SUPPORT_SESSION_EXPIRE",
  "SUPPORT_SESSION_CLEANUP",   // 만료된 세션 일괄 정리 (관리자 버튼 실행)
  "SYSTEM_ROLE_GRANT",         // 시스템 관리자 임명
  "SYSTEM_ROLE_REVOKE",        // 시스템 관리자 해임 (+ 대상 활성 세션 일괄 종료)
  "USER_SUSPEND",
  "USER_UNSUSPEND",
  "USER_UNLOCK",
  "USER_FORCE_LOGOUT",
  "USER_MCP_KEYS_REVOKE",
  // 관리자가 회원 플랜·만료일을 수동 변경 (얼리 고객 BASIC, ENTERPRISE 부여 등).
  // memo 에 "[대상: email] FREE → BASIC(~2026-12-31) 사유" 형식으로 전후 값을 남긴다.
  "USER_PLAN_CHANGE",
  "PROJECT_TRANSFER_OWNER",
  // 어드민이 /admin/cleanup 에서 soft-deleted 프로젝트를 영구 삭제 실행한 기록.
  // memo 에 "executed=N (expired=E, retained=R)" 형식으로 처리량을 적재한다.
  "PROJECT_HARD_DELETE",
  "TEMPLATE_CREATE",
  "TEMPLATE_UPDATE",
  "TEMPLATE_DELETE",
  // 결제 운영 액션 (관리자 > 결제, 2026-09-21). memo 에 대상·전후 값·사유.
  // 돈이 움직이는 액션은 상태 변경과 같은 트랜잭션에 기록한다 (logAdminActionStrict).
  "BILLING_RETRY_CHARGE",      // PAST_DUE 구독 즉시 재결제 — PG 호출 전 "시도" 기록, 결과로 갱신
  "BILLING_DEFER_BILL_DATE",   // 다음 결제일 N일 연기 (보상)
  "BILLING_FORCE_TERMINATE",   // 구독 강제 종료 (CANCELED, 사유 ADMIN_TERMINATE)
  "BILLING_REFUND_RECORD",     // PG 콘솔 환불 뒤 이력 기록 (청약철회면 구독 종료 포함)
  "PROJECT_UNLOCK_BY_ADMIN",   // 결제 잠금 해제 대행 — 소유자 "활성화"와 같은 상한 판정
] as const;
export type AuditActionType = (typeof AUDIT_ACTION_TYPES)[number];

export const AUDIT_ACTION_LABEL: Record<AuditActionType, string> = {
  SUPPORT_SESSION_OPEN:     "지원 세션 시작",
  SUPPORT_SESSION_END:      "지원 세션 종료",
  SUPPORT_SESSION_EXPIRE:   "지원 세션 만료",
  SUPPORT_SESSION_CLEANUP:  "지원 세션 정리",
  SYSTEM_ROLE_GRANT:        "시스템 관리자 임명",
  SYSTEM_ROLE_REVOKE:       "시스템 관리자 해임",
  USER_SUSPEND:             "계정 정지",
  USER_UNSUSPEND:           "정지 해제",
  USER_UNLOCK:              "계정 잠금 해제",
  USER_FORCE_LOGOUT:        "전체 기기 로그아웃",
  USER_MCP_KEYS_REVOKE:     "MCP 키 일괄 폐기",
  USER_PLAN_CHANGE:         "플랜 수동 변경",
  PROJECT_TRANSFER_OWNER:   "소유권 이전",
  PROJECT_HARD_DELETE:      "프로젝트 영구 삭제",
  TEMPLATE_CREATE:          "템플릿 생성",
  TEMPLATE_UPDATE:          "템플릿 수정",
  TEMPLATE_DELETE:          "템플릿 삭제",
  BILLING_RETRY_CHARGE:     "결제 즉시 재시도",
  BILLING_DEFER_BILL_DATE:  "결제일 연기",
  BILLING_FORCE_TERMINATE:  "구독 강제 종료",
  BILLING_REFUND_RECORD:    "환불 기록",
  PROJECT_UNLOCK_BY_ADMIN:  "프로젝트 잠금 해제 대행",
};

export const AUDIT_TARGET_TYPES = ["PROJECT", "USER", "TEMPLATE", "SUBSCRIPTION", "PAYMENT"] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export const AUDIT_TARGET_LABEL: Record<AuditTargetType, string> = {
  PROJECT:      "프로젝트",
  USER:         "사용자",
  TEMPLATE:     "템플릿",
  SUBSCRIPTION: "구독",
  PAYMENT:      "결제",
};
