/**
 * GET /api/projects/[id]/pm-summary
 *   — PM 대시보드 통합 요약 (3 위젯 데이터 한 번에)
 *
 * 역할:
 *   - 팀 부하 매트릭스 / 위험 워치리스트 / 우선순위 히트맵 데이터를 한 라운드트립으로
 *   - 모든 단위업무를 한 번 로드해 메모리 집계 — 프로젝트 단위업무는 통상 수백 이내라 안전
 *
 * 권한:
 *   - content.read (VIEWER 이상)
 *
 * 격리:
 *   - dashboard summary / activity / focus / calendar 와 별도 라우트
 *   - 위험 점수 산정은 lib/pm/riskScore.ts 순수 함수에 위임
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { buildRiskItem, rankRiskItems } from "@/lib/pm/riskScore";
import type {
  PmSummaryResponse,
  PriorityLevel,
  PriorityMatrix,
  PriorityStage,
  TeamLoadRow,
} from "@/types/pm";

type RouteParams = { params: Promise<{ id: string }> };

// 위험 워치리스트 노출 상한 — PM 이 한눈에 처리 가능한 수준.
// 더 보고 싶으면 단위업무 페이지에서 정렬·필터로.
const RISK_LIMIT = 10;

// 매우 큰 프로젝트 안전망 — 메모리 폭주 방지. 운영에서 도달하면 페이지네이션 도입 검토.
const HARD_LIMIT = 2000;

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayMs  = new Date(todayStr + "T00:00:00Z").getTime();
    const horizonStr = (() => {
      const d = new Date(todayMs);
      d.setUTCDate(d.getUTCDate() + 7);
      return d.toISOString().slice(0, 10);
    })();
    const MS_PER_DAY = 1000 * 60 * 60 * 24;

    // 단위업무 + 요구사항 join + 담당자ID 한 번에. 진척률 등 무거운 필드는 제외.
    const unitWorks = await prisma.tbDsUnitWork.findMany({
      where:  { prjct_id: projectId },
      select: {
        unit_work_id:         true,
        unit_work_display_id: true,
        unit_work_nm:         true,
        end_de:               true,
        progrs_rt:            true,
        asign_mber_id:        true,
        requirement: {
          select: { priort_code: true },
        },
      },
      take: HARD_LIMIT,
    });

    // 담당자 이름 일괄 조회 (N+1 방지)
    const assigneeIds = [
      ...new Set(unitWorks.map((u) => u.asign_mber_id).filter((v): v is string => !!v)),
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

    // ── B. 위험 항목 후보 (모든 단위업무 점수화) ──────────────────────────
    const riskCandidates = [];

    // ── C. 우선순위 매트릭스 (HIGH/MEDIUM/LOW × notStarted/inProgress/completed) ──
    const cells: PriorityMatrix["cells"] = {
      HIGH:   { notStarted: 0, inProgress: 0, completed: 0 },
      MEDIUM: { notStarted: 0, inProgress: 0, completed: 0 },
      LOW:    { notStarted: 0, inProgress: 0, completed: 0 },
    };

    // 한 번의 순회로 A·B·C 모두 누적
    for (const uw of unitWorks) {
      const progress = uw.progrs_rt;
      const endDate  = uw.end_de ?? null;
      const dDay: number | null = endDate
        ? Math.round((new Date(endDate + "T00:00:00Z").getTime() - todayMs) / MS_PER_DAY)
        : null;

      const reqPriorityRaw = uw.requirement.priort_code;
      // 허용 외 값 방어 — DB 에 잘못된 코드가 있어도 UI 깨지지 않도록 MEDIUM 폴백.
      const reqPriority: PriorityLevel =
        reqPriorityRaw === "HIGH"   ? "HIGH"   :
        reqPriorityRaw === "LOW"    ? "LOW"    :
        "MEDIUM";

      // 진행 단계 분류
      const stage: PriorityStage =
        progress >= 100 ? "completed" :
        progress > 0    ? "inProgress" :
                          "notStarted";

      // (C) 매트릭스 누적
      cells[reqPriority][stage]++;

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

      // (B) 위험 점수 — 모든 단위업무 평가, 점수 0 이하는 정렬 단계에서 제외
      riskCandidates.push(
        buildRiskItem({
          unitWorkId:   uw.unit_work_id,
          displayId:    uw.unit_work_display_id,
          name:         uw.unit_work_nm,
          endDate,
          dDay,
          progress,
          assigneeName: uw.asign_mber_id ? (nameMap.get(uw.asign_mber_id) ?? null) : null,
          reqPriority,
        })
      );
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

    // 행 합계
    const rowTotals: PriorityMatrix["rowTotals"] = {
      HIGH:   cells.HIGH.notStarted   + cells.HIGH.inProgress   + cells.HIGH.completed,
      MEDIUM: cells.MEDIUM.notStarted + cells.MEDIUM.inProgress + cells.MEDIUM.completed,
      LOW:    cells.LOW.notStarted    + cells.LOW.inProgress    + cells.LOW.completed,
    };

    const response: PmSummaryResponse = {
      teamLoad,
      riskItems:      rankRiskItems(riskCandidates, RISK_LIMIT),
      priorityMatrix: {
        cells,
        rowTotals,
        grandTotal: rowTotals.HIGH + rowTotals.MEDIUM + rowTotals.LOW,
      },
      generatedAt: new Date().toISOString(),
    };

    return apiSuccess(response);
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/pm-summary] DB 오류:`, err);
    return apiError("DB_ERROR", "PM 대시보드 데이터 조회에 실패했습니다.", 500);
  }
}
