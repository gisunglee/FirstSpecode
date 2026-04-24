"use client";

/**
 * DesignTemplateDetailPage — 설계 양식 상세·편집 (신규/수정 겸용)
 *
 * 역할:
 *   - dsgnTmplId === "new" → 신규 등록 모드 (POST)
 *   - 그 외 → 기존 양식 수정 모드 (PUT)
 *   - example_cn / template_cn 각각 MarkdownEditor (원문/미리보기 탭)
 *   - 시스템 공통(isSystem) 또는 default_yn='Y' 는 읽기 전용
 *   - 우측 카드 "영향받는 프롬프트 템플릿" — 같은 ref_ty_code 기준 카운트 + 상위 10건
 *     (자동 동기화되지 않음 안내 포함)
 */

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import MarkdownEditor, { MarkdownTabButtons } from "@/components/ui/MarkdownEditor";
import { useAppStore } from "@/store/appStore";
import { useIsSystemAdmin, useMyRole } from "@/hooks/useMyRole";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type DesignRefType = "REQUIREMENT" | "UNIT_WORK" | "SCREEN" | "AREA" | "FUNCTION";

type LinkedPromptTemplate = {
  tmplId:     string;
  tmplNm:     string;
  isSystem:   boolean;
  taskTyCode: string;
  defaultYn:  string;
};

type TemplateDetail = {
  dsgnTmplId:  string;
  projectId:   string | null;
  isSystem:    boolean;
  defaultYn:   string;
  refTyCode:   DesignRefType;
  tmplNm:      string;
  tmplDc:      string;
  exampleCn:   string;
  templateCn:  string;
  useYn:       string;
  sortOrdr:    number;
  creatMberId: string | null;
  creatDt:     string;
  mdfcnDt:     string;
  myRole:      string;
  linkedPromptTemplateCount: number;
  linkedPromptTemplates:     LinkedPromptTemplate[];
};

// ── 상수 ──────────────────────────────────────────────────────────────────────

const REF_TYPE_OPTIONS: { value: DesignRefType; label: string }[] = [
  { value: "REQUIREMENT", label: "요구사항" },
  { value: "UNIT_WORK",   label: "단위업무" },
  { value: "SCREEN",      label: "화면" },
  { value: "AREA",        label: "영역" },
  { value: "FUNCTION",    label: "기능" },
];

// ── 페이지 래퍼 ───────────────────────────────────────────────────────────────

export default function DesignTemplateDetailPage() {
  return (
    <Suspense fallback={null}>
      <DesignTemplateDetailPageInner />
    </Suspense>
  );
}

// ── 메인 ──────────────────────────────────────────────────────────────────────

