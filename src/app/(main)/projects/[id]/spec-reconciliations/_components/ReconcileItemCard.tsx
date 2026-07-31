"use client";

/**
 * 스펙 변경 후보 한 건의 증거·Diff·결정 UI.
 */

import { useState } from "react";
import { toast } from "sonner";
import { FocusedDiff } from "./FocusedDiff";
import type {
  Hierarchy,
  HierarchyNode,
  ProjectMember,
  ReconcileItem,
} from "./types";

export type DecisionPayload = {
  action:
    | "APPLY_SPEC"
    | "FIX_SOURCE"
    | "NO_SPEC_CHANGE"
    | "ACCEPT_EXCEPTION"
    | "MODEL_GAP"
    | "DEFERRED";
  reason?: string;
  useMergePreview?: boolean;
  exceptionOwnerMemberId?: string;
  exceptionExpiresAt?: string;
  reviewerMemberId?: string;
};

export type SourceFixPayload = {
  checkpointType: "GIT_COMMIT" | "SOURCE_MANIFEST";
  headCheckpoint: string;
  evidenceTrust: "LOCAL_AGENT_ATTESTED" | "USER_UPLOADED";
  ancestryVerified: boolean | null;
  diffHash?: string;
  evidence: Record<string, unknown>;
  sourceFact: string;
  reason: string;
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "결정 대기",
  APPLIED: "스펙 적용",
  NO_SPEC_CHANGE: "스펙 영향 없음",
  STALE_SPEC: "스펙 충돌",
  AWAITING_SOURCE_FIX: "소스 수정 대기",
  RESOLVED: "후속 조치 연결",
  ROLLED_BACK: "적용 취소",
  BATCH_CONFLICT: "배치 제안 충돌",
};

