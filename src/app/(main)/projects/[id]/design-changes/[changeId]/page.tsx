"use client";

/**
 * DesignChangeDetailPage — 설계 변경 이력 상세
 *
 * 역할:
 *   - 기본 정보 카드: 변경 테이블·대상 ID·변경자·일시·AI 여부·변경 사유
 *   - 스냅샷 카드: snapshot_data 필드별 렌더링
 *     · 마크다운 감지 (# / ** / - 패턴) → marked로 HTML 렌더링
 *     · 긴 JSON 문자열 → <pre> 코드 블록
 *     · 일반 값 → 텍스트
 */

import { Suspense, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { marked } from "marked";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";

// ── 테이블명 한글 매핑 ────────────────────────────────────────────────────────

const TABLE_LABEL: Record<string, string> = {
  tb_ds_unit_work:    "단위업무",
  tb_ds_screen:       "화면",
  tb_ds_area:         "영역",
  tb_ds_function:     "기능",
  tb_ds_db_table:     "DB 테이블",
  tb_ds_table_column: "DB 컬럼",
  tb_rq_requirement:  "요구사항",
  tb_rq_user_story:   "사용자스토리",
  tb_pj_project:      "프로젝트",
  tb_ds_plan_studio_artf: "기획 산출물",
};

// snapshot_data 필드명 한글 매핑
const FIELD_LABEL: Record<string, string> = {
  unit_work_id:         "단위업무 ID",
  unit_work_nm:         "단위업무명",
  unit_work_dc:         "단위업무 설명",
  scrn_id:              "화면 ID",
  scrn_nm:              "화면명",
  scrn_dc:              "화면 설명",
  scrn_ty_code:         "화면 유형",
  area_id:              "영역 ID",
  area_nm:              "영역명",
  area_dc:              "영역 설명",
  area_ty_code:         "영역 유형",
  excaldw_data:         "Excalidraw 데이터",
  func_id:              "기능 ID",
  func_nm:              "기능명",
  func_dc:              "기능 설명",
  spec_cn:              "기능 명세",
  cmplx_code:           "복잡도",
  efrt_val:             "공수",
  sort_ordr:            "정렬 순서",
  mdfcn_dt:             "수정 일시",
  creat_dt:             "등록 일시",
  prjct_id:             "프로젝트 ID",
  req_id:               "요구사항 ID",
  asign_mber_id:        "담당자 ID",
  bgng_de:              "시작일",
  end_de:               "종료일",
  progrs_rt:            "진척률",
  tbl_id:               "테이블 ID",
  tbl_physc_nm:         "물리 테이블명",
  tbl_lgcl_nm:          "논리 테이블명",
  tbl_dc:               "테이블 설명",
  col_physc_nm:         "물리 컬럼명",
  col_lgcl_nm:          "논리 컬럼명",
  data_ty_nm:           "데이터 타입",
  col_dc:               "컬럼 설명",
};

// ── 타입 ──────────────────────────────────────────────────────────────────────

type ChangeDetail = {
  chgId:        string;
  refTblNm:     string;
  refId:        string;
  chgRsnCn:     string | null;
  snapshotData: unknown;
  aiReqYn:      string;
  aiTaskId:     string | null;
  chgMberEmail: string | null;
  chgDt:        string;
};

// ── 유틸 ──────────────────────────────────────────────────────────────────────

/** 마크다운으로 보이는 문자열인지 판별 */
function looksLikeMarkdown(str: string): boolean {
  return /^#{1,6}\s|^\*\s|^-\s|\*\*[\s\S]+?\*\*|^>\s|\n#{1,6}\s/.test(str);
}

/** JSON 구조처럼 보이는 문자열인지 판별 */
function looksLikeJson(str: string): boolean {
  const trimmed = str.trim();
  return (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
         (trimmed.startsWith("[") && trimmed.endsWith("]"));
}

/** 날짜 문자열 포맷 */
function formatDate(dt: string): string {
  return new Date(dt).toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function DesignChangeDetailPage() {
  return (
    <Suspense fallback={null}>
      <DesignChangeDetailInner />
    </Suspense>
  );
}

function DesignChangeDetailInner() {
  const params    = useParams<{ id: string; changeId: string }>();
  const router    = useRouter();
  const projectId = params.id;
  const changeId  = params.changeId;
  const { setBreadcrumb } = useAppStore();

  const { data, isLoading, isError } = useQuery<{ data: ChangeDetail }>({
    queryKey: ["design-changes", projectId, changeId],
    queryFn:  () =>
      authFetch<{ data: ChangeDetail }>(
        `/api/projects/${projectId}/design-changes/${changeId}`
      ),
  });

  const detail = data?.data;

  useEffect(() => {
    setBreadcrumb([
      { label: "설계 변경 이력", href: `/projects/${projectId}/design-changes` },
      { label: detail ? `${TABLE_LABEL[detail.refTblNm] ?? detail.refTblNm} 변경` : "상세" },
    ]);
    return () => setBreadcrumb([]);
  }, [setBreadcrumb, projectId, detail]);

  if (isLoading) {
    return (
      <div style={{ padding: "80px 24px", textAlign: "center", color: "var(--color-text-secondary)", fontSize: 14 }}>
        로딩 중...
      </div>
    );
  }

  if (isError || !detail) {
    return (
      <div style={{ padding: "80px 24px", textAlign: "center", color: "#e53935", fontSize: 14 }}>
        변경 이력을 불러올 수 없습니다.
      </div>
    );
  }

  return (
    <div style={{ padding: 0 }}>

      {/* ── 헤더 ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 24px",
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 24,
      }}>
        <button
          onClick={() => router.push(`/projects/${projectId}/design-changes`)}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "4px 10px", borderRadius: 6,
            border: "1px solid var(--color-border)",
            background: "transparent",
            color: "var(--color-text-secondary)",
            fontSize: 12, cursor: "pointer",
          }}
        >
          ← 목록
        </button>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>
          {TABLE_LABEL[detail.refTblNm] ?? detail.refTblNm} 변경 이력 상세
        </div>
      </div>

      <div style={{ padding: "0 24px 40px", maxWidth: 900, display: "flex", flexDirection: "column", gap: 20 }}>

        {/* ── 기본 정보 카드 ── */}
        <section style={cardStyle}>
          <div style={cardTitleStyle}>기본 정보</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px" }}>
            <MetaRow label="변경 대상 테이블" value={
              <span>
                <span style={{
                  display: "inline-block", padding: "2px 8px", borderRadius: 12,
                  background: "#e8eaf6", color: "#3949ab", fontSize: 11, fontWeight: 700, marginRight: 6,
                }}>
                  {TABLE_LABEL[detail.refTblNm] ?? detail.refTblNm}
                </span>
                <code style={{ fontFamily: "monospace", fontSize: 11, color: "var(--color-text-secondary)" }}>
                  {detail.refTblNm}
                </code>
              </span>
            } />
            <MetaRow label="대상 레코드 ID" value={
              <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--color-text-primary)" }}>
                {detail.refId}
              </code>
            } />
            <MetaRow label="변경 일시" value={formatDate(detail.chgDt)} />
            <MetaRow label="변경자" value={detail.chgMberEmail ?? "—"} />
            <MetaRow label="AI 요청 여부" value={
              <span style={{
                display: "inline-block", padding: "2px 8px", borderRadius: 12,
                background: detail.aiReqYn === "Y" ? "#e8eaf6" : "#f5f5f5",
                color:      detail.aiReqYn === "Y" ? "#3949ab" : "#9e9e9e",
                fontSize: 11, fontWeight: 700,
              }}>
                {detail.aiReqYn === "Y" ? "✨ AI 요청" : "수동"}
              </span>
            } />
            {detail.aiTaskId && (
              <MetaRow label="AI 태스크 ID" value={
                <code style={{ fontFamily: "monospace", fontSize: 11, color: "var(--color-text-secondary)" }}>
                  {detail.aiTaskId}
                </code>
              } />
            )}
            {detail.chgRsnCn && (
              <div style={{ gridColumn: "1 / -1" }}>
                <MetaRow label="변경 사유" value={detail.chgRsnCn} />
              </div>
            )}
          </div>
        </section>

        {/* ── 스냅샷 데이터 카드 ── */}
        <section style={{ ...cardStyle, maxHeight: 600, overflowY: "auto" }}>
          <div style={{ ...cardTitleStyle, position: "sticky", top: -20, background: "var(--color-bg-card)", zIndex: 1, margin: "-20px -24px 16px", padding: "20px 24px 10px" }}>
            스냅샷 데이터
          </div>
          <SnapshotViewer data={detail.snapshotData} />
        </section>

      </div>
    </div>
  );
}

// ── MetaRow ───────────────────────────────────────────────────────────────────

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
        {value}
      </div>
    </div>
  );
}

