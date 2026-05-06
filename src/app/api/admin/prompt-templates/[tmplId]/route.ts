/**
 * GET    /api/admin/prompt-templates/[tmplId] — DEFAULT 프롬프트 상세
 * PUT    /api/admin/prompt-templates/[tmplId] — DEFAULT 프롬프트 수정
 * DELETE /api/admin/prompt-templates/[tmplId] — (의도적 미지원) 403
 *
 * 권한: SUPER_ADMIN 전용 (requireSystemAdmin).
 *
 * 설계:
 *   - 이 라우트는 prjct_id=NULL 행만 다룬다. 다른 행 ID 추측 시 NOT_FOUND.
 *   - 삭제 차단 — DEFAULT 프롬프트가 사라지면 모든 프로젝트 AI 흐름에 영향.
 *   - default_yn 은 body 에서 받지 않음 — 스코프 변경 차단.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { ARTF_DIV, ARTF_FMT } from "@/constants/planStudio";

type RouteParams = { params: Promise<{ tmplId: string }> };

const VALID_TASK_TYPES_GENERAL = ["INSPECT", "DESIGN", "IMPLEMENT", "MOCKUP", "IMPACT", "CUSTOM"];
const TASK_TYPE_PLAN_STUDIO    = "PLAN_STUDIO_ARTF_GENERATE";
const VALID_DIV_CODES = Object.keys(ARTF_DIV);
const VALID_FMT_CODES = Object.keys(ARTF_FMT);

// ── GET: 단건 조회 (DEFAULT 만) ──────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { tmplId } = await params;

  try {
    const t = await prisma.tbAiPromptTemplate.findUnique({
      where: { tmpl_id: tmplId },
    });

    if (!t || t.prjct_id !== null) {
      return apiError("NOT_FOUND", "프롬프트 템플릿을 찾을 수 없습니다.", 404);
    }

    return apiSuccess({
      tmplId:      t.tmpl_id,
      projectId:   null,
      isSystem:    true,
      defaultYn:   t.default_yn,
      tmplNm:      t.tmpl_nm,
      taskTyCode:  t.task_ty_code,
      refTyCode:   t.ref_ty_code   ?? null,
      divCode:     t.div_code      ?? null,
      fmtCode:     t.fmt_code      ?? null,
      sysPromptCn: t.sys_prompt_cn ?? "",
      tmplDc:      t.tmpl_dc       ?? "",
      useYn:       t.use_yn,
      sortOrdr:    t.sort_ordr,
      useCnt:      t.use_cnt,
      creatMberId: t.creat_mber_id ?? null,
      creatDt:     t.creat_dt.toISOString(),
      mdfcnDt:     t.mdfcn_dt.toISOString(),
    });
  } catch (err) {
    console.error(`[GET /api/admin/prompt-templates/${tmplId}] DB 오류:`, err);
    return apiError("DB_ERROR", "프롬프트 템플릿 조회에 실패했습니다.", 500);
  }
}

// ── PUT: 수정 (DEFAULT 만) ───────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { tmplId } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  // body 의 default_yn / prjct_id 는 의도적으로 구조 분해하지 않음 — 주입 차단
  const {
    tmplNm, taskTyCode, refTyCode,
    divCode, fmtCode,
    sysPromptCn,
    tmplDc, useYn, sortOrdr,
  } = body as {
    tmplNm?:      string;
    taskTyCode?:  string;
    refTyCode?:   string | null;
    divCode?:     string | null;
    fmtCode?:     string | null;
    sysPromptCn?: string | null;
    tmplDc?:      string | null;
    useYn?:       string;
    sortOrdr?:    number;
  };

  if (!tmplNm?.trim()) {
    return apiError("VALIDATION_ERROR", "템플릿 명은 필수입니다.", 400);
  }

  // 사용처별 작업 유형·매트릭스 검증 (일반 API 와 동일)
  const isPlanStudio = refTyCode === "PLAN_STUDIO_ARTF";
  let normalizedDivCode: string | null = null;
  let normalizedFmtCode: string | null = null;

  if (isPlanStudio) {
    if (taskTyCode !== TASK_TYPE_PLAN_STUDIO) {
      return apiError("VALIDATION_ERROR",
        `기획실 산출물 템플릿의 작업 유형은 ${TASK_TYPE_PLAN_STUDIO} 여야 합니다.`, 400);
    }
    if (!divCode || !VALID_DIV_CODES.includes(divCode)) {
      return apiError("VALIDATION_ERROR", "유효하지 않은 산출물 구분(divCode)입니다.", 400);
    }
    if (!fmtCode || !VALID_FMT_CODES.includes(fmtCode)) {
      return apiError("VALIDATION_ERROR", "유효하지 않은 출력 형식(fmtCode)입니다.", 400);
    }
    normalizedDivCode = divCode;
    normalizedFmtCode = fmtCode;
  } else {
    if (!taskTyCode || !VALID_TASK_TYPES_GENERAL.includes(taskTyCode)) {
      return apiError("VALIDATION_ERROR", "유효하지 않은 작업 유형입니다.", 400);
    }
  }

  try {
    const existing = await prisma.tbAiPromptTemplate.findUnique({
      where: { tmpl_id: tmplId },
    });

    if (!existing || existing.prjct_id !== null) {
      return apiError("NOT_FOUND", "프롬프트 템플릿을 찾을 수 없습니다.", 404);
    }

    await prisma.tbAiPromptTemplate.update({
      where: { tmpl_id: tmplId },
      data: {
        tmpl_nm:       tmplNm.trim(),
        task_ty_code:  taskTyCode,
        ref_ty_code:   refTyCode !== undefined ? (refTyCode ?? null) : existing.ref_ty_code,
        div_code:      normalizedDivCode,
        fmt_code:      normalizedFmtCode,
        sys_prompt_cn: sysPromptCn !== undefined ? (sysPromptCn ?? null) : existing.sys_prompt_cn,
        tmpl_dc:       tmplDc !== undefined ? (tmplDc ?? null) : existing.tmpl_dc,
        use_yn:        useYn ?? existing.use_yn,
        sort_ordr:     sortOrdr ?? existing.sort_ordr,
        mdfcn_dt:      new Date(),
        // default_yn / prjct_id 는 건드리지 않음 — 스코프 고정
      },
    });

    return apiSuccess({ tmplId });
  } catch (err) {
    console.error(`[PUT /api/admin/prompt-templates/${tmplId}] DB 오류:`, err);
    return apiError("DB_ERROR", "프롬프트 템플릿 수정에 실패했습니다.", 500);
  }
}

// ── DELETE: 정책상 차단 ──────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, _ctx: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  return apiError(
    "FORBIDDEN_DEFAULT_IS_DELETE_PROTECTED",
    "기본 제공 프롬프트 템플릿은 UI 에서 삭제할 수 없습니다. DB 관리 경로로만 제거 가능합니다.",
    403
  );
}
