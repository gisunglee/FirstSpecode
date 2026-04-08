/**
 * DELETE /api/diff-test/reset — 테스트 데이터 전체 삭제
 *
 * 역할:
 *   - tb_sp_diff_test_master 전체 삭제 (cascade로 node도 삭제)
 *   - 테스트 환경 전용 — 본 제품 통합 시 권한 체크 추가 필요
 */

import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";

export async function DELETE() {
  try {
    // base_master_id self-reference 때문에 자식부터 삭제
    await prisma.$transaction(async (tx) => {
      await tx.tbSpDiffTestNode.deleteMany({});
      await tx.tbSpDiffTestMaster.deleteMany({});
    });
    return apiSuccess({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/diff-test/reset]", err);
    return apiError("DB_ERROR", "초기화에 실패했습니다.", 500);
  }
}
