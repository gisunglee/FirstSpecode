"use client";

/**
 * ReferenceInfoPage — 기준 정보 관리
 *
 * 역할:
 *   - 시스템 설정값(key-value) 카드형 목록 조회
 *   - 사용 여부(Y/N) 토글 즉시 전환
 *   - 추가/수정 모달 다이얼로그
 *   - 업무 구분 필터 + 키워드 검색
 *   - 논리삭제 (del_yn)
 */

import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type RefInfo = {
  refInfoId:     string;
  refInfoCode:   string;
  refBgngDe:     string;
  refEndDe:      string | null;
  refInfoNm:     string;
  busDivCode:    string;
  refDataTyCode: string;
  mainRefVal:    string | null;
  subRefVal:     string | null;
  refInfoDc:     string | null;
  useYn:         string;
  creatDt:       string;
  mdfcnDt:       string | null;
};

// ── 업무 구분 / 자료 유형 레이블 ──────────────────────────────────────────────

const BUS_DIV_OPTIONS = [
  { value: "AUTH",   label: "인증" },
  { value: "SYSTEM", label: "시스템" },
  { value: "PRJCT",  label: "프로젝트" },
  { value: "USER",   label: "사용자" },
  { value: "AI",     label: "AI" },
  { value: "ETC",    label: "기타" },
];

const DATA_TYPE_OPTIONS = [
  { value: "STRING", label: "문자열" },
  { value: "NUMBER", label: "숫자" },
  { value: "YN",     label: "Y/N" },
  { value: "DATE",   label: "일자" },
  { value: "CODE",   label: "코드" },
  { value: "JSON",   label: "JSON" },
];

