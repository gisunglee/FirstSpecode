/**
 * GET /api/projects/[id]/dashboard/manage-summary
 *   — 관리자 대시보드 요약 (1차 카드 3종 통합 조회)
 *
 * 역할:
 *   - 카드 3개에 필요한 데이터를 한 번의 라운드트립으로 모아서 반환
 *     1) progress      — 단위업무 진행률 집계 (전체/완료/평균%)
 *     2) stalled       — 마감 지났는데 미완료(progrs_rt < 100) 단위업무 + Top 5
 *     3) recentChanges — 설계 변경 이력 최신 5건
 *
 * 왜 통합 엔드포인트인가:
 *   - 첫 페이지 진입 시 카드별 3개 HTTP 호출 → 1회로 줄여 LCP 단축.
 *   - 동일 권한 가드를 3번 평가하지 않으므로 DB 부하·코드 중복도 감소.
 *
 * 권한:
 *   - content.read — VIEWER 이상 통과 (관리뷰는 OWNER/ADMIN/PM/PL 자동 분기,
 *     일반 멤버가 URL 직접 접근해도 읽기는 허용. UI 토글로 보호.)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import type { ManageSummaryResponse } from "@/types/dashboard";

type RouteParams = { params: Promise<{ id: string }> };

// 정체된 일 / 최근 변경 카드는 본문에 미리보기를 보여주므로 5건만 노출.
// 카운트는 별도 집계 쿼리로 정확히 가져온다.
const PREVIEW_LIMIT = 5;

// 응답 타입은 src/types/dashboard.ts 의 ManageSummaryResponse 를 그대로 사용.
// (클라이언트 카드 컴포넌트가 같은 타입을 import 해서 단일 진실원 유지)

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    // 오늘 날짜 (YYYY-MM-DD) — end_de 가 text 컬럼이므로 문자열 비교
    // 시간 부분은 비교에 의미 없으므로 자정 기준 ISO 날짜만 사용.
    const todayStr = new Date().toISOString().slice(0, 10);

    // 최근 7일 시점 (팀 활동 카드용)
    // ⚠️ "팀 활동" 의 정의는 현재 tb_ds_design_change 이벤트만 카운트.
    // 진행률 변경·코멘트·검토 응답 등은 미포함이라 실제 활동량보다 보수적이다.
    // 트래킹 범위 확장은 별도 활동 로그 테이블 도입이 필요해 후속 과제로 둠.
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // 이번 달 시작 시점 (AI 사용 카드용) — UTC 1일 0시 기준.
    // ⚠️ KST 와 9시간 차이가 있어 월초/월말 9시간은 실제 한국 시간의 전월/현월 경계와
    // 어긋난다. 대시보드 정밀도 요구 수준에서는 무시 가능하지만, 정확한 KST 월 경계가
    // 필요해지면 process.env.TZ 또는 Asia/Seoul Intl 변환으로 교체.
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [
      // ── 진행률 집계 ────────────────────────────────────────────
      progressAgg,
      completedCnt,

      // ── 정체된 일 ──────────────────────────────────────────────
      stalledCnt,
      stalledItems,

      // ── 최근 변경 5건 ──────────────────────────────────────────
      recentChanges,

      // ── Phase 2: 팀 활동 — 최근 7일 변경자 그룹화 ──────────────
      activityGroups,

      // ── Phase 2: AI 사용 — 이번 달 상태별 그룹화 ───────────────
      aiStatusGroups,
    ] = await Promise.all([
      // 단위업무 전체수 + 평균 진행률
      // _avg 가 row 0 일 때 null 을 돌려주므로 응답 가공에서 0 으로 폴백.
      prisma.tbDsUnitWork.aggregate({
        where:  { prjct_id: projectId },
        _count: { _all: true },
        _avg:   { progrs_rt: true },
      }),

      // 완료된 단위업무 (progrs_rt = 100)
      prisma.tbDsUnitWork.count({
        where: { prjct_id: projectId, progrs_rt: 100 },
      }),

      // 정체 카운트 — end_de < 오늘 AND progrs_rt < 100
      // end_de 가 비어있는 행은 정체 판정 불가 → 제외.
      prisma.tbDsUnitWork.count({
        where: {
          prjct_id:  projectId,
          progrs_rt: { lt: 100 },
          end_de:    { lt: todayStr, not: null },
        },
      }),

      // 정체 미리보기 5건 — 가장 오래 정체된 순(마감 오름차순)
      prisma.tbDsUnitWork.findMany({
        where: {
          prjct_id:  projectId,
          progrs_rt: { lt: 100 },
          end_de:    { lt: todayStr, not: null },
        },
        select: {
          unit_work_id:         true,
          unit_work_display_id: true,
          unit_work_nm:         true,
          end_de:               true,
          progrs_rt:            true,
          asign_mber_id:        true,
        },
        orderBy: { end_de: "asc" },
        take:    PREVIEW_LIMIT,
      }),

      // 최근 설계 변경 5건
      prisma.tbDsDesignChange.findMany({
        where:   { prjct_id: projectId },
        orderBy: { chg_dt: "desc" },
        take:    PREVIEW_LIMIT,
        select: {
          chg_id:        true,
          ref_tbl_nm:    true,
          ref_id:        true,
          chg_type_code: true,
          chg_rsn_cn:    true,
          chg_mber_id:   true,
          chg_dt:        true,
        },
      }),

      // 팀 활동 — 최근 7일 변경자별 카운트
      // chg_mber_id 가 null 인 행(시스템/배치 변경)은 그룹 키도 null 이라
      // 클라이언트로 보낼 때 별도로 걸러낸다.
      prisma.tbDsDesignChange.groupBy({
        by:      ["chg_mber_id"],
        where:   { prjct_id: projectId, chg_dt: { gte: sevenDaysAgo } },
        _count:  { _all: true },
      }),

      // AI 사용 — 이번 달 상태별 카운트 (한 번의 그룹 쿼리로 집계)
      prisma.tbAiTask.groupBy({
        by:     ["task_sttus_code"],
        where:  { prjct_id: projectId, req_dt: { gte: monthStart } },
        _count: { _all: true },
      }),
    ]);

    // 담당자/변경자/기여자 이름 일괄 조회 (N+1 방지)
    // 정체 미리보기·최근 변경·팀 활동 Top 기여자에 등장하는 mberId 를 한 번에 모아 join.
    const memberIds = [
      ...new Set(
        [
          ...stalledItems.map((s) => s.asign_mber_id),
          ...recentChanges.map((c) => c.chg_mber_id),
          ...activityGroups.map((g) => g.chg_mber_id),
        ].filter((v): v is string => !!v)
      ),
    ];

    const members = memberIds.length > 0
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: memberIds } },
          select: { mber_id: true, mber_nm: true, email_addr: true },
        })
      : [];

    // mber_nm 우선, 없으면 email_addr fallback (퇴장 멤버는 null 그대로 둠)
    const memberDisplayMap = new Map(
      members.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null])
    );

    const total       = progressAgg._count._all;
    const averagePct  = total === 0
      ? 0
      // _avg 는 row 0 일 때 null. 소수 1자리 반올림.
      : Math.round((progressAgg._avg.progrs_rt ?? 0) * 10) / 10;

    // ── 팀 활동 가공 ──────────────────────────────────────────
    // groupBy 결과에서 chg_mber_id null 행은 시스템/배치 변경 → 사용자 카운트에서 제외
    const namedActivity = activityGroups.filter(
      (g): g is typeof g & { chg_mber_id: string } => !!g.chg_mber_id
    );
    const topContributors = [...namedActivity]
      // 내림차순 정렬 후 상위 3
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, 3)
      .map((g) => ({
        mberId:      g.chg_mber_id,
        displayName: memberDisplayMap.get(g.chg_mber_id) ?? g.chg_mber_id,
        count:       g._count._all,
      }));

    // ── AI 사용 가공 ──────────────────────────────────────────
    // tb_ai_task.task_sttus_code 는 PENDING/IN_PROGRESS/DONE/APPLIED/REJECTED/FAILED/TIMEOUT.
    // - DONE/APPLIED      → 완료 (사용자가 결과를 받은 상태)
    // - PENDING/IN_PROGRESS → 진행 중
    // - FAILED/TIMEOUT    → 실패 (운영자가 봐야 하는 시그널)
    // - REJECTED          → 사용자 거절 — 카운트에 포함하지 않음(중립)
    let monthCount      = 0;
    let completedCount  = 0;
    let inProgressCount = 0;
    let failedCount     = 0;
    for (const g of aiStatusGroups) {
      const n = g._count._all;
      monthCount += n;
      if (g.task_sttus_code === "DONE" || g.task_sttus_code === "APPLIED") {
        completedCount += n;
      } else if (g.task_sttus_code === "PENDING" || g.task_sttus_code === "IN_PROGRESS") {
        inProgressCount += n;
      } else if (g.task_sttus_code === "FAILED" || g.task_sttus_code === "TIMEOUT") {
        failedCount += n;
      }
      // REJECTED 는 monthCount 에는 포함되지만 세 분류 어디에도 들어가지 않음 — 의도적
    }

    const response: ManageSummaryResponse = {
      progress: {
        total,
        completed:  completedCnt,
        averagePct,
      },
      stalled: {
        count: stalledCnt,
        items: stalledItems.map((s) => ({
          unitWorkId:       s.unit_work_id,
          displayId:        s.unit_work_display_id,
          name:             s.unit_work_nm,
          // 위 where 조건에서 null 제외 했으므로 안전하게 string 단언
          endDate:          s.end_de ?? "",
          progress:         s.progrs_rt,
          assignMemberName: s.asign_mber_id
            ? (memberDisplayMap.get(s.asign_mber_id) ?? null)
            : null,
        })),
      },
      recentChanges: recentChanges.map((c) => ({
        chgId:        c.chg_id,
        refTblNm:     c.ref_tbl_nm,
        refId:        c.ref_id,
        chgTypeCode:  c.chg_type_code,
        chgRsnCn:     c.chg_rsn_cn ?? null,
        chgMberEmail: c.chg_mber_id ? (memberDisplayMap.get(c.chg_mber_id) ?? null) : null,
        chgDt:        c.chg_dt.toISOString(),
      })),
      teamActivity: {
        activeMemberCount: namedActivity.length,
        topContributors,
      },
      aiUsage: {
        monthCount,
        completedCount,
        inProgressCount,
        failedCount,
      },
    };

    return apiSuccess(response);
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/dashboard/manage-summary] DB 오류:`, err);
    return apiError("DB_ERROR", "관리 대시보드 데이터 조회에 실패했습니다.", 500);
  }
}
