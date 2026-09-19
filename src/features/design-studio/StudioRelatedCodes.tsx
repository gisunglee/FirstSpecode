"use client";

import { useMemo, useState } from "react";
import type {
  RelatedCodeGroup,
  RelatedCodesResponse,
  RelatedFunctionCode,
  StudioBlock,
} from "./types";

type Props = {
  blocks: StudioBlock[];
  data: RelatedCodesResponse | undefined;
  isFetching: boolean;
  selectedBlock: StudioBlock | null;
};

// 공통코드가 수십 건이어도 관련 정보 패널을 과도하게 차지하지 않도록
// 처음에는 대표 코드값만 노출하고 사용자가 필요할 때 전체를 펼친다.
const DEFAULT_VISIBLE_CODE_COUNT = 5;

function scopeRelations(
  functions: RelatedFunctionCode[],
  selectedBlock: StudioBlock | null,
): RelatedFunctionCode[] {
  if (!selectedBlock) return functions;
  if (selectedBlock.kind === "function") {
    return functions.filter((fn) => fn.functionId === selectedBlock.entityId);
  }
  if (selectedBlock.kind === "area") {
    return functions.filter((fn) => fn.areaId === selectedBlock.entityId);
  }
  if (selectedBlock.kind === "screen") {
    return functions.filter((fn) => fn.screenId === selectedBlock.entityId);
  }
  return functions;
}

function scopeFunctionBlocks(
  blocks: StudioBlock[],
  selectedBlock: StudioBlock | null,
): StudioBlock[] {
  const functions = blocks.filter((block) => block.kind === "function");
  if (!selectedBlock) return functions;
  if (selectedBlock.kind === "function") return [selectedBlock];
  if (selectedBlock.kind === "area") {
    return functions.filter((block) => block.parentKey === selectedBlock.key);
  }
  if (selectedBlock.kind === "screen") {
    const areaKeys = new Set(
      blocks
        .filter((block) => block.kind === "area" && block.parentKey === selectedBlock.key)
        .map((block) => block.key),
    );
    return functions.filter((block) => block.parentKey && areaKeys.has(block.parentKey));
  }
  return functions;
}

function contextLabel(selectedBlock: StudioBlock | null) {
  if (!selectedBlock) return "현재 단위업무 전체";
  if (selectedBlock.kind === "function") return "현재 기능";
  if (selectedBlock.kind === "area") return "현재 영역의 기능";
  if (selectedBlock.kind === "screen") return "현재 화면의 기능";
  return "현재 단위업무 전체";
}

