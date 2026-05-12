/**
 * seed-docs-concepts.ts — "개념 익히기" 섹션 4개 페이지 등록
 *
 * 처리:
 *   1) /core-concepts 섹션의 이름을 "개념 익히기"로 변경 (슬러그 유지)
 *   2) /unit-work          — 본문 갱신 + PUBLISHED
 *   3) /screen-area-function — 본문 갱신 + DRAFT → PUBLISHED
 *   4) /traceability       — 신규 생성
 *   5) /deliverables       — 신규 생성
 *
 * 멱등성:
 *   - 모두 (sect_id, page_slug) 기준 upsert
 *   - 여러 번 실행해도 안전
 *
 * 실행:
 *   npx dotenv -e .env.local -- npx tsx scripts/seed-docs-concepts.ts
 */

import { prisma } from "../src/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// 본문
// ─────────────────────────────────────────────────────────────────────────────

const unitWorkMd = `# 단위업무란?

## 가장 작은 "업무의 단위"

SPECODE에서 가장 먼저 만나는 개념이 **단위업무(UW, Unit Work)** 입니다.
이름 그대로, **한 사람이 한 흐름으로 끝낼 수 있는 가장 작은 업무 묶음**을 뜻합니다.

예를 들어 이런 것들이 각각 하나의 단위업무입니다.

- 이메일로 회원가입하기
- 비밀번호 재설정하기
- 멤버 초대하기
- 단위업무 CRUD 관리하기
- 화면 설계하기

## 왜 단위업무가 필요한가요

기획자가 "회원 시스템을 만들어주세요"라고 말하면 너무 막연합니다.
개발자도, AI도, 이 한 문장으로는 작업을 시작할 수 없습니다.

그래서 우리는 **잘게 쪼개야 합니다.**

\`\`\`
회원 시스템
 ├ UW-00001  이메일 회원가입
 ├ UW-00002  이메일/비밀번호 로그인
 ├ UW-00003  소셜 로그인
 ├ UW-00004  JWT 인증 처리
 ├ UW-00005  비밀번호 재설정
 ├ UW-00006  회원 프로필 관리
 └ UW-00007  회원 탈퇴
\`\`\`

이렇게 쪼개면 각 단위업무마다 **누가, 언제, 무엇을 만들지** 분명해집니다.
견적도, 일정도, 진행 상황도 모두 단위업무 단위로 관리됩니다.

## 단위업무는 무엇을 가지고 있나요

하나의 단위업무는 단순한 제목이 아닙니다.
그 안에 **개발에 필요한 모든 정보**가 묶여 있습니다.

| 단위업무가 가진 것 | 설명 |
|---|---|
| **요구사항(RQ)** | 이 업무가 어떤 요구에서 출발했는가 |
| **화면(PID)** | 이 업무를 위해 만들어야 할 화면 목록 |
| **영역** | 각 화면 안의 영역 (검색·목록·상세 등) |
| **기능** | 각 영역에서 동작하는 기능 (조회·저장·삭제 등) |
| **참조 테이블** | 사용하는 DB 테이블 |
| **API** | 호출되는 API 명세 |

이 정보가 모이면 **AI에게 정확하게 일을 시킬 수 있는 명세서**가 완성됩니다.

## 번호 체계 — UW-XXXXX

SPECODE의 모든 단위업무는 **UW-00001 형태의 고유 번호**를 가집니다.

- 한 번 부여된 번호는 절대 바뀌지 않습니다.
- 화면·영역·기능·코드까지 이 번호로 연결됩니다.
- "이 코드가 어디서 왔는가?"를 끝까지 추적할 수 있습니다.

## 실전 예시

UW-00014 "과업 CRUD"를 살펴볼까요?

\`\`\`
[UW-00014] 과업 CRUD
 ├ 화면: [PID-00028] 과업 목록
 │       [PID-00029] 과업 상세
 ├ 영역: 검색 영역, 목록 영역, 상세 영역
 ├ 기능: 목록 조회, 등록, 수정, 삭제
 └ 테이블: tb_pj_task
\`\`\`

이 단위업무 하나의 정보만 있어도, AI에게:
> "UW-00014 단위업무를 구현해줘. 명세는 다음과 같아: …"

라고 정확히 요청할 수 있습니다.

---

→ 다음은 [화면·영역·기능 구조](/docs/core-concepts/screen-area-function)를 보세요.
`;

