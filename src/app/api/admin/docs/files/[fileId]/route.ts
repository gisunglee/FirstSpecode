/**
 * DELETE /api/admin/docs/files/[fileId] — 첨부 논리 삭제 (use_yn='N')
 *
 * 권한: SUPER_ADMIN 전용
 *
 * 설계 메모:
 *   - 물리 디스크 삭제는 별도 cleanup 배치에 위임 (즉시 삭제 시 동시성 위험)
 *   - 논리 삭제 즉시 사용자 뷰어/에디터 양쪽에서 사라짐
 *   - 본문 markdown 에 남아있는 ![](url) 은 깨진 이미지로 표시되므로
 *     관리자가 본문에서도 함께 제거해야 함 (UI 에서 안내)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";

type RouteParams = { params: Promise<{ fileId: string }> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { fileId } = await params;
  if (!UUID_PATTERN.test(fileId)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 파일 ID입니다.", 400);
  }

  try {
    const result = await prisma.tbSysAttachFile.updateMany({
      where: { attach_id: fileId, use_yn: "Y" },
      data:  {
        use_yn:       "N",
        mdfr_mber_id: gate.mberId,
        mdfcn_dt:     new Date(),
      },
    });

    if (result.count === 0) {
      return apiError("NOT_FOUND", "파일을 찾을 수 없습니다.", 404);
    }

    return apiSuccess({ fileId });
  } catch (err) {
    console.error("[DELETE /api/admin/docs/files/[fileId]]", err);
    return apiError("DB_ERROR", "파일 삭제에 실패했습니다.", 500);
  }
}
