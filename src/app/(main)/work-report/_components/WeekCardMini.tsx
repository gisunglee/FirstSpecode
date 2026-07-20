"use client";

/**
 * WeekCardMini — "카드 보기" 요약 카드
 *
 * 실제 문서(WeeklyDocView)를 CSS로 축소 복제하지 않는다 — transform:scale 로 진짜 DOM을
 * 줄이면 글자가 흐려지고 클릭 좌표도 어긋나기 쉽다. 대신 같은 문서 톤(라벨 셀 + 테두리)을
 * 유지한 요약 정보만 담은 별도 카드로 만들었다. 클릭하면 "주간" 모드로 전환되어
 * WeeklyDocView 실물을 보여준다.
 */

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { addDaysStr } from "@/lib/weekUtil";
import type { WorkLogResponse } from "@/types/workLog";

export default function WeekCardMini({
  projectId,
  monday,
  weekIndex,
  onClick,
}: {
  projectId: string;
  monday: string;
  /** "N월 N주" 표기용 — 그 달 안에서 몇 번째 주인지 */
  weekIndex: number;
  onClick: () => void;
}) {
  const sunday = addDaysStr(monday, 6);

  const dailyQuery = useQuery({
    queryKey: ["work-log-range", projectId, monday, "DAILY"],
    queryFn: () =>
      authFetch<{ data: WorkLogResponse }>(
        `/api/projects/${projectId}/work-logs?from=${monday}&to=${sunday}&logTyCode=DAILY&mberId=me`
      ).then((r) => r.data),
    enabled: !!projectId,
  });

  const weekQuery = useQuery({
    queryKey: ["work-log", "WEEK", projectId, monday],
    queryFn: () =>
      authFetch<{ data: WorkLogResponse }>(
        `/api/projects/${projectId}/work-logs?date=${monday}&logTyCode=WEEK&mberId=me`
      ).then((r) => r.data),
    enabled: !!projectId,
  });

  const weekLog    = weekQuery.data?.items?.[0] ?? null;
  const dailyLogs  = dailyQuery.data?.items ?? [];
  const totalItems = dailyLogs.reduce((sum, l) => sum + l.items.length, 0);
  const doneItems  = dailyLogs.reduce((sum, l) => sum + l.items.filter((i) => i.doneYn === "Y").length, 0);
  const tagCount   = weekLog?.items.length ?? 0;
  const resultPreview = weekLog?.resultCn?.trim();

  return (
    <div
      onClick={onClick}
      className="sp-doc-table-wrap"
      style={{
        width: 260, flex: "0 0 260px", cursor: "pointer",
        transition: "box-shadow var(--transition-fast)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "var(--shadow-sm)")}
      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
    >
      <div className="sp-doc-label" style={{ padding: "8px 10px", textAlign: "left" }}>
        {monday.slice(5, 7)}월 {weekIndex}주
        <div style={{ fontWeight: 400, fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
          {monday} ~ {sunday}
        </div>
      </div>
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, minHeight: 96 }}>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
          계획 완료 {totalItems === 0 ? "-" : `${doneItems}/${totalItems}`} · 중요업무 {tagCount}건
        </div>
        <div
          style={{
            fontSize: "var(--text-sm)", color: resultPreview ? "var(--color-text-primary)" : "var(--color-text-disabled)",
            display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}
        >
          {resultPreview || "아직 금주 결과보고가 없습니다."}
        </div>
      </div>
    </div>
  );
}
