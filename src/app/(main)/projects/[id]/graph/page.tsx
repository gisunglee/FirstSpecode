"use client";

/**
 * GraphViewPage — 프로젝트 계층 그래프 시각화 (실험 메뉴)
 *
 * 역할:
 *   - 프로젝트 전체의 과업→요구사항→단위업무→화면→영역→기능 계층을
 *     force-directed 그래프로 시각화 (옵시디언 그래프뷰 스타일)
 *   - 노드 클릭 → 사이드 패널에 상세(및 인접 노드) 표시, "상세 페이지 열기" 링크
 *   - 타입별 표시/숨김 토글, 텍스트 검색으로 노드 포커싱
 *
 * 주요 기술:
 *   - react-force-graph-2d: 물리 시뮬레이션 기반 그래프
 *   - TanStack Query: 데이터 로드 및 캐싱
 *   - dynamic(import, { ssr: false }): canvas 기반이라 서버 렌더 제외
 *
 * 유지보수 메모:
 *   - 데이터는 GET /api/projects/[id]/graph 한 방 호출. 계층이 커지면 요청 인자로
 *     focus/depth 를 받아 부분만 반환하도록 API 를 확장하면 됨.
 *   - 스타일·라벨·경로는 ./types.ts 의 NODE_STYLE / detailHrefOf 에 모아둠.
 *   - 하이라이트(선택/호버) 로직은 이 파일에서 집중 계산, 캔버스는 결과만 그림.
 */

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";
import type { GraphData, GraphLink, GraphNode, NodeType } from "./types";
import { NODE_STYLE, detailHrefOf } from "./types";

// canvas 기반 라이브러리라 서버 렌더 불가 → SSR 비활성화로 클라이언트에서만 마운트
const GraphCanvas = dynamic(() => import("./GraphCanvas"), {
  ssr: false,
  loading: () => (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: 13 }}>
      그래프 초기화 중...
    </div>
  ),
});

// ── 페이지 본문 ──────────────────────────────────────────────────────────────

