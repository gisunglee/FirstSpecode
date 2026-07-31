"use client";

/**
 * 스펙 반영 검토 상세 (PID-00064)
 *
 * 증거 검증과 의미 추론을 분리하고, 항목별 6가지 결정 및 receipt 최종 확정을 수행한다.
 */

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import {
  ReconcileItemCard,
  type DecisionPayload,
  type SourceFixPayload,
} from "../_components/ReconcileItemCard";
import { BatchProgressPanel } from "../_components/BatchProgressPanel";
import type {
  ProjectMember,
  ReceiptDetail,
} from "../_components/types";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "미커밋 초안",
  NEEDS_REVIEW: "검토 필요",
  CLOSED: "정합성 확정",
  STALE_BASELINE: "기준점 충돌",
};

export default function SpecReconciliationDetailPage() {
  const { id: projectId, receiptId } = useParams<{
    id: string;
    receiptId: string;
  }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [overrideReason, setOverrideReason] = useState("");
  const [bulkSelection, setBulkSelection] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["spec-reconciliation", projectId, receiptId],
    queryFn: () =>
      authFetch<{ data: ReceiptDetail }>(
        `/api/projects/${projectId}/spec-reconciliations/${receiptId}`,
      ).then((response) => response.data),
    refetchInterval: (query) => {
      const receipt = query.state.data;
      return receipt?.reviewStatus === "ANALYZING"
        ? 5_000
        : false;
    },
  });
  const { data: memberData } = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () =>
      authFetch<{ data: { members: ProjectMember[] } }>(
        `/api/projects/${projectId}/members`,
      ).then((response) => response.data),
  });

  const decision = useMutation({
    mutationFn: ({
      itemId,
      payload,
    }: {
      itemId: string;
      payload: DecisionPayload;
    }) =>
      authFetch<{ data: { kind: string; receiptClosed?: boolean } }>(
        `/api/projects/${projectId}/spec-reconciliations/${receiptId}` +
          `/items/${itemId}/decision`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      ).then((response) => response.data),
    onSuccess: (result) => {
      toast.success(
        result.receiptClosed
          ? "결정과 source baseline 확정을 함께 완료했습니다."
          : "검토 결정을 저장했습니다.",
      );
      invalidateDetail();
    },
    onError: (error: Error) => {
      toast.error(error.message);
      invalidateDetail();
    },
  });

  const reanalyze = useMutation({
    mutationFn: ({
      itemId,
      input,
    }: {
      itemId: string;
      input: {
        proposedValue: string;
        sourceFact: string;
        inferredImpact?: string;
        risk: string;
        confidence: string;
      };
    }) =>
      authFetch(
        `/api/projects/${projectId}/spec-reconciliations/${receiptId}` +
          `/items/${itemId}/reanalyze`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      toast.success("최신 스펙을 기준으로 후보를 다시 열었습니다.");
      invalidateDetail();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const verify = useMutation({
    mutationFn: (input: { action: "VERIFY" | "OVERRIDE"; reason?: string }) =>
      authFetch<{ data: { receiptClosed: boolean; closeBlockedReason: string | null } }>(
        `/api/projects/${projectId}/spec-reconciliations/${receiptId}/verify`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      ).then((response) => response.data),
    onSuccess: (result) => {
      toast.success(
        result.receiptClosed
          ? "증거 확인과 source baseline 전진을 완료했습니다."
          : "증거를 확인했습니다. 아직 해결되지 않은 항목이 있습니다.",
      );
      invalidateDetail();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rollback = useMutation({
    mutationFn: ({ itemId, reason }: { itemId: string; reason: string }) =>
      authFetch<{ data: { childReceiptId: string } }>(
        `/api/projects/${projectId}/spec-reconciliations/${receiptId}` +
          `/items/${itemId}/rollback`,
        { method: "POST", body: JSON.stringify({ reason }) },
      ).then((response) => response.data),
    onSuccess: (result) => {
      toast.success("적용을 취소하고 새 재검토 건을 만들었습니다.");
      router.push(
        `/projects/${projectId}/spec-reconciliations/${result.childReceiptId}`,
      );
    },
    onError: (error: Error) => {
      toast.error(error.message);
      invalidateDetail();
    },
  });

  const bulkApply = useMutation({
    mutationFn: (itemIds: string[]) =>
      authFetch<{ data: { items: Array<{ itemId: string }> } }>(
        `/api/projects/${projectId}/spec-reconciliations/${receiptId}/apply`,
        {
          method: "POST",
          body: JSON.stringify({
            itemIds,
            reason: "검토자가 낮은 위험도의 구현 상세 항목을 일괄 승인했습니다.",
          }),
        },
      ).then((response) => response.data),
    onSuccess: (result) => {
      toast.success(`${result.items.length}건을 한 트랜잭션으로 적용했습니다.`);
      setBulkSelection(new Set());
      invalidateDetail();
    },
    onError: (error: Error) => {
      toast.error(error.message);
      invalidateDetail();
    },
  });

  const confirmSourceFix = useMutation({
    mutationFn: ({
      itemId,
      payload,
    }: {
      itemId: string;
      payload: SourceFixPayload;
    }) =>
      authFetch<{ data: { receiptClosed: boolean } }>(
        `/api/projects/${projectId}/spec-reconciliations/${receiptId}` +
          `/items/${itemId}/confirm-resolution`,
        { method: "POST", body: JSON.stringify(payload) },
      ).then((response) => response.data),
    onSuccess: (result) => {
      toast.success(
        result.receiptClosed
          ? "소스 보완 확인과 정합성 확정을 완료했습니다."
          : "소스 보완 증거를 저장했습니다.",
      );
      invalidateDetail();
    },
    onError: (error: Error) => {
      toast.error(error.message);
      invalidateDetail();
    },
  });

  const retryBatch = useMutation({
    mutationFn: (batchId: string) =>
      authFetch(
        `/api/projects/${projectId}/spec-reconciliations/${receiptId}` +
          `/batches/${batchId}/retry`,
        { method: "POST" },
      ),
    onSuccess: () => {
      toast.success("실패한 배치를 다시 AI 작업 큐에 등록했습니다.");
      invalidateDetail();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const resolveBatchConflictMutation = useMutation({
    mutationFn: ({ itemId, batchId }: { itemId: string; batchId: string }) =>
      authFetch(
        `/api/projects/${projectId}/spec-reconciliations/${receiptId}` +
          `/items/${itemId}/resolve-batch-conflict`,
        {
          method: "POST",
          body: JSON.stringify({ batchId }),
        },
      ),
    onSuccess: () => {
      toast.success("선택한 배치 제안으로 충돌을 해결했습니다.");
      invalidateDetail();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function invalidateDetail() {
    queryClient.invalidateQueries({
      queryKey: ["spec-reconciliation", projectId, receiptId],
    });
    queryClient.invalidateQueries({
      queryKey: ["spec-reconciliations", projectId],
    });
    queryClient.invalidateQueries({
      queryKey: ["source-baselines", projectId],
    });
  }

  if (isLoading) {
    return (
      <main className="sp-reconcile-page">
        <div className="sp-reconcile-loading">
          <span className="sp-spinner sp-spinner-lg" />
        </div>
      </main>
    );
  }
  if (isError || !data) {
    return (
      <main className="sp-reconcile-page">
        <div className="sp-empty">
          <div className="sp-empty-title">스펙 변경 접수를 불러오지 못했습니다.</div>
          <button
            type="button"
            className="sp-btn sp-btn-secondary"
            onClick={() => router.back()}
          >
            목록으로
          </button>
        </div>
      </main>
    );
  }

  const terminal = data.items.every((item) =>
    ["APPLIED", "NO_SPEC_CHANGE", "RESOLVED", "ROLLED_BACK"].includes(
      item.status,
    ),
  );
  const canVerify =
    data.canApply &&
    data.status === "NEEDS_REVIEW" &&
    data.reviewStatus === "NEEDS_REVIEW" &&
    terminal;
  const members = memberData?.members ?? [];
  const selectedTargetKeys = new Set(
    Array.isArray(data.selectedTargets)
      ? data.selectedTargets
          .filter(
            (target) =>
              target &&
              typeof target.targetRefType === "string" &&
              typeof target.targetRefId === "string",
          )
          .map(
            (target) => `${target.targetRefType}:${target.targetRefId}`,
          )
      : [],
  );
  const visibleItems = selectedBatchId
    ? data.items.filter((item) => itemBelongsToBatch(item.batchOrigin, selectedBatchId))
    : data.items;

  return (
    <main className="sp-reconcile-page">
      <header className="sp-reconcile-header">
        <div>
          <button
            type="button"
            className="sp-btn sp-btn-ghost sp-btn-sm"
            onClick={() =>
              router.push(`/projects/${projectId}/spec-reconciliations`)
            }
          >
            ← 스펙 반영함
          </button>
          <h1 className="sp-reconcile-heading">
            {data.summary || "구현 변경 스펙 검토"}
          </h1>
          <p className="sp-reconcile-subtitle">
            소스 사실과 AI 추론을 구분해 확인하고, 승인한 결정만 반영합니다.
          </p>
        </div>
        <span className={`sp-badge sp-badge-lg ${statusBadgeClass(data.status)}`}>
          {STATUS_LABEL[data.status] ?? data.status}
        </span>
      </header>

      <section className="sp-group">
        <div className="sp-group-header">
          <h2 className="sp-group-title">접수·증거 정보</h2>
        </div>
        <div className="sp-group-body">
          <div className="sp-reconcile-summary-grid">
            <SummaryCell
              label="출처"
              value={data.originType === "IMPLEMENTATION" ? "구현요청" : "후속 수정"}
            />
            <SummaryCell
              label="증거"
              value={`${data.evidenceTrust} · ${data.evidenceVerify}`}
            />
            <SummaryCell
              label="Source"
              value={`${shortHash(data.baseCheckpoint)} → ${shortHash(data.headCheckpoint)}`}
            />
            <SummaryCell
              label="Baseline"
              value={`제출 v${data.submittedBaselineVersion} · 현재 v${data.currentBaselineVersion}`}
            />
            <SummaryCell
              label="Head"
              value={data.headStable ? "확정 checkpoint" : "미커밋 DRAFT"}
            />
            <SummaryCell
              label="Ancestry"
              value={
                data.ancestryVerified == null
                  ? "해당 없음"
                  : data.ancestryVerified
                    ? "정상"
                    : "실패"
              }
            />
            <SummaryCell label="제출자" value={data.submitMemberName} />
            <SummaryCell label="접수일" value={formatDate(data.createdAt)} />
            <SummaryCell label="AI 태스크" value={data.aiTaskId ?? "연결 없음"} />
            <SummaryCell label="분석 버전" value={data.analysisVersion ?? "미기록"} />
            <SummaryCell label="Diff hash" value={shortHash(data.diffHash ?? "미기록")} />
            <SummaryCell label="항목" value={`${data.items.length}건`} />
          </div>
        </div>
      </section>

      {data.status === "DRAFT" ? (
        <section className="sp-reconcile-notice is-info">
          미커밋 변경은 후보 검토용 DRAFT입니다. 소스를 커밋한 뒤 같은{" "}
          <code className="sp-code">/sync-specode</code>를 다시 실행하면 이 receipt가
          최종 checkpoint로 갱신됩니다. DRAFT는 baseline을 전진시키지 않습니다.
        </section>
      ) : null}

      {data.status === "STALE_BASELINE" ? (
        <section className="sp-reconcile-notice is-error">
          다른 receipt가 먼저 source baseline을 전진시켰습니다. 최신 baseline부터 다시{" "}
          <code className="sp-code">/sync-specode</code>를 실행해야 합니다.
        </section>
      ) : null}

      {data.reviewStatus === "ANALYZING" ? (
        <section className="sp-reconcile-notice is-info">
          서버 AI가 source evidence와 설계 컨텍스트를 분석 중입니다. 분석 결과가
          검증되기 전에는 receipt를 확정할 수 없습니다.
        </section>
      ) : null}

      {data.reviewStatus === "ANALYSIS_FAILED" ? (
        <section className="sp-reconcile-notice is-error">
          AI 분석 결과 형식 또는 before 스펙 검증에 실패했습니다. MCP의{" "}
          <code className="sp-code">queue_reconciliation_analysis</code>로 최신
          컨텍스트 분석을 다시 요청하세요.
        </section>
      ) : null}

      {data.reviewStatus === "ANALYSIS_PARTIAL_FAILED" ? (
        <section className="sp-reconcile-notice is-error">
          일부 자동 비교 배치가 실패했습니다. 아래 배치 목록에서 실패 건만 재시도할 수
          있으며, 모든 배치가 완료되기 전에는 정합성을 확정할 수 없습니다.
        </section>
      ) : null}

      {data.reviewStatus === "BATCH_CONFLICT" ? (
        <section className="sp-reconcile-notice is-error">
          서로 다른 배치가 같은 스펙에 다른 값을 제안했습니다. 충돌 항목에서 사용할
          제안을 선택해야 일반 검토를 계속할 수 있습니다.
        </section>
      ) : null}

      <BatchProgressPanel
        batches={data.batches}
        selectedBatchId={selectedBatchId}
        canRetry={data.canApply}
        retryPending={retryBatch.isPending}
        onSelect={setSelectedBatchId}
        onRetry={(batchId) => retryBatch.mutate(batchId)}
      />

      <section className="sp-reconcile-item-list" aria-label="스펙 변경 후보">
        {bulkSelection.size > 0 ? (
          <div className="sp-reconcile-notice is-info">
            <span>
              낮은 위험도의 구현 상세·스펙 명확화 {bulkSelection.size}건 선택
            </span>
            <button
              type="button"
              className="sp-btn sp-btn-primary sp-btn-sm"
              disabled={bulkApply.isPending}
              onClick={() => bulkApply.mutate(Array.from(bulkSelection))}
            >
              선택 항목 일괄 적용
            </button>
          </div>
        ) : null}
        {selectedBatchId && visibleItems.length === 0 ? (
          <div className="sp-empty">
            <div className="sp-empty-title">이 배치에서 생성된 스펙 후보가 없습니다.</div>
            <div className="sp-empty-desc">
              소스 사실만 확인됐거나 스펙 변경이 필요하지 않은 배치입니다.
            </div>
          </div>
        ) : null}
        {visibleItems.map((item, index) => (
          <ReconcileItemCard
            key={item.itemId}
            index={index + 1}
            item={item}
            members={members}
            canReview={
              data.canApply &&
              data.status === "NEEDS_REVIEW" &&
              (data.reviewStatus === "NEEDS_REVIEW" ||
                (data.reviewStatus === "BATCH_CONFLICT" &&
                  item.status === "BATCH_CONFLICT"))
            }
            canRollback={data.canApply && data.status === "CLOSED"}
            checkpointType={
              data.checkpointType as "GIT_COMMIT" | "SOURCE_MANIFEST"
            }
            candidateSource={
              selectedTargetKeys.has(
                `${item.targetRefType}:${item.targetRefId}`,
              )
                ? "USER_SELECTED"
                : "AI_SUPPLEMENTED"
            }
            bulkSelectable={
              data.canApply &&
              data.status === "NEEDS_REVIEW" &&
              data.reviewStatus === "NEEDS_REVIEW" &&
              item.status === "PENDING" &&
              ["LOW", "MEDIUM"].includes(item.risk) &&
              ["IMPLEMENTATION_DETAIL", "SPEC_CLARIFICATION"].includes(
                item.classification,
              )
            }
            bulkSelected={bulkSelection.has(item.itemId)}
            isPending={
              decision.isPending ||
              reanalyze.isPending ||
              rollback.isPending ||
              bulkApply.isPending ||
              confirmSourceFix.isPending ||
              retryBatch.isPending ||
              resolveBatchConflictMutation.isPending
            }
            onDecision={(itemId, payload) =>
              decision.mutate({ itemId, payload })
            }
            onReanalyze={(itemId, input) =>
              reanalyze.mutate({ itemId, input })
            }
            onRollback={(itemId, reason) =>
              rollback.mutate({ itemId, reason })
            }
            onConfirmSourceFix={(itemId, payload) =>
              confirmSourceFix.mutate({ itemId, payload })
            }
            onResolveBatchConflict={(itemId, batchId) =>
              resolveBatchConflictMutation.mutate({ itemId, batchId })
            }
            onBulkSelectedChange={(itemId, selected) =>
              setBulkSelection((current) => {
                const next = new Set(current);
                if (selected) next.add(itemId);
                else next.delete(itemId);
                return next;
              })
            }
          />
        ))}
      </section>

      {canVerify ? (
        <section className="sp-group">
          <div className="sp-group-header">
            <h2 className="sp-group-title">정합성 최종 확정</h2>
          </div>
          <div className="sp-group-body">
            <p className="sp-reconcile-evidence-copy">
              모든 항목이 해결됐습니다. 증거와 최종 checkpoint를 확인하면 receipt 종료와
              source baseline 전진이 같은 트랜잭션으로 실행됩니다.
            </p>
            {data.evidenceTrust === "USER_UPLOADED" && data.canOverride ? (
              <div className="sp-reconcile-decision">
                <textarea
                  className="sp-input sp-reconcile-reason"
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  placeholder="원본 저장소를 별도로 확인한 근거와 override 사유"
                />
                <button
                  type="button"
                  className="sp-btn sp-btn-danger"
                  disabled={verify.isPending || !overrideReason.trim()}
                  onClick={() =>
                    verify.mutate({
                      action: "OVERRIDE",
                      reason: overrideReason.trim(),
                    })
                  }
                >
                  관리자 override로 확정
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="sp-btn sp-btn-success sp-reconcile-action-top"
                disabled={verify.isPending}
                onClick={() => verify.mutate({ action: "VERIFY" })}
              >
                증거 확인 및 정합성 확정
              </button>
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="sp-reconcile-summary-cell">
      <div className="sp-reconcile-summary-label">{label}</div>
      <div className="sp-reconcile-summary-value">{value}</div>
    </div>
  );
}

function shortHash(value: string) {
  return value.length > 16 ? `${value.slice(0, 16)}…` : value;
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

function statusBadgeClass(status: string) {
  if (status === "CLOSED") return "sp-badge-success";
  if (status === "STALE_BASELINE") return "sp-badge-error";
  if (status === "DRAFT") return "sp-badge-info";
  return "sp-badge-warning";
}

function itemBelongsToBatch(value: unknown, batchId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const batchIds = (value as { batchIds?: unknown }).batchIds;
  return Array.isArray(batchIds) && batchIds.includes(batchId);
}
