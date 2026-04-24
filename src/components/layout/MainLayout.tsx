"use client";

/**
 * MainLayout — 시스템 공통 레이아웃 래퍼 (PID-00060, PID-00027)
 *
 * 역할:
 *   - GNB(상단) + LNB(좌측) + 메인 컨텐츠 + StatusBar(하단) 배치
 *   - 마운트 시 저장된 테마를 document.documentElement에 반영
 *   - 마운트 시 미인증 상태면 /auth/login 으로 리다이렉트
 *   - 마운트 시 미확인 제거 안내 이력 조회 → 있으면 모달 표시 (PID-00027)
 *
 * 레이아웃 구조:
 *   <html data-theme="...">
 *     <body>
 *       <GNB />                    ← 상단 (height-menubar: 28px)
 *       <div style="flex:1">
 *         <LNB />                  ← 좌측 (sidebar-width: 200px)
 *         <main>                   ← 메인 워크스페이스 (AR-00097)
 *           {children}
 *         </main>
 *       </div>
 *       <StatusBar />              ← 하단 (height-statusbar: 22px)
 *       <RemovalNoticeModal />     ← 제거 안내 (FID-00090, FID-00091)
 *     </body>
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import GNB from "./GNB";
import LNB from "./LNB";
import StatusBar from "./StatusBar";
import GlobalSearchDialog from "@/components/search/GlobalSearchDialog";
import SupportSessionBanner from "@/components/admin/SupportSessionBanner";
import { useAppStore } from "@/store/appStore";
import { authFetch } from "@/lib/authFetch";
import { useTripleClickSidebarToggle } from "@/hooks/useTripleClickSidebarToggle";
import { useGlobalSearchShortcut } from "@/hooks/useGlobalSearchShortcut";

type RemovalNotice = {
  noticeId:    string;
  projectName: string;
  removedAt:   string;
};

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { theme } = useAppStore();
  const queryClient = useQueryClient();
  const router = useRouter();

  // 어디서든 빠르게 3연타 클릭하면 사이드바 접기/펼치기
  useTripleClickSidebarToggle();

  // 어디서든 Ctrl+K (Mac: Cmd+K) 로 전역 검색 토글
  useGlobalSearchShortcut();

  // 인증 상태 — 토큰 확인 전까지 화면 미표시 (레이아웃 flash 방지)
  const [authChecked, setAuthChecked] = useState(false);

  // 마운트 시 access_token 존재 여부로 인증 확인
  // sessionStorage는 SSR에서 접근 불가 → useEffect(클라이언트 전용)에서 처리
  useEffect(() => {
    const token = sessionStorage.getItem("access_token");
    if (!token) {
      // 토큰 없으면 로그인 페이지로 이동
      router.replace("/auth/login");
      return;
    }
    setAuthChecked(true);
  }, [router]);

  // 마운트/테마 변경 시 data-theme 동기화
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // ── 제거 안내 이력 조회 (FID-00090) ─────────────────────────────────────────
  // 로그인 후 레이아웃이 마운트될 때 한 번 조회
  // staleTime 0 → 매 마운트마다 재조회 (로그인 직후 처리)
  const [modalVisible, setModalVisible] = useState(false);

  const { data: noticesData } = useQuery({
    queryKey: ["removal-notices"],
    queryFn:  () =>
      authFetch<{ data: { notices: RemovalNotice[] } }>("/api/member/removal-notices")
        .then((r) => r.data),
    staleTime: 0,
    retry: false,
  });

  // 미확인 안내가 있으면 모달 표시
  useEffect(() => {
    if (noticesData?.notices && noticesData.notices.length > 0) {
      setModalVisible(true);
    }
  }, [noticesData]);

  // ── 제거 안내 확인 처리 (FID-00091) ──────────────────────────────────────────
  const confirmMutation = useMutation({
    mutationFn: () =>
      authFetch("/api/member/removal-notices/confirm", { method: "POST" }),
    onSuccess: () => {
      setModalVisible(false);
      queryClient.invalidateQueries({ queryKey: ["removal-notices"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const notices = noticesData?.notices ?? [];

  // 인증 확인 완료 전까지 아무것도 렌더링하지 않음 (미인증 화면 flash 방지)
  if (!authChecked) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        background: "var(--color-bg-root)",
      }}
    >
      {/* 상단 GNB */}
      <GNB />

      {/* 시스템 관리자 지원 세션 배너 — 현재 경로가 활성 지원 세션의 프로젝트일 때만 표시.
          일반 사용자·지원 세션 비진행 시엔 null 반환. */}
      <SupportSessionBanner />

      {/* 중간 영역: LNB + 메인 컨텐츠 */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* 좌측 LNB */}
        <LNB />

        {/* 메인 워크스페이스 (AR-00097) */}
        <main
          style={{
            flex: 1,
            overflow: "auto",
            background: "var(--color-bg-content)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {children}
        </main>
      </div>

      {/* 하단 StatusBar */}
      <StatusBar />

      {/* 전역 검색 다이얼로그 — GNB 돋보기/Ctrl+K 로 토글. 내부에서 open 상태 구독 */}
      <GlobalSearchDialog />

      {/* PID-00027 제거 안내 모달 */}
      {modalVisible && notices.length > 0 && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 2000,
        }}>
          <div style={{
            background: "var(--color-bg-card)",
            borderRadius: "var(--radius-lg)",
            padding: "28px 32px",
            width: 400,
            maxWidth: "90vw",
            boxShadow: "0 8px 32px rgba(0,0,0,0.24)",
          }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>
              프로젝트에서 제거되었습니다.
            </h2>

            <p style={{ margin: "0 0 12px", fontSize: 14, color: "var(--color-text-secondary)" }}>
              아래 프로젝트에서 제거되었습니다.
            </p>

            <ul style={{ margin: "0 0 16px", paddingLeft: 20 }}>
              {notices.map((n) => (
                <li
                  key={n.noticeId}
                  style={{ fontSize: 14, color: "var(--color-text-primary)", marginBottom: 4 }}
                >
                  {n.projectName}
                </li>
              ))}
            </ul>

            <p style={{ margin: "0 0 24px", fontSize: 13, color: "var(--color-text-secondary)" }}>
              작성하신 데이터는 유지됩니다.
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => confirmMutation.mutate()}
                disabled={confirmMutation.isPending}
                style={{
                  padding: "8px 24px",
                  borderRadius: 6,
                  border: "none",
                  background: "var(--color-primary, #1976d2)",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {confirmMutation.isPending ? "처리 중..." : "확인"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
