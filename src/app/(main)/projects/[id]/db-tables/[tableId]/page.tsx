"use client";

/**
 * DbTableDetailPage — DB 테이블 상세·편집
 *
 * 역할:
 *   - 상단: 테이블 기본 정보 (물리명·논리명·설명) 편집
 *   - 하단: 컬럼 목록 — +1/+5 추가, ADD DDL 파싱, 드래그앤드롭 순서 변경
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";
import RevisionList from "@/components/db-table/RevisionList";
import RevisionDiffDialog from "@/components/db-table/RevisionDiffDialog";
import RevisionListDialog from "@/components/db-table/RevisionListDialog";
import AssigneeHistoryDialog from "@/components/ui/AssigneeHistoryDialog";
// 매핑 인사이트 Phase 1 — "사용 현황" 섹션 + 컬럼별 미사용 배지용 훅
import TableUsageSection, { useTableUsage } from "@/components/db-table/TableUsageSection";
// 매핑 인사이트 Phase 2 — 컬럼 클릭 드릴다운 팝업
import ColumnUsageDialog from "@/components/db-table/ColumnUsageDialog";
// 리팩토링 — 공통코드 그룹 검색 드롭다운 분리 (이 파일 1100줄+ 축소 목적)
import CodeGroupSelect, { type CodeGroupOption } from "@/components/db-table/CodeGroupSelect";
// 리팩토링 — ADD DDL 팝업 분리 (파싱 단계 / 확인 단계 JSX + 자체 상태 캡슐화)
import AddDdlDialog from "@/components/db-table/AddDdlDialog";
// 리팩토링 — 경량 확인 다이얼로그 2종 (논리명 경고, 삭제 확인+영향도)
import { LgclNameWarnDialog, DeleteTableConfirmDialog } from "@/components/db-table/DbTableDialogs";
// ParsedCol 타입만 사용 (파싱 자체는 AddDdlDialog 내부가 담당)
import { type ParsedCol } from "@/lib/ddlParser";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type ColDraft = {
  _key: string;
  colId?: string;
  colPhysclNm: string;
  colLgclNm: string;
  dataTyNm: string;
  colDc: string;
  refGrpCode: string;
};

type DbTableDetail = {
  tblId: string;
  tblPhysclNm: string;
  tblLgclNm: string;
  tblDc: string;
  creatDt: string;
  mdfcnDt: string | null;
  // 담당자 — 서버 join으로 내려옴
  assignMemberId:   string | null;
  assignMemberName: string | null;
  columns: {
    colId: string;
    colPhysclNm: string;
    colLgclNm: string;
    dataTyNm: string;
    colDc: string;
    refGrpCode: string;
    sortOrdr: number;
    mdfcnDt: string | null;
  }[];
};

// 프로젝트 멤버 — 담당자 콤보박스 옵션용
type ProjectMember = {
  memberId: string;
  name:     string | null;
  email:    string;
  role:     string;
};

let _keySeq = 0;
function nextKey() { return `col_${++_keySeq}`; }

// ISO 날짜 문자열 → "YYYY-MM-DD HH:mm" (한국 시간) 형식으로 변환
function formatDt(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}`;
}

// DDL 파싱은 공용 모듈(`@/lib/ddlParser`)로 이관됨.
// 여기서는 단일 테이블 컬럼만 필요하므로 `parseSingleDdl` 사용.
// ParsedCol 타입도 공용 모듈에서 re-export 받아 사용 (기존 호출부 인터페이스 동일).

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function DbTableDetailPage() {
  return (
    <Suspense fallback={null}>
      <DbTableDetailPageInner />
    </Suspense>
  );
}

function DbTableDetailPageInner() {
  const params = useParams<{ id: string; tableId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { setBreadcrumb } = useAppStore();
  const projectId = params.id;
  const tableId = params.tableId;
  const isNew = tableId === "new";

  // ── 폼 상태 ────────────────────────────────────────────────────────────────
  const [physNm, setPhysNm] = useState("");
  const [lgclNm, setLgclNm] = useState("");
  const [dc, setDc] = useState("");
  // 담당자 — "" = 미지정 (서버에서 null 처리)
  const [assignMemberId, setAssignMemberId] = useState("");
  // 담당자 변경 이력 팝업 상태 — 다른 엔티티와 동일한 공용 AssigneeHistoryDialog 사용
  const [assigneeHistoryOpen, setAssigneeHistoryOpen] = useState(false);
  const [cols, setCols] = useState<ColDraft[]>([]);

  // ── ADD DDL 팝업 상태 ──────────────────────────────────────────────────────
  // ddlText/ddlParsed 는 AddDdlDialog 내부로 이관 → 여기서는 open 여부만 관리
  const [ddlOpen, setDdlOpen] = useState(false);

  // ── 드래그 상태 ─────────────────────────────────────────────────────────────
  const dragIdx = useRef<number | null>(null);
  const dragOverIdx = useRef<number | null>(null);

  // ── 데이터 조회 ────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery<DbTableDetail>({
    queryKey: ["db-table", projectId, tableId],
    queryFn: () =>
      authFetch<{ data: DbTableDetail }>(`/api/projects/${projectId}/db-tables/${tableId}`)
        .then((r) => r.data),
    enabled: !isNew,
  });

  // 공통코드 그룹 목록 (코드 열 드롭다운 옵션용)
  const { data: codeGroups } = useQuery<CodeGroupOption[]>({
    queryKey: ["code-groups-options", projectId],
    queryFn: () =>
      authFetch<{ data: { items: CodeGroupOption[] } }>(
        `/api/projects/${projectId}/code-groups?useYn=Y`
      ).then((r) => r.data.items),
  });

  // 프로젝트 멤버 목록 (담당자 콤보박스용)
  const { data: memberData } = useQuery({
    queryKey: ["project-members", projectId],
    queryFn:  () =>
      authFetch<{ data: { members: ProjectMember[]; myMemberId: string } }>(
        `/api/projects/${projectId}/members`
      ).then((r) => r.data),
    staleTime: 60 * 1000, // 1분
  });
  const members    = memberData?.members ?? [];
  const myMemberId = memberData?.myMemberId ?? "";

  // 매핑 인사이트 — 컬럼별 사용 통계 (미사용 배지 + 아래 UsageSection 공유)
  // 같은 queryKey 사용 → TableUsageSection 과 쿼리 dedupe
  const { data: usageData } = useTableUsage(projectId, tableId);
  const columnUsage = usageData?.columnUsage ?? {};

  // 컬럼 드릴다운 팝업 대상 (Phase 2) — null 이면 팝업 닫힘
  const [usageDialogColId, setUsageDialogColId] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setPhysNm(data.tblPhysclNm);
      setLgclNm(data.tblLgclNm);
      setDc(data.tblDc);
      setAssignMemberId(data.assignMemberId ?? "");
      setCols(data.columns.map((c) => ({
        _key: nextKey(),
        colId: c.colId,
        colPhysclNm: c.colPhysclNm,
        colLgclNm: c.colLgclNm,
        dataTyNm: c.dataTyNm,
        colDc: c.colDc,
        refGrpCode: c.refGrpCode,
      })));
    }
  }, [data]);

  useEffect(() => {
    const label = isNew ? "신규 등록" : (data?.tblPhysclNm ?? "편집");
    setBreadcrumb([
      { label: "DB 테이블", href: `/projects/${projectId}/db-tables` },
      { label },
    ]);
    return () => setBreadcrumb([]);
  }, [projectId, isNew, data?.tblPhysclNm, setBreadcrumb]);

  // ── 저장 뮤테이션 ────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isNew) {
        const res = await authFetch<{ data: { tblId: string } }>(
          `/api/projects/${projectId}/db-tables`,
          { method: "POST", body: JSON.stringify({ tblPhysclNm: physNm, tblLgclNm: lgclNm, tblDc: dc, assignMemberId }) }
        );
        const newTblId = res.data.tblId;
        if (cols.length > 0) {
          await authFetch(`/api/projects/${projectId}/db-tables/${newTblId}`, {
            method: "PUT",
            body: JSON.stringify({
              tblPhysclNm: physNm, tblLgclNm: lgclNm, tblDc: dc, assignMemberId,
              columns: cols.map((c) => ({
                colPhysclNm: c.colPhysclNm, colLgclNm: c.colLgclNm,
                dataTyNm: c.dataTyNm, colDc: c.colDc,
                refGrpCode: c.refGrpCode || undefined,
              })),
            }),
          });
        }
        return newTblId;
      } else {
        await authFetch(`/api/projects/${projectId}/db-tables/${tableId}`, {
          method: "PUT",
          body: JSON.stringify({
            tblPhysclNm: physNm, tblLgclNm: lgclNm, tblDc: dc, assignMemberId,
            columns: cols.map((c) => ({
              colId: c.colId, colPhysclNm: c.colPhysclNm, colLgclNm: c.colLgclNm,
              dataTyNm: c.dataTyNm, colDc: c.colDc,
              refGrpCode: c.refGrpCode || undefined,
            })),
          }),
        });
        return tableId;
      }
    },
    onSuccess: (savedId) => {
      qc.invalidateQueries({ queryKey: ["db-tables", projectId] });
      qc.invalidateQueries({ queryKey: ["db-table", projectId, savedId] });
      // 컬럼 삭제/추가는 매핑 유효성에 영향 → 사용 현황도 함께 갱신
      qc.invalidateQueries({ queryKey: ["db-table-usage", projectId, savedId] });
      toast.success("저장되었습니다.");
      if (isNew) router.replace(`/projects/${projectId}/db-tables/${savedId}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 컬럼 조작 ───────────────────────────────────────────────────────────────
  function addColumns(count: number) {
    const newCols = Array.from({ length: count }, () => ({
      _key: nextKey(), colPhysclNm: "", colLgclNm: "", dataTyNm: "", colDc: "", refGrpCode: "",
    }));
    setCols((prev) => [...prev, ...newCols]);
  }

  function removeColumn(key: string) {
    setCols((prev) => prev.filter((c) => c._key !== key));
  }

  function updateCol(key: string, field: keyof ColDraft, value: string) {
    setCols((prev) => prev.map((c) => c._key === key ? { ...c, [field]: value } : c));
  }

  // ── 드래그앤드롭 ────────────────────────────────────────────────────────────
  function handleDragStart(idx: number) { dragIdx.current = idx; }
  function handleDragEnter(idx: number) { dragOverIdx.current = idx; }
  function handleDragEnd() {
    const from = dragIdx.current;
    const to = dragOverIdx.current;
    if (from === null || to === null || from === to) {
      dragIdx.current = dragOverIdx.current = null;
      return;
    }
    setCols((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      if (!moved) return prev;
      next.splice(to, 0, moved);
      return next;
    });
    dragIdx.current = dragOverIdx.current = null;
  }

  // ── DDL 등록 처리 ───────────────────────────────────────────────────────────
  // 파싱/입력/확인 단계는 AddDdlDialog 내부가 담당.
  // 여기서는 "최종 확정된 컬럼 배열을 현재 컬럼 리스트에 덧붙인다" 만 책임진다.
  function handleDdlApply(parsed: ParsedCol[]) {
    const newCols: ColDraft[] = parsed.map((p) => ({
      _key: nextKey(),
      colPhysclNm: p.colPhysclNm,
      colLgclNm: p.colLgclNm,
      dataTyNm: p.dataTyNm,
      colDc: "",
      refGrpCode: "",
    }));
    setCols((prev) => [...prev, ...newCols]);
  }

  // 도움말 팝업
  const [helpOpen, setHelpOpen] = useState(false);

  // 논리 컬럼명 누락 확인 후 저장
  const [lgclWarnOpen, setLgclWarnOpen] = useState(false);
  const [lgclWarnCount, setLgclWarnCount] = useState(0);

  function handleSave() {
    if (!physNm.trim()) { toast.error("물리 테이블명을 입력해 주세요."); return; }
    const empty = cols.find((c) => !c.colPhysclNm.trim());
    if (empty) { toast.error("컬럼 물리명을 모두 입력해 주세요."); return; }

    // 논리 컬럼명이 비어있는 컬럼 확인 → 경고 후 사용자 선택
    const missingLgcl = cols.filter((c) => c.colPhysclNm.trim() && !c.colLgclNm.trim());
    if (missingLgcl.length > 0) {
      setLgclWarnCount(missingLgcl.length);
      setLgclWarnOpen(true);
      return;
    }

    saveMutation.mutate();
  }

  // ── 삭제 ────────────────────────────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  // 이력 Diff 뷰어 팝업 대상 리비전 id
  const [diffRevId, setDiffRevId] = useState<string | null>(null);
  // 전체 이력 보기 모달 표시 여부
  const [revListOpen, setRevListOpen] = useState(false);
  // 드래그 핸들(⋮⋮)을 눌렀을 때만 해당 행을 draggable 로 전환
  // → input 영역에서 텍스트 선택/복사가 드래그앤드롭으로 흡수되는 문제 방지
  const [dragHandleIdx, setDragHandleIdx] = useState<number | null>(null);

  const deleteMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/db-tables/${tableId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["db-tables", projectId] });
      toast.success("테이블이 삭제되었습니다.");
      router.push(`/projects/${projectId}/db-tables`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!isNew && isLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", padding: 0 }}>

      {/* ── 헤더 ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 24px",
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        flexShrink: 0,
      }}>
        <button
          onClick={() => router.push(`/projects/${projectId}/db-tables`)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1 }}
        >
          ←
        </button>
        <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          {isNew ? "DB 테이블 신규 등록" : "DB 테이블 상세"}
        </span>
        <div style={{ flex: 1 }} />
        {/* 삭제 버튼 — 신규 등록 중에는 표시하지 않음 */}
        {!isNew && (
          <button
            onClick={() => setDeleteConfirm(true)}
            style={{ padding: "5px 14px", borderRadius: 6, border: "none", background: "#fdecea", color: "#e53935", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            삭제
          </button>
        )}
        <button onClick={() => router.push(`/projects/${projectId}/db-tables`)} style={secondaryBtnStyle}>
          취소
        </button>
        <button onClick={handleSave} disabled={saveMutation.isPending} style={primaryBtnStyle}>
          {saveMutation.isPending ? "저장 중..." : "저장"}
        </button>
      </div>

      {/* ── 본문 ── */}
      {/* 본문 래퍼 — Phase 1 이후 UsageSection/변경이력 섹션이 추가되면서
          과거의 "컬럼 목록만 내부 스크롤" 구조가 공간 경쟁을 일으켜 컬럼 목록이 0 높이로 접힘.
          페이지 전체 스크롤 방식으로 전환 (overflow:hidden 제거, flex:1 제거). */}
      <div style={{ padding: "20px 24px 20px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1200 }}>

        {/* ── 테이블 기본 정보 ── */}
        <section style={{ ...sectionStyle, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ ...sectionTitleStyle, marginBottom: 0 }}>테이블 정보</div>
            {/* 등록일시 / 수정일시 — 신규 등록 시에는 표시하지 않음 */}
            {!isNew && data && (
              <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--color-text-secondary)" }}>
                <span>등록 <span style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>{formatDt(data.creatDt)}</span></span>
                {data.mdfcnDt && (
                  <span>수정 <span style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>{formatDt(data.mdfcnDt)}</span></span>
                )}
              </div>
            )}
          </div>
          {/* 3컬럼: 물리 테이블명 / 논리 테이블명 / 담당자 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 20px" }}>
            <div style={formGroupStyle}>
              <label style={labelStyle}>물리 테이블명 *</label>
              <input
                value={physNm}
                onChange={(e) => setPhysNm(e.target.value)}
                placeholder="tb_example"
                style={{ ...inputStyle, fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace", fontWeight: 600, letterSpacing: "0.02em" }}
              />
            </div>
            <div style={formGroupStyle}>
              <label style={labelStyle}>논리 테이블명</label>
              <input
                value={lgclNm}
                onChange={(e) => setLgclNm(e.target.value)}
                placeholder="예시 테이블"
                style={inputStyle}
              />
            </div>
            {/* 담당자 — 선택 (필수 아님). 논리 테이블명 오른쪽 */}
            {/* <label> 대신 <div> 사용 — <button>을 <label> 안에 두면 라벨 빈 영역 클릭이 */}
            {/*   브라우저 기본 동작으로 버튼에 포워딩됨. 아이콘만 클릭되도록 div 구조 */}
            <div style={formGroupStyle}>
              <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4 }}>
                <span>담당자</span>
                {!isNew && (
                  <button
                    type="button"
                    onClick={() => setAssigneeHistoryOpen(true)}
                    title="담당자 변경 이력"
                    style={inlineIconBtnStyle}
                  >
                    {/* 시계(이력) 아이콘 — 14px, currentColor로 테마 대응 */}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" strokeWidth="2"
                         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" />
                    </svg>
                  </button>
                )}
              </div>
              <select
                value={assignMemberId}
                onChange={(e) => setAssignMemberId(e.target.value)}
                style={selectStyle}
              >
                <option value="">담당자 없음</option>
                {members.map((m) => (
                  <option key={m.memberId} value={m.memberId}>
                    {m.name ?? m.email}
                    {m.memberId === myMemberId ? " (나)" : ""}
                  </option>
                ))}
              </select>
            </div>
            {/* 설명 — textarea 2줄, full width */}
            <div style={{ ...formGroupStyle, gridColumn: "1 / -1" }}>
              <label style={labelStyle}>설명</label>
              <textarea
                value={dc}
                onChange={(e) => setDc(e.target.value)}
                placeholder="테이블 용도 설명"
                rows={2}
                style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
              />
            </div>
          </div>
        </section>

        {/* ── 컬럼 목록 ──
            flex:1 제거 — 자연 높이로 렌더링되어야 페이지 전체 스크롤에 자연스럽게 편입된다.
            컬럼이 매우 많은 테이블은 페이지 스크롤로 대응. */}
        <section style={sectionStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={sectionTitleStyle}>
              컬럼 목록
              <span style={{ fontSize: 12, fontWeight: 400, color: "var(--color-text-secondary)", marginLeft: 8 }}>
                {cols.length}개
              </span>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {/* ADD DDL */}
              <button
                onClick={() => setDdlOpen(true)}
                style={ddlBtnStyle}
              >
                ADD DDL
              </button>
              {/* +1 */}
              <button onClick={() => addColumns(1)} style={addNBtnStyle}>
                +1
              </button>
              {/* +5 */}
              <button onClick={() => addColumns(5)} style={addNBtnStyle}>
                +5
              </button>
            </div>
          </div>

          <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
            {/* 헤더 */}
            <div style={{ ...colHeaderStyle, flexShrink: 0 }}>
              <div />
              <div>물리 컬럼명 *</div>
              <div>논리 컬럼명</div>
              <div>데이터 타입</div>
              <div>설명</div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                공통 코드
                <button
                  type="button"
                  onClick={() => setHelpOpen(true)}
                  title="도움말"
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 16, height: 16, borderRadius: "50%",
                    border: "1.5px solid var(--color-text-secondary)",
                    background: "transparent", color: "var(--color-text-secondary)",
                    fontSize: 10, fontWeight: 700, cursor: "pointer", padding: 0, lineHeight: 1,
                  }}
                >
                  ?
                </button>
              </div>
              <div />
            </div>

            {/* 컬럼 행 컨테이너 — 자연 높이 (페이지 전체 스크롤에 편입) */}
            <div>
              {cols.length === 0 ? (
                <div style={{ padding: "32px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>
                  컬럼을 추가해 주세요.
                </div>
              ) : (
                cols.map((col, idx) => {
                  // 매핑 인사이트 — 저장된 컬럼 중 col_mapping 에서 참조된 적이 없는 "미사용 컬럼"
                  // · col.colId 없음(=새로 추가/미저장)은 #fffbeb 배경과 개념이 달라 제외
                  // · box-shadow inset 으로 좌측 3px 오렌지 띠 → 레이아웃 영향 없음
                  const isUnused = !!col.colId && !columnUsage[col.colId];
                  return (
                  <div
                    key={col._key}
                    // 드래그는 핸들(⋮⋮)을 mousedown 했을 때만 활성화됨
                    draggable={dragHandleIdx === idx}
                    onDragStart={() => handleDragStart(idx)}
                    onDragEnter={() => handleDragEnter(idx)}
                    onDragEnd={() => { handleDragEnd(); setDragHandleIdx(null); }}
                    onDragOver={(e) => e.preventDefault()}
                    title={isUnused ? "이 컬럼은 아직 어떤 기능/영역/화면에서도 매핑되지 않았습니다." : undefined}
                    style={{
                      ...colRowStyle,
                      borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                      background: col.colId ? "var(--color-bg-card)" : "#fffbeb",
                      // 미사용 컬럼 표시 — warning semantic 토큰 사용 (3테마 대응)
                      boxShadow:  isUnused ? "inset 3px 0 0 var(--color-warning)" : "none",
                    }}
                  >
                    <div
                      // 핸들에서만 드래그 시작 — mouseup/drag 종료 시 해제
                      onMouseDown={() => setDragHandleIdx(idx)}
                      onMouseUp={() => setDragHandleIdx(null)}
                      style={{ cursor: "grab", color: "#ccc", userSelect: "none", textAlign: "center", fontSize: 14 }}
                    >
                      ⋮⋮
                    </div>
                    <input
                      value={col.colPhysclNm}
                      onChange={(e) => updateCol(col._key, "colPhysclNm", e.target.value)}
                      placeholder="col_name"
                      style={{ ...colInputStyle, fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace", fontWeight: 400 }}
                    />
                    <input
                      value={col.colLgclNm}
                      onChange={(e) => updateCol(col._key, "colLgclNm", e.target.value)}
                      placeholder="컬럼 논리명"
                      style={colInputStyle}
                    />
                    <input
                      value={col.dataTyNm}
                      onChange={(e) => updateCol(col._key, "dataTyNm", e.target.value)}
                      placeholder="VARCHAR(100)"
                      style={{ ...colInputStyle, fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace" }}
                    />
                    <input
                      value={col.colDc}
                      onChange={(e) => updateCol(col._key, "colDc", e.target.value)}
                      placeholder="설명"
                      style={{ ...colInputStyle, fontFamily: "'Pretendard','Noto Sans KR',sans-serif" }}
                    />
                    {/* 코드 — 공통코드 그룹 검색 드롭다운 */}
                    <CodeGroupSelect
                      value={col.refGrpCode}
                      options={codeGroups ?? []}
                      onChange={(v) => updateCol(col._key, "refGrpCode", v)}
                    />
                    {/* 액션 버튼 세트 — 사용처 보기(저장된 컬럼만) + 삭제
                        · 사용처 버튼은 col.colId 있을 때만 의미 있음
                        · 매핑이 있는 컬럼은 강조색(🔎), 미사용은 연한 회색 아이콘 */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                      {col.colId && (
                        <button
                          type="button"
                          onClick={() => col.colId && setUsageDialogColId(col.colId)}
                          title={
                            columnUsage[col.colId]
                              ? `이 컬럼의 사용처 보기 (매핑 ${columnUsage[col.colId]!.total}건)`
                              : "이 컬럼의 사용처 보기 (현재 매핑 없음)"
                          }
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            fontSize: 13, padding: "0 3px", lineHeight: 1,
                            opacity: columnUsage[col.colId] ? 1 : 0.4,
                          }}
                        >
                          🔎
                        </button>
                      )}
                      <button
                        onClick={() => removeColumn(col._key)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#e57373", fontSize: 16, padding: "0 4px", lineHeight: 1 }}
                        title="컬럼 삭제"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  );
                })
              )}
            </div>
          </div>

          {cols.length > 0 && (
            <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--color-text-secondary)" }}>
              ☰ 좌측 핸들을 드래그하여 순서를 변경할 수 있습니다.
            </p>
          )}
        </section>

        {/* ── 사용 현황 (매핑 인사이트 Phase 1) ──
            · 신규 등록 중에는 tableId 가 없어서 숨김
            · 섹션 내부에서 자체 로딩/빈 상태 처리 */}
        {!isNew && data && (
          <TableUsageSection projectId={projectId} tableId={tableId} />
        )}

        {/* ── 변경 이력 (최근 5건 · 인라인) ── */}
        {!isNew && data && (
          <section style={{ ...sectionStyle, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ ...sectionTitleStyle, marginBottom: 0 }}>변경 이력</div>
              <button
                type="button"
                className="sp-btn sp-btn-ghost"
                onClick={() => setRevListOpen(true)}
                style={{ padding: "4px 10px", fontSize: "var(--text-xs)" }}
              >
                전체 이력 보기
              </button>
            </div>
            <RevisionList
              projectId={projectId}
              tblId={tableId}
              pageSize={5}
              compact
              onSelectRev={(revId) => setDiffRevId(revId)}
            />
          </section>
        )}
      </div>

      {/* ── Diff 뷰어 팝업 (인라인 최근 5건에서 직접 여는 경우) ── */}
      {diffRevId && (
        <RevisionDiffDialog
          projectId={projectId}
          tblId={tableId}
          revId={diffRevId}
          onClose={() => setDiffRevId(null)}
          onNavigate={(id) => setDiffRevId(id)}
        />
      )}

      {/* ── 전체 이력 목록 모달 (내부에서 Diff 팝업 중첩 가능) ── */}
      {revListOpen && (
        <RevisionListDialog
          projectId={projectId}
          tblId={tableId}
          onClose={() => setRevListOpen(false)}
        />
      )}

      {/* 담당자 변경 이력 — 공용 경량 다이얼로그 (단위업무/과업/요구사항/화면과 동일) */}
      <AssigneeHistoryDialog
        open={assigneeHistoryOpen}
        onClose={() => setAssigneeHistoryOpen(false)}
        projectId={projectId}
        refTblNm="tb_ds_db_table"
        refId={tableId}
        currentAssigneeName={data?.assignMemberName ?? ""}
      />

      {/* 컬럼 사용처 드릴다운 (Phase 2) — 🔎 버튼 클릭 시 표시 */}
      {usageDialogColId && (
        <ColumnUsageDialog
          open={true}
          onClose={() => setUsageDialogColId(null)}
          projectId={projectId}
          tableId={tableId}
          colId={usageDialogColId}
        />
      )}

      {/* ── ADD DDL 팝업 (분리 컴포넌트) ── */}
      <AddDdlDialog
        open={ddlOpen}
        onClose={() => setDdlOpen(false)}
        onApply={handleDdlApply}
      />

      {/* ── 공통 코드 도움말 팝업 ── */}
      {helpOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200 }}
          onClick={() => setHelpOpen(false)}
        >
          <div
            style={{ background: "var(--color-bg-card)", borderRadius: 12, padding: "24px 28px", minWidth: 400, maxWidth: 520, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>공통 코드</span>
              <button onClick={() => setHelpOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.8, whiteSpace: "pre-line" }}>
              {"해당 컬럼이 공통코드를 사용한다면 어떤 공통코드 그룹을 참조하는지 선택해 주세요.\n\n" +
                "• 필수 값이 아니므로 비워 두어도 무방합니다.\n" +
                "• 공통코드를 지정하면 AI가 구현 시 해당 코드 그룹의 값 목록을 정확히 참조하여 코드를 생성합니다.\n" +
                "• 이용을 위해서는 공통코드에 먼저 등록해 주세요."}
            </div>
          </div>
        </div>
      )}

      {/* ── 논리 컬럼명 누락 경고 다이얼로그 (분리 컴포넌트) ── */}
      <LgclNameWarnDialog
        open={lgclWarnOpen}
        missing={lgclWarnCount}
        onClose={() => setLgclWarnOpen(false)}
        onConfirm={() => { setLgclWarnOpen(false); saveMutation.mutate(); }}
        busy={saveMutation.isPending}
      />
      {/* ── 삭제 확인 다이얼로그 (분리 컴포넌트, Phase 2 영향도 경고 포함) ── */}
      <DeleteTableConfirmDialog
        open={deleteConfirm}
        tableName={physNm}
        colCount={cols.length}
        impact={usageData ? {
          functionCount: usageData.summary.functionCount,
          areaCount:     usageData.summary.areaCount,
          screenCount:   usageData.summary.screenCount,
        } : undefined}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={() => deleteMutation.mutate()}
        busy={deleteMutation.isPending}
      />
    </div>
  );
}

// CodeGroupSelect 는 @/components/db-table/CodeGroupSelect 로 분리 이관됨.

// ── 스타일 ────────────────────────────────────────────────────────────────────

// 핸들 / 물리명 / 논리명 / 데이터타입 / 설명 / 공통코드 / 액션(사용처+삭제)
const COL_GRID = "28px 1fr 1fr 140px 1fr 160px 64px";

const sectionStyle: React.CSSProperties = {
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 10, padding: "20px 24px",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 700,
  color: "var(--color-text-primary)",
  marginBottom: 16,
};

const formGroupStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 5,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 400,
  color: "var(--color-text-secondary)",
};

