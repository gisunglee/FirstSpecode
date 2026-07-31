/**
 * 스펙 반영함 화면 API DTO.
 */

export type HierarchyNode = {
  id: string;
  displayId: string;
  name: string;
};

export type Hierarchy = {
  unitWork?: HierarchyNode | null;
  screen?: HierarchyNode | null;
  area?: HierarchyNode | null;
  function?: HierarchyNode | null;
};

export type ReconcileItem = {
  itemId: string;
  classification: string;
  targetRefType: string;
  targetRefId: string;
  targetField: string;
  targetHierarchy: Hierarchy;
  sourceEvidence: unknown;
  sourceFact: string;
  inferredImpact: string | null;
  beforeValue: string;
  proposedValue: string;
  beforeHash: string;
  risk: string;
  confidence: string;
  status: string;
  decision: string | null;
  decisionReason: string | null;
  decisionMemberName: string | null;
  decidedAt: string | null;
  designChangeId: string | null;
  resolutionEvidence: unknown;
  exceptionExpiresAt: string | null;
  exceptionOwnerMemberId: string | null;
  followupTaskId: string | null;
  reviewRequestId: string | null;
  mergePreview: string | null;
  mergeLatestHash: string | null;
  mergeConflicts: unknown;
  batchOrigin: unknown;
  resolvedAt: string | null;
};

export type ReconcileBatch = {
  batchId: string;
  batchNo: number;
  batchKey: string;
  scopeType: string;
  scopeRefId: string | null;
  scopeName: string;
  sourcePaths: unknown;
  targetCount: number;
  metrics: unknown;
  status: string;
  taskId: string | null;
  summary: string | null;
  failure: string | null;
  retryCount: number;
  createdAt: string;
  completedAt: string | null;
};

export type ReceiptDetail = {
  receiptId: string;
  originType: string;
  aiTaskId: string | null;
  status: string;
  reviewStatus: string;
  summary: string;
  checkpointType: string;
  baseCheckpoint: string;
  headCheckpoint: string;
  headStable: boolean;
  submittedBaselineVersion: number;
  currentBaselineVersion: number;
  sourceEvidence: unknown;
  evidenceTrust: string;
  evidenceVerify: string;
  ancestryVerified: boolean | null;
  diffHash: string | null;
  evidenceVerifyData: unknown;
  overrideReason: string | null;
  prUrl: string | null;
  selectedTargets: Array<{
    targetRefType: string;
    targetRefId: string;
  }> | null;
  analysisScope: unknown;
  analysisVersion: string | null;
  submitMemberName: string;
  createdAt: string;
  closedAt: string | null;
  canApply: boolean;
  canOverride: boolean;
  batches: ReconcileBatch[];
  items: ReconcileItem[];
};

export type ProjectMember = {
  memberId: string;
  name: string | null;
  email: string;
  role: string;
  job: string;
};
