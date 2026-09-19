# B. SPECODE 결제·요금제 정책 (작업 기준 문서)
> 최종 갱신: 2026-09-20 · 상태: **결제 기능 운영 배포 완료 (Mock PG, 내부 사용자용)**. 다음 단계 = 운영 env·cron → 사업자 정보 실제값 → 토스 가맹 심사 → 토스 어댑터

이 문서는 결제 기능이 끝날 때까지 **모든 세션이 가장 먼저 읽는 단일 기준**이다.
대화에서 결정된 것은 여기에만 쓴다. 여기 없는 규칙은 결정되지 않은 것이다.
본문(§1~§7)은 **지금 운영에 배포된 상태**를 적는다. 과거에 어땠는지는 §8 결정 이력에만 남긴다.

## 0. 세션 운영 규칙 (Claude 에게)

1. 결제 관련 작업을 시작하면 이 문서를 먼저 읽고, `§7 남은 작업`에서 다음 할 일을 확인한다.
2. `§2 사용자 입력 대기`가 남아 있으면 그 작업에 필요한 것만 한 번에 묻는다.
3. 논의 중에는 적극적으로 반박한다. 사용자가 "베스트 안을 관철하라"고 명시했다 (CLAUDE.md 협업 방식 참조).
4. 구현 중에는 이 문서의 범위만 만든다. 더 나은 생각이 나면 코드를 바꾸지 말고 먼저 말한다. 설계와 다르게 구현할 필요가 생기면 코드보다 먼저 이 문서 §1·§8 에 적고 보고한다.
5. 작업이 끝나면 `§7`에 반영, 바뀐 규칙은 `§1` 본문을 고치고(주석 덧붙이기 금지), `§8 결정 이력`에 한 줄 남긴다.
6. 운영 DB 에 직접 연결되어 있다. DDL 은 항상 (a) 읽기 전용 점검 → (b) SQL 파일 작성 → (c) 사용자 확인 → (d) 적용 → (e) 읽기 전용 재검증 순서. 옛 코드와 공존해야 하는 변경은 2단계(추가 → 배포 → 잠금)로 나눈다. `git push` = 운영 배포이므로 푸시는 반드시 사용자 확인 후. 배포 완료는 `https://www.specode.co.kr` 을 직접 확인한다(`.env.local` 의 APP_URL 은 localhost).
7. 검증은 운영 데이터를 건드리지 않고 임시 스키마에서 한다: `npm run test:billing:db`. 스키마 변경 뒤에는 `prisma migrate diff --from-url <운영> --to-schema-datamodel` 로 drift 를 확인한다.
8. 관련 규칙 파일: `.claude/develop/A-NEXTJS-기술규칙.md`(특히 §9 권한 분리), `.claude/database/a.TableScript.md §10`(결제 테이블), `.claude/design/DS_*.md`(UI 전 필독).

## 1. 확정 정책 (운영 반영 상태)

### 1-1. 배경과 목적
- SPECODE 는 원래 완전 무료 + "표준화닷컴"으로 수익화할 계획이었다. 표준화닷컴이 아직 없어 SPECODE 로 먼저 결제를 붙였다.
- 결제의 목적은 매출보다 **① 서버비 브레이크(무료 상한 근거) ② 진지한 사용자 선별 ③ 표준화닷컴에 재사용할 구독 인프라 확보**다.
- 1인 창업. 운영 부담이 늘어나는 설계는 피한다. "심플하게"가 기본값.
- 고객 99.99% 국내, 개인(카드) 결제. PG 는 토스페이먼츠 빌링키 자동결제 예정. **현재는 Mock PG** — 운영 사용자가 회사 내부 인원뿐이라 실제 결제 없이 전 흐름을 운영에서 쓴다.
- AI 호출 비용은 고객이 자기 API 키로 낸다. SPECODE 는 토큰 비용이 없다 → **AI 기능은 전 티어 무료**.

### 1-2. 티어

| | FREE | BASIC | PRO (준비중) |
|---|---|---|---|
| 가격 | 0원 | 좌석당 월 9,900원 (부가세 포함 표시, 공급가 9,000원) | 미표시 (출시 시 14,900원 제안) |
| 소유 프로젝트 | 1개 | 무제한 | 무제한 |
| 멤버 | 프로젝트당 5명 (소유자·뷰어 포함) | 좌석 수만큼, 뷰어 무료 | 좌석 수만큼, 뷰어 무료 |
| 첨부파일 | 업로드 차단 | 5GB (표기만, 집계는 후속) | 20GB |
| AI·MCP·설계·발행 등 기능 | 전부 | 전부 | 전부 + "AI 데이터 표준화 활용" 예고 |
| 결제 | 없음 | 가능 | **불가 — 회색 칸, 버튼 없음 ("가격은 출시 시 공개")** |
| ENTERPRISE | 페이지에 "문의" 한 줄. 결제 없음. 관리자가 수동 부여 | | |

