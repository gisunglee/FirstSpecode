"use client";

/**
 * BillingGuidePage — 결제 시스템 안내 (/admin/billing/guide, SUPER_ADMIN)
 *
 * 역할:
 *   - 결제가 "지금 어떤 모드로, 어떤 설정으로" 돌고 있는지 실시간 점검 패널 (GET /api/admin/billing/system-status)
 *   - 결제 흐름·영향 범위·일일 배치·웹훅·안전장치·운영 절차·남은 일을 운영자가 한 화면에서 읽는 설명서
 *
 * 왜 화면으로 두는가:
 *   결제는 배치·웹훅·PG 콜백처럼 사람이 안 보는 곳에서 자동으로 돈다. 운영자가 "어디가 결제에 걸려 있고, 언제 무엇이
 *   돌고, 뭐가 남았는지"를 코드나 정책 문서를 열지 않고 알 수 있어야 사고를 알아챈다.
 *   설명 텍스트는 이 파일에, 실시간 값은 system-status.ts 에 있다. 정책이 바뀌면 여기 문구도 같이 고친다(기준일 표기).
 *
 * 기준 문서: .claude/biz/B.결제정책.md (정책의 원천), 이 화면은 그 요약이다.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import type { BillingSystemStatus } from "@/lib/billing/system-status";
import { formatKstDate } from "@/lib/billing/pricing";

/** 이 안내문이 반영한 정책·코드 기준일 — 정책이 바뀌면 문구와 함께 갱신 */
const GUIDE_AS_OF = "2026-09-30";

