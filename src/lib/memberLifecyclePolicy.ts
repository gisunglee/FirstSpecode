/** 사용자 계정과 시스템 관리자 역할의 수명주기 불변식. */

/**
 * 탈퇴 회원의 표시 이름. 탈퇴 시 mber_nm 을 이 값으로 덮어써 개인식별정보를 지운다.
 * 옛 회원이 만든 요구사항·메모 등의 작성자 칸에 이 이름이 보인다.
 */
export const WITHDRAWN_MEMBER_NAME = "탈퇴회원";

export function isSystemAdminWithdrawalBlocked(systemRole: unknown): boolean {
  return systemRole === "SUPER_ADMIN";
}

export function canGrantSystemAdmin(memberStatus: unknown): boolean {
  return memberStatus === "ACTIVE";
}

export function canChangeSuspension(systemRole: unknown): boolean {
  return systemRole !== "SUPER_ADMIN";
}
