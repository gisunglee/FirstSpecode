/**
 * GET  /api/projects/[id]/test-specs        — 테스트 명세서 목록 조회
 * POST /api/projects/[id]/test-specs        — 테스트 명세서 신규 생성 (단위/통합)
 *
 * Query (GET):
 *   - kind?       UNIT | INTEGRATION (없으면 전체)
 *   - unitWorkId? 특정 단위업무에 연결된 명세서만 (단위테스트는 1:1, 통합은 N:M)
 *
 * Body (POST):
 *   - testKindCode: "UNIT" | "INTEGRATION"
 *   - testSpecNm:   string (필수)
 *   - testSpecDc?:  string
 *   - asignMemberId?: string
 *   - unitWorkIds?: string[]  연결할 단위업무 (선택)
 *   - screenIds?:   string[]  연결할 화면 (선택)
 *   - displayId?:   string (없으면 TS-NNNNN 자동 채번)
 *
 *   매핑 정책:
 *     - UNIT: 단위업무 0~1개 + 화면 N개. 최소 한 종류 1개 이상.
 *     - INTEGRATION: 단위업무 N개 + 화면 N개. 최소 한 종류 1개 이상.
 *     - 단위 테스트는 보통 화면 단위로 작성하고, 통합 테스트는 단위업무가 자연스러움.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { getIdPrefix } from "@/lib/idPrefix";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";

type RouteParams = { params: Promise<{ id: string }> };

// 진척률을 0~100 정수로 강제 (잘못된 입력은 0)
// 화면 드롭다운은 10단위지만 서버는 범위만 보장하고 값은 그대로 보관
function clampProgress(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  const n = Math.round(v);
  if (n < 0)   return 0;
  if (n > 100) return 100;
  return n;
}

// ─── GET: 목록 조회 ─────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url        = new URL(request.url);
  const kind       = url.searchParams.get("kind")       ?? undefined;     // UNIT | INTEGRATION
  const unitWorkId = url.searchParams.get("unitWorkId") ?? undefined;

  try {
    const items = await prisma.tbQaTestSpec.findMany({
      where: {
        prjct_id:       projectId,
        ...(kind && { test_kind_code: kind }),
        // 매핑된 단위업무로 필터 — uwLinks 안에 unitWorkId 가 있는 명세서만
        ...(unitWorkId && {
          uwLinks: { some: { unit_work_id: unitWorkId } },
        }),
      },
      include: {
        uwLinks: {
          include: { unitWork: { select: { unit_work_display_id: true, unit_work_nm: true } } },
        },
        screenLinks: {
          include: { screen: { select: { scrn_display_id: true, scrn_nm: true } } },
          orderBy: { sort_ordr: "asc" },
        },
        _count: { select: { cases: true, rounds: true } },
      },
      orderBy: [{ sort_ordr: "asc" }, { creat_dt: "desc" }],
    });

    // 클라이언트 친화 형태로 변환
    const data = items.map((s) => ({
      testSpecId:        s.test_spec_id,
      displayId:         s.test_spec_display_id,
      testKindCode:      s.test_kind_code,
      testSpecNm:        s.test_spec_nm,
      testSpecDc:        s.test_spec_dc,
      sttusCode:         s.sttus_code,
      asignMemberId:     s.asign_mber_id,
      prgrsRt:           s.prgrs_rt,
      unitWorks:         s.uwLinks.map((u) => ({
                           unitWorkId: u.unit_work_id,
                           displayId:  u.unitWork?.unit_work_display_id ?? null,
                           name:       u.unitWork?.unit_work_nm ?? null,
                         })),
      screens:           s.screenLinks.map((sl) => ({
                           screenId:  sl.scrn_id,
                           displayId: sl.screen?.scrn_display_id ?? null,
                           name:      sl.screen?.scrn_nm ?? null,
                         })),
      caseCount:         s._count.cases,
      roundCount:        s._count.rounds,
      createdAt:         s.creat_dt,
      updatedAt:         s.mdfcn_dt,
    }));

    return apiSuccess({ items: data, totalCount: data.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/test-specs] DB 오류:`, err);
    return apiError("DB_ERROR", "테스트 명세서 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 신규 생성 ────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { testKindCode, testSpecNm, testSpecDc, asignMemberId, prgrsRt, unitWorkIds, screenIds, displayId: inputDisplayId } = body as {
    testKindCode?:  string;
    testSpecNm?:    string;
    testSpecDc?:    string;
    asignMemberId?: string;
    prgrsRt?:       number;
    unitWorkIds?:   string[];
    screenIds?:     string[];
    displayId?:     string;
  };

  // 입력 검증
  if (testKindCode !== "UNIT" && testKindCode !== "INTEGRATION") {
    return apiError("VALIDATION_ERROR", "테스트 종류는 UNIT 또는 INTEGRATION 이어야 합니다.", 400);
  }
  if (!testSpecNm?.trim()) {
    return apiError("VALIDATION_ERROR", "명세서명을 입력해 주세요.", 400);
  }
  const uwList     = Array.isArray(unitWorkIds) ? unitWorkIds : [];
  const screenList = Array.isArray(screenIds)   ? screenIds   : [];
  // 단위업무 또는 화면 중 최소 한 종류는 1개 이상 — 둘 다 비면 "테스트 대상" 이 모호해진다
  if (uwList.length === 0 && screenList.length === 0) {
    return apiError("VALIDATION_ERROR", "연결할 단위업무 또는 화면을 1개 이상 선택해 주세요.", 400);
  }

  const limitErr = apiTextLimitGuard([
    ["name",       testSpecNm],
    ["description", testSpecDc],
    ["displayId",  inputDisplayId],
  ]);
  if (limitErr) return limitErr;

  // 프로젝트 소속 검증 — UW/화면 양쪽 다 (보안)
  if (uwList.length > 0) {
    const uws = await prisma.tbDsUnitWork.findMany({
      where: { unit_work_id: { in: uwList }, prjct_id: projectId },
      select: { unit_work_id: true },
    });
    if (uws.length !== uwList.length) {
      return apiError("NOT_FOUND", "선택한 단위업무 중 존재하지 않는 항목이 있습니다.", 404);
    }
  }
  if (screenList.length > 0) {
    const scrs = await prisma.tbDsScreen.findMany({
      where: { scrn_id: { in: screenList }, prjct_id: projectId },
      select: { scrn_id: true },
    });
    if (scrs.length !== screenList.length) {
      return apiError("NOT_FOUND", "선택한 화면 중 존재하지 않는 항목이 있습니다.", 404);
    }
  }

  try {
    // displayId — 사용자 입력 우선, 없으면 TS-NNNNN 자동 채번
    let displayId: string;
    if (inputDisplayId?.trim()) {
      displayId = inputDisplayId.trim();
    } else {
      const last = await prisma.tbQaTestSpec.findFirst({
        where:   { prjct_id: projectId },
        orderBy: { test_spec_display_id: "desc" },
        select:  { test_spec_display_id: true },
      });
      const nextSeq = last
        ? (parseInt(last.test_spec_display_id.replace(/\D/g, "")) || 0) + 1
        : 1;
      const prefix = await getIdPrefix(projectId, "TEST_SPEC");
      displayId = `${prefix}-${String(nextSeq).padStart(5, "0")}`;
    }

    // sort_ordr 마지막 + 1
    const maxSort = await prisma.tbQaTestSpec.findFirst({
      where:   { prjct_id: projectId },
      orderBy: { sort_ordr: "desc" },
      select:  { sort_ordr: true },
    });

    // 단일 트랜잭션 — spec 생성 + uwLinks + screenLinks 일괄 매핑
    const spec = await prisma.$transaction(async (tx) => {
      const created = await tx.tbQaTestSpec.create({
        data: {
          prjct_id:             projectId,
          test_spec_display_id: displayId,
          test_kind_code:       testKindCode,
          test_spec_nm:         testSpecNm.trim(),
          test_spec_dc:         testSpecDc?.trim() || null,
          asign_mber_id:        asignMemberId || null,
          // 진척률 — 0~100 범위 강제, 그 외 입력은 0 으로 fallback
          prgrs_rt:             clampProgress(prgrsRt),
          sort_ordr:            (maxSort?.sort_ordr ?? 0) + 1,
        },
      });
      if (uwList.length > 0) {
        await tx.tbQaTestSpecUw.createMany({
          data: uwList.map((uwId, i) => ({
            test_spec_id: created.test_spec_id,
            unit_work_id: uwId,
            sort_ordr:    i,
          })),
        });
      }
      if (screenList.length > 0) {
        await tx.tbQaTestSpecScreen.createMany({
          data: screenList.map((scrId, i) => ({
            test_spec_id: created.test_spec_id,
            scrn_id:      scrId,
            sort_ordr:    i,
          })),
        });
      }
      return created;
    });

    return apiSuccess({
      testSpecId: spec.test_spec_id,
      displayId:  spec.test_spec_display_id,
    }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/test-specs] DB 오류:`, err);
    return apiError("DB_ERROR", "테스트 명세서 생성에 실패했습니다.", 500);
  }
}
