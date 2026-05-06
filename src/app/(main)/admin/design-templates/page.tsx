"use client";

/**
 * AdminDesignTemplatesPage — 시스템 공통(DEFAULT) 설계 양식 관리
 *
 * 역할:
 *   - tb_ai_design_template 중 prjct_id=NULL 행만 조회·편집 (admin API 응답이 이미 그렇게 제한됨)
 *   - 일반 페이지(/projects/.../design-templates) 와 거의 동일한 UI 패턴
 *     · 신규 등록 / 행 클릭 진입 / 사용여부·계층 필터
 *   - 삭제는 정책상 막혀 있어 UI 에서도 노출하지 않음
 *
 * 권한:
 *   - AdminLayout 이 isSystemAdmin 으로 전체 영역을 가드. 이 페이지는 추가 가드 불필요.
 *
 * 주요 기술:
 *   - TanStack Query: 목록 useQuery
 *   - authFetch: JWT 자동 첨부
 *   - 모든 색상은 semantic 토큰 (3테마 자동 대응)
 */

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type DesignRefType = "REQUIREMENT" | "UNIT_WORK" | "SCREEN" | "AREA" | "FUNCTION";

type TemplateRow = {
  dsgnTmplId:  string;
  projectId:   string | null;
  isSystem:    boolean;
  refTyCode:   DesignRefType;
  tmplNm:      string;
  tmplDc:      string;
  hasExample:  boolean;
  hasTemplate: boolean;
  useYn:       string;
  defaultYn:   string;
  sortOrdr:    number;
  creatMberId: string | null;
  creatDt:     string;
  mdfcnDt:     string;
};

// ── 상수 ──────────────────────────────────────────────────────────────────────
// 일반 페이지(projects/.../design-templates/page.tsx) 와 동일한 매핑.
// 향후 분리하려면 lib 헬퍼로 추출.

const REF_TYPE_LABELS: Record<DesignRefType, string> = {
  REQUIREMENT: "요구사항",
  UNIT_WORK:   "단위업무",
  SCREEN:      "화면",
  AREA:        "영역",
  FUNCTION:    "기능",
};

const REF_TYPE_COLORS: Record<DesignRefType, { bg: string; color: string }> = {
  REQUIREMENT: { bg: "var(--color-warning-subtle)", color: "var(--color-warning)" },
  UNIT_WORK:   { bg: "var(--color-accent-subtle)",  color: "var(--color-accent)"  },
  SCREEN:      { bg: "var(--color-info-subtle)",    color: "var(--color-info)"    },
  AREA:        { bg: "var(--color-brand-subtle)",   color: "var(--color-brand)"   },
  FUNCTION:    { bg: "var(--color-success-subtle)", color: "var(--color-success)" },
};

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function AdminDesignTemplatesPage() {
  return (
    <Suspense fallback={null}>
      <AdminDesignTemplatesPageInner />
    </Suspense>
  );
}