- 플랜 코드 `FREE / BASIC / PRO / ENTERPRISE` (`src/lib/permissions.ts PLAN_CODES`). 옛 `TEAM` 은 제거됨(DB 에 남은 값은 FREE 취급).
- `ai.bulkDesign`, `ai.planStudio` 의 PRO 게이트는 제거됨. `requiresPlan` 을 쓰는 권한은 현재 없다.
- 요금제 페이지 `/intro/pricing`: FREE(왼쪽) · **BASIC(가운데, 추천)** · PRO(오른쪽, 회색). BASIC 버튼은 `/settings/billing` 으로 연결(`siteInfo.BILLING_OPEN=true`; PG 장애 등으로 결제를 잠시 닫을 땐 false).
- 가격·상한 숫자는 `src/app/intro/_components/siteInfo.ts PRICING` 한 곳. 결제 도메인(`src/lib/billing/constants.ts`)도 이 상수를 읽는다 — 페이지와 청구액이 어긋날 수 없다.

### 1-3. 소유자·결제 주체
- **프로젝트 소유자는 항상 1명** = `tb_pj_project.owner_mber_id` = OWNER 역할 멤버. 결제자 = 소유자.
- 플랜·상한·좌석 판정은 **프로젝트 소유자의 플랜**으로 한다 (행위자의 플랜이 아님).
- 다른 사람 프로젝트에 초대받는 것은 무제한·무료. 돈을 내는 사람은 프로젝트를 만드는 소유자 한 명.
- 플랜은 회원(`tb_cm_member.plan_code / plan_expire_dt`)에만 있다. 프로젝트 설정의 `plan_code` 컬럼은 2026-09-20 삭제됨.
- 회원 `plan_code` 는 **실효 플랜의 미러**다. 구독이 살아 있으면(ACTIVE/PAST_DUE/CANCEL_SCHEDULED) 구독 서비스가 `BASIC`/NULL 로, 종료·강등 시 `FREE`/NULL 로 써 준다. 살아 있는 구독이 있는 회원은 관리자 수동 플랜 변경이 409 로 거부된다(구독이 원천). 구독 없는 유료 플랜(관리자 수동 부여 BASIC/PRO/ENTERPRISE)은 좌석 상한 없이 무제한.

### 1-4. 좌석
- 좌석 = 결제자가 소유한 활성(`del_yn='N'`) 프로젝트 전체에서 **중복 제거한 편집 가능 멤버 수**(OWNER/ADMIN/MEMBER, ACTIVE). 같은 사람이 내 프로젝트 3개에 있어도 1좌석. 결제자 본인 포함.
- **VIEWER 는 좌석 미차감(무료), 인원 제한 없음.** 고객사 PM·검수자가 읽기만 하는 경우가 많고, 여기에 돈을 물리면 확산이 막힌다. "뷰어도 다 본다"는 문제는 요금이 아니라 권한(`content.export` 뷰어 제외 등)으로 다룬다. 뷰어 유료화는 2026-09-20 반려됨.
- **선구매 좌석 모델**: 좌석 N개를 미리 구매, 편집 멤버 수 ≤ N 불변식만 지킨다. 불변식을 지키는 검사 지점은 **편집 멤버가 되는 모든 경로** 3곳 — 멤버 초대(이메일로 기존 좌석 보유자·중복 제외), 초대 수락(재검사), **뷰어 → MEMBER/ADMIN 승격**. 뷰어로 내리는 변경은 검사 없음. 초과 시 403 `PLAN_LIMIT_SEAT` + 구독 화면 안내.
  - 좌석 추가: 즉시. 남은 일수 일할로 **1회 추가 결제**(일할 = 단가 × 추가좌석 × 남은일 ÷ 주기일, 원 단위 반올림, 남은일은 주기일을 넘지 않음). ACTIVE 상태에서만 — PAST_DUE 는 결제 수단부터, CANCEL_SCHEDULED 는 해지 취소부터. 추가 결제가 성공하면 기존 축소 예약은 취소된다.
  - 좌석 축소: 다음 결제일부터 적용, 환불 없음. **현재 사용 좌석보다 작게는 못 줄임.** 예약 중에는 **예약값이 초대·승격 상한**이다(다음 결제일에 좌석이 줄 때 불변식이 깨지지 않도록). 현재 좌석 수를 그대로 입력하면 예약 취소.
  - 왜 선구매인가: 결제일 직전에 멤버를 빼고 다음날 넣는 악용을 막고, 매월 청구 금액 계산을 단순하게 하기 위해.
- 매월 청구액 = 좌석 수 × 좌석 단가. 플랜 기본료 없음. 단가는 구독 시작 시점 판매가로 계약되어 행에 저장된다(가격 인상 시 기존 구독 유지, 재구독 시 새 판매가).
- 좌석 입력 범위 1~500 (`SEAT_INPUT_LIMITS`). 그 이상은 ENTERPRISE 문의.

### 1-5. 결제 주기·체험·실패
- **월 결제만.** 연간 결제 없음. **별도 체험 없음.** FREE 가 체험. 카드 등록 없이 FREE 시작.
- 첫 결제는 카드 등록 직후 즉시(한 달치). 다음 결제일 = **매월 같은 날(KST)**, 없는 날은 그 달 말일. 기준일(anchor)은 마지막 구독 시작 결제(INITIAL)의 KST 일자 — 31일 시작이면 2/28 → 3/31 로 복귀, 드리프트 없음. 새 주기는 이전 주기 종료 시각부터 이어진다(재시도로 늦어도 연속).
- 결제 7일 전 사전 안내 메일 1회(카드사 가이드라인). 주기당 1회만 — `prentc_dt` 로 중복 방지.
- 결제 실패: 첫 실패 시 `PAST_DUE`, **3일 간격 3회 재시도**(총 4회 시도), 그동안 정상 사용(플랜 유지·잠금 없음). 실패마다 메일(N회차·다음 재시도일). 재시도 소진 → `EXPIRED` + FREE 강등 + 잠금 + 메일.
- 결제 수단 변경(카드 교체) 기능 있음. PAST_DUE 중에 카드를 바꾸면 **즉시 재결제**를 시도한다(3일을 기다리게 하지 않음). 성공 시 ACTIVE 복귀.
- 첫 결제(INITIAL)가 거절되면 구독 행을 만들지 않고 실패 이력만 남긴다(402). 다시 시작하면 된다.

