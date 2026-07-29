/**
 * Dashboard summary 응답 타입 — 클라이언트/서버 공유
 *
 * 왜 이 파일을 분리했는가:
 *   - API route(서버 전용)에서 타입을 export 하면 클라이언트가 import 시
 *     Next.js 번들러가 가끔 서버 의존을 따라 들어가려 시도해 빌드가 꼬임.
 *   - 타입만 담은 별도 파일은 양쪽이 안전하게 import 가능.
 *
 * 응답 구조 변경 시 이 파일과 두 route.ts 의 응답 객체를 함께 수정.
 */

// ── 관리뷰 요약 응답 ────────────────────────────────────────────────────────
export type ManageSummaryResponse = {
  progress: {
    /** 프로젝트의 전체 단위업무 수 */
    total: number;
    /** progrs_rt = 100 인 단위업무 수 */
    completed: number;
    /** 평균 진행률 (0~100, 소수 1자리 반올림) */
    averagePct: number;
    /** 요구사항 분석 평균 진행률(progrs_rt) — 단위업무만 보여주던 갭을 보완하는 보조 지표 */
    requirementAvgPct: number;
    /** 화면 설계 평균 진행률(design_rt) */
    screenDesignAvgPct: number;
    /** 기능 구현 평균 진행률(impl_rt) */
    functionImplAvgPct: number;
  };
  stalled: {
    /** 설계 또는 구현 중 하나라도 종료 예정일이 지났는데 그 phase 진척률이 100% 미만인 단위업무 총 건수 */
    count: number;
    /** 미리보기 (가장 오래 지연된 순) */
    items: Array<{
      unitWorkId:       string;
      displayId:        string;
      name:             string;
      assignMemberName: string | null;
      /** 설계 종료 예정일(plan_dsgn_end_de) 기준 phase — overdue=종료일 경과 && progress<100 */
      design: { endDate: string | null; progress: number; overdue: boolean };
      /** 하위 화면 실질구현기간(actl_impl_*) 롤업 기준 phase */
      impl:   { endDate: string | null; progress: number; overdue: boolean };
    }>;
    /** 설계 지연 단위업무 건수 — 팀부하의 "지연" 정의와 달리 설계 진척률 기준(2026-07-28: 화면→단위업무 기준으로 변경) */
    designDelayedCount: number;
    /** 구현 지연 기능 건수 */
    functionDelayedCount: number;
  };
  recentChanges: Array<{
    chgId:        string;
    refTblNm:     string;
    refId:        string;
    chgTypeCode:  string;
    chgRsnCn:     string | null;
    chgMberEmail: string | null;
    chgDt:        string;
    /** 변경된 엔티티의 현재 이름(단위업무/화면/영역/기능/요구사항/스토리) — 삭제됐거나
     *  지원 안 하는 ref_tbl_nm 이면 null(그 경우 UI는 유형 라벨만 표시) */
    refName:      string | null;
  }>;
  teamActivity: {
    /** 최근 7일간 한 번 이상 변경 활동을 한 멤버 수 */
    activeMemberCount: number;
    /** Top 기여자 — 변경 건수 내림차순 (Top 3) */
    topContributors: Array<{
      mberId:      string;
      displayName: string;
      count:       number;
    }>;
    /** 활성 작업량(진행중+임박+지연) 1위 멤버 — "활동량"과 다른 "부하" 신호.
     *  아무도 담당 단위업무가 없으면 null. */
    topLoadMember: {
      displayName: string;
      activeLoad:  number;
    } | null;
  };
  aiUsage: {
    /** 이번 달(달력 기준) 생성된 AI 태스크 총 건수 */
    monthCount: number;
    /** 그 중 완료(DONE/APPLIED) 건수 */
    completedCount: number;
    /** 진행 중(PENDING/IN_PROGRESS) 건수 */
    inProgressCount: number;
    /** 실패/타임아웃 건수 — 운영자가 신경 써야 하는 시그널 */
    failedCount: number;
  };
  /** 담당자·일정 미입력(요구사항/단위업무/화면/기능 합산) 총 건수 — 지연 판정조차 안 되는 사각지대 */
  unassignedTotal: number;
};

// ── 개발자뷰 요약 응답 ──────────────────────────────────────────────────────
export type MeSummaryResponse = {
  myRequirements: {
    /** 내가 담당자로 지정된 요구사항 총 건수 */
    count: number;
    /** 미리보기 5건 (표시ID 정렬) */
    items: Array<{
      reqId:     string;
      displayId: string;
      name:      string;
      /** 분석 시작일(yyyy-MM-dd) — 미입력이면 null */
      startDate: string | null;
      /** 분석 종료일(yyyy-MM-dd) — 미입력이면 null */
      endDate:   string | null;
      /** 분석 진척률(progrs_rt, 0~100) */
      progress:  number;
    }>;
  };
  myDeadlines: {
    /** 설계 또는 구현 중 하나라도 마감 임박/지연인 단위업무 총 건수 */
    count: number;
    /** 대표 D-day(dDay) < 0 인 단위업무 (지연) */
    overdueCount: number;
    /** Top 5 — 대표 D-day 가까운 순 (지연 → 임박) */
    items: Array<{
      unitWorkId: string;
      displayId:  string;
      name:       string;
      /** 설계/구현 D-day 중 더 급한(작은) 값. 음수 = 지연(일), 0 = 오늘, 양수 = 남은 일수 */
      dDay:       number;
      /** dDay 를 결정한 phase — 어느 진척률을 강조 표시할지 UI 판단용 */
      dDaySource: "DESIGN" | "IMPL";
      design: { endDate: string | null; progress: number };
      impl:   { endDate: string | null; progress: number };
    }>;
    /** 내가 담당한 화면 중 마감 임박/지연(설계) 건수 — 목록은 MY 보드에서, 여기선 카운트만 */
    screenCount: number;
    /** 내가 담당한 기능 중 마감 임박/지연(구현) 건수 */
    functionCount: number;
  };
  myAiResults: {
    /** 완료(DONE)·미적용 — 액션 필요 건수(배지 강조용). 목록(items)의 필터와는 별개. */
    actionableCount: number;
    /** 최근 5건 — 상태 무관, 요청일(req_dt) 내림차순 */
    items: Array<{
      aiTaskId:   string;
      taskTyCode: string;
      refTyCode:  string;
      /** PENDING/IN_PROGRESS/DONE/APPLIED/REJECTED/FAILED/TIMEOUT */
      sttusCode:  string;
      reqDt:      string;
      complDt:    string | null;
    }>;
  };
  myReviews: {
    /** 나에게 온 미응답 검토 요청 (REQUESTED/REVIEWING) 총 건수 */
    pendingCount: number;
    /** 미리보기 — 오래된 요청 우선 */
    items: Array<{
      reviewId:      string;
      title:         string;
      refTblNm:      string;
      refId:         string;
      sttusCode:     string;
      reqMberName:   string | null;
      creatDt:       string;
    }>;
  };
};
