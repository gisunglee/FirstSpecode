"use client";

/**
 * StandardInfoPage — 기준 정보 관리
 *
 * 역할:
 *   - 프로젝트별 기준 정보(key-value) 목록 조회
 *   - 사용 여부(Y/N) 토글 즉시 전환
 *   - 행 클릭 → 상세 다이얼로그 → 수정/삭제
 *   - 신규 등록 → 추가 모달
 *   - 업무 구분 필터 + 키워드 검색
 *
 * 주요 기술:
 *   - TanStack Query: 목록 useQuery, 토글/삭제 useMutation, 저장 후 invalidate
 *   - authFetch: 인증 헤더 자동 포함
 *   - 모든 색상은 semantic 토큰 (3테마 자동 대응)
 *
 * 컴포넌트 분리:
 *   - StdInfoEditModal      : 추가/수정 모달
 *   - StdInfoDetailDialog   : 상세 조회 다이얼로그
 *   - _constants.ts         : 타입·BUS_DIV/DATA_TYPE 옵션·색상 매핑·날짜 헬퍼
 *
 * 명명 이력:
 *   - 2026-05-05 reference-info / ref_* → standard-info / std_* 로 통일
 *   - 2026-05-05 전역 → 프로젝트 단위 (prjct_id NOT NULL) 전환
 *   - 2026-05-05 690줄 단일 파일 → page + 모달 2개 + _constants 분리
 */

