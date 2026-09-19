/**
 * PATCH /api/projects/[id]/members/[memberId]/role — 역할 변경 (FID-00073)
 *
 * 역할:
 *   - member.changeRole 권한 보유자만 변경 가능 (OWNER/ADMIN)
 *   - 허용 값: OWNER / ADMIN / MEMBER / VIEWER (4-role 체계)
 *   - role=OWNER 는 "승격"이 아니라 "양도"다 — 아래 참고
 *
 * 소유자는 항상 1명 (2026-09-19 변경):
 *   과거에는 OWNER 를 여러 명 둘 수 있었고 "마지막 OWNER 강등 거부"로만 보호했다.
 *   결제(플랜·좌석)는 "결제자 = 프로젝트 소유자 1명"을 전제로 하므로 OWNER 를
 *   단일화했다. 그래서:
 *     - 다른 멤버를 OWNER 로 바꾸면 → 양도. 대상이 OWNER 가 되고, 요청한 현재
 *       OWNER 는 ADMIN 으로 내려가며, 프로젝트 owner_mber_id 도 함께 바뀐다.
 *       현재 OWNER 본인만 할 수 있다.
 *     - OWNER 를 다른 역할로 내리는 요청은 거부. 소유자를 바꾸는 길은 양도뿐이다.
 *   (양도 후 프로젝트를 떠나려면 transfer-and-leave 를 쓴다.)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { applyLockOnTransferOrRestore } from "@/lib/billing/lock";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { ROLE_CODES, isRoleCode } from "@/lib/permissions";

type RouteParams = { params: Promise<{ id: string; memberId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, memberId } = await params;

  // 인증 + 멤버십 + 권한(member.changeRole) 체크 한 줄
  const gate = await requirePermission(request, projectId, "member.changeRole");
  if (gate instanceof Response) return gate;

  // 요청 바디 파싱
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { role } = body as { role?: string };

  if (!isRoleCode(role)) {
    return apiError(
      "VALIDATION_ERROR",
      `유효하지 않은 역할입니다. (허용: ${ROLE_CODES.join(", ")})`,
      400
    );
  }

  // 대상 멤버 조회
  const target = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: memberId } },
  });
  if (!target || target.mber_sttus_code !== "ACTIVE") {
    return apiError("NOT_FOUND", "멤버를 찾을 수 없습니다.", 404);
  }

  // 변화 없음 — 멱등 처리
  if (target.role_code === role) {
    return apiSuccess({ memberId, role });
  }

  // 소유자 강등 거부 — 소유자를 바꾸는 유일한 경로는 양도(role=OWNER 지정)다.
  // 소유자가 0명이 되는 상태를 어떤 경로로도 만들지 않는다.
  if (target.role_code === "OWNER") {
    return apiError(
      "OWNER_TRANSFER_ONLY",
      "소유자의 역할은 직접 변경할 수 없습니다. 다른 멤버를 소유자로 지정해 양도해 주세요.",
      400
    );
  }

  // ── 양도 (role=OWNER) ──────────────────────────────────────────────────
  if (role === "OWNER") {
    // member.changeRole 권한(ADMIN 포함)만으론 부족한 비즈니스 규칙 — 소유자 본인만
    if (gate.role !== "OWNER") {
      return apiError("FORBIDDEN", "소유권 양도는 현재 소유자만 할 수 있습니다.", 403);
    }
    if (memberId === gate.mberId) {
      return apiError("VALIDATION_ERROR", "본인에게는 양도할 수 없습니다.", 400);
    }

    try {
      const now = new Date();
      // 세 곳을 한 트랜잭션에서 바꾼다 — 대상 역할, 본인 역할, 프로젝트 소유자 컬럼.
      // 하나만 바뀌면 "OWNER 역할은 A, owner_mber_id 는 B" 같은 어긋난 상태가 생긴다.
      await prisma.$transaction(async (tx) => {
        await tx.tbPjProjectMember.update({
          where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: memberId } },
          data:  { role_code: "OWNER", sttus_chg_dt: now },
        });
        await tx.tbPjProjectMember.update({
          where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: gate.mberId } },
          data:  { role_code: "ADMIN", sttus_chg_dt: now },
        });
        await tx.tbPjProject.update({
          where: { prjct_id: projectId },
          data:  { owner_mber_id: memberId },
        });
        // 새 소유자 플랜 기준으로 상한을 넘으면 잠긴 채 넘어간다 (양도 자체는 막지 않음 — 정책 §1-6)
        await applyLockOnTransferOrRestore(projectId, now, tx);
      });

      return apiSuccess({ memberId, role, transferred: true, previousOwnerRole: "ADMIN" });
    } catch (err) {
      console.error(`[PATCH /api/projects/${projectId}/members/${memberId}/role] 양도 DB 오류:`, err);
      return apiError("DB_ERROR", "소유권 양도 중 오류가 발생했습니다.", 500);
    }
  }

  // ── 일반 역할 변경 (ADMIN / MEMBER / VIEWER 사이) ──────────────────────
  try {
    await prisma.tbPjProjectMember.update({
      where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: memberId } },
      data:  { role_code: role, sttus_chg_dt: new Date() },
    });

    return apiSuccess({ memberId, role });
  } catch (err) {
    console.error(`[PATCH /api/projects/${projectId}/members/${memberId}/role] DB 오류:`, err);
    return apiError("DB_ERROR", "역할 변경 중 오류가 발생했습니다.", 500);
  }
}
