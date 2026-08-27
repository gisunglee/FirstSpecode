"use client";

/**
 * DbTablesPage — DB 테이블 목록 (프로젝트별)
 *
 * 역할:
 *   - tb_ds_db_table 목록 조회 (컬럼 수 포함)
 *   - 테이블명 클릭 시 상세/편집 페이지 이동
 *   - 신규 등록 인라인 폼 (물리명 필수)
 *   - 삭제 확인 다이얼로그
 */

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";
import DdlBulkImportDialog from "@/components/ui/DdlBulkImportDialog";
import ExcelDownloadButton from "@/components/common/ExcelDownloadButton";
// 매핑 인사이트 Phase 2 — IO 프로필 아이콘, 커버리지 텍스트 배지
import { IoProfileIcon, CoverageText } from "@/components/db-table/TableInsightBadges";
import type { IoProfile } from "@/lib/dbTableUsage";
import { BulkDeleteTableConfirmDialog, type BulkDeleteItem } from "@/components/db-table/DbTableDialogs";
import type { TableUsageResponse } from "@/components/db-table/TableUsageSection";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type DbTableRow = {
  tblId: string;
  tblPhysclNm: string;
  tblLgclNm: string;
  tblDc: string;
  creatDt: string;
  // 수정일 — 아직 수정된 적 없으면 null (서버가 mdfcn_dt를 내려줌)
  mdfcnDt: string | null;
  // 담당자 — 서버 join으로 내려옴. 미지정/퇴장 멤버면 null
  assignMemberId: string | null;
  assignMemberName: string | null;
  columnCount: number;
  // 이 테이블의 컬럼을 사용하는 distinct 기능 수 (매핑 인사이트 Phase 1)
  // 0 이면 "아직 설계에서 참조되지 않은 테이블" 로 해석 가능 → 회색 처리
  functionCount: number;
  // Phase 2 추가 — 매핑된 적 있는 컬럼 수 (커버리지 계산용)
  usedColCount: number;
  // Phase 2 추가 — IO 프로필 분류 (READ_HEAVY / WRITE_HEAVY / MIXED / NONE)
  ioProfile: IoProfile;
  // Phase 3 추가 — 마지막 매핑 저장 시각 (ISO). 매핑 없으면 null.
  lastUsedDt: string | null;
};

// ── 상수 ──────────────────────────────────────────────────────────────────────

// 클라이언트 사이드 인사이트 필터 — URL 파라미터 대신 페이지 내부 state 로 유지
// (같은 목록을 다른 관점으로 볼 뿐이라 URL 공유까진 불필요하다고 판단)
type InsightFilter = "all" | "unused" | "low" | "hot" | "stale";

// 임계값 (필요 시 상수 튜닝으로 정책 조정)
//  - 저활용:  커버리지 < 30% (컬럼은 있는데 대부분 안 쓰임)
//  - 핫:     functionCount >= 5 (특정 테이블을 여러 기능이 공통 사용)
//  - 오래됨: 마지막 매핑 저장이 STALE_DAYS 일 이상 전
const LOW_COVERAGE_THRESHOLD = 30;
const HOT_FUNCTION_THRESHOLD = 5;
const STALE_DAYS = 90;

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function DbTablesPage() {
  return (
    <Suspense fallback={null}>
      <DbTablesPageInner />
    </Suspense>
  );
}

function DbTablesPageInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const projectId = params.id;
  const { setBreadcrumb } = useAppStore();

  // DB 테이블은 브레드크럼 생략 — LNB + 페이지 헤더로 위치 안내 충분
  useEffect(() => {
    setBreadcrumb([]);
    return () => setBreadcrumb([]);
  }, [setBreadcrumb]);

  const [search, setSearch] = useState("");

  // 매핑 인사이트 필터 — Phase 2
  //   · all:    전체
  //   · unused: 매핑 자체가 없는 테이블 (ioProfile=NONE)
  //   · low:    컬럼이 있는데 커버리지 < 30% (설계 누락 의심)
  //   · hot:    기능 연결 수가 임계치 이상 (핵심 테이블)
  const [insightFilter, setInsightFilter] = useState<InsightFilter>("all");

  // 담당자 필터 — 전역 appStore.myAssigneeMode 구독 (GNB 토글과 양방향 바인딩)
  const filterAssignedTo = useAppStore((s) => s.myAssigneeMode);
  const setMyAssigneeMode = useAppStore((s) => s.setMyAssigneeMode);
  const hasLoadedProfile = useAppStore((s) => s._hasLoadedProfile);
  // 페이지 세그먼트 토글 클릭 → 전역 state + DB 저장 + 실패 시 롤백
  function setFilterAssignedTo(next: "all" | "me") {
    const prev = filterAssignedTo;
    setMyAssigneeMode(next);
    authFetch("/api/member/profile/assignee-view", {
      method: "PATCH",
      body: JSON.stringify({ mode: next }),
    }).catch((err: Error) => {
      setMyAssigneeMode(prev);
      toast.error("설정 저장 실패: " + err.message);
    });
  }

  // ── 신규 등록 인라인 폼 ──────────────────────────────────────────────────────
  const [creating, setCreating] = useState(false);
  const [newPhysNm, setNewPhysNm] = useState("");
  const [newLgclNm, setNewLgclNm] = useState("");
  const [newDc, setNewDc] = useState("");

  // ── DDL 일괄 등록 모달 ──────────────────────────────────────────────────────
  const [bulkOpen, setBulkOpen] = useState(false);

  // ── 일괄 삭제 ────────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // 삭제 확인창을 열 때 선택된 테이블들의 사용 현황을 미리 조회해 담아둔다 (탐색 중 화면 이탈 방지)
  const [deleteItems, setDeleteItems] = useState<BulkDeleteItem[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);

  // ── 목록 조회 ────────────────────────────────────────────────────────────────
  // 프로필 로드 전에는 쿼리 지연 → 첫 렌더 플리커 방지
  const { data: rows = [], isLoading } = useQuery<DbTableRow[]>({
    queryKey: ["db-tables", projectId, filterAssignedTo],
    queryFn: () => {
      const qs = filterAssignedTo === "me" ? "?assignedTo=me" : "";
      return authFetch<{ data: DbTableRow[] }>(`/api/projects/${projectId}/db-tables${qs}`)
        .then((r) => r.data);
    },
    enabled: hasLoadedProfile,
  });

  // ── 생성 뮤테이션 ────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (body: { tblPhysclNm: string; tblLgclNm: string; tblDc: string }) =>
      authFetch<{ data: { tblId: string } }>(`/api/projects/${projectId}/db-tables`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["db-tables", projectId] });
      toast.success("테이블이 등록되었습니다.");
      setCreating(false);
      setNewPhysNm(""); setNewLgclNm(""); setNewDc("");
      // 생성 즉시 상세 페이지로 이동
      router.push(`/projects/${projectId}/db-tables/${res.data.tblId}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 일괄 삭제 뮤테이션 ────────────────────────────────────────────────────────
  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) =>
      authFetch<{ data: { deleted: { tblId: string }[]; failed: { tblPhysclNm: string; reason: string }[] } }>(
        `/api/projects/${projectId}/db-tables/bulk`,
        { method: "DELETE", body: JSON.stringify({ tableIds: ids }) }
      ),
    onSuccess: (res) => {
      const { deleted, failed } = res.data;
      qc.invalidateQueries({ queryKey: ["db-tables", projectId] });
      setDeleteDialogOpen(false);
      setSelectedIds(new Set());
      if (deleted.length > 0) toast.success(`테이블 ${deleted.length}개가 삭제되었습니다.`);
      if (failed.length > 0) {
        toast.error(
          `${failed.length}개는 삭제하지 못했습니다: ` +
          failed.map((f) => `${f.tblPhysclNm}(${f.reason})`).join(", ")
        );
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // 체크박스 토글 — 이벤트 버블링으로 행 클릭(상세 이동)이 같이 발동하지 않도록 호출부에서 stopPropagation
  function toggleSelect(tblId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tblId)) next.delete(tblId); else next.add(tblId);
      return next;
    });
  }

  // 검색어 + 인사이트 필터를 동시에 적용
  // 인사이트 필터는 "관점 전환" 이므로 검색과 교집합으로 동작
  const filtered = rows.filter((r) => {
    // 1) 검색어
    const q = search.toLowerCase();
    if (q && !r.tblPhysclNm.toLowerCase().includes(q) && !r.tblLgclNm.toLowerCase().includes(q)) {
      return false;
    }
    // 2) 인사이트 필터
    if (insightFilter === "unused") {
      // 매핑이 전혀 없는 테이블 (IO 분류 기준) — 정리 대상 후보
      return r.ioProfile === "NONE";
    }
    if (insightFilter === "low") {
      // 컬럼은 있는데 활용률이 낮음 (설계 누락 의심)
      // 0 컬럼 테이블은 계산 불능이라 제외
      if (r.columnCount === 0) return false;
      const coverage = (r.usedColCount / r.columnCount) * 100;
      return coverage > 0 && coverage < LOW_COVERAGE_THRESHOLD;
    }
    if (insightFilter === "hot") {
      return r.functionCount >= HOT_FUNCTION_THRESHOLD;
    }
    if (insightFilter === "stale") {
      // 매핑이 있으면서 마지막 저장이 STALE_DAYS 이상 전인 테이블
      // (매핑이 없는 테이블은 "unused" 필터 대상 — 여기선 제외)
      if (!r.lastUsedDt) return false;
      const ageMs = Date.now() - new Date(r.lastUsedDt).getTime();
      return ageMs >= STALE_DAYS * 24 * 60 * 60 * 1000;
    }
    return true;
  });

  function handleCreate() {
    if (!newPhysNm.trim()) { toast.error("물리 테이블명을 입력해 주세요."); return; }
    createMutation.mutate({ tblPhysclNm: newPhysNm, tblLgclNm: newLgclNm, tblDc: newDc });
  }

  // 현재 화면(검색/필터 적용 후)에 보이는 행 기준 전체 선택/해제
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selectedIds.has(r.tblId));
  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (allFilteredSelected) return new Set();
      return new Set(filtered.map((r) => r.tblId));
    });
  }

  // 선택 삭제 버튼 클릭 — 각 테이블의 사용 현황을 미리 조회해 확인창에 표시
  async function openDeleteDialog() {
    const targets = rows.filter((r) => selectedIds.has(r.tblId));
    if (targets.length === 0) return;

    setUsageLoading(true);
    setDeleteDialogOpen(true);
    try {
      const results = await Promise.all(
        targets.map((t) =>
          authFetch<{ data: TableUsageResponse }>(`/api/projects/${projectId}/db-tables/${t.tblId}/usage`)
            .then((r) => r.data.usedBy)
            .catch(() => undefined) // 조회 실패 시 undefined — 다이얼로그가 "확인 불가"로 별도 표시
        )
      );
      setDeleteItems(
        targets.map((t, i) => ({
          tblId:       t.tblId,
          tblPhysclNm: t.tblPhysclNm,
          colCount:    t.columnCount,
          usedBy:      results[i],
        }))
      );
    } finally {
      setUsageLoading(false);
    }
  }

  return (
    <div style={{ padding: 0 }}>

      {/* ── 헤더 ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 24px", position: "sticky", top: 0, zIndex: 10,
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          DB 테이블 관리
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ExcelDownloadButton
            href={`/api/projects/${projectId}/db-tables/export${
              filterAssignedTo === "me" ? "?assignedTo=me" : ""
            }`}
            entityKey="db-tables"
            disabled={!hasLoadedProfile}
          />
          {/* DDL 일괄 등록 — 여러 CREATE TABLE 을 한 번에 파싱·등록 */}
          <button onClick={() => setBulkOpen(true)} style={bulkBtnStyle}>
            + DDL 일괄 등록
          </button>
          <button
            onClick={() => { setCreating(true); setTimeout(() => document.getElementById("new-phys-nm")?.focus(), 50); }}
            style={primaryBtnStyle}
          >
            + 신규 등록
          </button>
        </div>
      </div>

      {/* ── DDL 일괄 등록 모달 ── */}
      {bulkOpen && (
        <DdlBulkImportDialog
          projectId={projectId}
          existingPhysNms={rows.map((r) => r.tblPhysclNm)}
          onClose={() => setBulkOpen(false)}
          // 1건이라도 등록 성공하면 목록 무효화 (모달은 사용자가 결과 확인 후 직접 닫음)
          onCompleted={() => qc.invalidateQueries({ queryKey: ["db-tables", projectId] })}
        />
      )}

      <div style={{ padding: "0 24px 24px" }}>

        {/* ── 검색 + 인사이트 필터 + 건수 + 담당자 필터 ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="테이블명 검색..."
            className="sp-input"
            style={{ width: 280 }}
          />

          {/* 인사이트 필터 칩 — Phase 2
              전체/미사용/저활용/핫 · 검색/담당자 필터와 교집합으로 동작 */}
          <div style={{ display: "inline-flex", gap: 4 }}>
            {([
              { key: "all", label: "전체", tip: "모든 테이블" },
              { key: "unused", label: "미사용", tip: "매핑이 전혀 없는 테이블 (정리 대상 후보)" },
              { key: "low", label: "저활용", tip: `컬럼 활용률 < ${LOW_COVERAGE_THRESHOLD}% (설계 누락 의심)` },
              { key: "hot", label: "핫", tip: `기능 연결 ${HOT_FUNCTION_THRESHOLD}개 이상 (핵심 테이블)` },
              { key: "stale", label: "오래됨", tip: `마지막 매핑 저장이 ${STALE_DAYS}일 이상 지난 테이블 (데드 후보)` },
            ] as const).map((chip) => {
              const active = insightFilter === chip.key;
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setInsightFilter(chip.key)}
                  title={chip.tip}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    border: `1px solid ${active ? "var(--color-primary, #1976d2)" : "var(--color-border)"}`,
                    background: active ? "var(--color-primary, #1976d2)" : "var(--color-bg-card)",
                    color: active ? "#fff" : "var(--color-text-primary)",
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>

          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            총 <strong>{filtered.length}</strong>건
          </span>
          <div style={{ flex: 1 }} />
          {/* 담당자 세그먼트 토글 — GNB 전역 토글과 양방향 바인딩 */}
          <div style={segmentGroupStyle}>
            <button
              type="button"
              onClick={() => setFilterAssignedTo("all")}
              style={segmentBtnStyle(filterAssignedTo === "all")}
            >
              전체
            </button>
            <button
              type="button"
              onClick={() => setFilterAssignedTo("me")}
              style={segmentBtnStyle(filterAssignedTo === "me")}
            >
              내 담당
            </button>
          </div>
        </div>

        {/* ── 테이블 ── */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>

          {/* 헤더 행 */}
          <div style={headerRowStyle}>
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAll}
              style={{ cursor: "pointer" }}
              aria-label="전체 선택"
            />
            <span>물리 테이블명</span>
            <span>논리 테이블명</span>
            <span>설명</span>
            <span>담당자</span>
            <span style={{ textAlign: "center" }}>컬럼 수</span>
            {/* Phase 2 — 컬럼 활용률 */}
            <span style={{ textAlign: "center" }} title="매핑된 컬럼 비율 (usedColCount / columnCount)">
              활용률
            </span>
            {/* 기능 연결수 — 이 테이블을 사용하는 distinct 기능 수 (매핑 인사이트).
                컬럼 폭이 타이트해서 라벨은 "기능"으로 줄이고 전체 의미는 title 툴팁으로 */}
            <span style={{ textAlign: "center" }} title="이 테이블의 컬럼을 사용하는 기능의 수">
              기능
            </span>
            {/* Phase 2 — IO 프로필 아이콘 (조회/저장/혼합) */}
            <span style={{ textAlign: "center" }} title="IO 프로필: 조회 위주(🔍) / 저장 위주(✏️) / 혼합(🔄)">
              IO
            </span>
            <span style={{ textAlign: "center" }}>등록/수정일</span>
          </div>

          {/* 신규 등록 인라인 폼 */}
          {creating && (
            <div style={{ ...dataRowStyle, background: "rgba(103,80,164,0.04)", borderTop: "none" }}>
              {/* 체크박스 자리 — 신규 등록 행은 선택 대상 아님 */}
              <div />
              <input
                id="new-phys-nm"
                value={newPhysNm}
                onChange={(e) => setNewPhysNm(e.target.value)}
                placeholder="tb_example *"
                style={inlineInputStyle}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false); }}
              />
              <input
                value={newLgclNm}
                onChange={(e) => setNewLgclNm(e.target.value)}
                placeholder="예시 테이블"
                style={inlineInputStyle}
              />
              <input
                value={newDc}
                onChange={(e) => setNewDc(e.target.value)}
                placeholder="설명 (선택)"
                style={inlineInputStyle}
              />
              {/* 담당자 / 컬럼수 / 활용률 / 기능 연결 / IO / 등록일 자리 — 인라인 등록 시에는 모두 비움
                  (신규 테이블은 매핑이 없으므로 인사이트 값은 모두 기본값) */}
              <div />
              <div />
              <div />
              <div />
              <div />
              <div />
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  style={saveBtnStyle}
                >
                  {createMutation.isPending ? "저장 중..." : "저장"}
                </button>
                <button onClick={() => setCreating(false)} style={cancelBtnStyle}>
                  취소
                </button>
              </div>
            </div>
          )}

          {/* 데이터 행 */}
          {isLoading ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
              로딩 중...
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
              {search ? "검색 결과가 없습니다." : "등록된 DB 테이블이 없습니다."}
            </div>
          ) : (
            filtered.map((row, idx) => (
              <div
                key={row.tblId}
                onClick={() => router.push(`/projects/${projectId}/db-tables/${row.tblId}`)}
                style={{
                  ...dataRowStyle,
                  borderTop: idx === 0 && !creating ? "none" : "1px solid var(--color-border)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-table-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-bg-card)")}
              >
                {/* 체크박스 — 행 클릭(상세 이동)으로 이벤트가 번지지 않도록 stopPropagation */}
                <input
                  type="checkbox"
                  checked={selectedIds.has(row.tblId)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSelect(row.tblId)}
                  style={{ cursor: "pointer" }}
                  aria-label={`${row.tblPhysclNm} 선택`}
                />

                {/* 물리명 — AI 태스크 페이지 기준에 맞춰 파랑/굵게/monospace 제거,
                    다른 데이터 셀과 동일한 13px primary 일반 텍스트로 통일 */}
                <span style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
                  {row.tblPhysclNm}
                </span>

                {/* 논리명 */}
                <span style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
                  {row.tblLgclNm || <span style={{ color: "var(--color-text-tertiary)" }}>-</span>}
                </span>

                {/* 설명 */}
                <span style={{ fontSize: 13, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.tblDc || <span style={{ color: "var(--color-text-tertiary)" }}>-</span>}
                </span>

                {/* 담당자 — 미지정/퇴장 멤버는 흐린 "-" */}
                <span
                  style={{
                    fontSize: 13,
                    color: row.assignMemberName ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                  title={row.assignMemberName ?? undefined}
                >
                  {row.assignMemberName ?? "-"}
                </span>

                {/* 컬럼 수 */}
                <span style={{ textAlign: "center", fontSize: 13, color: "var(--color-text-primary)" }}>
                  {row.columnCount}
                </span>

                {/* 활용률 — Phase 2. 매핑된 컬럼 / 전체 컬럼 */}
                <span style={{ textAlign: "center" }}>
                  <CoverageText used={row.usedColCount} total={row.columnCount} />
                </span>

                {/* 기능 연결수 (매핑 인사이트) — 0 이면 "아직 참조되지 않음" 으로 회색 처리.
                    많이 연결될수록 핵심 테이블이라는 시각적 힌트를 주기 위해 강조 색상 사용 */}
                <span
                  style={{
                    textAlign: "center",
                    fontSize: 13,
                    fontWeight: row.functionCount > 0 ? 700 : 400,
                    color: row.functionCount > 0
                      ? "var(--color-primary, #1976d2)"
                      : "var(--color-text-tertiary, #bbb)",
                  }}
                  title={
                    row.functionCount === 0
                      ? "이 테이블은 아직 어떤 기능에서도 컬럼 매핑되지 않았습니다."
                      : `${row.functionCount}개 기능이 이 테이블의 컬럼을 사용합니다.`
                  }
                >
                  {row.functionCount}
                </span>

                {/* IO 프로필 — Phase 2 */}
                <span style={{ textAlign: "center" }}>
                  <IoProfileIcon profile={row.ioProfile} />
                </span>

                {/* 등록/수정일 — 수정된 적이 있으면 mdfcnDt, 아니면 creatDt */}
                <span style={{ fontSize: 13, color: "var(--color-text-primary)", textAlign: "center" }}>
                  {(row.mdfcnDt ?? row.creatDt).slice(0, 10)}
                </span>
              </div>
            ))
          )}
        </div>

        {/* 선택 삭제 버튼 — 하나 이상 선택했을 때만 표시, 목록 하단 우측 정렬 */}
        {selectedIds.size > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button
              type="button"
              onClick={openDeleteDialog}
              disabled={usageLoading}
              style={deleteBtnStyle}
            >
              {usageLoading ? "확인 중..." : `선택 삭제 (${selectedIds.size})`}
            </button>
          </div>
        )}
      </div>

      <BulkDeleteTableConfirmDialog
        open={deleteDialogOpen}
        projectId={projectId}
        items={deleteItems}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={() => bulkDeleteMutation.mutate([...selectedIds])}
        busy={bulkDeleteMutation.isPending}
      />
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

// 체크박스 / 물리 / 논리 / 설명 / 담당자 / 컬럼수 / 활용률 / 기능연결 / IO / 등록·수정일
// 설명(1fr)이 남는 공간을 모두 흡수하므로, 뒤 6개 고정폭 컬럼을 실제 표시 내용(숫자·짧은
// 배지·YYYY-MM-DD)에 딱 맞게 타이트하게 줄이면 그만큼이 자동으로 설명 폭에 더해진다(2026-07-28).
// 물리/논리 테이블명: 긴 식별자(tb_ai_design_template 등)와 한글 논리명에 여유를 주기 위해 +20% 확장
const GRID =
  "20px minmax(192px,264px) minmax(144px,216px) 1fr 52px 48px 84px 48px 36px 82px";

const headerRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: GRID,
  padding: "10px 16px", gap: 12,
  background: "var(--color-bg-muted)",
  borderBottom: "1px solid var(--color-border)",
  fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
  alignItems: "center",
};

const dataRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: GRID,
  padding: "11px 16px", gap: 12,
  background: "var(--color-bg-card)",
  alignItems: "center",
  transition: "background 0.1s",
};


const inlineInputStyle: React.CSSProperties = {
  padding: "4px 8px", borderRadius: 5,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 12, outline: "none", width: "100%",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "5px 14px", borderRadius: 6,
  border: "1px solid transparent",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
};

// DDL 일괄 등록 — 주요 액션은 아니지만 구분을 위해 outline 스타일
const bulkBtnStyle: React.CSSProperties = {
  padding: "5px 14px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
};

// 담당자 필터 세그먼트 토글 — 다른 4개 목록과 동일 패턴
const segmentGroupStyle: React.CSSProperties = {
  display: "inline-flex",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  overflow: "hidden",
  background: "var(--color-bg-card)",
};
const segmentBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: "7px 14px",
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  border: "none",
  background: active ? "var(--color-brand-subtle)" : "transparent",
  color: active ? "var(--color-brand)" : "var(--color-text-secondary)",
  cursor: "pointer",
  outline: "none",
});

const saveBtnStyle: React.CSSProperties = {
  padding: "3px 10px", borderRadius: 4,
  border: "none",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 11, fontWeight: 700, cursor: "pointer",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "3px 8px", borderRadius: 4,
  border: "1px solid var(--color-border)",
  background: "transparent", color: "var(--color-text-secondary)",
  fontSize: 11, cursor: "pointer",
};

// 선택 삭제 버튼 — 단건 상세 페이지의 삭제 버튼과 동일한 위험 색상
const deleteBtnStyle: React.CSSProperties = {
  padding: "6px 16px", borderRadius: 6,
  border: "none",
  background: "#fdecea", color: "#e53935",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
};

