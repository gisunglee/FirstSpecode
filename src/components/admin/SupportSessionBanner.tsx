"use client";

/**
 * SupportSessionBanner — 시스템 관리자 지원 세션 알림 배너 (전역)
 *
 * 역할:
 *   - SUPER_ADMIN 에게 활성 지원 세션이 1건이라도 있으면 화면 상단에 배너 표시
 *   - 어느 페이지든 (시스템 관리 / 대시보드 / 다른 프로젝트) **항상 보이게** —
 *     관리자가 지원 세션 중인 것을 잊어버리지 않도록 (이전: /projects/{id}/* 만)
 *   - 남은 시간 카운트다운 + "프로젝트로 이동" + "지원 종료" 버튼 제공
 *   - 활성 세션이 여러 개면 한 줄씩 쌓아서 모두 표시
 *
 * 시각:
 *   - 진한 warning 톤 + 펄스 애니메이션 + 좌측 stripe 로 강조
 *   - 일반 사용자에겐 항상 null (네트워크 0)
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { useIsSystemAdmin } from "@/hooks/useMyRole";

type SessionItem = {
  sessId:      string;
  projectId:   string;
  projectName: string;
  memo:        string | null;
  expiresAt:   string;
  createdAt:   string;
};

export default function SupportSessionBanner() {
  const { isSystemAdmin } = useIsSystemAdmin();
  const queryClient = useQueryClient();

  // 관리자만 활성 세션 조회 — 일반 사용자는 네트워크 호출 0
  const { data: sessions = [] } = useQuery<SessionItem[]>({
    queryKey: ["support-session", "active", "all"],
    queryFn: () =>
      authFetch<{ data: { items: SessionItem[] } }>(
        `/api/admin/support-session`
      ).then((r) => r.data.items ?? []),
    enabled: isSystemAdmin,
    refetchInterval: 60 * 1000, // 1분 주기 — 만료 자동 감지
    staleTime: 30 * 1000,
  });

  // 1초마다 카운트다운만 갱신
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!isSystemAdmin || sessions.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isSystemAdmin, sessions.length]);

  // 만료된 세션은 표시 제외 — 1초 단위 시각 갱신과 함께 자연스럽게 사라짐
  const activeSessions = useMemo(
    () => sessions.filter((s) => new Date(s.expiresAt).getTime() > now),
    [sessions, now]
  );

  // 세션 종료 뮤테이션
  const endMutation = useMutation({
    mutationFn: (sessId: string) =>
      authFetch("/api/admin/support-session", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ sessId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-session", "active"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "support-sessions", "active"] });
      toast.success("지원 세션이 종료되었습니다.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!isSystemAdmin || activeSessions.length === 0) return null;

  return (
    <>
      {/* CSS 애니메이션 — 좌측 stripe 미세 펄스 */}
      <style>{`
        @keyframes sp-support-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.55; }
        }
        .sp-support-stripe {
          animation: sp-support-pulse 1.6s ease-in-out infinite;
        }
      `}</style>

      <div role="status" aria-label="지원 세션 진행 중">
        {activeSessions.map((s) => (
          <SessionBanner
            key={s.sessId}
            session={s}
            now={now}
            onEnd={() => endMutation.mutate(s.sessId)}
            ending={endMutation.isPending}
          />
        ))}
      </div>
    </>
  );
}

// ── 세션 한 건 배너 ────────────────────────────────────────────────────────
function SessionBanner({
  session, now, onEnd, ending,
}: {
  session: SessionItem;
  now:     number;
  onEnd:   () => void;
  ending:  boolean;
}) {
  const remaining = Math.max(0, new Date(session.expiresAt).getTime() - now);
  const min = Math.floor(remaining / 60000);
  const sec = Math.floor((remaining % 60000) / 1000);
  const timeStr = `${min}:${String(sec).padStart(2, "0")}`;
  // 5분 이하 — 색을 더 강하게
  const isUrgent = remaining < 5 * 60 * 1000;

  return (
    <div
      style={{
        display:      "flex",
        alignItems:   "center",
        gap:          12,
        padding:      "10px 16px 10px 0",
        background:   isUrgent ? "var(--color-error-subtle)" : "var(--color-warning-subtle)",
        color:        isUrgent ? "var(--color-error)"        : "var(--color-warning)",
        borderBottom: `1px solid ${isUrgent ? "var(--color-error-border)" : "var(--color-warning-border)"}`,
        fontSize:     "var(--text-sm)",
        fontWeight:   500,
        position:     "relative",
      }}
    >
      {/* 좌측 강조 stripe — 펄스 애니메이션 */}
      <div
        className="sp-support-stripe"
        style={{
          width:      6,
          alignSelf:  "stretch",
          background: isUrgent ? "var(--color-error)" : "var(--color-warning)",
        }}
      />

      <span style={{ fontSize: 16 }}>⚠️</span>
      <span style={{ fontWeight: 700, fontSize: "var(--text-md)" }}>
        지원 세션 진행 중 (읽기 전용)
      </span>
      <span style={{
        padding:      "2px 8px",
        borderRadius: "var(--radius-sm)",
        background:   "var(--color-bg-card)",
        border:       `1px solid ${isUrgent ? "var(--color-error-border)" : "var(--color-warning-border)"}`,
        fontSize:     "var(--text-xs)",
        fontWeight:   700,
      }}>
        {session.projectName}
      </span>
      {session.memo && (
        <span style={{ opacity: 0.85, fontSize: "var(--text-xs)" }}>
          — {session.memo}
        </span>
      )}

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        {/* 카운트다운 */}
        <span style={{
          fontFamily:   "var(--font-mono)",
          fontSize:     "var(--text-sm)",
          fontWeight:   700,
          padding:      "3px 10px",
          background:   "var(--color-bg-card)",
          borderRadius: "var(--radius-sm)",
          border:       `1px solid ${isUrgent ? "var(--color-error-border)" : "var(--color-warning-border)"}`,
        }}>
          {timeStr}
        </span>

        {/* 프로젝트로 이동 — 다른 페이지에서 빠르게 진입 */}
        <Link
          href={`/projects/${session.projectId}/unit-works`}
          style={{
            padding:      "4px 10px",
            fontSize:     "var(--text-xs)",
            fontWeight:   600,
            color:        isUrgent ? "var(--color-error)" : "var(--color-warning)",
            background:   "var(--color-bg-card)",
            border:       `1px solid ${isUrgent ? "var(--color-error-border)" : "var(--color-warning-border)"}`,
            borderRadius: "var(--radius-sm)",
            textDecoration: "none",
          }}
        >
          프로젝트로 이동
        </Link>

        <button
          onClick={onEnd}
          disabled={ending}
          style={{
            padding:      "4px 10px",
            fontSize:     "var(--text-xs)",
            fontWeight:   600,
            color:        "var(--color-text-inverse)",
            background:   isUrgent ? "var(--color-error)" : "var(--color-warning)",
            border:       "none",
            borderRadius: "var(--radius-sm)",
            cursor:       ending ? "wait" : "pointer",
            opacity:      ending ? 0.6 : 1,
          }}
        >
          {ending ? "…" : "지원 종료"}
        </button>
      </div>
    </div>
  );
}
