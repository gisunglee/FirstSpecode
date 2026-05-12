/**
 * seed-docs-story.ts — Docs Hub 콘텐츠 등록 스크립트
 *
 * 역할:
 *   1) 기존 /welcome 페이지의 본문(page_cn)을 새 환영 글로 교체
 *   2) "SPECODE 이야기" 섹션(/story) 신규 생성
 *   3) 그 아래 3개 페이지(/where-we-are, /know-and-use, /promise) 신규 생성
 *
 * 멱등성:
 *   - section: sect_slug='/story' 가 있으면 재사용, 없으면 생성
 *   - page   : (sect_id, page_slug) 가 있으면 본문/제목만 갱신, 없으면 신규 생성
 *   - 그래서 여러 번 실행해도 데이터가 깨지지 않는다
 *
 * 실행:
 *   npx dotenv -e .env.local -- npx tsx scripts/seed-docs-story.ts
 */

import { prisma } from "../src/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// 본문 마크다운
// ─────────────────────────────────────────────────────────────────────────────

const welcomeMd = `# 환영합니다.

## AI와 함께, 더 단단하게.

요즘 개발 현장의 풍경은 사뭇 달라졌습니다.
AI에게 한 문장만 던지면 화면 하나가 뚝딱 만들어지고,
며칠 걸리던 기능이 몇 시간으로 줄어드는 시대입니다.

그런데 한편으로는 이런 불안이 함께 자랍니다.

> "AI에게 다 맡겨도 정말 괜찮을까?"
> "수억원짜리 프로젝트를, 잘 모르는 채로 AI에게만 시켜도 될까?"
> "납품한 코드, 우리가 끝까지 책임질 수 있을까?"

**SPECODE는 그 사이에서 출발했습니다.**

AI를 안 쓰면 뒤처지고, 다 맡기면 불안한 — 그 사이.
우리는 AI를 **부리는 쪽**에 서야 한다는 믿음으로 만들었습니다.

---

## SPECODE가 하는 일

SPECODE는 공공·SI 프로젝트의 흐름을 이렇게 바꿉니다.

**1. 요구사항부터 명확하게**
   막연한 요구를 단위업무(UW)로 잘게 쪼개고,
   화면·영역·기능까지 추적 가능한 형태로 정리합니다.

**2. 설계는 AI와 함께, 더 빠르게**
   설계 트리에서 AI 태스크를 던지면,
   화면 시안·기능 명세·DB 컬럼 매핑을 빠르게 채워줍니다.
   **단, 무엇을 시키는지 우리가 알고 있어야 합니다.**

**3. 산출물은 자동으로**
   PRD 문서, 프로그램 사양서, 엑셀 산출물, MD 통합 파일까지
   공공 프로젝트에 필요한 산출물을 버튼 한 번으로 받아갑니다.

**4. 개발은 Claude Code로**
   잘 정리된 설계는 그대로 Claude Code의 입력이 됩니다.
   막무가내 바이브코딩이 아니라, **명세 기반 AI 협업**입니다.

---

## 누구를 위한 도구인가요?

- **기획자·PM** — 요구사항부터 산출물까지, 흩어진 문서를 한 곳에서
- **개발자** — 잘 정리된 명세로 AI에게 정확하게 일을 시키고 싶은 분
- **관리자·발주처** — 진행 상황과 산출물을 한 화면에서 확인하고 싶은 분

---

## 시작해볼까요?

처음이라면 [첫 프로젝트 만들기](/docs/getting-started/first-project)부터 보세요.
SPECODE가 왜 이렇게 만들어졌는지 궁금하다면 [SPECODE 이야기](/docs/story/where-we-are)로.

> **AI에게 일을 시키는 사람으로 남기 위해 — SPECODE.**
`;

