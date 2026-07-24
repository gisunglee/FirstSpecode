"use client";

/**
 * PrintPreviewModal — 리더 리포트 "인쇄 미리보기"
 *
 * 실제 사용하던 주간업무보고서 양식(협조 및 이슈사항 현황 + 사업수행 실적/계획 2단)을 참고해
 * PM이 직접 작성한 금주실적/차주계획/금주코멘트/특이사항(perf_cn/plan_cn/comment_cn/note_cn)과
 * TbWrIssue 목록을 같은 레이아웃으로 재구성해 보여준다. 예전엔 AI 원본(draft_cn)을 헤더 문구로
 * 파싱해서 나눴지만, 헤더에 오타가 나면 파싱이 깨지는 문제가 있어(2026-07-22) 애초에 별도
 * 컬럼으로 나뉜 값을 그대로 쓰는 쪽으로 바꿨다 — 여기선 더 이상 파싱이 필요 없다.
 * 금주 코멘트/특이사항은 값이 비어도("-") 항상 표시한다 — 자리 자체가 비어 보이는 게
 * 어색하다는 피드백(2026-07-22).
 * 이슈는 IssueList와 같은 쿼리 캐시(["issues", projectId])를 그대로 공유해 중복 조회가 없다.
 *
 * 인쇄/PDF 출력은 새 라이브러리 없이 브라우저 인쇄(Ctrl+P → "PDF로 저장")를 그대로 쓴다.
 * .sp-print-area 로 감싼 영역만 인쇄되도록 components.css 에 전역 @media print 규칙을 추가했다.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { addDaysStr, getWeekMondayStr, mmddRange } from "@/lib/weekUtil";
import type { IssueListResponse } from "@/types/issue";
import { ISSUE_CATEGORY_LABEL, ISSUE_STATUS_LABEL } from "@/types/issue";

const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

function formatKoreanDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${WEEKDAY_LABEL[d.getUTCDay()]}요일`;
}

// bgngDt(프로젝트 시작일) 기준 monday가 몇 번째 주인지 — PDF의 "26주차"가 캘린더 기준이 아니라
// 프로젝트 진행 기준 번호였던 것을 재현. 시작일이 없으면 계산 불가(null) — 화면에서 주차 숫자를 생략.
function computeWeekIndex(bgngDt: string | null, monday: string): number | null {
  if (!bgngDt) return null;
  const projectStartMonday = getWeekMondayStr(bgngDt.slice(0, 10));
  const diffDays = Math.round(
    (new Date(monday + "T00:00:00Z").getTime() - new Date(projectStartMonday + "T00:00:00Z").getTime()) /
      (1000 * 60 * 60 * 24)
  );
  return Math.floor(diffDays / 7) + 1;
}

export default function PrintPreviewModal({
  projectId,
  monday,
  weeklyReportId,
  perfCn,
  planCn,
  commentCn,
  noteCn,
  onClose,
}: {
  projectId: string;
  monday: string;
  weeklyReportId: string | null;
  perfCn: string | null;
  planCn: string | null;
  commentCn: string | null;
  noteCn: string | null;
  onClose: () => void;
}) {
  const sunday     = addDaysStr(monday, 6);
  const nextMonday = addDaysStr(monday, 7);
  const nextSunday = addDaysStr(monday, 13);
  const [downloading, setDownloading] = useState(false);

  // Bearer 인증 헤더가 필요해서 fetch + blob 패턴 사용 (test-specs 엑셀 다운로드와 동일 흐름)
  async function handleDownloadXlsx() {
    if (!weeklyReportId) return;
    setDownloading(true);
    try {
      const at = typeof window !== "undefined" ? (sessionStorage.getItem("access_token") ?? "") : "";
      const res = await fetch(`/api/projects/${projectId}/weekly-reports/${weeklyReportId}/xlsx`, {
        headers: at ? { Authorization: `Bearer ${at}` } : {},
      });
      if (!res.ok) return;
      const disposition = res.headers.get("content-disposition") ?? "";
      const m = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const filename = m ? decodeURIComponent(m[1]) : "주간업무보고서.xlsx";
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setDownloading(false);
    }
  }

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () =>
      authFetch<{ data: { name: string; startDate: string | null } }>(`/api/projects/${projectId}`).then((r) => r.data),
  });

  const issuesQuery = useQuery({
    queryKey: ["issues", projectId],
    queryFn: () => authFetch<{ data: IssueListResponse }>(`/api/projects/${projectId}/issues`).then((r) => r.data),
  });

  const weekIndex = computeWeekIndex(projectQuery.data?.startDate ?? null, monday);
  const projectName = projectQuery.data?.name ?? "";
  // 인쇄본은 고객 보고용 — "보고" 체크를 끈 항목(오래돼서 더 언급 안 해도 되는 이슈 등)은 뺀다
  const issues = (issuesQuery.data?.items ?? []).filter((i) => i.rptYn === "Y");

  return (
    // 이 배경 div는 sp-print-area의 조상이라 sp-no-print(display:none)를 걸면 안 된다 —
    // 조상이 display:none이 되면 그 안의 sp-print-area까지 통째로 사라져 인쇄가 백지로 나온다.
    // 화면에서 안 보이게 하는 건 @media print의 `body * { visibility: hidden }`가 이미 처리하고,
    // 이 div는 position:fixed 컨테이너로만 남아 sp-print-area(position:absolute)의 기준이 된다.
    <div
      style={{ position: "fixed", inset: 0, background: "var(--color-bg-overlay)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200 }}
      onClick={onClose}
    >
      <div
        className="sp-print-reset"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(880px, 95vw)", maxHeight: "90vh",
          background: "var(--color-bg-card)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <div
          className="sp-no-print"
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 20px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)",
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>인쇄 미리보기</div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--color-text-secondary)", padding: "0 4px", lineHeight: 1 }}
          >×</button>
        </div>

        {/* 인쇄 대상 영역 — 이 안쪽만 sp-print-area 로 화면에 남고 나머지는 @media print 에서 숨겨짐 */}
        <div className="sp-print-reset" style={{ padding: 20, overflow: "auto", flex: 1 }}>
          <div className="sp-print-area">
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--color-text-primary)" }}>
                {projectName ? `${projectName} ` : ""}주간업무보고서
              </div>
            </div>

            <div className="sp-doc-table-wrap" style={{ maxWidth: "none", marginBottom: 16 }}>
              <table className="sp-doc-table">
                <tbody>
                  <tr>
                    <td className="sp-doc-label" style={{ width: 90 }}>주차</td>
                    <td style={{ width: "35%" }}>
                      {weekIndex !== null ? `${weekIndex}주차 (${mmddRange(monday, sunday)})` : mmddRange(monday, sunday)}
                    </td>
                    <td className="sp-doc-label" style={{ width: 90 }}>보고일자</td>
                    <td>{formatKoreanDate(new Date().toISOString().slice(0, 10))}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--color-text-primary)", margin: "18px 0 6px" }}>
              협조 및 이슈사항 현황
            </div>
            <div className="sp-doc-table-wrap" style={{ maxWidth: "none", marginBottom: 16 }}>
              <table className="sp-doc-table">
                <thead>
                  <tr>
                    <th className="sp-doc-label" style={{ width: "9%" }}>구분</th>
                    <th className="sp-doc-label" style={{ width: "26%" }}>내용</th>
                    <th className="sp-doc-label" style={{ width: "26%" }}>조치 계획 / 결과</th>
                    <th className="sp-doc-label" style={{ width: "16%" }}>요청자 / 담당자</th>
                    <th className="sp-doc-label" style={{ width: "13%" }}>요청일 ~ 목표일</th>
                    <th className="sp-doc-label" style={{ width: "10%" }}>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--color-text-tertiary)" }}>등록된 이슈가 없습니다.</td></tr>
                  ) : (
                    issues.map((issue) => (
                      <tr key={issue.issueId}>
                        <td>{ISSUE_CATEGORY_LABEL[issue.categoryCode]}</td>
                        <td>{issue.cn || "-"}</td>
                        <td>{issue.actionCn || "-"}</td>
                        <td>{issue.requesterNm || "-"} / {issue.assigneeNm || "-"}</td>
                        <td>{issue.reqDt ?? "-"} ~ {issue.dueDt ?? "-"}</td>
                        <td>{ISSUE_STATUS_LABEL[issue.statusCode]}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--color-text-primary)", margin: "18px 0 6px" }}>
              사업수행 실적 및 계획
            </div>
            <div className="sp-doc-table-wrap" style={{ maxWidth: "none", marginBottom: 16 }}>
              <table className="sp-doc-table">
                <thead>
                  <tr>
                    <th className="sp-doc-label" style={{ width: 90 }}>구분</th>
                    <th className="sp-doc-label" style={{ width: "45%" }}>금주 실적 ({mmddRange(monday, sunday)})</th>
                    <th className="sp-doc-label">차주 계획 ({mmddRange(nextMonday, nextSunday)})</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="sp-doc-label">사업수행</td>
                    <td style={{ whiteSpace: "pre-wrap" }}>{perfCn || "-"}</td>
                    <td style={{ whiteSpace: "pre-wrap" }}>{planCn || "-"}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="sp-doc-table-wrap" style={{ maxWidth: "none" }}>
              <table className="sp-doc-table">
                <tbody>
                  <tr>
                    <td className="sp-doc-label" style={{ width: 90 }}>금주 코멘트</td>
                    <td style={{ whiteSpace: "pre-wrap" }}>{commentCn || "-"}</td>
                  </tr>
                  <tr>
                    <td className="sp-doc-label" style={{ width: 90 }}>특이사항</td>
                    <td style={{ whiteSpace: "pre-wrap" }}>{noteCn || "-"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="sp-no-print" style={{ padding: "12px 20px", borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="sp-btn sp-btn-ghost sp-btn-sm" onClick={onClose}>닫기</button>
          <button
            type="button"
            className="sp-btn sp-btn-secondary sp-btn-sm"
            disabled={!weeklyReportId || downloading}
            onClick={handleDownloadXlsx}
          >
            {downloading ? "다운로드 중..." : "엑셀 다운로드"}
          </button>
          <button type="button" className="sp-btn sp-btn-primary sp-btn-sm" onClick={() => window.print()}>
            인쇄 / PDF 저장
          </button>
        </div>
      </div>
    </div>
  );
}
