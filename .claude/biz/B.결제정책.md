# B. SPECODE 결제·요금제 정책 (작업 기준 문서)
> 최종 갱신: 2026-09-19 · 상태: 1단계(정책 페이지) 진행 중

이 문서는 결제 기능이 끝날 때까지 **모든 세션이 가장 먼저 읽는 단일 기준**이다.
대화에서 결정된 것은 여기에만 쓴다. 여기 없는 규칙은 결정되지 않은 것이다.

## 0. 세션 운영 규칙 (Claude 에게)

1. 결제 관련 작업을 시작하면 이 문서를 먼저 읽고, `§7 진행 상태`에서 현재 단계를 확인한다.
2. `§2 미확정 항목`이 남아 있으면 그 단계에 필요한 것만 사용자에게 한 번에 묻고, 답을 `§1`로 옮긴다.
3. 논의 중에는 적극적으로 반박한다. 사용자가 "베스트 안을 관철하라"고 명시했다 (CLAUDE.md 협업 방식 참조).
4. 구현 중에는 이 문서의 범위만 만든다. 더 나은 생각이 나면 코드를 바꾸지 말고 먼저 말한다.
5. 단계가 끝나면 `§7`에 완료 표시, 바뀐 결정은 `§1`에 반영, 마지막에 `§8 결정 이력`에 한 줄 남긴다.
6. 운영 DB 에 직접 연결되어 있다. DDL 은 항상 (a) 읽기 전용 점검 → (b) SQL 파일 작성 → (c) 사용자 확인 → (d) 적용 → (e) 읽기 전용 재검증 순서. 옛 코드와 공존해야 하는 변경은 2단계(추가 → 배포 → 잠금)로 나눈다. `git push` = 운영 배포이므로 푸시는 반드시 사용자 확인 후.
7. 관련 규칙 파일: `.claude/develop/A-NEXTJS-기술규칙.md`(특히 §9 권한 분리), `.claude/database/a.TableScript.md`(DDL 전 필독), `.claude/design/DS_*.md`(UI 전 필독).

## 1. 확정 정책

### 1-1. 배경과 목적
- SPECODE 는 원래 완전 무료 + "표준화닷컴"으로 수익화할 계획이었다. 표준화닷컴이 아직 없어 SPECODE 로 먼저 결제를 붙인다.
- 지금 단계에서 결제의 목적은 매출보다 **① 서버비 브레이크(무료 상한 근거) ② 진지한 사용자 선별 ③ 표준화닷컴에 재사용할 구독 인프라 확보**다.
- 1인 창업. 운영 부담이 늘어나는 설계는 피한다. "심플하게"가 기본값.
- 고객 99.99% 국내, 개인(카드) 결제. PG 는 토스페이먼츠 빌링키 자동결제.
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

- 코드의 플랜 코드는 `FREE / BASIC / PRO / ENTERPRISE`. 기존 `TEAM` 은 제거.
- 기존 `ai.bulkDesign`, `ai.planStudio` 의 `requiresPlan: "PRO"` 게이트는 **제거**.
- 요금제 페이지 레이아웃: FREE(왼쪽, 담담) · **BASIC(가운데, "추천" 강조)** · PRO(오른쪽, 회색, 준비중).
- PRO 칸에는 구체적 예고를 적는다("향후 확장 예정" 같은 빈말 금지): 첨부 20GB, AI 데이터 표준화 활용.

### 1-3. 소유자·결제 주체 (0단계에서 코드로 확정)
- **프로젝트 소유자는 항상 1명** = `tb_pj_project.owner_mber_id` = OWNER 역할 멤버. 결제자 = 소유자.
- 플랜·상한·좌석 판정은 **프로젝트 소유자의 플랜**으로 한다 (행위자의 플랜이 아님). 소유자가 BASIC 이면 그 프로젝트 멤버 전원이 BASIC 혜택.
- 다른 사람 프로젝트에 초대받는 것은 무제한·무료. 돈을 내는 사람은 프로젝트를 만드는 소유자 한 명.
- 프로젝트 설정의 `plan_code` 컬럼은 아무도 읽지 않음 → 결제 작업 중 **삭제** 예정. 회원 `plan_code` 가 "결제자의 플랜".

