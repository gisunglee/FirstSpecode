"use client";

/**
 * AdminLayout — 시스템 관리자 전용 라우트 가드 + 공통 프레임
 *
 * 역할:
 *   - /admin/** 진입 시 isSystemAdmin 체크, 아니면 대시보드로 리디렉션
 *   - SYSTEM ADMIN 배지 + "시스템 관리" 타이틀 공통 노출
 *   - 메뉴 네비게이션은 LNB 의 "시스템 관리" 그룹이 담당 — 본 레이아웃에는 없음
 *     (이전 버전에는 상단 탭 네비를 두었으나 LNB 와 100% 중복되어 제거)
 *
 * 설계:
 *   - 서버 렌더링으로 막지 않는 이유:
 *     (main) 레이아웃이 이미 클라이언트 컴포넌트 기반 인증 흐름이라
 *     layout.tsx 를 서버로 만들면 세션 토큰 전달이 꼬임.
 *     → 클라이언트에서 profile 쿼리 → isSystemAdmin=false 면 즉시 push
 *   - API 는 독립적으로 requireSystemAdmin() 으로 보호되므로 UI 가드가
 *     뚫려도 데이터는 노출되지 않음 (이중 방어선)
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useIsSystemAdmin } from "@/hooks/useMyRole";

// 경로별 표시 타이틀 — 가장 긴 prefix 가 우선.
// 헤더 h1 에 노출되며, "SYSTEM ADMIN" 배지 옆에 현재 페이지 명을 보여준다.
// 신규 admin 페이지가 추가되면 여기 한 줄만 더하면 된다.
const TITLE_BY_PATH: Array<{ prefix: string; title: string }> = [
  { prefix: "/admin/users",            title: "사용자" },
  { prefix: "/admin/projects",         title: "프로젝트" },
  { prefix: "/admin/config-templates", title: "환경설정 템플릿" },
  { prefix: "/admin/design-templates", title: "설계 양식" },
  { prefix: "/admin/prompt-templates", title: "프롬프트 관리" },
  { prefix: "/admin/docs",             title: "문서 관리" },
  { prefix: "/admin/audit",            title: "감사 로그" },
  { prefix: "/admin/cleanup",          title: "정보 삭제" },
  { prefix: "/admin/batch",            title: "배치" },
  { prefix: "/admin",                  title: "대시보드" }, // 가장 짧음 — 항상 마지막
];

function resolveAdminTitle(pathname: string): string {
  // 가장 긴 prefix 우선 매칭 — 위 배열의 순서가 곧 우선순위
  const found = TITLE_BY_PATH.find((m) => pathname === m.prefix || pathname.startsWith(m.prefix + "/"));
  return found?.title ?? "시스템 관리";
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isSystemAdmin, isLoading } = useIsSystemAdmin();
  const router   = useRouter();
  const pathname = usePathname();
  const title    = resolveAdminTitle(pathname);

  // 로딩 완료 + 관리자 아님 → 대시보드로 우회
  // (404 대신 리디렉트 — 주소표시줄에 /admin 이 남지 않도록)
  useEffect(() => {
    if (!isLoading && !isSystemAdmin) {
      router.replace("/dashboard");
    }
  }, [isLoading, isSystemAdmin, router]);

  // 로딩 중 또는 비관리자 → 빈 화면 (flash 방지)
  if (isLoading || !isSystemAdmin) {
    return (
      <div style={{ padding: 40, color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }}>
        권한 확인 중…
      </div>
    );
  }

  return (
    // maxWidth 제거 — 화면을 끝까지 사용 (관리자는 데이터 밀도가 높아 넓은 게 유리).
    // 이전에는 maxWidth: 1400 + margin: "0 auto" 로 중앙 정렬했으나 사용자가
    // 광폭 모니터에서 양쪽 빈 공간이 답답하다고 피드백 → 풀 와이드로 변경.
    <div style={{ padding: "24px 32px" }}>
      {/* 상단 헤더 — 시스템 관리 영역임을 명확히 표시.
          메뉴 이동은 LNB 의 "시스템 관리" 그룹으로 일원화. */}
      <div
        style={{
          display:      "flex",
          alignItems:   "center",
          gap:          12,
          marginBottom: 20,
        }}
      >
        <span
          style={{
            display:      "inline-flex",
            alignItems:   "center",
            gap:          6,
            padding:      "3px 10px",
            fontSize:     "var(--text-xs)",
            fontWeight:   700,
            background:   "var(--color-warning-subtle)",
            color:        "var(--color-warning)",
            border:       "1px solid var(--color-warning-border)",
            borderRadius: "var(--radius-sm)",
            letterSpacing:"0.04em",
          }}
        >
          SYSTEM ADMIN
        </span>
        <h1 style={{ margin: 0, fontSize: "var(--text-xl)", color: "var(--color-text-heading)" }}>
          {title}
        </h1>
      </div>

      {children}
    </div>
  );
}
