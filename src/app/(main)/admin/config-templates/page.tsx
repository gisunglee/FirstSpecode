"use client";

/**
 * AdminConfigTemplatesPage — 시스템 환경설정 템플릿 관리 (/admin/config-templates)
 *
 * 역할:
 *   - tb_sys_config_template 목록을 그룹별로 표시
 *   - "+ 템플릿 추가", 행 클릭 수정, 삭제
 *   - SUPER_ADMIN 전용 (AdminLayout 이 이미 가드)
 *
 * 프로젝트별 환경설정 페이지(/projects/[id]/configs)와 동일한 모양으로
 * 일관성 유지. 차이점:
 *   - 실제 값(config_value) 필드 없음 — 템플릿은 "기본값 정의서"일 뿐
 *   - 기본값 일괄 초기화 같은 버튼 없음
 *   - 상단 경고: "여기 변경은 기존 프로젝트에 자동 반영되지 않음"
 */

import { Suspense, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type TemplateItem = {
  configId:      string;   // 실제로는 sys_tmpl_id
  key:           string;
  label:         string;
  description:   string | null;
  valueType:     string;
  defaultValue:  string;
  selectOptions: string[] | null;
  sortOrder:     number;
  useYn:         string;
};

type TemplateGroup = {
  group: string;
  items: TemplateItem[];
};

// ── 상수 ──────────────────────────────────────────────────────────────────────

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

export default function AdminConfigTemplatesPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const qc = useQueryClient();

  const [addOpen,     setAddOpen]     = useState(false);
  const [editItem,    setEditItem]    = useState<(TemplateItem & { group: string }) | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string; key: string } | null>(null);

  // ── 목록 조회 ─────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "config-templates"],
    queryFn:  () =>
      authFetch<{ data: { groups: TemplateGroup[] } }>(
        `/api/admin/config-templates`,
      ).then((r) => r.data),
  });

  const allItems: (TemplateItem & { group: string })[] = [];
  for (const g of data?.groups ?? []) {
    for (const item of g.items) allItems.push({ ...item, group: g.group });
  }

  // ── 삭제 뮤테이션 ─────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      authFetch(`/api/admin/config-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      qc.invalidateQueries({ queryKey: ["admin", "config-templates"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return <div style={{ padding: "40px 0", color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }}>로딩 중...</div>;
  }

  return (
    <div>
      {/* ── 상단 경고 안내 ─────────────────────────────────────────────────── */}
      <div style={{
        padding: "10px 14px", borderRadius: 8, marginBottom: 16,
        background: "var(--color-warning-subtle)", border: "1px solid var(--color-warning-border)",
        fontSize: "var(--text-sm)", color: "var(--color-text-primary)", lineHeight: 1.7,
      }}>
        <strong style={{ color: "var(--color-warning)" }}>안내</strong> — 이 템플릿은 <b>프로젝트 생성 시점</b>에 복사되어 사용됩니다.
        여기서 기본값을 변경해도 <b>이미 생성된 프로젝트에는 자동 반영되지 않습니다</b>.
        전체 프로젝트에 일괄 적용이 필요하면 별도 백필 SQL 실행이 필요합니다.
      </div>

      {/* ── 헤더 ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, marginBottom: 12,
      }}>
        <div style={{ fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-text-heading)", flex: 1 }}>
          환경설정 템플릿
        </div>
        <button onClick={() => setAddOpen(true)} style={primaryBtnStyle}>
          + 템플릿 추가
        </button>
      </div>

      <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginBottom: 12 }}>
        총 {allItems.length}건
      </div>

      {/* ── 테이블 ───────────────────────────────────────────────────────── */}
      {allItems.length === 0 ? (
        <div style={{ padding: "60px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }}>
          등록된 템플릿이 없습니다. "템플릿 추가" 버튼으로 항목을 추가해 주세요.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={gridHeaderStyle}>
            <div>설정 그룹</div>
            <div>설정명</div>
            <div>설정 구분 키</div>
            <div>설명</div>
            <div>유형</div>
            <div>기본값</div>
            <div style={{ textAlign: "center" }}>활성</div>
            <div />
          </div>

          {allItems.map((item, idx) => {
            const showGroup = idx === 0 || allItems[idx - 1].group !== item.group;
            const inactive  = item.useYn === "N";
            return (
              <div
                key={item.configId}
                style={{
                  ...gridRowStyle,
                  borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                  background: inactive ? "var(--color-bg-muted)" : "var(--color-bg-card)",
                  opacity:    inactive ? 0.7 : 1,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-brand)" }}>
                  {showGroup ? item.group : ""}
                </div>

                <div
                  onClick={() => setEditItem(item)}
                  title="클릭하여 수정"
                  style={{ fontSize: 13, color: "var(--color-text-primary)", cursor: "pointer" }}
                >
                  {item.label}
                </div>

                <div>
                  <span style={{
                    display: "inline-block", padding: "2px 8px", borderRadius: 4,
                    background: "var(--color-bg-muted)", fontSize: 11, fontWeight: 600,
                    fontFamily: "monospace", color: "var(--color-text-secondary)", letterSpacing: "0.02em",
                  }}>
                    {item.key}
                  </span>
                </div>

                <div
                  style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={item.description ?? ""}
                >
                  {item.description || <span style={{ color: "var(--color-text-tertiary)" }}>—</span>}
                </div>

                <div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                    background: "var(--color-bg-muted)", color: "var(--color-text-secondary)",
                  }}>
                    {VALUE_TYPE_LABELS[item.valueType] ?? item.valueType}
                  </span>
                </div>

                {/* 기본값 */}
                <div style={{ fontSize: 12, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.defaultValue}>
                  {item.valueType === "BOOLEAN" ? (
                    <span style={{
                      display: "inline-block", padding: "2px 10px", borderRadius: 10, fontSize: 11, fontWeight: 700,
                      ...(item.defaultValue === "Y"
                        ? { background: "var(--color-success-subtle)", color: "var(--color-success)" }
                        : { background: "var(--color-bg-muted)", color: "var(--color-text-tertiary)" }),
                    }}>
                      {item.defaultValue === "Y" ? "ON" : "OFF"}
                    </span>
                  ) : (
                    item.defaultValue || <span style={{ color: "var(--color-text-tertiary)" }}>—</span>
                  )}
                </div>

                {/* 활성 여부 */}
                <div style={{ textAlign: "center" }}>
                  <span style={{
                    display: "inline-block", padding: "2px 8px", borderRadius: 4,
                    fontSize: 11, fontWeight: 600,
                    ...(inactive
                      ? { background: "transparent", color: "var(--color-text-tertiary)", border: "1px dashed var(--color-border)" }
                      : { background: "var(--color-success-subtle)", color: "var(--color-success)" }),
                  }}>
                    {inactive ? "비활성" : "활성"}
                  </span>
                </div>

                {/* 액션 */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
                  <button
                    onClick={() => setEditItem(item)}
                    title="수정"
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--color-text-secondary)", padding: "2px 6px" }}
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => setDeleteTarget({ id: item.configId, label: item.label, key: item.key })}
                    title="삭제"
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--color-text-tertiary)", padding: "2px 6px" }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 추가 모달 ────────────────────────────────────────────────────── */}
      {addOpen && (
        <AddTemplateModal
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            setAddOpen(false);
            qc.invalidateQueries({ queryKey: ["admin", "config-templates"] });
          }}
        />
      )}

      {/* ── 수정 모달 ────────────────────────────────────────────────────── */}
      {editItem && (
        <EditTemplateModal
          item={editItem}
          onClose={() => setEditItem(null)}
          onSaved={() => {
            setEditItem(null);
            qc.invalidateQueries({ queryKey: ["admin", "config-templates"] });
          }}
        />
      )}

      {/* ── 삭제 확인 ───────────────────────────────────────────────────── */}
      {deleteTarget && (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalBoxStyle, width: "min(440px, 85vw)", padding: "24px 28px" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 16 }}>
              템플릿 항목을 삭제하시겠습니까?
            </div>
            <div style={{ padding: "12px 16px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 8, fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: "var(--color-text-secondary)", minWidth: 90 }}>설정명</span>
                <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{deleteTarget.label}</span>
              </div>
              <div style={{ display: "flex", gap: 8, fontSize: 13 }}>
                <span style={{ color: "var(--color-text-secondary)", minWidth: 90 }}>설정 구분 키</span>
                <code style={{ fontWeight: 600, fontFamily: "monospace", color: "var(--color-text-primary)" }}>{deleteTarget.key}</code>
              </div>
            </div>
            <div style={{
              padding: "10px 14px", borderRadius: 8, marginBottom: 20,
              background: "var(--color-error-subtle)", border: "1px solid var(--color-error-border, var(--color-error))",
              fontSize: 12, lineHeight: 1.7, color: "var(--color-error)",
            }}>
              템플릿을 삭제해도 <b>이미 생성된 프로젝트의 설정 데이터는 그대로 유지됩니다</b>. 이후 신규 프로젝트에는 복사되지 않습니다.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setDeleteTarget(null)} style={secondaryBtnStyle}>취소</button>
              <button
                onClick={() => { deleteMutation.mutate(deleteTarget.id); setDeleteTarget(null); }}
                disabled={deleteMutation.isPending}
                style={dangerBtnStyle}
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

// ── 추가 모달 ────────────────────────────────────────────────────────────────

function AddTemplateModal({ onClose, onAdded }: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [group, setGroup]               = useState("GENERAL");
  const [key, setKey]                   = useState("");
  const [label, setLabel]               = useState("");
  const [description, setDescription]   = useState("");
  const [valueType, setValueType]       = useState("TEXT");
  const [defaultValue, setDefaultValue] = useState("");
  const [selectOptions, setSelectOptions] = useState("");

  const addMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      authFetch(`/api/admin/config-templates`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("템플릿이 추가되었습니다.");
      onAdded();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSubmit() {
    if (!key.trim())   { toast.error("설정 구분 키를 입력해 주세요."); return; }
    if (!label.trim()) { toast.error("설정명을 입력해 주세요.");       return; }

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
    <div style={modalOverlayStyle}>
      <div style={modalBoxStyle}>
        <div style={modalHeaderStyle}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>템플릿 항목 추가</span>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>

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

        <div style={{
          margin: "0 24px 14px", padding: "10px 14px", borderRadius: 8,
          background: "var(--color-warning-subtle)", border: "1px solid var(--color-warning-border)",
          fontSize: 12, lineHeight: 1.7, color: "var(--color-text-secondary)",
        }}>
          <span style={{ fontWeight: 700, color: "var(--color-warning)" }}>주의</span>
          &nbsp;— 새 템플릿은 <b>추가 시점 이후 생성되는 프로젝트에만</b> 자동 복사됩니다. 기존 프로젝트에 반영하려면 백필 SQL 을 돌려야 합니다.
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 24px 20px" }}>
          <button onClick={onClose} style={secondaryBtnStyle}>취소</button>
          <button onClick={handleSubmit} disabled={addMutation.isPending} style={primaryBtnStyle}>
            {addMutation.isPending ? "추가 중..." : "추가"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 수정 모달 ────────────────────────────────────────────────────────────────

function EditTemplateModal({ item, onClose, onSaved }: {
  item:    TemplateItem & { group: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [group, setGroup]               = useState(item.group);
  const [key, setKey]                   = useState(item.key);
  const [label, setLabel]               = useState(item.label);
  const [description, setDescription]   = useState(item.description ?? "");
  const [valueType, setValueType]       = useState(item.valueType);
  const [defaultValue, setDefaultValue] = useState(item.defaultValue);
  const [selectOptions, setSelectOptions] = useState(item.selectOptions?.join(", ") ?? "");
  const [useYn, setUseYn]               = useState(item.useYn);

  const editMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      authFetch(`/api/admin/config-templates/${item.configId}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("템플릿이 수정되었습니다.");
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSave() {
    if (!key.trim())   { toast.error("설정 구분 키를 입력해 주세요."); return; }
    if (!label.trim()) { toast.error("설정명을 입력해 주세요.");       return; }

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
      useYn,
    });
  }

  return (
    <div style={modalOverlayStyle}>
      <div style={modalBoxStyle}>
        <div style={modalHeaderStyle}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>템플릿 항목 수정</span>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>

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

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
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
            <div>
              <label style={formLabelStyle}>활성 여부</label>
              <select value={useYn} onChange={(e) => setUseYn(e.target.value)} style={formInputStyle}>
                <option value="Y">활성</option>
                <option value="N">비활성</option>
              </select>
            </div>
          </div>

          {valueType === "SELECT" && (
            <div>
              <label style={formLabelStyle}>선택지 후보 (쉼표 구분)</label>
              <input value={selectOptions} onChange={(e) => setSelectOptions(e.target.value)} placeholder="claude, gpt-4o, gemini" style={formInputStyle} />
            </div>
          )}
        </div>

        <div style={{
          margin: "0 24px 14px", padding: "10px 14px", borderRadius: 8,
          background: "var(--color-warning-subtle)", border: "1px solid var(--color-warning-border)",
          fontSize: 12, lineHeight: 1.7, color: "var(--color-text-secondary)",
        }}>
          <span style={{ fontWeight: 700, color: "var(--color-warning)" }}>주의</span>
          &nbsp;— 이 변경은 <b>기존 프로젝트의 설정에는 반영되지 않습니다</b>. 새로 생성되는 프로젝트에만 적용됩니다.
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 24px 20px" }}>
          <button onClick={onClose} style={secondaryBtnStyle}>취소</button>
          <button onClick={handleSave} disabled={editMutation.isPending} style={primaryBtnStyle}>
            {editMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────
// 설정 그룹 | 설정명 | 설정 구분 키 | 설명 | 유형 | 기본값 | 활성 | 액션
const GRID_TEMPLATE = "120px 1fr 180px 1fr 85px 140px 70px 60px";

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
  padding: "6px 16px", borderRadius: 6, border: "1px solid transparent",
  background: "var(--color-brand)", color: "var(--color-text-inverse)",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "6px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-primary)", fontSize: 12, cursor: "pointer",
};

const dangerBtnStyle: React.CSSProperties = {
  padding: "6px 16px", borderRadius: 6, border: "1px solid transparent",
  background: "var(--color-error)", color: "var(--color-text-inverse)",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
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

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
};

const modalBoxStyle: React.CSSProperties = {
  width: "min(560px, 90vw)", background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)", borderRadius: 10,
  boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden",
};

const modalHeaderStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "16px 24px", borderBottom: "1px solid var(--color-border)",
  background: "var(--color-bg-muted)",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none", border: "none", fontSize: 16, cursor: "pointer",
  color: "var(--color-text-secondary)", padding: "2px 6px",
};
