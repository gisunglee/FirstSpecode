"use client";

/**
 * TestSpecListPage — 테스트 명세서 목록 (단위 / 통합 통합 화면)
 *
 * 경로:
 *   - LNB 진입: /projects/[id]/test-specs?kind=UNIT
 *               /projects/[id]/test-specs?kind=INTEGRATION
 *   - URL 쿼리 ?kind=UNIT|INTEGRATION 이 활성 탭 결정 (없으면 UNIT 기본)
 *
 * 기능:
 *   - 종류 탭 (단위 / 통합) — 메뉴 클릭 시 자동 선택
 *   - 검색 (명세서명)
 *   - 상태 필터 (전체 / DRAFT / IN_PROGRESS / PASSED / FAILED)
 *   - 행 클릭 → 상세 페이지
 *   - [+ 새 명세서] 버튼 — 현재 탭 종류로 신규 페이지 이동
 */

import { Suspense, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { SelectChevron } from "@/components/ui/SelectChevron";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type SpecListItem = {
  testSpecId:    string;
  displayId:     string;
  testKindCode:  "UNIT" | "INTEGRATION";
  testSpecNm:    string;
  testSpecDc:    string | null;
  sttusCode:     string;
  asignMemberId: string | null;
  unitWorks:     { unitWorkId: string; displayId: string | null; name: string | null }[];
  caseCount:     number;
  roundCount:    number;
  createdAt:     string;
  updatedAt:     string | null;
};

// ── 상수 ─────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  DRAFT:       "작성중",
  IN_PROGRESS: "진행중",
  PASSED:      "합격",
  FAILED:      "불합격",
};

