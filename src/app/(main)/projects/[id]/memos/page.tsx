"use client";

/**
 * MemoListPage — 메모 목록 (/projects/[id]/memos)
 *
 * 역할:
 *   - 프로젝트 내 메모 목록 조회 (본인 전체 + 팀공개 메모)
 *   - 검색, 공개범위 필터
 *   - URL의 refType/refId 쿼리가 있으면 해당 엔티티 연결 메모만 (엔티티 상세화면
 *     MemoEntryButton의 "창 크게 보기"에서 진입)
 *   - 행 클릭 → 상세 페이지 이동
 */

import { Suspense, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import ExcelDownloadButton from "@/components/common/ExcelDownloadButton";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type MemoRow = {
  memoId:        string;
  subject:       string;
  memoTyCode:    string;
  visbltyCode:   string;
  purposeCode:   string;
  refTyCode:     string | null;
  refId:         string | null;
  refName:       string;
  viewCnt:       number;
  creatMberId:   string;
  creatMberName: string;
  isMine:        boolean;
  canEdit:       boolean;
  creatDt:       string;
};

// ── 상수 ──────────────────────────────────────────────────────────────────────

const REF_TYPE_LABEL: Record<string, string> = {
  REQUIREMENT: "요구사항",
  TASK:        "과업",
  UNIT_WORK:   "단위업무",
  SCREEN:      "화면",
  AREA:        "영역",
  FUNCTION:    "기능",
};

const MEMO_TYPE_LABEL: Record<string, string> = {
  WEB:   "웹",
  EXCEL: "엑셀",
};

const PURPOSE_FILTERS = [
  { value: "",        label: "전체" },
  { value: "GENERAL", label: "메모" },
  { value: "MEETING", label: "회의록" },
];

const PURPOSE_LABEL: Record<string, { label: string; bg: string; fg: string }> = {
  GENERAL: { label: "메모",   bg: "var(--color-bg-muted)",         fg: "var(--color-text-secondary)" },
  MEETING: { label: "회의록", bg: "var(--color-success-subtle)",   fg: "var(--color-success)" },
};

const VISIBILITY_LABEL: Record<string, { label: string; bg: string; fg: string }> = {
  PRIVATE:   { label: "나만보기", bg: "var(--color-bg-muted)",     fg: "var(--color-text-secondary)" },
  TEAM_READ: { label: "전체조회", bg: "var(--color-info-subtle, #e3f2fd)",    fg: "var(--color-info, #1565c0)" },
  TEAM_EDIT: { label: "전체수정", bg: "var(--color-success-subtle, #e8f5e9)", fg: "var(--color-success, #2e7d32)" },
};

const VISIBILITY_FILTERS = [
  { value: "",     label: "전체" },
  { value: "mine", label: "내 메모" },
  { value: "team", label: "팀 공개" },
];

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── 페이지 ────────────────────────────────────────────────────────────────────

export default function MemoListPage() {
  return (
    <Suspense fallback={null}>
      <MemoListInner />
    </Suspense>
  );
}

function MemoListInner() {
  const { id: projectId } = useParams<{ id: string }>();
  const router       = useRouter();
  const searchParams = useSearchParams();

  // 엔티티 상세화면 MemoEntryButton의 "창 크게 보기"에서 진입 시 URL에 실려 옴 — 고정 스코프
  const refType = searchParams.get("refType") ?? undefined;
  const refId   = searchParams.get("refId")   ?? undefined;

  const [search, setSearch]     = useState("");
  const [visFilter, setVisFilter] = useState("");
  // "회의록" 좌측 메뉴에서 진입하면 URL에 purpose=MEETING이 실려 옴 — 그 값을 초기 필터로 사용
  const [purposeFilter, setPurposeFilter] = useState(searchParams.get("purpose") ?? "");

  // ── 데이터 조회 ──
  const queryParams = new URLSearchParams();
  if (search.trim())  queryParams.set("search", search.trim());
  if (visFilter)       queryParams.set("visibility", visFilter);
  if (purposeFilter)   queryParams.set("purpose", purposeFilter);
  if (refType && refId) { queryParams.set("refType", refType); queryParams.set("refId", refId); }
  const qs = queryParams.toString();

  const { data, isLoading } = useQuery({
    queryKey: ["memos", projectId, search, visFilter, purposeFilter, refType, refId],
    queryFn: () =>
      authFetch<{ data: { items: MemoRow[] } }>(
        `/api/projects/${projectId}/memos${qs ? `?${qs}` : ""}`
      ).then((r) => r.data),
  });

  const items = data?.items ?? [];

  if (isLoading) return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;

  return (
    <div style={{ padding: 0 }}>
      {/* ── 헤더 바 ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 24px", position: "sticky", top: 0, zIndex: 10,
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 2 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {purposeFilter === "MEETING" ? "회의록" : "메모"}
          </span>
          {refType && refId && (
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
              <span style={{ padding: "1px 7px", borderRadius: 999, fontWeight: 700, background: "var(--color-accent-subtle, #fde8b8)", color: "var(--color-accent-hover, #d4820a)" }}>
                {REF_TYPE_LABEL[refType] ?? refType} 연결 메모만 보는 중
              </span>
              <button
                onClick={() => router.push(`/projects/${projectId}/memos`)}
                style={{ border: "none", background: "none", cursor: "pointer", color: "var(--color-text-tertiary)", textDecoration: "underline", fontSize: 11.5, padding: 0 }}
              >
                전체 메모 보기
              </button>
            </span>
          )}
        </div>
        <ExcelDownloadButton
          href={`/api/projects/${projectId}/memos/export${qs ? `?${qs}` : ""}`}
          entityKey="memos"
        />
        <button
          onClick={() => {
            const newQs = new URLSearchParams();
            if (refType && refId) { newQs.set("refType", refType); newQs.set("refId", refId); }
            if (purposeFilter)     newQs.set("purpose", purposeFilter);
            const s = newQs.toString();
            router.push(`/projects/${projectId}/memos/new${s ? `?${s}` : ""}`);
          }}
          style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px" }}
        >
          + 새 메모
        </button>
      </div>

      {/* ── 필터 + 건수 ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", padding: "0 24px" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="제목 검색..."
          className="sp-input"
          style={{ width: 220 }}
        />
        <div style={{ display: "flex", gap: 4 }}>
          {PURPOSE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setPurposeFilter(f.value)}
              style={{
                padding: "5px 12px", borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: "1px solid var(--color-border)",
                background: purposeFilter === f.value ? "var(--color-primary, #1976d2)" : "var(--color-bg-card)",
                color: purposeFilter === f.value ? "#fff" : "var(--color-text-secondary)",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {VISIBILITY_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setVisFilter(f.value)}
              style={{
                padding: "5px 12px", borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: "1px solid var(--color-border)",
                background: visFilter === f.value ? "var(--color-primary, #1976d2)" : "var(--color-bg-card)",
                color: visFilter === f.value ? "#fff" : "var(--color-text-secondary)",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 14, color: "var(--color-text-secondary)", marginLeft: "auto" }}>
          총 {items.length}건
        </span>
      </div>

      {/* ── 테이블 — 빈 상태에서도 헤더 표시 (과업 페이지 패턴과 통일) ── */}
      <div style={{ padding: "0 24px 24px" }}>
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
          {/* 헤더 행 */}
          <div style={gridHeaderStyle}>
            <div>제목</div>
            <div>구분</div>
            <div>연결 대상</div>
            <div>방식</div>
            <div>공개 범위</div>
            <div>작성자</div>
            <div style={{ textAlign: "center" }}>조회</div>
            <div>작성일</div>
          </div>

          {items.length === 0 ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
              등록된 메모가 없습니다.
            </div>
          ) : (
            /* 데이터 행 */
            items.map((m, idx) => (
              <div
                key={m.memoId}
                onClick={() => router.push(`/projects/${projectId}/memos/${m.memoId}`)}
                style={{
                  ...gridRowStyle,
                  borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                }}
              >
                {/* 제목 */}
                <div style={{ fontWeight: 500, fontSize: 13, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.subject || "(제목 없음)"}
                </div>

                {/* 구분 */}
                <div style={{ fontSize: 12 }}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                    background: PURPOSE_LABEL[m.purposeCode]?.bg, color: PURPOSE_LABEL[m.purposeCode]?.fg,
                  }}>
                    {PURPOSE_LABEL[m.purposeCode]?.label ?? m.purposeCode}
                  </span>
                </div>

                {/* 연결 대상 */}
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.refTyCode ? (
                    <>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: "#1976d2",
                        background: "#e3f2fd", padding: "1px 5px", borderRadius: 3, marginRight: 4,
                      }}>
                        {REF_TYPE_LABEL[m.refTyCode] ?? m.refTyCode}
                      </span>
                      {m.refName}
                    </>
                  ) : (
                    <span style={{ color: "#ccc" }}>—</span>
                  )}
                </div>

                {/* 작성 방식 */}
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                  {MEMO_TYPE_LABEL[m.memoTyCode] ?? m.memoTyCode}
                </div>

                {/* 공개 범위 */}
                <div style={{ fontSize: 12 }}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                    background: VISIBILITY_LABEL[m.visbltyCode]?.bg, color: VISIBILITY_LABEL[m.visbltyCode]?.fg,
                  }}>
                    {VISIBILITY_LABEL[m.visbltyCode]?.label ?? m.visbltyCode}
                  </span>
                </div>

                {/* 작성자 */}
                <div style={{ fontSize: 13, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.creatMberName}>
                  {m.creatMberName}
                </div>

                {/* 조회수 */}
                <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)" }}>
                  {m.viewCnt}
                </div>

                {/* 작성일 */}
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                  {formatDateShort(m.creatDt)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

// 제목(가변) | 구분 | 연결대상 | 방식 | 공개범위 | 작성자 | 조회 | 작성일
const GRID_TEMPLATE = "1fr 8% 13% 7% 9% 10% 6% 9%";

const gridHeaderStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: GRID_TEMPLATE, gap: 8,
  padding: "10px 16px", background: "var(--color-bg-muted)",
  fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border)", alignItems: "center",
};

const gridRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: GRID_TEMPLATE, gap: 8,
  padding: "12px 16px", alignItems: "center",
  background: "var(--color-bg-card)", cursor: "pointer",
  transition: "background 0.1s",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px", borderRadius: 6, border: "1px solid transparent",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 14, fontWeight: 600, cursor: "pointer",
};

