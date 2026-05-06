/**
 * runJob — 배치 잡 실행 + 로그 표준화 헬퍼
 *
 * 모든 정기/수동 배치는 이 헬퍼를 통해 실행한다. 잡 종류별 처리 본체
 * (loadTargets / processItem) 만 작성하면 다음이 자동 처리된다.
 *
 *   1) 동시 실행 방지 — 같은 job_ty_code 의 RUNNING 잡이 있으면 거부 (좀비
 *      잡은 STALE_TIMEOUT_MS 지나면 자동 인계)
 *   2) tb_cm_batch_job 한 행 생성 (sttus=RUNNING, bgng_dt=now)
 *   3) loadTargets 로 대상 목록 수집 (maxItems 적용)
 *   4) 각 항목별로 processItem 호출 → 성공/실패/스킵을 tb_cm_batch_job_item
 *      에 적재 (한 항목 실패가 다른 항목 처리를 막지 않음)
 *   5) 잡 종료 시 카운트 합산 + 최종 상태(SUCCESS/PARTIAL/FAILED) 결정
 *      종료 update 는 finally 안에서 — 본체가 무엇을 throw 하든 잡이 영원히
 *      RUNNING 으로 남는 좀비 사태를 방지.
 *
 * 트랜잭션 정책:
 *   - 잡 메타·항목 결과는 매번 커밋 (큰 트랜잭션으로 묶지 않음). 어떤 항목
 *     에서 죽어도 그때까지의 로그가 남아 디버깅에 도움.
 *   - processItem 본체에서 자체 트랜잭션을 사용한다 (필요 시).
 *
 * 새 배치 잡 추가 절차:
 *   1) job_ty_code 상수 정의
 *   2) loadTargets: 대상 목록 반환 (식별 정보 포함)
 *   3) processItem: 1건 처리 (성공이면 throw 안 함, 실패면 throw)
 *   4) 엔드포인트(/api/admin/batch/run/<name>) 에서 runJob() 호출
 */

import { prisma } from "@/lib/prisma";

/** 잡 트리거 종류 — CRON(외부 스케줄러) / MANUAL(어드민 버튼) */
export type BatchTriggerType = "CRON" | "MANUAL";

/**
 * RUNNING 인 잡이 이만큼 묵으면 좀비로 간주하고 새 잡이 인계한다.
 *
 * 사유:
 *   process kill 등으로 finally 블록조차 못 돌면 잡이 RUNNING 으로 남는다.
 *   이후 잡 시작 자체가 영원히 막히지 않도록 시간 기반 fail-safe.
 *   값은 "정상 잡이라면 이 시간을 절대 안 넘는다" 정도로 설정.
 */
const STALE_TIMEOUT_MS = 30 * 60 * 1000; // 30분

/** 항목 처리 결과 — processItem 의 반환/예외 매핑에 사용 */
type ItemResult =
  | { status: "SUCCESS"; meta?: unknown }
  | { status: "SKIPPED"; reason?: string; meta?: unknown }
  // 의도적으로 status: 'FAILED' 는 직접 반환하지 않고 throw 로만 표현 →
  // 실수로 성공 분기로 빠지는 사고를 차단.
;

/** runJob 인자 — 호출자가 잡 종류별 본체만 채워 넣는다. */
export interface RunJobOptions<TItem> {
  /** 잡 종류 코드 (PROJECT_HARD_DELETE 등) */
  jobTyCode: string;
  /** 어드민 UI 표시용 이름 */
  jobNm:     string;
  /** 트리거 종류 */
  trgrTyCode: BatchTriggerType;
  /** 수동 트리거인 경우의 운영자 멤버 ID */
  trgrMberId?: string | null;
  /** 잡 메타 (보관기간/임계값 등) — summary_json 에 저장 */
  summary?:   Record<string, unknown>;
  /** 1회 잡당 최대 처리 항목 수 — 트랜잭션 길이 통제 */
  maxItems?:  number;

  /** 처리 대상 목록 수집. 식별/사후 추적 정보를 함께 반환. */
  loadTargets(): Promise<Array<{
    item:    TItem;
    trgtId:  string;
    label?:  string;          // 사후 추적용 라벨(프로젝트명, 파일명 등)
    trgtTy:  string;          // 'PROJECT' | 'ATTACH_FILE' 등
  }>>;

  /** 항목 1건 처리. 성공/스킵 명시, 그 외는 throw → FAILED 기록. */
  processItem(item: TItem): Promise<ItemResult>;
}

