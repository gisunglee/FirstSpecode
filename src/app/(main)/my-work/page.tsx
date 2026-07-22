"use client";

/**
 * MyWorkPage — MY 보드 (URL: /my-work)
 * "PM 보드"(팀 전체 조망, 현재는 "PM 현황"으로 개명)와 대구를 이루는 이름으로 지었다 —
 * 구조(요약+카드형 리스트)가 같아서 "PM 보드의 개인용 버전"이라는 연상이 목적이었다.
 * 2026-07-20 PM 보드→PM 현황 개명으로 이 이름 짝은 깨졌음 — MY 보드 개명 여부는 별도 결정 필요.
 *
 * 역할:
 *   - "PM 진단"(전체 시야)의 반대 — 로그인한 나를 기준으로 요구사항(분석)/단위업무/화면/기능 중
 *     내가 담당한 것 전부 + 그 하위에 담당자가 안 붙은 것들을 한 스냅샷으로 본다.
 *   - 기준일(오늘을 대신하는 값)을 앞당겨서 "내일이면? 모레면?" 더 지연될 게 뭔지 미리 볼 수 있다.
 *
 * 데이터:
 *   GET /api/projects/[id]/my-work — 페이지 전체가 단일 쿼리 공유(위젯마다 독립 쿼리인 PM 진단과
 *   다른 이유: 이 페이지는 "내 스냅샷 하나"라 기준일도 전체가 공유하는 게 자연스럽다).
 */

import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";
import type { MyWorkResponse } from "@/types/myWork";

import MyWorkSummary        from "./_components/MyWorkSummary";
import type { StatFilter }  from "./_components/MyWorkSummary";
import MyTaskList           from "./_components/MyTaskList";
import UnassignedChildrenList from "./_components/UnassignedChildrenList";
import MissingScheduleList   from "./_components/MissingScheduleList";

// yyyy-MM-dd 문자열에 일수를 더하고(음수면 뺀다) — pm/_components/DelayStatusMatrix.tsx 와 동일
function shiftDateStr(dateStr: string, deltaDays: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export default function MyWorkPage() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const [asOfDate, setAsOfDate] = useState("");
  const displayDate = asOfDate || new Date().toISOString().slice(0, 10);
  const [excludeCompleted, setExcludeCompleted] = useState(true);
  // 요약 카드의 지연/임박 타일 클릭 → 내 업무 리스트 필터. 하위 담당자 미지정 타일 클릭 → 그 리스트로 스크롤.
  const [statFilter, setStatFilter] = useState<StatFilter>(null);
  const unassignedRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useQuery<MyWorkResponse>({
    queryKey: ["my-work", currentProjectId, displayDate, excludeCompleted],
    queryFn: () =>
      authFetch<{ data: MyWorkResponse }>(
        `/api/projects/${currentProjectId}/my-work?asOf=${displayDate}&excludeCompleted=${excludeCompleted}`
      ).then((r) => r.data),
    enabled: !!currentProjectId,
  });

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 */}
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 24px", position: "sticky", top: 0, zIndex: 10,
          background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)",
          marginBottom: 16, gap: 12, flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 19, fontWeight: 700, color: "var(--color-text-primary)" }}>
          🧑‍💻 MY 보드
        </div>

        {/* 기준일 +/- 스테퍼 + 완료 제외 — 페이지 전체가 공유 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)" }}>기준일</span>
            <button type="button" onClick={() => setAsOfDate(shiftDateStr(displayDate, -1))} title="하루 전" style={stepBtnStyle}>−</button>
            <input
              type="date"
              value={displayDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="sp-input"
              style={{ padding: "2px 6px", fontSize: "var(--text-base)", height: 26, width: 130 }}
            />
            <button type="button" onClick={() => setAsOfDate(shiftDateStr(displayDate, 1))} title="하루 후" style={stepBtnStyle}>+</button>
          </div>
          {asOfDate && (
            <button type="button" onClick={() => setAsOfDate("")} title="오늘 기준으로 되돌리기" style={resetBtnStyle}>오늘</button>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "var(--text-base)", color: "var(--color-text-secondary)", cursor: "pointer" }}>
            <input type="checkbox" checked={excludeCompleted} onChange={(e) => setExcludeCompleted(e.target.checked)} style={{ cursor: "pointer" }} />
            완료 제외
          </label>
        </div>
      </div>

      <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {!currentProjectId ? (
          <NoProjectSelected />
        ) : (
          <>
            {/* 요약(좌) + 내 업무 미설정(우) — 요약이 화면 전체 폭을 다 쓸 만큼 무겁지 않아 절반으로 줄이고,
                남는 폭에 새 위젯을 나란히 배치했다. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16, alignItems: "start" }}>
              <MyWorkSummary
                summary={data?.summary}
                progressSummary={data?.progressSummary}
                isLoading={isLoading}
                error={error as Error | null}
                statFilter={statFilter}
                onStatFilterChange={setStatFilter}
                onJumpToUnassigned={() => unassignedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              />
              <MissingScheduleList items={data?.missingSchedule ?? []} isLoading={isLoading} error={error as Error | null} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16, alignItems: "start" }}>
              <MyTaskList
                items={data?.items ?? []}
                isLoading={isLoading}
                error={error as Error | null}
                statFilter={statFilter}
                onClearStatFilter={() => setStatFilter(null)}
              />
              <div ref={unassignedRef}>
                <UnassignedChildrenList items={data?.unassignedChildren ?? []} isLoading={isLoading} error={error as Error | null} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const stepBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 22, height: 22, borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)", fontSize: 14, fontWeight: 700,
  cursor: "pointer", lineHeight: 1, padding: 0,
};

const resetBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  height: 22, padding: "0 8px", borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)", fontSize: 11, fontWeight: 600,
  cursor: "pointer", lineHeight: 1,
};

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
        상단 프로젝트 선택기에서 프로젝트를 고르면 내 업무가 표시됩니다.
      </div>
    </div>
  );
}
