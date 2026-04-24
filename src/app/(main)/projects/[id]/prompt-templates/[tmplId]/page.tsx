"use client";

/**
 * PromptTemplateDetailPage — AI 프롬프트 템플릿 상세·편집 (신규/수정 겸용)
 *
 * 역할:
 *   - tmplId === "new" → 신규 등록 모드 (POST)
 *   - 그 외 → 기존 템플릿 수정 모드 (PUT)
 *   - sys_prompt_cn: MarkdownEditor + 파란 탭 (원문/미리보기)
 *   - 시스템 공통 템플릿(isSystem=true)은 읽기 전용
 *
 * 주요 기술:
 *   - TanStack Query: 상세 조회 및 뮤테이션
 *   - MarkdownEditor + MarkdownTabButtons
 */

import { Suspense, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import MarkdownEditor, { MarkdownTabButtons } from "@/components/ui/MarkdownEditor";
import { useAppStore } from "@/store/appStore";
import { type PromptTemplateTaskType, type PromptTemplateRefType } from "@/constants/codes";
import { useIsSystemAdmin, useMyRole } from "@/hooks/useMyRole";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type TaskType = PromptTemplateTaskType;
type RefType  = PromptTemplateRefType;

type TemplateDetail = {
  tmplId: string;
  projectId: string | null;
  isSystem: boolean;
  defaultYn: string;
  tmplNm: string;
  taskTyCode: TaskType;
  refTyCode: RefType | null;
  sysPromptCn: string;
  tmplDc: string;
  useYn: string;
  sortOrdr: number;
  useCnt: number;
  creatDt: string;
  mdfcnDt: string;
  myRole: string;
};

// ── 상수 ──────────────────────────────────────────────────────────────────────

const TASK_TYPE_OPTIONS: { value: TaskType; label: string }[] = [
  { value: "DESIGN", label: "설계" },
  { value: "INSPECT", label: "명세 검토" },
  { value: "IMPACT", label: "영향도 분석" },
  { value: "IMPLEMENT", label: "구현" },
  { value: "TEST", label: "테스트" },
];

// 더 이상 사용하지 않는 유형 (기존 데이터 표시용)
const DEPRECATED_TASK_TYPES: Partial<Record<TaskType, string>> = {
  MOCKUP: "목업",
  CUSTOM: "자유 요청",
};

// ── 페이지 래퍼 ───────────────────────────────────────────────────────────────

export default function PromptTemplateDetailPage() {
  return (
    <Suspense fallback={null}>
      <PromptTemplateDetailPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function PromptTemplateDetailPageInner() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const projectId = params.id as string;
  const tmplId = params.tmplId as string;
  const isNew = tmplId === "new";

  const { setBreadcrumb } = useAppStore();

  // ── 탭 상태 ──────────────────────────────────────────────────────────────────
  const [sysTab, setSysTab] = useState<"edit" | "preview">("edit");
  const [copyConfirm, setCopyConfirm] = useState(false);

  // ── 폼 상태 ──────────────────────────────────────────────────────────────────
  const [tmplNm, setTmplNm] = useState("");
  const [taskTyCode, setTaskTyCode] = useState<TaskType>("INSPECT");
  const [refTyCode, setRefTyCode] = useState<RefType | "">("");
  const [tmplDc, setTmplDc] = useState("");
  const [useYn, setUseYn] = useState("Y");
  const [sortOrdr, setSortOrdr] = useState(0);
  const [sysPromptCn, setSysPromptCn] = useState("");

  // ── 상세 조회 (수정 모드만) ───────────────────────────────────────────────────
  const { data: detail, isLoading } = useQuery<TemplateDetail>({
    queryKey: ["prompt-templates", projectId, tmplId],
    queryFn: () => authFetch<{ data: TemplateDetail }>(
      `/api/projects/${projectId}/prompt-templates/${tmplId}`
    ).then((r) => r.data),
    enabled: !isNew,
  });

  useEffect(() => {
    if (detail) {
      setTmplNm(detail.tmplNm);
      setTaskTyCode(detail.taskTyCode);
      setRefTyCode(detail.refTyCode ?? "");
      setTmplDc(detail.tmplDc);
      setUseYn(detail.useYn);
      setSortOrdr(detail.sortOrdr);
      setSysPromptCn(detail.sysPromptCn);
    }
  }, [detail]);

  useEffect(() => {
    setBreadcrumb([
      { label: "프롬프트 관리", href: `/projects/${projectId}/prompt-templates` },
      { label: isNew ? "신규 등록" : (detail?.tmplNm ?? "편집") },
    ]);
    return () => setBreadcrumb([]);
  }, [setBreadcrumb, projectId, isNew, detail?.tmplNm]);

  // DEFAULT = 시스템 공통(prjct_id=null) 또는 default_yn='Y' 중 하나라도 해당
  // (서버의 isDefault 판정과 동일 — 이중 가드 일관성)
  const isDefault = !isNew && (
    (detail?.defaultYn === "Y") || (detail?.isSystem ?? false)
  );

  const { isSystemAdmin, isLoading: isSysAdminLoading } = useIsSystemAdmin();
  // 신규 등록 모드(detail 없음)에서도 권한 판정이 필요하므로
  // detail?.myRole 대신 별도 훅으로 역할 조회 (기존 상세 모드에선 동일 캐시 사용)
  const { myRole: currentProjectRole, isLoading: isRoleLoading } = useMyRole(projectId);
  const isProjectAdmin = currentProjectRole === "OWNER" || currentProjectRole === "ADMIN";
  const isPermissionLoading = isSysAdminLoading || isRoleLoading;

  // 편집 가능 여부:
  //   - 신규 등록(isNew) → OWNER/ADMIN 또는 SUPER_ADMIN 만 편집 가능 (권한 없으면 읽기 전용)
  //   - DEFAULT 행  → SUPER_ADMIN 만 편집 가능
  //   - 프로젝트 복사본 → 프로젝트 OWNER/ADMIN 만 편집 가능
  //   - 그 외(일반 멤버/뷰어) → 읽기 전용
  const readOnly = isNew
    ? !(isProjectAdmin || isSystemAdmin)
    : (isDefault ? !isSystemAdmin : !isProjectAdmin);

  // "이 템플릿 복사" 버튼 노출 — OWNER/ADMIN 또는 SUPER_ADMIN 만
  //   (POST 도 동일 역할만 허용하므로 서버와 UI 일치)
  const canCopy = isProjectAdmin || isSystemAdmin;

  // ── 저장 뮤테이션 ──────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        tmplNm,
        taskTyCode,
        refTyCode: refTyCode || null,
        sysPromptCn: sysPromptCn || null,
        tmplDc: tmplDc || null,
        useYn,
        sortOrdr,
      };
      if (isNew) {
        return authFetch(`/api/projects/${projectId}/prompt-templates`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      return authFetch(`/api/projects/${projectId}/prompt-templates/${tmplId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["prompt-templates", projectId] });
      if (isNew) {
        toast.success("템플릿이 등록되었습니다.");
        // 신규 등록 후에는 생성된 상세 페이지로 이동
        const newId = (res as { data?: { tmplId?: string } })?.data?.tmplId;
        if (newId) router.replace(`/projects/${projectId}/prompt-templates/${newId}`);
        else router.push(`/projects/${projectId}/prompt-templates`);
      } else {
        toast.success("템플릿이 저장되었습니다.");
        qc.invalidateQueries({ queryKey: ["prompt-templates", projectId, tmplId] });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSave() {
    if (!tmplNm.trim()) { toast.error("템플릿 명을 입력하세요."); return; }
    if (taskTyCode in DEPRECATED_TASK_TYPES) {
      toast.error(`"${DEPRECATED_TASK_TYPES[taskTyCode]}"은(는) 사용 중단된 유형입니다. 작업 유형을 변경해 주세요.`);
      return;
    }
    saveMutation.mutate();
  }

  // ── 복사 뮤테이션 ──────────────────────────────────────────────────────────────
  const copyMutation = useMutation({
    mutationFn: () =>
      authFetch<{ data: { tmplId: string } }>(`/api/projects/${projectId}/prompt-templates`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmplNm: `${tmplNm} (복사본)`,
          taskTyCode,
          refTyCode: refTyCode || null,
          sysPromptCn: sysPromptCn || null,
          tmplDc: tmplDc || null,
          useYn: "N",   // 복사본은 항상 미사용으로 생성
          sortOrdr,
        }),
      }).then((r) => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["prompt-templates", projectId] });
      toast.success("복사본이 생성되었습니다. (사용 여부: 미사용)");
      setCopyConfirm(false);
      router.push(`/projects/${projectId}/prompt-templates/${res.tmplId}`);
    },
    onError: (err: Error) => { toast.error(err.message); setCopyConfirm(false); },
  });

  // ── 로딩 ──────────────────────────────────────────────────────────────────────
  if (!isNew && isLoading) {
    return <div style={{ padding: "40px 32px", color: "var(--color-text-tertiary)" }}>로딩 중...</div>;
  }

  // ── 권한 가드 — /new URL 직입 시 DEVELOPER 이하는 접근 차단 ───────────────
  //  리스트의 "신규 등록" 버튼은 OWNER/ADMIN 이상에게만 노출되지만
  //  URL 을 직접 타이핑해 도달하는 경우에 대비. 서버도 POST 에서 403 으로 차단함.
  //  권한 훅이 아직 로딩 중이면 판정 보류(플리커 방지).
  if (isNew && !isPermissionLoading && !isProjectAdmin && !isSystemAdmin) {
    return (
      <div style={{ padding: "40px 32px" }}>
        <div style={{
          maxWidth: 520,
          padding: "24px 28px",
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          background: "var(--color-bg-card)",
        }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>
            권한이 없습니다
          </h2>
          <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
            프롬프트 템플릿 생성은 프로젝트 관리자(OWNER/ADMIN)만 가능합니다.
            필요한 경우 프로젝트 관리자에게 요청하거나 기존 템플릿을 복사해서 사용하세요.
          </p>
          <button
            onClick={() => router.push(`/projects/${projectId}/prompt-templates`)}
            style={secondaryBtnStyle}
          >
            목록으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 0, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>

      {/* ── 헤더 ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 24px",
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/prompt-templates`)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1, padding: "2px 4px" }}
          >
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {isNew ? "프롬프트 템플릿 등록" : (readOnly ? "프롬프트 템플릿 보기" : "프롬프트 템플릿 편집")}
          </span>
        </div>
        {!readOnly && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => router.push(`/projects/${projectId}/prompt-templates`)}
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
        )}
      </div>

      {/* ── 폼 본문 ── */}
      <div style={{ flex: 1, minHeight: 0, padding: "0 24px 24px", maxWidth: 860, display: "flex", flexDirection: "column" }}>
        <div style={{
          border: "1px solid var(--color-border)", borderRadius: 8,
          padding: "24px 28px", background: "var(--color-bg-card)",
          display: "flex", flexDirection: "column", gap: 20,
          flex: 1, minHeight: 0, overflow: "hidden",
        }}>

          {/* 카드 상단: DEFAULT 배지 + 경고 / 복사 버튼 */}
          {!isNew && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: -8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                {isDefault ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* DEFAULT 배지 — text-primary 배경 + text-inverse 글자로 3테마 컨트라스트 유지 */}
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "3px 9px",
                      borderRadius: 4,
                      background: "var(--color-text-primary)",
                      color:      "var(--color-text-inverse)",
                      letterSpacing: "0.06em",
                    }}>
                      DEFAULT
                    </span>
                    {readOnly ? (
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-error)" }}>
                        시스템 관리자만 수정 가능
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-warning)" }}>
                        시스템 관리자 편집 모드
                      </span>
                    )}
                  </div>
                ) : <div />}
                {/* 복사 버튼 — OWNER/ADMIN 또는 SUPER_ADMIN 만 */}
                {canCopy && (
                  <button
                    onClick={() => setCopyConfirm(true)}
                    disabled={copyMutation.isPending}
                    style={secondaryBtnStyle}
                  >
                    이 템플릿 복사
                  </button>
                )}
              </div>

              {/* SUPER_ADMIN 의 DEFAULT 편집 시 경고 배너 — prjct_id=null 이므로 전체 프로젝트 영향 */}
              {isDefault && !readOnly && (
                <div style={{
                  padding: "10px 14px", borderRadius: 6,
                  background: "var(--color-warning-subtle)",
                  border:     "1px solid var(--color-warning-border)",
                  fontSize:   13,
                  color:      "var(--color-warning)",
                  lineHeight: 1.6,
                }}>
                  ⚠️ <strong>시스템 공통 템플릿</strong>을 수정하고 있습니다.
                  변경 내용은 <strong>모든 프로젝트의 AI 요청</strong>에 즉시 적용됩니다.
                  신중하게 수정해 주세요. 문제가 생기면 <strong>이 템플릿 복사</strong> 후 원본을 복원하세요.
                </div>
              )}
            </div>
          )}

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
              ⚠️ 이 템플릿의 작업 유형 <strong>"{DEPRECATED_TASK_TYPES[taskTyCode]}"</strong>은(는) 더 이상 사용하지 않는 유형입니다.
              저장 전에 <strong>설계 / 명세 검토 / 영향도 분석 / 구현 / 테스트</strong> 중 하나로 변경해 주세요.
            </div>
          )}

          {/* 템플릿 명 */}
          <FormField label="템플릿 명" required>
            <input
              value={tmplNm}
              onChange={(e) => setTmplNm(e.target.value)}
              placeholder="템플릿 명을 입력하세요"
              readOnly={readOnly}
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
              readOnly={readOnly}
              style={inputStyle}
            />
          </FormField>

          {/* 작업 유형 / 대상 사용처 / 정렬 순서 / 사용 여부 — 비율 조정: 사용처 넓게, 정렬·여부 좁게 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr 0.7fr 0.7fr", gap: 16 }}>
            <FormField label="작업 유형" required>
              <select
                value={taskTyCode}
                onChange={(e) => setTaskTyCode(e.target.value as TaskType)}
                disabled={readOnly}
                style={selectStyle}
              >
                {TASK_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
                {/* 기존 데이터에 폐기 유형이 있을 경우 선택지 유지 */}
                {taskTyCode in DEPRECATED_TASK_TYPES && (
                  <option value={taskTyCode} disabled style={{ color: "var(--color-warning)" }}>
                    ⚠ {DEPRECATED_TASK_TYPES[taskTyCode]} (미사용)
                  </option>
                )}
              </select>
            </FormField>

            <FormField label="대상 사용처">
              <select
                value={refTyCode}
                onChange={(e) => setRefTyCode(e.target.value as RefType | "")}
                disabled={readOnly}
                style={selectStyle}
              >
                <option value="">범용</option>
                <option value="UNIT_WORK">단위업무 (UNIT_WORK)</option>
                <option value="SCREEN">화면 (SCREEN)</option>
                <option value="AREA">영역 설계 (AREA)</option>
                <option value="FUNCTION">기능 설계 (FUNCTION)</option>
              </select>
            </FormField>

            <FormField label="정렬 순서">
              <input
                type="number"
                value={sortOrdr}
                onChange={(e) => setSortOrdr(Number(e.target.value))}
                readOnly={readOnly}
                min={0}
                style={inputStyle}
              />
            </FormField>

            <FormField label="사용 여부">
              <select
                value={useYn}
                onChange={(e) => setUseYn(e.target.value)}
                disabled={readOnly}
                style={selectStyle}
              >
                <option value="Y">사용</option>
                <option value="N">미사용</option>
              </select>
            </FormField>
          </div>

          {/* 수정 모드에서 메타 정보 표시 */}
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

          {/* 시스템 프롬프트 — 남은 공간 전부 차지 */}
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexShrink: 0 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)" }}>
                시스템 프롬프트
                <span style={{ fontSize: 11, fontWeight: 400, color: "var(--color-text-secondary)", marginLeft: 8 }}>
                  AI의 역할·맥락 지시
                </span>
              </label>
              {!readOnly && (
                <MarkdownTabButtons tab={sysTab} onTabChange={setSysTab} />
              )}
            </div>
            <MarkdownEditor
              value={sysPromptCn}
              onChange={setSysPromptCn}
              placeholder="시스템 프롬프트를 입력하세요. AI의 역할, 맥락, 규칙 등을 기술합니다."
              readOnly={readOnly}
              tab={readOnly ? "preview" : sysTab}
              onTabChange={setSysTab}
              fullHeight
            />
          </div>

        </div>
      </div>

      {/* ── 복사 확인 다이얼로그 ── */}
      {copyConfirm && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
        }}>
          <div style={{
            width: 400, padding: "28px 28px 20px",
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
            display: "flex", flexDirection: "column", gap: 12,
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
              템플릿 복사
            </div>
            <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-primary)", lineHeight: 1.6 }}>
              <strong>"{tmplNm}"</strong> 템플릿을 복사하시겠습니까?
            </p>
            <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              복사본은 <strong style={{ color: "var(--color-warning)" }}>사용 여부 N(미사용)</strong> 상태로 생성됩니다.<br />
              복사 후 편집 화면으로 이동합니다.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
              <button
                onClick={() => setCopyConfirm(false)}
                disabled={copyMutation.isPending}
                style={secondaryBtnStyle}
              >
                취소
              </button>
              <button
                onClick={() => copyMutation.mutate()}
                disabled={copyMutation.isPending}
                style={primaryBtnStyle}
              >
                {copyMutation.isPending ? "복사 중..." : "복사"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── FormField ────────────────────────────────────────────────────────────────

function FormField({ label, required, children }: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
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

// ── 스타일 상수 ───────────────────────────────────────────────────────────────

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
