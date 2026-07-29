/**
 * GET /api/projects/[id]/dashboard/me-summary
 *   — 개발자 대시보드 요약 (카드 4종 통합 조회)
 *
 * 역할:
 *   - 로그인 사용자의 "오늘 내가 뭘 해야 하지?" 데이터를 한 번에 모아 반환
 *     1) myRequirements — 내가 담당한 요구사항 (전체 건수 + 분석 기간·분석률 미리보기 5건)
 *     2) myDeadlines  — 내 단위업무 중 설계·구현 phase 하나라도 마감 D-7 이내+지연인 것 (Top 5,
 *                       phase 별 날짜·진척률 분리 + 더 급한 phase 기준 D-day) + 화면/기능 마감 카운트
 *     3) myAiResults  — 내가 요청한 AI 태스크 최근 5건(상태 무관) + 액션 필요(완료·미적용) 건수
 *     4) myReviews    — 나에게 온 검토 요청 (미응답)
 *
 * 2026-07-20: myDeadlines 가 단위업무만 다뤄 "내가 담당한 화면/기능"의 마감이 전혀 안 보이던
 *   갭을 보완 — MY 보드(/my-work)를 만들며 확인된 니즈. 목록은 여전히 단위업무만(기존 UX 유지),
 *   화면/기능은 카운트만 추가하고 전체는 MY 보드로 링크.
 *
 * 2026-07-20(2차): myAiResults 를
 *   "완료·미적용"만 보여주던 좁은 필터에서 "최근 요청 전체"로 확장(결과만 받고 안 쓴
 *   경우가 아니어도 볼 가치가 있다는 피드백) — 배지 숫자(actionableCount)는 기존처럼
 *   액션 필요 건수를 유지, 목록만 넓힘.
 *
 * 왜 통합 엔드포인트인가:
 *   - manage-summary 와 동일 사유 (라운드트립 1회로 단축).
 *   - 모든 카드가 "me" 기준이라 권한 가드 1번만 평가하면 됨.
 *
 * 권한:
 *   - content.read 필요 (멤버라면 누구나 자기 데이터 조회 가능)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import type { MeSummaryResponse } from "@/types/dashboard";
import { fetchUnitWorkProgress, fetchScreenProgress } from "@/lib/pm/progressRollup";

type RouteParams = { params: Promise<{ id: string }> };

// 개발자뷰는 "한눈에" 가 핵심 — 본문 미리보기를 작게 유지.
const REQUIREMENTS_PREVIEW_LIMIT = 5;
const DEADLINES_PREVIEW_LIMIT  = 5;
const AI_RESULTS_PREVIEW_LIMIT = 5;
const REVIEWS_PREVIEW_LIMIT    = 5;

// 마감 임박 기준 — 오늘부터 +7일 이내(지연된 항목도 함께 반환)
// 너무 짧으면 (예: D-1) 카드가 비어 보이고, 너무 길면 시급도가 흐려진다.
// 운영 후 피드백으로 조정.
const DEADLINE_LOOKAHEAD_DAYS = 7;

// 응답 타입은 src/types/dashboard.ts 의 MeSummaryResponse 를 그대로 사용.

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const meId = gate.mberId;

  try {
    // 날짜 범위 — end_de 가 text(YYYY-MM-DD) 라 문자열 비교가 안전한 ISO 포맷 사용
    const today    = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const horizon  = new Date(today.getTime());
    horizon.setDate(horizon.getDate() + DEADLINE_LOOKAHEAD_DAYS);
    const horizonStr = horizon.toISOString().slice(0, 10);

    // D-day 계산 — 음수 = 지연. text 컬럼이라 Date 로 변환 후 일 단위 차이.
    const todayMidnight = new Date(todayStr + "T00:00:00Z").getTime();
    const MS_PER_DAY     = 1000 * 60 * 60 * 24;
    const computeDDay = (endDate: string) =>
      Math.round((new Date(endDate + "T00:00:00Z").getTime() - todayMidnight) / MS_PER_DAY);

    const [
      // ── 내 요구사항 ────────────────────────────────────────────
      // 개수는 DB count로, 미리보기는 별도 take 쿼리로 5건만 가져온다.
      myRequirementsCnt,
      myRequirementsItems,

      // ── 내 마감 ────────────────────────────────────────────────
      // 단위업무 진행률(progrs_rt)이 저장값이 아니라 화면·기능 롤업 계산값이라(2026-07-28)
      // DB count/filter 대신 내 담당 단위업무 전체를 읽어 JS에서 계산.
      myUnitWorkRows,

      // ── 내 마감 — 화면/기능 (카운트만, MY 보드로 상세 유도) ──────
      myScreenRows,
      myFunctionRows,

      // ── 내 AI 결과 ─────────────────────────────────────────────
      aiResultsCnt,
      aiResultsItems,

      // ── 나에게 온 검토 요청 (미응답) ─────────────────────────────
      myReviewsCnt,
      myReviewsItems,
    ] = await Promise.all([
      // 내가 담당자로 지정된 요구사항 총 건수
      prisma.tbRqRequirement.count({
        where: { prjct_id: projectId, asign_mber_id: meId },
      }),

      // 요구사항 미리보기 5건 — 분석 기간(anls_bgng_de~anls_end_de) + 분석률(progrs_rt)
      prisma.tbRqRequirement.findMany({
        where:   { prjct_id: projectId, asign_mber_id: meId },
        select: {
          req_id: true, req_display_id: true, req_nm: true,
          anls_bgng_de: true, anls_end_de: true, progrs_rt: true,
        },
        orderBy: { req_display_id: "asc" },
        take:    REQUIREMENTS_PREVIEW_LIMIT,
      }),

      // 내 담당 단위업무 전체 — 마감/진행률은 아래에서 JS로 계산
      prisma.tbDsUnitWork.findMany({
        where: { prjct_id: projectId, asign_mber_id: meId },
        select: {
          unit_work_id: true, unit_work_display_id: true, unit_work_nm: true,
          plan_dsgn_end_de: true,
        },
      }),

      // 내가 담당한 화면 중 구현 마감이 +7일 이내(지연 포함)인 것 — 완료 여부는 함수 뒤에서 판정.
      // (실질설계기간은 2026-07-28부터 화면에 없음 — 화면 자체가 갖는 일정은 구현뿐)
      prisma.tbDsScreen.findMany({
        where: {
          prjct_id:       projectId,
          asign_mber_id:  meId,
          actl_impl_end_de: { lte: horizonStr, not: null },
        },
        select: { scrn_id: true },
      }),

      // 내가 담당한 기능 중, 소속 화면의 구현 마감이 +7일 이내(지연 포함)인 것
      // (기능 자신은 구현 일정이 없음 — 화면에서 상속, 2026-07-28)
      prisma.tbDsFunction.findMany({
        where: {
          prjct_id:      projectId,
          asign_mber_id: meId,
          area: { screen: { actl_impl_end_de: { lte: horizonStr, not: null } } },
        },
        select: { func_id: true },
      }),

      // 액션 필요 건수 — 내가 요청 + DONE + 미적용
      // DONE: AI 처리 완료, apply_dt NULL: 사용자가 아직 채택/적용하지 않음
      // (배지 강조용 숫자 — 아래 목록 쿼리와 필터가 다름에 주의)
      prisma.tbAiTask.count({
        where: {
          prjct_id:        projectId,
          req_mber_id:     meId,
          task_sttus_code: "DONE",
          apply_dt:        null,
        },
      }),

      // 최근 AI 결과 5건 — 상태 무관(진행중/완료/적용됨/실패 다 포함), 요청일 내림차순.
      // "미적용"만 보여주면 이미 적용했거나 실패한 것도 유용한 히스토리인데 안 보이는
      // 문제가 있어 목록은 넓히고, 배지(actionableCount)만 액션 필요 신호로 남긴다.
      prisma.tbAiTask.findMany({
        where: {
          prjct_id:    projectId,
          req_mber_id: meId,
        },
        select: {
          ai_task_id:      true,
          task_ty_code:    true,
          ref_ty_code:     true,
          task_sttus_code: true,
          req_dt:          true,
          compl_dt:        true,
        },
        orderBy: { req_dt: "desc" },
        take:    AI_RESULTS_PREVIEW_LIMIT,
      }),

      // 나에게 온 검토 요청 — 미응답(REQUESTED/REVIEWING) 카운트
      // idx_ds_review_revwr (revwr_mber_id, review_sttus_code) 인덱스로 빠름.
      prisma.tb_ds_review_request.count({
        where: {
          prjct_id:           projectId,
          revwr_mber_id:      meId,
          review_sttus_code:  { in: ["REQUESTED", "REVIEWING"] },
        },
      }),

      // 검토 요청 미리보기 — 오래된 것 우선(SLA 위협부터 표시)
      prisma.tb_ds_review_request.findMany({
        where: {
          prjct_id:           projectId,
          revwr_mber_id:      meId,
          review_sttus_code:  { in: ["REQUESTED", "REVIEWING"] },
        },
        select: {
          review_id:         true,
          review_title_nm:   true,
          ref_tbl_nm:        true,
          ref_id:            true,
          review_sttus_code: true,
          req_mber_id:       true,
          creat_dt:          true,
        },
        orderBy: { creat_dt: "asc" },
        take:    REVIEWS_PREVIEW_LIMIT,
      }),
    ]);

    // 검토 요청자 이름 일괄 조회 (N+1 방지) — 미리보기용 사람 표시
    const reviewerIds = [
      ...new Set(myReviewsItems.map((r) => r.req_mber_id).filter(Boolean)),
    ];
    const reviewers = reviewerIds.length > 0
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: reviewerIds } },
          select: { mber_id: true, mber_nm: true, email_addr: true },
        })
      : [];
    const reviewerMap = new Map(
      reviewers.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null])
    );

    // ── 내 화면 구현 마감 완료 여부 판정 — 하위 기능 impl_rt 평균(화면 단위 롤업, 중앙 헬퍼 재사용) ──
    const myScreenIds = myScreenRows.map((s) => s.scrn_id);
    const myScreenProgressMap = await fetchScreenProgress(myScreenIds);
    const screenCount = myScreenIds.filter((id) => (myScreenProgressMap.get(id)?.implRt ?? 0) < 100).length;

    // ── 내 기능 구현 완료 여부 — TbCmProgress.impl_rt, 없으면 0(미완료)으로 간주 ──
    const myFuncIds = myFunctionRows.map((f) => f.func_id);
    const myFuncProgressRows = myFuncIds.length > 0
      ? await prisma.tbCmProgress.findMany({
          where:  { ref_tbl_nm: "tb_ds_function", ref_id: { in: myFuncIds } },
          select: { ref_id: true, impl_rt: true },
        })
      : [];
    const myFuncImplRtMap = new Map(myFuncProgressRows.map((p) => [p.ref_id, p.impl_rt]));
    const functionCount = myFuncIds.filter((id) => (myFuncImplRtMap.get(id) ?? 0) < 100).length;

    // ── 내 단위업무 마감/진행률 — 저장값이 아니라 화면·기능 롤업 계산값(2026-07-28) ──
    const myUwProgressMap = await fetchUnitWorkProgress(myUnitWorkRows.map((u) => u.unit_work_id));

    // 내 단위업무들의 구현 종료 예정일 롤업 — 단위업무 자신은 구현 일정이 없어(화면 소관),
    // 하위 화면들의 실질구현종료일(actl_impl_end_de) 중 가장 늦은 날짜로 계산
    // (manage-summary/route.ts 의 "정체된 일" 롤업과 동일 기준).
    const myUnitWorkIds = myUnitWorkRows.map((u) => u.unit_work_id);
    const myUwScreensForImpl = myUnitWorkIds.length > 0
      ? await prisma.tbDsScreen.findMany({
          where:  { unit_work_id: { in: myUnitWorkIds } },
          select: { unit_work_id: true, actl_impl_end_de: true },
        })
      : [];
    const myImplEndByUnitWork = new Map<string, string | null>();
    for (const s of myUwScreensForImpl) {
      if (!s.unit_work_id || !s.actl_impl_end_de) continue;
      const cur = myImplEndByUnitWork.get(s.unit_work_id);
      if (!cur || s.actl_impl_end_de > cur) myImplEndByUnitWork.set(s.unit_work_id, s.actl_impl_end_de);
    }

    // 마감 판정 — 설계 또는 구현 "둘 중 하나라도" +7일 이내(지연 포함)인데 그 phase가
    // 미완료(<100%)면 포함(OR 조건). 대표 D-day는 두 phase 중 더 급한(작은) 값 — 둘 다
    // 지연이면 더 오래 지연된 쪽, 하나만 지연이면 그쪽, 둘 다 임박이면 더 가까운 쪽.
    // (manage-summary/route.ts 의 "정체된 일" 판정과 동일한 phase 분리 원칙)
    const myUpcomingCandidates = myUnitWorkRows
      .map((u) => {
        const p = myUwProgressMap.get(u.unit_work_id);
        const designEnd = u.plan_dsgn_end_de ?? null;
        const designRt  = p?.designRt ?? 0;
        const implEnd   = myImplEndByUnitWork.get(u.unit_work_id) ?? null;
        const implRt    = p?.implRt ?? 0;

        const designEligible = !!designEnd && designEnd <= horizonStr && designRt < 100;
        const implEligible   = !!implEnd   && implEnd   <= horizonStr && implRt   < 100;
        if (!designEligible && !implEligible) return null;

        const designDDay = designEnd ? computeDDay(designEnd) : null;
        const implDDay   = implEnd   ? computeDDay(implEnd)   : null;

        let dDay: number;
        let dDaySource: "DESIGN" | "IMPL";
        if (designEligible && implEligible) {
          if ((designDDay as number) <= (implDDay as number)) { dDay = designDDay as number; dDaySource = "DESIGN"; }
          else { dDay = implDDay as number; dDaySource = "IMPL"; }
        } else if (designEligible) {
          dDay = designDDay as number; dDaySource = "DESIGN";
        } else {
          dDay = implDDay as number; dDaySource = "IMPL";
        }

        return {
          row: u,
          dDay,
          dDaySource,
          design: { endDate: designEnd, progress: designRt },
          impl:   { endDate: implEnd,   progress: implRt },
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => a.dDay - b.dDay);
    const deadlineCnt   = myUpcomingCandidates.length;
    const overdueCnt    = myUpcomingCandidates.filter((c) => c.dDay < 0).length;
    const deadlineItems = myUpcomingCandidates.slice(0, DEADLINES_PREVIEW_LIMIT);

    const response: MeSummaryResponse = {
      myRequirements: {
        count: myRequirementsCnt,
        items: myRequirementsItems.map((r) => ({
          reqId:      r.req_id,
          displayId:  r.req_display_id,
          name:       r.req_nm,
          startDate:  r.anls_bgng_de,
          endDate:    r.anls_end_de,
          progress:   r.progrs_rt,
        })),
      },
      myDeadlines: {
        count:        deadlineCnt,
        overdueCount: overdueCnt,
        items:        deadlineItems.map((c) => ({
          unitWorkId: c.row.unit_work_id,
          displayId:  c.row.unit_work_display_id,
          name:       c.row.unit_work_nm,
          dDay:       c.dDay,
          dDaySource: c.dDaySource,
          design:     c.design,
          impl:       c.impl,
        })),
        screenCount,
        functionCount,
      },
      myAiResults: {
        actionableCount: aiResultsCnt,
        items: aiResultsItems.map((a) => ({
          aiTaskId:   a.ai_task_id,
          taskTyCode: a.task_ty_code,
          refTyCode:  a.ref_ty_code,
          sttusCode:  a.task_sttus_code,
          reqDt:      a.req_dt.toISOString(),
          complDt:    a.compl_dt?.toISOString() ?? null,
        })),
      },
      myReviews: {
        pendingCount: myReviewsCnt,
        items:        myReviewsItems.map((r) => ({
          reviewId:    r.review_id,
          title:       r.review_title_nm,
          refTblNm:    r.ref_tbl_nm,
          refId:       r.ref_id,
          sttusCode:   r.review_sttus_code,
          reqMberName: reviewerMap.get(r.req_mber_id) ?? null,
          creatDt:     r.creat_dt.toISOString(),
        })),
      },
    };

    return apiSuccess(response);
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/dashboard/me-summary] DB 오류:`, err);
    return apiError("DB_ERROR", "내 대시보드 데이터 조회에 실패했습니다.", 500);
  }
}