// ── SnapshotViewer ────────────────────────────────────────────────────────────

function SnapshotViewer({ data }: { data: unknown }) {
  if (data === null || data === undefined) {
    return <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>스냅샷 데이터 없음</span>;
  }

  // 원시 타입이면 단순 표시
  if (typeof data !== "object" || Array.isArray(data)) {
    const str = JSON.stringify(data, null, 2);
    return (
      <pre style={codeBlockStyle}>{str}</pre>
    );
  }

  const obj = data as Record<string, unknown>;
  const entries = Object.entries(obj);

  if (entries.length === 0) {
    return <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>빈 스냅샷</span>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {entries.map(([key, val]) => (
        <SnapshotField key={key} fieldKey={key} value={val} />
      ))}
    </div>
  );
}

// ── SnapshotField — 필드별 렌더링 ─────────────────────────────────────────────

function SnapshotField({ fieldKey, value }: { fieldKey: string; value: unknown }) {
  const label = FIELD_LABEL[fieldKey] ?? fieldKey;

  const renderValue = () => {
    // null / undefined
    if (value === null || value === undefined) {
      return <span style={{ color: "var(--color-text-secondary)", fontStyle: "italic", fontSize: 13 }}>—</span>;
    }

    // 불리언
    if (typeof value === "boolean") {
      return (
        <span style={{
          display: "inline-block", padding: "2px 8px", borderRadius: 10,
          background: value ? "#e8f5e9" : "#fdecea",
          color:      value ? "#2e7d32" : "#c62828",
          fontSize: 12, fontWeight: 600,
        }}>
          {value ? "Yes" : "No"}
        </span>
      );
    }

    // 숫자
    if (typeof value === "number") {
      return <span style={{ fontSize: 13, fontFamily: "monospace", color: "var(--color-text-primary)" }}>{value}</span>;
    }

    // 문자열
    if (typeof value === "string") {
      // 마크다운 감지 — 길이가 충분하고 패턴 매칭
      if (value.length > 60 && looksLikeMarkdown(value)) {
        const html = marked.parse(value, { async: false }) as string;
        return (
          <div style={{ position: "relative" }}>
            <span style={modeBadgeStyle}>Markdown</span>
            <div
              className="markdown-body"
              style={mdViewerStyle}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        );
      }

      // JSON 문자열 (Excalidraw 데이터 등)
      if (value.length > 40 && looksLikeJson(value)) {
        let pretty = value;
        try { pretty = JSON.stringify(JSON.parse(value), null, 2); } catch { /* 그대로 표시 */ }
        return (
          <div style={{ position: "relative" }}>
            <span style={{ ...modeBadgeStyle, background: "#e3f2fd", color: "#1565c0" }}>JSON</span>
            <pre style={{ ...codeBlockStyle, maxHeight: 320, overflowY: "auto" }}>{pretty}</pre>
          </div>
        );
      }

      // 날짜 패턴
      if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
        return <span style={{ fontSize: 13, color: "var(--color-text-primary)" }}>{formatDate(value)}</span>;
      }

      // 일반 문자열 — 여러 줄이면 pre-wrap
      if (value.includes("\n")) {
        return <pre style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap", color: "var(--color-text-primary)" }}>{value}</pre>;
      }

      return <span style={{ fontSize: 13, color: "var(--color-text-primary)" }}>{value}</span>;
    }

    // 객체 / 배열
    const str = JSON.stringify(value, null, 2);
    return (
      <div style={{ position: "relative" }}>
        <span style={{ ...modeBadgeStyle, background: "#fff8e1", color: "#f57f17" }}>Object</span>
        <pre style={{ ...codeBlockStyle, maxHeight: 320, overflowY: "auto" }}>{str}</pre>
      </div>
    );
  };

  return (
    <div style={{
      padding:      "12px 14px",
      borderRadius: 8,
      background:   "var(--color-bg-muted, #f8f9fa)",
      border:       "1px solid var(--color-border)",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)", marginBottom: 8 }}>
        {label}
        {FIELD_LABEL[fieldKey] && (
          <span style={{ marginLeft: 6, fontWeight: 400, color: "#bbb", fontFamily: "monospace" }}>
            ({fieldKey})
          </span>
        )}
      </div>
      {renderValue()}
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background:   "var(--color-bg-card)",
  border:       "1px solid var(--color-border)",
  borderRadius: 10,
  padding:      "20px 24px",
};

const cardTitleStyle: React.CSSProperties = {
  fontSize:     14,
  fontWeight:   700,
  color:        "var(--color-text-primary)",
  marginBottom: 16,
  paddingBottom: 10,
  borderBottom: "1px solid var(--color-border)",
};

const codeBlockStyle: React.CSSProperties = {
  margin:       0,
  padding:      "10px 12px",
  borderRadius: 6,
  background:   "var(--color-bg-muted, #f4f4f4)",
  fontSize:     12,
  fontFamily:   "monospace",
  color:        "var(--color-text-primary)",
  whiteSpace:   "pre-wrap",
  wordBreak:    "break-all",
};

const modeBadgeStyle: React.CSSProperties = {
  display:      "inline-block",
  padding:      "2px 7px",
  borderRadius: 4,
  background:   "#e8f5e9",
  color:        "#2e7d32",
  fontSize:     10,
  fontWeight:   700,
  marginBottom: 6,
};

const mdViewerStyle: React.CSSProperties = {
  fontSize:   13,
  lineHeight: 1.7,
  color:      "var(--color-text-primary)",
  padding:    "10px 12px",
  borderRadius: 6,
  background: "var(--color-bg-muted, #f8f9fa)",
  border:     "1px solid var(--color-border)",
};