function CodeGroupDetail({
  group,
  relation,
}: {
  group: RelatedCodeGroup | undefined;
  relation: RelatedFunctionCode["codeGroups"][number];
}) {
  const [isAllCodesVisible, setIsAllCodesVisible] = useState(false);
  const codes = group?.codes ?? [];
  const hasMoreCodes = codes.length > DEFAULT_VISIBLE_CODE_COUNT;
  const visibleCodes = isAllCodesVisible
    ? codes
    : codes.slice(0, DEFAULT_VISIBLE_CODE_COUNT);
  // 같은 컬럼이 INPUT/OUTPUT 양쪽에 매핑되어도 이용 컬럼 목록에는 한 번만 표시한다.
  const uniqueSources = [...new Map(
    relation.sources.map((source) => [`${source.tableId}:${source.columnId}`, source]),
  ).values()];

  return (
    <section className="sp-studio-code-group">
      <header>
        <div>
          <strong>{group?.groupName || relation.groupCode}</strong>
          <span>{relation.groupCode}</span>
        </div>
        <span className="sp-studio-code-count">{group?.codes.length ?? 0}개</span>
      </header>

      {group?.exists ? (
        <div className="sp-studio-code-values">
          {visibleCodes.map((code) => (
            <div key={code.codeId} className={code.useYn === "Y" ? "" : "is-disabled"}>
              <code>{code.code}</code>
              <span>{code.name}</span>
            </div>
          ))}
          {codes.length === 0 && <p>등록된 코드값이 없습니다.</p>}
          {hasMoreCodes && (
            <button
              className="sp-studio-code-more"
              type="button"
              onClick={() => setIsAllCodesVisible((current) => !current)}
            >
              {isAllCodesVisible
                ? "접기"
                : `${codes.length - DEFAULT_VISIBLE_CODE_COUNT}개 더보기`}
            </button>
          )}
        </div>
      ) : (
        <p className="sp-studio-code-warning">프로젝트에서 코드 그룹을 찾을 수 없습니다.</p>
      )}

      <div className="sp-studio-code-evidence" aria-label={`코드 이용 컬럼 ${uniqueSources.length}개`}>
        <div className="sp-studio-code-sources">
          {uniqueSources.map((source) => (
            <div key={source.mappingId} title={source.purpose || source.mappingGroupName}>
              <span className="sp-studio-code-table-label">
                <i className="sp-studio-code-table-dot" aria-hidden="true" />
                <span>{source.tableLogicalName || source.tableName}</span>
              </span>
              <div className="sp-studio-code-column-path">
                <span>{source.tableName}.</span>
                <strong>{source.columnName}</strong>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function StudioRelatedCodes({
  blocks,
  data,
  isFetching,
  selectedBlock,
}: Props) {
  const scopedFunctionBlocks = useMemo(
    () => scopeFunctionBlocks(blocks, selectedBlock),
    [blocks, selectedBlock],
  );
  const estimatedMappingCount = scopedFunctionBlocks.reduce(
    (sum, block) => sum + (block.colMappingCount ?? 0),
    0,
  );
  const scopedRelations = useMemo(
    () => scopeRelations(data?.functions ?? [], selectedBlock),
    [data?.functions, selectedBlock],
  );
  const relatedRelations = scopedRelations.filter((fn) => fn.codeGroups.length > 0);
  const groupCodes = new Set(
    relatedRelations.flatMap((fn) => fn.codeGroups.map((group) => group.groupCode)),
  );
  const groupByCode = new Map(
    (data?.codeGroups ?? []).map((group) => [group.groupCode, group]),
  );
  const distinctGroupSummaries = [...groupCodes].map((groupCode) => ({
    groupCode,
    groupName: groupByCode.get(groupCode)?.groupName || groupCode,
    functionCount: relatedRelations.filter((fn) =>
      fn.codeGroups.some((group) => group.groupCode === groupCode),
    ).length,
  }));
  const isSingleFunction = selectedBlock?.kind === "function";

  return (
    <details className="sp-studio-related">
      <summary>
        공통코드
        <span>
          {isFetching ? "…" : data ? groupCodes.size : "-"}
        </span>
      </summary>

      {!data ? (
        <p>
          상단의 관련 정보 불러오기를 사용해 주세요.
          {estimatedMappingCount > 0 && ` 컬럼 매핑 ${estimatedMappingCount}건이 연결되어 있습니다.`}
        </p>
      ) : (
        <div className="sp-studio-code-body">
          <div className="sp-studio-code-toolbar">
            <div>
              <span>{contextLabel(selectedBlock)}</span>
              {!isSingleFunction && <strong>관련 기능 {relatedRelations.length}개</strong>}
            </div>
          </div>

          {relatedRelations.length === 0 ? (
            <p className="sp-studio-code-empty">
              {scopedRelations.some((fn) => fn.mappingCount > 0)
                ? "컬럼 매핑은 있지만 공통코드가 연결된 컬럼은 없습니다."
                : "연결된 공통코드가 없습니다."}
            </p>
          ) : isSingleFunction ? (
            relatedRelations[0].codeGroups.map((relation) => (
              <CodeGroupDetail
                key={relation.groupCode}
                group={groupByCode.get(relation.groupCode)}
                relation={relation}
              />
            ))
          ) : (
            <div className="sp-studio-code-overview">
              {distinctGroupSummaries.map((group) => (
                <div key={group.groupCode} className="sp-studio-code-overview-item">
                  <div>
                    <strong>{group.groupName}</strong>
                    <span>{group.groupCode}</span>
                  </div>
                  <small>기능 {group.functionCount}개</small>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </details>
  );
}
