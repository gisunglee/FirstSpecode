/**
 * socialHandoff — 소셜 콜백 → 가입 완료/연동 확인 화면 사이의 토큰 전달
 *
 * 콜백이 받은 socialToken(10분, 계정 생성·연동 권한)을 쿼리스트링으로 넘기면
 * 브라우저 기록·서버 접근 로그·Referer 에 남는다. 대신 같은 탭의 sessionStorage 에 잠깐 두고
 * 다음 화면이 꺼내 쓴다. 탭을 닫으면 사라지고, 다른 탭·다른 출처에서는 읽을 수 없다.
 *
 * 생산자: (auth)/auth/social/callback/page.tsx
 * 소비자: (auth)/auth/social/register/page.tsx, (auth)/auth/social/link/page.tsx
 */

const KEY = "specode_social_handoff";

export type SocialHandoff = {
  kind:       "REGISTER" | "LINK";
  token:      string;
  email:      string;
  name?:      string;
  provider?:  string;
  redirectTo?: string;
};

export function storeSocialHandoff(data: SocialHandoff): boolean {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    // 시크릿 모드·저장소 차단 환경 — 호출자가 에러를 보여준다
    return false;
  }
}

/** 읽기만 한다(새로고침해도 유지). 성공·취소 시 clearSocialHandoff 로 지운다. */
export function readSocialHandoff(kind: SocialHandoff["kind"]): SocialHandoff | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SocialHandoff>;
    if (parsed.kind !== kind || typeof parsed.token !== "string" || typeof parsed.email !== "string") return null;
    return parsed as SocialHandoff;
  } catch {
    return null;
  }
}

export function clearSocialHandoff(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* 저장소 접근 불가 — 지울 것도 없다 */ }
}
