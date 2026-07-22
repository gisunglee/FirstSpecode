"use client";

/**
 * IssueFormModal — 협조/이슈 항목 추가·수정 팝업
 *
 * 표 안에서 행마다 입력창을 펼치던 인라인 편집이 필드가 늘면서(구분/담당자/목표일/보고 여부까지)
 * 표가 지저분해진다는 피드백으로, ActivityMdModal/PrintPreviewModal과 같은 팝업 패턴으로 뺐다.
 * issue가 null이면 추가, 있으면 그 값으로 채워진 수정 폼.
 */

import { useState } from "react";
import type { Issue, IssueCategoryCode, IssueStatusCode } from "@/types/issue";
import { ISSUE_CATEGORY_LABEL, ISSUE_STATUS_LABEL } from "@/types/issue";

const CATEGORY_OPTIONS: IssueCategoryCode[] = ["CUSTOMER_REQ", "OUR_REQ", "ISSUE"];
const STATUS_OPTIONS: IssueStatusCode[] = ["OPEN", "IN_PROGRESS", "PARTIAL", "DONE"];

export type IssueFormValues = {
  categoryCode: IssueCategoryCode;
  cn: string;
  actionCn: string | null;
  requesterNm: string | null;
  assigneeNm: string | null;
  reqDt: string | null;
  dueDt: string | null;
  statusCode: IssueStatusCode;
  rptYn: "Y" | "N";
};

function toInitial(issue: Issue | null): IssueFormValues {
  if (!issue) {
    return { categoryCode: "ISSUE", cn: "", actionCn: "", requesterNm: "", assigneeNm: "", reqDt: "", dueDt: "", statusCode: "OPEN", rptYn: "Y" };
  }
  return {
    categoryCode: issue.categoryCode,
    cn:           issue.cn,
    actionCn:     issue.actionCn ?? "",
    requesterNm:  issue.requesterNm ?? "",
    assigneeNm:   issue.assigneeNm ?? "",
    reqDt:        issue.reqDt ?? "",
    dueDt:        issue.dueDt ?? "",
    statusCode:   issue.statusCode,
    rptYn:        issue.rptYn,
  };
}

export default function IssueFormModal({
  issue,
  saving,
  onCancel,
  onSave,
}: {
  issue: Issue | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (values: IssueFormValues) => void;
}) {
  const [values, setValues] = useState<IssueFormValues>(() => toInitial(issue));

  function set<K extends keyof IssueFormValues>(key: K, value: IssueFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "var(--color-bg-overlay)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200 }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(620px, 95vw)", maxHeight: "90vh",
          background: "var(--color-bg-card)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)",
        }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {issue ? "이슈 수정" : "이슈 추가"}
          </div>
          <button
            onClick={onCancel}
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--color-text-secondary)", padding: "0 4px", lineHeight: 1 }}
          >×</button>
        </div>

        <div style={{ padding: 20, overflow: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <label style={{ flex: 1 }}>
              <div style={fieldLabel}>구분</div>
              <select className="sp-input sp-select" value={values.categoryCode} onChange={(e) => set("categoryCode", e.target.value as IssueCategoryCode)}>
                {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{ISSUE_CATEGORY_LABEL[c]}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 20 }}>
              <input type="checkbox" checked={values.rptYn === "Y"} onChange={(e) => set("rptYn", e.target.checked ? "Y" : "N")} />
              <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)" }}>보고(고객 보고용에 포함)</span>
            </label>
          </div>

          <label>
            <div style={fieldLabel}>내용</div>
            <textarea className="sp-input" rows={4} value={values.cn} placeholder="이슈 내용" onChange={(e) => set("cn", e.target.value)} />
          </label>

          <label>
            <div style={fieldLabel}>조치 계획 / 결과</div>
            <textarea className="sp-input" rows={4} value={values.actionCn ?? ""} placeholder="조치 계획 / 결과" onChange={(e) => set("actionCn", e.target.value)} />
          </label>

          <div style={{ display: "flex", gap: 12 }}>
            <label style={{ flex: 1 }}>
              <div style={fieldLabel}>요청자</div>
              <input className="sp-input" value={values.requesterNm ?? ""} placeholder="요청자" onChange={(e) => set("requesterNm", e.target.value)} />
            </label>
            <label style={{ flex: 1 }}>
              <div style={fieldLabel}>담당자</div>
              <input className="sp-input" value={values.assigneeNm ?? ""} placeholder="담당자" onChange={(e) => set("assigneeNm", e.target.value)} />
            </label>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <label style={{ flex: 1 }}>
              <div style={fieldLabel}>요청일</div>
              <input type="date" className="sp-input" value={values.reqDt ?? ""} onChange={(e) => set("reqDt", e.target.value)} />
            </label>
            <label style={{ flex: 1 }}>
              <div style={fieldLabel}>목표일</div>
              <input type="date" className="sp-input" value={values.dueDt ?? ""} onChange={(e) => set("dueDt", e.target.value)} />
            </label>
            <label style={{ flex: 1 }}>
              <div style={fieldLabel}>상태</div>
              <select className="sp-input sp-select" value={values.statusCode} onChange={(e) => set("statusCode", e.target.value as IssueStatusCode)}>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{ISSUE_STATUS_LABEL[s]}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="sp-btn sp-btn-ghost sp-btn-sm" onClick={onCancel} disabled={saving}>취소</button>
          <button type="button" className="sp-btn sp-btn-primary sp-btn-sm" onClick={() => onSave(values)} disabled={saving}>
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

const fieldLabel = { fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 4 };
