"use client";

/**
 * ProjectSwapDialog — 열린 프로젝트 교체 (정책 §1-6)
 *
 * 왜 있는가:
 *   FREE 는 열린 소유 프로젝트가 1개뿐이다. A 를 쓰다 B 를 열려면 A 를 닫아야 하는데 닫는 수단이
 *   없어서, 지금까지는 "그 프로젝트를 삭제·양도하세요"라는 막다른 길이었다(삭제는 절대 없음 —
 *   정책 §1-6 과 정면으로 어긋난다). A 와 B 를 오가며 쓰는 것은 정책상 정상 사용이므로
 *   "여는 흐름 안에서" 닫기를 함께 처리한다. 단독 "닫기" 버튼은 두지 않는다.
 *
 * 화면:
 *   닫힐 프로젝트 이름과 열릴 프로젝트 이름을 나란히 보여 주고 [바꾸기] 하나로 처리한다.
 *   닫힐 프로젝트에 편집 멤버가 여럿이면(결제 도입 전부터 쓰던 프로젝트) 그 사람들의 편집이
 *   막히므로 경고 한 줄을 띄운다 — 당사자는 이유를 알 수 없기 때문이다.
 *
 * 서버:
 *   POST /api/projects/{open}/unlock { closeProjectIds } — 한 트랜잭션. 닫은 뒤에도 상한을 넘으면
 *   전체 롤백되어 아무것도 닫히지 않는다("둘 다 잠긴" 상태 방지). 그때는 이 다이얼로그를 닫고
 *   호출부가 받은 사유를 그대로 보여 준다.
 */

import { usePathname, useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { BILLING_PATH } from "@/lib/billing/constants";
import { overlayStyle, dialogStyle } from "./PlanLimitDialog";

/** 교체 대상 — 호출부(프로젝트 목록)가 이미 갖고 있는 값으로 채운다. 추가 조회 없음 */
export type SwapTarget = {
  projectId: string;
  name:      string;
  /** 편집 멤버 수 — 2명 이상이면 닫을 때 경고. 모르면 생략 */
  editorCount?: number;
};

export type ProjectSwapInfo = {
  /** 열려는(지금 잠긴) 프로젝트 */
  open:  SwapTarget;
  /** 닫아야 하는, 지금 열려 있는 소유 프로젝트들 — 보통 1개 */
  close: SwapTarget[];
};

type Props = {
  /** null 이면 닫힘 */
  info: ProjectSwapInfo | null;
  onClose: () => void;
  /** 교체 성공 — 목록 갱신 등 */
  onDone: () => void;
  /** 교체가 다른 사유로 거절됨(롤백됨) — 호출부가 그 사유를 안내한다 */
  onRejected: (err: Error) => void;
};

export default function ProjectSwapDialog({ info, onClose, onDone, onRejected }: Props) {
  const router   = useRouter();
  const pathname = usePathname();

  const mutation = useMutation({
    mutationFn: () =>
      authFetch<{ data: { unlocked: boolean; closedProjectIds: string[] } }>(
        `/api/projects/${info!.open.projectId}/unlock`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ closeProjectIds: info!.close.map((p) => p.projectId) }),
        },
      ),
    onSuccess: onDone,
    onError:   (err: Error) => { onClose(); onRejected(err); },
  });

  if (!info) return null;

  // 닫으면 편집이 막히는 사람이 있는 프로젝트 (소유자 본인 1명은 정상)
  const withOtherEditors = info.close.filter((p) => (p.editorCount ?? 1) > 1);
  const multiple = info.close.length > 1;

  function startBasic() {
    const params = new URLSearchParams();
    params.set("returnTo", pathname);
    onClose();
    router.push(`${BILLING_PATH}?${params.toString()}`);
  }

  return (
    <div style={overlayStyle} onClick={() => !mutation.isPending && onClose()} role="presentation">
      <div
        style={{ ...dialogStyle, maxWidth: 520 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-swap-dialog-title"
      >
        <h3
          id="project-swap-dialog-title"
          style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}
        >
          프로젝트를 바꿔서 열까요?
        </h3>
        <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          FREE 플랜은 프로젝트를 한 번에 1개만 열 수 있습니다.
          {multiple && ` 지금 ${info.close.length}개가 열려 있어 모두 닫습니다.`}
        </p>

        {/* 무엇이 닫히고 무엇이 열리는지 — 이 다이얼로그의 전부 */}
        <div
          style={{
            margin: "0 0 16px",
            padding: "12px 14px",
            borderRadius: "var(--radius-card)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
            display: "grid",
            gap: 8,
            fontSize: 14,
          }}
        >
          {info.close.map((p) => (
            <SwapRow key={p.projectId} arrow="닫힘" name={p.name} tone="muted" />
          ))}
          <SwapRow arrow="열림" name={info.open.name} tone="primary" />
        </div>

        {withOtherEditors.length > 0 && (
          <div className="sp-hint is-warn" style={{ display: "block", margin: "0 0 16px", lineHeight: 1.6 }}>
            {withOtherEditors.map((p) => p.name).join(", ")} 에 편집 멤버가 있습니다.
            닫으면 그분들도 읽기 전용이 되며 따로 알림은 가지 않습니다.
          </div>
        )}

        <p style={{ margin: "0 0 20px", fontSize: 12, color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
          닫힌 프로젝트는 읽기 전용이 되고 데이터는 그대로 남습니다. 언제든 다시 바꿀 수 있습니다.
          두 개를 함께 열려면 BASIC 이 필요합니다.
        </p>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="sp-btn" onClick={onClose} disabled={mutation.isPending} style={{ fontSize: 13, padding: "6px 14px" }}>
            취소
          </button>
          <button className="sp-btn sp-btn-ghost" onClick={startBasic} disabled={mutation.isPending} style={{ fontSize: 13, padding: "6px 14px" }}>
            BASIC 시작하기
          </button>
          <button
            className="sp-btn sp-btn-primary"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            style={{ fontSize: 13, padding: "6px 14px" }}
          >
            {mutation.isPending ? "바꾸는 중…" : "바꾸기"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "닫힘 ← 이름" / "열림 → 이름" 한 줄 */
function SwapRow({ arrow, name, tone }: { arrow: string; name: string; tone: "muted" | "primary" }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
      <span
        style={{
          flexShrink: 0, width: 40,
          fontSize: "var(--text-xs)", fontWeight: 600,
          color: tone === "primary" ? "var(--color-brand)" : "var(--color-text-tertiary)",
        }}
      >
        {arrow}
      </span>
      <span
        style={{
          color: tone === "primary" ? "var(--color-text-primary)" : "var(--color-text-secondary)",
          fontWeight: tone === "primary" ? 600 : 400,
          textDecoration: tone === "muted" ? "line-through" : "none",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}
      >
        {name}
      </span>
    </div>
  );
}
