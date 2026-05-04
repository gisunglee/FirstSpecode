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
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";
import { useEffect } from "react";
import {
  type PromptTemplateTaskType,
  type PromptTemplateRefType,
  PROMPT_TEMPLATE_TASK_TYPE_LABEL,
} from "@/constants/codes";
import { ARTF_DIV } from "@/constants/planStudio";
import { type PromptDomain, parsePromptDomain } from "@/lib/prompt-template/domain";
import { useIsSystemAdmin, useMyRole } from "@/hooks/useMyRole";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type TemplateRow = {
  tmplId:     string;
  projectId:  string | null;
  isSystem:   boolean;
  tmplNm:     string;
  taskTyCode: PromptTemplateTaskType;
  refTyCode:  PromptTemplateRefType | null;
  // 기획실(PLAN_STUDIO_ARTF) 전용 매트릭스 — 그 외 사용처는 null
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
// 태스크 타입 라벨은 공용 PROMPT_TEMPLATE_TASK_TYPE_LABEL 사용.
// RefType 라벨은 이 페이지에서 "영역 설계/기능 설계" 식 접미사가 붙어 있어 공용(영역/기능)과 다름 → 로컬 유지.

const REF_TYPE_LABELS: Record<string, string> = {
  UNIT_WORK:        "단위업무",
  SCREEN:           "화면",
  AREA:             "영역 설계",
  FUNCTION:         "기능 설계",
  PLAN_STUDIO_ARTF: "기획실",
};

// 작업 유형 배지 색상 — semantic 토큰으로 3테마 자동 대응.
//   DESIGN(보라)→brand, INSPECT(파랑)→info, IMPACT(주황)→warning,
//   IMPLEMENT(빨강)→error, TEST(초록)→success,
//   PLAN_STUDIO_ARTF_GENERATE(파랑)→info — 기획실 산출물 생성
//   폐기 유형→muted+tertiary
const taskTypeBadgeColors: Record<PromptTemplateTaskType, { bg: string; color: string }> = {
  DESIGN:                    { bg: "var(--color-brand-subtle)",   color: "var(--color-brand)"   },
  INSPECT:                   { bg: "var(--color-info-subtle)",    color: "var(--color-info)"    },
  IMPACT:                    { bg: "var(--color-warning-subtle)", color: "var(--color-warning)" },
  IMPLEMENT:                 { bg: "var(--color-error-subtle)",   color: "var(--color-error)"   },
  TEST:                      { bg: "var(--color-success-subtle)", color: "var(--color-success)" },
  PLAN_STUDIO_ARTF_GENERATE: { bg: "var(--color-info-subtle)",    color: "var(--color-info)"    },
  // 폐기 유형 — 흐린 회색
  MOCKUP:    { bg: "var(--color-bg-muted)", color: "var(--color-text-tertiary)" },
  CUSTOM:    { bg: "var(--color-bg-muted)", color: "var(--color-text-tertiary)" },
  PRE_IMPL:  { bg: "var(--color-bg-muted)", color: "var(--color-text-tertiary)" },
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
  const params       = useParams();
  const router       = useRouter();
  const searchParams = useSearchParams();
  const qc           = useQueryClient();
  const projectId    = params.id as string;

  // 권한 — DEFAULT 편집은 SUPER_ADMIN 만, 프로젝트 복사본 편집/삭제/복사는 OWNER/ADMIN 만
  //   (SUPER_ADMIN 은 프로젝트 역할 관계없이 어디든 편집 가능 — hasPermission short-circuit)
  const { isSystemAdmin } = useIsSystemAdmin();
  const { myRole } = useMyRole(projectId);
  const isProjectAdmin = myRole === "OWNER" || myRole === "ADMIN";
  const canCreateOrCopy = isSystemAdmin || isProjectAdmin;

  const { setBreadcrumb } = useAppStore();
  useEffect(() => {
    setBreadcrumb([{ label: "프롬프트 관리" }]);
    // 언마운트 시 초기화 — 다른 페이지 이동 후에도 GNB 브레드크럼이 잔존하는 문제 방지
    return () => setBreadcrumb([]);
  }, [setBreadcrumb]);

  // ── 도메인 탭 (URL 단일 진실의 원천) ──────────────────────────────────────────
  // 새로고침/뒤로가기/링크 공유에 안전하도록 useState 대신 URL 쿼리에서 직접 파싱.
  // 잘못된 값이거나 미지정이면 "general" 기본.
  const activeTab: PromptDomain = parsePromptDomain(searchParams.get("tab")) ?? "general";
  const setActiveTab = (next: PromptDomain) => {
    // 탭 전환 시 다른 필터는 유지하되 도메인 컨텍스트가 바뀌었으므로
    // 기획실 전용/일반 전용 필터는 비워서 잘못된 조회 방지.
    const next_qs = new URLSearchParams(searchParams.toString());
    next_qs.set("tab", next);
    next_qs.delete("refType");
    next_qs.delete("divCode");
    router.replace(`?${next_qs.toString()}`);
  };

  // ── 필터 상태 ────────────────────────────────────────────────────────────────
  const [taskTypeFilter, setTaskTypeFilter] = useState("");
  // 일반 탭 전용: 사용처 필터 (UNIT_WORK/SCREEN/AREA/FUNCTION)
  const [refTypeFilter,  setRefTypeFilter]  = useState("");
  // 기획실 탭 전용: 산출물 구분 필터 (IA/JOURNEY/...)
  const [divCodeFilter,  setDivCodeFilter]  = useState("");
  const [useYnFilter,    setUseYnFilter]    = useState("");

  // ── 삭제 확인 다이얼로그 ──────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<{ tmplId: string; tmplNm: string } | null>(null);

  // ── 데이터 조회 ───────────────────────────────────────────────────────────────
  // 탭은 항상 도메인 파라미터로 서버에 전달 — 서버에서 ref_ty_code 기준으로 분류한 결과만 반환
  const queryParams = new URLSearchParams();
  queryParams.set("domain", activeTab);
  if (taskTypeFilter) queryParams.set("taskType", taskTypeFilter);
  if (activeTab === "general"    && refTypeFilter) queryParams.set("refType", refTypeFilter);
  if (activeTab === "plan-studio" && divCodeFilter) queryParams.set("divCode", divCodeFilter);
  if (useYnFilter) queryParams.set("useYn", useYnFilter);
  const qs = `?${queryParams.toString()}`;

  const { data: rows = [], isLoading } = useQuery<TemplateRow[]>({
    queryKey: ["prompt-templates", projectId, activeTab, taskTypeFilter, refTypeFilter, divCodeFilter, useYnFilter],
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
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          프롬프트 관리
        </div>
        {/* 신규 등록 — OWNER/ADMIN 또는 SUPER_ADMIN 만. 나머지는 버튼 자체 노출 X */}
        {canCreateOrCopy && (
          <button
            onClick={() => router.push(`/projects/${projectId}/prompt-templates/new`)}
            style={primaryBtnStyle}
          >
            + 신규 등록
          </button>
        )}
      </div>

      {/* ── 도메인 탭 — 일반 / 기획실 ── */}
      <div style={{
        display: "flex", gap: 0,
        padding: "0 24px",
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        <TabButton
          active={activeTab === "general"}
          onClick={() => setActiveTab("general")}
          label="일반"
        />
        <TabButton
          active={activeTab === "plan-studio"}
          onClick={() => setActiveTab("plan-studio")}
          label="기획실"
        />
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

          {/* 도메인 별 컨텍스트 필터 — 일반 탭은 사용처, 기획실 탭은 산출물 구분 */}
          {activeTab === "general" ? (
            <select
              value={refTypeFilter}
              onChange={(e) => setRefTypeFilter(e.target.value)}
              style={filterSelectStyle}
            >
              <option value="">전체 사용처</option>
              <option value="UNIT_WORK">단위업무 (UNIT_WORK)</option>
              <option value="SCREEN">화면 (SCREEN)</option>
              <option value="AREA">영역 설계 (AREA)</option>
              <option value="FUNCTION">기능 설계 (FUNCTION)</option>
            </select>
          ) : (
            <select
              value={divCodeFilter}
              onChange={(e) => setDivCodeFilter(e.target.value)}
              style={filterSelectStyle}
            >
              <option value="">전체 산출물</option>
              {Object.values(ARTF_DIV).map((d) => (
                <option key={d.code} value={d.code}>{d.name} ({d.code})</option>
              ))}
            </select>
          )}

          <select
            value={useYnFilter}
            onChange={(e) => setUseYnFilter(e.target.value)}
            style={filterSelectStyle}
          >
            <option value="">사용 여부</option>
            <option value="Y">사용</option>
            <option value="N">미사용</option>
          </select>

          {(taskTypeFilter || refTypeFilter || divCodeFilter || useYnFilter) && (
            <button
              onClick={() => {
                setTaskTypeFilter("");
                setRefTypeFilter("");
                setDivCodeFilter("");
                setUseYnFilter("");
              }}
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
            <div style={{ padding: "64px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 14 }}>
              로딩 중...
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 14 }}>
              {activeTab === "plan-studio"
                ? "기획실 프롬프트가 없습니다."
                : "일반 프롬프트가 없습니다."}
            </div>
          ) : (
            rows.map((row, idx) => {
              const tc        = taskTypeBadgeColors[row.taskTyCode] ?? { bg: "var(--color-bg-muted)", color: "var(--color-text-secondary)" };
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
                  {/* 템플릿 명 */}
                  <div style={{ overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {/* [공통] 배지는 [DEFAULT] 와 의미가 거의 겹쳐 제거됨.
                          편집 가능 여부의 판단 신호로는 [DEFAULT] 만 유지. */}
                      {isDefault && (
                        // DEFAULT 배지 — "편집 불가" 강조. text-primary 배경 + text-inverse 글자로
                        // 3테마 모두 컨트라스트 유지(어두운 테마에선 밝은 배지, 밝은 테마에선 어두운 배지).
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

                  {/* 대상 범위 — FUNCTION→success, AREA→info, PLAN_STUDIO_ARTF→brand, 그 외→muted */}
                  {/* 기획실 산출물은 div·fmt 까지 같이 표시 (예: "기획실 IA·MD") */}
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

                  {/* 액션 — DEFAULT(공통/기본): SUPER_ADMIN 만 편집·삭제
                             프로젝트 복사본:    OWNER/ADMIN 만 편집·삭제
                             그 외:              버튼 자체 비노출 (서버도 403 으로 차단) */}
                  <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const rowIsDefault = isDefault || row.isSystem;
                      const canEditThisRow = rowIsDefault ? isSystemAdmin : isProjectAdmin;
                      if (!canEditThisRow) return null;
                      return (
                        <>
                          <button
                            onClick={() => router.push(`/projects/${projectId}/prompt-templates/${row.tmplId}`)}
                            style={secondarySmallBtnStyle}
                          >
                            편집
                          </button>
                          {/* DEFAULT 는 삭제 금지 (SUPER_ADMIN 도 seed 관리 경로로만 삭제) */}
                          {!rowIsDefault && (
                            <button
                              onClick={() => setDeleteTarget({ tmplId: row.tmplId, tmplNm: row.tmplNm })}
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

// ── 도메인 탭 버튼 ────────────────────────────────────────────────────────────
//
// 활성 상태: brand 색 밑줄 + 굵은 글씨 (3테마 자동 대응).
// 비활성 상태: secondary 텍스트 + 투명 보더 (위치 안 흔들리도록 같은 두께 보더 유지).

function TabButton({
  active, onClick, label,
}: {
  active:  boolean;
  onClick: () => void;
  label:   string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding:    "10px 16px",
        background: "none",
        border:     "none",
        // 활성 탭만 brand 색 밑줄 — 위치 안 흔들리도록 비활성도 같은 두께의 투명 보더 유지
        borderBottom: active ? "2px solid var(--color-brand)" : "2px solid transparent",
        marginBottom: -1,   // 부모의 borderBottom 과 시각적으로 겹치도록
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
  minWidth:           120,
};
