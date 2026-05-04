# Chapter 3. Next.js App Router (Spring MVC 와 비교)

> **이 챕터의 정체**: Next.js 는 React 위에 얹은 **풀스택 프레임워크**다.
> "**파일 경로 = URL**" 이라는 단 한 가지 핵심 컨벤션.

---

## 3-1. 큰 그림 — Spring MVC vs Next.js App Router

| 영역 | Spring MVC | Next.js App Router |
|---|---|---|
| URL 매핑 | `@RequestMapping("/users")` | `src/app/users/page.tsx` (파일 경로 자체) |
| HTTP 메서드 | `@GetMapping`, `@PostMapping` | `route.ts` 에서 `export GET()`, `POST()` 함수 |
| 동적 파라미터 | `@PathVariable Long id` | 폴더명 `[id]` |
| 쿼리스트링 | `@RequestParam` | `useSearchParams()` 또는 `request.nextUrl.searchParams` |
| 뷰 (HTML) | JSP / Thymeleaf | `page.tsx` (React 컴포넌트) |
| 공통 레이아웃 | SiteMesh / 데코레이터 | `layout.tsx` |
| 인증 필터 | `@PreAuthorize` / Filter | `requireAuth()` 함수 직접 호출 |
| 에러 페이지 | `@ControllerAdvice` | `error.tsx` |
| 로딩 | (자체 구현) | `loading.tsx` (자동) |

---

## 3-2. 폴더 = URL — 핵심 매핑

```
src/app/
├── page.tsx                          → /
├── (auth)/                           → URL 영향 없음 (그룹)
│   ├── login/page.tsx                → /login
│   └── signup/page.tsx               → /signup
├── (main)/                           → URL 영향 없음 (그룹)
│   ├── dashboard/page.tsx            → /dashboard
│   ├── projects/page.tsx             → /projects
│   └── projects/[id]/page.tsx        → /projects/abc123
└── api/
    ├── projects/route.ts             → /api/projects (GET, POST)
    └── projects/[id]/route.ts        → /api/projects/abc123 (GET, PUT, DELETE)
```

### 각 폴더의 의미
| 폴더/파일 | 역할 |
|---|---|
| `page.tsx` | 해당 URL 의 페이지 (없으면 그 URL 은 404) |
| `route.ts` | API 엔드포인트 (page.tsx 와 동시 존재 불가) |
| `layout.tsx` | 자식 페이지를 감싸는 공통 레이아웃 |
| `loading.tsx` | 페이지 로딩 중 표시 |
| `error.tsx` | 에러 시 표시 (Spring 의 ErrorPage) |
| `not-found.tsx` | 404 |

### `(auth)`, `(main)` 같은 괄호 폴더 = 라우트 그룹
- URL 에는 영향 없음
- 같은 레이아웃을 공유하는 페이지들을 그룹핑

> 우리 [src/app/(main)/layout.tsx](../../src/app/(main)/layout.tsx) 가 GNB/LNB 를 감싸고,
> [src/app/(auth)/](../../src/app/(auth)/) 는 별도 레이아웃 (로그인 화면은 GNB 없음).

### `[id]` = 동적 세그먼트
- Spring 의 `@PathVariable` 과 동일
- 폴더 이름이 `[id]` 면, URL 의 그 자리 값이 `id` 라는 변수로 전달됨

---

## 3-3. 페이지 (`page.tsx`) — JSP 와의 비교

### Spring MVC + JSP
```java
@Controller
public class ProjectController {
  @GetMapping("/projects")
  public String list(Model model) {
    model.addAttribute("projects", service.findAll());
    return "projects/list";   // → /WEB-INF/views/projects/list.jsp
  }
}
```

### Next.js
```tsx
// src/app/projects/page.tsx — 컨트롤러+뷰가 한 파일
"use client";

import { useQuery } from "@tanstack/react-query";

export default function ProjectsPage() {
  const { data } = useQuery({
    queryKey: ["projects"],
    queryFn: () => fetch("/api/projects").then(r => r.json()),
  });

  return (
    <div>
      {data?.items.map(p => <div key={p.id}>{p.name}</div>)}
    </div>
  );
}
```

