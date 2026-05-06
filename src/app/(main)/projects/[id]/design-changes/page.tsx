"use client";

/**
 * DesignChangesPage — 설계 변경 이력 목록
 *
 * 역할:
 *   - tb_ds_design_change 목록을 테이블로 표시 (등록일 DESC)
 *   - 테이블명(한글), AI 요청 여부, 변경자, 변경 사유, 변경 일시 노출
 *   - 행 클릭 시 상세 페이지 이동
 *   - 테이블명·변경 사유·변경자 기준 검색
 *   - 20개씩 페이지네이션
 */

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";

// ── 테이블명 한글 매핑 ────────────────────────────────────────────────────────

const TABLE_LABEL: Record<string, string> = {
  tb_ds_unit_work:        "단위업무",
  tb_ds_screen:           "화면",
  tb_ds_area:             "영역",
  tb_ds_function:         "기능",
  tb_ds_db_table:         "DB 테이블",
  tb_ds_table_column:     "DB 컬럼",
  tb_ds_col_mapping:      "컬럼 매핑",
  tb_rq_requirement:      "요구사항",
  tb_rq_user_story:       "사용자스토리",
  tb_pj_project:          "프로젝트",
  tb_ds_function_column_mapping: "컬럼 매핑",
  tb_ds_plan_studio_artf: "기획 산출물",
};

const TABLE_COLOR: Record<string, { bg: string; text: string }> = {
  tb_ds_unit_work:             { bg: "#e8eaf6", text: "#3949ab" },
  tb_ds_screen:                { bg: "#e8f5e9", text: "#2e7d32" },
  tb_ds_area:                  { bg: "#fff8e1", text: "#f57f17" },
  tb_ds_function:              { bg: "#fce4ec", text: "#c62828" },
  tb_ds_db_table:              { bg: "#e3f2fd", text: "#1565c0" },
  tb_ds_table_column:          { bg: "#e0f7fa", text: "#00695c" },
  tb_ds_col_mapping:           { bg: "#ede7f6", text: "#512da8" },
  tb_ds_function_column_mapping: { bg: "#ede7f6", text: "#512da8" },
  tb_rq_requirement:           { bg: "#f3e5f5", text: "#6a1b9a" },
  tb_rq_user_story:            { bg: "#fff3e0", text: "#e65100" },
  tb_pj_project:               { bg: "#efebe9", text: "#4e342e" },
  tb_ds_plan_studio_artf:      { bg: "#e1f5fe", text: "#0277bd" },
};

// ── 상수 ──────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

// ── 타입 ──────────────────────────────────────────────────────────────────────

type ChangeItem = {
  chgId:        string;
  refTblNm:     string;
  refId:        string;
  chgTypeCode:  string;
  chgRsnCn:     string | null;
  aiReqYn:      string;
  aiTaskId:     string | null;
  chgMberEmail: string | null;
  chgDt:        string;
};

