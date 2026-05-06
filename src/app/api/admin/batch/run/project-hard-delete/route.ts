/**
 * POST /api/admin/batch/run/project-hard-delete
 *   - 보관 기간이 지난 soft-deleted 프로젝트의 영구 삭제 배치
 *   - 외부 cron 또는 SUPER_ADMIN 어드민이 호출
 *
 * 호출:
 *   외부 cron:  curl -X POST -H 'X-Cron-Secret: <env>' .../project-hard-delete
 *   어드민:     "수동 실행" 버튼에서 동일 엔드포인트 호출 (JWT 세션)
 *
 * 동작:
 *   1) del_yn='Y' AND hard_del_dt <= now() 인 프로젝트 목록 수집
 *   2) 각 프로젝트별 트랜잭션 안에서:
 *      - 첨부파일의 디스크 경로 목록을 미리 수집 (CASCADE 전)
 *      - tb_pj_project DELETE → CASCADE 로 23+ 테이블 자동 정리
 *      - DELETE 가 트랜잭션 안에서 깨질 경우 디스크는 건드리지 않는다
 *   3) 트랜잭션 커밋 성공 후 디스크 파일 best-effort 삭제
 *      (디스크 실패는 잡 차원에서 WARN 로그만 — DB 는 이미 정리됨)
 *   4) runJob 헬퍼가 항목별 SUCCESS/FAILED 를 tb_cm_batch_job_item 에 기록
 *
 * 주의:
 *   디스크 파일 경로(file_path_nm)는 절대 경로/상대 경로 형태가 환경마다
 *   다를 수 있다. 본 배치는 file_path_nm 을 그대로 신뢰하고 fs.unlink 한다.
 *   업로드 코드와 일치시키는 책임은 업로드/배치 양쪽 동시에 있음.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { runJob } from "@/lib/batch/runJob";
import { requireBatchAuth } from "@/lib/batch/requireBatchAuth";
import { hardDeleteProject } from "@/lib/batch/hardDeleteProject";

interface TargetProject {
  prjctId:    string;
  prjctNm:    string;
  hardDelDt:  Date | null;
}

export async function POST(request: NextRequest) {
  const auth = await requireBatchAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const result = await runJob<TargetProject>({
      jobTyCode:  "PROJECT_HARD_DELETE",
      jobNm:      "프로젝트 영구 삭제",
      trgrTyCode: auth.trigger,
      trgrMberId: auth.mberId,
      maxItems:   100,                // 한 회 최대 처리량
      summary:    { invokedAt: new Date().toISOString() },

      // 처리 대상: 보관 기간이 지난 soft-deleted 프로젝트
      async loadTargets() {
        const now = new Date();
        const rows = await prisma.tbPjProject.findMany({
          where:  {
            del_yn:      "Y",
            hard_del_dt: { lte: now },
          },
          select: { prjct_id: true, prjct_nm: true, hard_del_dt: true },
          // 가장 오래된 것부터 처리 — 운영 직관
          orderBy: { hard_del_dt: "asc" },
        });
        return rows.map((r) => ({
          item:   { prjctId: r.prjct_id, prjctNm: r.prjct_nm, hardDelDt: r.hard_del_dt },
          trgtId: r.prjct_id,
          label:  r.prjct_nm,
          trgtTy: "PROJECT",
        }));
      },

      // 1건 처리 — 공통 헬퍼에 위임 (어드민 수동 정리 경로와 동일 로직 공유)
      async processItem(p) {
        const result = await hardDeleteProject(p.prjctId);
        return {
          status: "SUCCESS",
          meta: {
            projectName: p.prjctNm,
            hardDelDt:   p.hardDelDt?.toISOString() ?? null,
            ...result,
          },
        };
      },
    });

    return apiSuccess(result);
  } catch (err) {
    console.error("[POST /api/admin/batch/run/project-hard-delete] 오류:", err);
    return apiError("BATCH_ERROR", "배치 실행 중 오류가 발생했습니다.", 500);
  }
}
