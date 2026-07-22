"use client";

/**
 * IssueList — 협조 및 이슈사항 현황 (리더 리포트 전용)
 *
 * 주 단위로 리셋되는 데이터가 아니라 프로젝트가 계속 관리하는 살아있는 목록이라
 * projectId만 받는다(monday 불필요) — 인쇄 미리보기(PrintPreviewModal)도 같은 쿼리를 공유.
 *
 * 편집 방식: 필드가 늘면서(구분/담당자/목표일/보고 여부까지) 행 안에 입력창을 펼치는 인라인
 * 편집이 표를 지저분하게 만든다는 피드백으로, 추가·수정 모두 IssueFormModal 팝업으로 뺐다.
 * 예외는 "보고" 체크박스 — 자주 툭툭 켜고 끄는 용도라 팝업 없이 표에서 바로 토글한다.
 *
 * 정렬: 기본은 "보고 대상(체크) 우선 + 요청일 최신순" 조합 — 첫 5건만 보이는 기본 화면에서
 * 고객 보고서에 실제로 나갈 항목과 최근 건이 먼저 보이게 하기 위함. 요청일/목표일 헤더를
 * 클릭하면 그 필드 단독 정렬(오름차순/내림차순 토글)로 바뀌고, "기본순" 링크로 되돌릴 수 있다.
 *
 * 필드: 구분(고객요청/당사요청/이슈)으로 "요청자"가 떠안던 방향 혼란을 분리했고, 담당자·목표일을
 * 추가했다. 담당자는 외부 협력사 인력도 지정할 수 있어야 해서 프로젝트 멤버 선택이 아닌 자유 텍스트.
 *
 * "보고" 체크박스(rptYn) — 이 목록 자체는 내부 관리용으로 계속 쌓이지만, 인쇄 미리보기(고객
 * 보고용)에는 체크된 것만 나간다. 오래돼서 더 언급할 필요 없는 항목을 지우지 않고 체크만 풀면
 * 보고서에서 조용히 빠진다.
 *
 * 프로젝트당 보통 10~50건까지 쌓인다는 전제로, 기본 5건만 보이고 "더보기"로 전체를 편다
 * (페이징은 불필요하다는 판단 — 접었다 펴는 것만으로 충분).
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import type { Issue, IssueListResponse, IssueCategoryCode, IssueStatusCode } from "@/types/issue";
import { ISSUE_CATEGORY_LABEL, ISSUE_STATUS_LABEL } from "@/types/issue";
import IssueFormModal, { type IssueFormValues } from "./IssueFormModal";
import ConfirmDialog from "@/components/common/ConfirmDialog";

const DEFAULT_VISIBLE = 5;
const CENTER = { textAlign: "center" as const };

const CATEGORY_BADGE: Record<IssueCategoryCode, string> = {
  CUSTOMER_REQ: "sp-badge-info",
  OUR_REQ:      "sp-badge-brand",
  ISSUE:        "sp-badge-warning",
};
const STATUS_BADGE: Record<IssueStatusCode, string> = {
  OPEN:        "sp-badge-neutral",
  IN_PROGRESS: "sp-badge-warning",
  PARTIAL:     "sp-badge-info",
  DONE:        "sp-badge-success",
};

type SortField = "reqDt" | "dueDt" | null;
type SortDir = "asc" | "desc";

// null인 날짜는 정렬 방향과 무관하게 항상 맨 뒤로 — "언제인지 모르는 것"이 최신/최우선으로 보이면 안 됨
function compareDateNullsLast(a: string | null, b: string | null, dir: SortDir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const diff = new Date(a).getTime() - new Date(b).getTime();
  return dir === "asc" ? diff : -diff;
}

export default function IssueList({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [formOpen, setFormOpen] = useState(false);
  const [formIssue, setFormIssue] = useState<Issue | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Issue | null>(null);

  const issuesQuery = useQuery({
    queryKey: ["issues", projectId],
    queryFn: () => authFetch<{ data: IssueListResponse }>(`/api/projects/${projectId}/issues`).then((r) => r.data),
    enabled: !!projectId,
  });
  const rows = issuesQuery.data?.items ?? [];

  const sortedRows = useMemo(() => {
    const arr = [...rows];
    if (sortField === null) {
      // 기본 정렬 — 보고 대상(체크)을 먼저, 그 안에서는 요청일 최신순
      arr.sort((a, b) => {
        if (a.rptYn !== b.rptYn) return a.rptYn === "Y" ? -1 : 1;
        return compareDateNullsLast(a.reqDt, b.reqDt, "desc");
      });
    } else {
      const field: "reqDt" | "dueDt" = sortField;
      arr.sort((a, b) => compareDateNullsLast(a[field], b[field], sortDir));
    }
    return arr;
  }, [rows, sortField, sortDir]);

  function clickSort(field: "reqDt" | "dueDt") {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const closeForm = () => { setFormOpen(false); setFormIssue(null); };
  const openCreate = () => { setFormIssue(null); setFormOpen(true); };
  const openEdit = (row: Issue) => { setFormIssue(row); setFormOpen(true); };

  const createMutation = useMutation({
    mutationFn: (body: IssueFormValues) =>
      authFetch(`/api/projects/${projectId}/issues`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["issues", projectId] }); closeForm(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (issueId: string) => authFetch(`/api/projects/${projectId}/issues/${issueId}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["issues", projectId] }); setDeleteTarget(null); },
  });

  // 부분완료/완료 처리된 이슈는 삭제하면 처리 이력 자체가 사라지므로 더 무겁게 경고한다
  function deleteDescription(row: Issue): string {
    if (row.statusCode === "PARTIAL" || row.statusCode === "DONE") {
      return `이미 "${ISSUE_STATUS_LABEL[row.statusCode]}" 처리된 이슈입니다. 삭제하면 처리 이력을 되돌릴 수 없습니다. 정말 삭제하시겠습니까?`;
    }
    return "이 이슈를 삭제하시겠습니까? 삭제 후에는 되돌릴 수 없습니다.";
  }

  const patchMutation = useMutation({
    mutationFn: ({ issueId, body }: { issueId: string; body: Partial<IssueFormValues> }) =>
      authFetch(`/api/projects/${projectId}/issues/${issueId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["issues", projectId] }); closeForm(); },
  });

  function toggleReport(row: Issue) {
    patchMutation.mutate({ issueId: row.issueId, body: { rptYn: row.rptYn === "Y" ? "N" : "Y" } });
  }

  function handleFormSave(values: IssueFormValues) {
    if (formIssue) {
      patchMutation.mutate({ issueId: formIssue.issueId, body: values });
    } else {
      createMutation.mutate(values);
    }
  }

  const visibleRows = expanded ? sortedRows : sortedRows.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = sortedRows.length - visibleRows.length;

  function sortArrow(field: "reqDt" | "dueDt") {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", background: "var(--color-bg-card)", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--color-text-primary)" }}>
          협조 및 이슈사항 현황
        </div>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>(고객 보고용)</span>
        <span className="sp-badge sp-badge-neutral">{rows.length}</span>
        {sortField !== null && (
          <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setSortField(null)}>
            기본순으로
          </button>
        )}
        <button
          type="button"
          className="sp-btn sp-btn-secondary sp-btn-xs"
          style={{ marginLeft: "auto" }}
          onClick={openCreate}
        >
          + 이슈 추가
        </button>
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
          등록된 이슈가 없습니다. "+ 이슈 추가"로 협조 요청이나 미해결 이슈를 관리해 보세요.
        </div>
      ) : (
        <>
          <div className="sp-table-wrap" style={{ overflowX: "auto" }}>
            <table className="sp-table sp-table-flat">
              <thead>
                <tr>
                  <th style={{ width: 44, ...CENTER }} title="인쇄 미리보기(고객 보고용)에 포함">보고</th>
                  <th style={{ width: "6%" }}>구분</th>
                  <th style={{ width: "25%" }}>내용</th>
                  <th style={{ width: "25%" }}>조치 계획 / 결과</th>
                  <th style={{ width: "7%", ...CENTER }}>요청자</th>
                  <th style={{ width: "7%", ...CENTER }}>담당자</th>
                  <th style={{ width: "8%", ...CENTER, cursor: "pointer", userSelect: "none" }} onClick={() => clickSort("reqDt")}>
                    요청일{sortArrow("reqDt")}
                  </th>
                  <th style={{ width: "8%", ...CENTER, cursor: "pointer", userSelect: "none" }} onClick={() => clickSort("dueDt")}>
                    목표일{sortArrow("dueDt")}
                  </th>
                  <th style={{ width: "6%", ...CENTER }}>상태</th>
                  <th style={{ width: 56 }} />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.issueId}>
                    <td style={CENTER}>
                      <input type="checkbox" checked={row.rptYn === "Y"} onChange={() => toggleReport(row)} />
                    </td>
                    <td><span className={`sp-badge ${CATEGORY_BADGE[row.categoryCode]}`}>{ISSUE_CATEGORY_LABEL[row.categoryCode]}</span></td>
                    <td style={{ whiteSpace: "pre-wrap" }}>{row.cn || "-"}</td>
                    <td style={{ whiteSpace: "pre-wrap" }}>{row.actionCn || "-"}</td>
                    <td style={CENTER}>{row.requesterNm || "-"}</td>
                    <td style={CENTER}>{row.assigneeNm || "-"}</td>
                    <td className="is-mono" style={CENTER}>{row.reqDt ?? "-"}</td>
                    <td className="is-mono" style={CENTER}>{row.dueDt ?? "-"}</td>
                    <td style={CENTER}><span className={`sp-badge ${STATUS_BADGE[row.statusCode]}`}>{ISSUE_STATUS_LABEL[row.statusCode]}</span></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => openEdit(row)} style={{ marginRight: 4 }}>수정</button>
                      <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setDeleteTarget(row)}>삭제</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {sortedRows.length > DEFAULT_VISIBLE && (
            <div style={{ textAlign: "center", marginTop: 8 }}>
              <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setExpanded((v) => !v)}>
                {expanded ? "접기" : `더보기 (+${hiddenCount})`}
              </button>
            </div>
          )}
        </>
      )}

      {formOpen && (
        <IssueFormModal
          issue={formIssue}
          saving={createMutation.isPending || patchMutation.isPending}
          onCancel={closeForm}
          onSave={handleFormSave}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="이슈 삭제"
        description={deleteTarget ? deleteDescription(deleteTarget) : ""}
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.issueId)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
