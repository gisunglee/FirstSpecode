"use client";

/** Extensible right-side inspector shell. Initial modules use the loaded hierarchy only. */

import type { StudioBlock } from "./types";

type Props = {
  blocks: StudioBlock[];
  collapsed: boolean;
  selectedBlock: StudioBlock | null;
  onToggleCollapsed: () => void;
};

const RELATED_MODULES = ["코드", "기준정보", "DB", "API", "테스트케이스", "메모"];

export default function StudioInspector({
  blocks,
  collapsed,
  selectedBlock,
  onToggleCollapsed,
}: Props) {
  const requirement = blocks.find((block) => block.kind === "requirement");

  return (
    <aside className={`sp-studio-inspector${collapsed ? " is-collapsed" : ""}`}>
      <button
        type="button"
        className="sp-studio-panel-toggle is-left"
        onClick={onToggleCollapsed}
        title={collapsed ? "관련 정보 펼치기" : "관련 정보 접기"}
        aria-label={collapsed ? "관련 정보 펼치기" : "관련 정보 접기"}
      >
        {collapsed ? "‹" : "›"}
      </button>

      {!collapsed && (
        <>
          <div className="sp-studio-panel-heading">관련 정보</div>
          <div className="sp-studio-inspector-context">
            <span>현재 문서</span>
            <strong>{selectedBlock ? `${selectedBlock.displayId} ${selectedBlock.name}` : "선택 없음"}</strong>
          </div>

          <div className="sp-studio-related-list">
            <details className="sp-studio-related" open>
              <summary>요구사항 <span>{requirement ? 1 : 0}</span></summary>
              {requirement ? (
                <button type="button" className="sp-studio-related-item">
                  <span>{requirement.displayId}</span>
                  <strong>{requirement.name}</strong>
                </button>
              ) : (
                <p>연결된 요구사항이 없습니다.</p>
              )}
            </details>

            {RELATED_MODULES.map((label) => (
              <details className="sp-studio-related" key={label}>
                <summary>{label} <span>0</span></summary>
                <p>관련 정보 연결 기능을 추가할 수 있습니다.</p>
              </details>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

