/**
 * billing/billing-key — 빌링키(PG 자동결제 키) 저장용 암호화
 *
 * 역할:
 *   - 빌링키를 AES-256-GCM 으로 암호화해 tb_bl_subscription.billing_key 에 저장 (형식 `v2:iv:tag:ct`)
 *   - 옛 형식(`iv:ct`, AES-256-CBC — src/lib/encrypt.ts, Mock 시절)은 복호화만 지원한다.
 *     새로 저장되는 값은 전부 v2. Mock 빌링키는 토스 전환 때 어차피 재등록되므로 재암호화 배치는 두지 않는다.
 *   - 운영 환경에서 암호화 키(API_KEY_SECRET)가 비어 있거나 짧으면 결제 경로만 fail-closed 로 막는다.
 *
 * 왜 GCM 인가 (정책 §7-3 7번, 2026-09-20 점검):
 *   CBC 는 암호문을 바꿔치기해도 복호화가 "성공"한다(무결성 없음). GCM 은 인증 태그가 있어 한 바이트라도
 *   바뀌면 복호화가 실패한다. 빌링키는 유출·변조 시 남의 카드로 결제되는 값이라 무결성이 필요하다.
 *
 * 왜 키를 sha256 으로 파생하는가:
 *   encrypt.ts 는 시크릿을 0 으로 패딩해 32바이트를 만든다. 여기서는 시크릿에 용도 문자열을 붙여 sha256 한
 *   32바이트를 쓴다 — 같은 API_KEY_SECRET 이라도 AI API 키 암호화와 다른 키가 되고, 길이에 상관없이
 *   32바이트가 고르게 나온다. 별도 환경변수(결제 전용 키·KMS)는 정책상 보류.
 *
 * 왜 encrypt.ts 에서 막지 않는가:
 *   encrypt.ts 는 AI API 키 저장에도 쓰인다. 거기서 throw 하면 결제와 무관한 기능까지 함께 멈춘다.
 *
 * 운영 주의:
 *   API_KEY_SECRET 을 한 번 정하면 바꾸지 않는다. 바꾸면 기존 빌링키가 전부 복호화되지 않아
 *   정기 결제가 실패하고 재시도 소진 뒤 강등된다. 바꿔야 한다면 재암호화 절차를 먼저 만든다.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { decryptApiKey } from "@/lib/encrypt";
import { BILLING_ERROR_CODES as E } from "./constants";
import { BillingError } from "./errors";

/** 정책 §2 — 32자(바이트) 키. 이보다 짧으면 파생 키의 엔트로피가 부족하다 */
const MIN_SECRET_LENGTH = 32;

const GCM_ALGORITHM   = "aes-256-gcm";
/** GCM 권장 IV 길이 — 96비트 */
const GCM_IV_BYTES    = 12;
/** 인증 태그 길이 — 128비트 */
const GCM_TAG_BYTES   = 16;
/** 암호문 버전 접두사 — 형식이 또 바뀌면 v3 를 추가하고 decrypt 에서 분기한다 */
const GCM_PREFIX      = "v2:";
/** 키 파생용 용도 문자열 — 바꾸면 기존 v2 암호문을 전부 못 푼다 */
const KEY_DERIVATION_LABEL = "specode-billing-key-v2";

function assertSecretConfigured(): void {
  if (process.env.NODE_ENV !== "production") return;
  const secret = process.env.API_KEY_SECRET ?? "";
  if (secret.length >= MIN_SECRET_LENGTH) return;
  console.error(
    `[billing] API_KEY_SECRET 이 ${MIN_SECRET_LENGTH}자 이상으로 설정되지 않아 결제 수단 저장·청구를 중단합니다. ` +
    "운영 환경변수를 설정해 주세요.",
  );
  throw new BillingError(
    E.GATEWAY_UNAVAILABLE,
    "결제 시스템 설정이 완료되지 않아 지금은 결제 수단을 처리할 수 없습니다. 운영자에게 문의해 주세요.",
    503,
  );
}

/** 시크릿 → 32바이트 GCM 키. 개발 환경은 encrypt.ts 와 같은 기본값을 쓴다(운영은 assertSecretConfigured 가 막는다) */
function deriveKey(): Buffer {
  const secret = process.env.API_KEY_SECRET ?? "specode-dev-key-do-not-use-in-prod!";
  return createHash("sha256").update(`${KEY_DERIVATION_LABEL}|${secret}`).digest();
}

/** 빌링키 원문 → `v2:iv_hex:tag_hex:ct_hex` */
export function encryptBillingKey(plaintext: string): string {
  assertSecretConfigured();
  const iv     = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv(GCM_ALGORITHM, deriveKey(), iv, { authTagLength: GCM_TAG_BYTES });
  const ct     = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${GCM_PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

/** v2(GCM) 와 옛 형식(CBC) 모두 복호화. 변조된 v2 암호문은 인증 태그 검사에서 예외가 난다 */
export function decryptBillingKey(encrypted: string): string {
  assertSecretConfigured();
  if (!encrypted.startsWith(GCM_PREFIX)) {
    // 옛 형식 — Mock 시절 저장분. 토스 전환 시 재등록되면 자연히 사라진다
    return decryptApiKey(encrypted);
  }
  const [ivHex, tagHex, ctHex] = encrypted.slice(GCM_PREFIX.length).split(":");
  if (!ivHex || !tagHex || !ctHex) throw new Error("잘못된 빌링키 암호문 형식입니다(v2).");
  const decipher = createDecipheriv(GCM_ALGORITHM, deriveKey(), Buffer.from(ivHex, "hex"), { authTagLength: GCM_TAG_BYTES });
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]);
  return pt.toString("utf8");
}

/** 저장된 값이 새 형식(GCM)인지 — 운영 점검·스모크에서 확인용 */
export function isGcmBillingKey(encrypted: string): boolean {
  return encrypted.startsWith(GCM_PREFIX);
}