const inputStyle: React.CSSProperties = {
  padding: "8px 12px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box",
};

// select 전용 — 브라우저 기본 화살표(두껍고 오른쪽 끝에 붙음) 제거 후 커스텀 SVG 화살표 사용
const selectStyle: React.CSSProperties = {
  ...inputStyle,
  paddingRight:       "32px",
  appearance:         "none",
  WebkitAppearance:   "none",
  backgroundImage:    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundRepeat:   "no-repeat",
  backgroundPosition: "right 10px center",
};

// 라벨 옆 인라인 아이콘 버튼 — 이력 조회 등 보조 액션을 최소 면적으로 표현
const inlineIconBtnStyle: React.CSSProperties = {
  display:        "inline-flex",
  alignItems:     "center",
  justifyContent: "center",
  width:          18,
  height:         18,
  padding:        0,
  border:         "none",
  background:     "transparent",
  color:          "var(--color-text-tertiary)",
  cursor:         "pointer",
  borderRadius:   3,
  lineHeight:     0,
};

const colHeaderStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: COL_GRID, gap: 8,
  padding: "8px 12px",
  background: "var(--color-bg-muted)",
  borderBottom: "1px solid var(--color-border)",
  fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)",
  alignItems: "center",
};

const colRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: COL_GRID, gap: 8,
  padding: "7px 12px",
  background: "var(--color-bg-card)",
  alignItems: "center",
};

const colInputStyle: React.CSSProperties = {
  padding: "5px 8px", borderRadius: 5,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "6px 18px", borderRadius: 6,
  border: "none",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 13, fontWeight: 600, cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "6px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)", color: "var(--color-text-primary)",
  fontSize: 13, cursor: "pointer",
};

const addNBtnStyle: React.CSSProperties = {
  padding: "4px 12px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)", color: "var(--color-text-primary)",
  fontSize: 12, fontWeight: 700, cursor: "pointer",
};

const ddlBtnStyle: React.CSSProperties = {
  padding: "4px 12px", borderRadius: 6,
  border: "1px solid #7c3aed",
  background: "#f5f3ff", color: "#7c3aed",
  fontSize: 12, fontWeight: 700, cursor: "pointer",
  letterSpacing: "0.04em",
};
