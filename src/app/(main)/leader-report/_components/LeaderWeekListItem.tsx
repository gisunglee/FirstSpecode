"use client";

/**
 * LeaderWeekListItem — 좌측 주차 목록의 카드 한 장 (리더 리포트 전용)
 *
 * 업무 리포트의 WeekCardMini와 자리는 같지만 보여주는 정보가 다르다 — "내 계획 완료율"이 아니라
 * "이 주에 팀원이 몇 명 업무일지를 썼는지"(참여 현황)와 AI 생성 상태. 참여 기준은 일별(DAILY)
 * 기록 하나라도 남겼는지로 잡았다 — "매일 적는 습관"이라는 업무일지 취지에 가장 가깝다는 결정.
 */

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { addDaysStr, mmddRange } from "@/lib/weekUtil";
import type { WorkLogResponse } from "@/types/workLog";
import type { WeeklyReportListResponse } from "@/types/weeklyReport";

const AI_STATUS_BADGE: Record<string, string> = {
  PENDING:     "sp-badge-warning",
  IN_PROGRESS: "sp-badge-warning",
  DONE:        "sp-badge-success",
  FAILED:      "sp-badge-error",
};

export default function LeaderWeekListItem({
  projectId,
  monday,
  weekIndex,
  active,
  onClick,
}: {
  projectId: string;
  monday: string;
  weekIndex: number;
  active: boolean;
  onClick: () => void;
}) {
  const sunday = addDaysStr(monday, 6);

  const dailyQuery = useQuery({
    queryKey: ["work-log-range", projectId, monday, "DAILY", "all"],
    queryFn: () =>
      authFetch<{ data: WorkLogResponse }>(
        `/api/projects/${projectId}/work-logs?from=${monday}&to=${sunday}&logTyCode=DAILY&mberId=all`
      ).then((r) => r.data),
    enabled: !!projectId,
  });

  const membersQuery = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () =>
      authFetch<{ data: { members: { memberId: string }[] } }>(`/api/projects/${projectId}/members`).then((r) => r.data),
    enabled: !!projectId,
  });

  // AI 상태는 프로젝트 전체 리포트 목록에서 찾는다 — queryKey가 같아 여러 카드가 떠도 한 번만 fetch.
  const wrListQuery = useQuery({
    queryKey: ["weekly-reports", projectId],
    queryFn: () =>
      authFetch<{ data: WeeklyReportListResponse }>(`/api/projects/${projectId}/weekly-reports`).then((r) => r.data),
    enabled: !!projectId,
  });
  const aiStatus = wrListQuery.data?.items.find((r) => r.weekStartDt === monday)?.aiTaskStatus ?? null;

  const writtenMemberIds = new Set((dailyQuery.data?.items ?? []).map((l) => l.mberId));
  const totalMembers   = membersQuery.data?.members.length ?? 0;
  const writtenCount    = writtenMemberIds.size;
  const participationTone =
    totalMembers === 0 || writtenCount === 0 ? "var(--color-text-tertiary)"
    : writtenCount >= totalMembers ? "var(--color-success)"
    : "var(--color-warning)";

  return (
    <div
      onClick={onClick}
      style={{
        width: "100%", cursor: "pointer", borderRadius: "var(--radius-sm)",
        border: `1px solid ${active ? "var(--color-brand)" : "var(--color-border)"}`,
        background: active ? "var(--color-brand-subtle)" : "var(--color-bg-card)",
        transition: "border-color var(--transition-fast), background var(--transition-fast)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "6px 10px", display: "flex", alignItems: "center", gap: 6,
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: active ? "var(--color-brand)" : "var(--color-text-primary)" }}>
          {monday.slice(5, 7)}월 {weekIndex}주
        </span>
        {aiStatus && (
          <span className={`sp-badge ${AI_STATUS_BADGE[aiStatus] ?? "sp-badge-neutral"}`} style={{ marginLeft: "auto" }}>
            <span className="dot" />
          </span>
        )}
      </div>
      <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)" }}>
          {mmddRange(monday, sunday)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: participationTone, flexShrink: 0 }} />
          <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--color-text-primary)" }}>
            {writtenCount}/{totalMembers} 작성
          </span>
        </div>
      </div>
    </div>
  );
}
