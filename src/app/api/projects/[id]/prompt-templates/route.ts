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
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ── GET: 목록 조회 ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

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

// ── POST: 생성 / 복사 ─────────────────────────────────────────────────────────
//
// 권한:
//   - 프로젝트 OWNER/ADMIN 만 생성/복사 가능 (SUPER_ADMIN 은 hasPermission short-circuit 으로 자동 통과)
//   - UI 의 "이 템플릿 복사" 버튼도 동일 역할에게만 노출해 일관성 유지
//
// 보안:
//   - prjct_id 는 항상 현재 projectId 로 강제 (body 주입 차단)
//   - default_yn 은 항상 "N" 으로 강제 (DEFAULT 로 승격 차단 — seed 로만 생성 가능)
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  // 프로젝트 역할 가드 — OWNER/ADMIN 만 (SUPER_ADMIN 은 위 hasPermission 에서 통과)
  if (gate.systemRole !== "SUPER_ADMIN"
    && gate.role !== "OWNER" && gate.role !== "ADMIN") {
    return apiError(
      "FORBIDDEN_PROJECT_ADMIN_REQUIRED",
      "프로젝트 관리자(OWNER/ADMIN)만 템플릿을 생성/복사할 수 있습니다.",
      403
    );
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  // default_yn 은 의도적으로 구조 분해하지 않음 — body 에서 "Y" 주입해도 무시
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
        prjct_id:      projectId,   // 현재 프로젝트 강제
        tmpl_nm:       tmplNm.trim(),
        task_ty_code:  taskTyCode,
        ref_ty_code:   refTyCode   ?? null,
        sys_prompt_cn: sysPromptCn ?? null,
        tmpl_dc:       tmplDc      ?? null,
        use_yn:        useYn       ?? "Y",
        default_yn:    "N",         // DEFAULT 승격 차단 (seed 로만 'Y' 가능)
        sort_ordr:     sortOrdr    ?? 0,
        use_cnt:       0,
        creat_mber_id: gate.mberId,
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