// 액션 타입 뱃지 스타일 매핑
const ACTION_STYLE: Record<string, { label: string; bg: string; text: string }> = {
  CREATE: { label: "등록", bg: "#e8f5e9", text: "#2e7d32" },
  UPDATE: { label: "수정", bg: "#fff8e1", text: "#f57f17" },
  DELETE: { label: "삭제", bg: "#fce4ec", text: "#c62828" },
};

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function formatDate(dt: string): string {
  return new Date(dt).toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function tblLabel(tbl: string) {
  return TABLE_LABEL[tbl] ?? tbl;
}

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function DesignChangesPage() {
  return (
    <Suspense fallback={null}>
      <DesignChangesPageInner />
    </Suspense>
  );
}

function DesignChangesPageInner() {
  const params    = useParams<{ id: string }>();
  const router    = useRouter();
  const projectId = params.id;
  const { setBreadcrumb } = useAppStore();

  useEffect(() => {
    setBreadcrumb([{ label: "설계 변경 이력" }]);
    return () => setBreadcrumb([]);
  }, [setBreadcrumb]);

  const [search,       setSearch]       = useState("");
  const [actionFilter, setActionFilter] = useState("");   // "" = 전체, CREATE/UPDATE/DELETE
  const [page,         setPage]         = useState(1);

  // 검색어·필터 변경 시 첫 페이지로 리셋
  function handleSearch(v: string) {
    setSearch(v);
    setPage(1);
  }
  function handleActionFilter(v: string) {
    setActionFilter(v);
    setPage(1);
  }

  // ── 목록 조회 ────────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery<{ items: ChangeItem[]; totalCount: number }>({
    queryKey: ["design-changes", projectId],
    queryFn:  () =>
      authFetch<{ data: { items: ChangeItem[]; totalCount: number } }>(
        `/api/projects/${projectId}/design-changes`
      ).then((r) => r.data),
  });

  const items = data?.items ?? [];

  const filtered = items.filter((item) => {
    // 액션 타입 필터 (전체가 아닌 경우 정확히 일치해야 함)
    if (actionFilter && item.chgTypeCode !== actionFilter) return false;

    const q = search.toLowerCase();
    if (!q) return true;
    return (
      tblLabel(item.refTblNm).toLowerCase().includes(q) ||
      item.refTblNm.toLowerCase().includes(q) ||
      (item.chgRsnCn ?? "").toLowerCase().includes(q) ||
      (item.chgMberEmail ?? "").toLowerCase().includes(q) ||
      (ACTION_STYLE[item.chgTypeCode]?.label ?? "").includes(q)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const paged      = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div style={{ padding: 0 }}>

      {/* ── 헤더 ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 24px",
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          설계 변경 이력
        </div>
        <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          총 <strong>{filtered.length}</strong>건
        </span>
      </div>

      <div style={{ padding: "0 24px 32px" }}>

        {/* ── 검색 + 페이지네이션 (상단) ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="대상 테이블·변경 사유·변경자 검색..."
              style={{
                padding: "7px 12px", borderRadius: 7,
                border: "1px solid var(--color-border)",
                background: "var(--color-bg-card)",
                color: "var(--color-text-primary)",
                fontSize: 13, outline: "none", width: 260,
              }}
            />
            <select
              value={actionFilter}
              onChange={(e) => handleActionFilter(e.target.value)}
              style={{
                padding: "7px 28px 7px 10px", borderRadius: 7,
                border: "1px solid var(--color-border)",
                background: "var(--color-bg-card)",
                color: "var(--color-text-primary)",
                fontSize: 13, cursor: "pointer",
                appearance: "none", WebkitAppearance: "none",
                backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 8px center",
              }}
            >
              <option value="">액션 전체</option>
              <option value="CREATE">등록</option>
              <option value="UPDATE">수정</option>
              <option value="DELETE">삭제</option>
            </select>
          </div>
          {!isLoading && filtered.length > PAGE_SIZE && (
            <Pagination
              currentPage={safePage}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          )}
        </div>

        {/* ── 테이블 ── */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>

          {/* 헤더 행 */}
          <div style={headerRowStyle}>
            <span style={{ textAlign: "right" }}>No</span>
            <span>액션</span>
            <span>대상 테이블</span>
            <span>변경 사유</span>
            <span>변경자</span>
            <span>변경 일시</span>
          </div>

          {/* 데이터 */}
          {isLoading ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "var(--color-text-secondary)", fontSize: 14 }}>
              로딩 중...
            </div>
          ) : paged.length === 0 ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "var(--color-text-secondary)", fontSize: 14 }}>
              {search ? "검색 결과가 없습니다." : "설계 변경 이력이 없습니다."}
            </div>
          ) : (
            paged.map((item, idx) => {
              // No: 전체 건수 기준 내림차순 (1페이지 1번 = 가장 최신)
              const no = filtered.length - ((safePage - 1) * PAGE_SIZE + idx);
              const colors = TABLE_COLOR[item.refTblNm] ?? { bg: "#f0f0f0", text: "#616161" };
              return (
                <div
                  key={item.chgId}
                  onClick={() => router.push(`/projects/${projectId}/design-changes/${item.chgId}`)}
                  style={{
                    ...dataRowStyle,
                    borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover, #f4f6ff)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-bg-card)")}
                >
                  {/* No */}
                  <span style={{ textAlign: "right", fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {no}
                  </span>

                  {/* 액션 타입 */}
                  <span>
                    {(() => {
                      const a = ACTION_STYLE[item.chgTypeCode] ?? { label: item.chgTypeCode, bg: "#f0f0f0", text: "#616161" };
                      return (
                        <span className="sp-badge" style={{
                          display: "inline-block", padding: "2px 8px", borderRadius: 12,
                          background: a.bg, color: a.text,
                          fontSize: 11, fontWeight: 700,
                        }}>
                          {a.label}
                        </span>
                      );
                    })()}
                  </span>

                  {/* 대상 테이블 */}
                  <span>
                    <span className="sp-badge" style={{
                      display: "inline-block", padding: "2px 8px", borderRadius: 12,
                      background: colors.bg, color: colors.text,
                      fontSize: 11, fontWeight: 700,
                    }}>
                      {tblLabel(item.refTblNm)}
                    </span>
                  </span>

                  {/* 변경 사유 */}
                  <span style={{
                    fontSize: 13, color: item.chgRsnCn ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    fontStyle: item.chgRsnCn ? "normal" : "italic",
                  }}>
                    {item.chgRsnCn ?? "—"}
                  </span>

                  {/* 변경자 */}
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.chgMberEmail ?? "—"}
                  </span>

                  {/* 변경 일시 */}
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                    {formatDate(item.chgDt)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────

function Pagination({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages:  number;
  onPageChange: (p: number) => void;
}) {
  // 최대 7개 페이지 번호 노출 (앞뒤 생략 포함)
  function getPages(): (number | "…")[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | "…")[] = [1];
    if (currentPage > 3) pages.push("…");
    for (let p = Math.max(2, currentPage - 1); p <= Math.min(totalPages - 1, currentPage + 1); p++) {
      pages.push(p);
    }
    if (currentPage < totalPages - 2) pages.push("…");
    pages.push(totalPages);
    return pages;
  }

  const pages = getPages();

  const btnBase: React.CSSProperties = {
    minWidth: 32, height: 32, borderRadius: 6,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg-card)",
    color: "var(--color-text-primary)",
    fontSize: 12, cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    padding: "0 8px",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 20 }}>
      {/* 이전 */}
      <button
        disabled={currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}
        style={{ ...btnBase, opacity: currentPage === 1 ? 0.4 : 1, cursor: currentPage === 1 ? "default" : "pointer" }}
      >
        ‹
      </button>

      {/* 페이지 번호 */}
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`ellipsis-${i}`} style={{ minWidth: 32, textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)" }}>
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            style={{
              ...btnBase,
              background: p === currentPage ? "var(--color-primary, #1976d2)" : "var(--color-bg-card)",
              color:      p === currentPage ? "#fff" : "var(--color-text-primary)",
              border:     p === currentPage ? "1px solid var(--color-primary, #1976d2)" : "1px solid var(--color-border)",
              fontWeight: p === currentPage ? 700 : 400,
            }}
          >
            {p}
          </button>
        )
      )}

      {/* 다음 */}
      <button
        disabled={currentPage === totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        style={{ ...btnBase, opacity: currentPage === totalPages ? 0.4 : 1, cursor: currentPage === totalPages ? "default" : "pointer" }}
      >
        ›
      </button>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const GRID = "48px 70px 130px 1fr minmax(140px,200px) 150px";

const headerRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: GRID,
  padding: "10px 16px", gap: 12,
  background: "var(--color-bg-muted)",
  borderBottom: "1px solid var(--color-border)",
  fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
  alignItems: "center",
};

const dataRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: GRID,
  padding: "11px 16px", gap: 12,
  background: "var(--color-bg-card)",
  alignItems: "center",
  transition: "background 0.1s",
};
