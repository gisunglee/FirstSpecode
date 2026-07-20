"use client";

/**
 * DraftTab — "초안 생성" 탭
 *
 * 주(월요일) 를 고르면 그 주의 TbWrWeeklyReport 존재 여부를 이력 목록에서 찾아 보여준다.
 * "초안 생성" 클릭 → TbAiTask PENDING 생성 → aiTaskStatus 가 PENDING/IN_PROGRESS 인 동안
 * 폴링(react-query refetchInterval) → DONE 되면 draft_cn 을 편집 가능한 textarea로 노출.
 *
 * 실제 AI 처리는 이 페이지 밖에서 일어난다(`/run-ai-tasks`) — 그래서 "즉시 완료"가 아니라
 * "생성 요청 → 대기" UX 이다. 다른 AI 기능(기능 검토 등)과 동일한 흐름.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { addDaysStr, getWeekMondayStr } from "@/lib/weekUtil";
import type { WeeklyReport, WeeklyReportListResponse } from "@/types/weeklyReport";

const STATUS_LABEL: Record<string, string> = {
  PENDING:     "생성 대기 중",
  IN_PROGRESS: "생성 처리 중",
  DONE:        "생성 완료",
  FAILED:      "생성 실패",
};

export default function DraftTab({
  projectId,
  weekMonday,
  onWeekChange,
}: {
  projectId: string;
  weekMonday: string;
  onWeekChange: (weekMonday: string) => void;
}) {
  const queryClient = useQueryClient();
  const weekSunday = addDaysStr(weekMonday, 6);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [draftCn, setDraftCn] = useState("");

  // 이력 목록에서 이 주에 해당하는 리포트가 이미 있는지 찾는다 — 별도 "주로 조회" API를 만들지 않고
  // (30건 이내 소규모 데이터라) 이미 있는 목록 조회를 재사용.
  const { data: listData } = useQuery({
    queryKey: ["weekly-reports", projectId],
    queryFn: () =>
      authFetch<{ data: WeeklyReportListResponse }>(`/api/projects/${projectId}/weekly-reports`).then((r) => r.data),
    enabled: !!projectId,
  });

  useEffect(() => {
    const existing = listData?.items.find((r) => r.weekStartDt === weekMonday);
    setSelectedReportId(existing?.weeklyReportId ?? null);
  }, [weekMonday, listData]);

  const { data: detail } = useQuery({
    queryKey: ["weekly-report", projectId, selectedReportId],
    queryFn: () =>
      authFetch<{ data: WeeklyReport }>(`/api/projects/${projectId}/weekly-reports/${selectedReportId}`).then((r) => r.data),
    enabled: !!selectedReportId,
    refetchInterval: (query) => {
      const status = query.state.data?.aiTaskStatus;
      return status === "PENDING" || status === "IN_PROGRESS" ? 5000 : false;
    },
  });

  useEffect(() => {
    setDraftCn(detail?.draftCn ?? "");
  }, [detail?.draftCn, selectedReportId]);

  const generateMutation = useMutation({
    mutationFn: () =>
      authFetch<{ data: { weeklyReportId: string; aiTaskId: string } }>(`/api/projects/${projectId}/weekly-reports`, {
        method: "POST",
        body: JSON.stringify({ weekStartDt: weekMonday }),
      }),
    onSuccess: (res) => {
      setSelectedReportId(res.data.weeklyReportId);
      queryClient.invalidateQueries({ queryKey: ["weekly-reports", projectId] });
      queryClient.invalidateQueries({ queryKey: ["weekly-report", projectId, res.data.weeklyReportId] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/weekly-reports/${selectedReportId}`, {
        method: "PATCH",
        body: JSON.stringify({ draftCn }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["weekly-report", projectId, selectedReportId] });
    },
  });

  const isGenerating = detail?.aiTaskStatus === "PENDING" || detail?.aiTaskStatus === "IN_PROGRESS";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => onWeekChange(addDaysStr(weekMonday, -7))}>
          ← 이전 주
        </button>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}>
          {weekMonday} ~ {weekSunday}
        </span>
        <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => onWeekChange(addDaysStr(weekMonday, 7))}>
          다음 주 →
        </button>
        {weekMonday !== getWeekMondayStr() && (
          <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => onWeekChange(getWeekMondayStr())}>
            이번 주
          </button>
        )}
      </div>

      <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", background: "var(--color-bg-card)", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {detail?.aiTaskStatus && (
            <span className={`sp-badge ${detail.aiTaskStatus === "DONE" ? "sp-badge-success" : detail.aiTaskStatus === "FAILED" ? "sp-badge-error" : "sp-badge-warning"}`}>
              <span className="dot" />{STATUS_LABEL[detail.aiTaskStatus] ?? detail.aiTaskStatus}
            </span>
          )}
          <button
            type="button"
            className="sp-btn sp-btn-primary sp-btn-sm"
            disabled={generateMutation.isPending || isGenerating}
            onClick={() => generateMutation.mutate()}
          >
            {selectedReportId ? "AI 초안 재생성" : "AI 초안 생성 요청"}
          </button>
        </div>

        {isGenerating && (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
            생성 요청이 접수되었습니다. 팀에서 AI 태스크가 처리되면 자동으로 반영됩니다 (잠시 후 다시 확인).
          </div>
        )}

        {!selectedReportId && !generateMutation.isPending && (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
            아직 이 주의 초안이 없습니다. 팀원들의 업무일지가 쌓인 뒤 "AI 초안 생성 요청"을 눌러 주세요.
          </div>
        )}

        {selectedReportId && !isGenerating && (
          <div>
            <textarea
              className="sp-input sp-textarea"
              style={{ width: "100%", minHeight: 320, fontFamily: "var(--font-mono)" }}
              placeholder="AI가 생성한 초안이 여기에 표시됩니다. 자유롭게 수정한 뒤 저장하세요."
              value={draftCn}
              onChange={(e) => setDraftCn(e.target.value)}
            />
            <div style={{ marginTop: 6, textAlign: "right" }}>
              <button
                type="button"
                className="sp-btn sp-btn-secondary sp-btn-sm"
                disabled={saveMutation.isPending || draftCn === (detail?.draftCn ?? "")}
                onClick={() => saveMutation.mutate()}
              >
                저장
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
