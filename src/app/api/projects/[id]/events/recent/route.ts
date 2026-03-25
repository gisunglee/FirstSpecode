/**
 * GET /api/projects/[id]/events/recent — 최근 이벤트 10건 조회
 *
 * 역할:
 *   - 해당 프로젝트의 팀 액티비티 최신 10건 반환 (FID-00205)
 *   - tb_ds_design_change + tb_rq_requirement_history 통합 조회 후 시간순 정렬
 *   - StatusBar 이벤트 팝업 데이터 소스
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";

// 이벤트 팝업에 표시할 최대 건수
const RECENT_EVENT_LIMIT = 10;

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  // Next.js 16: params는 Promise — await 필수
  const { id: prjct_id } = await params;

  if (!prjct_id) {
    return NextResponse.json(
      apiError("VALIDATION_ERROR", "프로젝트 ID가 필요합니다.", 400),
      { status: 400 }
    );
  }

  try {
    // 설계 변경 이벤트와 요구사항 이력 이벤트를 병렬 조회 후 통합
    const [designChanges, reqHistories] = await Promise.all([
      prisma.tbDsDesignChange.findMany({
        where: { prjct_id },
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
      prisma.tbRqRequirementHistory.findMany({
        where: { req_id: { not: "" } }, // req_id 기반 필터는 추후 프로젝트 연결 후 교체
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
    console.error(`[GET /api/projects/${prjct_id}/events/recent] DB 오류:`, err);
    return NextResponse.json(
      apiError("DB_ERROR", "최근 이벤트 조회에 실패했습니다.", 500),
      { status: 500 }
    );
  }
}