### 1-4. 좌석 (2026-09-19 1단계 시작 시 명시 확정)
- 좌석 = 결제자가 소유한 활성 프로젝트 전체에서 **중복 제거한 편집 가능 멤버 수**(OWNER/ADMIN/MEMBER). 같은 사람이 내 프로젝트 3개에 있어도 1좌석. 결제자 본인 포함.
- **VIEWER 는 좌석 미차감(무료)**. 고객사 PM·검수자가 읽기만 하는 경우가 많고, 여기에 돈을 물리면 확산이 막힌다.
- **선구매 좌석 모델**: 좌석 N개를 미리 구매, 편집 멤버 수는 항상 N 이하라는 불변식만 지킨다.
  - 좌석 추가: 즉시. 남은 일수만큼 일할 계산해 **1회 추가 결제**. (일할 = 단가 × 추가좌석 × 남은일/주기일)
  - 좌석 축소: 다음 결제일부터 적용, 환불 없음. **현재 사용 좌석보다 작게는 못 줄임.**
  - 왜 선구매인가: 결제일 직전에 멤버를 빼고 다음날 넣는 악용을 막고, 매월 청구 금액 계산을 단순하게 하기 위해.
- 매월 청구액 = 좌석 수 × 좌석 단가. 플랜 기본료 없음(고객이 계산하기 가장 쉽다).

### 1-5. 결제 주기·체험·실패
- **월 결제만.** 연간 결제 없음 (환불·중도해지 복잡도 회피).
- **별도 체험 없음.** FREE 가 체험. 카드 등록 없이 FREE 시작.
- 결제 실패: 3일 간격 3회 재시도, 그동안 정상 사용. 모두 실패 시 FREE 강등 + 이메일 안내.
- 결제 수단 변경(카드 교체) 기능 필수.

### 1-6. 강등·해지 시 데이터 (확정)
- 강등(해지 확정·결제 실패) 순간 **소유 프로젝트 전부에 잠금 플래그**. 조회·MCP 읽기는 되고 편집·생성·초대·업로드만 막힘.
- 프로젝트 목록에서 잠긴 프로젝트에 자물쇠 배지 + **"활성화" 버튼**. 멤버 5명 이하면 그 프로젝트만 해제, 아니면 "멤버를 5명 이하로 줄이세요" 안내. 프로젝트가 1개뿐이고 5명 이하면 자동 해제.
- FREE 상한 규칙은 한 줄: **"멤버 5명 이하인 프로젝트만 활성"**. "기존 멤버 유지" 예외 없음(한 달 결제 후 50명 넣고 해지하는 악용 차단).
- **삭제는 절대 없음.** 재결제하면 전부 즉시 해제.
- 기존 사용자(결제 도입 전부터 FREE 인데 프로젝트 3개·멤버 8명 등): **기존 것은 그대로, 새로 늘리는 것만 막음.** 잠금은 강등 이벤트에서만 걸리므로 자연히 이렇게 동작하지만 정책으로 명시.
- 소유권 이전: **항상 허용.** 새 소유자가 상한을 넘으면 잠긴 상태로 넘어가고, 결제하거나 다른 프로젝트를 정리하면 풀림. 탈퇴 흐름(양도 후 탈퇴)이 막히지 않아야 하기 때문.
- 프로젝트 복구(restore): 상한 초과 상태면 잠긴 상태로 복구.

### 1-7. 환불·해지 (확정)
- 법: 전자상거래법상 결제 후 7일 이내 청약철회 가능. 단 서비스 제공이 시작된 경우 **사전 고지 + 체험 수단 제공**을 조건으로 제한 가능. FREE 가 체험 수단.
- 정책: **7일 이내 + 유료 기능 미사용이면 전액 환불, 사용 시작했으면 환불 없음.**
- "사용 시작" 판정 = 결제 후 다음 중 하나라도 발생: ① 두 번째 프로젝트 생성 ② 6번째 이상 편집 멤버 초대 ③ 첨부파일 업로드. 셋 다 DB 로그로 확인 가능해야 한다. "로그인했으니 사용" 같은 기준은 쓰지 않는다.
- 해지: 즉시가 아니라 **기간 말 적용**. 해지 취소 가능.
- **해지 버튼은 설정 화면에 바로.** 2025-02 시행 전자상거래법 개정(다크패턴 규제): 해지가 결제만큼 쉬워야 함. 가격 인상·무료→유료 자동전환 시 30일 전 동의(현재 해당 없음, 인상 시 기억).
- 환불 실행: v1 은 토스 콘솔에서 수동. 관리자 회원 상세에 "유료 기능 사용 여부 3개 플래그"만 보여 주면 판정 가능.
- 세금계산서: v1 미지원. FAQ 에 "카드 매출전표로 대체, 필요 시 이메일 문의" 한 줄. 요청이 실제로 오면 사업자번호 입력 검토.
- 결제 전·약관·환불정책 페이지에 위 내용을 사전 고지(법적 요건).

