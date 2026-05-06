"use client";

/**
 * PlanStudioAIRequestPopup — 기획실 산출물 AI 생성 확인 팝업
 *
 * 역할:
 *   - "AI 생성" 클릭 시 즉시 INSERT 하지 않고, 매칭된 프롬프트 정보 + 전달 내용 미리보기 +
 *     사용자 코멘트·첨부 이미지를 받아 최종 확인 후 generate API 호출.
 *
 * 매칭:
 *   - GET /api/projects/[id]/prompt-templates?domain=plan-studio&divCode=...&fmtCode=...&useYn=Y
 *   - default_yn='Y' 우선, 없으면 첫 번째 항목.
 *   - 매칭 실패 시 본 팝업은 "요청" 차단(영역 패턴과 동일).
 *
 * 호출:
 *   - POST /api/projects/[id]/plan-studios/[planStudioId]/artifacts/[artfId]/generate
 *   - multipart/form-data — coment_cn + contexts(JSON 문자열) + files[]
 *   - 서버 측에서 multipart 처리 (route.ts 갱신 필요)
 */

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { ARTF_DIV, ARTF_FMT } from "@/constants/planStudio";
import AiTaskFilePicker from "@/components/ui/AiTaskFilePicker";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type ContextItem = { ctxtTyCode: string; refId: string; sortOrdr?: number };

type MatchedPrompt = {
  tmplId:           string;
  tmplNm:           string;
  sysPromptPreview: string;
};

type PromptListItem = {
  tmplId:           string;
  tmplNm:           string;
  defaultYn:        string;
  sysPromptPreview: string;
};

type Props = {
  open:        boolean;
  onClose:     () => void;
  projectId:   string;
  planStudioId: string;
  artfId:      string;
  artfNm:      string;
  artfDivCode: string;       // IA / JOURNEY / FLOW / MOCKUP / ERD / PROCESS
  artfFmtCode: string;       // MD / MERMAID / HTML
  artfIdeaCn:  string;
  contexts:    ContextItem[];
  isReRequest: boolean;      // 이미 한 번 처리된 후 재요청인지 — 헤더 안내용
  onSuccess:   () => void;
};

// ── 컴포넌트 ──────────────────────────────────────────────────────────────────