export default function GraphViewPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const { setBreadcrumb } = useAppStore();

  useEffect(() => {
    setBreadcrumb([{ label: "그래프 뷰" }]);
    return () => setBreadcrumb([]);
  }, [setBreadcrumb]);

  // ── 데이터 로드 ─────────────────────────────────────────────────────────────
  const { data, isLoading, isError } = useQuery<{ data: GraphData }>({
    queryKey: ["graph", projectId],
    queryFn:  () => authFetch<{ data: GraphData }>(`/api/projects/${projectId}/graph`),
  });
  const graph = data?.data;

  // ── 컨트롤 상태 ────────────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId,    setHoverId]    = useState<string | null>(null);
  const [search,     setSearch]     = useState("");
  const [hiddenTypes, setHiddenTypes] = useState<Set<NodeType>>(new Set());

  // ── 이웃 인덱스 ─────────────────────────────────────────────────────────────
  // 노드 id → 연결된 이웃 id 집합 (양방향). 하이라이트 계산용.
  // 데이터가 바뀔 때만 재계산되도록 useMemo 로 캐싱.
  const neighborMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!graph) return map;
    for (const l of graph.links) {
      const s = typeof l.source === "string" ? l.source : (l.source as { id: string }).id;
      const t = typeof l.target === "string" ? l.target : (l.target as { id: string }).id;
      if (!map.has(s)) map.set(s, new Set());
      if (!map.has(t)) map.set(t, new Set());
      map.get(s)!.add(t);
      map.get(t)!.add(s);
    }
    return map;
  }, [graph]);

  // ── 하이라이트 집합 계산 ───────────────────────────────────────────────────
  // 선택된 노드가 있으면 그 노드 + 이웃을, 없고 호버만 있으면 호버 노드 + 이웃을 강조.
  // 아무것도 없으면 빈 집합 → 모든 노드가 정상 밝기로 표시됨 (GraphCanvas 로직 참조).
  const focusId = selectedId ?? hoverId;
  const { highlightIds, highlightLinks } = useMemo(() => {
    const nodeSet = new Set<string>();
    const linkSet = new Set<string>();
    if (!focusId || !graph) return { highlightIds: nodeSet, highlightLinks: linkSet };

    nodeSet.add(focusId);
    const neighbors = neighborMap.get(focusId);
    if (neighbors) neighbors.forEach((n) => nodeSet.add(n));

    for (const l of graph.links) {
      const s = typeof l.source === "string" ? l.source : (l.source as { id: string }).id;
      const t = typeof l.target === "string" ? l.target : (l.target as { id: string }).id;
      if (s === focusId || t === focusId) linkSet.add(`${s}|${t}`);
    }
    return { highlightIds: nodeSet, highlightLinks: linkSet };
  }, [focusId, graph, neighborMap]);

  // ── 선택된 노드의 상세 정보 + 이웃 분류 ───────────────────────────────────
  const detail = useMemo(() => {
    if (!selectedId || !graph) return null;
    const node = graph.nodes.find((n) => n.id === selectedId);
    if (!node) return null;
    const neighborIds = neighborMap.get(selectedId) ?? new Set<string>();
    const neighbors = graph.nodes.filter((n) => neighborIds.has(n.id));
    return { node, neighbors };
  }, [selectedId, graph, neighborMap]);

  // ── 검색 결과 ─────────────────────────────────────────────────────────────
  const searchResults = useMemo(() => {
    if (!graph || !search.trim()) return [];
    const kw = search.trim().toLowerCase();
    return graph.nodes
      .filter((n) => n.label.toLowerCase().includes(kw))
      .slice(0, 20);
  }, [graph, search]);

  function toggleType(type: NodeType) {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  // ── 렌더 ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return <div style={{ padding: "80px 32px", textAlign: "center", color: "#888", fontSize: 14 }}>그래프 데이터 불러오는 중...</div>;
  }
  if (isError || !graph) {
    return <div style={{ padding: "80px 32px", textAlign: "center", color: "#e53935", fontSize: 14 }}>그래프를 불러올 수 없습니다.</div>;
  }

  return (
    <div style={{ position: "relative", height: "calc(100vh - 60px)", background: "#0f1419", overflow: "hidden" }}>
      {/* ── 그래프 캔버스 (전체 배경) ───────────────────────────────────────── */}
      <div style={{ position: "absolute", inset: 0 }}>
        <GraphCanvas
          nodes={graph.nodes}
          links={graph.links as GraphLink[]}
          selectedId={selectedId}
          highlightIds={highlightIds}
          highlightLinks={highlightLinks}
          hiddenTypes={hiddenTypes}
          onSelect={setSelectedId}
          onHover={setHoverId}
        />
      </div>

      {/* ── 좌측: 검색 + 타입 필터 + 통계 ─────────────────────────────────── */}
      <div style={panelLeftStyle}>
        <div style={panelTitleStyle}>
          <span style={{ fontSize: 16 }}>🕸</span>
          <span>그래프 뷰</span>
        </div>
        <div style={{ fontSize: 11, color: "#8a96a3", marginBottom: 12 }}>
          노드를 클릭해 하위 관계를 확인하세요
        </div>

        {/* 검색 */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="노드 검색..."
          style={searchInputStyle}
        />

        {search.trim() && searchResults.length > 0 && (
          <div style={{ maxHeight: 180, overflowY: "auto", marginTop: 6, marginBottom: 10, borderRadius: 6, background: "#1a2230", border: "1px solid #2a3441" }}>
            {searchResults.map((n) => {
              const style = NODE_STYLE[n.type];
              return (
                <button
                  key={n.id}
                  onClick={() => { setSelectedId(n.id); setSearch(""); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                    padding: "7px 10px", background: "transparent", border: "none",
                    color: "#e8e8e8", fontSize: 12, cursor: "pointer", textAlign: "left",
                    borderBottom: "1px solid #2a3441",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#263241")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: style.color, flexShrink: 0 }} />
                  <span style={{ color: "#8a96a3", fontSize: 10, minWidth: 46 }}>{style.label}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {n.label || "(이름 없음)"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* 타입 토글 */}
        <div style={{ fontSize: 11, color: "#8a96a3", marginTop: 14, marginBottom: 6 }}>타입 필터</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {(Object.keys(NODE_STYLE) as NodeType[]).map((t) => {
            const s = NODE_STYLE[t];
            const hidden = hiddenTypes.has(t);
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "6px 8px", borderRadius: 5,
                  background: hidden ? "transparent" : "#1a2230",
                  border: `1px solid ${hidden ? "#2a3441" : "#3a4553"}`,
                  color: hidden ? "#555" : "#e8e8e8",
                  fontSize: 12, cursor: "pointer", textAlign: "left",
                  opacity: hidden ? 0.5 : 1,
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{s.label}</span>
                <span style={{ fontSize: 11, color: "#8a96a3" }}>{graph.stats[t] ?? 0}</span>
                <span style={{ fontSize: 9, color: "#555" }}>{hidden ? "숨김" : ""}</span>
              </button>
            );
          })}
        </div>

        {/* 통계 푸터 */}
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid #2a3441", fontSize: 10, color: "#8a96a3" }}>
          전체 노드 <strong style={{ color: "#e8e8e8" }}>{graph.nodes.length}</strong> · 링크 <strong style={{ color: "#e8e8e8" }}>{graph.links.length}</strong>
        </div>
      </div>

      {/* ── 우측: 선택된 노드 상세 (없으면 미표시) ─────────────────────────── */}
      {detail && (
        <div style={panelRightStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "2px 10px", borderRadius: 12,
              background: NODE_STYLE[detail.node.type].color + "33",
              color: NODE_STYLE[detail.node.type].color,
              fontSize: 11, fontWeight: 700,
            }}>
              <span>{NODE_STYLE[detail.node.type].emoji}</span>
              <span>{NODE_STYLE[detail.node.type].label}</span>
            </span>
            <button
              onClick={() => setSelectedId(null)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#8a96a3", fontSize: 16, lineHeight: 1, padding: 2 }}
            >
              ×
            </button>
          </div>

          <div style={{ fontSize: 11, color: "#8a96a3", marginBottom: 2 }}>{detail.node.displayId}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#f0f3f7", marginBottom: 12, lineHeight: 1.3 }}>
            {detail.node.name || "(이름 없음)"}
          </div>

          <Link
            href={detailHrefOf(projectId, detail.node)}
            style={{
              display: "block", marginBottom: 16,
              padding: "7px 12px", borderRadius: 6,
              background: "#1565c0", color: "#fff",
              fontSize: 12, fontWeight: 600, textAlign: "center",
              textDecoration: "none",
            }}
          >
            상세 페이지 열기 →
          </Link>

          {/* 연결된 이웃 — 타입별로 묶어서 표시 */}
          <div style={{ fontSize: 11, color: "#8a96a3", marginBottom: 6 }}>
            연결 ({detail.neighbors.length})
          </div>
          {(Object.keys(NODE_STYLE) as NodeType[]).map((t) => {
            const group = detail.neighbors.filter((n) => n.type === t);
            if (group.length === 0) return null;
            const s = NODE_STYLE[t];
            return (
              <div key={t} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: "#8a96a3", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color }} />
                  {s.label} ({group.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {group.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => setSelectedId(n.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "5px 8px", borderRadius: 5,
                        background: "#1a2230", border: "1px solid #2a3441",
                        color: "#e8e8e8", fontSize: 11, cursor: "pointer",
                        textAlign: "left",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#263241")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "#1a2230")}
                    >
                      <span style={{ color: "#8a96a3", fontSize: 10, minWidth: 54 }}>{n.displayId}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {n.name || "(이름 없음)"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 우측 하단: 범례 ────────────────────────────────────────────────── */}
      {!detail && (
        <div style={legendStyle}>
          <div style={{ fontSize: 10, color: "#8a96a3", marginBottom: 6, fontWeight: 700, letterSpacing: "0.05em" }}>범례</div>
          {(Object.keys(NODE_STYLE) as NodeType[]).map((t) => {
            const s = NODE_STYLE[t];
            return (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#e8e8e8", marginBottom: 3 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color }} />
                <span>{s.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 스타일 ───────────────────────────────────────────────────────────────────

const panelLeftStyle: React.CSSProperties = {
  position: "absolute", top: 16, left: 16, zIndex: 5,
  width: 240, padding: "14px 16px",
  background: "rgba(15, 20, 25, 0.92)",
  border: "1px solid #2a3441", borderRadius: 10,
  backdropFilter: "blur(8px)",
  color: "#e8e8e8",
};

const panelRightStyle: React.CSSProperties = {
  position: "absolute", top: 16, right: 16, bottom: 16, zIndex: 5,
  width: 300, padding: "14px 16px",
  background: "rgba(15, 20, 25, 0.92)",
  border: "1px solid #2a3441", borderRadius: 10,
  backdropFilter: "blur(8px)",
  color: "#e8e8e8",
  overflowY: "auto",
};

const panelTitleStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  fontSize: 14, fontWeight: 700, color: "#f0f3f7", marginBottom: 2,
};

const searchInputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px",
  background: "#1a2230", border: "1px solid #2a3441",
  borderRadius: 6, color: "#e8e8e8", fontSize: 12, outline: "none",
  boxSizing: "border-box",
};

const legendStyle: React.CSSProperties = {
  position: "absolute", bottom: 16, right: 16, zIndex: 4,
  padding: "10px 12px",
  background: "rgba(15, 20, 25, 0.85)",
  border: "1px solid #2a3441", borderRadius: 8,
  backdropFilter: "blur(8px)",
};
