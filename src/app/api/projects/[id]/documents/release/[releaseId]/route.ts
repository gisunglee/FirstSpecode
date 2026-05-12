/**
 * DELETE /api/projects/[id]/documents/release/[releaseId]
 *   — 산출물 발행 이력 1건 삭제
 *
 * 정책:
 *   - 권한: "content.export" (OWNER/ADMIN/MEMBER) — 지원 세션 자동 차단
 *   - 프로젝트 소속 검증 — 다른 프로젝트의 releaseId 가 들어와도 안전
 *   - 삭제 = TbDsDocumentRelease 행 hard delete (snapshot_data 도 같이 사라짐)
 *   - 영향:
 *       · 그 발행본의 docx/xlsx 복원 불가
 *       · 변경이력 표에서도 제거됨
 *
 * 주의:
 *   삭제는 되돌릴 수 없음 (snapshot 박제본 자체 삭제). UI 측에서 사용자 확인을 받아야 한다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; releaseId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, releaseId } = await params;

  // ① 권한 — content.export (지원 세션 자동 차단)
  const gate = await requirePermission(request, projectId, "content.export");
  if (gate instanceof Response) return gate;

  try {
    // ② 프로젝트 소속 검증
    const release = await prisma.tbDsDocumentRelease.findUnique({
      where:  { release_id: releaseId },
      select: { prjct_id: true },
    });
    if (!release || release.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "발행 이력을 찾을 수 없습니다.", 404);
    }

    // ③ 삭제 — 박제본 자체가 사라지므로 되돌릴 수 없다
    await prisma.tbDsDocumentRelease.delete({ where: { release_id: releaseId } });

    return apiSuccess({ releaseId });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/documents/release/${releaseId}] 오류:`, err);
    return apiError("DB_ERROR", "발행 이력 삭제에 실패했습니다.", 500);
  }
}
