"use client";

/**
 * PromptTemplatesPage — AI 프롬프트 템플릿 목록 (프롬프트 관리)
 *
 * 역할:
 *   - 프로젝트 및 시스템 공통 AI 프롬프트 템플릿 목록 조회
 *   - sort_ordr ASC 정렬, 사용 여부(use_yn) 시각적 강조
 *   - 이용 건수(use_cnt) 표시
 *   - 행 클릭 → 상세/편집 페이지 이동
 *   - 신규 등록 버튼 → /prompt-templates/new
 *
 * 주요 기술:
 *   - TanStack Query: 목록 조회 및 삭제 후 캐시 무효화
 *   - authFetch: 인증 헤더 자동 포함
 */

import { Suspense, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";
import { useEffect } from "react";
import { type PromptTemplateTaskType, PROMPT_TEMPLATE_TASK_TYPE_LABEL } from "@/constants/codes";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type RefType  = "AREA" | "FUNCTION";

type TemplateRow = {
  tmplId:     string;
  projectId:  string | null;
  isSystem:   boolean;
  tmplNm:     string;
  taskTyCode: PromptTemplateTaskType;
  refTyCode:  RefType | null;
  tmplDc:     string;
  useYn:      string;
  defaultYn:  string;
  sortOrdr:   number;
  useCnt:     number;
  creatDt:    string;
  mdfcnDt:    string;
};

// ── 상수 ──────────────────────────────────────────────────────────────────────
// 태스크 타입 라벨은 공용 PROMPT_TEMPLATE_TASK_TYPE_LABEL 사용.
// RefType 라벨은 이 페이지에서 "영역 설계/기능 설계" 식 접미사가 붙어 있어 공용(영역/기능)과 다름 → 로컬 유지.

const REF_TYPE_LABELS: Record<string, string> = {
  AREA:      "영역 설계",
  FUNCTION:  "기능 설계",
  UNIT_WORK: "단위업무",
};

const taskTypeBadgeColors: Record<PromptTemplateTaskType, { bg: string; color: string }> = {
  DESIGN:    { bg: "#f3e5f5", color: "#6a1b9a" },
  INSPECT:   { bg: "#e3f2fd", color: "#1565c0" },
  IMPACT:    { bg: "#fff3e0", color: "#e65100" },
  IMPLEMENT: { bg: "#fce4ec", color: "#c62828" },
  TEST:      { bg: "#e8f5e9", color: "#2e7d32" },
  // 폐기 유형 — 회색으로 표시
  MOCKUP:    { bg: "#f5f5f5", color: "#9e9e9e" },
  CUSTOM:    { bg: "#f5f5f5", color: "#9e9e9e" },
  PRE_IMPL:  { bg: "#f5f5f5", color: "#9e9e9e" },
};

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function PromptTemplatesPage() {
  return (
    <Suspense fallback={null}>
      <PromptTemplatesPageInner />
    </Suspense>
  );
}

function PromptTemplatesPageInner() {
  const params    = useParams();
  const router    = useRouter();
  const qc        = useQueryClient();
  const projectId = params.id as string;

  const { setBreadcrumb } = useAppStore();
  useEffect(() => {
    setBreadcrumb([{ label: "프롬프트 관리" }]);
  }, [setBreadcrumb]);

  // ── 필터 상태 ────────────────────────────────────────────────────────────────
  const [taskTypeFilter, setTaskTypeFilter] = useState("");
  const [refTypeFilter,  setRefTypeFilter]  = useState("");
  const [useYnFilter,    setUseYnFilter]    = useState("");

  // ── 삭제 확인 다이얼로그 ──────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<{ tmplId: string; tmplNm: string } | null>(null);

  // ── 데이터 조회 ───────────────────────────────────────────────────────────────
  const queryParams = new URLSearchParams();
  if (taskTypeFilter) queryParams.set("taskType", taskTypeFilter);
  if (refTypeFilter)  queryParams.set("refType",  refTypeFilter);
  if (useYnFilter)    queryParams.set("useYn",    useYnFilter);
  const qs = queryParams.toString() ? `?${queryParams.toString()}` : "";

  const { data: rows = [], isLoading } = useQuery<TemplateRow[]>({
    queryKey: ["prompt-templates", projectId, taskTypeFilter, refTypeFilter, useYnFilter],
    queryFn: () =>
      authFetch<{ data: TemplateRow[] }>(`/api/projects/${projectId}/prompt-templates${qs}`)
        .then((r) => r.data),
  });

  // ── 삭제 뮤테이션 ──────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (tmplId: string) =>
      authFetch(`/api/projects/${projectId}/prompt-templates/${tmplId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prompt-templates", projectId] });
      toast.success("템플릿이 삭제되었습니다.");
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
          프롬프트 관리
        </div>
        <button
          onClick={() => router.push(`/projects/${projectId}/prompt-templates/new`)}
          style={primaryBtnStyle}
        >
          + 신규 등록
        </button>
      </div>

      <div style={{ padding: "0 24px 24px" }}>

        {/* ── 필터 바 ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <select
            value={taskTypeFilter}
            onChange={(e) => setTaskTypeFilter(e.target.value)}
            style={filterSelectStyle}
          >
            <option value="">전체 유형</option>
            {Object.entries(PROMPT_TEMPLATE_TASK_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>

          <select
            value={refTypeFilter}
            onChange={(e) => setRefTypeFilter(e.target.value)}
            style={filterSelectStyle}
          >
            <option value="">전체 사용처</option>
            <option value="AREA">영역 설계 (AREA)</option>
            <option value="FUNCTION">기능 설계 (FUNCTION)</option>
            <option value="UNIT_WORK">단위업무 (UNIT_WORK)</option>
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

          {(taskTypeFilter || refTypeFilter || useYnFilter) && (
            <button
              onClick={() => { setTaskTypeFilter(""); setRefTypeFilter(""); setUseYnFilter(""); }}
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
            gridTemplateColumns: "28% 11% 8% 5% 5% 7% 10% 9%",
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
            <span>액션</span>
          </div>

          {/* 바디 */}
          {isLoading ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
              로딩 중...
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
              등록된 프롬프트 템플릿이 없습니다.
            </div>
          ) : (
            rows.map((row, idx) => {
              const tc        = taskTypeBadgeColors[row.taskTyCode] ?? { bg: "#f5f5f5", color: "#555" };
              const active    = row.useYn === "Y";
              const isDefault = row.defaultYn === "Y";
              return (
                <div
                  key={row.tmplId}
                  onClick={() => router.push(`/projects/${projectId}/prompt-templates/${row.tmplId}`)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "28% 11% 8% 5% 5% 7% 10% 9%",
                    padding: "12px 16px",
                    paddingLeft: active ? 16 : 13,
                    borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                    borderLeft: active ? "3px solid transparent" : "3px solid #bdbdbd",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    background: active ? "var(--color-bg-card)" : "#fafafa",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover, #f0f4ff)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = active ? "var(--color-bg-card)" : "#fafafa")}
                >
                  {/* 템플릿 명 */}
                  <div style={{ overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {row.isSystem && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                          background: "var(--color-primary)", color: "#fff", flexShrink: 0,
                        }}>
                          공통
                        </span>
                      )}
                      {isDefault && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                          background: "#37474f", color: "#fff", flexShrink: 0,
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

                  {/* 대상 범위 */}
                  <div style={{ textAlign: "center" }}>
                    <span style={{
                      display: "inline-block", padding: "2px 8px",
                      borderRadius: 4, fontSize: 11, fontWeight: 600,
                      background: row.refTyCode === "FUNCTION" ? "#e8f5e9"
                                : row.refTyCode === "AREA"     ? "#e3f2fd"
                                : "#f5f5f5",
                      color:      row.refTyCode === "FUNCTION" ? "#2e7d32"
                                : row.refTyCode === "AREA"     ? "#1565c0"
                                : "#888",
                      whiteSpace: "nowrap",
                    }}>
                      {row.refTyCode ? REF_TYPE_LABELS[row.refTyCode] ?? row.refTyCode : "범용"}
                    </span>
                  </div>

                  {/* 정렬 */}
                  <span style={{ fontSize: 13, color: "var(--color-text-secondary)", textAlign: "right", paddingRight: 8 }}>
                    {row.sortOrdr}
                  </span>

                  {/* 이용 건수 */}
                  <span style={{ fontSize: 13, color: "var(--color-text-secondary)", textAlign: "right", paddingRight: 8 }}>
                    {row.useCnt.toLocaleString()}
                  </span>

                  {/* 사용 여부 */}
                  <div style={{ textAlign: "center" }}>
                    <span style={{
                      display: "inline-block", padding: "2px 8px",
                      borderRadius: 4, fontSize: 11, fontWeight: 600,
                      background: active ? "#e8f5e9" : "transparent",
                      color:      active ? "#2e7d32" : "#9e9e9e",
                      border:     active ? "none" : "1px dashed #bdbdbd",
                    }}>
                      {active ? "사용" : "미사용"}
                    </span>
                  </div>

                  {/* 수정일 */}
                  <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                    {row.mdfcnDt.slice(0, 10)}
                  </span>

                  {/* 액션 — default_yn=Y인 시스템 기본 프롬프트는 편집·삭제 불가 */}
                  <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    {!isDefault && (
                      <button
                        onClick={() => router.push(`/projects/${projectId}/prompt-templates/${row.tmplId}`)}
                        style={secondarySmallBtnStyle}
                      >
                        편집
                      </button>
                    )}
                    {!isDefault && !row.isSystem && (
                      <button
                        onClick={() => setDeleteTarget({ tmplId: row.tmplId, tmplNm: row.tmplNm })}
                        style={dangerSmallBtnStyle}
                      >
                        삭제
                      </button>
                    )}
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
              <strong>"{deleteTarget.tmplNm}"</strong> 템플릿을 삭제하시겠습니까?
            </p>
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: 0 }}>
              삭제된 템플릿은 복구할 수 없습니다.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button style={secondaryBtnStyle} onClick={() => setDeleteTarget(null)}>취소</button>
              <button
                style={dangerBtnStyle}
                onClick={() => deleteMutation.mutate(deleteTarget.tmplId)}
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
  background: "var(--color-primary, #1976d2)", color: "#fff",
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
  background: "#e53935", color: "#fff",
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
  background: "#fdecea", color: "#e53935",
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
  minWidth:           120,
};
