"use client";

/**
 * RevisionDiffDialog — DB 테이블 변경 이력 Diff 뷰어 (구조 diff)
 *
 * 역할:
 *   - 단건 리비전 조회 후 추가/수정/삭제 컬럼을 섹션별로 표시
 *   - 이전/다음 리비전 네비게이션 지원
 *
 * 표시 구조:
 *   📋 테이블 — (변경된 경우에만) before → after
 *   ➕ 추가된 컬럼 (N)
 *   ✏ 수정된 컬럼 (N)
 *   ➖ 삭제된 컬럼 (N)
 *
 * 색 사용 (토큰):
 *   - 추가: --color-success
 *   - 수정: --color-warning
 *   - 삭제: --color-error
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type ColumnSnapshotFields = {
  col_id:        string;
  col_physcl_nm: string;
  col_lgcl_nm:   string | null;
  data_ty_nm:    string | null;
  col_dc:        string | null;
  ref_grp_code:  string | null;
  sort_ordr:     number;
};

type ColumnModification = {
  col_id:        string;
  col_physcl_nm: string;
  before:        Partial<ColumnSnapshotFields>;
  after:         Partial<ColumnSnapshotFields>;
};

type RevisionDiffSnapshot = {
  table: { before: Record<string, unknown>; after: Record<string, unknown> } | null;
  columns: {
    added:    ColumnSnapshotFields[];
    modified: ColumnModification[];
    removed:  ColumnSnapshotFields[];
  };
};

type RevisionDetailResponse = {
  data: {
    revId:         string;
    revNo:         number;
    chgTypeCode:   "CREATE" | "UPDATE" | "DELETE";
    chgSummary:    string;
    chgMemberName: string;
    chgDt:         string;
    snapshot:      RevisionDiffSnapshot;
    prevRevId:     string | null;
    nextRevId:     string | null;
  };
};

// 컬럼 필드별 한글 레이블 (Diff 표시용)
const COL_FIELD_LABEL: Record<string, string> = {
  col_physcl_nm: "물리명",
  col_lgcl_nm:   "논리명",
  data_ty_nm:    "데이터 타입",
  col_dc:        "설명",
  ref_grp_code:  "참조 그룹",
  sort_ordr:     "정렬순서",
};

const TABLE_FIELD_LABEL: Record<string, string> = {
  tbl_physcl_nm: "물리 테이블명",
  tbl_lgcl_nm:   "논리 테이블명",
  tbl_dc:        "설명",
};

// ── Props ────────────────────────────────────────────────────────────────────

type Props = {
  projectId: string;
  tblId:     string;
  revId:     string;
  onClose:   () => void;
  onNavigate: (revId: string) => void;         // 이전/다음 버튼 클릭 시
};

// ── 컴포넌트 ─────────────────────────────────────────────────────────────────

export default function RevisionDiffDialog({
  projectId, tblId, revId, onClose, onNavigate,
}: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["db-table-revision-detail", projectId, tblId, revId],
    queryFn:  () =>
      authFetch<RevisionDetailResponse>(
        `/api/projects/${projectId}/db-tables/${tblId}/revisions/${revId}`
      ).then((r) => r.data),
  });

  return (
    <div className="sp-overlay" onClick={onClose}>
      <div
        className="sp-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 640, maxHeight: "85vh", display: "flex", flexDirection: "column" }}
      >
        <div className="sp-modal-header">
          <span className="sp-modal-title">변경 이력 #{data?.revNo ?? "-"}</span>
          <button type="button" onClick={onClose} style={closeBtnStyle} aria-label="닫기">×</button>
        </div>

        <div className="sp-modal-body" style={{ overflow: "auto", flex: 1 }}>
          {isLoading || !data ? (
            <div style={{ padding: "32px 0", textAlign: "center", color: "var(--color-text-tertiary)" }}>
              로딩 중...
            </div>
          ) : (
            <DiffBody data={data} />
          )}
        </div>

        <div className="sp-modal-footer">
          <button
            type="button"
            className="sp-btn sp-btn-ghost"
            disabled={!data?.prevRevId}
            onClick={() => data?.prevRevId && onNavigate(data.prevRevId)}
          >
            ◀ 이전
          </button>
          <button
            type="button"
            className="sp-btn sp-btn-ghost"
            disabled={!data?.nextRevId}
            onClick={() => data?.nextRevId && onNavigate(data.nextRevId)}
          >
            다음 ▶
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" className="sp-btn sp-btn-secondary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

// ── Diff 본문 ────────────────────────────────────────────────────────────────

function DiffBody({ data }: { data: RevisionDetailResponse["data"] }) {
  const { snapshot, chgMemberName, chgDt, chgTypeCode, chgSummary } = data;
  const { table, columns } = snapshot;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {/* 메타 정보 */}
      <div
        style={{
          padding:      "var(--space-3)",
          background:   "var(--color-bg-surface)",
          borderRadius: "var(--radius-md)",
          border:       "1px solid var(--color-border-subtle)",
          fontSize:     "var(--text-sm)",
          color:        "var(--color-text-secondary)",
          display:      "flex",
          flexDirection:"column",
          gap:          "var(--space-1)",
        }}
      >
        <div>
          <strong style={{ color: "var(--color-text-primary)" }}>{chgMemberName}</strong>
          {" · "}
          {new Date(chgDt).toLocaleString("ko-KR")}
          {" · "}
          <TypeBadge type={chgTypeCode} />
        </div>
        {chgSummary && (
          <div style={{ color: "var(--color-text-tertiary)" }}>{chgSummary}</div>
        )}
      </div>

      {/* 테이블 자체 변경 */}
      {table && (
        <Section
          title="테이블"
          icon="📋"
          color="var(--color-text-secondary)"
          count={Object.keys(table.after).length}
        >
          <FieldDiff before={table.before} after={table.after} labels={TABLE_FIELD_LABEL} />
        </Section>
      )}

      {/* 추가된 컬럼 */}
      {columns.added.length > 0 && (
        <Section title="추가된 컬럼" icon="➕" color="var(--color-success)" count={columns.added.length}>
          {columns.added.map((c) => (
            <ColumnRow key={c.col_id} col={c} accent="var(--color-success)" />
          ))}
        </Section>
      )}

      {/* 수정된 컬럼 */}
      {columns.modified.length > 0 && (
        <Section title="수정된 컬럼" icon="✏" color="var(--color-warning)" count={columns.modified.length}>
          {columns.modified.map((m) => (
            <ColumnModRow key={m.col_id} mod={m} />
          ))}
        </Section>
      )}

      {/* 삭제된 컬럼 */}
      {columns.removed.length > 0 && (
        <Section title="삭제된 컬럼" icon="➖" color="var(--color-error)" count={columns.removed.length}>
          {columns.removed.map((c) => (
            <ColumnRow key={c.col_id} col={c} accent="var(--color-error)" />
          ))}
        </Section>
      )}

      {/* 아무 변경도 없으면 (이론상 여기까지 오면 안 됨) */}
      {!table && columns.added.length === 0 && columns.modified.length === 0 && columns.removed.length === 0 && (
        <div style={{ padding: "24px 0", textAlign: "center", color: "var(--color-text-tertiary)" }}>
          변경 내역이 없습니다.
        </div>
      )}
    </div>
  );
}

