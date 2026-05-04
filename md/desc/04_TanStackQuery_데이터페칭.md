# Chapter 4. TanStack Query — 데이터 페칭의 표준

> **이 챕터의 정체**: 클라이언트가 서버 API 를 부를 때 쓰는 **캐싱+상태관리 라이브러리**.
> Java 비유: Spring 의 `@Cacheable` + AsyncTask + 자동 재시도 + 자동 invalidation 을 합친 도구.

---

## 4-1. 왜 필요한가 — `fetch` 만으로 안 되는 이유

순수하게 React + fetch 로 데이터를 받으면 직접 처리해야 할 일:

1. 로딩 상태 관리 (`isLoading`)
2. 에러 상태 관리 (`error`)
3. 같은 데이터를 여러 컴포넌트가 요청 → 중복 호출
4. 페이지 이동 후 돌아왔을 때 캐시 재사용
5. 데이터 변경 후 목록 자동 갱신
6. 네트워크 끊겼다가 복귀 시 재시도

이걸 매번 직접 코딩하면 **재앙**이다. → **TanStack Query** 가 표준.

---

### 잠깐 — Server Component 에서 직접 fetch 하면 안 되나?

당연한 의문. 결론: **둘 다 가능. 하지만 우리 프로젝트는 클라이언트 + useQuery 가 표준.**

| 패턴 | 적합한 상황 |
|---|---|
| Server Component 에서 직접 `await fetch` 또는 `await prisma.~` | 정적/SEO 중요 페이지, 한 번 받고 끝 |
| Client Component + `useQuery` | **인터랙션 많은 화면** (필터, 정렬, 페이지, 즉시 갱신) — 우리 대부분 |

이유:
- 우리 화면은 검색/필터/실시간 갱신/생성 후 즉시 목록 반영 등 **인터랙션 무거움**
- 캐시 + invalidate 패턴이 강력함
- 같은 데이터를 여러 컴포넌트가 가져가도 1번만 호출됨

→ 그래서 거의 모든 페이지가 첫 줄에 `"use client"`.

---

## 4-2. 핵심 개념 3가지

| 개념 | 의미 | Java 비유 |
|---|---|---|
| **Query** | 서버에서 **읽기** (GET) | `@Cacheable` 메서드 |
| **Mutation** | 서버 데이터 **변경** (POST/PUT/DELETE) | `@CacheEvict` + transactional service |
| **QueryClient** | 캐시 저장소 | `CacheManager` |

---

## 4-3. 설정 — Provider 등록 (한 번만)

```tsx
// src/providers/QueryProvider.tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  // useState 로 초기화하는 이유:
  // 매 렌더마다 new QueryClient() 가 호출되면 캐시가 초기화됨
  const [queryClient] = useState(
    () => new QueryClient({
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: false,    // 창 포커스 시 재조회 끄기
          retry: 1,                       // 실패 시 1번 재시도
          staleTime: 30_000,              // 30초간 "신선" 으로 간주 (재호출 안 함)
        },
      },
    })
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

[src/app/layout.tsx](../../src/app/layout.tsx) 에서 이걸로 전체를 감싼다.
**앱 어디에서든 useQuery / useMutation 사용 가능.**

---

## 4-4. Query — 데이터 조회

### 가장 단순한 패턴
```tsx
"use client";
import { useQuery } from "@tanstack/react-query";

function ProjectsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["projects"],            // ← 캐시 키 (필수)
    queryFn: () => fetch("/api/projects").then(r => r.json()),
  });

  if (isLoading) return <div>로딩중...</div>;
  if (error)     return <div>에러: {error.message}</div>;
  return <div>{data.items.map(p => <div key={p.id}>{p.name}</div>)}</div>;
}
```

### `queryKey` 의 정체
- **캐시를 식별하는 ID**. 같은 키 = 같은 데이터.
- 배열 형태. 필터/페이지 변수를 같이 넣어야 한다.

```tsx
// 검색어와 페이지가 바뀌면 다른 캐시
useQuery({
  queryKey: ["projects", page, search, statusFilter],
  queryFn: () => fetch(`/api/projects?page=${page}&search=${search}&status=${statusFilter}`).then(r => r.json()),
});
```

> ⚠️ **queryKey 에 필터를 빠뜨리면 캐시 갱신 안 됨.**
> Spring `@Cacheable(key = "...")` 의 `key` 가 메서드 인자 안 넣으면 같은 캐시 → 같은 함정.
> [.claude/develop/A-NEXTJS-기술규칙.md](../../.claude/develop/A-NEXTJS-기술규칙.md) 4번 규칙에서도 강조.

### 우리 프로젝트 — [src/app/(main)/projects/page.tsx:206-210](../../src/app/(main)/projects/page.tsx#L206-L210)
```tsx
const { data, isLoading } = useQuery<ProjectsResponse>({
  queryKey: ["projects"],
  queryFn: () => authFetch<ProjectsResponse>("/api/projects"),
  staleTime: 60 * 1000,    // 1분
});

