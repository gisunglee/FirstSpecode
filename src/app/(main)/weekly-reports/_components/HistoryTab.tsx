"use client";

/**
 * HistoryTab — "이력" 탭. 과거에 생성한 주간보고 목록을 훑어보고,
 * 행을 누르면 "초안 생성" 탭으로 전환되며 그 주가 선택된다(onSelectWeek).
 */

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import type { WeeklyReportListResponse } from "@/types/weeklyReport";

const STATUS_BADGE: Record<string, string> = {
  PENDING:     "sp-badge-warning",
  IN_PROGRESS: "sp-badge-warning",
  DONE:        "sp-badge-success",
  FAILED:      "sp-badge-error",
};
const STATUS_LABEL: Record<string, string> = {
  PENDING:     "대기 중",
  IN_PROGRESS: "처리 중",
  DONE:        "완료",
  FAILED:      "실패",
};

export default function HistoryTab({
  projectId,
  onSelectWeek,
}: {
  projectId: string;
  onSelectWeek: (weekMonday: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["weekly-reports", projectId],
    queryFn: () =>
      authFetch<{ data: WeeklyReportListResponse }>(`/api/projects/${projectId}/weekly-reports`).then((r) => r.data),
    enabled: !!projectId,
  });

  const items = data?.items ?? [];

  if (isLoading) {
    return <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>불러오는 중...</div>;
  }

  if (items.length === 0) {
    return (
      <div className="sp-empty" style={{ padding: "48px 24px", textAlign: "center", background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)" }}>
        <div className="sp-empty-icon">🗂️</div>
        <div className="sp-empty-title">생성된 주간보고가 없습니다</div>
        <div className="sp-empty-desc">"초안 생성" 탭에서 첫 주간보고를 만들어 보세요.</div>
      </div>
    );
  }

  return (
    <div className="sp-table-wrap">
      <table className="sp-table">
        <thead>
          <tr>
            <th style={{ width: 160 }}>주간</th>
            <th style={{ width: 110 }}>상태</th>
            <th style={{ width: 140 }}>생성자</th>
            <th>초안 미리보기</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.weeklyReportId} onClick={() => onSelectWeek(r.weekStartDt)}>
              <td className="is-mono">{r.weekStartDt} 주</td>
              <td>
                {r.aiTaskStatus && (
                  <span className={`sp-badge ${STATUS_BADGE[r.aiTaskStatus] ?? "sp-badge-neutral"}`}>
                    <span className="dot" />{STATUS_LABEL[r.aiTaskStatus] ?? r.aiTaskStatus}
                  </span>
                )}
              </td>
              <td>{r.creatMberNm ?? "-"}</td>
              <td className={!r.draftCn ? "is-muted" : undefined} style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.draftCn?.replace(/\n/g, " ").slice(0, 80) || "(아직 초안 없음)"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
