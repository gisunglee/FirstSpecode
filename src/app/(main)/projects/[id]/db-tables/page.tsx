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
// 매핑 인사이트 Phase 2 — IO 프로필 아이콘, 커버리지 텍스트 배지
import { IoProfileIcon, CoverageText } from "@/components/db-table/TableInsightBadges";
import type { IoProfile } from "@/lib/dbTableUsage";

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

  return (
    <div style={{ padding: 0 }}>

      {/* ── 헤더 ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 24px",
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          DB 테이블 관리
        </div>
        <div style={{ display: "flex", gap: 8 }}>
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
            style={{ ...inputStyle, width: 280 }}
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
            <span>물리 테이블명</span>
            <span>논리 테이블명</span>
            <span>설명</span>
            <span>담당자</span>
            <span style={{ textAlign: "center" }}>컬럼 수</span>
            {/* Phase 2 — 컬럼 활용률 */}
            <span style={{ textAlign: "center" }} title="매핑된 컬럼 비율 (usedColCount / columnCount)">
              활용률
            </span>
            {/* 기능 연결수 — 이 테이블을 사용하는 distinct 기능 수 (매핑 인사이트) */}
            <span style={{ textAlign: "center" }} title="이 테이블의 컬럼을 사용하는 기능의 수">
              기능 연결
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
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover, #f4f6ff)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-bg-card)")}
              >
                {/* 물리명 */}
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-primary, #1976d2)", fontFamily: "monospace" }}>
                  {row.tblPhysclNm}
                </span>

                {/* 논리명 */}
                <span style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
                  {row.tblLgclNm || <span style={{ color: "#bbb" }}>—</span>}
                </span>

                {/* 설명 */}
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.tblDc || <span style={{ color: "#bbb" }}>—</span>}
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
                <span style={{ textAlign: "center", fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
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
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)", textAlign: "center" }}>
                  {(row.mdfcnDt ?? row.creatDt).slice(0, 10)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

// 물리 / 논리 / 설명 / 담당자 / 컬럼수 / 활용률 / 기능연결 / IO / 등록·수정일
// 담당자: 이름 대부분이 짧고(닉네임/실명) ellipsis 처리되므로 80px 로 축소 — 좁은 화면에서 설명 영역 확보
// 등록/수정일: YYYY-MM-DD(10자) 고정폭이라 90px 로 줄이고 center 정렬 — 우측 잔여 공백 제거
const GRID =
  "minmax(160px,220px) minmax(120px,180px) 1fr 80px 72px 100px 80px 48px 90px";

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

const inputStyle: React.CSSProperties = {
  padding: "7px 12px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 13, outline: "none",
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

