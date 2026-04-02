"use client";

/**
 * DbTablesPage — DB 테이블 목록 (프로젝트별)
 *
 * 역할:
 *   - tb_ds_db_table 목록 조회 (컬럼 수 포함)
 *   - 테이블명 클릭 시 상세/편집 페이지 이동
 *   - 신규 등록 인라인 폼 (물리명 필수)
 *   - 삭제 확인 다이얼로그
 */

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type DbTableRow = {
  tblId:       string;
  tblPhysclNm: string;
  tblLgclNm:   string;
  tblDc:       string;
  creatDt:     string;
  columnCount: number;
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function DbTablesPage() {
  return (
    <Suspense fallback={null}>
      <DbTablesPageInner />
    </Suspense>
  );
}

function DbTablesPageInner() {
  const params      = useParams<{ id: string }>();
  const router      = useRouter();
  const qc          = useQueryClient();
  const projectId   = params.id;
  const { setBreadcrumb } = useAppStore();

  useEffect(() => {
    setBreadcrumb([{ label: "DB 테이블" }]);
    return () => setBreadcrumb([]);
  }, [setBreadcrumb]);

  const [search,       setSearch]       = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DbTableRow | null>(null);

  // ── 신규 등록 인라인 폼 ──────────────────────────────────────────────────────
  const [creating,     setCreating]     = useState(false);
  const [newPhysNm,    setNewPhysNm]    = useState("");
  const [newLgclNm,    setNewLgclNm]    = useState("");
  const [newDc,        setNewDc]        = useState("");

  // ── 목록 조회 ────────────────────────────────────────────────────────────────
  const { data: rows = [], isLoading } = useQuery<DbTableRow[]>({
    queryKey: ["db-tables", projectId],
    queryFn:  () =>
      authFetch<{ data: DbTableRow[] }>(`/api/projects/${projectId}/db-tables`)
        .then((r) => r.data),
  });

  // ── 생성 뮤테이션 ────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (body: { tblPhysclNm: string; tblLgclNm: string; tblDc: string }) =>
      authFetch<{ data: { tblId: string } }>(`/api/projects/${projectId}/db-tables`, {
        method: "POST",
        body:   JSON.stringify(body),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["db-tables", projectId] });
      toast.success("테이블이 등록되었습니다.");
      setCreating(false);
      setNewPhysNm(""); setNewLgclNm(""); setNewDc("");
      // 생성 즉시 상세 페이지로 이동
      router.push(`/projects/${projectId}/db-tables/${res.data.tblId}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 삭제 뮤테이션 ────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (tblId: string) =>
      authFetch(`/api/projects/${projectId}/db-tables/${tblId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["db-tables", projectId] });
      toast.success("테이블이 삭제되었습니다.");
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const filtered = rows.filter(
    (r) =>
      r.tblPhysclNm.toLowerCase().includes(search.toLowerCase()) ||
      r.tblLgclNm.toLowerCase().includes(search.toLowerCase())
  );

  function handleCreate() {
    if (!newPhysNm.trim()) { toast.error("물리 테이블명을 입력해 주세요."); return; }
    createMutation.mutate({ tblPhysclNm: newPhysNm, tblLgclNm: newLgclNm, tblDc: newDc });
  }

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
          DB 테이블 관리
        </div>
        <button
          onClick={() => { setCreating(true); setTimeout(() => document.getElementById("new-phys-nm")?.focus(), 50); }}
          style={primaryBtnStyle}
        >
          + 신규 등록
        </button>
      </div>

      <div style={{ padding: "0 24px 24px" }}>

        {/* ── 검색 + 건수 ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="테이블명 검색..."
            style={{ ...inputStyle, width: 280 }}
          />
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            총 <strong>{filtered.length}</strong>건
          </span>
        </div>

        {/* ── 테이블 ── */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>

          {/* 헤더 행 */}
          <div style={headerRowStyle}>
            <span>물리 테이블명</span>
            <span>논리 테이블명</span>
            <span>설명</span>
            <span style={{ textAlign: "center" }}>컬럼 수</span>
            <span>등록일</span>
            <span>액션</span>
          </div>

          {/* 신규 등록 인라인 폼 */}
          {creating && (
            <div style={{ ...dataRowStyle, background: "rgba(103,80,164,0.04)", borderTop: "none" }}>
              <input
                id="new-phys-nm"
                value={newPhysNm}
                onChange={(e) => setNewPhysNm(e.target.value)}
                placeholder="tb_example *"
                style={inlineInputStyle}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false); }}
              />
              <input
                value={newLgclNm}
                onChange={(e) => setNewLgclNm(e.target.value)}
                placeholder="예시 테이블"
                style={inlineInputStyle}
              />
              <input
                value={newDc}
                onChange={(e) => setNewDc(e.target.value)}
                placeholder="설명 (선택)"
                style={inlineInputStyle}
              />
              <div />
              <div />
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  style={saveBtnStyle}
                >
                  {createMutation.isPending ? "저장 중..." : "저장"}
                </button>
                <button onClick={() => setCreating(false)} style={cancelBtnStyle}>
                  취소
                </button>
              </div>
            </div>
          )}

          {/* 데이터 행 */}
          {isLoading ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
              로딩 중...
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
              {search ? "검색 결과가 없습니다." : "등록된 DB 테이블이 없습니다."}
            </div>
          ) : (
            filtered.map((row, idx) => (
              <div
                key={row.tblId}
                onClick={() => router.push(`/projects/${projectId}/db-tables/${row.tblId}`)}
                style={{
                  ...dataRowStyle,
                  borderTop: idx === 0 && !creating ? "none" : "1px solid var(--color-border)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover, #f4f6ff)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-bg-card)")}
              >
                {/* 물리명 */}
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-primary, #1976d2)", fontFamily: "monospace" }}>
                  {row.tblPhysclNm}
                </span>

                {/* 논리명 */}
                <span style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
                  {row.tblLgclNm || <span style={{ color: "#bbb" }}>—</span>}
                </span>

                {/* 설명 */}
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.tblDc || <span style={{ color: "#bbb" }}>—</span>}
                </span>

                {/* 컬럼 수 */}
                <span style={{ textAlign: "center", fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
                  {row.columnCount}
                </span>

                {/* 등록일 */}
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                  {row.creatDt.slice(0, 10)}
                </span>

                {/* 액션 */}
                <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => router.push(`/projects/${projectId}/db-tables/${row.tblId}`)}
                    style={editBtnStyle}
                  >
                    편집
                  </button>
                  <button
                    onClick={() => setDeleteTarget(row)}
                    style={dangerBtnStyle}
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── 삭제 확인 다이얼로그 ── */}
      {deleteTarget && (
        <div style={overlayStyle} onClick={() => setDeleteTarget(null)}>
          <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 700 }}>
              테이블을 삭제하시겠습니까?
            </p>
            <p style={{ margin: "0 0 6px", fontSize: 14, color: "var(--color-text-secondary)" }}>
              <code style={{ fontFamily: "monospace", background: "var(--color-bg-muted)", padding: "1px 6px", borderRadius: 4 }}>
                {deleteTarget.tblPhysclNm}
              </code>
            </p>
            {deleteTarget.columnCount > 0 && (
              <p style={{ margin: "0 0 20px", fontSize: 12, color: "#e57373" }}>
                ⚠ 하위 컬럼 {deleteTarget.columnCount}개도 함께 삭제됩니다.
              </p>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button
                style={{ ...cancelBtnStyle, padding: "6px 16px", fontSize: 13 }}
                onClick={() => setDeleteTarget(null)}
                disabled={deleteMutation.isPending}
              >
                취소
              </button>
              <button
                style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: "#e53935", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                onClick={() => deleteMutation.mutate(deleteTarget.tblId)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const GRID = "minmax(160px,220px) minmax(120px,180px) 1fr 80px 100px 110px";

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

const inputStyle: React.CSSProperties = {
  padding: "7px 12px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 13, outline: "none",
};

const inlineInputStyle: React.CSSProperties = {
  padding: "4px 8px", borderRadius: 5,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 12, outline: "none", width: "100%",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "5px 14px", borderRadius: 6,
  border: "1px solid transparent",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
};

const saveBtnStyle: React.CSSProperties = {
  padding: "3px 10px", borderRadius: 4,
  border: "none",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 11, fontWeight: 700, cursor: "pointer",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "3px 8px", borderRadius: 4,
  border: "1px solid var(--color-border)",
  background: "transparent", color: "var(--color-text-secondary)",
  fontSize: 11, cursor: "pointer",
};

const editBtnStyle: React.CSSProperties = {
  padding: "3px 10px", borderRadius: 4,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)", color: "var(--color-text-primary)",
  fontSize: 11, cursor: "pointer",
};

const dangerBtnStyle: React.CSSProperties = {
  padding: "3px 10px", borderRadius: 4,
  border: "none",
  background: "#fdecea", color: "#e53935",
  fontSize: 11, fontWeight: 600, cursor: "pointer",
};

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: "var(--color-bg-card)",
  borderRadius: 10, padding: "28px 32px",
  minWidth: 360, maxWidth: 440,
  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
};