// ── 섹션 ─────────────────────────────────────────────────────────────────────

type SectionProps = {
  title:    string;
  icon:     string;
  color:    string;
  count:    number;
  children: React.ReactNode;
};

function Section({ title, icon, color, count, children }: SectionProps) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ border: "1px solid var(--color-border-subtle)", borderRadius: "var(--radius-md)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width:       "100%",
          display:     "flex",
          alignItems:  "center",
          gap:         "var(--space-2)",
          padding:     "var(--space-3)",
          background:  "transparent",
          border:      "none",
          cursor:      "pointer",
          fontSize:    "var(--text-sm)",
          fontWeight:  600,
          color,
        }}
      >
        <span>{icon}</span>
        <span>{title}</span>
        <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400 }}>({count})</span>
        <div style={{ flex: 1 }} />
        <span style={{ color: "var(--color-text-tertiary)" }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 var(--space-3) var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── 컬럼 행 (추가/삭제용 — 전체 필드 한 줄) ─────────────────────────────────

function ColumnRow({ col, accent }: { col: ColumnSnapshotFields; accent: string }) {
  const parts = [
    col.col_physcl_nm,
    col.data_ty_nm,
    col.col_lgcl_nm ? `"${col.col_lgcl_nm}"` : null,
  ].filter(Boolean);
  return (
    <div
      style={{
        padding:      "var(--space-2) var(--space-3)",
        background:   "var(--color-bg-surface)",
        borderLeft:   `3px solid ${accent}`,
        borderRadius: "var(--radius-sm)",
        fontSize:     "var(--text-sm)",
        fontFamily:   "var(--font-mono)",
        color:        "var(--color-text-primary)",
      }}
    >
      {parts.join("  ·  ")}
      {col.col_dc && (
        <div style={{ fontFamily: "inherit", fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginTop: 2 }}>
          {col.col_dc}
        </div>
      )}
    </div>
  );
}

// ── 컬럼 수정 행 — 변경 필드 before → after ─────────────────────────────────

function ColumnModRow({ mod }: { mod: ColumnModification }) {
  const fieldKeys = Object.keys(mod.after);
  return (
    <div
      style={{
        padding:      "var(--space-2) var(--space-3)",
        background:   "var(--color-bg-surface)",
        borderLeft:   "3px solid var(--color-warning)",
        borderRadius: "var(--radius-sm)",
        fontSize:     "var(--text-sm)",
      }}
    >
      <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 4 }}>
        {mod.col_physcl_nm}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {fieldKeys.map((k) => (
          <FieldDiffLine
            key={k}
            label={COL_FIELD_LABEL[k] ?? k}
            before={mod.before[k as keyof ColumnSnapshotFields]}
            after={mod.after[k as keyof ColumnSnapshotFields]}
          />
        ))}
      </div>
    </div>
  );
}

