/**
 * GET /api/admin/projects — 전체 프로젝트 목록 (시스템 관리자 전용)
 *
 * 파라미터:
 *   ?search=<프로젝트명/고객사명 부분 일치>
 *   ?page=1&pageSize=50
 *
 * 각 프로젝트의 OWNER 멤버·멤버 수·최근 수정일을 함께 반환 — 지원 세션 판단용.
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
  const searchRaw = searchParams.get("search")?.trim() ?? "";
  const page      = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize  = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? "50", 10) || 50)
  );

  const search = searchRaw.slice(0, 100);

  const where = search
    ? {
        OR: [
          { prjct_nm:  { contains: search, mode: "insensitive" as const } },
          { client_nm: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  try {
    const [items, totalCount] = await Promise.all([
      prisma.tbPjProject.findMany({
        where,
        select: {
          prjct_id:  true,
          prjct_nm:  true,
          client_nm: true,
          creat_dt:  true,
          mdfcn_dt:  true,
          members: {
            where: {
              role_code:       "OWNER",
              mber_sttus_code: "ACTIVE",
            },
            select: {
              member: { select: { mber_id: true, email_addr: true, mber_nm: true } },
            },
            take: 1, // 소유자 1명만 표시 (복수 OWNER 는 상세 페이지에서)
          },
          _count: {
            select: {
              members: {
                where: { mber_sttus_code: "ACTIVE" },
              },
            },
          },
        },
        orderBy: { mdfcn_dt: "desc" },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
      }),
      prisma.tbPjProject.count({ where }),
    ]);

    return apiSuccess({
      items: items.map((p) => ({
        projectId:    p.prjct_id,
        name:         p.prjct_nm,
        clientName:   p.client_nm,
        createdAt:    p.creat_dt.toISOString(),
        modifiedAt:   p.mdfcn_dt?.toISOString() ?? null,
        owner:        p.members[0]?.member
          ? {
              mberId: p.members[0].member.mber_id,
              email:  p.members[0].member.email_addr,
              name:   p.members[0].member.mber_nm,
            }
          : null,
        activeMemberCount: p._count.members,
      })),
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    });
  } catch (err) {
    console.error("[GET /api/admin/projects] DB 오류:", err);
    return apiError("DB_ERROR", "프로젝트 목록 조회에 실패했습니다.", 500);
  }
}
