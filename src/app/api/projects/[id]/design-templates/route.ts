/**
 * GET  /api/projects/[id]/design-templates — 설계 양식 목록 조회
 * POST /api/projects/[id]/design-templates — 설계 양식 생성
 *
 * 역할:
 *   - 해당 프로젝트의 양식 + 시스템 공통 양식(prjct_id=NULL)을 함께 반환
 *   - 대상 계층(ref_ty_code) / 사용여부 / 스코프 필터 지원
 *
 * 리스트 응답은 본문(example_cn/template_cn) 대신 존재 여부 플래그만 반환 →
 *   대용량 마크다운을 목록 전송 페이로드에서 제외해 성능 보호.
 */

import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { DESIGN_REF_TYPES } from "@/lib/designTemplate";

type RouteParams = { params: Promise<{ id: string }> };

// ── GET: 목록 조회 ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url         = new URL(request.url);
  const refTyCode   = url.searchParams.get("refType") ?? null;
  const useYnFilter = url.searchParams.get("useYn")   ?? null;
  // scope: "all"(기본) | "system"(공통만) | "project"(프로젝트만)
  const scope       = url.searchParams.get("scope")   ?? "all";

  try {
    // 단일 쿼리로 메타 + 본문까지 조회 후 서버에서 존재 여부 플래그만 계산.
    // 본문(example_cn/template_cn)은 최대 수십 KB 수준의 마크다운이므로
    // 네트워크 페이로드 우려가 있으나, 목록 페이지 데이터 건수가 크지 않고(5~수십)
    // DB 왕복 2회를 절감하는 편이 체감 성능에 유리.
    // 필요 시 response에서만 본문을 떼어 전송해 페이로드를 줄인다.
    const templates = await prisma.tbAiDesignTemplate.findMany({
      where: {
        ...(scope === "system"
          ? { prjct_id: null }
          : scope === "project"
            ? { prjct_id: projectId }
            : { OR: [{ prjct_id: projectId }, { prjct_id: null }] }),
        ...(refTyCode   ? { ref_ty_code: refTyCode }   : {}),
        ...(useYnFilter ? { use_yn:      useYnFilter } : {}),
      },
      orderBy: [
        { sort_ordr: "asc" },
        { creat_dt:  "asc" },
      ],
    });

    return apiSuccess(
      templates.map((t) => ({
        dsgnTmplId:  t.dsgn_tmpl_id,
        projectId:   t.prjct_id ?? null,
        isSystem:    t.prjct_id === null,
        refTyCode:   t.ref_ty_code,
        tmplNm:      t.tmpl_nm,
        tmplDc:      t.tmpl_dc ?? "",
        // 본문 존재 여부만 플래그로 전송 — 목록에는 전체 본문 불필요
        hasExample:  !!(t.example_cn  && t.example_cn.trim().length > 0),
        hasTemplate: !!(t.template_cn && t.template_cn.trim().length > 0),
        useYn:       t.use_yn,
        defaultYn:   t.default_yn,
        sortOrdr:    t.sort_ordr,
        creatMberId: t.creat_mber_id ?? null,
        creatDt:     t.creat_dt.toISOString(),
        mdfcnDt:     t.mdfcn_dt.toISOString(),
      }))
    );
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/design-templates] DB 오류:`, err);
    return apiError("DB_ERROR", "설계 양식 목록 조회에 실패했습니다.", 500);
  }
}

// ── POST: 생성 / 복사 ─────────────────────────────────────────────────────────
//
// 권한 (프롬프트 관리와 동일):
//   - 프로젝트 OWNER/ADMIN 만 생성/복사 가능 (SUPER_ADMIN 은 hasPermission short-circuit)
//
// 보안:
//   - prjct_id 는 항상 현재 projectId 로 강제 (body 주입 차단)
//   - default_yn 은 항상 "N" 으로 강제 (DEFAULT 로 승격 차단 — seed 로만 'Y' 가능)
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  // 프로젝트 역할 가드 — OWNER/ADMIN 만 (SUPER_ADMIN 은 위 hasPermission 에서 통과)
  if (gate.systemRole !== "SUPER_ADMIN"
    && gate.role !== "OWNER" && gate.role !== "ADMIN") {
    return apiError(
      "FORBIDDEN_PROJECT_ADMIN_REQUIRED",
      "프로젝트 관리자(OWNER/ADMIN)만 설계 양식을 생성/복사할 수 있습니다.",
      403
    );
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  // default_yn 은 의도적으로 구조 분해하지 않음 — body 에서 "Y" 주입해도 무시
  const {
    tmplNm, refTyCode, tmplDc,
    exampleCn, templateCn,
    useYn, sortOrdr,
  } = (body ?? {}) as {
    tmplNm?:     string;
    refTyCode?:  string;
    tmplDc?:     string | null;
    exampleCn?:  string | null;
    templateCn?: string | null;
    useYn?:      string;
    sortOrdr?:   number;
  };

  if (!tmplNm?.trim()) {
    return apiError("VALIDATION_ERROR", "템플릿 명은 필수입니다.", 400);
  }
  if (!refTyCode || !(DESIGN_REF_TYPES as readonly string[]).includes(refTyCode)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 대상 계층입니다.", 400);
  }

  try {
    const created = await prisma.tbAiDesignTemplate.create({
      data: {
        dsgn_tmpl_id:  randomUUID(),
        prjct_id:      projectId,           // 프로젝트 전용으로 고정
        ref_ty_code:   refTyCode,
        tmpl_nm:       tmplNm.trim(),
        tmpl_dc:       tmplDc     ?? null,
        example_cn:    exampleCn  ?? null,
        template_cn:   templateCn ?? null,
        use_yn:        useYn      ?? "Y",
        default_yn:    "N",                 // DEFAULT 승격 차단 (seed 로만 'Y' 가능)
        sort_ordr:     sortOrdr   ?? 0,
        creat_mber_id: gate.mberId,
        creat_dt:      new Date(),
        mdfcn_dt:      new Date(),
      },
    });

    return apiSuccess({ dsgnTmplId: created.dsgn_tmpl_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/design-templates] DB 오류:`, err);
    return apiError("DB_ERROR", "설계 양식 생성에 실패했습니다.", 500);
  }
}
