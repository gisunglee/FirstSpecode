/**
 * POST /api/projects/[id]/unlock — 잠긴 프로젝트 "활성화" (소유자 전용, 정책 §1-6)
 *
 * 조건: 소유자 플랜 기준 상한 이하 — FREE 는 멤버(소유자·뷰어 포함) 5명 이하,
 *       구독이면 사용 좌석 ≤ 구매 좌석. 초과면 403 PROJECT_UNLOCK_OVER_LIMIT + 무엇을 줄여야 하는지 안내.
 * 이미 풀려 있으면 200 (멱등).
 *
 * requirePermission 을 쓰지 않는 이유: 잠긴 프로젝트에서 쓰기 권한은 전부 403 이라
 * 그 게이트를 통과할 수 없다. 소유자 컬럼(owner_mber_id)만 직접 확인한다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";
import { BILLING_ERROR_CODES, BILLING_PATH } from "@/lib/billing/constants";
import { unlockProjectByOwner } from "@/lib/billing/lock";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  // 잠금 해제는 결제 상태를 바꾸는 소유자 행위 — 로그인 세션에서만
  if (auth.credentialType !== "SESSION") {
    return apiError("FORBIDDEN_CREDENTIAL_SCOPE", "이 작업은 로그인 세션에서만 할 수 있습니다.", 403);
  }

  const { id: projectId } = await params;

  try {
    const project = await prisma.tbPjProject.findUnique({
      where:  { prjct_id: projectId },
      select: { owner_mber_id: true, del_yn: true, lock_yn: true },
    });
    if (!project || project.del_yn === "Y") {
      return apiError("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    }
    if (project.owner_mber_id !== auth.mberId) {
      return apiError("FORBIDDEN", "프로젝트 소유자만 활성화할 수 있습니다.", 403);
    }
    if (project.lock_yn !== "Y") {
      return apiSuccess({ unlocked: true, alreadyActive: true });
    }

    const result = await unlockProjectByOwner(projectId);
    if (result.unlocked) {
      return apiSuccess({ unlocked: true, alreadyActive: false });
    }

    const v = result.verdict;
    const message =
      v.reason === "FREE_MEMBERS"
        ? `FREE 플랜은 멤버 ${v.limit}명(소유자·뷰어 포함) 이하인 프로젝트만 활성화할 수 있습니다. ` +
          `현재 ${v.memberCount}명입니다. 멤버를 줄이거나 구독을 시작해 주세요.`
        : `구매한 좌석 ${v.limit}개를 넘어 편집 멤버 ${v.usedSeats}명이 있습니다. ` +
          "좌석을 추가하거나 편집 멤버를 뷰어로 바꿔 주세요.";

    return apiError(BILLING_ERROR_CODES.UNLOCK_OVER_LIMIT, message, 403, { ...v, billingPath: BILLING_PATH });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/unlock] 오류:`, err);
    return apiError("DB_ERROR", "활성화 처리 중 오류가 발생했습니다.", 500);
  }
}
