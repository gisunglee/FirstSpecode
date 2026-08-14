"use client";

/**
 * FontScaleControl — 에디터 공통 폰트 크기 +/- 버튼
 *
 * RichEditor 툴바, 상세명세·분석메모 헤더 등 여러 곳에서 재사용.
 * editorPrefsStore의 전역 스케일을 공유하므로 어디서 조절해도 모든 에디터에 함께 적용됨.
 */

import type { CSSProperties } from "react";
import { useEditorPrefsStore } from "@/store/editorPrefsStore";

export function FontScaleControl() {
  const fontScale = useEditorPrefsStore((s) => s.fontScale);
  const increase  = useEditorPrefsStore((s) => s.increaseFontScale);
  const decrease  = useEditorPrefsStore((s) => s.decreaseFontScale);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }} title="글자 크기">
      <button
        type="button"
        onClick={decrease}
        title="글자 크기 축소"
        style={btnStyle}
      >
        가-
      </button>
      <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", minWidth: 30, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
        {Math.round(fontScale * 100)}%
      </span>
      <button
        type="button"
        onClick={increase}
        title="글자 크기 확대"
        style={btnStyle}
      >
        가+
      </button>
    </div>
  );
}

const btnStyle: CSSProperties = {
  padding:      "2px 7px",
  borderRadius: 4,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-muted)",
  color:        "var(--color-text-secondary)",
  fontSize:     11,
  fontWeight:   500,
  cursor:       "pointer",
  whiteSpace:   "nowrap",
};
