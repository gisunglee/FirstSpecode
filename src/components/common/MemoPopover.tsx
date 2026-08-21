"use client";

/**
 * MemoPopover — 메모 미니 목록 팝오버
 *
 * 역할:
 *   - 최신순 타일 목록 (웹/엑셀 타입 아이콘, 공개범위 표시)
 *   - 필터: 전체보기/내 메모만, (refTyCode+refId 있을 때만) 이 항목만/전체
 *   - 타일 클릭·"새 메모" 클릭 → onOpenMemo(memoId)로 부모에 위임(MemoEditModal이 뜸).
 *     이 목록 팝오버 자신은 계속 열려있는 채로 남는다 — 상세 모달에서 저장/삭제하면
 *     memos-popover 쿼리가 무효화되어 자동으로 최신화된다.
 *   - "전체 목록 보기" → 기존 /memos 목록 화면으로 이동(같은 필터 유지)
 *
 * 사용처: MemoEntryButton (사이드바 전역 아이콘 / 엔티티 상세 아이콘 공용)
 *
 * Portal을 쓰는 이유: 사이드바 레일(.sp-rail)에 overflow-x:hidden이 걸려있어서, 부모
 * 기준 absolute 위치로 렌더링하면 레일 밖으로 나가는 순간 잘려서 안 보였다(실제 확인됨).
 * document.body에 직접 렌더링하고 anchorEl의 화면 좌표를 기준으로 위치를 계산해서
 * 어떤 조상의 overflow/트랜스폼과도 무관하게 항상 보이도록 한다.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

type MemoRow = {
  memoId:        string;
  subject:       string;
  memoTyCode:    string;
  visbltyCode:   string;
  refTyCode:     string | null;
  refId:         string | null;
  refName:       string;
  creatMberName: string;
  isMine:        boolean;
  canEdit:       boolean;
  creatDt:       string;
};

const REF_TYPE_LABEL: Record<string, string> = {
  REQUIREMENT: "요구사항",
  TASK:        "과업",
  UNIT_WORK:   "단위업무",
  SCREEN:      "화면",
  AREA:        "영역",
  FUNCTION:    "기능",
};

type Props = {
  projectId:  string;
  // 엔티티 상세에서 열었을 때만 전달 — 없으면 전역(사이드바) 진입
  refTyCode?: string;
  refId?:     string;
  // rail: 좌측 사이드바 하단 좁은 레일에서 열림 → 오른쪽으로 펼침
  // inline: 엔티티 상세 헤더 아이콘에서 열림 → 아래쪽으로 펼침
  placement?: "rail" | "inline";
  anchorEl:   HTMLElement; // 위치 계산 기준 — 진입 버튼 자신
  onClose:    () => void;
  onOpenMemo: (memoId: string) => void; // 타일/새 메모 클릭 → 별도 편집 모달 열기
  onNavigate: (path: string) => void;   // "창 크게 보기" 전용 — 실제 페이지 이동
};

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function MemoPopover({ projectId, refTyCode, refId, placement = "inline", anchorEl, onClose, onOpenMemo, onNavigate }: Props) {
  const hasRef = !!(refTyCode && refId);

  const [visFilter, setVisFilter]     = useState<"all" | "mine">("all");
  // 엔티티 상세에서 열었을 때 기본은 "이 항목만" — 전역(사이드바)에서는 이 토글 자체가 없음
  const [scopeFilter, setScopeFilter] = useState<"ref" | "all">("ref");

  const applyRef = hasRef && scopeFilter === "ref";
  const qs = new URLSearchParams();
  if (applyRef) { qs.set("refType", refTyCode!); qs.set("refId", refId!); }
  if (visFilter === "mine") qs.set("visibility", "mine");

  const { data, isLoading } = useQuery({
    queryKey: ["memos-popover", projectId, applyRef ? refTyCode : null, applyRef ? refId : null, visFilter],
    queryFn: () =>
      authFetch<{ data: { items: MemoRow[] } }>(`/api/projects/${projectId}/memos?${qs.toString()}`)
        .then((r) => r.data),
  });
  const items = data?.items ?? [];

  const fullQs = new URLSearchParams();
  if (applyRef) { fullQs.set("refType", refTyCode!); fullQs.set("refId", refId!); }

  // anchorEl 기준 화면 좌표로 위치 계산 — position:fixed + portal이라 어떤 조상의
  // overflow:hidden에도 잘리지 않는다.
  const rect = anchorEl.getBoundingClientRect();
  const posStyle: React.CSSProperties = placement === "rail"
    ? { left: rect.right + 8, bottom: window.innerHeight - rect.bottom }
    : { top: rect.bottom + 8, right: window.innerWidth - rect.right };

  return createPortal(
    <>
      {/* 바깥 클릭 시 닫힘 — 투명 풀스크린 백드롭 */}
      <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={onClose} />
      <div
        style={{
          position: "fixed",
          ...posStyle,
          width: 320, maxHeight: 520, zIndex: 201,
          background: "var(--color-bg-card)", border: "1px solid var(--color-border)",
          borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--color-border)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>메모</span>
            <button
              onClick={() => onOpenMemo("new")}
              style={{
                display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600,
                padding: "4px 9px", borderRadius: 6, cursor: "pointer",
                border: "1px solid var(--color-brand-border)",
                background: "var(--color-brand-subtle)", color: "var(--color-brand)",
              }}
            >
              + 새 메모
            </button>
          </div>

          {/* 두 필터를 한 줄에 좌우로 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <SegToggle
              options={[{ v: "all", label: "전체보기" }, { v: "mine", label: "내 메모만" }]}
              value={visFilter}
              onChange={(v) => setVisFilter(v as "all" | "mine")}
            />
            {hasRef && (
              <SegToggle
                options={[
                  { v: "ref", label: "이 항목만" },
                  { v: "all", label: "전체" },
                ]}
                value={scopeFilter}
                onChange={(v) => setScopeFilter(v as "ref" | "all")}
              />
            )}
          </div>
        </div>

        {/* 목록 */}
        <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {isLoading && (
            <div style={{ padding: "24px 8px", textAlign: "center", fontSize: 11.5, color: "var(--color-text-tertiary)" }}>불러오는 중...</div>
          )}
          {!isLoading && items.length === 0 && (
            <div style={{ padding: "24px 8px", textAlign: "center", fontSize: 11.5, color: "var(--color-text-tertiary)" }}>표시할 메모가 없습니다</div>
          )}
          {items.map((m) => (
            <button
              key={m.memoId}
              onClick={() => onOpenMemo(m.memoId)}
              style={{
                display: "flex", gap: 8, padding: "8px 9px", borderRadius: 8,
                border: "1px solid var(--color-border)", background: "var(--color-bg-surface)",
                cursor: "pointer", textAlign: "left", position: "relative",
              }}
            >
              <span style={{
                width: 4, borderRadius: 2, flexShrink: 0, alignSelf: "stretch",
                background: m.memoTyCode === "EXCEL" ? "var(--color-success)" : "var(--color-brand)",
              }} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m.subject || "(제목 없음)"}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--color-text-tertiary)" }}>
                  <span>{m.memoTyCode === "EXCEL" ? "엑셀형" : "웹"}</span>
                  <span>·</span>
                  {m.refTyCode && (
                    <>
                      <span style={{ padding: "1px 6px", borderRadius: 999, background: "var(--color-accent-subtle)", color: "var(--color-accent-hover)" }}>
                        {REF_TYPE_LABEL[m.refTyCode] ?? m.refTyCode}
                      </span>
                      <span>·</span>
                    </>
                  )}
                  <span>{m.creatMberName}</span>
                  <span>·</span>
                  <span>{formatDateShort(m.creatDt)}</span>
                  {m.visbltyCode === "PRIVATE" && <span title="나만보기">🔒</span>}
                </span>
              </span>
            </button>
          ))}
        </div>

        {/* 창 크게 보기 */}
        <button
          onClick={() => onNavigate(`/projects/${projectId}/memos?${fullQs.toString()}`)}
          style={{
            padding: "9px 12px", fontSize: 11.5, fontWeight: 600, textAlign: "center",
            border: "none", borderTop: "1px solid var(--color-border)", cursor: "pointer",
            background: "var(--color-bg-elevated)", color: "var(--color-text-secondary)",
          }}
        >
          창 크게 보기 →
        </button>
      </div>
    </>,
    document.body,
  );
}

// ── 세그먼트 토글(작은 2버튼 스위치) ────────────────────────────────────────
function SegToggle<T extends string>({ options, value, onChange }: {
  options: { v: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden", width: "fit-content" }}>
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          style={{
            fontSize: 10.5, fontWeight: 600, padding: "4px 9px", border: "none", cursor: "pointer",
            background: value === o.v ? "var(--color-brand)" : "var(--color-bg-elevated)",
            color:      value === o.v ? "var(--color-text-inverse)" : "var(--color-text-secondary)",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
