/**
 * GET /api/admin/users — 전체 사용자 목록 (시스템 관리자 전용)
 *
 * 파라미터:
 *   ?search=<이메일 또는 이름 부분 일치>
 *   ?status=<mber_sttus_code 필터>   (ACTIVE | UNVERIFIED | SUSPENDED | WITHDRAWN)
 *   ?page=1&pageSize=50              (기본 50)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";

// 한 번에 로드 가능한 최대 개수 — 더 큰 쿼리는 인위적으로 제한
const PAGE_SIZE_MAX = 200;

export async function GET(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { searchParams } = new URL(request.url);
  const searchRaw = searchParams.get("search")?.trim() ?? "";
  const status    = searchParams.get("status")?.trim() ?? "";
  const page      = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize  = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? "50", 10) || 50)
  );

  // 검색어 이스케이프 — Prisma contains 는 LIKE 이므로 %, _ 를 그대로 넣으면 오작동.
  // 사용자 입력 검색은 부분일치만 필요하니 정상문자만 대상.
  const search = searchRaw.slice(0, 100);

  const where = {
    ...(status ? { mber_sttus_code: status } : {}),
    ...(search
      ? {
          OR: [
            { email_addr: { contains: search, mode: "insensitive" as const } },
            { mber_nm:    { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  try {
    const [items, totalCount] = await Promise.all([
      prisma.tbCmMember.findMany({
        where,
        select: {
          mber_id:         true,
          email_addr:      true,
          mber_nm:         true,
          plan_code:       true,
          mber_sttus_code: true,
          sys_role_code:   true,
          join_dt:         true,
          wthdrw_dt:       true,
          _count: {
            select: { projectMembers: true },
          },
        },
        orderBy: { join_dt: "desc" },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
      }),
      prisma.tbCmMember.count({ where }),
    ]);

    return apiSuccess({
      items: items.map((m) => ({
        mberId:         m.mber_id,
        email:          m.email_addr,
        name:           m.mber_nm,
        plan:           m.plan_code,
        status:         m.mber_sttus_code,
        isSystemAdmin:  m.sys_role_code === "SUPER_ADMIN",
        joinedAt:       m.join_dt.toISOString(),
        withdrawnAt:    m.wthdrw_dt?.toISOString() ?? null,
        projectCount:   m._count.projectMembers,
      })),
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    });
  } catch (err) {
    console.error("[GET /api/admin/users] DB 오류:", err);
    return apiError("DB_ERROR", "사용자 목록 조회에 실패했습니다.", 500);
  }
}
