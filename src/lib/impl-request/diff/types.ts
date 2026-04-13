/**
 * diff-test/types — Diff Prompt Test 공용 타입 정의
 *
 * 역할:
 *   - 4계층 노드(UW/PID/AR/FID) 입력 구조
 *   - 변경 감지/모드/통계 타입
 */

export type NodeType = "UW" | "PID" | "AR" | "FID";
export const NODE_TYPES: NodeType[] = ["UW", "PID", "AR", "FID"];
export const NODE_SEQ: Record<NodeType, number> = { UW: 1, PID: 2, AR: 3, FID: 4 };

export type ChangeMode = "NO_CHANGE" | "DIFF" | "FULL" | "REPLACE";

export type NodeInput = {
  UW: string;
  PID: string;
  AR: string;
  FID: string;
};

export type NodeStats = {
  changed: boolean;
  hash: string;
  mode?: ChangeMode;
  lineRatio?: number;
  added?: number;
  removed?: number;
  kept?: number;
};

export type SaveResponse = {
  ok: true;
  masterId: string;
  testSn: number;
  baseMasterId: string | null;
  changedNodes: NodeType[];
  nodeStats: Record<NodeType, NodeStats>;
};

export type DiffSummary = Partial<Record<NodeType, {
  mode: ChangeMode;
  lineRatio?: number;
  added?: number;
  removed?: number;
  kept?: number;
}>>;
