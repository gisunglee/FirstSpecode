"use client";

/**
 * WeekPlanRow — "주간 계획" 카드 3장 (이번주 + 최대 2주 앞서 미리 작성)
 *
 * 기본 노출 범위가 곧 "미리 쓸 수 있는 한도" — baseOffset(현재 주 기준 오프셋)의 최댓값이
 * 0이라 [이번주, 다음주, 2주 후] 3장이 항상 최대치다("다음" 버튼은 그 이상 못 감).
 * "이전"으로 지난 주까지는 훑어볼 수 있지만 지난 주 카드는 읽기 전용 — 지난 계획은 못 고친다.
 *
 * 계획/결과 2단 구성 + 일감 태그는 DayCard와 동일한 패턴이다. 다른 점은:
 *   - 일은 보통 한 주~한 달 단위로 굴러가서, "일감 태그"는 매일 반복해서 붙이기보다
 *     주 단위로 한 번 붙여 두는 쪽이 자연스럽다는 피드백으로 DayCard에서 여기로 옮겼다.
 *   - 결과는 WEEK 전용 컬럼(result_cn)에 저장 — DAILY는 note_cn 하나로 충분하지만
 *     WEEK는 "계획"과 "결과"를 같은 note_cn에 섞으면 구분이 안 돼 컬럼을 분리했다.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { addDaysStr, getWeekMondayStr } from "@/lib/weekUtil";
import type { WorkLogResponse, WorkLogItemRefType } from "@/types/workLog";
import RefPicker from "./RefPicker";

const OFFSET_LABEL: Record<number, string> = { 0: "이번주", 1: "다음주", 2: "2주 후" };

function weekLabel(offset: number): string {
  if (OFFSET_LABEL[offset]) return OFFSET_LABEL[offset];
  return offset < 0 ? `${-offset}주 전` : `${offset}주 후`;
}

function WeekCard({ projectId, monday, offset }: { projectId: string; monday: string; offset: number }) {
  const queryClient = useQueryClient();
  const [noteCn, setNoteCn] = useState("");
  const [resultCn, setResultCn] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const isPast = offset < 0;

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
    setNoteCn(weekLog?.noteCn ?? "");
    setResultCn(weekLog?.resultCn ?? "");
  }, [weekLog?.noteCn, weekLog?.resultCn, monday]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const saveMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/work-logs`, {
        method: "PUT",
        body: JSON.stringify({ logTyCode: "WEEK", logDt: monday, noteCn, resultCn }),
      }),
    onSuccess: invalidate,
  });

  // 일감 태그 추가는 work_log_id 가 필요 — 아직 이 주에 로그가 없으면(첫 태그) 먼저 upsert.
  async function ensureWorkLogId(): Promise<string> {
    if (weekLog) return weekLog.workLogId;
    const res = await authFetch<{ data: { workLogId: string } }>(`/api/projects/${projectId}/work-logs`, {
      method: "PUT",
      body: JSON.stringify({ logTyCode: "WEEK", logDt: monday, noteCn, resultCn }),
    });
    return res.data.workLogId;
  }

  const addTagMutation = useMutation({
    mutationFn: async (args: { refTyCode: WorkLogItemRefType; refId: string }) => {
      const workLogId = await ensureWorkLogId();
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

  // 금주 카드 강조 — DayCard와 동일하게 배경 틴트는 빼고 테두리(+라벨 텍스트 컬러)만 강조.
  const isCurrentWeek = offset === 0;
  const tagItems = weekLog?.items ?? [];
  const isDirty  = noteCn !== (weekLog?.noteCn ?? "") || resultCn !== (weekLog?.resultCn ?? "");

  return (
    <div
      style={{
        width: 420, flex: "0 0 420px",
        border: `${isCurrentWeek ? 2 : 1}px solid ${isCurrentWeek ? "var(--color-brand)" : "var(--color-border)"}`,
        borderRadius: "var(--radius-card)",
        background: "var(--color-bg-card)",
        opacity: isPast ? 0.7 : 1,
      }}
    >
      <div
        style={{
          padding: "8px 12px", display: "flex", alignItems: "center", gap: 8,
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: isCurrentWeek ? "var(--color-brand)" : "var(--color-text-primary)" }}>
          📅 {weekLabel(offset)}
        </span>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)" }}>
          {monday}
        </span>
        {isPast && <span className="sp-badge sp-badge-neutral" style={{ marginLeft: "auto" }}>읽기 전용</span>}
      </div>

      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {isLoading ? (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>불러오는 중...</div>
        ) : (
          <>
            <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--color-text-tertiary)", letterSpacing: "0.04em" }}>
              계획
            </div>
            <textarea
              className="sp-input sp-textarea"
              rows={4}
              style={{ width: "100%", fontSize: "var(--text-sm)" }}
              placeholder={isPast ? "작성된 계획이 없습니다." : "이번 주에 하려는 일을 짧게 적어 두세요."}
              value={noteCn}
              onChange={(e) => setNoteCn(e.target.value)}
              disabled={isPast}
            />

            {/* 관련 일감 — 체크박스 없는 참고 태그. 주 단위로 한 번만 붙이면 됨. */}
            <div style={{ borderTop: "1px solid var(--color-border-subtle)", paddingTop: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--color-text-tertiary)", letterSpacing: "0.04em" }}>
                  관련 일감
                </span>
                {!isPast && (
                  <button
                    type="button"
                    className="sp-btn sp-btn-ghost sp-btn-xs"
                    onClick={() => setPickerOpen((v) => !v)}
                    style={{ marginLeft: "auto" }}
                  >
                    + 일감 태그
                  </button>
                )}
              </div>

              {tagItems.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: pickerOpen ? 6 : 0 }}>
                  {tagItems.map((item) => (
                    <span key={item.itemId} className="sp-badge sp-badge-neutral sp-badge-pill" style={{ gap: 5 }}>
                      🔖 {item.itemCn}
                      {!isPast && (
                        <button
                          type="button"
                          onClick={() => deleteTagMutation.mutate(item.itemId)}
                          title="태그 제거"
                          style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, marginLeft: 2, fontSize: "var(--text-xs)" }}
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}

              {pickerOpen && !isPast && (
                <RefPicker
                  projectId={projectId}
                  onSelect={(refTyCode, refId) => addTagMutation.mutate({ refTyCode, refId })}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </div>

            <div style={{ borderTop: "1px solid var(--color-border-subtle)", paddingTop: 8 }}>
              <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--color-text-tertiary)", letterSpacing: "0.04em", marginBottom: 4 }}>
                결과
              </div>
              <textarea
                className="sp-input sp-textarea"
                rows={4}
                style={{ width: "100%", fontSize: "var(--text-sm)" }}
                placeholder={isPast ? "작성된 결과가 없습니다." : "이번 주가 끝나면 실제로 한 일을 짧게 정리해 보세요."}
                value={resultCn}
                onChange={(e) => setResultCn(e.target.value)}
                disabled={isPast}
              />
            </div>

            {!isPast && isDirty && (
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
    </div>
  );
}

export default function WeekPlanRow({ projectId }: { projectId: string }) {
  const [baseOffset, setBaseOffset] = useState(0);
  const thisWeekMonday = getWeekMondayStr();

  const offsets = [baseOffset, baseOffset + 1, baseOffset + 2];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setBaseOffset((v) => v - 1)}>
          ← 이전
        </button>
        <button
          type="button"
          className="sp-btn sp-btn-ghost sp-btn-xs"
          disabled={baseOffset >= 0}
          onClick={() => setBaseOffset((v) => Math.min(0, v + 1))}
        >
          다음 →
        </button>
        {baseOffset !== 0 && (
          <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setBaseOffset(0)}>
            이번주로
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {offsets.map((offset) => (
          <WeekCard
            key={offset}
            projectId={projectId}
            monday={addDaysStr(thisWeekMonday, offset * 7)}
            offset={offset}
          />
        ))}
      </div>
    </div>
  );
}