function DesignTemplateDetailPageInner() {
  const params     = useParams();
  const router     = useRouter();
  const qc         = useQueryClient();
  const projectId  = params.id as string;
  const dsgnTmplId = params.dsgnTmplId as string;
  const isNew      = dsgnTmplId === "new";

  const { setBreadcrumb } = useAppStore();

  // 복사 확인 모달 — "이 양식 복사" 버튼 클릭 시 열림
  const [copyConfirm, setCopyConfirm] = useState(false);

  // 탭 상태 — 예시/템플릿 마크다운 에디터별
  const [exampleTab,  setExampleTab]  = useState<"edit" | "preview">("edit");
  const [templateTab, setTemplateTab] = useState<"edit" | "preview">("edit");

  // 폼 상태
  const [tmplNm,     setTmplNm]     = useState("");
  const [refTyCode,  setRefTyCode]  = useState<DesignRefType>("SCREEN");
  const [tmplDc,     setTmplDc]     = useState("");
  const [useYn,      setUseYn]      = useState("Y");
  const [sortOrdr,   setSortOrdr]   = useState(0);
  const [exampleCn,  setExampleCn]  = useState("");
  const [templateCn, setTemplateCn] = useState("");

  // 상세 조회 (수정 모드만)
  const { data: detail, isLoading } = useQuery<TemplateDetail>({
    queryKey: ["design-templates", projectId, dsgnTmplId],
    queryFn: () =>
      authFetch<{ data: TemplateDetail }>(
        `/api/projects/${projectId}/design-templates/${dsgnTmplId}`,
      ).then((r) => r.data),
    enabled: !isNew,
  });

  // detail → 폼 동기화 (queryFn 내부 setState 안티패턴 방지)
  useEffect(() => {
    if (!detail) return;
    setTmplNm(detail.tmplNm);
    setRefTyCode(detail.refTyCode);
    setTmplDc(detail.tmplDc);
    setUseYn(detail.useYn);
    setSortOrdr(detail.sortOrdr);
    setExampleCn(detail.exampleCn);
    setTemplateCn(detail.templateCn);
  }, [detail]);

  useEffect(() => {
    setBreadcrumb([
      { label: "설계 양식", href: `/projects/${projectId}/design-templates` },
      { label: isNew ? "신규 등록" : (detail?.tmplNm ?? "편집") },
    ]);
    return () => setBreadcrumb([]);
  }, [setBreadcrumb, projectId, isNew, detail?.tmplNm]);

  const isDefault = !isNew && (detail?.defaultYn === "Y");
  const isSystem  = !isNew && (detail?.isSystem ?? false);
  // DEFAULT = 시스템 공통(prjct_id=null) 또는 default_yn='Y' 중 하나 (서버의 isDefault 판정과 동일)
  const isDefaultOrSystem = isSystem || isDefault;

  const { isSystemAdmin, isLoading: isSysAdminLoading } = useIsSystemAdmin();
  const { myRole: currentProjectRole, isLoading: isRoleLoading } = useMyRole(projectId);
  const isProjectAdmin = currentProjectRole === "OWNER" || currentProjectRole === "ADMIN";
  const isPermissionLoading = isSysAdminLoading || isRoleLoading;

  // 편집 가능 여부 (프롬프트 관리와 동일 패턴):
  //   - 신규 등록(isNew) → OWNER/ADMIN 또는 SUPER_ADMIN 만 편집 가능
  //   - DEFAULT 행  → SUPER_ADMIN 만 편집 가능
  //   - 프로젝트 복사본 → 프로젝트 OWNER/ADMIN 만 편집 가능
  //   - 그 외(일반 멤버/뷰어) → 읽기 전용
  const readOnly = isNew
    ? !(isProjectAdmin || isSystemAdmin)
    : (isDefaultOrSystem ? !isSystemAdmin : !isProjectAdmin);

  // "이 양식 복사" 버튼 노출 — OWNER/ADMIN 또는 SUPER_ADMIN 만
  const canCopy = isProjectAdmin || isSystemAdmin;

  // 저장
  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        tmplNm,
        refTyCode,
        tmplDc:     tmplDc     || null,
        exampleCn:  exampleCn  || null,
        templateCn: templateCn || null,
        useYn,
        sortOrdr,
      };
      if (isNew) {
        return authFetch(`/api/projects/${projectId}/design-templates`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      return authFetch(`/api/projects/${projectId}/design-templates/${dsgnTmplId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["design-templates", projectId] });
      // 상세 페이지의 resolve 결과도 갱신 필요
      qc.invalidateQueries({ queryKey: ["design-template", projectId] });
      if (isNew) {
        toast.success("양식이 등록되었습니다.");
        const newId = (res as { data?: { dsgnTmplId?: string } })?.data?.dsgnTmplId;
        if (newId) router.replace(`/projects/${projectId}/design-templates/${newId}`);
        else router.push(`/projects/${projectId}/design-templates`);
      } else {
        toast.success("양식이 저장되었습니다.");
        qc.invalidateQueries({ queryKey: ["design-templates", projectId, dsgnTmplId] });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSave() {
    if (!tmplNm.trim()) { toast.error("템플릿 명을 입력하세요."); return; }
    saveMutation.mutate();
  }

  // ── 복사 뮤테이션 ──────────────────────────────────────────────────────────────
  // 현재 양식의 내용을 새 레코드로 복제. 서버가 prjct_id=현재 프로젝트, default_yn='N'
  // 으로 강제하므로 시스템/DEFAULT 양식도 안전하게 프로젝트 전용 사본이 된다.
  // 복사본은 use_yn='Y' (활성) 으로 생성 — 복사 직후 바로 사용할 수 있어야 한다는
  // 운영 방침. 편집이 필요하면 상세 페이지에서 수정한다.
  const copyMutation = useMutation({
    mutationFn: () =>
      authFetch<{ data: { dsgnTmplId: string } }>(
        `/api/projects/${projectId}/design-templates`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tmplNm:     `${tmplNm} (복사본)`,
            refTyCode,
            tmplDc:     tmplDc     || null,
            exampleCn:  exampleCn  || null,
            templateCn: templateCn || null,
            useYn:      "Y",        // 복사본은 바로 사용 가능하도록 활성으로 생성
            sortOrdr,
          }),
        },
      ).then((r) => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["design-templates", projectId] });
      toast.success("복사본이 생성되었습니다.");
      setCopyConfirm(false);
      router.push(`/projects/${projectId}/design-templates/${res.dsgnTmplId}`);
    },
    onError: (err: Error) => { toast.error(err.message); setCopyConfirm(false); },
  });

  if (!isNew && isLoading) {
    return <div style={{ padding: "40px 32px", color: "var(--color-text-tertiary)" }}>로딩 중...</div>;
  }

  // /new URL 직입 시 DEVELOPER 이하는 접근 차단 (서버도 POST 에서 403)
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
            설계 양식 생성은 프로젝트 관리자(OWNER/ADMIN)만 가능합니다.
            필요한 경우 프로젝트 관리자에게 요청하거나 기존 양식을 복사해서 사용하세요.
          </p>
          <button
            onClick={() => router.push(`/projects/${projectId}/design-templates`)}
            style={secondaryBtnStyle}
          >
            목록으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 0, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
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
            onClick={() => router.push(`/projects/${projectId}/design-templates`)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1, padding: "2px 4px" }}
          >
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {isNew ? "설계 양식 등록" : (readOnly ? "설계 양식 보기" : "설계 양식 편집")}
          </span>
        </div>
        {!readOnly && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => router.push(`/projects/${projectId}/design-templates`)}
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

      {/* ── 2단 레이아웃: 좌측 편집 / 우측 사이드 카드 ── */}
      <div style={{
        padding: "0 24px 24px",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 320px",
        gap: 16,
        alignItems: "start",
      }}>
        {/* 좌측: 편집 영역 */}
        <div style={{
          border: "1px solid var(--color-border)", borderRadius: 8,
          padding: "24px 28px", background: "var(--color-bg-card)",
          display: "flex", flexDirection: "column", gap: 20,
        }}>
          {/* 카드 상단: 공통/DEFAULT 배지 + 복사 버튼 / 경고 배너
              프롬프트 템플릿 편집 페이지와 동일한 구조로 통일 (UX 일관성) */}
          {!isNew && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: -8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                {isDefaultOrSystem ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {isSystem && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "3px 9px",
                        borderRadius: 4,
                        background: "var(--color-brand)",
                        color:      "var(--color-text-inverse)",
                        letterSpacing: "0.04em",
                      }}>
                        공통
                      </span>
                    )}
                    {isDefault && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "3px 9px",
                        borderRadius: 4,
                        background: "var(--color-text-primary)",
                        color:      "var(--color-text-inverse)",
                        letterSpacing: "0.06em",
                      }}>
                        DEFAULT
                      </span>
                    )}
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
                    이 양식 복사
                  </button>
                )}
              </div>

              {/* DEFAULT 경고 배너 — 분기 */}
              {isDefaultOrSystem && readOnly && (
                <div style={{
                  padding: "10px 14px", borderRadius: 6,
                  background: "var(--color-warning-subtle)",
                  border:     "1px solid var(--color-warning-border)",
                  fontSize:   13,
                  color:      "var(--color-warning)",
                  lineHeight: 1.6,
                }}>
                  ⚠️ 이 양식은 <strong>{isSystem ? "시스템 공통" : "기본"} 양식</strong>이므로
                  시스템 관리자만 수정할 수 있습니다.
                  프로젝트 전용 양식이 필요하면 <strong>&ldquo;이 양식 복사&rdquo;</strong> 후 편집해 주세요.
                </div>
              )}
              {/* SUPER_ADMIN 의 DEFAULT 편집 시 경고 — prjct_id=null 이면 전체 프로젝트 영향 */}
              {isDefaultOrSystem && !readOnly && (
                <div style={{
                  padding: "10px 14px", borderRadius: 6,
                  background: "var(--color-warning-subtle)",
                  border:     "1px solid var(--color-warning-border)",
                  fontSize:   13,
                  color:      "var(--color-warning)",
                  lineHeight: 1.6,
                }}>
                  ⚠️ <strong>{isSystem ? "시스템 공통" : "기본"} 양식</strong>을 수정하고 있습니다.
                  변경 내용은 {isSystem ? <strong>모든 프로젝트</strong> : "이 프로젝트"} 의 해당 계층
                  설계 예시/템플릿에 즉시 반영됩니다. 신중하게 수정해 주세요.
                  문제가 생기면 <strong>&ldquo;이 양식 복사&rdquo;</strong> 후 원본을 복원하세요.
                </div>
              )}
            </div>
          )}

          {/* 템플릿 명 */}
          <FormField label="템플릿 명" required>
            <input
              value={tmplNm}
              onChange={(e) => setTmplNm(e.target.value)}
              placeholder="양식의 명칭을 입력하세요"
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
              placeholder="양식에 대한 간단한 설명"
              readOnly={readOnly}
              style={inputStyle}
            />
          </FormField>

          {/* 대상 계층 / 정렬 / 사용 여부 */}
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.7fr 0.7fr", gap: 16 }}>
            <FormField label="대상 계층" required>
              <select
                value={refTyCode}
                onChange={(e) => setRefTyCode(e.target.value as DesignRefType)}
                disabled={readOnly}
                style={selectStyle}
              >
                {REF_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </FormField>

            <FormField label="정렬">
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

          {/* 메타 */}
          {!isNew && detail && (
            <div style={{ display: "flex", gap: 24 }}>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                등록일: <strong>{detail.creatDt.slice(0, 10)}</strong>
              </span>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                수정일: <strong>{detail.mdfcnDt.slice(0, 10)}</strong>
              </span>
            </div>
          )}

          {/* 예시 본문 */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)" }}>
                예시 본문
                <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 8 }}>
                  "예시" 버튼 팝업에 표시되는 마크다운
                </span>
              </label>
              {!readOnly && <MarkdownTabButtons tab={exampleTab} onTabChange={setExampleTab} />}
            </div>
            <MarkdownEditor
              value={exampleCn}
              onChange={setExampleCn}
              placeholder="작성 예시 마크다운을 입력하세요."
              readOnly={readOnly}
              tab={readOnly ? "preview" : exampleTab}
              onTabChange={setExampleTab}
              rows={18}
            />
          </div>

          {/* 템플릿 본문 */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)" }}>
                템플릿 본문
                <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 8 }}>
                  "템플릿 삽입" 버튼이 에디터에 넣는 구조. 사용 가능 플레이스홀더:{" "}
                  <code style={{ background: "var(--color-bg-muted)", padding: "1px 5px", borderRadius: 3 }}>
                    {`{{displayId}}`}
                  </code>
                  ,{" "}
                  <code style={{ background: "var(--color-bg-muted)", padding: "1px 5px", borderRadius: 3 }}>
                    {`{{name}}`}
                  </code>
                </span>
              </label>
              {!readOnly && <MarkdownTabButtons tab={templateTab} onTabChange={setTemplateTab} />}
            </div>
            <MarkdownEditor
              value={templateCn}
              onChange={setTemplateCn}
              placeholder="채워 넣을 구조(헤딩·표 등)만 담은 마크다운을 입력하세요."
              readOnly={readOnly}
              tab={readOnly ? "preview" : templateTab}
              onTabChange={setTemplateTab}
              rows={18}
            />
          </div>
        </div>

        {/* 우측 사이드: 연결된 프롬프트 템플릿 카드 */}
        <LinkedPromptsCard
          projectId={projectId}
          isNew={isNew}
          detail={detail}
        />
      </div>

      {/* ── 복사 확인 모달 ── */}
      {copyConfirm && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.45)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 1000,
        }}>
          <div style={{
            width: 380, padding: 24,
            background: "var(--color-bg-card)",
            borderRadius: 8, border: "1px solid var(--color-border)",
            display: "flex", flexDirection: "column", gap: 12,
          }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>
              이 양식을 복사하시겠습니까?
            </p>
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: 0, lineHeight: 1.6 }}>
              현재 양식의 내용을 그대로 복제하여 <strong>프로젝트 전용 사본</strong>을 만듭니다.<br />
              사본은 <strong>바로 사용 가능한 상태</strong>로 생성됩니다. 필요 시 상세 페이지에서 편집하세요.
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

// ── 연결된 프롬프트 템플릿 카드 ───────────────────────────────────────────────

function LinkedPromptsCard({
  projectId, isNew, detail,
}: {
  projectId: string;
  isNew:     boolean;
  detail:    TemplateDetail | undefined;
}) {
  if (isNew) {
    return (
      <div style={sideCardStyle}>
        <div style={sideCardTitleStyle}>영향 범위</div>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.6, margin: 0 }}>
          저장 후에 이 양식과 같은 대상 계층을 쓰는 프롬프트 템플릿 수를 확인할 수 있습니다.
        </p>
      </div>
    );
  }
  if (!detail) return null;

  const count = detail.linkedPromptTemplateCount ?? 0;
  const list  = detail.linkedPromptTemplates ?? [];

  return (
    <div style={sideCardStyle}>
      <div style={sideCardTitleStyle}>
        이 양식을 참조할 수 있는 프롬프트
      </div>

      {count === 0 ? (
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "0 0 8px", lineHeight: 1.6 }}>
          같은 대상 계층의 프롬프트 템플릿이 없습니다.
        </p>
      ) : (
        <>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "0 0 10px", lineHeight: 1.6 }}>
            같은 <strong>{detail.refTyCode}</strong> 계층의 프롬프트 <strong>{count}</strong>건이
            이 양식을 참조할 수 있습니다.
          </p>
          <ul style={{ margin: "0 0 10px", paddingLeft: 16, fontSize: 12, color: "var(--color-text-primary)", lineHeight: 1.8 }}>
            {list.map((p) => (
              <li key={p.tmplId} style={{ display: "list-item" }}>
                {p.isSystem && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                    background: "var(--color-brand)", color: "var(--color-text-inverse)", marginRight: 4,
                  }}>
                    공통
                  </span>
                )}
                {p.defaultYn === "Y" && (
                  // DEFAULT 배지 — text-primary 배경 + text-inverse 글자로 3테마 컨트라스트 유지
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                    background: "var(--color-text-primary)",
                    color:      "var(--color-text-inverse)",
                    marginRight: 4,
                  }}>
                    DEFAULT
                  </span>
                )}
                {p.tmplNm}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* SPA 내비게이션 — full page reload 방지 위해 next/link 사용 */}
      <Link
        href={`/projects/${projectId}/prompt-templates`}
        style={{
          display: "inline-block", marginTop: 4,
          fontSize: 12, color: "var(--color-brand)",
          textDecoration: "none",
        }}
      >
        → 프롬프트 관리로 이동
      </Link>

      <div style={{
        marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--color-border)",
        fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.6,
      }}>
        ※ 양식을 수정해도 프롬프트 본문은 <strong>자동으로 동기화되지 않습니다</strong>.
        필요하면 프롬프트 본문도 직접 수정해 주세요.
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

const sideCardStyle: React.CSSProperties = {
  border: "1px solid var(--color-border)", borderRadius: 8,
  padding: "18px 20px", background: "var(--color-bg-card)",
  position: "sticky", top: 16,
};

const sideCardTitleStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, marginBottom: 10,
  color: "var(--color-text-primary)",
};
