"use client";

/**
 * PmDashboardPage — PM 진단 (URL: /pm)
 *
 * 역할:
 *   - PM 의사결정용 종합 시야 — 자원·일정·위험 한 화면
 *   - 위젯: 팀 부하 매트릭스 / 미지정 현황 / 분석 현황 / 지연 현황(설계·구현 2단) /
 *     마감 임박 × 진척률 히트맵 / 마감 임박 리스트(단위업무·화면·기능 3카드)
 *   - 대부분 데이터는 단일 엔드포인트(/api/projects/[id]/pm-summary)에서, 마감 관련 위젯들은
 *     각자 독립 쿼리(캐시 공유 안 함 — DeadlineProgressHeatmap/DeadlineListCard 주석 참조)
 *
 * 격리:
 *   - dashboard/, activity/, focus/, calendar/ 와 완전 분리된 폴더
 *   - 공유는 lib/utils.ts 뿐
 *
 * 레이아웃:
 *   - 상단: 팀 부하 매트릭스, 지연 현황 (가로 폭 full, 세로로 순서대로)
 *   - 하단: 마감 임박 리스트 3카드(단위업무/화면/기능) — 항상 한 줄에 3개 고정
 *
 * 2026-07-18: "위험 워치리스트"/"우선순위 × 진척 히트맵"을 "마감 임박 리스트" 3카드로 교체.
 * 2026-07-20: 위 교체로 미사용 상태였던 RiskWatchlist.tsx/PriorityHeatmap.tsx 와
 *   pm-summary 의 riskItems/priorityMatrix 계산을 완전히 제거. 메뉴명도 "PM 워치"→"PM 진단",
 *   "PM 보드"→"PM 현황"으로 변경 — 진단(문제 있는지 자세히 파고들 때) vs 현황(매일 훑는 빠른 목록)
 *   이라는 실제 사용 맥락을 이름에 반영.
 *
 * 2026-07-20(2차): 대시보드 카드 링크가 "?focus=teamLoad" 식으로 들어오면 해당 섹션까지
 *   스크롤 + 잠깐 하이라이트(is-focus-flash, styles/components.css) 해서 "여기구나"를
 *   바로 알 수 있게 함. 섹션 id 는 pm-section-{teamLoad|missing|delay}.
 *   useSearchParams 를 쓰므로 Suspense 로 감싸야 함(Next.js 16 제약).
 */

import { Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";
import type { PmSummaryResponse } from "@/types/pm";

import TeamLoadMatrix          from "./_components/TeamLoadMatrix";
import DelayStatusMatrix       from "./_components/DelayStatusMatrix";
import AnalysisStatusCard      from "./_components/AnalysisStatusCard";
import MissingStatusCard       from "./_components/MissingStatusCard";
import DeadlineProgressHeatmap from "./_components/DeadlineProgressHeatmap";
import DeadlineListCard        from "./_components/DeadlineListCard";

// PM 대시보드는 의사결정용 — 너무 신선할 필요는 없지만 그렇다고 카드 대시보드처럼
// 5분 동안 안 갱신되면 위험 항목을 놓칠 수 있어 2분으로 절충.
const STALE_TIME_MS = 2 * 60 * 1000;

// 스크롤 대상 섹션 id 접두어 + 하이라이트 지속 시간(ms, components.css 의 애니메이션 길이와 맞춤)
const FOCUS_ID_PREFIX  = "pm-section-";
const FOCUS_FLASH_MS   = 1700;

export default function PmDashboardPage() {
  return (
    <Suspense fallback={null}>
      <PmDashboardInner />
    </Suspense>
  );
}

function PmDashboardInner() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const searchParams = useSearchParams();
  const focusParam = searchParams.get("focus");
  const [flashSection, setFlashSection] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<PmSummaryResponse>({
    queryKey: ["pm-summary", currentProjectId],
    queryFn: () =>
      authFetch<{ data: PmSummaryResponse }>(
        `/api/projects/${currentProjectId}/pm-summary`
      ).then((r) => r.data),
    enabled:   !!currentProjectId,
    staleTime: STALE_TIME_MS,
  });

  // 대시보드에서 "?focus=teamLoad" 식으로 들어오면 스크롤 + 하이라이트.
  // isLoading 이 끝난 뒤 실행 — 스켈레톤→실데이터 전환으로 섹션 높이가 바뀌기 전에 스크롤하면
  // 위치가 어긋난다.
  useEffect(() => {
    if (!focusParam || isLoading) return;
    const el = document.getElementById(`${FOCUS_ID_PREFIX}${focusParam}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setFlashSection(focusParam);
    const timer = setTimeout(() => setFlashSection(null), FOCUS_FLASH_MS);
    return () => clearTimeout(timer);
  }, [focusParam, isLoading]);

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 24px", position: "sticky", top: 0, zIndex: 10,
          background: "var(--color-bg-card)",
          borderBottom: "1px solid var(--color-border)",
          marginBottom: 16,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 19, fontWeight: 700, color: "var(--color-text-primary)" }}>
          📊 PM 진단
        </div>
        {data?.generatedAt && (
          <span
            style={{
              fontSize: "var(--text-base)",
              color: "var(--color-text-tertiary)",
              fontFamily: "var(--font-mono)",
            }}
          >
            기준: {data.generatedAt.slice(11, 16)} {data.generatedAt.slice(0, 10)}
          </span>
        )}
      </div>

      <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {!currentProjectId ? (
          <NoProjectSelected />
        ) : (
          <>
            {/* 상단 — 팀 부하 매트릭스 (full width) */}
            <div
              id={`${FOCUS_ID_PREFIX}teamLoad`}
              style={{ scrollMarginTop: 100, borderRadius: "var(--radius-card)" }}
              className={flashSection === "teamLoad" ? "is-focus-flash" : undefined}
            >
              <TeamLoadMatrix
                rows={data?.teamLoad ?? []}
                isLoading={isLoading}
                error={error as Error | null}
              />
            </div>

            {/* 미지정 현황 + 분석 현황 — 둘 다 표가 좁아(5~6열) full width로 두면 카드 오른쪽이
                텅 비어 보인다. 위험 워치리스트/우선순위 히트맵과 같은 2열 그리드로 나란히 배치.
                지연 위젯보다 먼저 두는 이유: 애초에 입력이 안 된 항목은 지연 판정 자체가 안 되는
                사각지대라 먼저 훑어보게. */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
                gap: 16,
              }}
            >
              <div
                id={`${FOCUS_ID_PREFIX}missing`}
                style={{ scrollMarginTop: 100, borderRadius: "var(--radius-card)" }}
                className={flashSection === "missing" ? "is-focus-flash" : undefined}
              >
                <MissingStatusCard
                  projectId={currentProjectId}
                  rows={data?.missingSummary ?? []}
                  isLoading={isLoading}
                  error={error as Error | null}
                />
              </div>
              <AnalysisStatusCard
                projectId={currentProjectId}
                rows={data?.analysisDelay ?? []}
                summary={data?.analysisSummary}
                isLoading={isLoading}
                error={error as Error | null}
              />
            </div>

            {/* 지연 현황 (full width) — 설계/구현 always-visible 2단 */}
            <div
              id={`${FOCUS_ID_PREFIX}delay`}
              style={{ scrollMarginTop: 100, borderRadius: "var(--radius-card)" }}
              className={flashSection === "delay" ? "is-focus-flash" : undefined}
            >
              <DelayStatusMatrix
                projectId={currentProjectId}
                designRows={data?.designDelay ?? []}
                implRows={data?.implDelay ?? []}
                isLoading={isLoading}
                error={error as Error | null}
              />
            </div>

            {/* 마감 임박 × 진척률 히트맵 (full width) — pm-summary 와 완전히 독립된 자체 쿼리.
                엔티티(단위업무/화면/기능)·기준일 조합마다 이 컴포넌트가 직접 fetch한다. */}
            <DeadlineProgressHeatmap projectId={currentProjectId} />

            {/* 마감 임박 리스트 — 단위업무/화면/기능, 항상 3열 고정(auto-fit 아님 — 좁아져도
                줄 수가 줄지 않고 카드 내부가 줄어든다). 카드 하나가 entity prop만 바꿔 3번 렌더됨. */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 16,
              }}
            >
              <DeadlineListCard projectId={currentProjectId} entity="UNIT_WORK" />
              <DeadlineListCard projectId={currentProjectId} entity="SCREEN" />
              <DeadlineListCard projectId={currentProjectId} entity="FUNCTION" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function NoProjectSelected() {
  return (
    <div
      className="sp-empty"
      style={{
        padding: "48px 24px",
        textAlign: "center",
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <div className="sp-empty-icon">📁</div>
      <div className="sp-empty-title">프로젝트를 선택해 주세요</div>
      <div className="sp-empty-desc">
        상단 프로젝트 선택기에서 프로젝트를 고르면 PM 진단이 표시됩니다.
      </div>
    </div>
  );
}
