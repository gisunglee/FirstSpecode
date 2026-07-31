"use client";

import type { ReconcileBatch } from "./types";

const STATUS_LABEL: Record<string, string> = {
  PLANNED: "계획됨",
  PENDING: "대기",
  ANALYZING: "분석 중",
  COMPLETED: "완료",
  FAILED: "실패",
  SUPERSEDED: "이전 분석",
};

export function BatchProgressPanel({
  batches,
  selectedBatchId,
  canRetry,
  retryPending,
  onSelect,
  onRetry,
}: {
  batches: ReconcileBatch[];
  selectedBatchId: string | null;
  canRetry: boolean;
  retryPending: boolean;
  onSelect: (batchId: string | null) => void;
  onRetry: (batchId: string) => void;
}) {
  if (batches.length === 0) return null;
  const activeBatches = batches.filter((batch) => batch.status !== "SUPERSEDED");
  const analysisBatches = activeBatches.filter(
    (batch) => batch.scopeType !== "ROUTER",
  );
  const completed = analysisBatches.filter((batch) => batch.status === "COMPLETED").length;
  const failed = activeBatches.filter((batch) => batch.status === "FAILED").length;
  const routing = activeBatches.some(
    (batch) =>
      batch.scopeType === "ROUTER" &&
      ["PENDING", "ANALYZING"].includes(batch.status),
  );

  return (
    <section className="sp-group">
      <div className="sp-group-header">
        <div>
          <h2 className="sp-group-title">자동 비교 배치</h2>
          <div className="sp-reconcile-path">
            {routing
              ? "변경 파일 영향 범위 분류 중"
              : `분석 ${completed}/${analysisBatches.length} 완료`}
            {failed > 0 ? ` · 실패 ${failed}건` : ""}
          </div>
        </div>
        <button
          type="button"
          className={`sp-btn sp-btn-sm ${selectedBatchId ? "sp-btn-secondary" : "sp-btn-primary"}`}
          onClick={() => onSelect(null)}
        >
          전체 결과
        </button>
      </div>
      <div className="sp-group-body">
        <div className="sp-reconcile-batch-list">
          {batches.map((batch) => {
            const paths = Array.isArray(batch.sourcePaths)
              ? batch.sourcePaths.length
              : 0;
            return (
              <div
                key={batch.batchId}
                className={`sp-reconcile-batch-row ${selectedBatchId === batch.batchId ? "is-selected" : ""}`}
              >
                <button
                  type="button"
                  className="sp-reconcile-batch-main"
                  disabled={batch.scopeType === "ROUTER"}
                  onClick={() => onSelect(batch.batchId)}
                >
                  <span className="sp-reconcile-batch-order">
                    {batch.batchNo}
                  </span>
                  <span>
                    <span className="sp-reconcile-table-title">
                      {batch.scopeName}
                    </span>
                    <span className="sp-reconcile-table-subtitle">
                      {batch.scopeType} · 파일 {paths} · 설계 대상 {batch.targetCount}
                    </span>
                  </span>
                </button>
                <div className="sp-reconcile-badge-row">
                  <span className={`sp-badge ${batchStatusClass(batch.status)}`}>
                    {STATUS_LABEL[batch.status] ?? batch.status}
                  </span>
                  {batch.status === "FAILED" && canRetry ? (
                    <button
                      type="button"
                      className="sp-btn sp-btn-secondary sp-btn-xs"
                      disabled={retryPending}
                      onClick={() => onRetry(batch.batchId)}
                    >
                      실패 배치 재시도
                    </button>
                  ) : null}
                </div>
                {batch.failure ? (
                  <div className="sp-hint is-err">{batch.failure}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function batchStatusClass(status: string) {
  if (status === "COMPLETED") return "sp-badge-success";
  if (status === "FAILED") return "sp-badge-error";
  if (status === "ANALYZING") return "sp-badge-info";
  if (status === "SUPERSEDED") return "sp-badge-neutral";
  return "sp-badge-warning";
}
