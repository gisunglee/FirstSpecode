"use client";

/**
 * CommonCodesPage — 공통코드 관리 (마스터-디테일)
 *
 * 역할:
 *   - 좌측: 코드 그룹 목록 (검색, 추가, 인라인 편집, 삭제)
 *   - 우측: 선택된 그룹의 코드 목록 (추가, 인라인 편집, 삭제, 순서 변경)
 *   - 한 화면에서 부모(그룹)↔자식(코드) 동시 관리
 */

import { Suspense, useState, useRef, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type CodeGroup = {
  grpCode: string;
  grpCodeNm: string;
  grpCodeDc: string;
  useYn: string;
  codeCount: number;
};

type Code = {
  codeId: number;
  cmCode: string;
  grpCode: string;
  grpCodeNm?: string; // 모든 코드 조회 모드에서만 사용
  codeNm: string;
  codeDc: string;
  useYn: string;
  sortOrdr: number;
};

// 코드 PK 유효성 검증: 영문대소문자, 숫자, _, :, - 만 허용
const CODE_PATTERN = /^[A-Za-z0-9_:\-]+$/;

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function CommonCodesPage() {
  return (
    <Suspense fallback={null}>
      <CommonCodesPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function CommonCodesPageInner() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const queryClient = useQueryClient();

  // ── 상태 ──────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [selectedGrpCode, setSelectedGrpCode] = useState<string | null>(null);
  const [showAllCodes, setShowAllCodes] = useState(false); // 모든 그룹의 코드 조회 모드
  const [globalUnique, setGlobalUnique] = useState(false); // 전체 공통코드 유니크 옵션 (저장 시 검증)
  const [uniqueHelpOpen, setUniqueHelpOpen] = useState(false); // "공통코드 유니크 사용" 도움말 팝업

  // 그룹 추가 모드
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGrpCode, setNewGrpCode] = useState("");
  const [newGrpCodeNm, setNewGrpCodeNm] = useState("");
  const grpCodeInputRef = useRef<HTMLInputElement>(null);

  // 그룹 인라인 편집
  const [editingGroup, setEditingGroup] = useState<{ grpCode: string; field: string } | null>(null);
  const [editGroupValue, setEditGroupValue] = useState("");

  // 그룹 설명 편집
  const [descValue, setDescValue] = useState("");
  const [descDirty, setDescDirty] = useState(false);

  // 코드 추가 모드 — 여러 행 동시 입력 지원
  const [addingCode, setAddingCode] = useState(false);
  type NewCodeDraft = { cmCode: string; codeNm: string; codeDc: string };
  const emptyDraft: NewCodeDraft = { cmCode: "", codeNm: "", codeDc: "" };
  const [newCodeDrafts, setNewCodeDrafts] = useState<NewCodeDraft[]>([emptyDraft]);
  const codeNmInputRef = useRef<HTMLInputElement>(null);

  // 코드 인라인 편집 (codeId = serial PK 기준)
  const [editingCode, setEditingCode] = useState<{ codeId: number; field: string } | null>(null);
  const [editCodeValue, setEditCodeValue] = useState("");

  // 삭제 확인
  const [deleteTarget, setDeleteTarget] = useState<{ type: "group" | "code"; id: string | number; name: string } | null>(null);

  // 그룹 코드 변경 확인 (PK 변경이라 경고 필요)
  const [renameConfirm, setRenameConfirm] = useState<{ grpCode: string; newValue: string } | null>(null);


  // ── 그룹 목록 조회 ────────────────────────────────────────────────────────
  const { data: groupsData, isLoading: groupsLoading } = useQuery({
    queryKey: ["code-groups", projectId, search],
    queryFn: () =>
      authFetch<{ data: { items: CodeGroup[] } }>(
        `/api/projects/${projectId}/code-groups?search=${encodeURIComponent(search)}`
      ).then((r) => r.data.items),
  });
  const groups = groupsData ?? [];

  // ── 코드 목록 조회 ────────────────────────────────────────────────────────
  // 일반 모드: 선택된 그룹의 코드 조회
  const { data: codesData, isLoading: codesLoading } = useQuery({
    queryKey: ["codes", projectId, selectedGrpCode],
    queryFn: () =>
      authFetch<{ data: { items: Code[] } }>(
        `/api/projects/${projectId}/code-groups/${selectedGrpCode}/codes`
      ).then((r) => r.data.items),
    enabled: !!selectedGrpCode && !showAllCodes,
  });

  // 전체 조회 모드: 모든 그룹의 코드를 그룹코드 → 정렬순서 순으로 조회
  const { data: allCodesData, isLoading: allCodesLoading } = useQuery({
    queryKey: ["codes-all", projectId],
    queryFn: () =>
      authFetch<{ data: { items: Code[] } }>(
        `/api/projects/${projectId}/codes-all`
      ).then((r) => r.data.items),
    enabled: showAllCodes,
  });

  const codes = showAllCodes ? (allCodesData ?? []) : (codesData ?? []);

  // ── 프로젝트 환경설정 — 공통코드 동작 제어용 두 값만 사용 ──────────────────
  //   UNIQUE_CODE_USE_YN  : "Y" → 공통코드 유니크 강제 (체크박스 해제 불가)
  //   CODE_DEL_PSBL_YN    : "N" → 코드/그룹 삭제 차단 (✕ 버튼 비활성)
  // configs 페이지와 동일 queryKey 라 캐시 공유됨 (서버 재호출 최소화)
  const { data: configsData } = useQuery({
    queryKey: ["configs", projectId],
    queryFn: () =>
      authFetch<{ data: { groups: Array<{ items: Array<{ key: string; value: string }> }> } }>(
        `/api/projects/${projectId}/configs`
      ).then((r) => r.data),
  });
  const configMap: Record<string, string> = {};
  for (const g of configsData?.groups ?? []) {
    for (const item of g.items) configMap[item.key] = item.value;
  }
  const uniqueForced  = configMap.UNIQUE_CODE_USE_YN === "Y";
  const deleteBlocked = configMap.CODE_DEL_PSBL_YN   === "N";
  // 체크박스 표시·서버 전송에 모두 사용 — uniqueForced 면 사용자 의사와 무관하게 true
  const effectiveUnique = uniqueForced || globalUnique;

  // 선택된 그룹 정보
  const selectedGroup = groups.find((g) => g.grpCode === selectedGrpCode);

  // 그룹 선택 시 설명값 동기화
  useEffect(() => {
    if (selectedGroup) {
      setDescValue(selectedGroup.grpCodeDc);
      setDescDirty(false);
    }
  }, [selectedGroup?.grpCode, selectedGroup?.grpCodeDc]);

  // ── 그룹 추가 ─────────────────────────────────────────────────────────────
  const addGroupMut = useMutation({
    mutationFn: (body: { grpCode: string; grpCodeNm: string }) =>
      authFetch(`/api/projects/${projectId}/code-groups`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("그룹이 추가되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["code-groups", projectId] });
      setAddingGroup(false);
      setNewGrpCode("");
      setNewGrpCodeNm("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function commitAddGroup() {
    if (!newGrpCode.trim() || !newGrpCodeNm.trim()) {
      toast.error("그룹 코드와 코드명을 모두 입력해 주세요.");
      return;
    }
    addGroupMut.mutate({ grpCode: newGrpCode.trim(), grpCodeNm: newGrpCodeNm.trim() });
  }

  // ── 그룹 수정 ─────────────────────────────────────────────────────────────
  const updateGroupMut = useMutation({
    mutationFn: ({ grpCode, body }: { grpCode: string; body: Record<string, unknown> }) =>
      authFetch(`/api/projects/${projectId}/code-groups/${grpCode}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["code-groups", projectId] });
      setEditingGroup(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function startEditGroup(grpCode: string, field: string, currentValue: string) {
    setEditingGroup({ grpCode, field });
    setEditGroupValue(currentValue);
  }

  function commitEditGroup() {
    if (!editingGroup) return;

    // 그룹 코드(PK) 변경인 경우 — 확인 다이얼로그 띄움
    if (editingGroup.field === "grpCode" && editGroupValue.trim() !== editingGroup.grpCode) {
      setRenameConfirm({ grpCode: editingGroup.grpCode, newValue: editGroupValue.trim() });
      return;
    }

    const body = { [editingGroup.field]: editGroupValue };
    updateGroupMut.mutate({ grpCode: editingGroup.grpCode, body });
  }

  // 그룹 코드 변경 확정
  function confirmRenameGroup() {
    if (!renameConfirm) return;
    updateGroupMut.mutate(
      { grpCode: renameConfirm.grpCode, body: { newGrpCode: renameConfirm.newValue } },
      {
        onSuccess: () => {
          // 선택된 그룹 코드도 새 코드로 갱신
          if (selectedGrpCode === renameConfirm.grpCode) {
            setSelectedGrpCode(renameConfirm.newValue);
          }
          queryClient.invalidateQueries({ queryKey: ["code-groups", projectId] });
          queryClient.invalidateQueries({ queryKey: ["codes", projectId] });
          setRenameConfirm(null);
          setEditingGroup(null);
          toast.success("그룹 코드가 변경되었습니다.");
        },
      }
    );
  }

  // 그룹 설명 저장 (blur 시)
  const saveDesc = useCallback(() => {
    if (!selectedGrpCode || !descDirty) return;
    updateGroupMut.mutate({ grpCode: selectedGrpCode, body: { grpCodeDc: descValue } });
    setDescDirty(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGrpCode, descDirty, descValue]);

  // 사용여부 토글
  function toggleGroupUseYn(grpCode: string, current: string) {
    updateGroupMut.mutate({ grpCode, body: { useYn: current === "Y" ? "N" : "Y" } });
  }

  // ── 그룹 삭제 ─────────────────────────────────────────────────────────────
  const deleteGroupMut = useMutation({
    mutationFn: (grpCode: string) =>
      authFetch(`/api/projects/${projectId}/code-groups/${grpCode}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("그룹이 삭제되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["code-groups", projectId] });
      if (selectedGrpCode === deleteTarget?.id) setSelectedGrpCode(null);
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 코드 추가 (단건 API를 순차 호출해서 다건 처리) ─────────────────────────
  const addCodeMut = useMutation({
    mutationFn: (body: { cmCode: string; codeNm: string; codeDc?: string; globalUnique?: boolean }) =>
      authFetch(`/api/projects/${projectId}/code-groups/${selectedGrpCode}/codes`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  });

  async function commitAddCodes() {
    // 비어있지 않은 행만 대상
    const valid = newCodeDrafts
      .map((d) => ({ cmCode: d.cmCode.trim(), codeNm: d.codeNm.trim(), codeDc: d.codeDc.trim() }))
      .filter((d) => d.cmCode || d.codeNm);

    if (valid.length === 0) { toast.error("추가할 코드를 입력해 주세요."); return; }

    // 벨리데이션 — 한 건이라도 문제면 저장 중단
    for (let i = 0; i < valid.length; i++) {
      const d = valid[i];
      if (!d.cmCode) { toast.error(`${i + 1}번째 행: 코드를 입력해 주세요.`); return; }
      if (!CODE_PATTERN.test(d.cmCode)) { toast.error(`${i + 1}번째 행: 코드는 영문, 숫자, _, :, - 만 입력 가능합니다.`); return; }
      if (!d.codeNm) { toast.error(`${i + 1}번째 행: 코드명을 입력해 주세요.`); return; }
    }
    // 입력 중 중복 체크 (같은 제출 안에서)
    const codes = valid.map((d) => d.cmCode);
    const dupLocal = codes.find((c, i) => codes.indexOf(c) !== i);
    if (dupLocal) { toast.error(`입력한 코드 중 중복이 있습니다: ${dupLocal}`); return; }

    // 순차 저장 — 실패 시 중단하고 에러 토스트.
    // globalUnique 는 effectiveUnique(=환경설정 강제 OR 사용자 체크) 사용
    let successCnt = 0;
    for (const d of valid) {
      try {
        await addCodeMut.mutateAsync({ cmCode: d.cmCode, codeNm: d.codeNm, codeDc: d.codeDc || undefined, globalUnique: effectiveUnique });
        successCnt++;
      } catch (err) {
        toast.error(`${d.cmCode}: ${(err as Error).message}`);
        break;
      }
    }
    if (successCnt > 0) {
      toast.success(`${successCnt}건 추가되었습니다.`);
      queryClient.invalidateQueries({ queryKey: ["codes", projectId, selectedGrpCode] });
      queryClient.invalidateQueries({ queryKey: ["code-groups", projectId] });
    }
    if (successCnt === valid.length) {
      // 전체 성공 시 입력 폼 닫기
      setAddingCode(false);
      setNewCodeDrafts([emptyDraft]);
    }
  }

  function updateDraft(idx: number, field: keyof NewCodeDraft, value: string) {
    setNewCodeDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, [field]: value } : d)));
  }
  function addDraftRow() {
    setNewCodeDrafts((prev) => [...prev, { ...emptyDraft }]);
  }
  function removeDraftRow(idx: number) {
    setNewCodeDrafts((prev) => prev.length === 1 ? [{ ...emptyDraft }] : prev.filter((_, i) => i !== idx));
  }

  // ── 코드 수정 ─────────────────────────────────────────────────────────────
  const updateCodeMut = useMutation({
    mutationFn: ({ codeId, body }: { codeId: number; body: Record<string, unknown> }) =>
      authFetch(`/api/projects/${projectId}/code-groups/${selectedGrpCode}/codes/${codeId}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["codes", projectId, selectedGrpCode] });
      setEditingCode(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function startEditCode(codeId: number, field: string, currentValue: string) {
    setEditingCode({ codeId, field });
    setEditCodeValue(currentValue);
  }

  function commitEditCode() {
    if (!editingCode) return;
    const val = editingCode.field === "sortOrdr" ? parseInt(editCodeValue) || 0 : editCodeValue;
    updateCodeMut.mutate({ codeId: editingCode.codeId, body: { [editingCode.field]: val } });
  }

  // cm_code(문자열) 변경 — codeId(serial)로 API 호출
  function commitEditCmCode(codeId: number, oldCmCode: string) {
    if (!editingCode) return;
    const newVal = editCodeValue.trim();
    if (!newVal || newVal === oldCmCode) { setEditingCode(null); setEditCodeValue(""); return; }
    if (!CODE_PATTERN.test(newVal)) { toast.error("코드는 영문, 숫자, _, :, - 만 입력 가능합니다."); return; }
    // globalUnique 는 effectiveUnique 사용 — 환경설정 강제 시 사용자 체크와 무관하게 유니크 검증
    updateCodeMut.mutate({ codeId, body: { cmCode: newVal, globalUnique: effectiveUnique } });
  }

  function toggleCodeUseYn(codeId: number, current: string) {
    updateCodeMut.mutate({ codeId, body: { useYn: current === "Y" ? "N" : "Y" } });
  }

  // ── 코드 삭제 ─────────────────────────────────────────────────────────────
  const deleteCodeMut = useMutation({
    mutationFn: (codeId: number) =>
      authFetch(`/api/projects/${projectId}/code-groups/${selectedGrpCode}/codes/${codeId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("코드가 삭제되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["codes", projectId, selectedGrpCode] });
      queryClient.invalidateQueries({ queryKey: ["code-groups", projectId] });
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // 그룹 추가 모드 활성화 시 자동 포커스
  useEffect(() => {
    if (addingGroup) grpCodeInputRef.current?.focus();
  }, [addingGroup]);
  useEffect(() => {
    if (addingCode) codeNmInputRef.current?.focus();
  }, [addingCode]);

  // ── 렌더링 ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 0, height: "100%" }}>
      {/* 행 호버 효과 CSS */}
      <style>{`
        .cc-group-row:hover { background: var(--color-bg-muted) !important; }
        .cc-code-row:hover { background: var(--color-bg-muted) !important; }
        .cc-code-row .cc-del-btn { opacity: 0.6; transition: all 0.15s; }
        .cc-code-row:hover .cc-del-btn { opacity: 1; }
        .cc-del-btn:hover { background: #ffebee !important; border-color: #ef9a9a !important; color: #c62828 !important; }
      `}</style>

      {/* 헤더 */}
      <div style={headerStyle}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          공통코드 관리
        </div>
      </div>

      {/* 마스터-디테일 레이아웃 */}
      <div style={{ margin: "16px 24px 0", border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden", display: "flex", flexDirection: "column", height: "calc(100vh - 100px)" }}>

        {/* ── 상단 바: 좌측 검색(30%) | 우측 모든 코드 조회 옵션(70%) ── */}
        <div style={{ display: "grid", gridTemplateColumns: "30% 70%", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
          {/* 좌측: 검색 */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRight: "1px solid var(--color-border)" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", flexShrink: 0 }}>검색</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="그룹 코드·코드명 검색..."
              style={{ ...searchInputStyle, flex: 1 }}
            />
          </div>
          {/* 우측: 옵션 토글들 */}
          <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", gap: 16 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-text-secondary)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showAllCodes}
                onChange={(e) => { setShowAllCodes(e.target.checked); if (e.target.checked) setSelectedGrpCode(null); }}
                style={{ cursor: "pointer" }}
              />
              모든 그룹코드 조회 (그룹별 정렬)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <label
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  fontSize: 12, color: "var(--color-text-secondary)",
                  cursor: uniqueForced ? "not-allowed" : "pointer",
                }}
                title={uniqueForced ? "프로젝트 환경설정(UNIQUE_CODE_USE_YN=Y)에서 강제 적용 중입니다." : undefined}
              >
                <input
                  type="checkbox"
                  checked={effectiveUnique}
                  disabled={uniqueForced}
                  onChange={(e) => { if (!uniqueForced) setGlobalUnique(e.target.checked); }}
                  style={{ cursor: uniqueForced ? "not-allowed" : "pointer" }}
                />
                공통코드 유니크 사용
                {uniqueForced && (
                  <span style={{ fontSize: 10, color: "#e65100", marginLeft: 4 }}>
                    (환경설정 강제)
                  </span>
                )}
              </label>
              <button
                onClick={() => setUniqueHelpOpen(true)}
                title="도움말"
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 18, height: 18, borderRadius: "50%",
                  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
                  color: "var(--color-text-secondary)", fontSize: 10, fontWeight: 700,
                  cursor: "pointer", lineHeight: 1, padding: 0,
                }}
              >
                ?
              </button>
            </div>
          </div>
        </div>

        {/* ── 하단: 좌측 그룹 목록 | 우측 코드 테이블 ── */}
        <div style={{ display: "grid", gridTemplateColumns: "30% 70%", flex: 1, overflow: "hidden" }}>

          {/* ── 좌측: 코드 그룹 ── */}
          <div style={{ borderRight: "1px solid var(--color-border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* 섹션 헤더 — 타이틀 + 추가 버튼 */}
            <div style={{ padding: "6px 16px", fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>그룹코드</span>
              <button
                onClick={() => { setAddingGroup(true); setNewGrpCode(""); setNewGrpCodeNm(""); }}
                style={{ ...addBtnStyle, padding: "3px 10px", fontSize: 11 }}
              >
                + 추가
              </button>
            </div>
            {/* 컬럼 헤더 */}
            <div style={{ ...groupColHeaderStyle }}>
              <div>그룹 코드</div>
              <div>그룹명</div>
              <div style={{ textAlign: "center" }}>코드수</div>
              <div style={{ textAlign: "center" }}>사용</div>
              <div />
            </div>
            {/* 그룹 목록 */}
            <div style={{ flex: 1, overflowY: "auto" }}>
            {/* 신규 추가 인라인 행 */}
            {addingGroup && (
              <div style={{ ...groupRowStyle, background: "#fff9e8" }}>
                <input
                  ref={grpCodeInputRef}
                  value={newGrpCode}
                  onChange={(e) => setNewGrpCode(e.target.value)}
                  placeholder="USER_STATUS"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitAddGroup();
                    if (e.key === "Escape") setAddingGroup(false);
                  }}
                  style={{ ...inlineInputStyle, fontSize: 12, fontWeight: 600 }}
                />
                <input
                  value={newGrpCodeNm}
                  onChange={(e) => setNewGrpCodeNm(e.target.value)}
                  placeholder="사용자 상태"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitAddGroup();
                    if (e.key === "Escape") setAddingGroup(false);
                  }}
                  style={{ ...inlineInputStyle, fontSize: 12 }}
                />
                <button onClick={commitAddGroup} style={{ ...miniSaveBtnStyle, gridColumn: "span 2", padding: "4px 8px", fontSize: 11 }}>저장</button>
                <button onClick={() => setAddingGroup(false)} style={deleteBtnStyle} title="취소">×</button>
              </div>
            )}

            {groupsLoading ? (
              <div style={{ padding: 20, color: "#aaa", fontSize: 13 }}>로딩 중...</div>
            ) : groups.length === 0 ? (
              <div style={{ padding: 20, color: "#aaa", fontSize: 13 }}>
                {search ? "검색 결과가 없습니다." : "등록된 코드 그룹이 없습니다."}
              </div>
            ) : (
              groups.map((g) => (
                <div
                  key={g.grpCode}
                  className="cc-group-row"
                  onClick={() => setSelectedGrpCode(g.grpCode)}
                  style={{
                    ...groupRowStyle,
                    background: selectedGrpCode === g.grpCode ? "var(--color-primary-bg, #e3f2fd)" : "var(--color-bg-card)",
                    borderLeft: selectedGrpCode === g.grpCode ? "3px solid var(--color-primary, #1976d2)" : "3px solid transparent",
                    cursor: "pointer",
                  }}
                >
                  {/* 그룹 코드 (더블클릭 인라인 편집) */}
                  {editingGroup?.grpCode === g.grpCode && editingGroup.field === "grpCode" ? (
                    <input
                      autoFocus
                      value={editGroupValue}
                      onChange={(e) => setEditGroupValue(e.target.value)}
                      onBlur={commitEditGroup}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEditGroup();
                        if (e.key === "Escape") { setEditingGroup(null); setEditGroupValue(""); }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ ...inlineInputStyle, fontSize: 12, fontWeight: 600 }}
                    />
                  ) : (
                    <div
                      onDoubleClick={(e) => { e.stopPropagation(); startEditGroup(g.grpCode, "grpCode", g.grpCode); }}
                      style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "text" }}
                      title="더블클릭하여 그룹 코드 편집"
                    >
                      {g.grpCode}
                    </div>
                  )}

                  {/* 그룹명 (더블클릭 인라인 편집) */}
                  {editingGroup?.grpCode === g.grpCode && editingGroup.field === "grpCodeNm" ? (
                    <input
                      autoFocus
                      value={editGroupValue}
                      onChange={(e) => setEditGroupValue(e.target.value)}
                      onBlur={commitEditGroup}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEditGroup();
                        if (e.key === "Escape") { setEditingGroup(null); setEditGroupValue(""); }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ ...inlineInputStyle, fontSize: 12 }}
                    />
                  ) : (
                    <div
                      onDoubleClick={(e) => { e.stopPropagation(); startEditGroup(g.grpCode, "grpCodeNm", g.grpCodeNm); }}
                      style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "text" }}
                      title="더블클릭하여 편집"
                    >
                      {g.grpCodeNm}
                    </div>
                  )}

                  {/* 코드 수 뱃지 */}
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, minWidth: 22, textAlign: "center",
                      color: g.codeCount > 0 ? "var(--color-primary, #1976d2)" : "#bbb",
                      background: g.codeCount > 0 ? "rgba(25,118,210,0.08)" : "var(--color-bg-muted)",
                      borderRadius: 10, padding: "2px 8px",
                    }}>
                      {g.codeCount}
                    </span>
                  </div>

                  {/* 사용여부 토글 */}
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <div
                      onClick={(e) => { e.stopPropagation(); toggleGroupUseYn(g.grpCode, g.useYn); }}
                      style={{ width: 32, height: 18, borderRadius: 9, background: g.useYn === "Y" ? "#4caf50" : "#ddd", position: "relative", cursor: "pointer", transition: "background 0.2s" }}
                      title={g.useYn === "Y" ? "사용 중 → 미사용으로 변경" : "미사용 → 사용으로 변경"}
                    >
                      <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: g.useYn === "Y" ? 16 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                    </div>
                  </div>

                  {/* 삭제 — 환경설정(CODE_DEL_PSBL_YN=N) 시 비활성 */}
                  <button
                    className="cc-del-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (deleteBlocked) return;
                      setDeleteTarget({ type: "group", id: g.grpCode, name: g.grpCodeNm });
                    }}
                    disabled={deleteBlocked}
                    style={{
                      ...deleteBtnStyle,
                      cursor: deleteBlocked ? "not-allowed" : "pointer",
                      opacity: deleteBlocked ? 0.3 : undefined,
                    }}
                    title={deleteBlocked ? "프로젝트 환경설정(CODE_DEL_PSBL_YN=N)에서 코드 삭제가 차단되어 있습니다." : "그룹 삭제"}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>

          {/* 좌측 하단 요약 — 총 N개 그룹 */}
          <div style={{ borderTop: "1px solid var(--color-border)", padding: "8px 16px", fontSize: 11, color: "#999" }}>
            총 {groups.length}개 그룹
          </div>
        </div>

        {/* ── 우측: 코드 목록 ── */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* 섹션 라벨 + 그룹 정보 */}
          <div style={{ padding: "8px 16px", fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>상세 공통코드</span>
          </div>

          {!selectedGrpCode && !showAllCodes ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#bbb", gap: 8 }}>
              <span style={{ fontSize: 32, opacity: 0.4 }}>🏷</span>
              <span style={{ fontSize: 13 }}>좌측에서 코드 그룹을 선택하세요</span>
            </div>
          ) : showAllCodes ? (
            <>
              {/* 전체 조회 헤더 */}
              <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-card)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)" }}>
                  전체 공통코드 ({codes.length}건)
                </span>
              </div>

              {/* 테이블 컬럼 헤더 (전체 조회) */}
              <div style={{ ...codeGridHeaderStyle, gridTemplateColumns: CODE_GRID_ALL }}>
                <div>그룹코드</div>
                <div>코드</div>
                <div>코드명</div>
                <div>설명</div>
                <div style={{ textAlign: "center" }}>사용</div>
                <div style={{ textAlign: "center" }}>순서</div>
                <div />
              </div>

              {/* 코드 행 (전체 조회 — 읽기 전용) */}
              <div style={{ flex: 1, overflowY: "auto" }}>
                {allCodesLoading ? (
                  <div style={{ padding: 20, color: "#aaa", fontSize: 13 }}>로딩 중...</div>
                ) : codes.length === 0 ? (
                  <div style={{ padding: 20, color: "#aaa", fontSize: 13 }}>등록된 코드가 없습니다.</div>
                ) : (
                  codes.map((c) => (
                    <div key={c.codeId} style={{ ...codeGridRowStyle, gridTemplateColumns: CODE_GRID_ALL, borderBottom: "1px solid var(--color-border)" }}>
                      {/* 그룹코드명 (코드) */}
                      <div style={{ fontSize: 12, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "2px 4px" }} title={`${c.grpCodeNm} (${c.grpCode})`}>
                        <span style={{ fontWeight: 600 }}>{c.grpCodeNm}</span>
                        <span style={{ color: "#999", marginLeft: 4 }}>({c.grpCode})</span>
                      </div>
                      {/* 코드 */}
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "2px 4px" }}>{c.cmCode}</div>
                      {/* 코드명 */}
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "2px 4px" }}>{c.codeNm}</div>
                      {/* 설명 */}
                      <div style={{ fontSize: 13, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "2px 4px" }}>{c.codeDc || "-"}</div>
                      {/* 사용 */}
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <div style={{ width: 32, height: 18, borderRadius: 9, background: c.useYn === "Y" ? "#4caf50" : "#ddd", position: "relative" }}>
                          <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: c.useYn === "Y" ? 16 : 2, boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                        </div>
                      </div>
                      {/* 순서 */}
                      <div style={{ textAlign: "center", fontSize: 13, color: "#888" }}>{c.sortOrdr}</div>
                      <div />
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              {/* 그룹 정보 헤더 — 그룹명 + 설명 textarea + 코드 추가 */}
              <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-card)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)" }}>
                      {selectedGroup?.grpCodeNm}
                    </span>
                    <span style={{ fontSize: 12, color: "#666", background: "var(--color-bg-muted)", padding: "2px 10px", borderRadius: 4 }}>
                      {selectedGroup?.grpCode}
                    </span>
                  </div>
                  <button
                    onClick={() => { setAddingCode(true); setNewCodeDrafts([{ ...emptyDraft }]); }}
                    style={addBtnStyle}
                  >
                    + 코드 추가
                  </button>
                </div>
                {/* 그룹 설명 textarea + 저장 */}
                <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                  <textarea
                    value={descValue}
                    onChange={(e) => { setDescValue(e.target.value); setDescDirty(true); }}
                    placeholder="그룹 설명을 입력하세요..."
                    rows={2}
                    style={{ ...inlineInputStyle, flex: 1, resize: "none", fontSize: 12, background: "var(--color-bg-muted)", borderRadius: 6 }}
                  />
                  {descDirty && (
                    <button onClick={() => { saveDesc(); }} style={{ ...miniSaveBtnStyle, padding: "4px 10px", fontSize: 11, flexShrink: 0, marginTop: 2 }}>저장</button>
                  )}
                </div>
              </div>

              {/* 테이블 컬럼 헤더 */}
              <div style={codeGridHeaderStyle}>
                <div>코드</div>
                <div>코드명</div>
                <div>설명</div>
                <div style={{ textAlign: "center" }}>사용</div>
                <div style={{ textAlign: "center" }}>순서</div>
                <div />
              </div>

              {/* 코드 행 */}
              <div style={{ flex: 1, overflowY: "auto" }}>
                {/* 신규 추가 인라인 행 — 여러 건 동시 입력 */}
                {addingCode && (
                  <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--color-border)", background: "#fff9e8" }}>
                    {newCodeDrafts.map((draft, idx) => (
                      <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                        <input
                          ref={idx === 0 ? codeNmInputRef : undefined}
                          value={draft.cmCode}
                          onChange={(e) => updateDraft(idx, "cmCode", e.target.value)}
                          placeholder="코드 (영문,숫자,_,:,-)"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitAddCodes();
                            if (e.key === "Escape") { setAddingCode(false); setNewCodeDrafts([{ ...emptyDraft }]); }
                          }}
                          style={{ ...inlineInputStyle, flex: 1 }}
                        />
                        <input
                          value={draft.codeNm}
                          onChange={(e) => updateDraft(idx, "codeNm", e.target.value)}
                          placeholder="코드명"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitAddCodes();
                            if (e.key === "Escape") { setAddingCode(false); setNewCodeDrafts([{ ...emptyDraft }]); }
                          }}
                          style={{ ...inlineInputStyle, flex: 1.2 }}
                        />
                        <input
                          value={draft.codeDc}
                          onChange={(e) => updateDraft(idx, "codeDc", e.target.value)}
                          placeholder="설명 (선택)"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitAddCodes();
                            if (e.key === "Escape") { setAddingCode(false); setNewCodeDrafts([{ ...emptyDraft }]); }
                          }}
                          style={{ ...inlineInputStyle, flex: 1.5 }}
                        />
                        <button
                          onClick={() => removeDraftRow(idx)}
                          title="행 제거"
                          style={{ ...deleteBtnStyle, color: "#c62828" }}
                        >
                          −
                        </button>
                      </div>
                    ))}
                    {/* 행 추가 + 일괄 저장 + 취소 */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                      <button
                        onClick={addDraftRow}
                        style={{
                          padding: "4px 12px", borderRadius: 5, border: "1px dashed var(--color-border)",
                          background: "transparent", color: "var(--color-text-secondary)",
                          fontSize: 11, fontWeight: 600, cursor: "pointer",
                        }}
                      >
                        + 행 추가
                      </button>
                      <div style={{ display: "flex", gap: 6 }}>
                        {effectiveUnique && (
                          <span style={{ fontSize: 10, color: "#e65100", alignSelf: "center", marginRight: 6 }}>
                            ⚠ 유니크 옵션 적용 중{uniqueForced ? " (환경설정 강제)" : ""}
                          </span>
                        )}
                        <button
                          onClick={() => { setAddingCode(false); setNewCodeDrafts([{ ...emptyDraft }]); }}
                          style={{ ...miniCancelBtnStyle, padding: "4px 12px", fontSize: 11 }}
                        >
                          취소
                        </button>
                        <button
                          onClick={commitAddCodes}
                          disabled={addCodeMut.isPending}
                          style={{ ...miniSaveBtnStyle, padding: "4px 14px", fontSize: 11 }}
                        >
                          {addCodeMut.isPending ? "저장 중..." : `일괄 저장 (${newCodeDrafts.filter((d) => d.cmCode.trim() || d.codeNm.trim()).length})`}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {codesLoading ? (
                  <div style={{ padding: 20, color: "#aaa", fontSize: 13 }}>로딩 중...</div>
                ) : codes.length === 0 && !addingCode ? (
                  <div style={{ padding: 20, color: "#aaa", fontSize: 13 }}>등록된 코드가 없습니다.</div>
                ) : (
                  codes.map((c) => (
                    <div key={c.codeId} className="cc-code-row" style={{ ...codeGridRowStyle, borderBottom: "1px solid var(--color-border)" }}>
                      {/* 코드 (PK) — 클릭 편집 */}
                      {editingCode?.codeId === c.codeId && editingCode.field === "cmCode" ? (
                        <input
                          autoFocus
                          value={editCodeValue}
                          onChange={(e) => setEditCodeValue(e.target.value)}
                          onBlur={() => commitEditCmCode(c.codeId, c.cmCode)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEditCmCode(c.codeId, c.cmCode);
                            if (e.key === "Escape") { setEditingCode(null); setEditCodeValue(""); }
                          }}
                          style={{ ...inlineInputStyle, fontSize: 12 }}
                        />
                      ) : (
                        <div
                          onClick={(e) => { e.stopPropagation(); startEditCode(c.codeId, "cmCode", c.cmCode); }}

                          style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "text", minHeight: 20, padding: "2px 4px" }}
                          title="클릭하여 편집"
                        >
                          {c.cmCode}
                        </div>
                      )}


                      {/* 코드명 */}
                      {editingCode?.codeId === c.codeId && editingCode.field === "codeNm" ? (
                        <input
                          autoFocus
                          value={editCodeValue}
                          onChange={(e) => setEditCodeValue(e.target.value)}
                          onBlur={commitEditCode}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEditCode();
                            if (e.key === "Escape") { setEditingCode(null); setEditCodeValue(""); }
                          }}
                          style={inlineInputStyle}
                        />
                      ) : (
                        <div
                          onClick={(e) => { e.stopPropagation(); startEditCode(c.codeId, "codeNm", c.codeNm); }}

                          style={{ cursor: "text", fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minHeight: 20, padding: "2px 4px" }}
                          title="클릭하여 편집"
                        >
                          {c.codeNm || "-"}
                        </div>
                      )}

                      {/* 설명 */}
                      {editingCode?.codeId === c.codeId && editingCode.field === "codeDc" ? (
                        <input
                          autoFocus
                          value={editCodeValue}
                          onChange={(e) => setEditCodeValue(e.target.value)}
                          onBlur={commitEditCode}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEditCode();
                            if (e.key === "Escape") { setEditingCode(null); setEditCodeValue(""); }
                          }}
                          style={inlineInputStyle}
                        />
                      ) : (
                        <div
                          onClick={(e) => { e.stopPropagation(); startEditCode(c.codeId, "codeDc", c.codeDc); }}

                          style={{ cursor: "text", fontSize: 13, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minHeight: 20, padding: "2px 4px" }}
                          title="클릭하여 편집"
                        >
                          {c.codeDc || "-"}
                        </div>
                      )}

                      {/* 사용여부 토글 */}
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <div
                          onClick={() => toggleCodeUseYn(c.codeId, c.useYn)}
                          style={{ width: 32, height: 18, borderRadius: 9, background: c.useYn === "Y" ? "#4caf50" : "#ddd", position: "relative", cursor: "pointer", transition: "background 0.2s" }}
                          title={c.useYn === "Y" ? "사용 중" : "미사용"}
                        >
                          <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: c.useYn === "Y" ? 16 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                        </div>
                      </div>

                      {/* 순서 */}
                      {editingCode?.codeId === c.codeId && editingCode.field === "sortOrdr" ? (
                        <input
                          autoFocus
                          type="number"
                          value={editCodeValue}
                          onChange={(e) => setEditCodeValue(e.target.value)}
                          onBlur={commitEditCode}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEditCode();
                            if (e.key === "Escape") { setEditingCode(null); setEditCodeValue(""); }
                          }}
                          style={{ ...inlineInputStyle, textAlign: "center", width: "100%" }}
                        />
                      ) : (
                        <div
                          onClick={(e) => { e.stopPropagation(); startEditCode(c.codeId, "sortOrdr", String(c.sortOrdr)); }}

                          style={{ textAlign: "center", cursor: "text", fontSize: 13, color: "#888", minHeight: 20, padding: "2px 4px" }}
                          title="클릭하여 편집"
                        >
                          {c.sortOrdr}
                        </div>
                      )}

                      {/* 삭제 — 호버 시에만 표시. 환경설정(CODE_DEL_PSBL_YN=N) 시 비활성 */}
                      <div style={{ textAlign: "center" }}>
                        <button
                          className="cc-del-btn"
                          onClick={() => {
                            if (deleteBlocked) return;
                            setDeleteTarget({ type: "code", id: c.codeId, name: c.codeNm });
                          }}
                          disabled={deleteBlocked}
                          style={{
                            ...deleteBtnStyle,
                            cursor: deleteBlocked ? "not-allowed" : "pointer",
                            opacity: deleteBlocked ? 0.3 : undefined,
                          }}
                          title={deleteBlocked ? "프로젝트 환경설정(CODE_DEL_PSBL_YN=N)에서 코드 삭제가 차단되어 있습니다." : "코드 삭제"}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
      </div>

      {/* ── 삭제 확인 다이얼로그 ── */}
      {deleteTarget && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
        >
          <div
            style={{ background: "var(--color-bg-card)", borderRadius: 10, padding: "24px 28px", minWidth: 400, maxWidth: 460, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 18 }}>⚠️</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#c62828" }}>
                {deleteTarget.type === "group" ? "그룹 삭제 확인" : "코드 삭제 확인"}
              </span>
            </div>
            <div style={{ padding: "12px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", marginBottom: 14 }}>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)", marginRight: 8 }}>
                {deleteTarget.type === "group" ? "그룹명" : "코드명"}
              </span>
              <strong style={{ fontSize: 13, color: "var(--color-text-primary)" }}>{deleteTarget.name}</strong>
            </div>
            <div style={{
              padding: "10px 14px", borderRadius: 8,
              background: "#ffebee", border: "1px solid #ef9a9a",
              fontSize: 12, lineHeight: 1.7, color: "#b71c1c", marginBottom: 20,
            }}>
              {deleteTarget.type === "group" ? (
                <>
                  <b>주의</b> — 그룹을 삭제하면 <b>하위의 모든 코드도 함께 삭제</b>됩니다.
                  <br />이미 다른 기능이나 데이터에서 이 코드를 사용 중이라면 오류가 발생할 수 있습니다.
                </>
              ) : (
                <>
                  <b>주의</b> — 이 코드를 프로그램이나 데이터에서 참조하고 있다면 오류가 발생할 수 있습니다. 확인 후 삭제하세요.
                </>
              )}
              <br />삭제 후에는 복구할 수 없습니다.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setDeleteTarget(null)} style={miniCancelBtnStyle}>취소</button>
              <button
                onClick={() => {
                  if (deleteTarget.type === "group") deleteGroupMut.mutate(deleteTarget.id as string);
                  else deleteCodeMut.mutate(deleteTarget.id as number);
                }}
                style={{ ...miniSaveBtnStyle, background: "#e53935" }}
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 그룹 코드 변경 경고 다이얼로그 ── */}
      {renameConfirm && (
        <div
          onClick={() => { setRenameConfirm(null); setEditingGroup(null); setEditGroupValue(""); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--color-bg-card)", borderRadius: 10, padding: "24px 28px", minWidth: 380, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: "#e65100" }}>
              ⚠ 그룹 코드 변경
            </div>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 8px", lineHeight: 1.6 }}>
              그룹 코드를 <strong>{renameConfirm.grpCode}</strong> → <strong>{renameConfirm.newValue}</strong> 로 변경합니다.
            </p>
            <p style={{ fontSize: 12, color: "#e53935", margin: "0 0 20px", lineHeight: 1.5 }}>
              이 그룹에 속한 모든 코드의 참조가 함께 변경됩니다.<br />
              이 코드를 사용하는 다른 시스템이 있다면 영향을 받을 수 있습니다.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => { setRenameConfirm(null); setEditingGroup(null); setEditGroupValue(""); }} style={miniCancelBtnStyle}>취소</button>
              <button onClick={confirmRenameGroup} style={{ ...miniSaveBtnStyle, background: "#e65100" }}>
                변경
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── "공통코드 유니크 사용" 도움말 팝업 ── */}
      {uniqueHelpOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}
          onClick={() => setUniqueHelpOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(560px, 90vw)", background: "var(--color-bg-card)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.2)", overflow: "hidden" }}
          >
            {/* 헤더 */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 20px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)",
            }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>공통코드 유니크 사용</span>
              <button
                onClick={() => setUniqueHelpOpen(false)}
                style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--color-text-secondary)", padding: "0 4px", lineHeight: 1 }}
              >×</button>
            </div>

            {/* 내용 */}
            <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12, fontSize: 13, lineHeight: 1.7, color: "var(--color-text-primary)" }}>
              <div style={{ color: "var(--color-text-secondary)" }}>
                코드가 <b>프로젝트 내 모든 그룹</b>에서 유일해야 하는지 결정합니다.
              </div>

              <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>체크 해제 (기본)</div>
                <div style={{ color: "var(--color-text-secondary)" }}>
                  같은 그룹 안에서만 코드 중복 방지. 다른 그룹에는 같은 코드가 있어도 괜찮습니다.
                </div>
              </div>

              <div style={{ padding: "10px 14px", borderRadius: 8, background: "#fff8e1", border: "1px solid #ffe082" }}>
                <div style={{ fontWeight: 700, marginBottom: 2, color: "#e65100" }}>체크 시</div>
                <div style={{ color: "#795548" }}>
                  전체 프로젝트에서 코드는 유일해야 합니다. 동일한 이름의 코드가 다른 그룹에도 존재할 수 없습니다.
                </div>
              </div>

              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", fontStyle: "italic" }}>
                ※ 등록·수정 시점에만 검증됩니다.
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ── 스타일 ───────────────────────────────────────────────────────────────────

const headerStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "10px 24px", background: "var(--color-bg-card)",
  borderBottom: "1px solid var(--color-border)",
};

const searchInputStyle: React.CSSProperties = {
  flex: 1, padding: "7px 12px", borderRadius: 7,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-primary)", fontSize: 13, outline: "none",
};

const addBtnStyle: React.CSSProperties = {
  padding: "3px 10px", borderRadius: 4, lineHeight: 1.4,
  border: "1px solid var(--color-primary, #1976d2)",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0,
  alignSelf: "center", height: "fit-content",
};

// 그룹 컬럼 그리드: 그룹코드 | 그룹명 | 코드수 | 사용 | 삭제
const GROUP_GRID = "1.2fr 1.5fr 48px 40px 28px";

const groupColHeaderStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: GROUP_GRID, gap: 8,
  padding: "7px 14px", background: "var(--color-bg-card)",
  fontSize: 11, fontWeight: 600, color: "var(--color-text-tertiary, #999)",
  borderBottom: "1px solid var(--color-border)", alignItems: "center",
};

const groupRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: GROUP_GRID, gap: 8, alignItems: "center",
  padding: "9px 14px", borderBottom: "1px solid var(--color-border)",
  transition: "background 0.15s",
};

const inlineInputStyle: React.CSSProperties = {
  width: "100%", padding: "5px 8px", borderRadius: 4,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-primary)", fontSize: 13, outline: "none",
  boxSizing: "border-box",
};

const CODE_GRID = "1.2fr 1.5fr 2fr 50px 50px 32px";
// 전체 조회 모드: 그룹코드명 컬럼 추가 (맨 앞)
const CODE_GRID_ALL = "1.5fr 1.2fr 1.5fr 2fr 50px 50px 32px";

const codeGridHeaderStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: CODE_GRID, gap: 10,
  padding: "9px 16px", background: "var(--color-bg-muted)",
  fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border)", alignItems: "center",
};

const codeGridRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: CODE_GRID, gap: 10,
  padding: "9px 16px", alignItems: "center",
  background: "var(--color-bg-card)",
};

const deleteBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 22, height: 22, borderRadius: 4,
  background: "transparent", border: "1px solid transparent",
  cursor: "pointer", fontSize: 15, color: "#bbb", lineHeight: 1, padding: 0,
  transition: "all 0.12s",
};

const miniSaveBtnStyle: React.CSSProperties = {
  padding: "4px 12px", borderRadius: 5, border: "none",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
};

const miniCancelBtnStyle: React.CSSProperties = {
  padding: "4px 12px", borderRadius: 5,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-primary)", fontSize: 12, cursor: "pointer",
};
