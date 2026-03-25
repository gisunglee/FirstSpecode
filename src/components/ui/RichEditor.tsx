"use client";

/**
 * RichEditor — TipTap 기반 WYSIWYG 웹에디터
 *
 * 역할:
 *   - 볼드·이탤릭·밑줄·헤딩·목록·코드블록·표·인용 등 서식 지원
 *   - 클립보드 이미지 붙여넣기 → Canvas 리사이즈(max 800px, JPEG 82%) → base64 저장
 *   - 이미지 선택 시 우하단 핸들로 크기 조절 (ResizableImage)
 *
 * 이미지 저장 방식:
 *   base64 data URI → DB TEXT 컬럼 저장 (추후 Supabase Storage URL로 교체 가능)
 *
 * docx 변환 호환성:
 *   TipTap 표준 시맨틱 HTML 출력 → html-docx-js 등으로 Word 변환 시 표·이미지 정상 변환
 */

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import Placeholder from "@tiptap/extension-placeholder";
import { ResizableImage } from "./ResizableImage";
import { useEffect, useCallback, useRef } from "react";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type Props = {
  value:        string;
  onChange:     (html: string) => void;
  placeholder?: string;
  minHeight?:   number;
  readOnly?:    boolean;
};

// ── 이미지 리사이즈 유틸 ───────────────────────────────────────────────────────
// Canvas로 max 800px 리사이즈 + JPEG 82% 압축 → base64 반환
// 원본이 800px 이하면 그대로 사용

