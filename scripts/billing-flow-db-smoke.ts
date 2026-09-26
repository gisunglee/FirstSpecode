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
 *   가격·날짜 순수 함수 → FREE 상한(편집자 소유자 1명·뷰어 무제한·필요 좌석 안내) → BASIC 시작(좌석 검증·첫 결제·플랜 미러) → 좌석 상한(초대 검사)
 *   → 좌석 추가(일할 결제) → 좌석 축소 예약·취소 → 사전 안내 메일(멱등) → 정기 결제(갱신)
 *   → 실패 카드로 변경 → 결제 실패(PAST_DUE) → 3일 간격 재시도 3회 → 강등(EXPIRED·FREE·잠금)
 *   → 잠금 검사(requirePermission 권한·메서드 기준, requireProjectUnlocked) → 활성화(상한 이하/초과)
 *   → 열린 프로젝트 교체(남의 것 거부·롤백·정상 교체·여러 개 닫기) → 재결제(전부 해제)
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
    const withdrawal = await import("@/lib/billing/withdrawal");
    const { encodeMockAuthKey } = await import("@/lib/billing/mock-auth-key");
    const { buildCustomerKey }  = await import("@/lib/billing/gateway");
    const { BillingError }      = await import("@/lib/billing/errors");
    const { requirePermission } = await import("@/lib/requirePermission");
    const { requireProjectUnlocked } = await import("@/lib/requireProjectUnlocked");
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
    {
      // 좌석 구성 — 숫자 판정과 같은 기준. 본인 첫 줄, 프로젝트 2개에 걸친 사람은 칩 2개
      const bd = await seats.getSeatBreakdown(ids.A);
      assert.equal(bd.projectCount, 2);
      assert.equal(bd.editors.length, 3, "editors 길이 = countUsedSeats");
      assert.equal(bd.editors[0]!.mberId, ids.A);
      assert.ok(bd.editors[0]!.isSelf && bd.editors[0]!.projects.length === 2, "본인은 두 프로젝트 OWNER");
      assert.equal(bd.viewers.length, 4, "뷰어 4명(중복 제거)");
      assert.ok(bd.viewers.some((v) => v.mberId === ids.V[0] && v.projects.length === 2), "V0 은 P1·P2 뷰어 → 칩 2개, 1명");
      assert.equal(bd.pendingEditorInvites, 0);
      await prisma.tbPjProjectInvitation.create({ data: { prjct_id: ids.P1, email_addr: "pending@billing-smoke.invalid", role_code: "MEMBER", invt_token_val: `tok-${randomUUID()}`, invtr_mber_id: ids.A, expiry_dt: new Date(Date.now() + days(3)) } });
      assert.equal((await seats.getSeatBreakdown(ids.A)).pendingEditorInvites, 1, "초대 중 편집 멤버 1");
    }

    const customerKey = buildCustomerKey(ids.A);
    const goodCard = () => encodeMockAuthKey({ cardCompany: "신한", last4: "1234", alwaysFail: false });
    const failCard = () => encodeMockAuthKey({ cardCompany: "국민", last4: "9999", alwaysFail: true });

    // ── 1-b. FREE 상한 — 편집 멤버는 소유자뿐, 뷰어 무제한 (정책 §1-2, 2026-09-26) ──
    log("FREE 상한 — 편집 멤버 초대·승격은 403 PLAN_LIMIT_MEMBER(필요 좌석·월 금액 포함), 뷰어 초대는 통과");
    {
      // A 는 아직 FREE (plan_code null). P1 편집 멤버 = A, B 로 이미 상한 초과 상태 — 기존은 그대로, 추가만 막힌다
      const rf = await limits.checkMemberLimit(ids.P1, [{ role: "MEMBER", mberId: ids.D }], "inviter");
      assert.ok(rf && rf.status === 403);
      const body = await rf!.clone().json();
      assert.equal(body.code, "PLAN_LIMIT_MEMBER");
      assert.equal(body.requiredSeats, 4, "BASIC 으로 가면 사용 좌석 3(A,B,C) + 새 편집자 D = 4좌석");
      assert.equal(body.monthlyAmount, 39600);
      assert.equal(await limits.checkMemberLimit(ids.P1, [{ role: "VIEWER", mberId: ids.D }]), null, "뷰어는 무료·무제한");
      const rfC = await limits.checkMemberLimit(ids.P1, [{ role: "MEMBER", mberId: ids.C }], "inviter");
      assert.equal((await rfC!.clone().json()).requiredSeats, 3, "이미 좌석 보유자(C)는 새 좌석이 아니지만 FREE 에선 그래도 차단");
      const rfIn = await limits.checkMemberLimit(ids.P1, [{ role: "MEMBER", mberId: ids.D }], "invitee");
      assert.ok(rfIn && rfIn.status === 403, "수락 시점 재검사도 같은 결론");
      const rp = await limits.checkSeatLimit(ids.P1, [{ role: "MEMBER", mberId: ids.V[0]! }]);
      assert.ok(rp && rp.status === 403 && (await rp.clone().json()).code === "PLAN_LIMIT_MEMBER", "FREE 뷰어 → 편집 승격도 차단");
      assert.equal(await limits.checkSeatLimit(ids.P1, [{ role: "VIEWER", mberId: ids.B }]), null, "뷰어로 내리는 방향은 검사 없음");
    }

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
    // 주기가 끝났는데 배치가 아직 안 돈 틈 — 남은 일수 0 → 0원 좌석 추가가 되면 안 된다
    await assert.rejects(sub.previewSeatAddition(ids.A, 1, tBill), (e: unknown) => e instanceof BillingError && e.code === "BILLING_INVALID_STATE");
    await assert.rejects(sub.changeSeats(actor, 6, tBill), (e: unknown) => e instanceof BillingError && e.code === "BILLING_INVALID_STATE");
    assert.equal((await sub.findSubscription(ids.A))!.seat_cnt, 5, "주기 종료 후 좌석 추가 거부 → 좌석 그대로");
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

    log("이중 결제 방지 — 다른 요청이 먼저 갱신한(낡은 버전) 구독으로 청구 시도 → skipped, 결제 이력 없음");
    {
      const stale = (await sub.findSubscription(ids.A))!;
      // 다른 요청이 먼저 처리한 것을 흉내낸다 — mdfcn_dt(버전)만 앞으로 밀어 둔다
      await prisma.tbBlSubscription.update({ where: { sbscrptn_id: stale.sbscrptn_id }, data: { mdfcn_dt: new Date(stale.mdfcn_dt.getTime() + 1000) } });
      const before = await prisma.tbBlPayment.count({ where: { sbscrptn_id: stale.sbscrptn_id } });
      const r = await sub.attemptRecurringCharge(stale, emailA, tBill, "RENEWAL");
      assert.ok(!r.ok && r.skipped === true, "선점 실패 → skipped");
      assert.equal(await prisma.tbBlPayment.count({ where: { sbscrptn_id: stale.sbscrptn_id } }), before, "PG 청구·이력 없음");
      const after = (await sub.findSubscription(ids.A))!;
      assert.equal(after.fail_cnt, 0, "실패로 세지 않음");
      assert.equal(after.sbscrptn_sttus_code, "ACTIVE");
    }

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
    // 상세 수정·인라인·정렬은 "content.read" 로 게이트를 통과한 뒤 자체 판정한다 → 메서드(PUT)로 막혀야 한다
    const reqPut = (p: string) => new NextRequest(`http://localhost:3000${p}`, { method: "PUT", headers: { Authorization: `Bearer ${token}` } });
    const putGate = await requirePermission(reqPut(`/api/projects/${ids.P1}/screens/x`), ids.P1, "content.read");
    assert.ok(putGate instanceof Response && putGate.status === 403 && (await putGate.clone().json()).code === "PROJECT_LOCKED", "읽기 권한이어도 PUT 은 잠금");
    const patchTransfer = new NextRequest(`http://localhost:3000/api/projects/${ids.P1}/members/x/role`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } });
    const roleGate = await requirePermission(patchTransfer, ids.P1, "member.changeRole");
    assert.ok(!(roleGate instanceof Response) && roleGate.projectLocked === true, "역할 변경은 통과하되 projectLocked 플래그 전달");
    // requireAuth 만 쓰는 라우트용 헬퍼
    const helperGate = await requireProjectUnlocked(ids.P1);
    assert.ok(helperGate instanceof Response && helperGate.status === 403, "requireProjectUnlocked → 403");
    assert.equal(await requireProjectUnlocked(randomUUID()), null, "없는 프로젝트는 호출부 404 에 맡김");

    // ── 10. 활성화 — FREE: 소유자 혼자 편집 + 열린 프로젝트 1개 ─────────
    log("활성화 — P1 은 편집 멤버 3명(A·B·D)이라 거부(FREE_EDITORS), B·D 를 뷰어로 내리면 해제; P2 는 열린 P1 때문에 거부(FREE_PROJECTS), P1 을 잠그면 해제");
    const u0 = await lock.unlockProjectByOwner(ids.P1);
    assert.ok(!u0.unlocked && u0.verdict.reason === "FREE_EDITORS" && u0.verdict.editorCount === 3, "A+B+D 편집 멤버 3명 → 거부 (D 는 4단계 좌석 추가 때 합류)");
    const setRole = (p: string, m: string, role: string) =>
      prisma.tbPjProjectMember.update({ where: { prjct_id_mber_id: { prjct_id: p, mber_id: m } }, data: { role_code: role } });
    await setRole(ids.P1, ids.B, "VIEWER");
    await setRole(ids.P1, ids.D, "VIEWER");
    const u1 = await lock.unlockProjectByOwner(ids.P1);
    assert.equal(u1.unlocked, true, "뷰어로 내리면 소유자 혼자 → 해제");
    assert.equal(await requireProjectUnlocked(ids.P1), null, "해제 후 헬퍼 통과");
    const u2 = await lock.unlockProjectByOwner(ids.P2);
    assert.ok(!u2.unlocked && u2.verdict.reason === "FREE_EDITORS", "P2 는 C 가 편집 멤버");
    await setRole(ids.P2, ids.C, "VIEWER");
    const u3 = await lock.unlockProjectByOwner(ids.P2);
    assert.ok(!u3.unlocked && u3.verdict.reason === "FREE_PROJECTS" && u3.verdict.openProjectCount === 1, "열린 P1 이 있어 P2 는 못 연다 — FREE 는 활성 1개");
    await lock.lockAllOwnedProjects(ids.A, new Date());   // P1 을 다시 잠그면 P2 를 열 수 있다 — 어느 것을 열지는 소유자가 고른다
    assert.equal((await lock.unlockProjectByOwner(ids.P2)).unlocked, true);
    // 뒤 단계(재결제·좌석 계산)를 위해 B·D·C 를 편집 멤버로 되돌리고 다시 잠가 둔다
    await setRole(ids.P1, ids.B, "MEMBER");
    await setRole(ids.P1, ids.D, "MEMBER");
    await setRole(ids.P2, ids.C, "MEMBER");
    await lock.lockAllOwnedProjects(ids.A, new Date());

    // ── 10-b. 열린 프로젝트 교체 — A 를 닫고 B 를 연다 ─────────────────
    log("교체 — 남의 프로젝트는 못 닫고, 닫은 뒤 상한을 넘으면 전체 롤백(둘 다 잠기는 상태 금지), 정상이면 A 닫힘·B 열림");
    const isLocked = async (p: string) =>
      (await prisma.tbPjProject.findUniqueOrThrow({ where: { prjct_id: p }, select: { lock_yn: true } })).lock_yn === "Y";

    // 준비 — 편집 멤버는 소유자뿐, P1 만 열어 둔다
    await setRole(ids.P1, ids.B, "VIEWER");
    await setRole(ids.P1, ids.D, "VIEWER");
    await setRole(ids.P2, ids.C, "VIEWER");
    await lock.lockAllOwnedProjects(ids.A, new Date());
    assert.equal((await lock.unlockProjectByOwner(ids.P1)).unlocked, true, "P1 을 열어 둔다");

    // ① 하위호환 — body 없는 기존 경로는 그대로 거부된다
    const noSwap = await lock.unlockProjectByOwner(ids.P2);
    assert.ok(!noSwap.unlocked && noSwap.verdict.reason === "FREE_PROJECTS", "교체 없이는 P2 를 못 연다");

    // ② 남의 프로젝트를 닫으려 하면 아무것도 하지 않는다
    const foreignP = randomUUID();
    await prisma.tbPjProject.create({ data: { prjct_id: foreignP, prjct_nm: "foreign", prjct_abrv: "FGN", creat_mber_id: ids.E, owner_mber_id: ids.E } });
    const swapForeign = await lock.swapOpenProject(ids.A, ids.P2, [foreignP], new Date());
    assert.ok(!swapForeign.unlocked && swapForeign.reason === "INVALID_CLOSE_TARGET", "남의 프로젝트는 닫을 수 없다");
    assert.equal(await isLocked(foreignP), false, "남의 프로젝트는 건드리지 않았다");
    assert.equal(await isLocked(ids.P1),   false, "거부되어도 P1 은 열린 채 그대로");
    assert.equal(await isLocked(ids.P2),   true,  "P2 도 잠긴 채 그대로");

    // ③ 없는 프로젝트 ID 도 같은 방어에 걸린다
    const swapGhost = await lock.swapOpenProject(ids.A, ids.P2, [randomUUID()], new Date());
    assert.ok(!swapGhost.unlocked && swapGhost.reason === "INVALID_CLOSE_TARGET", "존재하지 않는 ID 거부");
    assert.equal(await isLocked(ids.P1), false, "여전히 P1 열림");

    // ④ 가장 중요 — 닫은 뒤에도 상한을 넘으면 전체 롤백(P1 이 닫힌 채 P2 도 안 열리는 상태 금지)
    await setRole(ids.P2, ids.C, "MEMBER");   // P2 에 편집 멤버를 하나 더 둔다
    const swapRollback = await lock.swapOpenProject(ids.A, ids.P2, [ids.P1], new Date());
    assert.ok(!swapRollback.unlocked && swapRollback.reason === "OVER_LIMIT" && swapRollback.verdict.reason === "FREE_EDITORS",
      "P2 는 편집 멤버가 둘이라 못 연다");
    assert.equal(await isLocked(ids.P1), false, "롤백 — P1 은 닫히지 않았다");
    assert.equal(await isLocked(ids.P2), true,  "롤백 — P2 도 잠긴 그대로");

    // ⑤ 정상 교체 — P1 닫힘, P2 열림
    await setRole(ids.P2, ids.C, "VIEWER");
    const swapOk = await lock.swapOpenProject(ids.A, ids.P2, [ids.P1], new Date());
    assert.ok(swapOk.unlocked && swapOk.closedProjectIds.length === 1 && swapOk.closedProjectIds[0] === ids.P1, "교체 성공");
    assert.equal(await isLocked(ids.P1), true,  "P1 닫힘");
    assert.equal(await isLocked(ids.P2), false, "P2 열림");

    // ⑥ 여러 개가 열려 있던 기존 사용자 — 전부 닫고 하나만 연다
    const extraP = randomUUID();
    await prisma.tbPjProject.create({ data: { prjct_id: extraP, prjct_nm: "extra", prjct_abrv: "EXT", creat_mber_id: ids.A, owner_mber_id: ids.A, lock_yn: "N" } });
    const swapMany = await lock.swapOpenProject(ids.A, ids.P1, [ids.P2, extraP], new Date());
    assert.ok(swapMany.unlocked && swapMany.closedProjectIds.length === 2, "열려 있던 2개를 닫고 P1 을 연다");
    assert.equal(await isLocked(ids.P1), false, "P1 열림");
    assert.equal(await isLocked(ids.P2), true,  "P2 닫힘");
    assert.equal(await isLocked(extraP), true,  "extra 닫힘");

    // 뒤 단계(재결제·좌석 계산)를 위해 원상복구 — 임시 프로젝트 제거, 편집 멤버 복원, 전부 잠금
    await prisma.tbPjProject.deleteMany({ where: { prjct_id: { in: [foreignP, extraP] } } });
    await setRole(ids.P1, ids.B, "MEMBER");
    await setRole(ids.P1, ids.D, "MEMBER");
    await setRole(ids.P2, ids.C, "MEMBER");
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
    log("자동 해제 — 소유 프로젝트가 1개(소유자 혼자)뿐인 소유자는 강등 직후 자동 활성화");
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
    assert.equal(soloP.lock_yn, "N", "1개뿐 + 소유자 혼자 → 자동 해제");

    // ── 14. 소유권 이전 잠금 판정 + 탈퇴 시 구독 종료 ──────────────────
    log("이전·복구 판정 — FREE 소유자에게 편집자 2명 프로젝트가 가면 잠김(FREE_EDITORS), 혼자 프로젝트라도 이미 열린 것이 있으면 잠김(FREE_PROJECTS, 양도 우회 차단) / 탈퇴 시 살아 있는 구독 CANCELED·빌링키 NULL");
    const over = await lock.isProjectOverPlanLimit(ids.P2, ids2.O);
    assert.ok(over.over && over.reason === "FREE_EDITORS", "P2 는 A·C 편집 멤버 2명");
    // 소유자 혼자인 P3 를 O(FREE, 열린 solo 프로젝트 보유)에게 넘기는 상황 → 받은 프로젝트는 잠긴 채 넘어간다
    const p3 = randomUUID();
    await prisma.tbPjProject.create({ data: { prjct_id: p3, prjct_nm: "P3", prjct_abrv: "P3", creat_mber_id: ids.A, owner_mber_id: ids.A } });
    await prisma.tbPjProjectMember.create({ data: pm(p3, ids.A, "OWNER") });
    const over3 = await lock.isProjectOverPlanLimit(p3, ids2.O);
    assert.ok(over3.over && over3.reason === "FREE_PROJECTS" && over3.openProjectCount === 1, "열린 solo 가 있어 P3 는 잠긴 채 받는다");
    assert.equal((await lock.isProjectOverPlanLimit(ids2.P, ids2.O)).over, false, "O 의 유일한 열린 프로젝트는 상한 이하");
    await prisma.tbPjProject.update({ where: { prjct_id: p3 }, data: { del_yn: "Y" } });  // 뒤 단계의 A 소유 프로젝트 수(2)에 영향 없게 치운다
    // 탈퇴: solo 가 다시 구독한 뒤 withdrawSubscription
    await sub.completeCardRegistration(actor2, { authKey: goodCard(), customerKey: buildCustomerKey(ids2.O), purpose: "start", seatCnt: 1 }, tRe);
    await prisma.$transaction(async (tx) => { assert.equal(await sub.withdrawSubscription(tx, ids2.O, tRe), true); });
    const soloSub = (await sub.findSubscription(ids2.O))!;
    assert.equal(soloSub.sbscrptn_sttus_code, "CANCELED");
    assert.equal(soloSub.billing_key, null);

    // ── 15. 결제 내역·개요 DTO ───────────────────────────────────────────
    // ── 16. 관리자 결제 화면 — 조회·운영 액션·환불 원장·동시성 ──────────
    log("관리자 — 요약·목록·상세, 잠금 해제 대행(초과 거부, 강제 없음), 결제일 연기, 청약철회/운영 보정 환불, 즉시 재결제, 강제 종료, 종료 사유");
    const adminQ = await import("@/lib/billing/admin-queries");
    const adminA = await import("@/lib/billing/admin-actions");
    const adminActor = { mberId: ids.A, ipAddr: "127.0.0.1", userAgent: "smoke" };  // 감사 FK 용 회원 — 임시 스키마엔 SUPER_ADMIN 없음
    {
      // 종료 사유 — 앞 단계에서 끝난 구독들
      const endedA = (await sub.findSubscription(ids.A))!;
      assert.equal(endedA.ended_rsn_code, "USER_CANCEL", "해지 확정 → USER_CANCEL");
      assert.equal((await sub.findSubscription(ids2.O))!.ended_rsn_code, "MEMBER_WITHDRAWAL", "탈퇴 → MEMBER_WITHDRAWAL");

      const sum0 = await adminQ.getBillingSummary(tEnd);
      assert.equal(sum0.liveCount, 0);
      assert.ok(sum0.lockedProjectCount >= 2);
      assert.equal((await adminQ.listSubscriptionsForAdmin({ status: "LIVE", page: 1, pageSize: 50 })).items.length, 0);
      const allList = await adminQ.listSubscriptionsForAdmin({ status: "", search: "owner-", page: 1, pageSize: 50 });
      assert.equal(allList.items.length, 1);
      assert.equal(allList.items[0]!.endedReason, "USER_CANCEL");
      assert.ok(!JSON.stringify(allList).includes("mockbk_"), "목록에 빌링키 없음");

      // 잠금 해제 대행 — P2 는 C 가 편집 멤버라 초과 → 거부(강제 없음). C 를 뷰어로 내리면 해제 + 감사 행 (P1 은 잠겨 있어 열린 프로젝트 0)
      const u1 = await adminA.adminUnlockProject(ids.P2, adminActor, "테스트");
      assert.ok(!u1.unlocked && u1.verdict.reason === "FREE_EDITORS");
      await setRole(ids.P2, ids.C, "VIEWER");
      const u2 = await adminA.adminUnlockProject(ids.P2, adminActor, "편집 멤버 정리 후 대행");
      assert.ok(u2.unlocked && !u2.alreadyActive);
      assert.equal(await prisma.tbSysAdminAudit.count({ where: { action_type: "PROJECT_UNLOCK_BY_ADMIN", target_id: ids.P2 } }), 1, "해제와 감사가 같은 트랜잭션");
      await setRole(ids.P2, ids.C, "MEMBER");  // 뒤 단계의 사용 좌석 계산을 위해 되돌린다

      // 재구독 → ACTIVE, 종료 사유 리셋. 결제일 연기 +10일(감사 동반), ACTIVE 재결제는 거부
      const tA = new Date(tEnd.getTime() + days(1));
      await sub.completeCardRegistration(actor, { authKey: goodCard(), customerKey, purpose: "start", seatCnt: 4 }, tA);
      const s4 = (await sub.findSubscription(ids.A))!;
      assert.equal(s4.ended_rsn_code, null, "재구독 시 종료 사유 리셋");
      await assert.rejects(adminA.adminRetryCharge(s4.sbscrptn_id, adminActor, "x", tA), (e: unknown) => e instanceof BillingError && e.code === "BILLING_INVALID_STATE");
      const deferred = await adminA.adminDeferBilling(s4.sbscrptn_id, 10, adminActor, "장애 보상", tA);
      assert.equal(new Date(deferred.nextBillAt!).getTime(), s4.next_bill_dt!.getTime() + days(10));
      assert.equal(await prisma.tbSysAdminAudit.count({ where: { action_type: "BILLING_DEFER_BILL_DATE", target_id: s4.sbscrptn_id } }), 1);

      // 청약철회 — 계정의 첫 구독 시작 결제만, 7일 이내, 계정당 1회. 사용 여부는 보지 않는다 (정책 §1-7, 2026-09-26)
      // A 의 이번 INITIAL 은 재구독(첫 INITIAL 은 t0) → 대상 아님
      const initial4 = (await prisma.tbBlPayment.findFirst({ where: { sbscrptn_id: s4.sbscrptn_id, pymnt_ty_code: "INITIAL", pymnt_sttus_code: "PAID" }, orderBy: { creat_dt: "desc" } }))!;
      await assert.rejects(adminA.adminRecordRefund(initial4.pymnt_id, { reason: "WITHDRAWAL", memo: "재구독" }, adminActor),
        (e: unknown) => e instanceof BillingError && e.code === "BILLING_REFUND_NOT_ALLOWED", "재구독 결제는 청약철회 불가(첫 결제만)");
      const eligA = await withdrawal.getWithdrawalEligibility(ids.A);
      assert.notEqual(eligA.firstPaymentId, initial4.pymnt_id, "A 의 첫 결제는 t0 의 INITIAL");

      // 새 회원 W — 편집자 2명 프로젝트(옛 기준 "유료 기능 사용")여도 첫 결제 7일 이내면 전액 환불
      //   → REFUND 행 + 원 결제 REFUNDED + 구독 종료(REFUND_WITHDRAWAL) + FREE 강등 + 잠금
      const ids3 = { W: randomUUID(), M: randomUUID(), P: randomUUID(), X: randomUUID() };
      await prisma.tbCmMember.createMany({ data: [mk(ids3.W, "wd"), mk(ids3.M, "wdm"), mk(ids3.X, "late")] });
      await prisma.tbPjProject.create({ data: { prjct_id: ids3.P, prjct_nm: "wd", prjct_abrv: "WD", creat_mber_id: ids3.W, owner_mber_id: ids3.W } });
      await prisma.tbPjProjectMember.createMany({ data: [pm(ids3.P, ids3.W, "OWNER"), pm(ids3.P, ids3.M, "MEMBER")] });
      const emailOf = async (id: string) => (await prisma.tbCmMember.findUniqueOrThrow({ where: { mber_id: id } })).email_addr!;
      const actorW = { mberId: ids3.W, email: await emailOf(ids3.W) };
      assert.equal((await withdrawal.getWithdrawalEligibility(ids3.W)).reason, "NO_PAYMENT");
      await sub.completeCardRegistration(actorW, { authKey: goodCard(), customerKey: buildCustomerKey(ids3.W), purpose: "start", seatCnt: 2 }, tA);
      const subW = (await sub.findSubscription(ids3.W))!;
      const initialW = (await prisma.tbBlPayment.findFirst({ where: { sbscrptn_id: subW.sbscrptn_id, pymnt_ty_code: "INITIAL", pymnt_sttus_code: "PAID" } }))!;
      const eligW = await withdrawal.getWithdrawalEligibility(ids3.W);
      assert.ok(eligW.eligible && eligW.firstPaymentId === initialW.pymnt_id && eligW.deadline, "첫 결제·7일 이내 → 가능");
      // 청약철회 7일 검사는 PG 승인 시각(실제 현재) 기준 — 시뮬레이션 시각이 아니라 실제 now 로 호출한다
      const wd = await adminA.adminRecordRefund(initialW.pymnt_id, { reason: "WITHDRAWAL", memo: "7일 이내 청약철회" }, adminActor);
      assert.equal(wd.refund.amount, -initialW.amt);
      assert.equal(wd.refund.origPaymentId, initialW.pymnt_id);
      assert.equal(wd.refund.refundReason, "WITHDRAWAL");
      assert.equal(wd.original.status, "REFUNDED");
      assert.equal(wd.subscriptionTerminated, true);
      const s5 = (await sub.findSubscription(ids3.W))!;
      assert.equal(s5.sbscrptn_sttus_code, "CANCELED");
      assert.equal(s5.ended_rsn_code, "REFUND_WITHDRAWAL");
      assert.equal(s5.billing_key, null);
      assert.equal((await prisma.tbCmMember.findUniqueOrThrow({ where: { mber_id: ids3.W } })).plan_code, "FREE");
      assert.equal((await prisma.tbPjProject.findUniqueOrThrow({ where: { prjct_id: ids3.P } })).lock_yn, "Y", "편집자 2명 프로젝트는 강등 시 잠김");
      await assert.rejects(adminA.adminRecordRefund(initialW.pymnt_id, { reason: "WITHDRAWAL", memo: "중복" }, adminActor), (e: unknown) => e instanceof BillingError && e.code === "BILLING_REFUND_NOT_ALLOWED", "이미 전액 환불");
      assert.equal((await withdrawal.getWithdrawalEligibility(ids3.W)).reason, "ALREADY_REFUNDED");
      // W 가 다시 구독해도 두 번째 INITIAL 은 대상이 아니다 (계정당 1회) — 첫 결제는 환불된 것이 그대로 첫 결제
      await sub.completeCardRegistration(actorW, { authKey: goodCard(), customerKey: buildCustomerKey(ids3.W), purpose: "start", seatCnt: 2 }, new Date(tA.getTime() + days(1)));
      const initialW2 = (await prisma.tbBlPayment.findFirst({ where: { mber_id: ids3.W, pymnt_ty_code: "INITIAL", pymnt_sttus_code: "PAID" }, orderBy: { creat_dt: "desc" } }))!;
      assert.notEqual(initialW2.pymnt_id, initialW.pymnt_id);
      assert.equal((await withdrawal.getWithdrawalEligibility(ids3.W)).firstPaymentId, initialW.pymnt_id, "환불된 첫 결제가 여전히 '첫 결제'");
      await assert.rejects(adminA.adminRecordRefund(initialW2.pymnt_id, { reason: "WITHDRAWAL", memo: "2회차" }, adminActor),
        (e: unknown) => e instanceof BillingError && e.code === "BILLING_REFUND_NOT_ALLOWED", "계정당 1회");

      // 8일 지난 청약철회는 거부 — 새 회원 X 의 첫 결제 승인 시각을 12일 전으로 돌려 재현
      const actorX = { mberId: ids3.X, email: await emailOf(ids3.X) };
      await sub.completeCardRegistration(actorX, { authKey: goodCard(), customerKey: buildCustomerKey(ids3.X), purpose: "start", seatCnt: 1 }, tA);
      const initialX = (await prisma.tbBlPayment.findFirst({ where: { mber_id: ids3.X, pymnt_ty_code: "INITIAL", pymnt_sttus_code: "PAID" } }))!;
      await prisma.tbBlPayment.update({ where: { pymnt_id: initialX.pymnt_id }, data: { apprv_dt: new Date(Date.now() - days(12)) } });
      assert.equal((await withdrawal.getWithdrawalEligibility(ids3.X)).reason, "WINDOW_PASSED");
      await assert.rejects(adminA.adminRecordRefund(initialX.pymnt_id, { reason: "WITHDRAWAL", memo: "늦음" }, adminActor),
        (e: unknown) => e instanceof BillingError && e.code === "BILLING_REFUND_NOT_ALLOWED", "7일 초과 청약철회 거부");

      // 이후 단계는 A 의 살아 있는 구독(s4)을 그대로 쓴다 — 예전엔 청약철회로 끝낸 뒤 재구독했지만 이제 A 는 대상이 아니다
      const s6 = s4;
      const initial6 = initial4;

      // 운영 보정 부분 환불 — PARTIALLY_REFUNDED, 잔액. 동시 2건(잔액 전액씩) → 정확히 1건만 성공
      const adj = await adminA.adminRecordRefund(initial6.pymnt_id, { reason: "ADJUSTMENT", amount: 1000, memo: "테스트 보정" }, adminActor);
      assert.equal(adj.original.status, "PARTIALLY_REFUNDED");
      assert.equal(adj.subscriptionTerminated, false);
      assert.equal((await sub.findSubscription(ids.A))!.sbscrptn_sttus_code, "ACTIVE", "운영 보정은 구독 유지");
      await assert.rejects(adminA.adminRecordRefund(initial6.pymnt_id, { reason: "WITHDRAWAL", memo: "x" }, adminActor), (e: unknown) => e instanceof BillingError, "일부 환불된 결제는 청약철회 불가");
      const remaining = initial6.amt - 1000;
      const race = await Promise.allSettled([
        adminA.adminRecordRefund(initial6.pymnt_id, { reason: "ADJUSTMENT", amount: remaining, memo: "동시 A" }, adminActor),
        adminA.adminRecordRefund(initial6.pymnt_id, { reason: "ADJUSTMENT", amount: remaining, memo: "동시 B" }, adminActor),
      ]);
      assert.equal(race.filter((r) => r.status === "fulfilled").length, 1, "동시 환불은 하나만 성공 (FOR UPDATE)");
      const finalOrig = (await prisma.tbBlPayment.findUniqueOrThrow({ where: { pymnt_id: initial6.pymnt_id } }));
      assert.equal(finalOrig.pymnt_sttus_code, "REFUNDED");
      const refundSum = await adminQ.refundedAmountByOriginal([initial6.pymnt_id]);
      assert.equal(refundSum.get(initial6.pymnt_id), initial6.amt, "누적 환불 = 원 금액, 초과 없음");
      assert.equal(await prisma.tbSysAdminAudit.count({ where: { action_type: "BILLING_REFUND_RECORD", target_id: initial6.pymnt_id } }), 2, "성공한 환불 2건만 감사");

      // 결제 진행 중 경합 — Mock 청구를 1.5초 지연시키고 그 사이 연기·종료 → 409, 청구 결과는 정상 반영
      process.env.MOCK_CHARGE_DELAY_MS = "1500";
      const dueAt = new Date(new Date((await sub.findSubscription(ids.A))!.next_bill_dt!).getTime() + days(0.1));
      const renewalP = daily.processSubscriptionDaily(s6.sbscrptn_id, dueAt);
      await new Promise((r) => setTimeout(r, 300));
      await assert.rejects(adminA.adminDeferBilling(s6.sbscrptn_id, 5, adminActor, "경합", dueAt), (e: unknown) => e instanceof BillingError && e.code === "BILLING_CONCURRENT_OPERATION", "청구 중 연기 → 409");
      await assert.rejects(adminA.adminTerminate(s6.sbscrptn_id, adminActor, "경합", dueAt), (e: unknown) => e instanceof BillingError && e.code === "BILLING_CONCURRENT_OPERATION", "청구 중 종료 → 409");
      await assert.rejects(sub.cancelSubscription(actor, dueAt), (e: unknown) => e instanceof BillingError && e.code === "BILLING_CONCURRENT_OPERATION", "청구 중 회원 해지 → 409");
      assert.deepEqual(await renewalP, ["RENEWED"]);
      delete process.env.MOCK_CHARGE_DELAY_MS;
      const afterRenew = (await sub.findSubscription(ids.A))!;
      assert.equal(afterRenew.billing_op_token, null, "청구 끝나면 토큰 해제");
      assert.equal(afterRenew.sbscrptn_sttus_code, "ACTIVE");
      const s7dto = await adminA.adminDeferBilling(s6.sbscrptn_id, 3, adminActor, "경합 뒤 정상", dueAt);
      assert.ok(s7dto.nextBillAt, "청구 끝난 뒤 연기는 성공");

      // 실패 카드로 변경 → 결제일 실패 → PAST_DUE → 관리자 즉시 재결제(실패, fail_cnt 2) + 감사 "시도"→결과 갱신
      await sub.completeCardRegistration(actor, { authKey: failCard(), customerKey, purpose: "change" }, dueAt);
      const due2 = new Date(new Date(s7dto.nextBillAt!).getTime() + days(0.1));
      assert.deepEqual(await daily.processSubscriptionDaily(s6.sbscrptn_id, due2), ["RENEW_FAILED"]);
      const retry = await adminA.adminRetryCharge(s6.sbscrptn_id, adminActor, "카드 고쳤다고 함", new Date(due2.getTime() + 60_000));
      assert.ok(!retry.ok && !retry.skipped && retry.failCnt === 2);
      const retryAudit = await prisma.tbSysAdminAudit.findFirst({ where: { action_type: "BILLING_RETRY_CHARGE", target_id: s6.sbscrptn_id }, orderBy: { creat_dt: "desc" } });
      assert.ok(retryAudit?.memo?.includes("실패 fail_cnt=2"), "재결제 감사 memo 가 결과로 갱신됨");

      // 상세 조회 + 강제 종료 → CANCELED · ADMIN_TERMINATE · 잠금 · 감사
      const detail = (await adminQ.getSubscriptionDetailForAdmin(s6.sbscrptn_id))!;
      assert.equal(detail.subscription.status, "PAST_DUE");
      assert.equal(detail.usedSeats, 4);
      assert.ok(detail.payments.some((p) => p.type === "REFUND"));
      assert.ok(detail.payments.every((p) => p.type !== "REFUND" || p.refundableAmount === 0), "환불 행엔 잔액 없음");
      const ended = await adminA.adminTerminate(s6.sbscrptn_id, adminActor, "부정 사용", due2);
      assert.equal(ended.status, "CANCELED");
      assert.equal(ended.endedReason, "ADMIN_TERMINATE");
      assert.equal(await prisma.tbPjProject.count({ where: { owner_mber_id: ids.A, lock_yn: "Y" } }), 2);
      assert.equal(await prisma.tbSysAdminAudit.count({ where: { action_type: "BILLING_FORCE_TERMINATE", target_id: s6.sbscrptn_id } }), 1);
      await assert.rejects(adminA.adminTerminate(s6.sbscrptn_id, adminActor, "x", due2), (e: unknown) => e instanceof BillingError && e.code === "BILLING_INVALID_STATE");

      const payList = await adminQ.listPaymentsForAdmin({ search: "owner-", page: 1, pageSize: 200 });
      assert.ok(payList.items.some((p) => p.type === "REFUND" && p.refundReason === "ADJUSTMENT"), "A 의 운영 보정 환불 행");
      assert.equal(payList.searchTruncated, false);
      const payListW = await adminQ.listPaymentsForAdmin({ search: "wd-", page: 1, pageSize: 200 });
      assert.ok(payListW.items.some((p) => p.type === "REFUND" && p.refundReason === "WITHDRAWAL"), "W 의 청약철회 환불 행");
      assert.deepEqual(await adminQ.listAdminAlertRecipients(), [], "임시 스키마엔 SUPER_ADMIN 없음");
    }

    log("DTO — 개요·결제 내역에 빌링키 없음, 실패 이력 포함");
    const overview = await sub.getBillingOverview(ids.A);
    assert.equal(overview.provider, "MOCK");
    assert.equal(overview.subscription?.status, "CANCELED");
    assert.equal(overview.subscription?.endedReason, "ADMIN_TERMINATE");
    assert.ok(!JSON.stringify(overview).includes("mockbk_"), "빌링키 노출 없음");
    const payments = await sub.listPayments(ids.A);
    assert.ok(payments.length >= 14);
    assert.ok(payments.some((p) => p.status === "FAILED" && p.failReason?.includes("MOCK_DECLINED")));
    assert.ok(payments.every((p) => p.orderId.startsWith("SPC-")));

    console.log("\n\x1b[32m✔ 결제 2단계 스모크 전부 통과\x1b[0m — 결제 이력", payments.length, "건, 좌석 흐름·배치·잠금(권한·메서드·헬퍼)·이중결제 방지·해지 검증 완료");
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
