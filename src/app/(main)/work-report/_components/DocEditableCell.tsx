"use client";

/**
 * DocEditableCell — "한글 문서에 바로 쓰는" 느낌의 클릭-편집 셀
 *
 * 평소엔 일반 텍스트처럼 보이다가(테두리·버튼 없음), 클릭하면 그 자리에서 바로
 * textarea로 바뀌어 타이핑할 수 있고, blur 되면 바뀐 내용만 저장한다. 별도의
 * "편집 모드"/"저장" 버튼이 없는 이유 — 셀마다 버튼이 붙으면 문서 전체가 다시
 * 업무일지 카드처럼 번잡해 보인다는 게 지난 피드백의 핵심이었다.
 *
 * textarea는 rows 고정이 아니라 내용에 맞춰 자동으로 높이가 늘어난다(auto-grow) —
 * 고정 rows로는 몇 줄만 넘어가도 내부 스크롤이 생겨 "문서" 느낌이 깨진다.
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
  // commit() 직후 서버 재조회가 끝나기 전까지 부모가 넘겨주는 value는 여전히 "저장 전" 값이다.
  // 그 stale 값으로 draft를 덮어써버리면 방금 입력한 내용이 잠깐(재조회가 끝날 때까지)
  // 사라졌다가 돌아오는 것처럼 보인다 — 저장 직후 한 번은 외부 value 동기화를 건너뛴다.
  const suppressNextSyncRef = useRef(false);

  useEffect(() => {
    if (editing) return;
    if (suppressNextSyncRef.current) {
      suppressNextSyncRef.current = false;
      return;
    }
    setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  // auto-grow — 내용 길이에 맞춰 textarea 높이를 매번 다시 계산
  useEffect(() => {
    if (!editing || !textareaRef.current) return;
    const el = textareaRef.current;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, editing]);

  function commit() {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed !== value.trim()) {
      suppressNextSyncRef.current = true;
      onSave(trimmed);
    }
  }

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        className="sp-doc-textarea"
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
        style={{ minHeight: minRows * 20 }}
      />
    );
  }

  return (
    <div className="sp-doc-cell-editable" onClick={() => setEditing(true)} style={{ minHeight: minRows * 20 }}>
      {draft.trim() ? (
        <span style={{ whiteSpace: "pre-wrap" }}>{draft}</span>
      ) : (
        <span style={{ color: "var(--color-text-disabled)" }}>{placeholder}</span>
      )}
    </div>
  );
}
