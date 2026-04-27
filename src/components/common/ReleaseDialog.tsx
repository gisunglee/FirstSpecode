"use client";

/**
 * ReleaseDialog — 산출물 발행 모달
 *
 * 역할:
 *   - 사용자가 산출물(요구사항·단위업무·화면 등) 1건을 새 버전으로 "공식 발행" 할 때
 *     모달에서 버전·변경 내용·작성자·승인자를 입력받는다.
 *   - 발행 시 POST /api/projects/[id]/documents/release 호출 → 성공 시 onSuccess 콜백.
 *   - 모달 자체는 도메인 무관 — props 로 docKind, refId, defaults 만 전달받음.
 *
 * 입력 항목:
 *   - 발행 버전 (필수)
 *   - 변경 내용 (선택, textarea)
 *   - 작성자   (선택, 기본값: 도메인 담당자명 등 호출부에서 제공)
 *   - 승인자   (선택, 기본값: 프로젝트 설정의 PM)
 *
 * 사용 예:
 *   <ReleaseDialog
 *     open={isOpen}
 *     projectId={projectId}
 *     docKind="REQUIREMENT"
 *     refId={reqId}
 *     defaults={{ version: "v1.1", author: "이기성", approver: "이제형" }}
 *     onClose={() => setIsOpen(false)}
 *     onSuccess={() => { setIsOpen(false); refetchHistory(); }}
 *   />
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────
export type ReleaseDocKind = "REQUIREMENT"; // 추후 "UNIT_WORK" | "SCREEN" 등 추가

type ReleaseDialogProps = {
  open:       boolean;
  projectId:  string;
  docKind:    ReleaseDocKind;
  refId:      string;
  /** 모달 열릴 때 초기값으로 채워지는 값들 — 사용자가 자유 수정 가능 */
  defaults: {
    version:  string;
    author:   string;
    approver: string;
  };
  onClose:   () => void;
  onSuccess: (release: { releaseId: string; version: string }) => void;
};

type ReleaseSuccessResponse = {
  releaseId:  string;
  vrsnNo:     string;
  releasedAt: string;
};

// ── 입력 길이 — 백엔드와 동일 (백엔드가 진짜 검증, 여기는 UX 보조) ────────
const MAX_VERSION  = 50;
const MAX_CHANGE   = 2000;
const MAX_AUTHOR   = 100;
const MAX_APPROVER = 100;

export default function ReleaseDialog({
  open,
  projectId,
  docKind,
  refId,
  defaults,
  onClose,
  onSuccess,
}: ReleaseDialogProps) {
  // 폼 상태 — 모달이 열릴 때마다 defaults 로 초기화
  const [version,   setVersion]   = useState(defaults.version);
  const [changeCn,  setChangeCn]  = useState("");
  const [author,    setAuthor]    = useState(defaults.author);
  const [approver,  setApprover]  = useState(defaults.approver);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 모달이 새로 열릴 때마다 defaults 반영 — 다른 산출물에서 재사용 가능하게
  useEffect(() => {
    if (open) {
      setVersion(defaults.version);
      setChangeCn("");
      setAuthor(defaults.author);
      setApprover(defaults.approver);
    }
    // open 이 true 로 바뀌는 순간만 초기화 — defaults 가 살짝 바뀌어도 입력 중인 값을 덮어쓰지 않음
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  async function handleSubmit() {
    if (!version.trim()) {
      toast.error("발행 버전을 입력해 주세요.");
      return;
    }
    if (version.length > MAX_VERSION) {
      toast.error(`발행 버전은 ${MAX_VERSION}자 이내로 입력해 주세요.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await authFetch<{ data: ReleaseSuccessResponse }>(
        `/api/projects/${projectId}/documents/release`,
        {
          method: "POST",
          body: JSON.stringify({
            docKind,
            refId,
            vrsnNo:     version.trim(),
            // 빈 문자열은 백엔드에서 fallback 처리 — null 로 명시적 전달
            changeCn:   changeCn.trim()  || null,
            authorNm:   author.trim()    || null,
            approverNm: approver.trim()  || null,
          }),
        }
      );
      toast.success(`${res.data.vrsnNo} 버전으로 발행되었습니다.`);
      onSuccess({ releaseId: res.data.releaseId, version: res.data.vrsnNo });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "발행에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose} role="presentation">
      <div
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-dialog-title"
      >
        <h3
          id="release-dialog-title"
          style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}
        >
          산출물 발행
        </h3>
        <p style={{ margin: "0 0 18px", fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          현재 시점의 산출물 양식을 새 버전으로 박제합니다.
          이후 데이터가 바뀌어도 이 발행본은 그대로 다운로드 가능합니다.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label className="sp-label" htmlFor="rl-version">
              발행 버전 <span style={{ color: "var(--color-error)" }}>*</span>
            </label>
            <input
              id="rl-version"
              className="sp-input"
              placeholder="v1.0"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              maxLength={MAX_VERSION}
              autoFocus
            />
          </div>

          <div>
            <label className="sp-label" htmlFor="rl-change">변경 내용</label>
            <textarea
              id="rl-change"
              className="sp-input"
              placeholder="예) 최초 작성, RFP 1차 변경 반영, 사용자 팝업 추가"
              value={changeCn}
              onChange={(e) => setChangeCn(e.target.value)}
              maxLength={MAX_CHANGE}
              rows={3}
              style={{ resize: "vertical", lineHeight: 1.5 }}
            />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label className="sp-label" htmlFor="rl-author">작성자</label>
              <input
                id="rl-author"
                className="sp-input"
                placeholder="(미지정)"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                maxLength={MAX_AUTHOR}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="sp-label" htmlFor="rl-approver">승인자</label>
              <input
                id="rl-approver"
                className="sp-input"
                placeholder="(미지정)"
                value={approver}
                onChange={(e) => setApprover(e.target.value)}
                maxLength={MAX_APPROVER}
              />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            style={{ ...secondaryBtnStyle, fontSize: 13, padding: "6px 14px" }}
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            style={{
              ...primaryBtnStyle,
              fontSize: 13,
              padding: "6px 14px",
              cursor: isSubmitting ? "wait" : "pointer",
              opacity: isSubmitting ? 0.6 : 1,
            }}
          >
            {isSubmitting ? "발행 중..." : "발행"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 스타일 (ConfirmDialog 패턴과 동일) ───────────────────────────────────
const overlayStyle: React.CSSProperties = {
  position:       "fixed",
  inset:          0,
  background:     "rgba(0,0,0,0.45)",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
  zIndex:         1000,
};

const dialogStyle: React.CSSProperties = {
  background:   "var(--color-bg-card)",
  borderRadius: 10,
  padding:      "24px 28px",
  width:        "100%",
  maxWidth:     520,
  boxShadow:    "0 8px 32px rgba(0,0,0,0.18)",
  border:       "1px solid var(--color-border)",
};

const primaryBtnStyle: React.CSSProperties = {
  padding:      "8px 20px",
  borderRadius: 6,
  border:       "1px solid transparent",
  background:   "var(--color-primary, #1976d2)",
  color:        "#fff",
  fontSize:     14,
  fontWeight:   600,
  cursor:       "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding:      "8px 16px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     14,
  cursor:       "pointer",
};
