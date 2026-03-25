/**
 * POST /api/projects/[id]/ai-tasks/[taskId]/apply — AI 결과 반영 (FID-00187)
 *
 * DONE 상태의 태스크 결과를 대상 엔티티에 반영하고 APPLIED로 상태 변경
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; taskId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, taskId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  try {
    const task = await prisma.tbAiTask.findUnique({
      where: { ai_task_id: taskId },
    });

    if (!task || task.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "AI 태스크를 찾을 수 없습니다.", 404);
    }

    // 이미 반영된 태스크
    if (task.task_sttus_code === "APPLIED") {
      return apiError("CONFLICT", "이미 반영된 태스크입니다.", 409);
    }

    // DONE 상태만 반영 가능
    if (task.task_sttus_code !== "DONE") {
      return apiError("VALIDATION_ERROR", "처리 완료(DONE) 상태의 태스크만 반영할 수 있습니다.", 400);
    }

    const resultCn = task.result_cn ?? "";
    const now      = new Date();

    await prisma.$transaction(async (tx) => {
      // ① AI 태스크 상태 APPLIED로 변경
      await tx.tbAiTask.update({
        where: { ai_task_id: taskId },
        data: {
          task_sttus_code: "APPLIED",
          apply_dt:        now,
        },
      });

      // ② task_ty_code에 따라 대상 엔티티 업데이트
      //    DESIGN  → 영역 설명(area_dc) 또는 기능 명세(spec_cn)에 결과 반영
      //    INSPECT / IMPACT / CUSTOM → 정보성, 엔티티 직접 수정 없음
      //    IMPLEMENT / MOCKUP → 명세에 결과 병합 (현재 버전은 spec_cn 추가)
      if (["DESIGN", "IMPLEMENT"].includes(task.task_ty_code)) {
        if (task.ref_ty_code === "AREA") {
          await tx.tbDsArea.update({
            where: { area_id: task.ref_id },
            data:  { area_dc: resultCn },
          });
        } else if (task.ref_ty_code === "FUNCTION") {
          await tx.tbDsFunction.update({
            where: { func_id: task.ref_id },
            data:  { spec_cn: resultCn },
          });
        }
      }

      // ③ 설계 변경 이력 기록 (ai_req_yn = 'Y')
      const refTblNm = task.ref_ty_code === "AREA" ? "tb_ds_area" : "tb_ds_function";
      await tx.tbDsDesignChange.create({
        data: {
          prjct_id:      projectId,
          ref_tbl_nm:    refTblNm,
          ref_id:        task.ref_id,
          chg_rsn_cn:    `AI 태스크 결과 반영 (${task.task_ty_code})`,
          snapshot_data: { aiTaskId: taskId, resultCn },
          ai_req_yn:     "Y",
          ai_task_id:    taskId,
          chg_mber_id:   auth.mberId,
        },
      });
    });

    return apiSuccess({ taskId, status: "APPLIED" });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/ai-tasks/${taskId}/apply] DB 오류:`, err);
    return apiError("DB_ERROR", "반영 처리 중 오류가 발생했습니다.", 500);
  }
}