> Spring 은 "Controller → Model → View" 의 흐름.
> Next.js Client Component 는 "**브라우저에서 직접 API 호출**" 흐름. (SPA 와 같음)
> 데이터 페칭은 클라이언트 컴포넌트 + TanStack Query 가 정석. (Chapter 4 에서 자세히)

---

## 3-4. API Route (`route.ts`) — `@RestController` 의 자리

```
src/app/api/projects/route.ts        ← /api/projects
src/app/api/projects/[id]/route.ts   ← /api/projects/{id}
```

### Spring 과 비교
```java
@RestController
@RequestMapping("/api/projects")
public class ProjectApi {
  @GetMapping
  public List<ProjectDto> list() { ... }

  @PostMapping
  public ProjectDto create(@RequestBody CreateReq req) { ... }
}

@RestController
@RequestMapping("/api/projects/{id}")
public class ProjectApiDetail {
  @GetMapping public ProjectDto get(@PathVariable Long id) { ... }
  @PutMapping public ProjectDto update(@PathVariable Long id, @RequestBody UpdateReq req) { ... }
  @DeleteMapping public void delete(@PathVariable Long id) { ... }
}
```

```ts
// src/app/api/projects/route.ts — GET, POST 한 파일에
export async function GET(request: NextRequest) { ... }
export async function POST(request: NextRequest) { ... }

// src/app/api/projects/[id]/route.ts — GET/PUT/DELETE 한 파일에
type RouteParams = { params: Promise<{ id: string }> };
export async function GET(_req: NextRequest, { params }: RouteParams) { ... }
export async function PUT(_req: NextRequest, { params }: RouteParams) { ... }
export async function DELETE(_req: NextRequest, { params }: RouteParams) { ... }
```

> **함수 이름 = HTTP 메서드.** 어노테이션 대신 `export` 한 함수의 이름으로 매칭.

### 우리 프로젝트 실전 — [src/app/api/projects/route.ts](../../src/app/api/projects/route.ts)

전체 구조를 분석해보면:

```ts
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";              // ← Repository
import { requireAuth } from "@/lib/requireAuth";     // ← Filter
import { apiSuccess, apiError } from "@/lib/apiResponse"; // ← ResponseEntity 헬퍼

// GET /api/projects — 목록
export async function GET(request: NextRequest) {
  // 1. 인증 — Spring 의 @PreAuthorize 자리
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;        // 401/403 즉시 반환

  try {
    // 2. DB 조회 — Service + Mapper 자리
    const memberships = await prisma.tbPjProjectMember.findMany({
      where: { mber_id: auth.mberId, mber_sttus_code: "ACTIVE" },
      include: { project: { select: { ... } } },    // JOIN
    });

    // 3. 변환 — DTO 매핑 자리
    const items = memberships.map((m) => ({
      projectId:  m.project.prjct_id,
      name:       m.project.prjct_nm,
      // ...
    }));

    // 4. 응답
    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error("[GET /api/projects] DB 오류:", err);
    return apiError("DB_ERROR", "프로젝트 목록 조회에 실패했습니다.", 500);
  }
}
```

**한 함수 안에 Controller + Service + DTO 매핑이 다 들어있다.**
계층이 작으면 굳이 분리하지 않는 게 우리 컨벤션. 커지면 `src/lib/` 로 추출.

---

## 3-5. 동적 라우트 — `[id]` 사용

### Next.js 16 의 함정 — `params` 가 Promise 다
```ts
// src/app/api/projects/[id]/route.ts
type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;   // ← await 필수! 빠뜨리면 undefined.
  // ...
}
```

> **버전 종속 함정**. Next.js 14 까지는 `{ id }` 가 동기였는데 16부터 Promise 로 변경됨.
> 우리 [.claude/develop/A-NEXTJS-기술규칙.md](../../.claude/develop/A-NEXTJS-기술규칙.md) 3번 규칙에서 강조.

### 페이지에서도 마찬가지
```tsx
// src/app/projects/[id]/page.tsx
type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const { id } = await params;
  return <div>프로젝트 ID: {id}</div>;
}
```

---

## 3-6. Server Component vs Client Component (제대로)

