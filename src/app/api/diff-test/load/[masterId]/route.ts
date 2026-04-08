/**
 * GET /api/diff-test/load/[masterId] — 특정 master 불러오기
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ masterId: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { masterId } = await params;

  try {
    const master = await prisma.tbSpDiffTestMaster.findUnique({
      where: { master_id: masterId },
      include: { nodes: true },
    });

    if (!master) return apiError("NOT_FOUND", "마스터를 찾을 수 없습니다.", 404);

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
        diffPromptMd: master.diff_prompt_md,
        nodes,
      },
    });
  } catch (err) {
    console.error(`[GET /api/diff-test/load/${masterId}]`, err);
    return apiError("DB_ERROR", "마스터 조회에 실패했습니다.", 500);
  }
}
