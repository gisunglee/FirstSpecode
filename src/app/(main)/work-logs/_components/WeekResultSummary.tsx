"use client";

/**
 * WeekResultSummary — "OO 주 결과 요약" 카드
 *
 * WEEK 로그의 result_cn만 다룬다 — 계획(WeekChecklistSummary)과 분리해서 "계획 카드 옆에
 * 결과 카드"로 나란히 보여주기 위해 예전 WeekPlanRow의 WeekCard에서 결과 섹션만 떼어냈다
 * (2026-07-24).
 *
 * 카드 높이를 WeekChecklistSummary와 같은 WEEK_SUMMARY_CARD_HEIGHT로 고정하고, textarea는
 * rows 대신 fill로 남는 공간을 채운다(2026-07-24e) — 계획 카드는 체크리스트 항목 수에 따라
 * 제각각 늘어나는데 결과 요약 카드는 항상 고정 크기라, 옆으로 나란히 두면 높이가 안 맞던
 * 문제를 계획 카드 쪽 내부 스크롤 캡핑 + 양쪽 카드 높이 고정으로 해결.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { invalidateWorkLogQueries, WEEK_SUMMARY_CARD_HEIGHT } from "@/lib/weekUtil";
import type { WorkLogResponse } from "@/types/workLog";
import EmptyHighlightTextarea from "./EmptyHighlightTextarea";

export default function WeekResultSummary({
  projectId,
  monday,
  label,
}: {
  projectId: string;
  monday: string;
  label: string;
}) {
  const queryClient = useQueryClient();
  const [resultCn, setResultCn] = useState("");

  const queryKey = ["work-log", "WEEK", projectId, monday];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      authFetch<{ data: WorkLogResponse }>(
        `/api/projects/${projectId}/work-logs?date=${monday}&logTyCode=WEEK&mberId=me`
      ).then((r) => r.data),
    enabled: !!projectId,
  });
  const weekLog = data?.items?.[0] ?? null;

  useEffect(() => {
    setResultCn(weekLog?.resultCn ?? "");
  }, [weekLog?.resultCn, monday]);

  const saveMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/work-logs`, {
        method: "PUT",
        body: JSON.stringify({ logTyCode: "WEEK", logDt: monday, noteCn: weekLog?.noteCn ?? "", resultCn }),
      }),
    onSuccess: () => invalidateWorkLogQueries(queryClient),
  });

  const isDirty = resultCn !== (weekLog?.resultCn ?? "");

  return (
    <div
      style={{
        border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)",
        background: "var(--color-bg-card)", padding: 12,
        display: "flex", flexDirection: "column", gap: 8,
        height: WEEK_SUMMARY_CARD_HEIGHT,
      }}
    >
      <span style={{ fontSize: "var(--text-base)", fontWeight: 700, color: "var(--color-text-primary)" }}>{label} 결과 요약</span>

      {isLoading ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>불러오는 중...</div>
      ) : (
        <>
          <EmptyHighlightTextarea
            rows={8}
            fill
            message={`${label} 결과를 입력해 주세요.`}
            value={resultCn}
            onChange={setResultCn}
          />
          {isDirty && (
            <div style={{ textAlign: "right" }}>
              <button
                type="button"
                className="sp-btn sp-btn-secondary sp-btn-xs"
                disabled={saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                저장
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
