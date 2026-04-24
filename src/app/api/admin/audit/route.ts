/**
 * GET /api/admin/audit — 시스템 관리자 감사 로그 조회 (시스템 관리자 전용)
 *
 * 파라미터:
 *   ?adminMberId=<관리자 id>   (특정 관리자 필터)
 *   ?actionType=<SUPPORT_SESSION_OPEN 등>
 *   ?targetType=<PROJECT|USER|TEMPLATE>
 *   ?targetId=<엔티티 id>
 *   ?page=1&pageSize=50
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";

const PAGE_SIZE_MAX = 200;

export async function GET(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { searchParams } = new URL(request.url);
  const adminMberId = searchParams.get("adminMberId") ?? undefined;
  const actionType  = searchParams.get("actionType")  ?? undefined;
  const targetType  = searchParams.get("targetType")  ?? undefined;
  const targetId    = searchParams.get("targetId")    ?? undefined;
  const page        = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize    = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? "50", 10) || 50)
  );

  const where = {
    ...(adminMberId ? { admin_mber_id: adminMberId } : {}),
    ...(actionType  ? { action_type:   actionType  } : {}),
    ...(targetType  ? { target_type:   targetType  } : {}),
    ...(targetId    ? { target_id:     targetId    } : {}),
  };

  try {
    const [items, totalCount] = await Promise.all([
      prisma.tbSysAdminAudit.findMany({
        where,
        orderBy: { creat_dt: "desc" },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        select: {
          audit_id:      true,
          admin_mber_id: true,
          action_type:   true,
          target_type:   true,
          target_id:     true,
          memo:          true,
          ip_addr:       true,
          user_agent:    true,
          creat_dt:      true,
          admin: {
            select: { email_addr: true, mber_nm: true },
          },
        },
      }),
      prisma.tbSysAdminAudit.count({ where }),
    ]);

    return apiSuccess({
      items: items.map((a) => ({
        auditId:    a.audit_id,
        admin: {
          mberId: a.admin_mber_id,
          email:  a.admin.email_addr,
          name:   a.admin.mber_nm,
        },
        actionType: a.action_type,
        targetType: a.target_type,
        targetId:   a.target_id,
        memo:       a.memo,
        ipAddr:     a.ip_addr,
        userAgent:  a.user_agent,
        createdAt:  a.creat_dt.toISOString(),
      })),
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    });
  } catch (err) {
    console.error("[GET /api/admin/audit] DB 오류:", err);
    return apiError("DB_ERROR", "감사 로그 조회에 실패했습니다.", 500);
  }
}