### 1-8. 첨부파일
- FREE: 업로드 API 진입점에서 차단(플랜 코드 비교 한 줄).
- BASIC 5GB / PRO 20GB 는 페이지에 표기만. **용량 집계·초과 차단은 후속 과제**(현재 집계 코드 없음).

### 1-9. 법적·심사 요건 (토스 가맹 심사 필수)
- 통신판매업 신고번호, 사업자 정보 푸터 표기.
- 이용약관(환불 정책을 한 절로 포함), 개인정보처리방침 페이지. 환불 정책은 요금제 FAQ 에서도 요약.
- 요금제와 가격이 사이트에 실제로 보여야 심사 통과 → 정책 페이지가 결제 연동보다 먼저인 이유.
- 정기결제 사전 안내 이메일(카드사 가이드라인: 결제 7일 전 고지).

### 1-10. 기술 결정
- **구독 테이블은 상품 코드를 갖는 범용 구조.** SPECODE PRO 전용으로 짜지 않는다. 표준화닷컴 상품을 한 줄 추가하면 붙도록.
- 테이블 3개: 구독(빌링키 컬럼 포함, 결제자 1인 1카드), 결제 이력, 웹훅 이벤트(멱등성). + 프로젝트 잠금 컬럼 1개.
- 잠금 검사: `requirePermission` 진입점 한 곳에서 "잠김 + 쓰기 권한 → 403" (지원 세션 읽기전용과 같은 `isWritePermission` 재사용). 기능별 검사 금지.
- 상한 계산은 3곳만: 프로젝트 생성(+복사), 멤버 초대(+수락 시 재검사), 첨부 업로드. 일상 요청은 아무것도 세지 않는다.
- 잠금·해제 이벤트 3개: 만료/해지 배치(기존 project-hard-delete 배치 옆), 재결제 성공 훅, 소유자 "활성화" 클릭.
- 이메일 템플릿 5종: 결제 완료 영수증, 결제 예정 사전 안내, 결제 실패, 해지 확인, 강등·잠금 안내. 기존 인증 메일 인프라 재사용.
- 회원 탈퇴 시 구독 해지 + 빌링키 삭제 필수(탈퇴 API 수정). 안 하면 탈퇴자 카드에서 계속 출금.
- 첨부 업로드 버튼을 화면마다 비활성화하지 않는다. 서버 403 + 토스트 하나로 통일.
- 관리자 구독 목록 화면은 만들지 않는다(토스 대시보드로 대체). 관리자 회원 상세에 플랜·만료일·좌석 수동 변경 폼만(현재 GET 만 있고 PATCH 없음 → 신규).
- 결제 페이지 UI 는 `.claude/design/` 토큰·컴포넌트 규칙 준수. 인트로(공개) 페이지는 `src/app/intro/` 의 기존 스타일(`intro.css`)을 따른다.
- 사업자 정보·약관 시행일 등 법정 표기는 `src/app/intro/_components/siteInfo.ts` 한 곳에서 관리. 인트로 내비·푸터는 `IntroNav`/`IntroFooter` 공용 컴포넌트.

## 2. 미확정 항목 (해당 단계 시작 시 한 번에 묻기)
- [x] 좌석 단가 → 9,900원 확정 (2026-09-19). PRO 는 출시 시 14,900원 제안.
- [x] §1-4 좌석 규칙(뷰어 무료·선구매·일할 추가·축소는 다음 주기) 명시 확정 (2026-09-19).
- [x] PRO "출시 알림 받기" → **만들지 않음** (2026-09-19 사용자 결정. 만들었다가 전부 제거, 운영 테이블 DROP).
- [x] 운영 앱 배포 방식 확인됨: `git push origin main` = 배포. 배포 완료 알림은 사용자가 준다.
- [ ] **사업자 정보 임시값 교체 (결제 오픈 전 필수)** — 2026-09-19 사용자 지시로 임시값을 넣고 배포 진행. 확정된 것: 상호 `(주)바른아이오`, 대표자·개인정보보호책임자 `이강선`. **교체할 것** (`src/app/intro/_components/siteInfo.ts` 한 곳, TODO 주석 표시):
  - 전화 `000-0000-0000` → 070/안심번호 또는 대표 휴대폰
  - 사업자등록번호 `000-00-00000` → 실제 번호
  - 통신판매업신고번호 `신고 준비 중` → 관할 구청 신고 후 번호 (정부24 온라인 신청, 1~3일)
  - 주소 `서울특별시 (상세 주소 입력 예정)` → 사업장 주소
  - 문의 이메일 `contact@bareun.io` → 실제 수신 가능한 주소로 확정(없으면 메일함 개설)