### 1-6. 강등·해지 시 데이터
- 강등(해지 확정·결제 실패 소진) 순간 **소유 프로젝트 전부에 잠금 플래그**(`tb_pj_project.lock_yn='Y'`). 조회·MCP 읽기는 되고 쓰기 권한만 403 `PROJECT_LOCKED`. 잠금은 `requirePermission` 한 곳에서 판정하며 시스템 관리자도 예외가 아니다(잠금은 권한이 아니라 소유자 플랜 상태).
- 잠금 중에도 허용하는 쓰기 4개: `member.remove` · `member.changeRole` · `project.delete` · `project.transfer` — "멤버를 줄이세요" 안내를 실제로 수행할 수 있어야 한다. 그 외 편집·생성·초대·업로드·설정은 전부 막힘.
- 화면: 프로젝트 목록에 🔒 배지 + 소유자에게 **"활성화"** 버튼. 잠긴 프로젝트 안에는 상단 "읽기 전용" 배너(소유자에겐 활성화·구독 갱신 링크, 멤버에겐 소유자 문의 안내).
- "상한 초과" 판정은 한 함수(`lock.isProjectOverPlanLimit`)로 통일: FREE 소유자 → 그 프로젝트 활성 멤버 > 5(소유자·뷰어 포함) / 구독 좌석 소유자 → 소유 프로젝트 전체 사용 좌석 > 좌석 상한 / 그 외(수동 부여) → 초과 없음. FREE 의 "소유 프로젝트 1개" 상한은 잠금 판정에 넣지 않는다 — 기존 것은 그대로, 새로 늘리는 것만 막는다.
- 해제 3경로: **재결제 성공 → 전부 즉시 해제** / 소유자 "활성화" → 상한 이하인 그 프로젝트만 해제(초과면 403 + 무엇을 줄여야 하는지 안내) / 강등 직후 소유 프로젝트가 1개뿐이고 상한 이하면 **자동 해제**.
- FREE 상한 규칙은 한 줄: **"멤버 5명 이하인 프로젝트만 활성"**. "기존 멤버 유지" 예외 없음(한 달 결제 후 50명 넣고 해지하는 악용 차단).
- **삭제는 절대 없음.**
- 기존 사용자(결제 도입 전부터 FREE 인데 프로젝트 3개·멤버 8명 등): **기존 것은 그대로, 새로 늘리는 것만 막음.** 잠금은 강등 이벤트에서만 걸린다.
- 소유권 이전: **항상 허용.** 이전 직후 새 소유자 기준으로 상한 판정 → 초과면 잠긴 채 넘어가고(결제하거나 정리하면 풀림), 이하면 잠금이 있었어도 풀린다. 탈퇴 흐름(양도 후 탈퇴)이 막히지 않아야 하기 때문.
- 프로젝트 복구(restore): 멤버를 되살린 뒤 같은 판정 → 상한 초과면 잠긴 상태로 복구.
- 회원 탈퇴: 살아 있는 구독을 CANCELED 로 닫고 빌링키를 지운다(안 하면 탈퇴자 카드에서 계속 출금). 프로젝트는 탈퇴 라우트가 보관 삭제하므로 잠그지 않는다.

### 1-7. 환불·해지
- 법: 전자상거래법상 결제 후 7일 이내 청약철회 가능. 단 서비스 제공이 시작된 경우 **사전 고지 + 체험 수단 제공**을 조건으로 제한 가능. FREE 가 체험 수단.
- 정책: **7일 이내 + 유료 기능 미사용이면 전액 환불, 사용 시작했으면 환불 없음.**
- "사용 시작" 판정 = 최초 결제 시각(마지막 INITIAL PAID 의 승인 시각) 이후 다음 중 하나라도 발생: ① 결제 후 프로젝트를 만들어 소유 프로젝트 2개 이상 ② 결제 후 합류한 편집 멤버로 어떤 프로젝트든 편집 멤버 6명 이상 ③ 소유 프로젝트에 첨부파일 업로드. 컬럼에 저장하지 않고 `creat_dt`·`join_dt` 로 매번 계산(`src/lib/billing/paidUsage.ts`). 관리자 회원 상세 "구독·결제" 섹션에 3플래그 표시.
- 해지: ACTIVE 에서는 **기간 말 적용**(`CANCEL_SCHEDULED` → 기간 종료 시 배치가 `CANCELED`·FREE·잠금·메일). 그 전까지 **해지 취소** 가능. **PAST_DUE 에서 해지하면 즉시 종료** — 결제 실패로 새 기간을 결제하지 못해 남은 유료 기간이 없기 때문.
- **해지 버튼은 설정 화면(`/settings/billing`)에 바로, 확인 1회.** 2025-02 시행 전자상거래법 개정(다크패턴 규제). 가격 인상·무료→유료 자동전환 시 30일 전 동의(현재 해당 없음, 인상 시 기억).
- 환불 실행: v1 은 PG 콘솔에서 수동. 게이트웨이에 `cancelPayment` 인터페이스는 두었다.
- 세금계산서: v1 미지원. FAQ 에 "카드 매출전표로 대체, 필요 시 이메일 문의". 요청이 실제로 오면 사업자번호 입력 검토.
- 결제 전(요금제 페이지 "알아두실 점"·FAQ)·약관(제12조 환불)·개인정보처리방침에 위 내용 사전 고지.

