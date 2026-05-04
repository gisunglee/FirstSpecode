# SPECODE — Java 개발자를 위한 Next.js/React/TypeScript 교재

> 대상: Java/SpringBoot/MyBatis 20년차 → Next.js 16 + React 19 + TypeScript 6 + Prisma
> 목적: 비교 학습으로 빠르게 실전 투입.
> 분량: 9개 챕터, 한 챕터당 30분 ~ 1시간.

---

## 학습 순서

| 순서 | 챕터 | 핵심 내용 |
|---|---|---|
| 1 | [00. 시작하기 — 마인드셋 전환](./00_시작하기_마인드셋전환.md) | Java vs JS/TS 의 결정적 차이 5가지 |
| 2 | [01. TypeScript 기본](./01_TypeScript_기본.md) | 변수, 타입, 함수, async/await, 모듈 |
| 3 | [02. React 기본](./02_React_기본.md) | 컴포넌트, JSX, props, state, hook |
| 4 | [03. Next.js App Router](./03_NextJS_AppRouter.md) | 파일 = URL, page.tsx, route.ts, 레이아웃 |
| 5 | [04. TanStack Query — 데이터 페칭](./04_TanStackQuery_데이터페칭.md) | useQuery, useMutation, invalidateQueries |
| 6 | [05. 상태 관리](./05_상태관리.md) | useState / Zustand / TanStack Query / URL |
| 7 | [06. Prisma ORM](./06_Prisma_ORM.md) | MyBatis 비교, 트랜잭션, JOIN, 동적 쿼리 |
| 8 | [07. 우리 프로젝트 구조 분석](./07_프로젝트구조_분석.md) | src/ 폴더 한 줄씩, 의존성 흐름 |
| 9 | [08. 실전 코드 읽기 가이드](./08_실전_코드읽기_가이드.md) | 새 파일 30초 파악법, 트레이싱 |
| 부록 | [09. 디자인 시스템 (sp-* / 토큰)](./09_부록_디자인시스템.md) | UI 작업의 절대 규칙 |

---

## 빠른 참조 — Java ↔ Next.js 매핑

| Java/Spring | Next.js (우리 프로젝트) |
|---|---|
| `@RestController` 클래스 | `src/app/api/.../route.ts` 의 `export GET/POST/...` 함수 |
| JSP / Thymeleaf | `src/app/.../page.tsx` (React 컴포넌트) |
| `@PathVariable` | 폴더명 `[id]` + `await params` |
| `@RequestParam` | `useSearchParams()` (Suspense 안에서) |
| MyBatis Mapper.xml | Prisma (`prisma.tbXxx.findMany(...)`) |
| `@Transactional` | `prisma.$transaction(async (tx) => {...})` |
| `@Autowired` | `import` 문 |
| `@Cacheable` | `useQuery({ queryKey, queryFn })` |
| `@CacheEvict` | `queryClient.invalidateQueries({ queryKey })` |
| `@PreAuthorize` | `requireAuth(request)` / `requirePermission(...)` |
| `HttpSession` | Zustand + sessionStorage/localStorage |
| `RestTemplate` | `authFetch()` (우리 프로젝트 래퍼) |
| `@Service` | `src/lib/*.ts` 의 export 함수 |
| `application.yml` | `.env.local` + `next.config.ts` |

---

## 핵심 함정 5가지 (사고 방지용)

1. **`"use client"` 는 첫 줄에.** 주석 다음에 오면 인식 안 될 수 있음.
2. **`params` 는 Promise.** Next.js 16부터 `await params` 필수.
3. **`useSearchParams` 는 Suspense 안에서만.** 안 그러면 빌드 에러.
4. **`useState` 는 비동기.** `setX(1); console.log(x)` 는 이전 값 출력.
5. **`useQuery` 의 queryKey 에 필터를 빠뜨리면 캐시 갱신 안 됨.**

---

## 작업 시작 전 필독

- [.claude/CLAUDE.md](../../.claude/CLAUDE.md) — Claude Code 작업 규칙
- [.claude/develop/A-NEXTJS-기술규칙.md](../../.claude/develop/A-NEXTJS-기술규칙.md) — 모든 코드의 헌법
- [.claude/biz/A.단위업무.md](../../.claude/biz/A.단위업무.md) — UW(단위업무) 35개 목록
- [design/DS_TOKENS.md](../../design/DS_TOKENS.md) — UI 토큰
- [design/DS_COMPONENTS.md](../../design/DS_COMPONENTS.md) — UI 컴포넌트

---

## 진척도 자가 점검은 [08-14절](./08_실전_코드읽기_가이드.md#8-14-학습-진척도-자가-점검) 참고
