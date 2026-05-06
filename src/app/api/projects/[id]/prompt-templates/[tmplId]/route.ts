/**
 * GET    /api/projects/[id]/prompt-templates/[tmplId] — 프롬프트 템플릿 상세 조회
 * PUT    /api/projects/[id]/prompt-templates/[tmplId] — 프롬프트 템플릿 수정
 * DELETE /api/projects/[id]/prompt-templates/[tmplId] — 프롬프트 템플릿 삭제
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { ARTF_DIV, ARTF_FMT } from "@/constants/planStudio";

type RouteParams = { params: Promise<{ id: string; tmplId: string }> };

// ── 검증 상수 ────────────────────────────────────────────────────────────────
// (POST/PUT 양쪽에서 동일한 규칙. 정의는 ../route.ts 와 일치 — 리팩터링 시 헬퍼 추출 검토)
const VALID_TASK_TYPES_GENERAL = ["INSPECT", "DESIGN", "IMPLEMENT", "MOCKUP", "IMPACT", "CUSTOM"];
const TASK_TYPE_PLAN_STUDIO    = "PLAN_STUDIO_ARTF_GENERATE";
const VALID_DIV_CODES = Object.keys(ARTF_DIV);
const VALID_FMT_CODES = Object.keys(ARTF_FMT);

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
      // 기획실 매트릭스 차원 — 그 외 사용처는 NULL
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
      myRole:      membership.role_code,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/prompt-templates/${tmplId}] DB 오류:`, err);
    return apiError("DB_ERROR", "프롬프트 템플릿 조회에 실패했습니다.", 500);
  }
}

// ── PUT: 수정 ─────────────────────────────────────────────────────────────────
//
// 이중 권한 가드:
//   ① DEFAULT(시스템 공통) — prjct_id=NULL OR default_yn='Y'
//        → SUPER_ADMIN(sys_role_code) 만 수정 가능
//   ② 프로젝트 복사본 — prjct_id=projectId AND default_yn='N'
//        → 프로젝트 OWNER/ADMIN 만 수정 가능 (종전 5개 역할에서 축소)
// SUPER_ADMIN 은 hasPermission short-circuit 으로 ②도 자동 통과.
//
// default_yn 승격/강등 주입 차단 — body 에 defaultYn 필드를 받지 않음(아래 구조 분해).
// 스코프는 seed/DB 관리자만 변경 가능.
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, tmplId } = await params;

  // content.update 기반 1차 가드 — 멤버십·플랜·역할·시스템역할 컨텍스트 확보
  const gate = await requirePermission(request, projectId, "content.update");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  // body 에서 default_yn 은 의도적으로 구조 분해하지 않음 — 주입 시도 무시
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

  // ── 사용처별 작업 유형·매트릭스 검증 (POST 와 동일 규칙) ─────────────────────
  // PUT 은 부분 업데이트 성격이 강하지만, refTyCode/divCode/fmtCode 가 명시적으로
  // 변경되는 경우에는 일관성을 깨뜨리지 않도록 함께 검증한다.
  const isPlanStudio = refTyCode === "PLAN_STUDIO_ARTF";
  let normalizedDivCode: string | null = null;
  let normalizedFmtCode: string | null = null;

  if (isPlanStudio) {
    if (taskTyCode !== TASK_TYPE_PLAN_STUDIO) {
      return apiError(
        "VALIDATION_ERROR",
        `기획실 산출물 템플릿의 작업 유형은 ${TASK_TYPE_PLAN_STUDIO} 여야 합니다.`,
        400
      );
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
    // 비-기획실에서 div/fmt 가 넘어와도 무시 — DB 무결성 위반 방지 (NULL 강제)
  }

  try {
    const existing = await prisma.tbAiPromptTemplate.findUnique({
      where:  { tmpl_id: tmplId },
    });

    if (!existing || (existing.prjct_id !== null && existing.prjct_id !== projectId)) {
      return apiError("NOT_FOUND", "프롬프트 템플릿을 찾을 수 없습니다.", 404);
    }

    // 2차 가드 — DEFAULT vs 프로젝트 복사본 분기
    const isDefault = existing.prjct_id === null || existing.default_yn === "Y";
    if (isDefault) {
      if (gate.systemRole !== "SUPER_ADMIN") {
        return apiError(
          "FORBIDDEN_DEFAULT_REQUIRES_SUPER_ADMIN",
          "기본 제공 프롬프트 템플릿은 시스템 관리자(SUPER_ADMIN)만 수정할 수 있습니다.",
          403
        );
      }
    } else {
      // 프로젝트 사본 — OWNER/ADMIN 또는 PM/PL 만 수정 가능
      if (gate.systemRole !== "SUPER_ADMIN"
        && gate.role !== "OWNER" && gate.role !== "ADMIN"
        && gate.job !== "PM"   && gate.job !== "PL") {
        return apiError(
          "FORBIDDEN_PROJECT_ADMIN_OR_PM_REQUIRED",
          "프로젝트 관리자(OWNER/ADMIN) 또는 PM/PL 만 수정할 수 있습니다.",
          403
        );
      }
    }

    await prisma.tbAiPromptTemplate.update({
      where: { tmpl_id: tmplId },
      data: {
        tmpl_nm:       tmplNm.trim(),
        task_ty_code:  taskTyCode,
        ref_ty_code:   refTyCode !== undefined ? (refTyCode ?? null) : existing.ref_ty_code,
        // div_code/fmt_code 는 사용처가 PLAN_STUDIO_ARTF 일 때만 값 유지, 그 외는 NULL 로 정리
        div_code:      normalizedDivCode,
        fmt_code:      normalizedFmtCode,
        sys_prompt_cn: sysPromptCn !== undefined ? (sysPromptCn ?? null) : existing.sys_prompt_cn,
        tmpl_dc:       tmplDc !== undefined ? (tmplDc ?? null) : existing.tmpl_dc,
        use_yn:        useYn ?? existing.use_yn,
        sort_ordr:     sortOrdr ?? existing.sort_ordr,
        mdfcn_dt:      new Date(),
        // default_yn 은 의도적으로 건드리지 않음 — 스코프 승격/강등 차단
      },
    });

    return apiSuccess({ tmplId });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/prompt-templates/${tmplId}] DB 오류:`, err);
    return apiError("DB_ERROR", "프롬프트 템플릿 수정에 실패했습니다.", 500);
  }
}

// ── DELETE: 삭제 ──────────────────────────────────────────────────────────────
//
// PUT 과 동일한 이중 권한 가드:
//   ① DEFAULT(시스템 공통) → SUPER_ADMIN 만
//   ② 프로젝트 복사본 → 프로젝트 OWNER/ADMIN 만
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, tmplId } = await params;

  const gate = await requirePermission(request, projectId, "content.delete");
  if (gate instanceof Response) return gate;

  try {
    const existing = await prisma.tbAiPromptTemplate.findUnique({
      where:  { tmpl_id: tmplId },
      select: { tmpl_id: true, prjct_id: true, default_yn: true },
    });

    if (!existing || (existing.prjct_id !== null && existing.prjct_id !== projectId)) {
      return apiError("NOT_FOUND", "프롬프트 템플릿을 찾을 수 없습니다.", 404);
    }

    const isDefault = existing.prjct_id === null || existing.default_yn === "Y";
    if (isDefault) {
      // DEFAULT 는 UI·API 어느 경로로도 삭제 불가 (SUPER_ADMIN 조차도).
      // 실수로 삭제되면 모든 프로젝트의 AI 요청에 영향 + 복원 painful.
      // 진짜 제거가 필요하면 seed/DB 관리 경로로만 가능.
      return apiError(
        "FORBIDDEN_DEFAULT_IS_DELETE_PROTECTED",
        "기본 제공 프롬프트 템플릿은 UI 에서 삭제할 수 없습니다. DB 관리 경로로만 제거 가능합니다.",
        403
      );
    }
    // 프로젝트 복사본 — OWNER/ADMIN 또는 PM/PL 만 (SUPER_ADMIN 도 허용)
    if (gate.systemRole !== "SUPER_ADMIN"
      && gate.role !== "OWNER" && gate.role !== "ADMIN"
      && gate.job !== "PM"   && gate.job !== "PL") {
      return apiError(
        "FORBIDDEN_PROJECT_ADMIN_OR_PM_REQUIRED",
        "프로젝트 관리자(OWNER/ADMIN) 또는 PM/PL 만 삭제할 수 있습니다.",
        403
      );
    }

    await prisma.tbAiPromptTemplate.delete({ where: { tmpl_id: tmplId } });

    return apiSuccess({ tmplId, deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/prompt-templates/${tmplId}] DB 오류:`, err);
    return apiError("DB_ERROR", "프롬프트 템플릿 삭제에 실패했습니다.", 500);
  }
}
