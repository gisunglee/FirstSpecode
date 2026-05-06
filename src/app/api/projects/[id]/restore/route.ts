/**
 * POST /api/projects/[id]/restore — 삭제 예정 프로젝트 복구
 *
 * 역할:
 *   OWNER 가 보관 기간(hard_del_dt) 안에 프로젝트를 되살린다.
 *   DELETE 의 역연산. 멤버까지 함께 원상복귀시킨다.
 *
 * 권한:
 *   OWNER 만 가능. OWNER 본인 멤버십은 DELETE 시 ACTIVE 그대로 보존되므로
 *   여기서 멤버십 + 역할 검증이 정상 동작한다.
 *
 * 흐름:
 *   1) 멤버십 + OWNER 검증
 *   2) 프로젝트 상태 검증 (del_yn='Y' AND hard_del_dt > now())
 *      - 이미 활성: 멱등 처리(200)
 *      - 이미 hard_del_dt 경과: 410 GONE (배치가 곧 정리)
 *   3) 트랜잭션:
 *      - tb_pj_project del_yn='N', 관련 컬럼 NULL
 *      - 삭제 시 함께 REMOVED 처리됐던 멤버를 ACTIVE 로 되돌림
 *        (sttus_chg_dt >= del_dt 인 REMOVED 멤버가 그 대상)
 *
 * 시스템 관리자(SUPER_ADMIN)도 자기 OWNER 프로젝트면 동일 경로로 복구 가능.
 * 다른 사람의 프로젝트 복구는 별도 어드민 API 에서 처리(예정).
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  try {
    // ① OWNER 권한 확인 — DELETE 시 OWNER 멤버십은 ACTIVE 로 보존돼 있다.
    const membership = await prisma.tbPjProjectMember.findUnique({
      where:  { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
      select: { role_code: true, mber_sttus_code: true },
    });
    if (
      !membership ||
      membership.mber_sttus_code !== "ACTIVE" ||
      membership.role_code !== "OWNER"
    ) {
      return apiError("FORBIDDEN", "OWNER만 복구할 수 있습니다.", 403);
    }

    // ② 프로젝트 상태 확인
    const project = await prisma.tbPjProject.findUnique({
      where:  { prjct_id: projectId },
      select: { del_yn: true, del_dt: true, hard_del_dt: true },
    });
    if (!project) {
      return apiError("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    }
    if (project.del_yn === "N") {
      // 이미 활성 — 멱등 처리
      return apiSuccess({ ok: true, alreadyActive: true });
    }

    const now = new Date();
    if (project.hard_del_dt && project.hard_del_dt <= now) {
      // 보관 기간이 지나 hard delete 대기 중. 배치가 곧 영구 삭제하므로 복구 거절.
      return apiError(
        "GONE_HARD_DELETE_PENDING",
        "보관 기간이 지나 영구 삭제 대기 중입니다. 더 이상 복구할 수 없습니다.",
        410
      );
    }

    // ③ 복구 트랜잭션
    const deletedAt = project.del_dt;
    await prisma.$transaction(async (tx) => {
      // 프로젝트 자체를 활성화로 되돌림
      await tx.tbPjProject.update({
        where: { prjct_id: projectId },
        data: {
          del_yn:      "N",
          del_dt:      null,
          del_mber_id: null,
          hard_del_dt: null,
        },
      });

      // 삭제 시점에 일괄 REMOVED 처리됐던 멤버들을 ACTIVE 로 되돌림.
      //
      // 식별 기준: sttus_chg_dt >= del_dt 인 REMOVED 멤버.
      //   - 보관 기간 동안 다른 API 가 모두 차단되므로 이 시점 이후
      //     자연 발생한 REMOVED 는 없다 → 안전한 식별 조건.
      //   - 보호: del_dt 가 NULL 인 비정상 상태에서는 어떤 멤버도 건드리지 않음.
      if (deletedAt) {
        await tx.tbPjProjectMember.updateMany({
          where: {
            prjct_id:        projectId,
            mber_sttus_code: "REMOVED",
            sttus_chg_dt:    { gte: deletedAt },
          },
          data: {
            mber_sttus_code: "ACTIVE",
            sttus_chg_dt:    new Date(),
          },
        });
      }
    });

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/restore] DB 오류:`, err);
    return apiError("DB_ERROR", "복구 처리 중 오류가 발생했습니다.", 500);
  }
}
