"use client";

/**
 * AdminPromptTemplateDetailPage — DEFAULT AI 프롬프트 상세·편집
 *
 * 역할:
 *   - tmplId === "new" → 신규 등록 모드 (POST /api/admin/prompt-templates)
 *   - 그 외 → 기존 DEFAULT 프롬프트 수정 (PUT /api/admin/.../[id])
 *   - 일반 페이지(/projects/.../prompt-templates/[id]) 와 동일한 폼 구조.
 *
 * 권한:
 *   - AdminLayout 이 isSystemAdmin 으로 영역 가드. 추가 가드 불필요.
 *   - 항상 편집 가능. 복사·읽기 전용 분기 없음.
 *   - 삭제 진입점 없음 (정책상 차단).
 */

import { Suspense, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import MarkdownEditor, { MarkdownTabButtons } from "@/components/ui/MarkdownEditor";
import { type PromptTemplateTaskType, type PromptTemplateRefType } from "@/constants/codes";
import { ARTF_DIV, ARTF_FMT } from "@/constants/planStudio";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type TaskType = PromptTemplateTaskType;
type RefType  = PromptTemplateRefType;

type TemplateDetail = {
  tmplId:      string;
  projectId:   string | null;
  isSystem:    boolean;
  defaultYn:   string;
  tmplNm:      string;
  taskTyCode:  TaskType;
  refTyCode:   RefType | null;
  divCode:     string | null;
  fmtCode:     string | null;
  sysPromptCn: string;
  tmplDc:      string;
  useYn:       string;
  sortOrdr:    number;
  useCnt:      number;
  creatDt:     string;
  mdfcnDt:     string;
};

const TASK_TYPE_OPTIONS: { value: TaskType; label: string }[] = [
  { value: "DESIGN",    label: "설계" },
  { value: "INSPECT",   label: "명세 검토" },
  { value: "IMPACT",    label: "영향도 분석" },
  { value: "IMPLEMENT", label: "구현" },
  { value: "TEST",      label: "테스트" },
];

const DEPRECATED_TASK_TYPES: Partial<Record<TaskType, string>> = {
  MOCKUP: "목업",
  CUSTOM: "자유 요청",
};

const DIV_OPTIONS = Object.values(ARTF_DIV);
const FMT_OPTIONS = Object.values(ARTF_FMT);

// ── 페이지 래퍼 ───────────────────────────────────────────────────────────────

export default function AdminPromptTemplateDetailPage() {
  return (
    <Suspense fallback={null}>
      <AdminPromptTemplateDetailPageInner />
    </Suspense>
  );
}

function AdminPromptTemplateDetailPageInner() {
  const params = useParams();
  const router = useRouter();
  const qc     = useQueryClient();
  const tmplId = params.tmplId as string;
  const isNew  = tmplId === "new";

  const [sysTab, setSysTab] = useState<"edit" | "preview">("edit");

  // 폼 상태
  const [tmplNm,      setTmplNm]      = useState("");
  const [taskTyCode,  setTaskTyCode]  = useState<TaskType>("INSPECT");
  const [refTyCode,   setRefTyCode]   = useState<RefType | "">("");
  const [divCode,     setDivCode]     = useState("");
  const [fmtCode,     setFmtCode]     = useState("");
  const [tmplDc,      setTmplDc]      = useState("");
  const [useYn,       setUseYn]       = useState("Y");
  const [sortOrdr,    setSortOrdr]    = useState(0);
  const [sysPromptCn, setSysPromptCn] = useState("");

  // 상세 조회
  const { data: detail, isLoading } = useQuery<TemplateDetail>({
    queryKey: ["admin-prompt-template", tmplId],
    queryFn: () => authFetch<{ data: TemplateDetail }>(
      `/api/admin/prompt-templates/${tmplId}`,
    ).then((r) => r.data),
    enabled: !isNew,
  });

  useEffect(() => {
    if (detail) {
      setTmplNm(detail.tmplNm);
      setTaskTyCode(detail.taskTyCode);
      setRefTyCode(detail.refTyCode ?? "");
      setDivCode(detail.divCode ?? "");
      setFmtCode(detail.fmtCode ?? "");
      setTmplDc(detail.tmplDc);
      setUseYn(detail.useYn);
      setSortOrdr(detail.sortOrdr);
      setSysPromptCn(detail.sysPromptCn);
    }
  }, [detail]);

  // 저장
  const saveMutation = useMutation({
    mutationFn: () => {
      const isPlanStudio = refTyCode === "PLAN_STUDIO_ARTF";
      const body = {
        tmplNm,
        taskTyCode,
        refTyCode:   refTyCode || null,
        divCode:     isPlanStudio ? (divCode || null) : null,
        fmtCode:     isPlanStudio ? (fmtCode || null) : null,
        sysPromptCn: sysPromptCn || null,
        tmplDc:      tmplDc      || null,
        useYn,
        sortOrdr,
      };
      if (isNew) {
        return authFetch("/api/admin/prompt-templates", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      return authFetch(`/api/admin/prompt-templates/${tmplId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["admin-prompt-templates"] });
      if (isNew) {
        toast.success("DEFAULT 프롬프트가 등록되었습니다.");
        const newId = (res as { data?: { tmplId?: string } })?.data?.tmplId;
        if (newId) router.replace(`/admin/prompt-templates/${newId}`);
        else router.push("/admin/prompt-templates");
      } else {
        toast.success("DEFAULT 프롬프트가 저장되었습니다.");
        qc.invalidateQueries({ queryKey: ["admin-prompt-template", tmplId] });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSave() {
    if (!tmplNm.trim()) { toast.error("템플릿 명을 입력하세요."); return; }
    if (taskTyCode in DEPRECATED_TASK_TYPES) {
      toast.error(`"${DEPRECATED_TASK_TYPES[taskTyCode]}"은(는) 사용 중단된 유형입니다.`);
      return;
    }
    if (refTyCode === "PLAN_STUDIO_ARTF") {
      if (!divCode) { toast.error("산출물 구분을 선택하세요."); return; }
      if (!fmtCode) { toast.error("출력 형식을 선택하세요."); return; }
    }
    saveMutation.mutate();
  }

  if (!isNew && isLoading) {
    return <div style={{ padding: "40px 32px", color: "var(--color-text-tertiary)" }}>로딩 중...</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 140px)" }}>
      {/* ── 서브 헤더 ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => router.push("/admin/prompt-templates")}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1, padding: "2px 4px" }}
          >
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {isNew ? "DEFAULT 프롬프트 등록" : "DEFAULT 프롬프트 편집"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => router.push("/admin/prompt-templates")}
            disabled={saveMutation.isPending}
            style={secondaryBtnStyle}
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            style={primaryBtnStyle}
          >
            {saveMutation.isPending ? "저장 중..." : (isNew ? "등록" : "저장")}
          </button>
        </div>
      </div>

      {/* ── 폼 본문 ── */}
      <div style={{
        flex: 1, minHeight: 0,
        border: "1px solid var(--color-border)", borderRadius: 8,
        padding: "24px 28px", background: "var(--color-bg-card)",
        display: "flex", flexDirection: "column", gap: 20,
        overflow: "hidden",
      }}>
        {/* DEFAULT 영향 범위 경고 */}
        <div style={{
          padding: "10px 14px", borderRadius: 6,
          background: "var(--color-warning-subtle)",
          border:     "1px solid var(--color-warning-border)",
          fontSize:   13,
          color:      "var(--color-warning)",
          lineHeight: 1.6,
        }}>
          ⚠️ <strong>DEFAULT 프롬프트</strong>입니다. 변경 내용은 <strong>모든 프로젝트의 AI 요청</strong>에
          즉시 적용됩니다. 신중하게 수정해 주세요.
        </div>

        {/* 폐기된 작업 유형 경고 */}
        {!isNew && taskTyCode in DEPRECATED_TASK_TYPES && (
          <div style={{
            padding: "10px 14px", borderRadius: 6,
            background: "var(--color-warning-subtle)",
            border:     "1px solid var(--color-warning-border)",
            fontSize:   13,
            color:      "var(--color-text-secondary)",
            lineHeight: 1.6,
          }}>
            ⚠️ 작업 유형 <strong>&ldquo;{DEPRECATED_TASK_TYPES[taskTyCode]}&rdquo;</strong>은(는) 더 이상 사용하지 않는 유형입니다.
            저장 전에 <strong>설계 / 명세 검토 / 영향도 분석 / 구현 / 테스트</strong> 중 하나로 변경해 주세요.
          </div>
        )}

        {/* 템플릿 명 */}
        <FormField label="템플릿 명" required>
          <input
            value={tmplNm}
            onChange={(e) => setTmplNm(e.target.value)}
            placeholder="템플릿 명을 입력하세요"
            maxLength={200}
            style={inputStyle}
          />
        </FormField>

        {/* 설명 */}
        <FormField label="설명">
          <input
            value={tmplDc}
            onChange={(e) => setTmplDc(e.target.value)}
            placeholder="템플릿에 대한 간단한 설명을 입력하세요"
            style={inputStyle}
          />
        </FormField>

        {/* 작업 유형 / 사용처 / 정렬 / 사용 여부 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr 0.7fr 0.7fr", gap: 16 }}>
          <FormField label="작업 유형" required>
            <select
              value={taskTyCode}
              onChange={(e) => setTaskTyCode(e.target.value as TaskType)}
              disabled={refTyCode === "PLAN_STUDIO_ARTF"}
              style={selectStyle}
            >
              {refTyCode === "PLAN_STUDIO_ARTF" ? (
                <option value="PLAN_STUDIO_ARTF_GENERATE">산출물 생성</option>
              ) : (
                <>
                  {TASK_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                  {taskTyCode in DEPRECATED_TASK_TYPES && (
                    <option value={taskTyCode} disabled style={{ color: "var(--color-warning)" }}>
                      ⚠ {DEPRECATED_TASK_TYPES[taskTyCode]} (미사용)
                    </option>
                  )}
                </>
              )}
            </select>
          </FormField>

          <FormField label="대상 사용처">
            <select
              value={refTyCode}
              onChange={(e) => {
                const v = e.target.value as RefType | "";
                setRefTyCode(v);
                if (v === "PLAN_STUDIO_ARTF") {
                  setTaskTyCode("PLAN_STUDIO_ARTF_GENERATE");
                  if (!divCode) setDivCode("IA");
                  if (!fmtCode) setFmtCode("MD");
                } else {
                  if (taskTyCode === "PLAN_STUDIO_ARTF_GENERATE") setTaskTyCode("INSPECT");
                  setDivCode("");
                  setFmtCode("");
                }
              }}
              style={selectStyle}
            >
              <option value="">범용</option>
              <option value="UNIT_WORK">단위업무 (UNIT_WORK)</option>
              <option value="SCREEN">화면 (SCREEN)</option>
              <option value="AREA">영역 설계 (AREA)</option>
              <option value="FUNCTION">기능 설계 (FUNCTION)</option>
              <option value="PLAN_STUDIO_ARTF">기획실 산출물 (PLAN_STUDIO_ARTF)</option>
            </select>
          </FormField>

          <FormField label="정렬 순서">
            <input
              type="number"
              value={sortOrdr}
              onChange={(e) => setSortOrdr(Number(e.target.value))}
              min={0}
              style={inputStyle}
            />
          </FormField>

          <FormField label="사용 여부">
            <select
              value={useYn}
              onChange={(e) => setUseYn(e.target.value)}
              style={selectStyle}
            >
              <option value="Y">사용</option>
              <option value="N">미사용</option>
            </select>
          </FormField>
        </div>

        {/* 기획실 매트릭스 */}
        {refTyCode === "PLAN_STUDIO_ARTF" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr 0.7fr 0.7fr", gap: 16 }}>
            <FormField label="산출물 구분" required>
              <select value={divCode} onChange={(e) => setDivCode(e.target.value)} style={selectStyle}>
                {DIV_OPTIONS.map((d) => (
                  <option key={d.code} value={d.code}>{d.name} ({d.code})</option>
                ))}
              </select>
            </FormField>
            <FormField label="출력 형식" required>
              <select value={fmtCode} onChange={(e) => setFmtCode(e.target.value)} style={selectStyle}>
                {FMT_OPTIONS.map((f) => (
                  <option key={f.code} value={f.code}>{f.name} ({f.code})</option>
                ))}
              </select>
            </FormField>
            <div />
            <div />
          </div>
        )}

        {/* 메타 */}
        {!isNew && detail && (
          <div style={{ display: "flex", gap: 24 }}>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              이용 건수: <strong>{detail.useCnt.toLocaleString()}</strong>
            </span>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              등록일: <strong>{detail.creatDt.slice(0, 10)}</strong>
            </span>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              수정일: <strong>{detail.mdfcnDt.slice(0, 10)}</strong>
            </span>
          </div>
        )}

        {/* 시스템 프롬프트 */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexShrink: 0 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)" }}>
              시스템 프롬프트
              <span style={{ fontSize: 11, fontWeight: 400, color: "var(--color-text-secondary)", marginLeft: 8 }}>
                AI의 역할·맥락 지시
              </span>
            </label>
            <MarkdownTabButtons tab={sysTab} onTabChange={setSysTab} />
          </div>
          <MarkdownEditor
            value={sysPromptCn}
            onChange={setSysPromptCn}
            placeholder="시스템 프롬프트를 입력하세요. AI의 역할, 맥락, 규칙 등을 기술합니다."
            tab={sysTab}
            onTabChange={setSysTab}
            fullHeight
          />
        </div>
      </div>
    </div>
  );
}

// ── FormField ────────────────────────────────────────────────────────────────

function FormField({ label, required, children }: {
  label:     string;
  required?: boolean;
  children:  React.ReactNode;
}) {
  return (
    <div>
      <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)" }}>
        {label}
        {required && <span style={{ color: "var(--color-error)", marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

// ── 스타일 ───────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)", color: "var(--color-text-primary)",
  fontSize: 14, boxSizing: "border-box", outline: "none",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  paddingRight: "32px",
  appearance: "none",
  WebkitAppearance: "none",
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 10px center",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "5px 14px", borderRadius: 6,
  border: "1px solid transparent",
  background: "var(--color-brand)", color: "var(--color-text-inverse)",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "5px 14px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)", color: "var(--color-text-primary)",
  fontSize: 12, cursor: "pointer",
};
