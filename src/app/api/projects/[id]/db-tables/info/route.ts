/**
 * GET /api/projects/[id]/db-tables/info — 테이블 정보를 AI 프롬프트용 마크다운으로 반환
 *
 * Query:
 *   name  — 테이블 물리명 (필수, 대소문자 무시)
 *   mode  — "brief" | "full" (기본 brief)
 *
 * 사용처:
 *   - 구현요청 등 AI 작업에서 컨텍스트 길이를 조절하며 테이블 정보 주입
 *   - 미등록 테이블은 404로 응답하여 호출부가 적절히 처리하도록 함
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { buildTableScript, type TableScriptMode } from "@/lib/dbTableScript";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;
  const { id: projectId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  const url = new URL(request.url);
  const name = url.searchParams.get("name")?.trim();
  const mode = (url.searchParams.get("mode") ?? "brief") as TableScriptMode;

  if (!name) return apiError("VALIDATION_ERROR", "name 파라미터가 필요합니다.", 400);
  if (mode !== "brief" && mode !== "full") {
    return apiError("VALIDATION_ERROR", "mode는 brief 또는 full 이어야 합니다.", 400);
  }

  try {
    const md = await buildTableScript(projectId, name, mode);
    if (md === null) {
      return apiError("NOT_FOUND", `등록된 테이블이 없습니다: ${name}`, 404);
    }
    return apiSuccess({ name, mode, markdown: md });
  } catch (err) {
    console.error(`[GET /db-tables/info name=${name}]`, err);
    return apiError("DB_ERROR", "테이블 정보 조회에 실패했습니다.", 500);
  }
}
