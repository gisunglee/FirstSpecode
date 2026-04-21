"use client";

/**
 * RevisionList — DB 테이블 변경 이력 목록 그리드
 *
 * 역할:
 *   - 이력 목록 조회 (페이지네이션)
 *   - 행의 [Diff] 버튼 클릭 → onSelectRev(revId) 콜백
 *
 * Props:
 *   - projectId, tblId
 *   - pageSize (기본 20)
 *   - compact: true 면 페이지네이션 없이 1페이지만 (상세 페이지 하단 인라인 용)
 *   - onSelectRev: 행 선택 콜백
 *
 * 참고:
 *   - 변경자 표시는 이름만 (AI/사람 구분 없음)
 *   - 삭제 액션 없음 (감사 기록)
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type RevisionItem = {
  revId:         string;
  revNo:         number;
  chgTypeCode:   "CREATE" | "UPDATE" | "DELETE";
  chgSummary:    string;
  chgMemberName: string;
  chgDt:         string;
};

type RevisionListResponse = {
  data: {
    items:      RevisionItem[];
    totalCount: number;
    page:       number;
    pageSize:   number;
  };
};

// ── 설정 ─────────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 20;

// chgTypeCode 별 배지 클래스
const TYPE_BADGE: Record<RevisionItem["chgTypeCode"], string> = {
  CREATE: "sp-badge sp-badge-success",
  UPDATE: "sp-badge sp-badge-warning",
  DELETE: "sp-badge sp-badge-error",
};
const TYPE_LABEL: Record<RevisionItem["chgTypeCode"], string> = {
  CREATE: "등록",
  UPDATE: "수정",
  DELETE: "삭제",
};

// ── Props ────────────────────────────────────────────────────────────────────

type Props = {
  projectId:    string;
  tblId:        string;
  pageSize?:    number;
  compact?:     boolean;                                // 상세 페이지 하단 인라인 모드
  onSelectRev:  (revId: string) => void;
};

// ── 컴포넌트 ─────────────────────────────────────────────────────────────────

export default function RevisionList({
  projectId, tblId, pageSize = DEFAULT_PAGE_SIZE, compact = false, onSelectRev,
}: Props) {
  const [page, setPage] = useState(1);

  // compact 모드는 항상 1페이지, 전체 모드는 페이지 번호 상태 사용
  const currentPage = compact ? 1 : page;

  const { data, isLoading } = useQuery({
    queryKey: ["db-table-revisions", projectId, tblId, currentPage, pageSize],
    queryFn:  () =>
      authFetch<RevisionListResponse>(
        `/api/projects/${projectId}/db-tables/${tblId}/revisions?page=${currentPage}&pageSize=${pageSize}`
      ).then((r) => r.data),
  });

  const items      = data?.items ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  if (isLoading) {
    return (
      <div style={{ padding: "24px 0", textAlign: "center", color: "var(--color-text-tertiary)" }}>
        로딩 중...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: "24px 0", textAlign: "center", color: "var(--color-text-tertiary)" }}>
        변경 이력이 없습니다.
      </div>
    );
  }

  return (
    <div>
      {/* 그리드 */}
      <div
        style={{
          border:       "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          overflow:     "hidden",
        }}
      >
        {/* 헤더 */}
        <div style={headerRowStyle}>
          <div>변경일시</div>
          <div>변경자</div>
          <div>유형</div>
          <div>요약</div>
          <div style={{ textAlign: "center" }}>액션</div>
        </div>

        {/* 데이터 행 */}
        {items.map((it, idx) => (
          <div
            key={it.revId}
            style={{
              ...dataRowStyle,
              borderTop: idx === 0 ? "none" : "1px solid var(--color-border-subtle)",
            }}
          >
            <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
              {formatDt(it.chgDt)}
            </div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)" }}>
              {it.chgMemberName}
            </div>
            <div>
              <span className={TYPE_BADGE[it.chgTypeCode]}>
                {TYPE_LABEL[it.chgTypeCode]}
              </span>
            </div>
            <div
              style={{
                fontSize:     "var(--text-sm)",
                color:        "var(--color-text-secondary)",
                overflow:     "hidden",
                textOverflow: "ellipsis",
                whiteSpace:   "nowrap",
              }}
              title={it.chgSummary}
            >
              {it.chgSummary || "-"}
            </div>
            <div style={{ textAlign: "center" }}>
              <button
                type="button"
                className="sp-btn sp-btn-ghost"
                onClick={() => onSelectRev(it.revId)}
                style={{ padding: "2px 10px", fontSize: "var(--text-xs)" }}
              >
                Diff
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 페이지네이션 (compact 모드에서는 숨김) */}
      {!compact && totalPages > 1 && (
        <div
          style={{
            display:        "flex",
            alignItems:     "center",
            justifyContent: "space-between",
            marginTop:      "var(--space-3)",
            fontSize:       "var(--text-sm)",
            color:          "var(--color-text-secondary)",
          }}
        >
          <div>총 {totalCount}건 · {currentPage} / {totalPages} 페이지</div>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              className="sp-btn sp-btn-ghost"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              style={{ padding: "4px 10px" }}
            >
              이전
            </button>
            <button
              type="button"
              className="sp-btn sp-btn-ghost"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              style={{ padding: "4px 10px" }}
            >
              다음
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function formatDt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── 스타일 (토큰 기반) ───────────────────────────────────────────────────────

// 그리드 컬럼: 변경일시 140 | 변경자 100 | 유형 70 | 요약 1fr | 액션 70
const gridTemplate = "140px 100px 70px 1fr 70px";

// 다른 이력 화면과 동일 패턴: 헤더 muted(회색), 데이터 행 card(흰색)
const headerRowStyle: React.CSSProperties = {
  display:             "grid",
  gridTemplateColumns: gridTemplate,
  alignItems:          "center",
  gap:                 "var(--space-3)",
  padding:             "10px 16px",
  background:          "var(--color-bg-muted)",
  fontSize:            "var(--text-xs)",
  fontWeight:          600,
  color:               "var(--color-text-secondary)",
  borderBottom:        "1px solid var(--color-border)",
};

const dataRowStyle: React.CSSProperties = {
  display:             "grid",
  gridTemplateColumns: gridTemplate,
  alignItems:          "center",
  gap:                 "var(--space-3)",
  padding:             "12px 16px",
  background:          "var(--color-bg-card)",
};