const whereWeAreMd = `# AI 시대, 우리는 어디쯤 있을까

## 두 갈래 길

AI 코딩 도구가 쏟아지면서, 개발자들은 두 갈래 길 앞에 섰습니다.

**한쪽 길**에 선 사람들은 AI를 외면합니다.
"AI가 만든 코드는 못 믿겠다", "결국 내가 다시 짜야 한다"고 말합니다.
하지만 그 사이 옆자리 동료는 같은 일을 절반의 시간에 끝냅니다.

**다른 쪽 길**에 선 사람들은 AI에게 모든 걸 맡깁니다.
프롬프트 한 줄로 화면을 만들고, 잘 모르는 코드를 그대로 납품합니다.
그러다 어느 날 — 책임질 수 없는 결함을 마주합니다.

## 우리는 어디에 서 있나요

대부분의 사람은 사실 그 가운데에 있습니다.

> "AI를 안 쓰면 손해라는 건 알겠는데,"
> "다 맡기는 건 영 불안하다."

그게 정상입니다. 특히 **공공·SI 프로젝트**에서는 더 그렇습니다.

- 수억 원의 예산
- 수백 명의 사용자
- 수년에 걸친 운영
- 그리고 끝까지 따라붙는 **책임의 무게**

이런 환경에서 "AI가 알아서 했어요"는 변명이 되지 않습니다.

## 그래서 우리는 묻게 됩니다

> AI는 어떻게 써야 할까?
> 어디까지 맡기고, 어디부터 우리가 잡아야 할까?
> 빠른 동시에, 단단한 결과를 만들 방법이 있을까?

**SPECODE는 그 질문에서 출발한 도구입니다.**

다음 페이지에서, 우리가 찾은 답을 보여드릴게요.

→ [활용하되, 알아야 합니다](/docs/story/know-and-use)
`;

const knowAndUseMd = `# 활용하되, 알아야 합니다

## AI는 도구입니다, 운전대는 우리 손에

자동차가 처음 나왔을 때, 사람들은 두려워했습니다.
지금은 누구나 운전합니다. 단, **운전법을 익힌 사람만**.

AI도 마찬가지입니다.
AI를 잘 쓰는 사람과 AI에게 끌려가는 사람은,
같은 도구를 쓰지만 완전히 다른 결과를 만들어냅니다.

## 바이브코딩의 함정

요즘 흔히 "바이브코딩(Vibe Coding)"이라 부르는 방식이 있습니다.
"이런 느낌의 화면을 만들어줘" 하고 AI에게 던지는 거죠.

가볍게 토이 프로젝트를 만들 땐 즐겁고 빠릅니다.
하지만 **수억 원짜리 프로젝트**에서는 이야기가 다릅니다.

- 요구사항이 한 줄로 끝나지 않습니다.
- 화면 하나가 수십 개의 룰과 엮여 있습니다.
- "이 기능이 왜 이렇게 동작하는가"를 끝까지 설명할 수 있어야 합니다.

설계 없이 AI에게 던지면 AI는 헤매고,
헤매는 AI가 만든 코드는 결국 **우리가 책임집니다.**

## AI에게 일을 시키려면

AI에게 일을 잘 시키려면, 우리가 먼저 알아야 합니다.

| 우리가 모르면 | 우리가 알면 |
|---|---|
| AI가 만든 결과를 검증할 수 없음 | AI 결과를 다듬어 더 좋게 만들 수 있음 |
| 잘못된 결과를 그대로 납품 | 문제를 짚어 다시 시킬 수 있음 |
| AI에게 끌려감 | AI를 부림 |

그래서 우리에게 필요한 건 **AI를 거부하는 용기**도,
**AI를 맹신하는 안일함**도 아닙니다.

**"무엇을 시킬지 명확하게 알고 있는 능력"** — 그게 핵심입니다.

## SPECODE가 하는 일

SPECODE는 그 능력을 시스템으로 만들어줍니다.

- 막연한 요구사항을 **단위업무(UW)** 로 잘게 쪼개고
- 화면·영역·기능까지 **추적 가능한 형태**로 정리하고
- AI에게 던질 **명확한 입력**을 준비합니다.

설계가 단단해지면, AI는 가장 좋은 동료가 됩니다.
우리는 AI를 **부리는 쪽**에 남을 수 있습니다.

→ [빠르고 단단한 설계, SPECODE의 약속](/docs/story/promise)
`;

