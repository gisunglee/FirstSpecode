"use client";

/**
 * ProjectConfigsPage — 프로젝트 환경설정 (/projects/[id]/configs)
 *
 * 역할:
 *   - 프로젝트별 key-value 설정 관리
 *   - 테이블 형태로 그룹·키·설정명·설명·유형·값 표시
 *   - 설정 항목 추가(팝업)/삭제, 값 일괄 저장, 기본값 초기화
 */

import { Suspense, useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type ConfigItem = {
  configId:      string;
  key:           string;
  value:         string;
  label:         string;
  description:   string | null;
  valueType:     string;
  defaultValue:  string;
  selectOptions: string[] | null;
  sortOrder:     number;
};

type ConfigGroup = {
  group: string;
  items: ConfigItem[];
};

// ── 상수 ──────────────────────────────────────────────────────────────────────

const GROUP_LABELS: Record<string, string> = {
  GENERAL: "일반",
  AI:      "AI 설정",
  MAIL:    "메일",
  PROMPT:  "프롬프트",
  DESIGN:  "설계",
  IMPL:    "구현",
};

const VALUE_TYPE_LABELS: Record<string, string> = {
  BOOLEAN: "ON/OFF",
  TEXT:    "텍스트",
  NUMBER:  "숫자",
  SELECT:  "선택",
};

const VALUE_TYPE_OPTIONS = [
  { value: "BOOLEAN", label: "ON/OFF" },
  { value: "TEXT",    label: "텍스트" },
  { value: "NUMBER",  label: "숫자" },
  { value: "SELECT",  label: "선택" },
];

// ── 페이지 ────────────────────────────────────────────────────────────────────

export default function ProjectConfigsPage() {
  return (
    <Suspense fallback={null}>
      <ConfigsInner />
    </Suspense>
  );
}

function ConfigsInner() {
  const { id: projectId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  // 편집 중인 값 (configId → value)
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  // 신규 항목 추가 폼
  const [addFormOpen, setAddFormOpen] = useState(false);
  // 항목 수정 팝업 (행 클릭 시)
  const [editItem, setEditItem] = useState<(ConfigItem & { group: string }) | null>(null);
  // 삭제 확인 다이얼로그
  const [deleteTarget, setDeleteTarget] = useState<{ configId: string; label: string; key: string } | null>(null);

  // ── 데이터 조회 ──
  const { data, isLoading } = useQuery({
    queryKey: ["configs", projectId],
    queryFn: () =>
      authFetch<{ data: { groups: ConfigGroup[] } }>(
        `/api/projects/${projectId}/configs`
      ).then((r) => r.data),
  });

  // 조회 데이터로 editValues 초기화
  useEffect(() => {
    if (data?.groups) {
      const vals: Record<string, string> = {};
      for (const g of data.groups) {
        for (const item of g.items) {
          vals[item.configId] = item.value;
        }
      }
      setEditValues(vals);
    }
  }, [data]);

  // 전체 아이템 flat 리스트
  const allItems: (ConfigItem & { group: string })[] = [];
  for (const g of data?.groups ?? []) {
    for (const item of g.items) {
      allItems.push({ ...item, group: g.group });
    }
  }

  // ── 일괄 저장 뮤테이션 ──
  const saveMutation = useMutation({
    mutationFn: (items: { configId: string; value: string }[]) =>
      authFetch(`/api/projects/${projectId}/configs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      }),
    onSuccess: () => {
      toast.success("저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["configs", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 항목 삭제 뮤테이션 ──
  const deleteMutation = useMutation({
    mutationFn: (configId: string) =>
      authFetch(`/api/projects/${projectId}/configs/${configId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["configs", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 초기화 (모든 값을 default_value로) ──
  function handleReset() {
    if (!data?.groups) return;
    if (!window.confirm("모든 설정을 기본값으로 초기화하시겠습니까?")) return;

    const items: { configId: string; value: string }[] = [];
    for (const g of data.groups) {
      for (const item of g.items) {
        items.push({ configId: item.configId, value: item.defaultValue });
      }
    }
    saveMutation.mutate(items);
  }

  // ── 저장 (변경된 값만) ──
  function handleSave() {
    if (!data?.groups) return;
    const items: { configId: string; value: string }[] = [];
    for (const g of data.groups) {
      for (const item of g.items) {
        const newVal = editValues[item.configId];
        if (newVal !== undefined && newVal !== item.value) {
          items.push({ configId: item.configId, value: newVal });
        }
      }
    }
    if (items.length === 0) { toast.info("변경된 항목이 없습니다."); return; }
    saveMutation.mutate(items);
  }

  function handleDelete(configId: string, label: string, key: string) {
    setDeleteTarget({ configId, label, key });
  }

  function updateValue(configId: string, value: string) {
    setEditValues((prev) => ({ ...prev, [configId]: value }));
  }

  if (isLoading) return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;

  return (
    <div style={{ padding: 0 }}>
      {/* ── 헤더 바 ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 24px",
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)", flex: 1 }}>
          환경설정
        </div>
        <button onClick={() => setAddFormOpen(true)} style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 14px" }}>
          + 설정 추가
        </button>
        <button onClick={handleReset} disabled={saveMutation.isPending} style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 14px" }}>
          초기화
        </button>
        <button onClick={handleSave} disabled={saveMutation.isPending} style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px" }}>
          {saveMutation.isPending ? "저장 중..." : "저장"}
        </button>
      </div>

      {/* ── 건수 ── */}
      <div style={{ padding: "0 24px", marginBottom: 12, fontSize: 14, color: "var(--color-text-secondary)" }}>
        총 {allItems.length}건
      </div>

      {/* ── 테이블 ── */}
      {allItems.length === 0 ? (
        <div style={{ padding: "60px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
          등록된 설정이 없습니다. "설정 추가" 버튼으로 항목을 추가해 주세요.
        </div>
      ) : (
        <div style={{ padding: "0 24px 48px" }}>
          <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
            {/* 헤더 행 */}
            <div style={gridHeaderStyle}>
              <div>설정 그룹</div>
              <div>설정명</div>
              <div>설정 구분 키</div>
              <div>설명</div>
              <div>유형</div>
              <div>설정 값</div>
              <div style={{ textAlign: "center" }}>기본값</div>
              <div />
            </div>

            {/* 데이터 행 */}
            {allItems.map((item, idx) => {
              const val = editValues[item.configId] ?? item.value;
              const isModified = val !== item.value;
              // 같은 그룹이면 첫 행에만 그룹명 표시
              const showGroup = idx === 0 || allItems[idx - 1].group !== item.group;

              return (
                <div
                  key={item.configId}
                  style={{
                    ...gridRowStyle,
                    borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                    background: isModified ? "rgba(25,118,210,0.04)" : "var(--color-bg-card)",
                  }}
                >
                  {/* 그룹 */}
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-primary, #1976d2)" }}>
                    {showGroup ? item.group : ""}
                  </div>

                  {/* 설정명 — 클릭 시 수정 팝업 */}
                  <div
                    onClick={() => setEditItem(item)}
                    title="클릭하여 수정"
                    style={{ fontSize: 13, color: "var(--color-text-primary)", cursor: "pointer", textDecoration: "underline", textDecorationColor: "transparent", transition: "text-decoration-color 0.15s" }}
                    onMouseEnter={(e) => (e.currentTarget.style.textDecorationColor = "var(--color-primary, #1976d2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.textDecorationColor = "transparent")}
                  >
                    {item.label}
                  </div>

                  {/* 설정 구분 키 */}
                  <div>
                    <span style={{
                      display: "inline-block", padding: "2px 8px", borderRadius: 4,
                      background: "#f0f0f0", fontSize: 11, fontWeight: 600,
                      fontFamily: "monospace", color: "#555", letterSpacing: "0.02em",
                    }}>
                      {item.key}
                    </span>
                  </div>

                  {/* 설명 */}
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.description ?? ""}>
                    {item.description || <span style={{ color: "#ccc" }}>—</span>}
                  </div>

                  {/* 유형 */}
                  <div>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                      background: "#f5f5f5", color: "#666",
                    }}>
                      {VALUE_TYPE_LABELS[item.valueType] ?? item.valueType}
                    </span>
                  </div>

                  {/* 값 — 타입별 렌더링 */}
                  <div>
                    {item.valueType === "BOOLEAN" ? (
                      <button
                        onClick={() => updateValue(item.configId, val === "Y" ? "N" : "Y")}
                        style={{
                          padding: "3px 14px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                          border: "1px solid", cursor: "pointer",
                          ...(val === "Y"
                            ? { background: "#e8f5e9", color: "#2e7d32", borderColor: "#a5d6a7" }
                            : { background: "var(--color-bg-muted)", color: "var(--color-text-secondary)", borderColor: "var(--color-border)" }),
                        }}
                      >
                        {val === "Y" ? "ON" : "OFF"}
                      </button>
                    ) : item.valueType === "SELECT" && item.selectOptions?.length ? (
                      <select
                        value={val}
                        onChange={(e) => updateValue(item.configId, e.target.value)}
                        style={valueSelectStyle}
                      >
                        {item.selectOptions.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : item.valueType === "NUMBER" ? (
                      <input type="number" value={val} onChange={(e) => updateValue(item.configId, e.target.value)} style={{ ...valueInputStyle, width: 80 }} />
                    ) : (
                      <input type="text" value={val} onChange={(e) => updateValue(item.configId, e.target.value)} style={{ ...valueInputStyle, width: "100%" }} />
                    )}
                  </div>

                  {/* 기본값 */}
                  <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {item.defaultValue || "—"}
                  </div>

                  {/* 수정·삭제 */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
                    <button
                      onClick={() => setEditItem(item)}
                      title="수정"
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--color-text-secondary)", padding: "2px 6px" }}
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleDelete(item.configId, item.label, item.key)}
                      title="삭제"
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#ccc", padding: "2px 6px" }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 신규 항목 추가 팝업 ── */}
      {addFormOpen && (
        <AddConfigModal
          projectId={projectId}
          onClose={() => setAddFormOpen(false)}
          onAdded={() => {
            setAddFormOpen(false);
            queryClient.invalidateQueries({ queryKey: ["configs", projectId] });
          }}
        />
      )}

      {/* ── 항목 수정 팝업 ── */}
      {editItem && (
        <EditConfigModal
          projectId={projectId}
          item={editItem}
          onClose={() => setEditItem(null)}
          onSaved={() => {
            setEditItem(null);
            queryClient.invalidateQueries({ queryKey: ["configs", projectId] });
          }}
        />
      )}

      {/* ── 삭제 확인 다이얼로그 ── */}
      {deleteTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}>
          <div style={{ width: "min(420px, 85vw)", background: "var(--color-bg-card)", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.2)", padding: "24px 28px" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 16 }}>
              설정 항목을 삭제하시겠습니까?
            </div>
            <div style={{ padding: "12px 16px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 8, fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: "var(--color-text-secondary)", minWidth: 90 }}>설정명</span>
                <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{deleteTarget.label}</span>
              </div>
              <div style={{ display: "flex", gap: 8, fontSize: 13 }}>
                <span style={{ color: "var(--color-text-secondary)", minWidth: 90 }}>설정 구분 키</span>
                <code style={{ fontWeight: 600, fontFamily: "monospace", color: "#555" }}>{deleteTarget.key}</code>
              </div>
            </div>
            <div style={{
              padding: "10px 14px", borderRadius: 8, marginBottom: 20,
              background: "#fce4ec", border: "1px solid #ef9a9a",
              fontSize: 12, lineHeight: 1.7, color: "#b71c1c",
            }}>
              삭제하면 복구할 수 없습니다. 이 설정을 프로그램 코드에서 사용 중이라면 오류가 발생할 수 있으니 확인 후 삭제하세요.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setDeleteTarget(null)} style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 16px" }}>취소</button>
              <button
                onClick={() => { deleteMutation.mutate(deleteTarget.configId); setDeleteTarget(null); }}
                disabled={deleteMutation.isPending}
                style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 16px", background: "#e53935" }}
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 설정 추가 모달 ────────────────────────────────────────────────────────────

function AddConfigModal({ projectId, onClose, onAdded }: {
  projectId: string;
  onClose:   () => void;
  onAdded:   () => void;
}) {
  const [group, setGroup]             = useState("GENERAL");
  const [key, setKey]                 = useState("");
  const [label, setLabel]             = useState("");
  const [description, setDescription] = useState("");
  const [valueType, setValueType]     = useState("TEXT");
  const [defaultValue, setDefaultValue] = useState("");
  const [selectOptions, setSelectOptions] = useState("");
  const [helpOpen, setHelpOpen]       = useState(false);
  // 추가 확인 다이얼로그
  const [confirmOpen, setConfirmOpen] = useState(false);

  const addMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      authFetch(`/api/projects/${projectId}/configs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("설정 항목이 추가되었습니다.");
      onAdded();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // 유효성 검사 후 확인 다이얼로그 표시
  function handleSubmit() {
    if (!key.trim()) { toast.error("설정 구분 키를 입력해 주세요."); return; }
    if (!label.trim()) { toast.error("설정명을 입력해 주세요."); return; }
    setConfirmOpen(true);
  }

  // 확인 후 실제 등록
  function doAdd() {
    const selectOpts = valueType === "SELECT" && selectOptions.trim()
      ? selectOptions.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    addMutation.mutate({
      group:         group || "GENERAL",
      key,
      label,
      description:   description || undefined,
      valueType,
      defaultValue,
      selectOptions: selectOpts,
    });
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(520px, 90vw)", background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden" }}
      >
        {/* 헤더 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 24px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>설정 항목 추가</span>
            <button
              onClick={() => setHelpOpen(!helpOpen)}
              title="입력 도움말"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 20, height: 20, borderRadius: "50%",
                border: "1px solid var(--color-border)", background: helpOpen ? "var(--color-primary, #1976d2)" : "var(--color-bg-card)",
                color: helpOpen ? "#fff" : "var(--color-text-secondary)",
                fontSize: 11, fontWeight: 700, cursor: "pointer",
              }}
            >
              ?
            </button>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 16, cursor: "pointer", color: "var(--color-text-secondary)", padding: "2px 6px" }}>✕</button>
        </div>

        {/* 도움말 팝업 (별도 오버레이) */}
        {helpOpen && (
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}
            onClick={() => setHelpOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "min(600px, 90vw)", background: "var(--color-bg-card)",
                borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.2)", overflow: "hidden",
              }}
            >
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "14px 20px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)",
              }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>입력 안내</span>
                <button
                  onClick={() => setHelpOpen(false)}
                  style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--color-text-secondary)", padding: "0 4px", lineHeight: 1 }}
                >×</button>
              </div>
              <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14, fontSize: 13, lineHeight: 1.8, color: "var(--color-text-primary)" }}>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>설정 그룹</div>
                  <div style={{ color: "var(--color-text-secondary)" }}>설정을 묶어주는 분류명입니다. 시스템 동작에는 영향 없이 목록 정리용으로만 사용됩니다. 예: <code>AI</code>, <code>MAIL</code>, <code>GENERAL</code></div>
                </div>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>설정 구분 키</div>
                  <div style={{ color: "var(--color-text-secondary)" }}>코드에서 이 설정을 찾는 고유 식별자입니다. 한번 정하면 바꾸기 어려우니 신중하게 지어주세요. 영문 대문자 + 언더스코어(_)만 사용합니다. 예: <code>USE_AI_API</code></div>
                </div>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>설정명</div>
                  <div style={{ color: "var(--color-text-secondary)" }}>화면에 표시되는 알기 쉬운 이름입니다. 예: &quot;AI API 사용 여부&quot;</div>
                </div>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>설명</div>
                  <div style={{ color: "var(--color-text-secondary)" }}>이 설정의 역할을 메모해두면 나중에 보기 편합니다. (선택)</div>
                </div>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>값 유형</div>
                  <div style={{ color: "var(--color-text-secondary)" }}>
                    <code>ON/OFF</code> Y/N 토글 · <code>텍스트</code> 자유 입력 · <code>숫자</code> 숫자만 · <code>선택</code> 후보 중 택 1
                  </div>
                </div>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>기본값</div>
                  <div style={{ color: "var(--color-text-secondary)" }}>처음 만들 때 들어갈 초기 값입니다. ON/OFF면 <code>Y</code> 또는 <code>N</code>을 입력하세요.</div>
                </div>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>선택지 후보</div>
                  <div style={{ color: "var(--color-text-secondary)" }}>값 유형이 &quot;선택&quot;일 때만 필요합니다. 쉼표로 나열하세요. 예: <code>claude, gpt-4o, gemini</code></div>
                </div>
                <div style={{ marginTop: 4, padding: "12px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>이 환경설정은 언제 사용하나요?</div>
                  <div style={{ color: "var(--color-text-secondary)" }}>
                    여기서 등록한 설정 값은 프로젝트 내 다양한 기능에서 공통으로 참조됩니다.
                    예를 들어 AI 기능 사용 여부, 메일 발송 설정, 프롬프트 관련 옵션 등을
                    코드 수정 없이 화면에서 바로 켜고 끄거나 값을 바꿀 수 있습니다.
                    운영 중 설정을 자주 조정해야 하는 항목을 이곳에 등록해 두면 편리합니다.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 폼 */}
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={formLabelStyle}>설정 그룹</label>
              <input value={group} onChange={(e) => setGroup(e.target.value.toUpperCase())} placeholder="GENERAL" style={formInputStyle} />
            </div>
            <div>
              <label style={formLabelStyle}>설정 구분 키</label>
              <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="USE_AI_API" style={formInputStyle} />
            </div>
          </div>

          <div>
            <label style={formLabelStyle}>설정명</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="AI API 사용 여부" style={formInputStyle} />
          </div>

          <div>
            <label style={formLabelStyle}>설명 (선택)</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="이 설정에 대한 설명" style={formInputStyle} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={formLabelStyle}>값 유형</label>
              <select value={valueType} onChange={(e) => setValueType(e.target.value)} style={formInputStyle}>
                {VALUE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label style={formLabelStyle}>기본값</label>
              <input value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} placeholder={valueType === "BOOLEAN" ? "Y 또는 N" : ""} style={formInputStyle} />
            </div>
          </div>

          {valueType === "SELECT" && (
            <div>
              <label style={formLabelStyle}>선택지 후보 (쉼표 구분)</label>
              <input value={selectOptions} onChange={(e) => setSelectOptions(e.target.value)} placeholder="claude, gpt-4o, gemini" style={formInputStyle} />
            </div>
          )}
        </div>

        {/* 경고 안내 */}
        <div style={{
          margin: "0 24px 14px", padding: "10px 14px", borderRadius: 8,
          background: "#fff8e1", border: "1px solid #ffe082",
          fontSize: 12, lineHeight: 1.7, color: "#795548",
        }}>
          <span style={{ fontWeight: 700, color: "#e65100" }}>주의</span>
          &nbsp;— 설정 그룹, 구분 키, 설정명 등 항목 구조를 변경해도 이미 프로그램 코드에서 사용 중인 설정이 자동으로 바뀌지는 않습니다.
          코드에서 참조하는 키를 변경하면 프로그램도 함께 수정해야 합니다.
          단, <b>설정 값</b>은 저장 즉시 반영되므로 값을 바꿀 때는 영향 범위를 확인한 뒤 변경하세요.
        </div>

        {/* 하단 버튼 */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 24px 20px" }}>
          <button onClick={onClose} style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 16px" }}>취소</button>
          <button onClick={handleSubmit} disabled={addMutation.isPending} style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 16px" }}>
            {addMutation.isPending ? "추가 중..." : "추가"}
          </button>
        </div>
      </div>

      {/* 추가 확인 다이얼로그 */}
      {confirmOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200 }}
          onClick={() => setConfirmOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(400px, 85vw)", background: "var(--color-bg-card)", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.2)", padding: "24px 28px" }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 16 }}>
              이 항목을 등록하시겠습니까?
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 16px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", marginBottom: 20 }}>
              <div style={{ display: "flex", gap: 8, fontSize: 13 }}>
                <span style={{ color: "var(--color-text-secondary)", minWidth: 90, flexShrink: 0 }}>설정 그룹</span>
                <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{group || "GENERAL"}</span>
              </div>
              <div style={{ display: "flex", gap: 8, fontSize: 13 }}>
                <span style={{ color: "var(--color-text-secondary)", minWidth: 90, flexShrink: 0 }}>설정 구분 키</span>
                <code style={{ fontWeight: 600, color: "var(--color-primary, #1976d2)", fontFamily: "monospace" }}>{key}</code>
              </div>
              <div style={{ display: "flex", gap: 8, fontSize: 13 }}>
                <span style={{ color: "var(--color-text-secondary)", minWidth: 90, flexShrink: 0 }}>설정명</span>
                <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{label}</span>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setConfirmOpen(false)} style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 16px" }}>취소</button>
              <button
                onClick={() => { setConfirmOpen(false); doAdd(); }}
                disabled={addMutation.isPending}
                style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 16px" }}
              >
                등록
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 설정 수정 모달 ────────────────────────────────────────────────────────────

function EditConfigModal({ projectId, item, onClose, onSaved }: {
  projectId: string;
  item:      ConfigItem & { group: string };
  onClose:   () => void;
  onSaved:   () => void;
}) {
  const [group, setGroup]             = useState(item.group);
  const [key, setKey]                 = useState(item.key);
  const [label, setLabel]             = useState(item.label);
  const [description, setDescription] = useState(item.description ?? "");
  const [valueType, setValueType]     = useState(item.valueType);
  const [defaultValue, setDefaultValue] = useState(item.defaultValue);
  const [selectOptions, setSelectOptions] = useState(item.selectOptions?.join(", ") ?? "");

  const editMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      authFetch(`/api/projects/${projectId}/configs/${item.configId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("설정이 수정되었습니다.");
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSave() {
    if (!key.trim()) { toast.error("설정 구분 키를 입력해 주세요."); return; }
    if (!label.trim()) { toast.error("설정명을 입력해 주세요."); return; }

    const selectOpts = valueType === "SELECT" && selectOptions.trim()
      ? selectOptions.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    editMutation.mutate({
      group:         group || "GENERAL",
      key,
      label,
      description:   description || undefined,
      valueType,
      defaultValue,
      selectOptions: selectOpts,
    });
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
    >
      <div
        style={{ width: "min(520px, 90vw)", background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden" }}
      >
        {/* 헤더 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 24px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)",
        }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>설정 항목 수정</span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 16, cursor: "pointer", color: "var(--color-text-secondary)", padding: "2px 6px" }}>✕</button>
        </div>

        {/* 폼 */}
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={formLabelStyle}>설정 그룹</label>
              <input value={group} onChange={(e) => setGroup(e.target.value.toUpperCase())} style={formInputStyle} />
            </div>
            <div>
              <label style={formLabelStyle}>설정 구분 키</label>
              <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} style={formInputStyle} />
            </div>
          </div>

          <div>
            <label style={formLabelStyle}>설정명</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} style={formInputStyle} />
          </div>

          <div>
            <label style={formLabelStyle}>설명 (선택)</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} style={formInputStyle} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={formLabelStyle}>값 유형</label>
              <select value={valueType} onChange={(e) => setValueType(e.target.value)} style={formInputStyle}>
                {VALUE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label style={formLabelStyle}>기본값</label>
              <input value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} placeholder={valueType === "BOOLEAN" ? "Y 또는 N" : ""} style={formInputStyle} />
            </div>
          </div>

          {valueType === "SELECT" && (
            <div>
              <label style={formLabelStyle}>선택지 후보 (쉼표 구분)</label>
              <input value={selectOptions} onChange={(e) => setSelectOptions(e.target.value)} placeholder="claude, gpt-4o, gemini" style={formInputStyle} />
            </div>
          )}
        </div>

        {/* 경고 안내 */}
        <div style={{
          margin: "0 24px 14px", padding: "10px 14px", borderRadius: 8,
          background: "#fff8e1", border: "1px solid #ffe082",
          fontSize: 12, lineHeight: 1.7, color: "#795548",
        }}>
          <span style={{ fontWeight: 700, color: "#e65100" }}>주의</span>
          &nbsp;— 설정 구분 키를 변경하면 이 키를 사용하는 프로그램 코드도 함께 수정해야 합니다.
        </div>

        {/* 하단 버튼 */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 24px 20px" }}>
          <button onClick={onClose} style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 16px" }}>취소</button>
          <button onClick={handleSave} disabled={editMutation.isPending} style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 16px" }}>
            {editMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

// 설정 그룹 | 설정명 | 설정 구분 키 | 설명 | 유형 | 설정 값 | 기본값 | 삭제
const GRID_TEMPLATE = "140px 1fr 180px 1fr 85px 200px 110px 60px";

const gridHeaderStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: GRID_TEMPLATE, gap: 8,
  padding: "10px 16px", background: "var(--color-bg-muted)",
  fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border)", alignItems: "center",
};

const gridRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: GRID_TEMPLATE, gap: 8,
  padding: "10px 16px", alignItems: "center",
  transition: "background 0.1s",
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

const formLabelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 600,
  color: "var(--color-text-secondary)", marginBottom: 4,
};

const formInputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: 6,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-primary)", fontSize: 13, outline: "none", boxSizing: "border-box",
};

const valueInputStyle: React.CSSProperties = {
  padding: "4px 8px", borderRadius: 5,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-primary)", fontSize: 12, outline: "none", boxSizing: "border-box",
};

const valueSelectStyle: React.CSSProperties = {
  padding: "4px 8px", borderRadius: 5, width: "100%",
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-primary)", fontSize: 12, cursor: "pointer", outline: "none",
};
