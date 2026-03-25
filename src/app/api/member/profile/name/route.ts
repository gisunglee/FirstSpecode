/**
 * PUT /api/member/profile/name — 이름 저장 (FID-00039)
 *
 * Body: { name: string }
 * Header: Authorization: Bearer <AT>
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";

export async function PUT(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { name } = (body ?? {}) as Record<string, unknown>;

  if (!name || typeof name !== "string" || !name.trim()) {
    return apiError("VALIDATION_ERROR", "이름을 입력해 주세요.", 400);
  }

  try {
    await prisma.tbCmMember.update({
      where: { mber_id: auth.mberId },
      data:  { mber_nm: name.trim(), mdfcn_dt: new Date() },
    });

    return apiSuccess({ message: "이름이 변경되었습니다." });

  } catch (err) {
    console.error("[PUT /api/member/profile/name] 오류:", err);
    return apiError("DB_ERROR", "이름 변경 중 오류가 발생했습니다.", 500);
  }
}
