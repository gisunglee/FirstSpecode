/**
 * encrypt — API 키 AES-256-CBC 암호화 유틸 (UW-00012)
 *
 * 역할:
 *   - API 키 원문을 DB에 저장하기 전 암호화
 *   - 화면 표시용 마스킹 생성 (예: sk-****1234)
 *
 * 환경변수:
 *   API_KEY_SECRET — 32바이트 암호화 키 (미설정 시 개발용 기본값 사용)
 *                    운영 환경에서는 반드시 설정할 것
 */

import { createCipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-cbc";

// 환경변수에서 32바이트 키 생성 — 부족하면 패딩, 초과하면 자름
function getEncryptKey(): Buffer {
  const secret = process.env.API_KEY_SECRET ?? "specode-dev-key-do-not-use-in-prod!";
  return Buffer.from(secret.padEnd(32, "0").slice(0, 32), "utf8");
}

/**
 * API 키 원문을 AES-256-CBC로 암호화
 * @returns "iv_hex:encrypted_hex" 형식 문자열
 */
export function encryptApiKey(plaintext: string): string {
  const key = getEncryptKey();
  const iv  = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * API 키를 마스킹 처리 (앞 3자 + **** + 뒤 4자)
 * 예: "sk-ant-api-abcdefgh1234" → "sk-****1234"
 */
export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) {
    // 너무 짧으면 전체 마스킹
    return "****";
  }
  const prefix = trimmed.slice(0, 3);
  const suffix = trimmed.slice(-4);
  return `${prefix}****${suffix}`;
}
