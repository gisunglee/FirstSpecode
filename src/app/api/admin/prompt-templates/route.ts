/**
 * GET  /api/admin/prompt-templates — 시스템 공통(DEFAULT) AI 프롬프트 템플릿 목록
 * POST /api/admin/prompt-templates — DEFAULT 프롬프트 템플릿 신규 생성
 *
 * 권한: SUPER_ADMIN 전용 (requireSystemAdmin).
 *
 * 역할:
 *   - tb_ai_prompt_template 중 prjct_id=NULL (시스템 공통) 만 다룸
 *   - 신규 생성 시 default_yn='Y' + prjct_id=NULL 로 강제
 *
 * 일반 페이지 API(/api/projects/[id]/prompt-templates) 와의 분리 이유는
 * design-templates admin API 의 역할 주석 참조.
 */

import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { ARTF_DIV, ARTF_FMT } from "@/constants/planStudio";
import { buildPromptDomainWhere, parsePromptDomain } from "@/lib/prompt-template/domain";

// ── 검증 상수 (일반 API 와 동일 규칙) ────────────────────────────────────────
const VALID_TASK_TYPES_GENERAL = ["INSPECT", "DESIGN", "IMPLEMENT", "MOCKUP", "IMPACT", "CUSTOM"];
const TASK_TYPE_PLAN_STUDIO    = "PLAN_STUDIO_ARTF_GENERATE";
const VALID_DIV_CODES = Object.keys(ARTF_DIV);
const VALID_FMT_CODES = Object.keys(ARTF_FMT);

// 시스템 프롬프트 미리보기 — 200자 절단
const SYS_PROMPT_PREVIEW_LEN = 200;
function buildSysPromptPreview(raw: string | null): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  return trimmed.length > SYS_PROMPT_PREVIEW_LEN
    ? trimmed.slice(0, SYS_PROMPT_PREVIEW_LEN) + "…"
    : trimmed;
}

// ── GET: DEFAULT 프롬프트 목록 ──────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const url           = new URL(request.url);
  const taskTyCode    = url.searchParams.get("taskType")  ?? null;
  const refTyCode     = url.searchParams.get("refType")   ?? null;
  const useYnFilter   = url.searchParams.get("useYn")     ?? null;
  const domain        = parsePromptDomain(url.searchParams.get("domain"));
  const divCodeFilter = url.searchParams.get("divCode") ?? null;
  const fmtCodeFilter = url.searchParams.get("fmtCode") ?? null;

  try {
    const templates = await prisma.tbAiPromptTemplate.findMany({
      where: {
        // 시스템 공통(prjct_id=null) 만 — admin 페이지는 다른 프로젝트의 템플릿을 보지 않음
        prjct_id: null,
        ...(taskTyCode  ? { task_ty_code: taskTyCode }  : {}),
        ...(refTyCode   ? { ref_ty_code:  refTyCode }   : {}),
        ...(useYnFilter ? { use_yn:       useYnFilter } : {}),
        ...buildPromptDomainWhere(domain),
        ...(domain === "plan-studio" && divCodeFilter ? { div_code: divCodeFilter } : {}),
        ...(domain === "plan-studio" && fmtCodeFilter ? { fmt_code: fmtCodeFilter } : {}),
      },
      orderBy: [
        { sort_ordr: "asc" },
        { creat_dt:  "asc" },
      ],
    });

    return apiSuccess(
      templates.map((t) => ({
        tmplId:           t.tmpl_id,
        projectId:        null,
        isSystem:         true,
        tmplNm:           t.tmpl_nm,
        taskTyCode:       t.task_ty_code,
        refTyCode:        t.ref_ty_code   ?? null,
        divCode:          t.div_code      ?? null,
        fmtCode:          t.fmt_code      ?? null,
        tmplDc:           t.tmpl_dc       ?? "",
        sysPromptPreview: buildSysPromptPreview(t.sys_prompt_cn),
        useYn:            t.use_yn,
        defaultYn:        t.default_yn,
        sortOrdr:         t.sort_ordr,
        useCnt:           t.use_cnt,
        creatMberId:      t.creat_mber_id ?? null,
        creatDt:          t.creat_dt.toISOString(),
        mdfcnDt:          t.mdfcn_dt.toISOString(),
      }))
    );
  } catch (err) {
    console.error("[GET /api/admin/prompt-templates] DB 오류:", err);
    return apiError("DB_ERROR", "프롬프트 템플릿 목록 조회에 실패했습니다.", 500);
  }
}

// ── POST: DEFAULT 프롬프트 신규 생성 ────────────────────────────────────────
export async function POST(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

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
    const created = await prisma.tbAiPromptTemplate.create({
      data: {
        tmpl_id:       randomUUID(),
        prjct_id:      null,                // 시스템 공통 강제
        tmpl_nm:       tmplNm.trim(),
        task_ty_code:  taskTyCode,
        ref_ty_code:   refTyCode   ?? null,
        div_code:      normalizedDivCode,
        fmt_code:      normalizedFmtCode,
        sys_prompt_cn: sysPromptCn ?? null,
        tmpl_dc:       tmplDc      ?? null,
        use_yn:        useYn       ?? "Y",
        default_yn:    "Y",                 // DEFAULT 강제
        sort_ordr:     sortOrdr    ?? 0,
        use_cnt:       0,
        creat_mber_id: gate.mberId,
        creat_dt:      new Date(),
        mdfcn_dt:      new Date(),
      },
    });

    return apiSuccess({ tmplId: created.tmpl_id }, 201);
  } catch (err) {
    console.error("[POST /api/admin/prompt-templates] DB 오류:", err);
    return apiError("DB_ERROR", "프롬프트 템플릿 생성에 실패했습니다.", 500);
  }
}
