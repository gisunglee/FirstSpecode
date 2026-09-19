/**
 * billing-flow-db-smoke — 결제 2단계 전체 흐름 스모크 (Mock PG, 임시 스키마)
 *
 * 실행: npm run test:billing:db   (dotenv -e .env.local -- npx tsx scripts/billing-flow-db-smoke.ts)
 *
 * 운영 DB 와 같은 서버에 `specode_billing_test_<ts>` 스키마를 만들어 `prisma db push` 로 전체 스키마를
 * 올린 뒤, 도메인 서비스(src/lib/billing/*)를 실제로 호출해 아래 흐름을 검증하고 스키마를 지운다.
 * 운영 public 스키마는 건드리지 않는다. 메일은 SMTP_HOST 를 지워 콘솔로만 나간다.
 *
 * 검증 흐름 (정책 §3 2단계 "수동 점검" 항목 그대로):
 *   가격·날짜 순수 함수 → BASIC 시작(좌석 검증·첫 결제·플랜 미러) → 좌석 상한(초대 검사)
 *   → 좌석 추가(일할 결제) → 좌석 축소 예약·취소 → 사전 안내 메일(멱등) → 정기 결제(갱신)
 *   → 실패 카드로 변경 → 결제 실패(PAST_DUE) → 3일 간격 재시도 3회 → 강등(EXPIRED·FREE·잠금)
 *   → 잠금 검사(requirePermission) → 활성화(상한 이하/초과) → 재결제(전부 해제)
 *   → 해지 예약·취소·확정 → 관리자 수동 플랜 409 판정 → 탈퇴 시 구독 종료
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DIRECT_URL or DATABASE_URL is required");

const workspaceRoot = process.cwd();
const schemaName = `specode_billing_test_${Date.now()}`;
if (!/^specode_billing_test_[0-9]+$/.test(schemaName)) throw new Error("Unsafe temporary schema name");

const testUrl = new URL(databaseUrl);
testUrl.searchParams.set("schema", schemaName);

const admin = new PrismaClient({ datasourceUrl: databaseUrl });
const prismaCli = path.join(workspaceRoot, "node_modules", "prisma", "build", "index.js");

const DAY = 24 * 60 * 60 * 1000;
const days = (n: number) => n * DAY;

function pushTemporarySchema(): void {
  const result = spawnSync(
    process.execPath,
    [prismaCli, "db", "push", "--schema", "prisma/schema.prisma", "--skip-generate"],
    {
      cwd: workspaceRoot,
      env: { ...process.env, DATABASE_URL: testUrl.toString(), DIRECT_URL: testUrl.toString() },
      encoding: "utf8",
      timeout: 180_000,
    },
  );
  if (result.status !== 0) {
    throw new Error([result.error?.message, result.stdout, result.stderr].filter(Boolean).join("\n").trim());
  }
}

let step = 0;
function log(msg: string) {
  step += 1;
  console.log(`\x1b[32m[${String(step).padStart(2, "0")}]\x1b[0m ${msg}`);
}

async function main(): Promise<void> {
  let db: PrismaClient | null = null;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
    pushTemporarySchema();

    // 서비스 모듈이 읽는 env — import 전에 세팅. SMTP 는 지워서 실제 발송을 막는다.
    process.env.DATABASE_URL = testUrl.toString();
    process.env.DIRECT_URL   = testUrl.toString();
    process.env.APP_URL      = "http://localhost:3000";
    process.env.PAYMENT_GATEWAY = "mock";
    delete process.env.SMTP_HOST;
    delete process.env.MOCK_WEBHOOK_SECRET;

    const { prisma } = await import("@/lib/prisma");
    db = prisma;
    const pricing = await import("@/lib/billing/pricing");
    const sub     = await import("@/lib/billing/subscription");
    const daily   = await import("@/lib/billing/daily");
    const lock    = await import("@/lib/billing/lock");
    const seats   = await import("@/lib/billing/seats");
    const limits  = await import("@/lib/planLimits");
    const { encodeMockAuthKey } = await import("@/lib/billing/mock-auth-key");
    const { buildCustomerKey }  = await import("@/lib/billing/gateway");
    const { BillingError }      = await import("@/lib/billing/errors");
    const { requirePermission } = await import("@/lib/requirePermission");
    const { NextRequest }       = await import("next/server");
    const { signAccessToken }   = await import("@/lib/auth");

    // ── 0. 순수 함수 ─────────────────────────────────────────────────────
    log("가격·날짜 순수 함수");
    {
      // KST 2026-01-31 10:00 → +1개월(anchor 31) = 2026-02-28 10:00 KST → 다시 +1개월 = 3/31
      const jan31 = new Date("2026-01-31T10:00:00+09:00");
      const feb   = pricing.addMonthsKst(jan31, 1, 31);
      assert.equal(pricing.formatKstDate(feb), "2026-02-28");
      const mar   = pricing.nextPeriodEnd(feb, 31);
      assert.equal(pricing.formatKstDate(mar), "2026-03-31", "anchor 로 31일 복귀");
      // 30일 주기, 15일 남음, 1좌석 9,900 → 4,950
      const start = new Date("2026-04-01T00:00:00+09:00");
      const end   = new Date("2026-05-01T00:00:00+09:00");
      const pr = pricing.prorationForAddedSeats({ unitPrice: 9900, addSeats: 1, now: new Date(start.getTime() + days(15)), periodStart: start, periodEnd: end });
      assert.equal(pr.periodDays, 30);
      assert.equal(pr.remainingDays, 15);
      assert.equal(pr.amount, 4950);
      assert.equal(pricing.monthlyAmount(3, 9900), 29700);
    }

    // ── 1. 픽스처 ────────────────────────────────────────────────────────
    log("픽스처 — 소유자 A, 편집 멤버 B·C, 뷰어 4명, 프로젝트 P1(3명)·P2(6명)");
    const ids = { A: randomUUID(), B: randomUUID(), C: randomUUID(), D: randomUUID(), E: randomUUID(), P1: randomUUID(), P2: randomUUID(),
                  V: [randomUUID(), randomUUID(), randomUUID(), randomUUID()], sesA: randomUUID() };
    const mk = (id: string, name: string) => ({ mber_id: id, email_addr: `${name}-${id.slice(0, 8)}@billing-smoke.invalid`, mber_nm: name, mber_sttus_code: "ACTIVE" });
    await prisma.tbCmMember.createMany({ data: [mk(ids.A, "owner"), mk(ids.B, "b"), mk(ids.C, "c"), mk(ids.D, "d"), mk(ids.E, "e"), ...ids.V.map((v, i) => mk(v, `viewer${i}`))] });
    const emailA = (await prisma.tbCmMember.findUniqueOrThrow({ where: { mber_id: ids.A } })).email_addr!;
    const actor = { mberId: ids.A, email: emailA };
    for (const p of [ids.P1, ids.P2]) {
      await prisma.tbPjProject.create({ data: { prjct_id: p, prjct_nm: `P-${p.slice(0, 4)}`, prjct_abrv: "SMK", creat_mber_id: ids.A, owner_mber_id: ids.A } });
    }
    const pm = (p: string, m: string, role: string) => ({ prjct_id: p, mber_id: m, role_code: role, mber_sttus_code: "ACTIVE" });
    await prisma.tbPjProjectMember.createMany({ data: [
      pm(ids.P1, ids.A, "OWNER"), pm(ids.P1, ids.B, "MEMBER"), pm(ids.P1, ids.V[0]!, "VIEWER"),
      pm(ids.P2, ids.A, "OWNER"), pm(ids.P2, ids.C, "MEMBER"), ...ids.V.map((v) => pm(ids.P2, v, "VIEWER")),
    ] });
    assert.equal(await seats.countUsedSeats(ids.A), 3, "사용 좌석 = A,B,C (뷰어 제외, 중복 제외)");

    const customerKey = buildCustomerKey(ids.A);
    const goodCard = () => encodeMockAuthKey({ cardCompany: "신한", last4: "1234", alwaysFail: false });
    const failCard = () => encodeMockAuthKey({ cardCompany: "국민", last4: "9999", alwaysFail: true });

    // ── 2. BASIC 시작 ────────────────────────────────────────────────────
    log("BASIC 시작 — 좌석 2 는 거부, 3 은 성공(첫 결제·ACTIVE·plan_code=BASIC)");
    const t0 = new Date("2026-10-05T03:00:00+09:00");
    await assert.rejects(sub.beginCardRegistration(actor, "start", 2), (e: unknown) => e instanceof BillingError && e.code === "BILLING_SEAT_COUNT_INVALID");
    const startRes = await sub.beginCardRegistration(actor, "start", 3);
    assert.equal(startRes.mode, "redirect");
    assert.ok(startRes.mode === "redirect" && startRes.url.startsWith("/billing/pg-window?"));

    // 다른 customerKey 로 콜백 → 403
    await assert.rejects(sub.completeCardRegistration(actor, { authKey: goodCard(), customerKey: "spc_other", purpose: "start", seatCnt: 3 }, t0),
      (e: unknown) => e instanceof BillingError && e.code === "BILLING_CUSTOMER_KEY_MISMATCH");

    // 실패 카드로 첫 결제 → 402, 구독 행 없음, FAILED 이력만
    await assert.rejects(sub.completeCardRegistration(actor, { authKey: failCard(), customerKey, purpose: "start", seatCnt: 3 }, t0),
      (e: unknown) => e instanceof BillingError && e.code === "BILLING_PAYMENT_FAILED");
    assert.equal(await sub.findSubscription(ids.A), null, "첫 결제 실패 → 구독 행 없음");
    assert.equal((await prisma.tbBlPayment.findMany({ where: { mber_id: ids.A } })).length, 1);

    const started = await sub.completeCardRegistration(actor, { authKey: goodCard(), customerKey, purpose: "start", seatCnt: 3 }, t0);
    assert.equal(started.purpose, "start");
    let s = (await sub.findSubscription(ids.A))!;
    assert.equal(s.sbscrptn_sttus_code, "ACTIVE");
    assert.equal(s.seat_cnt, 3);
    assert.equal(pricing.formatKstDate(s.next_bill_dt!), "2026-11-05", "다음 결제일 = 매월 같은 날");
    assert.ok(s.billing_key && !s.billing_key.includes("mockbk_"), "빌링키는 암호화 저장");
    const memberA = await prisma.tbCmMember.findUniqueOrThrow({ where: { mber_id: ids.A } });
    assert.equal(memberA.plan_code, "BASIC");
    assert.equal(memberA.plan_expire_dt, null);
    const paidInitial = await prisma.tbBlPayment.findFirst({ where: { mber_id: ids.A, pymnt_sttus_code: "PAID" } });
    assert.equal(paidInitial?.amt, 29700);
    assert.equal(paidInitial?.pymnt_ty_code, "INITIAL");
    assert.equal(await sub.hasLiveSubscription(ids.A), true, "관리자 수동 플랜 변경은 409 대상");
    await assert.rejects(sub.completeCardRegistration(actor, { authKey: goodCard(), customerKey, purpose: "start", seatCnt: 3 }, t0),
      (e: unknown) => e instanceof BillingError && e.code === "BILLING_ALREADY_SUBSCRIBED");

    // ── 3. 좌석 상한 (초대 검사) ─────────────────────────────────────────
    log("좌석 상한 — 편집 멤버 초대는 403 PLAN_LIMIT_SEAT, 뷰어·기존 좌석 보유자는 통과");
    const r1 = await limits.checkMemberLimit(ids.P1, [{ role: "MEMBER", mberId: ids.D }], "invitee");
    assert.ok(r1 && r1.status === 403 && (await r1.clone().json()).code === "PLAN_LIMIT_SEAT");
    assert.equal(await limits.checkMemberLimit(ids.P1, [{ role: "VIEWER", mberId: ids.D }]), null, "뷰어 무료");
    assert.equal(await limits.checkMemberLimit(ids.P1, [{ role: "MEMBER", mberId: ids.C }]), null, "C 는 P2 에서 이미 좌석 보유");
    const emailD = (await prisma.tbCmMember.findUniqueOrThrow({ where: { mber_id: ids.D } })).email_addr!;
    const r2 = await limits.checkMemberLimit(ids.P1, [{ role: "MEMBER", email: emailD }, { role: "MEMBER", email: emailD.toUpperCase() }], "inviter");
    assert.ok(r2 && r2.status === 403, "이메일 초대(같은 사람 2번)도 새 좌석 1개로 계산돼 초과");
    // 뷰어 → 편집 승격도 좌석을 먹는다 (역할 변경 API 가 checkSeatLimit 호출)
    const r2b = await limits.checkSeatLimit(ids.P1, [{ role: "MEMBER", mberId: ids.V[0]! }]);
    assert.ok(r2b && r2b.status === 403, "좌석 3/3 에서 뷰어 승격 → 403");
    assert.equal(await limits.checkSeatLimit(ids.P1, [{ role: "MEMBER", mberId: ids.C }]), null, "이미 좌석 보유자 승격은 통과");

    // ── 4. 좌석 추가 — 일할 결제 ─────────────────────────────────────────
    log("좌석 추가 — 10일 뒤 1좌석 추가, 일할 금액 결제 후 seat_cnt=4, 초대 통과");
    const t10 = new Date(t0.getTime() + days(10));
    const preview = await sub.previewSeatAddition(ids.A, 1, t10);
    const expected = Math.round(9900 * 1 * preview.remainingDays / preview.periodDays);
    assert.equal(preview.amount, expected);
    assert.ok(preview.amount > 0 && preview.amount < 9900);
    const added = await sub.changeSeats(actor, 4, t10);
    assert.equal(added.action, "ADDED");
    assert.equal(added.action === "ADDED" && added.amount, preview.amount);
    s = (await sub.findSubscription(ids.A))!;
    assert.equal(s.seat_cnt, 4);
    assert.equal(await limits.checkMemberLimit(ids.P1, [{ role: "MEMBER", mberId: ids.D }]), null, "좌석 4 → D 초대 가능");
    await prisma.tbPjProjectMember.create({ data: pm(ids.P1, ids.D, "MEMBER") });
    assert.equal(await seats.countUsedSeats(ids.A), 4);

    // ── 5. 좌석 축소 예약 / 취소 ─────────────────────────────────────────
    log("좌석 축소 — 사용 좌석(4) 미만은 거부, 5→4 예약은 초대 상한에 즉시 반영, 같은 값 입력 시 예약 취소");
    await assert.rejects(sub.changeSeats(actor, 3, t10), (e: unknown) => e instanceof BillingError && e.code === "BILLING_SEAT_COUNT_INVALID");
    const added2 = await sub.changeSeats(actor, 5, t10);           // 5좌석으로 올린 뒤
    assert.equal(added2.action, "ADDED");
    const reduce = await sub.changeSeats(actor, 4, t10);           // 4로 축소 예약
    assert.equal(reduce.action, "REDUCE_SCHEDULED");
    assert.equal((await seats.getSeatLimit(ids.A))?.limit, 4, "예약값이 상한");
    const r3 = await limits.checkMemberLimit(ids.P2, [{ role: "MEMBER", mberId: ids.E }]);
    assert.ok(r3 && r3.status === 403, "예약 상한 4 = 사용 4 → E 초대 불가");
    const cancelReduce = await sub.changeSeats(actor, 5, t10);
    assert.equal(cancelReduce.action, "REDUCE_CANCELED");
    assert.equal((await seats.getSeatLimit(ids.A))?.limit, 5);
    const reduceAgain = await sub.changeSeats(actor, 4, t10);      // 다음 갱신에서 적용되는지 보려고 다시 예약
    assert.equal(reduceAgain.action, "REDUCE_SCHEDULED");

    // ── 6. 사전 안내 (7일 전) — 멱등 ────────────────────────────────────
    log("배치 — 결제 7일 전 사전 안내 1회만 (같은 날 재실행 시 SKIP)");
    const tPre = new Date(s.next_bill_dt!.getTime() - days(6));
    assert.deepEqual(await daily.processSubscriptionDaily(s.sbscrptn_id, new Date(s.next_bill_dt!.getTime() - days(8))), [], "8일 전엔 아무것도 안 함");
    assert.deepEqual(await daily.processSubscriptionDaily(s.sbscrptn_id, tPre), ["PRENOTICE_SENT"]);
    assert.deepEqual(await daily.processSubscriptionDaily(s.sbscrptn_id, tPre), [], "중복 발송 없음");

    // ── 7. 정기 결제(갱신) — 축소 예약 적용, 기간 연속 ─────────────────
    log("배치 — 결제일 도래 → RECURRING 결제, 좌석 5→4 적용, 새 주기 = 이전 종료일부터");
    const prevEnd = s.next_bill_dt!;
    const tBill = new Date(prevEnd.getTime() + days(0.5));
    assert.deepEqual(await daily.processSubscriptionDaily(s.sbscrptn_id, tBill), ["RENEWED"]);
    s = (await sub.findSubscription(ids.A))!;
    assert.equal(s.seat_cnt, 4);
    assert.equal(s.pending_seat_cnt, null);
    assert.equal(s.crrnt_perd_bgng_dt!.getTime(), prevEnd.getTime(), "새 주기 시작 = 이전 종료");
    assert.equal(pricing.formatKstDate(s.next_bill_dt!), "2026-12-05");
    assert.equal(s.prentc_dt, null, "사전 안내 플래그 리셋");
    const recurring = await prisma.tbBlPayment.findFirst({ where: { sbscrptn_id: s.sbscrptn_id, pymnt_ty_code: "RECURRING" } });
    assert.equal(recurring?.amt, 4 * 9900);
    assert.deepEqual(await daily.processSubscriptionDaily(s.sbscrptn_id, tBill), [], "같은 날 재실행 → 중복 청구 없음");

    // ── 8. 실패 카드로 변경 → 결제 실패 → 재시도 3회 → 강등 ──────────
    log("결제 수단 변경(실패 카드) → 다음 결제 실패 → PAST_DUE, 플랜은 유지");
    const changed = await sub.completeCardRegistration(actor, { authKey: failCard(), customerKey, purpose: "change" }, tBill);
    assert.equal(changed.purpose, "change");
    assert.equal(changed.purpose === "change" && changed.retry, null, "ACTIVE 상태에서는 즉시 재결제 없음");
    const bill2 = (await sub.findSubscription(ids.A))!.next_bill_dt!;
    const tFail0 = new Date(bill2.getTime() + days(0.2));
    assert.deepEqual(await daily.processSubscriptionDaily(s.sbscrptn_id, tFail0), ["RENEW_FAILED"]);
    s = (await sub.findSubscription(ids.A))!;
    assert.equal(s.sbscrptn_sttus_code, "PAST_DUE");
    assert.equal(s.fail_cnt, 1);
    assert.equal((await prisma.tbCmMember.findUniqueOrThrow({ where: { mber_id: ids.A } })).plan_code, "BASIC", "재시도 중 정상 사용");
    assert.equal((await prisma.tbPjProject.count({ where: { owner_mber_id: ids.A, lock_yn: "Y" } })), 0, "재시도 중 잠금 없음");
    await assert.rejects(sub.changeSeats(actor, 6, tFail0), (e: unknown) => e instanceof BillingError && e.code === "BILLING_INVALID_STATE");

    log("재시도 — 1일 뒤 SKIP, 3일·6일 뒤 실패(fail_cnt 2·3), 9일 뒤 소진 → EXPIRED·FREE·잠금");
    assert.deepEqual(await daily.processSubscriptionDaily(s.sbscrptn_id, new Date(tFail0.getTime() + days(1))), [], "3일 전엔 재시도 안 함");
    assert.deepEqual(await daily.processSubscriptionDaily(s.sbscrptn_id, new Date(tFail0.getTime() + days(3))), ["RETRY_FAILED"]);
    assert.deepEqual(await daily.processSubscriptionDaily(s.sbscrptn_id, new Date(tFail0.getTime() + days(6))), ["RETRY_FAILED"]);
    s = (await sub.findSubscription(ids.A))!;
    assert.equal(s.fail_cnt, 3);
    assert.equal(s.sbscrptn_sttus_code, "PAST_DUE");
    assert.deepEqual(await daily.processSubscriptionDaily(s.sbscrptn_id, new Date(tFail0.getTime() + days(9))), ["EXPIRED"]);
    s = (await sub.findSubscription(ids.A))!;
    assert.equal(s.sbscrptn_sttus_code, "EXPIRED");
    assert.equal(s.fail_cnt, 4, "초기 1회 + 재시도 3회");
    assert.equal(s.billing_key, null, "종료 시 빌링키 삭제");
    assert.equal((await prisma.tbCmMember.findUniqueOrThrow({ where: { mber_id: ids.A } })).plan_code, "FREE");
    const lockedAfter = await prisma.tbPjProject.findMany({ where: { owner_mber_id: ids.A }, select: { prjct_id: true, lock_yn: true } });
    assert.ok(lockedAfter.every((p) => p.lock_yn === "Y"), "프로젝트 2개라 자동 해제 없이 전부 잠금");
    const failedPayments = await prisma.tbBlPayment.count({ where: { sbscrptn_id: s.sbscrptn_id, pymnt_sttus_code: "FAILED" } });
    assert.equal(failedPayments, 4, "실패 이력 4건 (주문 ID 전부 고유)");

    // ── 9. 잠금 검사 — requirePermission ─────────────────────────────────
    log("requirePermission — 잠긴 프로젝트: 읽기 200 / 쓰기 403 PROJECT_LOCKED / 멤버 제거는 예외 허용");
    process.env.JWT_SECRET ??= "billing-smoke-jwt-secret-with-sufficient-length-1234567890";
    await prisma.tbCmMemberSession.create({ data: { sesn_id: ids.sesA, mber_id: ids.A } });
    const token = signAccessToken({ mberId: ids.A, email: emailA, sesnId: ids.sesA });
    const req = (p: string) => new NextRequest(`http://localhost:3000${p}`, { headers: { Authorization: `Bearer ${token}` } });
    const readGate = await requirePermission(req(`/api/projects/${ids.P1}/tasks`), ids.P1, "content.read");
    assert.ok(!(readGate instanceof Response), "읽기는 통과");
    const writeGate = await requirePermission(req(`/api/projects/${ids.P1}/tasks`), ids.P1, "content.create");
    assert.ok(writeGate instanceof Response && writeGate.status === 403 && (await writeGate.clone().json()).code === "PROJECT_LOCKED");
    const removeGate = await requirePermission(req(`/api/projects/${ids.P1}/members/x`), ids.P1, "member.remove");
    assert.ok(!(removeGate instanceof Response), "잠금 해소 수단(멤버 제거)은 허용");

    // ── 10. 활성화 — P1(4명) 해제 OK, P2(6명) 초과 거부 → 뷰어 1명 빼면 OK ─
    log("활성화 — P1(멤버 4명) 해제, P2(6명) 는 FREE 상한 초과로 거부, 뷰어 제거 후 해제");
    const u1 = await lock.unlockProjectByOwner(ids.P1);
    assert.equal(u1.unlocked, true);
    const u2 = await lock.unlockProjectByOwner(ids.P2);
    assert.equal(u2.unlocked, false);
    assert.ok(!u2.unlocked && u2.verdict.reason === "FREE_MEMBERS" && u2.verdict.memberCount === 6);
    await prisma.tbPjProjectMember.update({ where: { prjct_id_mber_id: { prjct_id: ids.P2, mber_id: ids.V[3]! } }, data: { mber_sttus_code: "REMOVED" } });
    assert.equal((await lock.unlockProjectByOwner(ids.P2)).unlocked, true);
    // 재결제 테스트를 위해 다시 잠가 둔다
    await lock.lockAllOwnedProjects(ids.A, new Date());

    // ── 11. 재결제 — 종료된 행 재사용, 전부 해제 ──────────────────────
    log("재결제 — EXPIRED 행 재사용 → ACTIVE, BASIC, 잠금 전부 해제");
    const tRe = new Date(tFail0.getTime() + days(12));
    const restarted = await sub.completeCardRegistration(actor, { authKey: goodCard(), customerKey, purpose: "start", seatCnt: 4 }, tRe);
    assert.equal(restarted.purpose, "start");
    const s2 = (await sub.findSubscription(ids.A))!;
    assert.equal(s2.sbscrptn_id, s.sbscrptn_id, "행 재사용 (mber_id, prdct_code UNIQUE)");
    assert.equal(s2.sbscrptn_sttus_code, "ACTIVE");
    assert.equal(s2.fail_cnt, 0);
    assert.equal((await prisma.tbCmMember.findUniqueOrThrow({ where: { mber_id: ids.A } })).plan_code, "BASIC");
    assert.equal(await prisma.tbPjProject.count({ where: { owner_mber_id: ids.A, lock_yn: "Y" } }), 0, "재결제 → 전부 해제");
    assert.equal(await prisma.tbBlSubscription.count({ where: { mber_id: ids.A } }), 1);

    // ── 12. 해지 예약 → 취소 → 재예약 → 기간 말 확정 ────────────────
    log("해지 — 예약(CANCEL_SCHEDULED) → 취소(ACTIVE) → 재예약 → 기간 종료 배치에서 CANCELED·FREE·잠금");
    const c1 = await sub.cancelSubscription(actor, tRe);
    assert.equal(c1.status, "CANCEL_SCHEDULED");
    assert.equal(c1.periodEnd, s2.crrnt_perd_end_dt!.toISOString());
    assert.deepEqual(await daily.processSubscriptionDaily(s2.sbscrptn_id, new Date(tRe.getTime() + days(1))), [], "기간 중엔 아무것도 안 함(사전 안내도 없음)");
    await assert.rejects(sub.changeSeats(actor, 6, tRe), (e: unknown) => e instanceof BillingError && e.code === "BILLING_INVALID_STATE");
    const un = await sub.uncancelSubscription(actor, tRe);
    assert.equal(un.status, "ACTIVE");
    await sub.cancelSubscription(actor, tRe);
    const tEnd = new Date(s2.crrnt_perd_end_dt!.getTime() + days(0.1));
    assert.deepEqual(await daily.processSubscriptionDaily(s2.sbscrptn_id, tEnd), ["CANCEL_FINALIZED"]);
    const s3 = (await sub.findSubscription(ids.A))!;
    assert.equal(s3.sbscrptn_sttus_code, "CANCELED");
    assert.equal(s3.billing_key, null);
    assert.equal((await prisma.tbCmMember.findUniqueOrThrow({ where: { mber_id: ids.A } })).plan_code, "FREE");
    assert.equal(await prisma.tbPjProject.count({ where: { owner_mber_id: ids.A, lock_yn: "Y" } }), 2);
    assert.equal(await sub.hasLiveSubscription(ids.A), false, "종료 후엔 관리자 수동 변경 가능");
    assert.deepEqual(await daily.loadDailyTargets(), [], "종료된 구독은 배치 대상 아님");

    // ── 13. 자동 해제 — 프로젝트 1개뿐이면 강등 시 바로 활성 ─────────
    log("자동 해제 — 소유 프로젝트가 1개(≤5명)뿐인 소유자는 강등 직후 자동 활성화");
    const ids2 = { O: randomUUID(), P: randomUUID() };
    await prisma.tbCmMember.create({ data: mk(ids2.O, "solo") });
    await prisma.tbPjProject.create({ data: { prjct_id: ids2.P, prjct_nm: "solo", prjct_abrv: "SOL", creat_mber_id: ids2.O, owner_mber_id: ids2.O } });
    await prisma.tbPjProjectMember.create({ data: pm(ids2.P, ids2.O, "OWNER") });
    const actor2 = { mberId: ids2.O, email: "solo@billing-smoke.invalid" };
    await sub.completeCardRegistration(actor2, { authKey: goodCard(), customerKey: buildCustomerKey(ids2.O), purpose: "start", seatCnt: 1 }, t0);
    const solo = (await sub.findSubscription(ids2.O))!;
    const pastDue = await sub.cancelSubscription(actor2, t0);         // ACTIVE → 예약
    assert.equal(pastDue.status, "CANCEL_SCHEDULED");
    await daily.processSubscriptionDaily(solo.sbscrptn_id, new Date(solo.crrnt_perd_end_dt!.getTime() + days(0.1)));
    const soloP = await prisma.tbPjProject.findUniqueOrThrow({ where: { prjct_id: ids2.P } });
    assert.equal(soloP.lock_yn, "N", "1개뿐 + 5명 이하 → 자동 해제");

    // ── 14. 소유권 이전 잠금 판정 + 탈퇴 시 구독 종료 ──────────────────
    log("이전·복구 판정 — FREE 소유자에게 6명 프로젝트가 가면 잠김 / 탈퇴 시 살아 있는 구독 CANCELED·빌링키 NULL");
    await prisma.tbPjProjectMember.update({ where: { prjct_id_mber_id: { prjct_id: ids.P2, mber_id: ids.V[3]! } }, data: { mber_sttus_code: "ACTIVE" } }); // P2 다시 6명
    const over = await lock.isProjectOverPlanLimit(ids.P2, ids2.O);
    assert.ok(over.over && over.reason === "FREE_MEMBERS");
    assert.equal((await lock.isProjectOverPlanLimit(ids.P1, ids2.O)).over, false);
    // 탈퇴: solo 가 다시 구독한 뒤 withdrawSubscription
    await sub.completeCardRegistration(actor2, { authKey: goodCard(), customerKey: buildCustomerKey(ids2.O), purpose: "start", seatCnt: 1 }, tRe);
    await prisma.$transaction(async (tx) => { assert.equal(await sub.withdrawSubscription(tx, ids2.O, tRe), true); });
    const soloSub = (await sub.findSubscription(ids2.O))!;
    assert.equal(soloSub.sbscrptn_sttus_code, "CANCELED");
    assert.equal(soloSub.billing_key, null);

    // ── 15. 결제 내역·개요 DTO ───────────────────────────────────────────
    log("DTO — 개요·결제 내역에 빌링키 없음, 실패 이력 포함");
    const overview = await sub.getBillingOverview(ids.A);
    assert.equal(overview.provider, "MOCK");
    assert.equal(overview.subscription?.status, "CANCELED");
    assert.ok(!JSON.stringify(overview).includes("mockbk_"), "빌링키 노출 없음");
    const payments = await sub.listPayments(ids.A);
    assert.ok(payments.length >= 9);
    assert.ok(payments.some((p) => p.status === "FAILED" && p.failReason?.includes("MOCK_DECLINED")));
    assert.ok(payments.every((p) => p.orderId.startsWith("SPC-")));

    console.log("\n\x1b[32m✔ 결제 2단계 스모크 전부 통과\x1b[0m — 결제 이력", payments.length, "건, 좌석 흐름·배치·잠금·해지 검증 완료");
  } finally {
    if (db) await db.$disconnect().catch(() => {});
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch((e) => console.error("스키마 정리 실패:", e));
    await admin.$disconnect();
  }
}

main().catch((err) => {
  console.error("\x1b[31m✘ 스모크 실패\x1b[0m", err);
  process.exit(1);
});