// ── 필드 단위 diff (테이블/컬럼 공용) ───────────────────────────────────────

function FieldDiff({
  before, after, labels,
}: {
  before: Record<string, unknown>;
  after:  Record<string, unknown>;
  labels: Record<string, string>;
}) {
  const keys = Object.keys(after);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {keys.map((k) => (
        <FieldDiffLine key={k} label={labels[k] ?? k} before={before[k]} after={after[k]} />
      ))}
    </div>
  );
}

function FieldDiffLine({ label, before, after }: { label: string; before: unknown; after: unknown }) {
  return (
    <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>
      <span style={{ color: "var(--color-text-tertiary)", marginRight: 6 }}>{label}:</span>
      <span style={{ color: "var(--color-error)", textDecoration: "line-through", marginRight: 6 }}>
        {formatValue(before)}
      </span>
      <span style={{ color: "var(--color-text-tertiary)", marginRight: 6 }}>→</span>
      <span style={{ color: "var(--color-success)" }}>{formatValue(after)}</span>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(빈 값)";
  return String(v);
}

// ── 유형 배지 ────────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: "CREATE" | "UPDATE" | "DELETE" }) {
  const cls = type === "CREATE" ? "sp-badge sp-badge-success"
            : type === "UPDATE" ? "sp-badge sp-badge-warning"
            :                     "sp-badge sp-badge-error";
  const label = type === "CREATE" ? "등록" : type === "UPDATE" ? "수정" : "삭제";
  return <span className={cls}>{label}</span>;
}

// 사이트 표준 패턴: 박스 없이 텍스트만
const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border:     "none",
  cursor:     "pointer",
  fontSize:   20,
  lineHeight: 1,
  color:      "var(--color-text-tertiary)",
  padding:    0,
};
