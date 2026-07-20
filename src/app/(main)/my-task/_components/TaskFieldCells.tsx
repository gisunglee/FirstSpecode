"use client";

/**
 * TaskFieldCells — My Task 행에서 공용으로 쓰는 셀들(목록/트리 둘 다 재사용)
 *
 * 유형/D-day는 표시 전용, 담당자/일정/공수는 InlineEditCell로 제자리 편집.
 * 편집 시 어느 inline PATCH를 칠지는 endpointFor()가 노드 유형별로 결정 —
 * 영역(AREA)은 스키마 자체에 담당자/일정/공수 필드가 없어 항상 편집 불가.
 */

import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import type { MyTaskKind, MyTaskNode } from "@/types/myTask";
import { MY_TASK_KIND_LABELS } from "@/types/myTask";
import InlineEditCell from "./InlineEditCell";

// 행 그리드 열 고정폭 — 목록/트리 양쪽에서 동일하게 써야 두 뷰가 같은 느낌을 준다.
export const ROW_COLS = { kind: "64px", assignee: "76px", dday: "56px", start: "92px", end: "92px", effort: "56px", design: "52px", impl: "52px" };

export function endpointFor(kind: MyTaskKind, id: string, projectId: string): string | null {
  switch (kind) {
    case "UNIT_WORK": return `/api/projects/${projectId}/unit-works/${id}/inline`;
    case "SCREEN":    return `/api/projects/${projectId}/screens/${id}/inline`;
    case "FUNCTION":  return `/api/projects/${projectId}/functions/${id}/inline`;
    case "AREA":      return null;
  }
}

const KIND_COLOR: Record<MyTaskKind, string> = {
  UNIT_WORK: "var(--color-brand)",
  SCREEN:    "var(--color-info)",
  AREA:      "var(--color-text-tertiary)",
  FUNCTION:  "var(--color-text-secondary)",
};

export function KindLabel({ kind }: { kind: MyTaskKind }) {
  return (
    <span style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: KIND_COLOR[kind], whiteSpace: "nowrap" }}>
      {MY_TASK_KIND_LABELS[kind]}
    </span>
  );
}

function formatDDay(d: number | null): { label: string; color: string } {
  if (d === null) return { label: "-",      color: "var(--color-text-tertiary)" };
  if (d < 0)      return { label: `D+${-d}`, color: "var(--color-error)" };
  if (d === 0)    return { label: "D-DAY",   color: "var(--color-warning)" };
  if (d <= 3)     return { label: `D-${d}`,  color: "var(--color-warning)" };
  if (d <= 7)     return { label: `D-${d}`,  color: "var(--color-info)" };
  return            { label: `D-${d}`,  color: "var(--color-text-tertiary)" };
}

export function DDayLabel({ dDay }: { dDay: number | null }) {
  const { label, color } = formatDDay(dDay);
  return <span style={{ fontSize: "var(--text-sm)", fontWeight: 700, color, whiteSpace: "nowrap" }}>{label}</span>;
}

// 진척률은 "기능걸로 통일" 원칙 — 단위업무/화면은 하위 기능 롤업, 기능은 자기 값. 직접 편집 대상이
// 아니라(기능 상세/AI 결과 반영으로만 바뀜) InlineEditCell이 아니라 표시 전용 라벨.
function progressColor(value: number): string {
  if (value === 0) return "var(--color-error)";
  if (value < 50)  return "var(--color-warning)";
  return "var(--color-text-primary)";
}

// 설계/구현 두 열을 아우르는 헤더 — "?" 하나로 기준을 짧게 설명(모달 없이 title 툴팁만)
export function ProgressHeaderLabel() {
  return (
    <span style={{ gridColumn: "span 2", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
      설계 / 구현
      <span
        title="진척률은 항상 기능 기준입니다 — 기능은 자기 값, 단위업무·화면은 하위 기능들의 평균."
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 13, height: 13, borderRadius: "50%", border: "1px solid var(--color-border)",
          fontSize: 9, fontWeight: 700, color: "var(--color-text-tertiary)", cursor: "help", lineHeight: 1, flexShrink: 0,
        }}
      >?</span>
    </span>
  );
}

