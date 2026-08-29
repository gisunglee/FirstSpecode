/** 스펙 동기화 목록·상세 UI가 소비하는 API 응답 타입. */

export type Evidence = {
  path: string;
  symbol: string | null;
  startLine: number;
  endLine: number;
  snippet: string;
};

export type SyncItem = {
  syncItemId: string;
  findingType: "IMPLEMENTATION" | "DESIGN_COVERAGE";
  resultCode: string;
  importance: string;
  targetType: string | null;
  targetDisplayId: string | null;
  targetName: string | null;
  targetField: string | null;
  designStatement: string | null;
  sourceFact: string | null;
  reason: string;
  evidence: Evidence[];
  confidence: string;
  beforeValue: string | null;
  currentValue: string | null;
  proposedValue: string | null;
  status: string;
  decision: string | null;
  decisionReason: string | null;
};

export type SyncRunDetail = {
  syncRunId: string;
  unitWorkDisplayId: string;
  unitWorkName: string;
  mode: string;
  status: string;
  designSnapshotHash: string;
  sourceScope: {
    status?: string;
    files?: Array<{ path: string; kind: string; reason: string }>;
    questions?: string[];
  } | null;
  summary: {
    implementation?: string;
    designCoverage?: string;
    evaluatedTargetCount: number;
    normalTargetCount: number;
    issueCount: number;
    implementationIssueCount: number;
    coverageIssueCount: number;
    pendingCount: number;
  };
  implementationVerdict: string | null;
  designCoverageVerdict: string | null;
  failure: string | null;
  requesterId: string | null;
  createdAt: string;
  analyzedAt: string | null;
  completedAt: string | null;
  items: SyncItem[];
};
