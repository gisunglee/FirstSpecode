"use client";

/** Unit-work DB table summary with emphasis based on the settled document selection. */

import { useMemo } from "react";
import type { RelatedCodesResponse, StudioBlock } from "./types";

type Props = {
  blocks: StudioBlock[];
  data: RelatedCodesResponse | undefined;
  selectedBlock: StudioBlock | null;
};

function scopedFunctionIds(blocks: StudioBlock[], selectedBlock: StudioBlock | null): Set<string> {
  const functions = blocks.filter((block) => block.kind === "function");
  if (!selectedBlock) return new Set(functions.map((block) => block.entityId));
  if (selectedBlock.kind === "function") return new Set([selectedBlock.entityId]);
  if (selectedBlock.kind === "area") {
    return new Set(
      functions
        .filter((block) => block.parentKey === selectedBlock.key)
        .map((block) => block.entityId),
    );
  }
  if (selectedBlock.kind === "screen") {
    const areaKeys = new Set(
      blocks
        .filter((block) => block.kind === "area" && block.parentKey === selectedBlock.key)
        .map((block) => block.key),
    );
    return new Set(
      functions
        .filter((block) => block.parentKey && areaKeys.has(block.parentKey))
        .map((block) => block.entityId),
    );
  }
  return new Set(functions.map((block) => block.entityId));
}

export default function StudioRelatedDb({ blocks, data, selectedBlock }: Props) {
  const selectedFunctionIds = useMemo(
    () => scopedFunctionIds(blocks, selectedBlock),
    [blocks, selectedBlock],
  );
  const tables = data?.dbTables ?? [];

  return (
    <details className="sp-studio-related">
      <summary>DB <span>{data ? tables.length : "-"}</span></summary>
      {!data ? (
        <p>상단의 관련 정보 불러오기를 사용해 주세요.</p>
      ) : tables.length === 0 ? (
        <p>이 단위업무에 연결된 DB 테이블이 없습니다.</p>
      ) : (
        <div className="sp-studio-db-list">
          {tables.map((table) => {
            const isActive = table.functionIds.some((functionId) => selectedFunctionIds.has(functionId));
            return (
              <div
                key={table.tableId}
                className={`sp-studio-db-item${isActive ? " is-active" : ""}`}
              >
                <strong>{table.tableLogicalName || table.tableName}</strong>
                <span>{table.tableName}</span>
              </div>
            );
          })}
        </div>
      )}
    </details>
  );
}
