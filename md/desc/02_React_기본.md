# Chapter 2. React 기본 (JSP/Thymeleaf 와 비교)

> **이 챕터의 정체**: React 는 **UI 라이브러리**다. (프레임워크가 아니다.)
> 한 줄 요약: "**JS 함수가 HTML 을 반환한다.** 그게 컴포넌트다."

---

## 2-1. JSX/TSX — "JS 안에 HTML"

### JSP 와 비교
```jsp
<%-- JSP — HTML 안에 Java --%>
<table>
  <% for (User u : users) { %>
    <tr><td><%= u.getName() %></td></tr>
  <% } %>
</table>
```

```tsx
// React TSX — JS 안에 HTML
function UserTable({ users }: { users: User[] }) {
  return (
    <table>
      {users.map((u) => (
        <tr key={u.id}><td>{u.name}</td></tr>
      ))}
    </table>
  );
}
```

> **방향이 정반대다.** JSP 는 HTML 이 본체이고 안에 Java 를 박는다.
> JSX 는 **JS 가 본체**이고 안에 HTML 처럼 생긴 걸 박는다.

JSX 는 결국 함수 호출로 변환된다:
```tsx
<div className="x">hi</div>
// ↓ 변환
React.createElement("div", { className: "x" }, "hi");
```

---

## 2-2. JSX 의 5가지 규칙 (Java 개발자가 헷갈리는 것)

### ① 속성은 `class` 가 아니라 `className`
HTML 의 `class` 는 JS 예약어라 충돌. `className` 으로 표기.

```tsx
<div className="sp-btn sp-btn-primary">버튼</div>
```

### ② 카멜케이스
```tsx
<input onChange={...} />        // ← onchange 아님
<div tabIndex={1} />            // ← tabindex 아님
```

### ③ `{ }` 안에 JS 식을 넣는다
```tsx
const name = "홍길동";
<div>안녕, {name}!</div>             // 변수 출력
<div>{1 + 1}</div>                   // 식 평가
<div>{user ? user.name : "없음"}</div>  // 삼항 연산자
```

> **`if-else` 는 JSX 안에서 직접 못 쓴다.** 삼항이나 `&&` 를 쓴다.

### ④ 닫지 않는 태그도 `/` 로 닫아야 한다
```tsx
<input />     // ← OK
<input>       // ← 에러
<br />        // ← OK
```

### ⑤ 최상위 요소는 1개
```tsx
// ❌ 안 됨 — 최상위가 2개
return <div /><div />;

// ✅ Fragment 로 묶음 (HTML 출력에는 영향 없음)
return <><div /><div /></>;

// ✅ 부모 div 로 묶음
return <div><div /><div /></div>;
```

---

## 2-3. 컴포넌트 = 함수

```tsx
// 가장 단순한 컴포넌트
function Greeting() {
  return <div>안녕하세요!</div>;
}

// 사용
<Greeting />
```

**Java 개발자 시점**:
- "컴포넌트" = "JSP 의 커스텀 태그" 라고 생각하면 직관적
- 하지만 실제로는 **함수**다. `Greeting()` 이라는 함수가 매번 호출되어 JSX 를 반환한다

---

## 2-4. Props — 컴포넌트의 파라미터

```tsx
type Props = {
  name: string;
  age?: number;        // 옵션
};

function UserCard({ name, age }: Props) {
  return <div>{name} ({age ?? "?"} 세)</div>;
}

// 사용
<UserCard name="홍길동" age={30} />
<UserCard name="이순신" />          // age 생략 가능
```

> Java 메서드 호출 `userCard("홍길동", 30)` 과 같은 의미.
> 단, **이름으로 전달**한다 (positional 아님).

### Props 는 읽기 전용
```tsx
function Bad({ name }: { name: string }) {
  name = "다른이름";   // ← 동작은 하지만 무의미. 부모에 영향 0.
  return <div>{name}</div>;
}
```

> Props 는 **부모가 자식에게 주는 단방향 데이터**다.
> Java 로 치면 "메서드 인자를 final 로 받았다"고 보면 된다. 자식이 바꿔도 부모와 무관.

