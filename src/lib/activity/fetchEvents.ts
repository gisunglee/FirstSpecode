/**
 * fetchEvents — 여러 테이블에서 활동 이벤트를 모아 통합 스트림으로 반환
 *
 * 역할:
 *   - tb_ds_design_change / tb_ds_review_request / tb_ai_task 에서 시간 역순으로 수집
 *   - 각 행을 ActivityEvent 표준 모양으로 정규화
 *   - 행위자/대상의 표시명을 미리 join (클라이언트 N+1 방지)
 *
 * 페이지네이션:
 *   - cursor (ISO timestamp) 보다 더 옛 항목만 반환
 *   - limit (기본 50) 까지 자르고 nextCursor 계산
 *
 * 격리:
 *   - 이 모듈은 prisma 만 의존. dashboard 쪽 코드와 import 관계 없음.
 *   - 새 이벤트 타입은 fetchXxx 함수 하나 추가 + ActivityKind 에 코드 등록만으로 확장.
 */

import { prisma } from "@/lib/prisma";
import type { ActivityEvent, ActivityKind } from "@/types/activity";

const MAX_LIMIT     = 100;  // 한 페이지 최대 — 무한 스크롤 폭주 방지
const DEFAULT_LIMIT = 50;

// ── 대상 라벨 매핑 ──────────────────────────────────────────────────────────
//
// ref_tbl_nm 을 한국어 라벨로 변환. 변경 시 UI 자동 반영.
const REF_TBL_LABEL: Record<string, string> = {
  tb_ds_unit_work:    "단위업무",
  tb_ds_screen:       "화면",
  tb_ds_area:         "영역",
  tb_ds_function:     "기능",
  tb_rq_requirement:  "요구사항",
  tb_rq_user_story:   "사용자스토리",
};

const AI_REF_TYPE_LABEL: Record<string, string> = {
  UNIT_WORK: "단위업무",
  AREA:      "영역",
  FUNCTION:  "기능",
  SCREEN:    "화면",
};

const CHG_TYPE_LABEL: Record<string, string> = {
  CREATE: "생성",
  UPDATE: "수정",
  DELETE: "삭제",
};

const AI_TASK_TYPE_LABEL: Record<string, string> = {
  INSPECT:   "명세 검토",
  DESIGN:    "설계",
  IMPLEMENT: "구현",
  MOCKUP:    "목업",
  IMPACT:    "영향도",
  CUSTOM:    "자유",
};

export type FetchEventsOptions = {
  projectId: string;
  /** 이 시각 이전의 이벤트만 (무한 스크롤용). 없으면 현재부터. */
  cursor?:   Date;
  /** 가장 오래된 허용 시각 (기간 필터). 없으면 무제한. */
  since?:    Date;
  /** 페이지 크기. 기본 50, 최대 100. */
  limit?:    number;
};

/**
 * 통합 활동 피드 조회.
 *
 * 전략:
 *   - 각 테이블에서 (limit + 1) 건씩 가져옴 → 합본 → 시간 역순 정렬 → limit 으로 자름
 *   - "+1" 은 다음 커서 존재 여부 판정용
 *
 * 비용:
 *   - 3개 테이블 병렬 조회. 각각 (prjct_id, occurredAt DESC) 인덱스로 가벼움.
 *   - 응답 가공이 메모리에서 일어나지만 limit 50 × 3 = 150건이라 충분히 빠름.
 */
