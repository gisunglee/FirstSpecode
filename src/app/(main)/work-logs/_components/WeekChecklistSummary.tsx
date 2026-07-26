"use client";

/**
 * WeekChecklistSummary — "OO 주 계획" 요약 카드
 *
 * 새 데이터를 만들지 않는다 — 그 주 7일치 DAILY 로그의 할일 항목을 한 곳에 모아 보여주는
 * 뷰일 뿐이다. 여기서 체크하면 해당 날짜의 원본 항목(DayCard가 보는 것과 동일
 * work_log_id/item_id)도 같이 완료 처리된다 — 진짜로 같은 데이터를 다른 자리에서 보여주는
 * 것뿐이라 별도 동기화 로직이 필요 없다.
 *
 * 참고 이미지엔 항목마다 카테고리 태그(개발/배포/문서 등)가 있었는데, 지금 스키마엔 그런
 * 개념이 없어서 대신 그 항목이 속한 날짜(예: "07/20 월")를 붙였다 — "이 항목이 어느 날짜
 * 것인지"가 카테고리보다 더 바로 쓸모 있는 정보다(2026-07-24).
 *
 * "관련 일감"(WEEK 로그에 붙는 참고 태그)은 그대로 유지 — 예전 WeekPlanRow의 WeekCard에
 * 있던 로직을 그대로 옮겨왔다.
 *
 * "전주 관련일감 가져오기" 추가(2026-07-24d) — 관련 일감은 보통 몇 주씩 이어서 작업하는
 * 일감이라 매주 다시 태그하기 번거롭다는 피드백. 전주 WEEK 로그의 태그(ref_ty_code 있는
 * 항목)만 그대로 복사해온다 — 중복 방지는 하지 않는다(전일 미완료 복사와 같은 원칙: 사용자가
 * 원할 때만 누르는 명시적 동작이라 이미 있어도 다시 누르면 또 추가됨).
 *
 * 카드 전체 높이를 WEEK_SUMMARY_CARD_HEIGHT로 고정(2026-07-24e) — 체크리스트와 관련 일감
 * 모두 내부 스크롤로 캡핑해서, 항목이 몇 개든 옆 "결과 요약" 카드와 높이가 항상 맞도록 한다.
 * 두 영역의 배분은 체크리스트 114px(4개 분량) / 관련일감 90px(3줄 분량) — 관련 일감이 스크롤이
 * 너무 일찍 생긴다는 피드백으로 체크리스트 쪽 여유를 좀 덜어 관련일감 쪽에 옮겼다(2026-07-24f).
 * 카드 전체 높이(360)는 그대로 유지 — "결과 요약" 카드와의 정렬을 깨지 않기 위함.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { addDaysStr, invalidateWorkLogQueries, WEEK_SUMMARY_CARD_HEIGHT } from "@/lib/weekUtil";
import type { WorkLogResponse, WorkLogItemRefType } from "@/types/workLog";
import RefPicker from "./RefPicker";

const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

export default function WeekChecklistSummary({
  projectId,
  monday,
  label,
}: {
  projectId: string;
  monday: string;
  label: string;
}) {
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const sunday = addDaysStr(monday, 6);
  const invalidate = () => invalidateWorkLogQueries(queryClient);

  const dailyQuery = useQuery({
    queryKey: ["work-log-range", projectId, monday, "DAILY", "me7"],
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
  const weekLog = weekQuery.data?.items?.[0] ?? null;

  const toggleItemMutation = useMutation({
    mutationFn: async (args: { workLogId: string; itemId: string; doneYn: "Y" | "N" }) => {
      await authFetch(`/api/projects/${projectId}/work-logs/${args.workLogId}/items/${args.itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ doneYn: args.doneYn }),
      });
    },
    onSuccess: invalidate,
  });

  // 관련 일감 태그 추가는 work_log_id 가 필요 — 아직 이 주에 WEEK 로그가 없으면 먼저 upsert.
  async function ensureWeekLogId(): Promise<string> {
    if (weekLog) return weekLog.workLogId;
    const res = await authFetch<{ data: { workLogId: string } }>(`/api/projects/${projectId}/work-logs`, {
      method: "PUT",
      body: JSON.stringify({ logTyCode: "WEEK", logDt: monday, noteCn: "", resultCn: "" }),
    });
    return res.data.workLogId;
  }

  const addTagMutation = useMutation({
    mutationFn: async (args: { refTyCode: WorkLogItemRefType; refId: string }) => {
      const workLogId = await ensureWeekLogId();
      await authFetch(`/api/projects/${projectId}/work-logs/${workLogId}/items`, {
        method: "POST",
        body: JSON.stringify(args),
      });
    },
    onSuccess: () => {
      setPickerOpen(false);
      invalidate();
    },
  });

  const deleteTagMutation = useMutation({
    mutationFn: async (itemId: string) => {
      if (!weekLog) return;
      await authFetch(`/api/projects/${projectId}/work-logs/${weekLog.workLogId}/items/${itemId}`, {
        method: "DELETE",
      });
    },
    onSuccess: invalidate,
  });

  const copyPrevWeekTagsMutation = useMutation({
    mutationFn: async () => {
      const prevMonday = addDaysStr(monday, -7);
      const prevRes = await authFetch<{ data: WorkLogResponse }>(
        `/api/projects/${projectId}/work-logs?date=${prevMonday}&logTyCode=WEEK&mberId=me`
      );
      const prevTagItems = (prevRes.data.items?.[0]?.items ?? []).filter((i) => i.refTyCode);
      if (prevTagItems.length === 0) return 0;
      const workLogId = await ensureWeekLogId();
      for (const item of prevTagItems) {
        await authFetch(`/api/projects/${projectId}/work-logs/${workLogId}/items`, {
          method: "POST",
          body: JSON.stringify({ refTyCode: item.refTyCode, refId: item.refId }),
        });
      }
      return prevTagItems.length;
    },
    onSuccess: (copiedCount) => {
      invalidate();
      toast[copiedCount > 0 ? "success" : "info"](
        copiedCount > 0 ? `전주 관련일감 ${copiedCount}건을 가져왔습니다.` : "전주에 가져올 관련 일감이 없습니다."
      );
    },
    onError: () => toast.error("전주 관련일감 가져오기에 실패했습니다."),
  });

  const dailyLogs = dailyQuery.data?.items ?? [];
  const checklist = dailyLogs
    .flatMap((log) =>
      log.items
        .filter((i) => !i.refTyCode)
        .map((item) => ({ ...item, workLogId: log.workLogId, logDt: log.logDt }))
    )
    .sort((a, b) => a.logDt.localeCompare(b.logDt));
  const total = checklist.length;
  const done  = checklist.filter((i) => i.doneYn === "Y").length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const tagItems = weekLog?.items ?? [];
  const isLoading = dailyQuery.isLoading || weekQuery.isLoading;

  return (
    <div
      style={{
        border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)",
        background: "var(--color-bg-card)", padding: 12,
        display: "flex", flexDirection: "column", gap: 8,
        height: WEEK_SUMMARY_CARD_HEIGHT,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: "var(--text-base)", fontWeight: 700, color: "var(--color-text-primary)" }}>{label} 계획</span>
        {/* 이/다음 "주"만으로는 정확히 어느 날짜 범위인지 안 보인다는 피드백(2026-07-24h) —
            제목 옆에 월/일 범위를 바로 붙여준다. */}
        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)" }}>
          {monday.slice(5, 7)}/{monday.slice(8, 10)} ~ {sunday.slice(5, 7)}/{sunday.slice(8, 10)}
        </span>
        {total > 0 && (
          <span style={{ marginLeft: "auto", fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)" }}>
            {done}/{total} 완료 {percent}%
          </span>
        )}
      </div>

      {isLoading ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>불러오는 중...</div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, height: 140, overflowY: "auto" }}>
            {checklist.length === 0 && (
              <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-disabled)" }}>등록한 할일이 없습니다.</div>
            )}
            {checklist.map((item) => (
              <label key={item.itemId} className="sp-checkbox-wrap" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  className="sp-checkbox"
                  type="checkbox"
                  checked={item.doneYn === "Y"}
                  onChange={(e) => toggleItemMutation.mutate({ workLogId: item.workLogId, itemId: item.itemId, doneYn: e.target.checked ? "Y" : "N" })}
                />
                <span
                  style={{
                    flex: 1, fontSize: "var(--text-sm)",
                    textDecoration: item.doneYn === "Y" ? "line-through" : "none",
                    color: item.doneYn === "Y" ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
                  }}
                >
                  {item.itemCn}
                </span>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
                  {item.logDt.slice(5, 7)}/{item.logDt.slice(8, 10)} {WEEKDAY_LABEL[new Date(item.logDt + "T00:00:00Z").getUTCDay()]}
                </span>
              </label>
            ))}
          </div>
          {total > 0 && (
            <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
              체크한 항목은 해당 날짜 기록에도 바로 반영됩니다.
            </div>
          )}

          {/* 관련 일감 — flex:1로 카드 하단 남는 공간을 그대로 흡수한다(고정 maxHeight를 쓰면
              그 공간이 빈 여백으로 남아 낭비된다는 피드백, 2026-07-24g) */}
          <div style={{ borderTop: "1px solid var(--color-border-subtle)", paddingTop: 8, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--color-text-secondary)", letterSpacing: "0.04em" }}>
                관련 일감
              </span>
              <button
                type="button"
                className="sp-btn sp-btn-ghost sp-btn-xs"
                title="전주 관련일감 가져오기"
                disabled={copyPrevWeekTagsMutation.isPending}
                onClick={() => copyPrevWeekTagsMutation.mutate()}
                style={{ marginLeft: "auto" }}
              >
                전주 가져오기
              </button>
              <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setPickerOpen((v) => !v)}>
                + 일감 태그
              </button>
            </div>
            {tagItems.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", alignContent: "flex-start", gap: 5, marginBottom: pickerOpen ? 6 : 0, flex: 1, minHeight: 0, overflowY: "auto" }}>
                {tagItems.map((item) => (
                  <span key={item.itemId} className="sp-badge sp-badge-neutral sp-badge-pill sp-badge-tag" style={{ gap: 5 }}>
                    🔖 {item.itemCn}
                    <button
                      type="button"
                      onClick={() => deleteTagMutation.mutate(item.itemId)}
                      title="태그 제거"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, marginLeft: 2, fontSize: "var(--text-xs)" }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            {pickerOpen && (
              <RefPicker
                projectId={projectId}
                onSelect={(refTyCode, refId) => addTagMutation.mutate({ refTyCode, refId })}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
