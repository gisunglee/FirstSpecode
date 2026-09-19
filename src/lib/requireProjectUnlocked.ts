/**
 * requireProjectUnlocked — 결제 잠금(lock_yn='Y') 프로젝트의 쓰기 차단 (정책 §1-6)
 *
 * 역할:
 *   - requirePermission 을 거치지 않는 쓰기 라우트(requireAuth + 자체 멤버십 검사 방식)가
 *     한 줄로 잠금을 판정할 수 있게 한다. 판정 규칙·에러 응답은 requirePermission 과 같다.
 *   - 잠금은 "이 소유자의 플랜으로는 편집할 수 없다"는 표시라 조회는 그대로 두고 쓰기만 막는다.
 *
 * 왜 따로 두는가:
 *   잠금 검사는 원래 requirePermission 한 곳에서 하기로 했지만(정책 §1-10), 이 앱에는
 *   requireAuth 만 쓰고 멤버십·역할을 직접 확인하는 쓰기 라우트가 20여 개 있다(AI 요청·첨부·복사 등).
 *   그 라우트들이 잠금을 모르면 "잠긴 프로젝트는 읽기 전용" 약속이 깨진다(2026-09-20 점검에서 발견).
 *
 * 사용법:
 *   const { id: projectId } = await params;
 *   const lockErr = await requireProjectUnlocked(projectId);
 *   if (lockErr) return lockErr;   // 403 PROJECT_LOCKED
 *
 * 잠금 중에도 허용해야 하는 정리 동작(멤버 제거·역할 강등·삭제·양도·탈퇴·초대 취소·AI 태스크 취소)
 * 에는 이 함수를 호출하지 않는다.
 */

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";
import { BILLING_ERROR_CODES, BILLING_PATH } from "@/lib/billing/constants";

/** 잠금 403 응답 — requirePermission 과 같은 코드·문구·extra 를 쓴다 (프론트 분기 통일) */
export function projectLockedError(): Response {
  return apiError(
    BILLING_ERROR_CODES.PROJECT_LOCKED,
    "이 프로젝트는 읽기 전용으로 잠겨 있습니다. 소유자가 구독을 갱신하거나 프로젝트 목록에서 활성화하면 편집할 수 있습니다.",
    403,
    { billingPath: BILLING_PATH }
  );
}

/**
 * 프로젝트가 잠겨 있으면 403 Response, 아니면 null.
 * 프로젝트가 없으면 null — 존재 여부는 호출부의 404 처리에 맡긴다.
 */
export async function requireProjectUnlocked(projectId: string): Promise<Response | null> {
  const project = await prisma.tbPjProject.findUnique({
    where:  { prjct_id: projectId },
    select: { lock_yn: true },
  });
  if (project?.lock_yn === "Y") return projectLockedError();
  return null;
}
