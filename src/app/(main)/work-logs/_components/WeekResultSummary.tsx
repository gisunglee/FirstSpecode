"use client";

/**
 * WeekResultSummary — "OO 주 실적 작성" / "OO 주 계획 작성" 카드
 *
 * WEEK 로그의 result_cn만 다루는 자유서술 텍스트 카드다 — 계획(WeekChecklistSummary,
 * 체크리스트)과 분리해서 "계획 카드 옆에 서술 카드"로 나란히 보여주기 위해 예전
 * WeekPlanRow의 WeekCard에서 이 섹션만 떼어냈다(2026-07-24).
 *
 * mode(2026-07-24h) — "다음 주" 인스턴스에 "결과 요약"이라는 제목을 그대로 쓰면 아직
 * 일어나지도 않은 주의 결과를 요약하라는 뜻이 돼 말이 안 된다는 지적. 저장하는 DB 컬럼
 * (result_cn)과 API는 그대로 두고, 화면 제목/안내문만 인스턴스별로 다르게 표시한다:
 *   - "result"(이번 주) — "{label} 실적 작성" — 이미 지난/진행 중인 주라 실제 실적 서술
 *   - "plan"  (다음 주) — "{label} 계획 작성" — 아직 안 온 주라 계획 서술
 *
 * 카드 높이를 WeekChecklistSummary와 같은 WEEK_SUMMARY_CARD_HEIGHT로 고정하고, textarea는
 * rows 대신 fill로 남는 공간을 채운다(2026-07-24e) — 계획 카드는 체크리스트 항목 수에 따라
 * 제각각 늘어나는데 이 카드는 항상 고정 크기라, 옆으로 나란히 두면 높이가 안 맞던 문제를
 * 계획 카드 쪽 내부 스크롤 캡핑 + 양쪽 카드 높이 고정으로 해결.
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
  mode,
}: {
  projectId: string;
  monday: string;
  label: string;
  /** "result"(실적 작성) | "plan"(계획 작성) — 제목·안내문에만 영향, 저장 데이터는 동일 */
  mode: "result" | "plan";
}) {
  const modeLabel = mode === "result" ? "실적" : "계획";
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
      <span style={{ fontSize: "var(--text-base)", fontWeight: 700, color: "var(--color-text-primary)" }}>{label} {modeLabel} 작성</span>

      {isLoading ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>불러오는 중...</div>
      ) : (
        <>
          <EmptyHighlightTextarea
            rows={8}
            fill
            message={`${label} ${modeLabel}을 입력해 주세요.`}
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
