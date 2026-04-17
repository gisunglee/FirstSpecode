/**
 * PUT /api/member/profile/image — 프로필 이미지 변경 (FID-00038)
 *
 * 역할:
 *   - multipart/form-data로 이미지 파일 수신
 *   - jpg/png, 최대 2MB 검증
 *   - /public/uploads/ 에 저장 (개발용 — 프로덕션은 S3 등으로 교체)
 *   - tb_cm_member.profl_img_url 업데이트
 *
 * Body: FormData { image: File }
 * Header: Authorization: Bearer <AT>
 */

import { NextRequest } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";

const MAX_SIZE_BYTES   = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES    = ["image/jpeg", "image/png"];
const UPLOAD_DIR       = join(process.cwd(), "public", "uploads", "profiles");

export async function PUT(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return apiError("VALIDATION_ERROR", "파일 업로드 형식이 올바르지 않습니다.", 400);
  }

  const file = formData.get("image");

  if (!file || !(file instanceof File)) {
    return apiError("VALIDATION_ERROR", "이미지 파일이 필요합니다.", 400);
  }

  // 형식 검증
  if (!ALLOWED_TYPES.includes(file.type)) {
    return apiError("VALIDATION_ERROR", "jpg, png 형식만 업로드 가능합니다.", 400);
  }

  // 크기 검증
  if (file.size > MAX_SIZE_BYTES) {
    return apiError("VALIDATION_ERROR", "이미지는 최대 2MB까지 업로드 가능합니다.", 400);
  }

  try {
    // 업로드 디렉토리 생성 (없으면)
    await mkdir(UPLOAD_DIR, { recursive: true });

    // 파일명: {mberId}_{timestamp}.{ext}
    const ext      = file.type === "image/png" ? "png" : "jpg";
    const filename = `${auth.mberId}_${Date.now()}.${ext}`;
    const filePath = join(UPLOAD_DIR, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    // 웹 접근 URL (public 폴더 기준)
    const imageUrl = `/uploads/profiles/${filename}`;

    await prisma.tbCmMember.update({
      where: { mber_id: auth.mberId },
      data:  { profl_img_url: imageUrl, mdfcn_dt: new Date() },
    });

    return apiSuccess({ imageUrl });

  } catch (err) {
    console.error("[PUT /api/member/profile/image] 오류:", err);
    return apiError("DB_ERROR", "이미지 업로드 중 오류가 발생했습니다.", 500);
  }
}
