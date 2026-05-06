/**
 * GET /api/projects/[id]/events/recent — 최근 이벤트 10건 조회
 *
 * 역할:
 *   - 해당 프로젝트의 팀 액티비티 최신 10건 반환 (FID-00205)
 *   - tb_ds_design_change + tb_rq_requirement_history 통합 조회 후 시간순 정렬
 *   - StatusBar 이벤트 팝업 데이터 소스
 *
 * 보안 (2026-05-06 보강):
 *   - 인증·멤버십 가드 추가 (이전엔 익명 접근으로 다른 프로젝트 이벤트 노출 위험)
 *   - tbRqRequirementHistory 는 prjct_id 컬럼이 없으므로 먼저 해당 프로젝트의
 *     req_id 목록을 조회한 뒤 IN 절로 필터링 — 다른 프로젝트의 요구사항 이력
 *     본문(vrsn_coment_cn) 이 응답에 섞이는 것을 차단.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

// 이벤트 팝업에 표시할 최대 건수
const RECENT_EVENT_LIMIT = 10;

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  // Next.js 16: params는 Promise — await 필수
  const { id: projectId } = await params;

  // 인증 + 멤버십 + 읽기 권한 — 이 한 줄이 빠지면 익명 접근 가능
  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    // tb_rq_requirement_history 는 prjct_id 컬럼이 없으므로 먼저 해당 프로젝트의
    // req_id 만 골라낸 뒤 history 를 IN 절로 거른다.
    // 추가 round-trip 비용은 있지만 events/recent 는 호출 빈도가 낮아(StatusBar 팝업
    // 클릭 시) 영향 미미. 향후 prjct_id 컬럼 또는 @relation 을 추가하면
    // 단일 쿼리로 정리 가능.
    const reqIdRows = await prisma.tbRqRequirement.findMany({
      where:  { prjct_id: projectId },
      select: { req_id: true },
    });
    const reqIdsInProject = reqIdRows.map((r) => r.req_id);

    const [designChanges, reqHistories] = await Promise.all([
      prisma.tbDsDesignChange.findMany({
        where: { prjct_id: projectId },
        select: {
          chg_id:      true,
          chg_mber_id: true,
          chg_rsn_cn:  true,
          chg_dt:      true,
          ref_tbl_nm:  true,
        },
        orderBy: { chg_dt: "desc" },
        take: RECENT_EVENT_LIMIT,
      }),
      // 프로젝트의 요구사항이 0건이면 IN([]) 으로 결과 없음 — 안전한 기본값
      reqIdsInProject.length === 0
        ? Promise.resolve([] as Array<{
            req_hist_id:    string;
            chg_mber_id:    string | null;
            vrsn_coment_cn: string | null;
            creat_dt:       Date;
          }>)
        : prisma.tbRqRequirementHistory.findMany({
            where: { req_id: { in: reqIdsInProject } },
            select: {
              req_hist_id:    true,
              chg_mber_id:    true,
              vrsn_coment_cn: true,
              creat_dt:       true,
            },
            orderBy: { creat_dt: "desc" },
            take: RECENT_EVENT_LIMIT,
          }),
    ]);

    // 두 소스를 공통 형태로 변환 후 시간순 정렬, 상위 10건 슬라이싱
    const events = [
      ...designChanges.map((e) => ({
        id:       e.chg_id,
        actor_nm: e.chg_mber_id ?? "알 수 없음",
        content:  e.chg_rsn_cn ?? `${e.ref_tbl_nm} 설계 변경`,
        event_dt: e.chg_dt.toISOString(),
      })),
      ...reqHistories.map((e) => ({
        id:       e.req_hist_id,
        actor_nm: e.chg_mber_id ?? "알 수 없음",
        content:  e.vrsn_coment_cn ?? "요구사항 버전 업데이트",
        event_dt: e.creat_dt.toISOString(),
      })),
    ]
      .sort((a, b) => b.event_dt.localeCompare(a.event_dt))
      .slice(0, RECENT_EVENT_LIMIT);

    return NextResponse.json(apiSuccess(events));
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/events/recent] DB 오류:`, err);
    return NextResponse.json(
      apiError("DB_ERROR", "최근 이벤트 조회에 실패했습니다.", 500),
      { status: 500 }
    );
  }
}
