"use client";

/** 동기화 실행의 근거를 검토하고 항목별 결정을 내리는 상세 화면. */

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { usePermissions } from "@/hooks/useMyRole";
import {
  ResultSection,
  SummaryCell,
} from "../_components/SyncResultSection";
import {
  formatDate,
  statusBadgeClass,
  verdictLabel,
} from "../_components/labels";
import type { SyncRunDetail } from "../_components/types";

const STATUS_LABEL: Record<string, string> = {
  RUNNING: "분석 중",
  NEEDS_INPUT: "범위 확인 필요",
  NEEDS_REVIEW: "검토 필요",
  COMPLETED: "완료",
  FAILED: "실패",
  CANCELLED: "취소",
};

export default function SpecSyncDetailPage() {
  const { id: projectId, runId } = useParams<{
    id: string;
    runId: string;
  }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { has } = usePermissions(projectId);
  const canReview = has("specSync.review");
  const canApply = has("specSync.apply");
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const { data, isLoading, isError } = useQuery({
    queryKey: ["spec-sync", projectId, runId],
    queryFn: () =>
      authFetch<{ data: SyncRunDetail }>(
        `/api/projects/${projectId}/spec-syncs/${runId}`,
      ).then((response) => response.data),
    refetchInterval: (query) =>
      ["RUNNING", "NEEDS_INPUT"].includes(query.state.data?.status ?? "")
        ? 5_000
        : false,
  });

  const decide = useMutation({
    mutationFn: ({
      itemId,
      decision,
      reason,
    }: {
      itemId: string;
      decision: "APPLY" | "REJECT" | "DEFER";
      reason: string;
    }) =>
      authFetch<{
        data: {
          kind: string;
          runStatus: string;
          currentValue?: string;
        };
      }>(
        `/api/projects/${projectId}/spec-syncs/${runId}/items/${itemId}/decision`,
        { method: "POST", body: JSON.stringify({ decision, reason }) },
      ).then((response) => response.data),
    onSuccess: (result) => {
      if (result.kind === "DESIGN_CHANGED") {
        toast.warning("분석 뒤 설계가 변경되어 적용하지 않았습니다. 세 값을 확인해 주세요.");
      } else {
        toast.success(result.kind === "APPLIED" ? "설계 설명에 반영했습니다." : "결정을 저장했습니다.");
      }
      queryClient.invalidateQueries({ queryKey: ["spec-sync", projectId, runId] });
      queryClient.invalidateQueries({ queryKey: ["spec-syncs", projectId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) {
    return (
      <main className="sp-reconcile-page">
        <div className="sp-reconcile-loading"><span className="sp-spinner sp-spinner-lg" /></div>
      </main>
    );
  }
  if (isError || !data) {
    return (
      <main className="sp-reconcile-page">
        <div className="sp-empty">
          <div className="sp-empty-title">동기화 결과를 불러오지 못했습니다.</div>
          <button type="button" className="sp-btn sp-btn-secondary" onClick={() => router.back()}>
            목록으로
          </button>
        </div>
      </main>
    );
  }

  const implementationItems = data.items.filter(
    (item) => item.findingType === "IMPLEMENTATION",
  );
  const coverageItems = data.items.filter(
    (item) => item.findingType === "DESIGN_COVERAGE",
  );

  return (
    <main className="sp-reconcile-page">
      <header className="sp-reconcile-header">
        <div>
          <button
            type="button"
            className="sp-btn sp-btn-ghost sp-btn-sm"
            onClick={() => router.push(`/projects/${projectId}/spec-reconciliations`)}
          >
            ← 스펙 동기화
          </button>
          <h1 className="sp-reconcile-heading">
            {data.unitWorkDisplayId} {data.unitWorkName}
          </h1>
          <p className="sp-reconcile-subtitle">
            구현 여부와 설계 누락 후보를 분리해 보고, 항목별로 결정합니다.
          </p>
        </div>
        <span className={`sp-badge sp-badge-lg ${statusBadgeClass(data.status)}`}>
          {STATUS_LABEL[data.status] ?? data.status}
        </span>
      </header>

      <section className="sp-group">
        <div className="sp-group-header"><h2 className="sp-group-title">실행 요약</h2></div>
        <div className="sp-group-body">
          <div className="sp-reconcile-summary-grid">
            <SummaryCell label="모드" value={data.mode === "CHECK" ? "기본 점검" : "정밀 동기화"} />
            <SummaryCell label="구현 정합성" value={verdictLabel(data.implementationVerdict)} />
            <SummaryCell label="설계 커버리지" value={verdictLabel(data.designCoverageVerdict)} />
            <SummaryCell label="점검 대상" value={`${data.summary.evaluatedTargetCount}건`} />
            <SummaryCell label="구현 정상" value={`${data.summary.normalTargetCount}건`} />
            <SummaryCell label="문제" value={`${data.summary.issueCount}건`} />
            <SummaryCell label="요청일" value={formatDate(data.createdAt)} />
          </div>
          {data.summary.normalTargetCount > 0 ? (
            <div className="sp-reconcile-notice is-info sp-reconcile-action-top">
              구현 정상 {data.summary.normalTargetCount}건은 상세 표시를 생략하고 점검 완료 수에만 반영했습니다.
            </div>
          ) : null}
          {data.failure ? <div className="sp-reconcile-notice is-error">{data.failure}</div> : null}
          {data.status === "NEEDS_INPUT" ? (
            <div className="sp-reconcile-notice is-info">
              관련 소스 범위를 확정하지 못했습니다. 로컬 명령에서 다음 질문에 답한 뒤 다시 제출하세요.
              {(data.sourceScope?.questions ?? []).map((question) => (
                <div key={question} className="sp-reconcile-table-subtitle">• {question}</div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <ResultSection
        title="1. 설계대로 구현됐는지"
        description="설계와 다르거나 구현 여부를 확인할 수 없는 문제만 표시합니다."
        emptyTitle="구현 정합성 문제가 없습니다."
        items={implementationItems}
        canReview={canReview}
        canApply={canApply}
        reasons={reasons}
        setReason={(itemId, reason) => setReasons((current) => ({ ...current, [itemId]: reason }))}
        decide={(itemId, decision, reason) => decide.mutate({ itemId, decision, reason })}
        deciding={decide.isPending}
      />

      <ResultSection
        title="2. 설계에 빠진 중요한 내용이 있는지"
        description={
          data.mode === "CHECK"
            ? "사용자 기능·보안·업무 규칙·데이터 변경처럼 중요한 누락 후보만 표시합니다."
            : "관련 소스를 역설계해 중요 누락과 일반 누락을 함께 표시합니다."
        }
        emptyTitle="검토할 설계 누락 후보가 없습니다."
        items={coverageItems}
        canReview={canReview}
        canApply={canApply}
        reasons={reasons}
        setReason={(itemId, reason) => setReasons((current) => ({ ...current, [itemId]: reason }))}
        decide={(itemId, decision, reason) => decide.mutate({ itemId, decision, reason })}
        deciding={decide.isPending}
      />

      <section className="sp-group">
        <div className="sp-group-header"><h2 className="sp-group-title">확인한 소스 범위</h2></div>
        <div className="sp-group-body">
          {(data.sourceScope?.files ?? []).length === 0 ? (
            <div className="sp-empty-desc">확정된 소스 범위가 없습니다.</div>
          ) : (
            <div className="sp-reconcile-item-list">
              {data.sourceScope?.files?.map((file) => (
                <div key={file.path} className="sp-reconcile-summary-cell">
                  <div className="sp-reconcile-path">{file.path}</div>
                  <div className="sp-reconcile-table-subtitle">{file.kind} · {file.reason}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