export default function PlanStudioAIRequestPopup({
  open, onClose,
  projectId, planStudioId, artfId,
  artfNm, artfDivCode, artfFmtCode, artfIdeaCn, contexts,
  isReRequest, onSuccess,
}: Props) {
  // ── 폼 상태 ──
  const [comment, setComment] = useState("");
  const [files,   setFiles]   = useState<File[]>([]);
  // 매칭 결과 — null=초기, "loading"=조회중, "none"=매칭실패, 객체=매칭성공
  const [taskPrompt, setTaskPrompt] = useState<MatchedPrompt | null | "loading" | "none">(null);

  // ── 매칭 프롬프트 조회 (open=true 로 전환되는 시점에만) ──
  useEffect(() => {
    if (!open) return;
    setTaskPrompt("loading");
    authFetch<{ data: PromptListItem[] }>(
      `/api/projects/${projectId}/prompt-templates`
        + `?domain=plan-studio&divCode=${artfDivCode}&fmtCode=${artfFmtCode}&useYn=Y`,
    )
      .then((res) => {
        const list = res.data ?? [];
        // default_yn='Y' 우선, 없으면 가장 첫 번째 항목 (서버 정렬과 동일 우선순위)
        const preferred = list.find((t) => t.defaultYn === "Y") ?? list[0] ?? null;
        setTaskPrompt(
          preferred
            ? { tmplId: preferred.tmplId, tmplNm: preferred.tmplNm, sysPromptPreview: preferred.sysPromptPreview }
            : "none",
        );
      })
      .catch(() => setTaskPrompt("none"));
  }, [open, projectId, artfDivCode, artfFmtCode]);

  // ── 팝업 닫힐 때 입력값 초기화 (다음 호출 때 잔여 상태 안 남도록) ──
  useEffect(() => {
    if (!open) {
      setComment("");
      setFiles([]);
      setTaskPrompt(null);
    }
  }, [open]);

  // ── 요청 뮤테이션 (multipart) ──
  // authFetch 는 Content-Type 을 JSON 으로 고정하므로 raw fetch 사용.
  const requestMut = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("artfNm",      artfNm);
      fd.append("artfDivCode", artfDivCode);
      fd.append("artfFmtCode", artfFmtCode);
      fd.append("artfIdeaCn",  artfIdeaCn ?? "");
      fd.append("comentCn",    comment.trim());
      fd.append("contexts",    JSON.stringify(contexts));
      files.forEach((f) => fd.append("files", f));

      const at = typeof window !== "undefined" ? (sessionStorage.getItem("access_token") ?? "") : "";
      const res = await fetch(
        `/api/projects/${projectId}/plan-studios/${planStudioId}/artifacts/${artfId}/generate`,
        {
          method:  "POST",
          body:    fd,
          headers: at ? { Authorization: `Bearer ${at}` } : {},
        },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { message?: string }).message ?? "AI 요청에 실패했습니다.");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("AI 요청이 등록되었습니다. AI 태스크 목록에서 확인하세요.");
      onSuccess();
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!open) return null;

  // ── 표시용 라벨 ──
  const divLabel = ARTF_DIV[artfDivCode as keyof typeof ARTF_DIV]?.name ?? artfDivCode;
  const fmtLabel = ARTF_FMT[artfFmtCode as keyof typeof ARTF_FMT]?.name ?? artfFmtCode;
  const reqCount  = contexts.filter((c) => c.ctxtTyCode === "REQ").length;
  const artfCount = contexts.filter((c) => c.ctxtTyCode === "ARTF").length;
  const hasIdea   = (artfIdeaCn ?? "").trim().length > 0;

  // 요청 버튼 활성 조건 — 매칭 성공한 경우에만 (영역 패턴과 동일 정책)
  const canRequest = taskPrompt && taskPrompt !== "loading" && taskPrompt !== "none";

  return (
    <div
      data-impl-overlay="plan-studio-ai-request"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        style={{ width: "100%", maxWidth: 540, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 12, boxShadow: "0 12px 48px rgba(0,0,0,0.25)", padding: "32px 36px", maxHeight: "90vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <span style={{ fontSize: 24 }}>✦</span>
          <div>
            <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
              기획실 산출물 AI 생성
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>
              요구사항·기획보드를 바탕으로 산출물을 생성합니다.
            </p>
          </div>
        </div>

        {/* 재요청 안내 — 이미 한 번 처리된 산출물에서 다시 호출하는 경우 */}
        {isReRequest && (
          <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(245,124,0,0.08)", border: "1px solid rgba(245,124,0,0.22)", borderRadius: 8, fontSize: 13, color: "#b45309" }}>
            ⚠ 이미 AI 요청 이력이 있는 산출물입니다. 다시 요청하면 새 결과로 본문이 갱신됩니다.
          </div>
        )}

        {/* 매칭 프롬프트 박스 */}
        <div style={{ marginBottom: 20, padding: "14px 16px", background: "rgba(103,80,164,0.06)", border: "1px solid rgba(103,80,164,0.18)", borderRadius: 8 }}>
          {taskPrompt === "loading" ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>프롬프트 템플릿 조회 중...</p>
          ) : taskPrompt === "none" || taskPrompt === null ? (
            <div>
              <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: "#c62828" }}>⚠ 프롬프트 템플릿을 찾지 못했습니다.</p>
              <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                <strong>{divLabel} · {fmtLabel}</strong> 조합의 프롬프트 템플릿이 없습니다.<br />
                프롬프트 관리 화면에서 등록한 후 다시 시도하세요.
              </p>
            </div>
          ) : (
            <>
              <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 600 }}>✅ 프롬프트 템플릿 찾았습니다</p>
              <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 700, color: "rgba(103,80,164,1)" }}>{taskPrompt.tmplNm}</p>
              {/* 시스템 프롬프트 살짝 미리보기 — 200자 절단된 본문 */}
              {taskPrompt.sysPromptPreview && (
                <pre style={{
                  margin: 0,
                  padding: "8px 10px",
                  background: "var(--color-bg-card)",
                  border:     "1px solid var(--color-border)",
                  borderRadius: 6,
                  fontSize:   11,
                  lineHeight: 1.55,
                  color:      "var(--color-text-secondary)",
                  whiteSpace: "pre-wrap",
                  wordBreak:  "break-word",
                  fontFamily: "inherit",
                  maxHeight:  140,
                  overflow:   "hidden",
                }}>
                  {taskPrompt.sysPromptPreview}
                </pre>
              )}
            </>
          )}
        </div>

        {/* 전달되는 내용 — 라벨 요약 */}
        <div style={{ marginBottom: 20, fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
          <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--color-text-primary)" }}>전달되는 내용</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {canRequest && (
              <SummaryRow label="시스템 프롬프트" value={taskPrompt.tmplNm} />
            )}
            <SummaryRow label="구분 · 형식" value={`${divLabel} (${artfDivCode}) · ${fmtLabel} (${artfFmtCode})`} />
            <SummaryRow label="요구사항"     value={`${reqCount}건`} />
            <SummaryRow label="기획보드"     value={`${artfCount}건`} />
            <SummaryRow label="상세 아이디어" value={hasIdea ? "작성됨" : "없음"} />
          </div>
        </div>

        {/* 코멘트 입력 */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 8 }}>
            <span style={{ fontSize: 11, background: "rgba(103,80,164,0.12)", color: "rgba(103,80,164,0.9)", borderRadius: 4, padding: "1px 6px" }}>코멘트</span>
            AI 요청 코멘트
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="AI에게 전달할 추가 지시사항(선택)"
            rows={3}
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)", fontSize: 13, resize: "vertical", lineHeight: 1.6, outline: "none" }}
          />
        </div>

        {/* 첨부 이미지 — multipart 로 함께 전송 (Claude 멀티모달 분석용) */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 8 }}>
            <span style={{ fontSize: 11, background: "rgba(25,118,210,0.12)", color: "#1565c0", borderRadius: 4, padding: "1px 6px" }}>첨부</span>
            참고 이미지 (선택)
          </label>
          <AiTaskFilePicker
            files={files}
            onChange={setFiles}
            disabled={requestMut.isPending}
          />
        </div>

        {/* 버튼 */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onClose}
            disabled={requestMut.isPending}
            style={cancelBtnStyle}
          >
            취소
          </button>
          <button
            onClick={() => requestMut.mutate()}
            disabled={requestMut.isPending || !canRequest}
            style={{
              ...primaryBtnStyle,
              opacity: !canRequest ? 0.3 : 1,
              cursor:  !canRequest ? "not-allowed" : "pointer",
            }}
          >
            {requestMut.isPending ? "요청 중..." : "요청"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 작은 보조 컴포넌트: "전달되는 내용" 라벨 한 줄 ──
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontSize: 11, background: "rgba(103,80,164,0.12)", color: "rgba(103,80,164,0.9)", borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>
        {label}
      </span>
      <span>{value}</span>
    </div>
  );
}

// ── 스타일 상수 ───────────────────────────────────────────────────────────────

const primaryBtnStyle: React.CSSProperties = {
  padding:    "7px 20px",
  borderRadius: 6,
  border:     "1px solid transparent",
  background: "var(--color-brand)",
  color:      "var(--color-text-inverse)",
  fontSize:   13,
  fontWeight: 600,
};

const cancelBtnStyle: React.CSSProperties = {
  padding:    "7px 18px",
  borderRadius: 6,
  border:     "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color:      "var(--color-text-primary)",
  fontSize:   13,
  cursor:     "pointer",
};