const items = data?.data?.items ?? [];   // ← optional chain + ??
```

`data?.data?.items` 처럼 옵셔널 체인을 쓰는 이유:
- 첫 렌더 시 아직 응답 도착 전 → `data` 는 `undefined`
- `?` 가 없으면 `Cannot read property 'data' of undefined` 에러

---

## 4-5. Query 의 자동 동작

`useQuery` 가 알아서 해주는 일:

| 자동 동작 | 의미 |
|---|---|
| **Caching** | 같은 queryKey 면 캐시 재사용 |
| **Background Refetch** | 마운트 시, 창 포커스 시(설정에 따라) 자동 재조회 |
| **Stale 관리** | `staleTime` 안에서는 캐시 사용, 지나면 다음 마운트 시 갱신 |
| **Retry** | 실패 시 자동 재시도 (기본 3회, 우리는 1회) |
| **Loading State** | `isLoading`, `isFetching` 자동 |
| **Error State** | `error`, `isError` 자동 |

> Spring 에서 직접 구현하려면 `@Cacheable` + `@Async` + `@Retryable` 다 붙여야 비슷한 효과.

---

## 4-6. Mutation — 데이터 변경

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

function CreateProjectButton() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (body: { name: string }) =>
      fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(r => {
        if (!r.ok) throw new Error("실패");
        return r.json();
      }),

    onSuccess: () => {
      // 목록 캐시 무효화 → 자동 재조회
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("생성됨");
    },

    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <button
      onClick={() => mutation.mutate({ name: "새 프로젝트" })}
      disabled={mutation.isPending}
    >
      {mutation.isPending ? "생성 중..." : "생성"}
    </button>
  );
}
```

### 핵심: `invalidateQueries`
> "이 queryKey 의 캐시는 더 이상 유효하지 않다. 다음 렌더에 재조회해라" 라는 표시.

이게 우리 프로젝트의 **Service 호출 후 목록 갱신** 패턴이다.

### 우리 프로젝트 — [src/app/(main)/projects/page.tsx:81-92](../../src/app/(main)/projects/page.tsx#L81-L92)
```tsx
const mutation = useMutation({
  mutationFn: (body: object) =>
    authFetch<{ data: { projectId: string } }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  onSuccess: (res) => {
    toast.success("프로젝트가 생성되었습니다.");
    onCreated(res.data.projectId);
  },
  onError: (err: Error) => toast.error(err.message),
});

// 호출
mutation.mutate({ name, description, ... });
```

부모 컴포넌트에서:
```tsx
function handleCreated(projectId: string) {
  queryClient.invalidateQueries({ queryKey: ["projects"] });   // 목록 캐시 무효화
  // ...
}
```

---

## 4-7. mutation 의 두 가지 호출 방식

```tsx
// 1. mutate — 비동기, await 못함. 단순 화면 흐름에 적합
mutation.mutate({ name: "새 프로젝트" });

// 2. mutateAsync — Promise 반환, await 가능. 여러 mutation 조합 시
const result = await mutation.mutateAsync({ name: "새 프로젝트" });
// 단점: try/catch 직접 해야 함 (onError 가 동작은 하지만 await 가 throw 함)
```

> 우리 프로젝트는 **`mutate`** 를 기본으로 쓴다. 단순하고, onSuccess/onError 가 명확.

---

## 4-8. 실전 패턴: 목록 + 생성/수정/삭제

### 패턴 1 — 같은 페이지 안에서
```tsx
function ProjectsPage() {
  const queryClient = useQueryClient();

  // 조회
  const { data } = useQuery({
    queryKey: ["projects"],
    queryFn: () => authFetch("/api/projects"),
  });

  // 삭제
  const deleteMut = useMutation({
    mutationFn: (id: string) => authFetch(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  return (
    <div>
      {data?.items.map(p => (
        <div key={p.id}>
          {p.name}
          <button onClick={() => deleteMut.mutate(p.id)}>삭제</button>
        </div>
      ))}
    </div>
  );
}
```

### 패턴 2 — invalidate 의 범위
```tsx
// 정확한 키로만 무효화
queryClient.invalidateQueries({ queryKey: ["projects"] });

// 부분 매칭 — ["projects", ...] 으로 시작하는 모든 캐시
queryClient.invalidateQueries({ queryKey: ["projects"] });
// → ["projects", page=1], ["projects", page=2] 모두 무효화

// 정확히 일치만
queryClient.invalidateQueries({ queryKey: ["projects"], exact: true });
```

