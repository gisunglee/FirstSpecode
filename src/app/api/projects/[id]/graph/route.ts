/**
 * GET /api/projects/[id]/graph — 프로젝트 전체 계층 그래프
 *
 * 역할:
 *   - 과업(Task) → 요구사항(Requirement) → 단위업무(UnitWork) → 화면(Screen) → 영역(Area) → 기능(Function)
 *     6계층의 모든 노드와 관계(엣지)를 한 번에 반환
 *   - 그래프 시각화 페이지(GraphViewPage)에서 force-directed 레이아웃 데이터로 사용
 *
 * 응답 형식:
 *   {
 *     nodes: [{ id, type, label, displayId, name }],
 *     links: [{ source, target }],
 *     stats: { task, requirement, unitWork, screen, area, function }
 *   }
 *
 * 유의:
 *   - 노드 id 충돌 방지를 위해 타입 prefix 부여 ("task:xxx", "req:xxx" 등).
 *   - 대규모 프로젝트(>수천 노드)는 향후 on-demand 로딩으로 전환 필요.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// 노드 타입 — 그래프 페이지의 색상·필터 기준
export type GraphNodeType = "task" | "req" | "unit" | "screen" | "area" | "func";

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  // 프로젝트 멤버 인증
  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    // 6개 레이어 병렬 조회 — 각 레이어는 독립 테이블이라 Promise.all 로 전부 동시 로드
    // (스키마상 N+1 관계가 아니라 단순 FK 참조이므로 include 중첩보다 병렬 쿼리가 효율적)
    const [tasks, reqs, units, screens, areas, funcs] = await Promise.all([
      prisma.tbRqTask.findMany({
        where:  { prjct_id: projectId },
        select: { task_id: true, task_display_id: true, task_nm: true },
        orderBy: { sort_ordr: "asc" },
      }),
      prisma.tbRqRequirement.findMany({
        where:  { prjct_id: projectId },
        select: { req_id: true, req_display_id: true, req_nm: true, task_id: true },
        orderBy: { sort_ordr: "asc" },
      }),
      prisma.tbDsUnitWork.findMany({
        where:  { prjct_id: projectId },
        select: { unit_work_id: true, unit_work_display_id: true, unit_work_nm: true, req_id: true },
        orderBy: { sort_ordr: "asc" },
      }),
      prisma.tbDsScreen.findMany({
        where:  { prjct_id: projectId },
        select: { scrn_id: true, scrn_display_id: true, scrn_nm: true, unit_work_id: true },
        orderBy: { sort_ordr: "asc" },
      }),
      prisma.tbDsArea.findMany({
        where:  { prjct_id: projectId },
        select: { area_id: true, area_display_id: true, area_nm: true, scrn_id: true },
        orderBy: { sort_ordr: "asc" },
      }),
      prisma.tbDsFunction.findMany({
        where:  { prjct_id: projectId },
        select: { func_id: true, func_display_id: true, func_nm: true, area_id: true },
        orderBy: { sort_ordr: "asc" },
      }),
    ]);

    // ── 노드 구성 ─────────────────────────────────────────────────────────────
    // 공통 스키마: id(타입 prefix 포함 유일 키), type, label(displayId+name), displayId, name, refId(원본 ID)
    const nodes: Array<{ id: string; type: GraphNodeType; label: string; displayId: string; name: string; refId: string }> = [];

    for (const t of tasks) {
      nodes.push({
        id:        `task:${t.task_id}`,
        type:      "task",
        label:     `${t.task_display_id} ${t.task_nm}`.trim(),
        displayId: t.task_display_id,
        name:      t.task_nm,
        refId:     t.task_id,
      });
    }
    for (const r of reqs) {
      nodes.push({
        id:        `req:${r.req_id}`,
        type:      "req",
        label:     `${r.req_display_id} ${r.req_nm}`.trim(),
        displayId: r.req_display_id,
        name:      r.req_nm,
        refId:     r.req_id,
      });
    }
    for (const u of units) {
      nodes.push({
        id:        `unit:${u.unit_work_id}`,
        type:      "unit",
        label:     `${u.unit_work_display_id} ${u.unit_work_nm}`.trim(),
        displayId: u.unit_work_display_id,
        name:      u.unit_work_nm,
        refId:     u.unit_work_id,
      });
    }
    for (const s of screens) {
      nodes.push({
        id:        `screen:${s.scrn_id}`,
        type:      "screen",
        label:     `${s.scrn_display_id} ${s.scrn_nm}`.trim(),
        displayId: s.scrn_display_id,
        name:      s.scrn_nm,
        refId:     s.scrn_id,
      });
    }
    for (const a of areas) {
      nodes.push({
        id:        `area:${a.area_id}`,
        type:      "area",
        label:     `${a.area_display_id} ${a.area_nm}`.trim(),
        displayId: a.area_display_id,
        name:      a.area_nm,
        refId:     a.area_id,
      });
    }
    for (const f of funcs) {
      nodes.push({
        id:        `func:${f.func_id}`,
        type:      "func",
        label:     `${f.func_display_id} ${f.func_nm}`.trim(),
        displayId: f.func_display_id,
        name:      f.func_nm,
        refId:     f.func_id,
      });
    }

    // ── 엣지 구성 ─────────────────────────────────────────────────────────────
    // FK 가 null 인 경우(미연결 노드)는 엣지를 생성하지 않음 — 그래프상 고립 노드로 표시됨
    const links: Array<{ source: string; target: string }> = [];

    for (const r of reqs)    if (r.task_id)      links.push({ source: `task:${r.task_id}`,     target: `req:${r.req_id}` });
    for (const u of units)   if (u.req_id)       links.push({ source: `req:${u.req_id}`,       target: `unit:${u.unit_work_id}` });
    for (const s of screens) if (s.unit_work_id) links.push({ source: `unit:${s.unit_work_id}`, target: `screen:${s.scrn_id}` });
    for (const a of areas)   if (a.scrn_id)      links.push({ source: `screen:${a.scrn_id}`,   target: `area:${a.area_id}` });
    for (const f of funcs)   if (f.area_id)      links.push({ source: `area:${f.area_id}`,     target: `func:${f.func_id}` });

    return apiSuccess({
      nodes,
      links,
      stats: {
        task:     tasks.length,
        req:      reqs.length,
        unit:     units.length,
        screen:   screens.length,
        area:     areas.length,
        func:     funcs.length,
      },
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/graph] DB 오류:`, err);
    return apiError("DB_ERROR", "그래프 데이터 조회에 실패했습니다.", 500);
  }
}
