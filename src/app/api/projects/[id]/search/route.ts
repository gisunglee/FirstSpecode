/**
 * GET /api/projects/[id]/search?q={keyword}&limit={n} — 전역 검색
 *
 * 역할:
 *   - 7개 엔티티(과업/요구사항/단위업무/화면/영역/기능/DB 테이블)를 이름·DisplayID로 UNION 검색
 *   - 사용자가 GNB 돋보기 또는 Ctrl+K 로 띄우는 GlobalSearchDialog 의 데이터 소스
 *   - 각 엔티티별 최대 `limit` 건(기본 5) → 총 최대 35건
 *
 * 검색 정책:
 *   - 대소문자 무시(insensitive), 부분 일치(contains)
 *   - 최소 2글자 — 서버에서도 가드 (프론트에서도 동일 체크)
 *   - DB 테이블은 Display ID 개념이 없어 물리명/논리명 둘 다 검색
 *   - AI 태스크는 대상에서 제외 (이름 필드 없음, UX 가독성 낮음)
 *
 * 성능:
 *   - prjct_id 인덱스 전제 (prisma/sql/add-search-indexes.sql)
 *   - Promise.all 로 7개 쿼리 병렬 실행
 *   - contains 는 ILIKE 라 B-tree 완전 활용은 못 하지만, prjct_id 필터로 스캔 범위가 작음
 *
 * 권한:
 *   - content.read 필요 (다른 목록 API 와 동일)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ── 응답 아이템 공통 스키마 ─────────────────────────────────────────────────
// DB 테이블만 displayId 대신 physclNm/lgclNm 을 가짐 — 프론트에서 타입별 분기 렌더
export type SearchResultItem =
  | { type: "task";     id: string; displayId: string; name: string }
  | { type: "req";      id: string; displayId: string; name: string }
  | { type: "unitWork"; id: string; displayId: string; name: string }
  | { type: "screen";   id: string; displayId: string; name: string }
  | { type: "area";     id: string; displayId: string; name: string }
  | { type: "func";     id: string; displayId: string; name: string }
  | { type: "dbTable";  id: string; physclNm: string; lgclNm: string | null };

export type SearchResponse = {
  query:   string;
  results: SearchResultItem[];
  // 타입별 건수 — 프론트에서 "과업 (3)" 같은 헤더 표시에 사용
  totalByType: Record<SearchResultItem["type"], number>;
};

// 최소 검색 글자 수 — 1글자는 결과 폭발 + 노이즈 많음
const MIN_QUERY_LENGTH = 2;
// 엔티티별 기본/최대 결과 건수 — 한 타입이 결과를 다 차지하지 못하도록 cap
const DEFAULT_LIMIT = 5;
const MAX_LIMIT     = 20;

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  // 권한: 프로젝트 구성원이면 누구나 검색 가능 (읽기 권한만 필요)
  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  // 쿼리 파라미터
  const url   = new URL(request.url);
  const qRaw  = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );

  // 최소 글자 가드 — 조기 반환으로 DB 히트 방지
  if (qRaw.length < MIN_QUERY_LENGTH) {
    const empty: SearchResponse = {
      query: qRaw,
      results: [],
      totalByType: { task: 0, req: 0, unitWork: 0, screen: 0, area: 0, func: 0, dbTable: 0 },
    };
    return apiSuccess(empty);
  }

  // Prisma 의 insensitive contains — Postgres ILIKE 로 번역됨
  const contains = { contains: qRaw, mode: "insensitive" as const };

  try {
    // 7개 엔티티 병렬 조회 — graph API 와 동일한 Promise.all 패턴
    const [tasks, reqs, units, screens, areas, funcs, dbTables] = await Promise.all([
      prisma.tbRqTask.findMany({
        where: {
          prjct_id: projectId,
          OR: [
            { task_nm:         contains },
            { task_display_id: contains },
          ],
        },
        select: { task_id: true, task_display_id: true, task_nm: true },
        take:   limit,
        orderBy: { task_display_id: "asc" },
      }),
      prisma.tbRqRequirement.findMany({
        where: {
          prjct_id: projectId,
          OR: [
            { req_nm:         contains },
            { req_display_id: contains },
          ],
        },
        select: { req_id: true, req_display_id: true, req_nm: true },
        take:   limit,
        orderBy: { req_display_id: "asc" },
      }),
      prisma.tbDsUnitWork.findMany({
        where: {
          prjct_id: projectId,
          OR: [
            { unit_work_nm:         contains },
            { unit_work_display_id: contains },
          ],
        },
        select: { unit_work_id: true, unit_work_display_id: true, unit_work_nm: true },
        take:   limit,
        orderBy: { unit_work_display_id: "asc" },
      }),
      prisma.tbDsScreen.findMany({
        where: {
          prjct_id: projectId,
          OR: [
            { scrn_nm:         contains },
            { scrn_display_id: contains },
          ],
        },
        select: { scrn_id: true, scrn_display_id: true, scrn_nm: true },
        take:   limit,
        orderBy: { scrn_display_id: "asc" },
      }),
      prisma.tbDsArea.findMany({
        where: {
          prjct_id: projectId,
          OR: [
            { area_nm:         contains },
            { area_display_id: contains },
          ],
        },
        select: { area_id: true, area_display_id: true, area_nm: true },
        take:   limit,
        orderBy: { area_display_id: "asc" },
      }),
      prisma.tbDsFunction.findMany({
        where: {
          prjct_id: projectId,
          OR: [
            { func_nm:         contains },
            { func_display_id: contains },
          ],
        },
        select: { func_id: true, func_display_id: true, func_nm: true },
        take:   limit,
        orderBy: { func_display_id: "asc" },
      }),
      prisma.tbDsDbTable.findMany({
        where: {
          prjct_id: projectId,
          OR: [
            { tbl_physcl_nm: contains },
            { tbl_lgcl_nm:   contains },
          ],
        },
        select: { tbl_id: true, tbl_physcl_nm: true, tbl_lgcl_nm: true },
        take:   limit,
        orderBy: { tbl_physcl_nm: "asc" },
      }),
    ]);

    // 공통 스키마로 변환
    // 결과 순서는 "분석 → 설계 → 공통 설계" 흐름으로 과업/요구사항/단위업무/화면/영역/기능/DB 순
    const results: SearchResultItem[] = [
      ...tasks.map((t) => ({
        type: "task" as const, id: t.task_id, displayId: t.task_display_id, name: t.task_nm,
      })),
      ...reqs.map((r) => ({
        type: "req" as const, id: r.req_id, displayId: r.req_display_id, name: r.req_nm,
      })),
      ...units.map((u) => ({
        type: "unitWork" as const, id: u.unit_work_id, displayId: u.unit_work_display_id, name: u.unit_work_nm,
      })),
      ...screens.map((s) => ({
        type: "screen" as const, id: s.scrn_id, displayId: s.scrn_display_id, name: s.scrn_nm,
      })),
      ...areas.map((a) => ({
        type: "area" as const, id: a.area_id, displayId: a.area_display_id, name: a.area_nm,
      })),
      ...funcs.map((f) => ({
        type: "func" as const, id: f.func_id, displayId: f.func_display_id, name: f.func_nm,
      })),
      ...dbTables.map((d) => ({
        type: "dbTable" as const, id: d.tbl_id, physclNm: d.tbl_physcl_nm, lgclNm: d.tbl_lgcl_nm,
      })),
    ];

    const response: SearchResponse = {
      query: qRaw,
      results,
      totalByType: {
        task:     tasks.length,
        req:      reqs.length,
        unitWork: units.length,
        screen:   screens.length,
        area:     areas.length,
        func:     funcs.length,
        dbTable:  dbTables.length,
      },
    };

    return apiSuccess(response);
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/search] DB 오류:`, err);
    return apiError("DB_ERROR", "검색 중 오류가 발생했습니다.", 500);
  }
}
