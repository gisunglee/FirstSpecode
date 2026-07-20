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
 *   - 드롭다운은 document.body 에 포탈로 렌더링 (position: fixed).
 *     컬럼 목록 컨테이너가 모서리를 둥글리려고 overflow:hidden 을 쓰고 있어서,
 *     같은 컨테이너 안에 absolute 로 띄우면 아래쪽 행에서 목록이 잘림 —
 *     화면 하단 공간이 부족하면 트리거 위쪽으로 뒤집어서 띄운다.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type CodeGroupOption = {
  grpCode:   string;
  grpCodeNm: string;
};

type Props = {
  value:    string;
  options:  CodeGroupOption[];
  onChange: (grpCode: string) => void;
};

const DROPDOWN_WIDTH = 280;
const DROPDOWN_MAX_HEIGHT = 240;

export default function CodeGroupSelect({ value, options, onChange }: Props) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number; openUp: boolean } | null>(null);
  const triggerRef   = useRef<HTMLDivElement>(null);
  const dropdownRef  = useRef<HTMLDivElement>(null);

  // 선택된 그룹 (표시 영역에 이름 노출용)
  const selected = options.find((o) => o.grpCode === value);

  // 검색 — grpCode / grpCodeNm 둘 다 매칭
  const filtered = options.filter((o) =>
    !search ||
    o.grpCode.toLowerCase().includes(search.toLowerCase()) ||
    o.grpCodeNm.toLowerCase().includes(search.toLowerCase())
  );

  // 열릴 때 트리거 위치 기준으로 좌표 계산 — 아래쪽 공간이 부족하면 위로 뒤집음
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < DROPDOWN_MAX_HEIGHT && rect.top > spaceBelow;
    setPos({
      // 오른쪽 정렬 기준(right:0)이던 기존 배치를 유지 — 트리거 오른쪽 끝에 드롭다운 오른쪽 끝을 맞춤
      left: rect.right - DROPDOWN_WIDTH,
      top:  openUp ? rect.top : rect.bottom,
      openUp,
    });
  }, [open]);

  // 외부 클릭 감지 — 트리거/드롭다운(포탈) 둘 다 바깥이면 닫기
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // 스크롤/리사이즈되면 좌표가 어긋나므로 닫기 (whole-page 스크롤 방식이라 window 기준)
  useEffect(() => {
    if (!open) return;
    function close() { setOpen(false); }
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div ref={triggerRef} style={{ position: "relative" }}>
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
          fontSize: 13,
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

      {/* 드롭다운 — document.body 에 포탈, 트리거 위치 기준 fixed 좌표 */}
      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          style={{
            ...dropdownStyle,
            top:  pos.openUp ? undefined : pos.top,
            bottom: pos.openUp ? window.innerHeight - pos.top : undefined,
            left: pos.left,
          }}
        >
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
        </div>,
        document.body
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
  fontFamily: "inherit",
  fontWeight: "inherit",
  fontSize: 13,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

// position/top/bottom/left 는 렌더 시점에 좌표를 덮어씀 (fixed 포탈이라 뷰포트 기준)
const dropdownStyle: React.CSSProperties = {
  position: "fixed", zIndex: 1000,
  width: DROPDOWN_WIDTH, maxHeight: DROPDOWN_MAX_HEIGHT,
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
  display: "flex", flexDirection: "column",
};

const searchInputStyle: React.CSSProperties = {
  padding: "6px 10px", border: "none",
  borderBottom: "1px solid var(--color-border)",
  outline: "none",
  fontFamily: "inherit",
  fontWeight: "inherit",
  fontSize: 13,
  background: "var(--color-bg-muted)",
  color: "var(--color-text-primary)",
};
