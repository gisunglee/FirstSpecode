"use client";

/**
 * 스펙 반영함 목록 (PID-00063)
 *
 * 구현요청과 후속 수정에서 접수된 receipt를 한 목록에 보여준다.
 * 결정은 상세 화면에서만 수행해 목록의 역할을 탐색과 상태 확인으로 제한한다.
 */

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { SourceBaselinePanel } from "./_components/SourceBaselinePanel";

type ReceiptRow = {
  receiptId: string;
  originType: string;
  aiTaskId: string | null;
  summary: string;
  status: string;
  reviewStatus: string;
  submitMemberName: string;
  itemCount: number;
  unresolvedCount: number;
  highestRisk: string;
  createdAt: string;
  closedAt: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "미커밋 초안",
  NEEDS_REVIEW: "검토 필요",
  CLOSED: "정합성 확정",
  STALE_BASELINE: "기준점 충돌",
};

const FILTERS = [
  { code: "ALL", label: "전체" },
  { code: "DRAFT", label: "초안" },
  { code: "NEEDS_REVIEW", label: "검토 필요" },
  { code: "CLOSED", label: "확정" },
  { code: "STALE_BASELINE", label: "기준점 충돌" },
] as const;

export default function SpecReconciliationsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["code"]>("ALL");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["spec-reconciliations", projectId],
    queryFn: () =>
      authFetch<{ data: { items: ReceiptRow[] } }>(
        `/api/projects/${projectId}/spec-reconciliations`,
      ).then((response) => response.data),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) =>
        item.reviewStatus === "ANALYZING",
      )
        ? 5_000
        : false,
  });

  const rows = useMemo(() => {
    const items = data?.items ?? [];
    return filter === "ALL"
      ? items
      : items.filter((item) => item.status === filter);
  }, [data?.items, filter]);

  return (
    <main className="sp-reconcile-page">
      <header className="sp-reconcile-header">
        <div>
          <h1 className="sp-reconcile-heading">스펙 반영함</h1>
          <p className="sp-reconcile-subtitle">
            실제 구현과 설계가 달라진 후보를 확인하고, 승인한 변경만 스펙에 반영합니다.
          </p>
        </div>
        <div className="sp-reconcile-table-summary">
          미결 {data?.items.filter((item) => item.unresolvedCount > 0).length ?? 0}건
        </div>
      </header>

      <SourceBaselinePanel projectId={projectId} />

      <section className="sp-group">
        <div className="sp-group-header">
          <h2 className="sp-group-title">후속 변경 제출</h2>
        </div>
        <div className="sp-group-body">
          <div className="sp-reconcile-evidence-copy">
            개발 완료 후 직접 수정한 소스는 로컬에서{" "}
            <code className="sp-code">/sync-specode</code>를 실행합니다. 관련 범위를
            알고 있으면 <code className="sp-code">/sync-specode UW-XXXXX</code>로
            좁힐 수 있습니다.
          </div>
        </div>
      </section>

      <nav className="sp-reconcile-filter-row" aria-label="접수 상태 필터">
        {FILTERS.map((item) => (
          <button
            key={item.code}
            type="button"
            className={`sp-btn sp-btn-sm ${
              filter === item.code ? "sp-btn-primary is-active" : "sp-btn-secondary"
            }`}
            onClick={() => setFilter(item.code)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {isLoading ? (
        <div className="sp-reconcile-loading" aria-label="불러오는 중">
          <span className="sp-spinner sp-spinner-lg" />
        </div>
      ) : isError ? (
        <div className="sp-empty">
          <div className="sp-empty-title">스펙 반영함을 불러오지 못했습니다.</div>
          <div className="sp-empty-desc">잠시 후 다시 시도해 주세요.</div>
        </div>
      ) : rows.length === 0 ? (
        <div className="sp-empty">
          <div className="sp-empty-title">검토할 구현 변경이 없습니다.</div>
          <div className="sp-empty-desc">
            구현 작업자가 편차를 제출하면 이곳에 접수됩니다.
          </div>
        </div>
      ) : (
        <section className="sp-table-wrap" aria-label="스펙 변경 접수 목록">
          <table className="sp-table">
            <thead>
              <tr>
                <th>변경 요약</th>
                <th>출처</th>
                <th>상태</th>
                <th>위험도</th>
                <th>항목</th>
                <th>제출자</th>
                <th>접수일</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.receiptId}
                  tabIndex={0}
                  onClick={() =>
                    router.push(
                      `/projects/${projectId}/spec-reconciliations/${row.receiptId}`,
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      router.push(
                        `/projects/${projectId}/spec-reconciliations/${row.receiptId}`,
                      );
                    }
                  }}
                >
                  <td>
                    <div className="sp-reconcile-table-title">
                      {row.summary || "구현 변경 스펙 검토"}
                    </div>
                    <div className="sp-reconcile-table-subtitle">
                      {row.aiTaskId ? `AI 태스크 ${row.aiTaskId}` : row.receiptId}
                    </div>
                  </td>
                  <td>{row.originType === "IMPLEMENTATION" ? "구현요청" : "후속 수정"}</td>
                  <td>
                    <span className={`sp-badge ${statusBadgeClass(row.status)}`}>
                      {reviewStatusLabel(row.reviewStatus) ??
                        STATUS_LABEL[row.status] ?? row.status}
                    </span>
                  </td>
                  <td>
                    <span className={`sp-badge ${riskBadgeClass(row.highestRisk)}`}>
                      {row.highestRisk}
                    </span>
                  </td>
                  <td>
                    {row.unresolvedCount}/{row.itemCount} 미결
                  </td>
                  <td>{row.submitMemberName}</td>
                  <td>{formatDate(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

function reviewStatusLabel(status: string) {
  if (status === "ANALYZING") return "자동 비교 중";
  if (status === "ANALYSIS_FAILED") return "AI 분석 실패";
  if (status === "ANALYSIS_PARTIAL_FAILED") return "일부 배치 실패";
  if (status === "BATCH_CONFLICT") return "배치 제안 충돌";
  return null;
}

function statusBadgeClass(status: string) {
  if (status === "CLOSED") return "sp-badge-success";
  if (status === "STALE_BASELINE") return "sp-badge-error";
  if (status === "DRAFT") return "sp-badge-info";
  return "sp-badge-warning";
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
