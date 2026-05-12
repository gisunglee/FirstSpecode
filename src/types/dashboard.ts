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
  };
  stalled: {
    /** 마감일이 지났는데 미완료(progrs_rt < 100) 인 단위업무 총 건수 */
    count: number;
    /** 미리보기 (마감 임박 순) */
    items: Array<{
      unitWorkId:       string;
      displayId:        string;
      name:             string;
      endDate:          string;
      progress:         number;
      assignMemberName: string | null;
    }>;
  };
  recentChanges: Array<{
    chgId:        string;
    refTblNm:     string;
    refId:        string;
    chgTypeCode:  string;
    chgRsnCn:     string | null;
    chgMberEmail: string | null;
    chgDt:        string;
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
};

// ── 개발자뷰 요약 응답 ──────────────────────────────────────────────────────
export type MeSummaryResponse = {
  myTasks: {
    /** 내가 담당한 과업 총 건수 */
    count: number;
    /** ctgry_code 별 분포 */
    byCategory: Record<string, number>;
    /** 미리보기 (이름 정렬) */
    items: Array<{
      taskId:    string;
      displayId: string;
      name:      string;
      category:  string;
    }>;
  };
  myDeadlines: {
    /** 마감 임박/지연 단위업무 총 건수 */
    count: number;
    /** end_de < 오늘 인 단위업무 (지연) */
    overdueCount: number;
    /** Top 5 — 마감 가까운 순 (지연 → 임박) */
    items: Array<{
      unitWorkId: string;
      displayId:  string;
      name:       string;
      endDate:    string;
      progress:   number;
      /** 음수 = 지연(일), 0 = 오늘, 양수 = 남은 일수 */
      dDay:       number;
    }>;
  };
  myAiResults: {
    /** 완료(DONE)·미적용 AI 태스크 총 건수 */
    count: number;
    items: Array<{
      aiTaskId:   string;
      taskTyCode: string;
      refTyCode:  string;
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
