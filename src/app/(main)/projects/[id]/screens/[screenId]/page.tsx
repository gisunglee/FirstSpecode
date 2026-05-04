"use client";

/**
 * ScreenDetailPage — 화면 상세·편집 (PID-00044)
 *
 * 역할:
 *   - 신규: screenId = "new" → POST (FID-00147 신규)
 *   - 수정: screenId 존재 → GET 로드(FID-00146) → PUT (FID-00147 수정 + 이력)
 *   - 하단 영역 목록 조회 (AR-00066, FID-00148) — 수정 모드에서만 표시
 *   - 영역 상세 이동 (FID-00149)
 *
 * 주요 기술:
 *   - TanStack Query: 상세 조회 및 캐시 무효화
 *   - useSearchParams: new 모드 시 unitWorkId pre-select 지원
 */

import { Suspense, useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { usePermissions } from "@/hooks/useMyRole";
import MarkdownEditor, { MarkdownTabButtons } from "@/components/ui/MarkdownEditor";
import { ScreenLayoutEditor, type LayoutRow } from "@/components/ui/ScreenLayoutEditor";
import SettingsHistoryDialog from "@/components/ui/SettingsHistoryDialog";
import AssigneeHistoryDialog from "@/components/ui/AssigneeHistoryDialog";
import PrdDownloadDialog from "@/components/ui/PrdDownloadDialog";
import DesignExamplePopup from "@/components/ui/DesignExamplePopup";
import { useDesignTemplate, applyTemplateVars } from "@/lib/designTemplate";
import { useAppStore } from "@/store/appStore";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type UnitWorkOption = {
  unitWorkId: string;
  displayId: string;
  name: string;
};

type AreaRow = {
  areaId: string;
  displayId: string;
  name: string;
  type: string;
  sortOrder: number;
  designRt: number;
  implRt: number;
  testRt: number;
};

type ScreenDetail = {
  screenId: string;
  displayId: string;
  name: string;
  description: string;
  comment: string;
  layoutData: string | null;
  type: string;
  sortOrder: number;
  categoryL: string;
  categoryM: string;
  categoryS: string;
  // 담당자 — 서버 join으로 내려옴
  assignMemberId:   string | null;
  assignMemberName: string | null;
  unitWorkId: string | null;
  unitWorkName: string;
  areas: AreaRow[];
};

type SaveBody = {
  unitWorkId?: string;
  displayId?: string;
  name: string;
  description: string;
  comment?: string;
  type: string;
  sortOrder: number;
  categoryL: string;
  categoryM: string;
  categoryS: string;
  layoutData?: string;
  saveHistory?: boolean;
  // 담당자 — "" = 미지정, 서버에서 null 처리
  assignMemberId: string;
};

// 프로젝트 멤버 — 담당자 콤보박스 옵션용
type ProjectMember = {
  memberId: string;
  name:     string | null;
  email:    string;
  role:     string;
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function ScreenDetailPage() {
  return (
    <Suspense fallback={null}>
      <ScreenDetailPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function ScreenDetailPageInner() {
  const params = useParams<{ id: string; screenId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setBreadcrumb } = useAppStore();
  const projectId = params.id;
  const screenId = params.screenId;
  const isNew = screenId === "new";

  // useSearchParams()는 Suspense 안에서만 동작 — 페이지 래퍼에서 보장됨
  const presetUnitWorkId = searchParams.get("unitWorkId") ?? "";

  // ── 폼 상태 ────────────────────────────────────────────────────────────────
  const [form, setForm] = useState<SaveBody>({
    unitWorkId: presetUnitWorkId || undefined,
    displayId: "",
    name: "",
    description: "",
    comment: "",
    type: "LIST",
    sortOrder: 0,
    categoryL: "",
    categoryM: "",
    categoryS: "",
    assignMemberId: "",
  });

  // 담당자 변경 이력 팝업 상태 — 설명 이력(historyViewOpen)과 별개 다이얼로그
  const [assigneeHistoryOpen, setAssigneeHistoryOpen] = useState(false);

  // 레이아웃 에디터 상태 (기본: 빈 배열)
  const [layoutRows, setLayoutRows] = useState<LayoutRow[]>([]);

  // 화면 설명 예시 팝업
  const [descExampleOpen, setDescExampleOpen] = useState(false);

  // 설계 양식 DB 조회 — 화면 계층
  const { data: designTmpl } = useDesignTemplate(projectId, "SCREEN");
  const [descTab, setDescTab] = useState<"edit" | "preview">("edit");

  // 설명 변경 이력 저장 여부 확인 다이얼로그
  const [prdOpen, setPrdOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);

  // 이력 조회 팝업 (SettingsHistoryDialog)
  const [historyViewOpen, setHistoryViewOpen] = useState(false);

  // 도움말 풍선
  const [helpOpen, setHelpOpen] = useState<string | null>(null);

  // 이력 저장 시 원본 설명 추적용
  const [originalDescription, setOriginalDescription] = useState("");

  // ── 단위업무 목록 조회 (단위업무 선택용) ─────────────────────────────────────
  const { data: uwData } = useQuery({
    queryKey: ["unit-works-for-select", projectId],
    queryFn: () =>
      authFetch<{ data: { items: UnitWorkOption[] } }>(
        `/api/projects/${projectId}/unit-works`
      ).then((r) => r.data.items),
  });
  const uwOptions = uwData ?? [];

  // ── 프로젝트 멤버 목록 조회 (담당자 콤보박스용) ─────────────────────────────
  const { data: memberData } = useQuery({
    queryKey: ["project-members", projectId],
    queryFn:  () =>
      authFetch<{ data: { members: ProjectMember[]; myMemberId: string } }>(
        `/api/projects/${projectId}/members`
      ).then((r) => r.data),
    staleTime: 60 * 1000, // 1분
  });
  const members    = memberData?.members ?? [];
  const myMemberId = memberData?.myMemberId ?? "";

  // ── 기존 화면 로드 (수정 모드) ─────────────────────────────────────────────
  //
  // ⚠️ 중요: queryFn 안에서 setState를 호출하지 않는다.
  //   TanStack Query는 동일 queryKey에 대해 캐시 hit 시 queryFn을 재실행하지 않으므로
  //   queryFn 내부의 setState는 "뒤로 가기 → 동일 row 재진입" 시 실행되지 않아
  //   form이 빈 상태로 남아 "조회 안됨"처럼 보이는 버그가 발생한다.
  //   대신 아래 useEffect에서 detail 변경을 감지해 form을 동기화한다.
  const { data: detail, isLoading: isDetailLoading } = useQuery({
    queryKey: ["screen", projectId, screenId],
    queryFn: () =>
      authFetch<{ data: ScreenDetail }>(
        `/api/projects/${projectId}/screens/${screenId}`
      ).then((r) => r.data),
    enabled: !isNew,
  });

  // ── 편집 권한 계산 ─────────────────────────────────────────────────────────
  // 통과: OWNER/ADMIN 역할 OR PM/PL 직무 OR 본인이 화면 담당자.
  const { has: hasPerm } = usePermissions(projectId);
  const matrixUpdateOK = hasPerm("requirement.update");
  const originalAssigneeId = detail?.assignMemberId ?? null;
  const isAssignee = !!myMemberId && originalAssigneeId === myMemberId;
  const canEdit = isNew ? true : (matrixUpdateOK || isAssignee);

  // detail이 로드되거나 다른 screenId로 바뀌면 폼/레이아웃을 항상 동기화.
  //   캐시 hit(재방문) 시에도 detail은 바로 값이 들어와 이 효과가 재실행되므로
  //   "동일 row 재진입" 케이스에서 폼이 비어 보이는 문제를 원천 차단한다.
  useEffect(() => {
    if (!detail) return;
    setForm({
      unitWorkId:     detail.unitWorkId ?? undefined,
      displayId:      detail.displayId ?? "",
      name:           detail.name,
      description:    detail.description ?? "",
      comment:        detail.comment ?? "",
      type:           detail.type,
      sortOrder:      detail.sortOrder,
      categoryL:      detail.categoryL,
      categoryM:      detail.categoryM,
      categoryS:      detail.categoryS,
      assignMemberId: detail.assignMemberId ?? "",
    });
    setOriginalDescription(detail.description ?? "");
    if (detail.layoutData) {
      try { setLayoutRows(JSON.parse(detail.layoutData)); } catch { /* 잘못된 JSON 무시 */ }
    } else {
      setLayoutRows([]);
    }
  }, [detail]);

  // ── 삭제 상태 / 뮤테이션 ─────────────────────────────────────────────────
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteChildren, setDeleteChildren] = useState<boolean | null>(null);

  const deleteMutation = useMutation({
    mutationFn: () => {
      const hasAreas = (detail?.areas?.length ?? 0) > 0;
      const childFlag = hasAreas ? deleteChildren : true;
      if (hasAreas && childFlag === null) throw new Error("하위 데이터 처리 방법을 선택해 주세요.");
      return authFetch(
        `/api/projects/${projectId}/screens/${screenId}?deleteChildren=${childFlag ?? true}`,
        { method: "DELETE" }
      );
    },
    onSuccess: () => {
      toast.success("화면이 삭제되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["screens", projectId] });
      router.push(`/projects/${projectId}/screens`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 저장 뮤테이션 ──────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (body: SaveBody) =>
      isNew
        ? authFetch<{ data: { screenId: string } }>(`/api/projects/${projectId}/screens`, {
          method: "POST",
          body: JSON.stringify(body),
        })
        : authFetch<{ data: { screenId: string } }>(`/api/projects/${projectId}/screens/${screenId}`, {
          method: "PUT",
          body: JSON.stringify(body),
        }),
    onSuccess: (res, variables) => {
      toast.success(isNew ? "화면이 등록되었습니다." : "저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["screens", projectId] });
      if (isNew && res?.data?.screenId) {
        // 신규 등록 후 생성된 화면 상세로 이동
        router.replace(`/projects/${projectId}/screens/${res.data.screenId}`);
      } else {
        // 수정 후 현재 페이지 데이터 갱신 (상세에 그대로 유지)
        queryClient.invalidateQueries({ queryKey: ["screen", projectId, screenId] });
        // 저장 완료 후 원본 설명을 현재 값으로 갱신
        setOriginalDescription(variables.description ?? "");
        if (variables.saveHistory) {
          // 이력 목록 캐시 무효화
          queryClient.invalidateQueries({ queryKey: ["settings-history", projectId] });
        }
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleChange(field: keyof SaveBody, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function doSave(saveHistory: boolean) {
    saveMutation.mutate({
      ...form,
      layoutData: layoutRows.length > 0 ? JSON.stringify(layoutRows) : undefined,
      saveHistory: saveHistory || undefined,
    });
    setHistoryDialogOpen(false);
  }

  function handleSave() {
    if (!form.name.trim()) {
      toast.error("화면명을 입력해 주세요.");
      return;
    }
    // 수정 모드에서 설명이 변경된 경우 이력 저장 여부 확인
    const descriptionChanged = !isNew && form.description.trim() !== originalDescription.trim();
    if (descriptionChanged) {
      setHistoryDialogOpen(true);
      return;
    }
    doSave(false);
  }

  // GNB 브레드크럼 설정 — 단위업무 > 화면 > 영역 목록
  useEffect(() => {
    if (isNew) {
      setBreadcrumb([
        { label: "화면 설계", href: `/projects/${projectId}/screens` },
        { label: "신규 등록" },
      ]);
    } else if (detail) {
      const d = detail as unknown as { unitWorkId?: string | null; unitWorkDisplayId?: string | null; unitWorkName?: string };
      const items = [
        // 단위업무 (클릭 → 단위업무 상세)
        ...(d.unitWorkId && d.unitWorkName
          ? [{ label: `${d.unitWorkDisplayId ?? ""} ${d.unitWorkName}`.trim(), href: `/projects/${projectId}/unit-works/${d.unitWorkId}` }]
          : []),
        // 화면 (현재 페이지)
        { label: `${detail.displayId} ${detail.name}` },
        // 하위 영역 목록
        { label: "영역 목록", href: `/projects/${projectId}/areas?screenId=${screenId}` },
      ];
      setBreadcrumb(items);
    }
    return () => setBreadcrumb([]);
  }, [projectId, screenId, isNew, detail, setBreadcrumb]);

  // ── 로딩 ───────────────────────────────────────────────────────────────────
  if (!isNew && isDetailLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>화면 정보를 불러오는 중...</div>;
  }

  return (
    <div style={{ padding: 0 }}>
      {/* 타이틀 행 — full-width 배경 */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16,
        padding: "10px 24px",
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        {/* 좌: 뒤로 + 타이틀 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/screens`)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1 }}
          >
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {isNew ? "화면 신규 등록" : `화면 편집 (${detail?.displayId ?? ""})`}
          </span>
        </div>
        {/* 우: PRD 다운로드 + 삭제·취소·저장 */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {!isNew && (
            <button
              onClick={() => setPrdOpen(true)}
              title="PRD 다운로드"
              style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 12px" }}
            >
              PRD ↓
            </button>
          )}
          <button
            onClick={() => router.push(`/projects/${projectId}/screens`)}
            disabled={saveMutation.isPending}
            style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 14px", minWidth: 60 }}
          >
            취소
          </button>
          {/* 삭제 — 신규 모드 아니고 편집 권한 있을 때만 노출 */}
          {!isNew && canEdit && (
            <button
              onClick={() => { setDeleteChildren(null); setDeleteConfirmOpen(true); }}
              disabled={saveMutation.isPending}
              style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 14px", minWidth: 60, color: "#e53935", borderColor: "#e53935" }}
            >
              삭제
            </button>
          )}
          {/* 저장 — 편집 권한자만 노출 */}
          {canEdit && (
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px", minWidth: 60 }}
            >
              {saveMutation.isPending ? "저장 중..." : "저장"}
            </button>
          )}
        </div>
      </div>

      <div style={{ padding: "0 24px 24px" }}>
        {/* 읽기 전용 안내 — 권한 없는 사용자가 진입한 경우 명시 */}
        {!isNew && !canEdit && (
          <div style={{
            margin: "0 0 16px",
            padding: "10px 14px",
            background: "var(--color-info-subtle, #f0f4ff)",
            border: "1px solid var(--color-info, #3b82f6)",
            borderRadius: 6,
            fontSize: 12,
            color: "var(--color-text-secondary)",
          }}>
            🔒 <strong>읽기 전용</strong> — 이 화면은 OWNER/ADMIN 또는 PM/PL 직무, 혹은 담당자만 수정할 수 있습니다.
          </div>
        )}
        {/* 2-컬럼 레이아웃: 기본 정보 | 화면 설명 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 28, alignItems: "start" }}>

          {/* 왼쪽: 기본 정보 + 영역 목록 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

            {/* AR-00065 기본 정보 폼 */}
            <Section title="기본 정보" hideTitle>
              {/* 상위 단위업무 선택 */}
              <FormField label="상위 단위업무">
                <select
                  value={form.unitWorkId ?? ""}
                  onChange={(e) => handleChange("unitWorkId", e.target.value)}
                  disabled={!canEdit}
                  style={selectStyle}
                >
                  <option value="">미분류</option>
                  {uwOptions.map((uw) => (
                    <option key={uw.unitWorkId} value={uw.unitWorkId}>
                      {uw.displayId} — {uw.name}
                    </option>
                  ))}
                </select>
              </FormField>

              {/* 화면명 + 표시 ID */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 16 }}>
                <FormField label="화면명" required>
                  <input
                    type="text"
                    value={form.name}
                    placeholder="화면명을 입력하세요"
                    onChange={(e) => handleChange("name", e.target.value)}
                    readOnly={!canEdit}
                    style={inputStyle}
                  />
                </FormField>
                <FormField label={<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>표시 ID<HelpIcon onClick={() => setHelpOpen("displayId")} /></span>}>
                  <input
                    type="text"
                    value={form.displayId ?? ""}
                    placeholder="미입력 시 자동 생성"
                    onChange={(e) => handleChange("displayId", e.target.value)}
                    readOnly={!canEdit}
                    style={inputStyle}
                  />
                </FormField>
              </div>

              {/* 담당자 + 화면 유형 + 정렬 순서 — 담당자에 더 넓은 공간 */}
              {/* 담당자 라벨 옆 작은 시계 아이콘 = 변경 이력 팝업 (신규 등록 모드에서는 숨김) */}
              {/* FormField 대신 인라인 div — <label> 안에 <button>이 있으면 라벨 빈 영역 클릭이 */}
              {/*   브라우저 기본 동작으로 버튼에 전달되기 때문 */}
              <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 100px", gap: 16 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6, fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
                    <span>담당자</span>
                    {!isNew && (
                      <button
                        type="button"
                        onClick={() => setAssigneeHistoryOpen(true)}
                        title="담당자 변경 이력"
                        style={inlineIconBtnStyle}
                      >
                        {/* 시계(이력) 아이콘 — 14px, currentColor로 테마 대응 */}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth="2"
                             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 7v5l3 2" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <select
                    value={form.assignMemberId}
                    onChange={(e) => handleChange("assignMemberId", e.target.value)}
                    disabled={!canEdit}
                    style={selectStyle}
                  >
                    <option value="">담당자 없음</option>
                    {members.map((m) => (
                      <option key={m.memberId} value={m.memberId}>
                        {m.name ?? m.email}
                        {m.memberId === myMemberId ? " (나)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <FormField label="화면 유형">
                  <select
                    value={form.type}
                    onChange={(e) => handleChange("type", e.target.value)}
                    disabled={!canEdit}
                    style={selectStyle}
                  >
                    <option value="LIST">LIST</option>
                    <option value="DETAIL">DETAIL</option>
                    <option value="INPUT">INPUT</option>
                    <option value="POPUP">POPUP</option>
                    <option value="TAB">TAB</option>
                    <option value="REPORT">REPORT</option>
                  </select>
                </FormField>
                <FormField label="정렬 순서">
                  <input
                    type="number"
                    min={0}
                    value={form.sortOrder}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, sortOrder: parseInt(e.target.value) || 0 }))
                    }
                    readOnly={!canEdit}
                    style={inputStyle}
                  />
                </FormField>
              </div>

              {/* 메뉴 분류 (대/중/소) */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                <FormField label={<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>대분류<HelpIcon onClick={() => setHelpOpen("category")} /></span>}>
                  <input
                    type="text"
                    value={form.categoryL}
                    placeholder="예: 회원 관리"
                    onChange={(e) => handleChange("categoryL", e.target.value)}
                    readOnly={!canEdit}
                    style={inputStyle}
                  />
                </FormField>
                <FormField label="중분류">
                  <input
                    type="text"
                    value={form.categoryM}
                    placeholder="예: 회원 정보"
                    onChange={(e) => handleChange("categoryM", e.target.value)}
                    readOnly={!canEdit}
                    style={inputStyle}
                  />
                </FormField>
                <FormField label="소분류">
                  <input
                    type="text"
                    value={form.categoryS}
                    placeholder="예: 목록 조회"
                    onChange={(e) => handleChange("categoryS", e.target.value)}
                    readOnly={!canEdit}
                    style={inputStyle}
                  />
                </FormField>
              </div>
            </Section>

            {/* 레이아웃 에디터 — 기본 정보 아래 */}
            <Section title="레이아웃 구성" hideTitle small>
              {/* ScreenLayoutEditor 자체는 readOnly prop 미지원 → 권한 없을 때 onChange를
                  no-op으로 묶어 사용자가 만져도 상태가 변하지 않도록 함. 시각적으로 잠겼음을
                  나타내기 위해 부모 div 에 opacity / pointer-events 처리를 더한다. */}
              <div style={canEdit ? undefined : { opacity: 0.7, pointerEvents: "none" }}>
                <ScreenLayoutEditor
                  title={<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>레이아웃 구성<HelpIcon onClick={() => setHelpOpen("layout")} /></span>}
                  value={layoutRows}
                  onChange={canEdit ? setLayoutRows : () => {}}
                  areas={detail?.areas.map((a) => ({
                    areaId: a.areaId,
                    displayId: a.displayId,
                    name: a.name,
                  }))}
                />
              </div>
            </Section>

            {/* AR-00066 영역 목록 (수정 모드에서만, FID-00148) */}
            {!isNew && detail && (
              <AreaListSection
                areas={detail.areas}
                projectId={projectId}
                screenId={screenId}
                router={router}
              />
            )}
          </div>

          {/* 오른쪽: 화면 설명 (마크다운) */}
          <Section
            title="화면 설명"
            small
            headerLeft={<MarkdownTabButtons tab={descTab} onTabChange={setDescTab} />}
            headerRight={
              <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => setDescExampleOpen(true)}
                  disabled={!designTmpl?.exampleCn}
                  style={{ ...ghostSmBtnStyle, opacity: designTmpl?.exampleCn ? 1 : 0.5, cursor: designTmpl?.exampleCn ? "pointer" : "not-allowed" }}
                >
                  예시
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!designTmpl?.templateCn) return;
                    handleChange(
                      "description",
                      applyTemplateVars(designTmpl.templateCn, {
                        displayId: detail?.displayId ?? "PID-XXXXX",
                        name:      form.name,
                      }),
                    );
                  }}
                  disabled={!designTmpl?.templateCn}
                  style={{ ...ghostSmBtnStyle, opacity: designTmpl?.templateCn ? 1 : 0.5, cursor: designTmpl?.templateCn ? "pointer" : "not-allowed" }}
                >
                  템플릿 삽입
                </button>
                {!isNew && (
                  <button
                    type="button"
                    onClick={() => setHistoryViewOpen(true)}
                    style={ghostSmBtnStyle}
                  >
                    🕐 변경 이력
                  </button>
                )}
              </div>
            }
          >
            <MarkdownEditor
              value={form.description}
              onChange={(md) => handleChange("description", md)}
              placeholder="화면 내용 및 세부 설계를 작성하세요."
              rows={26}
              tab={descTab}
              onTabChange={setDescTab}
              readOnly={!canEdit}
            />
          </Section>

          {/* 화면 설명 예시 팝업 — DB 설계 양식 */}
          {descExampleOpen && designTmpl?.exampleCn && (
            <DesignExamplePopup
              title="화면 설명 예시"
              contentMd={designTmpl.exampleCn}
              onClose={() => setDescExampleOpen(false)}
            />
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
                  화면 설명이 변경되었습니다.<br />
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
                    onClick={() => doSave(false)}
                    disabled={saveMutation.isPending}
                    style={{ ...secondaryBtnStyle, fontSize: 13, padding: "6px 16px" }}
                  >
                    이력 없이 저장
                  </button>
                  <button
                    type="button"
                    onClick={() => doSave(true)}
                    disabled={saveMutation.isPending}
                    style={{ ...primaryBtnStyle, fontSize: 13, padding: "6px 16px" }}
                  >
                    이력과 함께 저장
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 삭제 확인 다이얼로그 */}
          {deleteConfirmOpen && (
            <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
              onClick={() => setDeleteConfirmOpen(false)}
            >
              <div style={{ background: "var(--color-bg-card)", borderRadius: 10, padding: "28px 32px", minWidth: 360, maxWidth: 480, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>화면 삭제</div>
                <p style={{ fontSize: 14, color: "var(--color-text-secondary)", marginBottom: 16 }}>
                  <strong style={{ color: "var(--color-text-primary)" }}>{detail?.displayId} {detail?.name}</strong> 화면을 삭제합니다.
                </p>
                {(detail?.areas?.length ?? 0) > 0 && (
                  <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                    <p style={{ fontSize: 13, color: "#e53935", marginBottom: 4 }}>이 화면에 영역이 {detail!.areas.length}개 있습니다. 처리 방법을 선택하세요.</p>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                      <input type="radio" name="deleteChildren" checked={deleteChildren === true} onChange={() => setDeleteChildren(true)} />
                      영역 포함 모두 삭제
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                      <input type="radio" name="deleteChildren" checked={deleteChildren === false} onChange={() => setDeleteChildren(false)} />
                      화면만 삭제 (영역 미분류 상태로 유지)
                    </label>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button onClick={() => setDeleteConfirmOpen(false)} style={secondaryBtnStyle} disabled={deleteMutation.isPending}>취소</button>
                  <button
                    onClick={() => deleteMutation.mutate()}
                    style={{ ...secondaryBtnStyle, color: "#e53935", borderColor: "#e53935" }}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? "삭제 중..." : "삭제"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* PRD 다운로드 팝업 */}
          <PrdDownloadDialog
            open={prdOpen}
            onClose={() => setPrdOpen(false)}
            projectId={projectId}
            availableLevels={["UNIT_WORK", "SCREEN"]}
            defaultLevel="SCREEN"
            unitWorkId={detail?.unitWorkId}
            screenId={screenId}
          />

          {/* 설명 변경 이력 조회 팝업 */}
          <SettingsHistoryDialog
            open={historyViewOpen}
            onClose={() => setHistoryViewOpen(false)}
            projectId={projectId}
            itemName="화면 설명"
            currentValue={form.description}
            title="화면 설명 변경 이력"
            refTblNm="tb_ds_screen"
            refId={screenId}
          />

          {/* 담당자 변경 이력 — 경량 전용 다이얼로그 (diff 없음, 타임라인만) */}
          <AssigneeHistoryDialog
            open={assigneeHistoryOpen}
            onClose={() => setAssigneeHistoryOpen(false)}
            projectId={projectId}
            refTblNm="tb_ds_screen"
            refId={screenId}
            currentAssigneeName={detail?.assignMemberName ?? ""}
          />

          {/* ── 도움말 팝업 ── */}
          {helpOpen && SCREEN_HELP[helpOpen] && (
            <div
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200 }}
              onClick={() => setHelpOpen(null)}
            >
              <div
                style={{ background: "var(--color-bg-card)", borderRadius: 12, padding: "24px 28px", minWidth: 400, maxWidth: 520, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>{SCREEN_HELP[helpOpen].title}</span>
                  <button onClick={() => setHelpOpen(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1 }}>×</button>
                </div>
                <div style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.8, whiteSpace: "pre-line" }}>
                  {SCREEN_HELP[helpOpen].body}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

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

// ── 도움말 내용 ──────────────────────────────────────────────────────────────

const SCREEN_HELP: Record<string, { title: string; body: string }> = {
  layout: {
    title: "레이아웃 구성 안내",
    body:
      "화면을 구성하는 영역의 배치를 설정합니다.\n\n" +
      "• 행(Row)을 추가한 뒤, 각 행에 열(Column)을 배치하세요.\n" +
      "• 열마다 너비(%)와 대상 영역을 지정할 수 있습니다.\n" +
      "• 하위 영역이 등록되어 있으면 드롭다운으로 선택할 수 있습니다.\n" +
      "• 같은 행의 열 너비 합이 100%가 되도록 조정해 주세요.\n\n" +
      "💡 [출력] 버튼을 클릭하면 마크다운·JSON 형식으로 변환됩니다.\n" +
      "출력된 텍스트를 화면 설명에 붙여 넣으면 AI 설계 시 레이아웃 정보를 활용할 수 있습니다.",
  },
  displayId: {
    title: "표시 ID 안내",
    body:
      "명칭 대신 화면에 표시되는 고유 식별자입니다.\n" +
      "비워 두면 자동으로 생성됩니다.\n\n" +
      "예시)\n" +
      "• 단위업무: UW-00001\n" +
      "• 화면: SCR-00001\n" +
      "• 영역: AR-00001\n" +
      "• 기능: FN-00001",
  },
  category: {
    title: "대분류 · 중분류 · 소분류",
    body:
      "화면에 대한 분류를 자유롭게 지정할 수 있습니다.\n\n" +
      "• 필수 값이 아니므로 비워 두어도 무방합니다.\n" +
      "• 분류를 입력하면 화면 목록에서 해당 텍스트로 필터링·검색할 수 있습니다.\n" +
      "• 업무 분류(예: 회원 관리 > 회원 정보 > 목록 조회) 또는\n  메뉴 계층 용도로 활용하시면 됩니다.",
  },
};

// ── AR-00066 영역 목록 섹션 ───────────────────────────────────────────────────

function AreaListSection({
  areas, projectId, screenId, router,
}: {
  areas: AreaRow[];
  projectId: string;
  screenId: string;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <Section
      title={`영역 목록 (총 ${areas.length}개)`}
      small
      headerRight={
        <button
          onClick={() => router.push(`/projects/${projectId}/areas?screenId=${screenId}`)}
          style={{ ...secondaryBtnStyle, fontSize: 12, padding: "4px 12px" }}
        >
          영역 목록 관리 →
        </button>
      }
    >
      {areas.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "#aaa" }}>등록된 영역이 없습니다.</p>
      ) : (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
          {/* 헤더 */}
          <div style={areaGridHeaderStyle}>
            <div>순서</div>
            <div>영역명</div>
            <div style={{ textAlign: "center" }}>설/구/테</div>
            <div style={{ textAlign: "right" }}>유형</div>
          </div>
          {/* 행 */}
          {areas.map((area, idx) => (
            <div
              key={area.areaId}
              style={{
                ...areaGridRowStyle,
                borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
              }}
            >
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                {area.sortOrder}
              </div>
              {/* 영역명 클릭 → 영역 상세 (FID-00149) */}
              <div>
                <button
                  onClick={() => router.push(`/projects/${projectId}/areas/${area.areaId}`)}
                  style={linkBtnStyle}
                >
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)", marginRight: 6 }}>
                    {area.displayId}
                  </span>
                  {area.name}
                </button>
              </div>
              <div style={{ display: "flex", gap: 3, justifyContent: "center", fontSize: 11 }}>
                {[
                  { val: area.designRt, color: "#1565c0" },
                  { val: area.implRt, color: "#2e7d32" },
                  { val: area.testRt, color: "#6a1b9a" },
                ].map(({ val, color }, i) => (
                  <span key={i} style={{
                    color, fontWeight: 600,
                    background: val === 100 ? `${color}14` : "transparent",
                    borderRadius: 3, padding: "1px 3px",
                  }}>
                    {val}%
                  </span>
                ))}
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={areaTypeBadgeStyle(area.type)}>{area.type}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ── 공통 컴포넌트 ─────────────────────────────────────────────────────────────

function Section({
  title, headerLeft, headerRight, children, small = false, hideTitle = false,
}: {
  title: string;
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  /** 타이틀을 작은 uppercase 레이블로 표시 */
  small?: boolean;
  /** 타이틀 행 자체를 숨김 */
  hideTitle?: boolean;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        padding: small ? "14px 16px" : "20px 24px",
        background: "var(--color-bg-card)",
        display: "flex",
        flexDirection: "column",
        gap: small ? 10 : 16,
      }}
    >
      {!hideTitle && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* 타이틀 + 타이틀 옆 왼쪽 요소 */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {small ? (
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {title}
              </span>
            ) : (
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
                {title}
              </h2>
            )}
            {headerLeft}
          </div>
          {headerRight}
        </div>
      )}
      {children}
    </div>
  );
}

function FormField({
  label, required, children,
}: {
  label: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
        {label}
        {required && <span style={{ color: "#e53935", marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function areaTypeBadgeStyle(type: string): React.CSSProperties {
  // 신규 분류 5종 — 데이터 성격 기준 (FILTER/LIST/FORM/DETAIL/GENERAL)
  const colors: Record<string, { bg: string; color: string }> = {
    FILTER:  { bg: "#e3f2fd", color: "#1565c0" },
    LIST:    { bg: "#e8f5e9", color: "#2e7d32" },
    FORM:    { bg: "#fff3e0", color: "#e65100" },
    DETAIL:  { bg: "#f3e5f5", color: "#6a1b9a" },
    GENERAL: { bg: "#eceff1", color: "#37474f" },
  };
  const c = colors[type] ?? { bg: "#f5f5f5", color: "#555" };
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    background: c.bg,
    color: c.color,
  };
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 14,
  boxSizing: "border-box",
  outline: "none",
};

// select 전용 — 브라우저 기본 화살표를 제거하고 커스텀 화살표로 대체
const selectStyle: React.CSSProperties = {
  ...inputStyle,
  paddingRight: "32px",
  appearance: "none",
  WebkitAppearance: "none",
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 10px center",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 24px",
  borderRadius: 6,
  border: "1px solid transparent",
  background: "var(--color-primary, #1976d2)",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 14,
  cursor: "pointer",
};

// 라벨 옆 인라인 아이콘 버튼 — 이력 조회 등 보조 액션을 최소 면적으로 표현
const inlineIconBtnStyle: React.CSSProperties = {
  display:        "inline-flex",
  alignItems:     "center",
  justifyContent: "center",
  width:          18,
  height:         18,
  padding:        0,
  border:         "none",
  background:     "transparent",
  color:          "var(--color-text-tertiary)",
  cursor:         "pointer",
  borderRadius:   3,
  lineHeight:     0,
};

const linkBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--color-primary, #1976d2)",
  fontSize: 14,
  padding: 0,
  textAlign: "left",
  textDecoration: "underline",
};

const areaGridHeaderStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "44px 1fr 80px 100px",
  gap: 12,
  padding: "8px 14px",
  background: "var(--color-bg-muted)",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border)",
};

const ghostSmBtnStyle: React.CSSProperties = {
  padding: "3px 9px",
  borderRadius: 5,
  border: "1px solid var(--color-border)",
  background: "none",
  color: "var(--color-text-secondary)",
  fontSize: 12,
  cursor: "pointer",
};

const areaGridRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "44px 1fr 80px 100px",
  gap: 12,
  padding: "10px 14px",
  alignItems: "center",
  background: "var(--color-bg-card)",
};

// 설계 양식(예시/템플릿)은 DB(tb_ai_design_template)로 관리 — 공용 훅 useDesignTemplate 사용.
