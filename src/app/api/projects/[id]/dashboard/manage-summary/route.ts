/**
 * GET /api/projects/[id]/dashboard/manage-summary
 *   — 관리자 대시보드 요약 (카드 5종 + 배너 1종 통합 조회)
 *
 * 역할:
 *   - 카드에 필요한 데이터를 한 번의 라운드트립으로 모아서 반환
 *     1) progress      — 단위업무 진행률 + 요구사항/화면/기능 평균 진행률(보조 지표)
 *     2) stalled       — 설계·구현 중 한 phase 라도 마감 지났는데 그 phase 미완료(<100%)인
 *                        단위업무 + Top 5(설계/구현 phase 별 날짜·진척률 분리 표기) + 화면/기능 지연 카운트
 *     3) recentChanges — 설계 변경 이력 최신 5건
 *     4) teamActivity  — 최근 7일 활동 + 부하(활성 작업량) 1위 멤버
 *     5) aiUsage       — 이번 달 AI 사용 통계
 *     6) unassignedTotal — 담당자 미입력(4개 엔티티 합산) 총 건수, 배너용
 *
 * 2026-07-20: 대시보드가 "단위업무·과업" 2개 엔티티만 다뤄 요구사항 분석/화면 설계/기능 구현
 *   진행률, 팀 부하, 미지정 항목이 전혀 안 보이던 갭을 보완 — PM 진단(/pm)·PM 현황(/pm-board)을
 *   만들며 확인된 실제 니즈를 요약 신호로 반영(전체 매트릭스는 그쪽 화면으로 링크).
 *
 * 2026-07-20(2차): recentChanges 에 refName(변경된 엔티티의 현재 이름) 추가 — 유형 라벨만으론
 *   "화면이 바뀜"만 반복 노출돼 어떤 화면인지 알 수 없다는 피드백 반영.
 *
 * 왜 통합 엔드포인트인가:
 *   - 첫 페이지 진입 시 카드별 HTTP 호출 → 1회로 줄여 LCP 단축.
 *   - 동일 권한 가드를 여러 번 평가하지 않으므로 DB 부하·코드 중복도 감소.
 *
 * 권한:
 *   - content.read — VIEWER 이상 통과 (관리뷰는 OWNER/ADMIN/PM/PL 자동 분기,
 *     일반 멤버가 URL 직접 접근해도 읽기는 허용. UI 토글로 보호.)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { buildMissingStat } from "@/lib/pm/missingStatus";
import { fetchUnitWorkProgress, combinePhaseProgress, resolveFunctionScreenDates } from "@/lib/pm/progressRollup";
import type { ManageSummaryResponse } from "@/types/dashboard";

type RouteParams = { params: Promise<{ id: string }> };

// 정체된 일 / 최근 변경 카드는 본문에 미리보기를 보여주므로 5건만 노출.
// 카운트는 별도 집계 쿼리로 정확히 가져온다.
const PREVIEW_LIMIT = 5;

// 매우 큰 프로젝트 안전망 — pm-summary/route.ts 와 동일 기준(메모리 집계용 캡).
const HARD_LIMIT = 2000;

// 마감 임박 기준 — 팀 부하 계산의 "dueSoon" 판정용. pm-summary 의 7일 기준과 동일.
const LOAD_HORIZON_DAYS = 7;

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

    // 팀 부하의 "임박(dueSoon)" 판정 기준 — 오늘부터 +7일
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + LOAD_HORIZON_DAYS);
    const horizonStr = horizon.toISOString().slice(0, 10);

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
      // ── 최근 변경 5건 ──────────────────────────────────────────
      recentChanges,

      // ── 팀 활동 — 최근 7일 변경자 그룹화 ────────────────────────
      activityGroups,

      // ── AI 사용 — 이번 달 상태별 그룹화 ─────────────────────────
      aiStatusGroups,

      // ── 요구사항 분석 평균 진행률 (progress 카드 보조 지표) ─────
      requirementAvgAgg,

      // ── 미지정 배너 + 팀 부하 + 진행률/정체 판정용 원본 행 (4개 엔티티) ──
      // 담당자/일정/공수가 필요해 aggregate 대신 findMany 로 전체 로드.
      // 단위업무 진행률(progrs_rt)은 더 이상 저장값이 아니라 화면·기능 롤업 계산값이라
      // (2026-07-28) DB aggregate/count로 필터링할 수 없음 — 전체를 읽어 JS에서 계산.
      requirementRows,
      unitWorkRows,
      screenRows,
      areaRows,
      functionRows,
    ] = await Promise.all([
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

      // 요구사항 평균 진행률 — 단위업무 외 엔티티도 보여주기 위한 보조 지표
      prisma.tbRqRequirement.aggregate({
        where: { prjct_id: projectId },
        _avg:  { progrs_rt: true },
      }),

      prisma.tbRqRequirement.findMany({
        where:  { prjct_id: projectId },
        select: { asign_mber_id: true, anls_bgng_de: true, anls_end_de: true },
        take:   HARD_LIMIT,
      }),
      prisma.tbDsUnitWork.findMany({
        where:  { prjct_id: projectId },
        select: {
          unit_work_id: true, unit_work_display_id: true, unit_work_nm: true,
          asign_mber_id: true, plan_dsgn_bgng_de: true, plan_dsgn_end_de: true,
        },
        take:   HARD_LIMIT,
      }),
      prisma.tbDsScreen.findMany({
        where:  { prjct_id: projectId },
        select: {
          scrn_id: true, asign_mber_id: true, unit_work_id: true,
          actl_impl_bgng_de: true, actl_impl_end_de: true,
        },
        take:   HARD_LIMIT,
      }),
      prisma.tbDsArea.findMany({
        where:  { prjct_id: projectId },
        select: { area_id: true, scrn_id: true },
        take:   HARD_LIMIT,
      }),
      prisma.tbDsFunction.findMany({
        where:  { prjct_id: projectId },
        select: {
          func_id: true, area_id: true, asign_mber_id: true, impl_efrt_val: true,
        },
        take:   HARD_LIMIT,
      }),
    ]);

    // 단위업무 실적 진행률(설계+구현 롤업) — 저장값이 아니라 항상 재계산(lib/pm/progressRollup.ts 단일 소스)
    const unitWorkIds = unitWorkRows.map((u) => u.unit_work_id);
    const uwProgressMap = await fetchUnitWorkProgress(unitWorkIds);
    const uwProgress = (unitWorkId: string) => {
      const p = uwProgressMap.get(unitWorkId);
      return p ? combinePhaseProgress(p) : 0;
    };

    // 단위업무별 구현 종료 예정일 — 단위업무 자신은 구현 일정이 없어(화면 소관), 하위
    // 화면들의 실질구현종료일(actl_impl_end_de) 중 가장 늦은 날짜로 롤업(wbs/unitWorkPhaseRollup.ts
    // 의 IMPL phase 롤업과 동일 기준). screenRows 는 이미 로드돼 있어 추가 쿼리 없이 JS로 집계.
    const implEndByUnitWork = new Map<string, string | null>();
    for (const s of screenRows) {
      if (!s.unit_work_id || !s.actl_impl_end_de) continue;
      const cur = implEndByUnitWork.get(s.unit_work_id);
      if (!cur || s.actl_impl_end_de > cur) implEndByUnitWork.set(s.unit_work_id, s.actl_impl_end_de);
    }

    // 기능 진척률(design_rt/impl_rt) — functionRows 가 확정된 뒤에만 조회 가능해 순차 실행.
    // TbCmProgress 다형 참조(ref_tbl_nm='tb_ds_function'), 없으면 0으로 간주(누락을 완료로
    // 오인하지 않도록 — pm-summary 의 funcImplRtMap.get(...) ?? 0 관례와 동일).
    const funcIds = functionRows.map((f) => f.func_id);
    const funcProgressRows = funcIds.length > 0
      ? await prisma.tbCmProgress.findMany({
          where:  { ref_tbl_nm: "tb_ds_function", ref_id: { in: funcIds } },
          select: { ref_id: true, design_rt: true, impl_rt: true },
        })
      : [];
    const funcProgressMap = new Map(funcProgressRows.map((p) => [p.ref_id, p]));

    // 기능 → 소속 화면의 실질설계/구현기간 — 중앙 헬퍼(lib/pm/progressRollup.ts)로 통일
    const funcScreenDates = resolveFunctionScreenDates(functionRows, areaRows, screenRows);

    // ── 화면 설계 평균(하위 기능 design_rt 평균의 화면별 롤업 → 전체 평균) ──
    // pm-summary 의 screenAvgDesignRtMap 과 동일 정의(화면→영역→기능 단순평균).
    const areaToScrn = new Map(areaRows.map((a) => [a.area_id, a.scrn_id]));
    const scrnDesignRtAcc = new Map<string, { sum: number; count: number }>();
    for (const f of functionRows) {
      const scrnId = f.area_id ? areaToScrn.get(f.area_id) : null;
      if (!scrnId) continue;
      const rt  = funcProgressMap.get(f.func_id)?.design_rt ?? 0;
      const acc = scrnDesignRtAcc.get(scrnId) ?? { sum: 0, count: 0 };
      acc.sum += rt;
      acc.count += 1;
      scrnDesignRtAcc.set(scrnId, acc);
    }
    const scrnAvgDesignRt = new Map(
      [...scrnDesignRtAcc.entries()].map(([scrnId, { sum, count }]) => [scrnId, count > 0 ? sum / count : 0])
    );

    const functionImplAvgPct = functionRows.length > 0
      ? Math.round(
          functionRows.reduce((sum, f) => sum + (funcProgressMap.get(f.func_id)?.impl_rt ?? 0), 0)
            / functionRows.length
        )
      : 0;
    const screenDesignAvgPct = screenRows.length > 0
      ? Math.round(
          screenRows.reduce((sum, s) => sum + (scrnAvgDesignRt.get(s.scrn_id) ?? 0), 0) / screenRows.length
        )
      : 0;

    // ── 정체된 일 — 설계(단위업무)/구현(기능) 지연 카운트만(목록은 단위업무만 유지) ──
    // 설계 지연은 2026-07-28부터 화면이 아니라 단위업무 기준(plan_dsgn_end_de + design_rt 롤업).
    const designDelayedCount = unitWorkRows.filter((u) => {
      if (!u.plan_dsgn_end_de || u.plan_dsgn_end_de >= todayStr) return false;
      return (uwProgressMap.get(u.unit_work_id)?.designRt ?? 0) < 100;
    }).length;
    const functionDelayedCount = functionRows.filter((f) => {
      const screenImplEnd = funcScreenDates.get(f.func_id)?.implEndDe ?? null;
      if (!screenImplEnd || screenImplEnd >= todayStr) return false;
      return (funcProgressMap.get(f.func_id)?.impl_rt ?? 0) < 100;
    }).length;

    // ── 팀 부하 1위 — inProgress + dueSoon + overdue 합이 가장 큰 멤버 하나만.
    // 전체 매트릭스는 PM 진단(/pm)에서 — 여기선 "누가 제일 급한가" 한 줄만 필요.
    const loadMap = new Map<string, number>();
    for (const u of unitWorkRows) {
      if (!u.asign_mber_id || uwProgress(u.unit_work_id) >= 100) continue;
      let load = 1; // inProgress 또는 미시작이어도 담당 중인 미완료 건은 부하로 카운트
      if (u.plan_dsgn_end_de) {
        if (u.plan_dsgn_end_de < todayStr) load += 1;       // overdue
        else if (u.plan_dsgn_end_de <= horizonStr) load += 1; // dueSoon
      }
      loadMap.set(u.asign_mber_id, (loadMap.get(u.asign_mber_id) ?? 0) + load);
    }
    let topLoadMemberId: string | null = null;
    let topLoadValue = 0;
    for (const [mberId, load] of loadMap) {
      if (load > topLoadValue) {
        topLoadMemberId = mberId;
        topLoadValue = load;
      }
    }

    // ── 미지정 배너 — 4개 엔티티 담당자 미입력 합산 (lib/pm/missingStatus.ts 순수 함수 재사용) ──
    const missingStats = [
      buildMissingStat(
        "REQUIREMENT", "요구사항",
        requirementRows.map((r) => ({ asignMberId: r.asign_mber_id, startDate: r.anls_bgng_de, endDate: r.anls_end_de })),
        false
      ),
      buildMissingStat(
        "UNIT_WORK", "단위업무",
        unitWorkRows.map((u) => ({ asignMberId: u.asign_mber_id, startDate: u.plan_dsgn_bgng_de, endDate: u.plan_dsgn_end_de })),
        false
      ),
      buildMissingStat(
        // 실질설계기간은 2026-07-28부터 화면에 없음(단위업무 소관) — 화면 자체 일정은 구현만, 공수 필드도 없음
        "SCREEN", "화면",
        screenRows.map((s) => ({ asignMberId: s.asign_mber_id, startDate: s.actl_impl_bgng_de, endDate: s.actl_impl_end_de })),
        false
      ),
      buildMissingStat(
        "FUNCTION", "기능",
        functionRows.map((f) => {
          const dates = funcScreenDates.get(f.func_id);
          return {
            asignMberId: f.asign_mber_id,
            startDate:   dates?.implBgngDe ?? null,
            endDate:     dates?.implEndDe ?? null,
            effortRaw:   f.impl_efrt_val,
          };
        }),
        true
      ),
    ];
    const unassignedTotal = missingStats.reduce((sum, s) => sum + s.assigneeMissing, 0);

    // ── 진행률/정체 — 단위업무 실적 진행률(uwProgress)이 저장값이 아니라 계산값이라
    // DB aggregate/count 대신 JS에서 계산(2026-07-28).
    const total      = unitWorkRows.length;
    const completedCnt = unitWorkRows.filter((u) => uwProgress(u.unit_work_id) === 100).length;
    const averagePct = total === 0
      ? 0
      : Math.round((unitWorkRows.reduce((sum, u) => sum + uwProgress(u.unit_work_id), 0) / total) * 10) / 10;

    // 정체 판정 — 설계 종료 예정일 또는 구현 종료 예정일 "둘 중 하나라도" 지났는데
    // 그 phase 의 진척률이 100% 미만이면 정체(OR 조건). 두 phase 를 하나의 평균으로
    // 뭉치면 "설계는 제때 끝났는데 구현 시작일도 아직인" 케이스까지 정체로 잘못 잡혀서
    // (평균 50% < 100%) phase 별로 각각 판정하고 결과도 나눠서 보여준다.
    const stalledRows = unitWorkRows
      .map((u) => {
        const p = uwProgressMap.get(u.unit_work_id);
        const designEnd = u.plan_dsgn_end_de ?? null;
        const designRt  = p?.designRt ?? 0;
        const implEnd   = implEndByUnitWork.get(u.unit_work_id) ?? null;
        const implRt    = p?.implRt ?? 0;
        const design = { endDate: designEnd, progress: designRt, overdue: !!designEnd && designEnd < todayStr && designRt < 100 };
        const impl   = { endDate: implEnd,   progress: implRt,   overdue: !!implEnd   && implEnd   < todayStr && implRt   < 100 };
        // 정렬용 — 지연을 유발한 날짜 중 더 이른(오래된) 쪽이 우선 노출되도록
        const sortKey = [design.overdue ? design.endDate : null, impl.overdue ? impl.endDate : null]
          .filter((d): d is string => d !== null)
          .sort()[0] ?? "";
        return { row: u, design, impl, sortKey, isStalled: design.overdue || impl.overdue };
      })
      .filter((r) => r.isStalled)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    const stalledCnt = stalledRows.length;
    const stalledItems = stalledRows.slice(0, PREVIEW_LIMIT);

    // ── 최근 변경 카드 — 실제 엔티티 이름 배치 조회 ──────────────────────────
    // snapshot_data 는 변경 종류마다 모양이 달라(예: 인라인 편집은 {field,value}, 담당자 변경은
    // {beforeName,afterName}) 이름을 안정적으로 뽑아낼 소스가 아니다 — 현재 이름을 직접 조회.
    // 최대 5건(recentChanges)뿐이라 테이블당 조회도 그만큼 작다.
    const refIdsByTable = new Map<string, Set<string>>();
    for (const c of recentChanges) {
      if (!refIdsByTable.has(c.ref_tbl_nm)) refIdsByTable.set(c.ref_tbl_nm, new Set());
      refIdsByTable.get(c.ref_tbl_nm)!.add(c.ref_id);
    }
    const entityNameMap = new Map<string, string>(); // key: `${ref_tbl_nm}:${ref_id}`

    const chgUnitWorkIds = [...(refIdsByTable.get("tb_ds_unit_work") ?? [])];
    if (chgUnitWorkIds.length > 0) {
      const rows = await prisma.tbDsUnitWork.findMany({
        where: { unit_work_id: { in: chgUnitWorkIds } }, select: { unit_work_id: true, unit_work_nm: true },
      });
      for (const r of rows) entityNameMap.set(`tb_ds_unit_work:${r.unit_work_id}`, r.unit_work_nm);
    }
    const chgScreenIds = [...(refIdsByTable.get("tb_ds_screen") ?? [])];
    if (chgScreenIds.length > 0) {
      const rows = await prisma.tbDsScreen.findMany({
        where: { scrn_id: { in: chgScreenIds } }, select: { scrn_id: true, scrn_nm: true },
      });
      for (const r of rows) entityNameMap.set(`tb_ds_screen:${r.scrn_id}`, r.scrn_nm);
    }
    const chgAreaIds = [...(refIdsByTable.get("tb_ds_area") ?? [])];
    if (chgAreaIds.length > 0) {
      const rows = await prisma.tbDsArea.findMany({
        where: { area_id: { in: chgAreaIds } }, select: { area_id: true, area_nm: true },
      });
      for (const r of rows) entityNameMap.set(`tb_ds_area:${r.area_id}`, r.area_nm);
    }
    const chgFunctionIds = [...(refIdsByTable.get("tb_ds_function") ?? [])];
    if (chgFunctionIds.length > 0) {
      const rows = await prisma.tbDsFunction.findMany({
        where: { func_id: { in: chgFunctionIds } }, select: { func_id: true, func_nm: true },
      });
      for (const r of rows) entityNameMap.set(`tb_ds_function:${r.func_id}`, r.func_nm);
    }
    const chgRequirementIds = [...(refIdsByTable.get("tb_rq_requirement") ?? [])];
    if (chgRequirementIds.length > 0) {
      const rows = await prisma.tbRqRequirement.findMany({
        where: { req_id: { in: chgRequirementIds } }, select: { req_id: true, req_nm: true },
      });
      for (const r of rows) entityNameMap.set(`tb_rq_requirement:${r.req_id}`, r.req_nm);
    }
    const chgUserStoryIds = [...(refIdsByTable.get("tb_rq_user_story") ?? [])];
    if (chgUserStoryIds.length > 0) {
      const rows = await prisma.tbRqUserStory.findMany({
        where: { story_id: { in: chgUserStoryIds } }, select: { story_id: true, story_nm: true },
      });
      for (const r of rows) entityNameMap.set(`tb_rq_user_story:${r.story_id}`, r.story_nm);
    }

    // 담당자/변경자/기여자/부하 1위 이름 일괄 조회 (N+1 방지)
    // 정체 미리보기·최근 변경·팀 활동 Top 기여자·팀 부하 1위에 등장하는 mberId 를 한 번에 모아 join.
    const memberIds = [
      ...new Set(
        [
          ...stalledItems.map((s) => s.row.asign_mber_id),
          ...recentChanges.map((c) => c.chg_mber_id),
          ...activityGroups.map((g) => g.chg_mber_id),
          topLoadMemberId,
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

    const requirementAvgPct = Math.round(requirementAvgAgg._avg.progrs_rt ?? 0);

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
        requirementAvgPct,
        screenDesignAvgPct,
        functionImplAvgPct,
      },
      stalled: {
        count: stalledCnt,
        items: stalledItems.map((s) => ({
          unitWorkId:       s.row.unit_work_id,
          displayId:        s.row.unit_work_display_id,
          name:             s.row.unit_work_nm,
          assignMemberName: s.row.asign_mber_id
            ? (memberDisplayMap.get(s.row.asign_mber_id) ?? null)
            : null,
          design: s.design,
          impl:   s.impl,
        })),
        designDelayedCount,
        functionDelayedCount,
      },
      recentChanges: recentChanges.map((c) => ({
        chgId:        c.chg_id,
        refTblNm:     c.ref_tbl_nm,
        refId:        c.ref_id,
        chgTypeCode:  c.chg_type_code,
        chgRsnCn:     c.chg_rsn_cn ?? null,
        chgMberEmail: c.chg_mber_id ? (memberDisplayMap.get(c.chg_mber_id) ?? null) : null,
        chgDt:        c.chg_dt.toISOString(),
        refName:      entityNameMap.get(`${c.ref_tbl_nm}:${c.ref_id}`) ?? null,
      })),
      teamActivity: {
        activeMemberCount: namedActivity.length,
        topContributors,
        topLoadMember: topLoadMemberId
          ? {
              displayName: memberDisplayMap.get(topLoadMemberId) ?? topLoadMemberId,
              activeLoad:  topLoadValue,
            }
          : null,
      },
      aiUsage: {
        monthCount,
        completedCount,
        inProgressCount,
        failedCount,
      },
      unassignedTotal,
    };

    return apiSuccess(response);
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/dashboard/manage-summary] DB 오류:`, err);
    return apiError("DB_ERROR", "관리 대시보드 데이터 조회에 실패했습니다.", 500);
  }
}
