/**
 * GET  /api/projects/[id]/areas/[areaId]/files — 첨부파일 목록 조회
 * POST /api/projects/[id]/areas/[areaId]/files — 첨부파일 업로드
 */

import { NextRequest } from "next/server";
import path from "path";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { saveFile } from "@/lib/fileStorage";

type RouteParams = { params: Promise<{ id: string; areaId: string }> };

// ─── GET: 첨부파일 목록 ──────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
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
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, areaId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  // 영역 존재 확인
  const area = await prisma.tbDsArea.findUnique({ where: { area_id: areaId } });
  if (!area || area.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "영역을 찾을 수 없습니다.", 404);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return apiError("VALIDATION_ERROR", "파일 데이터를 파싱할 수 없습니다.", 400);
  }

  const files = formData.getAll("files") as File[];
  if (!files || files.length === 0) {
    return apiError("VALIDATION_ERROR", "업로드할 파일을 선택해 주세요.", 400);
  }

  try {
    const uploaded: { fileId: string; fileName: string; extension: string; fileType: string; reqRefYn: string }[] = [];

    for (const file of files) {
      const originalName = file.name;
      const ext          = path.extname(originalName).replace(".", "").toLowerCase();
      const storeName    = `${crypto.randomUUID()}.${ext || "bin"}`;
      // 물리 경로: areas/{projectId}/{areaId}/{storeName}
      const subPath      = `areas/${projectId}/${areaId}/${storeName}`;

      const arrayBuffer = await file.arrayBuffer();
      const buffer      = Buffer.from(arrayBuffer);

      // 이미지/일반 파일 구분
      const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];
      const fileType  = imageExts.includes(ext) ? "IMAGE" : "FILE";

      saveFile(subPath, buffer);

      const record = await prisma.tbCmAttachFile.create({
        data: {
          prjct_id:      projectId,
          ref_tbl_nm:    "tb_ds_area",
          ref_id:        areaId,
          file_ty_code:  fileType,
          orgnl_file_nm: originalName,
          stor_file_nm:  storeName,
          file_path_nm:  subPath,
          file_sz:       buffer.length,
          file_extsn_nm: ext || "bin",
          req_ref_yn:    "N",
        },
      });

      uploaded.push({
        fileId:    record.attach_file_id,
        fileName:  originalName,
        extension: ext || "bin",
        fileType,
        reqRefYn:  "N",
      });
    }

    return apiSuccess({ uploaded }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/areas/${areaId}/files] 업로드 오류:`, err);
    return apiError("DB_ERROR", "파일 업로드 중 오류가 발생했습니다.", 500);
  }
}