### Server Component (기본값)
- 서버에서 한 번 렌더링되어 HTML 로 클라이언트에 보냄
- DB 직접 접근 가능 (`await prisma...`)
- `useState`, `useEffect`, `onClick` **불가**
- 브라우저 API (`window`, `localStorage`) 접근 불가

### Client Component (`"use client"` 명시)
- 1차 렌더는 서버에서 (HTML), 이후 브라우저에서 hydration
- `useState`, `useEffect`, 이벤트 핸들러 가능
- DB 직접 접근 **불가** (브라우저에서 동작하니까)
- 데이터는 API route 통해서만 받음

### 우리 프로젝트의 패턴

| 파일 | 종류 | 이유 |
|---|---|---|
| [src/app/layout.tsx](../../src/app/layout.tsx) | Server | 메타데이터 등 정적 |
| [src/providers/QueryProvider.tsx](../../src/providers/QueryProvider.tsx) | Client | useState 사용 |
| [src/app/(main)/layout.tsx](../../src/app/(main)/layout.tsx) | Server | 단순 wrapper |
| `MainLayout` (그 안에서 import) | Client | 사이드바 토글 등 |
| [src/app/(main)/projects/page.tsx](../../src/app/(main)/projects/page.tsx) | Client | useState, useQuery |
| [src/app/api/**/*route.ts](../../src/app/api/) | (서버 전용) | API |

### 결정 기준
> "useState/useEffect/onClick 중 하나라도 필요? → `"use client"`. 아니면 그냥 둠."

### `"use client"` 위치 함정
```tsx
// ❌ 주석 다음에 오면 인식 안 될 수 있음
// 이 컴포넌트는 클라이언트
"use client";

// ✅ 무조건 첫 줄
"use client";

// (그 다음에 주석/import 등)
```

[.claude/develop/A-NEXTJS-기술규칙.md](../../.claude/develop/A-NEXTJS-기술규칙.md) 3번 규칙 참고.

---

## 3-7. Layout — 공통 UI 적용

### Spring 의 SiteMesh 와 비유
SiteMesh 는 모든 JSP 결과를 가로채 공통 헤더/사이드바를 감싼다.
Next.js 의 `layout.tsx` 도 같은 역할이지만 **컴포넌트로 명시적**이다.

```tsx
// src/app/layout.tsx — 모든 페이지를 감싸는 최상위
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <QueryProvider>
          {children}        {/* ← 자식 페이지가 여기에 들어감 */}
        </QueryProvider>
      </body>
    </html>
  );
}
```

```tsx
// src/app/(main)/layout.tsx — (main) 그룹의 페이지에만 적용
export default function MainGroupLayout({ children }: { children: React.ReactNode }) {
  return <MainLayout>{children}</MainLayout>;   // GNB + LNB 추가
}
```

### 중첩
```
RootLayout
└── MainGroupLayout
    └── projects/page.tsx
```

위처럼 layout 이 **누적**된다. JSP 의 SiteMesh 단일 데코레이터보다 유연.

---

## 3-8. 라우팅 (페이지 이동) — `useRouter`

### Java/JSP 시절
```html
<!-- a 태그 또는 form submit 또는 response.sendRedirect -->
<a href="/projects/123">상세</a>
```

### Next.js
```tsx
"use client";
import { useRouter } from "next/navigation";

export default function MyPage() {
  const router = useRouter();

  return (
    <button onClick={() => router.push("/projects/123")}>
      상세로 이동
    </button>
  );
}
```

### `<Link>` 컴포넌트 — 표준 a 태그보다 빠름
```tsx
import Link from "next/link";
<Link href="/projects/123">상세</Link>
// → 풀 페이지 새로고침 없이 클라이언트 라우팅 (SPA)
```

### 우리 프로젝트 — [src/app/(main)/projects/page.tsx:201,217](../../src/app/(main)/projects/page.tsx#L201)
```tsx
const router = useRouter();
// ...
function handleProjectClick(projectId: string) {
  setCurrentProjectId(projectId);
  router.push("/dashboard");
}
```

---

## 3-9. 쿼리스트링 — `useSearchParams`

