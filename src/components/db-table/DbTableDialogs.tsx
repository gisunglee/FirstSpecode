"use client";

/**
 * DbTableDialogs — DB 테이블 목록/상세 페이지의 경량 확인 다이얼로그 모음
 *
 * 포함 컴포넌트:
 *   - LgclNameWarnDialog:  논리 컬럼명 누락 경고 → 사용자 확인 후 저장
 *   - DeleteTableConfirmDialog: 단건 테이블 삭제 확인 (영향도 경고 포함)
 *   - BulkDeleteTableConfirmDialog: 목록에서 여러 테이블 선택 삭제 확인
 *     (테이블별 사용처를 기능/영역/화면 링크와 함께 보여줌)
 *
 * 설계:
 *   - 모두 "확인 → onConfirm 콜백" 의 단순 패턴이라 한 파일에 묶음
 *   - 상위 페이지는 open / onClose / onConfirm + 필요한 context 만 내려주면 됨
 *   - 색상은 semantic 토큰만 사용 (3테마 자동 대응)
 */

import { useEffect, useState } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import type { TableUsageResponse } from "./TableUsageSection";

// 영향도(매핑 참조)가 있는 삭제는 실수 클릭 방지를 위해 재확인 문구를 한 번 더 보여준다.
const IMPACT_RECONFIRM_TEXT =
  "정말로 삭제하시겠습니까? 기능에 정의되어 있는 매핑도 함께 삭제됩니다.";

// ── 공용 스타일 ──────────────────────────────────────────────────────────────

const backdropStyle: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: "var(--color-bg-card)",
  borderRadius: 10,
  padding: "28px 32px",
  minWidth: 360, maxWidth: 500,
  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
};

const footerStyle: React.CSSProperties = {
  display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20,
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "6px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "transparent",
  color: "var(--color-text-secondary)",
  fontSize: 13, cursor: "pointer",
};

// ── 1. 논리 컬럼명 누락 경고 ─────────────────────────────────────────────────

type LgclNameWarnProps = {
  open:       boolean;
  missing:    number;         // 논리명 누락 개수
  onClose:    () => void;
  onConfirm:  () => void;      // 누락 무시하고 저장
  busy?:      boolean;
};

