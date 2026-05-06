/**
 * GET /api/projects/trash — 내가 OWNER 인 "삭제 예정" 프로젝트 목록
 *
 * 역할:
 *   삭제 후 복구가 가능한 동안(=hard_del_dt 미경과) OWNER 가
 *   "휴지통" 화면에서 자기 프로젝트를 다시 살릴 수 있게 한다.
 *
 *   일반 프로젝트 목록(/api/projects, /api/projects/my) 은 삭제 예정을
 *   숨기므로, OWNER 본인조차 별도 경로(=본 API) 가 없으면 복구 진입점이
 *   없어진다. 그래서 휴지통 전용 엔드포인트를 둔다.
 *
 * 노출 범위:
 *   - mber_sttus_code='ACTIVE' 인 OWNER 만 조회 가능 (DELETE 시 OWNER
 *     본인은 ACTIVE 유지되도록 설계됨)
 *   - del_yn='Y' AND hard_del_dt > now() 인 프로젝트만 — 보관 기간이 지난
 *     건은 더 이상 복구 불가이므로 노출하지 않는다.
 *
 *  SUPER_ADMIN 의 어드민 화면은 별도 경로(/api/admin/projects?delStatus=deleted)
 *  를 사용한다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const now = new Date();

    const memberships = await prisma.tbPjProjectMember.findMany({
      where: {
        mber_id:         auth.mberId,
        role_code:       "OWNER",
        mber_sttus_code: "ACTIVE",
        project: {
          del_yn:      "Y",
          // 아직 hard delete 가 도래하지 않은 것만 — 지난 건은 복구 불가
          hard_del_dt: { gt: now },
        },
      },
      include: {
        project: {
          select: {
            prjct_id:    true,
            prjct_nm:    true,
            client_nm:   true,
            del_dt:      true,
            hard_del_dt: true,
          },
        },
      },
      orderBy: {
        // 가장 최근에 삭제 요청한 것부터 (사용자 직관)
        project: { del_dt: "desc" },
      },
    });

    const items = memberships.map((m) => ({
      projectId:    m.project.prjct_id,
      name:         m.project.prjct_nm,
      clientName:   m.project.client_nm ?? null,
      deletedAt:    m.project.del_dt?.toISOString()      ?? null,
      hardDeleteAt: m.project.hard_del_dt?.toISOString() ?? null,
    }));

    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error("[GET /api/projects/trash] DB 오류:", err);
    return apiError("DB_ERROR", "삭제 예정 프로젝트 조회에 실패했습니다.", 500);
  }
}
