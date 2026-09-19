"use client";

/**
 * ProjectLockedBanner — 잠긴 프로젝트 안 상단 "읽기 전용" 배너 (정책 §1-6, §3 3단계)
 *
 * 역할:
 *   - 현재 선택된 프로젝트가 결제 잠금(lock_yn='Y') 상태면 워크스페이스 상단에 한 줄 배너
 *   - 소유자에게는 구독 화면·프로젝트 목록(활성화) 링크, 멤버에게는 "소유자에게 문의" 안내
 *   - 잠기지 않았거나 프로젝트 밖(/projects, /settings 등)이면 null (네트워크 추가 호출 없음 —
 *     usePermissions 의 my-role 캐시를 그대로 읽는다)
 */

import Link from "next/link";
import { useAppStore } from "@/store/appStore";
import { usePermissions } from "@/hooks/useMyRole";
import { BILLING_PATH } from "@/lib/billing/constants";

export default function ProjectLockedBanner() {
  const { currentProjectId } = useAppStore();
  const { isProjectLocked, myRole } = usePermissions(currentProjectId);

  if (!currentProjectId || !isProjectLocked) return null;

  const isOwner = myRole === "OWNER";

  return (
    <div
      role="status"
      style={{
        display:       "flex",
        alignItems:    "center",
        gap:           "var(--space-3)",
        padding:       "6px var(--space-4)",
        background:    "var(--color-warning-subtle)",
        borderBottom:  "1px solid var(--color-warning-border)",
        color:         "var(--color-text-primary)",
        fontSize:      "var(--text-sm)",
        flexShrink:    0,
      }}
    >
      <span aria-hidden style={{ fontSize: 14 }}>🔒</span>
      <span style={{ fontWeight: 600, color: "var(--color-warning)" }}>읽기 전용</span>
      <span style={{ color: "var(--color-text-secondary)" }}>
        {isOwner
          ? "구독이 종료되어 이 프로젝트가 잠겼습니다. 조회는 되지만 편집·생성·초대·업로드는 막힙니다."
          : "소유자의 구독이 종료되어 이 프로젝트가 잠겼습니다. 편집이 필요하면 프로젝트 소유자에게 문의해 주세요."}
      </span>
      {isOwner && (
        <span style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)", flexShrink: 0 }}>
          <Link href="/projects" className="sp-btn sp-btn-secondary sp-btn-xs">활성화 (프로젝트 목록)</Link>
          <Link href={BILLING_PATH} className="sp-btn sp-btn-primary sp-btn-xs">구독 갱신</Link>
        </span>
      )}
    </div>
  );
}
