/**
 * GET /api/projects/[id]/ai-tasks/[taskId]/files — AI 태스크 첨부파일 목록 조회
 *
 * 역할:
 *   - AI 태스크 상세 다이얼로그에서 요청 시점에 올린 첨부 이미지/파일 목록을 읽어옴
 *   - 읽기 전용 — 업로드/삭제/수정은 제공하지 않는다
 *     (첨부는 AI 요청 접수 시점에만 확정되고, 이후엔 워커 처리 중이거나 완료되어 변경 불필요)
 *
 * 인증:
 *   JWT (requireAuth) + 프로젝트 멤버십 ACTIVE 필수
 *
 * 주의:
 *   - ref_tbl_nm="tb_ai_task" 필터로 영역/기능 첨부와 섞이지 않도록 방어
 *   - req_ref_yn 값에 관계없이 모두 반환 — 사용자가 업로드한 모든 파일을 볼 수 있어야 함
 *     (워커는 req_ref_yn='Y'만 받지만, 사용자는 전체 이력을 확인할 수 있어야 함)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; taskId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, taskId } = await params;

  // 멤버십 확인 — ACTIVE 아니면 403
  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    // 태스크 존재 + 프로젝트 소속 검증
    const task = await prisma.tbAiTask.findUnique({
      where:  { ai_task_id: taskId },
      select: { prjct_id: true },
    });
    if (!task || task.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "AI 태스크를 찾을 수 없습니다.", 404);
    }

    // ref_tbl_nm='tb_ai_task' 필터는 필수 — 다른 리소스 첨부와 혼입 방지
    const files = await prisma.tbCmAttachFile.findMany({
      where:   { ref_tbl_nm: "tb_ai_task", ref_id: taskId },
      orderBy: { creat_dt: "asc" },
    });

    const items = files.map((f) => ({
      fileId:     f.attach_file_id,
      fileName:   f.orgnl_file_nm,
      fileSize:   f.file_sz,
      extension:  f.file_extsn_nm,
      fileType:   f.file_ty_code,
      reqRefYn:   f.req_ref_yn ?? "Y",
      uploadedAt: f.creat_dt,
    }));

    return apiSuccess({ items });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/ai-tasks/${taskId}/files] DB 오류:`, err);
    return apiError("DB_ERROR", "첨부파일 목록 조회에 실패했습니다.", 500);
  }
}
