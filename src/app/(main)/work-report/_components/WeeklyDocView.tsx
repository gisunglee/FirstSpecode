"use client";

/**
 * WeeklyDocView — 한 주(월~일)를 "구분 | 업무내용 | 비고" 문서 한 장으로 렌더링
 *
 * 업무일지(TbWrWorkLog/TbWrWorkLogItem)와 완전히 같은 데이터를 다른 모양으로 보여줄 뿐
 * — 새 API·컬럼 없이 기존 GET/PUT work-logs, POST/DELETE .../items 만 재사용한다.
 *
 * 행 매핑:
 *   금주 결과보고   = 이 주 WEEK 로그의 result_cn
 *   다음주 업무계획 = 다음 주 WEEK 로그의 note_cn (WeekPlanRow의 "계획"과 동일 데이터)
 *   세부 업무계획   = 월~금 각 DAILY 로그: 계획=items(읽기전용 번호목록), 결과=note_cn(편집 가능)
 *   중요업무       = 이 주 WEEK 로그의 items(관련 일감 태그)
 *
 * "비고" 열은 뺐다 — 대응하는 데이터가 없어서 입력을 받지도 못하면서 헤더만 떠 있는 게
 * 오히려 혼란스럽다는 피드백. 세부 업무계획의 "계획/결과" 2단만 실질적으로 열이 나뉘고,
 * 나머지 행은 "구분 | 업무 내용" 2열 문서로 본다.
 *
 * "주간"/"월간" 두 모드 모두 이 컴포넌트를 그대로 반복 사용한다.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { addDaysStr, invalidateWorkLogQueries } from "@/lib/weekUtil";
import type { WorkLogResponse, WorkLogItemRefType } from "@/types/workLog";
import DocEditableCell from "./DocEditableCell";
import RefPicker from "../../work-logs/_components/RefPicker";

const WEEKDAY_LABEL = ["월", "화", "수", "목", "금"];

// 구분 열이 좁아서 "2026-07-20 ~ 2026-07-26" 같은 전체 날짜가 옆 칸과 겹쳐 보이던 문제로,
// 연도 없이 월/일만 짧게 표기한다.
function mmdd(dateStr: string): string {
  return `${dateStr.slice(5, 7)}/${dateStr.slice(8, 10)}`;
}
function mmddRange(from: string, to: string): string {
  return `${mmdd(from)} ~ ${mmdd(to)}`;
}

export default function WeeklyDocView({ projectId, monday }: { projectId: string; monday: string }) {
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);

  const friday     = addDaysStr(monday, 4);
  const nextMonday = addDaysStr(monday, 7);

  const dailyQuery = useQuery({
    queryKey: ["work-log-range", projectId, monday, "DAILY"],
    queryFn: () =>
      authFetch<{ data: WorkLogResponse }>(
        `/api/projects/${projectId}/work-logs?from=${monday}&to=${friday}&logTyCode=DAILY&mberId=me`
      ).then((r) => r.data),
    enabled: !!projectId,
  });

  const thisWeekQuery = useQuery({
    queryKey: ["work-log", "WEEK", projectId, monday],
    queryFn: () =>
      authFetch<{ data: WorkLogResponse }>(
        `/api/projects/${projectId}/work-logs?date=${monday}&logTyCode=WEEK&mberId=me`
      ).then((r) => r.data),
    enabled: !!projectId,
  });

  const nextWeekQuery = useQuery({
    queryKey: ["work-log", "WEEK", projectId, nextMonday],
    queryFn: () =>
      authFetch<{ data: WorkLogResponse }>(
        `/api/projects/${projectId}/work-logs?date=${nextMonday}&logTyCode=WEEK&mberId=me`
      ).then((r) => r.data),
    enabled: !!projectId,
  });

  // work-logs 관련 캐시를 폭넓게 무효화 — 이 화면에서 저장한 게 /work-logs 쪽에도
  // 곧바로 반영되어야 "같은 DB를 보고 있다"는 게 체감된다. queryKey 접두어가 컴포넌트마다
  // 달라("work-log"/"work-log-range"/"work-log-history") exact 매치로는 일부가 빠지므로
  // predicate 기반 헬퍼(weekUtil.ts)를 쓴다 — 저장 직후 값이 잠깐 사라졌다 새로고침해야
  // 돌아오던 버그가 바로 이 exact-key 불일치 때문이었다.
  const invalidateAll = () => invalidateWorkLogQueries(queryClient);

  const thisWeekLog = thisWeekQuery.data?.items?.[0] ?? null;
  const nextWeekLog = nextWeekQuery.data?.items?.[0] ?? null;
  const dailyByDate = new Map((dailyQuery.data?.items ?? []).map((l) => [l.logDt, l]));
  const weekdays    = Array.from({ length: 5 }, (_, i) => addDaysStr(monday, i));

  const saveThisWeekResult = useMutation({
    mutationFn: (resultCn: string) =>
      authFetch(`/api/projects/${projectId}/work-logs`, {
        method: "PUT",
        body: JSON.stringify({ logTyCode: "WEEK", logDt: monday, noteCn: thisWeekLog?.noteCn ?? "", resultCn }),
      }),
    onSuccess: invalidateAll,
  });

  const saveNextWeekPlan = useMutation({
    mutationFn: (noteCn: string) =>
      authFetch(`/api/projects/${projectId}/work-logs`, {
        method: "PUT",
        body: JSON.stringify({ logTyCode: "WEEK", logDt: nextMonday, noteCn, resultCn: nextWeekLog?.resultCn ?? "" }),
      }),
    onSuccess: invalidateAll,
  });

  const saveDailyResult = useMutation({
    mutationFn: (args: { date: string; noteCn: string }) =>
      authFetch(`/api/projects/${projectId}/work-logs`, {
        method: "PUT",
        body: JSON.stringify({ logTyCode: "DAILY", logDt: args.date, noteCn: args.noteCn }),
      }),
    onSuccess: invalidateAll,
  });

  // 중요업무(일감 태그)는 이 주 WEEK 로그에 달린다 — 아직 로그가 없으면 먼저 upsert.
  async function ensureWeekLogId(): Promise<string> {
    if (thisWeekLog) return thisWeekLog.workLogId;
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
      invalidateAll();
    },
  });

  const deleteTagMutation = useMutation({
    mutationFn: async (itemId: string) => {
      if (!thisWeekLog) return;
      await authFetch(`/api/projects/${projectId}/work-logs/${thisWeekLog.workLogId}/items/${itemId}`, {
        method: "DELETE",
      });
    },
    onSuccess: invalidateAll,
  });

  const isLoading = dailyQuery.isLoading || thisWeekQuery.isLoading || nextWeekQuery.isLoading;
  const tagItems  = thisWeekLog?.items ?? [];

  if (isLoading) {
    return (
      <div className="sp-doc-table-wrap" style={{ padding: 20, fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
        불러오는 중...
      </div>
    );
  }

  return (
    <div className="sp-doc-table-wrap">
      <table className="sp-doc-table">
        <colgroup>
          <col style={{ width: 140 }} />
          <col />
          <col style={{ width: "38%" }} />
        </colgroup>
        <thead>
          <tr>
            <th className="sp-doc-label">구분</th>
            <th className="sp-doc-label" colSpan={2}>업무 내용</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="sp-doc-label">
              금주 결과보고
              <div style={{ fontWeight: 400, fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>
                {mmddRange(monday, addDaysStr(monday, 6))}
              </div>
            </td>
            <td colSpan={2}>
              <DocEditableCell
                value={thisWeekLog?.resultCn ?? ""}
                placeholder="이번 주 실적을 정리해 보세요."
                minRows={3}
                onSave={(v) => saveThisWeekResult.mutate(v)}
              />
            </td>
          </tr>

          <tr>
            <td className="sp-doc-label">
              다음주 업무계획
              <div style={{ fontWeight: 400, fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>
                {mmddRange(nextMonday, addDaysStr(nextMonday, 6))}
              </div>
            </td>
            <td colSpan={2}>
              <DocEditableCell
                value={nextWeekLog?.noteCn ?? ""}
                placeholder="다음 주 계획을 적어 보세요."
                minRows={3}
                onSave={(v) => saveNextWeekPlan.mutate(v)}
              />
            </td>
          </tr>

          {/* 중요업무 — "다음주 업무계획" 바로 아래로 이동(피드백) */}
          <tr>
            <td className="sp-doc-label">중요업무</td>
            <td colSpan={2}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
                {tagItems.map((item) => (
                  <span key={item.itemId} className="sp-badge sp-badge-neutral sp-badge-pill" style={{ gap: 5 }}>
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
                <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setPickerOpen((v) => !v)}>
                  + 일감 태그
                </button>
              </div>
              {pickerOpen && (
                <RefPicker
                  projectId={projectId}
                  onSelect={(refTyCode, refId) => addTagMutation.mutate({ refTyCode, refId })}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </td>
          </tr>

          {/* 세부 업무계획 — 구분 셀은 아래 서브헤더 포함 6행 전체를 rowSpan 으로 병합 */}
          <tr>
            <td className="sp-doc-label" rowSpan={weekdays.length + 1}>세부<br />업무계획</td>
            <td className="sp-doc-label" style={{ fontSize: "var(--text-xs)" }}>계획</td>
            <td className="sp-doc-label" style={{ fontSize: "var(--text-xs)" }}>결과</td>
          </tr>
          {weekdays.map((d, i) => {
            const log   = dailyByDate.get(d);
            const items = log?.items ?? [];
            return (
              // 요일 행 높이를 기존 대비 20% 정도 더 여유 있게 — 기본 td 세로 padding(8px)보다 10px로.
              <tr key={d} className="sp-doc-row-tall">
                <td>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {WEEKDAY_LABEL[i]}{" "}
                    <span style={{ fontWeight: 400, color: "var(--color-text-secondary)", fontSize: "var(--text-xs)" }}>
                      ({mmdd(d)})
                    </span>
                  </div>
                  {items.length === 0 ? (
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-disabled)" }}>
                      등록된 계획 없음
                    </div>
                  ) : (
                    <ol style={{ margin: 0, paddingLeft: 18 }}>
                      {items.map((it) => (
                        <li
                          key={it.itemId}
                          style={{
                            textDecoration: it.doneYn === "Y" ? "line-through" : "none",
                            color: it.doneYn === "Y" ? "var(--color-text-tertiary)" : undefined,
                          }}
                        >
                          {it.itemCn}
                        </li>
                      ))}
                    </ol>
                  )}
                  <a
                    href={`/work-logs?week=${monday}`}
                    style={{ fontSize: "var(--text-xs)", color: "var(--color-brand)" }}
                  >
                    → 업무일지에서 편집
                  </a>
                </td>
                <td>
                  <DocEditableCell
                    value={log?.noteCn ?? ""}
                    placeholder="결과 입력"
                    minRows={2}
                    onSave={(v) => saveDailyResult.mutate({ date: d, noteCn: v })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
