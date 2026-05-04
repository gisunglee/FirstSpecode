# Chapter 1. TypeScript 기본 (Java 개발자 시점)

> **이 챕터의 정체**: TypeScript = JavaScript + 정적 타입.
> 우리 프로젝트의 모든 `.ts` / `.tsx` 파일이 TS 로 작성되어 있다.

---

## 1-1. 변수 선언 — `const` / `let` / (`var` 금지)

```ts
const PAGE_SIZE = 20;        // 재할당 불가 (Java 의 final)
let count = 0;               // 재할당 가능 (Java 의 일반 변수)
// var counter = 0;          // ← 절대 쓰지 마라. 함수 스코프라 버그 생긴다.
```

**규칙**: 우리 프로젝트는 99% `const`. 값이 바뀔 때만 `let`. `var` 는 1개도 없어야 정상.

> Java 의 `final int x = 10;` 이 default 라고 생각하면 편하다.

---

## 1-2. 기본 타입

| TS 타입 | Java 비유 | 예시 |
|---|---|---|
| `string` | `String` | `"hello"`, `'hello'`, `` `hello ${name}` `` |
| `number` | `Integer` + `Double` 통합 | `42`, `3.14` (구분 없음) |
| `boolean` | `boolean` | `true`, `false` |
| `null` | `null` | `null` |
| `undefined` | (Java 에 없음) | `undefined` |
| `Date` | `LocalDateTime` | `new Date()` |
| `string[]` 또는 `Array<string>` | `List<String>` | `["a", "b"]` |
| `Record<string, number>` | `Map<String, Integer>` | `{ a: 1, b: 2 }` |

> **숫자가 하나로 통합된다.** Java 의 `int`, `long`, `double` 구분이 사라진다. 대신 `BigInt` 라는 별도 타입이 따로 있다(잘 안 씀).

### 템플릿 리터럴 (백틱)
```ts
const name = "홍길동";
const msg = `안녕하세요, ${name}님!`;  // Java 의 String.format 같은 것
```

JS 의 `+` 문자열 연결도 가능하지만, 백틱이 훨씬 읽기 쉽다.

---

## 1-3. 타입 선언 — `type` vs `interface`

```ts
// type — 어떤 모양이든 OK
type ProjectId = string;
type ProjectItem = {
  projectId: string;
  name:      string;
};

// interface — 객체/클래스 모양 전용 (확장 가능)
interface User {
  id: number;
  name: string;
}
```

**우리 프로젝트의 컨벤션**: 거의 다 `type` 을 쓴다.
이유: `type` 이 더 자유롭고 (Union/Intersection 가능), `interface` 는 OOP 문맥에서나 유리한데 우리는 함수형이라.

> Java 의 `interface User { ... }` 와 비슷하지만, **메서드는 거의 안 넣는다.** 우리는 데이터 모양만 표시한다.

---

## 1-4. 옵셔널, 유니온, 리터럴

### 옵셔널 (`?`) — Java `Optional<T>` 보다 가볍다
```ts
type User = {
  id: number;
  name: string;
  email?: string;        // 있을 수도, 없을 수도
};

const u: User = { id: 1, name: "홍길동" };  // OK, email 생략
```

### 유니온 (`|`) — "이거 아니면 저거"
```ts
type Theme = "dark" | "light" | "dark-purple";

let t: Theme = "dark";    // OK
// t = "blue";            // ← 컴파일 에러
```

