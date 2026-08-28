/**
 * weeklyReportPrompt — 주간보고 AI 프롬프트 조립 (데이터 수집 + 텍스트 조립만, side-effect 없음)
 *
 * POST /api/projects/[id]/weekly-reports(초안 생성) 와
 * GET  /api/projects/[id]/weekly-reports/export-md(개인적으로 Claude에 붙여넣기용 MD 내보내기)
 * 둘 다 "AI에게 실제로 전달되는 내용"이 완전히 같아야 하므로 한 곳에서 관리한다.
 *
 * DB 쓰기(TbAiPromptTemplate.use_cnt 증가, TbWrWeeklyReport/TbAiTask 생성)는 호출부 책임 —
 * 이 함수는 순수하게 "이 주에 대해 어떤 텍스트를 만들 것인가"만 담당한다.
 */

import { prisma } from "@/lib/prisma";
import { addDaysStr } from "@/lib/weekUtil";
import { normalizeWeekNarrative } from "@/lib/workLogWeekNarrative";

export type WeeklyReportPromptResult = {
  finalReqCn:   string;
  promptTmplId: string | null;
};

export async function buildWeeklyReportPrompt(
  projectId: string,
  weekStart: string,
  // PM이 "AI 요청" 팝업에서 남긴 추가 코멘트 — 선택. export-md(개인 MD 내보내기)는 이 개념이
  // 없어 인자를 안 넘기므로 undefined로 자연스럽게 생략된다.
  pmComment?: string
): Promise<WeeklyReportPromptResult> {
  const weekEnd     = addDaysStr(weekStart, 6);
  const nextMonday  = addDaysStr(weekStart, 7);
  const nextSunday  = addDaysStr(weekStart, 13);
  // 지난주/전전주 — "총평"에서 흐름(반복 지연, 추세)을 짚을 수 있도록 참고용으로 넘긴다.
  // 데이터 자체(업무일지 원본)가 아니라 그때 이미 만들어둔 draft_cn(완성된 보고문)을 재사용 —
  // 매번 원본을 다시 요약시키면 이번 주 분석과 과거 분석이 섞여 프롬프트만 커진다.
  const lastWeekStart    = addDaysStr(weekStart, -7);
  const twoWeeksAgoStart = addDaysStr(weekStart, -14);

  // ── 그 주 전체 팀원 업무일지 + 프로젝트 정보 + 지난 2주 보고 수집 (병렬) ──────────
  const [dailyLogs, thisWeekLogs, nextWeekLogs, project, pastReports] = await Promise.all([
    prisma.tbWrWorkLog.findMany({
      where: {
        prjct_id:    projectId,
        log_ty_code: "DAILY",
        log_dt:      { gte: new Date(weekStart + "T00:00:00Z"), lte: new Date(weekEnd + "T00:00:00Z") },
      },
      include: { items: { orderBy: { sort_ordr: "asc" } } },
      orderBy: [{ creat_mber_id: "asc" }, { log_dt: "asc" }],
    }),
    prisma.tbWrWorkLog.findMany({
      where: { prjct_id: projectId, log_ty_code: "WEEK", log_dt: new Date(weekStart + "T00:00:00Z") },
      include: { items: { orderBy: { sort_ordr: "asc" } } },
    }),
    prisma.tbWrWorkLog.findMany({
      where: { prjct_id: projectId, log_ty_code: "WEEK", log_dt: new Date(nextMonday + "T00:00:00Z") },
    }),
    prisma.tbPjProject.findUnique({
      where:  { prjct_id: projectId },
      select: { prjct_nm: true, prjct_dc: true, client_nm: true },
    }),
    prisma.tbWrWeeklyReport.findMany({
      where: {
        prjct_id: projectId,
        week_start_dt: { in: [new Date(lastWeekStart + "T00:00:00Z"), new Date(twoWeeksAgoStart + "T00:00:00Z")] },
      },
      select: { week_start_dt: true, draft_cn: true },
    }),
  ]);

  const lastWeekReport    = pastReports.find((r) => r.week_start_dt.toISOString().slice(0, 10) === lastWeekStart);
  const twoWeeksAgoReport = pastReports.find((r) => r.week_start_dt.toISOString().slice(0, 10) === twoWeeksAgoStart);

  const thisWeekByMember = new Map(thisWeekLogs.map((l) => [l.creat_mber_id, l]));
  const nextWeekByMember = new Map(nextWeekLogs.map((l) => [l.creat_mber_id, l]));

  const byMember = new Map<string, typeof dailyLogs>();
  for (const log of dailyLogs) {
    const list = byMember.get(log.creat_mber_id) ?? [];
    list.push(log);
    byMember.set(log.creat_mber_id, list);
  }

  // 세 데이터(일별/이번주 자기입력/다음주 자기입력) 중 하나라도 작성한 멤버는 전부 포함
  const allMberIds = [...new Set([...byMember.keys(), ...thisWeekByMember.keys(), ...nextWeekByMember.keys()])];
  const members = allMberIds.length > 0
    ? await prisma.tbCmMember.findMany({
        where:  { mber_id: { in: allMberIds } },
        select: { mber_id: true, mber_nm: true, email_addr: true },
      })
    : [];
  const nameMap = new Map(members.map((m) => [m.mber_id, m.mber_nm || m.email_addr || m.mber_id]));

  const logLines: string[] = [];
  for (const mberId of allMberIds) {
    logLines.push(`### ${nameMap.get(mberId)}`);

    // ── 주간 자기 입력 — 본인이 직접 적은 계획/결과 ──
    const thisWeek = thisWeekByMember.get(mberId);
    const nextWeek = nextWeekByMember.get(mberId);
    const thisWeekNarrative = thisWeek
      ? normalizeWeekNarrative({
          noteCn: thisWeek.note_cn,
          resultCn: thisWeek.result_cn,
          logDt: thisWeek.log_dt,
          savedAt: thisWeek.mdfcn_dt ?? thisWeek.creat_dt,
        })
      : null;
    const nextWeekNarrative = nextWeek
      ? normalizeWeekNarrative({
          noteCn: nextWeek.note_cn,
          resultCn: nextWeek.result_cn,
          logDt: nextWeek.log_dt,
          savedAt: nextWeek.mdfcn_dt ?? nextWeek.creat_dt,
        })
      : null;
    const weekPart: string[] = [];
    if (thisWeekNarrative?.noteCn?.trim())   weekPart.push(`이번주 계획: ${thisWeekNarrative.noteCn.trim()}`);
    if (thisWeekNarrative?.resultCn?.trim()) weekPart.push(`이번주 결과: ${thisWeekNarrative.resultCn.trim()}`);
    if (thisWeek?.items?.length)     weekPart.push(`중요업무: ${thisWeek.items.map((i) => i.item_cn).join(", ")}`);
    if (nextWeekNarrative?.noteCn?.trim())   weekPart.push(`다음주 계획: ${nextWeekNarrative.noteCn.trim()}`);
    if (weekPart.length > 0) {
      logLines.push(`[주간 자기 입력]`);
      for (const line of weekPart) logLines.push(`- ${line}`);
    }

    // ── 일별 기록 ──
    const memberDailyLogs = byMember.get(mberId) ?? [];
    if (memberDailyLogs.length > 0) {
      logLines.push(`[일별 기록]`);
      for (const log of memberDailyLogs) {
        const dateStr = log.log_dt.toISOString().slice(0, 10);
        // ref_ty_code 있는 항목은 "참고 일감 태그"(체크박스 없음, 완료 개념이 없음) — 계획 체크리스트와
        // 별개다. 완료/미완료 집계에 섞으면 AI가 "게시판 일감 미완료"처럼 잘못 요약할 수 있어 제외하고,
        // 대신 "관련 일감"으로 따로 알려준다.
        const todoLogItems = log.items.filter((i) => !i.ref_ty_code);
        const tagLogItems  = log.items.filter((i) => i.ref_ty_code);
        const done    = todoLogItems.filter((i) => i.done_yn === "Y").map((i) => i.item_cn);
        const undone  = todoLogItems.filter((i) => i.done_yn !== "Y").map((i) => i.item_cn);
        const linePart: string[] = [];
        if (done.length)          linePart.push(`완료: ${done.join(", ")}`);
        if (undone.length)        linePart.push(`미완료: ${undone.join(", ")}`);
        if (tagLogItems.length)   linePart.push(`관련 일감: ${tagLogItems.map((i) => i.item_cn).join(", ")}`);
        if (log.note_cn?.trim())  linePart.push(`메모: ${log.note_cn.trim()}`);
        logLines.push(`- ${dateStr}: ${linePart.length ? linePart.join(" / ") : "(기록 없음)"}`);
      }
    } else {
      logLines.push(`[일별 기록] 없음`);
    }
  }
  const logDataBlock = logLines.length > 0 ? logLines.join("\n") : "(이번 주 작성된 업무일지가 없습니다)";

  // ── 프롬프트 템플릿 조회 (default_yn='Y' 우선, 프로젝트 전용 > 시스템 공통) ─────
  const promptTmpl = await prisma.tbAiPromptTemplate.findFirst({
    where: {
      OR:           [{ prjct_id: projectId }, { prjct_id: null }],
      task_ty_code: "WEEKLY_REPORT_DRAFT",
      use_yn:       "Y",
    },
    orderBy: [
      { default_yn: "desc" },
      { prjct_id:    { sort: "desc", nulls: "last" } },
      { creat_dt:    "desc" },
    ],
  });
  const sysPrompt = promptTmpl?.sys_prompt_cn?.trim() ?? "";

  const parts: string[] = [];
  if (sysPrompt) parts.push(`<시스템프롬프트>\n${sysPrompt}\n</시스템프롬프트>`);

  if (project) {
    parts.push(
      `<프로젝트 정보>\n` +
      `프로젝트명: ${project.prjct_nm}\n` +
      `설명: ${project.prjct_dc?.trim() || "(설명 없음)"}\n` +
      `발주처: ${project.client_nm?.trim() || "-"}\n` +
      `</프로젝트 정보>`
    );
  }

  // 차주 기간을 별도 태그로 명시 — "## 차주계획" 섹션 제목에 정확한 날짜를 바로 못 박게 함
  // (금주=대상 주간, 차주=이 기간이라는 걸 프롬프트에서 헷갈리지 않도록 분리)
  parts.push(`<대상 주간>\n${weekStart} ~ ${weekEnd}\n</대상 주간>`);
  parts.push(`<차주 기간>\n${nextMonday} ~ ${nextSunday}\n</차주 기간>`);

  // PM이 요청 시점에 남긴 코멘트 — 다른 참고 데이터보다 앞쪽, 눈에 잘 띄는 위치에 둔다.
  // "반드시 반영"이라고 못박아야 아래 업무일지 데이터 더미에 묻히지 않는다.
  if (pmComment?.trim()) {
    parts.push(`<PM 추가 요청사항 (이번 주 초안 작성 시 반드시 반영)>\n${pmComment.trim()}\n</PM 추가 요청사항>`);
  }

  // 과거 보고 — "참고용" 태그명과 날짜를 명시해서 이번 주 데이터와 절대 안 섞이게 한다.
  // 실제 "섞지 마라" 지시는 시스템프롬프트(DB) 쪽에서 한 번 더 못박음.
  parts.push(
    `<지난주 보고 (${lastWeekStart} ~ ${addDaysStr(lastWeekStart, 6)}, 참고용 — 이번 주 실적/계획과 절대 혼동 금지)>\n` +
    `${lastWeekReport?.draft_cn?.trim() || "(지난주 보고 없음)"}\n` +
    `</지난주 보고>`
  );
  parts.push(
    `<전전주 보고 (${twoWeeksAgoStart} ~ ${addDaysStr(twoWeeksAgoStart, 6)}, 참고용 — 이번 주 실적/계획과 절대 혼동 금지)>\n` +
    `${twoWeeksAgoReport?.draft_cn?.trim() || "(전전주 보고 없음)"}\n` +
    `</전전주 보고>`
  );

  parts.push(`<업무일지 데이터>\n${logDataBlock}\n</업무일지 데이터>`);

  return { finalReqCn: parts.join("\n\n"), promptTmplId: promptTmpl?.tmpl_id ?? null };
}
