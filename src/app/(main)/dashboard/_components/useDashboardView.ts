"use client";

/**
 * useDashboardView — 대시보드 뷰 모드(관리/개발자) 결정 훅
 *
 * 결정 규칙 (우선순위 위→아래):
 *   1) URL ?view=manage|me  → 명시 선택 우선 (북마크 가능)
 *   2) localStorage 마지막 선택 → 사용자 선호 기억
 *   3) 역할 자동 분기:
 *      - OWNER/ADMIN  → manage
 *      - 직무 PM/PL   → manage
 *      - 그 외        → me
 *   4) 미가입(역할 없음) → me (기본 안전값)
 *
 * 왜 이런 우선순위인가:
 *   - URL > localStorage > 자동분기 순으로 "사용자 의도가 강한 신호"부터 적용.
 *   - 역할이 변경되었거나 토글로 한 번 바꾼 경우 다음 진입에 그 선택을 따라간다.
 *
 * 반환:
 *   { view, setView }
 *     - setView 호출 시 URL 쿼리·localStorage 동시 갱신.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePermissions } from "@/hooks/useMyRole";

export type DashboardView = "manage" | "me";

const LS_KEY = "specode-dashboard-view";

// 관리뷰가 기본인 역할/직무 — 백엔드와 다른 위치에 흩어지지 않도록 한 곳에 모음.
function isManagerLikeRole(role: string | null, job: string | null): boolean {
  if (role === "OWNER" || role === "ADMIN") return true;
  if (job  === "PM"    || job  === "PL")    return true;
  return false;
}

function isDashboardView(v: unknown): v is DashboardView {
  return v === "manage" || v === "me";
}

// localStorage 안전 래퍼 — Safari 시크릿/프라이빗 모드, 쿼터 초과,
// 일부 모바일 브라우저에서 throw 가능. 실패해도 앱이 깨지지 않도록.
function lsGet(key: string): string | null {
  try { return typeof window !== "undefined" ? window.localStorage.getItem(key) : null; }
  catch { return null; }
}
function lsSet(key: string, value: string): void {
  try { if (typeof window !== "undefined") window.localStorage.setItem(key, value); }
  catch { /* 저장 실패해도 동작 자체에는 영향 없음 — 다음 진입에 자동 분기로 폴백 */ }
}

export function useDashboardView(projectId: string | null) {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { myRole, myJob, isLoading: roleLoading } = usePermissions(projectId);

  // SSR 시 window 접근 불가 → 초기값은 null, 마운트 후 결정
  // 첫 페인트는 깜빡임 방지를 위해 카드 자체가 skeleton 처리.
  const [view, setViewState] = useState<DashboardView | null>(null);

  // setView 안에서 최신 searchParams 를 참조하기 위한 ref.
  // 의존성 배열에 searchParams 를 직접 넣으면 URL 변경마다 setView 가 재생성되어
  // ViewToggle 의 onChange prop 이 매번 바뀌고 메모이제이션이 깨진다.
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  useEffect(() => {
    if (typeof window === "undefined") return;

    // ① URL 쿼리 우선
    const fromUrl = searchParams.get("view");
    if (isDashboardView(fromUrl)) {
      setViewState(fromUrl);
      // localStorage 도 함께 동기화 — 다음 진입에 같은 선택 유지
      lsSet(LS_KEY, fromUrl);
      return;
    }

    // ② localStorage
    const fromLs = lsGet(LS_KEY);
    if (isDashboardView(fromLs)) {
      setViewState(fromLs);
      return;
    }

    // ③ 역할 자동 분기 — 역할 로딩 끝나야 결정 가능
    // 로딩 중이면 view 를 null 로 두어 카드 skeleton 만 보이게 함.
    if (roleLoading) return;
    setViewState(isManagerLikeRole(myRole, myJob) ? "manage" : "me");
  }, [searchParams, myRole, myJob, roleLoading]);

  // 토글 — URL 과 localStorage 둘 다 갱신
  // 의존성은 router 만 — searchParams 는 ref 로 우회해서 함수 안정성 유지.
  const setView = useCallback(
    (next: DashboardView) => {
      setViewState(next);
      lsSet(LS_KEY, next);
      const params = new URLSearchParams(searchParamsRef.current.toString());
      params.set("view", next);
      // replace 로 히스토리 폭증 방지
      router.replace(`/dashboard?${params.toString()}`, { scroll: false });
    },
    [router]
  );

  return { view, setView, isManagerLikeUser: isManagerLikeRole(myRole, myJob) };
}