### 우리 프로젝트 — [src/app/(main)/projects/page.tsx:47-65](../../src/app/(main)/projects/page.tsx#L47-L65)
```tsx
function RoleBadge({ role }: { role: string }) {
  const isOwner = role === "OWNER";
  return (
    <span style={{ /* ... */ }}>
      {isOwner ? "OWNER" : "MEMBER"}
    </span>
  );
}

// 사용 (목록 안에서)
<RoleBadge role={item.myRole} />
```

`{ role }` 은 props 객체에서 `role` 만 구조분해해서 꺼냈다는 의미.

---

## 2-5. State — 컴포넌트의 기억 (`useState`)

여기서부터가 React 의 핵심이다.

```tsx
import { useState } from "react";

function Counter() {
  // [현재값, 변경함수] 한 쌍을 받는다
  const [count, setCount] = useState(0);

  return (
    <div>
      <span>{count}</span>
      <button onClick={() => setCount(count + 1)}>+1</button>
    </div>
  );
}
```

### 동작 원리 (이게 가장 중요)
1. 처음 렌더 시 `useState(0)` 이 호출되어 `count = 0`
2. 버튼 클릭 → `setCount(1)` 호출
3. **React 가 이 컴포넌트 함수를 다시 실행**
4. 이번 실행에서는 `count = 1` (React 가 기억하고 있음)
5. 새 JSX 반환 → React 가 변경된 부분만 DOM 에 반영

> **핵심 충격**: 함수가 **계속 다시 실행된다.**
> Java 의 인스턴스 필드처럼 한 번 만들고 끝이 아니라, 매 렌더마다 처음부터 다시 실행됨.
> 단, `useState` 가 값만 React 내부에 보관해서 **다음 렌더에서도 유지**되게 해준다.

### 우리 프로젝트 예시 — [src/app/(main)/projects/page.tsx:204](../../src/app/(main)/projects/page.tsx#L204)
```tsx
const [createOpen, setCreateOpen] = useState(false);
// ...
<button onClick={() => setCreateOpen(true)}>+ 프로젝트 생성</button>
{createOpen && <CreateProjectDialog onClose={() => setCreateOpen(false)} />}
```

`createOpen` 이 true 일 때만 `<CreateProjectDialog />` 가 렌더링됨. (`&&` 단축평가 활용)

---

## 2-6. State 의 주의사항

### ① 직접 변경 금지 — 항상 `set` 함수로
```tsx
const [user, setUser] = useState({ name: "A", age: 30 });

// ❌ 직접 변경 — React 가 감지 못 함, 화면 갱신 안 됨
user.age = 31;

// ✅ 새 객체로 교체
setUser({ ...user, age: 31 });
```

> **immutable 패턴**. Java 의 `final` 필드만 가진 record/dto 를 매번 새로 만드는 느낌.
> 이래서 `...spread` 가 React 에서 매일 쓰이는 것.

### ② 비동기다 — 즉시 반영 안 됨
```tsx
const [count, setCount] = useState(0);

function handleClick() {
  setCount(count + 1);
  console.log(count);   // ← 여전히 0! 아직 안 바뀐 시점
}
```

`setCount` 는 "다음 렌더에 반영해줘" 라고 예약하는 거지, 즉시 변수를 바꾸는 게 아니다.

### ③ 이전값 기반이면 함수 형태
```tsx
// 여러 번 빠르게 클릭 시 안전하지 않음
setCount(count + 1);

// 함수형 — 이전 값을 보장받음
setCount((prev) => prev + 1);
```

---

## 2-7. Effect — 외부 세계와의 동기화 (`useEffect`)

```tsx
import { useEffect } from "react";

function MyComponent({ userId }: { userId: number }) {
  useEffect(() => {
    // 컴포넌트가 화면에 나타난 후, userId 가 바뀔 때마다 실행
    console.log("user changed:", userId);

    return () => {
      // cleanup — 컴포넌트가 사라지거나, 다음 effect 실행 전에 호출
      console.log("cleanup");
    };
  }, [userId]);   // ← 의존성 배열: 이 값이 바뀔 때만 다시 실행

  return <div>...</div>;
}
```

