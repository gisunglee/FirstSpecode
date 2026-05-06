/**
 * GET    /api/admin/design-templates/[dsgnTmplId] — DEFAULT 설계 양식 상세
 * PUT    /api/admin/design-templates/[dsgnTmplId] — DEFAULT 설계 양식 수정
 * DELETE /api/admin/design-templates/[dsgnTmplId] — (의도적 미지원) 503
 *
 * 권한: SUPER_ADMIN 전용 (requireSystemAdmin).
 *
 * 설계:
 *   - 이 라우트는 prjct_id=NULL(시스템 공통) 행만 다룬다. 다른 행에 접근하면 NOT_FOUND.
 *   - 삭제는 정책상 차단 — DEFAULT 가 사라지면 모든 프로젝트의 AI 흐름에 영향 +
 *     복원 painful. 진짜 삭제가 필요하면 DB 직접 경로로만.
 *   - default_yn 은 의도적으로 body 에서 받지 않음 — 스코프 변경 차단.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { DESIGN_REF_TYPES } from "@/lib/designTemplate";

type RouteParams = { params: Promise<{ dsgnTmplId: string }> };

// ── GET: 단건 조회 (DEFAULT 만) ──────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { dsgnTmplId } = await params;

  try {
    const t = await prisma.tbAiDesignTemplate.findUnique({
      where: { dsgn_tmpl_id: dsgnTmplId },
    });

    // 시스템 공통 행만 — 프로젝트 행 ID 추측으로 접근하면 NOT_FOUND
    if (!t || t.prjct_id !== null) {
      return apiError("NOT_FOUND", "설계 양식을 찾을 수 없습니다.", 404);
    }

    // 영향받는 프롬프트 템플릿 — 같은 ref_ty_code, 사용 중, 시스템 또는 모든 프로젝트 영향 가능
    const [linkedCount, linkedPromptTemplates] = await Promise.all([
      prisma.tbAiPromptTemplate.count({
        where: {
          // admin 영역에서는 시스템 공통 + 모든 프로젝트 합산 카운트가 의미 있음
          ref_ty_code: t.ref_ty_code,
          use_yn:      "Y",
        },
      }),
      prisma.tbAiPromptTemplate.findMany({
        where: {
          ref_ty_code: t.ref_ty_code,
          use_yn:      "Y",
        },
        select: {
          tmpl_id:      true,
          tmpl_nm:      true,
          prjct_id:     true,
          task_ty_code: true,
          default_yn:   true,
        },
        take: 10,
        orderBy: [{ default_yn: "desc" }, { sort_ordr: "asc" }, { creat_dt: "asc" }],
      }),
    ]);

    return apiSuccess({
      dsgnTmplId:   t.dsgn_tmpl_id,
      projectId:    null,
      isSystem:     true,
      defaultYn:    t.default_yn,
      refTyCode:    t.ref_ty_code,
      tmplNm:       t.tmpl_nm,
      tmplDc:       t.tmpl_dc     ?? "",
      exampleCn:    t.example_cn  ?? "",
      templateCn:   t.template_cn ?? "",
      useYn:        t.use_yn,
      sortOrdr:     t.sort_ordr,
      creatMberId:  t.creat_mber_id ?? null,
      creatDt:      t.creat_dt.toISOString(),
      mdfcnDt:      t.mdfcn_dt.toISOString(),
      linkedPromptTemplateCount: linkedCount,
      linkedPromptTemplates: linkedPromptTemplates.map((p) => ({
        tmplId:     p.tmpl_id,
        tmplNm:     p.tmpl_nm,
        isSystem:   p.prjct_id === null,
        taskTyCode: p.task_ty_code,
        defaultYn:  p.default_yn,
      })),
    });
  } catch (err) {
    console.error(`[GET /api/admin/design-templates/${dsgnTmplId}] DB 오류:`, err);
    return apiError("DB_ERROR", "설계 양식 조회에 실패했습니다.", 500);
  }
}

// ── PUT: 수정 (DEFAULT 만) ───────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { dsgnTmplId } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  // body 의 default_yn / prjct_id 는 의도적으로 구조 분해하지 않음 — 주입 차단
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
    const existing = await prisma.tbAiDesignTemplate.findUnique({
      where: { dsgn_tmpl_id: dsgnTmplId },
    });

    if (!existing || existing.prjct_id !== null) {
      return apiError("NOT_FOUND", "설계 양식을 찾을 수 없습니다.", 404);
    }

    await prisma.tbAiDesignTemplate.update({
      where: { dsgn_tmpl_id: dsgnTmplId },
      data: {
        tmpl_nm:     tmplNm.trim(),
        ref_ty_code: refTyCode,
        tmpl_dc:     tmplDc     !== undefined ? (tmplDc ?? null)     : existing.tmpl_dc,
        example_cn:  exampleCn  !== undefined ? (exampleCn ?? null)  : existing.example_cn,
        template_cn: templateCn !== undefined ? (templateCn ?? null) : existing.template_cn,
        use_yn:      useYn    ?? existing.use_yn,
        sort_ordr:   sortOrdr ?? existing.sort_ordr,
        mdfcn_dt:    new Date(),
        // default_yn / prjct_id 는 건드리지 않음 — 스코프 고정
      },
    });

    return apiSuccess({ dsgnTmplId });
  } catch (err) {
    console.error(`[PUT /api/admin/design-templates/${dsgnTmplId}] DB 오류:`, err);
    return apiError("DB_ERROR", "설계 양식 수정에 실패했습니다.", 500);
  }
}

// ── DELETE: 정책상 차단 ──────────────────────────────────────────────────────
//
// DEFAULT 를 UI/API 로 삭제하는 경로를 의도적으로 막는다.
// 실수 1번이 모든 프로젝트의 AI 흐름을 망가뜨릴 수 있어, 진짜 제거가 필요하면
// DB 직접 작업으로만 가능. 라우트는 명확한 에러를 반환해 클라이언트가
// "이 경로로는 안 된다" 는 메시지를 그대로 띄울 수 있게 한다.
export async function DELETE(request: NextRequest, _ctx: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  return apiError(
    "FORBIDDEN_DEFAULT_IS_DELETE_PROTECTED",
    "기본 제공 설계 양식은 UI 에서 삭제할 수 없습니다. DB 관리 경로로만 제거 가능합니다.",
    403
  );
}
