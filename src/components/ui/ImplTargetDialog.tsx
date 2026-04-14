"use client";

/**
 * ImplTargetDialog — 구현 대상 선택 팝업 (공통 컴포넌트)
 *
 * 역할:
 *   - 단위업무 하위 설계 트리(UW → SCR → AR → FN)를 체크박스 트리로 표시
 *   - 현재 엔티티 기준 상위 체인 + 하위 전체 자동 선택
 *   - 체크 시 부모 자동 선택, 해제 시 자손 자동 해제
 *
 * 사용처:
 *   - 기능 상세, 영역 상세, 화면 상세, 단위업무 상세 등
 *
 * Props:
 *   - projectId: 프로젝트 ID
 *   - refType:   호출 페이지의 엔티티 유형 (FUNCTION | AREA | SCREEN | UNIT_WORK)
 *   - refId:     호출 페이지의 엔티티 ID
 *   - onClose:   닫기 콜백
 *   - onImplRequest: 구현요청 콜백 — 트리 루트 진입점(entryType/entryId) + 선택된 기능 ID 배열 전달
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type NodeType = "UNIT_WORK" | "SCREEN" | "AREA" | "FUNCTION";

type TreeNode = {
  id:        string;
  name:      string;
  displayId: string;
  type:      NodeType;
  children:  TreeNode[];
};

type ImplTreeResponse = {
  tree:        TreeNode;
  selectedIds: string[];
};

// ── 타입별 표시 설정 ──────────────────────────────────────────────────────────

const NODE_PREFIX: Record<NodeType, string> = {
  UNIT_WORK: "UW",
  SCREEN:    "SCR",
  AREA:      "AR",
  FUNCTION:  "FN",
};

const NODE_COLOR: Record<NodeType, string> = {
  UNIT_WORK: "#1565c0",
  SCREEN:    "#2e7d32",
  AREA:      "#e65100",
  FUNCTION:  "#6a1b9a",
};

// ── 트리 유틸 함수 ────────────────────────────────────────────────────────────

/** 트리를 순회하며 자식→부모 매핑을 생성 */
function buildParentMap(node: TreeNode, parentId: string | null, map: Map<string, string>): void {
  if (parentId) map.set(node.id, parentId);
  for (const child of node.children) {
    buildParentMap(child, node.id, map);
  }
}

/** 특정 노드의 모든 자손 ID를 수집 */
function collectDescendantIds(node: TreeNode, result: Set<string>): void {
  for (const child of node.children) {
    result.add(child.id);
    collectDescendantIds(child, result);
  }
}

/** 노드 하위에 FUNCTION 타입 자손이 있는지 확인 */
function hasFunctionDescendant(node: TreeNode): boolean {
  if (node.type === "FUNCTION") return true;
  return node.children.some((c) => hasFunctionDescendant(c));
}

/**
 * 선택된 기능(FN) 기준으로 상위 체인 자동 선택 상태를 재계산
 * - 기능이 1개라도 선택된 영역/화면/단위업무는 자동 선택
 * - 기능이 0개인 상위 노드는 자동 해제
 */
function rebuildParentSelection(tree: TreeNode, fnIds: Set<string>): Set<string> {
  const result = new Set<string>(fnIds);

  function hasCheckedFn(node: TreeNode): boolean {
    if (node.type === "FUNCTION") return fnIds.has(node.id);
    const has = node.children.some((c) => hasCheckedFn(c));
    if (has) result.add(node.id);
    return has;
  }

  hasCheckedFn(tree);
  return result;
}

