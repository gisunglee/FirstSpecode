/** 판정 항목, 코드 근거와 사람의 항목별 결정을 렌더링한다. */

import type { SyncItem } from "./types";
import {
  itemStatusBadgeClass,
  itemStatusLabel,
  resultBadgeClass,
  resultLabel,
} from "./labels";

type Decision = "APPLY" | "REJECT" | "DEFER";

/** 상세 상단 "다음 할 일" 링크가 항목 카드로 점프할 때 쓰는 DOM id. */
export function syncItemAnchorId(syncItemId: string) {
  return `sync-item-${syncItemId}`;
}

export function ResultSection(props: {
  title: string;
  description: string;
  emptyTitle: string;
  items: SyncItem[];
  canReview: boolean;
  canApply: boolean;
  reasons: Record<string, string>;
  setReason: (itemId: string, reason: string) => void;
  decide: (itemId: string, decision: Decision, reason: string) => void;
  deciding: boolean;
}) {
  return (
    <section className="sp-group">
      <div className="sp-group-header">
        <h2 className="sp-group-title">{props.title}</h2>
      </div>
      <div className="sp-group-body">
        <p className="sp-reconcile-subtitle">{props.description}</p>
        {props.items.length === 0 ? (
          <div className="sp-empty">
            <div className="sp-empty-title">{props.emptyTitle}</div>
          </div>
        ) : (
          <div className="sp-reconcile-item-list sp-reconcile-action-top">
            {props.items.map((item) => (
              <SyncItemCard
                key={item.syncItemId}
                item={item}
                canReview={props.canReview}
                canApply={props.canApply}
                reason={props.reasons[item.syncItemId] ?? ""}
                setReason={(reason) => props.setReason(item.syncItemId, reason)}
                decide={(decision) =>
                  props.decide(
                    item.syncItemId,
                    decision,
                    props.reasons[item.syncItemId] ?? "",
                  )
                }
                deciding={props.deciding}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SyncItemCard(props: {
  item: SyncItem;
  canReview: boolean;
  canApply: boolean;
  reason: string;
  setReason: (reason: string) => void;
  decide: (decision: Decision) => void;
  deciding: boolean;
}) {
  const { item } = props;
  const pending = item.status === "PENDING";
  return (
    <article
      // 결정 대기 카드는 왼쪽 경고색 띠로 구분해 목록에서 바로 찾을 수 있게 한다.
      className={`sp-group sp-reconcile-item ${pending ? "is-pending" : ""}`}
      id={syncItemAnchorId(item.syncItemId)}
    >
      <div className="sp-group-header">
        <div>
          <div className="sp-reconcile-badge-row">
            <span className={`sp-badge ${resultBadgeClass(item.resultCode)}`}>
              {resultLabel(item.resultCode)}
            </span>
            <span className="sp-badge sp-badge-neutral">{item.confidence}</span>
            <span className={`sp-badge ${itemStatusBadgeClass(item.status)}`}>
              {itemStatusLabel(item.status)}
            </span>
          </div>
          <div className="sp-reconcile-table-title sp-reconcile-action-top">
            {item.targetDisplayId
              ? `${item.targetDisplayId} · ${item.targetName ?? ""}`
              : "신규 구조 후보"}
          </div>
          {item.targetField ? (
            <div className="sp-reconcile-path">
              {item.targetType}.{item.targetField}
            </div>
          ) : null}
        </div>
      </div>
      <div className="sp-group-body">
        <div className="sp-reconcile-evidence-grid">
          <InfoBox
            title="설계 내용"
            copy={item.designStatement ?? "현재 설계에 대응 내용 없음"}
          />
          <InfoBox
            title="소스에서 확인한 사실"
            copy={item.sourceFact ?? "소스 사실을 확정하지 못했습니다."}
          />
        </div>
        <InfoBox title="판정 이유" copy={item.reason} />

        {item.status === "DESIGN_CHANGED" ? (
          <>
            {/* 적용 실패는 클릭 순간 토스트로만 알렸다. 카드에 남겨 다시 봐도 이유를 알 수 있게 한다. */}
            <div className="sp-reconcile-notice is-warning sp-reconcile-action-top">
              <div className="sp-reconcile-notice-title">적용되지 않았습니다</div>
              분석 시점 이후 이 설계 본문이 바뀌어 자동 반영을 중단했습니다. 아래 세 값을 비교해
              직접 반영하거나, 최신 설계로 다시 제안을 받으려면 동기화를 재실행하세요.
            </div>
            <div className="sp-reconcile-decision-grid sp-reconcile-action-top">
              <InfoBox title="분석 당시 설계" copy={item.beforeValue ?? "없음"} />
              <InfoBox
                title="현재 설계"
                copy={item.currentValue ?? "대상이 삭제되었거나 이동함"}
              />
              <InfoBox title="AI 제안" copy={item.proposedValue ?? "없음"} proposal />
            </div>
          </>
        ) : item.proposedValue !== null ? (
          <div className="sp-reconcile-evidence-grid sp-reconcile-action-top">
            <InfoBox title="현재 설계(분석 시점)" copy={item.beforeValue ?? ""} />
            <InfoBox title="제안 설계" copy={item.proposedValue} proposal />
          </div>
        ) : null}

        <EvidenceList item={item} />
        <DecisionPanel {...props} pending={pending} />
      </div>
    </article>
  );
}

function EvidenceList({ item }: { item: SyncItem }) {
  if (item.evidence.length === 0) return null;
  return (
    <div className="sp-reconcile-action-top">
      <div className="sp-reconcile-evidence-title">코드 근거</div>
      <div className="sp-reconcile-item-list">
        {item.evidence.map((evidence, index) => (
          <div
            key={`${evidence.path}:${evidence.startLine}:${index}`}
            className="sp-reconcile-evidence is-code"
          >
            <div className="sp-reconcile-path">
              {evidence.path}:{evidence.startLine}-{evidence.endLine}
              {evidence.symbol ? ` · ${evidence.symbol}` : ""}
            </div>
            <pre className="sp-reconcile-evidence-copy">{evidence.snippet}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionPanel(props: {
  item: SyncItem;
  canReview: boolean;
  canApply: boolean;
  reason: string;
  setReason: (reason: string) => void;
  decide: (decision: Decision) => void;
  deciding: boolean;
  pending: boolean;
}) {
  if (props.pending && props.canReview) {
    const canApplyHere = props.item.proposedValue !== null && props.canApply;
    return (
      <div className="sp-reconcile-decision">
        <div className="sp-reconcile-decision-title">이 항목을 결정하세요</div>
        <div className="sp-reconcile-decision-hint">
          {canApplyHere
            ? "적용하면 제안 설계가 설명 필드에 반영됩니다. 거부·보류는 사유가 필요합니다."
            : props.item.proposedValue === null
              ? "AI 수정안이 없는 항목이라 적용은 할 수 없고, 사유를 적어 거부 또는 보류만 할 수 있습니다."
              : "적용 권한이 없어 거부·보류만 할 수 있습니다. 사유를 입력하세요."}
        </div>
        <textarea
          className="sp-input sp-textarea sp-reconcile-reason"
          value={props.reason}
          onChange={(event) => props.setReason(event.target.value)}
          placeholder="거부·보류 사유를 입력하세요. 적용 사유는 선택입니다."
        />
        <div className="sp-reconcile-actions">
          {canApplyHere ? (
            <button
              type="button"
              className="sp-btn sp-btn-primary"
              disabled={props.deciding}
              onClick={() => props.decide("APPLY")}
            >
              설계에 적용
            </button>
          ) : null}
          <button
            type="button"
            className="sp-btn sp-btn-secondary"
            disabled={props.deciding || !props.reason.trim()}
            onClick={() => props.decide("REJECT")}
          >
            거부
          </button>
          <button
            type="button"
            className="sp-btn sp-btn-ghost"
            disabled={props.deciding || !props.reason.trim()}
            onClick={() => props.decide("DEFER")}
          >
            보류
          </button>
        </div>
      </div>
    );
  }
  if (props.pending) {
    return (
      <div className="sp-reconcile-notice is-info sp-reconcile-action-top">
        PM·PL·OWNER·ADMIN이 이 항목을 결정할 수 있습니다.
      </div>
    );
  }
  return props.item.decisionReason ? (
    <div className="sp-reconcile-notice is-info sp-reconcile-action-top">
      결정 사유: {props.item.decisionReason}
    </div>
  ) : null;
}

export function SummaryCell(props: { label: string; value: string }) {
  return (
    <div className="sp-reconcile-summary-cell">
      <div className="sp-reconcile-summary-label">{props.label}</div>
      <div className="sp-reconcile-summary-value">{props.value}</div>
    </div>
  );
}

/** 정보 박스. `proposal`은 사용자가 승인하는 제안 설계에만 켠다 (브랜드색 테두리). */
export function InfoBox(props: { title: string; copy: string; proposal?: boolean }) {
  return (
    <div className={`sp-reconcile-evidence ${props.proposal ? "is-proposal" : ""}`}>
      <div className="sp-reconcile-evidence-title">{props.title}</div>
      <div className="sp-reconcile-evidence-copy">{props.copy}</div>
    </div>
  );
}