- [ ] 이용약관·개인정보처리방침 시행일 (`siteInfo.ts`, 현재 2026년 10월 1일 가정). 배포일로 맞출 것.

## 3. 작업 목록 (화면 단위)

### 1단계 — 정책 페이지 (인트로, 로그인 없음)
| 화면 | 신규/수정 | 내용 |
|---|---|---|
| 요금제 `/intro/pricing` | 신규 | 3열 카드(§1-2 레이아웃) + FAQ 5개(좌석이란, 뷰어 무료, 해지·환불, 강등 시 데이터, 세금계산서) |
| 이용약관 `/intro/terms` | 신규 | 정적. 환불 정책을 한 절로 포함 |
| 개인정보처리방침 `/intro/privacy` | 신규 | 정적 |
| 인트로 메인 `src/app/intro/page.tsx` | 수정 | 상단 내비 "요금제" 링크, 푸터 사업자 정보·통신판매업 번호·약관 링크 |
| (병행) SPECODE 자체 설계 등록 | 검토 | 새 UW(결제·요금제)로 화면·영역·기능 등록. `get_design_template` 먼저 조회 |

### 2단계 — 결제 화면 (로그인 후, 설정)
| 화면 | 신규/수정 | 내용 |
|---|---|---|
| 설정 > 구독·결제 `/settings/billing` | 신규 | 현재 플랜, 좌석 수/사용 좌석, 다음 결제일·금액, 결제 수단, 결제 내역(영수증 링크). 버튼: BASIC 시작 / 좌석 추가·축소 / 결제 수단 변경 / 해지 / 해지 취소 |
| 결제 시작 | 신규 | 좌석 수 입력 → 금액 표시 → 토스 결제창 → 빌링키 등록. 성공·실패 콜백 2개 |
| 좌석 추가 모달 | 신규 | 추가 수, 일할 금액, 즉시 결제 |
| 해지 확인 모달 | 신규 | "기간 말까지 사용 가능", 한 번 확인 |
| GNB 플랜 배지 `src/components/layout/GNB.tsx` | 수정 | 클릭 → 구독 화면 |
| 회원 탈퇴 `DELETE /api/member/me` | 수정 | 구독 해지 + 빌링키 삭제 |
| DB | 신규 | 구독·결제 이력·웹훅 이벤트 테이블. 토스 웹훅 수신 API. 매일 청구·재시도·만료 배치 |
| 이메일 | 신규 | 템플릿 5종 |

#### 2단계 상세 설계 (2026-09-19 확정 — 새 세션은 이 절부터 읽고 구현)

**원칙**
- PG(토스) 실제 연동만 빼고 전부 리얼로 만든다. PG 가 뜨는 지점은 게이트웨이 인터페이스 뒤의 **Mock 구현**이 대신한다. 운영 사용자가 회사 내부 인원뿐이라 운영에서도 Mock 을 쓴다(사용자 결정). 토스 어댑터는 심사 후 파일 하나 추가로 붙인다.
- `tb_cm_member.plan_code / plan_expire_dt` 는 계속 "실효 플랜"의 미러다. 구독 서비스가 ACTIVE 면 `BASIC`/`NULL`, 해지·만료·강등 시 `FREE` 로 써 준다 → `requirePermission`·`planLimits` 는 그대로 동작. 4단계 수동 부여 API 는 활성 구독이 있으면 409.
- 환불 판정용 "유료 기능 사용 3플래그"는 컬럼으로 저장하지 않는다. 최초 결제 시각 이후의 프로젝트 생성·멤버 합류·첨부 업로드 `creat_dt` 로 계산한다(전부 로그가 있음). 관리자 회원 상세에서 계산값만 표시.