function AdminDesignTemplatesPageInner() {
  const router = useRouter();

  // ── 필터 ───────────────────────────────────────────────────────────────────
  const [refTypeFilter, setRefTypeFilter] = useState("");
  const [useYnFilter,   setUseYnFilter]   = useState("");

  // 페이지 도움말
  const [helpOpen, setHelpOpen] = useState(false);

  const queryParams = new URLSearchParams();
  if (refTypeFilter) queryParams.set("refType", refTypeFilter);
  if (useYnFilter)   queryParams.set("useYn",   useYnFilter);
  const qs = queryParams.toString() ? `?${queryParams.toString()}` : "";

  const { data: rows = [], isLoading } = useQuery<TemplateRow[]>({
    queryKey: ["admin-design-templates", refTypeFilter, useYnFilter],
    queryFn: () =>
      authFetch<{ data: TemplateRow[] }>(`/api/admin/design-templates${qs}`)
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
          시스템 공통(DEFAULT) 설계 양식 — 모든 프로젝트에서 참조됩니다.
          <HelpIcon onClick={() => setHelpOpen(true)} />
        </div>
        <button
          onClick={() => router.push("/admin/design-templates/new")}
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
              <span style={{ fontSize: 15, fontWeight: 700 }}>설계 양식이란? (시스템 관리)</span>
              <button
                onClick={() => setHelpOpen(false)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1 }}
              >
                ×
              </button>
            </div>
            <div style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.8, whiteSpace: "pre-line" }}>
              {ADMIN_DESIGN_TEMPLATES_HELP}
            </div>
          </div>
        </div>
      )}

      {/* ── 필터 바 ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <select
          value={refTypeFilter}
          onChange={(e) => setRefTypeFilter(e.target.value)}
          style={filterSelectStyle}
        >
          <option value="">대상 계층 전체</option>
          <option value="REQUIREMENT">요구사항</option>
          <option value="UNIT_WORK">단위업무</option>
          <option value="SCREEN">화면</option>
          <option value="AREA">영역</option>
          <option value="FUNCTION">기능</option>
        </select>

        <select
          value={useYnFilter}
          onChange={(e) => setUseYnFilter(e.target.value)}
          style={filterSelectStyle}
        >
          <option value="">사용 여부</option>
          <option value="Y">사용</option>
          <option value="N">미사용</option>
        </select>

        {(refTypeFilter || useYnFilter) && (
          <button
            onClick={() => { setRefTypeFilter(""); setUseYnFilter(""); }}
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
        {/* 헤더 */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "40% 12% 12% 8% 10% 12% 6%",
          padding: "10px 16px",
          background: "var(--color-bg-muted)",
          borderBottom: "1px solid var(--color-border)",
          fontSize: 12, fontWeight: 600,
          color: "var(--color-text-secondary)",
          gap: 8, alignItems: "center",
        }}>
          <span>템플릿 명</span>
          <span style={{ textAlign: "center" }}>대상 계층</span>
          <span style={{ textAlign: "center" }}>예시/템플릿</span>
          <span style={{ textAlign: "right" }}>정렬</span>
          <span style={{ textAlign: "center" }}>사용</span>
          <span>수정일</span>
          <span style={{ textAlign: "center" }}>액션</span>
        </div>

        {/* 바디 */}
        {isLoading ? (
          <div style={{ padding: "64px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 14 }}>
            로딩 중...
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: "64px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 14 }}>
            등록된 DEFAULT 양식이 없습니다.
          </div>
        ) : (
          rows.map((row, idx) => {
            const rtc    = REF_TYPE_COLORS[row.refTyCode];
            const active = row.useYn === "Y";
            return (
              <div
                key={row.dsgnTmplId}
                onClick={() => router.push(`/admin/design-templates/${row.dsgnTmplId}`)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "40% 12% 12% 8% 10% 12% 6%",
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
                {/* 템플릿 명 + DEFAULT 뱃지 */}
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

                {/* 대상 계층 */}
                <div style={{ textAlign: "center" }}>
                  <span style={{
                    display: "inline-block", padding: "2px 8px",
                    borderRadius: 4, fontSize: 11, fontWeight: 600,
                    background: rtc.bg, color: rtc.color, whiteSpace: "nowrap",
                  }}>
                    {REF_TYPE_LABELS[row.refTyCode]}
                  </span>
                </div>

                {/* 예시/템플릿 존재 여부 */}
                <div style={{ textAlign: "center", fontSize: 12 }}>
                  <span title="예시" style={{ color: row.hasExample ? "var(--color-success)" : "var(--color-border)", fontWeight: 700 }}>
                    {row.hasExample ? "●" : "○"}
                  </span>
                  <span style={{ margin: "0 4px", color: "var(--color-border-subtle)" }}>/</span>
                  <span title="템플릿" style={{ color: row.hasTemplate ? "var(--color-info)" : "var(--color-border)", fontWeight: 700 }}>
                    {row.hasTemplate ? "●" : "○"}
                  </span>
                </div>

                {/* 정렬 */}
                <span style={{ fontSize: 13, color: "var(--color-text-secondary)", textAlign: "right", paddingRight: 8 }}>
                  {row.sortOrdr}
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

                {/* 액션 — 편집 버튼만. 삭제는 정책상 차단 → UI 노출 X */}
                <div style={{ display: "flex", gap: 4, justifyContent: "center" }} onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => router.push(`/admin/design-templates/${row.dsgnTmplId}`)}
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

// ── 스타일 (모두 토큰 사용) ───────────────────────────────────────────────────

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
  minWidth:           140,
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
// 일반 페이지와 같은 정보를 시스템 관리자 시점에 맞춰 변형 — "전체 프로젝트 영향"
// 메시지를 더 강조.

const ADMIN_DESIGN_TEMPLATES_HELP = `여기는 시스템 공통(DEFAULT) 설계 양식 관리 페이지입니다.
모든 프로젝트가 기본으로 참조하는 양식 본문(예시 / 템플릿)을 편집합니다.

📌 어디에 쓰이나요?
  • 단위업무 / 화면 / 영역 / 기능 상세 페이지의 [예시] / [템플릿 삽입] 버튼
  • 사용자가 자기 프로젝트로 [이 양식 복사] 했을 때의 원본 출처

⚠️ 변경 시 영향 범위
  여기서 양식을 수정하면 변경 시점부터 모든 프로젝트의 해당 계층 설계 흐름에
  즉시 반영됩니다. 사본을 이미 만들어 둔 프로젝트는 영향받지 않지만,
  새로 [예시] / [템플릿 삽입] 버튼을 누르는 사용자는 변경된 본문을 보게 됩니다.

🔗 프롬프트 관리(/admin/prompt-templates) 와의 연관성
  AI 프롬프트가 "이 양식대로 작성하라" 를 지시하므로, 양식 수정 시 같은
  대상 계층을 쓰는 DEFAULT 프롬프트도 함께 점검·수정하세요.
  편집 페이지 우측 카드에서 영향받는 프롬프트 목록을 확인할 수 있습니다.

🚫 삭제는 차단됨
  실수 한 번이 모든 프로젝트의 AI 흐름을 망가뜨릴 수 있어 UI 에서는 삭제 버튼이 없습니다.
  진짜 제거가 필요하면 DB 직접 작업이 필요합니다.`;