const structureMd = `# 화면·영역·기능 구조

## 3계층으로 나누어 생각하기

SPECODE는 모든 설계를 **3계층**으로 나눕니다.

\`\`\`
화면 (PID)
 └ 영역
    └ 기능
\`\`\`

왜 굳이 3개로 나누는 걸까요?
하나로 뭉뚱그려서 "화면 만들어줘"라고 하면 안 될까요?

## 왜 나누는가

**잘게 나눌수록 AI에게 정확하게 시킬 수 있기 때문입니다.**

"회원 목록 화면 만들어줘"라는 한 문장과,
아래처럼 쪼개진 명세 중 — AI가 더 잘 만들 수 있는 건 무엇일까요?

\`\`\`
화면: 회원 목록 (PID-00022)
 ├ 영역: 검색 영역
 │   └ 기능: 이름·이메일·상태로 검색
 ├ 영역: 그리드 영역
 │   ├ 기능: 회원 목록 조회 (페이지네이션)
 │   └ 기능: 행 더블클릭 → 상세 이동
 └ 영역: 액션 영역
     ├ 기능: 신규 등록 버튼
     └ 기능: 선택 삭제 (ConfirmDialog 필수)
\`\`\`

답은 명확합니다. **잘게 쪼개진 쪽**입니다.
이 명세만 있으면 AI도, 사람도 헷갈리지 않고 같은 결과를 만들 수 있습니다.

## 각 계층의 정의

### ① 화면 (Screen, PID)

사용자가 브라우저에서 보는 **하나의 페이지**입니다.

- URL이 하나 부여됩니다 (예: \`/members\`)
- 고유 번호 PID-XXXXX 를 가집니다
- 보통 하나의 단위업무는 1~3개의 화면을 가집니다

### ② 영역 (Area)

화면 안의 **논리적인 묶음**입니다.

- 화면을 시각적·기능적으로 구분짓는 부분
- 예: 검색 영역, 목록 영역, 상세 영역, 액션 영역
- 한 화면은 보통 2~5개의 영역으로 구성됩니다

### ③ 기능 (Function)

영역 안에서 실제로 **동작하는 단위**입니다.

- "사용자가 클릭하면" 또는 "데이터가 바뀌면" 일어나는 일
- 예: 조회, 저장, 삭제, 검색, 페이지 이동
- 영역 하나에 보통 1~10개의 기능이 들어갑니다

## 한 장으로 보기

\`\`\`
[화면: 회원 목록 PID-00022]
 ┌──────────────────────────────┐
 │ [영역: 검색]                  │
 │  └ 기능: 이름으로 검색          │
 │  └ 기능: 상태 필터              │
 ├──────────────────────────────┤
 │ [영역: 목록 그리드]            │
 │  └ 기능: 목록 조회 (API GET)    │
 │  └ 기능: 더블클릭 → 상세         │
 ├──────────────────────────────┤
 │ [영역: 액션 버튼]              │
 │  └ 기능: 신규 등록             │
 │  └ 기능: 선택 삭제              │
 └──────────────────────────────┘
\`\`\`

## 이 구조가 AI에게 주는 선물

이렇게 나뉜 설계가 있으면, AI는 정확히 무엇을 만들어야 할지 압니다.

- **화면 단위**로 → Next.js 페이지 파일을 만듭니다.
- **영역 단위**로 → 컴포넌트를 분리합니다.
- **기능 단위**로 → 함수와 API 호출을 작성합니다.

설계 깊이가 그대로 코드 구조가 됩니다.
나중에 유지보수할 때도 어디를 고쳐야 할지 한눈에 보입니다.

---

→ 다음은 [요구사항 추적성](/docs/core-concepts/traceability)을 보세요.
`;

