/**
 * authTrace — 브라우저 인증 흐름 판단 기록 (진단 전용 링 버퍼)
 *
 * 역할:
 *   - authFetch / authRefreshClient / MainLayout 이 "왜 그렇게 판단했는지"를
 *     시각과 함께 sessionStorage 에 최근 N건만 남긴다 (탭별)
 *   - 세션 만료 모달이 이 기록을 화면에 보여 주어, 사용자가 캡처만 보내면
 *     어느 분기에서 오판했는지 재현 없이 확정할 수 있게 한다
 *
 * 원칙:
 *   - 토큰 원문·이메일 등 민감값은 절대 기록하지 않는다 (만료 시각·길이·코드만)
 *   - 실패해도 인증 흐름에 영향을 주지 않는다 (모든 저장소 접근은 try/catch)
 *   - 용량은 최근 40건으로 고정 — 오래 열어 둔 탭에서도 커지지 않는다
 */

import { accessTokenExpiresAtMs } from "@/lib/authSessionPolicy";

const TRACE_KEY = "lc_auth_trace_v1";
const MAX_ENTRIES = 40;

export type AuthTraceEntry = {
  /** 기록 시각 (HH:MM:SS.mmm, 로컬) */
  t: string;
  /** 이벤트 이름 — 예: api-401, shortcut-retry, refresh-start, lock-immediate */
  ev: string;
  /** 부가 정보 — 숫자/짧은 문자열만 */
  [key: string]: string | number | boolean | null | undefined;
};

function nowLabel(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

/** 토큰 자체 대신 "만료까지 남은 초"만 남긴다 (음수면 이미 만료). 토큰이 없으면 null. */
export function tokenExpiryLabel(token: string): string | null {
  if (!token) return null;
  const expiresAt = accessTokenExpiresAtMs(token);
  if (expiresAt === null) return "invalid";
  return `${Math.round((expiresAt - Date.now()) / 1000)}s`;
}

/** 한 건 기록. 저장소 오류는 조용히 무시한다 — 진단이 본 기능을 방해하면 안 된다. */
export function traceAuth(ev: string, data: Omit<AuthTraceEntry, "t" | "ev"> = {}): void {
  if (typeof window === "undefined") return;
  try {
    const entries = readAuthTrace();
    entries.push({ t: nowLabel(), ev, ...data });
    const trimmed = entries.slice(-MAX_ENTRIES);
    window.sessionStorage.setItem(TRACE_KEY, JSON.stringify(trimmed));
  } catch {
    // 저장소 접근 차단·용량 초과 등은 진단 포기
  }
}

/** 최근 기록 전체 (오래된 것부터). */
export function readAuthTrace(): AuthTraceEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(TRACE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AuthTraceEntry[]) : [];
  } catch {
    return [];
  }
}

/** 모달·콘솔 표시용 — 한 줄에 한 이벤트. */
export function formatAuthTrace(entries: AuthTraceEntry[]): string {
  return entries
    .map(({ t, ev, ...rest }) => {
      const fields = Object.entries(rest)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" ");
      return `${t} ${ev}${fields ? " " + fields : ""}`;
    })
    .join("\n");
}