export function LgclNameWarnDialog({ open, missing, onClose, onConfirm, busy }: LgclNameWarnProps) {
  useEscapeKey(onClose, open);
  if (!open) return null;

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700 }}>논리 컬럼명 누락</p>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          논리 컬럼명이 없는 컬럼이 <strong style={{ color: "var(--color-warning)" }}>{missing}개</strong> 있습니다.<br />
          나중에 입력하고, 지금은 이대로 저장하시겠습니까?
        </p>
        <div style={footerStyle}>
          <button type="button" style={cancelBtnStyle} onClick={onClose} disabled={busy}>
            취소
          </button>
          <button
            type="button"
            style={{
              padding: "6px 16px", borderRadius: 6, border: "none",
              background: "var(--color-brand)", color: "#fff",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
            onClick={onConfirm}
            disabled={busy}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 2. 테이블 삭제 확인 (영향도 경고 포함) ──────────────────────────────────

type ImpactCounts = {
  functionCount: number;
  areaCount:     number;
  screenCount:   number;
};

type DeleteConfirmProps = {
  open:       boolean;
  tableName:  string;            // 물리명 (code 태그로 표시)
  colCount:   number;             // 하위 컬럼 수
  impact?:    ImpactCounts;        // 매핑 영향도 (있으면 경고 표시)
  onClose:    () => void;
  onConfirm:  () => void;
  busy?:      boolean;
};

export function DeleteTableConfirmDialog({
  open, tableName, colCount, impact, onClose, onConfirm, busy,
}: DeleteConfirmProps) {
  useEscapeKey(onClose, open);

  // 영향도가 있는 삭제는 버튼 한 번 더 눌러야 실제로 삭제되도록 재확인 단계를 둔다
  // (다이얼로그는 open=false 여도 언마운트되지 않으므로 닫힐 때 되돌려 둠)
  const [reconfirm, setReconfirm] = useState(false);
  useEffect(() => { if (!open) setReconfirm(false); }, [open]);

  if (!open) return null;

  // 매핑 참조가 하나라도 있는지 (없으면 영향도 경고 박스 자체를 숨김)
  const hasImpact = impact && (impact.functionCount + impact.areaCount + impact.screenCount) > 0;

  function handleDeleteClick() {
    if (hasImpact && !reconfirm) { setReconfirm(true); return; }
    onConfirm();
  }

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700 }}>테이블을 삭제하시겠습니까?</p>
        <p style={{ margin: "0 0 6px", fontSize: 14, color: "var(--color-text-secondary)" }}>
          <code style={{
            fontFamily: "monospace",
            background: "var(--color-bg-muted)",
            padding: "1px 6px", borderRadius: 4,
          }}>
            {tableName}
          </code>
        </p>
        {colCount > 0 && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--color-error)" }}>
            ⚠ 하위 컬럼 {colCount}개도 함께 삭제됩니다.
          </p>
        )}

        {/* 매핑 영향도 경고 — 참조가 있을 때만
             warning semantic 토큰 사용 → 3테마 자동 대응 */}
        {hasImpact && impact && (
          <div style={{
            marginTop: 14, padding: "10px 12px",
            background:   "var(--color-warning-subtle)",
            border:       "1px solid var(--color-warning-border)",
            borderRadius: 6,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-warning)", marginBottom: 4 }}>
              ⚠ 이 테이블은 현재 다음 설계 산출물에서 참조 중입니다
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--color-warning)", lineHeight: 1.6 }}>
              {impact.functionCount > 0 && <li>기능 <strong>{impact.functionCount}</strong>개</li>}
              {impact.areaCount > 0 && <li>영역 <strong>{impact.areaCount}</strong>개</li>}
              {impact.screenCount > 0 && <li>화면 <strong>{impact.screenCount}</strong>개</li>}
            </ul>
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--color-text-secondary)" }}>
              삭제 시 해당 산출물의 컬럼 매핑이 끊어집니다. 계속 진행하시겠습니까?
            </div>
          </div>
        )}

        {/* 재확인 문구 — 삭제 버튼을 한 번 눌러 영향도를 인지했을 때만 표시 */}
        {hasImpact && reconfirm && (
          <p style={{ margin: "10px 0 0", fontSize: 12, fontWeight: 700, color: "var(--color-error)" }}>
            ⚠ {IMPACT_RECONFIRM_TEXT}
          </p>
        )}

        <div style={footerStyle}>
          <button type="button" style={cancelBtnStyle} onClick={onClose} disabled={busy}>
            취소
          </button>
          <button
            type="button"
            style={{
              padding: "6px 16px", borderRadius: 6, border: "none",
              background: "var(--color-error)", color: "#fff",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
            onClick={handleDeleteClick}
            disabled={busy}
          >
            {busy ? "삭제 중..." : reconfirm ? "네, 삭제합니다" : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 3. 목록 일괄 삭제 확인 (테이블별 사용처 링크 포함) ──────────────────────

type UsedByItem = TableUsageResponse["usedBy"][number];

export type BulkDeleteItem = {
  tblId:       string;
  tblPhysclNm: string;
  colCount:    number;
  // 사용처 조회 실패 시 undefined — "확인 불가" 로 별도 표시 (없음과 구분)
  usedBy?:     UsedByItem[];
};

type BulkDeleteConfirmProps = {
  open:      boolean;
  projectId: string;
  items:     BulkDeleteItem[];
  onClose:   () => void;
  onConfirm: () => void;
  busy?:     boolean;
};

const REF_TYPE_LABEL: Record<string, string> = {
  FUNCTION: "기능",
  AREA:     "영역",
  SCREEN:   "화면",
};

function refDetailHref(projectId: string, refType: string, refId: string): string | null {
  if (refType === "FUNCTION") return `/projects/${projectId}/functions/${refId}`;
  if (refType === "AREA")     return `/projects/${projectId}/areas/${refId}`;
  if (refType === "SCREEN")   return `/projects/${projectId}/screens/${refId}`;
  return null;
}

export function BulkDeleteTableConfirmDialog({
  open, projectId, items, onClose, onConfirm, busy,
}: BulkDeleteConfirmProps) {
  useEscapeKey(onClose, open);

  // 영향도가 있는 삭제는 버튼 한 번 더 눌러야 실제로 삭제되도록 재확인 단계를 둔다
  const [reconfirm, setReconfirm] = useState(false);
  useEffect(() => { if (!open) setReconfirm(false); }, [open]);

  if (!open) return null;

  const totalColCount   = items.reduce((sum, it) => sum + it.colCount, 0);
  const itemsWithImpact = items.filter((it) => it.usedBy && it.usedBy.length > 0);
  const usageUnchecked  = items.some((it) => it.usedBy === undefined);
  const hasImpact       = itemsWithImpact.length > 0;

  function handleDeleteClick() {
    if (hasImpact && !reconfirm) { setReconfirm(true); return; }
    onConfirm();
  }

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={{ ...dialogStyle, maxWidth: 560, maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700 }}>
          테이블 {items.length}개를 삭제하시겠습니까?
        </p>

        {/* 선택된 테이블 목록 */}
        <ul style={{ margin: "0 0 6px", paddingLeft: 18, fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
          {items.map((it) => (
            <li key={it.tblId}>
              <code style={{ fontFamily: "monospace", background: "var(--color-bg-muted)", padding: "1px 6px", borderRadius: 4 }}>
                {it.tblPhysclNm}
              </code>
            </li>
          ))}
        </ul>

        {totalColCount > 0 && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--color-error)" }}>
            ⚠ 하위 컬럼 총 {totalColCount}개도 함께 삭제됩니다.
          </p>
        )}

        {usageUnchecked && (
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--color-text-tertiary)" }}>
            일부 테이블은 사용처 확인에 실패했습니다. 삭제 전 개별 확인을 권장합니다.
          </p>
        )}

        {/* 매핑 영향도 경고 — 참조가 있는 테이블만 */}
        {itemsWithImpact.length > 0 && (
          <div style={{
            marginTop: 14, padding: "10px 12px",
            background:   "var(--color-warning-subtle)",
            border:       "1px solid var(--color-warning-border)",
            borderRadius: 6,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-warning)", marginBottom: 6 }}>
              ⚠ 다음 테이블은 현재 설계 산출물에서 참조 중입니다
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {itemsWithImpact.map((it) => (
                <div key={it.tblId}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-warning)" }}>
                    <code style={{ fontFamily: "monospace" }}>{it.tblPhysclNm}</code>
                  </div>
                  <ul style={{ margin: "2px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--color-warning)", lineHeight: 1.6 }}>
                    {it.usedBy!.map((u) => {
                      const href = refDetailHref(projectId, u.refType, u.refId);
                      const label = `[${REF_TYPE_LABEL[u.refType] ?? u.refType}] ${u.refName}`;
                      return (
                        <li key={`${u.refType}-${u.refId}`}>
                          {href ? (
                            <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
                              {label}
                            </a>
                          ) : label}
                          {" "}
                          <span style={{ color: "var(--color-text-secondary)" }}>({u.colCount}개 컬럼 사용)</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--color-text-secondary)" }}>
              삭제 시 위 산출물의 컬럼 매핑도 함께 삭제됩니다. 계속 진행하시겠습니까?
            </div>
          </div>
        )}

        {/* 재확인 문구 — 삭제 버튼을 한 번 눌러 영향도를 인지했을 때만 표시 */}
        {hasImpact && reconfirm && (
          <p style={{ margin: "10px 0 0", fontSize: 12, fontWeight: 700, color: "var(--color-error)" }}>
            ⚠ {IMPACT_RECONFIRM_TEXT}
          </p>
        )}

        <div style={footerStyle}>
          <button type="button" style={cancelBtnStyle} onClick={onClose} disabled={busy}>
            취소
          </button>
          <button
            type="button"
            style={{
              padding: "6px 16px", borderRadius: 6, border: "none",
              background: "var(--color-error)", color: "#fff",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
            onClick={handleDeleteClick}
            disabled={busy}
          >
            {busy ? "삭제 중..." : reconfirm ? "네, 삭제합니다" : `삭제 (${items.length}개)`}
          </button>
        </div>
      </div>
    </div>
  );
}
