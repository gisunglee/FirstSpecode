"use client";

/** One source document rendered inside the studio's continuous document surface. */

import Link from "next/link";
import { useMemo } from "react";
import MarkdownEditor from "@/components/ui/MarkdownEditor";
import RichEditor from "@/components/ui/RichEditor";
import { renderMarkdown, sanitizeHtml } from "@/lib/renderMarkdown";
import {
  STUDIO_KIND_CODE,
  STUDIO_KIND_LABEL,
  type StudioBlock,
  type StudioDraft,
} from "./types";

type Props = {
  block: StudioBlock;
  draft: StudioDraft | null;
  isEditing: boolean;
  isOpen: boolean;
  isSaving: boolean;
  isSelected: boolean;
  onCancelEdit: () => void;
  onChangeDraft: (draft: StudioDraft) => void;
  onEdit: () => void;
  onSave: () => void;
  onSelect: () => void;
  onToggle: () => void;
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`sp-studio-chevron${open ? " is-open" : ""}`}
      viewBox="0 0 16 16"
    >
      <path d="m5 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function EmptyDocument() {
  return <p className="sp-studio-empty-copy">작성된 내용이 없습니다. 편집을 눌러 내용을 추가하세요.</p>;
}

export default function DocumentSection({
  block,
  draft,
  isEditing,
  isOpen,
  isSaving,
  isSelected,
  onCancelEdit,
  onChangeDraft,
  onEdit,
  onSave,
  onSelect,
  onToggle,
}: Props) {
  const renderedPrimary = useMemo(
    () => block.format === "html"
      ? sanitizeHtml(block.description)
      : renderMarkdown(block.description),
    [block.description, block.format],
  );
  const renderedSecondary = useMemo(
    () => renderMarkdown(block.secondaryDescription),
    [block.secondaryDescription],
  );

  return (
    <section
      id={`studio-${block.key.replace(":", "-")}`}
      className={`sp-studio-section${isSelected ? " is-selected" : ""}${isEditing ? " is-editing" : ""}`}
      data-studio-block-key={block.key}
      onClick={onSelect}
    >
      <header className="sp-studio-section-header">
        <button
          type="button"
          className="sp-studio-section-toggle"
          aria-expanded={isOpen}
          aria-label={`${block.displayId} ${isOpen ? "접기" : "펼치기"}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          <Chevron open={isOpen} />
          <span className="sp-studio-kind">{STUDIO_KIND_CODE[block.kind]}</span>
          <span className="sp-studio-section-id">{block.displayId}</span>
          <span className="sp-studio-section-name">{block.name}</span>
        </button>

        <div className="sp-studio-section-actions">
          <span className="sp-studio-section-type">{STUDIO_KIND_LABEL[block.kind]}</span>
          <Link
            className="sp-btn sp-btn-ghost sp-btn-xs"
            href={block.sourceHref}
            onClick={(event) => event.stopPropagation()}
          >
            원본 열기
          </Link>
          {!isEditing && (
            <button
              type="button"
              className="sp-btn sp-btn-secondary sp-btn-xs"
              onClick={(event) => {
                event.stopPropagation();
                onEdit();
              }}
            >
              편집
            </button>
          )}
        </div>
      </header>

      {isOpen && (
        <div className="sp-studio-section-body">
          {isEditing && draft ? (
            <div className="sp-studio-editor" onClick={(event) => event.stopPropagation()}>
              {block.kind !== "analysis" && (
                <label className="sp-field">
                  <span className="sp-label">제목</span>
                  <input
                    className="sp-input"
                    value={draft.name}
                    onChange={(event) => onChangeDraft({ ...draft, name: event.target.value })}
                  />
                </label>
              )}

              {block.kind === "requirement" ? (
                <div className="sp-field">
                  <div className="sp-label">요구사항 내용</div>
                  <RichEditor
                    value={draft.description}
                    onChange={(description) => onChangeDraft({ ...draft, description })}
                    minHeight={180}
                    field="htmlContent"
                  />
                </div>
              ) : (
                <div className="sp-field">
                  <div className="sp-label">
                    {block.kind === "analysis" ? "분석 메모" : "내용"}
                  </div>
                  <MarkdownEditor
                    value={draft.description}
                    onChange={(description) => onChangeDraft({ ...draft, description })}
                    rows={20}
                    field="description"
                    title={`${block.displayId} ${block.name}`}
                  />
                </div>
              )}

              {block.kind === "analysis" && (
                <div className="sp-field">
                  <div className="sp-label">상세 명세</div>
                  <MarkdownEditor
                    value={draft.secondaryDescription}
                    onChange={(secondaryDescription) => onChangeDraft({ ...draft, secondaryDescription })}
                    rows={24}
                    field="detailSpec"
                    title="상세 명세"
                  />
                </div>
              )}

              <div className="sp-btn-row sp-studio-editor-actions">
                <button
                  type="button"
                  className="sp-btn sp-btn-primary"
                  disabled={isSaving || (block.kind !== "analysis" && !draft.name.trim())}
                  onClick={onSave}
                >
                  {isSaving ? "저장 중..." : "저장"}
                </button>
                <button
                  type="button"
                  className="sp-btn sp-btn-secondary"
                  disabled={isSaving}
                  onClick={onCancelEdit}
                >
                  취소
                </button>
                <span className="sp-studio-save-note">이 블록의 원본 문서만 저장됩니다.</span>
              </div>
            </div>
          ) : (
            <>
              {renderedPrimary ? (
                <div className="sp-markdown sp-studio-markdown" dangerouslySetInnerHTML={{ __html: renderedPrimary }} />
              ) : (
                <EmptyDocument />
              )}
              {block.kind === "analysis" && (
                <div className="sp-studio-analysis-detail">
                  <div className="sp-section-title">상세 명세</div>
                  {renderedSecondary ? (
                    <div className="sp-markdown sp-studio-markdown" dangerouslySetInnerHTML={{ __html: renderedSecondary }} />
                  ) : (
                    <EmptyDocument />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
