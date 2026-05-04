# Chapter 6. Prisma — MyBatis 의 자리

> **이 챕터의 정체**: Prisma 는 **타입 안전 ORM**. MyBatis 가 하던 일을 거의 다 한다.
> 중요: Prisma 는 **TypeScript 라이브러리**. SQL 매퍼가 아니라 **메서드 호출 → SQL 자동 생성**.

---

## 6-1. MyBatis vs Prisma 한눈에

| 비교 | MyBatis | Prisma |
|---|---|---|
| 매핑 정의 | XML (Mapper.xml) | `schema.prisma` 파일 (DSL) |
| 쿼리 작성 | XML 안에 SQL 직접 | TypeScript 메서드 (`findMany`, `create`...) |
| 타입 | 자동 생성 안됨 → DTO 직접 만듦 | **DB 스키마에서 자동 생성** |
| 결과 매핑 | resultMap 으로 직접 | 자동 |
| JOIN | XML 의 `<association>`, `<collection>` | `include`, `select` 옵션 |
| 동적 쿼리 | `<if>`, `<choose>` | TS 객체 동적 조립 (`...spread`) |
| 트랜잭션 | `@Transactional` | `prisma.$transaction(async (tx) => {})` |
| Raw SQL | 모든 쿼리가 SQL | `$queryRaw`, `$executeRaw` (가끔만) |

> **차이의 본질**: MyBatis 는 "SQL 을 잘 쓰게 도와주는 도구". Prisma 는 "DB 를 객체처럼 쓰게 해주는 도구".

---

## 6-2. 스키마 정의 — `schema.prisma`

### MyBatis 시절
- DDL 따로
- 도메인 클래스 따로 (`User.java`)
- Mapper XML 따로 (`UserMapper.xml`)

### Prisma — 한 파일로
[prisma/schema.prisma](../../prisma/schema.prisma) 일부:

```prisma
model TbCmMember {
  mber_id           String     @id @default(uuid())
  email_addr        String?    @unique
  pswd_hash         String?
  mber_nm           String?
  mber_sttus_code   String     @default("UNVERIFIED")
  plan_code         String     @default("FREE")
  join_dt           DateTime   @default(now())

  // 관계 (JOIN 대상)
  refreshTokens     TbCmRefreshToken[]
  projectMembers    TbPjProjectMember[]

  @@map("tb_cm_member")    // 실제 DB 테이블명 매핑
}
```

| 표기 | 의미 |
|---|---|
| `String?` | nullable |
| `@id` | PK |
| `@default(uuid())` | 기본값 자동 UUID |
| `@unique` | UNIQUE 제약 |
| `[]` | 1:N 관계의 N 쪽 |
| `@@map("..")` | 모델명과 실제 테이블명 분리 |

### `prisma generate` 가 하는 일
```bash
npm run db:generate
```
→ `node_modules/@prisma/client/` 안에 **타입 정의 + 쿼리 함수**가 자동 생성됨.

이게 핵심이다. **DB 스키마가 곧 TS 타입.** 쿼리 결과의 타입이 자동으로 추론됨.

---

## 6-3. 싱글톤 패턴 — Hot Reload 함정

[src/lib/prisma.ts](../../src/lib/prisma.ts):
```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

### 왜 이렇게?
Next.js dev 서버는 **파일 수정 시 모듈을 다시 로드**한다.
`new PrismaClient()` 를 매번 호출하면 DB 연결이 계속 쌓여 **연결 폭발**.

→ `globalThis` 에 보관해서 hot reload 거쳐도 같은 인스턴스 재사용.

> Spring 의 `@Configuration` + `@Bean` 으로 싱글톤 만드는 것과 의도가 같다.
> Java 는 컨테이너가 알아서 해주지만, Node.js 는 직접 해야 함.

> 우리 [.claude/develop/A-NEXTJS-기술규칙.md](../../.claude/develop/A-NEXTJS-기술규칙.md) 5번 규칙에 그대로 수록된 패턴.

---

## 6-4. 기본 CRUD — MyBatis 비교

### 단건 조회
```xml
<!-- MyBatis -->
<select id="findById" resultType="User">
  SELECT * FROM tb_cm_member WHERE mber_id = #{id}
</select>
```

```ts
// Prisma
const user = await prisma.tbCmMember.findUnique({
  where: { mber_id: id },
});
// user 의 타입 = TbCmMember | null (자동)
```

### 목록 조회
```xml
<!-- MyBatis -->
<select id="findAll" resultType="User">
  SELECT * FROM tb_cm_member WHERE mber_sttus_code = 'ACTIVE'
  ORDER BY join_dt DESC
