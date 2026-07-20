"use client";

/**
 * BoardCategoryCard — PM 현황 카드 1개 (진척 4구간 도넛 + 마감 임박 순 표)
 *
 * 역할:
 *   - 왼쪽: CSS conic-gradient 도넛(외부 차트 라이브러리 없음) — 미지정/진행중(~50)/진행중(~99)/완료 분포
 *   - 오른쪽: dDay 오름차순(지연·임박 먼저) 정렬된 표 — 항목 이름을 누르면 상세 페이지로 이동
 *   - nameColumns 로 계층 표시를 제어: 1=자기 이름만(단위업무/요구사항), 2=단위업무+화면(화면),
 *     3=단위업무(작은 글씨)+화면+기능명(기능) — 사용자 요청: "단위업무는 작아도 됨, 자리 없을 테니"
 */

import { useState } from "react";
import Link from "next/link";
import type { BoardCategory, BoardCategoryKind, ProgressBucket4 } from "@/types/pm";
import { PROGRESS_BUCKET4_ORDER, PROGRESS_BUCKET4_LABELS } from "@/types/pm";

type Props = {
  category:   BoardCategory | undefined;
  nameColumns: 1 | 2 | 3;
  /** 표에 보여줄 최대 행 수 — 도넛/총건수/4구간 분포는 이 값과 무관하게 항상 전체 기준(page.tsx 헤더 선택자로 공유) */
  rowLimit:   number;
  isLoading:  boolean;
  error:      Error | null;
};

// 카드별 "이 숫자가 어디서 오는지" 설명 — fetchDeadlineItems.ts/route.ts 가 실제로 쓰는 진척률·마감일
// 출처를 그대로 옮겨적음(코드와 설명이 어긋나지 않도록 반드시 route.ts 로직과 대조해서 채울 것).
const CATEGORY_HELP: Record<BoardCategoryKind, string> = {
  REQUIREMENT_ANALYSIS:
    "진척률 = 요구사항 자신의 분석 진척률. 마감일 = 요구사항 자신의 분석 종료일.",
  UNIT_WORK_DESIGN:
    "진척률 = 하위 전체 기능(단위업무→화면→영역→기능)의 설계 진척률 평균. 마감일 = 단위업무 자신의 종료일 " +
    "(단위업무에는 설계 전용 마감일이 따로 없어 단위업무 종료일을 그대로 씁니다).",
  SCREEN_DESIGN:
    "진척률 = 화면 하위 기능들의 설계 진척률 평균. 마감일 = 화면 자신의 설계 종료일.",
  FUNCTION_DESIGN:
    "진척률 = 기능 자신의 설계 진척률. 마감일 = 기능 자신의 구현 종료일 " +
    "(기능에는 설계 전용 마감일이 따로 없어 구현 종료일을 그대로 씁니다).",
  UNIT_WORK_IMPL:
    "진척률 = 하위 전체 기능의 구현 진척률 평균. 마감일 = 단위업무 자신의 종료일.",
  SCREEN_IMPL:
    "진척률 = 화면 하위 기능들의 구현 진척률 평균. 마감일 = 화면 자신의 설계 종료일 " +
    "(화면에는 구현 전용 마감일이 따로 없어 설계 종료일을 그대로 씁니다).",
  FUNCTION_IMPL:
    "진척률 = 기능 자신의 구현 진척률. 마감일 = 기능 자신의 구현 종료일.",
};

// 차트 전용 팔레트 — UNSET 만 의미상 매칭되는 semantic 토큰이 없어 중립 회색 리터럴 사용,
// 나머지 3구간은 이미 있는 warning/brand/success 토큰 재사용(3테마 자동 대응).
const BUCKET_COLORS: Record<ProgressBucket4, string> = {
  UNSET:          "#94a3b8",
  IN_PROGRESS_50: "var(--color-warning)",
  IN_PROGRESS_99: "var(--color-brand)",
  DONE:           "var(--color-success)",
};