const traceabilityMd = `# 요구사항 추적성

## "이 기능, 왜 이렇게 만들었어요?"

공공·SI 프로젝트에서 가장 자주 듣는 질문입니다.
때로는 발주처에서, 때로는 감리에서, 때로는 6개월 뒤의 우리 자신이 묻습니다.

이 질문에 **자신 있게 답할 수 있어야** 진짜 설계입니다.
"AI가 만들어줬어요"는 답이 되지 않습니다.

## 추적의 사슬

SPECODE는 모든 요소를 하나의 사슬로 묶어둡니다.

\`\`\`
요구사항(RQ)
   ↓
단위업무(UW)
   ↓
화면(PID) → 영역 → 기능
   ↓
코드
\`\`\`

이 사슬의 어느 지점에서든, **위로도 아래로도 따라갈 수 있습니다.**

## 위로 따라가기 — "왜?"에 답하기

코드 한 줄에서 출발해 거슬러 올라갈 수 있습니다.

\`\`\`
src/app/members/page.tsx (코드)
   ↑
PID-00022 회원 목록 (화면)
   ↑
UW-00010 역할 관리 (단위업무)
   ↑
RQ-00010 멤버의 역할을 관리할 수 있어야 함 (요구사항)
\`\`\`

"이 코드는 왜 이렇게 동작하나요?" → **RQ-00010 때문입니다.**
명확한 답이 나옵니다.

## 아래로 따라가기 — "영향 범위" 파악

요구사항이 바뀌면, **어디를 손봐야 하는지** 즉시 보입니다.

\`\`\`
RQ-00010 요구사항 변경
   ↓ 영향
UW-00010
   ↓
PID-00022 회원 목록
   ↓
src/app/members/page.tsx
src/app/api/members/route.ts
\`\`\`

"이 요구사항 바꾸면 어디까지 영향이 가나요?" → **이 사슬을 보여드리면 됩니다.**

## 추적성이 만드는 가치

| 추적성이 없을 때 | 추적성이 있을 때 |
|---|---|
| 변경 영향도 파악에 며칠 | 즉시 확인 |
| 감리 질문에 진땀 | 사슬 한 장으로 끝 |
| 6개월 뒤엔 본인도 모름 | 누가 봐도 명확 |
| 인수인계 = 재학습 | 인수인계 = 사슬 공유 |

## SPECODE에서 어떻게 보이나요

설계 트리에서 어떤 항목을 클릭하면, 그와 연결된 모든 항목이 함께 표시됩니다.

- 단위업무를 클릭하면 → 연결된 요구사항·화면·영역·기능이 한눈에
- 화면을 클릭하면 → 상위 단위업무, 하위 영역·기능이 한눈에
- 요구사항을 클릭하면 → 영향받는 모든 단위업무가 한눈에

추적은 **숨겨진 기능**이 아니라, **기본 동작**입니다.

## 한 번 더 — 우리의 입장

> "코드가 어떻게 동작하는지"는 누구나 압니다.
> "왜 그렇게 동작해야 하는지"를 답할 수 있는 사람은 드뭅니다.
>
> 추적성은 그 "왜"에 답하는 능력입니다.
> 그리고 그게 바이브코딩으로는 절대 만들 수 없는 가치입니다.

---

→ 다음은 [산출물의 종류](/docs/core-concepts/deliverables)를 보세요.
`;

const deliverablesMd = `# 산출물의 종류

## 공공 프로젝트의 산출물 압박

공공·SI 프로젝트를 한 번이라도 해본 분이라면 압니다.

- 요구사항 정의서
- 화면 설계서
- 프로그램 사양서
- ERD·테이블 정의서
- 메뉴 구조도
- 사용자 매뉴얼
- 운영자 매뉴얼
- 인수인계서
- …

**개발 시간보다 산출물 작성 시간이 더 길 때**가 있습니다.
야근의 절반은 워드 파일과의 사투입니다.

SPECODE는 그 부담을 정면으로 해결합니다.

> **"설계만 단단히 해두면, 산출물은 버튼 한 번이다."**

## SPECODE가 제공하는 산출물

### ① PRD 문서 (단위업무별)

각 단위업무마다 PRD(Product Requirements Document)가 자동 생성됩니다.

- 단위업무 개요
- 화면 목록 및 시안 설명
- 영역·기능 명세
- API 명세
- 참조 테이블
- 표준 가이드 검토 의견

**용도:** 개발자에게 명확한 명세를 전달, AI(Claude Code)에게 입력으로 사용

\`\`\`
다운로드 경로: 단위업무 상세 → "PRD 다운로드"
파일 형태   : Markdown (.md)
\`\`\`

### ② 프로그램 사양서

전통적인 형태의 프로그램 사양서를 자동 생성합니다.

- 화면별 사양 (입력·출력·검증 규칙)
- 처리 로직 흐름
- 예외 처리
- DB 접근

**용도:** 공공 프로젝트 감리·납품용 공식 문서

\`\`\`
다운로드 경로: 화면 상세 → "프로그램 사양서"
파일 형태   : Word (.docx) / PDF
\`\`\`

### ③ 엑셀 산출물

엑셀로 한 번에 묶어 받을 수 있는 통합 산출물입니다.

- 요구사항 목록
- 단위업무 목록
- 화면 목록
- 영역·기능 매트릭스
- 테이블 정의서

**용도:** 발주처 보고, 엑셀 기반 검토 회의

\`\`\`
다운로드 경로: 프로젝트 상단 → "엑셀 다운로드"
파일 형태   : Excel (.xlsx) — 시트별 분리
\`\`\`

### ④ MD 통합 패키지

설계 트리 전체를 마크다운 파일 묶음으로 받습니다.

- 단위업무별 PRD
- 화면별 명세
- 표준 가이드
- 폴더 구조 그대로

**용도:** Git 리포지토리에 commit, Claude Code 입력, 인수인계 자료

\`\`\`
다운로드 경로: 프로젝트 상단 → "MD 다운로드"
파일 형태   : ZIP (markdown files)
\`\`\`

## 산출물이 자동으로 만들어지는 이유

비결은 단순합니다.

**SPECODE는 설계 자체를 산출물 친화적인 구조로 저장합니다.**

- 단위업무·화면·영역·기능 = 산출물의 행과 열
- 표준 가이드 = 산출물의 검토 의견
- 요구사항 ↔ 코드 연결 = 산출물의 추적성

설계할 때 정성껏 채워두면, 산출물은 그 정보를 다른 형태로 **렌더링만** 합니다.

## 한 번 더 — 약속

> 더 이상 야근하며 워드 파일을 다듬지 않아도 됩니다.
> 설계에 집중하세요. 산출물은 SPECODE가 가져옵니다.

---

→ 이제 [이렇게 쓰세요](/docs/guide/create-project)에서 실제 사용법을 익혀보세요.
`;

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function makeExcerpt(text: string, max = 80): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (line.startsWith(">")) continue;
    const plain = line.replace(/\*\*/g, "").replace(/[#*`>]/g, "").trim();
    if (plain.length >= 10) return plain.length > max ? plain.slice(0, max) + "…" : plain;
  }
  return "";
}

