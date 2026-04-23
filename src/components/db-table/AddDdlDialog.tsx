"use client";

/**
 * AddDdlDialog — DB 테이블 상세에서 CREATE TABLE DDL 을 파싱하여 컬럼 일괄 추가
 *
 * 역할:
 *   - 입력 단계: DDL 원문 textarea
 *   - 확인 단계: 파싱된 컬럼 미리보기 (물리/논리/타입)
 *   - "등록" 클릭 시 onApply 콜백으로 상위에 결과 전달
 *
 * Props:
 *   - open:    팝업 표시 여부
 *   - onClose: 닫기 콜백
 *   - onApply: 파싱된 컬럼 배열을 상위 컬럼 리스트에 추가 (상위 상태 갱신은 상위 책임)
 *
 * 설계:
 *   - ddlText / ddlParsed 는 내부 상태로 캡슐화 — 상위 페이지 state 오염 방지
 *   - 파싱은 공용 parseSingleDdl 유틸에 위임 (블록 주석/COMMENT ON 등 지원)
 *   - 페이지 파일 1100줄+ 축소 목적으로 분리
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { parseSingleDdl, type ParsedCol } from "@/lib/ddlParser";
import { useEscapeKey } from "@/hooks/useEscapeKey";

type Props = {
  open:    boolean;
  onClose: () => void;
  onApply: (parsed: ParsedCol[]) => void;
};

export default function AddDdlDialog({ open, onClose, onApply }: Props) {
  const [ddlText,   setDdlText]   = useState("");
  const [ddlParsed, setDdlParsed] = useState<ParsedCol[] | null>(null);

  useEscapeKey(onClose, open);

  // 팝업이 닫힐 때 내부 상태 초기화 — 다음에 열 때 잔상 없음
  useEffect(() => {
    if (!open) {
      setDdlText("");
      setDdlParsed(null);
    }
  }, [open]);

  if (!open) return null;

  function handleParse() {
    const parsed = parseSingleDdl(ddlText);
    if (parsed.length === 0) {
      toast.error("컬럼을 파싱할 수 없습니다. CREATE TABLE 문을 확인해 주세요.");
      return;
    }
    setDdlParsed(parsed);
  }

  function handleApply() {
    if (!ddlParsed) return;
    onApply(ddlParsed);
    toast.success(`${ddlParsed.length}개 컬럼을 추가했습니다.`);
    onClose();
  }

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div style={headerStyle}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>ADD DDL</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--color-text-secondary)", lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {ddlParsed === null ? (
          /* 입력 단계 */
          <>
            <div style={bodyStyle}>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 600 }}>
                CREATE TABLE 문을 입력하세요.
                <span style={{ fontWeight: 400, marginLeft: 6 }}>Oracle / MySQL / PostgreSQL 모두 지원</span>
              </label>
              <textarea
                value={ddlText}
                onChange={(e) => setDdlText(e.target.value)}
                placeholder={"CREATE TABLE tb_example (\n  col_id VARCHAR(36) NOT NULL,\n  col_nm VARCHAR(200),\n  PRIMARY KEY (col_id)\n);"}
                style={textareaStyle}
                autoFocus
              />
            </div>
            <div style={footerStyle}>
              <button type="button" onClick={onClose} style={secondaryBtnStyle}>취소</button>
              <button type="button" onClick={handleParse} disabled={!ddlText.trim()} style={primaryBtnStyle}>파싱하기</button>
            </div>
          </>
        ) : (
          /* 확인 단계 */
          <>
            <div style={bodyStyle}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 4, flexShrink: 0 }}>
                {ddlParsed.length}개 컬럼을 파싱했습니다. 등록하시겠습니까?
              </div>
              <div style={previewWrapStyle}>
                <div style={previewHeaderStyle}>
                  <div>물리 컬럼명</div>
                  <div>논리 컬럼명</div>
                  <div>데이터 타입</div>
                </div>
                <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
                  {ddlParsed.map((p, i) => (
                    <div key={i} style={{
                      display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                      padding: "5px 12px",
                      borderTop: i === 0 ? "none" : "1px solid var(--color-border)",
                      fontSize: 12,
                    }}>
                      <span style={{ fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace", fontWeight: 600, color: "var(--color-text-primary)" }}>
                        {p.colPhysclNm}
                      </span>
                      <span style={{ color: p.colLgclNm ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}>
                        {p.colLgclNm || "—"}
                      </span>
                      <span style={{ fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace", color: "var(--color-text-secondary)" }}>
                        {p.dataTyNm}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={footerStyle}>
              <button type="button" onClick={() => setDdlParsed(null)} style={secondaryBtnStyle}>다시 입력</button>
              <button type="button" onClick={handleApply} style={primaryBtnStyle}>등록</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const backdropStyle: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  width: 560, height: "70vh", maxHeight: "85vh",
  background: "var(--color-bg-card)",
  borderRadius: 10,
  boxShadow: "0 8px 32px rgba(0,0,0,0.22)",
  display: "flex", flexDirection: "column",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  padding: "14px 20px",
  borderBottom: "1px solid var(--color-border)",
  display: "flex", alignItems: "center", justifyContent: "space-between",
  flexShrink: 0,
};

const bodyStyle: React.CSSProperties = {
  flex: 1, padding: "14px 20px",
  display: "flex", flexDirection: "column", gap: 8,
  minHeight: 0,
};

const footerStyle: React.CSSProperties = {
  padding: "12px 20px",
  borderTop: "1px solid var(--color-border)",
  display: "flex", justifyContent: "flex-end", gap: 8,
  flexShrink: 0,
};

const textareaStyle: React.CSSProperties = {
  flex: 1, resize: "none",
  padding: "10px 12px",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  fontSize: 12,
  fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace",
  background: "var(--color-bg-muted)",
  color: "var(--color-text-primary)",
  lineHeight: 1.6, outline: "none",
};

const previewWrapStyle: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: 6, overflow: "hidden",
  flex: 1, minHeight: 0,
  display: "flex", flexDirection: "column",
};

const previewHeaderStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
  padding: "6px 12px",
  background: "var(--color-bg-muted)",
  fontSize: 11, fontWeight: 700,
  color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border)",
  flexShrink: 0,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "6px 18px", borderRadius: 6,
  border: "none",
  background: "var(--color-brand)", color: "#fff",
  fontSize: 13, fontWeight: 600, cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "6px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)", color: "var(--color-text-primary)",
  fontSize: 13, cursor: "pointer",
};