const promiseMd = `# 빠르고 단단한 설계, SPECODE의 약속

## 우리가 약속드리는 세 가지

SPECODE는 화려한 도구를 약속하지 않습니다.
대신, 공공·SI 프로젝트의 현장에서 가장 필요한 세 가지를 약속합니다.

---

### 1. AI의 속도, 그대로 가져갑니다

설계 트리에서 한 번의 클릭으로 AI 태스크를 던지세요.

- 화면 시안 초안
- 기능 명세 초안
- DB 컬럼 매핑 제안
- 표준 가이드 검토 의견

**며칠 걸리던 설계 작업이 몇 시간으로 줄어듭니다.**
대신 그 시간을 "검토하고 다듬는 일"에 쓰세요.

---

### 2. 설계의 책임감, 놓치지 않습니다

SPECODE의 모든 설계는 **추적 가능한 구조**로 저장됩니다.

\`\`\`
요구사항(RQ) → 단위업무(UW) → 화면 → 영역 → 기능 → 코드
\`\`\`

어느 한 부분을 바꾸면, 어디에 영향을 주는지 한눈에 보입니다.
"이 화면이 왜 이런 동작을 하나요?"라는 질문에
**원본 요구사항까지 거슬러 올라가 답할 수 있습니다.**

이게 바이브코딩으로는 절대 만들 수 없는 가치입니다.

---

### 3. 산출물의 부담, 덜어드립니다

공공 프로젝트의 산출물 압박을 누구보다 잘 압니다.

| 산출물 | SPECODE에서 | 시간 |
|---|---|---|
| PRD 문서 | 자동 생성·다운로드 | 즉시 |
| 프로그램 사양서 | 자동 생성·다운로드 | 즉시 |
| 엑셀 산출물 | 한 번 클릭 | 즉시 |
| MD 통합 패키지 | 한 번 클릭 | 즉시 |

설계만 단단히 해두면, 산출물은 **버튼 한 번**입니다.
야근하며 워드 파일과 씨름하는 시간은 이제 그만.

---

## 우리의 입장

> AI를 거부하지 않습니다.
> AI에게 모든 걸 맡기지도 않습니다.
> 우리는 **AI를 부리는 사람**으로 남기 위해 SPECODE를 만들었습니다.

낮이든 밤이든, 빠르고 단단하게.
SPECODE가 여러분의 옆에서 함께 하겠습니다.

→ [첫 프로젝트 만들기](/docs/getting-started/first-project)부터 시작해보세요.
`;

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

// 페이지 발췌(excerpt)는 첫 본문 줄에서 너무 길지 않게 자른다
function makeExcerpt(text: string, max = 80): string {
  // 1번째 # 제목 다음 첫 의미있는 문장을 발췌로 쓴다
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (line.startsWith(">")) continue;
    const plain = line.replace(/\*\*/g, "").replace(/[#*`>]/g, "").trim();
    if (plain.length >= 10) return plain.length > max ? plain.slice(0, max) + "…" : plain;
  }
  return "";
}

async function upsertSection(args: {
  slug: string;
  name: string;
  sortOrdr: number;
  iconCode?: string | null;
}) {
  const existing = await prisma.tbSysDocsSection.findFirst({
    where: { sect_slug: args.slug, use_yn: "Y" },
  });

  if (existing) {
    console.log(`  · section 재사용: ${args.name} (${args.slug})`);
    return existing;
  }

  const created = await prisma.tbSysDocsSection.create({
    data: {
      sect_slug:      args.slug,
      sect_nm:        args.name,
      sect_icon_code: args.iconCode ?? null,
      sort_ordr:      args.sortOrdr,
      use_yn:         "Y",
    },
  });
  console.log(`  ✓ section 신규: ${args.name} (${args.slug})`);
  return created;
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
        badge_code:      args.badgeCode ?? existing.badge_code,
        sort_ordr:       args.sortOrdr,
        mdfcn_dt:        new Date(),
      },
    });
    console.log(`     · page 갱신: ${args.title} (/${args.slug})`);
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
  console.log("\n[1] 시작하기 > 환영합니다 본문 교체");
  const gettingStarted = await prisma.tbSysDocsSection.findFirst({
    where: { sect_slug: "getting-started", use_yn: "Y" },
  });
  if (!gettingStarted) {
    throw new Error("/getting-started 섹션을 찾지 못했습니다. 기존 데이터 확인 필요.");
  }
  await upsertPage({
    sectId:    gettingStarted.sect_id,
    slug:      "welcome",
    title:     "환영합니다",
    body:      welcomeMd,
    sortOrdr:  10,
    badgeCode: "NEW",
  });

  console.log("\n[2] SPECODE 이야기 섹션 + 3개 페이지 등록");
  const story = await upsertSection({
    slug:     "story",
    name:     "SPECODE 이야기",
    sortOrdr: 15, // 시작하기(10) ~ AI사용법(20) 사이
    iconCode: "sparkles",
  });

  await upsertPage({
    sectId:   story.sect_id,
    slug:     "where-we-are",
    title:    "AI 시대, 우리는 어디쯤 있을까",
    body:     whereWeAreMd,
    sortOrdr: 10,
  });

  await upsertPage({
    sectId:   story.sect_id,
    slug:     "know-and-use",
    title:    "활용하되, 알아야 합니다",
    body:     knowAndUseMd,
    sortOrdr: 20,
  });

  await upsertPage({
    sectId:   story.sect_id,
    slug:     "promise",
    title:    "빠르고 단단한 설계, SPECODE의 약속",
    body:     promiseMd,
    sortOrdr: 30,
  });

  console.log("\n완료.");
}

main()
  .catch((e) => {
    console.error("실패:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
