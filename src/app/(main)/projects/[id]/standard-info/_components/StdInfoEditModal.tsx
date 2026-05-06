"use client";

/**
 * StdInfoEditModal — 기준 정보 추가/수정 모달
 *
 * 역할:
 *   - 신규 등록(POST)·기존 수정(PUT) 양쪽 처리
 *   - 사용 여부 토글, 업무 카테고리 자유 입력(자동완성), 자료 유형 select, 기간 입력
 *
 * 주요 기술:
 *   - TanStack Query useMutation: 저장 후 부모에서 invalidate
 *   - authFetch: 인증 헤더 자동 포함
 *   - HTML5 datalist: 현재 프로젝트의 업무 카테고리 distinct 자동완성 (일관성 보조)
 *   - 모든 색상은 semantic 토큰 (3테마 자동 대응)
 *
 * 닫힘 정책:
 *   - 오버레이 클릭으로 닫히지 않음 — 작성 중 실수 방지를 위해 [취소]/[저장] 으로만 닫힘
 *
 * 명명 이력:
 *   - 2026-05-05 bus_div_code(고정 6종 select) → biz_ctgry_nm(자유 텍스트 + datalist) 전환
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import {
  type StdInfo,
  DATA_TYPE_OPTIONS,
  getTodayStr,
} from "../_constants";

type Props = {
  projectId:          string;
  editTarget:         StdInfo | null;  // null 이면 신규 등록
  /** 현재 프로젝트의 업무 카테고리 distinct 목록 — datalist 자동완성 소스 */
  existingCategories: string[];
  onClose:            () => void;
  onSaved:            () => void;
};

// datalist 의 element id — 같은 페이지에서 충돌하지 않도록 고유값 사용
const CTGRY_DATALIST_ID = "std-info-biz-ctgry-list";

export function StdInfoEditModal({
  projectId, editTarget, existingCategories, onClose, onSaved,
}: Props) {
  const isEdit = !!editTarget;

  const [stdInfoCode,   setStdInfoCode]   = useState(editTarget?.stdInfoCode ?? "");
  const [stdInfoNm,     setStdInfoNm]     = useState(editTarget?.stdInfoNm ?? "");
  // 업무 카테고리 — 자유 텍스트. 신규는 빈 문자열로 시작 (기본값 강제하지 않음 = 사용자가 의식적으로 입력)
  const [bizCtgryNm,    setBizCtgryNm]    = useState(editTarget?.bizCtgryNm ?? "");
  const [stdDataTyCode, setStdDataTyCode] = useState(editTarget?.stdDataTyCode ?? "STRING");
  const [stdBgngDe,     setStdBgngDe]     = useState(editTarget?.stdBgngDe ?? getTodayStr());
  const [stdEndDe,      setStdEndDe]      = useState(editTarget?.stdEndDe ?? "99991231");
  const [mainStdVal,    setMainStdVal]    = useState(editTarget?.mainStdVal ?? "");
  const [subStdVal,     setSubStdVal]     = useState(editTarget?.subStdVal ?? "");
  const [stdInfoDc,     setStdInfoDc]     = useState(editTarget?.stdInfoDc ?? "");
  // 신규는 기본 사용("Y"), 수정은 기존 값 유지
  const [useYn,         setUseYn]         = useState(editTarget?.useYn ?? "Y");

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        stdInfoCode, stdBgngDe, stdEndDe, stdInfoNm,
        bizCtgryNm: bizCtgryNm.trim(),
        stdDataTyCode, mainStdVal, subStdVal, stdInfoDc, useYn,
      };
      if (isEdit) {
        return authFetch(`/api/projects/${projectId}/standard-info/${editTarget.stdInfoId}`, {
          method:  "PUT",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(body),
        });
      }
      return authFetch(`/api/projects/${projectId}/standard-info`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
    },
    onSuccess: () => {
      toast.success(isEdit ? "수정되었습니다." : "추가되었습니다.");
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div style={overlayStyle}>
      <div style={{ ...dialogStyle, maxWidth: 520, width: "90vw" }}>
        <h3 style={{ margin: "0 0 20px", fontSize: 17, fontWeight: 700 }}>
          {isEdit ? "기준 정보 수정" : "기준 정보 추가"}
        </h3>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* 코드 + 명칭 */}
          <div style={{ display: "flex", gap: 12 }}>
            <ModalField label="기준 정보 코드 *" style={{ width: 120 }}>
              <input
                value={stdInfoCode}
                onChange={(e) => setStdInfoCode(e.target.value.toUpperCase())}
                maxLength={6} placeholder="AUTH01"
                style={modalInputStyle}
                disabled={isEdit}
              />
            </ModalField>
            <ModalField label="기준 정보 명 *" style={{ flex: 1 }}>
              <input
                value={stdInfoNm}
                onChange={(e) => setStdInfoNm(e.target.value)}
                style={modalInputStyle}
              />
            </ModalField>
          </div>

          {/* 업무 카테고리 + 자료 유형 */}
          <div style={{ display: "flex", gap: 12 }}>
            <ModalField label="업무 카테고리 *" style={{ flex: 1 }}>
              {/* 자유 텍스트 + datalist 자동완성.
                  현재 프로젝트에서 이미 쓴 카테고리가 자동완성으로 제안 → 일관성 유도.
                  새 카테고리도 자유 입력 가능. */}
              <input
                value={bizCtgryNm}
                onChange={(e) => setBizCtgryNm(e.target.value)}
                list={CTGRY_DATALIST_ID}
                maxLength={100}
                placeholder="예: 회원, 예산서, 배치"
                className="sp-no-native-arrow"
                style={modalChevronInputStyle}
              />
              <datalist id={CTGRY_DATALIST_ID}>
                {existingCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </ModalField>
            <ModalField label="자료 유형 *" style={{ flex: 1 }}>
              <select
                value={stdDataTyCode}
                onChange={(e) => setStdDataTyCode(e.target.value)}
                className="sp-no-native-arrow"
                style={modalChevronInputStyle}
              >
                {DATA_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </ModalField>
          </div>

          {/* 값 */}
          <div style={{ display: "flex", gap: 12 }}>
            <ModalField label="주요 기준 값" style={{ flex: 1 }}>
              <input
                value={mainStdVal} onChange={(e) => setMainStdVal(e.target.value)}
                style={modalInputStyle} placeholder="Y, 5, ADMIN 등"
              />
            </ModalField>
            <ModalField label="보조 기준 값" style={{ flex: 1 }}>
              <input value={subStdVal} onChange={(e) => setSubStdVal(e.target.value)} style={modalInputStyle} />
            </ModalField>
          </div>

          {/* 기간 + 사용 여부 */}
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <ModalField label="기준 시작일 *" style={{ flex: 1 }}>
              <input
                value={stdBgngDe} onChange={(e) => setStdBgngDe(e.target.value)}
                maxLength={8} placeholder="20260101" style={modalInputStyle}
              />
            </ModalField>
            <ModalField label="기준 종료일" style={{ flex: 1 }}>
              <input
                value={stdEndDe} onChange={(e) => setStdEndDe(e.target.value)}
                maxLength={8} placeholder="99991231" style={modalInputStyle}
              />
            </ModalField>
            {/* 사용 여부 토글 — 목록 행 토글과 동일한 pill 스타일 */}
            <ModalField label="사용 여부" style={{ width: 96 }}>
              <button
                type="button"
                onClick={() => setUseYn(useYn === "Y" ? "N" : "Y")}
                style={useYn === "Y" ? toggleActiveStyle : toggleInactiveStyle}
                title={useYn === "Y" ? "클릭하면 비활성화" : "클릭하면 활성화"}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: useYn === "Y" ? "var(--color-success)" : "var(--color-text-tertiary)",
                }} />
                {useYn === "Y" ? "사용" : "미사용"}
              </button>
            </ModalField>
          </div>

          {/* 설명 */}
          <ModalField label="설명">
            <textarea
              value={stdInfoDc} onChange={(e) => setStdInfoDc(e.target.value)} rows={3}
              style={{ ...modalInputStyle, resize: "vertical" }}
              placeholder="이 기준 정보의 용도를 설명하세요."
            />
          </ModalField>
        </div>

        {/* 액션 */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 24 }}>
          <button onClick={onClose} style={secondaryBtnStyle} disabled={saveMutation.isPending}>취소</button>
          <button onClick={() => saveMutation.mutate()} style={primaryBtnStyle} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 서브 컴포넌트 ────────────────────────────────────────────────────────────