**DB (접두어 `tb_bl_`, SQL 은 `prisma/sql/`, `package.json` 스크립트, DDL 은 §0 규칙 6 절차)**
- `tb_bl_subscription` — 구독 1행 = 결제자 1인 × 상품 1개. `(mber_id, prdct_code)` UNIQUE, 상태만 바뀌고 행은 재사용.
  `sbscrptn_id` PK · `mber_id` · `prdct_code` v30 (`SPECODE_BASIC`; 표준화닷컴은 코드 추가) · `sbscrptn_sttus_code` (`ACTIVE` | `PAST_DUE` 재시도 중 | `CANCEL_SCHEDULED` 기간 말 해지 예정 | `CANCELED` | `EXPIRED` 재시도 소진 강등) · `seat_cnt` · `pending_seat_cnt` NULL(축소 예약, 다음 결제일 적용) · `unit_price` (계약 단가, 부가세 포함) · `billing_key` (암호화, `src/lib/encrypt.ts`) · `card_co_nm` · `card_no_masked` · `pg_provdr_code` (`MOCK`|`TOSS`) · `pg_customer_key` · `crrnt_perd_bgng_dt` · `crrnt_perd_end_dt` · `next_bill_dt` · `fail_cnt` · `last_fail_dt` · `cancel_reqst_dt` · `ended_dt` · `creat_dt` · `mdfcn_dt`
- `tb_bl_payment` — 결제 이력(영수증 화면·환불 판정 근거). `pymnt_id` PK · `sbscrptn_id` FK · `mber_id` · `pymnt_ty_code` (`INITIAL`|`RECURRING`|`SEAT_ADD`|`REFUND`) · `amt` · `seat_cnt` · `perd_bgng_dt`/`perd_end_dt` (이 결제가 덮는 기간; SEAT_ADD 는 남은 기간) · `pymnt_sttus_code` (`PAID`|`FAILED`|`REFUNDED`) · `pg_provdr_code` · `pg_pymnt_key` · `pg_order_id` UNIQUE (멱등) · `receipt_url` · `fail_rsn_cn` · `apprv_dt` · `creat_dt`
- `tb_bl_pg_event` — 웹훅 원문. `event_id` PK · `pg_provdr_code` · `pg_event_id` UNIQUE (멱등) · `event_ty_code` · `payload` jsonb · `prcs_sttus_code` (`RECEIVED`|`PROCESSED`|`IGNORED`|`FAILED`) · `prcs_dt` · `creat_dt`
- `tb_pj_project` + `lock_yn` char(1) NOT NULL DEFAULT 'N', `lock_dt` NULL — 잠금 플래그(정책 §1-6). fast default 라 재작성 없음.
- `tb_pj_project_settings.plan_code` **삭제** — 읽는 코드가 없음을 grep 으로 확인 → 생성·복사 라우트의 쓰기 제거 → 배포 → DROP (2단계 DDL 규칙).

**게이트웨이 인터페이스 `src/lib/billing/gateway.ts`** — 토스 빌링 API 모양에 맞춰 정의. Mock/Toss 두 구현, `PAYMENT_GATEWAY=mock|toss` 로 선택(기본 mock).
- `startCardRegistration({ customerKey, successUrl, failUrl })` → Mock: `{ mode:"redirect", url:"/billing/pg-window?..." }` · Toss: `{ mode:"sdk", clientKey, customerKey }` (토스 카드 등록은 브라우저 SDK `requestBillingAuth` 가 띄우므로 리다이렉트 URL 이 아니다 — 프론트 버튼이 mode 로 분기)
- `issueBillingKey({ authKey, customerKey })` → `{ billingKey, cardCompany, cardNumberMasked }` (Toss: `POST /v1/billing/authorizations/issue`)
- `charge({ billingKey, customerKey, amount, orderId, orderName, customerEmail })` → `{ ok:true, paymentKey, receiptUrl, approvedAt } | { ok:false, code, message }` (Toss: `POST /v1/billing/{billingKey}`)
- `cancelPayment({ paymentKey, amount, reason })` (Toss: `POST /v1/payments/{paymentKey}/cancel`) — v1 환불은 토스 콘솔 수동이지만 인터페이스는 둔다
- `parseWebhook(request)` → `PgEvent | null` (서명 검증 포함)
- 빌링키 삭제 API 는 토스에 없다 → 우리 DB 에서 NULL 처리로 끝. 인터페이스에 넣지 않는다.
- Mock: `/billing/pg-window` 페이지에 큰 글씨로 **"PG 창"**, 카드사·끝 4자리 입력(선택), 성공/실패 버튼. 성공 → `successUrl?authKey=mock_...&customerKey=...`. `charge` 는 billingKey 에 `fail` 이 포함되면 실패를 흉내(결제 실패·재시도 흐름 테스트용).

