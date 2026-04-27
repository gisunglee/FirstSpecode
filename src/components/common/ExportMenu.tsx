"use client";

/**
 * ExportMenu — 산출물 출력 액션 그룹 드롭다운
 *
 * 역할:
 *   - 헤더에 흩어져 있던 [Word 출력] · [발행] · (이력 보기) 액션을 하나의 드롭다운으로 묶는다.
 *   - 산출물 종류 무관 — 호출부에서 핸들러만 주입.
 *   - 추후 PDF 출력 추가 시 메뉴 항목 1줄 추가로 확장 가능.
 *
 * 메뉴 구성 (조건부):
 *   - Word 출력         (항상)
 *   - 발행하기           (canRelease 일 때만)
 *   - ─────────────       (구분선, canRelease 일 때만)
 *   - 발행 이력 보기      (항상)
 *
 * 디자인 참고:
 *   src/components/layout/GNB.tsx 의 프로젝트 셀렉터/프로필 메뉴 패턴 그대로 차용.
 *   외부 클릭 시 닫기 + useRef + 절대 위치 메뉴.
 *
 * 사용 예:
 *   <ExportMenu
 *     canRelease={canExport}
 *     isExporting={isExporting}
 *     onExportDocx={handleExportDocx}
 *     onRelease={() => setIsReleaseOpen(true)}
 *     onViewHistory={() => setIsHistoryOpen(true)}
 *   />
 */

import { useEffect, useRef, useState } from "react";

type Props = {
  /** Word 출력 진행 중 — 트리거 버튼 라벨/상태 변경 */
  isExporting: boolean;
  /** 발행 권한 — false 면 "발행하기" 메뉴 항목 숨김 */
  canRelease:  boolean;
  /** Word 출력 핸들러 */
  onExportDocx:  () => void;
  /** 발행 모달 열기 핸들러 (canRelease=true 일 때만 호출됨) */
  onRelease:     () => void;
  /** 발행 이력 모달 열기 핸들러 */
  onViewHistory: () => void;
};

export default function ExportMenu({
  isExporting,
  canRelease,
  onExportDocx,
  onRelease,
  onViewHistory,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 메뉴 닫기 — GNB 드롭다운 패턴 그대로
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  // 메뉴 항목 클릭 헬퍼 — 핸들러 호출 후 메뉴 닫기
  function pick(handler: () => void) {
    return () => {
      setOpen(false);
      handler();
    };
  }

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={isExporting}
        style={{
          ...triggerStyle,
          opacity: isExporting ? 0.6 : 1,
          cursor: isExporting ? "wait" : "pointer",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {isExporting ? "출력 중..." : "출력"}
        <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>

      {open && (
        <div role="menu" style={menuStyle}>
          <button role="menuitem" onClick={pick(onExportDocx)} style={itemStyle}>
            Word 출력
          </button>

          {canRelease && (
            <>
              <button role="menuitem" onClick={pick(onRelease)} style={itemStyle}>
                발행하기
              </button>
              <div style={dividerStyle} />
            </>
          )}

          <button role="menuitem" onClick={pick(onViewHistory)} style={itemStyle}>
            발행 이력 보기
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 스타일 ─────────────────────────────────────────────────────────────
// 헤더 다른 버튼들과 같은 톤 (fontSize 12, padding 5px 14px) 으로 시각 일관성 유지.
// inline-flex + justify-content: center 로 텍스트와 ▾ 를 묶어서 가운데 정렬
// (예전엔 flex 시작점에 몰려 minWidth 우측 공백이 비어 보였음).
const triggerStyle: React.CSSProperties = {
  display:        "inline-flex",
  alignItems:     "center",
  justifyContent: "center",
  gap:            6,
  padding:        "5px 14px",
  minWidth:       70,
  fontSize:       12,
  borderRadius:   6,
  border:         "1px solid var(--color-border)",
  background:     "var(--color-bg-card)",
  color:          "var(--color-text-primary)",
  fontWeight:     500,
};

const menuStyle: React.CSSProperties = {
  position:     "absolute",
  top:          "calc(100% + 4px)",
  right:        0,                     // 헤더 우측 정렬 — 메뉴는 트리거 우측 끝에 맞춤
  minWidth:     180,
  background:   "var(--color-bg-card)",
  border:       "1px solid var(--color-border)",
  borderRadius: 6,
  boxShadow:    "var(--shadow-md, 0 4px 12px rgba(0,0,0,0.15))",
  padding:      4,
  zIndex:       50,
};

const itemStyle: React.CSSProperties = {
  display:      "block",
  width:        "100%",
  padding:      "8px 12px",
  fontSize:     13,
  textAlign:    "left",
  background:   "transparent",
  border:       "none",
  borderRadius: 4,
  color:        "var(--color-text-primary)",
  cursor:       "pointer",
};

const dividerStyle: React.CSSProperties = {
  height:       1,
  background:   "var(--color-border)",
  margin:       "4px 6px",
};
