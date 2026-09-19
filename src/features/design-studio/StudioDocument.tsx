"use client";

/** Continuous document canvas and its global/type-specific disclosure controls. */

import { useEffect, useRef } from "react";
import DocumentSection from "./DocumentSection";
import {
  STUDIO_KINDS,
  STUDIO_KIND_LABEL,
  type StudioBlock,
  type StudioDraft,
  type StudioKind,
} from "./types";

type Props = {
  blocks: StudioBlock[];
  draft: StudioDraft | null;
  editingKey: string | null;
  openKeys: Set<string>;
  saving: boolean;
  selectedKey: string | null;
  onCancelEdit: () => void;
  onChangeDraft: (draft: StudioDraft) => void;
  onCollapseAll: () => void;
  onEdit: (block: StudioBlock) => void;
  onExpandAll: () => void;
  onSave: () => void;
  onSelect: (block: StudioBlock) => void;
  onToggleBlock: (block: StudioBlock) => void;
  onToggleKind: (kind: StudioKind) => void;
  onVisibleBlockChange: (blockKey: string) => void;
};

function kindState(blocks: StudioBlock[], openKeys: Set<string>, kind: StudioKind) {
  const kindBlocks = blocks.filter((block) => block.kind === kind);
  const openCount = kindBlocks.filter((block) => openKeys.has(block.key)).length;
  return {
    count: kindBlocks.length,
    state: openCount === 0 ? "closed" : openCount === kindBlocks.length ? "open" : "mixed",
  } as const;
}

export default function StudioDocument({
  blocks,
  draft,
  editingKey,
  openKeys,
  saving,
  selectedKey,
  onCancelEdit,
  onChangeDraft,
  onCollapseAll,
  onEdit,
  onExpandAll,
  onSave,
  onSelect,
  onToggleBlock,
  onToggleKind,
  onVisibleBlockChange,
}: Props) {
  const paneRef = useRef<HTMLElement>(null);
  const scrollFrameRef = useRef<number | null>(null);

  function syncVisibleBlock() {
    const pane = paneRef.current;
    if (!pane) return;

    const sections = Array.from(
      pane.querySelectorAll<HTMLElement>("[data-studio-block-key]"),
    );
    if (sections.length === 0) return;

    const isAtBottom = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2;
    let currentSection = sections[0];

    if (isAtBottom) {
      currentSection = sections[sections.length - 1];
    } else {
      const toolbar = pane.querySelector<HTMLElement>(".sp-studio-disclosure-bar");
      const sectionHeader = sections[0].querySelector<HTMLElement>(".sp-studio-section-header");
      const anchorTop = pane.getBoundingClientRect().top
        + (toolbar?.offsetHeight ?? 0)
        + (sectionHeader?.offsetHeight ?? 0);
      for (const section of sections) {
        if (section.getBoundingClientRect().top > anchorTop) break;
        currentSection = section;
      }
    }

    const blockKey = currentSection.dataset.studioBlockKey;
    if (blockKey) onVisibleBlockChange(blockKey);
  }

  function handleScroll() {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      syncVisibleBlock();
    });
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(syncVisibleBlock);
    return () => window.cancelAnimationFrame(frame);
  }, [blocks, openKeys]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  return (
    <main ref={paneRef} className="sp-studio-document-pane" onScroll={handleScroll}>
      <div className="sp-studio-disclosure-bar">
        <div className="sp-studio-disclosure-global">
          <button type="button" className="sp-btn sp-btn-secondary sp-btn-xs" onClick={onExpandAll}>
            전체 펼치기
          </button>
          <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={onCollapseAll}>
            전체 접기
          </button>
        </div>

        <div className="sp-studio-kind-controls" aria-label="문서 종류별 펼치기와 접기">
          {STUDIO_KINDS.map((kind) => {
            const { count, state } = kindState(blocks, openKeys, kind);
            if (count === 0) return null;
            const willOpen = state !== "open";
            return (
              <button
                type="button"
                key={kind}
                className={`sp-studio-kind-control is-${state}`}
                aria-label={`${STUDIO_KIND_LABEL[kind]} ${count}개 모두 ${willOpen ? "펼치기" : "접기"}`}
                title={`${STUDIO_KIND_LABEL[kind]} 모두 ${willOpen ? "펼치기" : "접기"}`}
                onClick={() => onToggleKind(kind)}
              >
                <span>{STUDIO_KIND_LABEL[kind]}</span>
                <strong>{count}</strong>
                <span aria-hidden="true">{state === "open" ? "⌃" : state === "closed" ? "⌄" : "−"}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="sp-studio-document" aria-label="통합 설계 문서">
        {blocks.map((block) => (
          <DocumentSection
            key={block.key}
            block={block}
            draft={editingKey === block.key ? draft : null}
            isEditing={editingKey === block.key}
            isOpen={openKeys.has(block.key)}
            isSaving={saving}
            isSelected={selectedKey === block.key}
            onCancelEdit={onCancelEdit}
            onChangeDraft={onChangeDraft}
            onEdit={() => onEdit(block)}
            onSave={onSave}
            onSelect={() => onSelect(block)}
            onToggle={() => onToggleBlock(block)}
          />
        ))}
      </div>
    </main>
  );
}
