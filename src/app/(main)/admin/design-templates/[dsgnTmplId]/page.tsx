"use client";

/**
 * AdminDesignTemplateDetailPage — DEFAULT 설계 양식 상세·편집 (신규/수정 겸용)
 *
 * 역할:
 *   - dsgnTmplId === "new" → 신규 등록 모드 (POST /api/admin/design-templates)
 *   - 그 외 → 기존 DEFAULT 양식 수정 (PUT /api/admin/.../[id])
 *   - 일반 페이지(/projects/.../design-templates/[id]) 와 동일한 폼·에디터 구조.
 *
 * 권한:
 *   - AdminLayout 이 isSystemAdmin 으로 전체 영역을 가드 — 추가 가드 불필요.
 *   - 항상 편집 가능. "복사" / "보기 전용" 분기 없음 (admin 영역의 정체성).
 *   - 삭제 진입점 없음 (정책상 차단).
 *
 * 주의:
 *   - DEFAULT 양식은 모든 프로젝트에 영향 → 저장 전 명시적 경고 배너 노출.
 */

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import MarkdownEditor, { MarkdownTabButtons } from "@/components/ui/MarkdownEditor";

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
  linkedPromptTemplateCount: number;
  linkedPromptTemplates:     LinkedPromptTemplate[];
};

const REF_TYPE_OPTIONS: { value: DesignRefType; label: string }[] = [
  { value: "REQUIREMENT", label: "요구사항" },
  { value: "UNIT_WORK",   label: "단위업무" },
  { value: "SCREEN",      label: "화면" },
  { value: "AREA",        label: "영역" },
  { value: "FUNCTION",    label: "기능" },
];

// ── 페이지 래퍼 ───────────────────────────────────────────────────────────────

export default function AdminDesignTemplateDetailPage() {
  return (
    <Suspense fallback={null}>
      <AdminDesignTemplateDetailPageInner />
    </Suspense>
  );
}

function AdminDesignTemplateDetailPageInner() {
  const params     = useParams();
  const router     = useRouter();
  const qc         = useQueryClient();
  const dsgnTmplId = params.dsgnTmplId as string;
  const isNew      = dsgnTmplId === "new";

  // 탭 상태
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
    queryKey: ["admin-design-template", dsgnTmplId],
    queryFn: () =>
      authFetch<{ data: TemplateDetail }>(
        `/api/admin/design-templates/${dsgnTmplId}`,
      ).then((r) => r.data),
    enabled: !isNew,
  });

  // detail → 폼 동기화
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
        return authFetch("/api/admin/design-templates", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      return authFetch(`/api/admin/design-templates/${dsgnTmplId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["admin-design-templates"] });
      if (isNew) {
        toast.success("DEFAULT 양식이 등록되었습니다.");
        const newId = (res as { data?: { dsgnTmplId?: string } })?.data?.dsgnTmplId;
        if (newId) router.replace(`/admin/design-templates/${newId}`);
        else router.push("/admin/design-templates");
      } else {
        toast.success("DEFAULT 양식이 저장되었습니다.");
        qc.invalidateQueries({ queryKey: ["admin-design-template", dsgnTmplId] });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSave() {
    if (!tmplNm.trim()) { toast.error("템플릿 명을 입력하세요."); return; }
    saveMutation.mutate();
  }

  if (!isNew && isLoading) {
    return <div style={{ padding: "40px 32px", color: "var(--color-text-tertiary)" }}>로딩 중...</div>;
  }

  return (
    <div>
      {/* ── 서브 헤더 ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => router.push("/admin/design-templates")}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1, padding: "2px 4px" }}
          >
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {isNew ? "DEFAULT 양식 등록" : "DEFAULT 양식 편집"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => router.push("/admin/design-templates")}
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

      {/* ── 2단 레이아웃 ── */}
      <div style={{
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
          {/* DEFAULT 영향 범위 경고 — 모든 프로젝트에 영향 */}
          <div style={{
            padding: "10px 14px", borderRadius: 6,
            background: "var(--color-warning-subtle)",
            border:     "1px solid var(--color-warning-border)",
            fontSize:   13,
            color:      "var(--color-warning)",
            lineHeight: 1.6,
          }}>
            ⚠️ <strong>DEFAULT 양식</strong>입니다. 변경 내용은 <strong>모든 프로젝트</strong>의
            해당 계층 설계 예시/템플릿에 즉시 반영됩니다. 신중하게 수정해 주세요.
          </div>

          {/* 템플릿 명 */}
          <FormField label="템플릿 명" required>
            <input
              value={tmplNm}
              onChange={(e) => setTmplNm(e.target.value)}
              placeholder="양식의 명칭을 입력하세요"
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
              style={inputStyle}
            />
          </FormField>

          {/* 대상 계층 / 정렬 / 사용 여부 */}
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.7fr 0.7fr", gap: 16 }}>
            <FormField label="대상 계층" required>
              <select
                value={refTyCode}
                onChange={(e) => setRefTyCode(e.target.value as DesignRefType)}
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
                  &quot;예시&quot; 버튼 팝업에 표시되는 마크다운
                </span>
              </label>
              <MarkdownTabButtons tab={exampleTab} onTabChange={setExampleTab} />
            </div>
            <MarkdownEditor
              value={exampleCn}
              onChange={setExampleCn}
              placeholder="작성 예시 마크다운을 입력하세요."
              tab={exampleTab}
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
                  &quot;템플릿 삽입&quot; 버튼이 에디터에 넣는 구조. 사용 가능 플레이스홀더:{" "}
                  <code style={{ background: "var(--color-bg-muted)", padding: "1px 5px", borderRadius: 3 }}>
                    {`{{displayId}}`}
                  </code>
                  ,{" "}
                  <code style={{ background: "var(--color-bg-muted)", padding: "1px 5px", borderRadius: 3 }}>
                    {`{{name}}`}
                  </code>
                </span>
              </label>
              <MarkdownTabButtons tab={templateTab} onTabChange={setTemplateTab} />
            </div>
            <MarkdownEditor
              value={templateCn}
              onChange={setTemplateCn}
              placeholder="채워 넣을 구조(헤딩·표 등)만 담은 마크다운을 입력하세요."
              tab={templateTab}
              onTabChange={setTemplateTab}
              rows={18}
            />
          </div>
        </div>

        {/* 우측 사이드: 연결된 프롬프트 템플릿 카드 */}
        <LinkedPromptsCard isNew={isNew} detail={detail} />
      </div>
    </div>
  );
}

// ── 연결된 프롬프트 템플릿 카드 ───────────────────────────────────────────────
//
// 일반 페이지의 LinkedPromptsCard 와 동일한 정보를 admin 컨텍스트에 맞춰 변형:
//   - "이동" 링크가 admin 프롬프트 관리로 향함
//   - 영향 범위 안내 문구가 "이 프로젝트" → "모든 프로젝트" 로 변경

function LinkedPromptsCard({
  isNew, detail,
}: {
  isNew:  boolean;
  detail: TemplateDetail | undefined;
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
            이 양식을 참조할 수 있습니다 (시스템 + 모든 프로젝트 합산).
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

      <Link
        href="/admin/prompt-templates"
        style={{
          display: "inline-block", marginTop: 4,
          fontSize: 12, color: "var(--color-brand)",
          textDecoration: "none",
        }}
      >
        → DEFAULT 프롬프트 관리로 이동
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

// ── 스타일 (모두 토큰 사용) ───────────────────────────────────────────────────

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
