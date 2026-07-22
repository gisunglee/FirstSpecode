"use client";

/**
 * ProjectSettingsPage — 프로젝트 설정 (PID-00023, UW-00012)
 *
 * 역할:
 *   - [기본정보] 탭: 프로젝트명·발주처·기간 수정 (FID-00075, FID-00076)
 *   - [AI설정] 탭: API 키 CRUD + AI 호출 방식 변경 (FID-00077~FID-00081)
 *   - 프로젝트 복사·삭제 (FID-00060, FID-00062)
 *   - OWNER/ADMIN 전용 페이지
 *
 * 주요 기술:
 *   - TanStack Query: 프로젝트·AI설정·변경이력 조회
 *   - useMutation: 저장·복사·삭제·API키 CRUD
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import MarkdownEditor, { MarkdownTabButtons } from "@/components/ui/MarkdownEditor";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import TextCounter from "@/components/ui/TextCounter";
import { TEXT_LIMITS } from "@/lib/constants/textLimits";
import { KR_HOLIDAYS, KR_HOLIDAY_YEARS } from "@/lib/constants/krHolidays";
import { hasPermission, isRoleCode, isJobCode } from "@/lib/permissions";

// RichEditor(TipTap)는 SSR과 맞지 않아 요구사항 상세 페이지와 동일하게 동적 로드
const RichEditor = dynamic(() => import("@/components/ui/RichEditor"), { ssr: false });
import {
  parseProjectAbbrInput,
  PROJECT_ABBR_MAX_LEN,
  PROJECT_ABBR_PLACEHOLDER,
} from "@/lib/constants/projectAbbr";
import { DOC_META_CATALOG } from "@/lib/exports/doc-meta-catalog";

// ── 타입 ─────────────────────────────────────────────────────────────────
type ProjectDetail = {
  projectId:    string;
  name:         string;
  abbreviation: string | null;
  fullName:     string | null;  // 정식 명칭 — 단순 정보 보관 (출력·검증 없음)
  description:  string | null;
  startDate:    string | null;
  endDate:      string | null;
  clientName:   string | null;
  // 단계별 일정 (분석/설계/구현/테스트) — 프로젝트 전체 기간과 별개
  analysisStart: string | null;
  analysisEnd:   string | null;
  designStart:   string | null;
  designEnd:     string | null;
  devStart:      string | null;
  devEnd:        string | null;
  testStart:     string | null;
  testEnd:       string | null;
  myRole:       string;
  myJob:        string | null;
};

// 마일스톤 — 오픈일/이행일 등 "단일 시점" 핵심 일정. 단계 범위(위 PhaseKey)와 별개.
type Milestone = {
  milestoneId:   string;
  name:          string;
  date:          string; // YYYY-MM-DD
  content:       string; // HTML(RichEditor) — 착수보고회 장소/공지 등, 이미지 붙여넣기 가능
  creatorMberId: string;
  createdAt:     string;
  modifiedAt:    string | null;
};

// 공휴일 — WBS/업무일지 근무일 계산의 참조 데이터 (2026-07-22 도입)
// type: LEGAL(표준 공휴일 일괄 등록) / CUSTOM(직접 추가) — 목록에서 배지로만 구분, 동작은 동일
type Holiday = {
  holidayId:     string;
  name:          string;
  date:          string; // YYYY-MM-DD
  type:          "LEGAL" | "CUSTOM";
  creatorMberId: string;
  createdAt:     string;
};

type ApiKeyItem = { keyId: string; provider: string; maskedKey: string };

type AiSettings = {
  apiKeys:    ApiKeyItem[];
  callMethod: "DIRECT" | "QUEUE";
};

type Tab = "basic" | "schedule" | "ai" | "document";

type DocumentSettings = {
  copyrightHolder:   string | null;
  docVersionDefault: string | null;
  approverName:      string | null;
  systemName:        string | null;
  systemCode:        string | null;
  docNoTemplate:     string | null;
};

// ── 복사 확인 POPUP ──────────────────────────────────────────────────────
function CopyDialog({
  projectName, onCancel, onConfirm, isPending,
}: { projectName: string; onCancel: () => void; onConfirm: () => void; isPending: boolean }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, background: "var(--color-bg-card)", border: "1px solid var(--color-border-strong)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-xl)", padding: "28px 24px" }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>📋</div>
        <h3 style={{ margin: "0 0 10px", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-text-heading)" }}>프로젝트를 복사하시겠습니까?</h3>
        <p style={{ margin: "0 0 20px", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
          <strong>'{projectName}'</strong>의 분석·설계 모든 정보가 복사됩니다.<br />
          복사본은 <strong>'{projectName} (복사본)'</strong>으로 생성되며,<br />멤버는 복사되지 않습니다.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="sp-btn sp-btn-secondary" onClick={onCancel} disabled={isPending}>취소</button>
          <button className="sp-btn sp-btn-primary" onClick={onConfirm} disabled={isPending}>{isPending ? "복사 중..." : "복사"}</button>
        </div>
      </div>
    </div>
  );
}

// ── 삭제 확인 POPUP (PID-00018) ──────────────────────────────────────────
//
// 2026-05-06 동작 변경:
//   삭제는 즉시 제거가 아닌 "soft delete" 로 동작한다.
//   - 보관 기간(기본 14일) 동안 OWNER 가 복구 가능 (휴지통 화면 예정)
//   - 보관 기간이 지나면 별도 배치(또는 어드민)가 영구 삭제
//   - 다른 멤버에게는 즉시 보이지 않게 처리됨
//
//   문구도 그에 맞춰 "즉시 영구 삭제" 가 아닌 "삭제 처리(복구 가능)"로 정확화.
function DeleteDialog({
  projectName, onCancel, onConfirm, isPending,
}: { projectName: string; onCancel: () => void; onConfirm: () => void; isPending: boolean }) {
  const [inputName, setInputName] = useState("");
  const confirmed = inputName === projectName;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, background: "var(--color-bg-card)", border: "1px solid var(--color-border-strong)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-xl)", padding: "28px 24px" }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>⚠️</div>
        <h3 style={{ margin: "0 0 10px", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-text-heading)" }}>프로젝트를 삭제하시겠습니까?</h3>
        <p style={{ margin: "0 0 8px", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
          <strong>'{projectName}'</strong>을 삭제하면 다른 멤버에게 즉시 보이지 않게 되고,<br />
          보관 기간이 지나면 영구 삭제됩니다. 그 전까지는 복구할 수 있습니다.
        </p>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", marginBottom: 6, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            확인을 위해 프로젝트명 <strong style={{ color: "var(--color-text-primary)" }}>{projectName}</strong> 을 입력하세요
          </label>
          <input className="sp-input" placeholder={projectName} value={inputName} onChange={(e) => setInputName(e.target.value)} autoFocus
            style={{ borderColor: inputName ? (confirmed ? "var(--color-success, #22c55e)" : "var(--color-error)") : undefined }} />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="sp-btn sp-btn-secondary" onClick={onCancel} disabled={isPending}>취소</button>
          <button onClick={onConfirm} disabled={!confirmed || isPending} style={{ padding: "6px 16px", fontSize: "var(--text-sm)", fontWeight: 600, background: confirmed ? "var(--color-error)" : "var(--color-bg-elevated)", color: confirmed ? "#fff" : "var(--color-text-tertiary)", border: `1px solid ${confirmed ? "var(--color-error)" : "var(--color-border)"}`, borderRadius: "var(--radius-btn)", cursor: confirmed ? "pointer" : "not-allowed" }}>
            {isPending ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 메인 ─────────────────────────────────────────────────────────────────
export default function ProjectSettingsPage() {
  return <Suspense fallback={null}><ProjectSettingsInner /></Suspense>;
}

function ProjectSettingsInner() {
  const router      = useRouter();
  const params      = useParams();
  const queryClient = useQueryClient();
  const projectId   = params.id as string;

  const [activeTab,  setActiveTab]  = useState<Tab>("basic");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copyOpen,   setCopyOpen]   = useState(false);

  // 상단 헤더(뒤로가기+제목, 탭 4개)를 실측해서 "일정" 탭 안 점프 네비가 그 바로 밑에
  // 딱 붙게 한다. 값을 고정 숫자로 대충 잡으면(예: 48px) 폰트/여백이 바뀔 때마다 다시
  // 어긋나므로 ResizeObserver로 실제 렌더 높이를 재서 쓴다.
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setHeaderHeight(entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ── 프로젝트 조회 ───────────────────────────────────────────────────
  const { data: projData, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => authFetch<{ data: ProjectDetail }>(`/api/projects/${projectId}`).then((r) => r.data),
    staleTime: 60_000,
  });

  const project   = projData ?? null;
  const myRole    = project?.myRole ?? null;
  const canEdit   = myRole === "OWNER" || myRole === "ADMIN";
  const isOwner   = myRole === "OWNER";
  // 설정 > 일정 탭(단계별 일정/마일스톤/공휴일) 전용 게이트 — OWNER/ADMIN 역할이 아니어도
  // PM/PL 직무면 관리 가능(schedule.manage, requirement.update와 동일 관례).
  // 기본정보/AI설정/문서설정 탭은 여전히 canEdit(OWNER/ADMIN)만 — 건드리지 않는다.
  const canManageSchedule = hasPermission(
    {
      role: isRoleCode(myRole) ? myRole : null,
      job:  isJobCode(project?.myJob) ? project.myJob : null,
      plan: "FREE",
      systemRole: null,
    },
    "schedule.manage"
  );

  // ── 권한 가드 ──────────────────────────────────────────────────────
  // 멤버 페이지와 동일 패턴 — 권한 없는 사용자가 진입하면 토스트 안내 후
  // 과업 페이지로 이동. project 로딩 중에는 myRole 이 null 이므로 판정 보류.
  // (`/projects/{id}` 는 page.tsx 가 없어 404 — 모든 멤버에게 열린 /tasks 로 보낸다.)
  // canEdit(OWNER/ADMIN) 이 없어도 canManageSchedule(PM/PL)이면 "일정" 탭만 보러 들어올 수 있다.
  useEffect(() => {
    if (project && !canEdit && !canManageSchedule) {
      toast.info("프로젝트 설정 권한이 없어 기본 페이지로 이동합니다.");
      router.replace(`/projects/${projectId}/tasks`);
    }
  }, [project, canEdit, canManageSchedule, projectId, router]);

  // canEdit 없이 canManageSchedule로만 들어온 경우 — 기본정보 탭은 읽기전용이라 의미가
  // 없으니 바로 "일정" 탭을 기본으로 보여준다.
  useEffect(() => {
    if (project && !canEdit && canManageSchedule) {
      setActiveTab("schedule");
    }
  }, [project, canEdit, canManageSchedule]);

  // ── 복사 뮤테이션 ───────────────────────────────────────────────────
  const copyMutation = useMutation({
    mutationFn: () => authFetch<{ data: { newProjectId: string } }>(`/api/projects/${projectId}/copy`, { method: "POST" }),
    onSuccess: (res) => {
      toast.success("프로젝트가 복사되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/projects/${res.data.newProjectId}/settings`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 삭제 뮤테이션 (soft delete) ─────────────────────────────────────
  //
  // API 가 안전 토큰(confirm:'DELETE')을 요구한다 — 모달 통과(프로젝트명
  // 입력)와 별개로 본문 토큰까지 검사하는 이중 보호. 모달은 의도 확인,
  // 토큰은 실수로 발사되는 호출 자체를 차단한다.
  const deleteMutation = useMutation({
    mutationFn: () =>
      authFetch<{ data: { hardDeleteAt?: string; retentionDays?: number } }>(
        `/api/projects/${projectId}`,
        {
          method:  "DELETE",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ confirm: "DELETE" }),
        }
      ),
    onSuccess: (res) => {
      // 보관 기간이 응답에 들어오면 사용자가 안심할 수 있도록 토스트에 함께 안내.
      const days = res?.data?.retentionDays;
      toast.success(
        days
          ? `프로젝트가 삭제 처리되었습니다. ${days}일 후 영구 삭제됩니다 (그 전까지 복구 가능).`
          : "프로젝트가 삭제 처리되었습니다."
      );
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push("/projects");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <div style={{ padding: "28px 32px", color: "var(--color-text-tertiary)" }}>로딩 중...</div>;
  if (!project)  return <div style={{ padding: "28px 32px", color: "var(--color-error)" }}>프로젝트를 찾을 수 없습니다.</div>;
  // 권한 없을 시 위 useEffect 가 redirect 처리. redirect 가 적용되기 전 한 프레임 동안의
  // 빈 화면 방지를 위해 안내 텍스트만 잠깐 표시 (인라인 메시지 분기에서 redirect 분기로 통일).
  if (!canEdit && !canManageSchedule) return <div style={{ padding: "28px 32px", color: "var(--color-text-secondary)" }}>이동 중...</div>;

  const tabStyle = (tab: Tab): React.CSSProperties => ({
    padding: "8px 18px",
    fontSize: "var(--text-sm)",
    fontWeight: activeTab === tab ? 700 : 500,
    color: activeTab === tab ? "var(--color-brand)" : "var(--color-text-secondary)",
    background: "none",
    border: "none",
    borderBottom: activeTab === tab ? "2px solid var(--color-brand)" : "2px solid transparent",
    cursor: "pointer",
  });

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더(뒤로가기+제목) + 탭 네비게이션을 하나의 sticky 블록으로 묶는다.
          둘을 따로 sticky 처리하면 각각 top 계산이 어긋나거나(예전 버그) 스크롤 시
          탭 줄만 먼저 흘러가버려 "일정" 탭 안 점프 네비 바로 위에 붙어 있어야 할
          탭 줄이 사라지는 문제가 있었다. headerRef로 전체 높이를 실측해 ScheduleTab의
          점프 네비가 그 바로 아래에 오도록 top을 넘겨준다. */}
      <div ref={headerRef} style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--color-bg-card)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => router.push("/projects")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#666", lineHeight: 1, padding: "2px 4px" }}>
              ←
            </button>
            <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>프로젝트 설정</span>
          </div>
        </div>

        {/* AR-00032 탭 네비게이션 (FID-00074) — 탭 전부 동일 너비(1160)로 아래 콘텐츠와 정렬 */}
        <div style={{ padding: "0 24px", maxWidth: 1160 }}>
          <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)" }}>
            <button style={tabStyle("basic")}    onClick={() => setActiveTab("basic")}>기본정보</button>
            <button style={tabStyle("schedule")} onClick={() => setActiveTab("schedule")}>일정</button>
            <button style={tabStyle("ai")}       onClick={() => setActiveTab("ai")}>AI설정</button>
            <button style={tabStyle("document")} onClick={() => setActiveTab("document")}>문서설정</button>
          </div>
        </div>
      </div>

      {/* 탭 전부 동일 너비 — 다른 화면(단위업무 등)과 통일. 예전엔 document 탭만 1160, 나머지 680으로
          좁게 잡혀 있어 같은 설정 화면 안에서도 탭마다 폭이 들쭉날쭉해 보였다. */}
      <div style={{ padding: "12px 24px 24px", maxWidth: 1160 }}>

      {/* 탭 콘텐츠 */}
      {activeTab === "basic" && (
        <>
          <BasicInfoTab projectId={projectId} project={project} isOwner={isOwner} queryClient={queryClient} />

          {/* 멤버 관리 및 초대 바로가기 — 기본정보 탭에서만 노출 (FID-00074) */}
          {/* 위/아래 카드와 균일한 간격(20px)으로 맞춤 — 이전 marginTop 28 은 너무 떨어져 보였음 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 20, marginBottom: 20 }}>
            <NavCard
              title="멤버 관리"
              description="참여 인원 목록 및 역할을 관리합니다"
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
              onClick={() => router.push(`/projects/${projectId}/members`)}
              color="var(--color-brand)"
            />
            <NavCard
              title="초대 및 현황"
              description="새 멤버 초대 및 승인 대기를 확인합니다"
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/></svg>}
              onClick={() => router.push(`/projects/${projectId}/members/invitations`)}
              color="var(--color-success, #22c55e)"
            />
          </div>

          {/* 액션 영역 — 기본정보 탭에서만 노출. 프로젝트 삭제는 OWNER 전용 */}
          <div style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button className="sp-btn sp-btn-secondary" onClick={() => setCopyOpen(true)} disabled={copyMutation.isPending}>프로젝트 복사</button>
            {isOwner && (
              <button disabled={deleteMutation.isPending} onClick={() => setDeleteOpen(true)} style={{ padding: "6px 16px", fontSize: "var(--text-sm)", fontWeight: 600, background: "var(--color-error-subtle, rgba(239,68,68,0.08))", color: "var(--color-error)", border: "1px solid var(--color-error)", borderRadius: "var(--radius-btn)", cursor: "pointer" }}>
                프로젝트 삭제
              </button>
            )}
          </div>
        </>
      )}
      {activeTab === "schedule" && <ScheduleTab projectId={projectId} project={project} canManage={canManageSchedule} queryClient={queryClient} headerHeight={headerHeight} />}
      {activeTab === "ai"       && <AiSettingsTab projectId={projectId} />}
      {activeTab === "document" && <DocumentSettingsTab projectId={projectId} />}

      {copyOpen && (
        <CopyDialog projectName={project.name} onCancel={() => setCopyOpen(false)} onConfirm={() => { setCopyOpen(false); copyMutation.mutate(); }} isPending={copyMutation.isPending} />
      )}
      {deleteOpen && (
        <DeleteDialog projectName={project.name} onCancel={() => setDeleteOpen(false)} onConfirm={() => deleteMutation.mutate()} isPending={deleteMutation.isPending} />
      )}
      </div>
    </div>
  );
}