### 1-8. 첨부파일
- FREE: 업로드 API 진입점에서 차단(`checkUploadAllowed`, 영역·기능 files 라우트). 화면마다 버튼을 비활성화하지 않는다 — 서버 403 + 토스트 하나로 통일.
- BASIC 5GB / PRO 20GB 는 페이지에 표기만. **용량 집계·초과 차단은 후속 과제**.

### 1-9. 법적·심사 요건 (토스 가맹 심사 필수)
- 통신판매업 신고번호, 사업자 정보 푸터 표기 — `siteInfo.ts BUSINESS` 한 곳. **현재 일부 임시값**(§2).
- 이용약관(환불 정책 한 절 포함) `/intro/terms`, 개인정보처리방침 `/intro/privacy`. 환불 정책은 요금제 FAQ 에서도 요약.
- 요금제와 가격이 사이트에 실제로 보여야 심사 통과 → `/intro/pricing` 배포됨.
- 정기결제 사전 안내 이메일(결제 7일 전) 구현됨.

### 1-10. 구현 구조 (기술 결정의 현재 형태)
- 결제 도메인은 `src/lib/billing/` 한 폴더. 라우트는 얇게, 규칙은 여기에.

  | 파일 | 역할 |
  |---|---|
  | `constants.ts` | 상품 카탈로그(`PRODUCTS`: 코드 → 플랜·단가, 표준화닷컴은 한 줄 추가), 구독·결제 상태 코드, 재시도 정책, 에러 코드, 경로 |
  | `pricing.ts` | 월 청구액·일할·KST 월 연산(anchor)·날짜 표기. 순수 함수 |
  | `gateway.ts` / `gateway-mock.ts` / `mock-auth-key.ts` | PG 인터페이스(토스 빌링 API 모양)·구현 선택(`PAYMENT_GATEWAY`)·회원별 고정 customerKey(해시)·Mock 구현·Mock authKey 인코딩(브라우저 공용) |
  | `seats.ts` | 사용 좌석(distinct 편집 멤버)·기존 좌석 보유자 판정·좌석 상한(예약값 반영) |
  | `lock.ts` | 일괄 잠금/해제·상한 초과 판정·소유자 활성화·자동 해제·이전/복구 판정 |
  | `subscription.ts` | 조회 DTO(빌링키 미노출)·카드 등록 시작/완료·구독 활성화·좌석 변경·해지/취소·정기 결제·종료(강등)·탈퇴 |
  | `daily.ts` | 일일 배치 본체 — 구독 1건씩 ① 해지 확정 ② 청구 ③ 재시도 ④ 사전 안내. `now` 주입 가능(스모크) |
  | `emails.ts` | 메일 5종(영수증·사전 안내·실패·해지 확인·강등). SMTP 없으면 콘솔. 실패해도 흐름을 되돌리지 않음 |
  | `paidUsage.ts` | 환불 판정 3플래그 계산 |
  | `actor.ts` | 결제 API 호출자 — **로그인 세션만**(MCP 키 거부), ACTIVE 회원, 이메일 필수 |
  | `errors.ts` | `BillingError(code, message, status)` → 라우트가 `apiError` 로 변환 |

- **테이블 3개 + 컬럼 2개** (`tb_bl_subscription`·`tb_bl_payment`·`tb_bl_pg_event`, `tb_pj_project.lock_yn/lock_dt`). 상세는 `.claude/database/a.TableScript.md §10`. 구독은 (결제자, 상품) UNIQUE 1행을 재사용, 빌링키는 `src/lib/encrypt.ts` AES 암호화, 종료 시 NULL.
- **카드 등록 콜백은 앱 화면이 받는다.** PG 는 브라우저를 `/settings/billing/callback` 으로 되돌리고, 그 화면이 `POST /api/billing/card/callback` 을 호출한다. 이 앱의 인증이 Bearer 헤더라 리다이렉트(GET)에 실리지 않기 때문. successUrl 에 `purpose(start|change)`·`seatCnt` 를 실어 두고 서버가 customerKey 대조·좌석 재검증한다.
- 잠금 검사는 `requirePermission` 한 곳(멤버십 쿼리에 `lock_yn` 포함). 기능별 검사 금지. 잠금 해제 API(`POST /api/projects/[id]/unlock`)는 이 게이트를 타지 않고 `owner_mber_id` 만 직접 확인한다(잠긴 상태에서 쓰기 게이트는 통과 불가).
- 상한 계산 지점: 프로젝트 생성·복사(소유 수) / 초대·수락·승격(FREE 5명 또는 구독 좌석) / 첨부 업로드(FREE 차단). 일상 요청은 아무것도 세지 않는다.
- 배치는 기존 `requireBatchAuth`(X-Cron-Secret 또는 SUPER_ADMIN 세션) + `runJob` 패턴. `job_ty_code=BILLING_DAILY`. 같은 날 두 번 돌아도 상태 전이·`prentc_dt` 로 중복 청구·중복 메일 없음. PG 호출은 항목별 격리.
- 웹훅(`POST /api/billing/webhook/[provider]`)은 서명 검증 후 원문만 저장하고 `IGNORED` 처리. 청구는 동기 API 로 직접 반영하므로 v1 은 기록·대조용. Mock 은 `MOCK_WEBHOOK_SECRET` 없으면 경로 닫힘.
- 관리자 구독 목록 화면은 만들지 않는다(PG 대시보드로 대체). 관리자 회원 상세에 구독 요약·환불 3플래그 표시, 플랜 수동 변경(구독 있으면 409). 배치 화면에 `BILLING_DAILY` 수동 실행.
- UI 는 `.claude/design/` 토큰·`sp-*` 컴포넌트. 인트로 페이지는 `intro.css`. 법정 표기·가격은 `siteInfo.ts` 한 곳.

