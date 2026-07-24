"use client";

/**
 * LeaderReportDetail — 리더 리포트 우측 상세 (AI 결과 중심)
 *
 * 업무 리포트의 WeeklyDocView와 달리 "나만 보는 문서" 표 형식이 아니다 — 메인 콘텐츠는 PM이
 * 직접 쓰는 금주 실적/차주 계획/금주 코멘트/특이사항(perf_cn/plan_cn/comment_cn/note_cn) 네
 * 항목이고, AI 요청·원본은 그 아래 보조 영역이다(2026-07-23, 순서 변경 — 이전엔 AI 결과가
 * 위에 있었는데, "AI는 옵셔널이지 필수가 아니다"는 피드백으로 직접 작성이 메인이 됐다).
 * 그 아래 참여 현황(일별 기록 기준)과 팀원별 원본(접기/펼치기)을 참고용으로 둔다.
 *
 * AI 원본(draft_cn)과 실제 보고서 내용(perf_cn/plan_cn/comment_cn/note_cn)을 분리했다
 * (2026-07-22) — "## 금주실적" 같은 헤더 문구로 구분하던 방식은 AI 출력에 오타가 나면 깨지기
 * 쉬웠고, AI가 쓴 것과 PM이 직접 쓴 것이 한 텍스트에 섞여 있어 구분도 안 됐다. draft_cn은
 * 참고용 읽기 전용("AI 원본" 배지, AI 요청을 한 번도 안 했으면 아예 표시 안 함)이고, PM은
 * AI 요청과 완전히 무관하게 언제든 네 필드("직접 작성" 배지)를 직접 채울 수 있다 — 저장하면
 * TbWrWeeklyReport 행이 없어도 PATCH /weekly-reports(weekStartDt 기준)가 알아서 만든다.
 * AI 재생성을 눌러도 이 네 필드는 그대로 남는다(덮어쓰지 않음). "총평"이라는 이름은
 * 자기평가처럼 느껴진다는 피드백으로 "금주 코멘트"로 바꿨고, 별도로 "특이사항"도 추가했다
 * (comment_cn 컬럼명은 이전 review_cn에서 변경).
 *
 * 협조 및 이슈사항 현황(IssueList)은 주 선택과 무관한 상시 목록이라 여기 있지 않다 —
 * 페이지(page.tsx)의 별도 "협조·이슈" 탭에서 직접 렌더링한다(2026-07-22 이전엔 이 컴포넌트
 * 맨 아래 붙어 있었는데, 주 단위 콘텐츠를 다 스크롤해야 닿는 위치라 탭으로 분리했다).
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { addDaysStr } from "@/lib/weekUtil";
import type { WorkLogResponse, WorkLog } from "@/types/workLog";
import type { WeeklyReport, WeeklyReportListResponse } from "@/types/weeklyReport";
import DocEditableCell, { AiFeedbackMarkdown } from "../../work-report/_components/DocEditableCell";
import ActivityMdModal from "./ActivityMdModal";
import PrintPreviewModal from "./PrintPreviewModal";
import AiRequestCommentModal from "./AiRequestCommentModal";

const AI_STATUS_LABEL: Record<string, string> = {
  PENDING:     "생성 대기 중",
  IN_PROGRESS: "생성 처리 중",
  DONE:        "생성 완료",
  FAILED:      "생성 실패",
};

function memberSummaryLines(log: WorkLog): string[] {
  const lines: string[] = [];
  const todoItems = log.items.filter((i) => !i.refTyCode);
  const tagItems  = log.items.filter((i) => i.refTyCode);
  const done   = todoItems.filter((i) => i.doneYn === "Y").map((i) => i.itemCn);
  const undone = todoItems.filter((i) => i.doneYn !== "Y").map((i) => i.itemCn);
  const part: string[] = [];
  if (done.length)   part.push(`완료: ${done.join(", ")}`);
  if (undone.length) part.push(`미완료: ${undone.join(", ")}`);
  if (tagItems.length) part.push(`관련 일감: ${tagItems.map((i) => i.itemCn).join(", ")}`);
  if (log.noteCn?.trim()) part.push(`메모: ${log.noteCn.trim()}`);
  lines.push(`${log.logDt}: ${part.length ? part.join(" / ") : "(기록 없음)"}`);
  return lines;
}

export default function LeaderReportDetail({ projectId, monday }: { projectId: string; monday: string }) {
  const queryClient = useQueryClient();
  const [rawOpen, setRawOpen] = useState(false);
  const [mdModalOpen, setMdModalOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [aiCommentModalOpen, setAiCommentModalOpen] = useState(false);

  const sunday     = addDaysStr(monday, 6);
  const nextMonday = addDaysStr(monday, 7);

  const dailyQuery = useQuery({
    queryKey: ["work-log-range", projectId, monday, "DAILY", "all"],
    queryFn: () =>
      authFetch<{ data: WorkLogResponse }>(
        `/api/projects/${projectId}/work-logs?from=${monday}&to=${sunday}&logTyCode=DAILY&mberId=all`
      ).then((r) => r.data),
    enabled: !!projectId,
  });

  const thisWeekAllQuery = useQuery({
    queryKey: ["work-log", "WEEK", projectId, monday, "all"],
    queryFn: () =>
      authFetch<{ data: WorkLogResponse }>(
        `/api/projects/${projectId}/work-logs?date=${monday}&logTyCode=WEEK&mberId=all`
      ).then((r) => r.data),
    enabled: !!projectId,
  });

  const nextWeekAllQuery = useQuery({
    queryKey: ["work-log", "WEEK", projectId, nextMonday, "all"],
    queryFn: () =>
      authFetch<{ data: WorkLogResponse }>(
        `/api/projects/${projectId}/work-logs?date=${nextMonday}&logTyCode=WEEK&mberId=all`
      ).then((r) => r.data),
    enabled: !!projectId,
  });

  const membersQuery = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () =>
      authFetch<{ data: { members: { memberId: string; name: string | null }[] } }>(
        `/api/projects/${projectId}/members`
      ).then((r) => r.data),
    enabled: !!projectId,
  });

  const wrListQuery = useQuery({
    queryKey: ["weekly-reports", projectId],
    queryFn: () =>
      authFetch<{ data: WeeklyReportListResponse }>(`/api/projects/${projectId}/weekly-reports`).then((r) => r.data),
    enabled: !!projectId,
  });
  const existingReport = wrListQuery.data?.items.find((r) => r.weekStartDt === monday) ?? null;

  const reportDetailQuery = useQuery({
    queryKey: ["weekly-report", projectId, existingReport?.weeklyReportId],
    queryFn: () =>
      authFetch<{ data: WeeklyReport }>(`/api/projects/${projectId}/weekly-reports/${existingReport!.weeklyReportId}`).then((r) => r.data),
    enabled: !!existingReport,
    refetchInterval: (query) => {
      const status = query.state.data?.aiTaskStatus;
      return status === "PENDING" || status === "IN_PROGRESS" ? 5000 : false;
    },
  });

  const generateMutation = useMutation({
    mutationFn: (pmComment: string) =>
      authFetch(`/api/projects/${projectId}/weekly-reports`, {
        method: "POST",
        body: JSON.stringify({ weekStartDt: monday, pmComment: pmComment.trim() || undefined }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["weekly-reports", projectId] });
      setAiCommentModalOpen(false);
    },
  });

  // weekStartDt 기준 upsert — AI를 한 번도 요청하지 않아 TbWrWeeklyReport 행이 아직 없어도
  // 그냥 저장하면 이 라우트가 알아서 행을 만든다(AI 태스크는 절대 안 만듦). weeklyReportId가
  // 있어야만 호출 가능했던 예전 PATCH(.../[weeklyReportId])는 그래서 폐기했다(2026-07-23).
  const saveMutation = useMutation({
    mutationFn: (body: Partial<{ perfCn: string; planCn: string; commentCn: string; noteCn: string }>) =>
      authFetch(`/api/projects/${projectId}/weekly-reports`, {
        method: "PATCH",
        body: JSON.stringify({ weekStartDt: monday, ...body }),
      }),
    onSuccess: () => {
      // 목록을 무효화해야 처음 저장 시 새로 생긴 weeklyReportId를 existingReport가 잡아낸다
      queryClient.invalidateQueries({ queryKey: ["weekly-reports", projectId] });
      queryClient.invalidateQueries({ queryKey: ["weekly-report", projectId, existingReport?.weeklyReportId] });
    },
  });

  async function handleCopyAiDraft() {
    const text = reportDetailQuery.data?.draftCn ?? "";
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const isGenerating = reportDetailQuery.data?.aiTaskStatus === "PENDING" || reportDetailQuery.data?.aiTaskStatus === "IN_PROGRESS";

  // ── 참여 현황 — 일별(DAILY) 기록 하나라도 남긴 멤버 기준 ─────────────────────
  const writtenMemberIds = new Set((dailyQuery.data?.items ?? []).map((l) => l.mberId));
  const members = membersQuery.data?.members ?? [];

  // ── 팀원별 원본(접기/펼치기) — 셋 중 하나라도 쓴 멤버만 ──────────────────────
  const dailyByMember = new Map<string, WorkLog[]>();
  for (const log of dailyQuery.data?.items ?? []) {
    const list = dailyByMember.get(log.mberId) ?? [];
    list.push(log);
    dailyByMember.set(log.mberId, list);
  }
  const thisWeekByMember = new Map((thisWeekAllQuery.data?.items ?? []).map((l) => [l.mberId, l]));
  const nextWeekByMember = new Map((nextWeekAllQuery.data?.items ?? []).map((l) => [l.mberId, l]));
  const rawMberIds = [...new Set([...dailyByMember.keys(), ...thisWeekByMember.keys(), ...nextWeekByMember.keys()])];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", background: "var(--color-bg-card)", padding: 16 }}>
        {/* 직접 작성 — AI 요청 여부와 완전히 무관하게 항상 바로 쓸 수 있다("AI는 옵셔널이지
            필수가 아니다", 2026-07-23). perf_cn/plan_cn/comment_cn/note_cn 별도 컬럼이라
            헤더 문구 파싱에 의존하지 않아 AI 원본의 오타나 형식 변화와도 무관하게 항상 안정적으로
            구분된다. 네 항목을 한눈에 비교하기 좋게 가로로 배치(좁은 화면에서는 자동으로 줄바꿈). */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--color-text-primary)" }}>금주 실적</span>
              <span className="sp-badge sp-badge-success"><span className="dot" />직접 작성</span>
            </div>
            <DocEditableCell
              value={reportDetailQuery.data?.perfCn ?? ""}
              placeholder="이번 주 실적을 정리해 보세요."
              minRows={6}
              onSave={(v) => saveMutation.mutate({ perfCn: v })}
            />
          </div>

          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--color-text-primary)" }}>차주 계획</span>
              <span className="sp-badge sp-badge-success"><span className="dot" />직접 작성</span>
            </div>
            <DocEditableCell
              value={reportDetailQuery.data?.planCn ?? ""}
              placeholder="다음 주 계획을 정리해 보세요."
              minRows={6}
              onSave={(v) => saveMutation.mutate({ planCn: v })}
            />
          </div>

          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--color-text-primary)" }}>금주 코멘트 (선택)</span>
              <span className="sp-badge sp-badge-success"><span className="dot" />직접 작성</span>
            </div>
            <DocEditableCell
              value={reportDetailQuery.data?.commentCn ?? ""}
              placeholder="실적/계획을 자세히 볼 시간 없는 분들을 위한 한 줄 요약."
              minRows={6}
              onSave={(v) => saveMutation.mutate({ commentCn: v })}
            />
          </div>

          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--color-text-primary)" }}>특이사항 (선택)</span>
              <span className="sp-badge sp-badge-success"><span className="dot" />직접 작성</span>
            </div>
            <DocEditableCell
              value={reportDetailQuery.data?.noteCn ?? ""}
              placeholder="이번 주에 있었던 특기할 사항을 남겨 보세요."
              minRows={6}
              onSave={(v) => saveMutation.mutate({ noteCn: v })}
            />
          </div>
        </div>

        {/* AI 영역 — 직접 작성 항목 아래로(2026-07-23, 순서 변경). 참고용일 뿐이라 AI 요청을
            한 번도 안 했으면 원본 박스 자체를 안 보여준다("아직 초안 없음" 같은 빈 상자보다,
            버튼만 있고 조용한 편이 "AI는 선택"이라는 톤에 더 맞는다). */}
        <div style={{ borderTop: "1px solid var(--color-border-subtle)", paddingTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            {reportDetailQuery.data?.aiTaskStatus && (
              <span
                className={`sp-badge ${
                  reportDetailQuery.data.aiTaskStatus === "DONE" ? "sp-badge-success"
                  : reportDetailQuery.data.aiTaskStatus === "FAILED" ? "sp-badge-error"
                  : "sp-badge-warning"
                }`}
              >
                <span className="dot" />{AI_STATUS_LABEL[reportDetailQuery.data.aiTaskStatus] ?? reportDetailQuery.data.aiTaskStatus}
              </span>
            )}
            <button
              type="button"
              className="sp-btn sp-btn-primary sp-btn-sm"
              disabled={generateMutation.isPending || isGenerating}
              onClick={() => setAiCommentModalOpen(true)}
            >
              {existingReport?.draftCn ? "AI 재생성" : "AI 요청"}
            </button>
            <button type="button" className="sp-btn sp-btn-secondary sp-btn-sm" onClick={() => setMdModalOpen(true)}>
              최근 주간 활동 MD
            </button>
            <button type="button" className="sp-btn sp-btn-secondary sp-btn-sm" onClick={() => setPrintOpen(true)} style={{ marginLeft: "auto" }}>
              인쇄 미리보기
            </button>
          </div>

          {isGenerating && (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
              생성 요청이 접수되었습니다. 팀에서 AI 태스크가 처리되면 자동으로 반영됩니다.
            </div>
          )}

          {!isGenerating && reportDetailQuery.data?.draftCn && (
            <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", background: "var(--color-bg-muted)", padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span className="sp-badge sp-badge-info"><span className="dot" />AI 원본</span>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>참고용 — 위 항목에 직접 옮겨 적어 주세요</span>
                <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" style={{ marginLeft: "auto" }} onClick={handleCopyAiDraft}>
                  {copied ? "복사됨" : "복사"}
                </button>
              </div>
              <AiFeedbackMarkdown value={reportDetailQuery.data.draftCn} />
            </div>
          )}
        </div>
      </div>

      {/* 참여 현황 */}
      <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", background: "var(--color-bg-card)", padding: 16 }}>
        <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 10 }}>
          참여 현황 — {writtenMemberIds.size}/{members.length}명 작성 (일별 기록 기준)
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {members.map((m) => {
            const written = writtenMemberIds.has(m.memberId);
            return (
              <span
                key={m.memberId}
                className={`sp-badge ${written ? "sp-badge-success" : "sp-badge-neutral"}`}
              >
                <span className="dot" />{m.name ?? "(이름 없음)"} {written ? "" : "· 미작성"}
              </span>
            );
          })}
        </div>
      </div>

      {/* 팀원별 원본 — 접기/펼치기 */}
      <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", background: "var(--color-bg-card)", padding: 16 }}>
        <div
          onClick={() => setRawOpen((v) => !v)}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
        >
          <span style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--color-text-primary)" }}>
            팀원별 원본 보기 ({rawMberIds.length}명)
          </span>
          <span style={{ color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }}>{rawOpen ? "접기" : "펼치기"}</span>
        </div>

        {rawOpen && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
            {rawMberIds.length === 0 && (
              <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>이번 주 작성된 업무일지가 없습니다.</div>
            )}
            {rawMberIds.map((mberId) => {
              const thisWeek = thisWeekByMember.get(mberId);
              const nextWeek = nextWeekByMember.get(mberId);
              const dailies  = dailyByMember.get(mberId) ?? [];
              const name = thisWeek?.mberNm ?? nextWeek?.mberNm ?? dailies[0]?.mberNm ?? mberId;
              const weekLines: string[] = [];
              if (thisWeek?.noteCn?.trim())   weekLines.push(`이번주 계획: ${thisWeek.noteCn.trim()}`);
              if (thisWeek?.resultCn?.trim()) weekLines.push(`이번주 결과: ${thisWeek.resultCn.trim()}`);
              if (nextWeek?.noteCn?.trim())   weekLines.push(`다음주 계획: ${nextWeek.noteCn.trim()}`);

              return (
                <div key={mberId} style={{ borderTop: "1px solid var(--color-border-subtle)", paddingTop: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--color-text-primary)", marginBottom: 4 }}>
                    {name}
                  </div>
                  {weekLines.length > 0 && (
                    <ul style={{ margin: "0 0 6px", paddingLeft: 18, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                      {weekLines.map((l, i) => <li key={i}>{l}</li>)}
                    </ul>
                  )}
                  {dailies.length > 0 && (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                      {dailies.flatMap((log) => memberSummaryLines(log)).map((l, i) => <li key={i}>{l}</li>)}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {aiCommentModalOpen && (
        <AiRequestCommentModal
          isRegenerate={!!existingReport}
          submitting={generateMutation.isPending}
          onCancel={() => setAiCommentModalOpen(false)}
          onSubmit={(comment) => generateMutation.mutate(comment)}
        />
      )}
      {mdModalOpen && (
        <ActivityMdModal projectId={projectId} weekMonday={monday} onClose={() => setMdModalOpen(false)} />
      )}
      {printOpen && (
        <PrintPreviewModal
          projectId={projectId}
          monday={monday}
          weeklyReportId={existingReport?.weeklyReportId ?? null}
          perfCn={reportDetailQuery.data?.perfCn ?? null}
          planCn={reportDetailQuery.data?.planCn ?? null}
          commentCn={reportDetailQuery.data?.commentCn ?? null}
          noteCn={reportDetailQuery.data?.noteCn ?? null}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </div>
  );
}