function fmt(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${formatKstDate(d)} ${d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" })}`;
}

export default function BillingGuidePage() {
  const status = useQuery({
    queryKey: ["admin", "billing", "system-status"],
    queryFn:  () => authFetch<{ data: BillingSystemStatus }>("/api/admin/billing/system-status").then((r) => r.data),
    staleTime: 30 * 1000,
  });

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 1040 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          결제가 어떻게 돌아가는지 한 화면에 정리한 안내입니다. 아래 "지금 상태"는 실시간이고, 나머지 설명은 <b>{GUIDE_AS_OF}</b> 기준입니다.
          정책의 원천은 <code>.claude/biz/B.결제정책.md</code> 입니다.
        </div>
        <Link href="/admin/billing" className="sp-btn sp-btn-ghost sp-btn-sm">← 결제 운영 화면</Link>
      </div>

      {/* ── 1. 지금 상태 (실시간) ─────────────────────────────────────────── */}
      <Section title="1. 지금 상태 (실시간 점검)">
        {status.isLoading && <div style={{ color: "var(--color-text-tertiary)" }}>불러오는 중...</div>}
        {status.isError && <div className="sp-hint is-err">{(status.error as Error).message}</div>}
        {status.data && <StatusPanel s={status.data} />}
      </Section>

      {/* ── 2. 결제 흐름 ──────────────────────────────────────────────────── */}
      <Section title="2. 결제 흐름 — 사용자가 보는 순서">
        <Steps items={[
          ["카드 등록", "설정 > 구독·결제에서 BASIC 시작 → 좌석 수 입력 → 카드 등록창(토스 SDK, Mock 이면 앱 안 PG 창). 서버가 서명한 state 를 URL 에 실어 남이 만든 링크는 거부합니다."],
          ["첫 결제", "카드 등록이 끝나면 즉시 첫 달 금액(좌석 × 9,900원)을 청구합니다. 성공하면 구독 ACTIVE, 회원 플랜 BASIC, 잠겨 있던 프로젝트 전부 해제."],
          ["매월 정기 결제", "가입한 날짜(예: 30일 시작 → 매월 30일)에 일일 배치가 빌링키로 자동 청구합니다. 사용자는 아무것도 누르지 않습니다. 결제 7일 전 사전 안내 메일이 나갑니다."],
          ["좌석 추가", "남은 일수만큼 일할 계산해 즉시 청구. 축소는 다음 결제일부터 적용(환불 없음)."],
          ["결제 실패", "PAST_DUE 로 바뀌고 3일 간격으로 3회 재시도. 실패 메일 발송. 그동안 플랜 혜택은 유지."],
          ["강등", "재시도를 다 쓰면 EXPIRED → FREE 로 내려가고 소유 프로젝트가 읽기 전용으로 잠깁니다(혼자 쓰는 1개는 자동 해제). 재결제하면 전부 해제."],
          ["해지", "해지 예약 → 결제한 기간 끝까지 이용 → 기간 말 배치가 CANCELED 확정 → FREE·잠금. 그 전엔 취소 가능."],
          ["환불", "관리자 화면(구독 상세 > 결제 이력 > 환불)에서 PG 취소를 직접 실행. 청약철회(첫 결제 7일 이내, 계정당 1회, 전액, 구독 종료) / 운영 보정(금액 자유, 구독 유지)."],
        ]} />
      </Section>

      {/* ── 3. 영향 범위 ──────────────────────────────────────────────────── */}
      <Section title="3. 결제가 걸려 있는 곳 — 어디가 플랜을 보나">
        <Table head={["기능", "FREE 에서 막히는 조건", "어떻게 막히나"]} rows={[
          ["프로젝트 생성·복사", "열린(잠기지 않은) 소유 프로젝트가 이미 1개", "403 + 상한 다이얼로그(BASIC 시작하기 버튼)"],
          ["편집 멤버 초대·수락·뷰어→편집 승격", "편집자는 소유자 본인 1명만. 뷰어는 무제한", "403 PLAN_LIMIT_MEMBER + 필요 좌석·월 금액 안내"],
          ["잠긴 프로젝트의 모든 쓰기", "강등·해지 확정으로 lock_yn=Y", "requirePermission 이 권한 OR 메서드로 판정 → 403 PROJECT_LOCKED. 읽기는 허용"],
          ["프로젝트 '활성화' 버튼", "FREE 상한 이하일 때만", "편집자 2명 이상이면 FREE_EDITORS, 다른 열린 프로젝트가 있으면 FREE_PROJECTS 거부"],
          ["프로젝트 양도·복구", "받는 쪽 상한 판정", "같은 잠금 판정 함수 — 양도로 상한을 우회할 수 없음"],
          ["회원 탈퇴", "살아 있는 구독", "탈퇴 시 구독 CANCELED·빌링키 삭제. 확정 안 된 결제가 있으면 잠시 409"],
          ["관리자 수동 플랜 부여", "구독이 살아 있으면 불가", "409. 만료일이 지나면 일일 배치가 FREE·잠금"],
          ["MCP(API 키) 호출", "결제 API 는 노출 안 함", "MCP 키로 결제 라우트를 부르면 403. 프로젝트 쓰기는 잠금 판정 동일 적용"],
          ["GNB 플랜 배지·프로필", "표시만", "회원 plan_code 는 구독의 미러 — 구독이 원천"],
        ]} />
        <Note>좌석 = 편집 멤버(OWNER/ADMIN/MEMBER) 수를 사람 기준으로 중복 없이 센 것. 뷰어는 좌석을 쓰지 않습니다.</Note>
      </Section>

      {/* ── 4. 일일 배치 ──────────────────────────────────────────────────── */}
      <Section title="4. 일일 배치 — 하루 1회, 무엇이 자동으로 도나">
        <Table head={["순서", "하는 일", "대상"]} rows={[
          ["⑥", "10분 넘게 확정 안 된 결제 시도를 PG 주문 조회로 확정 (승인 → 반영·영수증 / 미청구 → 실패 / 불명 → 유지·알림)", "PENDING 결제"],
          ["⑦", "PG 거래 목록과 우리 이력 대사 — 승인·취소 누락, 금액 불일치를 잡아 알림 (Mock 은 건너뜀)", "마지막 완료 배치 이후(최소 25시간, 최대 31일)"],
          ["①", "해지 예약 구독의 기간이 끝났으면 CANCELED 확정 → FREE·잠금·메일", "CANCEL_SCHEDULED"],
          ["②", "결제일이 된 구독을 청구(축소 예약 적용). 실패면 PAST_DUE·실패 메일", "ACTIVE"],
          ["③", "마지막 실패 +3일이면 재시도. 3회 소진이면 EXPIRED·FREE·잠금·강등 메일", "PAST_DUE"],
          ["④", "결제 7일 전이면 사전 안내 메일(주기당 1회)", "ACTIVE"],
          ["⑤", "관리자가 수동 부여한 플랜의 만료일이 지났으면 FREE·잠금·메일", "구독 없는 유료 회원"],
        ]} />
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          <div><b>실행 방법</b> — 외부 cron 이 하루 1회 아래를 호출합니다. 관리자 &gt; 배치 화면에서 수동 실행도 됩니다.</div>
          <pre style={preStyle}>{`POST https://www.specode.co.kr/api/admin/batch/run/billing-daily
X-Cron-Secret: <BATCH_CRON_SECRET>`}</pre>
          <div><b>권장 시각</b> — 매일 오전(KST 09:00 전후). 결제일 당일 사용자가 깨어 있는 시간에 결제·메일이 나가는 편이 문의 대응에 낫습니다. 같은 날 두 번 돌아도 중복 청구·중복 메일은 나지 않습니다.</div>
          <div><b>관리자 알림 메일</b> — 배치가 실패/부분 실패이거나 강등·결제 실패·해지 확정·결과 불명·복구·대사 불일치·웹훅 실패가 하나라도 있으면 SUPER_ADMIN 전원에게 하루 1통. 정상 갱신은 알리지 않습니다.</div>
          <div><b>같은 방식으로 하나 더</b> — 접속 기록 90일 정리 <code>POST /api/admin/batch/run/access-log-cleanup</code> (개인정보처리방침 이행).</div>
        </div>
      </Section>

      {/* ── 5. 웹훅 ───────────────────────────────────────────────────────── */}
      <Section title="5. 웹훅 — 토스가 우리에게 알려 주는 것">
        <div style={{ display: "grid", gap: 8 }}>
          <div>등록 URL(토스 개발자센터 &gt; 웹훅, 테스트/라이브 각각): <code>https://www.specode.co.kr/api/billing/webhook/toss</code></div>
          <div>구독 이벤트: <b>PAYMENT_STATUS_CHANGED</b>(취소·환불 상태 변화), <b>BILLING_DELETED</b>(빌링키 삭제 통지). 그 외 종류는 저장하지 않습니다.</div>
          <div>⚠ <b>자동결제 승인은 토스가 웹훅을 보내지 않습니다.</b> 승인 반영은 우리가 청구 응답으로 직접 하고, 놓친 건 ⑥ PENDING 조회와 ⑦ 거래 대사가 잡습니다.</div>
          <div>검증: 토스 빌링 웹훅엔 서명이 없어 본문을 믿지 않고 paymentKey 로 토스에 다시 조회한 결과만 씁니다. 재전송은 transmission-id 로 멱등 처리, 일시 오류면 500 을 돌려줘 토스가 다시 보냅니다(최대 7회).</div>
          <div>콘솔에서 사람이 직접 취소한 건은 웹훅 대조가 환불 이력(운영 보정)으로 자동 기록합니다.</div>
        </div>
      </Section>

      {/* ── 6. 안전장치 ───────────────────────────────────────────────────── */}
      <Section title="6. 안전장치 — 돈이 두 번 나가거나 사라지지 않게">
        <Steps items={[
          ["PENDING 선기록", "PG 를 부르기 전에 결제 이력에 PENDING 행(주문 ID = 토스 멱등키)을 먼저 남깁니다. 결과를 못 받아도 새 주문 ID 로 다시 청구하지 않고 같은 주문 ID 로 조회해 확정합니다."],
          ["회원당 진행 중 1건", "PENDING 행의 잠금 키가 DB UNIQUE 라 같은 회원의 청구·환불이 동시에 두 개 돌 수 없습니다. 첫 결제 더블클릭도 여기서 막힙니다."],
          ["결제 작업 토큰", "청구 중(최대 5분) 해지·종료·좌석·카드 변경은 409. 토큰이 만료돼도 확정 안 된 PENDING 이 있으면 계속 409."],
          ["실패 확정 기준", "카드 거절 같은 4xx 업무 오류만 실패로 확정. 5xx·429·통신 두절·처리 중은 '결과 불명'으로 두고 조회로 확정합니다."],
          ["미반영 보호", "승인은 확인됐는데 구독이 종료됐거나 회원이 탈퇴한 경우 구독을 살리지 않고 '미반영' 표식 + 관리자 알림. 환불 여부는 사람이 판단합니다."],
          ["PG 종류 불일치", "Mock 으로 만든 구독을 토스로, 또는 그 반대로 청구하지 않습니다(전환 시 정리 필요)."],
          ["빌링키 보관", "AES-256-GCM 으로 암호화 저장, 로그·화면·API 어디에도 원문이 나가지 않습니다. 빌링키만으로는 우리 토스 시크릿 키 없이 청구할 수 없습니다."],
          ["카드 등록 위조 차단", "customerKey 는 서버 비밀 HMAC, 등록 시작 때 서명한 state(30분)를 콜백에서 검증. 회원당 카드 등록 요청 10분 10회 제한."],
        ]} />
      </Section>

      {/* ── 7. 운영 절차 ──────────────────────────────────────────────────── */}
      <Section title="7. 운영 절차 — 사람이 직접 하는 일">
        <Steps items={[
          ["환불", "관리자 &gt; 결제 &gt; 구독 상세 &gt; 결제 이력의 [환불]. 사유 필수. 청약철회는 첫 결제·7일·계정당 1회를 서버가 검사하고 구독을 즉시 종료합니다. PG 가 거절하면 아무것도 바뀌지 않습니다."],
          ["결제 실패 민원", "카드를 고쳤다는 사용자는 구독 상세의 [즉시 재결제]로 3일을 기다리지 않게 해 줍니다. 보상은 [다음 결제일 연기]로만(좌석·단가는 화면에서 못 바꿈)."],
          ["결과 불명·미반영 알림을 받았을 때", "관리자 &gt; 배치에서 해당 항목 meta 의 주문 ID 로 토스 콘솔을 대조합니다. 승인됐는데 구독이 없으면 환불 또는 수동 반영을 결정합니다."],
          ["Mock → 토스 전환(라이브 키 수령 후)", "① Vercel 에 TOSS_CLIENT_KEY·TOSS_SECRET_KEY(live) ② 살아 있는 Mock 구독을 강제 종료(토스로 청구 불가) ③ PAYMENT_GATEWAY=toss + 재배포 ④ 개발자센터에 라이브 웹훅 URL 등록 ⑤ 실카드 소액 결제 → 관리자 화면 환불로 왕복 확인 ⑥ siteInfo.BILLING_OPEN 을 true 로."],
          ["키 유출 의심", "토스 개발자센터에서 시크릿 키 즉시 재발급 → Vercel env 교체 → 재배포. API_KEY_SECRET 은 바꾸면 기존 빌링키를 못 풀므로 바꾸지 않습니다(재암호화 절차가 먼저)."],
        ]} />
      </Section>

      {/* ── 8. 남은 일 ────────────────────────────────────────────────────── */}
      <Section title={`8. 남은 일 (${GUIDE_AS_OF} 기준)`}>
        <Table head={["할 일", "누가", "왜"]} rows={[
          ["운영에 남은 테스트 TOSS 구독 1건 강제 종료", "운영자", "로컬 브라우저 테스트가 운영 DB 에 남긴 행. 개발 키로 암호화돼 있어 운영에서 청구 불가"],
          ["외부 cron 2개 등록 (billing-daily, access-log-cleanup)", "운영자", "등록 전엔 정기 결제·재시도·강등·대사가 전혀 돌지 않음. 위 '지금 상태'의 cron 표시가 초록이면 완료"],
          ["개발 DB 분리 (Supabase 프로젝트 하나 더)", "운영자", "지금은 로컬 개발 서버가 운영 DB 를 씀 → 테스트 결제가 운영 장부에 섞임"],
          ["결제 전용 암호화 키(BILLING_KEY_SECRET) 분리 결정", "운영자", "AI API 키와 같은 시크릿을 쓰는 중. 결제 행이 거의 없는 지금이 가장 쌈"],
          ["브라우저 왕복 재검증 (카드 등록 → 결제 → 관리자 환불)", "운영자", "CSRF state·환불 실행 반영 후 실제 토스 창으로 한 번"],
          ["사업자 정보 확정: 전화번호, 통신판매업 신고번호", "운영자", "전자상거래법 필수 표기 + 토스 가맹 심사"],
          ["토스 전자결제 신청 + 자동결제(빌링) 별도 신청", "운영자", "빌링은 추가 리스크 검토 후 계약. 신청서에 정기결제 명시. 카드사 심사 약 2주"],
          ["라이브 키 수령 후 Mock → 토스 전환", "운영자 + Claude", "7번 절차"],
          ["첨부 용량 집계·초과 차단, PRO 요금제, 세금계산서", "후속", "정책 문서 §7-4"],
        ]} />
      </Section>

      {/* ── 9. 위치 ───────────────────────────────────────────────────────── */}
      <Section title="9. 어디를 보면 되나">
        <Table head={["무엇", "위치"]} rows={[
          ["정책·결정 이력·남은 일(원천)", ".claude/biz/B.결제정책.md"],
          ["구독·좌석·청구·복구 로직", "src/lib/billing/subscription.ts"],
          ["일일 배치", "src/lib/billing/daily.ts, src/app/api/admin/batch/run/billing-daily/route.ts"],
          ["PG 어댑터 (Mock / 토스)", "src/lib/billing/gateway-mock.ts, gateway-toss.ts"],
          ["웹훅 처리·거래 대사", "src/lib/billing/webhook.ts, reconcile.ts"],
          ["관리자 운영 액션(환불·연기·종료·재결제)", "src/lib/billing/admin-actions.ts"],
          ["검증 스크립트", "npm run test:billing:db (전체 흐름, 임시 스키마) · npm run test:billing:toss (토스 테스트 API)"],
          ["운영 화면", "관리자 > 결제(요약·구독·이력), 관리자 > 배치(실행 기록·수동 실행), 관리자 > 감사 로그(결제 액션)"],
        ]} />
      </Section>
    </div>
  );
}

