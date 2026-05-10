"use client";

/**
 * ExcelDownloadButton — 모든 목록 화면 헤더에 배치하는 공통 엑셀 다운로드 버튼
 *
 * 역할:
 *   - href 의 export API 를 인증 호출하여 xlsx 파일을 받아 a[download] 로 저장
 *   - 권한 없음(403) / 용량 초과(400) / 기타 실패 시 toast 로 사용자에게 안내
 *
 * 사용:
 *   <ExcelDownloadButton
 *     href={`/api/projects/${projectId}/tasks/export?${qs}`}
 *     entityKey="tasks"
 *   />
 *
 * 설계 메모:
 *   - 인증 흐름은 authFetchRaw 에 위임 (토큰 갱신/리다이렉트는 거기서 처리)
 *   - 파일명은 서버 Content-Disposition 헤더를 우선 사용, 없으면 entityKey + .xlsx 로 폴백
 *   - 다운로드 진행 중에는 버튼 disabled + 라벨 "다운로드 중..." 으로 변경
 */

import { useState } from "react";
import { toast } from "sonner";
import { authFetchRaw } from "@/lib/authFetch";

type Props = {
  /** 다운로드를 트리거할 export API URL (검색·필터 querystring 포함) */
  href:      string;
  /** 서버가 파일명 헤더를 보내지 않을 때의 폴백 prefix ("tasks" 등) */
  entityKey: string;
  /** 호출 비활성화 (예: 데이터 로딩 중) */
  disabled?: boolean;
  /** 버튼 라벨 — 기본 "엑셀 다운로드" */
  label?:    string;
};

export default function ExcelDownloadButton({
  href, entityKey, disabled, label = "엑셀 다운로드",
}: Props) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (loading) return;  // 더블클릭 방지
    setLoading(true);

    try {
      const res = await authFetchRaw(href);

      if (!res.ok) {
        // 서버 표준 에러 응답 ({ code, message }) 을 toast 로 노출
        const body = await res.json().catch(() => null);
        toast.error(body?.message ?? `다운로드에 실패했습니다. (${res.status})`);
        return;
      }

      // 파일명 — 서버 Content-Disposition > entityKey 폴백
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match       = disposition.match(/filename="?([^";]+)"?/i);
      const filename    = match?.[1] ?? `${entityKey}.xlsx`;

      // Blob → 임시 anchor → 다운로드 트리거
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 같은 탭에서 ObjectURL 누수 방지 — 다음 tick 에서 해제
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      // authFetchRaw 가 던지는 인증 에러(세션 만료 등) — 메시지 그대로 노출
      const message = err instanceof Error ? err.message : "다운로드 중 오류가 발생했습니다.";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || loading}
      style={buttonStyle(disabled || loading)}
      aria-label={label}
      title={label}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
           aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      <span>{loading ? "다운로드 중..." : label}</span>
    </button>
  );
}

// ── 스타일 ─────────────────────────────────────────────────────────────────────
// 헤더 우측의 보조 버튼 톤 — primaryBtnStyle 옆에 어울리는 outline 형태.
// design 시스템의 sp-btn 클래스로 일괄화하기 전까지는 인라인 스타일로 페이지 톤 유지.

const buttonStyle = (isDisabled: boolean): React.CSSProperties => ({
  display:       "inline-flex",
  alignItems:    "center",
  gap:           6,
  padding:       "5px 12px",
  borderRadius:  6,
  border:        "1px solid var(--color-border)",
  background:    "var(--color-bg-card)",
  color:         "var(--color-text-primary)",
  fontSize:      12,
  fontWeight:    500,
  cursor:        isDisabled ? "not-allowed" : "pointer",
  opacity:       isDisabled ? 0.6 : 1,
  whiteSpace:    "nowrap",
});