export function ReconcileItemCard({
  index,
  item,
  members,
  canReview,
  canRollback,
  checkpointType,
  candidateSource,
  bulkSelectable,
  bulkSelected,
  isPending,
  onDecision,
  onReanalyze,
  onRollback,
  onConfirmSourceFix,
  onResolveBatchConflict,
  onBulkSelectedChange,
}: {
  index: number;
  item: ReconcileItem;
  members: ProjectMember[];
  canReview: boolean;
  canRollback: boolean;
  checkpointType: "GIT_COMMIT" | "SOURCE_MANIFEST";
  candidateSource: "USER_SELECTED" | "AI_SUPPLEMENTED";
  bulkSelectable: boolean;
  bulkSelected: boolean;
  isPending: boolean;
  onDecision: (itemId: string, payload: DecisionPayload) => void;
  onReanalyze: (
    itemId: string,
    input: {
      proposedValue: string;
      sourceFact: string;
      inferredImpact?: string;
      risk: string;
      confidence: string;
    },
  ) => void;
  onRollback: (itemId: string, reason: string) => void;
  onConfirmSourceFix: (itemId: string, payload: SourceFixPayload) => void;
  onResolveBatchConflict: (itemId: string, batchId: string) => void;
  onBulkSelectedChange: (itemId: string, selected: boolean) => void;
}) {
  const [action, setAction] = useState<DecisionPayload["action"]>("APPLY_SPEC");
  const [reason, setReason] = useState("");
  const [ownerMemberId, setOwnerMemberId] = useState("");
  const [reviewerMemberId, setReviewerMemberId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [reanalyzedProposal, setReanalyzedProposal] = useState(
    item.proposedValue,
  );
  const [rollbackReason, setRollbackReason] = useState("");
  const [fixHead, setFixHead] = useState("");
  const [fixDiffHash, setFixDiffHash] = useState("");
  const [fixSourceFact, setFixSourceFact] = useState("");
  const [fixReason, setFixReason] = useState("");
  const [fixAncestryVerified, setFixAncestryVerified] = useState(false);

  function submitDecision(useMergePreview = false) {
    if (
      action !== "APPLY_SPEC" &&
      !reason.trim()
    ) {
      toast.error("결정 사유를 입력해 주세요.");
      return;
    }
    if (action === "ACCEPT_EXCEPTION" && (!ownerMemberId || !expiresAt)) {
      toast.error("임시 예외 담당자와 만료일을 선택해 주세요.");
      return;
    }
    if (action === "MODEL_GAP" && !reviewerMemberId) {
      toast.error("설계 모델 보완 검토자를 선택해 주세요.");
      return;
    }
    onDecision(item.itemId, {
      action,
      reason: reason.trim() || undefined,
      useMergePreview,
      exceptionOwnerMemberId:
        action === "ACCEPT_EXCEPTION" ? ownerMemberId : undefined,
      exceptionExpiresAt:
        action === "ACCEPT_EXCEPTION"
          ? new Date(expiresAt).toISOString()
          : undefined,
      reviewerMemberId:
        action === "MODEL_GAP" ? reviewerMemberId : undefined,
    });
  }

  const isOpen = item.status === "PENDING";
  const batchConflicts = getBatchConflictCandidates(item.mergeConflicts);
  return (
    <article className="sp-group sp-reconcile-item">
      <div className="sp-group-header">
        <div>
          <h2 className="sp-group-title">
            변경 후보 {index} · {hierarchyPath(item.targetHierarchy)}
          </h2>
          <div className="sp-reconcile-path">
            {item.targetRefType}.{item.targetField} · {item.targetRefId}
          </div>
        </div>
        <div className="sp-reconcile-badge-row">
          {bulkSelectable ? (
            <label className="sp-checkbox-wrap">
              <input
                className="sp-checkbox"
                type="checkbox"
                checked={bulkSelected}
                onChange={(event) =>
                  onBulkSelectedChange(item.itemId, event.target.checked)
                }
              />
              일괄 적용 선택
            </label>
          ) : null}
          <span className={`sp-badge ${riskBadgeClass(item.risk)}`}>
            위험 {item.risk}
          </span>
          <span className="sp-badge sp-badge-info">
            확신 {item.confidence}
          </span>
          <span className="sp-badge sp-badge-neutral">
            {item.classification}
          </span>
          <span className="sp-badge sp-badge-neutral">
            {candidateSource === "USER_SELECTED"
              ? "사용자 선택 대상"
              : "AI 보완 후보"}
          </span>
          <span className={`sp-badge ${itemStatusBadgeClass(item.status)}`}>
            {STATUS_LABEL[item.status] ?? item.status}
          </span>
        </div>
      </div>

      <div className="sp-group-body">
        <div className="sp-reconcile-evidence-grid">
          <section className="sp-reconcile-evidence is-fact">
            <h3 className="sp-reconcile-evidence-title">확인된 소스 사실</h3>
            <p className="sp-reconcile-evidence-copy">{item.sourceFact}</p>
          </section>
          <section className="sp-reconcile-evidence is-inference">
            <h3 className="sp-reconcile-evidence-title">AI 영향 추론</h3>
            <p className="sp-reconcile-evidence-copy">
              {item.inferredImpact || "추론 없음"}
            </p>
          </section>
        </div>

        <div className="sp-section-title">제안 스펙 Diff</div>
        <FocusedDiff before={item.beforeValue} after={item.proposedValue} />

        {item.status === "BATCH_CONFLICT" ? (
          <section className="sp-reconcile-merge">
            <div className="sp-reconcile-notice is-error">
              여러 분석 배치가 같은 스펙에 서로 다른 값 또는 분류를 제안했습니다. 근거를
              비교한 뒤 사용할 제안을 선택해야 일반 검토를 진행할 수 있습니다.
            </div>
            <div className="sp-reconcile-conflict-list">
              {batchConflicts.map((candidate) => (
                <article
                  key={`${item.itemId}-${candidate.batchId}`}
                  className="sp-reconcile-conflict-candidate"
                >
                  <div className="sp-reconcile-evidence-title">
                    {candidate.batchName || candidate.batchId}
                  </div>
                  <div className="sp-reconcile-badge-row">
                    <span className="sp-badge sp-badge-neutral">
                      {candidate.classification}
                    </span>
                    <span className={`sp-badge ${riskBadgeClass(candidate.risk)}`}>
                      위험 {candidate.risk}
                    </span>
                    <span className="sp-badge sp-badge-info">
                      확신 {candidate.confidence}
                    </span>
                  </div>
                  <p className="sp-reconcile-evidence-copy">
                    {candidate.sourceFact}
                  </p>
                  <FocusedDiff
                    before={item.beforeValue}
                    after={candidate.proposedValue}
                    label="배치 제안"
                  />
                  {canReview ? (
                    <button
                      type="button"
                      className="sp-btn sp-btn-primary sp-btn-sm sp-reconcile-action-top"
                      disabled={isPending}
                      onClick={() =>
                        onResolveBatchConflict(item.itemId, candidate.batchId)
                      }
                    >
                      이 제안으로 검토 계속
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {item.mergePreview ? (
          <section className="sp-reconcile-merge">
            <div className="sp-reconcile-evidence-title">
              겹치지 않는 최신 스펙 변경을 합친 3-way 병합안
            </div>
            <FocusedDiff
              before={item.beforeValue}
              after={item.mergePreview}
              label="3-way 병합 결과"
            />
            {isOpen && canReview ? (
              <button
                type="button"
                className="sp-btn sp-btn-primary sp-reconcile-action-top"
                disabled={isPending}
                onClick={() =>
                  onDecision(item.itemId, {
                    action: "APPLY_SPEC",
                    reason: "검토자가 3-way 병합 결과를 확인했습니다.",
                    useMergePreview: true,
                  })
                }
              >
                병합 결과 적용
              </button>
            ) : null}
          </section>
        ) : null}

        {isOpen && canReview ? (
          <div className="sp-reconcile-decision">
            <div className="sp-reconcile-decision-grid">
              <div className="sp-field">
                <label className="sp-label" htmlFor={`action-${item.itemId}`}>
                  결정
                </label>
                <select
                  id={`action-${item.itemId}`}
                  className="sp-input"
                  value={action}
                  onChange={(event) =>
                    setAction(event.target.value as DecisionPayload["action"])
                  }
                >
                  <option value="APPLY_SPEC">스펙에 반영</option>
                  <option value="FIX_SOURCE">소스 수정 요청</option>
                  <option value="NO_SPEC_CHANGE">스펙 영향 없음</option>
                  <option value="ACCEPT_EXCEPTION">임시 예외 승인</option>
                  <option value="MODEL_GAP">설계 모델 보완</option>
                  <option value="DEFERRED">판단 보류</option>
                </select>
              </div>
              {action === "ACCEPT_EXCEPTION" ? (
                <>
                  <MemberSelect
                    id={`owner-${item.itemId}`}
                    label="예외 담당자"
                    members={members}
                    value={ownerMemberId}
                    onChange={setOwnerMemberId}
                  />
                  <div className="sp-field">
                    <label className="sp-label" htmlFor={`expiry-${item.itemId}`}>
                      만료일
                    </label>
                    <input
                      id={`expiry-${item.itemId}`}
                      className="sp-input"
                      type="datetime-local"
                      value={expiresAt}
                      onChange={(event) => setExpiresAt(event.target.value)}
                    />
                  </div>
                </>
              ) : null}
              {action === "MODEL_GAP" ? (
                <MemberSelect
                  id={`reviewer-${item.itemId}`}
                  label="보완 검토자"
                  members={members}
                  value={reviewerMemberId}
                  onChange={setReviewerMemberId}
                />
              ) : null}
            </div>
            <textarea
              className="sp-input sp-reconcile-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                action === "APPLY_SPEC"
                  ? "적용 사유(선택)"
                  : "결정 사유(필수)"
              }
            />
            <button
              type="button"
              className="sp-btn sp-btn-primary"
              disabled={isPending}
              onClick={() => submitDecision()}
            >
              결정 저장
            </button>
          </div>
        ) : null}

        {item.status === "STALE_SPEC" && canReview ? (
          <div className="sp-reconcile-decision">
            <div className="sp-reconcile-evidence-title">
              최신 스펙 기준 재분석
            </div>
            <textarea
              className="sp-input sp-reconcile-proposal-editor"
              value={reanalyzedProposal}
              onChange={(event) => setReanalyzedProposal(event.target.value)}
            />
            <button
              type="button"
              className="sp-btn sp-btn-secondary"
              disabled={isPending}
              onClick={() =>
                onReanalyze(item.itemId, {
                  proposedValue: reanalyzedProposal,
                  sourceFact: item.sourceFact,
                  inferredImpact: item.inferredImpact ?? undefined,
                  risk: item.risk,
                  confidence: item.confidence,
                })
              }
            >
              최신 스펙을 before로 다시 설정
            </button>
          </div>
        ) : null}

        {item.status === "AWAITING_SOURCE_FIX" && canReview ? (
          <div className="sp-reconcile-decision">
            <div className="sp-reconcile-evidence-title">
              수정된 소스 증거 확인
            </div>
            <p className="sp-reconcile-evidence-copy">
              가능하면 로컬에서 <code className="sp-code">/sync-specode</code>를
              다시 실행하세요. 아래 입력은 외부 작업 결과를 수동 확인할 때 사용합니다.
            </p>
            <div className="sp-reconcile-decision-grid">
              <div className="sp-field">
                <label className="sp-label" htmlFor={`fix-head-${item.itemId}`}>
                  최종 {checkpointType}
                </label>
                <input
                  id={`fix-head-${item.itemId}`}
                  className="sp-input"
                  value={fixHead}
                  onChange={(event) => setFixHead(event.target.value)}
                />
              </div>
              <div className="sp-field">
                <label className="sp-label" htmlFor={`fix-diff-${item.itemId}`}>
                  Diff SHA-256 (선택)
                </label>
                <input
                  id={`fix-diff-${item.itemId}`}
                  className="sp-input"
                  value={fixDiffHash}
                  onChange={(event) => setFixDiffHash(event.target.value)}
                />
              </div>
            </div>
            {checkpointType === "GIT_COMMIT" ? (
              <label className="sp-checkbox-wrap">
                <input
                  className="sp-checkbox"
                  type="checkbox"
                  checked={fixAncestryVerified}
                  onChange={(event) =>
                    setFixAncestryVerified(event.target.checked)
                  }
                />
                base commit이 최종 commit의 조상임을 확인함
              </label>
            ) : null}
            <textarea
              className="sp-input sp-reconcile-reason"
              value={fixSourceFact}
              onChange={(event) => setFixSourceFact(event.target.value)}
              placeholder="수정된 소스에서 직접 확인한 사실"
            />
            <textarea
              className="sp-input sp-reconcile-reason"
              value={fixReason}
              onChange={(event) => setFixReason(event.target.value)}
              placeholder="해결로 판단한 이유"
            />
            <button
              type="button"
              className="sp-btn sp-btn-primary"
              disabled={
                isPending ||
                !fixHead.trim() ||
                !fixSourceFact.trim() ||
                !fixReason.trim() ||
                (checkpointType === "GIT_COMMIT" && !fixAncestryVerified)
              }
              onClick={() =>
                onConfirmSourceFix(item.itemId, {
                  checkpointType,
                  headCheckpoint: fixHead.trim(),
                  evidenceTrust: "USER_UPLOADED",
                  ancestryVerified:
                    checkpointType === "GIT_COMMIT"
                      ? fixAncestryVerified
                      : null,
                  diffHash: fixDiffHash.trim() || undefined,
                  evidence: {
                    submittedFrom: "WEB_REVIEW",
                    sourceFact: fixSourceFact.trim(),
                  },
                  sourceFact: fixSourceFact.trim(),
                  reason: fixReason.trim(),
                })
              }
            >
              보완 증거 저장
            </button>
          </div>
        ) : null}

        {!isOpen && item.decision ? (
          <div className="sp-reconcile-decision">
            <div className="sp-reconcile-evidence-title">
              결정 · {item.decision}
            </div>
            <div className="sp-reconcile-evidence-copy">
              {item.decisionReason || "결정 사유 없음"}
            </div>
            {item.followupTaskId ? (
              <div className="sp-reconcile-path">
                후속 AI 태스크 · {item.followupTaskId}
              </div>
            ) : null}
            {item.reviewRequestId ? (
              <div className="sp-reconcile-path">
                설계 보완 리뷰 · {item.reviewRequestId}
              </div>
            ) : null}
            {item.exceptionExpiresAt ? (
              <div className="sp-reconcile-path">
                예외 만료 · {formatDate(item.exceptionExpiresAt)}
              </div>
            ) : null}
          </div>
        ) : null}

        {item.status === "APPLIED" && canRollback ? (
          <div className="sp-reconcile-decision">
            <div className="sp-reconcile-evidence-title">적용 rollback</div>
            <p className="sp-reconcile-evidence-copy">
              적용 직후 값이 그대로일 때만 되돌립니다. 되돌린 뒤에는 현재 source
              baseline 기준의 새 검토 건이 자동으로 생성됩니다.
            </p>
            <textarea
              className="sp-input sp-reconcile-reason"
              value={rollbackReason}
              onChange={(event) => setRollbackReason(event.target.value)}
              placeholder="되돌리는 이유(필수)"
            />
            <button
              type="button"
              className="sp-btn sp-btn-danger"
              disabled={isPending || !rollbackReason.trim()}
              onClick={() => onRollback(item.itemId, rollbackReason.trim())}
            >
              적용 취소 후 재검토 열기
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function MemberSelect({
  id,
  label,
  members,
  value,
  onChange,
}: {
  id: string;
  label: string;
  members: ProjectMember[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="sp-field">
      <label className="sp-label" htmlFor={id}>{label}</label>
      <select
        id={id}
        className="sp-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">선택</option>
        {members.map((member) => (
          <option key={member.memberId} value={member.memberId}>
            {member.name || member.email} · {member.role}/{member.job}
          </option>
        ))}
      </select>
    </div>
  );
}

function hierarchyPath(hierarchy: Hierarchy) {
  return [
    hierarchy.unitWork,
    hierarchy.screen,
    hierarchy.area,
    hierarchy.function,
  ]
    .filter((node): node is HierarchyNode => Boolean(node))
    .map((node) => `[${node.displayId}] ${node.name}`)
    .join(" > ");
}

function itemStatusBadgeClass(status: string) {
  if (["APPLIED", "NO_SPEC_CHANGE", "RESOLVED"].includes(status)) {
    return "sp-badge-success";
  }
  if (["STALE_SPEC", "BATCH_CONFLICT"].includes(status)) return "sp-badge-error";
  if (status === "AWAITING_SOURCE_FIX") return "sp-badge-info";
  return "sp-badge-warning";
}

function getBatchConflictCandidates(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const candidates = (value as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return [];
    }
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.batchId !== "string" ||
      typeof record.proposedValue !== "string" ||
      typeof record.sourceFact !== "string"
    ) {
      return [];
    }
    return [{
      batchId: record.batchId,
      batchName: typeof record.batchName === "string" ? record.batchName : "",
      proposedValue: record.proposedValue,
      sourceFact: record.sourceFact,
      classification:
        typeof record.classification === "string"
          ? record.classification
          : "UNKNOWN",
      risk: typeof record.risk === "string" ? record.risk : "MEDIUM",
      confidence:
        typeof record.confidence === "string" ? record.confidence : "LOW",
    }];
  });
}

function riskBadgeClass(risk: string) {
  if (risk === "CRITICAL" || risk === "HIGH") return "sp-badge-error";
  if (risk === "MEDIUM") return "sp-badge-warning";
  return "sp-badge-info";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
