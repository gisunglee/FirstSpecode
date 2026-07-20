"use client";

/**
 * WorkLogsPage — 업무일지 (URL: /work-logs)
 *
 * 역할:
 *   - 개발자가 하루 시작 전 오늘 할 일을 계획하고, 마무리에 한 일을 기록하는 습관 형성용 화면
 *   - 탭: "오늘의 할일"(한 주 7일을 카드로 늘어놓고 계획+결과 기록, 주 단위 이동) / "기록 보기"(주 단위 과거 조회)
 *   - 여기 쌓인 기록이 "주간보고"(PM 전용, /weekly-reports) AI 초안 생성의 원본 데이터가 된다
 *
 * 격리:
 *   - dashboard/, pm/, my-work/ 등과 완전 분리된 폴더. WBS와 같은 "일정" LNB 그룹에 속하지만
 *     WBS(프로젝트 전체 간트)와는 컨셉이 다른 "개인 일지" — 데이터도 API도 독립적.
 *
 * URL 쿼리:
 *   ?week=YYYY-MM-DD — 그 날짜가 속한 주로 초기 진입(예: "업무 리포트"의 "→ 업무일지에서
 *   편집" 링크). useSearchParams 는 Next 16 규칙상 반드시 Suspense 안에서만 사용 가능.
 */

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAppStore } from "@/store/appStore";
import { getWeekMondayStr } from "@/lib/weekUtil";
import TodayTab from "./_components/TodayTab";
import HistoryTab from "./_components/HistoryTab";

type Tab = "today" | "history";

export default function WorkLogsPage() {
  return (
    <Suspense fallback={null}>
      <WorkLogsPageInner />
    </Suspense>
  );
}

function WorkLogsPageInner() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const searchParams = useSearchParams();
  const weekParam = searchParams.get("week");
  const initialWeek = weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? getWeekMondayStr(weekParam) : getWeekMondayStr();

  const [tab, setTab] = useState<Tab>("today");
  const [weekMonday, setWeekMonday] = useState(initialWeek);

  return (
    <div style={{ padding: 0 }}>
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 24px", position: "sticky", top: 0, zIndex: 10,
          background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)",
          marginBottom: 16, gap: 12, flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 19, fontWeight: 700, color: "var(--color-text-primary)" }}>
          📓 업무일지
        </div>
        {currentProjectId && (
          <div className="sp-tab-seg">
            <div className={`sp-tab-seg-item${tab === "today" ? " is-active" : ""}`} onClick={() => setTab("today")}>
              오늘의 할일
            </div>
            <div className={`sp-tab-seg-item${tab === "history" ? " is-active" : ""}`} onClick={() => setTab("history")}>
              기록 보기
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: "0 24px 24px" }}>
        {!currentProjectId ? (
          <NoProjectSelected />
        ) : tab === "today" ? (
          <TodayTab
            projectId={currentProjectId}
            weekMonday={weekMonday}
            onWeekChange={setWeekMonday}
          />
        ) : (
          <HistoryTab
            projectId={currentProjectId}
            onEditDate={(d) => {
              setWeekMonday(getWeekMondayStr(d));
              setTab("today");
            }}
          />
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
        padding: "48px 24px", textAlign: "center",
        background: "var(--color-bg-card)", border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <div className="sp-empty-icon">📁</div>
      <div className="sp-empty-title">프로젝트를 선택해 주세요</div>
      <div className="sp-empty-desc">
        상단 프로젝트 선택기에서 프로젝트를 고르면 업무일지가 표시됩니다.
      </div>
    </div>
  );
}
