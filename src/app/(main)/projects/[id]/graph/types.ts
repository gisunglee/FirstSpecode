/**
 * 그래프 뷰 공용 타입 / 상수
 *
 * 이 파일에만 모아 두는 이유:
 *   - GraphViewPage (컨트롤/사이드패널), GraphCanvas (렌더러) 양쪽이 공유
 *   - 한 곳에서 색상·라벨·경로를 관리해서 테마 변경 시 수정 범위 최소화
 */

export type NodeType = "task" | "req" | "unit" | "screen" | "area" | "func";

export type GraphNode = {
  id:        string;         // 타입 prefix 포함 — "task:uuid"
  type:      NodeType;
  label:     string;
  displayId: string;
  name:      string;
  refId:     string;         // 원본 엔티티 ID (상세 페이지 라우팅용)
};

// force-graph 는 링크 생성 후 source/target 을 노드 객체로 mutate 할 수 있음
// — API 응답 시점에는 문자열, 런타임에는 객체가 들어올 수 있어 union 으로 선언
export type GraphLink = {
  source: string | { id: string };
  target: string | { id: string };
};

export type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
  stats: Record<NodeType, number>;
};

// ── 노드 타입별 시각 스타일 ────────────────────────────────────────────────────
// 색상은 계층이 깊어질수록 따뜻한 색조 → 차가운 색조로 이동 (눈으로 계층 파악 용이)
export const NODE_STYLE: Record<NodeType, { color: string; radius: number; label: string; emoji: string }> = {
  task:   { color: "#9575cd", radius: 10, label: "과업",       emoji: "📌" },
  req:    { color: "#ba68c8", radius: 9,  label: "요구사항",   emoji: "📋" },
  unit:   { color: "#64b5f6", radius: 8,  label: "단위업무",   emoji: "🧱" },
  screen: { color: "#4db6ac", radius: 7,  label: "화면",       emoji: "🖼" },
  area:   { color: "#ffb74d", radius: 6,  label: "영역",       emoji: "📦" },
  func:   { color: "#f06292", radius: 5,  label: "기능",       emoji: "⚙" },
};

// 노드 타입별 상세 페이지 경로 빌더
export function detailHrefOf(projectId: string, node: GraphNode): string {
  switch (node.type) {
    case "task":   return `/projects/${projectId}/tasks/${node.refId}`;
    case "req":    return `/projects/${projectId}/requirements/${node.refId}`;
    case "unit":   return `/projects/${projectId}/unit-works/${node.refId}`;
    case "screen": return `/projects/${projectId}/screens/${node.refId}`;
    case "area":   return `/projects/${projectId}/areas/${node.refId}`;
    case "func":   return `/projects/${projectId}/functions/${node.refId}`;
  }
}