// YYYYMMDD → YYYY-MM-DD (다른 형식이면 원본 그대로 반환)
function formatDate(d: string | null | undefined): string {
  if (!d) return "";
  const s = d.replace(/-/g, "");
  if (s.length === 8 && /^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return d;
}

const BUS_DIV_LABEL: Record<string, string> = Object.fromEntries(BUS_DIV_OPTIONS.map((o) => [o.value, o.label]));
const DATA_TYPE_LABEL: Record<string, string> = Object.fromEntries(DATA_TYPE_OPTIONS.map((o) => [o.value, o.label]));

const BUS_DIV_COLOR: Record<string, { bg: string; text: string }> = {
  AUTH:   { bg: "#e8eaf6", text: "#3949ab" },
  SYSTEM: { bg: "#e3f2fd", text: "#1565c0" },
  PRJCT:  { bg: "#e8f5e9", text: "#2e7d32" },
  USER:   { bg: "#fff8e1", text: "#f57f17" },
  AI:     { bg: "#fce4ec", text: "#c62828" },
  ETC:    { bg: "#f3e5f5", text: "#6a1b9a" },
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function ReferenceInfoPage() {
  return (
    <Suspense fallback={null}>
      <ReferenceInfoPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────

function ReferenceInfoPageInner() {
  const params      = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const projectId   = params.id;
  const { setBreadcrumb } = useAppStore();

  useEffect(() => {
    setBreadcrumb([{ label: "기준 정보 관리" }]);
    return () => setBreadcrumb([]);
  }, [setBreadcrumb]);

  const [search,     setSearch]     = useState("");
  const [busFilter,  setBusFilter]  = useState("");
  const [modalOpen,  setModalOpen]  = useState(false);
  const [editTarget, setEditTarget] = useState<RefInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RefInfo | null>(null);
  const [viewTarget,   setViewTarget]   = useState<RefInfo | null>(null);

  // ── 목록 조회 ──────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery<{ items: RefInfo[]; totalCount: number }>({
    queryKey: ["reference-info", projectId],
    queryFn:  () =>
      authFetch<{ data: { items: RefInfo[]; totalCount: number } }>(
        `/api/projects/${projectId}/reference-info`
      ).then((r) => r.data),
  });

  const items = data?.items ?? [];

  // 필터 적용
  const filtered = items.filter((item) => {
    if (busFilter && item.busDivCode !== busFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      item.refInfoCode.toLowerCase().includes(q) ||
      item.refInfoNm.toLowerCase().includes(q) ||
      (item.mainRefVal ?? "").toLowerCase().includes(q) ||
      (item.subRefVal ?? "").toLowerCase().includes(q) ||
      (item.refInfoDc ?? "").toLowerCase().includes(q)
    );
  });

  // ── 사용 여부 토글 ────────────────────────────────────────────────────────
  const toggleMutation = useMutation({
    mutationFn: ({ refInfoId, useYn }: { refInfoId: string; useYn: string }) =>
      authFetch(`/api/projects/${projectId}/reference-info/${refInfoId}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ useYn }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reference-info", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 삭제 ──────────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (refInfoId: string) =>
      authFetch(`/api/projects/${projectId}/reference-info/${refInfoId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["reference-info", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function openCreate() {
    setEditTarget(null);
    setModalOpen(true);
  }

  function openEdit(item: RefInfo) {
    setEditTarget(item);
    setModalOpen(true);
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
            <div style={{ padding: "64px 0", textAlign: "center", color: "var(--color-text-secondary)" }}>로딩 중...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "var(--color-text-secondary)", fontSize: 14 }}>
              {search || busFilter ? "검색 결과가 없습니다." : "기준 정보를 추가해 주세요."}
            </div>
          ) : (
            filtered.map((item, idx) => {
              const busColor = BUS_DIV_COLOR[item.busDivCode] ?? { bg: "#f0f0f0", text: "#616161" };
              const isActive = item.useYn === "Y";
              const period = formatDate(item.refBgngDe) + (item.refEndDe ? ` ~ ${formatDate(item.refEndDe)}` : " ~");
              return (
                <div
                  key={item.refInfoId}
                  onClick={() => setViewTarget(item)}
                  style={{
                    ...dataRowStyle,
                    borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover, #f4f6ff)")}
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
                    {item.refInfoCode}
                  </span>

                  {/* 기준 정보 명 */}
                  <span style={{ fontSize: 13, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.refInfoNm}
                  </span>

                  {/* 유형 */}
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {DATA_TYPE_LABEL[item.refDataTyCode] ?? item.refDataTyCode}
                  </span>

                  {/* 주요 값 */}
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-primary, #1976d2)" }}>
                    {item.mainRefVal || "—"}
                  </span>

                  {/* 보조 값 */}
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {item.subRefVal || "—"}
                  </span>

                  {/* 기간 */}
                  <span style={{ fontSize: 11, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                    {period}
                  </span>

                  {/* 사용 여부 토글 */}
                  <span onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => toggleMutation.mutate({ refInfoId: item.refInfoId, useYn: isActive ? "N" : "Y" })}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "2px 10px", borderRadius: 12,
                        border: "1px solid", cursor: "pointer",
                        borderColor: isActive ? "#4caf50" : "var(--color-border)",
                        background: isActive ? "#e8f5e9" : "var(--color-bg-muted)",
                        color: isActive ? "#2e7d32" : "var(--color-text-secondary)",
                        fontSize: 11, fontWeight: 600,
                      }}
                      title={isActive ? "클릭하면 비활성화" : "클릭하면 활성화"}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: isActive ? "#4caf50" : "#bdbdbd" }} />
                      {isActive ? "사용" : "미사용"}
                    </button>
                  </span>

                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── 추가/수정 모달 ── */}
      {modalOpen && (
        <RefInfoModal
          projectId={projectId}
          editTarget={editTarget}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            queryClient.invalidateQueries({ queryKey: ["reference-info", projectId] });
          }}
        />
      )}

      {/* ── 상세 조회 다이얼로그 ── */}
      {viewTarget && (() => {
        const v = viewTarget;
        const busColor = BUS_DIV_COLOR[v.busDivCode] ?? { bg: "#f0f0f0", text: "#616161" };
        const period = formatDate(v.refBgngDe) + (v.refEndDe ? ` ~ ${formatDate(v.refEndDe)}` : " ~");
        return (
          <div style={overlayStyle} onClick={() => setViewTarget(null)}>
            <div style={{ ...dialogStyle, minWidth: 480, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
              {/* 헤더 */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    display: "inline-block", padding: "2px 8px", borderRadius: 12,
                    background: busColor.bg, color: busColor.text,
                    fontSize: 11, fontWeight: 700,
                  }}>
                    {BUS_DIV_LABEL[v.busDivCode] ?? v.busDivCode}
                  </span>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>
                    {v.refInfoNm}
                  </h3>
                </div>
                <button
                  onClick={() => setViewTarget(null)}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1, padding: "0 2px" }}
                >
                  ×
                </button>
              </div>

              {/* 상세 내용 */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
                {[
                  { label: "코드",     value: v.refInfoCode },
                  { label: "유형",     value: DATA_TYPE_LABEL[v.refDataTyCode] ?? v.refDataTyCode },
                  { label: "주요 값",  value: v.mainRefVal || "—" },
                  { label: "보조 값",  value: v.subRefVal || "—" },
                  { label: "기간",     value: period },
                  { label: "사용",     value: v.useYn === "Y" ? "사용" : "미사용" },
                  { label: "설명",     value: v.refInfoDc || "—" },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>{label}</span>
                    <span style={{ fontSize: 13, color: "var(--color-text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* 액션 버튼 */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button onClick={() => setViewTarget(null)} style={secondaryBtnStyle}>닫기</button>
                <button
                  onClick={() => { setViewTarget(null); setDeleteTarget(v); }}
                  style={{ ...primaryBtnStyle, background: "#e53935" }}
                >
                  삭제
                </button>
                <button
                  onClick={() => { setViewTarget(null); openEdit(v); }}
                  style={primaryBtnStyle}
                >
                  수정
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 삭제 확인 다이얼로그 ── */}
      {deleteTarget && (
        <div style={overlayStyle} onClick={() => setDeleteTarget(null)}>
          <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>기준 정보를 삭제하시겠습니까?</h3>
            <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600 }}>&lsquo;{deleteTarget.refInfoNm}&rsquo;</p>
            <p style={{ margin: "0 0 24px", fontSize: 13, color: "#888" }}>삭제된 기준 정보는 복구할 수 없습니다.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setDeleteTarget(null)} style={secondaryBtnStyle} disabled={deleteMutation.isPending}>취소</button>
              <button
                onClick={() => deleteMutation.mutate(deleteTarget.refInfoId)}
                style={{ ...primaryBtnStyle, background: "#e53935" }}
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

// ── 추가/수정 모달 ───────────────────────────────────────────────────────────

function RefInfoModal({
  projectId, editTarget, onClose, onSaved,
}: {
  projectId:  string;
  editTarget: RefInfo | null;
  onClose:    () => void;
  onSaved:    () => void;
}) {
  const isEdit = !!editTarget;

  const [refInfoCode,   setRefInfoCode]   = useState(editTarget?.refInfoCode ?? "");
  const [refInfoNm,     setRefInfoNm]     = useState(editTarget?.refInfoNm ?? "");
  const [busDivCode,    setBusDivCode]    = useState(editTarget?.busDivCode ?? "SYSTEM");
  const [refDataTyCode, setRefDataTyCode] = useState(editTarget?.refDataTyCode ?? "STRING");
  const [refBgngDe,     setRefBgngDe]     = useState(editTarget?.refBgngDe ?? getTodayStr());
  const [refEndDe,      setRefEndDe]      = useState(editTarget?.refEndDe ?? "99991231");
  const [mainRefVal,    setMainRefVal]    = useState(editTarget?.mainRefVal ?? "");
  const [subRefVal,     setSubRefVal]     = useState(editTarget?.subRefVal ?? "");
  const [refInfoDc,     setRefInfoDc]     = useState(editTarget?.refInfoDc ?? "");

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        refInfoCode, refBgngDe, refEndDe, refInfoNm,
        busDivCode, refDataTyCode, mainRefVal, subRefVal, refInfoDc,
      };
      if (isEdit) {
        return authFetch(`/api/projects/${projectId}/reference-info/${editTarget.refInfoId}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      return authFetch(`/api/projects/${projectId}/reference-info`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      toast.success(isEdit ? "수정되었습니다." : "추가되었습니다.");
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...dialogStyle, maxWidth: 520, width: "90vw" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 20px", fontSize: 17, fontWeight: 700 }}>
          {isEdit ? "기준 정보 수정" : "기준 정보 추가"}
        </h3>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* 코드 + 명칭 */}
          <div style={{ display: "flex", gap: 12 }}>
            <ModalField label="기준 정보 코드 *" style={{ width: 120 }}>
              <input value={refInfoCode} onChange={(e) => setRefInfoCode(e.target.value.toUpperCase())}
                maxLength={6} placeholder="AUTH01" style={modalInputStyle} disabled={isEdit} />
            </ModalField>
            <ModalField label="기준 정보 명 *" style={{ flex: 1 }}>
              <input value={refInfoNm} onChange={(e) => setRefInfoNm(e.target.value)} style={modalInputStyle} />
            </ModalField>
          </div>

          {/* 업무 구분 + 자료 유형 */}
          <div style={{ display: "flex", gap: 12 }}>
            <ModalField label="업무 구분 *" style={{ flex: 1 }}>
              <select value={busDivCode} onChange={(e) => setBusDivCode(e.target.value)} style={modalSelectStyle}>
                {BUS_DIV_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </ModalField>
            <ModalField label="자료 유형 *" style={{ flex: 1 }}>
              <select value={refDataTyCode} onChange={(e) => setRefDataTyCode(e.target.value)} style={modalSelectStyle}>
                {DATA_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </ModalField>
          </div>

          {/* 값 */}
          <div style={{ display: "flex", gap: 12 }}>
            <ModalField label="주요 기준 값" style={{ flex: 1 }}>
              <input value={mainRefVal} onChange={(e) => setMainRefVal(e.target.value)} style={modalInputStyle} placeholder="Y, 5, ADMIN 등" />
            </ModalField>
            <ModalField label="보조 기준 값" style={{ flex: 1 }}>
              <input value={subRefVal} onChange={(e) => setSubRefVal(e.target.value)} style={modalInputStyle} />
            </ModalField>
          </div>

          {/* 기간 */}
          <div style={{ display: "flex", gap: 12 }}>
            <ModalField label="기준 시작일 *" style={{ flex: 1 }}>
              <input value={refBgngDe} onChange={(e) => setRefBgngDe(e.target.value)}
                maxLength={8} placeholder="20260101" style={modalInputStyle} />
            </ModalField>
            <ModalField label="기준 종료일" style={{ flex: 1 }}>
              <input value={refEndDe} onChange={(e) => setRefEndDe(e.target.value)}
                maxLength={8} placeholder="99991231" style={modalInputStyle} />
            </ModalField>
          </div>

          {/* 설명 */}
          <ModalField label="설명">
            <textarea value={refInfoDc} onChange={(e) => setRefInfoDc(e.target.value)} rows={3}
              style={{ ...modalInputStyle, resize: "vertical" }} placeholder="이 기준 정보의 용도를 설명하세요." />
          </ModalField>
        </div>

        {/* 액션 */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 24 }}>
          <button onClick={onClose} style={secondaryBtnStyle} disabled={saveMutation.isPending}>취소</button>
          <button onClick={() => saveMutation.mutate()} style={primaryBtnStyle} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 서브 컴포넌트 ────────────────────────────────────────────────────────────

function ModalField({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4, color: "var(--color-text-secondary)" }}>{label}</label>
      {children}
    </div>
  );
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

// ── 스타일 ───────────────────────────────────────────────────────────────────

const GRID = "80px 70px 1fr 65px 80px 80px minmax(130px,160px) 70px";

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

const selectStyle: React.CSSProperties = {
  padding: "7px 28px 7px 10px", borderRadius: 7,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)", color: "var(--color-text-primary)",
  fontSize: 13, cursor: "pointer",
};

const addBtnStyle: React.CSSProperties = {
  padding: "7px 16px", borderRadius: 7,
  border: "none",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 13, fontWeight: 600, cursor: "pointer",
};

const actionBtnStyle: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 5,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)", color: "var(--color-text-secondary)",
  fontSize: 12, cursor: "pointer",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "7px 20px", borderRadius: 6,
  border: "none",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 13, fontWeight: 600, cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "7px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)", color: "var(--color-text-primary)",
  fontSize: 13, cursor: "pointer",
};

const modalInputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)", color: "var(--color-text-primary)",
  fontSize: 13, boxSizing: "border-box",
};

// select 전용 — 오른쪽에 드롭다운 화살표 공간 확보
const modalSelectStyle: React.CSSProperties = {
  ...modalInputStyle,
  paddingRight: 28,
};

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: "var(--color-bg-card)",
  borderRadius: 12, padding: "24px 28px",
  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
  color: "var(--color-text-primary)",
};
