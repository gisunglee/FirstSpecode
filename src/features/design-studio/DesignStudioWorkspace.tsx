"use client";

/**
 * Design Studio workspace.
 *
 * State is intentionally local to this feature. The only integration points are the
 * project route and one LNB entry, so the studio can be removed without a domain rewrite.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchBlockPermissions,
  fetchDesignTree,
  fetchRequirement,
  fetchUnitWorks,
  saveStudioBlock,
} from "./api";
import { buildStudioBlocks } from "./model";
import StudioDocument from "./StudioDocument";
import StudioInspector from "./StudioInspector";
import StudioNavigator from "./StudioNavigator";
import type { StudioBlock, StudioDraft, StudioKind } from "./types";

type Props = { projectId: string };

const PROGRAMMATIC_SCROLL_FALLBACK_MS = 300;

function formatModifiedAt(value: string | undefined) {
  if (!value) return "수정 정보 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function docStatusLabel(status: string | undefined) {
  if (status === "DONE") return "작성완료";
  if (status === "DOING") return "작성중";
  return "작성전";
}

export default function DesignStudioWorkspace({ projectId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [navCollapsed, setNavCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [inspectorSelectedKey, setInspectorSelectedKey] = useState<string | null>(null);
  const [isDocumentScrolling, setIsDocumentScrolling] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<StudioDraft | null>(null);
  const [checkingKey, setCheckingKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const initializedUnitWorkRef = useRef<string | null>(null);
  const programmaticScrollFallbackRef = useRef<number | null>(null);

  const unitWorksQuery = useQuery({
    queryKey: ["design-studio", projectId, "unit-works"],
    queryFn: () => fetchUnitWorks(projectId),
  });
  const unitWorks = unitWorksQuery.data ?? [];
  const requestedUnitWorkId = searchParams.get("unitWorkId") ?? "";
  const selectedUnitWorkId = unitWorks.some((item) => item.unitWorkId === requestedUnitWorkId)
    ? requestedUnitWorkId
    : (unitWorks[0]?.unitWorkId ?? "");
  const selectedUnitWork = unitWorks.find((item) => item.unitWorkId === selectedUnitWorkId);

  useEffect(() => {
    if (!selectedUnitWorkId || requestedUnitWorkId === selectedUnitWorkId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("unitWorkId", selectedUnitWorkId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, requestedUnitWorkId, router, searchParams, selectedUnitWorkId]);

  const treeQuery = useQuery({
    queryKey: ["design-studio", projectId, "tree", selectedUnitWorkId],
    queryFn: () => fetchDesignTree(projectId, selectedUnitWorkId),
    enabled: !!selectedUnitWorkId,
  });
  const requirementId = treeQuery.data?.unitWorks[0]?.reqId ?? selectedUnitWork?.reqId ?? "";
  const requirementQuery = useQuery({
    queryKey: ["design-studio", projectId, "requirement", requirementId],
    queryFn: () => fetchRequirement(projectId, requirementId),
    enabled: !!requirementId,
  });

  const blocks = useMemo(
    () => buildStudioBlocks(projectId, treeQuery.data, requirementQuery.data),
    [projectId, requirementQuery.data, treeQuery.data],
  );
  const selectedBlock = blocks.find((block) => block.key === selectedKey) ?? blocks[0] ?? null;
  const inspectorSelectedBlock = blocks.find((block) => block.key === inspectorSelectedKey)
    ?? blocks[0]
    ?? null;

  // 스크롤 스파이는 계속 현재 문서를 추적하되, 관련 정보는 스크롤이 멈춘 뒤 한 번만 바꾼다.
  useEffect(() => {
    if (isDocumentScrolling || !selectedBlock) return;
    setInspectorSelectedKey(selectedBlock.key);
  }, [isDocumentScrolling, selectedBlock]);

  useEffect(() => () => {
    if (programmaticScrollFallbackRef.current !== null) {
      window.clearTimeout(programmaticScrollFallbackRef.current);
    }
  }, []);

  useEffect(() => {
    if (!selectedUnitWorkId || blocks.length === 0) return;
    if (initializedUnitWorkRef.current === selectedUnitWorkId) {
      setOpenKeys((current) => {
        const validKeys = new Set(blocks.map((block) => block.key));
        return new Set([...current].filter((key) => validKeys.has(key)));
      });
      return;
    }

    initializedUnitWorkRef.current = selectedUnitWorkId;
    // Requirements and detailed analysis stay quiet by default; the design stream opens.
    setOpenKeys(new Set(
      blocks
        .filter((block) => block.kind !== "requirement" && block.kind !== "analysis")
        .map((block) => block.key),
    ));
    const firstDesignBlock = blocks.find((block) => block.kind === "unitWork") ?? blocks[0];
    setSelectedKey(firstDesignBlock?.key ?? null);
    setInspectorSelectedKey(firstDesignBlock?.key ?? null);
    setIsDocumentScrolling(false);
    setEditingKey(null);
    setDraft(null);
  }, [blocks, selectedUnitWorkId]);

  function changeUnitWork(unitWorkId: string) {
    if (editingKey) {
      toast.warning("편집 중인 문서를 먼저 저장하거나 취소해 주세요.");
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("unitWorkId", unitWorkId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function selectBlock(block: StudioBlock, scroll = false) {
    if (scroll) {
      // 대상이 이미 화면 안에 있어 scroll 이벤트가 발생하지 않는 경우에도 잠금이 풀려야 한다.
      setIsDocumentScrolling(true);
      if (programmaticScrollFallbackRef.current !== null) {
        window.clearTimeout(programmaticScrollFallbackRef.current);
      }
      programmaticScrollFallbackRef.current = window.setTimeout(() => {
        programmaticScrollFallbackRef.current = null;
        setIsDocumentScrolling(false);
      }, PROGRAMMATIC_SCROLL_FALLBACK_MS);
    }
    setSelectedKey(block.key);
    if (scroll) {
      setOpenKeys((current) => new Set(current).add(block.key));
      window.requestAnimationFrame(() => {
        document.getElementById(`studio-${block.key.replace(":", "-")}`)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  }

  function handleDocumentScrollStateChange(isScrolling: boolean) {
    if (programmaticScrollFallbackRef.current !== null) {
      window.clearTimeout(programmaticScrollFallbackRef.current);
      programmaticScrollFallbackRef.current = null;
    }
    setIsDocumentScrolling(isScrolling);
  }

  function toggleBlock(block: StudioBlock) {
    setOpenKeys((current) => {
      const next = new Set(current);
      if (next.has(block.key)) next.delete(block.key);
      else next.add(block.key);
      return next;
    });
  }

  function toggleKind(kind: StudioKind) {
    const kindKeys = blocks.filter((block) => block.kind === kind).map((block) => block.key);
    const allOpen = kindKeys.every((key) => openKeys.has(key));
    setOpenKeys((current) => {
      const next = new Set(current);
      for (const key of kindKeys) {
        if (allOpen) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  }

  async function startEdit(block: StudioBlock) {
    if (editingKey && editingKey !== block.key) {
      toast.warning("한 번에 한 문서만 수정할 수 있습니다. 현재 편집을 저장하거나 취소해 주세요.");
      return;
    }
    setSelectedKey(block.key);
    setOpenKeys((current) => new Set(current).add(block.key));
    setCheckingKey(block.key);
    try {
      const permissions = block.kind === "requirement" || block.kind === "analysis"
        ? requirementQuery.data?.permissions
        : await fetchBlockPermissions(projectId, block);
      if (!permissions?.canEdit) {
        toast.error(permissions?.reasonMessage ?? "이 문서를 수정할 권한이 없습니다.");
        return;
      }
      setEditingKey(block.key);
      setDraft({
        name: block.name,
        description: block.description,
        secondaryDescription: block.secondaryDescription ?? "",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "수정 권한을 확인하지 못했습니다.");
    } finally {
      setCheckingKey(null);
    }
  }

  async function saveEditingBlock() {
    const block = blocks.find((item) => item.key === editingKey);
    if (!block || !draft) return;
    setSaving(true);
    try {
      await saveStudioBlock(projectId, block, draft, requirementQuery.data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["design-studio", projectId, "tree", selectedUnitWorkId] }),
        queryClient.invalidateQueries({ queryKey: ["design-studio", projectId, "requirement", requirementId] }),
        queryClient.invalidateQueries({ queryKey: ["design-studio", projectId, "unit-works"] }),
      ]);
      setEditingKey(null);
      setDraft(null);
      toast.success(`${block.displayId} 문서를 저장했습니다.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "문서를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const loading = unitWorksQuery.isLoading || (!!selectedUnitWorkId && treeQuery.isLoading);
  const error = unitWorksQuery.error ?? treeQuery.error ?? requirementQuery.error;

  if (loading) {
    return <div className="sp-studio-loading"><div className="sp-spinner sp-spinner-lg" /> 설계 문서를 불러오는 중입니다.</div>;
  }

  if (error) {
    return (
      <div className="sp-studio-state">
        <div className="sp-empty-title">설계 문서를 불러오지 못했습니다.</div>
        <div className="sp-empty-desc">{error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요."}</div>
      </div>
    );
  }

  if (unitWorks.length === 0) {
    return (
      <div className="sp-studio-state">
        <div className="sp-empty-title">조회할 단위업무가 없습니다.</div>
        <div className="sp-empty-desc">단위업무를 등록하면 통합 설계 문서를 만들 수 있습니다.</div>
      </div>
    );
  }

  return (
    <div className="sp-studio-shell">
      <header className="sp-studio-header">
        <div className="sp-studio-header-main">
          <div className="sp-studio-breadcrumb">
            종합 설계실 <span>/</span> {selectedUnitWork?.reqDisplayId} <span>/</span> {selectedUnitWork?.displayId}
          </div>
          <div className="sp-studio-title-row">
            <span className="sp-studio-title-code">{selectedBlock?.displayId ?? selectedUnitWork?.displayId}</span>
            <h1>{selectedBlock?.name ?? selectedUnitWork?.name}</h1>
            <span className="sp-badge sp-badge-warning">{docStatusLabel(selectedUnitWork?.docStatus)}</span>
          </div>
        </div>

        <div className="sp-studio-header-meta">
          <span>담당자 <strong>{selectedUnitWork?.assignMemberName ?? "미지정"}</strong></span>
          <span>최종 수정 <strong>{formatModifiedAt(selectedUnitWork?.modifiedAt)}</strong></span>
        </div>

        <div className="sp-studio-header-actions">
          <button
            type="button"
            className="sp-btn sp-btn-secondary"
            onClick={() => setOpenKeys(new Set(blocks.map((block) => block.key)))}
          >
            통합보기
          </button>
          {!editingKey ? (
            <button
              type="button"
              className="sp-btn sp-btn-secondary"
              disabled={!selectedBlock || checkingKey === selectedBlock.key}
              onClick={() => selectedBlock && startEdit(selectedBlock)}
            >
              {selectedBlock && checkingKey === selectedBlock.key ? "확인 중..." : "편집"}
            </button>
          ) : (
            <button type="button" className="sp-btn sp-btn-primary" disabled={saving} onClick={saveEditingBlock}>
              {saving ? "저장 중..." : "저장"}
            </button>
          )}
        </div>
      </header>

      <div className="sp-studio-body">
        <StudioNavigator
          blocks={blocks}
          collapsed={navCollapsed}
          query={query}
          selectedKey={selectedBlock?.key ?? null}
          selectedUnitWorkId={selectedUnitWorkId}
          unitWorks={unitWorks}
          onChangeQuery={setQuery}
          onSelectBlock={(block) => selectBlock(block, true)}
          onSelectUnitWork={changeUnitWork}
          onToggleCollapsed={() => setNavCollapsed((current) => !current)}
        />

        <StudioDocument
          blocks={blocks}
          draft={draft}
          editingKey={editingKey}
          openKeys={openKeys}
          saving={saving}
          selectedKey={selectedBlock?.key ?? null}
          onCancelEdit={() => { setEditingKey(null); setDraft(null); }}
          onChangeDraft={setDraft}
          onCollapseAll={() => setOpenKeys(new Set())}
          onEdit={startEdit}
          onExpandAll={() => setOpenKeys(new Set(blocks.map((block) => block.key)))}
          onSave={saveEditingBlock}
          onSelect={(block) => selectBlock(block)}
          onToggleBlock={toggleBlock}
          onToggleKind={toggleKind}
          onScrollStateChange={handleDocumentScrollStateChange}
          onVisibleBlockChange={setSelectedKey}
        />

        <StudioInspector
          blocks={blocks}
          collapsed={inspectorCollapsed}
          projectId={projectId}
          selectedBlock={inspectorSelectedBlock}
          unitWorkId={selectedUnitWorkId}
          onToggleCollapsed={() => setInspectorCollapsed((current) => !current)}
        />
      </div>
    </div>
  );
}
