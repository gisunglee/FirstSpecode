"use client";

/**
 * SettingsHistoryDialog — 버전 이력 비교 다이얼로그 (공통)
 *
 * tb_pj_settings_history 테이블의 이력을 좌측 버전 목록 + 우측 side-by-side diff로 표시.
 * 2개 버전을 선택하면 라인 단위 diff가 표시됨.
 *
 * 사용법:
 *   <SettingsHistoryDialog
 *     open={open}
 *     onClose={onClose}
 *     projectId={projectId}
 *     itemName="단위업무 설명"        ← chg_item_nm 필터
 *     currentValue={form.description} ← 현재 편집 중인 값 (선택적)
 *     title="버전 이력 비교"
 *   />
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type HistoryItem = {
  histId:    string;
  version:   number;
  changedBy: string;
  changedAt: string;
  afterVal:  string;
  beforeVal: string;
};

// diff 표시용 행
type DisplayRow = {
  leftNum:  number | null;
  leftText: string | null;
  leftType: "same" | "del" | "ins" | null;
  rightNum:  number | null;
  rightText: string | null;
  rightType: "same" | "del" | "ins" | null;
};

export type SettingsHistoryDialogProps = {
  open:          boolean;
  onClose:       () => void;
  projectId:     string;
  itemName:      string;
  currentValue?: string;
  title?:        string;
};

// ── 공통 컴포넌트 ─────────────────────────────────────────────────────────────

export default function SettingsHistoryDialog({
  open,
  onClose,
  projectId,
  itemName,
  currentValue = "",
  title = "버전 이력 비교",
}: SettingsHistoryDialogProps) {
  const queryClient = useQueryClient();

  // 선택된 버전 IDs (최대 2개)
  // "current"는 현재 편집 중인 값을 의미하는 특수 ID
  const [selected, setSelected] = useState<string[]>(["current"]);

  // 최초 자동 선택 여부 추적 — 팝업이 다시 열릴 때마다 리셋
  const autoSelectedRef = useRef(false);

  // ── 이력 조회 ──────────────────────────────────────────────────────────────
  const queryKey = ["settings-history", projectId, itemName];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      authFetch<{ data: { items: HistoryItem[] } }>(
        `/api/projects/${projectId}/settings-history?itemName=${encodeURIComponent(itemName)}`
      ).then((r) => r.data.items),
    enabled: open,
  });
  const items = data ?? [];

  // 팝업이 열릴 때마다 선택 초기화
  useEffect(() => {
    if (open) {
      setSelected(["current"]);
      autoSelectedRef.current = false;
    }
  }, [open]);

  // 이력 데이터 로드 완료 시 첫 번째(최신) 이력을 자동 선택
  // open도 deps에 포함: 캐시된 데이터가 있을 때 팝업이 다시 열려도 effect가 실행되도록
  useEffect(() => {
    if (!open || autoSelectedRef.current || items.length === 0) return;
    autoSelectedRef.current = true;
    setSelected(["current", items[0].histId]);
  }, [open, items]);

  // ── 삭제 뮤테이션 ──────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (histId: string) =>
      authFetch(`/api/projects/${projectId}/settings-history/${histId}`, { method: "DELETE" }),
    onSuccess: (_, histId) => {
      toast.success("이력이 삭제되었습니다.");
      // 삭제된 항목이 선택돼 있었으면 선택 해제
      setSelected((prev) => prev.filter((id) => id !== histId));
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 체크박스 토글 ──────────────────────────────────────────────────────────
  function toggleSelect(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) {
        // 2개 초과 선택 불가: 가장 오래된 선택(prev[0])을 제거하고 새 항목 추가
        return [prev[1], id];
      }
      return [...prev, id];
    });
  }

  // ── 선택된 두 버전의 텍스트 해석 ────────────────────────────────────────────
  function getValueById(id: string): string {
    if (id === "current") return currentValue;
    return items.find((it) => it.histId === id)?.afterVal ?? "";
  }

  function getLabelById(id: string): string {
    if (id === "current") return "현재";
    const it = items.find((x) => x.histId === id);
    return it ? `v${it.version}` : "?";
  }

  // 두 버전 중 오래된 것이 "이전(left)", 최신이 "이후(right)"
  const [leftId, rightId] = useMemo(() => {
    if (selected.length < 2) return [null, null];

    const order = (id: string) => {
      if (id === "current") return Infinity;
      const it = items.find((x) => x.histId === id);
      return it ? it.version : 0;
    };

    const [a, b] = selected;
    return order(a) <= order(b) ? [a, b] : [b, a];
  }, [selected, items]);

  // ── diff 계산 ──────────────────────────────────────────────────────────────
  const diffRows = useMemo<DisplayRow[]>(() => {
    if (!leftId || !rightId) return [];
    return buildDisplayRows(getValueById(leftId), getValueById(rightId));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftId, rightId, currentValue, items]);

  // 변경 통계
  const { adds, dels } = useMemo(() => {
    let adds = 0, dels = 0;
    diffRows.forEach((r) => {
      if (r.rightType === "ins") adds++;
      if (r.leftType  === "del") dels++;
    });
    return { adds, dels };
  }, [diffRows]);

  // ── 날짜 포맷 ──────────────────────────────────────────────────────────────
  function fmt(iso: string) {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  if (!open) return null;

  // ── 렌더 ───────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 2000,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background:    "var(--color-bg-card)",
          border:        "1px solid var(--color-border)",
          borderRadius:  10,
          width:         "min(1400px, 96vw)",
          height:        "min(780px, 90vh)",
          display:       "flex",
          flexDirection: "column",
          boxShadow:     "0 12px 48px rgba(0,0,0,0.25)",
          overflow:      "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 팝업 헤더 ── */}
        <div style={{
          display:       "flex",
          alignItems:    "center",
          justifyContent:"space-between",
          padding:       "16px 24px",
          borderBottom:  "1px solid var(--color-border)",
          flexShrink:    0,
          background:    "var(--color-bg-base)",
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {title}
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "var(--color-text-secondary)", lineHeight: 1, padding: "0 4px" }}
          >
            ×
          </button>
        </div>

        {/* ── 바디: 좌측 목록 + 우측 diff ── */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

          {/* ── 좌측: 버전 목록 ── */}
          <div style={{
            width:        280,
            flexShrink:   0,
            borderRight:  "1px solid var(--color-border)",
            display:      "flex",
            flexDirection:"column",
            overflow:     "hidden",
          }}>
            <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
              2개를 선택하면 비교가 표시됩니다
            </div>

            <div style={{ overflowY: "auto", flex: 1 }}>
              {/* 현재 */}
              <VersionRow
                id="current"
                label="현재"
                subLabel="편집 중인 내용"
                badge="현재"
                badgeColor="#1976d2"
                checked={selected.includes("current")}
                onToggle={() => toggleSelect("current")}
                showDelete={false}
              />

              {/* 이력 목록 */}
              {isLoading ? (
                <div style={{ padding: "16px", fontSize: 12, color: "var(--color-text-secondary)", textAlign: "center" }}>
                  불러오는 중...
                </div>
              ) : items.length === 0 ? (
                <div style={{ padding: "16px", fontSize: 12, color: "var(--color-text-secondary)", textAlign: "center" }}>
                  저장된 이력이 없습니다
                </div>
              ) : (
                items.map((item) => (
                  <VersionRow
                    key={item.histId}
                    id={item.histId}
                    label={`v${item.version}`}
                    subLabel={fmt(item.changedAt)}
                    badge={item.changedBy}
                    badgeColor="#555"
                    checked={selected.includes(item.histId)}
                    onToggle={() => toggleSelect(item.histId)}
                    showDelete={true}
                    onDelete={() => {
                      if (confirm(`v${item.version} 이력을 삭제하시겠습니까?`)) {
                        deleteMutation.mutate(item.histId);
                      }
                    }}
                    deleteDisabled={deleteMutation.isPending}
                  />
                ))
              )}
            </div>
          </div>

          {/* ── 우측: diff 뷰 ── */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {selected.length < 2 ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-secondary)", fontSize: 13 }}>
                좌측에서 비교할 버전을 2개 선택하세요
              </div>
            ) : (
              <>
                {/* diff 헤더 */}
                <div style={{
                  padding:       "10px 16px",
                  borderBottom:  "1px solid var(--color-border)",
                  display:       "flex",
                  alignItems:    "center",
                  gap:           10,
                  flexShrink:    0,
                  background:    "var(--color-bg-base)",
                }}>
                  <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>±</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
                    {adds + dels}
                  </span>
                  {/* 변경 블록 바 */}
                  <div style={{ display: "flex", gap: 2 }}>
                    {Array.from({ length: Math.min(adds, 10) }).map((_, i) => (
                      <div key={`a${i}`} style={{ width: 10, height: 10, borderRadius: 2, background: "#4caf50" }} />
                    ))}
                    {Array.from({ length: Math.min(dels, 10) }).map((_, i) => (
                      <div key={`d${i}`} style={{ width: 10, height: 10, borderRadius: 2, background: "#ef9a9a" }} />
                    ))}
                  </div>
                  <span style={{ fontSize: 12, color: "#4caf50", marginLeft: 4 }}>+{adds}</span>
                  <span style={{ fontSize: 12, color: "#e53935" }}>-{dels}</span>
                </div>

                {/* diff 컬럼 헤더 */}
                <div style={{
                  display:      "grid",
                  gridTemplateColumns: "1fr 1fr",
                  borderBottom: "1px solid var(--color-border)",
                  flexShrink:   0,
                }}>
                  <div style={{ padding: "6px 12px 6px 44px", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", borderRight: "1px solid var(--color-border)" }}>
                    {getLabelById(leftId!)} (이전)
                  </div>
                  <div style={{ padding: "6px 12px 6px 44px", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>
                    {getLabelById(rightId!)} (이후)
                  </div>
                </div>

                {/* diff 내용 */}
                <div style={{ flex: 1, overflowY: "auto", fontFamily: "'JetBrains Mono', 'Consolas', monospace", fontSize: 12 }}>
                  {diffRows.length === 0 ? (
                    <div style={{ padding: 24, color: "var(--color-text-secondary)", textAlign: "center", fontSize: 13 }}>
                      두 버전이 동일합니다
                    </div>
                  ) : (
                    diffRows.map((row, idx) => (
                      <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", minHeight: 22 }}>
                        {/* 좌측 셀 */}
                        <DiffCell
                          lineNum={row.leftNum}
                          text={row.leftText}
                          type={row.leftType}
                          side="left"
                          pairText={row.rightType === "ins" && row.leftType === "del" ? row.rightText : null}
                        />
                        {/* 우측 셀 */}
                        <DiffCell
                          lineNum={row.rightNum}
                          text={row.rightText}
                          type={row.rightType}
                          side="right"
                          pairText={row.leftType === "del" && row.rightType === "ins" ? row.leftText : null}
                        />
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 버전 목록 행 ──────────────────────────────────────────────────────────────

function VersionRow({
  id, label, subLabel, badge, badgeColor,
  checked, onToggle,
  showDelete, onDelete, deleteDisabled,
}: {
  id:             string;
  label:          string;
  subLabel:       string;
  badge:          string;
  badgeColor:     string;
  checked:        boolean;
  onToggle:       () => void;
  showDelete:     boolean;
  onDelete?:      () => void;
  deleteDisabled?: boolean;
}) {
  return (
    <div
      style={{
        display:      "flex",
        alignItems:   "center",
        gap:          8,
        padding:      "9px 14px",
        borderBottom: "1px solid var(--color-border)",
        background:   checked ? "var(--color-bg-base)" : "transparent",
        cursor:       "pointer",
      }}
      onClick={onToggle}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        style={{ width: 14, height: 14, flexShrink: 0, accentColor: "#1976d2", cursor: "pointer" }}
      />

      {/* 버전 레이블 */}
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", minWidth: 28 }}>
        {label}
      </span>

      {/* 날짜/부제 */}
      <span style={{ fontSize: 11, color: "var(--color-text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {subLabel}
      </span>

      {/* 사용자 뱃지 */}
      <span
        style={{
          fontSize:     11,
          padding:      "2px 7px",
          borderRadius: 4,
          background:   badgeColor,
          color:        "#fff",
          fontWeight:   600,
          flexShrink:   0,
          maxWidth:     60,
          overflow:     "hidden",
          textOverflow: "ellipsis",
          whiteSpace:   "nowrap",
        }}
      >
        {badge}
      </span>

      {/* 삭제 버튼 */}
      {showDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
          disabled={deleteDisabled}
          style={{
            background: "none", border: "none",
            cursor:     deleteDisabled ? "not-allowed" : "pointer",
            color:      "var(--color-text-secondary)",
            padding:    "2px",
            flexShrink: 0,
            opacity:    deleteDisabled ? 0.5 : 1,
            lineHeight: 1,
          }}
          title="이력 삭제"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4h6v2" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ── diff 셀 ───────────────────────────────────────────────────────────────────

function DiffCell({
  lineNum, text, type, side, pairText,
}: {
  lineNum:  number | null;
  text:     string | null;
  type:     "same" | "del" | "ins" | null;
  side:     "left" | "right";
  pairText: string | null;  // 같은 행의 반대편 텍스트 (문자 수준 diff용)
}) {
  const bg =
    type === "del" ? "rgba(244,67,54,0.08)"  :
    type === "ins" ? "rgba(76,175,80,0.08)"  :
    "transparent";

  const borderRight = side === "left" ? "1px solid var(--color-border)" : "none";

  const prefix =
    type === "del" ? "- " :
    type === "ins" ? "+ " :
    "  ";

  const prefixColor =
    type === "del" ? "#e53935" :
    type === "ins" ? "#4caf50" :
    "transparent";

  // 글자 수준 하이라이트 (del↔ins 페어일 때)
  const charSpans = useMemo(() => {
    if ((type !== "del" && type !== "ins") || !pairText || text === null) return null;
    const before = type === "del" ? text : pairText;
    const after  = type === "del" ? pairText : text;
    const ops    = charDiff(before, after);

    let pos = 0;
    return ops.map((op, idx) => {
      const slice = (type === "del" ? before : after).slice(pos, pos + op.len);
      pos += op.len;
      const highlight =
        (type === "del" && op.type === "del") ||
        (type === "ins" && op.type === "ins");
      return (
        <span
          key={idx}
          style={{
            background: highlight
              ? (type === "del" ? "rgba(229,57,53,0.35)" : "rgba(56,142,60,0.35)")
              : "transparent",
            borderRadius: 2,
          }}
        >
          {slice}
        </span>
      );
    });
  }, [type, text, pairText]);

  if (text === null) {
    // 빈 칸 (삽입/삭제 반대편)
    return (
      <div style={{
        display:     "flex",
        borderRight,
        background:  "var(--color-bg-base)",
        minHeight:   22,
      }}>
        <div style={{ width: 32, flexShrink: 0, background: "var(--color-bg-base)" }} />
      </div>
    );
  }

  return (
    <div style={{
      display:    "flex",
      background: bg,
      borderRight,
      minHeight:  22,
    }}>
      {/* 라인 번호 */}
      <div style={{
        width:      32,
        flexShrink: 0,
        textAlign:  "right",
        padding:    "3px 6px 3px 0",
        fontSize:   11,
        color:      type ? "#888" : "var(--color-text-secondary)",
        userSelect: "none",
        background: type === "del"
          ? "rgba(244,67,54,0.12)"
          : type === "ins"
          ? "rgba(76,175,80,0.12)"
          : "var(--color-bg-base)",
        borderRight: "1px solid var(--color-border)",
      }}>
        {lineNum ?? ""}
      </div>

      {/* 부호 */}
      <div style={{
        width:      16,
        flexShrink: 0,
        textAlign:  "center",
        padding:    "3px 0",
        color:      prefixColor,
        fontWeight: 700,
        userSelect: "none",
      }}>
        {type === "del" ? "-" : type === "ins" ? "+" : ""}
      </div>

      {/* 내용 */}
      <div style={{
        flex:        1,
        padding:     "3px 8px 3px 0",
        whiteSpace:  "pre-wrap",
        wordBreak:   "break-all",
        lineHeight:  "16px",
        color:       "var(--color-text-primary)",
      }}>
        {charSpans ?? text}
      </div>
    </div>
  );
}

// ── diff 알고리즘 ─────────────────────────────────────────────────────────────

type RawOp = { type: "same" | "del" | "ins"; text: string };

/** 라인 단위 LCS diff */
function lineDiff(before: string[], after: string[]): RawOp[] {
  const m = before.length, n = after.length;

  // 성능 제한: 너무 크면 전체를 replace로 처리
  if (m * n > 40000) {
    return [
      ...before.map((t) => ({ type: "del" as const, text: t })),
      ...after.map((t)  => ({ type: "ins" as const, text: t })),
    ];
  }

  // LCS DP
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = before[i - 1] === after[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // 역추적
  const ops: RawOp[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && before[i - 1] === after[j - 1]) {
      ops.unshift({ type: "same", text: before[i - 1] }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: "ins", text: after[j - 1] }); j--;
    } else {
      ops.unshift({ type: "del", text: before[i - 1] }); i--;
    }
  }
  return ops;
}

/** RawOp[] → DisplayRow[] (side-by-side) */
function buildDisplayRows(beforeText: string, afterText: string): DisplayRow[] {
  const beforeLines = beforeText === "" ? [] : beforeText.split("\n");
  const afterLines  = afterText  === "" ? [] : afterText.split("\n");

  const ops = lineDiff(beforeLines, afterLines);
  const rows: DisplayRow[] = [];
  let leftNum = 1, rightNum = 1;
  let i = 0;

  while (i < ops.length) {
    if (ops[i].type === "same") {
      rows.push({
        leftNum:  leftNum++,  leftText: ops[i].text, leftType:  "same",
        rightNum: rightNum++, rightText: ops[i].text, rightType: "same",
      });
      i++;
    } else {
      // del 블록 수집
      const dels: string[] = [];
      while (i < ops.length && ops[i].type === "del") { dels.push(ops[i].text); i++; }
      // ins 블록 수집
      const ins: string[] = [];
      while (i < ops.length && ops[i].type === "ins") { ins.push(ops[i].text); i++; }

      const pairs = Math.min(dels.length, ins.length);

      // 같은 수: del/ins 페어 (replace)
      for (let k = 0; k < pairs; k++) {
        rows.push({
          leftNum:  leftNum++,  leftText: dels[k], leftType:  "del",
          rightNum: rightNum++, rightText: ins[k],  rightType: "ins",
        });
      }
      // 남은 del (순수 삭제)
      for (let k = pairs; k < dels.length; k++) {
        rows.push({ leftNum: leftNum++, leftText: dels[k], leftType: "del", rightNum: null, rightText: null, rightType: null });
      }
      // 남은 ins (순수 삽입)
      for (let k = pairs; k < ins.length; k++) {
        rows.push({ leftNum: null, leftText: null, leftType: null, rightNum: rightNum++, rightText: ins[k], rightType: "ins" });
      }
    }
  }
  return rows;
}

// ── 문자 수준 diff ────────────────────────────────────────────────────────────

type CharOp = { type: "same" | "del" | "ins"; len: number };

function charDiff(before: string, after: string): CharOp[] {
  // 길면 그냥 전체 replace로
  if (before.length * after.length > 4000) {
    return [
      { type: "del", len: before.length },
      { type: "ins", len: after.length },
    ];
  }

  const m = before.length, n = after.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = before[i - 1] === after[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // 역추적 → run-length encoding
  const ops: Array<"same" | "del" | "ins"> = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && before[i - 1] === after[j - 1]) {
      ops.unshift("same"); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift("ins"); j--;
    } else {
      ops.unshift("del"); i--;
    }
  }

  // run-length로 압축
  const result: CharOp[] = [];
  for (const t of ops) {
    if (result.length && result[result.length - 1].type === t) {
      result[result.length - 1].len++;
    } else {
      result.push({ type: t, len: 1 });
    }
  }
  return result;
}
