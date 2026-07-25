"use client";

/**
 * useDayLog — 하루치 DAILY 업무일지(계획 체크리스트 + 오늘 작업 결과) 조회·편집 훅
 *
 * DayCard(카드형)와 한때 있던 "리스트형"(DayListRow, 이후 삭제) 컴포넌트가 같은 로직을
 * 공유하기 위해 DayCard.tsx에서 추출했다(2026-07-24).
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { invalidateWorkLogQueries } from "@/lib/weekUtil";
import type { WorkLogResponse } from "@/types/workLog";

export function useDayLog(projectId: string, date: string) {
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

  // 전일 미완료 항목 복사 — "이전 주 불러오기"(주 단위 일괄)보다 실제로 더 쓰이는 단위(하루,
  // 미완료만)로 대체한 기능(2026-07-24c).
  const copyPreviousIncompleteMutation = useMutation({
    mutationFn: () =>
      authFetch<{ data: { copiedCount: number } }>(`/api/projects/${projectId}/work-logs/copy-incomplete`, {
        method: "POST",
        body: JSON.stringify({ date }),
      }).then((r) => r.data),
    onSuccess: (data) => {
      invalidate();
      toast[data.copiedCount > 0 ? "success" : "info"](
        data.copiedCount > 0 ? `전일 미완료 ${data.copiedCount}건을 복사했습니다.` : "전일에 복사할 미완료 항목이 없습니다."
      );
    },
    onError: () => toast.error("전일 미완료 항목 복사에 실패했습니다."),
  });

  // ref_ty_code 있는 항목(일감 태그)은 WeekPlanRow/WeekChecklistSummary에서만 만든다 — 혹시
  // 남아있는 과거 데이터가 있어도 체크리스트에 섞여 다시 혼란을 주지 않도록 방어적으로 제외.
  const todoItems = (dailyLog?.items ?? []).filter((i) => !i.refTyCode);

  return {
    isLoading,
    dailyLog,
    todoItems,
    noteCn,
    setNoteCn,
    newItemText,
    setNewItemText,
    saveNoteMutation,
    addItemMutation,
    toggleItemMutation,
    deleteItemMutation,
    copyPreviousIncompleteMutation,
  };
}
