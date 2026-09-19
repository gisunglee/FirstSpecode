"use client";

/** Extensible right-side inspector shell. Initial modules use the loaded hierarchy only. */

import { useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import MemoEntryButton from "@/components/common/MemoEntryButton";
import { fetchRelatedCodes } from "./api";
import PanelToggleIcon from "./PanelToggleIcon";
import StudioRelatedCodes from "./StudioRelatedCodes";
import StudioRelatedDb from "./StudioRelatedDb";
import type { StudioBlock } from "./types";

const RELATED_INFO_AUTO_LOAD_DELAY_MS = 10_000;

type Props = {
  blocks: StudioBlock[];
  collapsed: boolean;
  projectId: string;
  selectedBlock: StudioBlock | null;
  unitWorkId: string;
  onToggleCollapsed: () => void;
};

const RELATED_MODULES = ["기준정보", "테스트케이스"];
const MEMO_REF_TYPE_BY_KIND: Record<StudioBlock["kind"], string> = {
  requirement: "REQUIREMENT",
  analysis: "REQUIREMENT",
  unitWork: "UNIT_WORK",
  screen: "SCREEN",
  area: "AREA",
  function: "FUNCTION",
};

export default function StudioInspector({
  blocks,
  collapsed,
  projectId,
  selectedBlock,
  unitWorkId,
  onToggleCollapsed,
}: Props) {
  const requirement = blocks.find((block) => block.kind === "requirement");
  const memoRefType = selectedBlock ? MEMO_REF_TYPE_BY_KIND[selectedBlock.kind] : undefined;
  // Future DB/API/test queries should join this top-level loader so one user action
  // prepares every related-information module for the current unit work.
  const relatedCodesQuery = useQuery({
    queryKey: ["design-studio", projectId, "related-codes", unitWorkId],
    queryFn: () => fetchRelatedCodes(projectId, unitWorkId),
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const loadRelatedInfo = useCallback(async () => {
    // Add future related-information queries to this Promise.all batch.
    await Promise.all([relatedCodesQuery.refetch()]);
  }, [relatedCodesQuery.refetch]);

  useEffect(() => {
    if (!unitWorkId || relatedCodesQuery.data || relatedCodesQuery.isFetching || relatedCodesQuery.isError) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadRelatedInfo();
    }, RELATED_INFO_AUTO_LOAD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    loadRelatedInfo,
    relatedCodesQuery.data,
    relatedCodesQuery.isError,
    relatedCodesQuery.isFetching,
    unitWorkId,
  ]);

  return (
    <aside className={`sp-studio-inspector${collapsed ? " is-collapsed" : ""}`}>
      <button
        type="button"
        className="sp-studio-panel-toggle is-left"
        onClick={onToggleCollapsed}
        title={collapsed ? "관련 정보 펼치기" : "관련 정보 접기"}
        aria-label={collapsed ? "관련 정보 펼치기" : "관련 정보 접기"}
      >
        <PanelToggleIcon direction={collapsed ? "left" : "right"} />
      </button>

      <div className="sp-studio-inspector-inner" hidden={collapsed}>
          <div className="sp-studio-panel-heading">관련 정보</div>
          <div className="sp-studio-inspector-context">
            <div className="sp-studio-inspector-context-copy">
              <span>현재 문서</span>
              <strong>{selectedBlock ? `${selectedBlock.displayId} ${selectedBlock.name}` : "선택 없음"}</strong>
            </div>
            {selectedBlock && memoRefType && (
              <MemoEntryButton
                projectId={projectId}
                refTyCode={memoRefType}
                refId={selectedBlock.entityId}
                refLabel={selectedBlock.name}
              />
            )}
          </div>

          <div className="sp-studio-related-loader">
            <div>
              <strong>
                {relatedCodesQuery.data
                  ? "관련 정보 불러옴"
                  : relatedCodesQuery.isError
                    ? "관련 정보 조회 실패"
                    : "관련 정보 준비"}
              </strong>
              <span>
                {relatedCodesQuery.data
                  ? "현재 단위업무 데이터가 캐시되어 있습니다."
                  : relatedCodesQuery.isError
                    ? relatedCodesQuery.error instanceof Error
                      ? relatedCodesQuery.error.message
                      : "관련 정보를 조회하지 못했습니다."
                    : "클릭하지 않으면 10초 후 자동으로 불러옵니다."}
              </span>
            </div>
            <button
              type="button"
              className={`sp-btn ${relatedCodesQuery.data ? "sp-btn-ghost" : "sp-btn-primary"} sp-btn-sm`}
              disabled={relatedCodesQuery.isFetching}
              onClick={() => void loadRelatedInfo()}
            >
              {relatedCodesQuery.isFetching
                ? "불러오는 중..."
                : relatedCodesQuery.data
                  ? "새로고침"
                  : relatedCodesQuery.isError
                    ? "다시 불러오기"
                    : "관련 정보 불러오기"}
            </button>
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

            <StudioRelatedCodes
              blocks={blocks}
              data={relatedCodesQuery.data}
              isFetching={relatedCodesQuery.isFetching}
              selectedBlock={selectedBlock}
            />

            <StudioRelatedDb
              blocks={blocks}
              data={relatedCodesQuery.data}
              selectedBlock={selectedBlock}
            />

            {RELATED_MODULES.map((label) => (
              <details className="sp-studio-related" key={label}>
                <summary>{label} <span>0</span></summary>
                <p>관련 정보 연결 기능을 추가할 수 있습니다.</p>
              </details>
            ))}
          </div>
      </div>
    </aside>
  );
}
