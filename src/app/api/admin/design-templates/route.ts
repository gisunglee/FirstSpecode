/**
 * GET  /api/admin/design-templates — 시스템 공통(DEFAULT) 설계 양식 목록
 * POST /api/admin/design-templates — DEFAULT 설계 양식 신규 생성
 *
 * 권한: SUPER_ADMIN 전용 (requireSystemAdmin).
 *
 * 역할:
 *   - tb_ai_design_template 중 prjct_id=NULL (시스템 공통) 만 다룸
 *   - 프로젝트 컨텍스트 없이 동작 — 어떤 프로젝트의 데이터도 건드리지 않음
 *   - 신규 생성 시 default_yn='Y' + prjct_id=NULL 로 강제
 *     (일반 페이지 POST 는 default_yn='N' + prjct_id=projectId 로 강제하므로
 *      두 경로가 만들어내는 데이터가 자연스럽게 분리됨)
 *
 * 일반 페이지 API(/api/projects/[id]/design-templates) 와 분리한 이유:
 *   - admin 작업은 특정 프로젝트 컨텍스트 위에서 동작하지 않아야 함
 *   - SUPER_ADMIN 권한 검증은 한 번의 tb_cm_member 조회로 끝
 *     (멤버십·플랜·역할 조회 불필요)
 *   - 향후 audit 로그 부착이 자연스러움
 */

import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { DESIGN_REF_TYPES } from "@/lib/designTemplate";

// ── GET: DEFAULT 양식 목록 ───────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const url         = new URL(request.url);
  const refTyCode   = url.searchParams.get("refType") ?? null;
  const useYnFilter = url.searchParams.get("useYn")   ?? null;

  try {
    // 시스템 공통(prjct_id=NULL) 만 — admin 페이지는 다른 프로젝트의 양식을 보지 않음
    const templates = await prisma.tbAiDesignTemplate.findMany({
      where: {
        prjct_id: null,
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
        projectId:   null,         // 항상 null (시스템 공통)
        isSystem:    true,
        refTyCode:   t.ref_ty_code,
        tmplNm:      t.tmpl_nm,
        tmplDc:      t.tmpl_dc ?? "",
        // 본문 존재 여부만 플래그로 전송 — 일반 페이지 API 와 동일 응답 형식
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
    console.error("[GET /api/admin/design-templates] DB 오류:", err);
    return apiError("DB_ERROR", "설계 양식 목록 조회에 실패했습니다.", 500);
  }
}

// ── POST: DEFAULT 양식 신규 생성 ──────────────────────────────────────────────
//
// admin 경로에서만 default_yn='Y' + prjct_id=NULL 로 행을 생성할 수 있다.
// 일반 페이지 POST 는 default_yn='N' + prjct_id=projectId 로 강제하므로
// 두 경로가 자연스럽게 분리된 데이터를 만든다.
export async function POST(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

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
        prjct_id:      null,                // 시스템 공통 강제
        ref_ty_code:   refTyCode,
        tmpl_nm:       tmplNm.trim(),
        tmpl_dc:       tmplDc     ?? null,
        example_cn:    exampleCn  ?? null,
        template_cn:   templateCn ?? null,
        use_yn:        useYn      ?? "Y",
        default_yn:    "Y",                 // DEFAULT 강제 — admin 경로의 정체성
        sort_ordr:     sortOrdr   ?? 0,
        creat_mber_id: gate.mberId,
        creat_dt:      new Date(),
        mdfcn_dt:      new Date(),
      },
    });

    return apiSuccess({ dsgnTmplId: created.dsgn_tmpl_id }, 201);
  } catch (err) {
    console.error("[POST /api/admin/design-templates] DB 오류:", err);
    return apiError("DB_ERROR", "설계 양식 생성에 실패했습니다.", 500);
  }
}
