"use client";

/**
 * DayCard — 하루치 업무일지 미니 카드 (계획/결과 2단 구성)
 *
 * TodayTab 이 한 주(7장)를 그리드로 늘어놓는 단위. 카드 하나가 독립적으로
 * 자기 날짜의 DAILY 로그를 조회·저장한다 — 날짜별로 로딩/저장 상태가 서로 얽히지
 * 않도록 각 카드가 자기 상태를 스스로 들고 있다(부모가 날짜별 상태를 모아 관리하지 않음).
 *
 * "계획" = 내가 직접 입력한 체크리스트(완료 체크 = 오늘 이 항목을 끝냈는가).
 * "결과" = 하루를 마무리하며 남기는 짧은 요약/특이사항 텍스트.
 *
 * "일감 태그"(화면/기능/과업 참고용 연결)는 여기 없다 — WeekPlanRow로 옮겼다. 일이 보통
 * 한 주~한 달 단위로 굴러가는데 매일 같은 일감을 반복해서 태그하는 게 의미가 없다는
 * 피드백으로, 일감 태그는 주 단위로 한 번만 붙이도록 통합했다.
 *
 * 조회·뮤테이션 로직은 useDayLog 훅으로 분리(2026-07-24) — 한때 있던 "리스트형" 보기와
 * 공유하려던 것인데, 리스트형 자체가 삭제되어 지금은 DayCard 단독 사용.
 *
 * 계획 체크리스트는 maxHeight가 아니라 고정 height로 스크롤한다(2026-07-24e) — 할일이
 * 적은 날은 목록이 짧아져서 "오늘 작업 결과" 라벨이 카드마다 다른 높이에서 시작하는 문제가
 * 있었다. 항목 수와 무관하게 항상 같은 높이(5개 분량)를 차지해야 한 주 7장의 "오늘 작업
 * 결과"가 수평으로 나란히 맞는다.
 */

import { useDayLog } from "./useDayLog";
import EmptyHighlightTextarea from "./EmptyHighlightTextarea";

const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

function formatDayHeading(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return `${dateStr.slice(5, 7)}/${dateStr.slice(8, 10)} (${WEEKDAY_LABEL[d.getUTCDay()]})`;
}

export default function DayCard({ projectId, date, isToday }: { projectId: string; date: string; isToday: boolean }) {
  const {
    isLoading, todoItems, noteCn, setNoteCn, newItemText, setNewItemText,
    saveNoteMutation, addItemMutation, toggleItemMutation, deleteItemMutation, dailyLog,
    copyPreviousIncompleteMutation,
  } = useDayLog(projectId, date);

  return (
    <div
      style={{
        width: 420, flex: "0 0 420px",
        // "오늘" 카드 강조 — 배경까지 틴트하니 카드 전체가 튀어서 부담스럽다는 피드백으로
        // 테두리(+날짜 텍스트 컬러)만 강조하고 배경은 다른 카드와 동일한 흰 배경 유지.
        border: `${isToday ? 2 : 1}px solid ${isToday ? "var(--color-brand)" : "var(--color-border)"}`,
        borderRadius: "var(--radius-card)",
        background: "var(--color-bg-card)",
        display: "flex", flexDirection: "column",
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          padding: "8px 12px", display: "flex", alignItems: "center", gap: 8,
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        {/* 날짜가 잘 안 보인다는 피드백으로 카드 헤더 폰트 한 단계 키움 */}
        <span style={{ fontSize: "var(--text-base)", fontWeight: 700, color: isToday ? "var(--color-brand)" : "var(--color-text-primary)" }}>
          {formatDayHeading(date)}{isToday && " · 오늘"}
        </span>
        {todoItems.length > 0 && (
          <span style={{ marginLeft: "auto", fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)" }}>
            {todoItems.filter((i) => i.doneYn === "Y").length}/{todoItems.length}
          </span>
        )}
        <button
          type="button"
          className="sp-btn sp-btn-ghost sp-btn-xs"
          title="전일 미완료 항목 복사"
          disabled={copyPreviousIncompleteMutation.isPending}
          onClick={() => copyPreviousIncompleteMutation.mutate()}
          style={{ marginLeft: todoItems.length > 0 ? 0 : "auto" }}
        >
          전일 복사
        </button>
      </div>

      {isLoading ? (
        <div style={{ padding: 12, fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>불러오는 중...</div>
      ) : (
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {/* 계획 */}
          <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--color-text-secondary)", letterSpacing: "0.04em" }}>
            계획
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 3, height: 140, overflowY: "auto" }}>
            {todoItems.length === 0 && (
              <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-disabled)" }}>등록한 할일이 없습니다.</div>
            )}
            {todoItems.map((item) => (
              <label key={item.itemId} className="sp-checkbox-wrap" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  className="sp-checkbox"
                  type="checkbox"
                  checked={item.doneYn === "Y"}
                  onChange={(e) => toggleItemMutation.mutate({ itemId: item.itemId, doneYn: e.target.checked ? "Y" : "N" })}
                />
                <span
                  style={{
                    flex: 1, fontSize: "var(--text-sm)",
                    textDecoration: item.doneYn === "Y" ? "line-through" : "none",
                    color: item.doneYn === "Y" ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
                  }}
                >
                  {item.itemCn}
                </span>
                <button
                  type="button"
                  className="sp-btn sp-btn-ghost sp-btn-xs"
                  onClick={() => deleteItemMutation.mutate(item.itemId)}
                  title="삭제"
                  style={{ padding: "1px 5px" }}
                >
                  ✕
                </button>
              </label>
            ))}
          </div>

          <div style={{ display: "flex", gap: 5 }}>
            <input
              className="sp-input"
              placeholder="할일 입력 후 Enter"
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newItemText.trim()) {
                  addItemMutation.mutate(newItemText.trim());
                }
              }}
              style={{ flex: 1, height: 28, fontSize: "var(--text-sm)" }}
            />
            <button
              type="button"
              className="sp-btn sp-btn-secondary sp-btn-xs"
              disabled={!newItemText.trim() || addItemMutation.isPending}
              onClick={() => addItemMutation.mutate(newItemText.trim())}
            >
              추가
            </button>
          </div>

          <div style={{ borderTop: "1px solid var(--color-border-subtle)", marginTop: 2, paddingTop: 8 }}>
            {/* 결과 — "결과"만으로는 뭘 적는 칸인지 애매하다는 피드백으로 "오늘 작업 결과"로 구체화 */}
            <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--color-text-secondary)", letterSpacing: "0.04em", marginBottom: 4 }}>
              오늘 작업 결과
            </div>
            <EmptyHighlightTextarea
              rows={5}
              message="오늘 작업 결과를 입력해 주세요."
              value={noteCn}
              onChange={setNoteCn}
            />
            {noteCn !== (dailyLog?.noteCn ?? "") && (
              <div style={{ marginTop: 4, textAlign: "right" }}>
                <button
                  type="button"
                  className="sp-btn sp-btn-secondary sp-btn-xs"
                  disabled={saveNoteMutation.isPending}
                  onClick={() => saveNoteMutation.mutate()}
                >
                  저장
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
