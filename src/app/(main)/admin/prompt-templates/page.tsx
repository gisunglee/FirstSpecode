"use client";

/**
 * AdminPromptTemplatesPage — 시스템 공통(DEFAULT) AI 프롬프트 템플릿 관리
 *
 * 역할:
 *   - tb_ai_prompt_template 중 prjct_id=NULL 행만 조회·편집 (admin API 응답 제한)
 *   - 일반 페이지(/projects/.../prompt-templates) 와 동일한 UI 패턴
 *   - 도메인 탭(일반/기획실), 작업유형·사용처·산출물·사용여부 필터
 *   - 삭제는 정책상 차단 → UI 노출 X
 *
 * 권한:
 *   - AdminLayout 이 isSystemAdmin 으로 영역 가드. 추가 가드 불필요.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  type PromptTemplateTaskType,
  type PromptTemplateRefType,
  PROMPT_TEMPLATE_TASK_TYPE_LABEL,
} from "@/constants/codes";
import { ARTF_DIV } from "@/constants/planStudio";
import { type PromptDomain, parsePromptDomain } from "@/lib/prompt-template/domain";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type TemplateRow = {
  tmplId:     string;
  projectId:  string | null;
  isSystem:   boolean;
  tmplNm:     string;
  taskTyCode: PromptTemplateTaskType;
  refTyCode:  PromptTemplateRefType | null;
  divCode:    string | null;
  fmtCode:    string | null;
  tmplDc:     string;
  useYn:      string;
  defaultYn:  string;
  sortOrdr:   number;
  useCnt:     number;
  creatDt:    string;
  mdfcnDt:    string;
};

// ── 상수 ──────────────────────────────────────────────────────────────────────

const REF_TYPE_LABELS: Record<string, string> = {
  UNIT_WORK:        "단위업무",
  SCREEN:           "화면",
  AREA:             "영역 설계",
  FUNCTION:         "기능 설계",
  PLAN_STUDIO_ARTF: "기획실",
};

const taskTypeBadgeColors: Record<PromptTemplateTaskType, { bg: string; color: string }> = {
  DESIGN:                    { bg: "var(--color-brand-subtle)",   color: "var(--color-brand)"   },
  INSPECT:                   { bg: "var(--color-info-subtle)",    color: "var(--color-info)"    },
  IMPACT:                    { bg: "var(--color-warning-subtle)", color: "var(--color-warning)" },
  IMPLEMENT:                 { bg: "var(--color-error-subtle)",   color: "var(--color-error)"   },
  TEST:                      { bg: "var(--color-success-subtle)", color: "var(--color-success)" },
  PLAN_STUDIO_ARTF_GENERATE: { bg: "var(--color-info-subtle)",    color: "var(--color-info)"    },
  MOCKUP:    { bg: "var(--color-bg-muted)", color: "var(--color-text-tertiary)" },
  CUSTOM:    { bg: "var(--color-bg-muted)", color: "var(--color-text-tertiary)" },
  PRE_IMPL:  { bg: "var(--color-bg-muted)", color: "var(--color-text-tertiary)" },
};

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function AdminPromptTemplatesPage() {
  return (
    <Suspense fallback={null}>
      <AdminPromptTemplatesPageInner />
    </Suspense>
  );
}

function AdminPromptTemplatesPageInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  // 도메인 탭 — URL 쿼리 단일 진실의 원천
  const activeTab: PromptDomain = parsePromptDomain(searchParams.get("tab")) ?? "general";
  const setActiveTab = (next: PromptDomain) => {
    const next_qs = new URLSearchParams(searchParams.toString());
    next_qs.set("tab", next);
    next_qs.delete("refType");
    next_qs.delete("divCode");
    router.replace(`?${next_qs.toString()}`);
  };

  // 필터 상태
  const [taskTypeFilter, setTaskTypeFilter] = useState("");
  const [refTypeFilter,  setRefTypeFilter]  = useState("");
  const [divCodeFilter,  setDivCodeFilter]  = useState("");
  const [useYnFilter,    setUseYnFilter]    = useState("");

  // 페이지 도움말
  const [helpOpen, setHelpOpen] = useState(false);

  // 탭 전환 시 다른 도메인 전용 필터 초기화 (잘못된 조회 방지)
  useEffect(() => {
    if (activeTab === "general")     setDivCodeFilter("");
    if (activeTab === "plan-studio") setRefTypeFilter("");
  }, [activeTab]);

  // 데이터 조회
  const queryParams = new URLSearchParams();
  queryParams.set("domain", activeTab);
  if (taskTypeFilter) queryParams.set("taskType", taskTypeFilter);
  if (activeTab === "general"     && refTypeFilter) queryParams.set("refType", refTypeFilter);
  if (activeTab === "plan-studio" && divCodeFilter) queryParams.set("divCode", divCodeFilter);
  if (useYnFilter) queryParams.set("useYn", useYnFilter);
  const qs = `?${queryParams.toString()}`;

  const { data: rows = [], isLoading } = useQuery<TemplateRow[]>({
    queryKey: ["admin-prompt-templates", activeTab, taskTypeFilter, refTypeFilter, divCodeFilter, useYnFilter],
    queryFn: () =>
      authFetch<{ data: TemplateRow[] }>(`/api/admin/prompt-templates${qs}`)
        .then((r) => r.data),
  });

  return (
    <div>
      {/* ── 페이지 서브 헤더 ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 16,
      }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "var(--text-md)", color: "var(--color-text-secondary)" }}>
          시스템 공통(DEFAULT) AI 프롬프트 — 모든 프로젝트 AI 요청에 영향.
          <HelpIcon onClick={() => setHelpOpen(true)} />
        </div>
        <button
          onClick={() => router.push("/admin/prompt-templates/new")}
          style={primaryBtnStyle}
        >
          + 신규 등록
        </button>
      </div>

      {/* ── 도움말 다이얼로그 ── */}
      {helpOpen && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 1200,
            background: "var(--color-bg-overlay)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={() => setHelpOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--color-bg-card)",
              borderRadius: 12, padding: "24px 28px",
              minWidth: 480, maxWidth: 600,
              boxShadow: "var(--shadow-lg)",
              color: "var(--color-text-primary)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>프롬프트 관리란? (시스템 관리)</span>
              <button
                onClick={() => setHelpOpen(false)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1 }}
              >
                ×
              </button>
            </div>
            <div style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.8, whiteSpace: "pre-line" }}>
              {ADMIN_PROMPT_TEMPLATES_HELP}
            </div>
          </div>
        </div>
      )}

      {/* ── 도메인 탭 ── */}
      <div style={{
        display: "flex", gap: 0,
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        <TabButton active={activeTab === "general"}     onClick={() => setActiveTab("general")}     label="일반" />
        <TabButton active={activeTab === "plan-studio"} onClick={() => setActiveTab("plan-studio")} label="기획실" />
      </div>

      {/* ── 필터 바 ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <select value={taskTypeFilter} onChange={(e) => setTaskTypeFilter(e.target.value)} style={filterSelectStyle}>
          <option value="">전체 유형</option>
          {Object.entries(PROMPT_TEMPLATE_TASK_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        {activeTab === "general" ? (
          <select value={refTypeFilter} onChange={(e) => setRefTypeFilter(e.target.value)} style={filterSelectStyle}>
            <option value="">전체 사용처</option>
            <option value="UNIT_WORK">단위업무 (UNIT_WORK)</option>
            <option value="SCREEN">화면 (SCREEN)</option>
            <option value="AREA">영역 설계 (AREA)</option>
            <option value="FUNCTION">기능 설계 (FUNCTION)</option>
          </select>
        ) : (
          <select value={divCodeFilter} onChange={(e) => setDivCodeFilter(e.target.value)} style={filterSelectStyle}>
            <option value="">전체 산출물</option>
            {Object.values(ARTF_DIV).map((d) => (
              <option key={d.code} value={d.code}>{d.name} ({d.code})</option>
            ))}
          </select>
        )}

        <select value={useYnFilter} onChange={(e) => setUseYnFilter(e.target.value)} style={filterSelectStyle}>
          <option value="">사용 여부</option>
          <option value="Y">사용</option>
          <option value="N">미사용</option>
        </select>

        {(taskTypeFilter || refTypeFilter || divCodeFilter || useYnFilter) && (
          <button
            onClick={() => { setTaskTypeFilter(""); setRefTypeFilter(""); setDivCodeFilter(""); setUseYnFilter(""); }}
            style={secondarySmallBtnStyle}
          >
            초기화
          </button>
        )}

        <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--color-text-secondary)" }}>
          총 <strong>{rows.length}</strong>건
        </span>
      </div>

      {/* ── 테이블 ── */}
      <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "30% 11% 10% 5% 5% 7% 12% 10%",
          padding: "10px 16px",
          background: "var(--color-bg-muted)",
          borderBottom: "1px solid var(--color-border)",
          fontSize: 12, fontWeight: 600,
          color: "var(--color-text-secondary)",
          gap: 8, alignItems: "center",
        }}>
          <span>템플릿 명</span>
          <span style={{ textAlign: "center" }}>작업 유형</span>
          <span style={{ textAlign: "center" }}>사용처</span>
          <span style={{ textAlign: "right" }}>정렬</span>
          <span style={{ textAlign: "right" }}>이용</span>
          <span style={{ textAlign: "center" }}>사용</span>
          <span>수정일</span>
          <span style={{ textAlign: "center" }}>액션</span>
        </div>

        {isLoading ? (
          <div style={{ padding: "64px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 14 }}>
            로딩 중...
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: "64px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 14 }}>
            등록된 DEFAULT 프롬프트가 없습니다.
          </div>
        ) : (
          rows.map((row, idx) => {
            const tc     = taskTypeBadgeColors[row.taskTyCode] ?? { bg: "var(--color-bg-muted)", color: "var(--color-text-secondary)" };
            const active = row.useYn === "Y";
            return (
              <div
                key={row.tmplId}
                onClick={() => router.push(`/admin/prompt-templates/${row.tmplId}`)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "30% 11% 10% 5% 5% 7% 12% 10%",
                  padding: "12px 16px",
                  paddingLeft: active ? 16 : 13,
                  borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                  borderLeft: active ? "3px solid transparent" : "3px solid var(--color-border)",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  background: active ? "var(--color-bg-card)" : "var(--color-bg-muted)",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-table-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = active ? "var(--color-bg-card)" : "var(--color-bg-muted)")}
              >
                {/* 템플릿 명 + DEFAULT 배지 */}
                <div style={{ overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                      background: "var(--color-text-primary)",
                      color:      "var(--color-text-inverse)",
                      flexShrink: 0,
                      letterSpacing: "0.04em",
                    }}>
                      DEFAULT
                    </span>
                    <span style={{
                      fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {row.tmplNm}
                    </span>
                  </div>
                  {row.tmplDc && (
                    <div style={{
                      fontSize: 11, color: "var(--color-text-secondary)", marginTop: 1,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {row.tmplDc}
                    </div>
                  )}
                </div>

                {/* 작업 유형 */}
                <div style={{ textAlign: "center" }}>
                  <span style={{
                    display: "inline-block", padding: "2px 8px",
                    borderRadius: 4, fontSize: 11, fontWeight: 600,
                    background: tc.bg, color: tc.color, whiteSpace: "nowrap",
                  }}>
                    {PROMPT_TEMPLATE_TASK_TYPE_LABEL[row.taskTyCode] ?? row.taskTyCode}
                  </span>
                </div>

                {/* 사용처 */}
                <div style={{ textAlign: "center" }}>
                  <span style={{
                    display: "inline-block", padding: "2px 8px",
                    borderRadius: 4, fontSize: 11, fontWeight: 600,
                    background: row.refTyCode === "FUNCTION"         ? "var(--color-success-subtle)"
                              : row.refTyCode === "AREA"             ? "var(--color-info-subtle)"
                              : row.refTyCode === "PLAN_STUDIO_ARTF" ? "var(--color-brand-subtle)"
                              : "var(--color-bg-muted)",
                    color:      row.refTyCode === "FUNCTION"         ? "var(--color-success)"
                              : row.refTyCode === "AREA"             ? "var(--color-info)"
                              : row.refTyCode === "PLAN_STUDIO_ARTF" ? "var(--color-brand)"
                              : "var(--color-text-secondary)",
                    whiteSpace: "nowrap",
                  }}>
                    {row.refTyCode === "PLAN_STUDIO_ARTF" && row.divCode && row.fmtCode
                      ? `기획실 ${row.divCode}·${row.fmtCode}`
                      : row.refTyCode
                        ? REF_TYPE_LABELS[row.refTyCode] ?? row.refTyCode
                        : "범용"}
                  </span>
                </div>

                {/* 정렬 / 이용 */}
                <span style={{ fontSize: 13, color: "var(--color-text-secondary)", textAlign: "right", paddingRight: 8 }}>
                  {row.sortOrdr}
                </span>
                <span style={{ fontSize: 13, color: "var(--color-text-secondary)", textAlign: "right", paddingRight: 8 }}>
                  {row.useCnt.toLocaleString()}
                </span>

                {/* 사용 여부 */}
                <div style={{ textAlign: "center" }}>
                  <span style={{
                    display: "inline-block", padding: "2px 8px",
                    borderRadius: 4, fontSize: 11, fontWeight: 600,
                    background: active ? "var(--color-success-subtle)" : "transparent",
                    color:      active ? "var(--color-success)" : "var(--color-text-tertiary)",
                    border:     active ? "none" : "1px dashed var(--color-border)",
                  }}>
                    {active ? "사용" : "미사용"}
                  </span>
                </div>

                {/* 수정일 */}
                <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                  {row.mdfcnDt.slice(0, 10)}
                </span>

                {/* 액션 — 편집만, 삭제는 정책상 차단 */}
                <div style={{ display: "flex", gap: 4, justifyContent: "center" }} onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => router.push(`/admin/prompt-templates/${row.tmplId}`)}
                    style={secondarySmallBtnStyle}
                  >
                    편집
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── 도메인 탭 버튼 ────────────────────────────────────────────────────────────

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding:    "10px 16px",
        background: "none",
        border:     "none",
        borderBottom: active ? "2px solid var(--color-brand)" : "2px solid transparent",
        marginBottom: -1,
        fontSize:   13,
        fontWeight: active ? 700 : 500,
        color:      active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
        cursor:     "pointer",
      }}
    >
      {label}
    </button>
  );
}

// ── 스타일 ───────────────────────────────────────────────────────────────────

const primaryBtnStyle: React.CSSProperties = {
  padding: "5px 14px", borderRadius: 6,
  border: "1px solid transparent",
  background: "var(--color-brand)", color: "var(--color-text-inverse)",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
};

const secondarySmallBtnStyle: React.CSSProperties = {
  padding: "3px 10px", borderRadius: 5,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)", color: "var(--color-text-primary)",
  fontSize: 11, cursor: "pointer",
};

const filterSelectStyle: React.CSSProperties = {
  padding:            "7px 32px 7px 12px",
  borderRadius:       6,
  border:             "1px solid var(--color-border)",
  fontSize:           13,
  background:         "var(--color-bg-card)",
  color:              "var(--color-text-primary)",
  cursor:             "pointer",
  outline:            "none",
  appearance:         "none",
  WebkitAppearance:   "none",
  backgroundImage:    `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
  backgroundRepeat:   "no-repeat",
  backgroundPosition: "right 10px center",
  minWidth:           120,
};

// ── 도움말 아이콘 ────────────────────────────────────────────────────────────

function HelpIcon({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title="도움말"
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 16, height: 16, borderRadius: "50%",
        border: "1.5px solid var(--color-text-secondary)",
        background: "transparent", color: "var(--color-text-secondary)",
        fontSize: 10, fontWeight: 700, cursor: "pointer", padding: 0, lineHeight: 1,
      }}
    >
      ?
    </button>
  );
}

// ── 도움말 본문 (admin 컨텍스트) ────────────────────────────────────────────

const ADMIN_PROMPT_TEMPLATES_HELP = `여기는 시스템 공통(DEFAULT) AI 프롬프트 관리 페이지입니다.
모든 프로젝트가 기본으로 참조하는 프롬프트의 시스템 메시지를 편집합니다.

📌 어디에 쓰이나요?
  • 단위업무 / 화면 / 영역 / 기능 상세 페이지의 [AI 작업] 버튼
  • 기획실 산출물 생성 (대상 사용처 = PLAN_STUDIO_ARTF)
  • SPECODE 가 (작업유형 × 사용처) 조합으로 자동 매칭

⚠️ 변경 시 영향 범위
  여기서 프롬프트를 수정하면 변경 시점부터 모든 프로젝트의 AI 요청에 즉시 반영됩니다.
  사본을 만들어 둔 프로젝트는 영향받지 않습니다.

🔗 설계 양식(/admin/design-templates) 과의 연관성
  프롬프트가 "이 양식대로 작성하라" 를 지시하므로, 프롬프트 수정 시 같은
  사용처의 DEFAULT 설계 양식도 함께 점검·수정하세요.

🚫 삭제는 차단됨
  실수 한 번이 모든 프로젝트의 AI 흐름을 망가뜨릴 수 있어 UI 에서는 삭제 버튼이 없습니다.
  진짜 제거가 필요하면 DB 직접 작업이 필요합니다.`;