## 2. 사용자 입력 대기 (Claude 가 대신 정할 수 없는 것)
- [ ] **사업자 정보 실제값** — `src/app/intro/_components/siteInfo.ts BUSINESS` 한 곳(TODO 주석). 토스 가맹 심사·전자상거래법 표시 의무가 이 값을 본다. 확정된 것: 상호 `(주)바른아이오`, 대표자·개인정보보호책임자 `이강선`. 교체할 것:
  - 전화 `000-0000-0000` → 070/안심번호 또는 대표 휴대폰
  - 사업자등록번호 `000-00-00000` → 실제 번호
  - 통신판매업신고번호 `신고 준비 중` → 관할 구청 신고 후 번호 (정부24 온라인 신청, 1~3일)
  - 주소 `서울특별시 (상세 주소 입력 예정)` → 사업장 주소
  - 문의 이메일 `contact@bareun.io` → 실제 수신 가능한 주소로 확정(없으면 메일함 개설)
- [ ] **이용약관·개인정보처리방침 시행일** — `siteInfo.ts`, 현재 "2026년 10월 1일" 가정. 실제 오픈일로.
- [ ] **운영 환경변수 확인** (Vercel): `API_KEY_SECRET`(빌링키 암호화 키 32자 — 미설정이면 개발 기본키로 암호화됨, 운영 필수) · `BATCH_CRON_SECRET`(32자 이상) · `SMTP_HOST/PORT/USER/PASS/FROM`(메일 5종) · `PAYMENT_GATEWAY`(비우면 mock) · `MOCK_WEBHOOK_SECRET`(선택).
- [ ] **외부 cron 등록** — 하루 1회. 없으면 정기 결제·재시도·해지 확정·사전 안내가 돌지 않는다(관리자 배치 화면 수동 실행은 가능).
  ```
  POST https://www.specode.co.kr/api/admin/batch/run/billing-daily
  X-Cron-Secret: <BATCH_CRON_SECRET>
  ```
- [ ] **토스페이먼츠 가맹 심사 신청** — 위 사업자 정보 교체·배포 후. 심사 통과 시 시크릿/클라이언트 키 수령 → §7 "토스 어댑터" 착수.

## 3. 구현 현황 (2026-09-20 운영 배포 기준)

### 3-1. 화면
| 화면 | 경로 | 내용 |
|---|---|---|
| 요금제 | `/intro/pricing` | 3열 카드 + "알아두실 점" + FAQ. BASIC 버튼 → `/settings/billing` |
| 이용약관 · 개인정보처리방침 | `/intro/terms` · `/intro/privacy` | 정적. 환불 조항 포함 |
| 인트로 내비·푸터 | `IntroNav` / `IntroFooter` | 요금제 링크, 사업자 정보·통신판매업 번호·약관 링크 |
| 구독·결제 | `/settings/billing` | 현재 플랜 카드(상태 배지·좌석 구매/사용·다음 결제일·금액·결제 수단) · BASIC 시작(좌석 입력→월 청구액→카드 등록) · 좌석 추가 모달(서버 일할 미리보기→즉시 결제) · 좌석 축소 모달(예약/취소) · 결제 수단 변경 · 해지(ConfirmDialog 1회) · 해지 취소 · 잠긴 프로젝트 안내 · 결제 내역 표(영수증 링크·실패 사유) · Mock 환경 배너 |
| PG 콜백 | `/settings/billing/callback` | PG 가 되돌려 보내는 곳. `POST /api/billing/card/callback` 호출 후 결과 토스트 → 구독 화면. 실패·취소(`result=fail`) 안내 |
| Mock PG 창 | `/billing/pg-window` | 큰 글씨 "PG 창" + 실제 결제 없음 안내. 카드사·끝 4자리(선택)·"항상 실패 카드" 체크 → [등록 성공]/[실패·취소]. `?view=receipt` 모의 영수증. successUrl/failUrl 은 같은 출처만 허용 |
| GNB | 프로필 드롭다운 | 플랜 배지 클릭 → 구독 화면. "구독·결제" 메뉴 |
| 프로젝트 목록 | `/projects` | 🔒 잠김 배지, 소유자에게 "활성화" 버튼(초과 시 이유 토스트), 생성 상한 초과 시 `PlanLimitDialog` |
| 잠긴 프로젝트 내부 | `MainLayout` 배너 | "읽기 전용" + 소유자 링크(활성화·구독 갱신) |
| 관리자 회원 상세 | `/admin/users/[id]` | 플랜 변경 모달(구독 있으면 비활성·409), 구독·결제 섹션(상태·좌석·다음 결제·카드·연속 실패·종료일), 환불 판정 3플래그 |
| 관리자 배치 | `/admin/batch` | `BILLING_DAILY` 잡 필터·수동 실행 |

