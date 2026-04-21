/**
 * POST /api/projects/[id]/impl-request/pre-impl — 선 구현 적용
 *
 * 역할:
 *   - 개발자가 CC 등으로 이미 직접 반영한 변경사항에 대해
 *     선택된 레이어의 기준선(스냅샷)을 현재 상태로 갱신
 *   - 이후 구현 요청 시 해당 레이어는 diff 없이 NO_CHANGE로 표시됨
 *   - 감사 추적: task_ty_code = "PRE_IMPL" 더미 태스크 생성
 *
 * 요청 본문:
 *   - entryType, entryId, functionIds: build/submit과 동일 (4계층 수집용)
 *   - resetLayerKeys: 초기화할 레이어 식별자 배열 ("ref_tbl_nm::ref_id" 형식)
 */

import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { collectLayers, TABLE_MAP } from "@/lib/impl-request/collector";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "ai.request");
  if (gate instanceof Response) return gate;

  // 요청 본문 파싱
  let body: {
    entryType: string;
    entryId: string;
    functionIds: string[];
    resetLayerKeys: string[];
  };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON이 아닙니다.", 400);
  }

  if (!body.entryType || !body.entryId) {
    return apiError("VALIDATION_ERROR", "entryType과 entryId는 필수입니다.", 400);
  }
  if (!body.functionIds?.length) {
    return apiError("VALIDATION_ERROR", "기능을 1개 이상 선택해 주세요.", 400);
  }
  if (!body.resetLayerKeys?.length) {
    return apiError("VALIDATION_ERROR", "초기화할 레이어를 1개 이상 선택해 주세요.", 400);
  }

  try {
    // 4계층 수집 (현재 _dc + hash)
    const layers = await collectLayers(body.entryType, body.entryId, body.functionIds, projectId);

    if (layers.length === 0) {
      return apiError("NOT_FOUND", "대상 설계서를 찾을 수 없습니다.", 404);
    }

    // resetLayerKeys 파싱 — "ref_tbl_nm::ref_id" 형식
    const resetKeySet = new Set(body.resetLayerKeys);

    // 선택된 레이어만 필터링
    const resetLayers = layers.filter((l) => {
      const key = `${TABLE_MAP[l.type]}::${l.id}`;
      return resetKeySet.has(key);
    });

    if (resetLayers.length === 0) {
      return apiError("VALIDATION_ERROR", "유효한 초기화 대상 레이어가 없습니다.", 400);
    }

    // 트랜잭션: 더미 AI 태스크(PRE_IMPL) + 선택 레이어 스냅샷 저장
    const aiTaskId = crypto.randomUUID();

    await prisma.$transaction(async (tx) => {
      // tb_ai_task INSERT — 선 구현 적용 기록
      await tx.tbAiTask.create({
        data: {
          ai_task_id: aiTaskId,
          prjct_id: projectId,
          ref_ty_code: body.entryType,
          ref_id: body.entryId,
          task_ty_code: "PRE_IMPL",
          req_cn: `선 구현 적용 — ${resetLayers.length}개 계층 기준선 갱신`,
          coment_cn: null,
          task_sttus_code: "DONE",
          req_snapshot_data: {
            entryType: body.entryType,
            entryId: body.entryId,
            functionIds: body.functionIds,
            resetLayers: resetLayers.map((l) => ({
              type: l.type,
              id: l.id,
              displayId: l.displayId,
              name: l.name,
            })),
            reason: "PRE_IMPL",
          },
          req_mber_id: gate.mberId,
          compl_dt: new Date(),
        },
      });

      // tb_sp_impl_snapshot INSERT — 선택 레이어만 현재 _dc 스냅샷 저장
      for (const layer of resetLayers) {
        await tx.tbSpImplSnapshot.create({
          data: {
            ai_task_id: aiTaskId,
            ref_tbl_nm: TABLE_MAP[layer.type],
            ref_id: layer.id,
            content_hash: layer.currentHash,
            raw_cn: layer.currentDc,
          },
        });
      }
    });

    return apiSuccess({ aiTaskId, resetCount: resetLayers.length });
  } catch (err) {
    console.error("[POST /impl-request/pre-impl]", err);
    return apiError("DB_ERROR", "선 구현 적용에 실패했습니다.", 500);
  }
}
