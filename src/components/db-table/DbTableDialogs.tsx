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

import { useEscapeKey } from "@/hooks/useEscapeKey";
import type { TableUsageResponse } from "./TableUsageSection";

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

// "완전 삭제" — 기존 삭제 버튼과 동일한 위험 색상
const deleteBtnStyleDialog: React.CSSProperties = {
  padding: "6px 16px", borderRadius: 6, border: "none",
  background: "var(--color-error)", color: "#fff",
  fontSize: 13, fontWeight: 600, cursor: "pointer",
};

// "데디케이트로 변경" — 되돌릴 수 있는 액션이라 삭제보다 약한 warning 톤(테두리만)으로 구분
const deprecateBtnStyle: React.CSSProperties = {
  padding: "6px 16px", borderRadius: 6,
  border: "1px solid var(--color-warning-border)",
  background: "transparent",
  color: "var(--color-warning)",
  fontSize: 13, fontWeight: 600, cursor: "pointer",
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

// ── 2. 테이블 삭제 확인 (영향도 경고 + 데디케이트 갈림길) ────────────────────

type ImpactCounts = {
  functionCount: number;
  areaCount:     number;
  screenCount:   number;
};

type DeleteConfirmProps = {
  open:         boolean;
  tableName:    string;             // 물리명 (code 태그로 표시)
  colCount:     number;              // 하위 컬럼 수
  impact?:      ImpactCounts;         // 매핑 영향도 (있으면 경고 표시)
  isDeprecated: boolean;              // 이미 "데디케이트" 상태인 테이블인지
  onClose:      () => void;
  // 아직 데디케이트 전 + 영향도가 있을 때만 노출되는 "상태만 바꾸기" 선택지
  onDeprecate:  () => void;
  onDelete:     () => void;
  deleting?:    boolean;
  deprecating?: boolean;
};

export function DeleteTableConfirmDialog({
  open, tableName, colCount, impact, isDeprecated,
  onClose, onDeprecate, onDelete, deleting, deprecating,
}: DeleteConfirmProps) {
  useEscapeKey(onClose, open);
  if (!open) return null;

  const busy = !!deleting || !!deprecating;

  // 매핑 참조가 하나라도 있는지 (없으면 영향도 경고 박스 자체를 숨김)
  const hasImpact = impact && (impact.functionCount + impact.areaCount + impact.screenCount) > 0;
  // 아직 데디케이트 전 + 영향이 있을 때만 "완전 삭제" 대신 "상태만 바꾸기"를 고를 수 있게 함.
  // 이미 데디케이트된 테이블이면 이번이 최종 정리이므로 갈림길 없이 바로 완전 삭제로 간다.
  const showFork = hasImpact && !isDeprecated;

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
              {showFork
                ? "완전히 지우는 대신, 일단 \"데디케이트\"로 표시만 해두고 나중에 정리할 수도 있습니다."
                : "삭제 시 해당 산출물의 컬럼 매핑이 끊어집니다. 계속 진행하시겠습니까?"}
            </div>
          </div>
        )}

        {isDeprecated && (
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>
            이미 데디케이트 상태인 테이블입니다. 삭제하면 완전히 제거됩니다.
          </p>
        )}

        <div style={footerStyle}>
          <button type="button" style={cancelBtnStyle} onClick={onClose} disabled={busy}>
            취소
          </button>
          {showFork && (
            <button
              type="button"
              style={deprecateBtnStyle}
              onClick={onDeprecate}
              disabled={busy}
            >
              {deprecating ? "변경 중..." : "데디케이트로 변경"}
            </button>
          )}
          <button
            type="button"
            style={deleteBtnStyleDialog}
            onClick={onDelete}
            disabled={busy}
          >
            {deleting ? "삭제 중..." : showFork ? "완전 삭제" : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 3. 목록 일괄 삭제 확인 (테이블별 사용처 링크 포함) ──────────────────────
//
// 선택한 테이블을 두 그룹으로 나눈다:
//   - 즉시 삭제 대상: 이미 "데디케이트" 상태이거나, 영향도(사용처)가 0인 테이블
//   - 개별 확인 필요: 아직 데디케이트 전인데 지금 기능에서 쓰고 있는 테이블
//     (사용처 조회 자체가 실패한 경우도 안전하게 이쪽으로 분류)
// 뒤쪽 그룹은 이번 일괄삭제에서 건너뛴다 — 상세 페이지에서 하나씩 열어
// "데디케이트로 변경" 또는 "완전 삭제"를 개별로 선택해야 한다.

type UsedByItem = TableUsageResponse["usedBy"][number];

export type BulkDeleteItem = {
  tblId:        string;
  tblPhysclNm:  string;
  colCount:     number;
  isDeprecated: boolean;
  // 사용처 조회 실패 시 undefined — "확인 불가" 로 별도 표시 (없음과 구분)
  usedBy?:      UsedByItem[];
};

type BulkDeleteConfirmProps = {
  open:      boolean;
  projectId: string;
  items:     BulkDeleteItem[];
  onClose:   () => void;
  // 즉시 삭제 대상의 tblId 목록만 전달됨 (개별 확인 필요 그룹은 제외)
  onDelete:  (tblIds: string[]) => void;
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

function isBulkItemImmediate(it: BulkDeleteItem): boolean {
  if (it.isDeprecated) return true;
  if (it.usedBy === undefined) return false; // 확인 실패 → 개별 확인으로 보냄
  return it.usedBy.length === 0;
}

// 즉시 삭제 대상 / 개별 확인 필요 대상으로 한 번에 나눔 (동일 판정을 두 번 filter 하지 않도록)
function splitBulkItems(items: BulkDeleteItem[]): { immediate: BulkDeleteItem[]; needsReview: BulkDeleteItem[] } {
  const immediate: BulkDeleteItem[] = [];
  const needsReview: BulkDeleteItem[] = [];
  for (const it of items) {
    (isBulkItemImmediate(it) ? immediate : needsReview).push(it);
  }
  return { immediate, needsReview };
}

// 사용처 목록 (기능/영역/화면 + 링크) — 즉시 삭제 대상 중 데디케이트+영향 있는 항목과
// 개별 확인 필요 항목이 동일한 형태로 보여준다
function UsedByList({ projectId, usedBy, color }: { projectId: string; usedBy: UsedByItem[]; color: string }) {
  return (
    <ul style={{ margin: "2px 0 0", paddingLeft: 18, fontSize: 12, color, lineHeight: 1.6 }}>
      {usedBy.map((u) => {
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
  );
}

export function BulkDeleteTableConfirmDialog({
  open, projectId, items, onClose, onDelete, busy,
}: BulkDeleteConfirmProps) {
  useEscapeKey(onClose, open);
  if (!open) return null;

  const { immediate: immediateItems, needsReview: needsReviewItems } = splitBulkItems(items);
  const totalColCount = immediateItems.reduce((sum, it) => sum + it.colCount, 0);

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={{ ...dialogStyle, maxWidth: 560, maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700 }}>
          {needsReviewItems.length > 0
            ? `테이블 ${items.length}개 중 ${immediateItems.length}개를 지금 삭제합니다.`
            : `테이블 ${items.length}개를 삭제하시겠습니까?`}
        </p>

        {immediateItems.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginTop: 6 }}>
              즉시 삭제됨
            </div>
            <ul style={{ margin: "2px 0 6px", paddingLeft: 18, fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
              {immediateItems.map((it) => (
                <li key={it.tblId}>
                  <code style={{ fontFamily: "monospace", background: "var(--color-bg-muted)", padding: "1px 6px", borderRadius: 4 }}>
                    {it.tblPhysclNm}
                  </code>
                  {it.isDeprecated && (
                    <span style={{ marginLeft: 6, fontSize: 11, color: "var(--color-text-tertiary)" }}>(데디케이트)</span>
                  )}
                  {/* 이미 데디케이트라 즉시 삭제 대상이지만, 여전히 쓰이고 있으면 그 사실은 보여줌
                      (단건 삭제 확인창이 isDeprecated 여도 영향도 박스는 항상 보여주는 것과 동일 원칙) */}
                  {it.usedBy && it.usedBy.length > 0 && (
                    <UsedByList projectId={projectId} usedBy={it.usedBy} color="var(--color-text-tertiary)" />
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {totalColCount > 0 && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--color-error)" }}>
            ⚠ 하위 컬럼 총 {totalColCount}개도 함께 삭제됩니다.
          </p>
        )}

        {/* 개별 확인이 필요해 이번 일괄삭제에서 제외되는 그룹 — 왜 빠지는지 이유를 함께 보여줌 */}
        {needsReviewItems.length > 0 && (
          <div style={{
            marginTop: 14, padding: "10px 12px",
            background:   "var(--color-warning-subtle)",
            border:       "1px solid var(--color-warning-border)",
            borderRadius: 6,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-warning)", marginBottom: 6 }}>
              ⚠ 개별 확인이 필요해 이번엔 건너뜁니다 ({needsReviewItems.length}개)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {needsReviewItems.map((it) => (
                <div key={it.tblId}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-warning)" }}>
                    <code style={{ fontFamily: "monospace" }}>{it.tblPhysclNm}</code>
                  </div>
                  {it.usedBy === undefined ? (
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
                      사용처 확인에 실패했습니다.
                    </div>
                  ) : (
                    <UsedByList projectId={projectId} usedBy={it.usedBy} color="var(--color-warning)" />
                  )}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--color-text-secondary)" }}>
              삭제하려면 이 테이블을 열어서 개별로 확인해 주세요 (그대로 두거나 데디케이트로 바꿀 수 있습니다).
            </div>
          </div>
        )}

        <div style={footerStyle}>
          <button type="button" style={cancelBtnStyle} onClick={onClose} disabled={busy}>
            {immediateItems.length > 0 ? "취소" : "닫기"}
          </button>
          {immediateItems.length > 0 && (
            <button
              type="button"
              style={deleteBtnStyleDialog}
              onClick={() => onDelete(immediateItems.map((it) => it.tblId))}
              disabled={busy}
            >
              {busy ? "삭제 중..." : `삭제 (${immediateItems.length}개)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
