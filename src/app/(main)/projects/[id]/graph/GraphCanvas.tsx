"use client";

/**
 * GraphCanvas — react-force-graph-2d 래퍼 (클라이언트 전용)
 *
 * 역할:
 *   - SSR 비활성화된 force-directed 그래프 렌더러
 *   - 노드/엣지 스타일링 (타입별 색상·크기)
 *   - 선택·호버 상태에 따른 강조(하이라이트) 처리
 *   - 노드 클릭 → 상위(GraphViewPage)로 선택 이벤트 전파
 *
 * 왜 분리?
 *   - ForceGraph2D 는 canvas 기반이라 서버 렌더링 불가 → dynamic({ ssr: false })
 *     가 필요하고, 그 경계를 최소화하기 위해 이 컴포넌트만 격리한다.
 *   - 상위 페이지는 일반 클라이언트 컴포넌트로 유지해 검색/필터 UI 렌더가 빠름.
 */

import { useEffect, useMemo, useRef } from "react";
// force-graph-2d 타입 정의가 엄격하지 않아 로컬에서 최소 스펙만 선언
// (프로젝트 전체에 any 를 흘리지 않기 위해 여기서만 허용)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import ForceGraph2D from "react-force-graph-2d";
import type { GraphNode, GraphLink, NodeType } from "./types";
import { NODE_STYLE } from "./types";

type Props = {
  nodes:           GraphNode[];
  links:           GraphLink[];
  selectedId:      string | null;
  highlightIds:    Set<string>;            // 연결된 노드 id 집합 (선택/호버 시 채워짐)
  highlightLinks:  Set<string>;             // 연결된 링크 id 집합 ("source|target" 형식)
  hiddenTypes:     Set<NodeType>;          // 타입 필터 — 숨길 타입
  onSelect:        (id: string | null) => void;
  onHover:         (id: string | null) => void;
};

// ForceGraph 내부는 노드에 x/y 가 주입되어 변형되므로, 원본 배열을 직접 넘기지 않고
// 얕은 복사본을 만들어 시뮬레이터에만 넘긴다 (상위 데이터 불변 유지).
type SimNode = GraphNode & { x?: number; y?: number };