### 3-2. API
| 메서드·경로 | 인증 | 내용 |
|---|---|---|
| `GET /api/billing/subscription` | 세션 | 개요(플랜·구독 DTO·사용 좌석·잠긴 프로젝트 수·상품·PG 종류) |
| `POST /api/billing/subscription/start {seatCnt}` | 세션 | 카드 등록 시작 → `{mode:"redirect",url}`(Mock) / `{mode:"sdk",...}`(Toss) |
| `POST /api/billing/card/callback {authKey, customerKey, purpose, seatCnt?}` | 세션 | 빌링키 발급 → start: 첫 결제·ACTIVE / change: 카드 교체(+PAST_DUE 면 즉시 재결제) |
| `POST /api/billing/card/change` | 세션 | 카드 변경용 등록 시작 |
| `PATCH /api/billing/seats {seatCnt}` | 세션 | 크면 일할 결제 추가 / 작으면 축소 예약 / 같으면 예약 취소 |
| `GET /api/billing/seats/preview?add=N` | 세션 | 일할 금액 미리보기(서버 계산) |
| `POST /api/billing/cancel` · `DELETE /api/billing/cancel` | 세션 | 해지 예약(PAST_DUE 면 즉시 종료) · 해지 취소 |
| `GET /api/billing/payments` | 세션 | 결제 내역 최신 50건 |
| `POST /api/billing/webhook/[provider]` | 서명 | 웹훅 원문 저장(멱등) |
| `POST /api/projects/[id]/unlock` | 세션·소유자 | 활성화. 초과 시 403 `PROJECT_UNLOCK_OVER_LIMIT` |
| `POST /api/admin/batch/run/billing-daily` | cron 시크릿 또는 SUPER_ADMIN | 일일 배치 |
| `PATCH /api/admin/users/[id]/plan` | SUPER_ADMIN | 수동 플랜 변경(구독 있으면 409 `SUBSCRIPTION_ACTIVE`) |
| 기존 라우트 수정 | | 프로젝트 생성·복사(소유 상한, `plan_code` 쓰기 제거) · 초대·수락(좌석 상한) · 역할 변경(승격 좌석 상한, 양도 후 잠금 판정) · transfer-and-leave · restore(잠금 판정) · `DELETE /api/member/me`(구독 종료) · `GET /api/projects`(locked·isOwner) · `GET my-role`(isLocked) · `GET /api/admin/users/[id]`(구독·3플래그) |

결제 API 는 MCP 에 노출하지 않는다(`register-tools.ts` 변경 없음). MCP 키로 호출하면 `actor.ts` 가 403.

### 3-3. 배치·메일
- `billing-daily` 하루 1회: 살아 있는 구독마다 ① CANCEL_SCHEDULED 기간 종료 → CANCELED ② ACTIVE 결제일 → RECURRING(축소 예약 적용) ③ PAST_DUE 마지막 실패 +3일 → 재시도, 소진 → EXPIRED ④ ACTIVE 결제 7일 전 → 사전 안내. 할 일 없으면 SKIPPED. 결과는 `tb_cm_batch_job_item.meta_json.actions`.
- 메일 5종 발송 시점: 영수증(시작·정기·좌석 추가 성공 직후) · 사전 안내(배치 ④) · 실패(재시도 남았을 때) · 해지 확인(해지 예약 시) · 강등(CANCELED/EXPIRED 확정 시, 잠긴 수·자동 해제 프로젝트명 포함).

### 3-4. DB
- 적용된 SQL: `prisma/sql/2026-09-20_create_billing.sql`(테이블 3·인덱스 8·잠금 컬럼 2) → 배포 → `2026-09-20_drop_project_settings_plan_code.sql`. npm 스크립트 `db:migrate:billing`, `db:migrate:billing-drop-settings-plan`.
- 운영 DB ↔ Prisma 모델 drift: 결제 관련 없음. 기존 drift 1건(`tb_pj_project_settings.artifact_scope_code` varchar(10) vs 모델 text, 2026-09-12 부터) — 결제 무관, §7 후속.

### 3-5. 검증
- `npm run test:billing:db` — 임시 스키마(`specode_billing_test_*`)에 전체 스키마를 올려 도메인 서비스를 실제 호출, 17단계: 가격·날짜 순수 함수 → BASIC 시작(좌석 부족 거부·customerKey 불일치 403·첫 결제 거절 402·성공) → 좌석 상한(초대·이메일 중복·승격) → 좌석 추가 일할 → 축소 예약·취소 → 사전 안내 멱등 → 정기 결제(축소 적용·기간 연속) → 실패 카드 변경 → PAST_DUE → 재시도 3회 → EXPIRED·FREE·잠금 → requirePermission 읽기/쓰기/예외 → 활성화(이하/초과) → 재결제 전부 해제 → 해지 예약·취소·확정 → 자동 해제 → 이전 판정·탈퇴 → DTO 빌링키 미노출. 운영 데이터 무영향, SMTP 차단.
- `npm run typecheck`.
- 배포 확인은 운영 URL 로: `/intro/pricing` 200 + `/settings/billing` 링크 포함, `/billing/pg-window` 200, `/api/billing/subscription` 미인증 401.

