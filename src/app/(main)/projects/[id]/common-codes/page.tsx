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
  grpCode: string;
  codeNm: string;
  codeDc: string;
  useYn: string;
  sortOrdr: number;
};

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

  // 코드 추가 모드
  const [addingCode, setAddingCode] = useState(false);
  const [newCodeNm, setNewCodeNm] = useState("");
  const [newCodeDc, setNewCodeDc] = useState("");
  const codeNmInputRef = useRef<HTMLInputElement>(null);

  // 코드 인라인 편집
  const [editingCode, setEditingCode] = useState<{ codeId: number; field: string } | null>(null);
  const [editCodeValue, setEditCodeValue] = useState("");

  // 삭제 확인
  const [deleteTarget, setDeleteTarget] = useState<{ type: "group" | "code"; id: string | number; name: string } | null>(null);

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
  const { data: codesData, isLoading: codesLoading } = useQuery({
    queryKey: ["codes", projectId, selectedGrpCode],
    queryFn: () =>
      authFetch<{ data: { items: Code[] } }>(
        `/api/projects/${projectId}/code-groups/${selectedGrpCode}/codes`
      ).then((r) => r.data.items),
    enabled: !!selectedGrpCode,
  });
  const codes = codesData ?? [];

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
    const body = { [editingGroup.field]: editGroupValue };
    updateGroupMut.mutate({ grpCode: editingGroup.grpCode, body });
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

  // ── 코드 추가 ─────────────────────────────────────────────────────────────
  const addCodeMut = useMutation({
    mutationFn: (body: { codeNm: string; codeDc?: string }) =>
      authFetch(`/api/projects/${projectId}/code-groups/${selectedGrpCode}/codes`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("코드가 추가되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["codes", projectId, selectedGrpCode] });
      queryClient.invalidateQueries({ queryKey: ["code-groups", projectId] });
      setAddingCode(false);
      setNewCodeNm("");
      setNewCodeDc("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function commitAddCode() {
    if (!newCodeNm.trim()) { toast.error("코드명을 입력해 주세요."); return; }
    addCodeMut.mutate({ codeNm: newCodeNm.trim(), codeDc: newCodeDc.trim() || undefined });
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
      {/* 헤더 */}
      <div style={headerStyle}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          공통코드 관리
        </div>
      </div>

      {/* 마스터-디테일 레이아웃 */}
      <div style={{ display: "grid", gridTemplateColumns: "35% 65%", height: "calc(100vh - 100px)", overflow: "hidden", margin: "16px 24px 0", border: "1px solid var(--color-border)", borderRadius: 8 }}>

        {/* ── 좌측: 코드 그룹 ── */}
        <div style={{ borderRight: "1px solid var(--color-border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* 검색 + 추가 */}
          <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--color-border)" }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="그룹 코드·코드명 검색..."
              style={searchInputStyle}
            />
            <button
              onClick={() => { setAddingGroup(true); setNewGrpCode(""); setNewGrpCodeNm(""); }}
              style={addBtnStyle}
            >
              + 추가
            </button>
          </div>

          {/* 그룹 목록 */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {/* 신규 추가 인라인 행 */}
            {addingGroup && (
              <div style={{ ...groupRowStyle, background: "#fffde7", borderBottom: "1px solid var(--color-border)" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                  <input
                    ref={grpCodeInputRef}
                    value={newGrpCode}
                    onChange={(e) => setNewGrpCode(e.target.value)}
                    placeholder="그룹 코드 (예: USER_STATUS)"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitAddGroup();
                      if (e.key === "Escape") setAddingGroup(false);
                    }}
                    style={{ ...inlineInputStyle, fontSize: 13, fontWeight: 600 }}
                  />
                  <input
                    value={newGrpCodeNm}
                    onChange={(e) => setNewGrpCodeNm(e.target.value)}
                    placeholder="코드명 (예: 사용자 상태)"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitAddGroup();
                      if (e.key === "Escape") setAddingGroup(false);
                    }}
                    style={{ ...inlineInputStyle, fontSize: 12 }}
                  />
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={commitAddGroup} style={miniSaveBtnStyle}>저장</button>
                  <button onClick={() => setAddingGroup(false)} style={miniCancelBtnStyle}>취소</button>
                </div>
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
                  onClick={() => setSelectedGrpCode(g.grpCode)}
                  style={{
                    ...groupRowStyle,
                    background: selectedGrpCode === g.grpCode ? "var(--color-primary-bg, #e3f2fd)" : "var(--color-bg-card)",
                    borderLeft: selectedGrpCode === g.grpCode ? "3px solid var(--color-primary, #1976d2)" : "3px solid transparent",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* 그룹 코드 (인라인 편집 가능) */}
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {g.grpCode}
                    </div>
                    {/* 그룹 코드명 (인라인 편집) */}
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
                        style={{ ...inlineInputStyle, fontSize: 12, marginTop: 2 }}
                      />
                    ) : (
                      <div
                        onDoubleClick={(e) => { e.stopPropagation(); startEditGroup(g.grpCode, "grpCodeNm", g.grpCodeNm); }}
                        style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title="더블클릭하여 편집"
                      >
                        {g.grpCodeNm}
                      </div>
                    )}
                  </div>

                  {/* 코드 수 뱃지 */}
                  <span style={{ fontSize: 11, color: "#888", background: "var(--color-bg-muted)", borderRadius: 10, padding: "1px 8px", flexShrink: 0 }}>
                    {g.codeCount}
                  </span>

                  {/* 사용여부 토글 */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleGroupUseYn(g.grpCode, g.useYn); }}
                    style={{ ...useYnBtnStyle, color: g.useYn === "Y" ? "#2e7d32" : "#bbb" }}
                    title={g.useYn === "Y" ? "사용 중" : "미사용"}
                  >
                    {g.useYn === "Y" ? "✓" : "—"}
                  </button>

                  {/* 삭제 */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: "group", id: g.grpCode, name: g.grpCodeNm }); }}
                    style={deleteBtnStyle}
                    title="그룹 삭제"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>

          {/* 선택된 그룹 설명 */}
          {selectedGroup && (
            <div style={{ borderTop: "1px solid var(--color-border)", padding: "12px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6 }}>
                그룹 설명
              </div>
              <textarea
                value={descValue}
                onChange={(e) => { setDescValue(e.target.value); setDescDirty(true); }}
                onBlur={saveDesc}
                placeholder="그룹 설명을 입력하세요..."
                rows={3}
                style={{ ...inlineInputStyle, resize: "vertical", fontSize: 13 }}
              />
            </div>
          )}
        </div>

        {/* ── 우측: 코드 목록 ── */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {!selectedGrpCode ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#aaa", fontSize: 14 }}>
              좌측에서 코드 그룹을 선택하세요
            </div>
          ) : (
            <>
              {/* 코드 목록 — 그룹명 + 코드추가 (좌측 검색바와 높이 맞춤) */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--color-border)" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)" }}>
                    {selectedGroup?.grpCodeNm ?? selectedGrpCode}
                  </span>
                  <span style={{ fontSize: 11, color: "#999" }}>
                    {selectedGroup?.grpCode}
                  </span>
                </div>
                <button
                  onClick={() => { setAddingCode(true); setNewCodeNm(""); setNewCodeDc(""); }}
                  style={addBtnStyle}
                >
                  + 코드 추가
                </button>
              </div>

              {/* 테이블 컬럼 헤더 */}
              <div style={codeGridHeaderStyle}>
                <div>코드명</div>
                <div>설명</div>
                <div style={{ textAlign: "center" }}>사용</div>
                <div style={{ textAlign: "center" }}>순서</div>
                <div />
              </div>

              {/* 코드 행 */}
              <div style={{ flex: 1, overflowY: "auto" }}>
                {/* 신규 추가 인라인 행 */}
                {addingCode && (
                  <div style={{ ...codeGridRowStyle, background: "#fffde7", borderBottom: "1px solid var(--color-border)" }}>
                    <input
                      ref={codeNmInputRef}
                      value={newCodeNm}
                      onChange={(e) => setNewCodeNm(e.target.value)}
                      placeholder="코드명"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitAddCode();
                        if (e.key === "Escape") setAddingCode(false);
                      }}
                      style={inlineInputStyle}
                    />
                    <input
                      value={newCodeDc}
                      onChange={(e) => setNewCodeDc(e.target.value)}
                      placeholder="설명 (선택)"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitAddCode();
                        if (e.key === "Escape") setAddingCode(false);
                      }}
                      style={inlineInputStyle}
                    />
                    <div style={{ textAlign: "center" }}>
                      <button onClick={commitAddCode} style={miniSaveBtnStyle}>저장</button>
                    </div>
                    <div />
                    <div style={{ textAlign: "center" }}>
                      <button onClick={() => setAddingCode(false)} style={miniCancelBtnStyle}>취소</button>
                    </div>
                  </div>
                )}

                {codesLoading ? (
                  <div style={{ padding: 20, color: "#aaa", fontSize: 13 }}>로딩 중...</div>
                ) : codes.length === 0 && !addingCode ? (
                  <div style={{ padding: 20, color: "#aaa", fontSize: 13 }}>등록된 코드가 없습니다.</div>
                ) : (
                  codes.map((c) => (
                    <div key={c.codeId} style={{ ...codeGridRowStyle, borderBottom: "1px solid var(--color-border)" }}>
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
                          onClick={() => startEditCode(c.codeId, "codeNm", c.codeNm)}
                          style={{ cursor: "pointer", fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title="클릭하여 편집"
                        >
                          {c.codeNm}
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
                          onClick={() => startEditCode(c.codeId, "codeDc", c.codeDc)}
                          style={{ cursor: "pointer", fontSize: 13, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title="클릭하여 편집"
                        >
                          {c.codeDc || "-"}
                        </div>
                      )}

                      {/* 사용여부 */}
                      <div style={{ textAlign: "center" }}>
                        <button
                          onClick={() => toggleCodeUseYn(c.codeId, c.useYn)}
                          style={{ ...useYnBtnStyle, color: c.useYn === "Y" ? "#2e7d32" : "#bbb" }}
                        >
                          {c.useYn === "Y" ? "Y" : "N"}
                        </button>
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
                          onClick={() => startEditCode(c.codeId, "sortOrdr", String(c.sortOrdr))}
                          style={{ textAlign: "center", cursor: "pointer", fontSize: 13, color: "#888" }}
                          title="클릭하여 편집"
                        >
                          {c.sortOrdr}
                        </div>
                      )}

                      {/* 삭제 */}
                      <div style={{ textAlign: "center" }}>
                        <button
                          onClick={() => setDeleteTarget({ type: "code", id: c.codeId, name: c.codeNm })}
                          style={deleteBtnStyle}
                          title="코드 삭제"
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

      {/* ── 삭제 확인 다이얼로그 ── */}
      {deleteTarget && (
        <div
          onClick={() => setDeleteTarget(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--color-bg-card)", borderRadius: 10, padding: "24px 28px", minWidth: 340, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
              {deleteTarget.type === "group" ? "그룹 삭제" : "코드 삭제"}
            </div>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 20px" }}>
              <strong>{deleteTarget.name}</strong>을(를) 삭제하시겠습니까?
              {deleteTarget.type === "group" && (
                <><br /><span style={{ color: "#e53935" }}>하위 코드도 모두 삭제됩니다.</span></>
              )}
            </p>
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
  padding: "6px 14px", borderRadius: 6,
  border: "1px solid var(--color-primary, #1976d2)",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0,
};

const groupRowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10,
  padding: "11px 16px", borderBottom: "1px solid var(--color-border)",
  transition: "background 0.15s",
};

const inlineInputStyle: React.CSSProperties = {
  width: "100%", padding: "5px 8px", borderRadius: 4,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-primary)", fontSize: 13, outline: "none",
  boxSizing: "border-box",
};

const CODE_GRID = "1.5fr 2.5fr 50px 50px 32px";

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

const useYnBtnStyle: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  fontSize: 14, fontWeight: 700, lineHeight: 1, padding: "2px 4px",
};

const deleteBtnStyle: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  fontSize: 18, color: "#ccc", lineHeight: 1, padding: "0 4px",
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