> 이게 TS 의 가장 강력한 무기다. **enum 없이 enum 처럼** 쓴다.
> 우리 [src/store/appStore.ts:22](../../src/store/appStore.ts#L22) 의 `AssigneeMode = "all" | "me"` 가 이 패턴.

### 리터럴 타입과 결합
```ts
function setStatus(s: "ACTIVE" | "INACTIVE") { ... }
setStatus("ACTIVE");   // OK
// setStatus("X");     // 컴파일 에러
```

---

## 1-5. 함수 — Java 메서드와의 차이

```ts
// 일반 함수 선언
function add(a: number, b: number): number {
  return a + b;
}

// 화살표 함수 (= Java 의 람다, but 일반 함수처럼 export 가능)
const add = (a: number, b: number): number => a + b;
```

**우리 프로젝트는 화살표 함수와 `function` 키워드를 둘 다 쓴다.**
- 컴포넌트는 `function MyComponent()` 패턴이 많다 (이름이 디버깅에 보임)
- 핸들러나 콜백은 화살표 함수 (`onClick={() => ...}`)

### 비동기 함수 — `async` / `await`

```ts
// async 가 붙으면 항상 Promise<T> 를 반환한다
async function fetchUser(id: number): Promise<User> {
  const res = await fetch(`/api/users/${id}`);  // 여기서 대기
  return res.json();                             // Promise<User> 의 T
}

// 호출도 await 필요
const user = await fetchUser(1);
```

> **Java 의 `Future<T>` + `.get()` 과 본질적으로 같다.** 하지만 문법이 훨씬 가볍다.
> Spring 의 `CompletableFuture` 처럼 무거운 게 아니라, 모든 I/O 가 기본 `Promise` 다.

### 우리 프로젝트 실제 예시

[src/lib/authFetch.ts:60-117](../../src/lib/authFetch.ts#L60-L117):
```ts
export async function authFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const at = getAccessToken();
  const headers = { ... };
  const response = await fetch(url, { ...options, headers });
  // ...
  return response.json() as Promise<T>;
}
```

`<T>` 는 Java 의 generic 그대로다. 호출 시 `authFetch<ProjectsResponse>(url)` 처럼 타입을 박아 쓴다.

---

## 1-6. 객체 다루기 — Spread / Destructuring

이게 처음 보면 가장 낯설다. **하지만 우리 코드 어디에나 있다.**

### Destructuring (구조 분해 할당)
```ts
const user = { id: 1, name: "홍길동", email: "a@b.com" };

// 옛날 방식
const id = user.id;
const name = user.name;

// 구조 분해 — 한 줄로
const { id, name } = user;
```

함수 파라미터에서도 자주 쓴다:
```ts
function RoleBadge({ role }: { role: string }) {
  return <span>{role}</span>;
}
```

위 코드의 `{ role }` 은 "객체의 `role` 필드만 꺼낸다"는 뜻.
실제 [src/app/(main)/projects/page.tsx:47](../../src/app/(main)/projects/page.tsx#L47) 에 있는 패턴이다.

### Spread (펼치기) — `...`
```ts
const a = { x: 1, y: 2 };
const b = { ...a, z: 3 };   // { x: 1, y: 2, z: 3 }

// 덮어쓰기
const c = { ...a, x: 99 };  // { x: 99, y: 2 }
```

배열에도 쓴다:
```ts
const arr1 = [1, 2];
const arr2 = [...arr1, 3];  // [1, 2, 3]
```

> **immutable update 의 핵심**. React 에서 상태를 바꿀 때 이 패턴을 매일 쓴다.
> Java 로 치면 "기존 객체 복사해서 새 객체 반환" 이라고 보면 된다.

### 우리 프로젝트 예시
[src/app/api/projects/route.ts:22-25](../../src/app/api/projects/route.ts#L22-L25):
```ts
where: {
  mber_id: auth.mberId,
  mber_sttus_code: "ACTIVE",
  ...(auth.allowedPrjctId ? { prjct_id: auth.allowedPrjctId } : {}),
  // ↑ 조건부 필드 추가 — 값이 있으면 펼치고, 없으면 빈 객체 펼침(아무것도 안 함)
},
```

이 한 줄이 `if-else` 5줄을 대체한다.

---

## 1-6+. Optional Chaining (`?.`) — Java `Optional` 의 가벼운 버전

자주 등장하므로 한 절로 분리한다.

```ts
const user = data?.user;            // data 가 null/undefined 면 user 도 undefined
const name = data?.user?.name;      // 중간에 하나라도 null/undefined 면 끝까지 undefined
const first = arr?.[0];             // 배열도 가능
const result = obj?.method?.();     // 메서드 호출도 가능
```

| 문법 | 의미 |
|---|---|
| `a.b` | a 가 null/undefined 면 **에러** |
| `a?.b` | a 가 null/undefined 면 **undefined 반환** |
| `a ?? b` | a 가 null/undefined 면 b |
| `a ?? "기본값"` | 위와 동일, 기본값 패턴 |

### 실전 — [src/app/(main)/projects/page.tsx:212](../../src/app/(main)/projects/page.tsx#L212)
```ts
const items = data?.data?.items ?? [];
//             ↑ 첫 렌더 시 data 가 undefined 인 경우를 안전 통과
//                              ↑ 그래도 못 받았으면 빈 배열
```

이 한 줄이 5줄짜리 Java null 체크와 같다.

> **Java 의 `Optional.ofNullable(data).map(d -> d.getUser()).orElse(null)`** 의 가벼운 버전.
> Optional 객체 만들고 unwrap 하는 비용 없이, 컴파일 시 안전성만 보장.

### 주의: `??` 와 `||` 의 차이
```ts
const a = 0 || 100;    // 100  (0 은 falsy)
const b = 0 ?? 100;    // 0    (0 은 null/undefined 가 아님)
```

> `??` 는 **null/undefined 만 fallback**.
> `||` 는 **모든 falsy 값** (0, "", false 포함) 을 fallback. 의도와 다른 결과 나오기 쉬움.
> 우리 프로젝트는 거의 다 `??` 사용.

---

## 1-7. 배열 메서드 — Stream API 와 비슷

| Java Stream | TS 배열 메서드 |
|---|---|
| `.stream().map(...)` | `.map(...)` |
| `.stream().filter(...)` | `.filter(...)` |
| `.stream().collect(toList())` | (필요 없음. 배열이 그대로 반환) |
| `.stream().reduce(...)` | `.reduce(...)` |
| `.stream().sorted(...)` | `.sort(...)` ← **원본 변경 주의!** |
| `Collectors.groupingBy` | `.reduce` 로 직접 만들거나 lodash |

### 예시
```ts
const items = [{ id: 1, n: 10 }, { id: 2, n: 20 }];

// map: 변환
const ids = items.map(it => it.id);          // [1, 2]

// filter: 추출
const big = items.filter(it => it.n > 15);   // [{id: 2, n: 20}]

// 체이닝 — Stream 이랑 똑같다
const result = items
  .filter(it => it.n > 5)
  .map(it => it.n * 2);                       // [20, 40]
```

### 우리 프로젝트 실전 — [src/app/api/projects/route.ts:42-57](../../src/app/api/projects/route.ts#L42-L57)
```ts
const items = memberships
  .sort((a, b) => {
    const aTime = (a.project.mdfcn_dt ?? a.project.creat_dt).getTime();
    const bTime = (b.project.mdfcn_dt ?? b.project.creat_dt).getTime();
    return bTime - aTime;       // 내림차순 (Java Comparator 와 동일)
  })
  .map((m) => ({
    projectId:  m.project.prjct_id,
    name:       m.project.prjct_nm,
    // ...
  }));
```

> ⚠️ **`sort()` 는 원본 배열을 변경한다.** Java Stream 처럼 안전하지 않다.
> 안전하게 하려면 `[...arr].sort(...)` 처럼 복사 후 정렬.

---

## 1-8. Generic — Java 와 거의 같다

```ts
// Java: public <T> T getById(Long id, Class<T> clazz)
// TS:
function getById<T>(id: number): Promise<T> {
  return fetch(`/api/${id}`).then(r => r.json());
}

const user = await getById<User>(1);     // T = User
```

우리 프로젝트의 [src/lib/apiResponse.ts:21](../../src/lib/apiResponse.ts#L21):
```ts
export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}
```

Java 의 `<T>` 와 의미가 같다. 차이라면 **컴파일 후 사라진다**는 것뿐.

---

## 1-9. 타입 단언 (`as`) — 캐스팅과 비슷하지만 다름

```ts
const data = JSON.parse(body) as User;
// "이 값을 User 로 봐줘. 책임은 내가 진다."
```

**Java 의 `(User) obj` 와 비슷하지만, 실제 검사는 안 한다.**
런타임에서는 그냥 통과한다 → 잘못 단언하면 그대로 폭탄.

> 우리 프로젝트는 가능하면 `as` 를 피하고, **타입 가드**를 쓴다.
```ts
if (typeof body === "object" && body !== null && "name" in body) {
  // ← 이 안에서는 body 가 안전하게 좁혀짐(narrowing)
}
```

---

## 1-10. `never`, `unknown`, `any` — 위험도 순서

| 타입 | 의미 | 사용 |
|---|---|---|
| `unknown` | "뭐가 들었는지 모름. 검증 후 써라" | API 응답, JSON.parse 결과 |
| `never` | "절대 발생 안 함" | 모든 case 가 처리됐다는 증명 |
| `any` | "타입 검사 끄겠다" | **금지**. Java 의 raw type + Object 캐스팅 |

> 우리 프로젝트의 [.claude/develop/A-NEXTJS-기술규칙.md](../../.claude/develop/A-NEXTJS-기술규칙.md) 에 명시:
> "`any` 타입 남발 — 타입 에러를 런타임까지 미룸 → 디버깅 지옥"

`unknown` 패턴 실전:
```ts
// src/app/api/projects/route.ts:70-83
let body: unknown;             // ← any 가 아니라 unknown
try {
  body = await request.json();
} catch {
  return apiError(...);
}

const { name, description, ... } = body as {     // 검증 후 단언
  name?: string;
  description?: string;
  // ...
};
```

---

## 1-11. 모듈 시스템 — `import` / `export`

### export
```ts
// 이름 export
export function add(a: number, b: number) { return a + b; }
export const PI = 3.14;
export type User = { id: number; name: string };

// default export — 파일당 1개만
export default function MyComponent() { ... }
```

### import
```ts
import { add, PI } from "./math";
import type { User } from "./types";       // 타입만 import (런타임 코드 0)
import MyComponent from "./MyComponent";   // default
import * as math from "./math";            // 전부
```

> Java 의 `import com.example.Foo;` 와 똑같이 생각하면 된다.
> 차이: **파일 경로**로 찾는다. (Java 는 패키지명, TS 는 파일 경로)

우리 프로젝트의 alias `@/`:
```ts
import { prisma } from "@/lib/prisma";   // = src/lib/prisma.ts
import { authFetch } from "@/lib/authFetch";
```

`@/` 는 [tsconfig.json](../../tsconfig.json) 에서 `src/` 로 매핑된다. 상대경로 `../../../` 지옥을 피하려는 관례.

---

## 1-12. Promise 와 비동기 — Java `CompletableFuture` 비교

```ts
// 1. 만들기
const p: Promise<number> = fetch("/api/count").then(r => r.json());

// 2. 기다리기 (방법 A: await)
const n = await p;

// 2. 기다리기 (방법 B: .then)
p.then(n => console.log(n));
```

### 병렬 실행 — `Promise.all`
```ts
// 순차 (느림): 5초 + 5초 = 10초
const a = await fetchA();
const b = await fetchB();

// 병렬 (빠름): max(5, 5) = 5초
const [a, b] = await Promise.all([fetchA(), fetchB()]);
```

> **우리 [.claude/develop/A-NEXTJS-기술규칙.md](../../.claude/develop/A-NEXTJS-기술규칙.md) 5번 규칙**:
> 의존 관계 없는 호출은 항상 `Promise.all` 로 묶을 것.

---

## 1-13. 한 줄 요약

> TypeScript는 Java 만큼 엄격한 타입을 주고, JavaScript 만큼 자유로운 객체를 주는 절충안이다.
> 단, **타입은 컴파일 후 사라진다는 점**만 매번 잊지 말 것.

---

다음 챕터 → [02_React_기본.md](./02_React_기본.md)
이전 챕터 ← [00_시작하기_마인드셋전환.md](./00_시작하기_마인드셋전환.md)