### 우리 [src/app/(main)/projects/page.tsx:220-228](../../src/app/(main)/projects/page.tsx#L220-L228)
```tsx
function handleCreated(projectId: string) {
  queryClient.invalidateQueries({ queryKey: ["projects"] });
  queryClient.invalidateQueries({ queryKey: ["projects", "my"] });
  // ↑ 두 가지 키를 따로 무효화 (전체 목록과 "내 프로젝트" 목록 둘 다)
  setCreateOpen(false);
  setCurrentProjectId(projectId);
  router.push(`/projects/${projectId}/settings`);
}
```

---

## 4-9. 우리 프로젝트의 fetch 래퍼 — `authFetch`

순수 `fetch()` 가 아니라 [src/lib/authFetch.ts](../../src/lib/authFetch.ts) 를 쓴다.

### 추가되는 기능
1. `Authorization: Bearer <AT>` 헤더 자동 부착
2. 401 (TOKEN_EXPIRED) 응답 시 자동으로 RT 로 재발급
3. 동시 401 발생 시 갱신 요청은 1번만 (Lock)
4. 갱신 실패 시 로그인 페이지 자동 이동

```tsx
// 사용은 fetch 와 거의 동일
const data = await authFetch<ProjectsResponse>("/api/projects");
```

> Spring 의 `RestTemplate` 에 인터셉터 + 토큰 갱신 + 재시도 추가한 것과 같은 위치.

### 핵심 코드 — [src/lib/authFetch.ts:60-117](../../src/lib/authFetch.ts#L60-L117)
```ts
export async function authFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const at = sessionStorage.getItem("access_token") ?? "";
  const headers = {
    "Content-Type": "application/json",
    ...(options?.headers ?? {}),
    ...(at ? { Authorization: `Bearer ${at}` } : {}),
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    const errorBody = await response.clone().json().catch(() => ({}));
    if (errorBody.code === "TOKEN_EXPIRED") {
      const newAT = await handleRefreshToken();
      // ... 재시도
    }
    // ...
  }

  return response.json() as Promise<T>;
}
```

---

## 4-10. 자주 쓰는 옵션 정리

```tsx
useQuery({
  queryKey: ["projects", page, search],
  queryFn: () => authFetch(...),

  // 데이터가 "신선" 한 시간. 그 안에는 재호출 안 함.
  staleTime: 60_000,

  // 캐시가 메모리에 남아있는 시간 (사용자가 페이지 떠난 후)
  gcTime: 5 * 60_000,

  // 자동 재조회 끄기/켜기
  refetchOnWindowFocus: true,
  refetchOnMount: true,

  // 조건부 실행 — false 면 호출 안 함 (마운트 후에도)
  enabled: !!projectId,

  // 데이터 변환
  select: (data) => data.items,

  // 폴링 — 5초마다
  refetchInterval: 5_000,
});
```

---

## 4-11. 흔한 실수와 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| 데이터 변경했는데 화면 그대로 | mutation onSuccess 에서 invalidate 누락 | `invalidateQueries` 호출 |
| 검색어 바꿔도 같은 결과 | queryKey 에 검색어 안 넣음 | `queryKey: ["x", search]` |
| 처음 진입 시 깜빡임 | `data` 가 처음에 undefined | `data?.items ?? []` 패턴 |
| API 가 두 번 호출됨 | StrictMode 의 의도된 동작 (개발 중) | dev 에서는 정상, prod 에서는 1번 |
| 로그아웃 후에도 캐시 남음 | queryClient 가 살아있음 | 로그아웃 시 `queryClient.clear()` |

---

## 4-12. Java 개발자 시점 비교 표

| 일 | Spring + MyBatis | React + TanStack Query |
|---|---|---|
| 목록 조회 | Service 메서드 호출 → JSP 에 model | `useQuery({ queryKey, queryFn })` |
| 캐싱 | `@Cacheable` | 자동 (queryKey 기반) |
| 캐시 무효화 | `@CacheEvict` | `invalidateQueries({ queryKey })` |
| 로딩 표시 | JSP 안에 직접 | `isLoading` boolean |
| 에러 처리 | try/catch + 별도 에러 페이지 | `onError` + toast |
| 재시도 | `@Retryable` | `retry: 3` 옵션 |

---

## 4-13. 한 줄 요약

> `useQuery` = 캐시되는 GET. `useMutation` = 변경 후 `invalidateQueries` 로 캐시 갱신. 끝.

---

다음 챕터 → [05_상태관리.md](./05_상태관리.md)
이전 챕터 ← [03_NextJS_AppRouter.md](./03_NextJS_AppRouter.md)
