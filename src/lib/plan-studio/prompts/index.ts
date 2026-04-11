/**
 * plan-studio/prompts — 구분별 AI 요청 프롬프트 로더
 *
 * 역할:
 *   - .claude/prompts/plan-studio/{DIV}-{FMT}.md 파일에서 프롬프트를 읽어 반환
 *   - 파일 없으면 기본 프롬프트 반환
 *   - 프롬프트 수정 시 md 파일만 편집하면 됨 (코드 변경 불필요)
 */

import { readFileSync } from "fs";
import { join } from "path";

/** 프롬프트 파일 디렉토리 */
const PROMPTS_DIR = join(process.cwd(), ".claude", "prompts", "plan-studio");

/**
 * 구분 + 형식에 맞는 전문 요청 프롬프트를 파일에서 읽어 반환
 *
 * @param divCode  IA | JOURNEY | FLOW | MOCKUP | ERD | PROCESS
 * @param fmtCode  MD | MERMAID | HTML
 * @returns 프롬프트 문자열 (파일 없으면 기본 프롬프트)
 */
export function getRequestPrompt(divCode: string, fmtCode: string): string {
  const fileName = `${divCode}-${fmtCode}.md`;
  const filePath = join(PROMPTS_DIR, fileName);

  try {
    const content = readFileSync(filePath, "utf-8");
    // 첫 번째 # 제목 라인 제거 (md 파일 제목은 관리용)
    const lines = content.split("\n");
    const bodyStart = lines.findIndex((l) => l.startsWith("#"));
    const body = bodyStart >= 0 ? lines.slice(bodyStart + 1).join("\n").trim() : content.trim();
    return body;
  } catch {
    // 파일이 없으면 기본 프롬프트
    return `요구사항과 기획내용을 분석하여 ${divCode} 산출물을 ${fmtCode} 형식으로 생성하세요.`;
  }
}
