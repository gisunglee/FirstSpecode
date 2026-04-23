"use client";

/**
 * CodeGroupSelect — DB 컬럼의 "참조 공통코드 그룹" 검색 드롭다운
 *
 * 역할:
 *   - 공통코드 그룹 목록을 받아서 검색 + 선택
 *   - 선택된 값은 grp_code 문자열로 상위에 전달 (onChange)
 *   - 클리어(✕) 버튼으로 빈 값 초기화
 *
 * Props:
 *   - value:   현재 선택된 grp_code ("" = 미선택)
 *   - options: 선택 가능한 그룹 목록 [{ grpCode, grpCodeNm }]
 *   - onChange: 선택 변경 콜백
 *
 * 특이사항:
 *   - 컬럼 행의 160px 슬롯 안에 들어가도록 compact 모드 기본
 *   - 외부 클릭 감지로 닫기 (useEffect 수동 리스너)
 *   - 페이지 파일에서 분리 — 기존 page.tsx 가 1150줄 넘어 책임 분리 목적
 */

import { useEffect, useRef, useState } from "react";

export type CodeGroupOption = {
  grpCode:   string;
  grpCodeNm: string;
};

type Props = {
  value:    string;
  options:  CodeGroupOption[];
  onChange: (grpCode: string) => void;
};

export default function CodeGroupSelect({ value, options, onChange }: Props) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // 선택된 그룹 (표시 영역에 이름 노출용)
  const selected = options.find((o) => o.grpCode === value);

  // 검색 — grpCode / grpCodeNm 둘 다 매칭
  const filtered = options.filter((o) =>
    !search ||
    o.grpCode.toLowerCase().includes(search.toLowerCase()) ||
    o.grpCodeNm.toLowerCase().includes(search.toLowerCase())
  );

  // 외부 클릭 감지 — 드롭다운 자동 닫기
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* 표시 영역 — 클릭하면 드롭다운 토글 */}
      <div
        onClick={() => { setOpen(!open); setSearch(""); }}
        style={{
          ...triggerStyle,
          cursor:     "pointer",
          display:    "flex",
          alignItems: "center",
          gap:        4,
          overflow:   "hidden",
          whiteSpace: "nowrap",
          minHeight:  28,
        }}
      >
        <span style={{
          flex: 1,
          overflow: "hidden", textOverflow: "ellipsis",
          color:   selected ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
          fontSize: 12,
        }}>
          {selected ? selected.grpCodeNm : ""}
        </span>
        {/* 클리어 버튼 */}
        {value && (
          <span
            onClick={(e) => { e.stopPropagation(); onChange(""); }}
            style={{ color: "var(--color-text-secondary)", fontSize: 12, cursor: "pointer", flexShrink: 0 }}
          >
            ✕
          </span>
        )}
      </div>

      {/* 드롭다운 */}
      {open && (
        <div style={dropdownStyle}>
          {/* 검색 입력 */}
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="코드 그룹 검색..."
            style={searchInputStyle}
          />
          {/* 목록 */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "12px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 11 }}>
                검색 결과 없음
              </div>
            ) : (
              filtered.map((o) => (
                <div
                  key={o.grpCode}
                  onClick={() => { onChange(o.grpCode); setOpen(false); }}
                  style={{
                    padding: "5px 10px", cursor: "pointer", fontSize: 12,
                    // 선택된 항목 강조 — brand-subtle 로 SSOT 유지
                    background:   o.grpCode === value ? "var(--color-brand-subtle)" : "transparent",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-bg-hover, #f5f7ff)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = o.grpCode === value ? "var(--color-brand-subtle)" : "transparent"; }}
                >
                  <span style={{
                    fontWeight: 600,
                    color:   "var(--color-brand)",
                    marginRight: 6,
                    fontFamily: "'JetBrains Mono','Consolas',monospace",
                    fontSize: 11,
                  }}>
                    {o.grpCode}
                  </span>
                  <span style={{ color: "var(--color-text-primary)" }}>{o.grpCodeNm}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 스타일 (컴포넌트 내부 사용 전용) ─────────────────────────────────────────

// 표시 영역 — 다른 컬럼 input 과 높이/패딩 정합성 유지
const triggerStyle: React.CSSProperties = {
  padding: "5px 8px",
  borderRadius: 5,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 12,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const dropdownStyle: React.CSSProperties = {
  position: "absolute", top: "100%", right: 0, zIndex: 100,
  width: 280, maxHeight: 240,
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
  display: "flex", flexDirection: "column",
};

const searchInputStyle: React.CSSProperties = {
  padding: "6px 10px", border: "none",
  borderBottom: "1px solid var(--color-border)",
  outline: "none", fontSize: 12,
  background: "var(--color-bg-muted)",
  color: "var(--color-text-primary)",
};
