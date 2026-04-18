/**
 * GET    /api/projects/[id]/prompt-templates/[tmplId] — 프롬프트 템플릿 상세 조회
 * PUT    /api/projects/[id]/prompt-templates/[tmplId] — 프롬프트 템플릿 수정
 * DELETE /api/projects/[id]/prompt-templates/[tmplId] — 프롬프트 템플릿 삭제
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; tmplId: string }> };

// ── GET: 상세 조회 ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, tmplId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const t = await prisma.tbAiPromptTemplate.findUnique({
      where: { tmpl_id: tmplId },
    });

    if (!t || (t.prjct_id !== null && t.prjct_id !== projectId)) {
      return apiError("NOT_FOUND", "프롬프트 템플릿을 찾을 수 없습니다.", 404);
    }

    return apiSuccess({
      tmplId:      t.tmpl_id,
      projectId:   t.prjct_id      ?? null,
      isSystem:    t.prjct_id      === null,
      defaultYn:   t.default_yn,
      tmplNm:      t.tmpl_nm,
      taskTyCode:  t.task_ty_code,
      refTyCode:   t.ref_ty_code   ?? null,
      sysPromptCn: t.sys_prompt_cn ?? "",
      tmplDc:      t.tmpl_dc       ?? "",
      useYn:       t.use_yn,
      sortOrdr:    t.sort_ordr,
      useCnt:      t.use_cnt,
      creatMberId: t.creat_mber_id ?? null,
      creatDt:     t.creat_dt.toISOString(),
      mdfcnDt:     t.mdfcn_dt.toISOString(),
      myRole:      membership.role_code,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/prompt-templates/${tmplId}] DB 오류:`, err);
    return apiError("DB_ERROR", "프롬프트 템플릿 조회에 실패했습니다.", 500);
  }
}

// ── PUT: 수정 ─────────────────────────────────────────────────────────────────

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, tmplId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const {
    tmplNm, taskTyCode, refTyCode,
    sysPromptCn,
    tmplDc, useYn, sortOrdr,
  } = body as {
    tmplNm?:      string;
    taskTyCode?:  string;
    refTyCode?:   string | null;
    sysPromptCn?: string | null;
    tmplDc?:      string | null;
    useYn?:       string;
    sortOrdr?:    number;
  };

  if (!tmplNm?.trim()) {
    return apiError("VALIDATION_ERROR", "템플릿 명은 필수입니다.", 400);
  }

  const VALID_TASK_TYPES = ["INSPECT", "DESIGN", "IMPLEMENT", "MOCKUP", "IMPACT", "CUSTOM"];
  if (!taskTyCode || !VALID_TASK_TYPES.includes(taskTyCode)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 작업 유형입니다.", 400);
  }

  try {
    const existing = await prisma.tbAiPromptTemplate.findUnique({
      where:  { tmpl_id: tmplId },
    });

    if (!existing || (existing.prjct_id !== null && existing.prjct_id !== projectId)) {
      return apiError("NOT_FOUND", "프롬프트 템플릿을 찾을 수 없습니다.", 404);
    }

    await prisma.tbAiPromptTemplate.update({
      where: { tmpl_id: tmplId },
      data: {
        tmpl_nm:       tmplNm.trim(),
        task_ty_code:  taskTyCode,
        ref_ty_code:   refTyCode !== undefined ? (refTyCode ?? null) : existing.ref_ty_code,
        sys_prompt_cn: sysPromptCn !== undefined ? (sysPromptCn ?? null) : existing.sys_prompt_cn,
        tmpl_dc:       tmplDc !== undefined ? (tmplDc ?? null) : existing.tmpl_dc,
        use_yn:        useYn ?? existing.use_yn,
        sort_ordr:     sortOrdr ?? existing.sort_ordr,
        mdfcn_dt:      new Date(),
      },
    });

    return apiSuccess({ tmplId });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/prompt-templates/${tmplId}] DB 오류:`, err);
    return apiError("DB_ERROR", "프롬프트 템플릿 수정에 실패했습니다.", 500);
  }
}

// ── DELETE: 삭제 ──────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, tmplId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM"]);
  if (roleCheck) return roleCheck;

  try {
    const existing = await prisma.tbAiPromptTemplate.findUnique({
      where:  { tmpl_id: tmplId },
      select: { tmpl_id: true, prjct_id: true },
    });

    if (!existing || (existing.prjct_id !== null && existing.prjct_id !== projectId)) {
      return apiError("NOT_FOUND", "프롬프트 템플릿을 찾을 수 없습니다.", 404);
    }

    // 시스템 공통 템플릿은 삭제 불가 (운영자만 가능하도록 추후 분리)
    if (existing.prjct_id === null) {
      return apiError("FORBIDDEN", "시스템 공통 템플릿은 삭제할 수 없습니다.", 403);
    }

    await prisma.tbAiPromptTemplate.delete({ where: { tmpl_id: tmplId } });

    return apiSuccess({ tmplId, deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/prompt-templates/${tmplId}] DB 오류:`, err);
    return apiError("DB_ERROR", "프롬프트 템플릿 삭제에 실패했습니다.", 500);
  }
}
