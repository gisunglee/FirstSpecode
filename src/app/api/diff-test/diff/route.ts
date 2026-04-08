/**
 * POST /api/diff-test/diff — 차이 프롬프트 생성
 *
 * 역할:
 *   - target master(현재) vs base master(직전 또는 지정)의 4개 노드를 비교
 *   - 노드별 모드 결정 + 라인 통계 → PRD_CHANGE.md 생성
 *   - master.diff_prompt_md, diff_summary_json 업데이트
 *
 * Request:
 *   { targetMasterId: string, baseMasterId?: string }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { hashOf } from "@/lib/diff-test/normalizer";
import { diffLines } from "@/lib/diff-test/differ";
import { decideMode } from "@/lib/diff-test/strategist";
import { render, type NodeRenderInput } from "@/lib/diff-test/renderer";
import { NODE_TYPES, type NodeType, type DiffSummary } from "@/lib/diff-test/types";

export async function POST(request: NextRequest) {
  let body: { targetMasterId?: string; baseMasterId?: string };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  if (!body.targetMasterId) return apiError("VALIDATION_ERROR", "targetMasterId는 필수입니다.", 400);

  try {
    // ① target master 로드
    const target = await prisma.tbSpDiffTestMaster.findUnique({
      where: { master_id: body.targetMasterId },
      include: { nodes: true },
    });
    if (!target) return apiError("NOT_FOUND", "target 마스터를 찾을 수 없습니다.", 404);

    // ② base master 결정 — 명시 또는 target.base_master_id
    const baseMasterId = body.baseMasterId ?? target.base_master_id;
    const base = baseMasterId
      ? await prisma.tbSpDiffTestMaster.findUnique({
          where: { master_id: baseMasterId },
          include: { nodes: true },
        })
      : null;

    // ③ 노드별 비교
    const baseMap = new Map<string, string>();
    if (base) {
      for (const n of base.nodes) baseMap.set(n.node_type_code, n.raw_md_cn);
    }
    const targetMap = new Map<string, string>();
    for (const n of target.nodes) targetMap.set(n.node_type_code, n.raw_md_cn);

    const renderNodes: NodeRenderInput[] = [];
    const summary: DiffSummary = {};

    for (const t of NODE_TYPES) {
      const beforeMd = baseMap.get(t) ?? "";
      const afterMd = targetMap.get(t) ?? "";
      const beforeHash = beforeMd ? hashOf(beforeMd).hash : "";
      const afterHash = hashOf(afterMd).hash;
      const stats = diffLines(beforeMd, afterMd);
      const mode = decideMode(stats, beforeHash !== afterHash);

      renderNodes.push({
        type: t as NodeType,
        label: t,
        beforeMd,
        afterMd,
        mode,
        stats,
      });

      summary[t as NodeType] = {
        mode,
        lineRatio: stats.lineRatio,
        added: stats.added,
        removed: stats.removed,
        kept: stats.kept,
      };
    }

    // ④ Renderer로 MD 생성
    const diffPromptMd = render({
      targetTestSn: Number(target.test_sn),
      baseTestSn: base ? Number(base.test_sn) : null,
      sjNm: target.sj_nm,
      nodes: renderNodes,
    });

    // ⑤ master 업데이트 — Json 컬럼은 plain object 필요 (Decimal/BigInt 안전 변환)
    const summaryJson = JSON.parse(JSON.stringify(summary));
    await prisma.tbSpDiffTestMaster.update({
      where: { master_id: target.master_id },
      data: {
        diff_prompt_md: diffPromptMd,
        diff_summary_json: summaryJson,
      },
    });

    return apiSuccess({
      ok: true,
      diffPromptMd,
      summary,
    });
  } catch (err) {
    console.error("[POST /api/diff-test/diff]", err);
    return apiError("DB_ERROR", "차이 프롬프트 생성에 실패했습니다.", 500);
  }
}