function ModalField({ label, children, style }: {
  label:    string;
  children: React.ReactNode;
  style?:   React.CSSProperties;
}) {
  return (
    <div style={style}>
      <label style={{
        fontSize: 12, fontWeight: 600, display: "block",
        marginBottom: 4, color: "var(--color-text-secondary)",
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}

// ── 스타일 (모두 토큰 사용) ──────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "var(--color-bg-overlay)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: "var(--color-bg-card)",
  borderRadius: 12, padding: "24px 28px",
  boxShadow: "var(--shadow-lg)",
  color: "var(--color-text-primary)",
};

const modalInputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 13, boxSizing: "border-box",
};

// <select> 와 <input list="..."> 공용 — 페이지 필터 select 와 동일한 chevron 패턴.
// 네이티브 indicator 는 className="sp-no-native-arrow" 로 제거하고 SVG chevron 만 노출.
// 우측 패딩 32px + 아이콘 위치 right 10px center → 화살표가 우측에서 떠있어 보임.
const modalChevronInputStyle: React.CSSProperties = {
  ...modalInputStyle,
  padding:            "7px 32px 7px 10px",
  cursor:             "pointer",
  outline:            "none",
  appearance:         "none",
  WebkitAppearance:   "none",
  backgroundImage:    `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
  backgroundRepeat:   "no-repeat",
  backgroundPosition: "right 10px center",
};

const toggleBaseStyle: React.CSSProperties = {
  width: "100%", height: 32,
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  padding: "0 10px", borderRadius: 6,
  border: "1px solid",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
  boxSizing: "border-box",
};

const toggleActiveStyle: React.CSSProperties = {
  ...toggleBaseStyle,
  borderColor: "var(--color-success)",
  background:  "var(--color-success-subtle)",
  color:       "var(--color-success)",
};

const toggleInactiveStyle: React.CSSProperties = {
  ...toggleBaseStyle,
  borderColor: "var(--color-border)",
  background:  "var(--color-bg-muted)",
  color:       "var(--color-text-secondary)",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "7px 20px", borderRadius: 6,
  border: "none",
  background: "var(--color-brand)",
  color: "var(--color-text-inverse)",
  fontSize: 13, fontWeight: 600, cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "7px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 13, cursor: "pointer",
};
