/** 서버가 계산한 핵심 스펙 항목별 쓰기 권한. UI는 자체 추정 대신 이 값을 우선한다. */
export type SpecContentPermissions = {
  canEdit: boolean;
  canDelete: boolean;
  grant: "MANAGER" | "ASSIGNEE" | "CREATOR_WINDOW" | null;
  reasonCode: string | null;
  reasonMessage: string | null;
  creatorWindowExpiresAt: string | null;
};
