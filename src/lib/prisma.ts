/**
 * prisma — Prisma Client 싱글톤
 *
 * 역할:
 *   - PrismaClient 인스턴스를 전역에서 단 하나만 유지
 *
 * 주의:
 *   - Next.js dev 서버는 hot reload 시마다 모듈을 재실행함
 *   - new PrismaClient()를 매번 호출하면 DB 연결이 계속 쌓여 연결 폭발 발생
 *   - globalThis에 인스턴스를 보관해서 재사용하는 방식으로 방어
 */

import { PrismaClient } from "@prisma/client";

// globalThis를 통해 싱글톤 보관 (TypeScript 타입 확장)
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // 개발 환경에서는 error/warn만 출력 (query 로그는 성능에 영향)
    // production에서는 error만 출력
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

// production에서는 globalThis 캐싱 불필요 (서버 재시작 없이 실행)
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