// ─── 상태 패널 ───────────────────────────────────────────────────────────────

function StatusPanel({ s }: { s: BillingSystemStatus }) {
  const cronTone = s.batch.cronHealthy ? "success" : s.batch.lastCron ? "warning" : "error";
  const problems = s.counts.stalePendingCharges + s.counts.webhookFailed24h + s.counts.paidUnapplied;
  const missingRequired = s.env.filter((e) => e.required && !e.set);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <Stat label="결제 모드" value={s.provider === "MOCK" ? "Mock (가짜 결제)" : `토스 ${s.tossTestMode ? "테스트 키" : "라이브 키"}`}
              badge={s.provider === "MOCK" ? { text: "실제 결제 없음", tone: "warning" } : s.tossTestMode ? { text: "돈 안 나감", tone: "info" } : { text: "실결제", tone: "success" }}
              hint={`NODE_ENV=${s.nodeEnv} · 요금제 버튼 ${s.billingOpen ? "열림" : "닫힘(BILLING_OPEN=false)"}`} />
        <Stat label="살아 있는 구독" value={String(s.counts.liveSubscriptions)}
              hint={Object.entries(s.counts.liveByProvider).map(([k, v]) => `${k} ${v}`).join(" · ") || "없음"}
              badge={s.provider !== "MOCK" && (s.counts.liveByProvider["MOCK"] ?? 0) > 0 ? { text: "Mock 구독 정리 필요", tone: "error" } : undefined} />
        <Stat label="외부 cron" value={s.batch.cronHealthy ? "정상" : s.batch.lastCron ? "26시간 넘게 안 옴" : "실행 기록 없음"}
              badge={{ text: s.batch.lastCron ? `마지막 ${fmt(s.batch.lastCron.startedAt)}` : "등록 필요", tone: cronTone }}
              hint="하루 1회 billing-daily 를 X-Cron-Secret 으로 호출해야 정기 결제가 돕니다" />
        <Stat label="마지막 배치" value={s.batch.lastAny ? `${s.batch.lastAny.status} (${s.batch.lastAny.trigger === "CRON" ? "cron" : "수동"})` : "없음"}
              hint={s.batch.lastAny ? `${fmt(s.batch.lastAny.startedAt)} · 대상 ${s.batch.lastAny.targetCnt} / 처리 ${s.batch.lastAny.successCnt} / 실패 ${s.batch.lastAny.failCnt} / 건너뜀 ${s.batch.lastAny.skipCnt}` : "관리자 > 배치에서 수동 실행 가능"} />
        <Stat label="확인 필요" value={String(problems)}
              badge={problems > 0 ? { text: "조치 필요", tone: "error" } : { text: "이상 없음", tone: "success" }}
              hint={`미확정 결제(10분+) ${s.counts.stalePendingCharges} · 웹훅 실패(24h) ${s.counts.webhookFailed24h} · 승인됐는데 미반영 ${s.counts.paidUnapplied}`} />
        <Stat label="환경변수" value={missingRequired.length === 0 ? "필수 전부 설정됨" : `필수 ${missingRequired.length}개 누락`}
              badge={missingRequired.length === 0 ? { text: "OK", tone: "success" } : { text: missingRequired.map((e) => e.name).join(", "), tone: "error" }}
              hint="값은 표시하지 않습니다 — 설정 여부만" />
      </div>

      <Table head={["환경변수", "상태", "설명"]} rows={s.env.map((e) => [
        <code key={e.name}>{e.name}</code>,
        <span key={e.name + "-b"} className={`sp-badge ${e.set ? "sp-badge-success" : e.required ? "sp-badge-error" : "sp-badge-neutral"}`}>
          {e.set ? "설정됨" : e.required ? "누락 (필수)" : "비어 있음 (선택)"}
        </span>,
        e.note,
      ])} />
      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>점검 시각 {fmt(s.checkedAt)} · 이 패널은 서버가 보는 값입니다(로컬에서 열면 로컬 env).</div>
    </div>
  );
}

