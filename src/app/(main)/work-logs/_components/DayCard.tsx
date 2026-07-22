"use client";

/**
 * DayCard — 하루치 업무일지 미니 카드 (계획/결과 2단 구성)
 *
 * TodayTab 이 한 주(7장)를 그리드로 늘어놓는 단위. 카드 하나가 독립적으로
 * 자기 날짜의 DAILY 로그를 조회·저장한다 — 날짜별로 로딩/저장 상태가 서로 얽히지
 * 않도록 각 카드가 자기 상태를 스스로 들고 있다(부모가 날짜별 상태를 모아 관리하지 않음).
 *
 * "계획" = 내가 직접 입력한 체크리스트(완료 체크 = 오늘 이 항목을 끝냈는가).
 * "결과" = 하루를 마무리하며 남기는 짧은 요약/특이사항 텍스트.
 *
 * "일감 태그"(화면/기능/과업 참고용 연결)는 여기 없다 — WeekPlanRow로 옮겼다. 일이 보통
 * 한 주~한 달 단위로 굴러가는데 매일 같은 일감을 반복해서 태그하는 게 의미가 없다는
 * 피드백으로, 일감 태그는 주 단위로 한 번만 붙이도록 통합했다.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { invalidateWorkLogQueries } from "@/lib/weekUtil";
import type { WorkLogResponse } from "@/types/workLog";

const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

function formatDayHeading(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return `${dateStr.slice(5, 7)}/${dateStr.slice(8, 10)} (${WEEKDAY_LABEL[d.getUTCDay()]})`;
}

export default function DayCard({ projectId, date, isToday }: { projectId: string; date: string; isToday: boolean }) {
  const queryClient = useQueryClient();
  const [noteCn, setNoteCn] = useState("");
  const [newItemText, setNewItemText] = useState("");

  const queryKey = ["work-log", "DAILY", projectId, date];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      authFetch<{ data: WorkLogResponse }>(
        `/api/projects/${projectId}/work-logs?date=${date}&logTyCode=DAILY&mberId=me`
      ).then((r) => r.data),
    enabled: !!projectId,
  });

  const dailyLog = data?.items?.[0] ?? null;

  useEffect(() => {
    setNoteCn(dailyLog?.noteCn ?? "");
  }, [dailyLog?.noteCn, date]);

  // work-log 계열 캐시(업무 리포트 등 다른 화면 포함) 전체 무효화 — 상세 이유는 weekUtil.ts 참고
  const invalidate = () => invalidateWorkLogQueries(queryClient);

  // 로그가 아직 없으면 먼저 upsert 해서 work_log_id 를 확보 — 항목 추가는 work_log_id 가 필요하다.
  async function ensureWorkLogId(): Promise<string> {
    if (dailyLog) return dailyLog.workLogId;
    const res = await authFetch<{ data: { workLogId: string } }>(`/api/projects/${projectId}/work-logs`, {
      method: "PUT",
      body: JSON.stringify({ logTyCode: "DAILY", logDt: date, noteCn }),
    });
    return res.data.workLogId;
  }

  const saveNoteMutation = useMutation({
    mutationFn: async () => {
      await authFetch(`/api/projects/${projectId}/work-logs`, {
        method: "PUT",
        body: JSON.stringify({ logTyCode: "DAILY", logDt: date, noteCn }),
      });
    },
    onSuccess: invalidate,
  });

  const addItemMutation = useMutation({
    mutationFn: async (itemCn: string) => {
      const workLogId = await ensureWorkLogId();
      await authFetch(`/api/projects/${projectId}/work-logs/${workLogId}/items`, {
        method: "POST",
        body: JSON.stringify({ itemCn }),
      });
    },
    onSuccess: () => {
      setNewItemText("");
      invalidate();
    },
  });

  const toggleItemMutation = useMutation({
    mutationFn: async (args: { itemId: string; doneYn: "Y" | "N" }) => {
      if (!dailyLog) return;
      await authFetch(`/api/projects/${projectId}/work-logs/${dailyLog.workLogId}/items/${args.itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ doneYn: args.doneYn }),
      });
    },
    onSuccess: invalidate,
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      if (!dailyLog) return;
      await authFetch(`/api/projects/${projectId}/work-logs/${dailyLog.workLogId}/items/${itemId}`, {
        method: "DELETE",
      });
    },
    onSuccess: invalidate,
  });

  // ref_ty_code 있는 항목(일감 태그)은 이제 WeekPlanRow에서만 만든다 — 혹시 남아있는
  // 과거 데이터가 있어도 체크리스트에 섞여 다시 혼란을 주지 않도록 방어적으로 제외.
  const todoItems = (dailyLog?.items ?? []).filter((i) => !i.refTyCode);

  return (
    <div
      style={{
        width: 420, flex: "0 0 420px",
        // "오늘" 카드 강조 — 배경까지 틴트하니 카드 전체가 튀어서 부담스럽다는 피드백으로
        // 테두리(+날짜 텍스트 컬러)만 강조하고 배경은 다른 카드와 동일한 흰 배경 유지.
        border: `${isToday ? 2 : 1}px solid ${isToday ? "var(--color-brand)" : "var(--color-border)"}`,
        borderRadius: "var(--radius-card)",
        background: "var(--color-bg-card)",
        display: "flex", flexDirection: "column",
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          padding: "8px 12px", display: "flex", alignItems: "center", gap: 8,
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        {/* 날짜가 잘 안 보인다는 피드백으로 카드 헤더 폰트 한 단계 키움 */}
        <span style={{ fontSize: "var(--text-base)", fontWeight: 700, color: isToday ? "var(--color-brand)" : "var(--color-text-primary)" }}>
          {formatDayHeading(date)}{isToday && " · 오늘"}
        </span>
        {todoItems.length > 0 && (
          <span style={{ marginLeft: "auto", fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)" }}>
            {todoItems.filter((i) => i.doneYn === "Y").length}/{todoItems.length}
          </span>
        )}
      </div>

      {isLoading ? (
        <div style={{ padding: 12, fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>불러오는 중...</div>
      ) : (
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {/* 계획 */}
          <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--color-text-secondary)", letterSpacing: "0.04em" }}>
            계획
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 140, overflowY: "auto" }}>
            {todoItems.length === 0 && (
              <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-disabled)" }}>등록한 할일이 없습니다.</div>
            )}
            {todoItems.map((item) => (
              <label key={item.itemId} className="sp-checkbox-wrap" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  className="sp-checkbox"
                  type="checkbox"
                  checked={item.doneYn === "Y"}
                  onChange={(e) => toggleItemMutation.mutate({ itemId: item.itemId, doneYn: e.target.checked ? "Y" : "N" })}
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
                <button
                  type="button"
                  className="sp-btn sp-btn-ghost sp-btn-xs"
                  onClick={() => deleteItemMutation.mutate(item.itemId)}
                  title="삭제"
                  style={{ padding: "1px 5px" }}
                >
                  ✕
                </button>
              </label>
            ))}
          </div>

          <div style={{ display: "flex", gap: 5 }}>
            <input
              className="sp-input"
              placeholder="할일 입력 후 Enter"
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newItemText.trim()) {
                  addItemMutation.mutate(newItemText.trim());
                }
              }}
              style={{ flex: 1, height: 28, fontSize: "var(--text-sm)" }}
            />
            <button
              type="button"
              className="sp-btn sp-btn-secondary sp-btn-xs"
              disabled={!newItemText.trim() || addItemMutation.isPending}
              onClick={() => addItemMutation.mutate(newItemText.trim())}
            >
              추가
            </button>
          </div>

          <div style={{ borderTop: "1px solid var(--color-border-subtle)", marginTop: 2, paddingTop: 8 }}>
            {/* 결과 — "결과"만으로는 뭘 적는 칸인지 애매하다는 피드백으로 "오늘 작업 결과"로 구체화 */}
            <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--color-text-secondary)", letterSpacing: "0.04em", marginBottom: 4 }}>
              오늘 작업 결과
            </div>
            <textarea
              className="sp-input sp-textarea"
              rows={5}
              style={{ width: "100%", fontSize: "var(--text-sm)" }}
              placeholder="오늘 실제로 한 일이나 특이사항을 짧게 남겨 보세요."
              value={noteCn}
              onChange={(e) => setNoteCn(e.target.value)}
            />
            {noteCn !== (dailyLog?.noteCn ?? "") && (
              <div style={{ marginTop: 4, textAlign: "right" }}>
                <button
                  type="button"
                  className="sp-btn sp-btn-secondary sp-btn-xs"
                  disabled={saveNoteMutation.isPending}
                  onClick={() => saveNoteMutation.mutate()}
                >
                  저장
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