</select>
```

```ts
// Prisma
const users = await prisma.tbCmMember.findMany({
  where:   { mber_sttus_code: "ACTIVE" },
  orderBy: { join_dt: "desc" },
});
```

### 생성
```ts
const created = await prisma.tbPjProject.create({
  data: {
    prjct_nm:      "새 프로젝트",
    creat_mber_id: "user-123",
  },
});
// created 는 INSERT 후 반환된 row (타입 완전 추론)
```

### 수정
```ts
await prisma.tbPjProject.update({
  where: { prjct_id: id },
  data:  { prjct_nm: "변경됨", mdfcn_dt: new Date() },
});
```

### 삭제 (논리삭제 권장)
```ts
// 우리 컨벤션: 가능하면 use_yn = 'N' 으로 논리삭제
await prisma.tbPjProject.update({
  where: { prjct_id: id },
  data:  { use_yn: "N" },
});

// 물리삭제는 정말 필요할 때만
await prisma.tbPjProject.delete({ where: { prjct_id: id } });
```

---

## 6-5. JOIN — `include` vs `select`

### MyBatis
```xml
<resultMap id="ProjectWithMembers" type="Project">
  <id property="id" column="prjct_id"/>
  <collection property="members" ofType="Member">
    <id property="mberId" column="mber_id"/>
  </collection>
</resultMap>
```

### Prisma — `include` (관계 끌어오기)
```ts
const project = await prisma.tbPjProject.findUnique({
  where: { prjct_id: id },
  include: {
    members: true,                    // ← 관계 모두 가져옴
  },
});