// ─── 공용 조각 ───────────────────────────────────────────────────────────────

const preStyle: React.CSSProperties = {
  margin: 0, padding: "10px 12px", background: "var(--color-bg-input)", border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-sm)", fontSize: "var(--text-xs)", color: "var(--color-text-primary)", overflowX: "auto",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="sp-group">
      <div className="sp-group-header"><div className="sp-group-title">{title}</div></div>
      <div className="sp-group-body" style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

function Stat({ label, value, hint, badge }: { label: string; value: string; hint?: string; badge?: { text: string; tone: "success" | "warning" | "error" | "info" } }) {
  return (
    <div style={{ padding: 14, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)" }}>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-text-heading)", lineHeight: 1.3 }}>{value}</div>
      {badge && <div style={{ marginTop: 6 }}><span className={`sp-badge sp-badge-${badge.tone}`}>{badge.text}</span></div>}
      {hint && <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

function Steps({ items }: { items: Array<[string, string]> }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 12, padding: "6px 0", borderTop: "1px solid var(--color-border-subtle)" }}>
          <div style={{ fontWeight: 600, color: "var(--color-text-heading)" }}>{k}</div>
          <div style={{ color: "var(--color-text-secondary)" }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: Array<Array<React.ReactNode>> }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-tertiary)", fontWeight: 600, fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border-subtle)", verticalAlign: "top", color: j === 0 ? "var(--color-text-heading)" : "var(--color-text-secondary)" }}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 10, fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>{children}</div>;
}
