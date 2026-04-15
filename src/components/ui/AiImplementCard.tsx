"use client";

/**
 * AiImplementCard — AI 구현 카드 (공통 컴포넌트)
 *
 * 역할:
 *   - AI 작업 패널의 "AI 구현" 카드 1개 단위로 렌더링
 *   - 클릭 시 ImplTargetDialog → ImplRequestPopup 흐름으로 구현요청 처리
 *   - 스냅샷(tb_sp_impl_snapshot)에는 UW/SCR/AR/FN 모두 저장되므로
 *     어느 계층에서 호출해도 동일한 동작 가능
 *
 * 사용처:
 *   - 기능 / 영역 / 화면 / 단위업무 상세 페이지의 AI 작업 패널
 *
 * Props:
 *   - projectId:  프로젝트 ID
 *   - refType:    카드를 표시하는 페이지의 엔티티 유형
 *   - refId:      카드를 표시하는 페이지의 엔티티 ID
 *   - implInfo:   이미 존재하는 IMPLEMENT 태스크 정보 (없으면 null/undefined → "실행")
 *                 상위 API에서 스냅샷 경유로 조회된 값 전달
 *   - onInvalidate: 최종 요청 성공 시 호출 (상위 쿼리 무효화용)
 */

import { useState } from "react";
import ImplTargetDialog from "@/components/ui/ImplTargetDialog";
import ImplRequestPopup from "@/components/ui/ImplRequestPopup";
import AiTaskDetailDialog from "@/components/ui/AiTaskDetailDialog";
import AiTaskHistoryDialog from "@/components/ui/AiTaskHistoryDialog";

// ── 상수 ──────────────────────────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  PENDING: "#f57c00",
  IN_PROGRESS: "#1565c0",
  DONE: "#2e7d32",
  APPLIED: "#6a1b9a",
  REJECTED: "#c62828",
  FAILED: "#c62828",
  TIMEOUT: "#757575",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "대기 중",
  IN_PROGRESS: "처리 중",
  DONE: "완료",
  APPLIED: "적용됨",
  REJECTED: "반려",
  FAILED: "실패",
  TIMEOUT: "시간 초과",
};

type NodeType = "UNIT_WORK" | "SCREEN" | "AREA" | "FUNCTION";

type Props = {
  projectId:   string;
  refType:     NodeType;
  refId:       string;
  implInfo?:   { aiTaskId: string; status: string } | null;
  onInvalidate?: () => void;
};

// ── 컴포넌트 ──────────────────────────────────────────────────────────────────

export default function AiImplementCard({ projectId, refType, refId, implInfo, onInvalidate }: Props) {
  const [implTargetOpen, setImplTargetOpen] = useState(false);
  const [implRequestParams, setImplRequestParams] = useState<{
    entryType: string; entryId: string; functionIds: string[];
  } | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const dotColor = implInfo ? (STATUS_DOT[implInfo.status] ?? "#ccc") : "#ccc";
  const statusLabel = implInfo ? (STATUS_LABEL[implInfo.status] ?? implInfo.status) : "-";

  return (
    <>
      <div className="ai-task-card" style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 14px", borderRadius: 8,
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-muted)",
      }}>
        {/* 아이콘 */}
        <div style={{
          width: 36, height: 36, borderRadius: 8, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "#e1f5fe", fontSize: 18,
        }}>
          ⚡
        </div>

        {/* 레이블 + 설명 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>
            AI 구현
          </span>
          <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2, lineHeight: 1.4 }}>
            구현 대상 선택 후 AI에게 구현 요청
          </div>
        </div>

        {/* 상태 + 버튼 */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: dotColor, fontWeight: 600, whiteSpace: "nowrap" }}>
              {statusLabel}
            </span>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {implInfo && (
              <button onClick={() => setDetailTaskId(implInfo.aiTaskId)} title="내용 보기" style={miniBtn}>
                내용
              </button>
            )}
            <button
              onClick={() => setImplTargetOpen(true)}
              style={{
                ...miniBtn,
                background: "rgba(103,80,164,0.1)",
                color: "rgba(103,80,164,0.95)",
                border: "1px solid rgba(103,80,164,0.3)",
                fontWeight: 700,
              }}
            >
              {implInfo ? "재 요청" : "실행"}
            </button>
            {implInfo && (
              <button
                onClick={() => setHistoryOpen(true)}
                title="이력 목록"
                style={{ ...miniBtn, fontSize: 13, padding: "2px 6px", lineHeight: 1 }}
              >
                ☰
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 구현 대상 선택 팝업 */}
      {implTargetOpen && (
        <ImplTargetDialog
          projectId={projectId}
          refType={refType}
          refId={refId}
          onClose={() => setImplTargetOpen(false)}
          onImplRequest={(params) => {
            // ImplTargetDialog는 유지한 채 프롬프트 미리보기 팝업 열기
            setImplRequestParams(params);
          }}
        />
      )}

      {/* 프롬프트 미리보기 + 최종 요청 팝업 */}
      {implRequestParams && (
        <ImplRequestPopup
          projectId={projectId}
          entryType={implRequestParams.entryType as NodeType}
          entryId={implRequestParams.entryId}
          functionIds={implRequestParams.functionIds}
          onClose={() => setImplRequestParams(null)}
          onSubmitted={() => {
            setImplRequestParams(null);
            setImplTargetOpen(false);
            onInvalidate?.();
          }}
        />
      )}

      {/* 내용 보기 상세 팝업 */}
      {detailTaskId && (
        <AiTaskDetailDialog
          projectId={projectId}
          taskId={detailTaskId}
          onClose={() => setDetailTaskId(null)}
          onApplied={() => { setDetailTaskId(null); onInvalidate?.(); }}
          onRejected={() => { setDetailTaskId(null); onInvalidate?.(); }}
        />
      )}

      {/* 이력 목록 팝업 — IMPLEMENT는 스냅샷 경유이므로 refType는 snapshotRefId 필터용 힌트 */}
      {historyOpen && (
        <AiTaskHistoryDialog
          projectId={projectId}
          refType={refType as "AREA" | "FUNCTION" | "UNIT_WORK"}
          refId={refId}
          taskType="IMPLEMENT"
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const miniBtn: React.CSSProperties = {
  padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 600,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)", cursor: "pointer", whiteSpace: "nowrap",
};
