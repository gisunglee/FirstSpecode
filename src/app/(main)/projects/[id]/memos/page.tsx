"use client";

/**
 * MemoListPage — 메모 목록 (/projects/[id]/memos)
 *
 * 역할:
 *   - 프로젝트 내 메모 목록 조회 (본인 + 공유 메모)
 *   - 검색, 공유 필터
 *   - 행 클릭 → 상세 페이지 이동
 */

import { Suspense, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type MemoRow = {
  memoId:        string;
  subject:       string;
  shareYn:       string;
  refTyCode:     string | null;
  refId:         string | null;
  refName:       string;
  viewCnt:       number;
  creatMberId:   string;
  creatMberName: string;
  isMine:        boolean;
  creatDt:       string;
};

// ── 상수 ──────────────────────────────────────────────────────────────────────

const REF_TYPE_LABEL: Record<string, string> = {
  FUNCTION:  "기능",
  AREA:      "영역",
  SCREEN:    "화면",
  UNIT_WORK: "단위업무",
};

const SHARE_FILTERS = [
  { value: "",       label: "전체" },
  { value: "mine",   label: "내 메모" },
  { value: "shared", label: "공유 메모" },
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
  const router = useRouter();

  const [search, setSearch]           = useState("");
  const [shareFilter, setShareFilter] = useState("");

  // ── 데이터 조회 ──
  const queryParams = new URLSearchParams();
  if (search.trim())  queryParams.set("search", search.trim());
  if (shareFilter)    queryParams.set("share", shareFilter);
  const qs = queryParams.toString();

  const { data, isLoading } = useQuery({
    queryKey: ["memos", projectId, search, shareFilter],
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
        padding: "10px 24px",
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)", flex: 1 }}>
          메모
        </div>
        <button
          onClick={() => router.push(`/projects/${projectId}/memos/new`)}
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
          style={{ ...inputStyle, width: 220 }}
        />
        <div style={{ display: "flex", gap: 4 }}>
          {SHARE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setShareFilter(f.value)}
              style={{
                padding: "5px 12px", borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: "1px solid var(--color-border)",
                background: shareFilter === f.value ? "var(--color-primary, #1976d2)" : "var(--color-bg-card)",
                color: shareFilter === f.value ? "#fff" : "var(--color-text-secondary)",
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
            <div>연결 대상</div>
            <div>공유</div>
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

                {/* 공유 */}
                <div style={{ fontSize: 12 }}>
                  {m.shareYn === "Y" ? (
                    <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: "#e8f5e9", color: "#2e7d32" }}>공유</span>
                  ) : (
                    <span style={{ color: "#ccc" }}>비공개</span>
                  )}
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

// 제목(가변) | 연결대상 | 공유 | 작성자 | 조회 | 작성일
const GRID_TEMPLATE = "1fr 15% 7% 10% 6% 9%";

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

const inputStyle: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 6,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-primary)", fontSize: 13, outline: "none",
  boxSizing: "border-box",
};
