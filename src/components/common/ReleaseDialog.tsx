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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────
// 백엔드 SUPPORTED_DOC_KINDS 와 동기화 — 추가 시 양쪽을 함께 수정해야 함.
export type ReleaseDocKind = "REQUIREMENT" | "UNIT_WORK" | "REQUIREMENTS_DEF";

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

  const queryClient = useQueryClient();

  // 발행 이력 조회 — 모달 내에서 최종/이전 버전 + 직전 변경 내용까지 참고용으로 표시.
  // 사용자가 다음 버전과 변경 내용을 작성할 때 일관성 유지에 도움.
  const { data: historyData } = useQuery({
    queryKey: ["release-history", projectId, docKind, refId, "dialog-peek"],
    queryFn: () =>
      authFetch<{ data: { releases: Array<{
        releaseId:  string;
        version:    string;
        releasedAt: string;
        change:     string; // 변경 내용 — 직전 작성 패턴 참고용
      }> } }>(
        `/api/projects/${projectId}/documents/release?docKind=${encodeURIComponent(docKind)}&refId=${encodeURIComponent(refId)}`
      ).then((r) => r.data),
    enabled: open && !!projectId && !!refId,
    staleTime: 10_000,
  });
  const prevReleases = historyData?.releases ?? [];

  // ── doc_kind 별 타이틀 ────────────────────────────────────
  // 동작은 동일하지만 사용자가 어떤 산출물을 발행하는지 명확히 알도록 타이틀만 차별화.
  // 안내문/활용 예/필드 구성은 모두 공통 — 한 컴포넌트로 유지.
  const titleByDocKind: Record<ReleaseDocKind, string> = {
    REQUIREMENT:      "요구사항 명세서 발행",
    UNIT_WORK:        "프로그램 사양서 발행",
    REQUIREMENTS_DEF: "요구사항 정의서 발행",
  };
  const dialogTitle = titleByDocKind[docKind] ?? "산출물 발행";

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
      // 본인 다이얼로그 + 모든 동일 산출물 발행 이력 캐시 무효화
      // (prefix 매칭 — dialog-peek 키 / 외부 이력 다이얼로그 키 모두 갱신)
      queryClient.invalidateQueries({ queryKey: ["release-history", projectId, docKind, refId] });
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
          {dialogTitle}
        </h3>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
          현재 시점의 산출물을 새 버전으로 <strong style={{ color: "var(--color-text-primary)" }}>스냅샷</strong>해 보관합니다.
          이후 본문이 변경되어도 발행본은 그대로 유지되어, 문서실에서 언제든지 다운로드할 수 있습니다.
          <br />
          아래 <strong style={{ color: "var(--color-text-primary)" }}>변경 내용</strong>은 향후 이 산출물의 변경 이력으로 사용됩니다.
        </p>
        <div style={{
          margin: "0 0 18px",
          padding: "8px 12px",
          background: "var(--color-bg-muted)",
          borderRadius: 6,
          fontSize: 12,
          color: "var(--color-text-secondary)",
          lineHeight: 1.6,
        }}>
          💡 <strong style={{ color: "var(--color-text-primary)" }}>활용 예</strong> — 요구사항 정의서 고객 합의 시점, 설계 확정 시점 등
          협의 결과를 공식 버전으로 남길 때.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* 이전 발행 이력 안내 — 버전·변경 내용 작성 시 일관성 유지에 참고.
              발행 이력 0건이면 "첫 발행" 안내, 1건 이상이면 최대 5건 표시. */}
          <div style={prevReleasesStyle}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 6 }}>
              이전 발행 이력 (참고용)
            </div>
            {prevReleases.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                아직 발행 이력이 없습니다 — 이번이 첫 발행입니다.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {prevReleases.slice(0, 5).map((r, idx) => (
                  <div key={r.releaseId} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {idx === 0 && <span style={latestBadgeStyle}>최종</span>}
                    <span style={{
                      fontFamily: "monospace",
                      fontWeight: idx === 0 ? 700 : 600,
                      color:      idx === 0 ? "var(--color-primary, #1976d2)" : "var(--color-text-primary)",
                      whiteSpace: "nowrap",
                    }}>
                      {r.version}
                    </span>
                    <span style={{ fontSize: 11, whiteSpace: "nowrap", color: "var(--color-text-tertiary)" }}>
                      {r.releasedAt.slice(0, 10)}
                    </span>
                    {/* 변경 내용 — 길면 한 줄로 ellipsis 처리.
                        새 변경 내용 작성할 때 직전 패턴 (어조/길이) 참고용 */}
                    {r.change && (
                      <span style={{
                        flex: 1, minWidth: 0,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        fontSize: 12, color: "var(--color-text-secondary)",
                      }} title={r.change}>
                        — {r.change}
                      </span>
                    )}
                  </div>
                ))}
                {prevReleases.length > 5 && (
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                    … 이전 {prevReleases.length - 5}건 더 (발행 이력에서 확인)
                  </div>
                )}
              </div>
            )}
          </div>

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

// 이전 발행 이력 안내 패널 — 발행 버전 입력 위에 표시
const prevReleasesStyle: React.CSSProperties = {
  padding:      "10px 12px",
  background:   "var(--color-bg-muted)",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
};

const latestBadgeStyle: React.CSSProperties = {
  display:      "inline-block",
  padding:      "1px 6px",
  fontSize:     10,
  fontWeight:   700,
  lineHeight:   1.4,
  borderRadius: 3,
  background:   "var(--color-primary, #1976d2)",
  color:        "#fff",
  letterSpacing: "0.04em",
};
