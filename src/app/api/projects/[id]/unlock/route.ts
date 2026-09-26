/**
 * POST /api/projects/[id]/unlock — 잠긴 프로젝트 "활성화" (소유자 전용, 정책 §1-6)
 *
 * 조건: 소유자 플랜 기준 상한 이하 — FREE 는 편집 멤버가 소유자뿐이고 열려 있는 다른 소유 프로젝트가 없을 때,
 *       구독이면 사용 좌석 ≤ 구매 좌석. 초과면 403 PROJECT_UNLOCK_OVER_LIMIT + 무엇을 줄여야 하는지 안내.
 * 이미 풀려 있으면 200 (멱등).
 *
 * body (선택) { closeProjectIds: string[] } — "열린 프로젝트 교체".
 *   FREE 는 열린 소유 프로젝트가 1개뿐이라 A 를 닫아야 B 를 열 수 있다. 이 목록을 잠근 뒤 같은
 *   트랜잭션에서 [id] 를 연다. 닫은 뒤에도 상한을 넘으면 전체 롤백이라 "둘 다 잠긴" 상태가 생기지 않는다.
 *   body 를 주지 않으면 기존 동작 그대로다(하위호환).
 *
 * requirePermission 을 쓰지 않는 이유: 잠긴 프로젝트에서 쓰기 권한은 전부 403 이라
 * 그 게이트를 통과할 수 없다. 소유자 컬럼(owner_mber_id)만 직접 확인한다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";
import { BILLING_ERROR_CODES, BILLING_PATH } from "@/lib/billing/constants";
import { swapOpenProject, unlockProjectByOwner, type OverLimitVerdict } from "@/lib/billing/lock";

type RouteParams = { params: Promise<{ id: string }> };

/** 한 번에 닫을 수 있는 프로젝트 수 상한 — 정상 흐름은 1개다. 비정상 입력 방어용 */
const MAX_CLOSE_TARGETS = 50;

/** 상한 초과 사유 → 사용자 안내 문구. 라우트 응답·교체 실패에서 같은 문구를 쓴다 */
function overLimitMessage(v: Extract<OverLimitVerdict, { over: true }>): string {
  if (v.reason === "FREE_EDITORS") {
    return `FREE 플랜은 소유자 혼자 편집하는 프로젝트만 활성화할 수 있습니다. 지금 편집 멤버가 ${v.editorCount}명입니다. ` +
      "다른 편집 멤버를 뷰어로 바꾸거나 구독을 시작해 주세요.";
  }
  if (v.reason === "FREE_PROJECTS") {
    return `FREE 플랜은 프로젝트를 한 번에 ${v.limit}개만 열 수 있습니다. 지금 열려 있는 소유 프로젝트가 ${v.openProjectCount}개 있습니다. ` +
      "그 프로젝트를 닫고 이 프로젝트를 열거나, 구독을 시작해 주세요.";
  }
  return `구매한 좌석 ${v.limit}개를 넘어 편집 멤버 ${v.usedSeats}명이 있습니다. ` +
    "좌석을 추가하거나 편집 멤버를 뷰어로 바꿔 주세요.";
}

/**
 * body 에서 closeProjectIds 를 꺼낸다. body 가 없거나 비어 있으면 빈 배열(기존 동작).
 * 형식이 틀리면 null 을 돌려 라우트가 400 으로 막는다 — 잘못된 입력으로 남의 프로젝트를 건드리지 않게.
 */
function parseCloseProjectIds(body: unknown): string[] | null {
  if (body === null || body === undefined) return [];
  if (typeof body !== "object") return null;
  const raw = (body as Record<string, unknown>).closeProjectIds;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_CLOSE_TARGETS) return null;
  const ids = raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return ids.length === raw.length ? ids : null;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  // 잠금 해제는 결제 상태를 바꾸는 소유자 행위 — 로그인 세션에서만
  if (auth.credentialType !== "SESSION") {
    return apiError("FORBIDDEN_CREDENTIAL_SCOPE", "이 작업은 로그인 세션에서만 할 수 있습니다.", 403);
  }

  const { id: projectId } = await params;

  // body 는 선택 — 없는 요청(기존 클라이언트)도 그대로 받아야 한다
  let body: unknown = null;
  try {
    const text = await request.text();
    body = text.trim() === "" ? null : JSON.parse(text);
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const closeProjectIds = parseCloseProjectIds(body);
  if (closeProjectIds === null) {
    return apiError("VALIDATION_ERROR", "closeProjectIds 는 프로젝트 ID 문자열 배열이어야 합니다.", 400);
  }

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
    // 이미 열려 있으면 아무것도 닫지 않는다 — 멱등. 닫기는 "열기 위해서만" 일어난다(정책 §1-6)
    if (project.lock_yn !== "Y") {
      return apiSuccess({ unlocked: true, alreadyActive: true, closedProjectIds: [] });
    }

    // ── 교체: 지정한 프로젝트를 닫고 이 프로젝트를 연다 (한 트랜잭션, 실패 시 전체 롤백) ──
    if (closeProjectIds.length > 0) {
      const swap = await swapOpenProject(auth.mberId, projectId, closeProjectIds, new Date());
      if (swap.unlocked) {
        return apiSuccess({ unlocked: true, alreadyActive: false, closedProjectIds: swap.closedProjectIds });
      }
      if (swap.reason === "INVALID_CLOSE_TARGET") {
        return apiError("FORBIDDEN", "닫으려는 프로젝트 중 소유자가 아니거나 존재하지 않는 것이 있습니다.", 403, {
          invalidIds: swap.invalidIds,
        });
      }
      // 닫은 뒤에도 상한 초과 — 롤백되어 아무것도 닫히지 않았다
      return apiError(BILLING_ERROR_CODES.UNLOCK_OVER_LIMIT, overLimitMessage(swap.verdict), 403, {
        ...swap.verdict, rolledBack: true, billingPath: BILLING_PATH,
      });
    }

    // ── 기존 동작: 지금 상태로 열 수 있으면 연다 ──
    const result = await unlockProjectByOwner(projectId);
    if (result.unlocked) {
      return apiSuccess({ unlocked: true, alreadyActive: false, closedProjectIds: [] });
    }

    return apiError(BILLING_ERROR_CODES.UNLOCK_OVER_LIMIT, overLimitMessage(result.verdict), 403, {
      ...result.verdict, billingPath: BILLING_PATH,
    });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/unlock] 오류:`, err);
    return apiError("DB_ERROR", "활성화 처리 중 오류가 발생했습니다.", 500);
  }
}
