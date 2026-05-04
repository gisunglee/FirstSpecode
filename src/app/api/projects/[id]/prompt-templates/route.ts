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
import { ARTF_DIV, ARTF_FMT } from "@/constants/planStudio";
import { buildPromptDomainWhere, parsePromptDomain } from "@/lib/prompt-template/domain";

type RouteParams = { params: Promise<{ id: string }> };

// ── 검증 상수 ────────────────────────────────────────────────────────────────
// 일반 사용처(UNIT_WORK/SCREEN/AREA/FUNCTION)에서 허용되는 작업 유형
// (TEST 는 화면 전용이라 서버 저장 대상에서 제외)
const VALID_TASK_TYPES_GENERAL = ["INSPECT", "DESIGN", "IMPLEMENT", "MOCKUP", "IMPACT", "CUSTOM"];

// 기획실(PLAN_STUDIO_ARTF) 전용 작업 유형 — 단일값
const TASK_TYPE_PLAN_STUDIO = "PLAN_STUDIO_ARTF_GENERATE";

// 기획실 매트릭스 도메인 — constants/planStudio.ts 와 단일 진실의 원천 유지
const VALID_DIV_CODES = Object.keys(ARTF_DIV);  // ["IA", "JOURNEY", "FLOW", "MOCKUP", "ERD", "PROCESS"]
const VALID_FMT_CODES = Object.keys(ARTF_FMT);  // ["MD", "MERMAID", "HTML"]

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
  // 도메인 탭 필터 (general / plan-studio) — 잘못된 값은 무시(null) 후 전체 반환
  const domain       = parsePromptDomain(url.searchParams.get("domain"));
  // 기획실 탭 전용 — 산출물 구분(IA/JOURNEY/...) 으로 좁히기. domain 미지정이면 무시.
  const divCodeFilter = url.searchParams.get("divCode") ?? null;

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
        // 도메인 분류는 lib 헬퍼에서 일원화 — 서버·클라이언트 정의 일치 보장
        ...buildPromptDomainWhere(domain),
        // 기획실 도메인일 때만 div_code 필터 의미 있음 — 일반 도메인에는 div_code 가 NULL
        ...(domain === "plan-studio" && divCodeFilter ? { div_code: divCodeFilter } : {}),
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
        // 기획실(PLAN_STUDIO_ARTF) 전용 매트릭스 차원 — 그 외 사용처는 NULL
        divCode:      t.div_code      ?? null,
        fmtCode:      t.fmt_code      ?? null,
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
    divCode, fmtCode,
    sysPromptCn,
    tmplDc, useYn, sortOrdr,
  } = body as {
    tmplNm?:       string;
    taskTyCode?:   string;
    refTyCode?:    string | null;
    divCode?:      string | null;
    fmtCode?:      string | null;
    sysPromptCn?:  string | null;
    tmplDc?:       string | null;
    useYn?:        string;
    sortOrdr?:     number;
  };

  if (!tmplNm?.trim()) {
    return apiError("VALIDATION_ERROR", "템플릿 명은 필수입니다.", 400);
  }

  // ── 사용처별 작업 유형·매트릭스 검증 ────────────────────────────────────────
  // 기획실(PLAN_STUDIO_ARTF) 은 단일 task_ty_code + (div × fmt) 매트릭스 필수,
  // 그 외 사용처는 일반 task_ty_code 5종 중 하나, div/fmt 는 무시(NULL)
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
    // 비-기획실에서 div/fmt 가 넘어와도 무시 — DB 무결성 위반 방지
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
        div_code:      normalizedDivCode,
        fmt_code:      normalizedFmtCode,
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
