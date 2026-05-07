"use client";

/**
 * AdminDocsPage — Docs Hub 트리 관리 (시스템 관리자 전용)
 *
 * 역할:
 *   - 섹션·페이지 트리 전체 노출 (DRAFT/ARCHIVED/숨김 모두 포함)
 *   - 섹션 추가·수정·삭제, 페이지 추가·수정·이동·삭제
 *   - ↑↓ 버튼으로 정렬 변경 (드래그 정렬은 추후 @dnd-kit 도입 시)
 *   - 페이지 본문(Markdown) 편집은 /admin/docs/[pageId] 페이지에서 (4단계)
 *
 * URL: /admin/docs
 *
 * 디자인:
 *   - sp-* 토큰 기반, 3테마 자동 대응
 *   - ConfirmDialog 으로 삭제 확인 (window.confirm 절대 금지)
 *
 * 데이터:
 *   - useQuery(["admin", "docs", "tree"])
 *   - 모든 mutation 후 invalidateQueries 로 재조회
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import ConfirmDialog from "@/components/common/ConfirmDialog";

// ── 타입 ──────────────────────────────────────────────────────────────────
type AdminPage = {
  pageId:      string;
  pageSlug:    string;
  pageSj:      string;
  pageExcerpt: string | null;
  statusCode:  "DRAFT" | "PUBLISHED" | "ARCHIVED" | string;
  badgeCode:   string | null;
  sortOrdr:    number;
  useYn:       string;
  updatedAt:   string | null;
};

type AdminSection = {
  sectId:       string;
  sectSlug:     string;
  sectNm:       string;
  sectIconCode: string | null;
  sortOrdr:     number;
  useYn:        string;
  pages:        AdminPage[];
};

type TreeResponse = { sections: AdminSection[] };

// ── 상태 라벨/색상 ────────────────────────────────────────────────────────
const STATUS_STYLE: Record<string, { label: string; bg: string; color: string }> = {
  DRAFT:     { label: "초안",   bg: "var(--color-bg-elevated)",     color: "var(--color-text-tertiary)" },
  PUBLISHED: { label: "공개",   bg: "var(--color-success-subtle)",  color: "var(--color-success)" },
  ARCHIVED:  { label: "보관",   bg: "var(--color-warning-subtle)",  color: "var(--color-warning)" },
};

// ── 메인 페이지 ────────────────────────────────────────────────────────────
export default function AdminDocsPage() {
  const qc = useQueryClient();

  // 트리 조회
  const { data, isLoading, error } = useQuery<TreeResponse>({
    queryKey: ["admin", "docs", "tree"],
    queryFn:  () =>
      authFetch<{ data: TreeResponse }>("/api/admin/docs/tree").then((r) => r.data),
    staleTime: 30 * 1000,
  });

  // 다이얼로그 상태
  const [sectionDialog, setSectionDialog] = useState<{ mode: "create" } | { mode: "edit"; section: AdminSection } | null>(null);
  const [pageDialog,    setPageDialog]    = useState<{ mode: "create"; sectId: string } | { mode: "edit"; page: AdminPage; sectId: string } | null>(null);
  const [confirmState,  setConfirmState]  = useState<
    | { kind: "section"; sectId: string; name: string }
    | { kind: "page";    pageId: string; name: string }
    | null
  >(null);

  // ── 정렬(↑↓) 뮤테이션 — 인접 두 항목의 sort_ordr 를 교체 ───────────────
  const reorderSection = useMutation({
    mutationFn: ({ id, sortOrdr }: { id: string; sortOrdr: number }) =>
      authFetch(`/api/admin/docs/sections/${id}`, {
        method: "PUT",
        body:   JSON.stringify({ sortOrdr }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "docs", "tree"] }),
    onError:   (e: Error) => toast.error("순서 변경 실패: " + e.message),
  });

  const reorderPage = useMutation({
    mutationFn: ({ id, sortOrdr }: { id: string; sortOrdr: number }) =>
      authFetch(`/api/admin/docs/pages/${id}`, {
        method: "PUT",
        body:   JSON.stringify({ sortOrdr }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "docs", "tree"] }),
    onError:   (e: Error) => toast.error("순서 변경 실패: " + e.message),
  });

  // ── 삭제 뮤테이션 ────────────────────────────────────────────────────────
  const deleteSection = useMutation({
    mutationFn: (id: string) =>
      authFetch(`/api/admin/docs/sections/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("섹션이 삭제되었습니다.");
      qc.invalidateQueries({ queryKey: ["admin", "docs", "tree"] });
      setConfirmState(null);
    },
    onError: (e: Error) => toast.error("섹션 삭제 실패: " + e.message),
  });

  const deletePage = useMutation({
    mutationFn: (id: string) =>
      authFetch(`/api/admin/docs/pages/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("페이지가 삭제되었습니다.");
      qc.invalidateQueries({ queryKey: ["admin", "docs", "tree"] });
      setConfirmState(null);
    },
    onError: (e: Error) => toast.error("페이지 삭제 실패: " + e.message),
  });

  const sections = data?.sections ?? [];

  // 인접 항목과 sort_ordr 교환 (인덱스 기반)
  function swapSection(idx: number, dir: -1 | 1) {
    const a = sections[idx];
    const b = sections[idx + dir];
    if (!a || !b) return;
    reorderSection.mutate({ id: a.sectId, sortOrdr: b.sortOrdr });
    reorderSection.mutate({ id: b.sectId, sortOrdr: a.sortOrdr });
  }
  function swapPage(sect: AdminSection, idx: number, dir: -1 | 1) {
    const a = sect.pages[idx];
    const b = sect.pages[idx + dir];
    if (!a || !b) return;
    reorderPage.mutate({ id: a.pageId, sortOrdr: b.sortOrdr });
    reorderPage.mutate({ id: b.pageId, sortOrdr: a.sortOrdr });
  }

  return (
    <div>
      {/* 액션 바 — 페이지 타이틀은 AdminLayout 이 담당하므로 우측 액션 버튼만 */}
      <div style={{
        display:        "flex",
        justifyContent: "flex-end",
        marginBottom:   12,
      }}>
        <button
          onClick={() => setSectionDialog({ mode: "create" })}
          style={primaryButton}
        >
          + 섹션 추가
        </button>
      </div>

      {/* 본문 */}
      <div>
        {isLoading && (
          <div style={emptyMsg}>트리를 불러오는 중...</div>
        )}
        {error && (
          <div style={{ ...emptyMsg, color: "var(--color-error)" }}>
            트리 불러오기 실패: {(error as Error).message}
          </div>
        )}
        {data && sections.length === 0 && (
          <div style={emptyMsg}>
            아직 섹션이 없습니다. 우측 상단의 [+ 섹션 추가] 버튼으로 첫 섹션을 만들어 보세요.
          </div>
        )}

        {/* 섹션 카드 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sections.map((s, idx) => (
            <SectionCard
              key={s.sectId}
              section={s}
              isFirst={idx === 0}
              isLast={idx === sections.length - 1}
              onUp={()    => swapSection(idx, -1)}
              onDown={()  => swapSection(idx,  1)}
              onEdit={()  => setSectionDialog({ mode: "edit", section: s })}
              onAddPage={() => setPageDialog({ mode: "create", sectId: s.sectId })}
              onEditPage={(p) => setPageDialog({ mode: "edit", page: p, sectId: s.sectId })}
              onPageUp={(pIdx)   => swapPage(s, pIdx, -1)}
              onPageDown={(pIdx) => swapPage(s, pIdx,  1)}
            />
          ))}
        </div>
      </div>

      {/* 다이얼로그들 */}
      {sectionDialog && (
        <SectionDialog
          state={sectionDialog}
          onClose={() => setSectionDialog(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["admin", "docs", "tree"] });
            setSectionDialog(null);
          }}
          // 수정 모드에서만 사용 — 다이얼로그 닫고 ConfirmDialog 띄우는 흐름
          onRequestDelete={() => {
            if (sectionDialog.mode !== "edit") return;
            const s = sectionDialog.section;
            setSectionDialog(null);
            setConfirmState({ kind: "section", sectId: s.sectId, name: s.sectNm });
          }}
        />
      )}
      {pageDialog && (
        <PageDialog
          state={pageDialog}
          sections={sections}
          onClose={() => setPageDialog(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["admin", "docs", "tree"] });
            setPageDialog(null);
          }}
          onRequestDelete={() => {
            if (pageDialog.mode !== "edit") return;
            const p = pageDialog.page;
            setPageDialog(null);
            setConfirmState({ kind: "page", pageId: p.pageId, name: p.pageSj });
          }}
        />
      )}
      <ConfirmDialog
        open={!!confirmState}
        title={confirmState?.kind === "section" ? "섹션 삭제" : "페이지 삭제"}
        description={
          confirmState?.kind === "section"
            ? `"${confirmState.name}" 섹션을 삭제하시겠습니까? 섹션에 페이지가 남아있으면 삭제되지 않습니다.`
            : `"${confirmState?.name}" 페이지를 삭제하시겠습니까? 본문과 첨부가 정리됩니다.`
        }
        confirmLabel="삭제"
        loading={deleteSection.isPending || deletePage.isPending}
        onConfirm={() => {
          if (!confirmState) return;
          if (confirmState.kind === "section") deleteSection.mutate(confirmState.sectId);
          else                                  deletePage.mutate(confirmState.pageId);
        }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 섹션 카드 — 제목 줄 + 페이지 목록
// ────────────────────────────────────────────────────────────────────────
function SectionCard({
  section, isFirst, isLast,
  onUp, onDown, onEdit, onAddPage,
  onEditPage, onPageUp, onPageDown,
}: {
  section:       AdminSection;
  isFirst:       boolean;
  isLast:        boolean;
  onUp:          () => void;
  onDown:        () => void;
  onEdit:        () => void;
  onAddPage:     () => void;
  onEditPage:    (p: AdminPage) => void;
  onPageUp:      (idx: number) => void;
  onPageDown:    (idx: number) => void;
}) {
  const isHidden = section.useYn === "N";
  return (
    <div style={{
      background:   "var(--color-bg-card)",
      border:       "1px solid var(--color-border)",
      borderRadius: "var(--radius-card)",
      overflow:     "hidden",
      opacity:      isHidden ? 0.65 : 1,
    }}>
      {/* 섹션 헤더 */}
      <div style={{
        display:    "flex",
        alignItems: "center",
        gap:        12,
        padding:    "10px 14px",
        background: "var(--color-bg-elevated)",
        borderBottom: "1px solid var(--color-border)",
      }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{
            fontSize:     "var(--text-md)",
            fontWeight:   700,
            color:        "var(--color-text-heading)",
            overflow:     "hidden",
            textOverflow: "ellipsis",
            whiteSpace:   "nowrap",
          }}>
            {section.sectNm}
          </span>
          <span style={metaChip}>/{section.sectSlug}</span>
          {isHidden && <span style={{ ...metaChip, color: "var(--color-warning)" }}>숨김</span>}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <IconBtn label="위로"   disabled={isFirst} onClick={onUp}>↑</IconBtn>
          <IconBtn label="아래로" disabled={isLast}  onClick={onDown}>↓</IconBtn>
          <IconBtn label="수정 (메타·삭제)" onClick={onEdit}>✏</IconBtn>
          <button onClick={onAddPage} style={smallButton}>+ 페이지</button>
        </div>
      </div>

      {/* 페이지 목록 */}
      {section.pages.length === 0 ? (
        <div style={{
          padding:   "16px",
          textAlign: "center",
          fontSize:  "var(--text-sm)",
          color:     "var(--color-text-tertiary)",
        }}>
          이 섹션에는 아직 페이지가 없습니다.
        </div>
      ) : (
        <div>
          {section.pages.map((p, idx) => (
            <PageRow
              key={p.pageId}
              page={p}
              isFirst={idx === 0}
              isLast={idx === section.pages.length - 1}
              onUp={()    => onPageUp(idx)}
              onDown={()  => onPageDown(idx)}
              onEdit={()  => onEditPage(p)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 페이지 한 줄
// ────────────────────────────────────────────────────────────────────────
function PageRow({
  page, isFirst, isLast, onUp, onDown, onEdit,
}: {
  page:     AdminPage;
  isFirst:  boolean;
  isLast:   boolean;
  onUp:     () => void;
  onDown:   () => void;
  onEdit:   () => void;
}) {
  const status = STATUS_STYLE[page.statusCode] ?? STATUS_STYLE.DRAFT!;
  const isHidden = page.useYn === "N";
  return (
    <div style={{
      display:      "flex",
      alignItems:   "center",
      gap:          10,
      padding:      "8px 14px 8px 28px",
      borderBottom: "1px solid var(--color-border-subtle)",
      opacity:      isHidden ? 0.6 : 1,
    }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{
          fontSize:     "var(--text-md)",
          color:        "var(--color-text-primary)",
          overflow:     "hidden",
          textOverflow: "ellipsis",
          whiteSpace:   "nowrap",
        }}>
          {page.pageSj}
        </span>
        <span style={{
          ...metaChip,
          background: status.bg,
          color:      status.color,
          fontWeight: 600,
        }}>
          {status.label}
        </span>
        {page.badgeCode && (
          <span style={{ ...metaChip, background: "var(--color-info-subtle)", color: "var(--color-info)" }}>
            {page.badgeCode}
          </span>
        )}
        <span style={metaChip}>/{page.pageSlug}</span>
        {isHidden && <span style={{ ...metaChip, color: "var(--color-warning)" }}>숨김</span>}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <IconBtn label="위로"   disabled={isFirst} onClick={onUp}>↑</IconBtn>
        <IconBtn label="아래로" disabled={isLast}  onClick={onDown}>↓</IconBtn>
        <Link href={`/admin/docs/${page.pageId}`} style={smallButton} title="본문 편집">
          본문
        </Link>
        <IconBtn label="수정 (메타·삭제)" onClick={onEdit}>✏</IconBtn>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 섹션 다이얼로그 (생성/수정)
// ────────────────────────────────────────────────────────────────────────
function SectionDialog({
  state, onClose, onSaved, onRequestDelete,
}: {
  state:  { mode: "create" } | { mode: "edit"; section: AdminSection };
  onClose: () => void;
  onSaved: () => void;
  // edit 모드에서만 활성. create 모드에서도 prop 자체는 받지만 호출 안 함.
  onRequestDelete: () => void;
}) {
  const isEdit = state.mode === "edit";
  const initial = useMemo(() => isEdit ? state.section : null, [isEdit, state]);

  const [sectNm,       setSectNm]       = useState(initial?.sectNm ?? "");
  const [sectSlug,     setSectSlug]     = useState(initial?.sectSlug ?? "");
  const [sectIconCode, setSectIconCode] = useState(initial?.sectIconCode ?? "");
  const [useYn,        setUseYn]        = useState(initial?.useYn ?? "Y");

  const save = useMutation({
    mutationFn: () => {
      const body = {
        sectNm:       sectNm.trim(),
        sectSlug:     sectSlug.trim().toLowerCase(),
        sectIconCode: sectIconCode || null,
        useYn,
      };
      if (isEdit) {
        return authFetch(`/api/admin/docs/sections/${state.section.sectId}`, {
          method: "PUT",
          body:   JSON.stringify(body),
        });
      }
      return authFetch("/api/admin/docs/sections", {
        method: "POST",
        body:   JSON.stringify(body),
      });
    },
    onSuccess: () => {
      toast.success(isEdit ? "섹션이 수정되었습니다." : "섹션이 추가되었습니다.");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DialogShell title={isEdit ? "섹션 수정" : "섹션 추가"} onClose={onClose}>
      <FormRow label="섹션명" required>
        <input
          value={sectNm}
          onChange={(e) => setSectNm(e.target.value)}
          placeholder="예: 시작하기"
          style={inputStyle}
          autoFocus
        />
      </FormRow>
      <FormRow label="슬러그" required hint="URL 에 쓰일 식별자 (영문 소문자/숫자/하이픈)">
        <input
          value={sectSlug}
          onChange={(e) => setSectSlug(e.target.value.toLowerCase())}
          placeholder="getting-started"
          style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
        />
      </FormRow>
      <FormRow label="아이콘 키" hint="menuIcons 의 i_* 키 (선택)">
        <input
          value={sectIconCode}
          onChange={(e) => setSectIconCode(e.target.value)}
          placeholder="i_planStudio"
          style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
        />
      </FormRow>
      <FormRow label="노출">
        <div style={{ display: "flex", gap: 8 }}>
          <label style={radioLabel}>
            <input type="radio" checked={useYn === "Y"} onChange={() => setUseYn("Y")} /> Y (보임)
          </label>
          <label style={radioLabel}>
            <input type="radio" checked={useYn === "N"} onChange={() => setUseYn("N")} /> N (숨김)
          </label>
        </div>
      </FormRow>

      <DialogFooter>
        {/* 수정 모드일 때만 좌측에 [삭제] 노출 — 푸터의 [취소][저장] 과 시각적 분리 */}
        {isEdit ? (
          <button
            type="button"
            onClick={onRequestDelete}
            disabled={save.isPending}
            style={dangerButton}
          >
            삭제
          </button>
        ) : <span />}
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          <button onClick={onClose} style={secondaryButton} disabled={save.isPending}>취소</button>
          <button onClick={() => save.mutate()} style={primaryButton} disabled={save.isPending}>
            {save.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </DialogFooter>
    </DialogShell>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 페이지 다이얼로그 (생성/수정 메타) — 본문은 별도 페이지에서 편집
// ────────────────────────────────────────────────────────────────────────
function PageDialog({
  state, sections, onClose, onSaved, onRequestDelete,
}: {
  state:    { mode: "create"; sectId: string } | { mode: "edit"; page: AdminPage; sectId: string };
  sections: AdminSection[];
  onClose:  () => void;
  onSaved:  () => void;
  onRequestDelete: () => void;
}) {
  const isEdit = state.mode === "edit";
  const initialPage = isEdit ? state.page : null;

  const [sectId,      setSectId]      = useState(state.sectId);
  const [pageSj,      setPageSj]      = useState(initialPage?.pageSj ?? "");
  const [pageSlug,    setPageSlug]    = useState(initialPage?.pageSlug ?? "");
  const [pageExcerpt, setPageExcerpt] = useState(initialPage?.pageExcerpt ?? "");
  const [statusCode,  setStatusCode]  = useState(initialPage?.statusCode ?? "DRAFT");
  const [badgeCode,   setBadgeCode]   = useState(initialPage?.badgeCode ?? "");
  const [useYn,       setUseYn]       = useState(initialPage?.useYn ?? "Y");

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        sectId,
        pageSj:      pageSj.trim(),
        pageSlug:    pageSlug.trim().toLowerCase(),
        pageExcerpt: pageExcerpt.trim() || null,
        statusCode,
        badgeCode:   badgeCode || null,
        useYn,
      };
      if (isEdit) {
        return authFetch(`/api/admin/docs/pages/${state.page.pageId}`, {
          method: "PUT",
          body:   JSON.stringify(body),
        });
      }
      return authFetch("/api/admin/docs/pages", {
        method: "POST",
        body:   JSON.stringify(body),
      });
    },
    onSuccess: () => {
      toast.success(isEdit ? "페이지가 수정되었습니다." : "페이지가 추가되었습니다.");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DialogShell title={isEdit ? "페이지 메타 수정" : "페이지 추가"} onClose={onClose}>
      <FormRow label="섹션" required>
        <select
          value={sectId}
          onChange={(e) => setSectId(e.target.value)}
          style={selectStyle}
        >
          {sections.map((s) => (
            <option key={s.sectId} value={s.sectId}>{s.sectNm}</option>
          ))}
        </select>
      </FormRow>
      <FormRow label="제목" required>
        <input
          value={pageSj}
          onChange={(e) => setPageSj(e.target.value)}
          placeholder="예: 환영합니다"
          style={inputStyle}
          autoFocus
        />
      </FormRow>
      <FormRow label="슬러그" required hint="URL 에 쓰일 식별자 (섹션 내 유니크)">
        <input
          value={pageSlug}
          onChange={(e) => setPageSlug(e.target.value.toLowerCase())}
          placeholder="welcome"
          style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
        />
      </FormRow>
      <FormRow label="요약 (한 줄)" hint="트리·검색 결과의 부가 설명에 사용">
        <input
          value={pageExcerpt}
          onChange={(e) => setPageExcerpt(e.target.value)}
          maxLength={500}
          style={inputStyle}
        />
      </FormRow>
      <FormRow label="상태" required>
        <select value={statusCode} onChange={(e) => setStatusCode(e.target.value)} style={selectStyle}>
          <option value="DRAFT">초안 (DRAFT)</option>
          <option value="PUBLISHED">공개 (PUBLISHED)</option>
          <option value="ARCHIVED">보관 (ARCHIVED)</option>
        </select>
      </FormRow>
      <FormRow label="배지">
        <select value={badgeCode} onChange={(e) => setBadgeCode(e.target.value)} style={selectStyle}>
          <option value="">없음</option>
          <option value="NEW">NEW</option>
          <option value="BETA">BETA</option>
          <option value="DEPRECATED">DEPRECATED</option>
        </select>
      </FormRow>
      <FormRow label="노출">
        <div style={{ display: "flex", gap: 8 }}>
          <label style={radioLabel}>
            <input type="radio" checked={useYn === "Y"} onChange={() => setUseYn("Y")} /> Y (보임)
          </label>
          <label style={radioLabel}>
            <input type="radio" checked={useYn === "N"} onChange={() => setUseYn("N")} /> N (숨김)
          </label>
        </div>
      </FormRow>

      {isEdit && (
        <div style={{
          marginTop:    8,
          padding:      "8px 12px",
          fontSize:     "var(--text-sm)",
          color:        "var(--color-text-tertiary)",
          background:   "var(--color-bg-elevated)",
          borderRadius: "var(--radius-sm)",
        }}>
          본문(Markdown) 편집은 페이지 행의 [본문] 버튼에서 진행합니다.
        </div>
      )}

      <DialogFooter>
        {isEdit ? (
          <button
            type="button"
            onClick={onRequestDelete}
            disabled={save.isPending}
            style={dangerButton}
          >
            삭제
          </button>
        ) : <span />}
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          <button onClick={onClose} style={secondaryButton} disabled={save.isPending}>취소</button>
          <button onClick={() => save.mutate()} style={primaryButton} disabled={save.isPending}>
            {save.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </DialogFooter>
    </DialogShell>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 공통 다이얼로그 셸 + 폼 헬퍼
// ────────────────────────────────────────────────────────────────────────
function DialogShell({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode;
}) {
  // ESC 키로만 닫기 — 입력 중 실수로 닫히는 것 방지를 위해
  // 오버레이 클릭(외부 클릭)은 의도적으로 무시.
  // 닫고 싶으면 헤더 X 버튼이나 푸터 [취소] 버튼을 사용.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div
        style={{
          width:      "min(560px, 92vw)",
          maxHeight:  "90vh",
          background: "var(--color-bg-surface)",
          border:     "1px solid var(--color-border-strong)",
          borderRadius: "var(--radius-card)",
          boxShadow:  "var(--shadow-md)",
          display:    "flex",
          flexDirection: "column",
          overflow:   "hidden",
        }}>
        <div style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          padding:        "12px 16px",
          borderBottom:   "1px solid var(--color-border)",
        }}>
          <span style={{
            fontSize:   "var(--text-md)",
            fontWeight: 700,
            color:      "var(--color-text-heading)",
          }}>
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            title="닫기 (ESC)"
            aria-label="닫기"
            style={{
              background:   "none",
              border:       "none",
              fontSize:     20,
              lineHeight:   1,
              color:        "var(--color-text-tertiary)",
              cursor:       "pointer",
              padding:      "0 4px",
            }}
          >
            ×
          </button>
        </div>
        <div style={{
          padding:    "16px",
          overflowY:  "auto",
          display:    "flex",
          flexDirection: "column",
          gap:        12,
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function FormRow({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{
        fontSize: "var(--text-sm)",
        fontWeight: 600,
        color: "var(--color-text-secondary)",
      }}>
        {label}{required && <span style={{ color: "var(--color-error)", marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {hint && (
        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
          {hint}
        </span>
      )}
    </div>
  );
}

function DialogFooter({ children }: { children: React.ReactNode }) {
  // 좌측: [삭제] (수정 모드일 때만), 우측: [취소][저장]
  // children 이 [삭제버튼, 우측그룹] 형태로 들어오므로 space-between 이면 자연스럽게 분리.
  // 신규 모드는 좌측에 빈 <span /> 이 들어오고 우측 그룹이 우측 정렬됨.
  return (
    <div style={{
      display:        "flex",
      alignItems:     "center",
      justifyContent: "space-between",
      gap:            8,
      paddingTop:     12,
      borderTop:      "1px solid var(--color-border-subtle)",
      marginTop:      8,
    }}>
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 작은 아이콘 버튼
// ────────────────────────────────────────────────────────────────────────
function IconBtn({ label, disabled, onClick, danger, children }: {
  label: string; disabled?: boolean; onClick: () => void; danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 28, height: 28,
        display: "flex", alignItems: "center", justifyContent: "center",
        background:   "transparent",
        border:       "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        color:        danger ? "var(--color-error)" : "var(--color-text-secondary)",
        cursor:       disabled ? "not-allowed" : "pointer",
        opacity:      disabled ? 0.4 : 1,
        fontSize:     12,
        lineHeight:   1,
      }}
    >
      {children}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 스타일 모음
// ────────────────────────────────────────────────────────────────────────
const primaryButton: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  background: "var(--color-brand)",
  color: "var(--color-text-inverse)",
  border: "1px solid var(--color-brand)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};
const secondaryButton: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: "var(--text-sm)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};
const dangerButton: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  background: "var(--color-bg-card)",
  color: "var(--color-error)",
  border: "1px solid var(--color-error-border)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};
const smallButton: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
  background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  height: 28,
  boxSizing: "border-box",
};
const inputStyle: React.CSSProperties = {
  padding: "7px 10px",
  fontSize: "var(--text-sm)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-input, 6px)",
  background: "var(--color-bg-input)",
  color: "var(--color-text-primary)",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

// select 전용 — 프로젝트 표준 chevron (ai-tasks 페이지의 filterSelectStyle 과 동일).
// 네이티브 화살표를 끄고(appearance: none) SVG 배경으로 통일된 모양 제공.
// 다크/라이트 모두 회색 톤(#888)이 자연스럽게 보임.
const selectStyle: React.CSSProperties = {
  ...inputStyle,
  // 우측에 chevron 들어갈 자리 확보
  padding:            "7px 32px 7px 10px",
  appearance:         "none",
  WebkitAppearance:   "none",
  MozAppearance:      "none",
  backgroundImage:    `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
  backgroundRepeat:   "no-repeat",
  backgroundPosition: "right 10px center",
};
const radioLabel: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: "var(--text-sm)",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};
const metaChip: React.CSSProperties = {
  fontSize:     10,
  fontWeight:   700,
  padding:      "1px 6px",
  borderRadius: "var(--radius-sm)",
  background:   "var(--color-bg-elevated)",
  color:        "var(--color-text-tertiary)",
  fontFamily:   "var(--font-mono)",
  letterSpacing:"0.02em",
};
const emptyMsg: React.CSSProperties = {
  padding:    "32px 16px",
  textAlign:  "center",
  fontSize:   "var(--text-sm)",
  color:      "var(--color-text-tertiary)",
};
