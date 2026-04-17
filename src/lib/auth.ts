/**
 * auth.ts — 인증 공통 유틸
 *
 * 역할:
 *   - 비밀번호 bcrypt 해시/검증
 *   - JWT 액세스 토큰 발급/검증
 *   - 리프레시 토큰 생성 및 해시
 *   - 인증 메일 발송 (SMTP 설정 없으면 콘솔 출력)
 *
 * 환경변수:
 *   JWT_SECRET       — JWT 서명 키 (필수)
 *   APP_URL          — 인증 링크 베이스 URL (기본: http://localhost:3000)
 *   SMTP_HOST        — SMTP 서버 호스트 (옵션)
 *   SMTP_PORT        — SMTP 포트 (기본: 587)
 *   SMTP_USER        — SMTP 사용자
 *   SMTP_PASS        — SMTP 비밀번호
 *   SMTP_FROM        — 발신자 주소 (기본: noreply@specode.dev)
 */

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import nodemailer from "nodemailer";

// bcrypt 라운드 수 — 높을수록 안전하지만 느림 (12 = 약 250ms)
const BCRYPT_ROUNDS = 12;

// JWT 액세스 토큰 만료 시간
const ACCESS_TOKEN_EXPIRES = "1h";

// 리프레시 토큰 만료 일수
export const REFRESH_TOKEN_EXPIRES_DAYS = 10;

// 인증 메일 토큰 만료 시간 (밀리초)
export const VERIFY_TOKEN_EXPIRES_MS = 60 * 60 * 1000; // 1시간

// 계정 잠금 해제 토큰 만료 시간 (밀리초)
export const UNLOCK_TOKEN_EXPIRES_MS = 30 * 60 * 1000; // 30분

// ── 비밀번호 ──────────────────────────────────────────────────────

/** 비밀번호를 bcrypt 해시로 변환 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** 비밀번호와 해시 일치 여부 검증 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ── JWT ──────────────────────────────────────────────────────────

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET 환경변수가 설정되지 않았습니다.");
  return secret;
}

/** JWT 액세스 토큰 발급 */
export function signAccessToken(payload: { mberId: string; email: string }): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ACCESS_TOKEN_EXPIRES });
}

/** JWT 액세스 토큰 검증 — 실패 시 null 반환 */
export function verifyAccessToken(
  token: string
): { mberId: string; email: string } | null {
  try {
    return jwt.verify(token, getJwtSecret()) as { mberId: string; email: string };
  } catch {
    return null;
  }
}

// ── 리프레시 토큰 ─────────────────────────────────────────────────

/** 리프레시 토큰 원문 생성 (32바이트 랜덤) */
export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** 리프레시 토큰 해시 (SHA-256) — DB에 저장할 값 */
export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** 리프레시 토큰 만료 일시 계산 */
export function refreshTokenExpiryDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + REFRESH_TOKEN_EXPIRES_DAYS);
  return d;
}

// ── API 키 (MCP 등 외부 클라이언트 인증용) ────────────────────────

/** API 키 원문 생성: "spk_" + 32바이트 랜덤 hex (총 68자) */
export function generateApiKey(): string {
  return "spk_" + crypto.randomBytes(32).toString("hex");
}

/** API 키 SHA-256 해시 — DB에 저장할 값 (원문은 저장 금지) */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/** API 키 prefix 추출 — 목록에서 식별용 ("spk_" + 앞 8자 = 12자) */
export function getApiKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, 12);
}

// ── 이메일 인증 토큰 ──────────────────────────────────────────────

/** 이메일 인증 토큰 원문 생성 (32바이트 랜덤) */
export function generateVerifyToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** 인증 토큰 만료 일시 계산 (현재 + 1시간) */
export function verifyTokenExpiryDate(): Date {
  return new Date(Date.now() + VERIFY_TOKEN_EXPIRES_MS);
}

// ── 소셜 임시 토큰 ─────────────────────────────────────────────

// 동일 이메일 감지 시 연동 확인 대기에 사용하는 임시 JWT — 10분 유효
const SOCIAL_TOKEN_EXPIRES = "10m";

/** 소셜 임시 토큰 발급 (LINK_REQUIRED 케이스) */
export function signSocialToken(payload: {
  provdrCode:    string;
  provdrUserId:  string;
  email:         string;
}): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: SOCIAL_TOKEN_EXPIRES });
}

