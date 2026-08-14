/**
 * editorPrefsStore — 에디터(요구사항내용/상세명세/분석메모) 공통 폰트 크기 설정 (Zustand + localStorage)
 *
 * 에디터마다 폰트 크기를 따로 기억하면 "왜 여긴 크고 저긴 작지" 혼란을 주므로
 * 전역 스케일 하나로 통일해 RichEditor·MarkdownEditor가 함께 참조한다.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

const FONT_SCALE_MIN = 0.8;
const FONT_SCALE_MAX = 1.6;
const FONT_SCALE_STEP = 0.1;

function clamp(v: number) {
  // 부동소수 오차 누적 방지(0.1씩 더할 때 0.30000000000000004 같은 값 방지)
  const rounded = Math.round(v * 100) / 100;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, rounded));
}

type EditorPrefsState = {
  fontScale: number;
};

type EditorPrefsActions = {
  increaseFontScale: () => void;
  decreaseFontScale: () => void;
};

export const useEditorPrefsStore = create<EditorPrefsState & EditorPrefsActions>()(
  persist(
    (set) => ({
      fontScale: 1,
      increaseFontScale: () => set((s) => ({ fontScale: clamp(s.fontScale + FONT_SCALE_STEP) })),
      decreaseFontScale: () => set((s) => ({ fontScale: clamp(s.fontScale - FONT_SCALE_STEP) })),
    }),
    { name: "specode-editor-prefs" }
  )
);
