/**
 * GET  /api/projects/[id]/prompt-templates — AI 프롬프트 템플릿 목록 조회
 * POST /api/projects/[id]/prompt-templates — AI 프롬프트 템플릿 생성
 *
 * 역할:
 *   - 해당 프로젝트의 템플릿 + 시스템 공통 템플릿(prjct_id=NULL)을 함께 반환
 *   - sort_ordr ASC → creat_dt ASC 순 정렬
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ── GET: 목록 조회 ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  // 프로젝트 멤버 확인
  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  // 쿼리 파라미터
  const url          = new URL(request.url);
  const taskTyCode   = url.searchParams.get("taskType")  ?? null;
  const refTyCode    = url.searchParams.get("refType")   ?? null;
  const useYnFilter  = url.searchParams.get("useYn")     ?? null;

  try {
    const templates = await prisma.tbAiPromptTemplate.findMany({
      where: {
        // 해당 프로젝트 + 시스템 공통(prjct_id=null) 모두 포함
        OR: [
          { prjct_id: projectId },
          { prjct_id: null },
        ],
        ...(taskTyCode  ? { task_ty_code: taskTyCode }  : {}),
        ...(refTyCode   ? { ref_ty_code:  refTyCode }   : {}),
        ...(useYnFilter ? { use_yn:       useYnFilter } : {}),
      },
      orderBy: [
        { sort_ordr: "asc" },
        { creat_dt:  "asc" },
      ],
    });

    return apiSuccess(
      templates.map((t) => ({
        tmplId:       t.tmpl_id,
        projectId:    t.prjct_id ?? null,
        isSystem:     t.prjct_id === null, // 시스템 공통 템플릿 여부
        tmplNm:       t.tmpl_nm,
        taskTyCode:   t.task_ty_code,
        refTyCode:    t.ref_ty_code   ?? null,
        tmplDc:       t.tmpl_dc       ?? "",
        useYn:        t.use_yn,
        defaultYn:    t.default_yn,
        sortOrdr:     t.sort_ordr,
        useCnt:       t.use_cnt,
        creatMberId:  t.creat_mber_id ?? null,
        creatDt:      t.creat_dt.toISOString(),
        mdfcnDt:      t.mdfcn_dt.toISOString(),
      }))
    );
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/prompt-templates] DB 오류:`, err);
    return apiError("DB_ERROR", "프롬프트 템플릿 목록 조회에 실패했습니다.", 500);
  }
}

// ── POST: 생성 ────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const {
    tmplNm, taskTyCode, refTyCode,
    sysPromptCn,
    tmplDc, useYn, sortOrdr,
  } = body as {
    tmplNm?:       string;
    taskTyCode?:   string;
    refTyCode?:    string | null;
    sysPromptCn?:  string | null;
    tmplDc?:       string | null;
    useYn?:        string;
    sortOrdr?:     number;
  };

  if (!tmplNm?.trim()) {
    return apiError("VALIDATION_ERROR", "템플릿 명은 필수입니다.", 400);
  }

  const VALID_TASK_TYPES = ["INSPECT", "DESIGN", "IMPLEMENT", "MOCKUP", "IMPACT", "CUSTOM"];
  if (!taskTyCode || !VALID_TASK_TYPES.includes(taskTyCode)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 작업 유형입니다.", 400);
  }

  try {
    const { randomUUID } = await import("crypto");
    const created = await prisma.tbAiPromptTemplate.create({
      data: {
        tmpl_id:       randomUUID(),
        prjct_id:      projectId,
        tmpl_nm:       tmplNm.trim(),
        task_ty_code:  taskTyCode,
        ref_ty_code:   refTyCode   ?? null,
        sys_prompt_cn: sysPromptCn ?? null,
        tmpl_dc:       tmplDc      ?? null,
        use_yn:        useYn       ?? "Y",
        sort_ordr:     sortOrdr    ?? 0,
        use_cnt:       0,
        creat_mber_id: auth.mberId,
        creat_dt:      new Date(),
        mdfcn_dt:      new Date(),
      },
    });

    return apiSuccess({ tmplId: created.tmpl_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/prompt-templates] DB 오류:`, err);
    return apiError("DB_ERROR", "프롬프트 템플릿 생성에 실패했습니다.", 500);
  }
}