export interface RunJobResult {
  jobId:       string;
  trgtCnt:     number;
  successCnt:  number;
  failCnt:     number;
  skipCnt:     number;
  ttusCode:    "SUCCESS" | "PARTIAL" | "FAILED";
  /** 같은 종류 잡이 이미 RUNNING 이라 거부됐을 때만 true. 다른 필드는 의미 없음. */
  alreadyRunning?: boolean;
  /** 거부된 경우 기존 RUNNING 잡의 ID — 호출자가 "이미 돌고 있어요" 안내에 사용 */
  inflightJobId?: string;
}

/**
 * 잡 1회 실행. 항상 호출자에게 결과 카운트를 반환한다 (잡 자체가 죽어도
 * 가능한 만큼 카운트 + sttus_code='FAILED' 로 마킹 후 반환).
 */
export async function runJob<TItem>(opts: RunJobOptions<TItem>): Promise<RunJobResult> {
  const maxItems = opts.maxItems ?? 100;

  // ── ① 동시 실행 방지 ────────────────────────────────────────────────
  //
  // 같은 job_ty_code 의 RUNNING 잡이 있으면 새 잡 시작을 거부한다. 단,
  // STALE_TIMEOUT_MS 가 지난 RUNNING 은 좀비로 간주(=프로세스 kill 등으로
  // 종료 마킹을 못 했음) — FAILED 로 강제 마킹 후 새 잡이 인계.
  const staleBefore = new Date(Date.now() - STALE_TIMEOUT_MS);
  const inflight = await prisma.tbCmBatchJob.findFirst({
    where:   { job_ty_code: opts.jobTyCode, sttus_code: "RUNNING" },
    select:  { job_id: true, bgng_dt: true },
    orderBy: { bgng_dt: "desc" },
  });

  if (inflight) {
    if (inflight.bgng_dt < staleBefore) {
      // 좀비 잡 정리 — 더 이상 살아있을 가능성 없음
      await prisma.tbCmBatchJob.update({
        where: { job_id: inflight.job_id },
        data:  {
          sttus_code: "FAILED",
          end_dt:     new Date(),
          error_msg:  `STALE — ${STALE_TIMEOUT_MS / 60_000}분 이상 RUNNING 으로 방치되어 새 잡이 인계함`,
        },
      });
      console.warn(
        `[batch:${opts.jobTyCode}] 좀비 잡 정리: ${inflight.job_id} (시작 ${inflight.bgng_dt.toISOString()})`
      );
    } else {
      // 정상 RUNNING 잡과 충돌 — 새 잡은 시작하지 않음
      return {
        jobId:          inflight.job_id,
        trgtCnt:        0,
        successCnt:     0,
        failCnt:        0,
        skipCnt:        0,
        ttusCode:       "FAILED",
        alreadyRunning: true,
        inflightJobId:  inflight.job_id,
      };
    }
  }

  // ── ② 잡 시작 기록 ──────────────────────────────────────────────────
  const job = await prisma.tbCmBatchJob.create({
    data: {
      job_ty_code:  opts.jobTyCode,
      job_nm:       opts.jobNm,
      trgr_ty_code: opts.trgrTyCode,
      trgr_mber_id: opts.trgrMberId ?? null,
      sttus_code:   "RUNNING",
      summary_json: opts.summary ? (opts.summary as object) : undefined,
    },
    select: { job_id: true },
  });

  let trgtCnt    = 0;
  let successCnt = 0;
  let failCnt    = 0;
  let skipCnt    = 0;
  let jobError:  string | null = null;

  // ── ③·④ 본체 + 항목 단위 격리 처리 ──────────────────────────────
  //
  // 종료 update 가 항상 돌도록 try/finally 로 감싼다. 본체에서 무엇을
  // throw 하든, 항목 로그 적재가 실패하든, 잡은 마지막에 정확한 상태로
  // 마킹된다.
  try {
    const targets = (await opts.loadTargets()).slice(0, maxItems);
    trgtCnt = targets.length;

    for (const t of targets) {
      try {
        const result = await opts.processItem(t.item);
        if (result.status === "SKIPPED") {
          skipCnt++;
          await persistItemLog(opts.jobTyCode, {
            job_id:       job.job_id,
            trgt_ty_code: t.trgtTy,
            trgt_id:      t.trgtId,
            trgt_label:   t.label,
            sttus_code:   "SKIPPED",
            error_msg:    result.reason ?? null,
            meta_json:    result.meta ? (result.meta as object) : undefined,
          });
        } else {
          successCnt++;
          await persistItemLog(opts.jobTyCode, {
            job_id:       job.job_id,
            trgt_ty_code: t.trgtTy,
            trgt_id:      t.trgtId,
            trgt_label:   t.label,
            sttus_code:   "SUCCESS",
            meta_json:    result.meta ? (result.meta as object) : undefined,
          });
        }
      } catch (err) {
        failCnt++;
        console.error(
          `[batch:${opts.jobTyCode}] item ${t.trgtId} (${t.label ?? ""}) 실패:`,
          err
        );
        await persistItemLog(opts.jobTyCode, {
          job_id:       job.job_id,
          trgt_ty_code: t.trgtTy,
          trgt_id:      t.trgtId,
          trgt_label:   t.label,
          sttus_code:   "FAILED",
          error_msg:    truncateError(err),
        });
      }
    }
  } catch (err) {
    // 잡 자체가 catastrophic 실패 (대상 수집 단계 등)
    jobError = truncateError(err);
    console.error(`[batch:${opts.jobTyCode}] 잡 실패:`, err);
  } finally {
    // ── ⑤ 잡 종료 — 본체가 무엇을 throw 하든 항상 실행 ─────────────
    const ttusCode: RunJobResult["ttusCode"] =
      jobError !== null
        ? "FAILED"
        : failCnt > 0 && successCnt === 0 && skipCnt === 0
          ? "FAILED"
          : failCnt > 0
            ? "PARTIAL"
            : "SUCCESS";

    try {
      await prisma.tbCmBatchJob.update({
        where: { job_id: job.job_id },
        data:  {
          sttus_code:  ttusCode,
          end_dt:      new Date(),
          trgt_cnt:    trgtCnt,
          success_cnt: successCnt,
          fail_cnt:    failCnt,
          skip_cnt:    skipCnt,
          error_msg:   jobError,
        },
      });
      // FAILED / PARTIAL 은 운영자 알림 대상 — 콘솔에도 강조해 표시.
      // (Sentry / Slack webhook 연동 시 이 로그 라인을 트리거로 사용)
      if (ttusCode !== "SUCCESS") {
        console.error(
          `[batch:${opts.jobTyCode}] JOB_${ttusCode} job=${job.job_id} ` +
          `targets=${trgtCnt} success=${successCnt} fail=${failCnt} skip=${skipCnt}`
        );
      }
    } catch (updateErr) {
      // 종료 update 자체가 실패하면 잡이 RUNNING 으로 남아 다음 잡을 차단.
      // STALE_TIMEOUT_MS 후 자동 인계되도록 설계되어 있긴 하지만, 운영자가
      // 즉시 인지할 수 있도록 별도 ERROR 로그.
      console.error(
        `[batch:${opts.jobTyCode}] CRITICAL — 잡 종료 update 실패. ` +
        `${STALE_TIMEOUT_MS / 60_000}분 후 자동 인계 예정. job=${job.job_id}`,
        updateErr
      );
    }
  }

  return {
    jobId:      job.job_id,
    trgtCnt,
    successCnt,
    failCnt,
    skipCnt,
    ttusCode:   jobError ? "FAILED" : (failCnt > 0 && successCnt === 0 && skipCnt === 0)
      ? "FAILED"
      : failCnt > 0 ? "PARTIAL" : "SUCCESS",
  };
}

