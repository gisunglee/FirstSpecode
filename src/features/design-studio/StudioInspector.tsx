"use client";

/**
 * Extensible right-side inspector shell.
 * 모듈: 요구사항 · 공통코드 · DB · 테스트케이스. 기준정보(tb_cm_standard_info)는 프로젝트에만 속하고
 * 설계 계층·컬럼 매핑과 연결 컬럼이 없어 넣지 않는다 — 연결 모델이 생기면 그때 추가 (2026-09-22).
 */

import { useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import MemoEntryButton from "@/components/common/MemoEntryButton";
import { fetchRelatedCodes, fetchRelatedTestSpecs } from "./api";
import PanelToggleIcon from "./PanelToggleIcon";
import StudioRelatedCodes from "./StudioRelatedCodes";
import StudioRelatedDb from "./StudioRelatedDb";
import StudioRelatedTests from "./StudioRelatedTests";
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
  // 관련 정보 조회는 전부 이 로더 하나에 합류한다 — 사용자 동작 한 번(또는 10초 자동)으로 현재 단위업무의
  // 모듈 전체를 채우고, 이후 스크롤은 캐시만 읽는다. 새 모듈은 useQuery 하나 + Promise.all 한 줄 추가.
  const relatedCodesQuery = useQuery({
    queryKey: ["design-studio", projectId, "related-codes", unitWorkId],
    queryFn: () => fetchRelatedCodes(projectId, unitWorkId),
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const relatedTestsQuery = useQuery({
    queryKey: ["design-studio", projectId, "related-test-specs", unitWorkId],
    queryFn: () => fetchRelatedTestSpecs(projectId, unitWorkId),
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // 로더 상태 표시는 모듈 전체를 하나로 본다 — 하나라도 실패면 실패, 전부 있으면 불러옴
  const relatedLoaded   = !!relatedCodesQuery.data && !!relatedTestsQuery.data;
  const relatedFetching = relatedCodesQuery.isFetching || relatedTestsQuery.isFetching;
  const relatedError    = relatedCodesQuery.error ?? relatedTestsQuery.error ?? null;

  const loadRelatedInfo = useCallback(async () => {
    await Promise.all([relatedCodesQuery.refetch(), relatedTestsQuery.refetch()]);
  }, [relatedCodesQuery.refetch, relatedTestsQuery.refetch]);

  useEffect(() => {
    if (!unitWorkId || relatedLoaded || relatedFetching || relatedError) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadRelatedInfo();
    }, RELATED_INFO_AUTO_LOAD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [loadRelatedInfo, relatedLoaded, relatedFetching, relatedError, unitWorkId]);

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
                {relatedLoaded
                  ? "관련 정보 불러옴"
                  : relatedError
                    ? "관련 정보 조회 실패"
                    : "관련 정보 준비"}
              </strong>
              <span>
                {relatedLoaded
                  ? "현재 단위업무 데이터가 캐시되어 있습니다."
                  : relatedError
                    ? relatedError instanceof Error
                      ? relatedError.message
                      : "관련 정보를 조회하지 못했습니다."
                    : "클릭하지 않으면 10초 후 자동으로 불러옵니다."}
              </span>
            </div>
            <button
              type="button"
              className={`sp-btn ${relatedLoaded ? "sp-btn-ghost" : "sp-btn-primary"} sp-btn-sm`}
              disabled={relatedFetching}
              onClick={() => void loadRelatedInfo()}
            >
              {relatedFetching
                ? "불러오는 중..."
                : relatedLoaded
                  ? "새로고침"
                  : relatedError
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

            <StudioRelatedTests
              projectId={projectId}
              data={relatedTestsQuery.data}
              selectedBlock={selectedBlock}
            />

          </div>
      </div>
    </aside>
  );
}
