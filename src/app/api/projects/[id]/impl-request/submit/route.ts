/**
 * POST /api/projects/[id]/impl-request/submit — 3단계: 최종 요청
 *
 * 역할:
 *   - 2단계(build)에서 생성된 프롬프트를 받아 tb_ai_task INSERT (PENDING)
 *   - 각 엔티티별 현재 _dc 스냅샷을 tb_sp_impl_snapshot에 저장
 *   - 다음 구현요청 시 이 스냅샷과 비교하여 diff 생성
 */

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/requireAuth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { collectLayers } from "@/lib/impl-request/collector";
import { TABLE_MAP } from "@/lib/impl-request/collector";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const { id: projectId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  let body: { entryType: string; entryId: string; functionIds: string[]; comentCn?: string; promptMd: string };
  try { body = await request.json(); } catch { return apiError("VALIDATION_ERROR", "올바른 JSON이 아닙니다.", 400); }

  if (!body.promptMd?.trim()) {
    return apiError("VALIDATION_ERROR", "프롬프트 내용이 없습니다.", 400);
  }

  try {
    // 스냅샷 저장을 위해 현재 4계층 재수집
    const layers = await collectLayers(body.entryType, body.entryId, body.functionIds, projectId);

    // ── 시스템 프롬프트 조회 ──
    // tb_ai_prompt_template에서 task_ty_code=IMPLEMENT, use_yn=Y 중 최신 1건
    // 프로젝트 우선 → 시스템 공통, 기능 특화 > 일반, default > 비default, 최신 순
    const promptTmpl = await prisma.tbAiPromptTemplate.findFirst({
      where: {
        AND: [
          { OR: [{ prjct_id: projectId }, { prjct_id: null }] },
        ],
        task_ty_code: "IMPLEMENT",
        use_yn: "Y",
      },
      orderBy: [
        { default_yn: "desc" },
        { prjct_id: { sort: "desc", nulls: "last" } },
        { creat_dt: "desc" },
      ],
    });

    // ── req_cn 조립: <시스템프롬프트> + <코멘트> + <구현요청서> ──
    const parts: string[] = [];
    if (promptTmpl?.sys_prompt_cn?.trim()) {
      parts.push(`<시스템프롬프트>\n${promptTmpl.sys_prompt_cn.trim()}\n</시스템프롬프트>`);
    }
    if (body.comentCn?.trim()) {
      parts.push(`<코멘트>\n${body.comentCn.trim()}\n</코멘트>`);
    }
    parts.push(`<구현요청서>\n${body.promptMd.trim()}\n</구현요청서>`);
    const finalReqCn = parts.join("\n\n");

    // 트랜잭션: AI 태스크 + 스냅샷 동시 저장
    const aiTaskId = crypto.randomUUID();

    await prisma.$transaction(async (tx) => {
      // tb_ai_task INSERT
      await tx.tbAiTask.create({
        data: {
          ai_task_id: aiTaskId,
          prjct_id: projectId,
          ref_ty_code: body.entryType,
          ref_id: body.entryId,
          task_ty_code: "IMPLEMENT",
          req_cn: finalReqCn,
          coment_cn: body.comentCn ?? null,
          task_sttus_code: "PENDING",
          req_snapshot_data: {
            entryType: body.entryType,
            entryId: body.entryId,
            functionIds: body.functionIds,
            layerCount: layers.length,
            promptTemplateId: promptTmpl?.tmpl_id ?? null,
          },
          req_mber_id: auth.mberId,
        },
      });

      // tb_sp_impl_snapshot INSERT — 각 계층별 현재 내용 스냅샷
      for (const layer of layers) {
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

    return apiSuccess({ aiTaskId, taskSttusCode: "PENDING" });
  } catch (err) {
    console.error("[POST /impl-request/submit]", err);
    return apiError("DB_ERROR", "구현 요청 등록에 실패했습니다.", 500);
  }
}
