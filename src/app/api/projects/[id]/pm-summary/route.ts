/**
 * GET /api/projects/[id]/pm-summary
 *   — PM 진단 통합 요약 (위젯 데이터 한 번에)
 *
 * 역할:
 *   - 팀 부하 매트릭스 / 설계 지연 / 구현 지연 데이터를 한 라운드트립으로
 *   - 모든 단위업무를 한 번 로드해 메모리 집계 — 프로젝트 단위업무는 통상 수백 이내라 안전
 *
 * 권한:
 *   - content.read (VIEWER 이상)
 *
 * 격리:
 *   - dashboard summary / activity / focus / calendar 와 별도 라우트
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { buildDesignDelayRows, buildImplDelayRows, buildAnalysisDelayRows } from "@/lib/pm/delayStatus";
import { buildMissingStat } from "@/lib/pm/missingStatus";
import { parseEffortHours } from "@/lib/effort";
import { fetchUnitWorkProgress, combinePhaseProgress, resolveFunctionScreenDates } from "@/lib/pm/progressRollup";
import type { PmSummaryResponse, TeamLoadRow } from "@/types/pm";

type RouteParams = { params: Promise<{ id: string }> };

// 매우 큰 프로젝트 안전망 — 메모리 폭주 방지. 운영에서 도달하면 페이지네이션 도입 검토.
const HARD_LIMIT = 2000;

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  // 지연 기준일(asOf) — "오늘"이 아니라 특정 날짜 기준으로 지연/마감 상태를 보고 싶을 때
  // (지연 현황 위젯의 "기준일" 필터). 형식이 아니면 무시하고 실제 오늘로 폴백.
  const asOfParam = new URL(request.url).searchParams.get("asOf");
  const isValidDateStr = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

  try {
    const todayStr = isValidDateStr(asOfParam) ? asOfParam : new Date().toISOString().slice(0, 10);
    const todayMs  = new Date(todayStr + "T00:00:00Z").getTime();
    const horizonStr = (() => {
      const d = new Date(todayMs);
      d.setUTCDate(d.getUTCDate() + 7);
      return d.toISOString().slice(0, 10);
    })();

    // 단위업무 + 담당자ID 한 번에.
    const unitWorks = await prisma.tbDsUnitWork.findMany({
      where:  { prjct_id: projectId },
      select: {
        unit_work_id:         true,
        unit_work_display_id: true,
        unit_work_nm:         true,
        plan_dsgn_bgng_de:    true,
        plan_dsgn_end_de:     true,
        plan_dsgn_efrt_val:   true,
        asign_mber_id:        true,
      },
      take: HARD_LIMIT,
    });
    // 단위업무 실적 진행률(설계+구현 롤업) — 저장값이 아니라 항상 재계산(2026-07-28)
    const uwProgressMap = await fetchUnitWorkProgress(unitWorks.map((u) => u.unit_work_id));
    const uwProgress = (unitWorkId: string) => {
      const p = uwProgressMap.get(unitWorkId);
      return p ? combinePhaseProgress(p) : 0;
    };

    // ── 분석 지연 현황용 원본 조회 — 요구사항 (설계/구현과 마찬가지로 무거운 필드 제외) ──
    const requirements = await prisma.tbRqRequirement.findMany({
      where:  { prjct_id: projectId },
      select: { req_id: true, asign_mber_id: true, anls_bgng_de: true, anls_end_de: true, progrs_rt: true },
      take:   HARD_LIMIT,
    });

    // ── D. 지연 현황용 원본 조회 — 기능/영역/화면 (단위업무는 위에서 이미 조회) ──
    // 진척률 등 무거운 필드는 제외. 담당자 집계에 필요한 최소 컬럼만.
    const functions = await prisma.tbDsFunction.findMany({
      where:  { prjct_id: projectId },
      select: { func_id: true, area_id: true, asign_mber_id: true, impl_efrt_val: true },
      take:   HARD_LIMIT,
    });
    // 영역(TbDsArea)에는 담당자 컬럼이 없음 — scrn_id 로 화면 담당자를 역참조해서 사용 (아래 buildDesignDelayRows/buildImplDelayRows)
    const areas = await prisma.tbDsArea.findMany({
      where:  { prjct_id: projectId },
      select: { area_id: true, scrn_id: true },
      take:   HARD_LIMIT,
    });
    const screens = await prisma.tbDsScreen.findMany({
      where:  { prjct_id: projectId },
      select: {
        scrn_id: true, unit_work_id: true, asign_mber_id: true,
        actl_impl_bgng_de: true, actl_impl_end_de: true,
      },
      take:   HARD_LIMIT,
    });
    // 기능 → 소속 화면의 실질구현기간 — 중앙 헬퍼(lib/pm/progressRollup.ts)로 통일
    const funcScreenDates = resolveFunctionScreenDates(functions, areas, screens);
    // 기능 진척률 — TbCmProgress 다형 참조(ref_tbl_nm='tb_ds_function'), 없으면 0
    const funcIds = functions.map((f) => f.func_id);
    const funcProgress = funcIds.length > 0
      ? await prisma.tbCmProgress.findMany({
          where:  { ref_tbl_nm: "tb_ds_function", ref_id: { in: funcIds } },
          select: { ref_id: true, impl_rt: true },
        })
      : [];
    const funcImplRtMap = new Map(funcProgress.map((p) => [p.ref_id, p.impl_rt]));

    // 담당자 이름 일괄 조회 (N+1 방지) — 단위업무·기능·화면·요구사항 담당자 (영역은 담당자 컬럼이 없어 제외)
    const assigneeIds = [
      ...new Set(
        [
          ...unitWorks.map((u) => u.asign_mber_id),
          ...functions.map((f) => f.asign_mber_id),
          ...screens.map((s) => s.asign_mber_id),
          ...requirements.map((r) => r.asign_mber_id),
        ].filter((v): v is string => !!v)
      ),
    ];
    const members = assigneeIds.length > 0
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: assigneeIds } },
          select: { mber_id: true, mber_nm: true, email_addr: true },
        })
      : [];
    const nameMap = new Map(
      members.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null])
    );

    // ── A. 팀 부하 매트릭스 — 멤버별 통계 누적 ─────────────────────────────
    // 누적: { mberId → TeamLoadRow }
    const loadMap = new Map<string, TeamLoadRow>();
    for (const m of members) {
      loadMap.set(m.mber_id, {
        mberId:       m.mber_id,
        displayName:  m.mber_nm || m.email_addr || m.mber_id,
        total:        0,
        inProgress:   0,
        dueSoon:      0,
        overdue:      0,
        completed:    0,
        activeLoad:   0,
      });
    }

    // 한 번의 순회로 팀 부하(A)만 누적
    for (const uw of unitWorks) {
      const progress = uwProgress(uw.unit_work_id);
      const endDate  = uw.plan_dsgn_end_de ?? null;

      // 진행 단계 분류
      const stage: "notStarted" | "inProgress" | "completed" =
        progress >= 100 ? "completed" :
        progress > 0    ? "inProgress" :
                          "notStarted";

      // (A) 팀 부하 누적 — 담당자가 있을 때만
      if (uw.asign_mber_id) {
        let row = loadMap.get(uw.asign_mber_id);
        if (!row) {
          // 멤버 테이블에 없는 mberId(퇴장 멤버 등) — displayName 폴백
          row = {
            mberId:       uw.asign_mber_id,
            displayName:  nameMap.get(uw.asign_mber_id) ?? uw.asign_mber_id,
            total:        0,
            inProgress:   0,
            dueSoon:      0,
            overdue:      0,
            completed:    0,
            activeLoad:   0,
          };
          loadMap.set(uw.asign_mber_id, row);
        }
        row.total++;
        if (stage === "completed") {
          row.completed++;
        } else if (stage === "inProgress") {
          row.inProgress++;
        }
        // 마감 분류 — 진행 중·미시작 중에서만 의미가 있음
        if (progress < 100 && endDate) {
          if (endDate < todayStr) {
            row.overdue++;
          } else if (endDate <= horizonStr) {
            row.dueSoon++;
          }
        }
        // activeLoad 는 마지막에 일괄 계산 (위 분기에서 직접 더하면 중복 가능)
      }
    }

    // activeLoad 일괄 계산 — inProgress + dueSoon + overdue. 단, 셋이 겹칠 수 있는데
    // (예: 진행 중 + 마감 임박) 한 단위업무가 두 카운트에 모두 잡힌다.
    // 부하의 "느낌" 시각화가 목적이라 합산이 그대로 적절.
    for (const row of loadMap.values()) {
      row.activeLoad = row.inProgress + row.dueSoon + row.overdue;
    }

    // 정렬 — 활성 작업량 내림차순. 같으면 전체 담당 내림차순.
    const teamLoad: TeamLoadRow[] = [...loadMap.values()]
      .filter((r) => r.total > 0 || r.completed > 0) // 담당 0건인 멤버는 제외(노이즈)
      .sort((a, b) => {
        if (b.activeLoad !== a.activeLoad) return b.activeLoad - a.activeLoad;
        return b.total - a.total;
      });

    // ── D. 설계 지연 — 단위업무 기준 (2026-07-28 2차 개편, lib/pm/delayStatus.ts 순수 함수에 위임) ──
    const designDelay = buildDesignDelayRows({
      unitWorks: unitWorks.map((u) => ({
        unitWorkId:  u.unit_work_id,
        asignMberId: u.asign_mber_id,
        designEndDe: u.plan_dsgn_end_de,
        designEffortHours: parseEffortHours(u.plan_dsgn_efrt_val),
        avgDesignRt: uwProgressMap.get(u.unit_work_id)?.designRt ?? 0,
      })),
      todayStr,
      nameMap,
    });

    // ── E. 구현 지연 — 기능 기준 지연 판정 + 4계층 롤업 (lib/pm/delayStatus.ts 순수 함수에 위임) ──
    const implDelay = buildImplDelayRows({
      functions: functions.map((f) => ({
        funcId:      f.func_id,
        areaId:      f.area_id,
        asignMberId: f.asign_mber_id,
        effortHours: parseEffortHours(f.impl_efrt_val),
        implEndDe:   funcScreenDates.get(f.func_id)?.implEndDe ?? null,
        implRt:      funcImplRtMap.get(f.func_id) ?? 0,
      })),
      areas: areas.map((a) => ({
        areaId: a.area_id,
        scrnId: a.scrn_id,
      })),
      screens: screens.map((s) => ({
        scrnId:      s.scrn_id,
        unitWorkId:  s.unit_work_id,
        asignMberId: s.asign_mber_id,
      })),
      unitWorks: unitWorks.map((u) => ({
        unitWorkId:  u.unit_work_id,
        asignMberId: u.asign_mber_id,
      })),
      todayStr,
      nameMap,
    });

    // ── F. 분석 지연 — 요구사항 기준 (lib/pm/delayStatus.ts 순수 함수에 위임) ──
    const analysisDelay = buildAnalysisDelayRows({
      requirements: requirements.map((r) => ({
        reqId:         r.req_id,
        asignMberId:   r.asign_mber_id,
        analysisEndDe: r.anls_end_de,
        progress:      r.progrs_rt,
      })),
      todayStr,
      nameMap,
    });

    // 프로젝트 전체 분석 현황 요약 — 담당자 유무와 무관하게 전체 요구사항 기준
    const analysisSummary = {
      totalCount:   requirements.length,
      avgProgress:  requirements.length > 0
        ? Math.round(requirements.reduce((sum, r) => sum + r.progrs_rt, 0) / requirements.length)
        : 0,
      delayedCount: requirements.filter(
        (r) => !!r.anls_end_de && r.anls_end_de < todayStr && r.progrs_rt < 100
      ).length,
    };

    // ── G. 미지정 현황 — 담당자/일정/공수 입력 누락 (lib/pm/missingStatus.ts 순수 함수에 위임) ──
    // 이미 위에서 조회한 4개 배열을 그대로 재사용 — 추가 쿼리 없음.
    const missingSummary = [
      buildMissingStat(
        "REQUIREMENT", "요구사항",
        requirements.map((r) => ({ asignMberId: r.asign_mber_id, startDate: r.anls_bgng_de, endDate: r.anls_end_de })),
        false
      ),
      buildMissingStat(
        "UNIT_WORK", "단위업무",
        unitWorks.map((u) => ({ asignMberId: u.asign_mber_id, startDate: u.plan_dsgn_bgng_de, endDate: u.plan_dsgn_end_de })),
        false
      ),
      buildMissingStat(
        // 화면은 이제 자체 일정이 구현(actl_impl_*)뿐이라 그 기준으로 검사(설계 일정은
        // 단위업무 소관이라 위의 UNIT_WORK 항목에서 이미 검사됨). 공수 필드도 화면엔 없어 제외.
        "SCREEN", "화면",
        screens.map((s) => ({ asignMberId: s.asign_mber_id, startDate: s.actl_impl_bgng_de, endDate: s.actl_impl_end_de })),
        false
      ),
      buildMissingStat(
        "FUNCTION", "기능",
        functions.map((f) => {
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

    const response: PmSummaryResponse = {
      teamLoad,
      designDelay,
      implDelay,
      analysisDelay,
      analysisSummary,
      missingSummary,
      generatedAt: new Date().toISOString(),
    };

    return apiSuccess(response);
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/pm-summary] DB 오류:`, err);
    return apiError("DB_ERROR", "PM 진단 데이터 조회에 실패했습니다.", 500);
  }
}