// ── AR-00033 기본정보 탭 (FID-00075, FID-00076) ───────────────────────────
function BasicInfoTab({
  projectId, project, isOwner, queryClient,
}: {
  projectId: string;
  project: ProjectDetail;
  isOwner: boolean;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [name,         setName]         = useState(project.name);
  const [abbreviation, setAbbreviation] = useState(project.abbreviation ?? "");
  const [fullName,     setFullName]     = useState(project.fullName ?? "");
  const [description,  setDescription]  = useState(project.description ?? "");
  // 설명 마크다운 에디터 탭 (편집/미리보기) — 다른 페이지(AI 태스크 상세 등)와 동일 패턴
  const [descTab,      setDescTab]      = useState<"edit" | "preview">("edit");
  const [startDate,    setStartDate]    = useState(project.startDate?.slice(0, 10) ?? "");
  const [endDate,      setEndDate]      = useState(project.endDate?.slice(0, 10) ?? "");
  const [clientName,   setClientName]   = useState(project.clientName ?? "");

  const saveMutation = useMutation({
    mutationFn: (body: object) =>
      authFetch(`/api/projects/${projectId}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success("저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["projects", "my"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error("프로젝트명을 입력해 주세요."); return; }
    // 수정은 약어 선택 — 빈 값은 null 로 보내 서버에서 약어 제거 처리.
    const abbrParsed = parseProjectAbbrInput(abbreviation, { required: false });
    if ("error" in abbrParsed) { toast.error(abbrParsed.error); return; }
    if (startDate && endDate && endDate < startDate) { toast.error("종료일은 시작일 이후여야 합니다."); return; }
    saveMutation.mutate({
      name,
      abbreviation: abbrParsed.value,
      fullName,
      description,
      startDate:  startDate || undefined,
      endDate:    endDate   || undefined,
      clientName,
    });
  }

  const ro = !isOwner;
  return (
    <form onSubmit={handleSave}>
      <div style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={fieldLabelStyle}>프로젝트명 <span style={{ color: "var(--color-error)" }}>*</span></label>
          <input className="sp-input" value={name} onChange={(e) => setName(e.target.value)} readOnly={ro} />
        </div>
        {/* 약어 + 정식 명칭(Full Name) 한 줄로 — 약어는 좁게, FullName 은 나머지 채움 */}
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ width: 200, flexShrink: 0 }}>
            <label style={fieldLabelStyle}>약어</label>
            <input
              className="sp-input"
              placeholder={PROJECT_ABBR_PLACEHOLDER}
              value={abbreviation}
              onChange={(e) => setAbbreviation(e.target.value)}
              readOnly={ro}
              maxLength={PROJECT_ABBR_MAX_LEN}
            />
            <p style={{ margin: "4px 0 0", fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>
              영문/숫자 2~10자. 문서 출력에 사용.
            </p>
          </div>
          <div style={{ flex: 1 }}>
            {/* FullName — 단순 정보 보관용. 현재 출력·검증 어디에도 쓰이지 않음. */}
            <label style={fieldLabelStyle}>Full Name</label>
            <input
              className="sp-input"
              placeholder="프로젝트 정식 명칭"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              readOnly={ro}
              maxLength={100}
            />
            <p style={{ margin: "4px 0 0", fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>
              프로젝트의 공식 정식 명칭 (선택).
            </p>
          </div>
        </div>
        <div>
          {/* 설명 — 마크다운 에디터 (편집/미리보기 탭) */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <label style={{ ...fieldLabelStyle, marginBottom: 0 }}>설명</label>
            <MarkdownTabButtons tab={descTab} onTabChange={setDescTab} />
          </div>
          <MarkdownEditor
            value={description}
            onChange={setDescription}
            readOnly={ro}
            tab={descTab}
            onTabChange={setDescTab}
            rows={9}
            placeholder="프로젝트에 대한 설명을 마크다운으로 작성하세요."
          />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={fieldLabelStyle}>시작일</label>
            <input className="sp-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} readOnly={ro} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={fieldLabelStyle}>종료일</label>
            <input className="sp-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} readOnly={ro} />
          </div>
        </div>
        <div>
          <label style={fieldLabelStyle}>발주처</label>
          <input className="sp-input" value={clientName} onChange={(e) => setClientName(e.target.value)} readOnly={ro} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="submit" className="sp-btn sp-btn-primary" disabled={ro || saveMutation.isPending}>
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </form>
  );
}

// ── 일정 탭 — 단계별(분석/설계/구현/테스트) 시작일·종료일 ────────────────────
// 별도 테이블 없이 프로젝트 테이블 컬럼으로 관리 (tb_pj_project.anls_bgng_de 등).
type PhaseKey = "analysis" | "design" | "dev" | "test";
const PHASE_LABELS: { key: PhaseKey; label: string }[] = [
  { key: "analysis", label: "분석" },
  { key: "design",   label: "설계" },
  { key: "dev",      label: "구현" },
  { key: "test",     label: "테스트" },
];

function ScheduleTab({
  projectId, project, canManage, queryClient, headerHeight,
}: {
  projectId: string;
  project: ProjectDetail;
  canManage: boolean;
  queryClient: ReturnType<typeof useQueryClient>;
  // 상위(설정 페이지)의 sticky 헤더(뒤로가기+제목+탭) 실측 높이 — 점프 네비를
  // 그 바로 아래에 붙이는 데 사용. 0이면(측정 전) 네비를 페이지 맨 위에 겹쳐 그리지
  // 않도록 아직 sticky를 걸지 않는다.
  headerHeight: number;
}) {
  const [dates, setDates] = useState<Record<PhaseKey, { start: string; end: string }>>({
    analysis: { start: project.analysisStart?.slice(0, 10) ?? "", end: project.analysisEnd?.slice(0, 10) ?? "" },
    design:   { start: project.designStart?.slice(0, 10)   ?? "", end: project.designEnd?.slice(0, 10)   ?? "" },
    dev:      { start: project.devStart?.slice(0, 10)      ?? "", end: project.devEnd?.slice(0, 10)      ?? "" },
    test:     { start: project.testStart?.slice(0, 10)     ?? "", end: project.testEnd?.slice(0, 10)     ?? "" },
  });

  const saveMutation = useMutation({
    mutationFn: (body: object) =>
      authFetch(`/api/projects/${projectId}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success("저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function setPhaseDate(key: PhaseKey, field: "start" | "end", value: string) {
    setDates((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    for (const { key, label } of PHASE_LABELS) {
      const { start, end } = dates[key];
      if (start && end && end < start) { toast.error(`${label} 종료일은 시작일 이후여야 합니다.`); return; }
    }
    saveMutation.mutate({
      // 프로젝트명은 PUT 필수값이라 함께 전송 (기본정보 탭과 동일한 API 사용)
      name: project.name,
      analysisStart: dates.analysis.start || undefined,
      analysisEnd:   dates.analysis.end   || undefined,
      designStart:   dates.design.start   || undefined,
      designEnd:     dates.design.end     || undefined,
      devStart:      dates.dev.start      || undefined,
      devEnd:        dates.dev.end        || undefined,
      testStart:     dates.test.start     || undefined,
      testEnd:       dates.test.end       || undefined,
    });
  }

  // 일정 탭 안에 섹션이 3개(단계별 일정/마일스톤/공휴일)로 늘어나면서 세로로 길어져,
  // 좁은 화면에서는 아래쪽 섹션이 안 보일 수 있다는 우려가 있었다. 탭으로 쪼개면
  // "한눈에 훑어보기"가 안 되므로, 콘텐츠는 그대로 이어붙이고 상단에 고정 점프 네비만
  // 추가해 좁은 화면에서도 원하는 섹션으로 바로 스크롤 이동할 수 있게 한다.
  const phaseRef     = useRef<HTMLDivElement>(null);
  const milestoneRef = useRef<HTMLDivElement>(null);
  const holidayRef   = useRef<HTMLDivElement>(null);
  const JUMP_TARGETS: Array<{ label: string; ref: React.RefObject<HTMLDivElement | null> }> = [
    { label: "단계별 일정", ref: phaseRef },
    { label: "마일스톤",   ref: milestoneRef },
    { label: "공휴일",     ref: holidayRef },
  ];

  // 점프 네비 자체 높이 — padding(8+12) + 버튼 한 줄(약 32px) 고정값. 상위 헤더와 달리
  // 내용이 항상 같은 한 줄 버튼 행이라 실측 없이도 어긋날 일이 없다.
  const JUMP_NAV_HEIGHT = 56;

  const ro = !canManage;
  return (
    // MilestoneSection 이 자체 <form>(추가/수정 다이얼로그)을 갖고 있어
    // 이 폼 안에 넣으면 <form> 안에 <form>이 중첩되어 hydration 에러가 난다.
    // 그래서 이 탭의 두 번째 폼은 바깥 <form> 밖, 형제 요소로 분리한다.
    <div>
      {/* 점프 네비 — sticky로 스크롤해도 계속 보임. 각 섹션은 scrollMarginTop으로
          이 네비 높이만큼 여백을 둬서, 점프했을 때 섹션 제목이 네비 밑에 가려지지 않게 한다.
          top을 0이 아니라 headerHeight로 두는 이유: 페이지 상단 헤더(뒤로가기+제목+탭)도
          sticky(top:0)라서 이 네비도 top:0으로 두면 스크롤 시 같은 자리에서 겹쳐 그 헤더
          뒤로 가려져 안 보이게 된다. 헤더의 실측 높이만큼 내려서 바로 아래에 붙게 한다. */}
      <div style={{
        position: "sticky", top: headerHeight, zIndex: 5,
        display: "flex", gap: 6, padding: "8px 0 12px",
        background: "var(--color-bg-content)",
      }}>
        {JUMP_TARGETS.map(({ label, ref }) => (
          <button
            key={label}
            type="button"
            className="sp-btn sp-btn-secondary"
            style={{ fontSize: "var(--text-sm)", padding: "6px 14px" }}
            onClick={() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            {label}
          </button>
        ))}
      </div>

      <div ref={phaseRef} style={{ scrollMarginTop: headerHeight + JUMP_NAV_HEIGHT }}>
        <form onSubmit={handleSave}>
          <div style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
            <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              단계별 진행 일정입니다. 프로젝트 전체 기간(기본정보 탭)과 별개로 관리됩니다.
            </p>
            {PHASE_LABELS.map(({ key, label }) => (
              <div key={key} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                <div style={{ width: 72, flexShrink: 0, paddingBottom: 8, fontSize: "var(--text-base)", fontWeight: 600, color: "var(--color-text-primary)" }}>
                  {label}
                </div>
                <div style={{ flex: 1 }}>
                  <label style={fieldLabelStyle}>시작일</label>
                  <input className="sp-input" type="date" value={dates[key].start} onChange={(e) => setPhaseDate(key, "start", e.target.value)} readOnly={ro} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={fieldLabelStyle}>종료일</label>
                  <input className="sp-input" type="date" value={dates[key].end} onChange={(e) => setPhaseDate(key, "end", e.target.value)} readOnly={ro} />
                </div>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" className="sp-btn sp-btn-primary" disabled={ro || saveMutation.isPending}>
                {saveMutation.isPending ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </form>
      </div>

      <div ref={milestoneRef} style={{ marginTop: 20, scrollMarginTop: headerHeight + JUMP_NAV_HEIGHT }}>
        <MilestoneSection projectId={projectId} canManage={canManage} />
      </div>

      <div ref={holidayRef} style={{ marginTop: 20, scrollMarginTop: headerHeight + JUMP_NAV_HEIGHT }}>
        <HolidaySection projectId={projectId} canManage={canManage} />
      </div>
    </div>
  );
}

// ── 마일스톤 — 오픈일/이행일 등 단일 시점 핵심 일정 (2026-07-21 도입) ──────────
//
// 위 단계별 일정(PhaseKey)은 "기간"만 다루지만, 실제 PM들은 오픈일·이행일처럼
// 이름 붙은 단일 날짜를 자유롭게 추가/삭제하고 싶어함. 그래서 고정 필드가 아닌
// 목록 형태(이름+날짜+내용)로 별도 관리. 내용은 착수보고회 장소·공지 등을
// 팀원에게 정확히 전달해야 하는 경우가 많아 마크다운 에디터를 붙임.
function diffDaysFromToday(dateStr: string): number {
  const target = new Date(dateStr + "T00:00:00Z").getTime();
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - todayUtc) / 86_400_000);
}

function formatDday(dateStr: string): string {
  const d = diffDaysFromToday(dateStr);
  if (d === 0) return "D-DAY";
  return d > 0 ? `D-${d}` : `D+${-d}`;
}

function MilestoneSection({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [formOpen,    setFormOpen]    = useState(false);
  const [editTarget,  setEditTarget]  = useState<Milestone | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Milestone | null>(null);
  const [detailTarget, setDetailTarget] = useState<Milestone | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["milestones", projectId],
    queryFn: () =>
      authFetch<{ data: { items: Milestone[] } }>(`/api/projects/${projectId}/milestones`).then((r) => r.data.items),
  });
  const milestones = data ?? [];

  // 등록한 사람 본인이면 canManage(PM/PL·OWNER/ADMIN)가 아니어도 수정/삭제 가능 —
  // GNB가 이미 캐시해 둔 프로필 조회를 queryKey 그대로 공유해 추가 요청 없이 재사용한다.
  // (queryFn은 다른 소비자와 동일하게 전체 프로필을 반환해야 캐시가 어긋나지 않는다.)
  const { data: profile } = useQuery({
    queryKey: ["member", "profile"],
    queryFn: () => authFetch<{ data: { mberId: string } }>("/api/member/profile").then((r) => r.data),
  });
  const myMberId = profile?.mberId;

  const deleteMutation = useMutation({
    mutationFn: (milestoneId: string) =>
      authFetch(`/api/projects/${projectId}/milestones/${milestoneId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["milestones", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: "var(--text-base)", fontWeight: 700, color: "var(--color-text-primary)" }}>마일스톤</div>
          <p style={{ margin: "4px 0 0", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
            오픈일·이행일처럼 팀 전체가 공유해야 할 핵심 날짜를 자유롭게 추가하세요.
          </p>
        </div>
        {canManage && (
          <button type="button" className="sp-btn sp-btn-primary" style={{ fontSize: "var(--text-sm)", padding: "6px 12px" }} onClick={() => setFormOpen(true)}>
            + 추가
          </button>
        )}
      </div>

      {isLoading ? (
        <div style={{ padding: "24px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }}>불러오는 중...</div>
      ) : milestones.length === 0 ? (
        <div style={{ padding: "24px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }}>
          등록된 마일스톤이 없습니다.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {milestones.map((m) => {
            const dday = formatDday(m.date);
            const isPast = diffDaysFromToday(m.date) < 0;
            return (
              <div
                key={m.milestoneId}
                onClick={() => setDetailTarget(m)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 12px", borderRadius: "var(--radius-btn)",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg-muted)",
                  opacity: isPast ? 0.6 : 1,
                  cursor: "pointer",
                }}
              >
                <span style={{
                  flexShrink: 0, minWidth: 56, textAlign: "center",
                  fontSize: "var(--text-xs)", fontWeight: 700,
                  padding: "2px 6px", borderRadius: 4,
                  background: dday === "D-DAY" ? "var(--color-error-subtle)" : "var(--color-brand-subtle)",
                  color:      dday === "D-DAY" ? "var(--color-error)"        : "var(--color-brand)",
                }}>
                  {dday}
                </span>
                <span style={{ flexShrink: 0, fontSize: "var(--text-base)", color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}>
                  {m.date}
                </span>
                <span style={{ flex: 1, fontSize: "var(--text-base)", fontWeight: 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.name}
                </span>
                {(canManage || m.creatorMberId === myMberId) && (
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={(e) => { e.stopPropagation(); setEditTarget(m); }}>수정</button>
                    <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={(e) => { e.stopPropagation(); setDeleteTarget(m); }}>삭제</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {formOpen && (
        <MilestoneFormDialog
          projectId={projectId}
          onClose={() => setFormOpen(false)}
        />
      )}
      {editTarget && (
        <MilestoneFormDialog
          projectId={projectId}
          milestone={editTarget}
          onClose={() => setEditTarget(null)}
        />
      )}
      {detailTarget && (
        <MilestoneDetailDialog milestone={detailTarget} onClose={() => setDetailTarget(null)} />
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="마일스톤 삭제"
        description={`'${deleteTarget?.name ?? ""}' 마일스톤을 삭제하시겠습니까?`}
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.milestoneId)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// 마일스톤 상세보기 — 읽기 전용. 수정 폼과 달리 canManage 여부와 무관하게 누구나 열람 가능.
// RichEditor를 readOnly로 그대로 재사용해 이미지 크기(width)를 편집 화면과 동일하게 보여준다.
function MilestoneDetailDialog({ milestone, onClose }: { milestone: Milestone; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 640, maxHeight: "85vh", overflowY: "auto", background: "var(--color-bg-card)", border: "1px solid var(--color-border-strong)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-xl)", padding: "24px 24px", display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-text-heading)" }}>{milestone.name}</h3>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}>{milestone.date}</span>
        </div>

        {milestone.content ? (
          <RichEditor value={milestone.content} onChange={() => {}} readOnly minHeight={80} />
        ) : (
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>내용이 없습니다.</p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="sp-btn sp-btn-secondary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

// 마일스톤 생성/수정 폼 — milestone prop 없으면 생성, 있으면 수정
function MilestoneFormDialog({
  projectId, milestone, onClose,
}: {
  projectId:  string;
  milestone?: Milestone;
  onClose:    () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName]       = useState(milestone?.name ?? "");
  const [date, setDate]       = useState(milestone?.date ?? "");
  const [content, setContent] = useState(milestone?.content ?? "");

  const saveMutation = useMutation({
    mutationFn: () =>
      authFetch(
        milestone ? `/api/projects/${projectId}/milestones/${milestone.milestoneId}` : `/api/projects/${projectId}/milestones`,
        {
          method: milestone ? "PUT" : "POST",
          body:   JSON.stringify({ name, date, content }),
        }
      ),
    onSuccess: () => {
      toast.success("저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["milestones", projectId] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error("이름을 입력해 주세요."); return; }
    if (!date)         { toast.error("날짜를 선택해 주세요."); return; }
    saveMutation.mutate();
  }

  return (
    // 바깥(배경) 클릭으로 닫히지 않도록 onClick 없음 — 내용 작성 중 실수로 날리는 것 방지.
    // 닫기는 반드시 취소 버튼(또는 저장)으로만.
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <form
        onSubmit={handleSubmit}
        style={{ width: "100%", maxWidth: 560, background: "var(--color-bg-card)", border: "1px solid var(--color-border-strong)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-xl)", padding: "24px 24px", display: "flex", flexDirection: "column", gap: 14 }}
      >
        <h3 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-text-heading)" }}>
          {milestone ? "마일스톤 수정" : "마일스톤 추가"}
        </h3>

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={fieldLabelStyle}>이름</label>
            <input
              className="sp-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 오픈일, 1차 이행일, 착수보고회"
              maxLength={TEXT_LIMITS.milestoneName}
              autoFocus
            />
            <TextCounter field="milestoneName" value={name} />
          </div>
          <div style={{ width: 160 }}>
            <label style={fieldLabelStyle}>날짜</label>
            <input className="sp-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <div>
          <label style={fieldLabelStyle}>내용</label>
          <RichEditor
            value={content}
            onChange={setContent}
            minHeight={300}
            placeholder="장소·공지 등 팀원에게 전달할 내용을 작성하세요. 이미지도 붙여넣기(Ctrl+V) 할 수 있습니다."
            field="milestoneContent"
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="sp-btn sp-btn-secondary" onClick={onClose} disabled={saveMutation.isPending}>취소</button>
          <button type="submit" className="sp-btn sp-btn-primary" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── 공휴일 — WBS/업무일지 근무일 계산의 참조 데이터 (2026-07-22 도입) ─────────
//
// 마일스톤과 달리 수정 기능이 없다 — 날짜/이름 자체가 고정값에 가깝고, 잘못 등록해도
// 지우고 다시 등록하는 편이 "수정" UI를 따로 두는 것보다 간단하다.
// "표준 공휴일 일괄 등록" 버튼은 src/lib/constants/krHolidays.ts 의 대한민국 법정공휴일
// 참조 목록을 이 프로젝트에 그대로 복사한다 — 프로젝트마다 같은 내용을 반복 입력하지
// 않도록 만든 재사용 서비스. 중복 날짜는 서버에서 자동으로 건너뛴다.
function HolidaySection({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Holiday | null>(null);
  const [yearDeleteTarget, setYearDeleteTarget] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["holidays", projectId],
    queryFn: () =>
      authFetch<{ data: { items: Holiday[] } }>(`/api/projects/${projectId}/holidays`).then((r) => r.data.items),
  });
  const holidays = data ?? [];

  // 등록한 사람 본인이면 canManage(PM/PL·OWNER/ADMIN)가 아니어도 단건 삭제 가능 —
  // MilestoneSection과 동일하게 GNB가 캐시해 둔 프로필 조회를 그대로 공유한다.
  const { data: profile } = useQuery({
    queryKey: ["member", "profile"],
    queryFn: () => authFetch<{ data: { mberId: string } }>("/api/member/profile").then((r) => r.data),
  });
  const myMberId = profile?.mberId;

  // 연도별 아코디언 — 일괄 등록 시 5개년(90여 건)이 한 번에 쌓여 평면 목록이면
  // 스크롤이 감당 안 됨. 연도로 묶어 기본은 접어두고 올해/내년만 펼쳐서 보여준다.
  const holidaysByYear = new Map<string, Holiday[]>();
  for (const h of holidays) {
    const year = h.date.slice(0, 4);
    if (!holidaysByYear.has(year)) holidaysByYear.set(year, []);
    holidaysByYear.get(year)!.push(h);
  }
  const years = Array.from(holidaysByYear.keys()).sort();

  const thisYear = new Date().getFullYear();
  const [expandedYears, setExpandedYears] = useState<Set<string>>(
    () => new Set([String(thisYear), String(thisYear + 1)])
  );
  function toggleYear(year: string) {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year); else next.add(year);
      return next;
    });
  }

  const deleteMutation = useMutation({
    mutationFn: (holidayId: string) =>
      authFetch(`/api/projects/${projectId}/holidays/${holidayId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["holidays", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteYearMutation = useMutation({
    mutationFn: (year: string) =>
      authFetch(`/api/projects/${projectId}/holidays/by-year/${year}`, { method: "DELETE" }),
    onSuccess: (_res, year) => {
      toast.success(`${year}년 공휴일이 모두 삭제되었습니다.`);
      setYearDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["holidays", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: "var(--text-base)", fontWeight: 700, color: "var(--color-text-primary)" }}>공휴일</div>
          <p style={{ margin: "4px 0 0", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
            WBS·업무일지의 근무일 계산에 쓰입니다. 표준 공휴일을 한 번에 등록하거나 직접 추가하세요.
          </p>
        </div>
        {canManage && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              className="sp-btn sp-btn-secondary"
              style={{ fontSize: "var(--text-sm)", padding: "6px 12px" }}
              onClick={() => setBulkImportOpen(true)}
            >
              표준 공휴일 일괄 등록
            </button>
            <button type="button" className="sp-btn sp-btn-primary" style={{ fontSize: "var(--text-sm)", padding: "6px 12px" }} onClick={() => setFormOpen(true)}>
              + 추가
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div style={{ padding: "24px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }}>불러오는 중...</div>
      ) : holidays.length === 0 ? (
        <div style={{ padding: "24px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }}>
          등록된 공휴일이 없습니다.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {years.map((year) => {
            const items = holidaysByYear.get(year)!;
            const expanded = expandedYears.has(year);
            return (
              <div key={year} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-btn)", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", background: "var(--color-bg-muted)" }}>
                  <button
                    type="button"
                    onClick={() => toggleYear(year)}
                    style={{
                      flex: 1, display: "flex", alignItems: "center", gap: 8,
                      padding: "10px 12px", border: "none", cursor: "pointer",
                      background: "transparent", textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
                    <span style={{ fontSize: "var(--text-base)", fontWeight: 700, color: "var(--color-text-primary)" }}>{year}년</span>
                    <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>{items.length}건</span>
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      className="sp-btn sp-btn-ghost sp-btn-xs"
                      style={{ marginRight: 10, flexShrink: 0 }}
                      onClick={(e) => { e.stopPropagation(); setYearDeleteTarget(year); }}
                    >
                      이 연도 전체 삭제
                    </button>
                  )}
                </div>

                {expanded && (
                  // 카드형(테두리+배경 개별 박스) 대신 얇은 목록 + 3열 그리드.
                  // 일괄 등록 시 연도당 20여 건이 쌓이는데 카드 스타일이면 세로 공간을 너무 먹어서,
                  // 구분선만 있는 표 형태로 바꾸고 3열로 채워 같은 정보를 1/3 높이에 보여준다.
                  // DOM 순서(날짜 오름차순) 그대로 grid-auto-flow(기본 row)를 타므로
                  // 왼쪽→오른쪽, 다음 줄 순으로 읽어도 날짜 순서가 유지된다.
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0 12px", padding: "4px 10px 10px" }}>
                    {items.map((h) => (
                      <div
                        key={h.holidayId}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "6px 4px", borderBottom: "1px solid var(--color-border)",
                          minWidth: 0,
                        }}
                      >
                        <span style={{ flexShrink: 0, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}>
                          {h.date.slice(5)}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {h.name}
                        </span>
                        {h.type === "CUSTOM" && (
                          <span style={{ flexShrink: 0, fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--color-text-tertiary)" }}>
                            직접
                          </span>
                        )}
                        {(canManage || h.creatorMberId === myMberId) && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(h)}
                            title="삭제"
                            style={{ flexShrink: 0, border: "none", background: "none", cursor: "pointer", color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)", lineHeight: 1, padding: "2px 4px" }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {formOpen && <HolidayFormDialog projectId={projectId} onClose={() => setFormOpen(false)} />}
      {bulkImportOpen && <HolidayBulkImportDialog projectId={projectId} onClose={() => setBulkImportOpen(false)} />}

      <ConfirmDialog
        open={!!deleteTarget}
        title="공휴일 삭제"
        description={`'${deleteTarget?.name ?? ""}' (${deleteTarget?.date ?? ""}) 을 삭제하시겠습니까?`}
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.holidayId)}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={!!yearDeleteTarget}
        title={`${yearDeleteTarget ?? ""}년 공휴일 전체 삭제`}
        description={`${yearDeleteTarget ?? ""}년에 등록된 공휴일 ${yearDeleteTarget ? holidaysByYear.get(yearDeleteTarget)?.length ?? 0 : 0}건이 모두 삭제됩니다. 되돌릴 수 없어요. 정말 삭제하시겠어요?`}
        confirmLabel="정말 삭제할게요"
        loading={deleteYearMutation.isPending}
        onConfirm={() => yearDeleteTarget && deleteYearMutation.mutate(yearDeleteTarget)}
        onCancel={() => setYearDeleteTarget(null)}
      />
    </div>
  );
}

// 공휴일 직접 추가 폼 — 마일스톤과 달리 수정은 없고 생성만 지원
function HolidayFormDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");

  const saveMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/holidays`, { method: "POST", body: JSON.stringify({ name, date }) }),
    onSuccess: () => {
      toast.success("등록되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["holidays", projectId] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error("이름을 입력해 주세요."); return; }
    if (!date)         { toast.error("날짜를 선택해 주세요."); return; }
    saveMutation.mutate();
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <form
        onSubmit={handleSubmit}
        style={{ width: "100%", maxWidth: 420, background: "var(--color-bg-card)", border: "1px solid var(--color-border-strong)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-xl)", padding: "24px 24px", display: "flex", flexDirection: "column", gap: 14 }}
      >
        <h3 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-text-heading)" }}>공휴일 추가</h3>

        <div>
          <label style={fieldLabelStyle}>이름</label>
          <input
            className="sp-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 창립기념일, 워크샵"
            maxLength={TEXT_LIMITS.name}
            autoFocus
          />
          <TextCounter field="name" value={name} />
        </div>
        <div>
          <label style={fieldLabelStyle}>날짜</label>
          <input className="sp-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="sp-btn sp-btn-secondary" onClick={onClose} disabled={saveMutation.isPending}>취소</button>
          <button type="submit" className="sp-btn sp-btn-primary" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}

// 표준 공휴일 일괄 등록 다이얼로그 — 연도를 체크박스로 골라서 필요한 연도만 등록.
// KR_HOLIDAY_YEARS/KR_HOLIDAYS는 순수 데이터 상수라 서버 라우트뿐 아니라 이 클라이언트
// 컴포넌트에서도 그대로 import 해 연도별 건수 미리보기에 재사용한다.
function HolidayBulkImportDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const thisYear = new Date().getFullYear();
  // 기본 선택 — 올해/내년만 체크해 둠 (프로젝트 진행 기간과 겹칠 가능성이 가장 높음)
  const [selectedYears, setSelectedYears] = useState<Set<string>>(
    () => new Set([String(thisYear), String(thisYear + 1)].filter((y) => KR_HOLIDAY_YEARS.includes(y)))
  );

  function toggleYear(year: string) {
    setSelectedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year); else next.add(year);
      return next;
    });
  }

  const importMutation = useMutation({
    mutationFn: () =>
      authFetch<{ data: { addedCount: number; totalCount: number } }>(
        `/api/projects/${projectId}/holidays/bulk-import`,
        { method: "POST", body: JSON.stringify({ years: Array.from(selectedYears) }) }
      ),
    onSuccess: (res) => {
      const { addedCount } = res.data;
      toast.success(addedCount > 0 ? `${addedCount}건 등록되었습니다.` : "이미 모두 등록되어 있습니다.");
      queryClient.invalidateQueries({ queryKey: ["holidays", projectId] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedYears.size === 0) { toast.error("연도를 하나 이상 선택해 주세요."); return; }
    importMutation.mutate();
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <form
        onSubmit={handleSubmit}
        style={{ width: "100%", maxWidth: 420, background: "var(--color-bg-card)", border: "1px solid var(--color-border-strong)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-xl)", padding: "24px 24px", display: "flex", flexDirection: "column", gap: 14 }}
      >
        <h3 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-text-heading)" }}>표준 공휴일 일괄 등록</h3>
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          등록할 연도를 선택하세요. 이미 등록된 날짜는 중복 없이 건너뜁니다.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {KR_HOLIDAY_YEARS.map((year) => {
            const count = KR_HOLIDAYS.filter((h) => h.date.startsWith(year)).length;
            return (
              <label
                key={year}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 10px", borderRadius: "var(--radius-btn)",
                  border: "1px solid var(--color-border)",
                  background: selectedYears.has(year) ? "var(--color-brand-subtle)" : "var(--color-bg-muted)",
                  cursor: "pointer",
                }}
              >
                <input type="checkbox" checked={selectedYears.has(year)} onChange={() => toggleYear(year)} />
                <span style={{ flex: 1, fontSize: "var(--text-base)", fontWeight: 600, color: "var(--color-text-primary)" }}>{year}년</span>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>{count}건</span>
              </label>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="sp-btn sp-btn-secondary" onClick={onClose} disabled={importMutation.isPending}>취소</button>
          <button type="submit" className="sp-btn sp-btn-primary" disabled={importMutation.isPending}>
            {importMutation.isPending ? "등록 중..." : "등록"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── AR-00034 AI설정 탭 — 현재 "준비 중" 상태 ───────────────────────────────
//
// [2026-05-04] 일시 비활성화 사유:
//   - tb_pj_project_api_key 에 저장되는 키는 어디서도 읽지 않고(decryptApiKey 호출자 0건),
//     실제 AI 요청은 외부 워커(Claude Code/Python)가 자기 키로 처리한다.
//   - ai_call_mthd_code(DIRECT/QUEUE) 도 분기 로직이 없어 토글이 무의미하다.
//   → 사용자 혼동을 막기 위해 UI 만 "준비 중" 안내로 교체.
//   → 데이터/테이블/API/이력 기록은 모두 보존 — 미래 워커가 프로젝트 단위 키를 읽도록
//     확장될 때 아래 AiSettingsTabLive 를 export 만 바꿔 복원하면 된다.
function AiSettingsTab({ projectId: _projectId }: { projectId: string }) {
  // _projectId : 미래 복원 시 사용. 현재 placeholder 에서는 참조하지 않음.
  return (
    <div
      style={{
        background:    "var(--color-bg-card)",
        border:        "1px solid var(--color-border)",
        borderRadius:  "var(--radius-card)",
        padding:       "48px 24px",
        textAlign:     "center",
      }}
    >
      <div style={{ fontSize: 40, marginBottom: 12 }}>🛠️</div>
      <h3
        style={{
          margin:    "0 0 8px",
          fontSize:  "var(--text-lg)",
          fontWeight: 700,
          color:     "var(--color-text-heading)",
        }}
      >
        준비 중입니다
      </h3>
      <p
        style={{
          margin:    "0 auto",
          maxWidth:  420,
          fontSize:  "var(--text-sm)",
          color:     "var(--color-text-secondary)",
          lineHeight: 1.7,
        }}
      >
        AI API 키 관리와 호출 방식 설정 기능은 곧 제공될 예정입니다.<br />
        현재 AI 요청은 시스템 기본 설정으로 처리됩니다.
      </p>
    </div>
  );
}

// ── AR-00034 AI설정 탭 — 실제 구현 (현재 비활성, 복원용 보존) ──────────────
//
// 복원 방법:
//   1) 위 AiSettingsTab 의 본문을 <AiSettingsTabLive projectId={_projectId} /> 로 교체
//   2) 또는 위 함수를 통째로 지우고 이 함수의 이름을 AiSettingsTab 으로 되돌림
//
// 관련 백엔드 라우트(보존 중):
//   - GET/PUT /api/projects/[id]/settings/ai
//   - POST    /api/projects/[id]/settings/api-keys
//   - PUT/DELETE /api/projects/[id]/settings/api-keys/[keyId]
function AiSettingsTabLive({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();

  // 인라인 상태
  const [showAddForm,  setShowAddForm]  = useState(false);
  const [newProvider,  setNewProvider]  = useState("");
  const [newKey,       setNewKey]       = useState("");
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [editKey,      setEditKey]      = useState("");
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);
  const [callMethod,   setCallMethod]   = useState<"DIRECT" | "QUEUE">("DIRECT");
  const [methodLoaded, setMethodLoaded] = useState(false);

  // AI 설정 조회 (FID-00077)
  const { data: aiData, isLoading } = useQuery({
    queryKey: ["ai-settings", projectId],
    queryFn: () =>
      authFetch<{ data: AiSettings }>(`/api/projects/${projectId}/settings/ai`).then((r) => r.data),
  });

  // 처음 로드될 때 callMethod 초기화
  if (aiData && !methodLoaded) {
    setCallMethod(aiData.callMethod);
    setMethodLoaded(true);
  }

  const apiKeys = aiData?.apiKeys ?? [];

  // API 키 등록 (FID-00078)
  const addKeyMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/settings/api-keys`, {
        method: "POST", body: JSON.stringify({ provider: newProvider, apiKey: newKey }),
      }),
    onSuccess: () => {
      toast.success("API 키가 등록되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["ai-settings", projectId] });

      setShowAddForm(false); setNewProvider(""); setNewKey("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // API 키 수정 (FID-00079)
  const editKeyMutation = useMutation({
    mutationFn: (keyId: string) =>
      authFetch(`/api/projects/${projectId}/settings/api-keys/${keyId}`, {
        method: "PUT", body: JSON.stringify({ apiKey: editKey }),
      }),
    onSuccess: () => {
      toast.success("API 키가 수정되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["ai-settings", projectId] });

      setEditingId(null); setEditKey("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // API 키 삭제 (FID-00080)
  const delKeyMutation = useMutation({
    mutationFn: (keyId: string) =>
      authFetch(`/api/projects/${projectId}/settings/api-keys/${keyId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("API 키가 삭제되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["ai-settings", projectId] });

      setConfirmDelId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // AI 호출 방식 저장 (FID-00081)
  const saveMethodMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/settings/ai`, {
        method: "PUT", body: JSON.stringify({ callMethod }),
      }),
    onSuccess: () => {
      toast.success("저장되었습니다.");

    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <div style={{ color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }}>로딩 중...</div>;

  const cardStyle: React.CSSProperties = {
    background: "var(--color-bg-card)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-card)",
    padding: "20px",
    marginBottom: 16,
  };

  return (
    <div>
      {/* API 키 섹션 */}
      <div style={cardStyle}>
        <h3 style={{ margin: "0 0 8px", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--color-text-heading)" }}>AI API 키</h3>

        {/* 키 목록 */}
        {apiKeys.length === 0 && !showAddForm && (
          <p style={{ margin: "0 0 12px", fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>등록된 API 키가 없습니다.</p>
        )}
        {apiKeys.map((k) => (
          <div key={k.keyId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--color-border-subtle)" }}>
            {editingId === k.keyId ? (
              // 인라인 수정 폼
              <>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, minWidth: 80 }}>{k.provider}</span>
                <input className="sp-input" placeholder="새 API 키 입력" value={editKey} onChange={(e) => setEditKey(e.target.value)} style={{ flex: 1, fontSize: "var(--text-sm)" }} />
                <button className="sp-btn sp-btn-primary" style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }} onClick={() => editKeyMutation.mutate(k.keyId)} disabled={!editKey.trim() || editKeyMutation.isPending}>저장</button>
                <button className="sp-btn sp-btn-secondary" style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }} onClick={() => { setEditingId(null); setEditKey(""); }}>취소</button>
              </>
            ) : confirmDelId === k.keyId ? (
              // 인라인 삭제 확인
              <>
                <span style={{ flex: 1, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                  <strong>{k.provider}</strong> 키를 삭제하시겠습니까?
                </span>
                <button className="sp-btn sp-btn-primary" style={{ fontSize: "var(--text-xs)", padding: "4px 10px", background: "var(--color-error)", borderColor: "var(--color-error)" }} onClick={() => delKeyMutation.mutate(k.keyId)} disabled={delKeyMutation.isPending}>확인</button>
                <button className="sp-btn sp-btn-secondary" style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }} onClick={() => setConfirmDelId(null)}>아니오</button>
              </>
            ) : (
              // 기본 표시
              <>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, minWidth: 80 }}>{k.provider}</span>
                <span style={{ flex: 1, fontSize: "var(--text-sm)", fontFamily: "monospace", color: "var(--color-text-secondary)" }}>{k.maskedKey}</span>
                <button className="sp-btn sp-btn-secondary" style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }} onClick={() => { setEditingId(k.keyId); setEditKey(""); }}>수정</button>
                <button style={{ fontSize: "var(--text-xs)", padding: "4px 10px", background: "none", border: "1px solid var(--color-error)", color: "var(--color-error)", borderRadius: "var(--radius-btn)", cursor: "pointer" }} onClick={() => setConfirmDelId(k.keyId)}>삭제</button>
              </>
            )}
          </div>
        ))}

        {/* 인라인 등록 폼 */}
        {showAddForm ? (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 14 }}>
            <div style={{ flex: "0 0 120px" }}>
              <label style={fieldLabelStyle}>프로바이더</label>
              <input className="sp-input" placeholder="Claude" value={newProvider} onChange={(e) => setNewProvider(e.target.value)} style={{ fontSize: "var(--text-sm)" }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={fieldLabelStyle}>API 키</label>
              <input className="sp-input" placeholder="sk-ant-..." value={newKey} onChange={(e) => setNewKey(e.target.value)} type="password" style={{ fontSize: "var(--text-sm)" }} />
            </div>
            <button className="sp-btn sp-btn-primary" style={{ fontSize: "var(--text-xs)", padding: "8px 12px" }} onClick={() => addKeyMutation.mutate()} disabled={!newProvider.trim() || !newKey.trim() || addKeyMutation.isPending}>등록</button>
            <button className="sp-btn sp-btn-secondary" style={{ fontSize: "var(--text-xs)", padding: "8px 12px" }} onClick={() => { setShowAddForm(false); setNewProvider(""); setNewKey(""); }}>취소</button>
          </div>
        ) : (
          <button className="sp-btn sp-btn-secondary" style={{ marginTop: 14, fontSize: "var(--text-sm)" }} onClick={() => setShowAddForm(true)}>+ 키 등록</button>
        )}
      </div>

      {/* AI 호출 방식 섹션 */}
      <div style={cardStyle}>
        <h3 style={{ margin: "0 0 8px", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--color-text-heading)" }}>AI 호출 방식</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          {[
            { value: "DIRECT", label: "Claude API 직접 호출", desc: "등록된 API 키로 직접 요청합니다." },
            { value: "QUEUE",  label: "Claude Code 큐 기반",  desc: "큐를 통해 순차 처리합니다." },
          ].map((opt) => (
            <label key={opt.value} style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
              <input type="radio" name="callMethod" value={opt.value} checked={callMethod === opt.value} onChange={() => setCallMethod(opt.value as "DIRECT" | "QUEUE")} style={{ marginTop: 3 }} />
              <div>
                <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--color-text-primary)" }}>{opt.label}</div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="sp-btn sp-btn-primary" onClick={() => saveMethodMutation.mutate()} disabled={saveMethodMutation.isPending}>
            {saveMethodMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 문서 설정 탭 (출력 docx 양식 기본값) ─────────────────────────────────────
// 입력 항목:
//   - 기본 승인자 (PM)  — 표지/변경이력 표의 "승인자" 칸에 자동 채워짐. 외부 PM 도 OK
//                        (자유 텍스트 — 멤버 select 가 아닌 이유는 멤버 명단에 없는
//                         고객사 PM 도 들어갈 수 있어야 하기 때문).
//   - 저작권 문구       — 표지/바닥글에 들어가는 "Copyright ⓒ ..." 문구
//   - 기본 문서 버전    — 표지/변경이력 표 첫 행의 "v1.0" 같은 라벨
//
// 모두 비워두면 export 핸들러가 코드 fallback 사용 — 입력란 placeholder 가 그 fallback 값을 보여줌.

// 입력 필드 라벨 스타일 — 요구사항/과업 등 다른 상세 페이지(FormField)와 통일.
// 이 파일은 원래 공용 sp-label 클래스(11px, 대문자, letter-spacing)를 썼는데,
// 그건 auth 폼·모달류 전용 스타일이라 실제 컨텐츠 상세 페이지들의 라벨(13px, 일반 케이스)과
// 크기가 달라 보였다 — sp-label 클래스 자체는 다른 화면(로그인 등)에서 여전히 쓰이므로 그대로 두고,
// 이 파일에서만 로컬 스타일로 대체한다.
const fieldLabelStyle: React.CSSProperties = {
  display:    "block",
  marginBottom: 6,
  fontSize:   13,
  fontWeight: 600,
  color:      "var(--color-text-primary)",
};

// 입력란 아래 안내 문구 공통 스타일 — 같은 패턴이 3곳 반복되어 상수로 추출
// color 는 secondary — placeholder/회색 텍스트와 구분되어 잘 읽히도록
const fieldHintStyle: React.CSSProperties = {
  margin:     "6px 0 0",
  fontSize:   "var(--text-xs)",
  color:      "var(--color-text-secondary)",
  lineHeight: 1.6,
};

// 안내 문구 안의 예시 텍스트(코드체) — 발주처명·버전 라벨 같은 예시 강조
const hintCodeStyle: React.CSSProperties = {
  background:   "var(--color-bg-elevated)",
  padding:      "1px 6px",
  borderRadius: 3,
  fontFamily:   "var(--font-mono, monospace)",
  fontSize:     "0.95em",
  color:        "var(--color-text-primary)",
};

function DocumentSettingsTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["document-settings", projectId],
    queryFn: () =>
      authFetch<{ data: DocumentSettings }>(`/api/projects/${projectId}/settings/document`).then((r) => r.data),
  });

  // 폼 상태 — 입력값은 모두 string (빈 문자열 → 저장 시 null 로 변환)
  const [approverName,      setApproverName]      = useState("");
  const [copyrightHolder,   setCopyrightHolder]   = useState("");
  const [docVersionDefault, setDocVersionDefault] = useState("");
  const [systemName,        setSystemName]        = useState("");
  const [systemCode,        setSystemCode]        = useState("");
  const [docNoTemplate,     setDocNoTemplate]     = useState("");
  const [loaded, setLoaded] = useState(false);

  // 처음 로드된 데이터를 폼 상태에 한 번만 반영 — 사용자 편집 중에 덮어쓰지 않도록
  if (data && !loaded) {
    setApproverName(data.approverName ?? "");
    setCopyrightHolder(data.copyrightHolder ?? "");
    setDocVersionDefault(data.docVersionDefault ?? "");
    setSystemName(data.systemName ?? "");
    setSystemCode(data.systemCode ?? "");
    setDocNoTemplate(data.docNoTemplate ?? "");
    setLoaded(true);
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/settings/document`, {
        method: "PUT",
        // 빈 문자열은 명시적으로 null 로 — 사용자가 지우면 fallback 으로 돌아가도록
        body: JSON.stringify({
          approverName:      approverName      || null,
          copyrightHolder:   copyrightHolder   || null,
          docVersionDefault: docVersionDefault || null,
          systemName:        systemName        || null,
          systemCode:        systemCode        || null,
          docNoTemplate:     docNoTemplate     || null,
        }),
      }),
    onSuccess: () => {
      toast.success("저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["document-settings", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <div style={{ color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }}>로딩 중...</div>;

  // 위/아래 스택 레이아웃 — 다른 탭(기본정보·일정)과 같은 폭(1160)을 그대로 쓴다.
  // 예전엔 좌우 2단(폼 420px + 메타표 520px)이라 폼 안의 안내 문구가 좁은 폭에서
  // 여러 줄로 꺾여 카드가 세로로 길었는데, 전체 폭을 쓰면 그만큼 줄바꿈이 줄어 낮아진다.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--color-text-heading)" }}>출력 문서 양식 기본값</h3>
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          프로젝트의 모든 산출물 문서(.docx) 출력 시 표지·바닥글·변경이력 표에
          <strong> 공통으로 사용되는 기본값</strong>입니다.
          요구사항 명세서뿐 아니라 향후 추가될 단위업무·화면 등 모든 산출물에 동일하게 적용됩니다.
          비워두면 시스템 기본값으로 출력됩니다.
        </p>

        {/* 2열 그리드 — 값 대부분이 짧아(GBMS, v1.0 등) 전체 폭 입력창은 늘어져 보인다.
            6개 필드를 예외 없이 2열로 배치 — 3행으로 자동 정렬됨. */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 20px" }}>
          <div>
            <label style={fieldLabelStyle}>시스템명</label>
            <input
              className="sp-input"
              placeholder="(미설정 시 프로젝트명 사용)"
              value={systemName}
              onChange={(e) => setSystemName(e.target.value)}
              maxLength={100}
            />
            <p style={fieldHintStyle}>
              <strong>적용 위치:</strong> 표지 메타표의 &ldquo;시스템명&rdquo; 행.<br />
              비워두면 프로젝트명이 자동으로 들어갑니다. 예) <code style={hintCodeStyle}>온실가스감축인지 운영시스템</code>
            </p>
          </div>

          <div>
            <label style={fieldLabelStyle}>시스템코드 (문서번호용)</label>
            <input
              className="sp-input"
              placeholder="(미설정 시 약어 사용)"
              value={systemCode}
              onChange={(e) => setSystemCode(e.target.value)}
              maxLength={30}
            />
            <p style={fieldHintStyle}>
              <strong>적용 위치:</strong> 문서번호 템플릿의 <code style={hintCodeStyle}>{"{SYS}"}</code> 치환값.<br />
              비워두면 프로젝트 약어가 들어갑니다. 예) <code style={hintCodeStyle}>GDBS</code>
            </p>
          </div>

          <div>
            <label style={fieldLabelStyle}>문서번호 템플릿</label>
            <input
              className="sp-input"
              placeholder="{SYS}_{DOC}_{SEQ:3}"
              value={docNoTemplate}
              onChange={(e) => setDocNoTemplate(e.target.value)}
              maxLength={100}
            />
            <p style={fieldHintStyle}>
              <strong>적용 위치:</strong> 모든 산출물 문서의 <strong>머리글 우측 문서번호</strong>.<br />
              변수: <code style={hintCodeStyle}>{"{SYS}"}</code> 시스템코드 · <code style={hintCodeStyle}>{"{DOC}"}</code> 산출물코드(예 A301) · <code style={hintCodeStyle}>{"{SEQ:3}"}</code> 일련번호(3자리) · <code style={hintCodeStyle}>{"{YYYY}"}</code> 연도.<br />
              예) <code style={hintCodeStyle}>{"{SYS}_{DOC}_{SEQ:3}"}</code> → <code style={hintCodeStyle}>GDBS_A301_001</code>. 비워두면 기본 템플릿을 사용합니다.
            </p>
          </div>

          <div>
            <label style={fieldLabelStyle}>기본 승인자 (PM)</label>
            <input
              className="sp-input"
              placeholder="(미지정)"
              value={approverName}
              onChange={(e) => setApproverName(e.target.value)}
              maxLength={100}
            />
            <p style={fieldHintStyle}>
              <strong>적용 위치:</strong> 표지의 &ldquo;승인자&rdquo; 행, 변경이력 표 우측 끝 &ldquo;승인자&rdquo; 컬럼.<br />
              보통 프로젝트 PM 또는 검수 책임자 이름. 멤버가 아닌
              <strong> 외부 PM(고객사 측, 컨소시엄 PM 등) 이름도 자유 입력 가능</strong>합니다.
              추후 산출물별 발행 기능 도입 시에도 이 값이 발행 모달의 승인자 기본값으로 활용됩니다.
            </p>
          </div>

          <div>
            <label style={fieldLabelStyle}>저작권 문구</label>
            <input
              className="sp-input"
              placeholder="Copyright ⓒ SPECODE"
              value={copyrightHolder}
              onChange={(e) => setCopyrightHolder(e.target.value)}
              maxLength={255}
            />
            <p style={fieldHintStyle}>
              <strong>적용 위치:</strong> 모든 출력 문서의 <strong>각 페이지 바닥글 우측</strong>에 공통 표시.<br />
              발주처·컨소시엄명·구축사 등을 자유롭게 입력하세요.
              예) <code style={hintCodeStyle}>Copyright ⓒ (주)바른아이오</code>
            </p>
          </div>

          <div>
            <label style={fieldLabelStyle}>기본 문서 버전</label>
            <input
              className="sp-input"
              placeholder="v1.0"
              value={docVersionDefault}
              onChange={(e) => setDocVersionDefault(e.target.value)}
              maxLength={50}
            />
            <p style={fieldHintStyle}>
              <strong>적용 위치:</strong> 표지의 &ldquo;문서 버전&rdquo; 행, 변경이력 표 첫 행 &ldquo;버전&rdquo; 컬럼.<br />
              <strong>최초 발행 버전</strong>으로 사용됩니다. 표기는 자유 — 예) <code style={hintCodeStyle}>v1.0</code>, <code style={hintCodeStyle}>1.0.0</code>, <code style={hintCodeStyle}>v0.1</code>
            </p>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            className="sp-btn sp-btn-primary"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {/* 산출물별 문서 메타 오버라이드 (고급) — 위 폼 카드 아래로 스택 */}
      <ArtifactMetaCard projectId={projectId} />
    </div>
  );
}

// ── 산출물별 문서 메타 오버라이드 ────────────────────────────────────────────
type ArtifactMetaRow = { phase: string; activity: string; work: string; docCode: string };
const META_FIELDS: { key: keyof ArtifactMetaRow; label: string }[] = [
  { key: "phase",    label: "단계" },
  { key: "activity", label: "활동" },
  { key: "work",     label: "작업" },
  { key: "docCode",  label: "문서코드" },
];

/**
 * ArtifactMetaCard — 산출물 종류별 단계/활동/작업/문서코드 오버라이드 표.
 *
 * 기본값은 카탈로그(doc-meta-catalog.ts). 비워두면 그 기본값으로 출력되고,
 * 방법론이 다른 프로젝트만 여기서 덮어쓴다. placeholder 에 기본값을 노출해 무엇이
 * 적용되는지 보이게 한다.
 */
function ArtifactMetaCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  // 메타/번호를 갖는 모든 문서 종류 (요구사항정의서·요구사항명세서·과업대비표·프로그램사양서)
  const artifacts = DOC_META_CATALOG;

  const { data, isLoading } = useQuery({
    queryKey: ["artifact-meta", projectId],
    queryFn: () =>
      authFetch<{ data: { overrides: Record<string, Partial<ArtifactMetaRow>> } }>(
        `/api/projects/${projectId}/settings/artifact-meta`,
      ).then((r) => r.data.overrides),
  });

  // 산출물 key → 입력 상태 (빈 문자열 = 기본값 사용)
  const [rows, setRows] = useState<Record<string, ArtifactMetaRow>>({});
  const [loaded, setLoaded] = useState(false);
  if (data && !loaded) {
    const init: Record<string, ArtifactMetaRow> = {};
    for (const a of artifacts) {
      const o = data[a.key] ?? {};
      init[a.key] = {
        phase:    o.phase    ?? "",
        activity: o.activity ?? "",
        work:     o.work     ?? "",
        docCode:  o.docCode  ?? "",
      };
    }
    setRows(init);
    setLoaded(true);
  }

  function setField(key: string, field: keyof ArtifactMetaRow, value: string) {
    setRows((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      // 비어있지 않은 필드만 추려 전송 (빈 값은 카탈로그 기본값으로 fallback)
      const overrides: Record<string, Partial<ArtifactMetaRow>> = {};
      for (const a of artifacts) {
        const r = rows[a.key];
        if (!r) continue;
        const entry: Partial<ArtifactMetaRow> = {};
        for (const { key } of META_FIELDS) {
          if (r[key].trim()) entry[key] = r[key].trim();
        }
        if (Object.keys(entry).length > 0) overrides[a.key] = entry;
      }
      return authFetch(`/api/projects/${projectId}/settings/artifact-meta`, {
        method: "PUT",
        body:   JSON.stringify({ overrides }),
      });
    },
    onSuccess: () => {
      toast.success("저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["artifact-meta", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return null;

  return (
    <div style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
      <h3 style={{ margin: "0 0 4px", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--color-text-heading)" }}>
        산출물별 문서 메타 <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", fontWeight: 500 }}>(고급)</span>
      </h3>
      <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
        산출물 종류별 <strong>단계·활동·작업·문서코드</strong>입니다. 표지·문서번호에 사용됩니다.
        <strong> 비워두면 회색 기본값</strong>으로 출력되니, 방법론이 다른 프로젝트만 덮어쓰세요.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
          <thead>
            <tr>
              <th style={metaThStyle}>산출물</th>
              {META_FIELDS.map((f) => (
                <th key={f.key} style={metaThStyle}>{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {artifacts.map((a) => {
              const row = rows[a.key] ?? { phase: "", activity: "", work: "", docCode: "" };
              return (
                <tr key={a.key}>
                  <td style={{ ...metaTdStyle, whiteSpace: "nowrap" }}>
                    <span style={{ fontWeight: 600 }}>{a.label}</span>
                  </td>
                  {META_FIELDS.map((f) => (
                    <td key={f.key} style={metaTdStyle}>
                      <input
                        className="sp-input"
                        style={{ width: "100%" }}
                        placeholder={a[f.key] ?? ""}
                        value={row[f.key]}
                        onChange={(e) => setField(a.key, f.key, e.target.value)}
                        maxLength={50}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          className="sp-btn sp-btn-primary"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}

const metaThStyle: React.CSSProperties = {
  textAlign: "left", padding: "8px 8px", borderBottom: "1px solid var(--color-border)",
  fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--color-text-secondary)", whiteSpace: "nowrap",
};
const metaTdStyle: React.CSSProperties = {
  padding: "6px 8px", borderBottom: "1px solid var(--color-border-subtle, var(--color-border))",
  verticalAlign: "middle",
};

/**
 * NavCard — 프로젝트 설정 내 이동용 카드 컴포넌트
 */
function NavCard({
  title,
  description,
  icon,
  onClick,
  color,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  color?: string;
}) {
  const [isHover, setIsHover] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "20px 24px",
        background: isHover ? "var(--color-bg-elevated)" : "var(--color-bg-card)",
        border: "1px solid",
        borderColor: isHover ? color ?? "var(--color-brand)" : "var(--color-border)",
        borderRadius: "var(--radius-lg)",
        cursor: "pointer",
        transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        boxShadow: isHover ? "var(--shadow-md)" : "none",
        transform: isHover ? "translateY(-1px)" : "none",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: isHover ? (color ?? "var(--color-brand)") : "var(--color-bg-muted)",
          color: isHover ? "#fff" : (color ?? "var(--color-brand)"),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.2s",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", letterSpacing: "-0.01em" }}>{description}</div>
      </div>
      <div style={{ color: "var(--color-text-tertiary)", fontSize: 18, opacity: isHover ? 1 : 0.3, transition: "opacity 0.2s", paddingLeft: 4 }}>
        ›
      </div>
    </div>
  );
}

