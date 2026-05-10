"use client";

/**
 * StdInfoHelp — 기준 정보 화면 도움말 팝오버
 *
 * 역할:
 *   - 페이지 제목 옆에 작은 (?) 아이콘을 노출하고, 클릭 시 도움말 패널을 토글한다.
 *   - "기준 정보가 무엇이고, 어떤 필드가 어떤 의미인지" 한 곳에서 안내.
 *
 * 디자인:
 *   - 모든 색상·간격·반경은 디자인 토큰 사용 (3테마 자동 대응).
 *   - 외부 클릭 + ESC 시 닫힘.
 *   - 토글 버튼은 작은 ⓘ 형태 — 헤더 타이틀의 시각적 무게를 깨지 않는다.
 */

import { useEffect, useRef, useState } from "react";

export function StdInfoHelp() {
  const [open, setOpen] = useState(false);
  const wrapperRef      = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 닫기 (GNB 드롭다운과 동일 패턴)
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown",   handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown",   handleKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="기준 정보가 무엇인지 도움말 보기"
        aria-expanded={open}
        title="기준 정보 도움말"
        style={triggerStyle(open)}
      >
        ?
      </button>

      {open && (
        <div role="dialog" aria-label="기준 정보 도움말" style={panelStyle}>
          <h3 style={titleStyle}>기준 정보란?</h3>
          <p style={leadStyle}>
            프로젝트에서 자주 쓰는 <strong>코드·임계값·분류</strong> 같은 값을 한 곳에 모아두고,
            어디서든 같은 기준으로 참조하기 위한 <strong>운영자 관리용 사전</strong>입니다.
            소스에 하드코딩하기 애매한 값을 등록·수정·기간 관리할 수 있어요.
          </p>

          <p style={sectionTitleStyle}>이런 경우에 씁니다</p>
          <ul style={listStyle}>
            <li>회원 권한 코드(ADMIN/USER/VIEWER)와 한글 라벨을 한 곳에서 관리</li>
            <li>결제 한도 같은 임계값을 운영자가 직접 변경</li>
            <li>업무 카테고리·지역·은행 같은 분류 코드를 통일</li>
            <li>기간별로 값이 달라지는 정책(예: 올해 한도 vs 내년 한도) 보존</li>
          </ul>

          <p style={sectionTitleStyle}>각 항목 의미</p>
          <dl style={dlStyle}>
            <dt style={dtStyle}>기준 정보 코드</dt>
            <dd style={ddStyle}>시스템이 참조할 식별자. 영문 대문자+숫자 권장 (예: <code style={codeStyle}>AUTH01</code>).</dd>

            <dt style={dtStyle}>기준 정보 명</dt>
            <dd style={ddStyle}>사람이 읽는 이름 (예: &ldquo;관리자 권한&rdquo;).</dd>

            <dt style={dtStyle}>업무 카테고리</dt>
            <dd style={ddStyle}>그룹핑용 자유 텍스트. 같은 프로젝트에서 이미 쓴 값이 자동으로 옵션에 뜹니다.</dd>

            <dt style={dtStyle}>자료 유형</dt>
            <dd style={ddStyle}>값의 형식. 문자열 / 숫자 / Y·N / 일자 / 코드 / JSON.</dd>

            <dt style={dtStyle}>주요·보조 기준 값</dt>
            <dd style={ddStyle}>실제 값. 한 코드에 두 값이 필요한 경우(예: 라벨+설명) 보조 값까지 사용.</dd>

            <dt style={dtStyle}>기준 시작일 / 종료일</dt>
            <dd style={ddStyle}>이 값이 유효한 기간. 종료일을 비우면 무기한(9999-12-31)으로 처리됩니다.</dd>

            <dt style={dtStyle}>사용 여부</dt>
            <dd style={ddStyle}>비활성화하면 참조 대상에서 제외 — 이력 보존을 위해 삭제 대신 미사용을 권장.</dd>

            <dt style={dtStyle}>설명</dt>
            <dd style={ddStyle}>이 기준 정보의 용도와 주의사항. 다른 멤버가 보고 이해할 수 있을 만큼 적어 주세요.</dd>
          </dl>

          <p style={footnoteStyle}>
            기준 정보는 프로젝트 단위로 격리됩니다. 다른 프로젝트의 값은 보이지 않으며 영향을 주지도 받지도 않습니다.
          </p>
        </div>
      )}
    </div>
  );
}

// ── 스타일 ─────────────────────────────────────────────────────────────────────

const triggerStyle = (active: boolean): React.CSSProperties => ({
  marginLeft:  6,
  width:       20,
  height:      20,
  borderRadius: "50%",
  border:      "1px solid var(--color-border)",
  background:  active ? "var(--color-brand-subtle)" : "var(--color-bg-card)",
  color:       active ? "var(--color-brand)" : "var(--color-text-secondary)",
  fontSize:    11,
  fontWeight:  700,
  lineHeight:  "18px",
  textAlign:   "center",
  cursor:      "pointer",
  padding:     0,
});

const panelStyle: React.CSSProperties = {
  position:     "absolute",
  top:          "calc(100% + 8px)",
  left:         0,
  width:        420,
  maxWidth:     "90vw",
  maxHeight:    "70vh",
  overflowY:    "auto",
  background:   "var(--color-bg-card)",
  border:       "1px solid var(--color-border)",
  borderRadius: 10,
  boxShadow:    "var(--shadow-lg)",
  padding:      "16px 18px",
  zIndex:       100,
};

const titleStyle: React.CSSProperties = {
  margin:    "0 0 8px",
  fontSize:  15,
  fontWeight: 700,
  color:     "var(--color-text-primary)",
};

const leadStyle: React.CSSProperties = {
  margin:    "0 0 14px",
  fontSize:  13,
  lineHeight: 1.6,
  color:     "var(--color-text-secondary)",
};

const sectionTitleStyle: React.CSSProperties = {
  margin:     "12px 0 6px",
  fontSize:   12,
  fontWeight: 700,
  color:      "var(--color-text-primary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const listStyle: React.CSSProperties = {
  margin:     "0 0 4px",
  paddingLeft: 18,
  fontSize:   13,
  lineHeight: 1.7,
  color:      "var(--color-text-secondary)",
};

const dlStyle: React.CSSProperties = {
  margin:    "0 0 10px",
  fontSize:  13,
  lineHeight: 1.55,
};

const dtStyle: React.CSSProperties = {
  marginTop:  6,
  fontWeight: 600,
  color:      "var(--color-text-primary)",
};

const ddStyle: React.CSSProperties = {
  margin: "0 0 0 0",
  color:  "var(--color-text-secondary)",
};

const codeStyle: React.CSSProperties = {
  background:   "var(--color-bg-muted)",
  border:       "1px solid var(--color-border)",
  borderRadius: 4,
  padding:      "0 4px",
  fontSize:     12,
  fontFamily:   "var(--font-mono, monospace)",
};

const footnoteStyle: React.CSSProperties = {
  margin:    "10px 0 0",
  paddingTop: 10,
  borderTop: "1px solid var(--color-border)",
  fontSize:  12,
  color:     "var(--color-text-tertiary)",
  lineHeight: 1.55,
};