export default function GraphCanvas({
  nodes, links, selectedId, highlightIds, highlightLinks, hiddenTypes,
  onSelect, onHover,
}: Props) {
  // ForceGraph ref — 외부에서 줌/팬 제어용
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);

  // 필터 적용된 그래프 데이터
  const graphData = useMemo(() => {
    const filteredNodes: SimNode[] = nodes
      .filter((n) => !hiddenTypes.has(n.type))
      .map((n) => ({ ...n }));
    const keepIds = new Set(filteredNodes.map((n) => n.id));
    // source/target 은 API 응답 시점에는 string, force-graph 시뮬레이션 후에는
    // { id } 객체로 mutate 될 수 있어 유니온 타입. id 값을 안전하게 추출.
    const linkId = (v: string | { id: string }) => (typeof v === "string" ? v : v.id);
    const filteredLinks = links.filter((l) => keepIds.has(linkId(l.source)) && keepIds.has(linkId(l.target)));
    return { nodes: filteredNodes, links: filteredLinks };
  }, [nodes, links, hiddenTypes]);

  // 선택된 노드가 바뀌면 해당 노드로 카메라 이동 (줌/팬)
  useEffect(() => {
    if (!selectedId || !fgRef.current) return;
    const node = graphData.nodes.find((n) => n.id === selectedId) as SimNode | undefined;
    if (node && typeof node.x === "number" && typeof node.y === "number") {
      fgRef.current.centerAt(node.x, node.y, 500);
      fgRef.current.zoom(2, 500);
    }
  }, [selectedId, graphData.nodes]);

  return (
    <ForceGraph2D
      ref={fgRef}
      graphData={graphData}
      backgroundColor="#0f1419"
      // ── 노드 렌더링 (커스텀 drawing) ─────────────────────────────────────────
      nodeCanvasObjectMode={() => "replace"}
      nodeCanvasObject={(rawNode, ctx, globalScale) => {
        const node = rawNode as SimNode;
        if (typeof node.x !== "number" || typeof node.y !== "number") return;

        const style = NODE_STYLE[node.type];
        const isSelected   = node.id === selectedId;
        const isHighlighted = highlightIds.size === 0 || highlightIds.has(node.id);
        const dim = !isHighlighted && !isSelected;

        // 원(노드)
        ctx.beginPath();
        ctx.arc(node.x, node.y, style.radius, 0, 2 * Math.PI);
        ctx.fillStyle = dim ? `${style.color}33` : style.color;
        ctx.fill();

        // 선택된 노드에는 글로우 링
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, style.radius + 4, 0, 2 * Math.PI);
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2 / globalScale;
          ctx.stroke();
        }

        // 라벨 — 줌 레벨에 따라 단계적으로 노출 (가독성 + 성능)
        //   globalScale > 0.6: 이름(또는 이름 없으면 displayId) 1줄
        //   globalScale > 1.5: 이름 아래에 displayId 작게 한 줄 추가
        const primary   = node.name?.trim() || node.displayId;
        const secondary = node.name?.trim() ? node.displayId : "";

        if (globalScale > 0.6 && primary) {
          ctx.textAlign = "center";
          ctx.textBaseline = "top";

          // 긴 이름은 20자에서 잘라 표시 (툴팁/사이드패널엔 원본 그대로)
          const clipped = primary.length > 20 ? primary.slice(0, 20) + "…" : primary;

          // 가독성을 위한 얇은 배경 박스 — 다크 캔버스에서 글자가 묻히지 않게
          const fontSize = Math.max(10, 12 / globalScale);
          ctx.font = `${fontSize}px sans-serif`;
          const textWidth = ctx.measureText(clipped).width;
          const padX = 4 / globalScale;
          const padY = 2 / globalScale;
          const boxY = node.y + style.radius + 3;

          ctx.fillStyle = dim ? "rgba(20,25,32,0.5)" : "rgba(20,25,32,0.78)";
          ctx.fillRect(
            node.x - textWidth / 2 - padX,
            boxY - padY,
            textWidth + padX * 2,
            fontSize + padY * 2,
          );

          // 주 라벨 (이름)
          ctx.fillStyle = dim ? "#555" : "#f0f3f7";
          ctx.fillText(clipped, node.x, boxY);

          // 보조 라벨 (displayId) — 줌이 더 클 때만
          if (globalScale > 1.5 && secondary) {
            const smallSize = Math.max(8, 9 / globalScale);
            ctx.font = `${smallSize}px sans-serif`;
            ctx.fillStyle = dim ? "#444" : "#8a96a3";
            ctx.fillText(secondary, node.x, boxY + fontSize + padY * 2 + 1);
          }
        }
      }}
      // 노드 포인터 영역을 명확히 (클릭 판정 보정)
      nodePointerAreaPaint={(rawNode, color, ctx) => {
        const node = rawNode as SimNode;
        if (typeof node.x !== "number" || typeof node.y !== "number") return;
        const style = NODE_STYLE[node.type];
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, style.radius + 2, 0, 2 * Math.PI);
        ctx.fill();
      }}
      // ── 링크 렌더링 ───────────────────────────────────────────────────────────
      linkColor={(l) => {
        const key = linkKey(l as GraphLink);
        if (highlightLinks.size > 0) {
          return highlightLinks.has(key) ? "#90caf9" : "#2a3441";
        }
        return "#3a4553";
      }}
      linkWidth={(l) => {
        const key = linkKey(l as GraphLink);
        return highlightLinks.has(key) ? 1.8 : 0.6;
      }}
      linkDirectionalParticles={(l) => {
        const key = linkKey(l as GraphLink);
        return highlightLinks.has(key) ? 2 : 0;
      }}
      linkDirectionalParticleWidth={2}
      linkDirectionalParticleColor={() => "#64b5f6"}
      // 줌 + 팬 + 쿨링 파라미터 — 초기 안정화까지 600회 틱
      cooldownTicks={600}
      warmupTicks={80}
      onNodeClick={(n) => onSelect((n as SimNode).id)}
      onNodeHover={(n) => onHover(n ? (n as SimNode).id : null)}
      onBackgroundClick={() => onSelect(null)}
    />
  );
}

/**
 * 링크 식별자 — source/target 이 객체화(force-graph 가 런타임에 노드 ref로 치환)
 * 되는 경우를 고려해서 string|object 양쪽을 모두 처리.
 */
function linkKey(l: GraphLink): string {
  const s = typeof l.source === "string" ? l.source : (l.source as { id: string })?.id;
  const t = typeof l.target === "string" ? l.target : (l.target as { id: string })?.id;
  return `${s}|${t}`;
}