export async function fetchActivityEvents(opts: FetchEventsOptions): Promise<{
  events:     ActivityEvent[];
  nextCursor: string | null;
}> {
  const { projectId, cursor, since } = opts;
  const limit = Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? DEFAULT_LIMIT));

  // 각 소스에서 "limit+1" 건씩 가져온 뒤 합본·정렬·자르기.
  // 더 가져오면 메모리 낭비, 덜 가져오면 합본 후 정렬 시 한 소스가 부족할 수 있음.
  const perSourceTake = limit + 1;

  const [designChanges, reviewRequests, aiDoneTasks] = await Promise.all([
    prisma.tbDsDesignChange.findMany({
      where: {
        prjct_id: projectId,
        ...(cursor ? { chg_dt: { lt: cursor } } : {}),
        ...(since  ? { chg_dt: { gte: since, ...(cursor ? { lt: cursor } : {}) } } : {}),
      },
      orderBy: { chg_dt: "desc" },
      take: perSourceTake,
      select: {
        chg_id:        true,
        chg_dt:        true,
        chg_mber_id:   true,
        chg_type_code: true,
        chg_rsn_cn:    true,
        ref_tbl_nm:    true,
        ref_id:        true,
      },
    }),

    prisma.tb_ds_review_request.findMany({
      where: {
        prjct_id: projectId,
        ...(cursor ? { creat_dt: { lt: cursor } } : {}),
        ...(since  ? { creat_dt: { gte: since, ...(cursor ? { lt: cursor } : {}) } } : {}),
      },
      orderBy: { creat_dt: "desc" },
      take: perSourceTake,
      select: {
        review_id:       true,
        creat_dt:        true,
        req_mber_id:     true,
        revwr_mber_id:   true,
        review_title_nm: true,
        ref_tbl_nm:      true,
        ref_id:          true,
      },
    }),

    // AI 완료 — compl_dt 기준 (req_dt 가 아니라 "결과 나온 시점" 이 활동)
    prisma.tbAiTask.findMany({
      where: {
        prjct_id:        projectId,
        task_sttus_code: "DONE",
        compl_dt:        {
          not: null,
          ...(cursor ? { lt: cursor } : {}),
          ...(since  ? { gte: since } : {}),
        },
      },
      orderBy: { compl_dt: "desc" },
      take: perSourceTake,
      select: {
        ai_task_id:   true,
        compl_dt:     true,
        req_mber_id:  true,
        task_ty_code: true,
        ref_ty_code:  true,
        ref_id:       true,
      },
    }),
  ]);

  // ── 멤버 / 검토자 표시명 일괄 조회 (N+1 방지) ──────────────────────────
  const memberIds = [
    ...new Set(
      [
        ...designChanges.map((d) => d.chg_mber_id),
        ...reviewRequests.flatMap((r) => [r.req_mber_id, r.revwr_mber_id]),
        ...aiDoneTasks.map((a) => a.req_mber_id),
      ].filter((v): v is string => !!v)
    ),
  ];

  const members = memberIds.length > 0
    ? await prisma.tbCmMember.findMany({
        where:  { mber_id: { in: memberIds } },
        select: { mber_id: true, mber_nm: true, email_addr: true },
      })
    : [];

  const nameMap = new Map(
    members.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null])
  );

  // ── 통합 → 정규화 → 정렬 → 자르기 ────────────────────────────────────
  const merged: ActivityEvent[] = [
    ...designChanges.map((d): ActivityEvent => ({
      eventId:     `dc:${d.chg_id}`,
      kind:        "DESIGN_CHANGE" satisfies ActivityKind,
      occurredAt:  d.chg_dt.toISOString(),
      actorMberId: d.chg_mber_id,
      actorName:   d.chg_mber_id ? (nameMap.get(d.chg_mber_id) ?? null) : null,
      targetTblNm: d.ref_tbl_nm,
      targetId:    d.ref_id,
      targetLabel: REF_TBL_LABEL[d.ref_tbl_nm] ?? d.ref_tbl_nm,
      meta: {
        chgTypeCode: d.chg_type_code,
        chgTypeLbl:  CHG_TYPE_LABEL[d.chg_type_code] ?? d.chg_type_code,
        reason:      d.chg_rsn_cn,
      },
    })),

    ...reviewRequests.map((r): ActivityEvent => ({
      eventId:     `rv:${r.review_id}`,
      kind:        "REVIEW_REQUEST" satisfies ActivityKind,
      occurredAt:  r.creat_dt.toISOString(),
      actorMberId: r.req_mber_id,
      actorName:   nameMap.get(r.req_mber_id) ?? null,
      targetTblNm: r.ref_tbl_nm,
      targetId:    r.ref_id,
      targetLabel: REF_TBL_LABEL[r.ref_tbl_nm] ?? r.ref_tbl_nm,
      meta: {
        title:        r.review_title_nm,
        reviewerName: nameMap.get(r.revwr_mber_id) ?? null,
      },
    })),

    ...aiDoneTasks.map((a): ActivityEvent => ({
      eventId:     `ai:${a.ai_task_id}`,
      kind:        "AI_TASK_DONE" satisfies ActivityKind,
      // 위 where 에서 not: null 보장 → ! 안전
      occurredAt:  a.compl_dt!.toISOString(),
      actorMberId: a.req_mber_id,
      actorName:   a.req_mber_id ? (nameMap.get(a.req_mber_id) ?? null) : null,
      targetTblNm: null,
      targetId:    a.ref_id,
      targetLabel: AI_REF_TYPE_LABEL[a.ref_ty_code] ?? a.ref_ty_code,
      meta: {
        taskTyCode:   a.task_ty_code,
        taskTyLbl:    AI_TASK_TYPE_LABEL[a.task_ty_code] ?? a.task_ty_code,
        refTyCode:    a.ref_ty_code,
      },
    })),
  ];

  // 시간 역순(최신 먼저)
  merged.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));

  // limit + 1 개 가져왔으니, limit 보다 많으면 다음 페이지 존재.
  const hasMore = merged.length > limit;
  const page    = merged.slice(0, limit);
  const nextCursor = hasMore
    // 다음 커서 = 현재 페이지 마지막 항목의 occurredAt (이보다 옛것이 다음 페이지)
    ? page[page.length - 1]?.occurredAt ?? null
    : null;

  return { events: page, nextCursor };
}
