/**
 * Worker API 인증 헬퍼
 *
 * 역할:
 *   - X-Worker-Key 헤더를 검증하여 외부 AI 워커 요청만 허용
 *   - 화면용 세션 인증(requireAuth)과 완전히 분리된 인증 체계
 *
 * 환경변수:
 *   WORKER_API_KEY — 워커 인증 키 (미설정 시 개발 환경에서는 경고 후 통과)
 */

import { NextRequest, NextResponse } from "next/server";

export function requireWorkerAuth(request: NextRequest): NextResponse | null {
  const workerKey = process.env.WORKER_API_KEY;

  // 개발 환경에서 WORKER_API_KEY 미설정 시 경고 후 통과
  if (!workerKey) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[Worker Auth] WORKER_API_KEY가 설정되지 않았습니다. 개발 환경이므로 인증을 건너뜁니다.");
      return null; // 인증 통과
    }
    // 프로덕션에서는 키 미설정 자체가 에러
    return NextResponse.json({ code: "SERVER_CONFIG_ERROR", message: "서버 설정 오류입니다." }, { status: 500 });
  }

  const requestKey = request.headers.get("X-Worker-Key");
  if (!requestKey || requestKey !== workerKey) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "유효하지 않은 Worker API 키입니다." }, { status: 401 });
  }

  return null; // 인증 통과
}
