/**
 * GET /api/projects/[id]/dashboard/me-summary
 *   — 개발자 대시보드 요약 (카드 4종 통합 조회)
 *
 * 역할:
 *   - 로그인 사용자의 "오늘 내가 뭘 해야 하지?" 데이터를 한 번에 모아 반환
 *     1) myTasks      — 내가 담당한 과업 (전체 + 카테고리 분포 + 미리보기 5건)
 *     2) myDeadlines  — 내 단위업무 중 마감 D-7 이내 + 지연 (Top 5) + 화면/기능 마감 카운트
 *     3) myAiResults  — 내가 요청한 AI 태스크 최근 5건(상태 무관) + 액션 필요(완료·미적용) 건수
 *     4) myReviews    — 나에게 온 검토 요청 (미응답)
 *
 * 2026-07-20: myDeadlines 가 단위업무만 다뤄 "내가 담당한 화면/기능"의 마감이 전혀 안 보이던
 *   갭을 보완 — MY 보드(/my-work)를 만들며 확인된 니즈. 목록은 여전히 단위업무만(기존 UX 유지),
 *   화면/기능은 카운트만 추가하고 전체는 MY 보드로 링크.
 *
 * 2026-07-20(2차): myTasks 미리보기 3→5건 + 최근 수정일 노출, myAiResults 를
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
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import type { MeSummaryResponse } from "@/types/dashboard";

type RouteParams = { params: Promise<{ id: string }> };

// 개발자뷰는 "한눈에" 가 핵심 — 본문 미리보기를 작게 유지.
const TASKS_PREVIEW_LIMIT      = 5;
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

    const [
      // ── 내 과업 ────────────────────────────────────────────────
      // 카운트와 카테고리 분포는 DB 집계로 처리 — 행 전체를 메모리에 올리지 않음.
      // 미리보기는 별도 take 쿼리로 3건만 가져온다.
      myTasksByCategory,
      myTasksItems,

      // ── 내 마감 ────────────────────────────────────────────────
      // count + 지연 count + 미리보기를 분리 쿼리로 (count 는 정확히, 미리보기는 빠르게)
      deadlineCnt,
      overdueCnt,
      deadlineItems,

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
      // 과업 카테고리별 카운트 — DB 에서 직접 집계 (행 무제한 로드 방지)
      // groupBy 결과: [{ ctgry_code: "NEW_DEV", _count: { _all: 3 } }, ...]
      prisma.tbRqTask.groupBy({
        by:     ["ctgry_code"],
        where:  { prjct_id: projectId, asign_mber_id: meId },
        _count: { _all: true },
      }),

      // 과업 미리보기 5건 — 표시용(수정일도 함께 — 행마다 "언제 손댔는지" 보여주기 위함)
      prisma.tbRqTask.findMany({
        where:   { prjct_id: projectId, asign_mber_id: meId },
        select:  { task_id: true, task_display_id: true, task_nm: true, ctgry_code: true, mdfcn_dt: true },
        orderBy: { task_display_id: "asc" },
        take:    TASKS_PREVIEW_LIMIT,
      }),

      // 마감 카운트 — end_de <= 오늘+7일 AND progrs_rt < 100
      // (지연된 것 포함, "임박" 안에 지연도 포함시켜야 사용자가 놓치지 않음)
      prisma.tbDsUnitWork.count({
        where: {
          prjct_id:      projectId,
          asign_mber_id: meId,
          progrs_rt:     { lt: 100 },
          end_de:        { lte: horizonStr, not: null },
        },
      }),

      // 지연 카운트 — end_de < 오늘
      prisma.tbDsUnitWork.count({
        where: {
          prjct_id:      projectId,
          asign_mber_id: meId,
          progrs_rt:     { lt: 100 },
          end_de:        { lt: todayStr, not: null },
        },
      }),

      // 마감 미리보기 — 마감 가까운 순 Top 5
      prisma.tbDsUnitWork.findMany({
        where: {
          prjct_id:      projectId,
          asign_mber_id: meId,
          progrs_rt:     { lt: 100 },
          end_de:        { lte: horizonStr, not: null },
        },
        select: {
          unit_work_id:         true,
          unit_work_display_id: true,
          unit_work_nm:         true,
          end_de:               true,
          progrs_rt:            true,
        },
        orderBy: { end_de: "asc" },
        take:    DEADLINES_PREVIEW_LIMIT,
      }),

      // 내가 담당한 화면 중 설계 마감이 +7일 이내(지연 포함)인 것 — 완료 여부는 함수 뒤에서 판정
      prisma.tbDsScreen.findMany({
        where: {
          prjct_id:       projectId,
          asign_mber_id:  meId,
          design_end_de:  { lte: horizonStr, not: null },
        },
        select: { scrn_id: true },
      }),

      // 내가 담당한 기능 중 구현 마감이 +7일 이내(지연 포함)인 것
      prisma.tbDsFunction.findMany({
        where: {
          prjct_id:      projectId,
          asign_mber_id: meId,
          impl_end_de:   { lte: horizonStr, not: null },
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

    // ── 내 화면 마감 완료 여부 판정 — 하위 기능 design_rt 평균(화면 단위 롤업).
    // pm-summary 의 screenAvgDesignRtMap 과 동일 정의. 화면이 없으면 쿼리 자체를 건너뜀.
    const myScreenIds = myScreenRows.map((s) => s.scrn_id);
    const myScreenAvgRows = myScreenIds.length > 0
      ? await prisma.$queryRaw<{ scrn_id: string; avg_design_rt: number }[]>`
          SELECT a.scrn_id,
                 COALESCE(AVG(p.design_rt), 0) AS avg_design_rt
            FROM tb_ds_function f
            JOIN tb_ds_area a ON a.area_id = f.area_id
            LEFT JOIN tb_cm_progress p
              ON p.ref_tbl_nm = 'tb_ds_function' AND p.ref_id = f.func_id
           WHERE a.scrn_id IN (${Prisma.join(myScreenIds)})
           GROUP BY a.scrn_id
        `
      : [];
    const myScreenAvgMap = new Map(myScreenAvgRows.map((r) => [r.scrn_id, Number(r.avg_design_rt)]));
    // 하위 기능이 아예 없는 화면은 위 쿼리 결과에 안 잡힘 → 진척 0(미완료)으로 간주
    const screenCount = myScreenIds.filter((id) => (myScreenAvgMap.get(id) ?? 0) < 100).length;

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

    // 과업 byCategory + count — groupBy 결과를 객체로 변환
    let myTasksCount = 0;
    const byCategory: Record<string, number> = {};
    for (const g of myTasksByCategory) {
      const n = g._count._all;
      myTasksCount += n;
      byCategory[g.ctgry_code] = n;
    }

    // D-day 계산 — 음수 = 지연
    // text 컬럼이라 Date 로 변환 후 일 단위 차이.
    const todayMidnight = new Date(todayStr + "T00:00:00Z").getTime();
    const MS_PER_DAY    = 1000 * 60 * 60 * 24;

    const response: MeSummaryResponse = {
      myTasks: {
        count:      myTasksCount,
        byCategory,
        items:      myTasksItems.map((t) => ({
          taskId:    t.task_id,
          displayId: t.task_display_id,
          name:      t.task_nm,
          category:  t.ctgry_code,
          mdfcnDt:   t.mdfcn_dt?.toISOString() ?? null,
        })),
      },
      myDeadlines: {
        count:        deadlineCnt,
        overdueCount: overdueCnt,
        items:        deadlineItems.map((u) => {
          // end_de 가 위 where 에서 not null 보장 + ISO 포맷 가정
          const endDate = u.end_de ?? "";
          const endMs   = endDate
            ? new Date(endDate + "T00:00:00Z").getTime()
            : todayMidnight;
          const dDay    = Math.round((endMs - todayMidnight) / MS_PER_DAY);
          return {
            unitWorkId: u.unit_work_id,
            displayId:  u.unit_work_display_id,
            name:       u.unit_work_nm,
            endDate,
            progress:   u.progrs_rt,
            dDay,
          };
        }),
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