## 4. 0단계 선행 정리 — 완료 (2026-09-19)
- `tb_pj_project.owner_mber_id` 도입(NOT NULL, 인덱스). 1단계 SQL → 배포 → step2 SQL 순으로 운영 적용.
- OWNER 단일화: 역할 API의 OWNER 지정 = 양도(대상 OWNER, 요청자 ADMIN, 소유자 컬럼 갱신). 소유자 강등 거부. 복수 OWNER·마지막 OWNER 보호 로직 제거. 멤버 화면에 양도 확인 다이얼로그.
- `transfer-and-leave` 가 소유자 컬럼도 갱신. 본인 양도 차단.
- 회원 탈퇴 시 소유 프로젝트: CASCADE 물리 삭제 → 보관 삭제(`softDeleteProject`). 탈퇴자 멤버십도 REMOVED.
- 해소된 기존 버그: 양도 후 나간 원 생성자가 탈퇴하면 `creat_mber_id` 기준으로 남의 프로젝트가 지워지던 문제.

## 5. 하지 않기로 한 것 (다시 제안하지 말 것)
- 좌석 없는 정액제 (제안했으나 사용자가 인원당 과금 선택).
- 뷰어 좌석 차감(뷰어 유료화) — 2026-09-20 반려. 확산이 우선.
- 4티어(TEAM) 유지, 연간 결제, 별도 체험 기간, 세금계산서 자동 발행, 관리자 구독 목록 화면, 첨부 버튼 화면별 비활성화, 첨부 용량 실시간 집계(후속).
- PRO "출시 알림 받기" 이메일 수집 (만들었다가 2026-09-19 제거 — 수요 측정보다 단순함 우선).
- 강등 시 "최근 프로젝트 1개 자동 유지" (누구를 남길지 시스템이 고를 수 없음 → 소유자가 "활성화"로 선택).
- 강등 시 "기존 멤버 유지" 예외 (악용 경로).
- 관리자 회원 상세의 "좌석 수동 변경" 폼 — 구독이 있으면 구독이 원천(409)이고 없으면 좌석 개념이 없어 만들 이유가 없음.
- 환불 판정 플래그 컬럼 저장 — 로그로 계산.

## 6. 완료 이력
- [x] 정책 논의 (2026-09-19)
- [x] 0단계 선행 정리 — 코드·운영 DB·배포 (2026-09-19)
- [x] 1단계 정책 페이지 — 요금제·약관·개인정보·공용 내비/푸터 (2026-09-19 코드, 2026-09-20 배포)
- [x] 3단계(부분) FREE 상한 — 생성·복사·초대·수락·첨부 진입점, `PlanLimitDialog`, TEAM 제거 (2026-09-19 코드, 2026-09-20 배포)
- [x] 4단계 관리자 수동 플랜 부여 — PATCH + 모달 + 감사 (2026-09-19 코드, 2026-09-20 배포)
- [x] 2단계 결제 연동(Mock PG) + 3단계 잠금 — §3 전부 (2026-09-20 코드·배포). 스모크 17단계·tsc·DDL drift 검증
- [x] 뷰어 → 편집 승격 좌석 검사 (2026-09-20)
- [x] 운영 DDL 2건 적용·재검증, 커밋 9개 푸시·배포 확인 (2026-09-20)

## 7. 남은 작업 (순서대로)

### 7-1. 지금 바로 — 운영 마무리 (사용자, 코드 변경 없음)
1. 운영 env 확인·설정 — §2 목록. 특히 `API_KEY_SECRET` 과 `BATCH_CRON_SECRET`.
2. 외부 cron 에 `billing-daily` 하루 1회 등록 — §2 curl. 첫 실행 후 `/admin/batch` 에서 `BILLING_DAILY` 잡이 SUCCESS(대상 0건이면 trgt 0) 로 남는지 확인.
3. 운영 Mock 으로 실사용 점검 — 내부 계정으로 `/settings/billing` → BASIC 시작 → PG 창 → 구독 화면 반영, 좌석 추가/축소, 해지/취소. (스모크는 서비스 계층 검증이라 화면·리다이렉트 흐름은 브라우저에서 한 번 눌러 보는 것이 남았다.)

### 7-2. 심사 전 — 사업자 정보 (사용자 입력 → Claude 반영, 코드 한 곳)
1. §2 사업자 정보 실제값·약관 시행일을 받아 `siteInfo.ts` 만 수정 → 푸시.
2. 요금제·약관·개인정보처리방침·푸터 4곳 표기 확인.
3. 토스페이먼츠 가맹 심사 신청(사용자). 심사가 보는 것: 요금제·가격 노출, 사업자 정보·통신판매업 번호, 약관(환불 조항), 개인정보처리방침 — 전부 배포되어 있음.

