/**
 * GET  /api/projects/[id]/areas/[areaId]/files — 첨부파일 목록 조회
 * POST /api/projects/[id]/areas/[areaId]/files — 첨부파일 업로드
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { requireProjectUnlocked } from "@/lib/requireProjectUnlocked";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { checkUploadAllowed } from "@/lib/planLimits";
import { handleProjectAttachmentUpload } from "@/lib/projectAttachmentUpload";

type RouteParams = { params: Promise<{ id: string; areaId: string }> };

// ─── GET: 첨부파일 목록 ──────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, areaId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const files = await prisma.tbCmAttachFile.findMany({
      where:   { ref_id: areaId, ref_tbl_nm: "tb_ds_area" },
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
    console.error(`[GET /api/projects/${projectId}/areas/${areaId}/files] DB 오류:`, err);
    return apiError("DB_ERROR", "첨부파일 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 첨부파일 업로드 ───────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, areaId } = await params;
  // 결제 잠금(정책 §1-6) — 이 라우트는 requirePermission 을 거치지 않아 여기서 직접 막는다
  const lockErr = await requireProjectUnlocked(projectId);
  if (lockErr) return lockErr;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  // FREE 플랜은 첨부 업로드 차단 — 소유자 플랜 기준. 파일 파싱 전에 막는다 (정책 §1-8)
  const uploadErr = await checkUploadAllowed(projectId);
  if (uploadErr) return uploadErr;

  // 영역 존재 확인
  const area = await prisma.tbDsArea.findUnique({ where: { area_id: areaId } });
  if (!area || area.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "영역을 찾을 수 없습니다.", 404);
  }

  return handleProjectAttachmentUpload({
    request,
    memberId: auth.mberId,
    projectId,
    refTable: "tb_ds_area",
    refId: areaId,
    relativeDir: `areas/${projectId}/${areaId}`,
  });
}
