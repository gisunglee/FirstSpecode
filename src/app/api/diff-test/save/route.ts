/**
 * POST /api/diff-test/save — 4계층 노드 저장
 *
 * 역할:
 *   - 4개 노드(UW/PID/AR/FID)의 raw MD를 받아서 master 1건 + node 4건 INSERT
 *   - 직전 master와 hash 비교하여 노드별 변경 여부 산출
 *   - 변경된 노드는 라인 통계까지 계산하여 함께 저장
 *
 * 주요 기술:
 *   - normalize → SHA256 hash로 변경 감지 (LLM 미사용, 결정적)
 *   - 트랜잭션으로 master + node 4건 원자적 INSERT
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { hashOf } from "@/lib/diff-test/normalizer";
import { diffLines } from "@/lib/diff-test/differ";
import { decideMode } from "@/lib/diff-test/strategist";
import { NODE_TYPES, NODE_SEQ, type NodeType, type NodeStats } from "@/lib/diff-test/types";

export async function POST(request: NextRequest) {
  let body: { sjNm?: string; memoCn?: string; nodes?: Record<NodeType, string> };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  if (!body.nodes) return apiError("VALIDATION_ERROR", "nodes는 필수입니다.", 400);
  for (const t of NODE_TYPES) {
    if (typeof body.nodes[t] !== "string") {
      return apiError("VALIDATION_ERROR", `nodes.${t}는 문자열이어야 합니다.`, 400);
    }
  }

  try {
    // ① 직전 master 조회
    const baseMaster = await prisma.tbSpDiffTestMaster.findFirst({
      orderBy: { creat_dt: "desc" },
      include: { nodes: true },
    });

    // ② 노드별 hash + 변경 감지
    const baseNodeMap = new Map<string, { hash: string; rawMd: string }>();
    if (baseMaster) {
      for (const n of baseMaster.nodes) {
        baseNodeMap.set(n.node_type_code, { hash: n.content_hash, rawMd: n.raw_md_cn });
      }
    }

    const nodeStats: Record<NodeType, NodeStats> = {} as Record<NodeType, NodeStats>;
    const changedNodes: NodeType[] = [];
    const nodesToCreate: Array<{
      node_type_code: NodeType;
      node_seq: number;
      raw_md_cn: string;
      content_hash: string;
      is_changed_yn: string;
      chg_mode_code: string | null;
      chg_line_ratio: number | null;  // NO_CHANGE는 null
      added_line_cnt: number;
      removed_line_cnt: number;
      kept_line_cnt: number;
    }> = [];

    for (const t of NODE_TYPES) {
      const rawMd = body.nodes[t];
      const { hash } = hashOf(rawMd);
      const base = baseNodeMap.get(t);
      const hashChanged = !base || base.hash !== hash;

      let stats = { added: 0, removed: 0, kept: 0, totalBefore: 0, totalAfter: 0, lineRatio: 0 };
      let mode: ReturnType<typeof decideMode> = "NO_CHANGE";

      if (hashChanged) {
        stats = diffLines(base?.rawMd ?? "", rawMd);
        mode = decideMode(stats, true);
        changedNodes.push(t);
      }

      nodeStats[t] = {
        changed: hashChanged,
        hash,
        mode,
        lineRatio: stats.lineRatio,
        added: stats.added,
        removed: stats.removed,
        kept: stats.kept,
      };

      nodesToCreate.push({
        node_type_code: t,
        node_seq: NODE_SEQ[t],
        raw_md_cn: rawMd,
        content_hash: hash,
        is_changed_yn: hashChanged ? "Y" : "N",
        chg_mode_code: mode,
        // 변경 없는 노드는 lineRatio를 null로 (의미적으로 N/A)
        chg_line_ratio: hashChanged ? stats.lineRatio : null,
        added_line_cnt: stats.added,
        removed_line_cnt: stats.removed,
        kept_line_cnt: stats.kept,
      });
    }

    // ③ 트랜잭션: master + node 4건 INSERT
    const created = await prisma.$transaction(async (tx) => {
      const master = await tx.tbSpDiffTestMaster.create({
        data: {
          sj_nm: body.sjNm?.trim() || null,
          memo_cn: body.memoCn?.trim() || null,
          base_master_id: baseMaster?.master_id ?? null,
          chg_node_cnt: changedNodes.length,
        },
      });

      await tx.tbSpDiffTestNode.createMany({
        data: nodesToCreate.map((n) => ({ ...n, master_id: master.master_id })),
      });

      return master;
    });

    return apiSuccess({
      ok: true,
      masterId: created.master_id,
      testSn: Number(created.test_sn),
      baseMasterId: baseMaster?.master_id ?? null,
      changedNodes,
      nodeStats,
    });
  } catch (err) {
    console.error("[POST /api/diff-test/save]", err);
    return apiError("DB_ERROR", "저장에 실패했습니다.", 500);
  }
}
