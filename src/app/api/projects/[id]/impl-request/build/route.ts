/**
 * POST /api/projects/[id]/impl-request/build — 2단계: 프롬프트 생성 (미리보기용)
 *
 * 역할:
 *   - 선택된 기능 기준 4계층 수집 → diff 계산 → 프롬프트 렌더링
 *   - DB 저장 없음 — 프롬프트 생성만 해서 반환
 *   - 사용자가 미리보기로 확인 후 "최종 요청"에서 실제 저장
 */

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/requireAuth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { collectLayers } from "@/lib/impl-request/collector";
import { renderImplPrompt } from "@/lib/impl-request/renderer";
import { expandTableScripts, type TableScriptMode } from "@/lib/dbTableScript";

type RouteParams = { params: Promise<{ id: string }> };

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

  let body: { entryType: string; entryId: string; functionIds: string[]; tableMode?: "none" | "brief" | "full" };
  try { body = await request.json(); } catch { return apiError("VALIDATION_ERROR", "올바른 JSON이 아닙니다.", 400); }

  if (!body.entryType || !body.entryId) {
    return apiError("VALIDATION_ERROR", "entryType과 entryId는 필수입니다.", 400);
  }
  if (!body.functionIds?.length) {
    return apiError("VALIDATION_ERROR", "기능을 1개 이상 선택해 주세요.", 400);
  }

  try {
    // 선택된 기능 기준으로 4계층 수집 + diff 계산
    const layers = await collectLayers(body.entryType, body.entryId, body.functionIds, projectId);

    if (layers.length === 0) {
      return apiError("NOT_FOUND", "대상 설계서를 찾을 수 없습니다.", 404);
    }

    // 프롬프트 렌더링 — 미리보기용 본문만 (시스템 프롬프트/코멘트는 submit에서 주입)
    let promptMd = renderImplPrompt(layers);

    // <TABLE_SCRIPT:tb_xxx> 플레이스홀더 치환 (tableMode가 brief/full일 때만)
    // - 미등록 테이블은 원본 그대로 유지
    // - 동일 테이블 중복 시 캐싱 (lib 내부)
    const tableMode = body.tableMode ?? "none";
    if (tableMode === "brief" || tableMode === "full") {
      promptMd = await expandTableScripts(projectId, promptMd, tableMode as TableScriptMode);
    }

    // 요약 정보 — 팝업 상단 모드 배지 + "모두 NO_CHANGE면 요청 불가" 판정용
    const summary = layers.map((l) => ({
      type: l.type,
      displayId: l.displayId,
      name: l.name,
      mode: l.hasSnapshot ? l.mode : "신규",
      lineRatio: l.lineRatio,
    }));

    // 시스템 프롬프트 템플릿 조회 (최종 요청 컨펌 팝업 표시용)
    const promptTmpl = await prisma.tbAiPromptTemplate.findFirst({
      where: {
        AND: [{ OR: [{ prjct_id: projectId }, { prjct_id: null }] }],
        task_ty_code: "IMPLEMENT",
        use_yn: "Y",
      },
      orderBy: [
        { default_yn: "desc" },
        { prjct_id: { sort: "desc", nulls: "last" } },
        { creat_dt: "desc" },
      ],
      select: { tmpl_id: true, tmpl_nm: true },
    });

    return apiSuccess({
      promptMd,
      summary,
      promptTemplate: promptTmpl ? { id: promptTmpl.tmpl_id, name: promptTmpl.tmpl_nm } : null,
    });
  } catch (err) {
    console.error("[POST /impl-request/build]", err);
    return apiError("DB_ERROR", "프롬프트 생성에 실패했습니다.", 500);
  }
}
