"use client";

/**
 * ScopeStatusCell — 사업 범위 구분(신규/수정/기존/폐기) 배지 + 인라인 편집
 *
 * 역할:
 *   - 목록 그리드 한 칸에서 scope_sttus_code 를 배지로 보여준다.
 *   - 편집 가능하면 클릭 시 select 로 바뀌어 즉시 변경한다.
 *
 * 왜 공용 컴포넌트인가:
 *   단위업무·화면·기능 세 목록이 같은 칸을 갖는다. 각 페이지에 배지 스타일과
 *   select 토글을 따로 쓰면 색과 동작이 금방 어긋난다.
 *
 * 왜 인라인 편집이 필요한가:
 *   AS-IS(이전 사업) 정보를 대량 등록할 때 구분이 잘못 찍히는 일이 반드시 생긴다.
 *   상세 화면을 하나씩 열어 고치게 하면 수백 건을 정정할 수가 없다.
 *
 * 권한:
 *   변경은 서버에서 MANAGER(OWNER/ADMIN, PM/PL)만 통과한다
 *   (specContentFieldPolicy.ts). canEdit 는 화면에서 select 를 열어줄지에 대한
 *   힌트일 뿐 최종 판정이 아니므로, 실패는 호출부가 토스트로 안내한다.
 */

import { useState } from "react";
import { SCOPE_STTUS, SCOPE_STTUS_LABELS, isScopeSttusCode, type ScopeSttusCode } from "@/lib/scopeStatus";

/**
 * 배지 색 — 의미에 맞는 semantic 토큰 계열로만 고른다(하드코딩 색 금지).
 *   신규 = 브랜드(이번 사업의 산출물), 수정 = 경고(손댄 것),
 *   기존 = 중립(이번 사업 대상 아님 — 눈에 덜 띄어야 함), 폐기 = 에러(걷어냄)
 */
const BADGE_CLASS: Record<ScopeSttusCode, string> = {
  NEW:        "sp-badge sp-badge-brand",
  MODIFIED:   "sp-badge sp-badge-warning",
  EXISTING:   "sp-badge sp-badge-neutral",
  DEPRECATED: "sp-badge sp-badge-error",
};

const OPTIONS = Object.values(SCOPE_STTUS);

type Props = {
  value: string;
  /** select 를 열어줄지 — 최종 권한 판정은 서버가 한다 */
  canEdit?: boolean;
  /** 변경 확정 시 호출. 같은 값이면 호출하지 않는다. */
  onChange?: (next: ScopeSttusCode) => void;
};

export function ScopeStatusCell({ value, canEdit = false, onChange }: Props) {
  const [editing, setEditing] = useState(false);

  // 알 수 없는 값이 저장돼 있어도 원문을 그대로 보여준다 — 조용히 감추면
  // 데이터가 깨진 사실을 아무도 모르게 된다.
  const code = isScopeSttusCode(value) ? value : null;
  const label = code ? SCOPE_STTUS_LABELS[code] : value;

  if (editing) {
    return (
      <select
        className="sp-input sp-select"
        style={{ width: "100%", fontSize: 11, padding: "2px 4px", height: 24 }}
        value={code ?? ""}
        autoFocus
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          const next = e.target.value;
          setEditing(false);
          if (isScopeSttusCode(next) && next !== code) onChange?.(next);
        }}
        // 행 클릭(상세 이동)으로 이벤트가 번지지 않도록 — 목록 행 전체가 클릭 대상이다
        onClick={(e) => e.stopPropagation()}
      >
        {OPTIONS.map((o) => (
          <option key={o} value={o}>{SCOPE_STTUS_LABELS[o]}</option>
        ))}
      </select>
    );
  }

  return (
    <span
      className={code ? BADGE_CLASS[code] : "sp-badge sp-badge-neutral"}
      style={canEdit ? { cursor: "pointer" } : undefined}
      title={canEdit ? "클릭해서 사업 범위 구분 변경" : undefined}
      onClick={canEdit ? (e) => { e.stopPropagation(); setEditing(true); } : undefined}
    >
      {label}
    </span>
  );
}