// ─── 내부 헬퍼 ────────────────────────────────────────────────────────────

/**
 * 항목 로그 적재 — 자체 try/catch 로 실패해도 호출자 흐름을 막지 않는다.
 *
 * 로그 적재가 실패하더라도 hard delete 같은 "이미 끝난 본체 처리" 까지
 * 되돌릴 수는 없다. 따라서 콘솔에라도 흔적을 남겨 사후 추적이 가능하도록.
 */
async function persistItemLog(
  jobTyCode: string,
  data: {
    job_id:       string;
    trgt_ty_code: string;
    trgt_id:      string;
    trgt_label?:  string;
    sttus_code:   "SUCCESS" | "FAILED" | "SKIPPED";
    error_msg?:   string | null;
    meta_json?:   object;
  },
): Promise<void> {
  try {
    await prisma.tbCmBatchJobItem.create({ data });
  } catch (err) {
    console.error(
      `[batch:${jobTyCode}] 항목 로그 적재 실패 — job=${data.job_id} ` +
      `target=${data.trgt_id} status=${data.sttus_code}`,
      err
    );
  }
}

/** 에러 메시지 길이 제한 — DB / 콘솔 보호 */
function truncateError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const MAX = 4_000;
  return msg.length > MAX ? msg.slice(0, MAX) + " …(truncated)" : msg;
}
