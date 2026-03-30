"use client";

/**
 * FunctionDetailPage — 기능 상세·편집 (PID-00051)
 *
 * 역할:
 *   - 기능 상세 조회 (FID-00171)
 *   - 기능 생성/수정 + 명세 편집 (FID-00172, 00173)
 *   - AI 명세 누락 검토 요청 (FID-00174)
 *   - AI 영향도 분석 요청 (FID-00175)
 *   - 하단 컬럼 매핑 목록 (FID-00178)
 *   - 컬럼 매핑 관리 팝업 (PID-00053 / FID-00181)
 *
 * 주요 기술:
 *   - TanStack Query: 상세 조회 및 뮤테이션
 *   - functionId === "new"이면 신규 모드
 */

import { Suspense, useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import MarkdownEditor from "@/components/ui/MarkdownEditor";
import SettingsHistoryDialog from "@/components/ui/SettingsHistoryDialog";
import ColMappingDialog from "@/components/ui/ColMappingDialog";
import AreaAttachFiles from "@/components/ui/AreaAttachFiles";
import { useAppStore } from "@/store/appStore";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type AiTaskInfo = { aiTaskId: string; status: string };

type FuncDetail = {
  funcId:              string;
  displayId:           string;
  name:                string;
  description:         string;
  commentCn:           string;
  type:                string;
  status:              string;
  priority:            string;
  complexity:          string;
  effort:              string;
  assignMemberId:      string | null;
  implStartDate:       string;
  implEndDate:         string;
  sortOrder:           number;
  areaId:              string | null;
  areaName:            string;
  aiTasks:             Record<string, AiTaskInfo>;
  // migration 후 활성화
  assignWorkStatus:    string;
  reviewStatus:        string;
  progressRate:        number;
};

type AreaOption = { areaId: string; displayId: string; name: string };

type ColMappingItem = {
  mappingId:    string;
  usePurpsCn:  string;
  ioSeCode:    string;
  uiTyCode:    string;
  tableName:   string;
  colName:     string;
  sortOrder:   number;
};;

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function FunctionDetailPage() {
  return (
    <Suspense fallback={null}>
      <FunctionDetailPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function FunctionDetailPageInner() {
  const params         = useParams<{ id: string; functionId: string }>();
  const router         = useRouter();
  const searchParams   = useSearchParams();
  const queryClient    = useQueryClient();
  const { setBreadcrumb } = useAppStore();
  const projectId      = params.id;
  const functionId     = params.functionId;
  const isNew        = functionId === "new";
  const presetAreaId = searchParams.get("areaId") ?? "";

  // ── 설명 예시 팝업 상태 ────────────────────────────────────────────────────
  const [descExampleOpen, setDescExampleOpen] = useState(false);

  // ── 변경 이력 관련 상태 ────────────────────────────────────────────────────
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyViewOpen,   setHistoryViewOpen]   = useState(false);
  const [originalDescription, setOriginalDescription] = useState("");

  // ── 폼 상태 ────────────────────────────────────────────────────────────────
  const [name,           setName]           = useState("");
  const [type,           setType]           = useState("OTHER");
  const [description,    setDescription]    = useState("");
  const [priority,       setPriority]       = useState("MEDIUM");
  const [complexity,     setComplexity]     = useState("MEDIUM");
  const [effort,         setEffort]         = useState("");
  const [assignMemberId, setAssignMemberId] = useState("");
  const [implStartDate,  setImplStartDate]  = useState("");
  const [implEndDate,    setImplEndDate]    = useState("");
  const [areaId,         setAreaId]         = useState(presetAreaId);
  const [sortOrder,      setSortOrder]      = useState(0);

  // ── AI 요청 코멘트 상태 ────────────────────────────────────────────────────
  const [commentCn,        setCommentCn]        = useState("");

  // ── 작업/검토 상태·진척률 ─────────────────────────────────────────────────
  const [assignWorkStatus, setAssignWorkStatus] = useState("BEFORE");
  const [reviewStatus,     setReviewStatus]     = useState("BEFORE");
  const [progressRate,     setProgressRate]     = useState(0);

  // 담당자 작업 상태 변경 시 완료면 진척률 자동 100%
  function handleWorkStatusChange(val: string) {
    setAssignWorkStatus(val);
    if (val === "DONE") setProgressRate(100);
  }

  // ── 상태 즉시 저장 (작업상태·진척률·검토상태 변경 시) ─────────────────────
  // 데이터 로드 후에만 동작하도록 초기화 플래그 사용
  const statusInitialized = useRef(false);

  const statusMutation = useMutation({
    mutationFn: (vals: { assignWorkStatus: string; progressRate: number; reviewStatus: string }) =>
      authFetch(`/api/projects/${projectId}/functions/${functionId}`, {
        method: "PUT",
        body: JSON.stringify({
          areaId: areaId || null,
          name: name.trim() || "미입력",
          type, description: description.trim(),
          commentCn: commentCn.trim(),
          assignWorkStatus: vals.assignWorkStatus,
          reviewStatus:     vals.reviewStatus,
          progressRate:     vals.assignWorkStatus === "DONE" ? 100 : vals.progressRate,
          priority, complexity, effort: effort.trim(),
          assignMemberId: assignMemberId || null,
          implStartDate: implStartDate || null,
          implEndDate:   implEndDate || null,
          sortOrder,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["function", projectId, functionId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  useEffect(() => {
    if (isNew || !statusInitialized.current) return;
    statusMutation.mutate({ assignWorkStatus, progressRate, reviewStatus });
  // statusMutation 은 의존성에서 제외 (stale closure 안전 — 값만 전달하므로)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignWorkStatus, progressRate, reviewStatus]);

  // ── 컬럼 매핑 팝업 ─────────────────────────────────────────────────────────
  const [mappingPopupOpen, setMappingPopupOpen] = useState(false);

  // ── 컬럼 매핑 목록 조회 (기존 저장 데이터 표시용) ──────────────────────────
  const { data: colMappingsData, refetch: refetchMappings } = useQuery({
    queryKey: ["col-mappings", projectId, "FUNCTION", functionId],
    queryFn:  () =>
      authFetch<{ data: { items: ColMappingItem[] } }>(
        `/api/projects/${projectId}/col-mappings?refType=FUNCTION&refId=${functionId}`
      ).then((r) => r.data),
    enabled: !isNew,
  });
  const colMappings = colMappingsData?.items ?? [];

  // ── 영역 목록 (areaId 선택용) ──────────────────────────────────────────────
  const { data: areasData } = useQuery({
    queryKey: ["areas", projectId],
    queryFn:  () =>
      authFetch<{ data: { items: AreaOption[] } }>(`/api/projects/${projectId}/areas`)
        .then((r) => r.data),
  });
  const areaOptions = areasData?.items ?? [];

  // ── 기능 상세 조회 ────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["function", projectId, functionId],
    queryFn:  () =>
      authFetch<{ data: FuncDetail }>(`/api/projects/${projectId}/functions/${functionId}`)
        .then((r) => r.data),
    enabled: !isNew,
  });

  // GNB 브레드크럼 설정 — 마운트 시 설정, 언마운트 시 초기화
  useEffect(() => {
    const items = [
      { label: "기능 정의", href: `/projects/${projectId}/functions` },
      ...(data?.areaName ? [{ label: data.areaName }] : []),
      { label: isNew ? "신규 등록" : (data?.displayId ?? "편집") },
    ];
    setBreadcrumb(items);
    return () => setBreadcrumb([]);
  }, [projectId, isNew, data?.areaName, data?.displayId, setBreadcrumb]);

  useEffect(() => {
    if (data) {
      setName(data.name);
      setType(data.type);
      setDescription(data.description);
      setPriority(data.priority);
      setComplexity(data.complexity);
      setEffort(data.effort);
      setAssignMemberId(data.assignMemberId ?? "");
      setImplStartDate(data.implStartDate);
      setImplEndDate(data.implEndDate);
      setAreaId(data.areaId ?? "");
      setSortOrder(data.sortOrder ?? 0);
      setCommentCn(data.commentCn ?? "");
      setAssignWorkStatus(data.assignWorkStatus ?? "BEFORE");
      setReviewStatus(data.reviewStatus ?? "BEFORE");
      setProgressRate(data.progressRate ?? 0);
      // 설명 변경 감지를 위해 원본 값 보관
      setOriginalDescription(data.description ?? "");
      // 초기 로드 완료 — 이후 상태 변경은 즉시 저장
      statusInitialized.current = true;
    }
  }, [data]);

  // ── 저장 뮤테이션 ──────────────────────────────────────────────────────────
  const saveMutation = useMutation<{ data: { funcId?: string } }, Error, { saveHistory?: boolean }>({
    mutationFn: ({ saveHistory } = {}) => {
      const body = {
        areaId: areaId || null,
        name: name.trim(), type, description: description.trim(),
        commentCn: commentCn.trim(),
        assignWorkStatus,
        reviewStatus,
        // 작업 완료 시 진척률 강제 100%
        progressRate: assignWorkStatus === "DONE" ? 100 : progressRate,
        priority, complexity, effort: effort.trim(),
        assignMemberId: assignMemberId || null,
        implStartDate: implStartDate || null,
        implEndDate:   implEndDate || null,
        sortOrder,
        saveHistory:   saveHistory || undefined,
      };
      if (isNew) {
        return authFetch<{ data: { funcId?: string } }>(`/api/projects/${projectId}/functions`, {
          method: "POST", body: JSON.stringify(body),
        });
      }
      return authFetch<{ data: { funcId?: string } }>(`/api/projects/${projectId}/functions/${functionId}`, {
        method: "PUT", body: JSON.stringify(body),
      });
    },
    onSuccess: (res, variables) => {
      toast.success(isNew ? "기능이 등록되었습니다." : "저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["functions", projectId] });
      if (isNew && res.data.funcId) {
        router.replace(`/projects/${projectId}/functions/${res.data.funcId}`);
      } else {
        queryClient.invalidateQueries({ queryKey: ["function", projectId, functionId] });
        setOriginalDescription(description.trim());
        if (variables?.saveHistory) {
          queryClient.invalidateQueries({ queryKey: ["settings-history", projectId] });
        }
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── AI 컨펌 상태 ──────────────────────────────────────────────────────────
  const [aiConfirm, setAiConfirm] = useState<{ taskType: string; label: string } | null>(null);

  // ── AI 요청 뮤테이션 ──────────────────────────────────────────────────────
  const aiMutation = useMutation({
    mutationFn: ({ taskType }: { taskType: string }) =>
      authFetch(`/api/projects/${projectId}/functions/${functionId}/ai`, {
        method: "POST",
        body: JSON.stringify({ taskType, comment: commentCn.trim() || undefined }),
      }),
    onSuccess: (_res, vars) => {
      const labels: Record<string, string> = {
        DESIGN:  "AI 설계 요청이 접수되었습니다.",
        INSPECT: "AI 점검 요청이 접수되었습니다.",
        IMPACT:  "AI 영향도 분석 요청이 접수되었습니다.",
      };
      toast.success(labels[vars.taskType] ?? "AI 요청이 접수되었습니다.");
      // 상태 갱신을 위해 상세 재조회
      queryClient.invalidateQueries({ queryKey: ["function", projectId, functionId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!isNew && isLoading) return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;

  return (
    <div style={{ padding: 0 }}>

      {/* 타이틀 행 — full-width 배경, 좌: ← 타이틀 | 중: 상태 배지(HTML) | 우: 취소·저장 */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16,
        padding: "10px 24px",
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>

        {/* 좌: 뒤로 + 타이틀 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/functions`)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1 }}
          >
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {isNew ? "기능 신규 등록" : `${data?.displayId ?? ""} 기능 편집`}
          </span>
        </div>

        {/* 중: 현황 패널 (작업상태 · 진척률 · 검토상태) */}
        {!isNew && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "5px 12px",
            background: "linear-gradient(135deg, rgba(var(--color-primary-rgb, 25,118,210), 0.06) 0%, transparent 100%)",
            border: "1px solid rgba(var(--color-primary-rgb, 25,118,210), 0.18)",
            borderLeft: "3px solid var(--color-primary, #1976d2)",
            borderRadius: 8,
          }}>
            {/* 작업 상태 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontSize: 9, color: "var(--color-text-secondary)", fontWeight: 600, letterSpacing: "0.05em" }}>작업상태</span>
              <select
                value={assignWorkStatus}
                onChange={(e) => handleWorkStatusChange(e.target.value)}
                style={{
                  ...statusSelectStyle,
                  ...(assignWorkStatus === "DONE"        ? { borderColor: "#2e7d32", color: "#2e7d32" }
                    : assignWorkStatus === "IN_PROGRESS" ? { borderColor: "var(--color-primary, #1976d2)", color: "var(--color-primary, #1976d2)" }
                    : {}),
                }}
              >
                <option value="BEFORE">작업 전</option>
                <option value="IN_PROGRESS">작업 중</option>
                <option value="DONE">작업 완료</option>
              </select>
            </div>

            <div style={{ width: 1, height: 28, background: "var(--color-border)" }} />

            {/* 진척률 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 130 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 9, color: "var(--color-text-secondary)", fontWeight: 600, letterSpacing: "0.05em" }}>진척률</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: "var(--color-primary, #1976d2)" }}>
                  {assignWorkStatus === "DONE" ? 100 : progressRate}%
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ flex: 1, height: 4, background: "var(--color-border)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${assignWorkStatus === "DONE" ? 100 : progressRate}%`,
                    background: assignWorkStatus === "DONE" ? "#2e7d32" : "var(--color-primary, #1976d2)",
                    borderRadius: 2,
                    transition: "width 0.3s ease",
                  }} />
                </div>
                <select
                  value={assignWorkStatus === "DONE" ? 100 : progressRate}
                  onChange={(e) => setProgressRate(Number(e.target.value))}
                  disabled={assignWorkStatus === "DONE"}
                  style={{ ...statusSelectStyle, minWidth: 56, opacity: assignWorkStatus === "DONE" ? 0.5 : 1 }}
                >
                  {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => (
                    <option key={v} value={v}>{v}%</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ width: 1, height: 28, background: "var(--color-border)" }} />

            {/* 검토 상태 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontSize: 9, color: "var(--color-text-secondary)", fontWeight: 600, letterSpacing: "0.05em" }}>검토상태</span>
              <select
                value={reviewStatus}
                onChange={(e) => setReviewStatus(e.target.value)}
                style={{
                  ...statusSelectStyle,
                  ...(reviewStatus === "DONE"      ? { borderColor: "#2e7d32", color: "#2e7d32" }
                    : reviewStatus === "IN_REVIEW" ? { borderColor: "var(--color-primary, #1976d2)", color: "var(--color-primary, #1976d2)" }
                    : reviewStatus === "FEEDBACK"  ? { borderColor: "#e65100", color: "#e65100" }
                    : {}),
                }}
              >
                <option value="BEFORE">검토 전</option>
                <option value="IN_REVIEW">검토 중</option>
                <option value="FEEDBACK">피드백 필요</option>
                <option value="DONE">검토 완료</option>
              </select>
            </div>
          </div>
        )}

        {/* 우측 밀어내기 스페이서 */}
        <div style={{ flex: 1 }} />

        {/* 우: AI 버튼 + 구분선 + 취소·저장 */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <style>{`@keyframes _spin{to{transform:rotate(360deg)}}`}</style>

          {/* AI 요청 버튼들 — 신규 모드에서는 disabled */}
          <>
            {AI_TASK_CONFIGS.map(({ taskType, label }) => {
              const info = data?.aiTasks?.[taskType];
              const isSpinning = !isNew && (aiMutation.isPending && aiMutation.variables?.taskType === taskType)
                || !isNew && (info && ["PENDING", "IN_PROGRESS"].includes(info.status));
              return (
                <div key={taskType} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button
                    onClick={() => {
                      if (!description.trim()) {
                        toast.error("설명을 먼저 입력해 주세요.");
                        return;
                      }
                      setAiConfirm({ taskType, label });
                    }}
                    disabled={isNew || aiMutation.isPending}
                    title={isNew ? "저장 후 사용할 수 있습니다" : undefined}
                    style={{ ...aiReqBtnStyle, opacity: isNew ? 0.4 : 1, cursor: isNew ? "not-allowed" : "pointer" }}
                    >
                      <span style={isSpinning ? { display: "inline-block", animation: "_spin 1s linear infinite", marginRight: 4 } : { marginRight: 4 }}>
                        ↻
                      </span>
                      {label}
                    </button>
                    {!isNew && info && <AiStatusBadge status={info.status} />}
                  </div>
                );
              })}
              {/* 구분선 */}
              <div style={{ width: 1, height: 20, background: "var(--color-border)", margin: "0 4px" }} />
            </>

          {/* 취소·저장 */}
          <button
            onClick={() => router.push(`/projects/${projectId}/functions`)}
            disabled={saveMutation.isPending}
            style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 14px", minWidth: 60 }}
          >
            취소
          </button>
          <button
            onClick={() => {
              if (!name.trim()) { toast.error("기능명을 입력해 주세요."); return; }
              const descChanged = !isNew && description.trim() !== originalDescription.trim();
              if (descChanged) { setHistoryDialogOpen(true); return; }
              saveMutation.mutate({});
            }}
            disabled={saveMutation.isPending}
            style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px", minWidth: 60 }}
          >
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {/* ── 2컬럼 레이아웃: 왼쪽 기본 정보, 오른쪽 설명 + 컬럼 매핑 + AI 지원 */}
      <div style={{ padding: "0 24px 24px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 20, alignItems: "start" }}>

        {/* ── 왼쪽: 기본 정보 + 첨부파일 ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <section style={sectionStyle}>

          {/* 행1: 소속 영역 | 유형 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <div style={formGroupStyle}>
              <label style={labelStyle}>소속 영역</label>
              <select value={areaId} onChange={(e) => setAreaId(e.target.value)} style={selectStyle}>
                <option value="">미분류 (영역 없음)</option>
                {areaOptions.map((a) => (
                  <option key={a.areaId} value={a.areaId}>{a.displayId} {a.name}</option>
                ))}
              </select>
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>유형</label>
              <select value={type} onChange={(e) => setType(e.target.value)} style={selectStyle}>
                {FUNC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          {/* 행2: 기능명 | 우선순위 (우선순위 width 고정) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: "0 16px" }}>
            <div style={formGroupStyle}>
              <label style={labelStyle}>기능명 <span style={{ color: "#e53935" }}>*</span></label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="기능명을 입력하세요"
                style={inputStyle}
              />
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>우선순위</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} style={selectStyle}>
                <option value="HIGH">높음</option>
                <option value="MEDIUM">중간</option>
                <option value="LOW">낮음</option>
              </select>
            </div>
          </div>

          {/* 행3: 복잡도 | 예상 공수 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <div style={formGroupStyle}>
              <label style={labelStyle}>복잡도</label>
              <select value={complexity} onChange={(e) => setComplexity(e.target.value)} style={selectStyle}>
                <option value="HIGH">높음</option>
                <option value="MEDIUM">중간</option>
                <option value="LOW">낮음</option>
              </select>
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>예상 공수</label>
              <input
                type="text"
                value={effort}
                onChange={(e) => setEffort(e.target.value)}
                placeholder="예: 2h, 0.5d"
                style={inputStyle}
              />
            </div>
          </div>

          {/* 행4: 구현 시작일 | 구현 종료일 | 정렬 순서 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px", gap: "0 16px" }}>
            <div style={formGroupStyle}>
              <label style={labelStyle}>구현 시작일</label>
              <input
                type="date"
                value={implStartDate}
                onChange={(e) => setImplStartDate(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>구현 종료일</label>
              <input
                type="date"
                value={implEndDate}
                onChange={(e) => setImplEndDate(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>정렬</label>
              <input
                type="number"
                min={0}
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
                style={inputStyle}
              />
            </div>
          </div>

        </section>

        {/* ── 왼쪽 하단: 첨부파일 ── */}
        {!isNew && (
          <section style={sectionStyle}>
            <h3 style={sectionTitleStyle}>첨부파일</h3>
            <AreaAttachFiles basePath={`/api/projects/${projectId}/functions/${functionId}`} />
          </section>
        )}
        </div>

        {/* ── 오른쪽: 설명 + 컬럼 매핑 + AI 지원 ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* AI 요청 코멘트 */}
          <section style={sectionStyle}>
            <label style={{ ...labelStyle, marginBottom: 6 }}>AI 요청 코멘트</label>
            <textarea
              value={commentCn}
              onChange={(e) => setCommentCn(e.target.value)}
              placeholder="AI 요청 시 참고할 추가 지시사항 (저장 시 함께 저장됩니다)"
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </section>

          {/* 설명 (func_dc) — MarkdownEditor */}
          <section style={sectionStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>설명</label>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={() => setDescExampleOpen(true)} style={ghostSmBtnStyle}>
                  예시
                </button>
                <button
                  type="button"
                  onClick={() => setDescription(DESCRIPTION_TEMPLATE(data?.displayId ?? "FN-XXXXX", name))}
                  style={ghostSmBtnStyle}
                >
                  템플릿 삽입
                </button>
                {!isNew && (
                  <button type="button" onClick={() => setHistoryViewOpen(true)} style={ghostSmBtnStyle}>
                    🕐 변경 이력
                  </button>
                )}
              </div>
            </div>
            <MarkdownEditor
              value={description}
              onChange={setDescription}
              placeholder="기능 설명을 마크다운으로 작성하세요."
              rows={14}
            />
          </section>

          {/* 설명 예시 팝업 */}
          {descExampleOpen && (
            <div
              style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
              onClick={() => setDescExampleOpen(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: "100%", maxWidth: 816, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.2)", padding: "20px 24px", maxHeight: "80vh", display: "flex", flexDirection: "column" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>설명 예시</span>
                  <button type="button" onClick={() => setDescExampleOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#888" }}>×</button>
                </div>
                <pre style={{ flex: 1, overflowY: "auto", background: "var(--color-bg-elevated)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "14px 16px", fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", color: "var(--color-text-primary)", margin: 0 }}>
                  {DESCRIPTION_EXAMPLE}
                </pre>
              </div>
            </div>
          )}

          {/* 설명 변경 이력 저장 여부 확인 다이얼로그 */}
          {historyDialogOpen && (
            <div
              style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
              onClick={() => setHistoryDialogOpen(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: "100%", maxWidth: 420, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.2)", padding: "24px 28px" }}
              >
                <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
                  변경 이력 저장
                </p>
                <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  기능 설명이 변경되었습니다.<br />
                  변경 이력을 함께 저장하시겠습니까?
                </p>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setHistoryDialogOpen(false)}
                    style={{ ...secondaryBtnStyle, fontSize: 13, padding: "6px 16px" }}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => { setHistoryDialogOpen(false); saveMutation.mutate({}); }}
                    disabled={saveMutation.isPending}
                    style={{ ...secondaryBtnStyle, fontSize: 13, padding: "6px 16px" }}
                  >
                    이력 없이 저장
                  </button>
                  <button
                    type="button"
                    onClick={() => { setHistoryDialogOpen(false); saveMutation.mutate({ saveHistory: true }); }}
                    disabled={saveMutation.isPending}
                    style={{ ...primaryBtnStyle, fontSize: 13, padding: "6px 16px" }}
                  >
                    이력과 함께 저장
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 설명 변경 이력 조회 팝업 */}
          <SettingsHistoryDialog
            open={historyViewOpen}
            onClose={() => setHistoryViewOpen(false)}
            projectId={projectId}
            itemName="기능 설명"
            currentValue={description}
            title="기능 설명 변경 이력"
          />

          {/* ── AR-00082 컬럼 매핑 — 신규 모드에서는 버튼 disabled */}
          <section style={sectionStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: colMappings.length > 0 ? 12 : 0 }}>
              <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>컬럼 매핑</h3>
              <button
                onClick={() => setMappingPopupOpen(true)}
                disabled={isNew}
                title={isNew ? "저장 후 사용할 수 있습니다" : undefined}
                style={{ ...primaryBtnStyle, fontSize: 13, padding: "6px 14px", opacity: isNew ? 0.4 : 1, cursor: isNew ? "not-allowed" : "pointer" }}
              >
                매핑 관리
              </button>
            </div>

            {/* 저장된 매핑 목록 테이블 */}
            {colMappings.length > 0 ? (
              <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
                {/* 헤더 */}
                <div style={colMappingHeaderStyle}>
                  <div style={{ flex: "0 0 120px" }}>항목명</div>
                  <div style={{ flex: "0 0 72px",  textAlign: "center" }}>IO구분</div>
                  <div style={{ flex: "0 0 90px" }}>UI유형</div>
                  <div style={{ flex: "1 1 0" }}>테이블</div>
                  <div style={{ flex: "1 1 0" }}>컬럼</div>
                </div>
                {/* 행 */}
                {colMappings.map((m, idx) => (
                  <div
                    key={m.mappingId}
                    style={{
                      ...colMappingRowStyle,
                      borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                      background: idx % 2 === 0 ? "var(--color-bg-card)" : "var(--color-bg-muted)",
                    }}
                  >
                    <div style={{ flex: "0 0 120px", fontSize: 12 }}>{m.usePurpsCn || <span style={{ color: "var(--color-text-disabled)" }}>—</span>}</div>
                    <div style={{ flex: "0 0 72px",  textAlign: "center" }}>
                      {m.ioSeCode ? (
                        <span style={{
                          display: "inline-block", padding: "1px 7px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                          background: "var(--color-primary, #1976d2)", color: "#fff",
                        }}>
                          {m.ioSeCode === "INPUT" ? "IN" : m.ioSeCode === "OUTPUT" ? "OUT" : "IO"}
                        </span>
                      ) : <span style={{ color: "var(--color-text-disabled)", fontSize: 12 }}>—</span>}
                    </div>
                    <div style={{ flex: "0 0 90px", fontSize: 12, color: "var(--color-text-secondary)" }}>{m.uiTyCode || "—"}</div>
                    <div style={{ flex: "1 1 0", fontSize: 12, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.tableName || "—"}</div>
                    <div style={{ flex: "1 1 0", fontSize: 12, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.colName || "—"}</div>
                  </div>
                ))}
              </div>
            ) : (
              !isNew && (
                <div style={{ padding: "16px 0 4px", textAlign: "center", fontSize: 13, color: "var(--color-text-disabled)" }}>
                  등록된 컬럼 매핑이 없습니다.
                </div>
              )
            )}
          </section>
        </div>
      </div>
      </div>

      {/* ── AI 요청 컨펌 다이얼로그 ──────────────────────────────────────── */}
      {aiConfirm && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setAiConfirm(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 400, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.2)", padding: "24px 28px" }}
          >
            <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
              AI 요청 확인
            </p>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              <strong>{aiConfirm.label}</strong>을 요청하시겠습니까?<br />
              AI 요청 코멘트가 있으면 함께 전달됩니다.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setAiConfirm(null)}
                style={{ ...secondaryBtnStyle, fontSize: 13, padding: "6px 16px" }}
              >
                취소
              </button>
              <button
                onClick={() => {
                  aiMutation.mutate({ taskType: aiConfirm.taskType });
                  setAiConfirm(null);
                }}
                disabled={aiMutation.isPending}
                style={{ ...primaryBtnStyle, fontSize: 13, padding: "6px 16px" }}
              >
                요청
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PID-00053 컬럼 매핑 관리 팝업 ────────────────────────────────── */}
      <ColMappingDialog
        open={mappingPopupOpen}
        onClose={() => setMappingPopupOpen(false)}
        onSaved={() => { setMappingPopupOpen(false); refetchMappings(); }}
        projectId={projectId}
        refType="FUNCTION"
        refId={functionId}
        title="컬럼 매핑 관리"
      />
    </div>
  );
}

// ── (구 ColumnMappingPopup 제거됨 — ColMappingDialog 공통 컴포넌트로 교체)

// ── AI 태스크 설정 ────────────────────────────────────────────────────────────

const AI_TASK_CONFIGS = [
  { taskType: "DESIGN",  label: "AI 설계 요청" },
  { taskType: "INSPECT", label: "AI 점검 요청" },
  { taskType: "IMPACT",  label: "AI 영향도 분석" },
];

function AiStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; color: string; bg: string }> = {
    PENDING:     { label: "대기 중",  color: "#f57c00", bg: "#fff8e1" },
    IN_PROGRESS: { label: "처리 중",  color: "#1565c0", bg: "#e3f2fd" },
    DONE:        { label: "완료",     color: "#2e7d32", bg: "#e8f5e9" },
    APPLIED:     { label: "적용됨",   color: "#6a1b9a", bg: "#f3e5f5" },
    REJECTED:    { label: "반려",     color: "#c62828", bg: "#ffebee" },
    FAILED:      { label: "실패",     color: "#c62828", bg: "#ffebee" },
    TIMEOUT:     { label: "시간초과", color: "#757575", bg: "#f5f5f5" },
  };
  const c = cfg[status] ?? { label: status, color: "#555", bg: "#f5f5f5" };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 6px",
      borderRadius: 4, color: c.color, background: c.bg,
      border: `1px solid ${c.color}40`, whiteSpace: "nowrap",
    }}>
      {c.label}
    </span>
  );
}

// ── 설명 예시 / 템플릿 ────────────────────────────────────────────────────────

const DESCRIPTION_EXAMPLE = `#### 기능: [FN-00001] 게시판 목록 조회

| 항목 | 내용 |
|:-----|:-----|
| 기능ID | FN-00001 |
| 기능명 | 게시판 목록 조회 |
| 기능유형 | SELECT |
| API | \`GET /api/board\` |
| 트리거 | 화면 진입(자동), 검색 버튼 클릭 |

**Input**

| 파라미터 | 타입 | 필수 | DB 매핑 | 설명 |
|:---------|:-----|:-----|:--------|:-----|
| projectId | number | Y (세션) | project_id | |
| boardTypeCd | string | N | board_type_cd | null이면 전체 |
| keyword | string | N | board_title_nm | LIKE 검색 |
| startDt | string | N | reg_dt | >= 조건 (yyyy-MM-dd) |
| endDt | string | N | reg_dt | <= 조건 (yyyy-MM-dd) |
| page | number | Y | - | 1부터 시작 |
| size | number | Y | - | 기본 20 |

**Output**

| 필드 | 타입 | DB 매핑 | 설명 |
|:-----|:-----|:--------|:-----|
| boardId | number | board_id | |
| boardTypeCd | string | board_type_cd | |
| boardTitleNm | string | board_title_nm | |
| regUserNm | string | (JOIN) | 작성자명 |
| regDt | string | reg_dt | |
| viewCnt | number | view_cnt | |
| fixYn | string | fix_yn | |
| attachYn | string | (서브쿼리) | 첨부파일 존재 Y/N |
| totalCount | number | COUNT(*) OVER() | 총 건수 |

**참조 테이블 관계**
\`\`\`
tb_cm_board b
  LEFT JOIN tb_cm_user u ON u.user_id = b.reg_user_id
\`\`\`
- 첨부파일 존재 여부: \`EXISTS (SELECT 1 FROM tb_cm_attach_file WHERE ref_type_cd = 'BOARD' AND ref_id = b.board_id AND del_yn = 'N')\`

**처리 로직**
\`\`\`
1. project_id 세션에서 획득
2. del_yn = 'N' 필터
3. 검색 조건 적용 (boardTypeCd, keyword LIKE, startDt >=, endDt <= +1일)
4. 정렬: fix_yn DESC, reg_dt DESC (상단고정 우선, 최신순)
5. 페이징: LIMIT :size OFFSET (:page - 1) * :size
\`\`\`

**업무 규칙**
- 검색 결과 0건 → "등록된 게시글이 없습니다" 안내
- 상단고정 게시글은 페이지와 무관하게 항상 최상단
- 기간 종료일은 해당일 23:59:59까지 포함`;

const DESCRIPTION_TEMPLATE = (displayId: string, name: string) => `#### 기능: [${displayId}] ${name}

| 항목 | 내용 |
|:-----|:-----|
| 기능ID | ${displayId} |
| 기능명 | ${name} |
| 기능유형 | |
| API | \`\` |
| 트리거 | |

**Input**

| 파라미터 | 타입 | 필수 | DB 매핑 | 설명 |
|:---------|:-----|:-----|:--------|:-----|
| | | | | |

**Output**

| 필드 | 타입 | DB 매핑 | 설명 |
|:-----|:-----|:--------|:-----|
| | | | |

**참조 테이블 관계**
\`\`\`
\`\`\`

**처리 로직**
\`\`\`
1.
\`\`\`

**업무 규칙**
- `;

// ── 상수 ─────────────────────────────────────────────────────────────────────

const FUNC_TYPES = [
  { value: "SEARCH",   label: "검색/조회" },
  { value: "SAVE",     label: "저장" },
  { value: "DELETE",   label: "삭제" },
  { value: "DOWNLOAD", label: "다운로드" },
  { value: "UPLOAD",   label: "업로드" },
  { value: "NAVIGATE", label: "이동" },
  { value: "VALIDATE", label: "유효성검증" },
  { value: "OTHER",    label: "기타" },
];

// ── 스타일 ────────────────────────────────────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  padding: "16px 20px",
  border: "1px solid var(--color-border)", borderRadius: 8,
  background: "var(--color-bg-card)",
};
const sectionTitleStyle: React.CSSProperties = { margin: "0 0 8px", fontSize: 15, fontWeight: 700 };
const colMappingHeaderStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "7px 12px",
  background: "var(--color-bg-muted)",
  borderBottom: "1px solid var(--color-border)",
  fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
};
const colMappingRowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "7px 12px",
};
const formGroupStyle: React.CSSProperties  = { marginBottom: 16 };
const labelStyle: React.CSSProperties = {
  display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600,
  color: "var(--color-text-secondary)",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", borderRadius: 6,
  border: "1px solid var(--color-border)", fontSize: 14,
  background: "var(--color-bg-card)", color: "var(--color-text-primary)", boxSizing: "border-box",
};
const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 10px center",
  paddingRight: 32,
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

const aiReqBtnStyle: React.CSSProperties = {
  padding:      "4px 10px",
  borderRadius: 5,
  border:       "1px solid var(--color-primary, #1976d2)",
  background:   "none",
  color:        "var(--color-primary, #1976d2)",
  fontSize:     12,
  fontWeight:   600,
  cursor:       "pointer",
  whiteSpace:   "nowrap",
};

const statusSelectStyle: React.CSSProperties = {
  padding:         "3px 24px 3px 8px",
  borderRadius:    5,
  border:          "1px solid var(--color-border)",
  fontSize:        12,
  fontWeight:      600,
  background:      "transparent",
  color:           "var(--color-text-primary)",
  cursor:          "pointer",
  appearance:      "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
  backgroundRepeat:   "no-repeat",
  backgroundPosition: "right 7px center",
  transition:      "border-color 0.15s, color 0.15s",
};

const ghostSmBtnStyle: React.CSSProperties = {
  padding:      "3px 9px",
  borderRadius: 5,
  border:       "1px solid var(--color-border)",
  background:   "none",
  color:        "var(--color-text-secondary)",
  fontSize:     12,
  cursor:       "pointer",
};
