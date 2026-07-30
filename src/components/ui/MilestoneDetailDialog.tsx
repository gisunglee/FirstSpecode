"use client";

/**
 * MilestoneDetailDialog — 마일스톤 상세보기(읽기 전용) 팝업
 *
 * 프로젝트 설정 > 일정 탭(마일스톤 섹션)과 캘린더 양쪽에서 공유하는 컴포넌트.
 * RichEditor를 readOnly로 그대로 재사용해 이미지 크기(width)를 편집 화면과 동일하게 보여준다.
 * canManage 여부와 무관하게 누구나 열람 가능(수정/삭제는 각 호출부가 별도 처리).
 */

import dynamic from "next/dynamic";

// RichEditor(TipTap)는 SSR과 맞지 않아 다른 상세 페이지들과 동일하게 동적 로드
const RichEditor = dynamic(() => import("@/components/ui/RichEditor"), { ssr: false });

export type MilestoneDetail = {
  name:    string;
  date:    string; // YYYY-MM-DD
  content: string; // HTML(RichEditor) — 비어있으면 "내용이 없습니다" 표시
};

export default function MilestoneDetailDialog({ milestone, onClose }: { milestone: MilestoneDetail; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 640, maxHeight: "85vh", overflowY: "auto", background: "var(--color-bg-card)", border: "1px solid var(--color-border-strong)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-xl)", padding: "24px 24px", display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-text-heading)" }}>{milestone.name}</h3>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}>{milestone.date}</span>
        </div>

        {milestone.content ? (
          <RichEditor value={milestone.content} onChange={() => {}} readOnly minHeight={80} />
        ) : (
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>내용이 없습니다.</p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="sp-btn sp-btn-secondary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
