/**
 * mdfcnSource — 설계 5계층 "최종 수정 경로" 판정 헬퍼
 *
 * 역할:
 *   - 요청의 인증 방식을 보고 mdfcn_src_code 에 저장할 출처 코드를 결정한다.
 *   - 요구사항/단위업무/화면/영역/기능 을 수정하는 모든 경로에서 공용으로 사용.
 *
 * 배경:
 *   기존에는 웹 화면 수정과 MCP 도구 수정이 모두 mdfcn_mber_id(= 회원 ID)로만
 *   기록됐다. MCP 키의 소유자와 웹 로그인 사용자가 같은 사람이기 때문에
 *   "내가 웹에서 고친 것"과 "MCP 가 고친 것"을 사후에 구분할 수 없었다.
 *   인증 단계에서 이미 두 경로가 갈리므로(credentialType) 그 값을 그대로 쓴다.
 *
 * 사용법:
 *   const gate = await requirePermission(request, projectId, "content.update");
 *   if (gate instanceof Response) return gate;
 *   await prisma.tbRqRequirement.update({
 *     where: { req_id: reqId },
 *     data: { ...본문, ...buildMdfcnAudit(gate) },
 *   });
 */

import type { AuthPayload } from "@/lib/requireAuth";

/**
 * 최종 수정 경로 코드 — DB(mdfcn_src_code varchar(10)) 에 저장되는 값.
 *
 *   WEB  — 웹 화면에서 사용자가 직접 수정 (JWT 세션 인증)
 *   MCP  — Claude Code 등 MCP 도구가 수정 (MCP 키 인증)
 *   SYNC — 스펙 동기화 적용으로 수정 (lib/spec-sync/targetRegistry.ts)
 *
 * 기존 행은 NULL 로 남는다(= 출처 모름). 과거 수정분의 경로를 임의로
 * 추정하지 않기 위해 DB 기본값을 두지 않았다.
 */
export const MDFCN_SRC = {
  WEB:  "WEB",
  MCP:  "MCP",
  SYNC: "SYNC",
} as const;

export type MdfcnSrcCode = (typeof MDFCN_SRC)[keyof typeof MDFCN_SRC];

/**
 * resolveMdfcnSource — 인증 정보로 수정 경로를 판정
 *
 * credentialType 은 requireAuth 가 인증 방식에 따라 채운다.
 *   - "MCP_CLIENT" : spk_ 로 시작하는 MCP 키 인증 → MCP
 *   - "SESSION"    : 브라우저 JWT 세션 인증        → WEB
 *
 * 스펙 동기화(SYNC)는 인증 방식으로 구분되지 않는다(웹 세션으로 승인함).
 * 해당 경로는 MDFCN_SRC.SYNC 를 직접 넘겨 기록한다.
 */
export function resolveMdfcnSource(auth: AuthPayload): MdfcnSrcCode {
  return auth.credentialType === "MCP_CLIENT" ? MDFCN_SRC.MCP : MDFCN_SRC.WEB;
}

/**
 * buildMdfcnAudit — 수정 감사 필드 3종을 한 번에 생성
 *
 * mdfcn_dt 를 갱신하는 곳은 mdfcn_src_code 도 반드시 함께 갱신해야 한다.
 * 하나만 갱신하면 이전 수정의 출처가 남아 "방금 전 · MCP" 같은 잘못된
 * 조합이 화면에 표시된다. 그래서 세 필드를 항상 묶어서 반환한다.
 *
 * @param auth 인증 컨텍스트 (requirePermission 또는 requireAuth 결과)
 * @param src  출처를 강제 지정할 때만 전달 (스펙 동기화 등). 미지정 시 인증 방식으로 판정.
 */
export function buildMdfcnAudit(auth: AuthPayload, src?: MdfcnSrcCode) {
  return {
    mdfcn_mber_id:  auth.mberId,
    mdfcn_dt:       new Date(),
    mdfcn_src_code: src ?? resolveMdfcnSource(auth),
  };
}

// ─── 목록 응답 조립 ──────────────────────────────────────────────────────────
// 설계 5계층 목록 API 가 공통으로 내려보내는 "최종 수정" 3필드.
// 다섯 곳(요구사항·단위업무·화면·영역·기능)이 같은 규칙을 써야 화면 표시도 일치한다.

export type ModifiedFields = {
  /** 최종 수정 일시(ISO 문자열). 수정 이력이 없으면 생성 일시로 폴백 */
  modifiedAt:       string;
  /** true면 modifiedAt 이 생성 일시 — 등록 후 한 번도 수정되지 않았다는 뜻 */
  modifiedIsCreate: boolean;
  /** 최종 수정 경로 — WEB | MCP | SYNC. 컬럼 추가 이전 수정분은 null(= 모름) */
  modifiedSource:   string | null;
};

/**
 * toModifiedFields — DB 행의 감사 컬럼을 목록 응답 필드로 변환
 *
 * 한 번도 수정되지 않은 행은 mdfcn_dt 가 null 이다. 그대로 내려보내 화면을
 * 빈칸으로 두면 "수정 안 됨"인지 "데이터가 없는 건지" 구분할 수 없으므로,
 * 생성 일시로 폴백하고 modifiedIsCreate 플래그로 둘을 구분한다.
 */
export function toModifiedFields(row: {
  creat_dt:       Date;
  mdfcn_dt:       Date | null;
  mdfcn_src_code: string | null;
}): ModifiedFields {
  return {
    modifiedAt:       (row.mdfcn_dt ?? row.creat_dt).toISOString(),
    modifiedIsCreate: row.mdfcn_dt === null,
    modifiedSource:   row.mdfcn_src_code ?? null,
  };
}