### 7-3. 심사 후 — 토스 어댑터 (Claude, 파일 추가 위주)
설계는 `gateway.ts` 상단 주석에 있다. 할 일:
1. `src/lib/billing/gateway-toss.ts` — `PaymentGateway` 구현: `startCardRegistration` → `{mode:"sdk", clientKey, customerKey}` · `issueBillingKey` → `POST /v1/billing/authorizations/issue` · `charge` → `POST /v1/billing/{billingKey}` · `cancelPayment` → `POST /v1/payments/{paymentKey}/cancel` · `parseWebhook` → 토스 서명 검증. env `TOSS_SECRET_KEY`, `TOSS_CLIENT_KEY`, 웹훅 시크릿. `gateway.ts` 의 `toss` 분기에서 생성.
2. `/settings/billing` 의 `goToCardRegistration` sdk 모드 — 토스 브라우저 SDK `requestBillingAuth(customerKey, successUrl, failUrl)` 호출. successUrl/failUrl 은 지금 콜백 화면 그대로(토스가 `authKey`·`customerKey` 를 붙여 돌려보냄).
3. 웹훅 이벤트 종류별 처리(필요한 것만) — 현재는 기록만. 토스 빌링 웹훅 문서 확인 후 결정.
4. **Mock → Toss 전환 절차** (중요): Mock 으로 만든 운영 구독의 빌링키는 토스에서 청구할 수 없다. 전환 시 살아 있는 Mock 구독을 어떻게 할지 결정 필요 — (권장) 내부 사용자 구독은 전환 직전 CANCELED 로 닫고 토스로 재등록. `pg_provdr_code` 로 구분 가능. 전환은 `PAYMENT_GATEWAY=toss` env 변경 + 재배포.
5. 실카드 소액 결제 → 콘솔 취소로 `cancelPayment` 까지 확인. 영수증 URL 은 토스 `receipt.url` 사용.
6. 정책 문서 §1-1 "현재는 Mock" 문구 갱신.

### 7-4. 후속 (우선순위 낮음, 각각 사용자 결정 후)
- 첨부 용량 집계·초과 차단(BASIC 5GB / PRO 20GB 표기만 있음).
- PRO 출시 — 가격·"AI 데이터 표준화 활용" 기능 정의 후. `PRODUCTS` 에 상품 추가, 요금제 카드 활성화.
- 세금계산서 — 요청이 실제로 오면 사업자번호 입력 검토.
- 표준화닷컴 상품 연결 — `PRODUCTS` 한 줄 + 플랜 미러 대상 결정.
- 기존 drift 1건 정리: `tb_pj_project_settings.artifact_scope_code` varchar(10) ↔ 모델 text (별도 DDL 또는 모델에 `@db.VarChar(10)`). 결제 무관.
- SPECODE 자체 설계 등록 — 결제·요금제를 새 UW 로 화면·영역·기능 등록(`get_design_template` 먼저 조회). 1단계 때 "검토"로 두었고 미착수.

## 8. 결정 이력 (한 줄씩, 최신이 아래)
- 2026-09-19 결제 도입 결정. 순서 = 정책 확정 → 정책 페이지 → 결제 연동.
- 2026-09-19 AI 기능 전 티어 무료. 3티어(FREE/BASIC/PRO). 인원당 과금. PRO 는 준비중 회색 칸.
- 2026-09-19 강등 = 전체 잠금 + 소유자가 활성화 선택. 환불 = 7일·미사용 3기준. 세금계산서 v1 미지원.
- 2026-09-19 OWNER 단일화·소유자 컬럼·탈퇴 보관삭제를 0단계로 먼저 처리 (기존 버그 포함).
- 2026-09-19 1단계 착수. 좌석 단가 9,900원, 좌석 규칙 4개 확정. 0단계 커밋 3개 푸시.
- 2026-09-19 PRO 출시 알림 기능 폐기(사용자). 폼·API·테이블 전부 제거. PRO 칸은 회색 안내만.
- 2026-09-19 3단계(부분) FREE 상한 구현. 초대 시 PENDING 은 세지 않고 수락 시 재검사. 시스템 관리자는 상한 제외.
- 2026-09-19 사업자 정보는 임시값으로 두고 진행(사용자). 상호 (주)바른아이오, 대표 이강선 확정. 나머지는 §2 교체 목록.
- 2026-09-19 심사 제외 전부 리얼로 만들기로 결정(사용자). PG 지점만 Mock("PG 창"), 운영에서도 Mock 사용 허용(내부 사용자만). 4단계 완료. 2단계 상세 설계 확정.
- 2026-09-20 2단계 구현 완료(Mock PG). 설계 대비 확정 차이: 콜백은 화면→POST, `prentc_dt` 컬럼, `payment.sbscrptn_id` NULL 허용, 잠금 예외 권한 4개, PAST_DUE 해지는 즉시 종료, 카드 변경 시 즉시 재결제, 축소 예약값이 초대 상한, 결제일 anchor = INITIAL 결제 KST 일자. 3단계 잠금도 함께 완료. (전부 §1 본문에 반영됨)
- 2026-09-20 역할 변경 VIEWER→MEMBER/ADMIN 도 좌석 검사(사용자 결정, `checkSeatLimit`). 뷰어 무료는 유지 — 뷰어 유료화 제안 반려.
- 2026-09-20 운영 배포(사용자 지시 "1·2·3 다 진행"): create_billing DDL → 푸시 → plan_code DROP 순서로 적용, 각 단계 읽기 전용 재검증. 결제 기능 운영 오픈(Mock PG, 내부 사용자).
- 2026-09-20 문서 현행화: 계획 문서 → 현재 상태 문서로 재구성. 설계 차이는 §1 본문에 흡수, §3 은 구현 현황, §7 은 남은 작업(운영 마무리 → 사업자 정보 → 토스 어댑터 → 후속). Mock→Toss 전환 시 Mock 구독 정리 필요를 §7-3 에 기록.