**도메인 서비스 `src/lib/billing/`** — 라우트는 얇게, 규칙은 여기에.
- `pricing.ts`: 월 청구액 = seat × unit_price · 일할 = unit_price × 추가좌석 × 남은일 ÷ 주기일(원 단위 반올림) · 다음 결제일 = 매월 같은 날, 없는 날은 그 달 말일
- `seats.ts`: 사용 좌석 = 결제자가 소유한 활성(`del_yn='N'`) 프로젝트의 OWNER/ADMIN/MEMBER ACTIVE 멤버 **distinct mber_id** 수. VIEWER 제외. 좌석 축소는 사용 좌석 미만 불가
- `subscription.ts`: `startBasic(seatCnt)` 카드 등록→빌링키→즉시 첫 결제→ACTIVE→member.plan_code=BASIC · `addSeats` 즉시 일할 결제 · `scheduleSeatReduce` pending_seat_cnt · `cancel`/`uncancel` · `changeCard` 새 빌링키로 교체 · `onChargeFailed` fail_cnt++ → PAST_DUE · 3회 소진 → `EXPIRED` + FREE + 잠금
- `lock.ts`: `lockAllOwnedProjects(mberId)` · `unlockProject(projectId)` (멤버 ≤5 조건) · `autoUnlockIfSingle(mberId)` · `applyLockOnTransferOrRestore(projectId)`
- `emails.ts`: 5종 — 결제 완료 영수증 · 결제 7일 전 예정 안내 · 결제 실패(N회차, 다음 재시도일) · 해지 확인(기간 말 날짜) · 강등·잠금 안내. 기존 `src/lib/auth.ts` 의 nodemailer 발송 함수 패턴 재사용
- 배치 `POST /api/admin/batch/run/billing-daily` — 기존 `project-hard-delete` 배치와 같은 `requireBatchAuth`(X-Cron-Secret 또는 관리자 세션) + `runJob`. 하루 1회: ① `next_bill_dt` 7일 전 안내 메일 ② 오늘 청구 ③ PAST_DUE 재시도(3일 간격) ④ 3회 소진 → 강등·잠금·메일 ⑤ CANCEL_SCHEDULED 기간 종료 → CANCELED·FREE·잠금·메일 ⑥ pending_seat_cnt 적용

**API (`/api/billing/*`, 인증 `requireAuth`, 결제자 본인만)**
`GET subscription`(현재 구독·좌석·사용 좌석·다음 결제·카드) · `POST subscription/start {seatCnt}` · `GET card/callback?authKey&customerKey`(성공) · `GET card/fail` · `POST card/change` · `PATCH seats {seatCnt}` · `POST cancel` · `DELETE cancel`(해지 취소) · `GET payments` · `POST webhook/[provider]`(인증 없음, 서명 검증) · `POST /api/projects/[id]/unlock`(소유자)

**화면**
- `/settings/billing` (설정 탭 추가, `/settings/profile` 옆): 현재 플랜 카드 · 좌석(구매/사용) · 다음 결제일·금액 · 결제 수단 · 결제 내역 표(영수증 링크). 버튼: BASIC 시작(좌석 수 입력→금액 미리보기→카드 등록) · 좌석 추가 모달(일할 금액 표시) · 좌석 축소(다음 결제일 적용 안내) · 결제 수단 변경 · 해지(설정 화면에 바로, 확인 1회) · 해지 취소
- `/billing/pg-window` Mock 전용 페이지
- GNB 플랜 배지 클릭 → `/settings/billing`. 요금제 페이지 `BILLING_OPEN` → true
- 3단계 잠금 UI 는 아래 3단계 표 그대로

**3단계 잠금 연결점**
- `requirePermission` 의 기존 한 쿼리에 `project.lock_yn` 추가 → `lock_yn='Y' && isWritePermission` → 403 `PROJECT_LOCKED` (지원 세션 읽기전용과 같은 판정 함수 재사용)
- `DELETE /api/member/me` 탈퇴 → 구독 CANCELED + billing_key NULL (안 하면 탈퇴자 카드에서 계속 출금)
- 소유권 이전·복구 → 새 소유자 플랜 기준 상한 초과면 `lock_yn='Y'`

**구현 순서(새 세션)**: DDL(SQL 작성→확인→적용) → Prisma 모델 → gateway 인터페이스+Mock → 도메인 서비스 → API → 배치 → 화면 → 이메일 → 3단계 잠금 → `plan_code` 컬럼 삭제. 각 단계 끝에 `tsc`, 마지막에 Mock 으로 전체 흐름(시작→좌석 추가→실패→재시도→강등→활성화→재결제) 수동 점검.