async function upsertPage(args: {
  sectId:    string;
  slug:      string;
  title:     string;
  body:      string;
  sortOrdr:  number;
  badgeCode?: string | null;
}) {
  const existing = await prisma.tbSysDocsPage.findFirst({
    where: { sect_id: args.sectId, page_slug: args.slug, use_yn: "Y" },
  });

  const excerpt = makeExcerpt(args.body);

  if (existing) {
    await prisma.tbSysDocsPage.update({
      where: { page_id: existing.page_id },
      data: {
        page_sj:         args.title,
        page_excerpt:    excerpt,
        page_cn:         args.body,
        page_sttus_code: "PUBLISHED",
        badge_code:      args.badgeCode ?? null,
        sort_ordr:       args.sortOrdr,
        mdfcn_dt:        new Date(),
      },
    });
    console.log(`     · page 갱신: ${args.title} (/${args.slug}) → PUBLISHED`);
    return;
  }

  await prisma.tbSysDocsPage.create({
    data: {
      sect_id:         args.sectId,
      page_slug:       args.slug,
      page_sj:         args.title,
      page_excerpt:    excerpt,
      page_cn:         args.body,
      page_sttus_code: "PUBLISHED",
      badge_code:      args.badgeCode ?? null,
      sort_ordr:       args.sortOrdr,
      use_yn:          "Y",
    },
  });
  console.log(`     ✓ page 신규: ${args.title} (/${args.slug})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // 1) 섹션 이름 변경 (슬러그는 유지 — URL 안 깨짐)
  console.log("[1] 섹션 이름 변경: '핵심 개념' → '개념 익히기'");
  const sect = await prisma.tbSysDocsSection.findFirst({
    where: { sect_slug: "core-concepts", use_yn: "Y" },
  });
  if (!sect) {
    throw new Error("/core-concepts 섹션을 찾지 못했습니다.");
  }
  if (sect.sect_nm !== "개념 익히기") {
    await prisma.tbSysDocsSection.update({
      where: { sect_id: sect.sect_id },
      data:  { sect_nm: "개념 익히기", mdfcn_dt: new Date() },
    });
    console.log("  ✓ 섹션 이름 변경 완료");
  } else {
    console.log("  · 이미 '개념 익히기' 상태");
  }

  // 2) 4개 페이지 등록/갱신
  console.log("\n[2] 4개 페이지 등록");
  await upsertPage({
    sectId:   sect.sect_id,
    slug:     "unit-work",
    title:    "단위업무란?",
    body:     unitWorkMd,
    sortOrdr: 10,
  });
  await upsertPage({
    sectId:   sect.sect_id,
    slug:     "screen-area-function",
    title:    "화면·영역·기능 구조",
    body:     structureMd,
    sortOrdr: 20,
  });
  await upsertPage({
    sectId:   sect.sect_id,
    slug:     "traceability",
    title:    "요구사항 추적성",
    body:     traceabilityMd,
    sortOrdr: 30,
  });
  await upsertPage({
    sectId:   sect.sect_id,
    slug:     "deliverables",
    title:    "산출물의 종류",
    body:     deliverablesMd,
    sortOrdr: 40,
  });

  console.log("\n완료.");
}

main()
  .catch((e) => {
    console.error("실패:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