### 의존성 배열 패턴
| 패턴 | 의미 |
|---|---|
| `[]` | 마운트 시 1번만 실행 (Java 의 `@PostConstruct` 비슷) |
| `[a, b]` | a 또는 b 가 바뀔 때 실행 |
| 생략 | 매 렌더마다 실행 (거의 안 씀, 주의) |

> **현대 React 에서 useEffect 는 점점 적게 쓴다.**
> 데이터 페칭은 TanStack Query 가, 폼 상태는 useState 가, 전역 상태는 Zustand 가 대신한다.
> useEffect 는 "정말 외부 시스템과 동기화할 때만" 쓰는 최후의 수단으로 쓴다.

---

## 2-8. 이벤트 핸들링

```tsx
function Form() {
  const [text, setText] = useState("");

  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      // e: React 가 감싼 이벤트 객체 (브라우저 이벤트와 거의 동일)
    />
  );
}
```

이게 **Controlled Component** 패턴이다.
- `value={text}` 로 화면 = state 묶음
- `onChange` 로 state 갱신
- → 둘이 항상 동기화

> JSP 의 `<input type="text" value="${name}" />` 와 비슷하지만, 실시간으로 양방향 동기.
> Java 의 Swing 의 `JTextField + DocumentListener` 와 본질이 같다.

### 우리 프로젝트 — [src/app/(main)/projects/page.tsx:131-138](../../src/app/(main)/projects/page.tsx#L131-L138)
```tsx
<input
  className="sp-input"
  placeholder="프로젝트명을 입력하세요"
  value={name}
  onChange={(e) => setName(e.target.value)}
  autoFocus
/>
```

---

## 2-9. 조건부 렌더링 패턴 4가지

```tsx
// 1. 삼항 연산자
{loading ? <Spinner /> : <Content />}

// 2. && 단축평가
{loading && <Spinner />}
{items.length > 0 && <List items={items} />}

// 3. early return
function MyPage() {
  if (loading) return <Spinner />;
  if (error)   return <Error />;
  return <Content />;
}

// 4. 함수 추출
function renderStatus() {
  if (loading) return "로딩중";
  if (error)   return "에러";
  return "완료";
}
return <div>{renderStatus()}</div>;
```

---

## 2-10. 리스트 렌더링 — `key` 가 핵심

```tsx
{items.map((item) => (
  <div key={item.id}>{item.name}</div>
//      ^^^^^^^^^^^^^ 필수!
))}
```

`key` 없으면 React 가 경고하고, 잘못된 key 는 미묘한 버그를 만든다.

### key 는 무엇이어야 하나
| 추천도 | 값 | 이유 |
|---|---|---|
| ✅ 최선 | DB id (`item.id`) | 안정적, 유일 |
| ⚠️ 임시 | UUID 새로 생성 | 매 렌더 다른 key → 사라졌다 다시 생김 |
| ❌ 금지 | `index` | 항목 순서 바뀌면 key 와 데이터 불일치 |

### 우리 프로젝트 — [src/app/(main)/projects/page.tsx:290-292](../../src/app/(main)/projects/page.tsx#L290-L292)
```tsx
{items.map((item, i) => (
  <div key={item.projectId}> ... </div>   // ← projectId 가 key
))}
```

---

## 2-11. 컴포넌트 분리 기준

| 기준 | 분리해야 함 |
|---|---|
| 같은 JSX 가 2번 이상 반복 | 컴포넌트로 추출 |
| 한 파일이 300줄 초과 | 분리 검토 |
| state 5개 이상 | 커스텀 훅 검토 |

> **억지로 쪼개서 추적이 어려워지면 그냥 둔다.** ([.claude/develop/A-NEXTJS-기술규칙.md](../../.claude/develop/A-NEXTJS-기술규칙.md) 인용)

우리 [src/app/(main)/projects/page.tsx](../../src/app/(main)/projects/page.tsx) 한 파일 안에:
- `RoleBadge` (배지 한 조각)
- `CreateProjectDialog` (생성 모달)
- `ProjectsPage` (export default 페이지)
- `ProjectsPageInner` (Suspense 안의 본체)