### 3단계 — 상한·잠금 (기존 화면 수정)
| 대상 | 수정 |
|---|---|
| 프로젝트 목록 `src/app/(main)/projects/page.tsx` | 자물쇠 배지 + "활성화" 버튼. 생성 시 상한 초과면 요금제 안내 모달 |
| 프로젝트 생성·복사 API | 소유 프로젝트 수 상한 검사 |
| 멤버 초대·수락 API | FREE 5명 / 구매 좌석 초과 검사. 뷰어 미차감 |
| 첨부 업로드 API 진입점 | FREE 차단 |
| `src/lib/requirePermission.ts` | 잠금 + 쓰기 → 403 (3줄). 플랜 판정을 소유자 기준으로 |
| `src/lib/permissions.ts` | AI PRO 게이트 제거, TEAM 제거, BASIC 추가 |
| 잠긴 프로젝트 내부 | 상단 배너 "읽기 전용 — 구독 갱신 또는 활성화" |
| 소유권 이전·복구 API | 상한 초과 시 잠금 상태로 |
| 프로젝트 설정 `plan_code` | 컬럼 삭제 (2단계 DDL) |

### 4단계 — 관리자
| 화면 | 신규/수정 | 내용 |
|---|---|---|
| 회원 상세 `src/app/(main)/admin/users/[mberId]/page.tsx` | 수정 | 플랜·만료일·좌석 수동 변경 폼 + "유료 기능 사용 여부 3플래그". API PATCH 신규 (ENTERPRISE·PRO 얼리 부여용) |

### 추천 착수 순서
1단계 전체 → 3단계의 생성·초대 상한만 먼저(결제 없이 FREE 브레이크) → 4단계 관리자 수동 부여(결제 없이 얼리 고객 BASIC 부여 가능) → 2단계 결제 → 3단계 잠금.

## 4. 기존 코드 사실 (2026-09-19 조사)
- 회원 `plan_code`/`plan_expire_dt` + `resolveEffectivePlan()` 은 `src/lib/permissions.ts` 에 이미 있음. 만료 시 FREE 취급.
- `requirePermission` 은 한 쿼리로 멤버십+회원 플랜+프로젝트 `del_yn` 을 가져오고, `isWritePermission()`(".read" 만 읽기) 으로 지원 세션 읽기전용을 구현 → 잠금에 그대로 재사용.
- 프로젝트 soft delete(`del_yn`, `hard_del_dt`, 보관 14일, `project-hard-delete` 배치)와 공통 로직 `src/lib/projectLifecycle.ts` 존재.
- 관리자 회원 API 는 플랜 GET 만 있음. PATCH 없음.
- 인트로 사이트 `src/app/intro/` (page, about, intro.css). 요금제 페이지 없음.
- 첨부 업로드 라우트: 요구사항·영역·기능 `files/route.ts` 3곳 + 관리자 docs + 프로필 이미지.
- 운영 DB(Supabase) 에 프로젝트 10개(삭제예정 1). 마이그레이션 방식: `prisma/sql/YYYY-MM-DD_*.sql` + `package.json` 의 `db:migrate:*` 스크립트로 `prisma db execute`.
- MCP 에 멤버 역할 변경·프로젝트 생성 도구 없음 → 0단계 MCP 수정 불필요. 결제 API 도 MCP 노출 대상 아님.

## 5. 0단계 선행 정리 — 완료 (2026-09-19)
- `tb_pj_project.owner_mber_id` 도입(NOT NULL, 인덱스). 1단계 SQL → 배포 → step2 SQL 순으로 운영 적용.
- OWNER 단일화: 역할 API의 OWNER 지정 = 양도(대상 OWNER, 요청자 ADMIN, 소유자 컬럼 갱신). 소유자 강등 거부. 복수 OWNER·마지막 OWNER 보호 로직 제거. 멤버 화면에 양도 확인 다이얼로그.
- `transfer-and-leave` 가 소유자 컬럼도 갱신. 본인 양도 차단.
- 회원 탈퇴 시 소유 프로젝트: CASCADE 물리 삭제 → 보관 삭제(`softDeleteProject`). 탈퇴자 멤버십도 REMOVED.
- 해소된 기존 버그: 양도 후 나간 원 생성자가 탈퇴하면 `creat_mber_id` 기준으로 남의 프로젝트가 지워지던 문제.
- 커밋: `e8d77f9`, `34e6bba`(스키마 NOT NULL 확정), `c6ec673`, `b493874` — 2026-09-19 모두 푸시·배포 완료.

