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
 *   - <문서명> ⬇          (항상, 문서명은 docName prop / 다운로드는 아이콘으로 표시)
 *   - 🗄 발행하기 (?)      (canRelease 일 때만 / 도장 아이콘 + releaseHelp 주면 ? 도움말)
 *   - ─────────────       (구분선, canRelease 일 때만)
 *   - 발행 이력 보기      (항상)
 *
 * 디자인 참고:
 *   src/components/layout/GNB.tsx 의 프로젝트 셀렉터/프로필 메뉴 패턴 그대로 차용.
 *   외부 클릭 시 닫기 + useRef + 절대 위치 메뉴.
 *
 * 사용 예:
 *   <ExportMenu
 *     docName="요구사항 명세서"
 *     releaseHelp="요구사항을 발행하면 …"
 *     canRelease={canExport}
 *     isExporting={isExporting}
 *     onExportDocx={handleExportDocx}
 *     onRelease={() => setIsReleaseOpen(true)}
 *     onViewHistory={() => setIsHistoryOpen(true)}
 *   />
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

// ── 인라인 아이콘 (lucide 계열, currentColor — 메뉴 텍스트 색 자동 추종) ──────────
function IconSvg({ children, size = 15 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
      aria-hidden
    >
      {children}
    </svg>
  );
}

// 다운로드 — 아래 화살표 + 받침. "내려받기" 의미.
function DownloadIcon() {
  return (
    <IconSvg>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </IconSvg>
  );
}

// 도장(stamp) — 발행(확정 기록) 의미. lucide "stamp" 형태.
function StampIcon() {
  return (
    <IconSvg>
      <path d="M5 22h14" />
      <path d="M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77Z" />
      <path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-3-3 3 3 0 0 0-3 3c0 2 1 2 1 3.5V13" />
    </IconSvg>
  );
}

type Props = {
  /** 산출물명 — 트리거 버튼 라벨 + "<문서명> 다운로드" 메뉴 항목에 사용 (예: "요구사항 명세서"). 미지정 시 "출력". */
  docName?: string;
  /** 발행하기 옆 도움말(?) 내용. 주면 ? 아이콘 노출 + 클릭 시 설명 펼침. 없으면 ? 미표시. */
  releaseHelp?: string;
  /** 다운로드 진행 중 — 트리거 버튼 라벨/상태 변경 */
  isExporting: boolean;
  /** 발행 권한 — false 면 "발행하기" 메뉴 항목 숨김 */
  canRelease:  boolean;
  /** 다운로드 핸들러 */
  onExportDocx:  () => void;
  /** 발행 모달 열기 핸들러 (canRelease=true 일 때만 호출됨) */
  onRelease:     () => void;
  /** 발행 이력 모달 열기 핸들러 */
  onViewHistory: () => void;
};

export default function ExportMenu({
  docName,
  releaseHelp,
  isExporting,
  canRelease,
  onExportDocx,
  onRelease,
  onViewHistory,
}: Props) {
  const [open, setOpen] = useState(false);
  // 발행하기 옆 ? 도움말 펼침 상태 — 메뉴 안에서만 토글, 메뉴는 닫지 않음
  const [helpOpen, setHelpOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // 트리거/메뉴 라벨 — docName 이 있으면 산출물명 기준, 없으면 기존 일반 문구로 폴백
  // 다운로드 항목은 "<문서명>" + 다운로드 아이콘 형태 (텍스트 "다운로드" 대신 아이콘 사용)
  const triggerLabel = docName ?? "출력";
  const exportName = docName ?? "Word 출력";

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
        onClick={() => { setOpen((o) => !o); setHelpOpen(false); }}
        disabled={isExporting}
        style={{
          ...triggerStyle,
          opacity: isExporting ? 0.6 : 1,
          cursor: isExporting ? "wait" : "pointer",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {isExporting ? "다운로드 중..." : triggerLabel}
        <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>

      {open && (
        <div role="menu" style={menuStyle}>
          {/* 다운로드 — "<문서명>" 뒤에 다운로드 아이콘 (텍스트 "다운로드" 대체) */}
          <button role="menuitem" onClick={pick(onExportDocx)} style={iconItemStyle}>
            <span style={{ flex: 1 }}>{exportName}</span>
            <DownloadIcon />
          </button>

          {canRelease && (
            <>
              {/* 발행하기 + ? 도움말 — ? 는 메뉴를 닫지 않고 설명만 토글 (발행 모달은 발행하기로만) */}
              <div style={releaseRowStyle}>
                <button role="menuitem" onClick={pick(onRelease)} style={{ ...iconItemStyle, flex: 1 }}>
                  <StampIcon />
                  <span style={{ flex: 1 }}>발행하기</span>
                </button>
                {releaseHelp && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setHelpOpen((h) => !h); }}
                    style={helpButtonStyle}
                    aria-label="발행 안내"
                    aria-expanded={helpOpen}
                  >
                    ?
                  </button>
                )}
              </div>

              {releaseHelp && helpOpen && (
                <div style={helpTextStyle}>{releaseHelp}</div>
              )}

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
  whiteSpace:     "nowrap",           // "요구사항 명세서" 처럼 긴 라벨도 한 줄 유지
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
  minWidth:     220,                   // "요구사항 명세서 다운로드" 가 줄바꿈 없이 들어가도록 확장
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
  whiteSpace:   "nowrap",              // 긴 다운로드 라벨이 두 줄로 깨지지 않게
  background:   "transparent",
  border:       "none",
  borderRadius: 4,
  color:        "var(--color-text-primary)",
  cursor:       "pointer",
};

// 아이콘 + 라벨을 한 줄에 배치하는 메뉴 항목 (다운로드/발행하기) — itemStyle 기반에 flex 추가
const iconItemStyle: React.CSSProperties = {
  ...itemStyle,
  display:    "flex",
  alignItems: "center",
  gap:        8,
};

const dividerStyle: React.CSSProperties = {
  height:       1,
  background:   "var(--color-border)",
  margin:       "4px 6px",
};

// 발행하기 메뉴 항목 + ? 도움말 버튼을 한 줄에 배치하는 컨테이너
const releaseRowStyle: React.CSSProperties = {
  display:     "flex",
  alignItems:  "center",
};

// ? 도움말 토글 버튼 — 작은 원형, 메뉴 항목 톤과 어울리게 옅은 보조 색
const helpButtonStyle: React.CSSProperties = {
  flexShrink:   0,
  width:        20,
  height:       20,
  marginRight:  8,
  fontSize:     12,
  lineHeight:   1,
  borderRadius: "50%",
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-muted, transparent)",
  color:        "var(--color-text-secondary)",
  cursor:       "pointer",
};

// ? 클릭 시 펼쳐지는 안내 문구 — 본문보다 작고 옅게, 메뉴 폭 안에서 줄바꿈 허용
const helpTextStyle: React.CSSProperties = {
  padding:    "6px 12px 10px",
  fontSize:   12,
  lineHeight: 1.5,
  color:      "var(--color-text-secondary)",
  whiteSpace: "normal",
};