export default function BoardCategoryCard({ category, nameColumns, rowLimit, isLoading, error }: Props) {
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div className="sp-group">
      <div className="sp-group-header" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="sp-group-title">{category?.label ?? ""}</span>
        {category && (
          <button type="button" onClick={() => setHelpOpen(true)} title="이 카드 설명" style={helpBtnStyle}>?</button>
        )}
        <span style={{ flex: 1 }} />
        {category && (
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
            총 {category.totalCount}건
          </span>
        )}
      </div>
      <div className="sp-group-body">
        {isLoading ? (
          <Skeleton />
        ) : error ? (
          <ErrorBox message={error.message} />
        ) : !category ? null : (
          <Body category={category} nameColumns={nameColumns} rowLimit={rowLimit} />
        )}
      </div>

      {helpOpen && category && (
        <CategoryHelpModal kind={category.kind} label={category.label} onClose={() => setHelpOpen(false)} />
      )}
    </div>
  );
}

function Body({ category, nameColumns, rowLimit }: { category: BoardCategory; nameColumns: 1 | 2 | 3; rowLimit: number }) {
  const { buckets, totalCount, items: allItems } = category;
  // 표 노출만 rowLimit로 자름 — 이미 D-day 임박순으로 정렬되어 있어 위에서부터 자르면 됨.
  // 도넛/buckets/totalCount는 위에서 이미 구조분해된 전체 값 그대로 사용(rowLimit과 무관).
  const items = allItems.slice(0, rowLimit);
  const hiddenCount = allItems.length - items.length;

  // conic-gradient 스톱 — 4구간을 순서대로 이어붙임. 항목이 하나도 없으면 회색 원.
  const stops: string[] = [];
  let acc = 0;
  for (const b of PROGRESS_BUCKET4_ORDER) {
    const count = buckets[b];
    if (count === 0) continue;
    const start = (acc / totalCount) * 360;
    acc += count;
    const end = (acc / totalCount) * 360;
    stops.push(`${BUCKET_COLORS[b]} ${start}deg ${end}deg`);
  }
  const gradient = totalCount > 0 ? `conic-gradient(${stops.join(", ")})` : "var(--color-border)";
  const donePct = totalCount > 0 ? Math.round((buckets.DONE / totalCount) * 100) : null;

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* 도넛 + 범례 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, flexShrink: 0, width: 150 }}>
        <div style={{
          width: 116, height: 116, borderRadius: "50%", background: gradient,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            width: 70, height: 70, borderRadius: "50%", background: "var(--color-bg-card)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)",
          }}>
            {donePct !== null ? `${donePct}%` : "-"}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
          {PROGRESS_BUCKET4_ORDER.map((b) => (
            <div key={b} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: BUCKET_COLORS[b], flexShrink: 0 }} />
              <span style={{ color: "var(--color-text-secondary)", flex: 1 }}>{PROGRESS_BUCKET4_LABELS[b]}</span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-primary)" }}>{buckets[b]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 마감 임박 순 표 */}
      <div style={{ flex: 1, minWidth: 280, overflowX: "auto" }}>
        {items.length === 0 ? (
          <Empty />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--color-bg-muted)", borderBottom: "1px solid var(--color-border)" }}>
                {nameColumns >= 2 && <th style={thStyle}>단위업무</th>}
                {nameColumns >= 3 && <th style={thStyle}>화면</th>}
                <th style={thStyle}>{nameColumns === 1 ? "이름" : nameColumns === 2 ? "화면" : "기능"}</th>
                <th style={thStyle}>담당자</th>
                <th style={thNumStyle}>진척률</th>
                <th style={thStyle}>마감일</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                  {nameColumns >= 2 && (
                    <td style={{ ...tdStyle, fontSize: 11, color: "var(--color-text-tertiary)" }}>
                      {it.parentNames[0]}
                    </td>
                  )}
                  {nameColumns >= 3 && <td style={tdStyle}>{it.parentNames[1]}</td>}
                  <td style={tdStyle}>
                    <Link href={it.href} style={{ color: "var(--color-brand)", textDecoration: "none" }}>
                      {it.name}
                    </Link>
                  </td>
                  <td style={tdStyle}>
                    {it.memberName ?? <span style={{ color: "var(--color-text-tertiary)" }}>미할당</span>}
                  </td>
                  <td style={{ ...tdNumStyle, fontWeight: 600, color: BUCKET_COLORS[it.bucket] }}>
                    {it.progress}%
                  </td>
                  <td style={{ ...tdStyle, color: it.dDay !== null && it.dDay < 0 ? "var(--color-error)" : undefined, whiteSpace: "nowrap" }}>
                    {it.endDate ?? <span style={{ color: "var(--color-text-tertiary)" }}>-</span>}
                    {it.dDay !== null && ` (D${it.dDay >= 0 ? "-" : "+"}${Math.abs(it.dDay)})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {hiddenCount > 0 && (
          <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--color-text-tertiary)" }}>
            {hiddenCount}건 더 있음 — 헤더의 목록 개수를 늘리면 더 볼 수 있습니다.
          </div>
        )}
      </div>
    </div>
  );
}

// 카드 헤더 "?" 클릭 시 뜨는 설명 팝업 — 진척률 4구간 의미(공통) + 이 카드만의 진척률/마감일 출처(개별)
// PM 진단 DelayStatusMatrix.tsx의 FormulaHelpModal과 같은 오버레이 패턴.
function CategoryHelpModal({ kind, label, onClose }: { kind: BoardCategoryKind; label: string; onClose: () => void }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(520px, 90vw)", background: "var(--color-bg-card)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.2)", overflow: "hidden" }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)",
        }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>{label} 카드 설명</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--color-text-secondary)", padding: "0 4px", lineHeight: 1 }}
          >×</button>
        </div>

        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12, fontSize: 15, lineHeight: 1.7, color: "var(--color-text-primary)" }}>
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>① 진척률·마감일 출처</div>
            <div style={{ color: "var(--color-text-secondary)" }}>{CATEGORY_HELP[kind]}</div>
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>② 진척 4구간</div>
            <div style={{ color: "var(--color-text-secondary)" }}>
              <b>미지정</b> — 진척률 0% (아직 시작 안 함)<br />
              <b>진행중(~50)</b> — 진척률 1~50%<br />
              <b>진행중(~99)</b> — 진척률 51~99%<br />
              <b>완료</b> — 진척률 100%
            </div>
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>③ 표 정렬</div>
            <div style={{ color: "var(--color-text-secondary)" }}>
              마감일이 가까운(또는 이미 지난) 항목이 위로 오도록 D-day 오름차순 정렬됩니다. 마감일이 없는 항목은 맨 아래에 배치됩니다.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const helpBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 18, height: 18, borderRadius: "50%",
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)", fontSize: 12, fontWeight: 700,
  cursor: "pointer", lineHeight: 1, padding: 0, flexShrink: 0,
};

function Skeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ height: 24, background: "var(--color-bg-elevated)", borderRadius: "var(--radius-sm)", opacity: 0.5 }} />
      ))}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return <div style={{ color: "var(--color-error)", fontSize: "var(--text-sm)" }}>⚠ {message}</div>;
}

function Empty() {
  return (
    <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 13 }}>
      항목이 없습니다.
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left", padding: "6px 10px", fontSize: 11, fontWeight: 600,
  color: "var(--color-text-tertiary)", whiteSpace: "nowrap",
};
const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };
const tdStyle: React.CSSProperties = {
  padding: "6px 10px", fontSize: 13, color: "var(--color-text-primary)",
};
const tdNumStyle: React.CSSProperties = { ...tdStyle, textAlign: "right", fontFamily: "var(--font-mono)" };
