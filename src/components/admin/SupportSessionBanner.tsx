"use client";

/**
 * SupportSessionBanner — 시스템 관리자 지원 세션 알림 배너
 *
 * 역할:
 *   - 현재 브라우저 경로가 /projects/{id}/** 이고,
 *     해당 프로젝트에 내 활성 지원 세션이 있으면
 *     화면 상단에 "읽기 전용 진행중" 경고 배너를 표시
 *   - 남은 시간 카운트다운과 "지원 종료" 버튼 제공
 *
 * 설계 근거:
 *   - 사용자가 무심코 고객 데이터를 수정하려 할 때 직전에 인지시키는 목적
 *   - 세션 만료 / 종료 시 즉시 배너 사라짐 — 1초 주기로 시간 재계산
 *   - 관리자가 아닌 사용자는 이 컴포넌트가 항상 조용히 null 반환 (비용 0)
 */

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { useIsSystemAdmin } from "@/hooks/useMyRole";

type SessionItem = {
  sessId:    string;
  projectId: string;
  memo:      string | null;
  expiresAt: string;
  createdAt: string;
};

// URL 에서 projectId 추출 — /projects/{uuid}/**
function extractProjectIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/projects\/([^/]+)/);
  if (!m) return null;
  // 하위 라우트가 "new" 같은 특수 키워드일 수 있지만, 그때는 세션 조회가 빈 결과를 주므로 무해
  return m[1] ?? null;
}

export default function SupportSessionBanner() {
  const pathname = usePathname();
  const { isSystemAdmin } = useIsSystemAdmin();
  const queryClient = useQueryClient();

  const projectId = extractProjectIdFromPath(pathname);

  // 관리자 + 프로젝트 경로일 때만 쿼리 활성화 — 그 외엔 네트워크 요청 없음
  const enabled = isSystemAdmin && !!projectId;

  const { data: sessions = [] } = useQuery<SessionItem[]>({
    queryKey: ["support-session", "active", projectId],
    queryFn: () =>
      authFetch<{ data: { items: SessionItem[] } }>(
        `/api/admin/support-session?projectId=${projectId}`
      ).then((r) => r.data.items ?? []),
    enabled,
    refetchInterval: 60 * 1000, // 1분 주기로 재조회 (만료 감지)
    staleTime: 30 * 1000,
  });

  // 1초마다 "남은 시간" 표시만 갱신
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);

  // 활성 세션 (지금 이 프로젝트)
  const activeSession = useMemo(() => {
    if (!projectId) return null;
    return sessions.find((s) => s.projectId === projectId && new Date(s.expiresAt).getTime() > now) ?? null;
  }, [sessions, projectId, now]);

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

  if (!enabled || !activeSession) return null;

  const remaining = Math.max(0, new Date(activeSession.expiresAt).getTime() - now);
  const min = Math.floor(remaining / 60000);
  const sec = Math.floor((remaining % 60000) / 1000);
  const timeStr = `${min}:${String(sec).padStart(2, "0")}`;

  return (
    <div
      role="status"
      style={{
        display:       "flex",
        alignItems:    "center",
        gap:           12,
        padding:       "6px 16px",
        background:    "var(--color-warning-subtle)",
        color:         "var(--color-warning)",
        borderBottom:  "1px solid var(--color-warning-border)",
        fontSize:      "var(--text-sm)",
        fontWeight:    500,
      }}
    >
      <span style={{ fontSize: 14 }}>⚠️</span>
      <span>
        <strong>지원 세션 진행 중 (읽기 전용)</strong>
        {activeSession.memo && (
          <span style={{ marginLeft: 8, opacity: 0.8 }}>— {activeSession.memo}</span>
        )}
      </span>
      <span style={{
        marginLeft:   "auto",
        fontFamily:   "var(--font-mono)",
        fontSize:     "var(--text-xs)",
        padding:      "2px 8px",
        background:   "var(--color-bg-card)",
        borderRadius: "var(--radius-sm)",
        border:       "1px solid var(--color-warning-border)",
      }}>
        {timeStr}
      </span>
      <button
        onClick={() => endMutation.mutate(activeSession.sessId)}
        disabled={endMutation.isPending}
        style={{
          padding:      "2px 10px",
          fontSize:     "var(--text-xs)",
          fontWeight:   600,
          color:        "var(--color-warning)",
          background:   "var(--color-bg-card)",
          border:       "1px solid var(--color-warning-border)",
          borderRadius: "var(--radius-sm)",
          cursor:       "pointer",
        }}
      >
        {endMutation.isPending ? "…" : "지원 종료"}
      </button>
    </div>
  );
}