import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";
import {
  type StdInfo,
  BUS_DIV_OPTIONS,
  BUS_DIV_LABEL,
  DATA_TYPE_LABEL,
  BUS_DIV_COLOR,
  FALLBACK_BUS_DIV_COLOR,
  formatDate,
} from "./_constants";
import { StdInfoEditModal }    from "./_components/StdInfoEditModal";
import { StdInfoDetailDialog } from "./_components/StdInfoDetailDialog";

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function StandardInfoPage() {
  return (
    <Suspense fallback={null}>
      <StandardInfoPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────

function StandardInfoPageInner() {
  const params      = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const projectId   = params.id;
  const { setBreadcrumb } = useAppStore();

  useEffect(() => {
    setBreadcrumb([{ label: "기준 정보 관리" }]);
    return () => setBreadcrumb([]);
  }, [setBreadcrumb]);

  // ── 화면 상태 ─────────────────────────────────────────────────────────────
  const [search,       setSearch]       = useState("");
  const [busFilter,    setBusFilter]    = useState("");
  const [modalOpen,    setModalOpen]    = useState(false);
  const [editTarget,   setEditTarget]   = useState<StdInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StdInfo | null>(null);
  const [viewTarget,   setViewTarget]   = useState<StdInfo | null>(null);

  // ── 목록 조회 ─────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery<{ items: StdInfo[]; totalCount: number }>({
    queryKey: ["standard-info", projectId],
    queryFn:  () =>
      authFetch<{ data: { items: StdInfo[]; totalCount: number } }>(
        `/api/projects/${projectId}/standard-info`,
      ).then((r) => r.data),
  });

  const items = data?.items ?? [];

  // 필터 적용 — 서버 페이지네이션은 아직 없음 (운영상 row 수가 많지 않을 것 가정)
  const filtered = items.filter((item) => {
    if (busFilter && item.busDivCode !== busFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      item.stdInfoCode.toLowerCase().includes(q) ||
      item.stdInfoNm.toLowerCase().includes(q) ||
      (item.mainStdVal ?? "").toLowerCase().includes(q) ||
      (item.subStdVal  ?? "").toLowerCase().includes(q) ||
      (item.stdInfoDc  ?? "").toLowerCase().includes(q)
    );
  });

  // ── 사용 여부 토글 ────────────────────────────────────────────────────────
  // PUT 본문에 useYn 한 키만 보냄 → 서버 isToggle 판별이 단일키 검사로 통과.
  const toggleMutation = useMutation({
    mutationFn: ({ stdInfoId, useYn }: { stdInfoId: string; useYn: string }) =>
      authFetch(`/api/projects/${projectId}/standard-info/${stdInfoId}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ useYn }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["standard-info", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 삭제 ──────────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (stdInfoId: string) =>
      authFetch(`/api/projects/${projectId}/standard-info/${stdInfoId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["standard-info", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function openCreate() {
    setEditTarget(null);
    setModalOpen(true);
  }

  function openEdit(item: StdInfo) {
    setEditTarget(item);
    setModalOpen(true);
  }

  return (
    <div style={{ padding: 0 }}>

      {/* ── 헤더 ── */}
      <div style={headerBarStyle}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          기준 정보 관리
        </div>
        <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          총 <strong>{filtered.length}</strong>건
        </span>
      </div>

      <div style={{ padding: "0 24px 32px" }}>

        {/* ── 검색 + 필터 + 추가 버튼 ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="코드·명칭·값 검색..."
            style={searchInputStyle}
          />
          <select value={busFilter} onChange={(e) => setBusFilter(e.target.value)} style={selectStyle}>
            <option value="">업무 구분 전체</option>
            {BUS_DIV_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <div style={{ flex: 1 }} />
          <button onClick={openCreate} style={addBtnStyle}>+ 기준 정보 추가</button>
        </div>

        {/* ── 테이블 ── */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
          {/* 헤더 행 */}
          <div style={headerRowStyle}>
            <span>업무 구분</span>
            <span>코드</span>
            <span>기준 정보 명</span>
            <span>유형</span>
            <span>주요 값</span>
            <span>보조 값</span>
            <span>기간</span>
            <span>사용</span>
          </div>

          {isLoading ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "var(--color-text-secondary)" }}>
              로딩 중...
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "var(--color-text-secondary)", fontSize: 14 }}>
              {search || busFilter ? "검색 결과가 없습니다." : "기준 정보를 추가해 주세요."}
            </div>
          ) : (
            filtered.map((item, idx) => (
              <DataRow
                key={item.stdInfoId}
                item={item}
                isFirst={idx === 0}
                onClickRow={() => setViewTarget(item)}
                onToggle={() => toggleMutation.mutate({
                  stdInfoId: item.stdInfoId,
                  useYn:     item.useYn === "Y" ? "N" : "Y",
                })}
              />
            ))
          )}
        </div>
      </div>

      {/* ── 추가/수정 모달 ── */}
      {modalOpen && (
        <StdInfoEditModal
          projectId={projectId}
          editTarget={editTarget}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            queryClient.invalidateQueries({ queryKey: ["standard-info", projectId] });
          }}
        />
      )}

      {/* ── 상세 조회 다이얼로그 ── */}
      {viewTarget && (
        <StdInfoDetailDialog
          target={viewTarget}
          onClose={() => setViewTarget(null)}
          onEdit={(t) => { setViewTarget(null); openEdit(t); }}
          onDelete={(t) => { setViewTarget(null); setDeleteTarget(t); }}
        />
      )}

      {/* ── 삭제 확인 다이얼로그 ── */}
      {deleteTarget && (
        <div style={overlayStyle} onClick={() => setDeleteTarget(null)}>
          <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>
              기준 정보를 삭제하시겠습니까?
            </h3>
            <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600 }}>
              &lsquo;{deleteTarget.stdInfoNm}&rsquo;
            </p>
            <p style={{ margin: "0 0 24px", fontSize: 13, color: "var(--color-text-tertiary)" }}>
              삭제된 기준 정보는 복구할 수 없습니다.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setDeleteTarget(null)}
                style={secondaryBtnStyle}
                disabled={deleteMutation.isPending}
              >
                취소
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteTarget.stdInfoId)}
                style={dangerBtnStyle}
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

// ── 데이터 행 컴포넌트 ───────────────────────────────────────────────────────
// 행 단위로 분리해야 hover 핸들러가 매 행마다 새로 만들어지지 않음 + 가독성 향상

