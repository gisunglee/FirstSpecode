/**
 * PATCH /api/member/profile/assignee-view — 전역 담당자 필터 모드 저장
 *
 * 역할:
 *   - GNB "내 담당 모드" 토글 또는 목록 페이지의 세그먼트 토글이
 *     상태를 바꿀 때마다 호출되는 경량 엔드포인트
 *   - 본인 설정이므로 별도 권한 체크 없음 (requireAuth만)
 *
 * Body: { mode: "all" | "me" }
 * Header: Authorization: Bearer <AT>
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";

// 허용 값 — 향후 확장 시 이 상수만 늘리면 됨
const ALLOWED_MODES = ["all", "me"] as const;
type AssigneeViewMode = typeof ALLOWED_MODES[number];

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { mode } = (body ?? {}) as { mode?: unknown };

  // 화이트리스트 검증 — 잘못된 문자열은 모두 차단
  if (typeof mode !== "string" || !ALLOWED_MODES.includes(mode as AssigneeViewMode)) {
    return apiError("VALIDATION_ERROR", `mode는 ${ALLOWED_MODES.join(" | ")} 중 하나여야 합니다.`, 400);
  }

  try {
    await prisma.tbCmMember.update({
      where: { mber_id: auth.mberId },
      data:  { asignee_view_mode: mode },
    });

    return apiSuccess({ assigneeViewMode: mode });
  } catch (err) {
    console.error("[PATCH /api/member/profile/assignee-view] 오류:", err);
    return apiError("DB_ERROR", "설정 저장 중 오류가 발생했습니다.", 500);
  }
}
