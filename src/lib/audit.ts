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

// 액션·대상 상수와 라벨은 순수 파일(auditTypes.ts)에 — 감사 화면(클라이언트)도 같은 것을 쓴다.
export {
  AUDIT_ACTION_TYPES, AUDIT_TARGET_TYPES, AUDIT_ACTION_LABEL, AUDIT_TARGET_LABEL,
  type AuditActionType, type AuditTargetType,
} from "@/lib/auditTypes";
import type { AuditActionType, AuditTargetType } from "@/lib/auditTypes";
import type { Prisma, PrismaClient } from "@prisma/client";

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

/**
 * 감사 로그 기록 — **실패하면 throw** 하는 판. 돈이 움직이는 관리자 액션(환불 기록·강제 종료·결제일 연기·
 * 잠금 해제 대행)은 상태 변경과 같은 트랜잭션에서 이 함수를 불러, 감사 행이 안 남으면 변경도 롤백되게 한다.
 * PG 를 호출하는 액션(즉시 재결제)은 호출 전에 이 함수로 "시도" 행을 만들고 결과로 memo 를 갱신한다.
 * 반환: audit_id
 */
export async function logAdminActionStrict(
  db: PrismaClient | Prisma.TransactionClient,
  input: LogAdminActionInput,
): Promise<string> {
  const row = await db.tbSysAdminAudit.create({
    data: {
      admin_mber_id: input.adminMberId,
      action_type:   input.actionType,
      target_type:   input.targetType ?? null,
      target_id:     input.targetId   ?? null,
      memo:          input.memo       ?? null,
      ip_addr:       input.ipAddr     ?? null,
      user_agent:    input.userAgent  ?? null,
    },
    select: { audit_id: true },
  });
  return row.audit_id;
}
