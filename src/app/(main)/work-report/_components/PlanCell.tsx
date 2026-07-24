"use client";

/**
 * PlanCell — WeeklyDocView "세부 업무계획" 표의 하루치 "계획" 칸
 *
 * 예전엔 이 칸이 읽기 전용(체크리스트 표시만)이라 계획 항목을 추가·완료·삭제하려면
 * "업무일지에서 편집" 링크를 타고 /work-logs로 나가야 했다 — 여기서 바로 되면 될 걸 굳이
 * 화면을 옮겨야 하는 게 번거롭다는 피드백으로, DayCard(work-logs)와 같은 체크리스트 UI를
 * 그대로 옮겨왔다(2026-07-23). 새 API 없음 — 기존 work-logs items 엔드포인트만 재사용.
 *
 * 데이터는 부모(WeeklyDocView)가 이미 한 번에 조회해둔 걸 props로 받는다 — 요일마다 따로
 * 쿼리하지 않음. 로그 자체가 없으면(그 날 아직 아무것도 안 씀) log=undefined로 들어오고,
 * 첫 항목 추가 시 이 컴포넌트가 알아서 upsert 한다.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { invalidateWorkLogQueries } from "@/lib/weekUtil";
import type { WorkLog } from "@/types/workLog";

export default function PlanCell({
  projectId,
  date,
  log,
}: {
  projectId: string;
  date: string;
  log: WorkLog | undefined;
}) {
  const queryClient = useQueryClient();
  const [newItemText, setNewItemText] = useState("");
  const invalidate = () => invalidateWorkLogQueries(queryClient);

  async function ensureWorkLogId(): Promise<string> {
    if (log) return log.workLogId;
    const res = await authFetch<{ data: { workLogId: string } }>(`/api/projects/${projectId}/work-logs`, {
      method: "PUT",
      body: JSON.stringify({ logTyCode: "DAILY", logDt: date, noteCn: "" }),
    });
    return res.data.workLogId;
  }

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
      if (!log) return;
      await authFetch(`/api/projects/${projectId}/work-logs/${log.workLogId}/items/${args.itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ doneYn: args.doneYn }),
      });
    },
    onSuccess: invalidate,
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      if (!log) return;
      await authFetch(`/api/projects/${projectId}/work-logs/${log.workLogId}/items/${itemId}`, {
        method: "DELETE",
      });
    },
    onSuccess: invalidate,
  });

  // ref_ty_code 있는 항목(일감 태그)은 "중요업무" 행에서만 다룬다 — DayCard와 동일 관례로 방어적 제외.
  const items = (log?.items ?? []).filter((i) => !i.refTyCode);

  return (
    <div>
      {items.length === 0 ? (
        <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-disabled)", marginBottom: 4 }}>
          등록된 계획 없음
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 4 }}>
          {items.map((item) => (
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
      )}

      <div style={{ display: "flex", gap: 5 }}>
        <input
          className="sp-input"
          placeholder="계획 입력 후 Enter"
          value={newItemText}
          onChange={(e) => setNewItemText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newItemText.trim()) {
              addItemMutation.mutate(newItemText.trim());
            }
          }}
          style={{ flex: 1, height: 26, fontSize: "var(--text-xs)" }}
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
    </div>
  );
}
