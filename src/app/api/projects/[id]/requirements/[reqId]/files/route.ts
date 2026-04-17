/**
 * POST /api/projects/[id]/requirements/[reqId]/files — 첨부파일 업로드 (FID-00106)
 * GET  /api/projects/[id]/requirements/[reqId]/files — 첨부파일 목록 조회
 */

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { saveFile } from "@/lib/fileStorage";

type RouteParams = { params: Promise<{ id: string; reqId: string }> };

// ─── GET: 첨부파일 목록 ──────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, reqId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const files = await prisma.tbCmAttachFile.findMany({
      where:   { ref_id: reqId, ref_tbl_nm: "tb_rq_requirement" },
      orderBy: { creat_dt: "asc" },
    });

    const items = files.map((f) => ({
      fileId:       f.attach_file_id,
      fileName:     f.orgnl_file_nm,
      fileSize:     f.file_sz,
      extension:    f.file_extsn_nm,
      uploadedAt:   f.creat_dt,
    }));

    return apiSuccess({ items });
  } catch (err) {
    console.error(`[GET files] DB 오류:`, err);
    return apiError("DB_ERROR", "첨부파일 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 첨부파일 업로드 ───────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, reqId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  // 요구사항 존재 확인
  const req = await prisma.tbRqRequirement.findUnique({ where: { req_id: reqId } });
  if (!req || req.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "요구사항을 찾을 수 없습니다.", 404);
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
    const uploaded: { fileId: string; fileName: string }[] = [];

    for (const file of files) {
      const originalName = file.name;
      const ext          = path.extname(originalName).replace(".", "").toLowerCase();
      // 저장 파일명: UUID + 확장자 (중복 방지)
      const storeName    = `${crypto.randomUUID()}.${ext || "bin"}`;
      // 물리 경로: requirements/{projectId}/{reqId}/{storeName}
      const subPath      = `requirements/${projectId}/${reqId}/${storeName}`;

      const arrayBuffer = await file.arrayBuffer();
      const buffer      = Buffer.from(arrayBuffer);

      // 파일 저장
      saveFile(subPath, buffer);

      // DB 등록
      const record = await prisma.tbCmAttachFile.create({
        data: {
          prjct_id:      projectId,
          ref_tbl_nm:    "tb_rq_requirement",
          ref_id:        reqId,
          file_ty_code:  "FILE",
          orgnl_file_nm: originalName,
          stor_file_nm:  storeName,
          file_path_nm:  subPath,
          file_sz:       buffer.length,
          file_extsn_nm: ext || "bin",
        },
      });

      uploaded.push({ fileId: record.attach_file_id, fileName: originalName });
    }

    return apiSuccess({ uploaded }, 201);
  } catch (err) {
    console.error(`[POST files] 업로드 오류:`, err);
    return apiError("DB_ERROR", "파일 업로드 중 오류가 발생했습니다.", 500);
  }
}
