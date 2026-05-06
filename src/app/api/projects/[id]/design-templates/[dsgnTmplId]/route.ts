/**
 * GET    /api/projects/[id]/design-templates/[dsgnTmplId] — 상세 조회
 * PUT    /api/projects/[id]/design-templates/[dsgnTmplId] — 수정
 * DELETE /api/projects/[id]/design-templates/[dsgnTmplId] — 삭제
 *
 * 권한 / 가드 (2026-04-24 이중 권한 가드 — 프롬프트 관리와 동일):
 *   - 상세 조회: 프로젝트 ACTIVE 멤버
 *   - 수정:
 *        · DEFAULT (prjct_id=NULL OR default_yn='Y') → SUPER_ADMIN 만
 *        · 프로젝트 복사본 → 프로젝트 OWNER/ADMIN 만 (종전 5개 역할에서 축소)
 *   - 삭제:
 *        · DEFAULT → 누구도 UI/API 로 삭제 불가 (DB 관리 경로로만)
 *        · 프로젝트 복사본 → 프로젝트 OWNER/ADMIN 만
 *
 * 상세 조회 응답에는 "이 양식과 같은 ref_ty_code 를 쓰는 프롬프트 템플릿" 카운트와
 * 상위 10건을 함께 반환 — 사용자에게 "양식 변경 시 영향 범위"를 힌트로 제공.
 * 자동 동기화는 하지 않는다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { DESIGN_REF_TYPES } from "@/lib/designTemplate";

type RouteParams = { params: Promise<{ id: string; dsgnTmplId: string }> };

// ── GET: 상세 조회 ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, dsgnTmplId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const t = await prisma.tbAiDesignTemplate.findUnique({
      where: { dsgn_tmpl_id: dsgnTmplId },
    });

    // 다른 프로젝트의 양식은 접근 불가 (시스템 공통은 허용)
    if (!t || (t.prjct_id !== null && t.prjct_id !== projectId)) {
      return apiError("NOT_FOUND", "설계 양식을 찾을 수 없습니다.", 404);
    }

    // 영향받는 프롬프트 템플릿 — 같은 ref_ty_code, 사용 중, 공통 또는 이 프로젝트
    const [linkedCount, linkedPromptTemplates] = await Promise.all([
      prisma.tbAiPromptTemplate.count({
        where: {
          OR: [{ prjct_id: projectId }, { prjct_id: null }],
          ref_ty_code: t.ref_ty_code,
          use_yn:      "Y",
        },
      }),
      prisma.tbAiPromptTemplate.findMany({
        where: {
          OR: [{ prjct_id: projectId }, { prjct_id: null }],
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
        // 기본 템플릿 먼저, 그 다음 정렬 순서
        orderBy: [{ default_yn: "desc" }, { sort_ordr: "asc" }, { creat_dt: "asc" }],
      }),
    ]);

    return apiSuccess({
      dsgnTmplId:   t.dsgn_tmpl_id,
      projectId:    t.prjct_id ?? null,
      isSystem:     t.prjct_id === null,
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
      myRole:       membership.role_code,
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
    console.error(`[GET /api/projects/${projectId}/design-templates/${dsgnTmplId}] DB 오류:`, err);
    return apiError("DB_ERROR", "설계 양식 조회에 실패했습니다.", 500);
  }
}

// ── PUT: 수정 ─────────────────────────────────────────────────────────────────
//
// 이중 권한 가드 (프롬프트 관리와 동일 패턴):
//   ① DEFAULT(시스템 공통) — prjct_id=NULL OR default_yn='Y'
//        → SUPER_ADMIN(sys_role_code) 만 수정 가능
//   ② 프로젝트 복사본 — prjct_id=projectId AND default_yn='N'
//        → 프로젝트 OWNER/ADMIN 만 수정 가능 (종전 5개 역할에서 축소)
// SUPER_ADMIN 은 hasPermission short-circuit 으로 ② 도 자동 통과.
// default_yn 승격/강등 주입 차단 — body 에 defaultYn 필드를 받지 않음.
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, dsgnTmplId } = await params;

  const gate = await requirePermission(request, projectId, "content.update");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  // body 에서 default_yn 은 의도적으로 구조 분해하지 않음 — 주입 시도 무시
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

    if (!existing || (existing.prjct_id !== null && existing.prjct_id !== projectId)) {
      return apiError("NOT_FOUND", "설계 양식을 찾을 수 없습니다.", 404);
    }

    // 2차 가드 — DEFAULT vs 프로젝트 복사본 분기
    const isDefault = existing.prjct_id === null || existing.default_yn === "Y";
    if (isDefault) {
      if (gate.systemRole !== "SUPER_ADMIN") {
        return apiError(
          "FORBIDDEN_DEFAULT_REQUIRES_SUPER_ADMIN",
          "기본 제공 설계 양식은 시스템 관리자(SUPER_ADMIN)만 수정할 수 있습니다.",
          403
        );
      }
    } else {
      // 프로젝트 사본 — OWNER/ADMIN 또는 PM/PL 만 수정 가능
      // (실무 책임자인 PM/PL 도 양식 운영을 함께 담당)
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
        // default_yn 은 의도적으로 건드리지 않음 — 스코프 승격/강등 차단
      },
    });

    return apiSuccess({ dsgnTmplId });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/design-templates/${dsgnTmplId}] DB 오류:`, err);
    return apiError("DB_ERROR", "설계 양식 수정에 실패했습니다.", 500);
  }
}

// ── DELETE: 삭제 ──────────────────────────────────────────────────────────────
//
// 이중 권한 가드:
//   ① DEFAULT → UI·API 어느 경로로도 삭제 불가 (SUPER_ADMIN 포함)
//      실수 삭제 시 전체 프로젝트 영향 + 복원 painful → DB 경로로만 제거.
//   ② 프로젝트 복사본 → 프로젝트 OWNER/ADMIN 만 (SUPER_ADMIN 도 허용)
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, dsgnTmplId } = await params;

  const gate = await requirePermission(request, projectId, "content.delete");
  if (gate instanceof Response) return gate;

  try {
    const existing = await prisma.tbAiDesignTemplate.findUnique({
      where:  { dsgn_tmpl_id: dsgnTmplId },
      select: { dsgn_tmpl_id: true, prjct_id: true, default_yn: true },
    });

    if (!existing || (existing.prjct_id !== null && existing.prjct_id !== projectId)) {
      return apiError("NOT_FOUND", "설계 양식을 찾을 수 없습니다.", 404);
    }

    const isDefault = existing.prjct_id === null || existing.default_yn === "Y";
    if (isDefault) {
      return apiError(
        "FORBIDDEN_DEFAULT_IS_DELETE_PROTECTED",
        "기본 제공 설계 양식은 UI 에서 삭제할 수 없습니다. DB 관리 경로로만 제거 가능합니다.",
        403
      );
    }
    // 프로젝트 사본 — OWNER/ADMIN 또는 PM/PL 만 삭제 가능
    if (gate.systemRole !== "SUPER_ADMIN"
      && gate.role !== "OWNER" && gate.role !== "ADMIN"
      && gate.job !== "PM"   && gate.job !== "PL") {
      return apiError(
        "FORBIDDEN_PROJECT_ADMIN_OR_PM_REQUIRED",
        "프로젝트 관리자(OWNER/ADMIN) 또는 PM/PL 만 삭제할 수 있습니다.",
        403
      );
    }

    await prisma.tbAiDesignTemplate.delete({ where: { dsgn_tmpl_id: dsgnTmplId } });

    return apiSuccess({ dsgnTmplId, deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/design-templates/${dsgnTmplId}] DB 오류:`, err);
    return apiError("DB_ERROR", "설계 양식 삭제에 실패했습니다.", 500);
  }
}
