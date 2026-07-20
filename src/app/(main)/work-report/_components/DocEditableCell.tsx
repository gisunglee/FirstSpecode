"use client";

/**
 * DocEditableCell — "한글 문서에 바로 쓰는" 느낌의 클릭-편집 셀
 *
 * 평소엔 일반 텍스트처럼 보이다가(테두리·버튼 없음), 클릭하면 그 자리에서 바로
 * textarea로 바뀌어 타이핑할 수 있고, blur 되면 바뀐 내용만 저장한다. 별도의
 * "편집 모드"/"저장" 버튼이 없는 이유 — 셀마다 버튼이 붙으면 문서 전체가 다시
 * 업무일지 카드처럼 번잡해 보인다는 게 지난 피드백의 핵심이었다.
 */

import { useEffect, useRef, useState } from "react";

export default function DocEditableCell({
  value,
  placeholder,
  onSave,
  minRows = 2,
}: {
  value:       string;
  placeholder: string;
  onSave:      (next: string) => void;
  minRows?:    number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 저장이 끝나 부모의 value가 갱신되면 편집 중이 아닐 때만 반영 — 타이핑 중에 덮어쓰지 않도록.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== value.trim()) onSave(trimmed);
  }

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        rows={minRows}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <div className="sp-doc-cell-editable" onClick={() => setEditing(true)} style={{ minHeight: minRows * 20 }}>
      {value.trim() ? (
        <span style={{ whiteSpace: "pre-wrap" }}>{value}</span>
      ) : (
        <span style={{ color: "var(--color-text-disabled)" }}>{placeholder}</span>
      )}
    </div>
  );
}
