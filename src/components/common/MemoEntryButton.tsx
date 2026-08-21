"use client";

/**
 * MemoEntryButton — 메모 진입 아이콘 (연결 개수 배지 + 팝오버 토글)
 *
 * 역할:
 *   - refTyCode+refId 전달 시: 엔티티 상세화면 아이콘 (예: 요구사항 상세 헤더)
 *   - 둘 다 없으면: 프로젝트 전역 진입점 (사이드바 하단 고정 아이콘)
 *
 * 사용:
 *   <MemoEntryButton projectId={projectId} refTyCode="REQUIREMENT" refId={reqId} />
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { MenuIcon } from "@/components/layout/menuIcons";
import MemoPopover from "./MemoPopover";
import MemoEditModal from "./MemoEditModal";

type Props = {
  projectId:  string;
  refTyCode?: string;
  refId?:     string;
  refLabel?:  string;
  // rail: 사이드바 하단 고정 아이콘(레이블 텍스트 포함) / inline: 엔티티 상세 헤더의 원형 아이콘 버튼
  variant?:   "rail" | "inline";
};

export default function MemoEntryButton({ projectId, refTyCode, refId, variant = "inline" }: Props) {
  const [open, setOpen] = useState(false);
  // 목록 팝오버에서 타일/새 메모를 클릭하면 여기 세팅됨 — 별도의 더 큰 편집 모달이 뜨고,
  // 목록 팝오버는 그 뒤에 계속 열려있는 채로 남는다(합의된 동작)
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);
  const router  = useRouter();
  const btnRef  = useRef<HTMLButtonElement>(null);

  const qs = refTyCode && refId ? `?refType=${refTyCode}&refId=${refId}` : "";
  // 배지 카운트 — 팝오버가 열려있지 않아도 항상 최신 개수 표시
  const { data } = useQuery({
    queryKey: ["memos-count", projectId, refTyCode ?? null, refId ?? null],
    queryFn: () =>
      authFetch<{ data: { items: { memoId: string }[] } }>(`/api/projects/${projectId}/memos${qs}`).then((r) => r.data),
    staleTime: 30_000,
  });
  const count = data?.items.length ?? 0;

  return (
    // rail 변형은 폭을 100%로 명시 — inline-flex(내용 크기에 맞춤)만으로는 버튼의
    // width:100%가 부모 기준을 못 잡아 좁은 사이드바 레일 안에서 아이콘이 찌그러져 보였음
    <div style={{ position: "relative", display: "inline-flex", width: variant === "rail" ? "100%" : undefined }}>
      {variant === "rail" ? (
        <button
          ref={btnRef}
          onClick={() => setOpen((v) => !v)}
          title="메모"
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            padding: "10px 4px", width: "100%", border: "none", background: "none", cursor: "pointer",
            borderTop: "1px solid var(--color-border-subtle)",
            color: "var(--color-text-secondary)",
          }}
        >
          <span style={{ position: "relative" }}>
            <MenuIcon name="i_memo" size={19} />
            {count > 0 && <CountBadge count={count} corner="top-right" />}
          </span>
          <span style={{ fontSize: 10.5, fontWeight: 600 }}>메모</span>
        </button>
      ) : (
        <button
          ref={btnRef}
          onClick={() => setOpen((v) => !v)}
          title="연결된 메모 보기"
          style={{
            width: 28, height: 28, borderRadius: 7, position: "relative",
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            border: "1px solid var(--color-border)", background: "var(--color-bg-surface)",
            color: "var(--color-text-secondary)",
          }}
        >
          <MenuIcon name="i_memo" size={14} />
          {count > 0 && <CountBadge count={count} corner="corner" />}
        </button>
      )}

      {open && btnRef.current && (
        <MemoPopover
          projectId={projectId}
          refTyCode={refTyCode}
          refId={refId}
          placement={variant}
          anchorEl={btnRef.current}
          onClose={() => setOpen(false)}
          onOpenMemo={(id) => setEditingMemoId(id)}
          onNavigate={(path) => { setOpen(false); router.push(path); }}
        />
      )}

      {/* 목록 팝오버와 별개로 뜨는 추가/편집 전용 모달 — 목록은 뒤에 계속 열려있음 */}
      {editingMemoId && (
        <MemoEditModal
          projectId={projectId}
          memoId={editingMemoId}
          presetRefType={editingMemoId === "new" && refTyCode ? refTyCode : undefined}
          presetRefId={editingMemoId === "new" && refId ? refId : undefined}
          onClose={() => setEditingMemoId(null)}
          // 저장해도 모달은 안 닫음(피드백) — 신규였다면 실제 id로 바꿔서 계속 편집
          onSaved={(savedId) => setEditingMemoId(savedId)}
        />
      )}
    </div>
  );
}

function CountBadge({ count, corner }: { count: number; corner: "top-right" | "corner" }) {
  const pos = corner === "top-right"
    ? { top: -6, right: -8 }
    : { top: -5, right: -5 };
  return (
    <span style={{
      position: "absolute", ...pos,
      // accent(amber)는 라이트/다크 테마에서 값이 동일해서, 배지 글자색도 테마 무관하게
      // 항상 어두운 색으로 고정 — text-inverse를 쓰면 라이트 테마에서 흰 글자가 amber 위에서 흐려짐
      background: "var(--color-accent)", color: "#1e2135",
      fontSize: 9, fontWeight: 700, minWidth: 14, height: 14, borderRadius: 999,
      display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
      lineHeight: 1,
    }}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
