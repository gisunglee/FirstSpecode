"use client";

/**
 * MainLayout — 시스템 공통 레이아웃 래퍼 (PID-00060, PID-00027)
 *
 * 역할:
 *   - GNB(상단) + LNB(좌측) + 메인 컨텐츠 + StatusBar(하단) 배치
 *   - 마운트 시 저장된 테마를 document.documentElement에 반영
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import GNB from "./GNB";
import LNB from "./LNB";
import StatusBar from "./StatusBar";
import { useAppStore } from "@/store/appStore";
import { authFetch } from "@/lib/authFetch";

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
