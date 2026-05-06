/**
 * POST /api/admin/cleanup/projects/execute
 *   - 어드민이 선택한 soft-deleted 프로젝트를 즉시 영구 삭제
 *   - 보관기간이 만료된 것뿐 아니라, 어드민 결정으로 보관 중인 프로젝트도
 *     강제 삭제할 수 있다(=OWNER 복구권 침해 가능). UI 에서 추가 경고 필수.
 *
 * Body:
 *   {
 *     projectIds: string[],     // 삭제할 프로젝트 ID 목록 (최소 1, 최대 50)
 *     confirm:    "DELETE"      // 안전 토큰 — 정확히 "DELETE" 만 허용
 *   }
 *
 * 응답:
 *   runJob 결과 (jobId, 카운트, 최종 상태) — 어드민 UI 에서
 *   /admin/batch/[jobId] 항목별 상세로 이동할 수 있게 함.
 *
 * 안전장치:
 *   - confirm="DELETE" 토큰 (UI 에서 강제 입력)
 *   - 1회 max 50건 — 트랜잭션 길이 / 실수 방지
 *   - 입력 ID 중 del_yn='Y' 가 아닌 건은 SKIPPED 로 기록 (활성 프로젝트가
 *     실수로 들어와도 영구 삭제되지 않도록 fail-secure)
 *   - SUPER_ADMIN 인증 (requireSystemAdmin) — MCP 키 / 일반 사용자 차단
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { runJob } from "@/lib/batch/runJob";
import { hardDeleteProject } from "@/lib/batch/hardDeleteProject";
import { logAdminAction } from "@/lib/audit";

// 1회 호출당 최대 처리 건수.
// 보수적 안전값 — 큰 프로젝트는 hard delete 한 건에 30초 이상 걸릴 수 있어
// 서버리스 환경에서 timeout 위험. cron 의 정기 정리(maxItems=100)와 다르게
// 어드민 수동 실행은 버튼 1회당 더 작게 잡아 사용자 경험을 안정시킨다.
const MAX_BATCH = 20;

interface TargetProject {
  prjctId: string;
  prjctNm: string;
}

export async function POST(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  // ─── 입력 검증 ─────────────────────────────────────────────────────────
  let body: { projectIds?: unknown; confirm?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  if (body.confirm !== "DELETE") {
    return apiError(
      "VALIDATION_ERROR",
      "안전 토큰이 일치하지 않습니다. confirm:'DELETE' 가 필요합니다.",
      400
    );
  }

  if (!Array.isArray(body.projectIds) || body.projectIds.length === 0) {
    return apiError("VALIDATION_ERROR", "삭제할 프로젝트를 선택해 주세요.", 400);
  }
  if (body.projectIds.length > MAX_BATCH) {
    return apiError(
      "VALIDATION_ERROR",
      `한 번에 최대 ${MAX_BATCH}건까지 삭제할 수 있습니다. 나눠 실행해 주세요.`,
      400
    );
  }

  // 모두 string + 중복 제거
  const requestedIds = Array.from(
    new Set(
      (body.projectIds as unknown[]).filter(
        (v): v is string => typeof v === "string" && v.length > 0
      )
    )
  );
  if (requestedIds.length === 0) {
    return apiError("VALIDATION_ERROR", "유효한 프로젝트 ID 가 없습니다.", 400);
  }

  // ─── 잡 실행 ───────────────────────────────────────────────────────────
  try {
    const result = await runJob<TargetProject>({
      jobTyCode:  "PROJECT_HARD_DELETE",
      jobNm:      "프로젝트 영구 삭제 (어드민 수동)",
      trgrTyCode: "MANUAL",
      trgrMberId: gate.mberId,
      maxItems:   MAX_BATCH,
      summary:    {
        invokedAt:        new Date().toISOString(),
        adminMberId:      gate.mberId,
        requestedCnt:     requestedIds.length,
      },

      // 대상 수집 — 요청 ID 중 실제 soft-deleted 인 것만 처리. 그 외는
      // loadTargets 단계에서 제외(=잡 trgt_cnt 에 잡히지 않음). 호출자에게
      // 어떤 ID 가 누락됐는지는 응답 trgtCnt 와 비교해 인지 가능.
      async loadTargets() {
        const rows = await prisma.tbPjProject.findMany({
          where: {
            prjct_id: { in: requestedIds },
            del_yn:   "Y",                // fail-secure: 활성 프로젝트는 절대 통과 안 됨
          },
          select: { prjct_id: true, prjct_nm: true },
        });
        return rows.map((r) => ({
          item:   { prjctId: r.prjct_id, prjctNm: r.prjct_nm },
          trgtId: r.prjct_id,
          label:  r.prjct_nm,
          trgtTy: "PROJECT",
        }));
      },

      // 1건 처리 — 정기 배치와 동일한 공통 헬퍼 재사용
      async processItem(p) {
        const r = await hardDeleteProject(p.prjctId);
        return {
          status: "SUCCESS",
          meta:   { projectName: p.prjctNm, ...r },
        };
      },
    });

    // 요청 ID 중 loadTargets 단계에서 누락된 수 — fail-secure 로 걸러진 건들
    const filteredOutCnt = requestedIds.length - result.trgtCnt;

    // ─── 감사 로그 ───────────────────────────────────────────────────────
    // 어드민의 destructive 액션은 사후 책임 추적이 필수. 본 호출은
    // logAdminAction 내부에서 try/catch 되므로 실패해도 응답을 막지 않는다.
    // requestedIds 가 50건 이내라 한 줄로 평탄화해도 가독성 유지.
    await logAdminAction({
      adminMberId: gate.mberId,
      actionType:  "PROJECT_HARD_DELETE",
      targetType:  "PROJECT",
      // target_id 는 단일 컬럼이라 첫 ID 만 — 전체 목록은 memo 에 적재
      targetId:    requestedIds[0] ?? null,
      memo:
        `executed=${result.successCnt}/${result.trgtCnt} ` +
        `fail=${result.failCnt} skip=${result.skipCnt} ` +
        `filteredOut=${filteredOutCnt} requested=${requestedIds.length} ` +
        `jobId=${result.jobId} ids=${requestedIds.join(",")}`,
      ipAddr:      gate.ipAddr,
      userAgent:   gate.userAgent,
    });

    return apiSuccess({ ...result, requestedCnt: requestedIds.length, filteredOutCnt });
  } catch (err) {
    console.error("[POST /api/admin/cleanup/projects/execute] 오류:", err);
    return apiError("BATCH_ERROR", "삭제 실행 중 오류가 발생했습니다.", 500);
  }
}