이렇게 **같이 쓰일 작은 컴포넌트는 같은 파일에 둔다.** 따로 폴더 만들지 않음.

---

## 2-12. Hook 의 규칙 (절대)

`useState`, `useEffect`, `useQuery` 등 `use` 로 시작하는 함수는 **Hook** 이다.

### 규칙
1. **함수 컴포넌트 최상단에서만 호출.** if/for 안에서 호출 금지.
2. **항상 같은 순서로 호출되어야 한다.**

```tsx
// ❌ 절대 안 됨
function Bad({ ok }: { ok: boolean }) {
  if (ok) {
    const [x] = useState(0);   // ← 조건부 hook 호출
  }
  return <div />;
}

// ✅ 항상 호출
function Good({ ok }: { ok: boolean }) {
  const [x] = useState(0);     // 무조건 호출
  if (!ok) return null;
  return <div>{x}</div>;
}
```

> 왜? React 는 hook 의 "호출 순서"로 어느 state 가 어느 변수인지 추적한다.
> 순서가 바뀌면 state 가 뒤섞인다.

---

## 2-12+. `useRef` — 렌더와 상관없이 값 보관하기

`useState` 의 형제. 차이가 명확하다.

| 비교 | useState | useRef |
|---|---|---|
| 값 변경 시 리렌더? | ✅ 한다 | ❌ 안 한다 |
| 접근 방법 | `[x, setX]` | `ref.current` |
| 용도 | 화면에 영향 주는 값 | DOM 참조, 타이머 ID, "이전 값 기억" |

### DOM 참조 (가장 흔한 용도)
```tsx
function AutoFocusInput() {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();   // 마운트 후 자동 포커스
  }, []);

  return <input ref={inputRef} />;
}
```

> JSP 시절의 `document.getElementById(...)` 자리. **선언적**으로 같은 일을 한다.

### 값 보관 (리렌더 없이)
```tsx
function Stopwatch() {
  const timerId = useRef<number | null>(null);

  function start() {
    timerId.current = window.setInterval(...);
  }
  function stop() {
    if (timerId.current) clearInterval(timerId.current);
  }
  // ...
}
```

타이머 ID는 화면에 표시 안 하므로 useRef 가 적절. useState 면 매번 리렌더 발생.

### 우리 프로젝트 검색 사례
[src/components/](../../src/components/) 의 다이얼로그/에디터 컴포넌트 다수가 useRef 사용. ESC 키 이벤트, 외부 클릭 감지, 자동 포커스 등.

---

## 2-13. Server Component vs Client Component (Next.js 만의 개념)

```tsx
// 기본 = Server Component (서버에서만 실행)
// → DB 접근 가능, useState 못 씀
export default function ServerPage() {
  return <div>Hello</div>;
}
```

```tsx
"use client";   // ← 첫 줄에 명시
// = Client Component (브라우저에서 실행)
// → useState/useEffect 가능, DB 직접 접근 불가
export default function ClientPage() {
  const [x, setX] = useState(0);
  return <button onClick={() => setX(x + 1)}>{x}</button>;
}
```

> 이건 Chapter 3 에서 본격적으로 다룬다. 지금은 **첫 줄에 `"use client"` 가 있냐 없냐** 로 운명이 갈린다는 것만 기억.

우리 [src/app/(main)/projects/page.tsx:1](../../src/app/(main)/projects/page.tsx#L1) 의 첫 줄:
```tsx
"use client";
```
→ 이 페이지는 브라우저에서 동작한다는 선언. `useState`, `onClick` 다 쓸 수 있다.

---

## 2-14. 한 줄 요약

> 컴포넌트는 함수다. 함수는 props 받아 JSX 를 반환한다. state 가 바뀌면 함수가 다시 호출된다. 끝.

---

다음 챕터 → [03_NextJS_AppRouter.md](./03_NextJS_AppRouter.md)
이전 챕터 ← [01_TypeScript_기본.md](./01_TypeScript_기본.md)
