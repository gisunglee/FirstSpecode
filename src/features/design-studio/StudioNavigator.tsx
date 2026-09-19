"use client";

/** Wiki-like studio navigation: flat labels, minimal indentation, no folder tree. */

import { useEffect, useRef } from "react";
import type { StudioBlock, UnitWorkSummary } from "./types";

const SHORT_KIND_CODE: Record<StudioBlock["kind"], string> = {
  requirement: "R",
  analysis: "A",
  unitWork: "U",
  screen: "S",
  area: "A",
  function: "F",
};

function compactDisplayId(block: StudioBlock): string {
  const numericSuffix = block.displayId.match(/(\d+)$/)?.[1];
  if (!numericSuffix) return block.displayId;
  return `${SHORT_KIND_CODE[block.kind]}-${Number.parseInt(numericSuffix, 10)}`;
}

type Props = {
  blocks: StudioBlock[];
  collapsed: boolean;
  query: string;
  selectedKey: string | null;
  selectedUnitWorkId: string;
  unitWorks: UnitWorkSummary[];
  onChangeQuery: (query: string) => void;
  onSelectBlock: (block: StudioBlock) => void;
  onSelectUnitWork: (unitWorkId: string) => void;
  onToggleCollapsed: () => void;
};

export default function StudioNavigator({
  blocks,
  collapsed,
  query,
  selectedKey,
  selectedUnitWorkId,
  unitWorks,
  onChangeQuery,
  onSelectBlock,
  onSelectUnitWork,
  onToggleCollapsed,
}: Props) {
  const selectedItemRef = useRef<HTMLButtonElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleBlocks = normalizedQuery
    ? blocks.filter((block) =>
        `${block.displayId} ${block.name}`.toLocaleLowerCase().includes(normalizedQuery),
      )
    : blocks;

  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  return (
    <aside className={`sp-studio-nav${collapsed ? " is-collapsed" : ""}`}>
      <button
        type="button"
        className="sp-studio-panel-toggle"
        onClick={onToggleCollapsed}
        title={collapsed ? "설계 문서 펼치기" : "설계 문서 접기"}
        aria-label={collapsed ? "설계 문서 펼치기" : "설계 문서 접기"}
      >
        {collapsed ? "›" : "‹"}
      </button>

      {!collapsed && (
        <>
          <div className="sp-studio-panel-heading">설계 문서</div>
          <div className="sp-studio-nav-controls">
            <select
              className="sp-input sp-select"
              aria-label="단위업무 선택"
              value={selectedUnitWorkId}
              onChange={(event) => onSelectUnitWork(event.target.value)}
            >
              {unitWorks.map((unitWork) => (
                <option key={unitWork.unitWorkId} value={unitWork.unitWorkId}>
                  {unitWork.displayId} {unitWork.name}
                </option>
              ))}
            </select>
            <div className="sp-input-wrap">
              <span className="sp-input-icon" aria-hidden="true">⌕</span>
              <input
                className="sp-input"
                placeholder="문서 검색"
                value={query}
                onChange={(event) => onChangeQuery(event.target.value)}
              />
            </div>
          </div>

          <nav className="sp-studio-wiki-list" aria-label="설계 문서 목차">
            {visibleBlocks.map((block) => (
              <button
                type="button"
                key={block.key}
                ref={selectedKey === block.key ? selectedItemRef : undefined}
                className={`sp-studio-wiki-item${selectedKey === block.key ? " is-active" : ""}`}
                data-depth={Math.min(block.depth, 3)}
                data-kind={block.kind}
                title={`${block.displayId} ${block.name}`}
                onClick={() => onSelectBlock(block)}
              >
                <span className="sp-studio-wiki-copy">
                  <span>{compactDisplayId(block)}</span>
                  <strong>{block.name}</strong>
                </span>
              </button>
            ))}
            {visibleBlocks.length === 0 && (
              <div className="sp-studio-nav-empty">일치하는 문서가 없습니다.</div>
            )}
          </nav>
        </>
      )}
    </aside>
  );
}
