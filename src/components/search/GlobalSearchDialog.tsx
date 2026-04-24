"use client";

/**
 * GlobalSearchDialog — 전역 검색 오버레이 (GNB 돋보기 또는 Ctrl+K 로 오픈)
 *
 * 역할:
 *   - 7개 엔티티(과업/요구사항/단위업무/화면/영역/기능/DB 테이블) 이름·DisplayID 검색
 *   - 타입별 그룹으로 결과 표시
 *   - 키보드 네비게이션: ↑↓ 이동, Enter 선택, Esc 닫기
 *   - 클릭 or Enter → router.push 로 상세 페이지 이동, 자동 닫힘
 *
 * 상태 관리:
 *   - 열림/닫힘: useAppStore.globalSearchOpen (GNB 돋보기, useGlobalSearchShortcut 가 토글)
 *   - 입력값/결과는 로컬 state
 *
 * 성능:
 *   - 입력 200ms 디바운스 → 과다 요청 방지
 *   - 2글자 이상에서만 API 호출
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "@/store/appStore";
import { authFetch } from "@/lib/authFetch";
import type { SearchResultItem, SearchResponse } from "@/app/api/projects/[id]/search/route";

// ── 상수 ──────────────────────────────────────────────────────────────────────

// 최소 검색 글자 수 — 서버도 동일 체크. 클라이언트에서 선제 가드로 요청 수 줄임
const MIN_QUERY_LENGTH = 2;
// 입력 후 이 시간만큼 추가 타이핑이 없으면 API 호출
const DEBOUNCE_MS = 200;

// ── 타입/라벨 매핑 ────────────────────────────────────────────────────────────
type ResultType = SearchResultItem["type"];

// 타입별 라벨 (그룹 헤더, 빈 결과 메시지 등에 사용)
const TYPE_LABEL: Record<ResultType, string> = {
  task:     "과업",
  req:      "요구사항",
  unitWork: "단위업무",
  screen:   "화면",
  area:     "영역",
  func:     "기능",
  dbTable:  "DB 테이블",
};

// 타입별 배지 색 — 브레드크럼 칩과 톤 맞춤
const TYPE_BADGE_COLOR: Record<ResultType, { bg: string; fg: string }> = {
  task:     { bg: "#e3f2fd", fg: "#1565c0" },
  req:      { bg: "#eceff1", fg: "#455a64" },
  unitWork: { bg: "#e0f2f1", fg: "#00695c" },
  screen:   { bg: "#e8f5e9", fg: "#2e7d32" },
  area:     { bg: "#fff3e0", fg: "#e65100" },
  func:     { bg: "#f3e5f5", fg: "#6a1b9a" },
  dbTable:  { bg: "#ede7f6", fg: "#4527a0" },
};

// 타입별 상세 페이지 라우팅 규칙 — 프로젝트 경로 prefix 와 결합해 사용
function detailPath(projectId: string, item: SearchResultItem): string {
  switch (item.type) {
    case "task":     return `/projects/${projectId}/tasks/${item.id}`;
    case "req":      return `/projects/${projectId}/requirements/${item.id}`;
    case "unitWork": return `/projects/${projectId}/unit-works/${item.id}`;
    case "screen":   return `/projects/${projectId}/screens/${item.id}`;
    case "area":     return `/projects/${projectId}/areas/${item.id}`;
    case "func":     return `/projects/${projectId}/functions/${item.id}`;
    case "dbTable":  return `/projects/${projectId}/db-tables/${item.id}`;
  }
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function GlobalSearchDialog() {
  const router = useRouter();
  const open           = useAppStore((s) => s.globalSearchOpen);
  const setOpen        = useAppStore((s) => s.setGlobalSearchOpen);
  const currentProjectId = useAppStore((s) => s.currentProjectId);

  const [input, setInput] = useState("");
  // 디바운스된 값 — 실제 쿼리 발사에 사용
  const [debounced, setDebounced] = useState("");
  // 키보드 네비게이션용 하이라이트 인덱스 (0부터)
  const [highlight, setHighlight] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  // ── 다이얼로그 오픈 시 입력 초기화 + 포커스 ────────────────────────────────
  useEffect(() => {
    if (open) {
      setInput("");
      setDebounced("");
      setHighlight(0);
      // 다음 tick 에 포커스 (DOM 렌더 후)
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // ── 입력 디바운스 ─────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebounced(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input]);

  // ── 검색 쿼리 ─────────────────────────────────────────────────────────────
  // 2글자 미만이면 enabled=false 로 API 호출 자체 안 함
  const shouldSearch = open && !!currentProjectId && debounced.length >= MIN_QUERY_LENGTH;
  const { data, isFetching, error } = useQuery<SearchResponse>({
    queryKey: ["global-search", currentProjectId, debounced],
    queryFn:  () =>
      authFetch<{ data: SearchResponse }>(
        `/api/projects/${currentProjectId}/search?q=${encodeURIComponent(debounced)}`
      ).then((r) => r.data),
    enabled:   shouldSearch,
    // 결과는 10초간 유효 — 동일 키워드 재검색 시 즉시 표시
    staleTime: 10_000,
  });

  const results = data?.results ?? [];

  // ── 타입별 그룹화 (렌더용) ────────────────────────────────────────────────
  // 순서는 API 응답 순서 보존 — 과업 → 요구사항 → 단위업무 → 화면 → 영역 → 기능 → DB 테이블
  const grouped = useMemo(() => {
    const groups: { type: ResultType; items: SearchResultItem[] }[] = [];
    const map = new Map<ResultType, SearchResultItem[]>();
    for (const r of results) {
      if (!map.has(r.type)) {
        map.set(r.type, []);
        groups.push({ type: r.type, items: map.get(r.type)! });
      }
      map.get(r.type)!.push(r);
    }
    return groups;
  }, [results]);

  // results 가 바뀌면 하이라이트를 0으로 리셋
  useEffect(() => { setHighlight(0); }, [results.length]);

  // ── 키보드 단축키 (다이얼로그 내부) ───────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, Math.max(0, results.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(0, h - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = results[highlight];
        if (item && currentProjectId) {
          setOpen(false);
          router.push(detailPath(currentProjectId, item));
        }
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, results, highlight, currentProjectId, router, setOpen]);

  // ── 클릭 핸들러 ──────────────────────────────────────────────────────────
  function handleItemClick(item: SearchResultItem) {
    if (!currentProjectId) return;
    setOpen(false);
    router.push(detailPath(currentProjectId, item));
  }

  if (!open) return null;

  // 현재 하이라이트된 아이템의 flat index 로부터 "이 그룹의 몇 번째인지" 계산
  // → CSS is-highlighted 클래스 대상 식별용
  let flatIndex = -1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="전역 검색"
      style={overlayStyle}
      onClick={() => setOpen(false)}
    >
      <div
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 검색 입력 ─────────────────────────────────────────────── */}
        <div style={inputWrapStyle}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
               style={{ color: "#9aa0b8", flexShrink: 0 }}>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="과업·요구사항·단위업무·화면·영역·기능·DB 테이블 검색..."
            style={inputStyle}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            onClick={() => setOpen(false)}
            title="닫기 (Esc)"
            style={closeBtnStyle}
            aria-label="닫기"
          >
            Esc
          </button>
        </div>

        {/* ── 결과 영역 ─────────────────────────────────────────────── */}
        <div style={resultsAreaStyle}>
          {/* 프로젝트 미선택 가드 */}
          {!currentProjectId ? (
            <EmptyState text="먼저 상단에서 프로젝트를 선택해주세요." />
          ) : debounced.length < MIN_QUERY_LENGTH ? (
            <EmptyState text={`검색어를 ${MIN_QUERY_LENGTH}글자 이상 입력해주세요.`} />
          ) : isFetching ? (
            <EmptyState text="검색 중..." />
          ) : error ? (
            <EmptyState text="검색 중 오류가 발생했습니다." />
          ) : results.length === 0 ? (
            <EmptyState text={`"${debounced}"에 대한 결과가 없습니다.`} />
          ) : (
            grouped.map((g) => (
              <div key={g.type} style={{ marginBottom: 8 }}>
                <div style={groupHeaderStyle}>
                  {TYPE_LABEL[g.type]}
                  <span style={{ marginLeft: 6, color: "#9aa0b8", fontWeight: 400 }}>
                    ({g.items.length})
                  </span>
                </div>
                {g.items.map((item) => {
                  flatIndex++;
                  const isHighlighted = flatIndex === highlight;
                  return (
                    <SearchRow
                      key={`${item.type}:${item.id}`}
                      item={item}
                      isHighlighted={isHighlighted}
                      onClick={() => handleItemClick(item)}
                      onMouseEnter={() => setHighlight(flatIndex)}
                    />
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* ── 푸터: 키 힌트 ─────────────────────────────────────────── */}
        <div style={footerStyle}>
          <Hint kbd="↑↓" text="이동" />
          <Hint kbd="Enter" text="열기" />
          <Hint kbd="Esc" text="닫기" />
        </div>
      </div>
    </div>
  );
}

// ── 결과 행 ──────────────────────────────────────────────────────────────────
function SearchRow({
  item,
  isHighlighted,
  onClick,
  onMouseEnter,
}: {
  item:          SearchResultItem;
  isHighlighted: boolean;
  onClick:       () => void;
  onMouseEnter:  () => void;
}) {
  const color = TYPE_BADGE_COLOR[item.type];

  // DB 테이블은 displayId 가 없고 물리명+논리명 둘 다 표시
  const isDbTable = item.type === "dbTable";

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      style={{
        ...rowStyle,
        background: isHighlighted ? "#eef0fb" : "transparent",
      }}
    >
      <span style={{ ...badgeStyle, background: color.bg, color: color.fg }}>
        {isDbTable ? "DB" : (item as { displayId: string }).displayId}
      </span>
      {isDbTable ? (
        <>
          <span style={{
            fontFamily: "'JetBrains Mono','Consolas',monospace",
            fontWeight: 600,
            color: "#1e2135",
          }}>
            {item.physclNm}
          </span>
          {item.lgclNm && (
            <span style={{ color: "#5b637a", fontSize: 12 }}>
              {item.lgclNm}
            </span>
          )}
        </>
      ) : (
        <span style={{ color: "#1e2135", flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
          {item.name || <span style={{ color: "#9aa0b8" }}>(이름 없음)</span>}
        </span>
      )}
    </button>
  );
}

// ── 빈 상태 ──────────────────────────────────────────────────────────────────
function EmptyState({ text }: { text: string }) {
  return (
    <div style={{
      padding: "48px 20px",
      textAlign: "center",
      color: "#9aa0b8",
      fontSize: 13,
    }}>
      {text}
    </div>
  );
}

// ── 키보드 힌트 ──────────────────────────────────────────────────────────────
function Hint({ kbd, text }: { kbd: string; text: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={kbdStyle}>{kbd}</span>
      <span style={{ color: "#9aa0b8" }}>{text}</span>
    </span>
  );
}

// ── 스타일 ──────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset:    0,
  background: "rgba(0, 0, 0, 0.6)",
  zIndex:   3000,
  display:  "flex",
  justifyContent: "center",
  alignItems: "flex-start",
  paddingTop: "12vh",
};

const dialogStyle: React.CSSProperties = {
  width:         "min(720px, 92vw)",
  maxHeight:     "min(72vh, 720px)",
  background:    "#ffffff",
  borderRadius:  12,
  boxShadow:     "0 20px 60px rgba(0,0,0,0.35)",
  display:       "flex",
  flexDirection: "column",
  overflow:      "hidden",
};

const inputWrapStyle: React.CSSProperties = {
  display:      "flex",
  alignItems:   "center",
  gap:          10,
  padding:      "14px 18px",
  borderBottom: "1px solid #eceff4",
  flexShrink:   0,
};

const inputStyle: React.CSSProperties = {
  flex:       1,
  border:     "none",
  outline:    "none",
  fontSize:   18,
  color:      "#1e2135",
  background: "transparent",
  fontFamily: "inherit",
};

const closeBtnStyle: React.CSSProperties = {
  padding:      "3px 8px",
  fontSize:     11,
  fontWeight:   600,
  color:        "#5b637a",
  background:   "#f1f3f9",
  border:       "1px solid #d4d8ec",
  borderRadius: 4,
  cursor:       "pointer",
  flexShrink:   0,
};

const resultsAreaStyle: React.CSSProperties = {
  flex:      1,
  overflowY: "auto",
  padding:   "8px 0",
};

const groupHeaderStyle: React.CSSProperties = {
  padding:      "8px 18px 4px",
  fontSize:     11,
  fontWeight:   700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color:        "#5b637a",
};

const rowStyle: React.CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        10,
  width:      "100%",
  padding:    "8px 18px",
  border:     "none",
  background: "transparent",
  cursor:     "pointer",
  textAlign:  "left",
  fontSize:   14,
  fontFamily: "inherit",
};

const badgeStyle: React.CSSProperties = {
  fontSize:     10,
  fontWeight:   700,
  padding:      "2px 7px",
  borderRadius: 3,
  fontFamily:   "'JetBrains Mono','Consolas',monospace",
  letterSpacing: "0.02em",
  flexShrink:   0,
  minWidth:     62,
  textAlign:    "center",
};

const footerStyle: React.CSSProperties = {
  display:        "flex",
  alignItems:     "center",
  gap:            16,
  padding:        "8px 18px",
  borderTop:      "1px solid #eceff4",
  background:     "#fafbff",
  fontSize:       11,
  color:          "#5b637a",
  flexShrink:     0,
};

const kbdStyle: React.CSSProperties = {
  display:      "inline-block",
  padding:      "1px 6px",
  fontSize:     10,
  fontWeight:   600,
  fontFamily:   "'JetBrains Mono','Consolas',monospace",
  color:        "#5b637a",
  background:   "#ffffff",
  border:       "1px solid #d4d8ec",
  borderRadius: 3,
  lineHeight:   1.4,
};
