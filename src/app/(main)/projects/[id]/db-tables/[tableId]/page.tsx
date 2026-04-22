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
// 공용 DDL 파서로 교체 — 기존 내부 parseDdl 와 동일 인터페이스의 parseSingleDdl 사용
// 블록 주석 /* */ 지원, COMMENT ON TABLE 지원 등 개선이 자동 적용됨
import { parseSingleDdl, type ParsedCol } from "@/lib/ddlParser";

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

type CodeGroupOption = {
  grpCode: string;
  grpCodeNm: string;
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
  const [ddlOpen, setDdlOpen] = useState(false);
  const [ddlText, setDdlText] = useState("");
  const [ddlParsed, setDdlParsed] = useState<ParsedCol[] | null>(null);

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

  // ── DDL 파싱 처리 ───────────────────────────────────────────────────────────
  // 공용 파서(parseSingleDdl)는 여러 CREATE TABLE 이 포함되어 있어도 첫 번째 블록의 컬럼만 반환.
  // 블록 주석(/* */)·COMMENT ON TABLE·앞줄 단독 주석 등 확장된 패턴을 자동 지원.
  function handleDdlParse() {
    const parsed = parseSingleDdl(ddlText);
    if (parsed.length === 0) {
      toast.error("컬럼을 파싱할 수 없습니다. CREATE TABLE 문을 확인해 주세요.");
      return;
    }
    setDdlParsed(parsed);
  }

  function handleDdlApply() {
    if (!ddlParsed) return;
    const newCols: ColDraft[] = ddlParsed.map((p) => ({
      _key: nextKey(),
      colPhysclNm: p.colPhysclNm,
      colLgclNm: p.colLgclNm,
      dataTyNm: p.dataTyNm,
      colDc: "",
      refGrpCode: "",
    }));
    setCols((prev) => [...prev, ...newCols]);
    toast.success(`${ddlParsed.length}개 컬럼을 추가했습니다.`);
    setDdlOpen(false);
    setDdlText("");
    setDdlParsed(null);
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
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", padding: 0 }}>

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
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "20px 24px 20px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1200 }}>

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

        {/* ── 컬럼 목록 ── */}
        <section style={{ ...sectionStyle, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
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
                onClick={() => { setDdlOpen(true); setDdlParsed(null); setDdlText(""); }}
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

          <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden", display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
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

            <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
              {cols.length === 0 ? (
                <div style={{ padding: "32px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>
                  컬럼을 추가해 주세요.
                </div>
              ) : (
                cols.map((col, idx) => (
                  <div
                    key={col._key}
                    // 드래그는 핸들(⋮⋮)을 mousedown 했을 때만 활성화됨
                    draggable={dragHandleIdx === idx}
                    onDragStart={() => handleDragStart(idx)}
                    onDragEnter={() => handleDragEnter(idx)}
                    onDragEnd={() => { handleDragEnd(); setDragHandleIdx(null); }}
                    onDragOver={(e) => e.preventDefault()}
                    style={{
                      ...colRowStyle,
                      borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                      background: col.colId ? "var(--color-bg-card)" : "#fffbeb",
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
                    <button
                      onClick={() => removeColumn(col._key)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#e57373", fontSize: 16, padding: "0 4px", lineHeight: 1 }}
                      title="컬럼 삭제"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {cols.length > 0 && (
            <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--color-text-secondary)" }}>
              ☰ 좌측 핸들을 드래그하여 순서를 변경할 수 있습니다.
            </p>
          )}
        </section>

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

      {/* ── ADD DDL 팝업 ── */}
      {ddlOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={() => { setDdlOpen(false); setDdlParsed(null); }}
        >
          <div
            style={{ width: 560, height: "70vh", maxHeight: "85vh", background: "var(--color-bg-card)", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.22)", display: "flex", flexDirection: "column", overflow: "hidden" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 팝업 헤더 */}
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>ADD DDL</span>
              <button onClick={() => { setDdlOpen(false); setDdlParsed(null); }} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#999", lineHeight: 1 }}>✕</button>
            </div>

            {ddlParsed === null ? (
              /* 입력 단계 */
              <>
                <div style={{ flex: 1, padding: "14px 20px", display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
                  <label style={{ fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 600 }}>
                    CREATE TABLE 문을 입력하세요.
                    <span style={{ fontWeight: 400, marginLeft: 6 }}>Oracle / MySQL / PostgreSQL 모두 지원</span>
                  </label>
                  <textarea
                    value={ddlText}
                    onChange={(e) => setDdlText(e.target.value)}
                    placeholder={"CREATE TABLE tb_example (\n  col_id VARCHAR(36) NOT NULL,\n  col_nm VARCHAR(200),\n  PRIMARY KEY (col_id)\n);"}
                    style={{
                      flex: 1, resize: "none", padding: "10px 12px",
                      border: "1px solid var(--color-border)", borderRadius: 6,
                      fontSize: 12,
                      fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace",
                      background: "var(--color-bg-muted)",
                      color: "var(--color-text-primary)",
                      lineHeight: 1.6, outline: "none",
                    }}
                    autoFocus
                  />
                </div>
                <div style={{ padding: "12px 20px", borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "flex-end", gap: 8, flexShrink: 0 }}>
                  <button onClick={() => setDdlOpen(false)} style={secondaryBtnStyle}>취소</button>
                  <button onClick={handleDdlParse} disabled={!ddlText.trim()} style={primaryBtnStyle}>파싱하기</button>
                </div>
              </>
            ) : (
              /* 확인 단계 */
              <>
                <div style={{ flex: 1, padding: "14px 20px", display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 4, flexShrink: 0 }}>
                    {ddlParsed.length}개 컬럼을 파싱했습니다. 등록하시겠습니까?
                  </div>
                  <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "6px 12px", background: "var(--color-bg-muted)", fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
                      <div>물리 컬럼명</div>
                      <div>논리 컬럼명</div>
                      <div>데이터 타입</div>
                    </div>
                    <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
                      {ddlParsed.map((p, i) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "5px 12px", borderTop: i === 0 ? "none" : "1px solid var(--color-border)", fontSize: 12 }}>
                          <span style={{ fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace", fontWeight: 600, color: "var(--color-text-primary)" }}>{p.colPhysclNm}</span>
                          <span style={{ color: p.colLgclNm ? "var(--color-text-primary)" : "#bbb" }}>{p.colLgclNm || "—"}</span>
                          <span style={{ fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace", color: "var(--color-text-secondary)" }}>{p.dataTyNm}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ padding: "12px 20px", borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "flex-end", gap: 8, flexShrink: 0 }}>
                  <button onClick={() => setDdlParsed(null)} style={secondaryBtnStyle}>다시 입력</button>
                  <button onClick={handleDdlApply} style={primaryBtnStyle}>등록</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

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

      {/* ── 논리 컬럼명 누락 경고 다이얼로그 ── */}
      {lgclWarnOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={() => setLgclWarnOpen(false)}
        >
          <div style={{ background: "var(--color-bg-card)", borderRadius: 10, padding: "28px 32px", minWidth: 360, maxWidth: 440, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }} onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700 }}>논리 컬럼명 누락</p>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              논리 컬럼명이 없는 컬럼이 <strong style={{ color: "#e65100" }}>{lgclWarnCount}개</strong> 있습니다.<br />
              나중에 입력하고, 지금은 이대로 저장하시겠습니까?
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-text-secondary)", fontSize: 13, cursor: "pointer" }}
                onClick={() => setLgclWarnOpen(false)}
              >
                취소
              </button>
              <button
                style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: "rgba(103,80,164,1)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                onClick={() => { setLgclWarnOpen(false); saveMutation.mutate(); }}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 삭제 확인 다이얼로그 ── */}
      {deleteConfirm && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={() => setDeleteConfirm(false)}
        >
          <div style={{ background: "var(--color-bg-card)", borderRadius: 10, padding: "28px 32px", minWidth: 360, maxWidth: 440, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }} onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700 }}>테이블을 삭제하시겠습니까?</p>
            <p style={{ margin: "0 0 6px", fontSize: 14, color: "var(--color-text-secondary)" }}>
              <code style={{ fontFamily: "monospace", background: "var(--color-bg-muted)", padding: "1px 6px", borderRadius: 4 }}>
                {physNm}
              </code>
            </p>
            {cols.length > 0 && (
              <p style={{ margin: "0 0 0", fontSize: 12, color: "#e57373" }}>
                ⚠ 하위 컬럼 {cols.length}개도 함께 삭제됩니다.
              </p>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button
                style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-text-secondary)", fontSize: 13, cursor: "pointer" }}
                onClick={() => setDeleteConfirm(false)}
                disabled={deleteMutation.isPending}
              >
                취소
              </button>
              <button
                style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: "#e53935", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                onClick={() => deleteMutation.mutate()}
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

// ── 코드 그룹 검색 드롭다운 ───────────────────────────────────────────────────
// 클릭 → 검색 입력 + 필터링된 목록 → 선택 → grp_code 저장

function CodeGroupSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: CodeGroupOption[];
  onChange: (grpCode: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // 선택된 그룹명 표시
  const selected = options.find((o) => o.grpCode === value);

  // 검색 필터링
  const filtered = options.filter((o) =>
    !search ||
    o.grpCode.toLowerCase().includes(search.toLowerCase()) ||
    o.grpCodeNm.toLowerCase().includes(search.toLowerCase())
  );

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* 표시 영역 — 클릭하면 드롭다운 토글 */}
      <div
        onClick={() => { setOpen(!open); setSearch(""); }}
        style={{
          ...colInputStyle,
          cursor: "pointer",
          display: "flex", alignItems: "center", gap: 4,
          overflow: "hidden", whiteSpace: "nowrap",
          minHeight: 28,
        }}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", color: selected ? "var(--color-text-primary)" : "#bbb", fontSize: 12 }}>
          {selected ? selected.grpCodeNm : ""}
        </span>
        {/* 클리어 버튼 */}
        {value && (
          <span
            onClick={(e) => { e.stopPropagation(); onChange(""); }}
            style={{ color: "#999", fontSize: 12, cursor: "pointer", flexShrink: 0 }}
          >
            ✕
          </span>
        )}
      </div>

      {/* 드롭다운 */}
      {open && (
        <div style={{
          position: "absolute", top: "100%", right: 0, zIndex: 100,
          width: 280, maxHeight: 240,
          background: "var(--color-bg-card)", border: "1px solid var(--color-border)",
          borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
          display: "flex", flexDirection: "column",
        }}>
          {/* 검색 입력 */}
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="코드 그룹 검색..."
            style={{
              padding: "6px 10px", border: "none", borderBottom: "1px solid var(--color-border)",
              outline: "none", fontSize: 12, background: "var(--color-bg-muted)",
              color: "var(--color-text-primary)",
            }}
          />
          {/* 목록 */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "12px", textAlign: "center", color: "#bbb", fontSize: 11 }}>
                검색 결과 없음
              </div>
            ) : (
              filtered.map((o) => (
                <div
                  key={o.grpCode}
                  onClick={() => { onChange(o.grpCode); setOpen(false); }}
                  style={{
                    padding: "5px 10px", cursor: "pointer", fontSize: 12,
                    background: o.grpCode === value ? "rgba(103,80,164,0.08)" : "transparent",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-bg-hover, #f5f7ff)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = o.grpCode === value ? "rgba(103,80,164,0.08)" : "transparent"; }}
                >
                  <span style={{ fontWeight: 600, color: "rgba(103,80,164,0.9)", marginRight: 6, fontFamily: "'JetBrains Mono','Consolas',monospace", fontSize: 11 }}>
                    {o.grpCode}
                  </span>
                  <span style={{ color: "var(--color-text-primary)" }}>{o.grpCodeNm}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const COL_GRID = "28px 1fr 1fr 140px 1fr 160px 36px";

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
