"use client";

/**
 * ProjectConfigsPage — 프로젝트 환경설정 (/projects/[id]/configs)
 *
 * 역할:
 *   - 프로젝트별 key-value 설정 관리
 *   - 테이블 형태로 그룹·키·설정명·설명·유형·값 표시
 *   - 설정 항목 추가(팝업)/삭제, 값 일괄 저장, 기본값 초기화
 */

import { Suspense, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type ConfigItem = {
  configId: string;
  key: string;
  value: string;
  label: string;
  description: string | null;
  valueType: string;
  defaultValue: string;
  selectOptions: string[] | null;
  sortOrder: number;
};

type ConfigGroup = {
  group: string;
  items: ConfigItem[];
};

// ── 상수 ──────────────────────────────────────────────────────────────────────

const VALUE_TYPE_LABELS: Record<string, string> = {
  BOOLEAN: "ON/OFF",
  TEXT: "텍스트",
  NUMBER: "숫자",
  SELECT: "선택",
};

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

  // 항목 수정 팝업 (행 클릭 시 또는 ✎ 버튼 클릭)
  const [editItem, setEditItem] = useState<(ConfigItem & { group: string }) | null>(null);
  // 도움말 팝업
  const [helpOpen, setHelpOpen] = useState(false);

  // ── 데이터 조회 ──
  const { data, isLoading } = useQuery({
    queryKey: ["configs", projectId],
    queryFn: () =>
      authFetch<{ data: { groups: ConfigGroup[] } }>(
        `/api/projects/${projectId}/configs`
      ).then((r) => r.data),
  });

  // 전체 아이템 flat 리스트
  const allItems: (ConfigItem & { group: string })[] = [];
  for (const g of data?.groups ?? []) {
    for (const item of g.items) {
      allItems.push({ ...item, group: g.group });
    }
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
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            환경설정
          </span>
          {/* 도움말 — "환경설정이란 무엇인가" 를 새 정책에 맞춰 안내 */}
          <button
            onClick={() => setHelpOpen(true)}
            title="환경설정 도움말"
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 20, height: 20, borderRadius: "50%",
              border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
              color: "var(--color-text-secondary)", fontSize: 11, fontWeight: 700,
              cursor: "pointer", lineHeight: 1, padding: 0,
            }}
          >
            ?
          </button>
        </div>
      </div>

      {/* ── 건수 ── */}
      <div style={{ padding: "0 24px", marginBottom: 12, fontSize: 14, color: "var(--color-text-secondary)" }}>
        총 {allItems.length}건
      </div>

      {/* ── 테이블 ── */}
      {allItems.length === 0 ? (
        <div style={{ padding: "60px 24px", textAlign: "center", color: "#888", fontSize: 13, lineHeight: 1.7 }}>
          이 프로젝트에 적용된 환경설정 항목이 없습니다.<br />
          시스템 관리자가 <code>/admin/config-templates</code> 에 표준 항목을 등록하면 다음 신규 프로젝트부터 자동 복사됩니다.
        </div>
      ) : (
        <div style={{ padding: "0 24px 48px" }}>
          <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
            {/* 헤더 행 */}
            <div style={gridHeaderStyle}>
              <div>설정 그룹</div>
              <div>설정 구분 키</div>
              <div>설정명</div>
              <div>유형</div>
              <div>설정 값</div>
              <div>설명</div>
              <div style={{ textAlign: "center" }}>기본값</div>
              <div />
            </div>

            {/* 데이터 행 */}
            {allItems.map((item, idx) => {
              // 같은 그룹이면 첫 행에만 그룹명 표시
              const showGroup = idx === 0 || allItems[idx - 1].group !== item.group;

              return (
                <div
                  key={item.configId}
                  style={{
                    ...gridRowStyle,
                    borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                    background: "var(--color-bg-card)",
                  }}
                >
                  {/* 그룹 */}
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-primary, #1976d2)" }}>
                    {showGroup ? item.group : ""}
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

                  {/* 설정명 — 클릭 시 수정 팝업. 좁은 폭에서는 ellipsis (title로 전체 노출) */}
                  <div
                    onClick={() => setEditItem(item)}
                    title={item.label}
                    style={{
                      fontSize: 13, color: "var(--color-text-primary)",
                      cursor: "pointer",
                      textDecoration: "underline", textDecorationColor: "transparent",
                      transition: "text-decoration-color 0.15s",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.textDecorationColor = "var(--color-primary, #1976d2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.textDecorationColor = "transparent")}
                  >
                    {item.label}
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

                  {/* 설정 값 — 읽기 전용 */}
                  <div style={{ fontSize: 12, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.value}>
                    {item.valueType === "BOOLEAN" ? (
                      <span style={{
                        display: "inline-block", padding: "2px 10px", borderRadius: 10, fontSize: 11, fontWeight: 700,
                        ...(item.value === "Y"
                          ? { background: "#e8f5e9", color: "#2e7d32" }
                          : { background: "#f5f5f5", color: "#999" }),
                      }}>
                        {item.value === "Y" ? "ON" : "OFF"}
                      </span>
                    ) : (
                      item.value || <span style={{ color: "#ccc" }}>—</span>
                    )}
                  </div>

                  {/* 설명 */}
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.description ?? ""}>
                    {item.description || <span style={{ color: "#ccc" }}>—</span>}
                  </div>

                  {/* 기본값 */}
                  <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {item.defaultValue || "—"}
                  </div>

                  {/* 수정 — 삭제는 의도치 않은 SPECODE 동작 변경을 막기 위해 제거됨 */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <button
                      onClick={() => setEditItem(item)}
                      title="수정"
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--color-text-secondary)", padding: "2px 6px" }}
                    >
                      ✎
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
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

      {/* ── 환경설정 도움말 팝업 ── */}
      {helpOpen && <ConfigsHelpPopup onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

// ── 도움말 팝업 — "환경설정이란 무엇이고 무엇을 할 수 있나" ─────────────────
//
// 핵심 메시지:
//   ① 여기 환경설정은 SPECODE 도구 자체의 동작을 제어한다 (고객사 산출물과 무관).
//   ② 사용자는 "값" 만 수정한다. 신규 추가/삭제는 시스템 관리자 영역.
//   ③ 항목 자체는 프로젝트 생성 시 시스템 표준 템플릿에서 자동 복사됨.
function ConfigsHelpPopup({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(620px, 92vw)", maxHeight: "85vh", overflow: "auto", background: "var(--color-bg-card)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.2)" }}
      >
        {/* 헤더 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)",
          position: "sticky", top: 0, zIndex: 1,
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
            환경설정 도움말
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--color-text-secondary)", padding: "0 4px", lineHeight: 1 }}
          >×</button>
        </div>

        {/* 본문 */}
        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14, fontSize: 13, lineHeight: 1.7, color: "var(--color-text-primary)" }}>

          <div>
            <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 14 }}>환경설정이란?</div>
            <div style={{ color: "var(--color-text-secondary)" }}>
              이 프로젝트 안에서 <b>SPECODE 도구 자체의 동작 방식</b>을 제어하는 곳입니다.
            </div>
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 8, background: "#fff8e1", border: "1px solid #ffe082" }}>
            <div style={{ fontWeight: 700, marginBottom: 2, color: "#e65100" }}>⚠️ 헷갈리지 마세요</div>
            <div style={{ color: "#795548" }}>
              여러분이 SPECODE로 분석·설계 중인 <b>고객사 산출물에는 영향이 없습니다.</b><br />
              SPECODE 도구가 이 프로젝트 안에서 어떻게 행동할지만 바꿉니다.
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 14 }}>📌 예시</div>
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", marginBottom: 8 }}>
              <div style={{ fontWeight: 700, marginBottom: 2, fontFamily: "monospace", fontSize: 12 }}>UNIQUE_CODE_USE_YN</div>
              <div style={{ color: "var(--color-text-secondary)" }}>
                ON: SPECODE 공통코드 페이지에서 그룹 간 같은 코드 중복 등록 차단<br />
                OFF: 그룹 안에서만 중복 방지
              </div>
            </div>
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
              <div style={{ fontWeight: 700, marginBottom: 2, fontFamily: "monospace", fontSize: 12 }}>CODE_DEL_PSBL_YN</div>
              <div style={{ color: "var(--color-text-secondary)" }}>
                ON: SPECODE 공통코드의 ✕ 버튼으로 삭제 가능<br />
                OFF: SPECODE 공통코드 삭제 차단 → 비활성(use_yn=N)만 허용
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── 설정 수정 모달 ────────────────────────────────────────────────────────────

function EditConfigModal({ projectId, item, onClose, onSaved }: {
  projectId: string;
  item: ConfigItem & { group: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  // 정책: 그룹/키/설정명/설명/유형/기본값/선택지는 시스템 관리자가
  // /admin/config-templates 에서 관리하는 표준 메타데이터.
  // 프로젝트 화면에서는 "설정 값" 만 사용자가 수정한다.
  const [value, setValue] = useState(item.value);

  const selectOptionList = item.selectOptions ?? [];

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
    // 값만 전송 — 메타데이터는 변경하지 않음
    editMutation.mutate({ value });
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
              <input value={item.group} readOnly style={formInputReadOnlyStyle} />
            </div>
            <div>
              <label style={formLabelStyle}>설정 구분 키</label>
              <input value={item.key} readOnly style={formInputReadOnlyStyle} />
            </div>
          </div>

          <div>
            <label style={formLabelStyle}>설정명</label>
            <input value={item.label} readOnly style={formInputReadOnlyStyle} />
          </div>

          <div>
            <label style={formLabelStyle}>설명</label>
            <input value={item.description ?? ""} readOnly style={formInputReadOnlyStyle} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
            <div>
              <label style={formLabelStyle}>값 유형</label>
              <input
                value={VALUE_TYPE_LABELS[item.valueType] ?? item.valueType}
                readOnly
                style={formInputReadOnlyStyle}
              />
            </div>
            <div>
              <label style={formLabelStyle}>
                설정 값 <span style={{ color: "var(--color-primary, #1976d2)" }}>*</span>
              </label>
              {item.valueType === "BOOLEAN" ? (
                <button
                  type="button"
                  onClick={() => setValue(value === "Y" ? "N" : "Y")}
                  style={{
                    display: "block", width: "100%", padding: "7px 12px", borderRadius: 6,
                    fontSize: 13, fontWeight: 700, cursor: "pointer",
                    border: "1px solid",
                    ...(value === "Y"
                      ? { background: "#e8f5e9", color: "#2e7d32", borderColor: "#a5d6a7" }
                      : { background: "#f5f5f5", color: "#999", borderColor: "var(--color-border)" }),
                  }}
                >
                  {value === "Y" ? "ON" : "OFF"}
                </button>
              ) : item.valueType === "SELECT" && selectOptionList.length > 0 ? (
                <select value={value} onChange={(e) => setValue(e.target.value)} style={formInputStyle}>
                  {selectOptionList.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={item.valueType === "NUMBER" ? "number" : "text"}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  style={formInputStyle}
                />
              )}
            </div>
            <div>
              <label style={formLabelStyle}>기본값</label>
              <input value={item.defaultValue} readOnly style={formInputReadOnlyStyle} />
            </div>
          </div>

          {item.valueType === "SELECT" && selectOptionList.length > 0 && (
            <div>
              <label style={formLabelStyle}>선택지 후보</label>
              <input value={selectOptionList.join(", ")} readOnly style={formInputReadOnlyStyle} />
            </div>
          )}
        </div>

        {/* 안내 — 값 외 필드는 시스템 관리자 영역임을 명시 */}
        <div style={{
          margin: "0 24px 14px", padding: "10px 14px", borderRadius: 8,
          background: "var(--color-bg-muted)", border: "1px solid var(--color-border)",
          fontSize: 12, lineHeight: 1.7, color: "var(--color-text-secondary)",
        }}>
          <span style={{ fontWeight: 700, color: "var(--color-text-primary)" }}>안내</span>
          &nbsp;— 설정 항목의 메타데이터(그룹·키·설정명·유형·기본값 등)는 시스템 관리자가 관리합니다.
          이 화면에서는 <b>설정 값</b>만 변경할 수 있습니다.
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

// 설정 그룹 | 설정 구분 키 | 설정명 | 유형 | 설정 값 | 설명 | 기본값 | 수정
//   설정 그룹(150px)  — 그룹명이 길어질 수 있어 100px → 150px (+50%)
//   설정 구분 키(216px) — UNIQUE_CODE_USE_YN 같은 긴 키가 잘리지 않도록 180px → 216px (+20%)
//                       (식별자 성격이라 좌측에 우선 노출)
//   유형(104px)       — 80px → 104px (+30%, "ON/OFF" 라벨에 여유) — 설정명 옆에 배치해
//                       "이 항목이 어떤 형태의 값인가" 를 즉시 인지할 수 있게 함
//   설정 값(110px)     — ON 배지(~40px) 또는 짧은 텍스트, ellipsis 적용됨
//                       (유형 바로 옆이라 형태↔현재값을 한눈에 비교)
//   기본값(60px)       — Y/N 단일 문자 center 정렬
//   수정(60px)         — ✎ 아이콘 1개 (삭제는 정책상 제거됨)
//   설정명·설명은 1fr 로 가용 공간 분배 + ellipsis (설명은 보조 정보라 우측 배치)
const GRID_TEMPLATE = "150px 216px 1fr 104px 110px 1fr 60px 60px";

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

// 읽기 전용 — 시스템 관리자가 정한 메타데이터를 그대로 노출.
// 사용자에게 "수정 불가" 임이 시각적으로 즉시 인지되도록 배경/색을 흐리게.
const formInputReadOnlyStyle: React.CSSProperties = {
  ...formInputStyle,
  background: "var(--color-bg-muted)",
  color: "var(--color-text-secondary)",
  cursor: "not-allowed",
};

