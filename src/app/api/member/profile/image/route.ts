/**
 * PUT /api/member/profile/image — 프로필 이미지 변경 (FID-00038)
 *
 * 역할:
 *   - multipart/form-data로 이미지 파일 수신
 *   - jpg/png, 최대 2MB 검증
 *   - /public/uploads/profiles/{샤드}/ 에 저장 (개발용 — 프로덕션은 S3 등으로 교체)
 *   - 기존 프로필 이미지 파일은 새 파일 저장 후 삭제 (1인당 1파일 유지)
 *   - tb_cm_member.profl_img_url 업데이트
 *
 * 저장 경로 규약:
 *   public/uploads/profiles/{mberId 앞 2자}/{mberId}_{timestamp}.{ext}
 *   - UUID 앞 2자(16진수)로 샤딩 → 최대 256개 하위 폴더로 분산
 *   - 타임스탬프로 브라우저 캐시 무효화
 *
 * Body: FormData { image: File }
 * Header: Authorization: Bearer <AT>
 */

import { NextRequest } from "next/server";
import { writeFile, mkdir, unlink } from "fs/promises";
import { join } from "path";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";

const MAX_SIZE_BYTES  = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES   = ["image/jpeg", "image/png"];
const PROFILES_ROOT   = join(process.cwd(), "public", "uploads", "profiles");

// 이전 프로필 URL로부터 디스크 경로를 안전하게 복원
// - 반드시 "/uploads/profiles/"로 시작해야 함 (path traversal 방어)
// - URL이 비정상이면 null 반환해서 삭제를 건너뛰도록
function resolveOldFilePath(oldUrl: string | null | undefined): string | null {
  if (!oldUrl) return null;
  const prefix = "/uploads/profiles/";
  if (!oldUrl.startsWith(prefix)) return null;
  const rel = oldUrl.slice(prefix.length);
  // ".."나 절대경로 흔적 차단
  if (rel.includes("..") || rel.startsWith("/") || rel.startsWith("\\")) return null;
  return join(PROFILES_ROOT, rel);
}

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
    // 기존 URL 조회 — 새 파일 저장 성공 후 이 경로의 파일을 삭제할 것
    const prev = await prisma.tbCmMember.findUnique({
      where:  { mber_id: auth.mberId },
      select: { profl_img_url: true },
    });
    const oldPath = resolveOldFilePath(prev?.profl_img_url);

    // 샤드 폴더 결정 — UUID 앞 2자. UUID가 아닌 경우를 대비해 소문자/영숫자로 정규화
    const shard    = (auth.mberId.slice(0, 2) || "00").toLowerCase().replace(/[^0-9a-z]/g, "0");
    const shardDir = join(PROFILES_ROOT, shard);
    await mkdir(shardDir, { recursive: true });

    // 파일명: {mberId}_{timestamp}.{ext}
    const ext      = file.type === "image/png" ? "png" : "jpg";
    const filename = `${auth.mberId}_${Date.now()}.${ext}`;
    const filePath = join(shardDir, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    // 웹 접근 URL (public 폴더 기준)
    const imageUrl = `/uploads/profiles/${shard}/${filename}`;

    await prisma.tbCmMember.update({
      where: { mber_id: auth.mberId },
      data:  { profl_img_url: imageUrl, mdfcn_dt: new Date() },
    });

    // 새 파일·DB 업데이트 모두 성공한 뒤에 옛 파일 정리
    // 실패해도 치명적이지 않으므로 로그만 남기고 응답은 정상 진행
    if (oldPath && oldPath !== filePath) {
      unlink(oldPath).catch((e) => {
        console.warn("[PUT /api/member/profile/image] 이전 파일 삭제 실패:", oldPath, e);
      });
    }

    return apiSuccess({ imageUrl });

  } catch (err) {
    console.error("[PUT /api/member/profile/image] 오류:", err);
    return apiError("DB_ERROR", "이미지 업로드 중 오류가 발생했습니다.", 500);
  }
}
