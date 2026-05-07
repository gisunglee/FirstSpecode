/**
 * POST /api/projects/[id]/ai-tasks/[taskId]/retry — AI 태스크 재요청 (FID-00184)
 *
 * FAILED/REJECTED/TIMEOUT 상태의 태스크를 복사하여 새 PENDING 태스크 생성
 * parent_task_id 로 이력 연결.
 *
 * 첨부 정책:
 *   - 원본 태스크의 tb_cm_attach_file 행을 그대로 복사하되 ref_id 만 새 taskId 로 치환
 *   - file_path_nm / stor_file_nm 은 동일하게 유지 → 디스크 파일은 1장, DB 행만 N개가 공유
 *   - 워커는 ref_id=새 taskId 로 첨부를 그대로 받아갈 수 있어 LLM 이 원본과 동일한
 *     이미지/파일을 보고 다시 처리할 수 있다 (재요청 의도 유지)
 *   - 디스크 파일 정리는 orphan 배치(attach-file-cleanup) 가 file_path_nm 기반으로
 *     처리하므로 형제 행이 살아있는 한 파일이 임의 삭제되지 않음 (ref-count 자연 보장)
 *
 * 트랜잭션:
 *   - 새 태스크 INSERT 와 첨부 행 복사를 한 트랜잭션으로 묶음
 *   - 둘 중 하나라도 실패하면 롤백되어 "태스크는 만들어졌는데 첨부가 누락" 같은
 *     반쪽짜리 상태가 남지 않게 한다
 *   - 디스크 IO 가 없으므로 트랜잭션에 묶어도 안전 (saveAiTaskAttachments 의 DB+디스크
 *     혼합 케이스와는 다른 상황)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; taskId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
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

    // FAILED / REJECTED / TIMEOUT 상태만 재요청 가능
    if (!["FAILED", "REJECTED", "TIMEOUT"].includes(task.task_sttus_code)) {
      return apiError("VALIDATION_ERROR", "현재 상태에서는 재요청할 수 없습니다.", 400);
    }

    // 원본 첨부 행 조회 — 새 태스크에 동일 디스크 파일을 가리키도록 복사할 후보들
    // ref_tbl_nm='tb_ai_task' 필터 필수 (다른 리소스의 첨부와 혼입 방지)
    const originalAttachments = await prisma.tbCmAttachFile.findMany({
      where:   { ref_tbl_nm: "tb_ai_task", ref_id: taskId },
      orderBy: { creat_dt: "asc" },
    });

    // 새 태스크 INSERT + 첨부 행 복사를 한 트랜잭션으로 묶음
    // 디스크 IO 가 없으므로 트랜잭션에 묶어도 안전하며, 부분 실패 시 자동 롤백된다
    const newTask = await prisma.$transaction(async (tx) => {
      const created = await tx.tbAiTask.create({
        data: {
          prjct_id:          projectId,
          ref_ty_code:       task.ref_ty_code,
          ref_id:            task.ref_id,
          task_ty_code:      task.task_ty_code,
          coment_cn:         task.coment_cn,
          // req_cn 은 원본 태스크 생성 시점에 시스템프롬프트+전체설계+코멘트+점검내용을
          // 모두 풀 조립해 저장된 "워커가 LLM 에 그대로 보낼 본문" — 워커는 이 컬럼을
          // SELECT 만 하고 재빌드하지 않는다 (worker/tasks/route.ts 참조).
          // 따라서 retry 에서 이 필드를 누락하면 새 태스크는 LLM 에 코멘트만 전달되어
          // 결과 품질이 무너진다. 원본 시점의 컨텍스트를 그대로 다시 처리하는 것이
          // "재요청"의 의미에 부합하므로 컬럼 통째로 복사한다.
          req_cn:            task.req_cn,
          req_snapshot_data: task.req_snapshot_data ?? {},
          parent_task_id:    taskId,
          retry_cnt:         (task.retry_cnt ?? 0) + 1,  // 재시도할 때마다 +1
          req_mber_id:       auth.mberId,
          task_sttus_code:   "PENDING",
        },
      });

      if (originalAttachments.length > 0) {
        // attach_file_id (PK) 와 creat_dt 는 schema 의 default(uuid()/now()) 로 자동 생성
        // file_path_nm 과 stor_file_nm 은 그대로 — 같은 디스크 파일을 공유한다
        await tx.tbCmAttachFile.createMany({
          data: originalAttachments.map((a) => ({
            prjct_id:      a.prjct_id,
            ref_tbl_nm:    "tb_ai_task",
            ref_id:        created.ai_task_id,
            file_ty_code:  a.file_ty_code,
            orgnl_file_nm: a.orgnl_file_nm,
            stor_file_nm:  a.stor_file_nm,
            file_path_nm:  a.file_path_nm,
            file_sz:       a.file_sz,
            file_extsn_nm: a.file_extsn_nm,
            req_ref_yn:    a.req_ref_yn,
          })),
        });
      }

      return created;
    });

    return apiSuccess(
      {
        taskId:            newTask.ai_task_id,
        status:            "PENDING",
        parentTaskId:      taskId,
        attachmentCount:   originalAttachments.length,
      },
      201,
    );
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/ai-tasks/${taskId}/retry] DB 오류:`, err);
    return apiError("DB_ERROR", "재요청 처리 중 오류가 발생했습니다.", 500);
  }
}