const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  DRAFT:       { bg: "#f5f5f5", fg: "#616161" },
  IN_PROGRESS: { bg: "#e3f2fd", fg: "#1565c0" },
  PASSED:      { bg: "#e8f5e9", fg: "#2e7d32" },
  FAILED:      { bg: "#ffebee", fg: "#c62828" },
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function TestSpecListPage() {
  return <Suspense fallback={null}><TestSpecListInner /></Suspense>;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

function TestSpecListInner() {
  const params       = useParams<{ id: string }>();
  const router       = useRouter();
  const searchParams = useSearchParams();
  const projectId    = params.id;

  // URL ?kind=UNIT|INTEGRATION — 없으면 UNIT 기본
  const kindParam = searchParams.get("kind");
  const kind: "UNIT" | "INTEGRATION" = kindParam === "INTEGRATION" ? "INTEGRATION" : "UNIT";

  // ── 로컬 필터 (검색·상태) ──────────────────────────────────────────────────
  const [search, setSearch]     = useState("");
  const [sttusFilter, setSttus] = useState<string>("ALL");

  // ── 목록 조회 ──────────────────────────────────────────────────────────────
  const { data: items = [], isLoading } = useQuery<SpecListItem[]>({
    queryKey: ["test-specs", projectId, kind],
    queryFn:  async () => {
      const res = await authFetch<{ data: { items: SpecListItem[] } }>(
        `/api/projects/${projectId}/test-specs?kind=${kind}`
      );
      return res.data.items;
    },
  });

  // 클라이언트 필터 (DB 부하 없도록 — 향후 row 많아지면 서버 쿼리로 이전)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((s) => {
      if (sttusFilter !== "ALL" && s.sttusCode !== sttusFilter) return false;
      if (!q) return true;
      return (
        s.testSpecNm.toLowerCase().includes(q) ||
        s.displayId.toLowerCase().includes(q) ||
        s.unitWorks.some((u) => (u.name ?? "").toLowerCase().includes(q))
      );
    });
  }, [items, search, sttusFilter]);

  // ── 탭 변경 ────────────────────────────────────────────────────────────────
  function switchKind(next: "UNIT" | "INTEGRATION") {
    if (next === kind) return;
    router.push(`/projects/${projectId}/test-specs?kind=${next}`);
  }

  function goNew() {
    router.push(`/projects/${projectId}/test-specs/new?kind=${kind}`);
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 24px", position: "sticky", top: 0, zIndex: 10, background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)", marginBottom: 16,
      }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          {kind === "UNIT" ? "단위 테스트 명세서" : "통합 테스트 명세서"}
        </span>
        <button onClick={goNew} style={primaryBtnStyle}>+ 새 명세서</button>
      </div>

      <div style={{ padding: "0 24px 24px", maxWidth: 1280 }}>
        {/* 종류 탭 + 필터 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div style={tabsWrapStyle}>
            <button onClick={() => switchKind("UNIT")} style={tabStyle(kind === "UNIT")}>
              단위 테스트
            </button>
            <button onClick={() => switchKind("INTEGRATION")} style={tabStyle(kind === "INTEGRATION")}>
              통합 테스트
            </button>
          </div>

          <span style={{ flex: 1 }} />

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="명세서명·표시ID·단위업무 검색"
            className="sp-input"
            style={{ width: 260, fontSize: 13 }}
          />
          <div className="sp-select-wrap" style={{ width: 120 }}>
            <select
              value={sttusFilter}
              onChange={(e) => setSttus(e.target.value)}
              className="sp-input"
              style={{ fontSize: 13 }}
            >
              <option value="ALL">전체 상태</option>
              {Object.entries(STATUS_LABEL).map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
            <span className="sp-select-arrow"><SelectChevron /></span>
          </div>
        </div>

        {/* 총 건수 */}
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 10 }}>
          {isLoading ? "로딩 중..." : `총 ${filtered.length}건${items.length !== filtered.length ? ` / 전체 ${items.length}건` : ""}`}
        </div>

        {/* 테이블 */}
        <div style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg, 8px)",
          overflow: "hidden",
        }}>
          <div style={{ ...gridStyle, padding: "10px 16px", background: "var(--color-bg-muted)", borderBottom: "1px solid var(--color-border)", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>
            <span>표시 ID</span>
            <span>명세서명</span>
            <span>연결 단위업무</span>
            <span style={{ textAlign: "center" }}>케이스</span>
            <span style={{ textAlign: "center" }}>회차</span>
            <span style={{ textAlign: "center" }}>상태</span>
            <span>수정일</span>
          </div>

          {isLoading ? (
            <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--color-text-tertiary)" }}>
              로딩 중...
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "60px 16px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 13 }}>
              {items.length === 0
                ? "아직 등록된 명세서가 없습니다. 우상단 [+ 새 명세서] 버튼으로 시작하세요."
                : "검색·필터 조건에 맞는 명세서가 없습니다."}
            </div>
          ) : (
            filtered.map((s, i) => {
              const color = STATUS_COLOR[s.sttusCode] ?? STATUS_COLOR.DRAFT;
              return (
                <div
                  key={s.testSpecId}
                  onClick={() => router.push(`/projects/${projectId}/test-specs/${s.testSpecId}`)}
                  style={{
                    ...gridStyle, padding: "12px 16px",
                    borderBottom: i < filtered.length - 1 ? "1px solid var(--color-border)" : "none",
                    cursor: "pointer",
                    transition: "background 0.12s",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--color-bg-muted)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = ""}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-brand, #1976d2)" }}>{s.displayId}</span>
                  <span style={{ fontSize: 13, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.testSpecNm}</span>
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.unitWorks.length === 0
                      ? <em style={{ color: "var(--color-text-tertiary)" }}>(연결 없음)</em>
                      : s.unitWorks.map((u) => `${u.displayId ?? "?"} ${u.name ?? ""}`.trim()).join(", ")}
                  </span>
                  <span style={{ fontSize: 12, textAlign: "center", color: "var(--color-text-secondary)" }}>{s.caseCount}</span>
                  <span style={{ fontSize: 12, textAlign: "center", color: "var(--color-text-secondary)" }}>{s.roundCount}</span>
                  <span style={{ textAlign: "center" }}>
                    <span style={{
                      display: "inline-block", padding: "2px 8px", borderRadius: 10,
                      background: color.bg, color: color.fg,
                      fontSize: 11, fontWeight: 700,
                    }}>{STATUS_LABEL[s.sttusCode] ?? s.sttusCode}</span>
                  </span>
                  <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
                    {(s.updatedAt ?? s.createdAt).slice(0, 10)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── 스타일 ───────────────────────────────────────────────────────────────────

const gridStyle: React.CSSProperties = {
  display: "grid",
  // 표시ID / 명세서명 / 단위업무 / 케이스 / 회차 / 상태 / 수정일
  gridTemplateColumns: "100px 1.6fr 2fr 70px 70px 80px 110px",
  gap: 12,
  alignItems: "center",
};

const tabsWrapStyle: React.CSSProperties = {
  display: "flex", gap: 2,
  background: "var(--color-bg-muted)",
  padding: 3, borderRadius: 7,
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: "5px 16px", borderRadius: 5, border: "none",
    background: active ? "var(--color-bg-card)" : "transparent",
    color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
    fontSize: 13, fontWeight: active ? 700 : 500, cursor: "pointer",
    boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
  };
}

const primaryBtnStyle: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 6,
  border: "1px solid transparent",
  background: "var(--color-primary, #1976d2)",
  color: "#fff",
  fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
};