function resizeImageToBase64(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      if (!src) return;

      const img = new window.Image();
      img.onload = () => {
        const MAX_W = 800;
        const ratio  = Math.min(1, MAX_W / img.width);
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round(img.width  * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

// ── 에디터 컴포넌트 ──────────────────────────────────────────────────────────

export default function RichEditor({
  value,
  onChange,
  placeholder = "내용을 입력하세요...",
  minHeight = 240,
  readOnly = false,
}: Props) {
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);

  const editor = useEditor({
    immediatelyRender: false,  // Next.js SSR hydration 불일치 방지
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        heading:   { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: "sp-codeblock" } },
      }),
      Underline,
      ResizableImage,           // @tiptap/extension-image 대체 (리사이즈 가능)
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder }),
    ],

    content: value || "",

    onUpdate: ({ editor: ed }) => {
      const html = ed.isEmpty ? "" : ed.getHTML();
      onChange(html);
    },

    // ── 클립보드 이미지 붙여넣기 ──────────────────────────────────────────
    // editorProps.handlePaste: TipTap이 re-render 시마다 options를 업데이트하므로
    // 이 클로저 안의 editor는 실제 호출 시점에 유효한 인스턴스를 참조함
    editorProps: {
      handlePaste(_view, event) {
        const items = event.clipboardData?.items;
        if (!items) return false;

        for (const item of Array.from(items)) {
          if (!item.type.startsWith("image/")) continue;

          event.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;

          // Canvas 리사이즈 후 에디터에 삽입
          resizeImageToBase64(file).then((resized) => {
            editorRef.current?.chain().focus().setImage({ src: resized }).run();
          });

          return true; // 기본 붙여넣기 중단
        }

        return false;
      },
    },
  });

  // editorRef 동기화 (handlePaste 클로저에서 사용)
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // ── 외부 value → 에디터 동기화 ───────────────────────────────────────────
  // API 로드 후 value가 바뀔 때 반영. 포커스 중이면 건너뜀(입력 중 덮어쓰기 방지)
  // setTimeout(0): setContent가 React 렌더링 사이클 내부에서 flushSync를 호출하는
  // 문제를 피하기 위해 다음 틱으로 지연
  useEffect(() => {
    if (!editor) return;
    if (editor.isFocused) return;
    const current = editor.isEmpty ? "" : editor.getHTML();
    if (value !== current) {
      const id = setTimeout(() => {
        editor.commands.setContent(value || "");
      }, 0);
      return () => clearTimeout(id);
    }
  }, [editor, value]);

  // ── 표 삽입 ────────────────────────────────────────────────────────────
  const insertTable = useCallback(() => {
    editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }, [editor]);

  if (!editor) return null;

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, background: "var(--color-bg-card)", overflow: "hidden" }}>

      {/* ── 툴바 ───────────────────────────────────────────────────────── */}
      {!readOnly && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 2, padding: "6px 8px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)" }}>

          <ToolBtn active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="제목 1">H1</ToolBtn>
          <ToolBtn active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="제목 2">H2</ToolBtn>
          <ToolBtn active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="제목 3">H3</ToolBtn>

          <Divider />

          <ToolBtn active={editor.isActive("bold")}      onClick={() => editor.chain().focus().toggleBold().run()}      title="굵게 (Ctrl+B)"><b>B</b></ToolBtn>
          <ToolBtn active={editor.isActive("italic")}    onClick={() => editor.chain().focus().toggleItalic().run()}    title="기울임 (Ctrl+I)"><i>I</i></ToolBtn>
          <ToolBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="밑줄 (Ctrl+U)"><u>U</u></ToolBtn>
          <ToolBtn active={editor.isActive("code")}      onClick={() => editor.chain().focus().toggleCode().run()}      title="인라인 코드">`c`</ToolBtn>

          <Divider />

          <ToolBtn active={editor.isActive("bulletList")}  onClick={() => editor.chain().focus().toggleBulletList().run()}  title="글머리 목록">• 목록</ToolBtn>
          <ToolBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="번호 목록">1. 목록</ToolBtn>

          <Divider />

          <ToolBtn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="인용">❝</ToolBtn>
          <ToolBtn active={editor.isActive("codeBlock")}  onClick={() => editor.chain().focus().toggleCodeBlock().run()}  title="코드 블록">{"```"}</ToolBtn>

          <Divider />

          <ToolBtn active={false} onClick={insertTable} title="표 삽입 (3×3)">표</ToolBtn>

          {editor.isActive("table") && (
            <>
              <ToolBtn active={false} onClick={() => editor.chain().focus().addColumnAfter().run()} title="열 추가">+열</ToolBtn>
              <ToolBtn active={false} onClick={() => editor.chain().focus().addRowAfter().run()}    title="행 추가">+행</ToolBtn>
              <ToolBtn active={false} onClick={() => editor.chain().focus().deleteColumn().run()}   title="열 삭제">-열</ToolBtn>
              <ToolBtn active={false} onClick={() => editor.chain().focus().deleteRow().run()}      title="행 삭제">-행</ToolBtn>
              <ToolBtn active={false} onClick={() => editor.chain().focus().deleteTable().run()}    title="표 삭제" danger>표삭제</ToolBtn>
            </>
          )}

          <Divider />

          <ToolBtn active={false} onClick={() => editor.chain().focus().undo().run()} title="실행 취소 (Ctrl+Z)">↩</ToolBtn>
          <ToolBtn active={false} onClick={() => editor.chain().focus().redo().run()} title="다시 실행 (Ctrl+Y)">↪</ToolBtn>
        </div>
      )}

      {/* ── 에디터 본문 ─────────────────────────────────────────────────── */}
      <div
        style={{ minHeight, cursor: readOnly ? "default" : "text" }}
        onClick={() => !readOnly && editor.chain().focus().run()}
      >
        <EditorContent editor={editor} className="sp-rich-editor" />
      </div>
    </div>
  );
}

// ── 툴바 버튼 ────────────────────────────────────────────────────────────────

function ToolBtn({ children, active, onClick, title, danger }: {
  children: React.ReactNode;
  active:   boolean;
  onClick:  () => void;
  title?:   string;
  danger?:  boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      style={{
        padding:      "3px 7px",
        borderRadius: 4,
        border:       active ? "1px solid var(--color-brand)" : "1px solid transparent",
        background:   active ? "color-mix(in srgb, var(--color-brand) 12%, transparent)" : "transparent",
        color:        danger ? "#e53935" : active ? "var(--color-brand)" : "var(--color-text-secondary)",
        fontSize:     12,
        fontWeight:   active ? 600 : 400,
        cursor:       "pointer",
        whiteSpace:   "nowrap",
        lineHeight:   "1.5",
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span style={{ width: 1, background: "var(--color-border)", margin: "2px 4px", alignSelf: "stretch" }} />;
}
