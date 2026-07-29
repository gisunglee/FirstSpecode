"use client";

/**
 * MyTaskFlatList — My Task 목록(flat) 보기
 *
 * 단위업무/화면/기능(영역 제외)을 한 줄씩, 정렬 기준(마감일순/정렬순서)에 따라 나열.
 * 담당자/설계일정/구현일정/공수는 셀 클릭으로 바로 편집(편집 가능한 셀만 — TaskFieldCells.tsx 참고).
 */

import Link from "next/link";
import type { MyTaskNode } from "@/types/myTask";
import { ROW_COLS, KindLabel, DDayLabel, DocStatusLabel, AssigneeCell, DateFieldCell, EffortCell, ProgressLabel, ProgressHeaderLabel } from "./TaskFieldCells";

type Props = {
  nodes:     MyTaskNode[];
  projectId: string;
  members:   { memberId: string; name: string }[];
  onChanged: () => void;
  isLoading: boolean;
  error:     Error | null;
};

const GRID_COLS = `${ROW_COLS.kind} ${ROW_COLS.assignee} ${ROW_COLS.dday} 1fr ${ROW_COLS.docStatus} ${ROW_COLS.designStart} ${ROW_COLS.designEnd} ${ROW_COLS.implStart} ${ROW_COLS.implEnd} ${ROW_COLS.designEffort} ${ROW_COLS.implEffort} ${ROW_COLS.design} ${ROW_COLS.impl}`;
// 작성/설계·구현 일정·공수 헤더는 셀 값이 가운데 정렬이라 헤더도 맞춰 가운데 정렬
const CENTER_HEADER: React.CSSProperties = { display: "block", textAlign: "center" };

export default function MyTaskFlatList({ nodes, projectId, members, onChanged, isLoading, error }: Props) {
  return (
    <div className="sp-group" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div
        style={{
          display: "grid", gridTemplateColumns: GRID_COLS, gap: 8,
          padding: "6px 14px", borderBottom: "1px solid var(--color-border)",
          fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", fontWeight: 600,
        }}
      >
        <span>유형</span><span>담당자</span><span>마감</span><span>작업명</span>
        <span style={CENTER_HEADER}>작성</span>
        <span style={CENTER_HEADER}>설계시작</span><span style={CENTER_HEADER}>설계종료</span>
        <span style={CENTER_HEADER}>구현시작</span><span style={CENTER_HEADER}>구현종료</span>
        <span style={CENTER_HEADER}>설계공수</span><span style={CENTER_HEADER}>구현공수</span>
        <ProgressHeaderLabel />
      </div>

      <div style={{ maxHeight: 640, overflowY: "auto" }}>
        {isLoading ? (
          <div style={{ padding: 16, color: "var(--color-text-tertiary)", fontSize: "var(--text-lg)" }}>불러오는 중...</div>
        ) : error ? (
          <div style={{ padding: 16, color: "var(--color-error)", fontSize: "var(--text-lg)" }}>⚠ {error.message}</div>
        ) : nodes.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "var(--text-lg)" }}>
            해당하는 업무가 없습니다.
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {nodes.map((n) => (
              <li key={`${n.kind}-${n.id}`} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                <div
                  style={{
                    display: "grid", gridTemplateColumns: GRID_COLS, gap: 8,
                    padding: "6px 14px", alignItems: "center", whiteSpace: "nowrap",
                  }}
                >
                  <KindLabel kind={n.kind} />
                  <AssigneeCell node={n} projectId={projectId} members={members} onChanged={onChanged} />
                  <DDayLabel dDay={n.dDay} />
                  <Link
                    href={n.href}
                    style={{
                      minWidth: 0, fontSize: "var(--text-md)", fontWeight: 500, color: "var(--color-text-primary)",
                      textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis",
                    }}
                    title={n.name}
                  >
                    {n.name || "(이름 없음)"}
                  </Link>
                  <DocStatusLabel docStatus={n.docStatus} />
                  <DateFieldCell node={n} projectId={projectId} field="designStartDate" onChanged={onChanged} />
                  <DateFieldCell node={n} projectId={projectId} field="designEndDate" onChanged={onChanged} />
                  <DateFieldCell node={n} projectId={projectId} field="implStartDate" onChanged={onChanged} />
                  <DateFieldCell node={n} projectId={projectId} field="implEndDate" onChanged={onChanged} />
                  <EffortCell node={n} projectId={projectId} field="designEffort" onChanged={onChanged} />
                  <EffortCell node={n} projectId={projectId} field="implEffort" onChanged={onChanged} />
                  <ProgressLabel value={n.designProgress} />
                  <ProgressLabel value={n.implProgress} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
