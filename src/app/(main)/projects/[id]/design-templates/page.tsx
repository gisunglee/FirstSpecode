"use client";

/**
 * DesignTemplatesPage — 설계 양식 목록 (스펙설정 → 설계 양식)
 *
 * 역할:
 *   - 프로젝트 + 시스템 공통 설계 양식 목록 조회
 *   - 대상 계층(ref_ty_code) / 사용여부 / 스코프 필터
 *   - 공통/DEFAULT 뱃지, 사용 여부 시각적 강조
 *   - 행 클릭 → 상세/편집 페이지 이동, "+ 신규 등록"
 *
 * 주의:
 *   - 시스템 공통(prjct_id=null) 또는 default_yn='Y' 는 편집·삭제 불가
 *     (서버에서도 403 반환되므로 UI도 버튼을 숨긴다)
 */

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";
import { useIsSystemAdmin, useMyRole } from "@/hooks/useMyRole";

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

const REF_TYPE_LABELS: Record<DesignRefType, string> = {
  REQUIREMENT: "요구사항",
  UNIT_WORK:   "단위업무",
  SCREEN:      "화면",
  AREA:        "영역",
  FUNCTION:    "기능",
};

// 계층별 색상 — semantic 토큰에 매핑해 3테마(dark/light/dark-purple) 자동 대응.
//   REQUIREMENT(주황)→warning, UNIT_WORK(앰버)→accent, SCREEN(파랑)→info,
//   AREA(인디고/퍼플)→brand, FUNCTION(초록)→success
const REF_TYPE_COLORS: Record<DesignRefType, { bg: string; color: string }> = {
  REQUIREMENT: { bg: "var(--color-warning-subtle)", color: "var(--color-warning)" },
  UNIT_WORK:   { bg: "var(--color-accent-subtle)",  color: "var(--color-accent)"  },
  SCREEN:      { bg: "var(--color-info-subtle)",    color: "var(--color-info)"    },
  AREA:        { bg: "var(--color-brand-subtle)",   color: "var(--color-brand)"   },
  FUNCTION:    { bg: "var(--color-success-subtle)", color: "var(--color-success)" },
};

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function DesignTemplatesPage() {
  return (
    <Suspense fallback={null}>
      <DesignTemplatesPageInner />
    </Suspense>
  );
}