## 6. 하지 않기로 한 것
- 좌석 없는 정액제 (제안했으나 사용자가 인원당 과금 선택).
- 4티어(TEAM) 유지, 연간 결제, 별도 체험 기간, 세금계산서 자동 발행, 관리자 구독 목록 화면, 첨부 버튼 화면별 비활성화, 첨부 용량 실시간 집계(후속).
- PRO "출시 알림 받기" 이메일 수집 (만들었다가 2026-09-19 제거 — 수요 측정보다 단순함 우선).
- 강등 시 "최근 프로젝트 1개 자동 유지" (누구를 남길지 시스템이 고를 수 없음 → 소유자가 "활성화"로 선택).
- 강등 시 "기존 멤버 유지" 예외 (악용 경로).

## 7. 진행 상태
- [x] 정책 논의 (2026-09-19)
- [x] 0단계 선행 정리 — 코드·운영 DB 적용·푸시(배포) 완료 (2026-09-19)
- [x] 1단계 정책 페이지 — 코드 완료(2026-09-19). 사업자 정보는 임시값으로 배포(§2 교체 목록 참조). 푸시는 사용자 확인 후
- [ ] 3단계(부분) 생성·초대 상한 — 코드 작성 완료(2026-09-19). `src/lib/planLimits.ts`(소유 프로젝트 1개·멤버 5명·첨부 차단, 소유자 플랜 기준, SUPER_ADMIN 제외) + 생성·복사·초대·수락·첨부 3곳 진입점 + `PlanLimitDialog`. permissions: TEAM 제거·BASIC 추가·AI PRO 게이트 제거. 운영 현황: 회원 11명 전부 FREE, 소유 2개↑ 3명(기존 유지, 추가만 차단), 멤버 6명↑ 프로젝트 0. 남은 것: 커밋·푸시
- [x] 4단계 관리자 수동 부여 — 코드 완료·로컬 커밋(2026-09-19). `PATCH /api/admin/users/[id]/plan` + 회원 상세 "플랜 변경" 모달 + 감사 `USER_PLAN_CHANGE`. 좌석 입력·사용 플래그 표시는 2단계에서 구독 데이터가 생기면 같은 모달에 추가
- [ ] 2단계 결제 연동 — 다음 작업. §3 "2단계 상세 설계" 확정됨. PG 는 Mock, 토스 어댑터는 심사 후
- [ ] 3단계 잠금 — 2단계와 같은 흐름에서 이어서
- [ ] 푸시(배포) — 로컬 커밋 3개(1단계·3단계 상한·4단계) 대기. 사용자 확인 후
- [ ] 토스 가맹 심사 신청 — 사업자 정보 실제 값 교체 후 (§2)
- [ ] 후속: 첨부 용량 집계, PRO 출시, 세금계산서

## 8. 결정 이력 (한 줄씩, 최신이 아래)
- 2026-09-19 결제 도입 결정. 순서 = 정책 확정 → 정책 페이지 → 결제 연동.
- 2026-09-19 AI 기능 전 티어 무료. 3티어(FREE/BASIC/PRO). 인원당 과금. PRO 는 준비중 회색 칸.
- 2026-09-19 강등 = 전체 잠금 + 소유자가 활성화 선택. 환불 = 7일·미사용 3기준. 세금계산서 v1 미지원.
- 2026-09-19 OWNER 단일화·소유자 컬럼·탈퇴 보관삭제를 0단계로 먼저 처리 (기존 버그 포함).
- 2026-09-19 1단계 착수. 좌석 단가 9,900원, 좌석 규칙 4개 확정. 0단계 커밋 3개 푸시.
- 2026-09-19 PRO 출시 알림 기능 폐기(사용자). 폼·API·테이블 전부 제거. PRO 칸은 회색 안내만.
- 2026-09-19 3단계(부분) FREE 상한 구현. 초대 시 PENDING 은 세지 않고 수락 시 재검사. 시스템 관리자는 상한 제외.
- 2026-09-19 사업자 정보는 임시값으로 두고 진행(사용자). 상호 (주)바른아이오, 대표 이강선 확정. 나머지는 §2 교체 목록.
- 2026-09-19 심사 제외 전부 리얼로 만들기로 결정(사용자). PG 지점만 Mock("PG 창"), 운영에서도 Mock 사용 허용(내부 사용자만). 4단계 완료. 2단계 상세 설계 §3 에 확정.
