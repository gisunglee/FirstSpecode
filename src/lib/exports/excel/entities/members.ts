/**
 * 엑셀 다운로드 — 멤버 목록 (UW-00010, UW-00013)
 */

import type { ExcelColumn, ExportConfig } from "../types";
import { ROLE_LABEL, JOB_LABEL, isRoleCode, isJobCode } from "@/lib/permissions";
import {
  fetchProjectMembers,
  type MemberListItem,
} from "@/lib/exports/members-data";

// 컬럼 구성은 화면(members/page.tsx)에 보이는 필드만 그대로.
// last_acces_dt 는 스키마에는 있지만 갱신 로직이 없어 항상 비어 떨어짐 → 엑셀에서도 제외.
const columns: ExcelColumn<MemberListItem>[] = [
  { key: "name",  header: "이름",  width: 18,
    format: (r) => r.name ?? "" },
  { key: "email", header: "이메일", width: 28 },
  { key: "role",  header: "역할",  width: 12,
    format: (r) => (isRoleCode(r.role) ? ROLE_LABEL[r.role] : r.role) },
  { key: "job",   header: "직무",  width: 16,
    format: (r) => (isJobCode(r.job) ? JOB_LABEL[r.job] : r.job) },
  { key: "joinedAt", header: "가입일",  width: 18,
    format: (r) => r.joinedAt },
];

export const membersExportConfig: ExportConfig<MemberListItem, { id: string }> = {
  permission:   "content.export",
  resolveScope: (p) => ({ projectId: p.id }),
  sheetName:    "멤버 목록",
  entityKey:    "members",
  columns,
  fetchData: async ({ params }) => {
    return fetchProjectMembers({ projectId: params.id });
  },
};