/** 트리에서 특정 ID의 노드를 찾는 재귀 탐색 */
function findNode(node: TreeNode, id: string): TreeNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function ImplTargetDialog({
  projectId,
  refType,
  refId,
  onClose,
  onImplRequest,
}: {
  projectId: string;
  refType:   NodeType;
  refId:     string;
  onClose:   () => void;
  onImplRequest?: (params: { entryType: NodeType; entryId: string; functionIds: string[] }) => void;
}) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // ── 트리 데이터 조회 ──────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["impl-tree", projectId, refType, refId],
    queryFn: () =>
      authFetch<{ data: ImplTreeResponse }>(
        `/api/projects/${projectId}/impl-tree?refType=${refType}&refId=${refId}`
      ).then((r) => r.data),
  });

  // ── 부모 맵 (자식ID → 부모ID) — 트리 변경 시 재계산 ─────────────────────
  const parentMap = useMemo(() => {
    if (!data?.tree) return new Map<string, string>();
    const map = new Map<string, string>();
    buildParentMap(data.tree, null, map);
    return map;
  }, [data?.tree]);

  // ── 초기 선택 상태 세팅 — API 응답의 selectedIds 중 기능만 추출 후 상위 자동 계산
  useEffect(() => {
    if (data?.selectedIds && data?.tree) {
      const fnIds = new Set<string>();
      for (const id of data.selectedIds) {
        const node = findNode(data.tree, id);
        if (node?.type === "FUNCTION") fnIds.add(id);
      }
      setCheckedIds(rebuildParentSelection(data.tree, fnIds));
    }
  }, [data?.selectedIds, data?.tree]);

  // ── 체크박스 토글 핸들러 ──────────────────────────────────────────────────
  // 규칙:
  //   1. 기능(FN)만 직접 체크/해제 가능
  //   2. 상위(UW/SCR/AR)는 하위 기능 선택 상태에 따라 자동 결정
  //   3. 하위 기능이 없는 노드는 선택 불가
  const handleToggle = useCallback(
    (id: string, checked: boolean) => {
      if (!data?.tree) return;

      const node = findNode(data.tree, id);
      if (!node) return;

      // 기능이 아닌 상위 노드 직접 클릭 → 무시 (자동 계산됨)
      if (node.type !== "FUNCTION") return;

      setCheckedIds((prev) => {
        // 현재 선택된 기능 ID 목록 추출
        const fnIds = new Set<string>();
        for (const pid of prev) {
          const n = findNode(data.tree, pid);
          if (n?.type === "FUNCTION") fnIds.add(pid);
        }

        // 토글 적용
        if (checked) fnIds.add(id);
        else fnIds.delete(id);

        // 상위 체인 자동 재계산
        return rebuildParentSelection(data.tree, fnIds);
      });
    },
    [data?.tree]
  );

  // ── 구현요청 버튼 — 선택된 기능(FN) ID 수집 후 콜백 호출 ─────────────────
  const handleImplRequest = useCallback(() => {
    if (!data?.tree || !onImplRequest) return;

    // 트리 전체에서 FUNCTION 타입이면서 체크된 노드 ID 수집
    const fnIds: string[] = [];
    function collectCheckedFns(node: TreeNode) {
      if (node.type === "FUNCTION" && checkedIds.has(node.id)) {
        fnIds.push(node.id);
      }
      for (const child of node.children) collectCheckedFns(child);
    }
    collectCheckedFns(data.tree);

    if (fnIds.length === 0) {
      toast.error("기능을 1개 이상 선택해 주세요.");
      return;
    }

    // 트리 루트의 type/id를 진입점으로 전달
    // (트리는 항상 UW 루트이므로 collectLayers가 UNIT_WORK 분기를 타고 functionIds로 필터링)
    onImplRequest({
      entryType: data.tree.type,
      entryId: data.tree.id,
      functionIds: fnIds,
    });
  }, [data?.tree, checkedIds, onImplRequest]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 90vw)", height: "70vh",
          display: "flex", flexDirection: "column",
          border: "1px solid var(--color-border)", borderRadius: 10,
          background: "var(--color-bg-card)", boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        {/* ── 헤더 ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--color-border)",
          background: "var(--color-bg-muted)", flexShrink: 0,
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
            구현 대상 선택
          </span>
          <button
            onClick={onClose}
            style={{
              padding: "5px 12px", background: "var(--color-bg-muted)",
              border: "1px solid var(--color-border)", borderRadius: 4,
              fontSize: 12, fontWeight: 600, cursor: "pointer",
              color: "var(--color-text-primary)",
            }}
          >
            닫기
          </button>
        </div>

        {/* ── 본문 ── */}
        {isLoading ? (
          <div style={{ padding: 48, textAlign: "center", color: "#aaa", fontSize: 13 }}>
            불러오는 중...
          </div>
        ) : !data?.tree ? (
          <div style={{ padding: 48, textAlign: "center", color: "#aaa", fontSize: 13 }}>
            트리 데이터를 불러올 수 없습니다.
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* 서브 헤더 + 단위업무명 — 상단 고정 */}
            <div style={{ padding: "16px 20px 0", flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 8 }}>
                ※ 구현 대상 선택
              </div>
              <div style={{ borderBottom: "1px solid var(--color-border)", marginBottom: 12 }} />
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginBottom: 12,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16 }}>📋</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)" }}>
                    {data.tree.displayId} {data.tree.name}
                  </span>
                </div>
                <button
                  onClick={handleImplRequest}
                  style={{
                    padding: "6px 16px", borderRadius: 6, border: "none",
                    background: "var(--color-primary, #1976d2)", color: "#fff",
                    fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  프롬프트 확인
                </button>
              </div>
            </div>

            {/* 트리 영역 — 스크롤 */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 16px", minHeight: 0 }}>
              <TreeNodeRow
                node={data.tree}
                level={0}
                checkedIds={checkedIds}
                onToggle={handleToggle}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 트리 노드 행 (재귀) ───────────────────────────────────────────────────────

function TreeNodeRow({
  node,
  level,
  checkedIds,
  onToggle,
}: {
  node:       TreeNode;
  level:      number;
  checkedIds: Set<string>;
  onToggle:   (id: string, checked: boolean) => void;
}) {
  const isChecked = checkedIds.has(node.id);
  const prefix    = NODE_PREFIX[node.type];
  const color     = NODE_COLOR[node.type];

  // 기능(FN)만 직접 토글 가능. 하위에 FN이 없는 노드는 비활성화
  const isFn = node.type === "FUNCTION";
  const canToggle = isFn || hasFunctionDescendant(node);
  const isClickable = isFn; // 상위 노드는 클릭해도 토글 안 됨

  return (
    <>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          paddingLeft: level * 24, paddingTop: 4, paddingBottom: 4,
          cursor: isClickable ? "pointer" : "default",
          // 선택/미선택 시각 차이: 미선택 시 흐리게, 기능 없으면 더 흐리게
          opacity: !canToggle ? 0.3 : isChecked ? 1 : 0.45,
          transition: "opacity 0.15s ease",
        }}
        onClick={() => isClickable && onToggle(node.id, !isChecked)}
      >
        {/* 체크박스 — 기능만 활성화, 상위는 읽기전용 */}
        <input
          type="checkbox"
          checked={isChecked}
          disabled={!isClickable}
          onChange={(e) => { e.stopPropagation(); if (isClickable) onToggle(node.id, e.target.checked); }}
          style={{ margin: 0, cursor: isClickable ? "pointer" : "default", accentColor: color }}
        />
        {/* 타입 배지 + 이름 */}
        <span style={{
          fontSize: 12, fontWeight: 700, color,
          minWidth: 28,
        }}>
          {prefix}:
        </span>
        <span style={{
          fontSize: 13,
          color: "var(--color-text-primary)",
          fontWeight: isChecked ? 600 : 400,
        }}>
          {node.name}
        </span>
      </div>

      {/* 자식 노드 재귀 렌더링 */}
      {node.children.map((child) => (
        <TreeNodeRow
          key={child.id}
          node={child}
          level={level + 1}
          checkedIds={checkedIds}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}