/** 소셜 임시 토큰 검증 — 실패 시 null 반환 */
export function verifySocialToken(
  token: string
): { provdrCode: string; provdrUserId: string; email: string } | null {
  try {
    return jwt.verify(token, getJwtSecret()) as {
      provdrCode: string;
      provdrUserId: string;
      email: string;
    };
  } catch {
    return null;
  }
}

/** 잠금 해제 토큰 만료 일시 계산 (현재 + 30분) */
export function unlockTokenExpiryDate(): Date {
  return new Date(Date.now() + UNLOCK_TOKEN_EXPIRES_MS);
}

// ── 이메일 발송 ───────────────────────────────────────────────────

/** 인증 메일 발송
 *  SMTP 환경변수가 없으면 콘솔에 링크 출력 (개발 편의)
 */
export async function sendVerificationEmail(
  toEmail: string,
  token: string
): Promise<void> {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const verifyUrl = `${appUrl}/auth/register/complete?token=${token}`;

  // SMTP 미설정 시 콘솔 출력 (개발 환경)
  if (!process.env.SMTP_HOST) {
    // 줄 바꿈 없이 한 줄로 출력 — 터미널에서 잘리지 않도록
    console.log("\n\x1b[33m[DEV] 이메일 인증 링크 (클릭 또는 복사):\x1b[0m");
    console.log(`\x1b[36m${verifyUrl}\x1b[0m\n`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "noreply@specode.dev",
    to: toEmail,
    subject: "[SPECODE] 이메일 인증을 완료해 주세요",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #4a56d4;">SPECODE 이메일 인증</h2>
        <p>아래 버튼을 클릭하여 이메일 인증을 완료해 주세요.</p>
        <p>인증 링크는 <strong>1시간</strong> 동안 유효합니다.</p>
        <a href="${verifyUrl}"
           style="display:inline-block; margin-top:16px; padding:12px 24px;
                  background:#4a56d4; color:#fff; border-radius:6px;
                  text-decoration:none; font-weight:600;">
          이메일 인증하기
        </a>
        <p style="margin-top:24px; color:#888; font-size:12px;">
          이 메일을 요청하지 않으셨다면 무시하셔도 됩니다.
        </p>
      </div>
    `,
  });
}

/** 이메일 변경 인증 메일 발송
 *  SMTP 환경변수가 없으면 콘솔에 링크 출력 (개발 환경)
 */
export async function sendEmailChangeEmail(
  toEmail: string,
  token: string
): Promise<void> {
  const appUrl    = process.env.APP_URL ?? "http://localhost:3001";
  const verifyUrl = `${appUrl}/settings/profile/email/complete?token=${token}`;

  if (!process.env.SMTP_HOST) {
    console.log("\n\x1b[33m[DEV] 이메일 변경 인증 링크 (클릭 또는 복사):\x1b[0m");
    console.log(`\x1b[36m${verifyUrl}\x1b[0m\n`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_PORT === "465",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from:    process.env.SMTP_FROM ?? "noreply@specode.dev",
    to:      toEmail,
    subject: "[SPECODE] 이메일 변경 인증을 완료해 주세요",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #4a56d4;">SPECODE 이메일 변경 인증</h2>
        <p>아래 버튼을 클릭하여 이메일 변경을 완료해 주세요.</p>
        <p>인증 링크는 <strong>1시간</strong> 동안 유효합니다.</p>
        <a href="${verifyUrl}"
           style="display:inline-block; margin-top:16px; padding:12px 24px;
                  background:#4a56d4; color:#fff; border-radius:6px;
                  text-decoration:none; font-weight:600;">
          이메일 변경 완료하기
        </a>
        <p style="margin-top:24px; color:#888; font-size:12px;">
          이 메일을 요청하지 않으셨다면 무시하셔도 됩니다.
        </p>
      </div>
    `,
  });
}

/** 비밀번호 재설정 메일 발송
 *  SMTP 환경변수가 없으면 콘솔에 링크 출력 (개발 환경)
 */
export async function sendPasswordResetEmail(
  toEmail: string,
  token: string
): Promise<void> {
  const appUrl   = process.env.APP_URL ?? "http://localhost:3001";
  const resetUrl = `${appUrl}/auth/password/reset?token=${token}`;

  if (!process.env.SMTP_HOST) {
    console.log("\n\x1b[33m[DEV] 비밀번호 재설정 링크 (클릭 또는 복사):\x1b[0m");
    console.log(`\x1b[36m${resetUrl}\x1b[0m\n`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from:    process.env.SMTP_FROM ?? "noreply@specode.dev",
    to:      toEmail,
    subject: "[SPECODE] 비밀번호를 재설정해 주세요",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #4a56d4;">SPECODE 비밀번호 재설정</h2>
        <p>아래 버튼을 클릭하여 비밀번호를 재설정해 주세요.</p>
        <p>링크는 <strong>1시간</strong> 동안 유효합니다.</p>
        <a href="${resetUrl}"
           style="display:inline-block; margin-top:16px; padding:12px 24px;
                  background:#4a56d4; color:#fff; border-radius:6px;
                  text-decoration:none; font-weight:600;">
          비밀번호 재설정하기
        </a>
        <p style="margin-top:24px; color:#888; font-size:12px;">
          이 메일을 요청하지 않으셨다면 무시하셔도 됩니다.
        </p>
      </div>
    `,
  });
}

/** 계정 잠금 해제 메일 발송
 *  SMTP 환경변수가 없으면 콘솔에 링크 출력 (개발 편의)
 */
export async function sendUnlockEmail(
  toEmail: string,
  token: string
): Promise<void> {
  const appUrl    = process.env.APP_URL ?? "http://localhost:3001";
  const unlockUrl = `${appUrl}/auth/login/unlock?token=${token}`;

  if (!process.env.SMTP_HOST) {
    console.log("\n\x1b[33m[DEV] 계정 잠금 해제 링크 (클릭 또는 복사):\x1b[0m");
    console.log(`\x1b[36m${unlockUrl}\x1b[0m\n`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from:    process.env.SMTP_FROM ?? "noreply@specode.dev",
    to:      toEmail,
    subject: "[SPECODE] 계정 잠금 해제 안내",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #4a56d4;">SPECODE 계정 잠금 해제</h2>
        <p>아래 버튼을 클릭하여 계정 잠금을 해제해 주세요.</p>
        <p>해제 링크는 <strong>30분</strong> 동안 유효합니다.</p>
        <a href="${unlockUrl}"
           style="display:inline-block; margin-top:16px; padding:12px 24px;
                  background:#4a56d4; color:#fff; border-radius:6px;
                  text-decoration:none; font-weight:600;">
          잠금 해제하기
        </a>
        <p style="margin-top:24px; color:#888; font-size:12px;">
          이 메일을 요청하지 않으셨다면 무시하셔도 됩니다.
        </p>
      </div>
    `,
  });
}

/** 프로젝트 초대 메일 발송
 *  SMTP 환경변수가 없으면 콘솔에 링크 출력 (개발 환경)
 */
export async function sendInvitationEmail(
  toEmail: string,
  token: string,
  projectName: string,
  inviterEmail: string
): Promise<void> {
  const appUrl    = process.env.APP_URL ?? "http://localhost:3001";
  const inviteUrl = `${appUrl}/invite/accept?token=${token}`;

  if (!process.env.SMTP_HOST) {
    console.log(`\n\x1b[33m[DEV] 프로젝트 초대 링크 (${toEmail} → ${projectName}):\x1b[0m`);
    console.log(`\x1b[36m${inviteUrl}\x1b[0m\n`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_PORT === "465",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from:    process.env.SMTP_FROM ?? "noreply@specode.dev",
    to:      toEmail,
    subject: `[SPECODE] '${projectName}' 프로젝트에 초대되었습니다`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #4a56d4;">SPECODE 프로젝트 초대</h2>
        <p><strong>${inviterEmail}</strong>님이 <strong>'${projectName}'</strong> 프로젝트에 초대했습니다.</p>
        <p>아래 버튼을 클릭하여 초대를 수락하세요. 링크는 <strong>7일</strong> 동안 유효합니다.</p>
        <a href="${inviteUrl}"
           style="display:inline-block; margin-top:16px; padding:12px 24px;
                  background:#4a56d4; color:#fff; border-radius:6px;
                  text-decoration:none; font-weight:600;">
          초대 수락하기
        </a>
        <p style="margin-top:24px; color:#888; font-size:12px;">
          이 메일을 요청하지 않으셨다면 무시하셔도 됩니다.
        </p>
      </div>
    `,
  });
}
