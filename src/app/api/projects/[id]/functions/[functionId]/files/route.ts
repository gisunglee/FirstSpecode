/**
 * GET  /api/projects/[id]/functions/[functionId]/files — 첨부파일 목록 조회
 * POST /api/projects/[id]/functions/[functionId]/files — 첨부파일 업로드
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { checkUploadAllowed } from "@/lib/planLimits";
import { handleProjectAttachmentUpload } from "@/lib/projectAttachmentUpload";

type RouteParams = { params: Promise<{ id: string; functionId: string }> };

// ─── GET: 첨부파일 목록 ──────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, functionId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const files = await prisma.tbCmAttachFile.findMany({
      where:   { ref_id: functionId, ref_tbl_nm: "tb_ds_function" },
      orderBy: { creat_dt: "asc" },
    });

    const items = files.map((f) => ({
      fileId:     f.attach_file_id,
      fileName:   f.orgnl_file_nm,
      fileSize:   f.file_sz,
      extension:  f.file_extsn_nm,
      fileType:   f.file_ty_code,
      reqRefYn:   f.req_ref_yn ?? "N",
      uploadedAt: f.creat_dt,
    }));

    return apiSuccess({ items });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/functions/${functionId}/files] DB 오류:`, err);
    return apiError("DB_ERROR", "첨부파일 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 첨부파일 업로드 ───────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, functionId } = await params;

  // 권한 가드 — 역할 매트릭스(permissions.ts) 기반.
  // 결제 잠금(§1-6)·지원 세션 읽기전용·프로젝트 삭제 상태도 requirePermission 이 함께 처리한다.
  const auth = await requirePermission(request, projectId, "content.update");
  if (auth instanceof Response) return auth;

  // FREE 플랜은 첨부 업로드 차단 — 소유자 플랜 기준. 파일 파싱 전에 막는다 (정책 §1-8)
  const uploadErr = await checkUploadAllowed(projectId);
  if (uploadErr) return uploadErr;

  // 기능 존재 확인
  const fn = await prisma.tbDsFunction.findUnique({ where: { func_id: functionId } });
  if (!fn || fn.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "기능을 찾을 수 없습니다.", 404);
  }

  return handleProjectAttachmentUpload({
    request,
    memberId: auth.mberId,
    projectId,
    refTable: "tb_ds_function",
    refId: functionId,
    relativeDir: `functions/${projectId}/${functionId}`,
  });
}
