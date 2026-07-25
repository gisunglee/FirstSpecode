"use client";

/**
 * WeekCardMini — 좌측 주차 목록의 카드 한 장 (마스터-디테일 레이아웃의 "마스터" 쪽)
 *
 * 예전엔 "카드 보기"라는 별도 전체 화면 모드였는데, 굳이 문서 상세를 벗어나야 카드
 * 목록을 볼 수 있는 구조가 불편하다는 피드백으로 — 항상 왼쪽에 세로로 떠 있는 목록으로
 * 바꿨다(이메일 클라이언트의 받은편지함 목록과 같은 자리). 클릭하면 오른쪽 상세(WeeklyDocView)만
 * 바뀌고 목록 자체는 그대로 남아있어 "뒤로 가기" 버튼이 필요 없어졌다.
 *
 * "MM월 N주" 라벨은 monday 하나로 getWeekOfMonthLabel(weekUtil.ts)이 스스로 계산한다 —
 * 예전엔 부모가 넘겨주는 weekIndex(화면에 지금 펼쳐 놓은 배열 안에서의 위치)를 그대로 썼는데,
 * 달 경계 주에서 "7월 1주"처럼 앞뒤가 안 맞는 라벨이 나오는 버그가 있었다(2026-07-24).
 */

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { addDaysStr, getWeekOfMonthLabel } from "@/lib/weekUtil";
import type { WorkLogResponse } from "@/types/workLog";

export default function WeekCardMini({
  projectId,
  monday,
  active,
  onClick,
}: {
  projectId: string;
  monday: string;
  active: boolean;
  onClick: () => void;
}) {
  const sunday = addDaysStr(monday, 6);
  const { monthStart, weekIndex } = getWeekOfMonthLabel(monday);

  const dailyQuery = useQuery({
    queryKey: ["work-log-range", projectId, monday, "DAILY"],
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

  const weekLog    = weekQuery.data?.items?.[0] ?? null;
  const dailyLogs  = dailyQuery.data?.items ?? [];
  const totalItems = dailyLogs.reduce((sum, l) => sum + l.items.length, 0);
  const doneItems  = dailyLogs.reduce((sum, l) => sum + l.items.filter((i) => i.doneYn === "Y").length, 0);
  const tagCount   = weekLog?.items.length ?? 0;
  const resultPreview = weekLog?.resultCn?.trim();

  return (
    <div
      onClick={onClick}
      style={{
        width: "100%", cursor: "pointer", borderRadius: "var(--radius-sm)",
        border: `1px solid ${active ? "var(--color-brand)" : "var(--color-border)"}`,
        background: active ? "var(--color-brand-subtle)" : "var(--color-bg-card)",
        transition: "border-color var(--transition-fast), background var(--transition-fast)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "6px 10px", fontWeight: 600, fontSize: "var(--text-sm)",
          color: active ? "var(--color-brand)" : "var(--color-text-primary)",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        {monthStart.slice(5, 7)}월 {weekIndex}주
        <span style={{ fontWeight: 400, fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginLeft: 6 }}>
          {monday} ~ {sunday}
        </span>
      </div>
      <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
          계획 완료 {totalItems === 0 ? "-" : `${doneItems}/${totalItems}`} · 중요업무 {tagCount}건
        </div>
        <div
          style={{
            fontSize: "var(--text-xs)", color: resultPreview ? "var(--color-text-secondary)" : "var(--color-text-disabled)",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}
        >
          {resultPreview || "아직 금주 결과보고가 없습니다."}
        </div>
      </div>
    </div>
  );
}
