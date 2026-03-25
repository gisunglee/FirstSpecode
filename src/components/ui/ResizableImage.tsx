"use client";

/**
 * ResizableImage — TipTap 커스텀 이미지 노드
 *
 * 역할:
 *   - @tiptap/extension-image 대체 (기본 이미지는 리사이즈 불가)
 *   - 이미지 선택 시 우하단 드래그 핸들 → 너비 조절
 *   - setImage 커맨드로 base64/URL 이미지 삽입
 */

import { Node, mergeAttributes, type CommandProps } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { useRef, useState, useCallback } from "react";
import type { NodeViewRendererProps } from "@tiptap/core";

// setImage 커맨드 타입 등록 (ChainedCommands에서 인식되도록)
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    image: {
      setImage: (attrs: Record<string, unknown>) => ReturnType;
    };
  }
}

// NodeViewRendererProps에 updateAttributes/selected 포함한 확장 타입
type ImageNodeViewProps = NodeViewRendererProps & {
  selected:         boolean;
  updateAttributes: (attrs: Record<string, unknown>) => void;
};

// ── 이미지 뷰 컴포넌트 ────────────────────────────────────────────────────────

function ResizableImageView({
  node,
  updateAttributes,
  selected,
}: ImageNodeViewProps) {
  const imgRef    = useRef<HTMLImageElement>(null);
  const startXRef = useRef(0);
  const startWRef = useRef(0);
  const [resizing, setResizing] = useState(false);

  const onHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startXRef.current = e.clientX;
      startWRef.current =
        imgRef.current?.offsetWidth ?? (node.attrs.width as number) ?? 400;
      setResizing(true);

      const onMove = (ev: MouseEvent) => {
        const newW = Math.max(60, startWRef.current + (ev.clientX - startXRef.current));
        updateAttributes({ width: Math.round(newW) });
      };
      const onUp = () => {
        setResizing(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [node.attrs.width, updateAttributes]
  );

  return (
    <NodeViewWrapper as="span" style={{ display: "inline-block", position: "relative", lineHeight: 0 }}>
      <img
        ref={imgRef}
        src={node.attrs.src as string}
        alt={(node.attrs.alt as string) ?? ""}
        width={(node.attrs.width as number) ?? undefined}
        style={{
          display:      "block",
          maxWidth:     "100%",
          cursor:       resizing ? "ew-resize" : "default",
          outline:      selected ? "2px solid var(--color-brand, #1976d2)" : "none",
          outlineOffset: "1px",
          borderRadius: "var(--radius-md, 6px)",
          margin:       "4px 0",
        }}
        draggable={false}
      />
      {/* 리사이즈 핸들 — 선택 시만 표시 */}
      {selected && (
        <span
          onMouseDown={onHandleMouseDown}
          style={{
            position:     "absolute",
            bottom:       2,
            right:        2,
            width:        10,
            height:       10,
            background:   "#fff",
            border:       "2px solid var(--color-brand, #1976d2)",
            borderRadius: 2,
            cursor:       "se-resize",
            display:      "block",
          }}
        />
      )}
    </NodeViewWrapper>
  );
}

// ── TipTap 커스텀 노드 정의 ───────────────────────────────────────────────────

export const ResizableImage = Node.create({
  name:      "image",
  inline:    true,
  group:     "inline",
  draggable: true,
  atom:      true,

  addAttributes() {
    return {
      src:   { default: null },
      alt:   { default: null },
      title: { default: null },
      width: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "img[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes)];
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addCommands(): any {
    return {
      setImage:
        (attrs: Record<string, unknown>) =>
        ({ commands }: CommandProps) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView as never);
  },
});