function DataRow({ item, isFirst, onClickRow, onToggle }: {
  item:       StdInfo;
  isFirst:    boolean;
  onClickRow: () => void;
  onToggle:   () => void;
}) {
  const busColor = BUS_DIV_COLOR[item.busDivCode] ?? FALLBACK_BUS_DIV_COLOR;
  const isActive = item.useYn === "Y";
  const period   = formatDate(item.stdBgngDe) + (item.stdEndDe ? ` ~ ${formatDate(item.stdEndDe)}` : " ~");

  return (
    <div
      onClick={onClickRow}
      style={{
        ...dataRowStyle,
        borderTop: isFirst ? "none" : "1px solid var(--color-border)",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-table-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-bg-card)")}
    >
      {/* 업무 구분 */}
      <span>
        <span style={{
          display: "inline-block", padding: "2px 8px", borderRadius: 12,
          background: busColor.bg, color: busColor.text,
          fontSize: 11, fontWeight: 700,
        }}>
          {BUS_DIV_LABEL[item.busDivCode] ?? item.busDivCode}
        </span>
      </span>

      {/* 코드 */}
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)" }}>
        {item.stdInfoCode}
      </span>

      {/* 기준 정보 명 */}
      <span style={{
        fontSize: 13, color: "var(--color-text-primary)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {item.stdInfoNm}
      </span>

      {/* 유형 */}
      <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
        {DATA_TYPE_LABEL[item.stdDataTyCode] ?? item.stdDataTyCode}
      </span>

      {/* 주요 값 — 강조용으로 brand 색상 사용 */}
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-brand)" }}>
        {item.mainStdVal || "—"}
      </span>

      {/* 보조 값 */}
      <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
        {item.subStdVal || "—"}
      </span>

      {/* 기간 */}
      <span style={{ fontSize: 11, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
        {period}
      </span>

      {/* 사용 여부 토글 */}
      <span onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onToggle}
          style={isActive ? togglePillActiveStyle : togglePillInactiveStyle}
          title={isActive ? "클릭하면 비활성화" : "클릭하면 활성화"}
        >
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: isActive ? "var(--color-success)" : "var(--color-text-tertiary)",
          }} />
          {isActive ? "사용" : "미사용"}
        </button>
      </span>
    </div>
  );
}

// ── 스타일 (모두 토큰 사용) ──────────────────────────────────────────────────
//
// 그리드는 컬럼 8개 — 업무구분 / 코드 / 기준정보명 / 유형 / 주요값 / 보조값 / 기간 / 사용
// 컬럼 폭 변경 시 GRID 만 수정하면 헤더·행이 함께 따라간다.
const GRID = "80px 70px 1fr 65px 80px 80px minmax(130px,160px) 70px";

const headerBarStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "10px 24px",
  background: "var(--color-bg-card)",
  borderBottom: "1px solid var(--color-border)",
  marginBottom: 16,
};

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
  padding: "10px 16px", gap: 12,
  background: "var(--color-bg-card)",
  alignItems: "center",
  transition: "background 0.1s",
};

const searchInputStyle: React.CSSProperties = {
  padding: "7px 12px", borderRadius: 7,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)", color: "var(--color-text-primary)",
  fontSize: 13, outline: "none", width: 240,
};

// 목록 화면 필터용 select — 과업 목록(filterSelectStyle) 과 동일한 표준 스타일.
// 네이티브 화살표를 숨기고(appearance:none) 직접 그린 chevron SVG 를 우측 10px 위치에 배치.
const selectStyle: React.CSSProperties = {
  padding:            "7px 32px 7px 12px",
  borderRadius:       6,
  border:             "1px solid var(--color-border)",
  fontSize:           13,
  background:         "var(--color-bg-card)",
  color:              "var(--color-text-primary)",
  cursor:             "pointer",
  outline:            "none",
  appearance:         "none",
  WebkitAppearance:   "none",
  backgroundImage:    `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
  backgroundRepeat:   "no-repeat",
  backgroundPosition: "right 10px center",
  minWidth:           140,
};

const addBtnStyle: React.CSSProperties = {
  padding: "7px 16px", borderRadius: 7,
  border: "none",
  background: "var(--color-brand)",
  color: "var(--color-text-inverse)",
  fontSize: 13, fontWeight: 600, cursor: "pointer",
};

const togglePillBaseStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "2px 10px", borderRadius: 12,
  border: "1px solid", cursor: "pointer",
  fontSize: 11, fontWeight: 600,
};

const togglePillActiveStyle: React.CSSProperties = {
  ...togglePillBaseStyle,
  borderColor: "var(--color-success)",
  background:  "var(--color-success-subtle)",
  color:       "var(--color-success)",
};

const togglePillInactiveStyle: React.CSSProperties = {
  ...togglePillBaseStyle,
  borderColor: "var(--color-border)",
  background:  "var(--color-bg-muted)",
  color:       "var(--color-text-secondary)",
};

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "var(--color-bg-overlay)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: "var(--color-bg-card)",
  borderRadius: 12, padding: "24px 28px",
  boxShadow: "var(--shadow-lg)",
  color: "var(--color-text-primary)",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "7px 20px", borderRadius: 6,
  border: "none",
  background: "var(--color-brand)",
  color: "var(--color-text-inverse)",
  fontSize: 13, fontWeight: 600, cursor: "pointer",
};

const dangerBtnStyle: React.CSSProperties = {
  ...primaryBtnStyle,
  background: "var(--color-error)",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "7px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 13, cursor: "pointer",
};