```tsx
"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

export default function Page() {
  return (
    <Suspense fallback={null}>     {/* ← 필수! */}
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const params = useSearchParams();
  const filter = params.get("filter") ?? "";
  return <div>필터: {filter}</div>;
}
```

> **`Suspense` 로 감싸지 않으면 빌드/런타임 에러.** Next.js 의 강제 규칙.
> 이유: hydration 타이밍 문제. [.claude/develop/A-NEXTJS-기술규칙.md](../../.claude/develop/A-NEXTJS-기술규칙.md) 3번 규칙.

우리 프로젝트의 [src/app/(main)/projects/page.tsx:192-198](../../src/app/(main)/projects/page.tsx#L192-L198) 패턴이 정확히 이것:
```tsx
export default function ProjectsPage() {
  return (
    <Suspense fallback={null}>
      <ProjectsPageInner />
    </Suspense>
  );
}
```

---

## 3-10. 인증 — Spring Security 와의 비교

### Spring Security
```java
@PreAuthorize("hasRole('ADMIN')")
@GetMapping("/admin")
public ... { }
```

### Next.js — 함수 호출로 명시
```ts
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);     // ← 직접 호출
  if (auth instanceof Response) return auth;   // 401 즉시 반환

  // 권한 체크가 필요하면 또 한 줄
  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  // 통과하면 실제 로직
  // ...
}
```

> **어노테이션 대신 명시적 함수 호출.** 매번 호출해야 하지만, "어디에 어떤 보안이 걸렸는지" 가 코드에 그대로 보임.

우리 [src/lib/requireAuth.ts](../../src/lib/requireAuth.ts) 가 이 역할을 한다.
JWT 검증 + MCP API 키 검증 + 프로젝트 scope 검증을 한 함수에서.

---

## 3-11. 에러 처리

```tsx
// src/app/projects/error.tsx — 이 폴더와 자식들의 에러 boundary
"use client";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <h2>에러 발생: {error.message}</h2>
      <button onClick={reset}>다시 시도</button>
    </div>
  );
}
```

> Spring 의 `@ControllerAdvice` 와 같은 역할. 다만 폴더 단위로 동작 범위가 결정됨.

---

## 3-12. 빌드 / 배포

```bash
npm run dev       # 개발 서버 (포트 3001 — 우리 프로젝트는 메모리에 기록됨)
npm run build     # tsc --noEmit && next build
npm run start     # 프로덕션 모드 실행
```

| Spring | Next.js |
|---|---|
| `mvn package` → `.war` | `next build` → `.next/` 폴더 |
| Tomcat 에 배포 | Node.js 프로세스로 실행 (`next start`) 또는 Vercel 등 |

`.next/` 안에는 서버 컴포넌트 결과 HTML, 클라이언트 번들 JS, 라우팅 정보 등이 다 들어있다.

---

## 3-13. 한 줄 요약

> Next.js 는 **파일이 곧 라우트**. `page.tsx` = 화면, `route.ts` = API. 끝.

---

## 3-14. 우리 프로젝트 매핑 표 (실전)

| URL | 파일 | 종류 |
|---|---|---|
| `/` | [src/app/page.tsx](../../src/app/page.tsx) | 페이지 |
| `/login` | `src/app/(auth)/login/page.tsx` | 페이지 |
| `/dashboard` | `src/app/(main)/dashboard/page.tsx` | 페이지 (인증 필요) |
| `/projects` | [src/app/(main)/projects/page.tsx](../../src/app/(main)/projects/page.tsx) | 페이지 |
| `/projects/{id}/settings` | `src/app/(main)/projects/[id]/settings/page.tsx` | 동적 페이지 |
| `GET /api/projects` | [src/app/api/projects/route.ts](../../src/app/api/projects/route.ts) | API |
| `POST /api/projects` | 같은 파일의 `POST` 함수 | API |
| `GET /api/projects/{id}` | `src/app/api/projects/[id]/route.ts` | API |

---

다음 챕터 → [04_TanStackQuery_데이터페칭.md](./04_TanStackQuery_데이터페칭.md)
이전 챕터 ← [02_React_기본.md](./02_React_기본.md)
