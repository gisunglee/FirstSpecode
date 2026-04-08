/**
 * GET /api/diff-test/load-latest — 가장 최근 master 불러오기
 *
 * 역할:
 *   - creat_dt DESC 최상단 master 1건 + 노드 4건 반환
 *   - 데이터가 없으면 빈 응답
 */

import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";

export async function GET() {
  try {
    const master = await prisma.tbSpDiffTestMaster.findFirst({
      orderBy: { creat_dt: "desc" },
      include: { nodes: true },
    });

    if (!master) {
      return apiSuccess({ master: null });
    }

    const nodes: Record<string, { rawMd: string; hash: string }> = {};
    for (const n of master.nodes) {
      nodes[n.node_type_code] = { rawMd: n.raw_md_cn, hash: n.content_hash };
    }

    return apiSuccess({
      master: {
        masterId: master.master_id,
        testSn: Number(master.test_sn),
        sjNm: master.sj_nm,
        memoCn: master.memo_cn,
        creatDt: master.creat_dt,
        nodes,
      },
    });
  } catch (err) {
    console.error("[GET /api/diff-test/load-latest]", err);
    return apiError("DB_ERROR", "최신 버전 조회에 실패했습니다.", 500);
  }
}
