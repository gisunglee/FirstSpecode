/**
 * GET /api/projects/[id]/my-work
 *   — "내 업무" 페이지 통합 데이터 (개발자 개인용 스냅샷)
 *
 * 역할:
 *   - 로그인한 나(gate.mberId)를 기준으로 요구사항(분석)/단위업무/화면/기능 중 내가 담당자인 것
 *     전부를 마감 임박 순으로 나열(B)하고, 내가 담당하는 것들의 직속 자식 중 담당자가 없는 것을
 *     따로 모아 보여준다(C). 진척 요약(D)과 카운트 요약(A)도 같이 계산해서 한 번에 반환한다.
 *   - "PM 진단"은 위젯마다 독립 쿼리로 캐시를 안 섞는 원칙이었지만, 이 페이지는 "내 스냅샷 하나"라
 *     한 번의 라운드트립으로 A+B+C+D 를 전부 담아 반환한다(pm-summary 와 같은 방식).
 *
 * Query:
 *   asOf             — yyyy-MM-dd (선택, 없으면 실제 오늘 — 다른 pm-* 라우트와 동일 규칙)
 *   excludeCompleted — "true"/"false" (선택, 기본 true — B 리스트에서 progress=100 제외 여부)
 *
 * 권한:
 *   - content.read (VIEWER 이상) — "나"는 로그인한 본인 고정, 다른 멤버 조회 기능은 없음
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { computeDDay } from "@/lib/pm/deadlineProgress";
import { fetchDeadlineItems } from "@/lib/pm/fetchDeadlineItems";
import type { MyWorkItem, MyWorkItemKind, UnassignedChildItem, MissingScheduleItem, MissingScheduleField, MyWorkResponse } from "@/types/myWork";

type RouteParams = { params: Promise<{ id: string }> };

const HARD_LIMIT = 2000;
const DUE_SOON_DAYS = 3;

function isValidDateStr(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function avgOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;
  const myId = gate.mberId;

  const url = new URL(request.url);
  const asOfParam = url.searchParams.get("asOf");
  const excludeCompletedParam = url.searchParams.get("excludeCompleted");
  const excludeCompleted = excludeCompletedParam !== "false"; // 기본 true — "false" 명시할 때만 끔
  const todayStr = isValidDateStr(asOfParam) ? asOfParam : new Date().toISOString().slice(0, 10);

  try {
    // ── B. 내 업무 통합 리스트 — 4개 엔티티 병렬 조회 ────────────────────────
    // 단위업무/화면/기능은 구현(IMPL)·설계(DESIGN) 둘 다 조회해서 id로 짝짓는다 — 리스트 하나에
    // 여러 엔티티가 섞여 있는데 "진척률"이 행마다 다른 기준(화면=설계, 나머지=구현)이면 숫자만
    // 봐서는 뭘 보는지 헷갈린다는 피드백으로, 설계·구현을 나란히 다 보여주기로 함.
    // 완료 필터(progress<100)는 항상 구현(impl) 기준 — "설계만 끝나고 구현 안 된 것"까지
    // 완료로 착각해 리스트에서 사라지면 안 되기 때문에, 대표값(progress)은 구현 고정.
    const [myRequirements, unitWorkImpl, unitWorkDesign, screenImpl, screenDesign, functionImpl, functionDesign, project] = await Promise.all([
      prisma.tbRqRequirement.findMany({
        where:  { prjct_id: projectId, asign_mber_id: myId },
        select: { req_id: true, req_display_id: true, req_nm: true, anls_bgng_de: true, anls_end_de: true, progrs_rt: true },
        take:   HARD_LIMIT,
      }),
      fetchDeadlineItems(projectId, "UNIT_WORK", "IMPL", myId),
      fetchDeadlineItems(projectId, "UNIT_WORK", "DESIGN", myId),
      fetchDeadlineItems(projectId, "SCREEN", "IMPL", myId),
      fetchDeadlineItems(projectId, "SCREEN", "DESIGN", myId),
      fetchDeadlineItems(projectId, "FUNCTION", "IMPL", myId),
      fetchDeadlineItems(projectId, "FUNCTION", "DESIGN", myId),
      // 구현/설계 토글의 최초 기본값 계산용 — 프로젝트 설정(일정 탭)의 계획설계 종료일만 필요
      prisma.tbPjProject.findUnique({ where: { prjct_id: projectId }, select: { dsgn_end_de: true } }),
    ]);

    // 기준일(todayStr, asOf 파라미터 반영)이 계획설계 종료일 이전이면 아직 분석·설계 기간 도중이라
    // "설계"를, 지났으면 "구현"을 최초 기본 탭으로 추천. 종료일 미설정(단계일정 안 잡음)이면
    // 판단 근거가 없어 기존 기본값이었던 "구현"으로 폴백.
    const designEndStr = project?.dsgn_end_de ? project.dsgn_end_de.toISOString().slice(0, 10) : null;
    const recommendedPhase: "DESIGN" | "IMPL" = designEndStr && todayStr <= designEndStr ? "DESIGN" : "IMPL";

    // IMPL 배열 기준으로 순회하며 같은 id의 DESIGN 값(진척률+마감일)을 붙인다(둘 다 같은
    // 담당자 필터로 조회했으니 id 집합은 동일 — 짝이 없으면 폴백만 해두고 실제로는 항상 매칭됨).
    // 설계 마감일도 진척률과 같은 패턴으로 둘 다 내려서(designProgress 옆에 designEndDate)
    // "구현 마감일 하나만 봐서는 설계 지연 여부를 알 수 없다"는 문제를 없앤다.
    function withDesign<T extends { id: string; progress: number; endDate: string | null }>(implRows: T[], designRows: T[]) {
      const designMap = new Map(designRows.map((r) => [r.id, { progress: r.progress, endDate: r.endDate }]));
      return implRows.map((r) => {
        const d = designMap.get(r.id);
        return { ...r, designProgress: d?.progress ?? 0, designEndDate: d?.endDate ?? null };
      });
    }
    // docStatus는 IMPL/DESIGN 조회 어느 쪽으로 받아도 같은 값(단일 컬럼, phase 구분 없음) —
    // withDesign이 IMPL 배열 기준으로 순회하므로 그 배열의 docStatus를 그대로 쓰면 됨.
    const unitWorkRaw = withDesign(unitWorkImpl, unitWorkDesign);
    const screenRaw   = withDesign(screenImpl, screenDesign);
    const functionRaw = withDesign(functionImpl, functionDesign);

    const rawItems: { kind: MyWorkItemKind; id: string; displayId: string; name: string; href: string; startDate: string | null; endDate: string | null; progress: number; designProgress: number | null; designEndDate: string | null; effort: string | null; docStatus: string | null }[] = [
      ...myRequirements.map((r) => ({
        kind: "REQUIREMENT" as const, id: r.req_id, displayId: r.req_display_id, name: r.req_nm,
        href: `/projects/${projectId}/requirements/${r.req_id}`,
        startDate: r.anls_bgng_de, endDate: r.anls_end_de, progress: r.progrs_rt, designProgress: null, designEndDate: null, effort: null,
        docStatus: null,
      })),
      ...unitWorkRaw.map((r) => ({ kind: "UNIT_WORK" as const, ...r })),
      ...screenRaw.map((r) => ({ kind: "SCREEN" as const, ...r })),
      ...functionRaw.map((r) => ({ kind: "FUNCTION" as const, ...r })),
    ];

    const itemsAll: MyWorkItem[] = rawItems.map((r) => ({
      kind: r.kind, id: r.id, displayId: r.displayId, name: r.name, href: r.href,
      startDate: r.startDate, endDate: r.endDate, progress: r.progress, designProgress: r.designProgress,
      designEndDate: r.designEndDate, docStatus: r.docStatus,
      dDay: r.endDate ? computeDDay(r.endDate, todayStr) : null,
      designDDay: r.designEndDate ? computeDDay(r.designEndDate, todayStr) : null,
    }));

    const items = excludeCompleted ? itemsAll.filter((it) => it.progress < 100) : itemsAll;
    items.sort((a, b) => {
      if (a.dDay === null && b.dDay === null) return a.name.localeCompare(b.name);
      if (a.dDay === null) return 1;
      if (b.dDay === null) return -1;
      if (a.dDay !== b.dDay) return a.dDay - b.dDay;
      return a.name.localeCompare(b.name);
    });

    // ── E. 내 업무 미설정 — B와 같은 완료 제외 기준, 시작일/종료일/공수 중 하나라도 비면 포함 ──
    // 공수는 화면(design_efrt_val)/기능(efrt_val)에만 존재하는 필드라 요구사항·단위업무는 검사 대상에서 뺀다.
    const missingSchedule: MissingScheduleItem[] = (excludeCompleted ? rawItems.filter((r) => r.progress < 100) : rawItems)
      .map((r) => {
        const missingFields: MissingScheduleField[] = [];
        if (!r.startDate) missingFields.push("시작일");
        if (!r.endDate) missingFields.push("종료일");
        if ((r.kind === "SCREEN" || r.kind === "FUNCTION") && !r.effort?.trim()) missingFields.push("공수");
        return { kind: r.kind, id: r.id, displayId: r.displayId, name: r.name, href: r.href, missingFields };
      })
      .filter((r) => r.missingFields.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    // ── D. 진척 요약 — 위 배열로 그룹 평균 계산(추가 쿼리 없음) ───────────────
    // 단위업무/화면/기능은 구현·설계 평균을 둘 다 계산 — 프론트에서 스위치로 골라본다
    // (행마다 기준이 달라서 헷갈린다는 피드백으로, 하나로 고정하지 않고 둘 다 내려줌).
    const progressSummary = {
      analysis: avgOrNull(myRequirements.map((r) => r.progrs_rt)),
      unitWork: { impl: avgOrNull(unitWorkRaw.map((r) => r.progress)), design: avgOrNull(unitWorkRaw.map((r) => r.designProgress)) },
      screen:   { impl: avgOrNull(screenRaw.map((r) => r.progress)),   design: avgOrNull(screenRaw.map((r) => r.designProgress)) },
      function: { impl: avgOrNull(functionRaw.map((r) => r.progress)), design: avgOrNull(functionRaw.map((r) => r.designProgress)) },
    };

    // ── C. 하위 담당자 미지정 — 내가 담당하는 요구사항/단위업무/화면의 직속 자식 ──
    const myReqIds = myRequirements.map((r) => r.req_id);
    const myUnitWorkIds = unitWorkRaw.map((r) => r.id);
    const myScreenIds = screenRaw.map((r) => r.id);

    const [unassignedUnitWorks, unassignedScreens, unassignedFunctions] = await Promise.all([
      myReqIds.length > 0
        ? prisma.tbDsUnitWork.findMany({
            where:  { req_id: { in: myReqIds }, asign_mber_id: null },
            select: { unit_work_id: true, unit_work_display_id: true, unit_work_nm: true, requirement: { select: { req_nm: true } } },
            take:   HARD_LIMIT,
          })
        : [],
      myUnitWorkIds.length > 0
        ? prisma.tbDsScreen.findMany({
            where:  { unit_work_id: { in: myUnitWorkIds }, asign_mber_id: null },
            select: { scrn_id: true, scrn_display_id: true, scrn_nm: true, unitWork: { select: { unit_work_nm: true } } },
            take:   HARD_LIMIT,
          })
        : [],
      myScreenIds.length > 0
        ? prisma.tbDsFunction.findMany({
            where:  { asign_mber_id: null, area: { scrn_id: { in: myScreenIds } } },
            select: { func_id: true, func_display_id: true, func_nm: true, area: { select: { screen: { select: { scrn_nm: true } } } } },
            take:   HARD_LIMIT,
          })
        : [],
    ]);

    const unassignedChildren: UnassignedChildItem[] = [
      ...unassignedUnitWorks.map((u) => ({
        parentKind: "REQUIREMENT" as const, parentName: u.requirement.req_nm,
        childKind: "UNIT_WORK" as const, id: u.unit_work_id, displayId: u.unit_work_display_id, name: u.unit_work_nm,
        href: `/projects/${projectId}/unit-works/${u.unit_work_id}`,
      })),
      ...unassignedScreens.map((s) => ({
        parentKind: "UNIT_WORK" as const, parentName: s.unitWork?.unit_work_nm ?? "(단위업무 없음)",
        childKind: "SCREEN" as const, id: s.scrn_id, displayId: s.scrn_display_id, name: s.scrn_nm,
        href: `/projects/${projectId}/screens/${s.scrn_id}`,
      })),
      ...unassignedFunctions.map((f) => ({
        parentKind: "SCREEN" as const, parentName: f.area?.screen?.scrn_nm ?? "(화면 없음)",
        childKind: "FUNCTION" as const, id: f.func_id, displayId: f.func_display_id, name: f.func_nm,
        href: `/projects/${projectId}/functions/${f.func_id}`,
      })),
    ];

    // ── A. 요약 카운트 — B/C 결과에서 파생(추가 쿼리 없음) ─────────────────
    const response: MyWorkResponse = {
      summary: {
        totalMine: itemsAll.length,
        overdueCount: itemsAll.filter((it) => it.dDay !== null && it.dDay < 0).length,
        dueSoonCount: itemsAll.filter((it) => it.dDay !== null && it.dDay >= 0 && it.dDay <= DUE_SOON_DAYS).length,
        unassignedChildrenCount: unassignedChildren.length,
      },
      items,
      unassignedChildren,
      missingSchedule,
      progressSummary,
      recommendedPhase,
      asOf: todayStr,
    };

    return apiSuccess(response);
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/my-work] DB 오류:`, err);
    return apiError("DB_ERROR", "내 업무 조회에 실패했습니다.", 500);
  }
}
