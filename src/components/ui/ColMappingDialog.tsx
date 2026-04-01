"use client";

/**
 * ColMappingDialog — 공통 컬럼 매핑 관리 팝업
 *
 * 역할:
 *   - refType + refId 기준으로 tb_ds_col_mapping 데이터를 조회/저장
 *   - 테이블 선택 → 컬럼 칩 클릭으로 빠른 행 추가
 *   - + 버튼으로 빈 행 수동 추가
 *   - 각 행에서 항목명, IO구분, UI유형, 설명 인라인 편집
 *   - 저장 시 기존 매핑 전체 교체 (POST /api/projects/[id]/col-mappings)
 *
 * Props:
 *   - refType: 'FUNCTION' | 'AREA' | ... (향후 확장)
 *   - refId:   참조 엔티티 ID
 */

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { useEscapeKey } from "@/hooks/useEscapeKey";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type DbTable  = { tableId: string; tableName: string; tableLogicalNm: string };
type DbColumn = { colId: string; colName: string; colLogicalNm: string };

type MappingRow = {
  _key:        string;   // React key (로컬 고유값)
  colId:       string;
  tableName:   string;
  colName:     string;
  _tableId:    string;
  ioSeCode:    string;   // INPUT | OUTPUT | INOUT | ""
  uiTyCode:    string;   // TEXT | TEXTAREA | SELECT | ... | ""
  usePurpsCn:  string;   // 항목명
  colDc:       string;   // 설명
};

type ApiMappingItem = {
  mappingId:      string;
  colId:          string;
  colName:        string;
  colLogicalNm:   string;
  tableId:        string;
  tableName:      string;
  tableLogicalNm: string;
  ioSeCode:       string;
  uiTyCode:       string;
  usePurpsCn:     string;
  colDc:          string;
  sortOrder:      number;
};

export interface ColMappingDialogProps {
  open:        boolean;
  onClose:     () => void;
  onSaved:     () => void;
  projectId:   string;
  refType:     string;
  refId:       string;
  title?:      string;
  // 단위업무 설명 — TABLE_SCRIPT:xxx> 패턴 파싱 후 테이블 자동 선택에 사용
  unitWorkDc?: string;
}

// ── 상수 ──────────────────────────────────────────────────────────────────────

const IO_OPTIONS = [
  { value: "",       label: "—" },
  { value: "INPUT",  label: "입력(IN)" },
  { value: "OUTPUT", label: "출력(OUT)" },
  { value: "INOUT",  label: "입출력" },
];

const UI_OPTIONS = [
  { value: "",          label: "—" },
  { value: "TEXT",      label: "텍스트" },
  { value: "TEXTAREA",  label: "텍스트영역" },
  { value: "SELECT",    label: "콤보박스" },
  { value: "RADIO",     label: "라디오" },
  { value: "CHECKBOX",  label: "체크박스" },
  { value: "DATE",      label: "날짜" },
  { value: "NUMBER",    label: "숫자" },
  { value: "FILE",      label: "파일" },
  { value: "HIDDEN",    label: "히든" },
];

