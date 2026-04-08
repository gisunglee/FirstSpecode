/**
 * GET /api/diff-test/list — master 목록 (드롭다운/이력 패널용)
 *
 * 역할:
 *   - 최근 master 50건 반환 (creat_dt DESC)
 *   - 변경 노드 수, 차이 프롬프트 생성 여부 포함
 */

import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";

export async function GET() {
  try {
    const masters = await prisma.tbSpDiffTestMaster.findMany({
      orderBy: { creat_dt: "desc" },
      take: 50,
      select: {
        master_id: true,
        test_sn: true,
        sj_nm: true,
        creat_dt: true,
        chg_node_cnt: true,
        diff_prompt_md: true,
      },
    });

    return apiSuccess({
      items: masters.map((m) => ({
        masterId: m.master_id,
        testSn: Number(m.test_sn),
        sjNm: m.sj_nm,
        creatDt: m.creat_dt,
        chgNodeCnt: m.chg_node_cnt ?? 0,
        hasDiffPrompt: !!m.diff_prompt_md,
      })),
    });
  } catch (err) {
    console.error("[GET /api/diff-test/list]", err);
    return apiError("DB_ERROR", "목록 조회에 실패했습니다.", 500);
  }
}
