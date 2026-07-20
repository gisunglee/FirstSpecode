"use client";

/**
 * MyTaskTree — My Task 그룹(tree) 보기
 *
 * 단위업무→화면→영역→기능 전체 구조를 재귀로 그린다(ImplTargetDialog.tsx의 재귀 렌더링
 * 패턴 재사용). 영역은 담당자/일정/공수 필드가 없어 라벨만 보이고 편집 불가.
 * 들여쓰기는 이름 칸 안쪽 paddingLeft로만 주기 때문에, 다른 열(담당자/마감/일정/공수)은
 * 깊이와 무관하게 항상 같은 위치에 정렬된다(MyTaskFlatList와 동일 그리드 폭 공유).
 */

import Link from "next/link";
import type { MyTaskNode } from "@/types/myTask";
import { ROW_COLS, KindLabel, DDayLabel, AssigneeCell, DateFieldCell, EffortCell, ProgressLabel, ProgressHeaderLabel } from "./TaskFieldCells";

type Props = {
  nodes:     MyTaskNode[];
  projectId: string;
  members:   { memberId: string; name: string }[];
  onChanged: () => void;
  isLoading: boolean;
  error:     Error | null;
};

const GRID_COLS = `${ROW_COLS.kind} ${ROW_COLS.assignee} ${ROW_COLS.dday} 1fr ${ROW_COLS.start} ${ROW_COLS.end} ${ROW_COLS.effort} ${ROW_COLS.design} ${ROW_COLS.impl}`;
const INDENT_PX = 10;

export default function MyTaskTree({ nodes, projectId, members, onChanged, isLoading, error }: Props) {
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
        <span>시작일</span><span>종료일</span><span>공수</span>
        <ProgressHeaderLabel />
      </div>

      <div style={{ maxHeight: 640, overflowY: "auto" }}>
        {isLoading ? (
          <div style={{ padding: 16, color: "var(--color-text-tertiary)", fontSize: "var(--text-lg)" }}>불러오는 중...</div>
        ) : error ? (
          <div style={{ padding: 16, color: "var(--color-error)", fontSize: "var(--text-lg)" }}>⚠ {error.message}</div>
        ) : nodes.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "var(--text-lg)" }}>
            단위업무가 없습니다.
          </div>
        ) : (
          <div>
            {nodes.map((n) => (
              <TreeRow key={`${n.kind}-${n.id}`} node={n} level={0} projectId={projectId} members={members} onChanged={onChanged} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TreeRow({
  node, level, projectId, members, onChanged,
}: {
  node: MyTaskNode; level: number; projectId: string;
  members: { memberId: string; name: string }[]; onChanged: () => void;
}) {
  return (
    <>
      <div style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
        <div
          style={{
            display: "grid", gridTemplateColumns: GRID_COLS, gap: 8,
            padding: "6px 14px", alignItems: "center", whiteSpace: "nowrap",
          }}
        >
          <KindLabel kind={node.kind} />
          <AssigneeCell node={node} projectId={projectId} members={members} onChanged={onChanged} />
          <DDayLabel dDay={node.dDay} />
          <Link
            href={node.href}
            style={{
              minWidth: 0, paddingLeft: level * INDENT_PX,
              fontSize: "var(--text-md)", fontWeight: node.kind === "UNIT_WORK" ? 700 : 500,
              color: node.kind === "AREA" ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
              textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis",
            }}
            title={node.name}
          >
            {level > 0 && "ㄴ "}{node.name || "(이름 없음)"}
          </Link>
          <DateFieldCell node={node} projectId={projectId} field="startDate" onChanged={onChanged} />
          <DateFieldCell node={node} projectId={projectId} field="endDate" onChanged={onChanged} />
          <EffortCell node={node} projectId={projectId} onChanged={onChanged} />
          <ProgressLabel value={node.designProgress} />
          <ProgressLabel value={node.implProgress} />
        </div>
      </div>
      {node.children.map((child) => (
        <TreeRow key={`${child.kind}-${child.id}`} node={child} level={level + 1} projectId={projectId} members={members} onChanged={onChanged} />
      ))}
    </>
  );
}
