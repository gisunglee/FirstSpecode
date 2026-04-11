/**
 * plan-studio/prompt-builder — AI 생성용 프롬프트 직조기 (v2 개선)
 *
 * 역할:
 *   - 산출물(artf) 단위로 XML 태그 프롬프트 직조
 *   - 구분(IA/ERD 등) + 형식(MD/MERMAID/HTML)별 전문 요청 프롬프트 삽입
 *   - REQ 컨텍스트: 요구사항 본문(분석/스펙/원문) + 사용자스토리 자동 동봉
 *   - ARTF 컨텍스트: 참조 artf의 artf_cn 로드 (type/format 명시)
 *   - 간접 순환 차단: 재귀 깊이 최대 3, 방문 set 추적
 *
 * XML 구조:
 *   <artifact_request>
 *     <division>, <format>, <name>
 *     <request_prompt> — 구분별 전문 프롬프트 (prompts/index.ts)
 *     <idea>, <instruction> — 사용자 직접 입력
 *     <requirements> — 요구사항 (REQ 컨텍스트)
 *     <references> — 기획내용 (ARTF 컨텍스트)
 *   </artifact_request>
 */

import { prisma } from "@/lib/prisma";
import { getRequestPrompt } from "./prompts";

export async function buildPrompt(opts: {
  artfId: string;
  artfNm: string;
  artfDivCode: string;
  artfFmtCode: string;
  artfIdeaCn: string;
  comentCn: string;
  contexts: Array<{ ctxtTyCode: string; refId: string }>;
}): Promise<string> {
  const lines: string[] = [];

  lines.push("<artifact_request>");
  lines.push("");
  lines.push(`  <division>${opts.artfDivCode}</division>`);
  lines.push(`  <format>${opts.artfFmtCode}</format>`);
  lines.push(`  <name>${opts.artfNm}</name>`);
  lines.push("");
  lines.push("  ---");
  lines.push("");

  // ── 구분별 전문 요청 프롬프트 ──
  const requestPrompt = getRequestPrompt(opts.artfDivCode, opts.artfFmtCode);
  lines.push("  <request_prompt>");
  lines.push(`    ${requestPrompt}`);
  lines.push("  </request_prompt>");
  lines.push("");
  lines.push("  ---");
  lines.push("");

  // ── 사용자 직접 입력 (idea만 — comentCn은 tb_ai_task.coment_cn에 별도 저장되므로 중복 방지) ──
  if (opts.artfIdeaCn?.trim()) {
    lines.push("  <idea>");
    lines.push(`    ${opts.artfIdeaCn}`);
    lines.push("  </idea>");
    lines.push("");
    lines.push("  ---");
    lines.push("");
  }

  // ── 요구사항 (REQ 컨텍스트) ──
  const reqContexts = opts.contexts.filter((c) => c.ctxtTyCode === "REQ");
  if (reqContexts.length > 0) {
    lines.push("  <requirements>");
    lines.push("");
    for (const ctx of reqContexts) {
      const req = await prisma.tbRqRequirement.findUnique({
        where: { req_id: ctx.refId },
        select: {
          req_display_id: true, req_nm: true,
          orgnl_cn: true, curncy_cn: true, analy_cn: true, spec_cn: true,
        },
      });
      if (!req) continue;

      // 사용자스토리 자동 동봉
      const stories = await prisma.tbRqUserStory.findMany({
        where: { req_id: ctx.refId },
        select: { story_nm: true, persona_cn: true, scenario_cn: true },
      });

      lines.push(`> ${req.req_display_id} ${req.req_nm}`);
      lines.push("");

      // 분석 메모
      if (req.analy_cn?.trim()) {
        lines.push("[분석 노트]");
        lines.push(req.analy_cn);
      }
      // 상세 명세
      if (req.spec_cn?.trim()) {
        lines.push("");
        lines.push("[상세 명세]");
        lines.push(req.spec_cn);
      }
      // 요구사항 원문 (현행화 우선, 없으면 최초 원문)
      const originalContent = req.curncy_cn?.trim() || req.orgnl_cn?.trim();
      if (originalContent) {
        lines.push("");
        lines.push("[요구사항 원문]");
        lines.push(originalContent);
      }

      // 사용자스토리
      if (stories.length > 0) {
        lines.push("      <user_stories>");
        for (const s of stories) {
          lines.push(`        <story name="${s.story_nm}" persona="${s.persona_cn ?? ""}">${s.scenario_cn ?? ""}</story>`);
        }
        lines.push("      </user_stories>");
      }

      lines.push("");
      lines.push("---");
      lines.push("");
    }
    lines.push("  </requirements>");
    lines.push("");
    lines.push("  ---");
    lines.push("");
  }

  // ── 기획내용 (ARTF 컨텍스트 — 다른 산출물 참조) ──
  const artfContexts = opts.contexts.filter((c) => c.ctxtTyCode === "ARTF");
  if (artfContexts.length > 0) {
    lines.push("<references>");
    lines.push("");
    const visited = new Set<string>([opts.artfId]);
    for (const ctx of artfContexts) {
      if (visited.has(ctx.refId)) continue;
      const refLines = await getRefArtfContent(ctx.refId, visited, 0);
      if (refLines) {
        lines.push(...refLines);
        lines.push("");
        lines.push("---");
        lines.push("");
      }
    }
    lines.push("</references>");
    lines.push("");
  }

  lines.push("</artifact_request>");

  return lines.join("\n");
}

/** 구분 코드 → 한글명 */
const DIV_NAMES: Record<string, string> = {
  IA: "정보구조도", JOURNEY: "사용자여정", FLOW: "화면흐름",
  MOCKUP: "목업", ERD: "ERD", PROCESS: "업무프로세스",
};

/** 형식 코드 → 한글명 */
const FMT_NAMES: Record<string, string> = {
  MD: "마크다운", MERMAID: "Mermaid", HTML: "HTML",
};

/**
 * 참조 산출물의 본문을 라벨 + 코드블록 형태로 반환
 * - Mermaid/HTML 내용이 태그로 오인되지 않도록 코드블록(```)으로 감쌈
 * - 재귀 깊이 최대 3, 방문 set으로 순환 차단
 */
async function getRefArtfContent(
  refId: string,
  visited: Set<string>,
  depth: number
): Promise<string[] | null> {
  if (depth >= 3) return null;
  visited.add(refId);

  const artf = await prisma.tbDsPlanStudioArtf.findUnique({
    where: { artf_id: refId },
    include: { planStudio: { select: { plan_studio_display_id: true } } },
  });
  if (!artf) return null;

  const label = `${artf.planStudio.plan_studio_display_id} > ${artf.artf_nm}`;
  const divName = DIV_NAMES[artf.artf_div_code] ?? artf.artf_div_code;
  const fmtName = FMT_NAMES[artf.artf_fmt_code] ?? artf.artf_fmt_code;
  const content = artf.artf_cn?.trim() || "(산출물 없음)";

  const result: string[] = [];
  result.push(`> ${label} (${divName} · ${fmtName})`);
  result.push("");

  // Mermaid/HTML은 코드블록으로 감싸서 태그 오인식 방지
  if (artf.artf_fmt_code === "MERMAID") {
    result.push("```mermaid");
    result.push(content);
    result.push("```");
  } else if (artf.artf_fmt_code === "HTML") {
    result.push("```html");
    result.push(content);
    result.push("```");
  } else {
    // MD는 그대로
    result.push(content);
  }

  return result;
}
