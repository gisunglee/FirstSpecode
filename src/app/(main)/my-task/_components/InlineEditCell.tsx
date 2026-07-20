"use client";

/**
 * InlineEditCell — 클릭하면 그 자리에서 값을 바꾸는 제자리 편집 셀(공통 프리미티브)
 *
 * 이 코드베이스엔 "제자리 편집" 전례가 없어(기획 트리는 별도 상세 패널+저장 버튼 방식)
 * My Task에서 처음 도입 — 팝오버 라이브러리 없이 조건부 렌더링만으로 최대한 단순하게.
 * 실제 저장 로직(어느 API를 PATCH할지)은 호출부(TaskFieldCells.tsx)가 결정해서 onSave로 넘긴다.
 */

import { useState } from "react";

type Props = {
  disabled?: boolean;
  disabledText?: string;
  /** 표시 텍스트 정렬 — 담당자/이름은 left, 날짜·공수처럼 짧은 값은 center */
  align?: "left" | "center";
  renderDisplay: () => React.ReactNode;
  renderEditor: (commit: (newValue: string | null) => void, cancel: () => void) => React.ReactNode;
  onSave: (newValue: string | null) => Promise<void>;
};

export default function InlineEditCell({ disabled, disabledText, align = "left", renderDisplay, renderEditor, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  if (disabled) {
    return <span style={{ display: "block", textAlign: align, color: "var(--color-text-tertiary)" }}>{disabledText ?? "-"}</span>;
  }

  if (saving) {
    return <span style={{ display: "block", textAlign: align, color: "var(--color-text-tertiary)" }}>저장 중…</span>;
  }

  if (!editing) {
    return (
      <span
        onClick={() => setEditing(true)}
        title="클릭해서 수정"
        style={{ display: "block", textAlign: align, cursor: "pointer" }}
      >
        {renderDisplay()}
      </span>
    );
  }

  const commit = async (newValue: string | null) => {
    setSaving(true);
    try {
      await onSave(newValue);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  return <>{renderEditor(commit, () => setEditing(false))}</>;
}
