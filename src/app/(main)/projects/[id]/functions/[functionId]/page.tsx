"use client";

/**
 * FunctionDetailPage — 기능 상세·편집 (PID-00051)
 *
 * 역할:
 *   - 기능 상세 조회 (FID-00171)
 *   - 기능 생성/수정 + 명세 편집 (FID-00172, 00173)
 *   - AI 명세 누락 검토 요청 (FID-00174)
 *   - AI 영향도 분석 요청 (FID-00175)
 *   - 하단 컬럼 매핑 목록 (FID-00178)
 *   - 컬럼 매핑 관리 팝업 (PID-00053 / FID-00181)
 *
 * 주요 기술:
 *   - TanStack Query: 상세 조회 및 뮤테이션
 *   - functionId === "new"이면 신규 모드
 */

import { Suspense, useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import MarkdownEditor from "@/components/ui/MarkdownEditor";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type FuncDetail = {
  funcId:        string;
  displayId:     string;
  name:          string;
  description:   string;
  type:          string;
  status:        string;
  priority:      string;
  complexity:    string;
  effort:        string;
  assignMemberId: string | null;
  implStartDate: string;
  implEndDate:   string;
  sortOrder:     number;
  areaId:        string | null;
  areaName:      string;
  columnMappings: ColumnMapping[];
};

type ColumnMapping = {
  mappingId:      string;
  colId:          string;
  colName:        string;
  colLogicalNm:   string;
  tableId:        string;
  tableName:      string;
  tableLogicalNm: string;
  purpose:        string;
  sortOrder:      number;
};

type AreaOption = { areaId: string; displayId: string; name: string };

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function FunctionDetailPage() {
  return (
    <Suspense fallback={null}>
      <FunctionDetailPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function FunctionDetailPageInner() {
  const params       = useParams<{ id: string; functionId: string }>();
  const router       = useRouter();
  const searchParams = useSearchParams();
  const queryClient  = useQueryClient();
  const projectId    = params.id;
  const functionId   = params.functionId;
  const isNew        = functionId === "new";
  const presetAreaId = searchParams.get("areaId") ?? "";

  // ── 설명 예시 팝업 상태 ────────────────────────────────────────────────────
  const [descExampleOpen, setDescExampleOpen] = useState(false);

  // ── 폼 상태 ────────────────────────────────────────────────────────────────
  const [name,           setName]           = useState("");
  const [type,           setType]           = useState("OTHER");
  const [description,    setDescription]    = useState("");
  const [priority,       setPriority]       = useState("MEDIUM");
  const [complexity,     setComplexity]     = useState("MEDIUM");
  const [effort,         setEffort]         = useState("");
  const [assignMemberId, setAssignMemberId] = useState("");
  const [implStartDate,  setImplStartDate]  = useState("");
  const [implEndDate,    setImplEndDate]    = useState("");
  const [areaId,         setAreaId]         = useState(presetAreaId);

  // ── AI 상태 ────────────────────────────────────────────────────────────────
  const [inspectComment, setInspectComment] = useState("");
  const [impactComment,  setImpactComment]  = useState("");

  // ── 컬럼 매핑 팝업 ─────────────────────────────────────────────────────────
  const [mappingPopupOpen, setMappingPopupOpen] = useState(false);

  // ── 영역 목록 (areaId 선택용) ──────────────────────────────────────────────
  const { data: areasData } = useQuery({
    queryKey: ["areas", projectId],
    queryFn:  () =>
      authFetch<{ data: { items: AreaOption[] } }>(`/api/projects/${projectId}/areas`)
        .then((r) => r.data),
  });
  const areaOptions = areasData?.items ?? [];

  // ── 기능 상세 조회 ────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["function", projectId, functionId],
    queryFn:  () =>
      authFetch<{ data: FuncDetail }>(`/api/projects/${projectId}/functions/${functionId}`)
        .then((r) => r.data),
    enabled: !isNew,
  });

  useEffect(() => {
    if (data) {
      setName(data.name);
      setType(data.type);
      setDescription(data.description);
      setPriority(data.priority);
      setComplexity(data.complexity);
      setEffort(data.effort);
      setAssignMemberId(data.assignMemberId ?? "");
      setImplStartDate(data.implStartDate);
      setImplEndDate(data.implEndDate);
      setAreaId(data.areaId ?? "");
    }
  }, [data]);

  // ── 저장 뮤테이션 ──────────────────────────────────────────────────────────
  const saveMutation = useMutation<{ data: { funcId?: string } }, Error, void>({
    mutationFn: () => {
      const body = {
        areaId: areaId || null,
        name: name.trim(), type, description: description.trim(),
        priority, complexity, effort: effort.trim(),
        assignMemberId: assignMemberId || null,
        implStartDate: implStartDate || null,
        implEndDate:   implEndDate || null,
      };
      if (isNew) {
        return authFetch<{ data: { funcId?: string } }>(`/api/projects/${projectId}/functions`, {
          method: "POST", body: JSON.stringify(body),
        });
      }
      return authFetch<{ data: { funcId?: string } }>(`/api/projects/${projectId}/functions/${functionId}`, {
        method: "PUT", body: JSON.stringify(body),
      });
    },
    onSuccess: (res) => {
      toast.success(isNew ? "기능이 등록되었습니다." : "저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["functions", projectId] });
      if (isNew && res.data.funcId) {
        router.replace(`/projects/${projectId}/functions/${res.data.funcId}`);
      } else {
        queryClient.invalidateQueries({ queryKey: ["function", projectId, functionId] });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── AI 요청 뮤테이션 ──────────────────────────────────────────────────────
  const aiMutation = useMutation({
    mutationFn: ({ taskType, comment }: { taskType: string; comment: string }) =>
      authFetch(`/api/projects/${projectId}/functions/${functionId}/ai`, {
        method: "POST", body: JSON.stringify({ taskType, comment }),
      }),
    onSuccess: (_data, vars) => {
      const labels: Record<string, string> = {
        INSPECT: "AI 명세 누락 검토 요청이 접수되었습니다.",
        IMPACT:  "AI 영향도 분석 요청이 접수되었습니다.",
      };
      toast.success(labels[vars.taskType] ?? "AI 요청이 접수되었습니다.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!isNew && isLoading) return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;

  return (
    <div style={{ padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
        <button
          onClick={() => router.push(`/projects/${projectId}/functions`)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--color-text-secondary)" }}
        >
          ←
        </button>
        <div style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)", flex: 1 }}>
          {isNew ? "기능 신규 등록" : `${data?.displayId ?? ""} 기능 편집`}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/functions`)}
            disabled={saveMutation.isPending}
            style={{ ...secondaryBtnStyle, fontSize: 13, padding: "7px 16px" }}
          >
            취소
          </button>
          <button
            onClick={() => {
              if (!name.trim()) { toast.error("기능명을 입력해 주세요."); return; }
              saveMutation.mutate();
            }}
            disabled={saveMutation.isPending}
            style={{ ...primaryBtnStyle, fontSize: 13, padding: "7px 20px" }}
          >
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {/* ── 2컬럼 레이아웃: 왼쪽 기본 정보, 오른쪽 설명 + 컬럼 매핑 + AI 지원 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 20, alignItems: "start" }}>

        {/* ── 왼쪽: AR-00078 기본 정보 ── */}
        <section style={sectionStyle}>
          <h3 style={sectionTitleStyle}>기본 정보</h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
            <div style={formGroupStyle}>
              <label style={labelStyle}>상위 영역</label>
              <select value={areaId} onChange={(e) => setAreaId(e.target.value)} style={selectStyle}>
                <option value="">미분류 (영역 없음)</option>
                {areaOptions.map((a) => (
                  <option key={a.areaId} value={a.areaId}>{a.displayId} {a.name}</option>
                ))}
              </select>
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>기능명 <span style={{ color: "#e53935" }}>*</span></label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="기능명을 입력하세요"
                style={inputStyle}
              />
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>유형</label>
              <select value={type} onChange={(e) => setType(e.target.value)} style={selectStyle}>
                {FUNC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>우선순위</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} style={selectStyle}>
                <option value="HIGH">HIGH — 높음</option>
                <option value="MEDIUM">MEDIUM — 중간</option>
                <option value="LOW">LOW — 낮음</option>
              </select>
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>복잡도</label>
              <select value={complexity} onChange={(e) => setComplexity(e.target.value)} style={selectStyle}>
                <option value="HIGH">HIGH — 높음</option>
                <option value="MEDIUM">MEDIUM — 중간</option>
                <option value="LOW">LOW — 낮음</option>
              </select>
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>예상 공수</label>
              <input
                type="text"
                value={effort}
                onChange={(e) => setEffort(e.target.value)}
                placeholder="예: 2h, 0.5d"
                style={inputStyle}
              />
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>구현 시작일</label>
              <input
                type="date"
                value={implStartDate}
                onChange={(e) => setImplStartDate(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>구현 종료일</label>
              <input
                type="date"
                value={implEndDate}
                onChange={(e) => setImplEndDate(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
        </section>

        {/* ── 오른쪽: 설명 + 컬럼 매핑 + AI 지원 ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* 설명 (func_dc) — MarkdownEditor */}
          <section style={sectionStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>설명</h3>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={() => setDescExampleOpen(true)} style={ghostSmBtnStyle}>
                  예시
                </button>
                <button
                  type="button"
                  onClick={() => setDescription(DESCRIPTION_TEMPLATE(data?.displayId ?? "FN-XXXXX", name))}
                  style={ghostSmBtnStyle}
                >
                  템플릿 삽입
                </button>
              </div>
            </div>
            <MarkdownEditor
              value={description}
              onChange={setDescription}
              placeholder="기능 설명을 마크다운으로 작성하세요."
              rows={14}
            />
          </section>

          {/* 설명 예시 팝업 */}
          {descExampleOpen && (
            <div
              style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
              onClick={() => setDescExampleOpen(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: "100%", maxWidth: 816, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.2)", padding: "20px 24px", maxHeight: "80vh", display: "flex", flexDirection: "column" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>설명 예시</span>
                  <button type="button" onClick={() => setDescExampleOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#888" }}>×</button>
                </div>
                <pre style={{ flex: 1, overflowY: "auto", background: "var(--color-bg-elevated)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "14px 16px", fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", color: "var(--color-text-primary)", margin: 0 }}>
                  {DESCRIPTION_EXAMPLE}
                </pre>
              </div>
            </div>
          )}

          {/* 신규 모드에서는 컬럼 매핑·AI 지원 숨김 */}
          {!isNew && (
            <>
              {/* ── AR-00082 컬럼 매핑 ── */}
              <section style={sectionStyle}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>컬럼 매핑</h3>
                  <button
                    onClick={() => setMappingPopupOpen(true)}
                    style={{ ...primaryBtnStyle, fontSize: 13, padding: "6px 14px" }}
                  >
                    매핑 관리
                  </button>
                </div>

                {!data?.columnMappings.length ? (
                  <div style={{ padding: "24px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
                    등록된 컬럼 매핑이 없습니다.
                  </div>
                ) : (
                  <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
                    <div style={mappingGridHeaderStyle}>
                      <div>테이블명</div>
                      <div>컬럼명</div>
                      <div>용도</div>
                    </div>
                    {data.columnMappings.map((m, idx) => (
                      <div
                        key={m.mappingId}
                        style={{ ...mappingGridRowStyle, borderTop: idx === 0 ? "none" : "1px solid var(--color-border)" }}
                      >
                        <div style={{ fontSize: 13, fontFamily: "monospace" }}>{m.tableName}</div>
                        <div style={{ fontSize: 13, fontFamily: "monospace" }}>{m.colName}</div>
                        <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{m.purpose || "-"}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ── AR-00080 AI 지원 ── */}
              <section style={sectionStyle}>
                <h3 style={sectionTitleStyle}>AI 지원</h3>

                <div style={{ marginBottom: 12 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>AI 명세 누락 검토</h4>
                  <textarea
                    value={inspectComment}
                    onChange={(e) => setInspectComment(e.target.value)}
                    placeholder="추가 검토 지시사항"
                    rows={2}
                    style={{ ...inputStyle, resize: "vertical", marginBottom: 8 }}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      onClick={() => aiMutation.mutate({ taskType: "INSPECT", comment: inspectComment })}
                      style={primaryBtnStyle}
                      disabled={aiMutation.isPending}
                    >
                      AI 명세 누락 검토 요청
                    </button>
                  </div>
                </div>

                <div>
                  <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>AI 영향도 분석</h4>
                  <textarea
                    value={impactComment}
                    onChange={(e) => setImpactComment(e.target.value)}
                    placeholder="추가 분석 지시사항"
                    rows={2}
                    style={{ ...inputStyle, resize: "vertical", marginBottom: 8 }}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      onClick={() => aiMutation.mutate({ taskType: "IMPACT", comment: impactComment })}
                      style={primaryBtnStyle}
                      disabled={aiMutation.isPending}
                    >
                      AI 영향도 분석 요청
                    </button>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {/* ── PID-00053 컬럼 매핑 관리 팝업 ────────────────────────────────── */}
      {mappingPopupOpen && data && (
        <ColumnMappingPopup
          projectId={projectId}
          functionId={functionId}
          initialMappings={data.columnMappings}
          onClose={() => setMappingPopupOpen(false)}
          onSaved={() => {
            setMappingPopupOpen(false);
            queryClient.invalidateQueries({ queryKey: ["function", projectId, functionId] });
          }}
        />
      )}
    </div>
  );
}

// ── PID-00053 컬럼 매핑 관리 팝업 ────────────────────────────────────────────

type DbTable  = { tableId: string; tableName: string; tableLogicalNm: string };
type DbColumn = { colId: string; colName: string; colLogicalNm: string };
type EditMapping = { colId: string; tableName: string; colName: string; purpose: string; _tableId: string };

function ColumnMappingPopup({
  projectId, functionId, initialMappings, onClose, onSaved,
}: {
  projectId:       string;
  functionId:      string;
  initialMappings: ColumnMapping[];
  onClose:         () => void;
  onSaved:         () => void;
}) {
  const [selectedTableId, setSelectedTableId] = useState("");
  const [mappings, setMappings] = useState<EditMapping[]>(
    initialMappings.map((m) => ({
      colId:     m.colId,
      tableName: m.tableName,
      colName:   m.colName,
      purpose:   m.purpose,
      _tableId:  m.tableId,
    }))
  );

  // DB 테이블 목록
  const { data: tablesData } = useQuery({
    queryKey: ["db-schema", projectId, "tables"],
    queryFn:  () =>
      authFetch<{ data: { tables: DbTable[] } }>(`/api/projects/${projectId}/db-schema`)
        .then((r) => r.data),
  });
  const tables = tablesData?.tables ?? [];

  // 선택 테이블의 컬럼 목록
  const { data: colsData } = useQuery({
    queryKey: ["db-schema", projectId, "columns", selectedTableId],
    queryFn:  () =>
      authFetch<{ data: { columns: DbColumn[] } }>(
        `/api/projects/${projectId}/db-schema?tableId=${selectedTableId}`
      ).then((r) => r.data),
    enabled: !!selectedTableId,
  });
  const columns = colsData?.columns ?? [];

  function addRow(colId: string, colName: string) {
    if (!selectedTableId) return;
    const tbl = tables.find((t) => t.tableId === selectedTableId);
    if (!tbl) return;
    if (mappings.some((m) => m.colId === colId)) {
      toast.error("이미 추가된 컬럼입니다.");
      return;
    }
    setMappings((prev) => [...prev, { colId, tableName: tbl.tableName, colName, purpose: "", _tableId: selectedTableId }]);
  }

  function removeRow(idx: number) {
    setMappings((prev) => prev.filter((_, i) => i !== idx));
  }

  function updatePurpose(idx: number, value: string) {
    setMappings((prev) => prev.map((m, i) => i === idx ? { ...m, purpose: value } : m));
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/functions/${functionId}/column-mappings`, {
        method: "POST",
        body:   JSON.stringify({ mappings: mappings.map((m) => ({ colId: m.colId, purpose: m.purpose })) }),
      }),
    onSuccess: () => {
      toast.success("컬럼 매핑이 저장되었습니다.");
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // AI 초안 생성 (DESIGN 태스크 요청)
  const aiDraftMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/functions/${functionId}/ai`, {
        method: "POST",
        body:   JSON.stringify({ taskType: "DESIGN" }),
      }),
    onSuccess: () => toast.success("AI 컬럼 매핑 초안 생성 요청이 접수되었습니다."),
    onError:   (err: Error) => toast.error(err.message),
  });

  return (
    <div style={{ ...overlayStyle, zIndex: 2000 }} onClick={onClose}>
      <div
        style={{
          background: "var(--color-bg-card)", borderRadius: 10,
          padding: "28px 32px", width: "min(720px, 92vw)", maxHeight: "85vh",
          overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>컬럼 매핑 관리</h3>
          <button onClick={onClose} style={secondaryBtnStyle}>닫기</button>
        </div>

        {/* AR-00084 테이블 선택 + AI 초안 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>테이블 선택</label>
            <select
              value={selectedTableId}
              onChange={(e) => setSelectedTableId(e.target.value)}
              style={selectStyle}
            >
              <option value="">테이블을 선택하세요</option>
              {tables.map((t) => (
                <option key={t.tableId} value={t.tableId}>
                  {t.tableName}{t.tableLogicalNm ? ` (${t.tableLogicalNm})` : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => aiDraftMutation.mutate()}
            style={{ ...primaryBtnStyle, flexShrink: 0 }}
            disabled={aiDraftMutation.isPending}
          >
            AI 초안 생성
          </button>
        </div>

        {/* 선택된 테이블의 컬럼 목록 (클릭하여 추가) */}
        {selectedTableId && columns.length > 0 && (
          <div style={{ marginBottom: 16, padding: 12, background: "var(--color-bg-muted)", borderRadius: 6 }}>
            <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 600 }}>
              컬럼 클릭하여 추가
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {columns.map((c) => (
                <button
                  key={c.colId}
                  onClick={() => addRow(c.colId, c.colName)}
                  style={{
                    padding: "3px 10px", borderRadius: 4, border: "1px solid var(--color-border)",
                    background: "var(--color-bg-card)", cursor: "pointer", fontSize: 12,
                    fontFamily: "monospace",
                  }}
                  title={c.colLogicalNm}
                >
                  {c.colName}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* AR-00085 매핑 편집 목록 */}
        {mappings.length > 0 && (
          <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden", marginBottom: 16 }}>
            <div style={mappingEditHeaderStyle}>
              <div>테이블명</div>
              <div>컬럼명</div>
              <div>용도</div>
              <div />
            </div>
            {mappings.map((m, idx) => (
              <div key={idx} style={{ ...mappingEditRowStyle, borderTop: idx === 0 ? "none" : "1px solid var(--color-border)" }}>
                <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--color-text-secondary)" }}>
                  {m.tableName}
                </div>
                <div style={{ fontSize: 12, fontFamily: "monospace" }}>{m.colName}</div>
                <div>
                  <input
                    type="text"
                    value={m.purpose}
                    onChange={(e) => updatePurpose(idx, e.target.value)}
                    placeholder="조회조건, 조회결과 등"
                    style={{ ...inputStyle, fontSize: 12, padding: "4px 8px" }}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <button onClick={() => removeRow(idx)} style={{ background: "none", border: "none", cursor: "pointer", color: "#e53935", fontSize: 16 }}>
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={secondaryBtnStyle} disabled={saveMutation.isPending}>취소</button>
          <button
            onClick={() => saveMutation.mutate()}
            style={primaryBtnStyle}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 설명 예시 / 템플릿 ────────────────────────────────────────────────────────

const DESCRIPTION_EXAMPLE = `test`;

const DESCRIPTION_TEMPLATE = (displayId: string, name: string) => `test`;

// ── 상수 ─────────────────────────────────────────────────────────────────────

const FUNC_TYPES = [
  { value: "SEARCH",   label: "SEARCH — 검색/조회" },
  { value: "SAVE",     label: "SAVE — 저장" },
  { value: "DELETE",   label: "DELETE — 삭제" },
  { value: "DOWNLOAD", label: "DOWNLOAD — 다운로드" },
  { value: "UPLOAD",   label: "UPLOAD — 업로드" },
  { value: "NAVIGATE", label: "NAVIGATE — 이동" },
  { value: "VALIDATE", label: "VALIDATE — 유효성검증" },
  { value: "OTHER",    label: "OTHER — 기타" },
];

// ── 스타일 ────────────────────────────────────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  marginBottom: 28, padding: "24px",
  border: "1px solid var(--color-border)", borderRadius: 8,
  background: "var(--color-bg-card)",
};
const sectionTitleStyle: React.CSSProperties = { margin: "0 0 8px", fontSize: 15, fontWeight: 700 };
const formGroupStyle: React.CSSProperties  = { marginBottom: 16 };
const labelStyle: React.CSSProperties = {
  display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600,
  color: "var(--color-text-secondary)",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", borderRadius: 6,
  border: "1px solid var(--color-border)", fontSize: 14,
  background: "var(--color-bg-card)", color: "var(--color-text-primary)", boxSizing: "border-box",
};
const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 10px center",
  paddingRight: 32,
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px", borderRadius: 6, border: "none",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 14, fontWeight: 600, cursor: "pointer",
};
const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-primary)", fontSize: 14, cursor: "pointer",
};
const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
};

const MAPPING_GRID   = "1fr 1fr 1fr";
const MAPPING_EDIT_GRID = "140px 140px 1fr 40px";

const mappingGridHeaderStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: MAPPING_GRID, gap: 8,
  padding: "8px 16px", background: "var(--color-bg-muted)",
  fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border)",
};
const mappingGridRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: MAPPING_GRID, gap: 8,
  padding: "10px 16px", alignItems: "center", background: "var(--color-bg-card)",
};
const mappingEditHeaderStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: MAPPING_EDIT_GRID, gap: 8,
  padding: "8px 12px", background: "var(--color-bg-muted)",
  fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border)",
};
const mappingEditRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: MAPPING_EDIT_GRID, gap: 8,
  padding: "8px 12px", alignItems: "center", background: "var(--color-bg-card)",
};

const ghostSmBtnStyle: React.CSSProperties = {
  padding:      "3px 9px",
  borderRadius: 5,
  border:       "1px solid var(--color-border)",
  background:   "none",
  color:        "var(--color-text-secondary)",
  fontSize:     12,
  cursor:       "pointer",
};