// project.members 사용 가능 (TbPjProjectMember[] 타입)
```

### `select` (필드 골라잡기)
```ts
const project = await prisma.tbPjProject.findUnique({
  where: { prjct_id: id },
  select: {
    prjct_id: true,
    prjct_nm: true,                   // 이 두 개만
    members: {                        // 관계도 골라잡을 수 있음
      select: { mber_id: true, role_code: true },
    },
  },
});
```

### 실전 — [src/app/api/projects/route.ts:20-40](../../src/app/api/projects/route.ts#L20-L40)
```ts
const memberships = await prisma.tbPjProjectMember.findMany({
  where: {
    mber_id: auth.mberId,
    mber_sttus_code: "ACTIVE",
  },
  include: {
    project: {
      select: {                     // 관계 안에서 select
        prjct_id:  true,
        prjct_nm:  true,
        client_nm: true,
        bgng_de:   true,
        end_de:    true,
        mdfcn_dt:  true,
        creat_dt:  true,
      },
    },
  },
  orderBy: { join_dt: "desc" },
});
```

> SQL 한 줄도 안 썼는데 타입까지 완벽하게 추론된다. 이게 Prisma 의 매력.

---

## 6-6. 동적 쿼리 — Spread 로 조립

### MyBatis 의 `<if>` `<choose>`
```xml
<select id="search">
  SELECT * FROM tb_pj_project
  <where>
    <if test="search != null">prjct_nm LIKE CONCAT('%', #{search}, '%')</if>
    <if test="status != null">AND mber_sttus_code = #{status}</if>
  </where>
</select>
```

### Prisma — TS 객체 조립
```ts
const where = {
  ...(search ? { prjct_nm: { contains: search } } : {}),
  ...(status ? { mber_sttus_code: status }        : {}),
};

const items = await prisma.tbPjProject.findMany({ where });
```

> Spread 가 동적 쿼리의 무기.
> 우리 [src/app/api/projects/route.ts:23](../../src/app/api/projects/route.ts#L23) 의 패턴이 정확히 이것.

---

## 6-7. 페이지네이션

```ts
const page = 1, pageSize = 20;

const [items, total] = await Promise.all([
  prisma.tbPjProject.findMany({
    where:   { use_yn: "Y" },
    orderBy: { creat_dt: "desc" },
    take:    pageSize,
    skip:    (page - 1) * pageSize,
  }),
  prisma.tbPjProject.count({ where: { use_yn: "Y" } }),
]);

// Promise.all 로 병렬 — 우리 5번 규칙 (Chapter 1 참고)
```

| Prisma | SQL |
|---|---|
| `take: 20` | `LIMIT 20` |
| `skip: 40` | `OFFSET 40` |

---

## 6-8. 트랜잭션 — `@Transactional` 의 자리

### Spring
```java
@Transactional
public Project createWithOwner(...) {
  Project p = projectMapper.insert(...);
  memberMapper.insert(p.getId(), userId, "OWNER");
  return p;
}
```

### Prisma — `$transaction`
```ts
const project = await prisma.$transaction(async (tx) => {
  const created = await tx.tbPjProject.create({ data: { ... } });

  await tx.tbPjProjectMember.create({
    data: {
      prjct_id: created.prjct_id,
      mber_id:  userId,
      role_code: "OWNER",
    },
  });

  return created;
});
```

### 핵심 규칙
- **콜백 안에서는 `prisma` 가 아니라 `tx` 를 사용해야** 한다. 안 그러면 같은 트랜잭션 안에 안 들어감.
- 콜백이 `throw` 하면 자동 ROLLBACK.
- 정상 리턴하면 COMMIT.

### 우리 프로젝트 실전 — [src/app/api/projects/route.ts:97-164](../../src/app/api/projects/route.ts#L97-L164)
```ts
const project = await prisma.$transaction(async (tx) => {
  const created = await tx.tbPjProject.create({ data: { ... } });

  await tx.tbPjProjectMember.create({
    data: {
      prjct_id: created.prjct_id,
      mber_id:  auth.mberId,
      role_code: "OWNER",
      // ...
    },
  });

  await tx.tbPjProjectSettings.create({ data: { ... } });

  // 시스템 템플릿 → 프로젝트 설정 복사
  const sysTmpls = await tx.tbSysConfigTemplate.findMany({ where: { ... } });
  if (sysTmpls.length > 0) {
    await tx.tbPjProjectConfig.createMany({
      data: sysTmpls.map((t) => ({ ... })),
      skipDuplicates: true,
    });
  }

  return created;
});
```

> 한 트랜잭션 안에 4개 테이블에 걸친 작업이 들어있다. 하나라도 실패하면 전체 ROLLBACK.

---

## 6-9. Raw SQL — 정말 필요할 때만

```ts
// $queryRaw — SELECT 류 (결과 반환)
const result = await prisma.$queryRaw<{ count: bigint }[]>`
  SELECT COUNT(*) as count FROM tb_pj_project WHERE prjct_nm LIKE ${`%${search}%`}
`;

// $executeRaw — INSERT/UPDATE/DELETE (영향 행수 반환)
await prisma.$executeRaw`UPDATE tb_pj_project SET use_yn = 'N' WHERE prjct_id = ${id}`;
```

> 백틱 (template literal) + `${}` 는 **자동으로 parameterized query** 가 된다.
> 그래서 SQL Injection 안전. **문자열 concat (`+`) 로는 절대 쓰지 말 것.**

---

## 6-10. 자동 생성 타입 활용

```ts
import type { Prisma, TbPjProject } from "@prisma/client";

// 모델 타입 (테이블 row 타입)
const p: TbPjProject = await prisma.tbPjProject.findUnique(...);

// include 결과 타입 자동 합성
type ProjectWithMembers = Prisma.TbPjProjectGetPayload<{
  include: { members: true }
}>;

// where 입력 타입
function buildWhere(search?: string): Prisma.TbPjProjectWhereInput {
  return search ? { prjct_nm: { contains: search } } : {};
}
```

> Java 의 JPA 처럼 엔티티가 따로 있는 게 아니라, **타입이 곧 엔티티**.
> "DTO 100개 만드는 시간"을 안 써도 된다는 게 가장 큰 차이.

---

## 6-11. 흔한 함정

### ① 트랜잭션 콜백에서 `prisma` 잘못 사용
```ts
// ❌ 같은 트랜잭션 아님
await prisma.$transaction(async (tx) => {
  await tx.userA.create(...);
  await prisma.userB.create(...);    // ← prisma 직접 호출 = 다른 connection
});

// ✅
await prisma.$transaction(async (tx) => {
  await tx.userA.create(...);
  await tx.userB.create(...);
});
```

### ② `null` 과 `undefined` 차이
```ts
// undefined → 필드 무시
update({ where: { id: 1 }, data: { name: undefined } });   // name 은 안 바뀜

// null → 컬럼을 NULL 로 설정
update({ where: { id: 1 }, data: { name: null } });        // name = NULL
```

### ③ N+1 — `include` 빠뜨림
```ts
// ❌ N+1 — 각 user 마다 추가 쿼리
const users = await prisma.user.findMany();
for (const u of users) {
  const orders = await prisma.order.findMany({ where: { userId: u.id } });
}

// ✅ 한 번에
const users = await prisma.user.findMany({ include: { orders: true } });
```

---

## 6-12. 이 챕터 요약

| 일 | MyBatis | Prisma |
|---|---|---|
| 스키마 정의 | DDL + DTO + Mapper.xml 따로 | `schema.prisma` 한 파일 |
| 쿼리 작성 | XML 안 SQL | TS 메서드 호출 |
| 타입 보장 | 직접 DTO 작성 | DB 스키마에서 자동 생성 |
| 동적 쿼리 | `<if>`, `<choose>` | spread |
| 트랜잭션 | `@Transactional` | `prisma.$transaction(async tx => {})` |
| 학습곡선 | SQL 만 알면 됨 | TS + Prisma DSL |

> **MyBatis 가 SQL 을 *잘 쓰게* 해준다면, Prisma 는 *덜 쓰게* 해준다.**
> 복잡한 쿼리는 `$queryRaw` 로 가능. 일반 CRUD 95% 는 메서드 한 줄.

---

다음 챕터 → [07_프로젝트구조_분석.md](./07_프로젝트구조_분석.md)
이전 챕터 ← [05_상태관리.md](./05_상태관리.md)
