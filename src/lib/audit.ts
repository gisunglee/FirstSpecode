/**
 * audit — 시스템 관리자 행동 감사 로그 헬퍼
 *
 * 역할:
 *   - tb_sys_admin_audit 에 행동 기록을 남기는 얇은 래퍼
 *   - 호출부가 try/catch 없이 쓸 수 있도록 내부에서 에러를 삼킴
 *     (로그 실패가 원래 API 응답을 막으면 안 됨)
 *
 * 사용법:
 *   await logAdminAction({
 *     adminMberId: gate.mberId,
 *     actionType:  "SUPPORT_SESSION_OPEN",
 *     targetType:  "PROJECT",
 *     targetId:    projectId,
 *     memo:        body.memo,
 *     ipAddr:      gate.ipAddr,
 *     userAgent:   gate.userAgent,
 *   });
 *
 * 설계 근거:
 *   - action_type 은 enum 이 아닌 문자열로 관리 — 감사 대상이 자주 추가되고
 *     DB 마이그레이션 비용이 비싸기 때문. 허용 값은 AUDIT_ACTION_TYPES 상수.
 *   - 기록 실패 시 error 로그만 남기고 throw 하지 않음 — 본 API 응답 보호.
 */

import { prisma } from "@/lib/prisma";

/**
 * 감사 액션 타입 — 새 액션을 추가하려면 여기 추가하고 호출부에서 사용.
 * 허용 값만 저장되도록 은근히 강제.
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
  "PROJECT_TRANSFER_OWNER",
  "TEMPLATE_CREATE",
  "TEMPLATE_UPDATE",
  "TEMPLATE_DELETE",
] as const;
export type AuditActionType = (typeof AUDIT_ACTION_TYPES)[number];

export const AUDIT_TARGET_TYPES = ["PROJECT", "USER", "TEMPLATE"] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export type LogAdminActionInput = {
  adminMberId: string;
  actionType:  AuditActionType;
  targetType?: AuditTargetType | null;
  targetId?:   string | null;
  memo?:       string | null;
  ipAddr?:     string | null;
  userAgent?:  string | null;
};

/**
 * 감사 로그 기록. 실패해도 throw 하지 않음 (본 응답을 막지 않도록).
 */
export async function logAdminAction(input: LogAdminActionInput): Promise<void> {
  try {
    await prisma.tbSysAdminAudit.create({
      data: {
        admin_mber_id: input.adminMberId,
        action_type:   input.actionType,
        target_type:   input.targetType ?? null,
        target_id:     input.targetId   ?? null,
        memo:          input.memo       ?? null,
        ip_addr:       input.ipAddr     ?? null,
        user_agent:    input.userAgent  ?? null,
      },
    });
  } catch (err) {
    // 감사 로그 실패는 조용히 error 로만 남긴다 — 본 API 응답을 막으면 안 됨.
    // 정말 중요한 경우(예: SUPPORT_SESSION_OPEN)에는 호출부에서 직접 응답 실패로 취급할 것.
    console.error("[logAdminAction] 감사 로그 기록 실패:", err, input);
  }
}
