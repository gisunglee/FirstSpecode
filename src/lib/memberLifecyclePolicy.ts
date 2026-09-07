/** 사용자 계정과 시스템 관리자 역할의 수명주기 불변식. */

export function isSystemAdminWithdrawalBlocked(systemRole: unknown): boolean {
  return systemRole === "SUPER_ADMIN";
}

export function canGrantSystemAdmin(memberStatus: unknown): boolean {
  return memberStatus === "ACTIVE";
}

export function canChangeSuspension(systemRole: unknown): boolean {
  return systemRole !== "SUPER_ADMIN";
}
