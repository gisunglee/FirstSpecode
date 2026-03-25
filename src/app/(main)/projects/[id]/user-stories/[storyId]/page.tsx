"use client";

/**
 * UserStoryDetailPage — 사용자스토리 상세·편집 (PID-00034)
 *
 * 역할:
 *   - 신규: storyId = "new" → POST (FID-00116 신규)
 *   - 수정: storyId 존재 → GET 로드(FID-00114) → PUT (FID-00116 수정)
 *   - 브레드크럼 맥락 표시 (FID-00113)
 *   - AI 초안 생성 (FID-00115, stub)
 *   - 인수기준 행 추가·삭제 (FID-00117)
 */

import { Suspense, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type AcRow = { given: string; when: string; then: string };

type StoryForm = {
  requirementId: string;
  name:          string;
  persona:       string;
  scenario:      string;
};

type StoryDetail = {
  storyId:             string;
  displayId:           string;
  name:                string;
  persona:             string;
  scenario:            string;
  requirementId:       string;
  requirementName:     string;
  taskId:              string | null;
  taskName:            string;
  acceptanceCriteria:  { acId: string; given: string; when: string; then: string }[];
};

type RequirementOption = {
  requirementId: string;
  name:          string;
  taskId:        string | null;
  taskName:      string;
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function UserStoryDetailPage() {
  return (
    <Suspense fallback={null}>
      <UserStoryDetailPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function UserStoryDetailPageInner() {
  const params      = useParams<{ id: string; storyId: string }>();
  const router      = useRouter();
  const queryClient = useQueryClient();
  const projectId   = params.id;
  const storyId     = params.storyId;
  const isNew       = storyId === "new";

  // ── 폼 상태 ────────────────────────────────────────────────────────────────
  const [form, setForm] = useState<StoryForm>({
    requirementId: "",
    name:          "",
    persona:       "",
    scenario:      "",
  });

  // 인수기준 행 목록 — 신규 시 1행 기본
  const [acRows, setAcRows] = useState<AcRow[]>([
    { given: "", when: "", then: "" },
  ]);

  // 브레드크럼용 컨텍스트 (수정 모드에서 로드)
  const [breadcrumb, setBreadcrumb] = useState<{
    taskName: string;
    requirementName: string;
  } | null>(null);

  const [aiLoading, setAiLoading] = useState(false);

  // ── 요구사항 목록 (선택 드롭다운) ──────────────────────────────────────────
  const { data: reqsData } = useQuery({
    queryKey: ["reqs-for-story", projectId],
    queryFn:  () =>
      authFetch<{ data: { items: RequirementOption[] } }>(
        `/api/projects/${projectId}/requirements`
      ).then((r) =>
        r.data.items.map((i) => ({
          requirementId: i.requirementId,
          name:          i.name,
          taskId:        i.taskId,
          taskName:      i.taskName,
        }))
      ),
  });
  const reqOptions = reqsData ?? [];

  // ── 기존 스토리 로드 (수정 모드) ────────────────────────────────────────────
  const { isLoading: isDetailLoading } = useQuery({
    queryKey: ["user-story", projectId, storyId],
    queryFn:  () =>
      authFetch<{ data: StoryDetail }>(
        `/api/projects/${projectId}/user-stories/${storyId}`
      ).then((r) => {
        const d = r.data;
        setForm({
          requirementId: d.requirementId,
          name:          d.name,
          persona:       d.persona,
          scenario:      d.scenario,
        });
        setAcRows(
          d.acceptanceCriteria.length > 0
            ? d.acceptanceCriteria.map((ac) => ({ given: ac.given, when: ac.when, then: ac.then }))
            : [{ given: "", when: "", then: "" }]
        );
        setBreadcrumb({ taskName: d.taskName, requirementName: d.requirementName });
        return d;
      }),
    enabled: !isNew,
  });

  // ── 저장 뮤테이션 ──────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        requirementId:       form.requirementId,
        name:                form.name,
        persona:             form.persona,
        scenario:            form.scenario,
        acceptanceCriteria:  acRows.filter((r) => r.given || r.when || r.then),
      };
      return isNew
        ? authFetch(`/api/projects/${projectId}/user-stories`, {
            method: "POST",
            body:   JSON.stringify(body),
          })
        : authFetch(`/api/projects/${projectId}/user-stories/${storyId}`, {
            method: "PUT",
            body:   JSON.stringify(body),
          });
    },
    onSuccess: () => {
      toast.success(isNew ? "사용자스토리가 등록되었습니다." : "저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["user-stories", projectId] });
      router.push(`/projects/${projectId}/user-stories`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 유효성 검사 ────────────────────────────────────────────────────────────
  function handleSave() {
    if (!form.requirementId) { toast.error("요구사항을 선택해 주세요."); return; }
    if (!form.name.trim())    { toast.error("스토리명을 입력해 주세요."); return; }
    if (!form.persona.trim()) { toast.error("페르소나를 입력해 주세요."); return; }
    if (!form.scenario.trim()) { toast.error("시나리오를 입력해 주세요."); return; }
    saveMutation.mutate();
  }

  // ── AI 초안 생성 ───────────────────────────────────────────────────────────
  async function handleAiDraft() {
    if (!form.requirementId) {
      toast.error("먼저 요구사항을 선택해 주세요.");
      return;
    }
    setAiLoading(true);
    try {
      const res = await authFetch<{
        data: {
          name: string; persona: string; scenario: string;
          acceptanceCriteria: { given: string; when: string; then: string }[];
        };
      }>(
        `/api/projects/${projectId}/user-stories/ai-draft`,
        { method: "POST", body: JSON.stringify({ requirementId: form.requirementId }) }
      );
      const d = res.data;
      setForm((prev) => ({ ...prev, name: d.name, persona: d.persona, scenario: d.scenario }));
      setAcRows(d.acceptanceCriteria.length > 0 ? d.acceptanceCriteria : [{ given: "", when: "", then: "" }]);
      toast.success("AI 초안이 생성되었습니다.");
    } catch {
      toast.error("초안 생성 중 오류가 발생했습니다.");
    } finally {
      setAiLoading(false);
    }
  }

  // ── 인수기준 행 조작 ───────────────────────────────────────────────────────
  function addAcRow() {
    setAcRows((prev) => [...prev, { given: "", when: "", then: "" }]);
  }

  function removeAcRow(idx: number) {
    setAcRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateAcRow(idx: number, field: keyof AcRow, value: string) {
    setAcRows((prev) => prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
  }

  // ── 현재 선택된 요구사항의 과업명 표시 ────────────────────────────────────
  const selectedReq = reqOptions.find((r) => r.requirementId === form.requirementId);

  if (!isNew && isDetailLoading) {
    return (
      <div style={{ padding: "40px 32px", color: "#888" }}>
        스토리 정보를 불러오는 중...
      </div>
    );
  }

  return (
    <div style={{ padding: "32px", maxWidth: 760 }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <button
          onClick={() => router.push(`/projects/${projectId}/user-stories`)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#666" }}
        >
          ←
        </button>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--color-text-primary)" }}>
          {isNew ? "사용자스토리 추가" : "사용자스토리 편집"}
        </h1>
      </div>

      {/* AR-00050 브레드크럼 */}
      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 28, paddingLeft: 4 }}>
        기획 레이어
        <span style={{ margin: "0 4px" }}>›</span>
        {breadcrumb?.taskName ?? selectedReq?.taskName ?? "과업"}
        <span style={{ margin: "0 4px" }}>›</span>
        {breadcrumb?.requirementName ?? selectedReq?.name ?? "요구사항"}
        <span style={{ margin: "0 4px" }}>›</span>
        사용자스토리
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* AI 초안 생성 버튼 */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={handleAiDraft}
            disabled={aiLoading}
            style={{ ...secondaryBtnStyle, fontSize: 13, opacity: aiLoading ? 0.5 : 1 }}
          >
            {aiLoading ? "⏳ AI 생성 중..." : "✨ AI 초안 생성"}
          </button>
        </div>

        {/* 요구사항 선택 */}
        <FormField label="요구사항" required>
          <select
            value={form.requirementId}
            onChange={(e) => setForm((p) => ({ ...p, requirementId: e.target.value }))}
            style={inputStyle}
          >
            <option value="">요구사항을 선택하세요</option>
            {reqOptions.map((r) => (
              <option key={r.requirementId} value={r.requirementId}>
                [{r.taskName}] {r.name}
              </option>
            ))}
          </select>
        </FormField>

        {/* 스토리명 */}
        <FormField label="스토리명" required>
          <input
            type="text"
            value={form.name}
            placeholder="예: 회원으로서 로그인 후 대시보드를 볼 수 있다"
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            style={inputStyle}
          />
        </FormField>

        {/* 페르소나 */}
        <FormField label="페르소나" required>
          <input
            type="text"
            value={form.persona}
            placeholder="예: 서비스에 가입한 일반 사용자로서"
            onChange={(e) => setForm((p) => ({ ...p, persona: e.target.value }))}
            style={inputStyle}
          />
        </FormField>

        {/* 시나리오 */}
        <FormField label="시나리오" required>
          <textarea
            value={form.scenario}
            placeholder="예: 나는 이메일과 비밀번호로 로그인하여 프로젝트 목록을 확인하고 싶다."
            rows={4}
            onChange={(e) => setForm((p) => ({ ...p, scenario: e.target.value }))}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </FormField>

        {/* 인수기준 (Given/When/Then) */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
              인수기준
            </label>
            <button onClick={addAcRow} style={{ ...secondaryBtnStyle, fontSize: 12, padding: "4px 12px" }}>
              + 인수기준 추가
            </button>
          </div>

          {acRows.length === 0 ? (
            <p style={{ fontSize: 13, color: "#aaa", margin: 0 }}>인수기준이 없습니다.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {acRows.map((row, idx) => (
                <div
                  key={idx}
                  style={{
                    border:       "1px solid var(--color-border)",
                    borderRadius: 6,
                    padding:      "12px 14px",
                    background:   "var(--color-bg-muted)",
                    position:     "relative",
                  }}
                >
                  {/* 삭제 버튼 */}
                  <button
                    onClick={() => removeAcRow(idx)}
                    style={{
                      position:   "absolute",
                      top:        8,
                      right:      10,
                      background: "none",
                      border:     "none",
                      cursor:     "pointer",
                      fontSize:   16,
                      color:      "#aaa",
                      lineHeight: 1,
                    }}
                    title="이 인수기준 삭제"
                  >
                    ×
                  </button>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(["given", "when", "then"] as const).map((field) => (
                      <div key={field} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            width:      52,
                            fontSize:   12,
                            fontWeight: 700,
                            color:      FIELD_COLORS[field],
                            flexShrink: 0,
                          }}
                        >
                          {FIELD_LABELS[field]}
                        </span>
                        <input
                          type="text"
                          value={row[field]}
                          placeholder={FIELD_PLACEHOLDERS[field]}
                          onChange={(e) => updateAcRow(idx, field, e.target.value)}
                          style={{ ...inputStyle, fontSize: 13 }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 버튼 */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/user-stories`)}
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
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 공통 컴포넌트 ─────────────────────────────────────────────────────────────

function FormField({ label, required, children }: {
  label:     string;
  required?: boolean;
  children:  React.ReactNode;
}) {
  return (
    <div>
      <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
        {label}
        {required && <span style={{ color: "#e53935", marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

// ── 인수기준 필드 레이블/색상/플레이스홀더 ──────────────────────────────────

const FIELD_LABELS: Record<string, string>       = { given: "Given:", when: "When:", then: "Then:" };
const FIELD_COLORS: Record<string, string>       = { given: "#1565c0", when: "#2e7d32", then: "#6a1b9a" };
const FIELD_PLACEHOLDERS: Record<string, string> = {
  given: "주어진 조건 (예: 사용자가 로그인된 상태에서)",
  when:  "사용자 행동 (예: 저장 버튼을 클릭하면)",
  then:  "기대 결과 (예: 데이터가 정상 저장된다.)",
};

// ── 스타일 ───────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width:        "100%",
  padding:      "8px 12px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     14,
  boxSizing:    "border-box",
  outline:      "none",
};

const primaryBtnStyle: React.CSSProperties = {
  padding:      "8px 24px",
  borderRadius: 6,
  border:       "none",
  background:   "var(--color-primary, #1976d2)",
  color:        "#fff",
  fontSize:     14,
  fontWeight:   600,
  cursor:       "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding:      "8px 16px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     14,
  cursor:       "pointer",
};