function DesignTemplatesPageInner() {
  const params    = useParams();
  const router    = useRouter();
  const qc        = useQueryClient();
  const projectId = params.id as string;

  // 권한 (프롬프트 관리와 동일 패턴):
  //   - DEFAULT (공통/기본) 편집은 SUPER_ADMIN 만
  //   - 프로젝트 복사본 편집/삭제/복사는 OWNER/ADMIN 만
  const { isSystemAdmin } = useIsSystemAdmin();
  const { myRole } = useMyRole(projectId);
  const isProjectAdmin = myRole === "OWNER" || myRole === "ADMIN";
  const canCreateOrCopy = isSystemAdmin || isProjectAdmin;

  const { setBreadcrumb } = useAppStore();
  useEffect(() => {
    setBreadcrumb([{ label: "설계 양식" }]);
    // 언마운트 시 초기화 — 다른 페이지로 이동해도 GNB 브레드크럼에
    //                     "설계 양식"이 남아있는 문제 방지
    return () => setBreadcrumb([]);
  }, [setBreadcrumb]);

  // ── 필터 ───────────────────────────────────────────────────────────────────
  const [refTypeFilter, setRefTypeFilter] = useState("");
  const [useYnFilter,   setUseYnFilter]   = useState("");
  const [scopeFilter,   setScopeFilter]   = useState(""); // "" | "system" | "project"

  // ── 삭제 확인 다이얼로그 ───────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<{ dsgnTmplId: string; tmplNm: string } | null>(null);

  // ── 데이터 조회 ────────────────────────────────────────────────────────────
  const queryParams = new URLSearchParams();
  if (refTypeFilter) queryParams.set("refType", refTypeFilter);
  if (useYnFilter)   queryParams.set("useYn",   useYnFilter);
  if (scopeFilter)   queryParams.set("scope",   scopeFilter);
  const qs = queryParams.toString() ? `?${queryParams.toString()}` : "";

  const { data: rows = [], isLoading } = useQuery<TemplateRow[]>({
    queryKey: ["design-templates", projectId, refTypeFilter, useYnFilter, scopeFilter],
    queryFn: () =>
      authFetch<{ data: TemplateRow[] }>(`/api/projects/${projectId}/design-templates${qs}`)
        .then((r) => r.data),
  });

  // ── 삭제 뮤테이션 ──────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (dsgnTmplId: string) =>
      authFetch(`/api/projects/${projectId}/design-templates/${dsgnTmplId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-templates", projectId] });
      // 상세 페이지 쪽에서도 resolve가 바뀔 수 있으므로 함께 무효화
      qc.invalidateQueries({ queryKey: ["design-template", projectId] });
      toast.success("양식이 삭제되었습니다.");
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div style={{ padding: 0 }}>
      {/* ── 페이지 헤더 ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 24px",
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          설계 양식
        </div>
        {/* 신규 등록 — OWNER/ADMIN 또는 SUPER_ADMIN 만 */}
        {canCreateOrCopy && (
          <button
            onClick={() => router.push(`/projects/${projectId}/design-templates/new`)}
            style={primaryBtnStyle}
          >
            + 신규 등록
          </button>
        )}
      </div>

      <div style={{ padding: "0 24px 24px" }}>

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
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value)}
            style={filterSelectStyle}
          >
            <option value="">스코프 전체</option>
            <option value="system">시스템 공통</option>
            <option value="project">프로젝트 전용</option>
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

          {(refTypeFilter || scopeFilter || useYnFilter) && (
            <button
              onClick={() => { setRefTypeFilter(""); setScopeFilter(""); setUseYnFilter(""); }}
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
            gridTemplateColumns: "34% 10% 10% 6% 7% 10% 13%",
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
            <span>액션</span>
          </div>

          {/* 바디 */}
          {isLoading ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 14 }}>
              로딩 중...
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 14 }}>
              등록된 설계 양식이 없습니다.
            </div>
          ) : (
            rows.map((row, idx) => {
              const rtc       = REF_TYPE_COLORS[row.refTyCode];
              const active    = row.useYn === "Y";
              const isDefault = row.defaultYn === "Y";
              return (
                <div
                  key={row.dsgnTmplId}
                  onClick={() => router.push(`/projects/${projectId}/design-templates/${row.dsgnTmplId}`)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "34% 10% 10% 6% 7% 10% 13%",
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
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover, var(--color-brand-subtle))")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = active ? "var(--color-bg-card)" : "var(--color-bg-muted)")}
                >
                  {/* 템플릿 명 + 공통/DEFAULT 뱃지 */}
                  <div style={{ overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {row.isSystem && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                          background: "var(--color-brand)", color: "var(--color-text-inverse)", flexShrink: 0,
                        }}>
                          공통
                        </span>
                      )}
                      {isDefault && (
                        // DEFAULT 배지 — text-primary 배경 + text-inverse 글자로 3테마 컨트라스트 유지
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                          background: "var(--color-text-primary)",
                          color:      "var(--color-text-inverse)",
                          flexShrink: 0,
                          letterSpacing: "0.04em",
                        }}>
                          DEFAULT
                        </span>
                      )}
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

                  {/* 예시/템플릿 존재 여부 — 예시는 success, 템플릿은 info, 없으면 border-subtle */}
                  <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)" }}>
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

                  {/* 액션 — DEFAULT(공통/기본): SUPER_ADMIN 만 편집, 삭제 불가
                             프로젝트 복사본:    OWNER/ADMIN 만 편집·삭제
                             그 외:              "보기" 버튼만 */}
                  <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const rowIsDefault = isDefault || row.isSystem;
                      const canEditThisRow = rowIsDefault ? isSystemAdmin : isProjectAdmin;
                      return (
                        <>
                          <button
                            onClick={() => router.push(`/projects/${projectId}/design-templates/${row.dsgnTmplId}`)}
                            style={secondarySmallBtnStyle}
                          >
                            {canEditThisRow ? "편집" : "보기"}
                          </button>
                          {/* 삭제는 프로젝트 복사본 + OWNER/ADMIN 만. DEFAULT 는 절대 불가. */}
                          {!rowIsDefault && isProjectAdmin && (
                            <button
                              onClick={() => setDeleteTarget({ dsgnTmplId: row.dsgnTmplId, tmplNm: row.tmplNm })}
                              style={dangerSmallBtnStyle}
                            >
                              삭제
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── 삭제 확인 다이얼로그 ── */}
      {deleteTarget && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.45)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 1000,
        }}>
          <div style={{
            width: 360, padding: 24,
            background: "var(--color-bg-card)",
            borderRadius: 8, border: "1px solid var(--color-border)",
            display: "flex", flexDirection: "column", gap: 12,
          }}>
            <p style={{ fontSize: 14, color: "var(--color-text-primary)", margin: 0 }}>
              <strong>&ldquo;{deleteTarget.tmplNm}&rdquo;</strong> 양식을 삭제하시겠습니까?
            </p>
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: 0 }}>
              삭제된 양식은 복구할 수 없습니다.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button style={secondaryBtnStyle} onClick={() => setDeleteTarget(null)}>취소</button>
              <button
                style={dangerBtnStyle}
                onClick={() => deleteMutation.mutate(deleteTarget.dsgnTmplId)}
                disabled={deleteMutation.isPending}
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

// ── 스타일 상수 ───────────────────────────────────────────────────────────────

const primaryBtnStyle: React.CSSProperties = {
  padding: "5px 14px", borderRadius: 6,
  border: "1px solid transparent",
  background: "var(--color-brand)", color: "var(--color-text-inverse)",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "6px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)", color: "var(--color-text-primary)",
  fontSize: 13, cursor: "pointer",
};

const dangerBtnStyle: React.CSSProperties = {
  padding: "6px 16px", borderRadius: 6,
  border: "1px solid transparent",
  background: "var(--color-error)", color: "var(--color-text-inverse)",
  fontSize: 13, fontWeight: 600, cursor: "pointer",
};

const secondarySmallBtnStyle: React.CSSProperties = {
  padding: "3px 10px", borderRadius: 5,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)", color: "var(--color-text-primary)",
  fontSize: 11, cursor: "pointer",
};

const dangerSmallBtnStyle: React.CSSProperties = {
  padding: "3px 10px", borderRadius: 5,
  border: "none",
  background: "var(--color-error-subtle)", color: "var(--color-error)",
  fontSize: 11, fontWeight: 600, cursor: "pointer",
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
