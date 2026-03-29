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
import SettingsHistoryDialog from "@/components/ui/SettingsHistoryDialog";
import ColMappingDialog from "@/components/ui/ColMappingDialog";
import { useAppStore } from "@/store/appStore";

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
  const params         = useParams<{ id: string; functionId: string }>();
  const router         = useRouter();
  const searchParams   = useSearchParams();
  const queryClient    = useQueryClient();
  const { setBreadcrumb } = useAppStore();
  const projectId      = params.id;
  const functionId     = params.functionId;
  const isNew        = functionId === "new";
  const presetAreaId = searchParams.get("areaId") ?? "";

  // ── 설명 예시 팝업 상태 ────────────────────────────────────────────────────
  const [descExampleOpen, setDescExampleOpen] = useState(false);

  // ── 변경 이력 관련 상태 ────────────────────────────────────────────────────
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyViewOpen,   setHistoryViewOpen]   = useState(false);
  const [originalDescription, setOriginalDescription] = useState("");

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
  const [sortOrder,      setSortOrder]      = useState(0);

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

  // GNB 브레드크럼 설정 — 마운트 시 설정, 언마운트 시 초기화
  useEffect(() => {
    const items = [
      { label: "기능 정의", href: `/projects/${projectId}/functions` },
      ...(data?.areaName ? [{ label: data.areaName }] : []),
      { label: isNew ? "신규 등록" : (data?.displayId ?? "편집") },
    ];
    setBreadcrumb(items);
    return () => setBreadcrumb([]);
  }, [projectId, isNew, data?.areaName, data?.displayId, setBreadcrumb]);

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
      setSortOrder(data.sortOrder ?? 0);
      // 설명 변경 감지를 위해 원본 값 보관
      setOriginalDescription(data.description ?? "");
    }
  }, [data]);

  // ── 저장 뮤테이션 ──────────────────────────────────────────────────────────
  const saveMutation = useMutation<{ data: { funcId?: string } }, Error, { saveHistory?: boolean }>({
    mutationFn: ({ saveHistory } = {}) => {
      const body = {
        areaId: areaId || null,
        name: name.trim(), type, description: description.trim(),
        priority, complexity, effort: effort.trim(),
        assignMemberId: assignMemberId || null,
        implStartDate: implStartDate || null,
        implEndDate:   implEndDate || null,
        sortOrder,
        saveHistory:   saveHistory || undefined,
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
    onSuccess: (res, variables) => {
      toast.success(isNew ? "기능이 등록되었습니다." : "저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["functions", projectId] });
      if (isNew && res.data.funcId) {
        router.replace(`/projects/${projectId}/functions/${res.data.funcId}`);
      } else {
        queryClient.invalidateQueries({ queryKey: ["function", projectId, functionId] });
        setOriginalDescription(description.trim());
        if (variables?.saveHistory) {
          queryClient.invalidateQueries({ queryKey: ["settings-history", projectId] });
        }
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
    <div style={{ padding: 0 }}>

      {/* 타이틀 행 — full-width 배경, 좌: ← 타이틀 | 중: 상태 배지(HTML) | 우: 취소·저장 */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16,
        padding: "10px 24px",
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>

        {/* 좌: 뒤로 + 타이틀 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/functions`)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1 }}
          >
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {isNew ? "기능 신규 등록" : `${data?.displayId ?? ""} 기능 편집`}
          </span>
        </div>

        {/* 중: 상태 배지 (단순 HTML) */}
        {!isNew && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, flex: 1, flexWrap: "wrap" }}>
            <div style={statusGroupStyle}>
              <span style={statusLabelStyle}>작업 상태</span>
              <span style={{ ...statusDotStyle, background: "#4caf50" }} />
              <span style={statusValueStyle}>완료</span>
            </div>
            <div style={statusDividerStyle} />
            <div style={statusGroupStyle}>
              <span style={statusLabelStyle}>PL 검토</span>
              <span style={{ ...statusDotStyle, background: "#ff9800" }} />
              <span style={statusValueStyle}>검토 중</span>
            </div>
            <div style={statusDividerStyle} />
            <div style={statusGroupStyle}>
              <span style={statusLabelStyle}>AI</span>
              <span style={{ ...statusDotStyle, background: "#1976d2" }} />
              <span style={statusValueStyle}>명세 생성 중</span>
            </div>
          </div>
        )}
        {isNew && <div style={{ flex: 1 }} />}

        {/* 우: 취소·저장 */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/functions`)}
            disabled={saveMutation.isPending}
            style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 14px", minWidth: 60 }}
          >
            취소
          </button>
          <button
            onClick={() => {
              if (!name.trim()) { toast.error("기능명을 입력해 주세요."); return; }
              const descChanged = !isNew && description.trim() !== originalDescription.trim();
              if (descChanged) { setHistoryDialogOpen(true); return; }
              saveMutation.mutate({});
            }}
            disabled={saveMutation.isPending}
            style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px", minWidth: 60 }}
          >
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {/* ── 2컬럼 레이아웃: 왼쪽 기본 정보, 오른쪽 설명 + 컬럼 매핑 + AI 지원 */}
      <div style={{ padding: "0 24px 24px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 20, alignItems: "start" }}>

        {/* ── 왼쪽: AR-00078 기본 정보 ── */}
        <section style={sectionStyle}>

          {/* 행1: 소속 영역 | 유형 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <div style={formGroupStyle}>
              <label style={labelStyle}>소속 영역</label>
              <select value={areaId} onChange={(e) => setAreaId(e.target.value)} style={selectStyle}>
                <option value="">미분류 (영역 없음)</option>
                {areaOptions.map((a) => (
                  <option key={a.areaId} value={a.areaId}>{a.displayId} {a.name}</option>
                ))}
              </select>
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>유형</label>
              <select value={type} onChange={(e) => setType(e.target.value)} style={selectStyle}>
                {FUNC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          {/* 행2: 기능명 | 우선순위 (우선순위 width 고정) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: "0 16px" }}>
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
              <label style={labelStyle}>우선순위</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} style={selectStyle}>
                <option value="HIGH">높음</option>
                <option value="MEDIUM">중간</option>
                <option value="LOW">낮음</option>
              </select>
            </div>
          </div>

          {/* 행3: 복잡도 | 예상 공수 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <div style={formGroupStyle}>
              <label style={labelStyle}>복잡도</label>
              <select value={complexity} onChange={(e) => setComplexity(e.target.value)} style={selectStyle}>
                <option value="HIGH">높음</option>
                <option value="MEDIUM">중간</option>
                <option value="LOW">낮음</option>
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
          </div>

          {/* 행4: 구현 시작일 | 구현 종료일 | 정렬 순서 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px", gap: "0 16px" }}>
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

            <div style={formGroupStyle}>
              <label style={labelStyle}>정렬</label>
              <input
                type="number"
                min={0}
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
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
              <label style={{ ...labelStyle, marginBottom: 0 }}>설명</label>
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
                {!isNew && (
                  <button type="button" onClick={() => setHistoryViewOpen(true)} style={ghostSmBtnStyle}>
                    🕐 변경 이력
                  </button>
                )}
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

          {/* 설명 변경 이력 저장 여부 확인 다이얼로그 */}
          {historyDialogOpen && (
            <div
              style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
              onClick={() => setHistoryDialogOpen(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: "100%", maxWidth: 420, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.2)", padding: "24px 28px" }}
              >
                <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
                  변경 이력 저장
                </p>
                <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  기능 설명이 변경되었습니다.<br />
                  변경 이력을 함께 저장하시겠습니까?
                </p>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setHistoryDialogOpen(false)}
                    style={{ ...secondaryBtnStyle, fontSize: 13, padding: "6px 16px" }}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => { setHistoryDialogOpen(false); saveMutation.mutate({}); }}
                    disabled={saveMutation.isPending}
                    style={{ ...secondaryBtnStyle, fontSize: 13, padding: "6px 16px" }}
                  >
                    이력 없이 저장
                  </button>
                  <button
                    type="button"
                    onClick={() => { setHistoryDialogOpen(false); saveMutation.mutate({ saveHistory: true }); }}
                    disabled={saveMutation.isPending}
                    style={{ ...primaryBtnStyle, fontSize: 13, padding: "6px 16px" }}
                  >
                    이력과 함께 저장
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 설명 변경 이력 조회 팝업 */}
          <SettingsHistoryDialog
            open={historyViewOpen}
            onClose={() => setHistoryViewOpen(false)}
            projectId={projectId}
            itemName="기능 설명"
            currentValue={description}
            title="기능 설명 변경 이력"
          />

          {/* 신규 모드에서는 컬럼 매핑·AI 지원 숨김 */}
          {!isNew && (
            <>
              {/* ── AR-00082 컬럼 매핑 ── */}
              <section style={sectionStyle}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 0 }}>
                  <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>컬럼 매핑</h3>
                  <button
                    onClick={() => setMappingPopupOpen(true)}
                    style={{ ...primaryBtnStyle, fontSize: 13, padding: "6px 14px" }}
                  >
                    매핑 관리
                  </button>
                </div>
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
      </div>

      {/* ── PID-00053 컬럼 매핑 관리 팝업 ────────────────────────────────── */}
      <ColMappingDialog
        open={mappingPopupOpen}
        onClose={() => setMappingPopupOpen(false)}
        onSaved={() => setMappingPopupOpen(false)}
        projectId={projectId}
        refType="FUNCTION"
        refId={functionId}
        title="컬럼 매핑 관리"
      />
    </div>
  );
}

// ── (구 ColumnMappingPopup 제거됨 — ColMappingDialog 공통 컴포넌트로 교체)

// ── 설명 예시 / 템플릿 ────────────────────────────────────────────────────────

const DESCRIPTION_EXAMPLE = `test`;

const DESCRIPTION_TEMPLATE = (displayId: string, name: string) => `test`;

// ── 상수 ─────────────────────────────────────────────────────────────────────

const FUNC_TYPES = [
  { value: "SEARCH",   label: "검색/조회" },
  { value: "SAVE",     label: "저장" },
  { value: "DELETE",   label: "삭제" },
  { value: "DOWNLOAD", label: "다운로드" },
  { value: "UPLOAD",   label: "업로드" },
  { value: "NAVIGATE", label: "이동" },
  { value: "VALIDATE", label: "유효성검증" },
  { value: "OTHER",    label: "기타" },
];

// ── 스타일 ────────────────────────────────────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  padding: "16px 20px",
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
  padding: "8px 20px", borderRadius: 6, border: "1px solid transparent",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 14, fontWeight: 600, cursor: "pointer",
};
const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-primary)", fontSize: 14, cursor: "pointer",
};

const statusGroupStyle: React.CSSProperties = {
  display:     "flex",
  alignItems:  "center",
  gap:         5,
};

const statusLabelStyle: React.CSSProperties = {
  fontSize:    11,
  fontWeight:  600,
  color:       "var(--color-text-secondary)",
  letterSpacing: "0.03em",
};

const statusDotStyle: React.CSSProperties = {
  width:        7,
  height:       7,
  borderRadius: "50%",
  flexShrink:   0,
};

const statusValueStyle: React.CSSProperties = {
  fontSize:  12,
  fontWeight: 500,
  color:     "var(--color-text-primary)",
};

const statusDividerStyle: React.CSSProperties = {
  width:      1,
  height:     14,
  background: "var(--color-border)",
  flexShrink: 0,
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