export function ProgressLabel({ value }: { value: number | null }) {
  if (value === null) {
    return <span style={{ display: "block", textAlign: "center", color: "var(--color-text-tertiary)" }}>-</span>;
  }
  return (
    <span style={{ display: "block", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", color: progressColor(value) }}>
      {value}%
    </span>
  );
}

type CellProps = { node: MyTaskNode; projectId: string; onChanged: () => void };

async function patchField(endpoint: string, field: string, value: string | null, onChanged: () => void) {
  try {
    await authFetch(endpoint, { method: "PATCH", body: JSON.stringify({ field, value }) });
    onChanged();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "저장에 실패했습니다.");
  }
}

export function AssigneeCell({ node, projectId, onChanged, members }: CellProps & { members: { memberId: string; name: string }[] }) {
  const endpoint = endpointFor(node.kind, node.id, projectId);
  return (
    <InlineEditCell
      disabled={!endpoint}
      disabledText="-"
      renderDisplay={() => node.assigneeName ?? "미지정"}
      renderEditor={(commit, cancel) => (
        <select
          autoFocus
          defaultValue={node.assigneeId ?? ""}
          onChange={(e) => commit(e.target.value || null)}
          onBlur={cancel}
          className="sp-input"
          style={{ fontSize: "var(--text-sm)", padding: "1px 4px", height: 24, maxWidth: 140 }}
        >
          <option value="">담당자 없음</option>
          {members.map((m) => (
            <option key={m.memberId} value={m.memberId}>{m.name}</option>
          ))}
        </select>
      )}
      onSave={(value) => endpoint ? patchField(endpoint, "assignee", value, onChanged) : Promise.resolve()}
    />
  );
}

export function DateFieldCell({ node, projectId, onChanged, field }: CellProps & { field: "startDate" | "endDate" }) {
  const endpoint = endpointFor(node.kind, node.id, projectId);
  const value = field === "startDate" ? node.startDate : node.endDate;
  return (
    <InlineEditCell
      disabled={!endpoint}
      disabledText="-"
      align="center"
      renderDisplay={() => value ?? "-"}
      renderEditor={(commit, cancel) => (
        <input
          type="date"
          autoFocus
          defaultValue={value ?? ""}
          onBlur={(e) => commit(e.target.value || null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
            if (e.key === "Enter") commit((e.target as HTMLInputElement).value || null);
          }}
          className="sp-input"
          style={{ fontSize: "var(--text-sm)", padding: "1px 2px", height: 24, width: "100%", textAlign: "center" }}
        />
      )}
      onSave={(v) => endpoint ? patchField(endpoint, field, v, onChanged) : Promise.resolve()}
    />
  );
}

export function EffortCell({ node, projectId, onChanged }: CellProps) {
  const supportsEffort = node.kind === "SCREEN" || node.kind === "FUNCTION";
  const endpoint = endpointFor(node.kind, node.id, projectId);
  return (
    <InlineEditCell
      disabled={!supportsEffort || !endpoint}
      disabledText="-"
      align="center"
      renderDisplay={() => node.effort ?? "-"}
      renderEditor={(commit, cancel) => (
        <input
          type="text"
          autoFocus
          defaultValue={node.effort ?? ""}
          placeholder="공수"
          onBlur={(e) => commit(e.target.value.trim() || null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
            if (e.key === "Enter") commit((e.target as HTMLInputElement).value.trim() || null);
          }}
          className="sp-input"
          style={{ fontSize: "var(--text-sm)", padding: "1px 2px", height: 24, width: "100%", textAlign: "center" }}
        />
      )}
      onSave={(v) => endpoint ? patchField(endpoint, "effort", v, onChanged) : Promise.resolve()}
    />
  );
}
