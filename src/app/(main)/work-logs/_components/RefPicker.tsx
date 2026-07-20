"use client";

/**
 * RefPicker — "일감 선택" 인라인 패널 (업무일지 오늘의 할일 전용)
 *
 * 단위업무/화면/기능/과업 4종 목록 API 응답의 id/name 필드명이 엔티티마다 달라
 * (screenId/funcId/unitWorkId/taskId, tasks만 응답 키도 items 아닌 tasks) 타입별로
 * 별도 조회 함수를 둔다 — 억지로 공통 인터페이스로 묶으면 오히려 각 API 응답 형태를
 * 매핑하는 코드가 더 복잡해진다.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import type { WorkLogItemRefType } from "@/types/workLog";

type PickerRow = { id: string; displayId: string; name: string };

const TYPE_LABEL: Record<WorkLogItemRefType, string> = {
  UNIT_WORK: "단위업무",
  SCREEN:    "화면",
  FUNCTION:  "기능",
  TASK:      "과업",
};
const TYPES: WorkLogItemRefType[] = ["UNIT_WORK", "SCREEN", "FUNCTION", "TASK"];

async function fetchRows(projectId: string, type: WorkLogItemRefType): Promise<PickerRow[]> {
  switch (type) {
    case "UNIT_WORK": {
      const r = await authFetch<{ data: { items: { unitWorkId: string; displayId: string; name: string }[] } }>(
        `/api/projects/${projectId}/unit-works`
      );
      return r.data.items.map((i) => ({ id: i.unitWorkId, displayId: i.displayId, name: i.name }));
    }
    case "SCREEN": {
      const r = await authFetch<{ data: { items: { screenId: string; displayId: string; name: string }[] } }>(
        `/api/projects/${projectId}/screens`
      );
      return r.data.items.map((i) => ({ id: i.screenId, displayId: i.displayId, name: i.name }));
    }
    case "FUNCTION": {
      const r = await authFetch<{ data: { items: { funcId: string; displayId: string; name: string }[] } }>(
        `/api/projects/${projectId}/functions`
      );
      return r.data.items.map((i) => ({ id: i.funcId, displayId: i.displayId, name: i.name }));
    }
    case "TASK": {
      const r = await authFetch<{ data: { tasks: { taskId: string; displayId: string; name: string }[] } }>(
        `/api/projects/${projectId}/tasks`
      );
      return r.data.tasks.map((i) => ({ id: i.taskId, displayId: i.displayId, name: i.name }));
    }
  }
}

export default function RefPicker({
  projectId,
  onSelect,
  onClose,
}: {
  projectId: string;
  onSelect: (refTyCode: WorkLogItemRefType, refId: string) => void;
  onClose:  () => void;
}) {
  const [type, setType]   = useState<WorkLogItemRefType>("FUNCTION");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["work-log-ref-picker", projectId, type],
    queryFn:  () => fetchRows(projectId, type),
  });

  const filtered = (data ?? []).filter((row) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return row.name.toLowerCase().includes(q) || row.displayId.toLowerCase().includes(q);
  });

  return (
    <div
      style={{
        border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
        background: "var(--color-bg-elevated)", padding: 10, marginTop: 6,
      }}
    >
      <div className="sp-tab-seg" style={{ marginBottom: 8 }}>
        {TYPES.map((t) => (
          <div
            key={t}
            className={`sp-tab-seg-item${t === type ? " is-active" : ""}`}
            onClick={() => setType(t)}
          >
            {TYPE_LABEL[t]}
          </div>
        ))}
      </div>

      <input
        className="sp-input"
        placeholder={`${TYPE_LABEL[type]} 이름/ID 검색`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 8, width: "100%" }}
      />

      <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {isLoading && (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", padding: 8 }}>불러오는 중...</div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", padding: 8 }}>결과가 없습니다.</div>
        )}
        {filtered.map((row) => (
          <div
            key={row.id}
            onClick={() => onSelect(type, row.id)}
            style={{
              padding: "6px 8px", borderRadius: "var(--radius-sm)", cursor: "pointer",
              fontSize: "var(--text-sm)", color: "var(--color-text-primary)",
              display: "flex", gap: 8, alignItems: "baseline",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-table-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
              {row.displayId}
            </span>
            <span>{row.name}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 8, textAlign: "right" }}>
        <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}
