"use client";

/** 프로젝트의 동기화 절차 안내와 실행 이력을 보여주는 목록 화면. */

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  decisionCountChips,
  formatDate,
  needsReanalysis,
  runStatusBadgeClass,
  runStatusLabel,
  verdictLabel,
} from "./_components/labels";
import type { SyncDecisionCounts } from "./_components/types";

type SyncRunRow = SyncDecisionCounts & {
  syncRunId: string;
  unitWorkDisplayId: string;
  unitWorkName: string;
  mode: string;
  status: string;
  implementationVerdict: string | null;
  designCoverageVerdict: string | null;
  requesterName: string;
  evaluatedTargetCount: number;
  normalTargetCount: number;
  issueCount: number;
  createdAt: string;
};

const FILTERS = [
  { code: "ALL", label: "전체" },
  { code: "RUNNING", label: "분석 중" },
  { code: "NEEDS_INPUT", label: "범위 확인" },
  { code: "NEEDS_REVIEW", label: "검토 필요" },
  { code: "COMPLETED", label: "완료" },
  { code: "FAILED", label: "실패" },
] as const;

export default function SpecReconciliationsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["code"]>("ALL");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["spec-syncs", projectId],
    queryFn: () =>
      authFetch<{ data: { items: SyncRunRow[] } }>(
        `/api/projects/${projectId}/spec-syncs`,
      ).then((response) => response.data),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) =>
        ["RUNNING", "NEEDS_INPUT"].includes(item.status),
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

  // 우상단 요약 — 사람이 손대야 하는 실행 수. 결정 대기와 재분석 필요를 구분한다.
  const reviewCount = data?.items.filter((item) => item.pendingCount > 0).length ?? 0;
  const reanalysisCount =
    data?.items.filter((item) => needsReanalysis(item.status, item.designChangedCount)).length ?? 0;

  return (
    <main className="sp-reconcile-page">
      <header className="sp-reconcile-header">
        <div>
          <h1 className="sp-reconcile-heading">스펙 동기화</h1>
          <p className="sp-reconcile-subtitle">
            현재 UW 설계와 현재 소스를 비교하고, 사람이 승인한 설명만 반영합니다.
          </p>
        </div>
        <div className="sp-reconcile-table-summary">
          검토 필요 {reviewCount}건
          {reanalysisCount > 0 ? ` · 재분석 필요 ${reanalysisCount}건` : ""}
        </div>
      </header>

      <section className="sp-group" aria-labelledby="spec-sync-usage">
        <div className="sp-group-header">
          <h2 id="spec-sync-usage" className="sp-group-title">이용 순서</h2>
        </div>
        <div className="sp-group-body">
          <div className="sp-reconcile-summary-grid">
            <Step number="1" title="UW 지정" copy="개발 저장소에서 /sync-specode UW-XXXXX 실행" />
            <Step number="2" title="현재 상태 비교" copy="AI가 해당 UW 설계 전체와 관련 소스를 직접 대조" />
            <Step number="3" title="근거 검토" copy="구현 불일치와 중요한 설계 누락 후보를 확인" />
            <Step number="4" title="선택 반영" copy="항목별 적용·거부·보류, 승인한 설명만 변경" />
          </div>
          <div className="sp-reconcile-notice is-info sp-reconcile-action-top">
            기본 <code className="sp-code">CHECK</code>를 권장합니다. Git 연결·commit 기준선 없이
            실행 시점의 현재 설계와 현재 소스를 비교합니다.
          </div>
        </div>
      </section>

      <nav className="sp-reconcile-filter-row" aria-label="동기화 상태 필터">
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
        <Empty title="동기화 실행을 불러오지 못했습니다." copy="잠시 후 다시 시도해 주세요." />
      ) : rows.length === 0 ? (
        <Empty
          title="표시할 동기화 실행이 없습니다."
          copy="개발 저장소에서 /sync-specode UW-XXXXX를 실행하면 결과가 여기에 저장됩니다."
        />
      ) : (
        <section className="sp-table-wrap" aria-label="스펙 동기화 실행 목록">
          <table className="sp-table">
            <thead>
              <tr>
                <th>단위업무</th>
                <th>모드</th>
                <th>구현 정합성</th>
                <th>설계 커버리지</th>
                <th>상태</th>
                <th>문제 처리 현황</th>
                <th>요청자</th>
                <th>요청일</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.syncRunId}
                  tabIndex={0}
                  onClick={() => router.push(
                    `/projects/${projectId}/spec-reconciliations/${row.syncRunId}`,
                  )}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      router.push(
                        `/projects/${projectId}/spec-reconciliations/${row.syncRunId}`,
                      );
                    }
                  }}
                >
                  <td>
                    <div className="sp-reconcile-table-title">{row.unitWorkDisplayId}</div>
                    <div className="sp-reconcile-table-subtitle">{row.unitWorkName}</div>
                  </td>
                  <td>{row.mode === "CHECK" ? "기본 점검" : "정밀 동기화"}</td>
                  <td><VerdictBadge value={row.implementationVerdict} /></td>
                  <td><VerdictBadge value={row.designCoverageVerdict} /></td>
                  <td>
                    <span
                      className={`sp-badge ${runStatusBadgeClass(row.status, row.designChangedCount)}`}
                    >
                      {runStatusLabel(row.status, row.designChangedCount)}
                    </span>
                  </td>
                  <td><DecisionProgressCell row={row} /></td>
                  <td>{row.requesterName}</td>
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

/**
 * "문제 N건" 고정 숫자 아래에 적용·거부·보류·설계변경·대기 건수를 배지로 보여준다.
 * 이전에는 결정 대기 수만 회색 부제로 있어 결정을 내려도 목록이 바뀐 것처럼 보이지 않았다.
 */
function DecisionProgressCell({ row }: { row: SyncRunRow }) {
  // 분석이 끝나기 전에는 문제 수 자체가 없다.
  if (["RUNNING", "NEEDS_INPUT", "FAILED", "CANCELLED"].includes(row.status)) {
    return <span className="sp-reconcile-table-subtitle">분석 결과 대기</span>;
  }
  const chips = decisionCountChips(row);
  return (
    <div>
      <div className="sp-reconcile-table-title">
        문제 {row.issueCount}건 · 구현 정상 {row.normalTargetCount}건
      </div>
      {chips.length === 0 ? (
        <div className="sp-reconcile-table-subtitle">처리할 문제 없음</div>
      ) : (
        <div className="sp-reconcile-count-row">
          {chips.map((chip) => (
            <span key={chip.code} className={`sp-badge ${chip.badgeClass}`}>
              {chip.label} {chip.count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Step({ number, title, copy }: { number: string; title: string; copy: string }) {
  return (
    <div className="sp-reconcile-summary-cell">
      <div className="sp-reconcile-summary-label">STEP {number}</div>
      <div className="sp-reconcile-summary-value">{title}</div>
      <div className="sp-reconcile-table-subtitle">{copy}</div>
    </div>
  );
}

function VerdictBadge({ value }: { value: string | null }) {
  if (!value) return <span className="sp-reconcile-table-subtitle">대기</span>;
  return <span className={`sp-badge ${verdictBadgeClass(value)}`}>{verdictLabel(value)}</span>;
}

function Empty({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="sp-empty">
      <div className="sp-empty-title">{title}</div>
      <div className="sp-empty-desc">{copy}</div>
    </div>
  );
}

function verdictBadgeClass(value: string) {
  if (["PASS", "CLEAR"].includes(value)) return "sp-badge-success";
  if (["FAIL", "GAP_CANDIDATE"].includes(value)) return "sp-badge-warning";
  return "sp-badge-info";
}