let keyCounter = 0;
function nextKey() { return `row-${++keyCounter}`; }

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function ColMappingDialog({
  open, onClose, onSaved, projectId, refType, refId, title = "컬럼 매핑 관리", unitWorkDc = "",
}: ColMappingDialogProps) {
  const queryClient     = useQueryClient();
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [selectedTableId, setSelectedTableId] = useState("");

  // ── 기존 매핑 조회 ──────────────────────────────────────────────────────────
  const { data: mappingData } = useQuery({
    queryKey: ["col-mappings", projectId, refType, refId],
    queryFn:  () =>
      authFetch<{ data: { items: ApiMappingItem[] } }>(
        `/api/projects/${projectId}/col-mappings?refType=${refType}&refId=${refId}`
      ).then((r) => r.data),
    enabled: open && !!refId,
  });

  // ── DB 테이블 목록 (effect보다 앞에 선언해야 effect에서 참조 가능) ──────────
  const { data: tablesData } = useQuery({
    queryKey: ["db-schema", projectId, "tables"],
    queryFn:  () =>
      authFetch<{ data: { tables: DbTable[] } }>(`/api/projects/${projectId}/db-schema`)
        .then((r) => r.data),
    enabled: open,
  });
  const tables = tablesData?.tables ?? [];

  // open 될 때 rows 초기화 + TABLE_SCRIPT 기반 테이블 자동 선택
  useEffect(() => {
    if (!open) return;
    const items = mappingData?.items ?? [];
    setRows(items.map((m) => ({
      _key:       nextKey(),
      colId:      m.colId,
      tableName:  m.tableName,
      colName:    m.colName,
      _tableId:   m.tableId,
      ioSeCode:   m.ioSeCode,
      uiTyCode:   m.uiTyCode,
      usePurpsCn: m.usePurpsCn,
      colDc:      m.colDc,
    })));

    // 단위업무 설명에서 TABLE_SCRIPT:xxx> 패턴 파싱 후 자동 선택
    // tables가 아직 로드되지 않은 경우 스킵 (tables 로드 후 재실행됨)
    if (unitWorkDc && tables.length > 0) {
      const matches = [...unitWorkDc.matchAll(/TABLE_SCRIPT:([^>]+)>/g)];
      const tableNames = matches.map((m) => m[1].trim());
      const matchedIds = tables
        .filter((t) => tableNames.includes(t.tableName))
        .map((t) => t.tableId);

      if (matchedIds.length > 0) {
        setFilterTableIds(matchedIds);
        setSelectedTableId(matchedIds[0]);
        return;
      }
    }

    setSelectedTableId("");
    setFilterTableIds([]);
  }, [open, mappingData, tables, unitWorkDc]);

  // ── 선택 테이블의 컬럼 목록 ────────────────────────────────────────────────
  const { data: colsData } = useQuery({
    queryKey: ["db-schema", projectId, "columns", selectedTableId],
    queryFn:  () =>
      authFetch<{ data: { columns: DbColumn[] } }>(
        `/api/projects/${projectId}/db-schema?tableId=${selectedTableId}`
      ).then((r) => r.data),
    enabled: !!selectedTableId,
  });
  const columns = colsData?.columns ?? [];

  // ── 행 조작 ────────────────────────────────────────────────────────────────

  function addRowFromChip(col: DbColumn) {
    const tbl = tables.find((t) => t.tableId === selectedTableId);
    if (!tbl) return;
    if (rows.some((r) => r.colId === col.colId)) {
      toast.error("이미 추가된 컬럼입니다.");
      return;

    }
    setRows((prev) => [...prev, {
      _key:       nextKey(),
      colId:      col.colId,
      tableName:  tbl.tableName,
      colName:    col.colName,
      _tableId:   tbl.tableId,
      ioSeCode:   "",
      uiTyCode:   "",
      usePurpsCn: col.colLogicalNm || col.colName,
      colDc:      "",
    }]);
  }

  function addEmptyRow() {
    setRows((prev) => [...prev, {
      _key:       nextKey(),
      colId:      "",
      tableName:  "",
      colName:    "",
      _tableId:   "",
      ioSeCode:   "",
      uiTyCode:   "",
      usePurpsCn: "",
      colDc:      "",
    }]);
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r._key !== key));
  }

  function updateRow<K extends keyof MappingRow>(key: string, field: K, value: MappingRow[K]) {
    setRows((prev) => prev.map((r) => r._key === key ? { ...r, [field]: value } : r));
  }

  // 테이블.컬럼 콤보박스 선택 시 값 갱신
  function setRowColumn(key: string, tableId: string, colId: string, colName: string, colLogicalNm?: string) {
    const tbl = tables.find((t) => t.tableId === tableId);
    if (!tbl) {
        setRows((prev) => prev.map((r) => r._key === key ? {
            ...r, _tableId: "", colId: "", tableName: "", colName: "",
        } : r));
        return;
    }
    setRows((prev) => prev.map((r) => r._key === key ? {
      ...r,
      _tableId:   tableId,
      colId,
      tableName:  tbl.tableName,
      colName,
      // 항목명이 비어있을 때만 논리명으로 자동 채움 (이미 입력한 값 보존)
      usePurpsCn: r.usePurpsCn || colLogicalNm || colName,
    } : r));
  }
  // ── 상태: 필터링 및 논리명 보기 설정 ───────────────────────────────────
  const [filterTableIds, setFilterTableIds] = useState<string[]>([]);
  const [showLogicalAll, setShowLogicalAll] = useState(false);
  const [showLogicalGrid, setShowLogicalGrid] = useState(false);

  // ── 드래그 상태 (_key 기반 — 필터가 걸려도 rows 원본 인덱스로 정확히 재정렬) ──
  const dragKey     = useRef<string | null>(null);
  const dragOverKey = useRef<string | null>(null);

  function handleDragStart(key: string) { dragKey.current = key; }
  function handleDragEnter(key: string) { dragOverKey.current = key; }
  function handleDragEnd() {
    const from = rows.findIndex((r) => r._key === dragKey.current);
    const to   = rows.findIndex((r) => r._key === dragOverKey.current);
    dragKey.current     = null;
    dragOverKey.current = null;
    if (from < 0 || to < 0 || from === to) return;

    const reordered = [...rows];
    const [moved]   = reordered.splice(from, 1);
    if (!moved) return;
    reordered.splice(to, 0, moved);
    setRows(reordered);
  }

  // ── 저장 ──────────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () => {
      const validRows = rows.filter((r) => r.colId);
      return authFetch(`/api/projects/${projectId}/col-mappings`, {
        method: "POST",
        body:   JSON.stringify({
          refType,
          refId,
          items: validRows.map((r) => ({
            colId:      r.colId,
            ioSeCode:   r.ioSeCode || null,
            uiTyCode:   r.uiTyCode || null,
            usePurpsCn: r.usePurpsCn || null,
            colDc:      r.colDc || null,
          })),
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["col-mappings", projectId, refType, refId] });
      toast.success("컬럼 매핑이 저장되었습니다.");
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ESC 키로 팝업 닫기
  useEscapeKey(onClose, open);

  if (!open) return null;

  return (
    <div style={overlayStyle}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>

        {/* ── 고정 상단: 헤더 + 테이블 선택 + 컬럼 칩 ─────────────────── */}
        <div style={dialogTopStyle}>

          {/* 헤더 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: "var(--color-text-secondary)" }}>
                <span style={{ fontWeight: 600 }}>논리명 보기:</span>
                <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input type="checkbox" checked={showLogicalAll} onChange={(e) => setShowLogicalAll(e.target.checked)} />
                  전체
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input type="checkbox" checked={showLogicalGrid} onChange={(e) => setShowLogicalGrid(e.target.checked)} />
                  그리드
                </label>
              </div>
              <button onClick={onClose} style={closeBtnStyle}>닫기</button>
            </div>
          </div>

          {/* 빠른 추가 영역 (테이블 선택 + 행 추가) */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
            <select
              value={selectedTableId}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedTableId(val);
                // 필터 목록에도 추가하여 그리드 동기화
                if (val && !filterTableIds.includes(val)) {
                  setFilterTableIds((prev) => [...prev, val]);
                }
              }}
              style={{ ...selectStyle, flex: 1 }}
            >
              <option value="">테이블 선택 (필터링 및 컬럼 빠른 추가)</option>
              {tables.map((t) => (
                <option key={t.tableId} value={t.tableId}>
                  {showLogicalAll ? (t.tableLogicalNm || t.tableName) : t.tableName}
                </option>
              ))}
            </select>
            <button onClick={addEmptyRow} style={addRowBtnStyle}>+1</button>
            <button
              onClick={() => {
                setRows((prev) => {
                  const newRows = Array.from({ length: 5 }).map(() => ({
                    _key:       nextKey(),
                    colId:      "",
                    tableName:  "",
                    colName:    "",
                    _tableId:   "",
                    ioSeCode:   "",
                    uiTyCode:   "",
                    usePurpsCn: "",
                    colDc:      "",
                  }));
                  return [...prev, ...newRows];
                });
              }}
              style={addRowBtnStyle}
            >
              +5
            </button>
          </div>

          {/* 테이블 필터 칩 (선택된 테이블들을 핀으로 고정 표시) */}
          {filterTableIds.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {filterTableIds.map((id) => {
                const tbl = tables.find(t => t.tableId === id);
                if (!tbl) return null;
                return (
                  <div key={id} style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "4px 10px", 
                    background: selectedTableId === id ? "#eff6ff" : "var(--color-bg-card)",
                    border: selectedTableId === id ? "1px solid #3b82f6" : "1px solid var(--color-border)", 
                    borderRadius: 16, fontSize: 12, 
                    color: selectedTableId === id ? "#1d4ed8" : "var(--color-text-primary)",
                    cursor: "pointer"
                  }} onClick={() => setSelectedTableId(id)}>
                    <span style={{ fontWeight: 600 }}>
                      {showLogicalAll ? (tbl.tableLogicalNm || tbl.tableName) : tbl.tableName}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation(); // 칩 클릭 방지 (삭제 버튼만 동작)
                        setFilterTableIds(prev => prev.filter(tid => tid !== id));
                        if (selectedTableId === id) setSelectedTableId("");
                      }}
                      style={{ 
                        background: "none", border: "none", cursor: "pointer", 
                        color: selectedTableId === id ? "#3b82f6" : "#e53935", 
                        fontSize: 14, lineHeight: 1, padding: "0 2px" 
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* 컬럼 칩 */}
          {selectedTableId && columns.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "8px 10px", background: "var(--color-bg-muted)", borderRadius: 6, marginBottom: 4 }}>
              {columns.map((c) => {
                const alreadyAdded = rows.some((r) => r.colId === c.colId);
                return (
                  <button
                    key={c.colId}
                    onClick={() => addRowFromChip(c)}
                    disabled={alreadyAdded}
                    title={c.colLogicalNm || c.colName}
                    style={{
                      padding: "5px 12px", borderRadius: 4,
                      border: "1px solid var(--color-border)",
                      background: alreadyAdded ? "var(--color-bg-muted)" : "var(--color-bg-card)",
                      color: alreadyAdded ? "var(--color-text-disabled)" : "var(--color-text-primary)",
                      cursor: alreadyAdded ? "default" : "pointer",
                      fontSize: 12, fontWeight: 500,
                    }}
                  >
                    {showLogicalAll ? (c.colLogicalNm || c.colName) : c.colName}
                  </button>
                );
              })}
            </div>
          )}

          {/* 그리드 헤더 — 고정 */}
          <div style={gridHeaderStyle}>
            <div style={{ width: 20 }} />
            <div style={{ width: 32, textAlign: "center" }}>NO</div>
            <div style={{ flex: "0 0 156px" }}>항목명</div>
            <div style={{ flex: "0 0 108px" }}>IO구분</div>
            <div style={{ flex: "0 0 110px" }}>UI유형</div>
            <div style={{ flex: "0 0 150px" }}>테이블</div>
            <div style={{ flex: "0 0 150px" }}>컬럼</div>
            <div style={{ flex: 2.7 }}>설명</div>
            <div style={{ width: 32 }} />
          </div>
        </div>

        {/* ── 스크롤 영역: 행 목록만 ────────────────────────────────────── */}
        <div style={dialogScrollStyle}>
          {rows.length === 0 ? (
            <div style={{ padding: "24px 0", textAlign: "center", color: "var(--color-text-secondary)", fontSize: 13 }}>
              매핑된 컬럼이 없습니다. 위에서 테이블을 선택하거나 + 행 추가를 클릭하세요.
            </div>
          ) : (
            (() => {
              const visibleRows = filterTableIds.length > 0 
                ? rows.filter(r => !r._tableId || filterTableIds.includes(r._tableId))
                : rows;

              if (visibleRows.length === 0) {
                return (
                  <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-disabled)" }}>
                    선택한 필터 조건에 맞는 데이터가 없습니다.
                  </div>
                );
              }

              return visibleRows.map((row, idx) => (
                <div
                  key={row._key}
                  draggable
                  onDragStart={() => handleDragStart(row._key)}
                  onDragEnter={() => handleDragEnter(row._key)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => e.preventDefault()}
                  style={{ ...gridRowStyle, borderTop: idx === 0 ? "none" : "1px solid var(--color-border)" }}
                >
                  {/* 드래그 핸들 */}
                  <div style={{ width: 20, color: "#bbb", cursor: "grab", userSelect: "none", textAlign: "center", fontSize: 14, flexShrink: 0 }}>
                    ☰
                  </div>

                  {/* NO */}
                  <div style={{ width: 32, textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {rows.findIndex(r => r._key === row._key) + 1}
                  </div>

                {/* 항목명 */}
                <div style={{ flex: "0 0 156px" }}>
                  <input
                    type="text"
                    value={row.usePurpsCn}
                    onChange={(e) => updateRow(row._key, "usePurpsCn", e.target.value)}
                    placeholder="항목명"
                    style={cellInputStyle}
                  />
                </div>

                {/* IO구분 — 토글 버튼 */}
                <div style={{ flex: "0 0 108px" }}>
                  <div style={{ display: "flex", gap: 3 }}>
                    {[
                      { value: "INPUT",  label: "IN" },
                      { value: "OUTPUT", label: "OUT" },
                      { value: "INOUT",  label: "IO" },
                    ].map((opt) => {
                      const active = row.ioSeCode === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => updateRow(row._key, "ioSeCode", active ? "" : opt.value)}
                          style={{
                            flex: 1,
                            padding: "4px 0",
                            borderRadius: 4,
                            border: active ? "none" : "1px solid var(--color-border)",
                            background: active ? "var(--color-primary, #1976d2)" : "transparent",
                            color: active ? "#fff" : "var(--color-text-secondary)",
                            fontSize: 11,
                            fontWeight: active ? 700 : 400,
                            cursor: "pointer",
                            transition: "all 0.12s",
                          }}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* UI유형 */}
                <div style={{ flex: "0 0 110px" }}>
                  <select
                    value={row.uiTyCode}
                    onChange={(e) => updateRow(row._key, "uiTyCode", e.target.value)}
                    style={cellSelectStyle}
                  >
                    {UI_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                {/* 테이블 / 컬럼 (분리됨) */}
                <div style={{ flex: "0 0 300px", maxWidth: 300 }}>
                  <ColumnPicker
                    tables={tables}
                    projectId={projectId}
                    initialTableId={row._tableId}
                    initialColId={row.colId}
                    filterTableIds={filterTableIds}
                    showLogical={showLogicalAll || showLogicalGrid}
                    onSelect={(tableId, colId, colName, colLogicalNm) => setRowColumn(row._key, tableId, colId, colName, colLogicalNm)}
                  />
                </div>

                {/* 설명 */}
                <div style={{ flex: 2.7 }}>
                  <input
                    type="text"
                    value={row.colDc}
                    onChange={(e) => updateRow(row._key, "colDc", e.target.value)}
                    placeholder="이 컬럼의 사용 설명"
                    style={cellInputStyle}
                  />
                </div>

                {/* 삭제 */}
                <div style={{ width: 32, display: "flex", justifyContent: "center" }}>
                  <button
                    onClick={() => removeRow(row._key)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#e53935", fontSize: 16, lineHeight: 1 }}
                  >
                    ×
                  </button>
                </div>
              </div>
            ));
          })()
        )}
        </div>{/* ── 스크롤 영역 끝 */}

        {/* ── 고정 하단: 취소 + 저장 ───────────────────────────────────── */}
        <div style={dialogBottomStyle}>
          <button onClick={onClose} disabled={saveMutation.isPending} style={secondaryBtnStyle}>
            취소
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            style={primaryBtnStyle}
          >
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>

      </div>
    </div>
  );
}

// ── 빈 행용 컬럼 피커 ─────────────────────────────────────────────────────────

function ColumnPicker({
  tables, projectId, initialTableId = "", initialColId = "", filterTableIds = [], showLogical = false, onSelect,
}: {
  tables:         DbTable[];
  projectId:      string;
  initialTableId?: string;
  initialColId?:   string;
  filterTableIds?: string[];
  showLogical?:   boolean;
  onSelect:       (tableId: string, colId: string, colName: string, colLogicalNm?: string) => void;
}) {
  const [tblId, setTblId] = useState(initialTableId);

  // 상위에서 initialTableId가 들어오면 동기화 (기존 데이터 로드 시)
  useEffect(() => {
    setTblId(initialTableId);
  }, [initialTableId]);

  const { data } = useQuery({
    queryKey: ["db-schema", projectId, "columns", tblId],
    queryFn:  () =>
      authFetch<{ data: { columns: DbColumn[] } }>(
        `/api/projects/${projectId}/db-schema?tableId=${tblId}`
      ).then((r) => r.data),
    enabled: !!tblId,
  });
  const cols = data?.columns ?? [];

  return (
    <div style={{ display: "flex", gap: 4 }}>
      <select
        value={tblId}
        onChange={(e) => {
          setTblId(e.target.value);
          // 테이블 변경 시 컬럼은 초기화
          onSelect(e.target.value, "", "");
        }}
        style={{ ...cellSelectStyle, flex: 1 }}
      >
        <option value="">테이블</option>
        {(filterTableIds.length > 0 
          ? tables.filter(t => filterTableIds.includes(t.tableId)) 
          : tables
        ).map((t) => (
          <option key={t.tableId} value={t.tableId}>
            {showLogical ? (t.tableLogicalNm || t.tableName) : t.tableName}
          </option>
        ))}
      </select>
      <select
        value={initialColId}
        onChange={(e) => {
          if (e.target.value) {
            const col = cols.find((c) => c.colId === e.target.value);
            onSelect(tblId, e.target.value, col?.colName ?? "", col?.colLogicalNm);
          } else {
            onSelect(tblId, "", "");
          }
        }}
        disabled={!tblId || cols.length === 0}
        style={{ ...cellSelectStyle, flex: 1 }}
      >
        <option value="">컬럼</option>
        {cols.map((c) => (
          <option key={c.colId} value={c.colId}>
            {showLogical ? (c.colLogicalNm || c.colName) : c.colName}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 2000,
};

const dialogStyle: React.CSSProperties = {
  background:    "var(--color-bg-card)",
  borderRadius:  10,
  width:         "min(1100px, 92vw)",
  height:        "min(88vh, 700px)",
  display:       "flex",
  flexDirection: "column",
  overflow:      "hidden",               // 다이얼로그 자체는 스크롤 없음 → X버튼 고정
  boxShadow:     "0 8px 32px rgba(0,0,0,0.28)",
};

// 고정 상단 영역 (헤더, 테이블 선택, 칩, 그리드 헤더)
const dialogTopStyle: React.CSSProperties = {
  padding:    "24px 28px 0",
  flexShrink: 0,
  borderBottom: "1px solid var(--color-border)",
};

// 스크롤 가능한 행 목록 영역
const dialogScrollStyle: React.CSSProperties = {
  flex:      1,
  overflowY: "auto",
  padding:   "0 28px",
  // border-bottom은 없음 — dialogBottomStyle이 separator 역할
};

// 고정 하단 영역 (취소 + 저장)
const dialogBottomStyle: React.CSSProperties = {
  padding:        "10px 28px",
  flexShrink:     0,
  borderTop:      "1px solid var(--color-border)",
  display:        "flex",
  justifyContent: "flex-end",
  gap:            8,
};

const closeBtnStyle: React.CSSProperties = {
  background: "var(--color-bg-card)", border: "1px solid var(--color-border)",
  borderRadius: 6, cursor: "pointer", fontSize: 13,
  color: "var(--color-text-primary)",
  lineHeight: 1, padding: "10px 24px",
  fontWeight: 600,
  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
};

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 12,
  color: "var(--color-text-secondary)",
  marginBottom: 6, fontWeight: 500,
};

const selectStyle: React.CSSProperties = {
  width: "100%", padding: "7px 28px 7px 10px",
  border: "1px solid var(--color-border)",
  borderRadius: 6, fontSize: 13,
  background: "var(--color-bg-input)",
  color: "var(--color-text-primary)",
  appearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 10px center",
  boxSizing: "border-box",
};

const gridHeaderStyle: React.CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        8,
  padding:    "8px 0 8px 0",
  marginTop:  10,
  fontSize:   12,
  fontWeight: 600,
  color:      "var(--color-text-secondary)",
  borderTop:  "1px solid var(--color-border)",
};

const gridRowStyle: React.CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        8,
  padding:    "6px 0",
};

const cellInputStyle: React.CSSProperties = {
  width: "100%", padding: "4px 7px",
  border: "1px solid var(--color-border)",
  borderRadius: 4, fontSize: 12,
  background: "var(--color-bg-input)",
  color: "var(--color-text-primary)",
};

const cellSelectStyle: React.CSSProperties = {
  width: "100%", padding: "4px 24px 4px 6px",
  border: "1px solid var(--color-border)",
  borderRadius: 4, fontSize: 12,
  background: "var(--color-bg-input)",
  color: "var(--color-text-primary)",
  appearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 8px center",
  boxSizing: "border-box",
};

const addRowBtnStyle: React.CSSProperties = {
  padding:      "7px 16px",
  border:       "1px solid var(--color-border)",
  borderRadius: 6,
  cursor:       "pointer",
  background:   "transparent",
  color:        "var(--color-text-secondary)",
  fontSize:     13,
  whiteSpace:   "nowrap",
  flexShrink:   0,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px", borderRadius: 6,
  border: "none", cursor: "pointer",
  background: "var(--color-primary, #1976d2)",
  color: "#fff", fontSize: 13, fontWeight: 500,
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  cursor: "pointer", background: "transparent",
  color: "var(--color-text-primary)", fontSize: 13,
};
