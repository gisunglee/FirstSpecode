/** 판정 항목, 코드 근거와 사람의 항목별 결정을 렌더링한다. */

import type { SyncItem } from "./types";
import {
  itemStatusBadgeClass,
  itemStatusLabel,
  resultBadgeClass,
  resultLabel,
} from "./labels";

type Decision = "APPLY" | "REJECT" | "DEFER";

export function ResultSection(props: {
  title: string;
  description: string;
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
            <div className="sp-empty-title">보고된 항목이 없습니다.</div>
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
    <article className="sp-group sp-reconcile-item">
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
            copy={item.sourceFact ?? "확인하지 못함"}
            fact
          />
        </div>
        <InfoBox title="판정 이유" copy={item.reason} />

        {item.status === "DESIGN_CHANGED" ? (
          <div className="sp-reconcile-decision-grid sp-reconcile-action-top">
            <InfoBox title="분석 당시 설계" copy={item.beforeValue ?? "없음"} />
            <InfoBox
              title="현재 설계"
              copy={item.currentValue ?? "대상이 삭제되었거나 이동함"}
            />
            <InfoBox title="AI 제안" copy={item.proposedValue ?? "없음"} />
          </div>
        ) : item.proposedValue !== null ? (
          <div className="sp-reconcile-evidence-grid sp-reconcile-action-top">
            <InfoBox title="현재 설계(분석 시점)" copy={item.beforeValue ?? ""} />
            <InfoBox title="제안 설계" copy={item.proposedValue} fact />
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
            className="sp-reconcile-evidence is-fact"
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
    return (
      <div className="sp-reconcile-decision">
        <textarea
          className="sp-input sp-textarea sp-reconcile-reason"
          value={props.reason}
          onChange={(event) => props.setReason(event.target.value)}
          placeholder="거부·보류 사유를 입력하세요. 적용 사유는 선택입니다."
        />
        <div className="sp-reconcile-actions">
          {props.item.proposedValue !== null && props.canApply ? (
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

export function InfoBox(props: { title: string; copy: string; fact?: boolean }) {
  return (
    <div className={`sp-reconcile-evidence ${props.fact ? "is-fact" : ""}`}>
      <div className="sp-reconcile-evidence-title">{props.title}</div>
      <div className="sp-reconcile-evidence-copy">{props.copy}</div>
    </div>
  );
}
