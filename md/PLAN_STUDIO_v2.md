# PRD 기획실 (Plan Studio) v2

> ## 1. 개요
| 항목 | 내용 |
|:-----|:-----|
| **메뉴명** | 기획실 |
| **비즈니스 목적** | 프로젝트당 여러 기획실(컨테이너)을 만들고, 각 기획실 안에서 다양한 기획(산출물)을 생성한다. 각 기획은 요구사항/다른 기획을 컨텍스트로 묶어 AI에게 MD·Mermaid·HTML 중 한 형식의 결과물(IA·ERD·MOCKUP·PROCESS·JOURNEY·FLOW)을 생성시킨다. 작업량이 많을 때 기획실 단위로 그룹핑하여 관리 복잡도를 낮춘다. |
| **기술 스택** | Next.js (App Router) · PostgreSQL · Prisma · Anthropic Claude API |
| **신규 테이블** | tb_ds_plan_studio, tb_ds_plan_studio_artf, tb_ds_plan_studio_ctxt |
| **기존 활용 테이블** | tb_pj_project, tb_rq_requirement, tb_rq_user_story, tb_ai_task, tb_cm_member |

## 1.1 용어 정의 (매우 중요)

| 화면 용어 | 테이블 | 의미 | 비유 |
|:---------|:------|:----|:----|
| **기획실** | `tb_ds_plan_studio` | 산출물들을 묶는 컨테이너 | 폴더 |
| **기획 / 산출물** | `tb_ds_plan_studio_artf` | 실제 작업 단위 (업무의 90%) | 폴더 안 문서 1건 |
| **기획실명** | `plan_studio_nm` | 컨테이너 이름 | "회원관리 기획실" |
| **기획명** | `artf_nm` | 작업 단위 이름 | "시스템 정보 구조도" |

## 2. 화면 목록
| 화면ID | 화면명 | URL | 유형 |
|:-------|:-------|:----|:-----|
| PID-PS-01 | 기획실 목록 | `/projects/{projectId}/plan-studio` | LIST |
| PID-PS-02 | 기획실 생성 팝업 | - | POPUP |
| PID-PS-03 | 기획실 상세 (산출물 목록 + 편집) | `/projects/{projectId}/plan-studio/{planStudioId}` | DETAIL |
| PID-PS-04 | 컨텍스트 추가 팝업 (요구사항) | - | POPUP |
| PID-PS-05 | 컨텍스트 추가 팝업 (기획보드=다른 산출물) | - | POPUP |

> PID-PS-03는 단일 페이지 안에 **좌측 산출물 목록 + 상단 헤더 + 중앙 편집 폼 + 우측 결과 뷰어**가 모두 배치된 작업 화면이다 (이미지 1 참고).

## 3. 화면 흐름
```
[기획실 목록] ──(+ 생성 버튼)──▶ [기획실 생성 팝업] ──(확인)──▶ [기획실 상세]
[기획실 목록] ──(행 클릭)──────▶ [기획실 상세]
[기획실 상세] ──(+ 새 기획)──▶ [신규 산출물 편집 상태]
[기획실 상세] ──(목록 행 클릭)──▶ [기존 산출물 편집 상태]
[기획실 상세] ──(요구사항 추가)──▶ [컨텍스트 추가 팝업 (요구사항)]
[기획실 상세] ──(기획보드 추가)──▶ [컨텍스트 추가 팝업 (기획보드)]
[기획실 상세] ──(AI 생성)────▶ [확인 다이얼로그] ──▶ [저장 + AI 호출] ──▶ [결과 본문 갱신]
[기획실 상세] ──(저장)──────▶ [산출물 UPDATE]
```

| 이동 | 전달 파라미터 | 동작 |
|:-----|:-------------|:-----|
| 목록 → 생성 팝업 | - | + 생성 버튼 |
| 생성 팝업 → 상세 | planStudioId | 기획실명 입력 후 확인 |
| 목록 → 상세 | planStudioId | 행 클릭 |
| 상세 → 컨텍스트 팝업 | artfId, 현재 선택 refId 목록 | 추가 버튼 |
| 상세 → AI 생성 | 현재 폼 전체 | AI 생성 버튼 |

## 4. 권한 정의
| 기능 | VIEWER | PM/DESIGNER/DEVELOPER | ADMIN | OWNER |
|:-----|:-------|:----------------------|:------|:------|
| 기획실 목록/상세 조회 | ✅ | ✅ | ✅ | ✅ |
| 기획실 생성·삭제 | ❌ | ✅ | ✅ | ✅ |
| 산출물(기획) 생성·수정·삭제 | ❌ | ✅ | ✅ | ✅ |
| AI 생성 | ❌ | ✅ | ✅ | ✅ |
| 좋은 설계 표시 | ❌ | ✅ | ✅ | ✅ |

## 5. 참조 테이블
- `tb_ds_plan_studio`
- `tb_ds_plan_studio_artf`
- `tb_ds_plan_studio_ctxt`
- `tb_ai_task` (AI 호출 이력)
- `tb_rq_requirement`, `tb_rq_user_story` (REQ 컨텍스트 + 자동 동봉)
- `tb_pj_project` (프로젝트 소속)
- `tb_cm_member` (등록자/수정자 표시명)

## 6. 코드값 정의 (앱 상수)

```typescript
// constants/planStudio.ts

// 기획 구분 (artf_div_code)
export const ARTF_DIV = {
  IA:      { code: 'IA',      name: '정보구조도',   group: '기획' },
  JOURNEY: { code: 'JOURNEY', name: '사용자여정',   group: '기획' },
  FLOW:    { code: 'FLOW',    name: '화면흐름',     group: '기획' },
  MOCKUP:  { code: 'MOCKUP',  name: '목업',         group: '기획' },
  ERD:     { code: 'ERD',     name: 'ERD',          group: '개발' },
  PROCESS: { code: 'PROCESS', name: '업무프로세스', group: '개발' },
} as const;

// 산출물 형식 (artf_fmt_code) - 택 1
export const ARTF_FMT = {
  MD:      { code: 'MD',      name: '마크다운' },
  MERMAID: { code: 'MERMAID', name: 'Mermaid' },
  HTML:    { code: 'HTML',    name: 'HTML' },
} as const;

// 컨텍스트 유형 (ctxt_ty_code)
export const CTXT_TY = {
  REQ:    { code: 'REQ',    name: '요구사항' },
  ARTF:   { code: 'ARTF',   name: '기획보드' },   // 다른 산출물 자기참조
  UNIT:   { code: 'UNIT',   name: '단위업무' },   // 향후
  SCREEN: { code: 'SCREEN', name: '화면설계' },   // 향후
} as const;

// AI 태스크 참조 유형
export const AI_TASK_REF_TY_ARTF = 'PLAN_STUDIO_ARTF';
export const AI_TASK_TY_ARTF_GENERATE = 'PLAN_STUDIO_ARTF_GENERATE';
```

---

## PID-PS-01 기획실 목록

### AR-PS-01 기획실 목록 그리드 (GRID)

**유형:** GRID

**UI 구조**
```
+──────────────────────────────────────────────────────────────────+
| 기획실                                              [+ 생성]     |
|──────────────────────────────────────────────────────────────────|
| 기획실ID    | 기획실명             | 산출물수 | 수정일시        |
| PB-00001    | 회원관리 기획실      | 12       | 2026-02-01     |
| PB-00002    | 주문 프로세스 기획실 | 5        | 2026-01-31     |
+──────────────────────────────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 기획실ID | text | plan_studio_display_id (PB-NNNNN) | - |
| 기획실명 | text (link) | 클릭 시 기획실 상세로 이동 | - |
| 산출물수 | number | 이 기획실에 속한 artf 총 개수 | - |
| 수정일시 | text | YYYY-MM-DD HH:mm | - |
| 삭제 | button (icon, danger) | 행 hover 시 노출, confirm 후 삭제 | - |
| 생성 | button (primary) | 생성 팝업 표시 | - |

#### FID-PS-01 기획실 목록 조회

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/plan-studios` |
| **트리거** | 화면 진입 시 자동 |

**Output**
```typescript
{
  items: Array<{
    planStudioId: string,
    planStudioDisplayId: string,   // PB-00001
    planStudioNm: string,
    artfCount: number,             // COUNT(tb_ds_plan_studio_artf)
    mdfcnDt: string | null,
    creatDt: string,
  }>,
  totalCount: number,
}
```

**처리 로직**
```
1. 목록 API 호출
2. 서버 처리:
   a. tb_ds_plan_studio 에서 prjct_id = 현재 프로젝트, creat_dt DESC
   b. 서브쿼리 또는 LEFT JOIN GROUP BY 로 artf_count 계산
      SELECT ps.*, COALESCE(COUNT(a.artf_id), 0) AS artf_count
      FROM tb_ds_plan_studio ps
      LEFT JOIN tb_ds_plan_studio_artf a ON a.plan_studio_id = ps.plan_studio_id
      WHERE ps.prjct_id = ?
      GROUP BY ps.plan_studio_id
      ORDER BY ps.creat_dt DESC
3. 0건이면 '등록된 기획실이 없습니다. 생성 버튼을 눌러 시작하세요' 안내
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_ds_plan_studio | plan_studio_id, plan_studio_display_id, plan_studio_nm, mdfcn_dt, creat_dt | 목록 본체 |
| tb_ds_plan_studio_artf | plan_studio_id | COUNT(*) |

#### FID-PS-02 기획실 삭제

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | DELETE |
| **API** | `DELETE /api/projects/{projectId}/plan-studios/{planStudioId}` |
| **트리거** | 삭제 버튼 → confirm |

**처리 로직**
```
1. confirm('기획실 내 모든 산출물과 컨텍스트가 함께 삭제됩니다. 계속하시겠습니까?')
2. API 호출
3. 서버 처리:
   a. tb_ds_plan_studio DELETE
      → CASCADE: tb_ds_plan_studio_artf 삭제
      → CASCADE: tb_ds_plan_studio_ctxt 삭제
   b. tb_ai_task 는 CASCADE 없음, 이력 보존
4. 성공 시 목록 새로고침
```

---

## PID-PS-02 기획실 생성 팝업

### AR-PS-02 생성 팝업 폼 (POPUP)

**유형:** POPUP

**UI 구조**
```
+──────────────────────────────────+
| 새 기획실 생성                    |
|──────────────────────────────────|
| 기획실명을 입력해 주세요          |
| [___________________________]   |
|                                  |
|           [취소]  [확인]         |
+──────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 기획실명 | text input | 필수 | - |
| 취소 | button (secondary) | 팝업 닫기 | - |
| 확인 | button (primary) | 생성 후 상세 이동 | - |

#### FID-PS-03 기획실 생성

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | INSERT |
| **API** | `POST /api/projects/{projectId}/plan-studios` |
| **트리거** | 확인 버튼 |

**Input**
| 파라미터 | 타입 | 필수 | 설명 |
|:---------|:-----|:-----|:-----|
| planStudioNm | string | Y | 기획실명 |

**Output**
```typescript
{ planStudioId: string, planStudioDisplayId: string }
```

**처리 로직**
```
1. 기획실명 공백 검증 (trim 후 길이 > 0)
2. API 호출
3. 서버 처리 (단일 트랜잭션):
   a. plan_studio_id = nanoid() 또는 cuid()
   b. plan_studio_display_id 채번:
      SELECT COALESCE(MAX(CAST(SUBSTRING(plan_studio_display_id FROM 4) AS INT)), 0) + 1
      FROM tb_ds_plan_studio
      WHERE prjct_id = ? AND plan_studio_display_id LIKE 'PB-%'
      → 'PB-' + LPAD(result, 5, '0')  (예: PB-00001)
   c. tb_ds_plan_studio INSERT (
        plan_studio_id, prjct_id, plan_studio_display_id, plan_studio_nm,
        creat_mber_id, creat_dt
      )
4. 성공 시 router.push(`/projects/${projectId}/plan-studio/${planStudioId}`)
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_ds_plan_studio | 전체 INSERT 컬럼 | 신규 등록 |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 기획실명 공백 | 400 | 기획실명을 입력해 주세요 |
| 서버 오류 | 500 | 생성 중 오류가 발생했습니다 |

---

## PID-PS-03 기획실 상세 (이미지 1 화면)

단일 페이지 안에 여러 영역이 배치된 작업 화면:

```
+──────────────────────────────────────────────────────────────────────────────+
| ← 기획실명 (PB-00001)                              [AI 생성]  [저장]          |
|──────────────────────────────────────────────────────────────────────────────|
| AR-PS-03 기획명 입력 + 구분 + [+ 새 기획]                                    |
|──────────────────────────────────────────────────────────────────────────────|
| AR-PS-04 산출물 그리드                     |  AR-PS-07 결과 뷰어             |
| 기획명  | 구분  | AI상태 | 액션 | 수정일시 |  [미리보기][원문편집]             |
| 시정보.. | IA    | 대기   | ...  | 02-01    |  [MD][Mermaid][HTML]            |
| 전체..  | PROC  | 완료   | ...  | 01-31    |  [확대] [★]                     |
|──────────────────────────────────|          |  ┌────────────────────────┐    |
| AR-PS-05 컨텍스트                |          |  │                         │    |
| [컨텍스트]                       |          |  │   (본문 렌더링)          │    |
|  요구사항  [+ 요구사항 추가]     |          |  │                         │    |
|  [RQ-00001 x] [RQ-00002 x] ...   |          |  └────────────────────────┘    |
|  기획보드  [+ 기획보드 추가]     |          |                                 |
|  [PB-00001 시정보구 x] ...        |          |                                 |
|──────────────────────────────────|          |                                 |
| AR-PS-06 상세 아이디어 + 지시사항|          |                                 |
| 상세 아이디어 (마크다운)          |          |                                 |
| [편집 | 미리보기]                 |          |                                 |
| [____________________________]   |          |                                 |
|                                  |          |                                 |
| AI 지시사항 (comment)            |          |                                 |
| [____________________________]   |          |                                 |
+──────────────────────────────────────────────────────────────────────────────+
```

> **핵심:** 산출물 그리드에서 행 클릭 시, 해당 artf의 데이터가 AR-PS-03/05/06/07 전부에 로드된다. 즉 좌측은 목록 + 편집 폼이 같은 페이지에 있고, 우측은 결과 뷰어다.

### AR-PS-03 기획명·구분 헤더 (FORM)

**유형:** FORM

**UI 구조**
```
+──────────────────────────────────────────────────────────+
| 기획명: [___________________]  구분: [IA ▾]  [+ 새 기획] |
+──────────────────────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 기획명 | text input | artf_nm, 필수 | - |
| 구분 | select (그룹핑) | artf_div_code | IA |
| + 새 기획 | button (primary) | 현재 편집 중 폼 초기화 → 신규 상태 | - |

**구분 select 옵션:**
```
─ 기획 ─
  IA      정보구조도
  JOURNEY 사용자여정
  FLOW    화면흐름
  MOCKUP  목업
─ 개발 ─
  ERD     ERD
  PROCESS 업무프로세스
```

### AR-PS-04 산출물 그리드 (GRID)

**유형:** GRID

**UI 구조**
```
+────────────────────────────────────────────────────────────────+
| 기획명           | 구분    | AI상태  | 액션     | 수정일시      |
| 시스템 정보 구조도 | IA      | 대기    | 창 팝 X  | 2026-02-01    |
| 전체 프로세스    | PROCESS | 생성완료 | 창 팝 X  | 2026-01-31    |
| 전체 요구사항 목업 | MOCKUP  | 작업중  | 창 팝 X  | 2026-01-22    |
+────────────────────────────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 기획명 | text (link) | 클릭 시 해당 artf를 편집 폼에 로드 | - |
| 구분 | badge | artf_div_code | - |
| AI 상태 | badge | 최신 tb_ai_task 기준 (PENDING/PROCESSING/COMPLETED/FAILED/NONE) | - |
| 창 | button (icon) | 새 탭으로 해당 artf 단독 뷰 (옵션) | - |
| 팝 | button (icon) | 모달로 원문 크게 보기 | - |
| X | button (danger) | confirm 후 artf 삭제 | - |
| 수정일시 | text | YYYY-MM-DD | - |

#### FID-PS-04 산출물 목록 조회

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/plan-studios/{planStudioId}` |
| **트리거** | 화면 진입 시 자동 (기획실 메타 + 산출물 목록 통합 조회) |

**Output**
```typescript
{
  planStudio: {
    planStudioId: string,
    planStudioDisplayId: string,
    planStudioNm: string,
  },
  artifacts: Array<{
    artfId: string,
    artfNm: string,
    artfDivCode: string,
    artfFmtCode: string,
    goodDesignYn: 'Y' | 'N',
    aiStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | null,
    mdfcnDt: string | null,
    creatDt: string,
  }>,
}
```

**처리 로직**
```
1. tb_ds_plan_studio 에서 plan_studio_id 기준 1건 조회 (없으면 404)
2. tb_ds_plan_studio_artf 목록 조회 (plan_studio_id=?, creat_dt DESC)
3. 각 artf 마다 최신 AI 상태 조회:
   SELECT task_sttus_code
   FROM tb_ai_task
   WHERE ref_ty_code = 'PLAN_STUDIO_ARTF' AND ref_id = artf_id
   ORDER BY req_dt DESC LIMIT 1
   (서브쿼리 또는 LATERAL JOIN)
4. aiStatus 매핑 후 결과 반환
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_ds_plan_studio | plan_studio_id, plan_studio_display_id, plan_studio_nm | 기획실 메타 |
| tb_ds_plan_studio_artf | 전체 | 산출물 목록 |
| tb_ai_task | ref_ty_code, ref_id, task_sttus_code, req_dt | 최신 상태 |

#### FID-PS-05 산출물 상세 조회 (특정 행 선택 시)

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/plan-studios/{planStudioId}/artifacts/{artfId}` |
| **트리거** | 그리드 행 클릭 |

**Output**
```typescript
{
  artfId: string,
  planStudioId: string,
  artfNm: string,
  artfDivCode: string,
  artfFmtCode: string,
  artfIdeaCn: string | null,
  comentCn: string | null,
  artfCn: string | null,
  goodDesignYn: 'Y' | 'N',
  aiTaskId: string | null,
  contexts: Array<{
    ctxtId: string,
    ctxtTyCode: 'REQ' | 'ARTF',
    refId: string,
    sortOrdr: number,
    refLabel: string,       // 'RQ-00001 이메일 회원가입' or 'PB-00001 > 시스템 정보 구조도'
  }>,
  creatDt: string,
  mdfcnDt: string | null,
}
```

**처리 로직**
```
1. tb_ds_plan_studio_artf 본체 조회 (plan_studio_id 소속 검증)
2. tb_ds_plan_studio_ctxt 조회 (artf_id=?, sort_ordr ASC)
3. 각 컨텍스트 라벨 조립:
   - REQ: tb_rq_requirement LEFT JOIN → req_display_id + ' ' + req_nm
   - ARTF: tb_ds_plan_studio_artf + tb_ds_plan_studio JOIN
           → plan_studio_display_id + ' > ' + artf_nm
4. 통합 결과 반환
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_ds_plan_studio_artf | 전체 | 본체 |
| tb_ds_plan_studio_ctxt | 전체 | 컨텍스트 |
| tb_rq_requirement | req_display_id, req_nm | REQ 라벨 |
| tb_ds_plan_studio | plan_studio_display_id | ARTF 라벨 |

#### FID-PS-06 산출물 삭제

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | DELETE |
| **API** | `DELETE /api/projects/{projectId}/plan-studios/{planStudioId}/artifacts/{artfId}` |
| **트리거** | 그리드 X 버튼 → confirm |

**처리 로직**
```
1. confirm('이 기획을 삭제하시겠습니까?')
2. API 호출
3. 서버 처리: tb_ds_plan_studio_artf DELETE
   → CASCADE: tb_ds_plan_studio_ctxt 삭제
4. 성공 시 그리드 새로고침. 현재 편집 중이었으면 폼 초기화.
```

### AR-PS-05 컨텍스트 (FORM)

**유형:** FORM

**UI 구조**
```
+──────────────────────────────────────────+
| 컨텍스트                                  |
|──────────────────────────────────────────|
| 요구사항                  [+ 요구사항 추가]|
| [RQ-00001 이메일 회원가입 X] [RQ-00002 X]│
|                                          |
| 기획보드                  [+ 기획보드 추가]|
| [PB-00001 시스템 정보 구조도 X]           |
+──────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 요구사항 칩 영역 | chip list | REQ 타입 컨텍스트 | - |
| 요구사항 추가 | button | PID-PS-04 팝업 | - |
| 기획보드 칩 영역 | chip list | ARTF 타입 컨텍스트 | - |
| 기획보드 추가 | button | PID-PS-05 팝업 | - |

#### FID-PS-07 컨텍스트 칩 추가/제거 (클라이언트 상태)

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | CLIENT_STATE |
| **API** | - (저장/AI 생성 시 일괄) |
| **트리거** | 팝업 선택 / 칩 X |

**처리 로직**
```
1. 추가:
   - 팝업에서 체크된 항목 ref 배열을 부모로 전달
   - 중복 체크: 이미 같은 (ctxtTyCode, refId) 있으면 skip
   - 자기참조 체크: ctxtTyCode='ARTF' AND refId = 현재 artfId 면 alert 후 거부
   - sort_ordr = 현재 배열 길이
2. 제거:
   - 해당 칩을 배열에서 splice, sort_ordr 재정렬
3. 변경 시 dirty 플래그 set → 저장 버튼 활성화
```

### AR-PS-06 상세 아이디어·AI 지시사항 (FORM)

**유형:** FORM

**UI 구조**
```
+──────────────────────────────────────────+
| 상세 아이디어 (AI 1순위 참조)             |
| [편집] [미리보기]                         |
| ┌──────────────────────────────────────┐ |
| │ (마크다운 에디터)                     │ |
| └──────────────────────────────────────┘ |
|                                          |
| AI 지시사항 (comment)                    |
| ┌──────────────────────────────────────┐ |
| │ (일반 텍스트영역)                     │ |
| └──────────────────────────────────────┘ |
+──────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 상세 아이디어 | markdown editor | artf_idea_cn | - |
| 편집/미리보기 토글 | tab | 마크다운 에디터 모드 | 편집 |
| AI 지시사항 | textarea | coment_cn | - |

> 클라이언트 상태만 관리. 저장은 FID-PS-08 통합 저장에서 처리.

### AR-PS-07 결과 뷰어 (PANEL)

**유형:** PANEL

**UI 구조**
```
+──────────────────────────────────────────+
| [미리보기][원문편집]  [MD][Mermaid][HTML]| [⛶] [★]
|──────────────────────────────────────────|
| ┌──────────────────────────────────────┐ |
| │                                      │ |
| │   (fmt_code에 따른 렌더링)            │ |
| │                                      │ |
| └──────────────────────────────────────┘ |
+──────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 미리보기/원문편집 | toggle | 미리보기는 렌더링, 원문편집은 artf_cn 직접 수정 | 미리보기 |
| 형식 탭 | tab (MD/MERMAID/HTML) | **artf_fmt_code 값 변경** (저장 시 반영) | 현재 artfFmtCode |
| 확대 | icon button | 풀스크린 모달 | - |
| ★ 좋은 설계 | toggle button | good_design_yn 토글 (Y/N) | N |

> **주의:** 형식 탭은 기존 PRD와 의미가 다르다. 한 artf는 하나의 fmt_code만 가지므로, 탭 전환은 **"다른 형식으로 AI 재생성 요청"** 이거나 **"현재 artf의 fmt를 변경하고 저장"** 이다. 아래 FID-PS-09 참고.

#### FID-PS-08 산출물 저장 (통합)

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | INSERT (신규) / UPDATE (기존) |
| **API** | `POST /api/projects/{projectId}/plan-studios/{planStudioId}/artifacts` (신규) / `PUT /api/projects/{projectId}/plan-studios/{planStudioId}/artifacts/{artfId}` (수정) |
| **트리거** | 저장 버튼 클릭 |

**Input**
```typescript
{
  artfNm: string,               // 필수
  artfDivCode: string,          // IA/JOURNEY/FLOW/MOCKUP/ERD/PROCESS
  artfFmtCode: string,          // MD/MERMAID/HTML
  artfIdeaCn: string | null,
  comentCn: string | null,
  artfCn: string | null,        // 원문편집 모드로 수정한 경우
  contexts: Array<{
    ctxtTyCode: 'REQ' | 'ARTF',
    refId: string,
    sortOrdr: number,
  }>,
}
```

**처리 로직**
```
1. artfNm 공백 검증
2. 자기참조 검증: contexts 중 (ctxtTyCode='ARTF' AND refId === 현재 artfId) 있으면 400
3. API 호출
4. 서버 처리 (단일 트랜잭션):
   a. 신규:
      - artf_id = nanoid()
      - tb_ds_plan_studio_artf INSERT (good_design_yn='N', ai_task_id=NULL)
   b. 수정:
      - tb_ds_plan_studio_artf UPDATE (
          artf_nm, artf_div_code, artf_fmt_code,
          artf_idea_cn, coment_cn, artf_cn,
          mdfr_mber_id, mdfcn_dt = NOW()
        )
   c. 컨텍스트 동기화 (단순 전략):
      DELETE FROM tb_ds_plan_studio_ctxt WHERE artf_id = ?
      INSERT 새 contexts 배열
5. 성공 시:
   - 그리드 새로고침
   - '저장되었습니다' 토스트
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_ds_plan_studio_artf | 전체 | INSERT/UPDATE |
| tb_ds_plan_studio_ctxt | 전체 | DELETE + INSERT |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| artfNm 공백 | 400 | 기획명을 입력해 주세요 |
| 자기참조 감지 | 400 | 자기 자신을 컨텍스트로 추가할 수 없습니다 |
| 서버 오류 | 500 | 저장 중 오류가 발생했습니다 |

#### FID-PS-09 결과 본문 직접 수정 (원문편집)

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | UPDATE (통합 저장의 일부) |
| **API** | FID-PS-08 과 동일 (artf_cn 필드만 변경되어 저장) |
| **트리거** | 원문편집 모드에서 수정 후 저장 버튼 |

**처리 로직**
```
1. 우측 뷰어가 원문편집 모드일 때 textarea로 artf_cn 직접 편집 가능
2. dirty 표시
3. 저장 버튼 클릭 시 FID-PS-08 호출 (artf_cn 포함 UPDATE)
4. ai_task_id 는 그대로 유지 (수동 수정이라 해서 null로 돌리지 않음)
```

#### FID-PS-10 좋은 설계 토글

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | UPDATE |
| **API** | `PATCH /api/projects/{projectId}/plan-studios/{planStudioId}/artifacts/{artfId}/good-design` |
| **트리거** | ★ 버튼 클릭 |

**Input**
```typescript
{ goodDesignYn: 'Y' | 'N' }
```

**처리 로직**
```
1. API 호출
2. 서버 처리:
   tb_ds_plan_studio_artf UPDATE
   SET good_design_yn = ?, mdfr_mber_id = ?, mdfcn_dt = NOW()
   WHERE artf_id = ?
3. 성공 시 화면 상태 갱신
```

> 동일 기획실 내 여러 artf가 Y여도 무방함 (unique 강제 없음). 사용자가 "이거 좋네" 싶은 것마다 자유롭게 찜.

---

## PID-PS-04 컨텍스트 추가 팝업 (요구사항)

### AR-PS-08 요구사항 선택 (POPUP)

**유형:** POPUP

**UI 구조**
```
+──────────────────────────────────────────+
| 요구사항 추가                        [X]|
|──────────────────────────────────────────|
| [검색: ___________________]              |
|──────────────────────────────────────────|
| [☐] RQ-00001 이메일 회원가입             |
| [☑] RQ-00002 이메일/비번 로그인 (이미)   |
| [☐] RQ-00003 회원 프로필 관리            |
|                                          |
|                       [취소]  [추가]     |
+──────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 검색 | text input | req_display_id, req_nm 부분일치 | - |
| 체크박스 목록 | checkbox list | 이미 선택된 것은 disabled+체크 | - |
| 추가 | button (primary) | 신규 선택분만 부모 화면으로 콜백 | - |

#### FID-PS-11 요구사항 검색·조회

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/requirements?q={keyword}` (기존 재사용) |
| **트리거** | 팝업 열림 / 검색어 변경 (debounce 300ms) |

**처리 로직**
```
1. tb_rq_requirement SELECT (prjct_id=?, req_display_id OR req_nm LIKE '%keyword%')
2. LIMIT 100
3. 부모에서 전달받은 기존 선택 refId 목록을 disabled 처리
```

---

## PID-PS-05 컨텍스트 추가 팝업 (기획보드)

### AR-PS-09 기획보드 선택 (POPUP)

PID-PS-04와 동일 구조, 데이터 소스만 다름. **현재 편집 중인 artf는 자기 자신 제외.**

#### FID-PS-12 기획보드 검색·조회 (자기 제외)

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/plan-studios/artifacts?q={keyword}&excludeArtfId={currentArtfId}` |
| **트리거** | 팝업 열림 / 검색어 변경 |

**처리 로직**
```
1. 프로젝트 내 모든 plan_studio의 artf 조회:
   SELECT a.artf_id, a.artf_nm, a.artf_div_code,
          ps.plan_studio_display_id, ps.plan_studio_nm
   FROM tb_ds_plan_studio_artf a
   JOIN tb_ds_plan_studio ps ON ps.plan_studio_id = a.plan_studio_id
   WHERE ps.prjct_id = ?
     AND a.artf_id != excludeArtfId
     AND (a.artf_nm LIKE ? OR ps.plan_studio_display_id LIKE ?)
   ORDER BY ps.creat_dt DESC, a.creat_dt DESC
   LIMIT 100
2. 라벨 조립: 'PB-00001 > 시스템 정보 구조도'
3. 결과 반환
```

> **주의:** 기획보드 선택 범위는 **현재 프로젝트 내 모든 기획실의 모든 artf** 이다. 같은 기획실 안으로 제한하지 않음. 재귀적 인사이트가 기획실 경계를 넘어서 작동하도록.

---

## AI 생성 (전역 액션)

### FID-PS-13 AI 생성 통합 흐름

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | INSERT (저장 + AI 호출 + 본문 업데이트) |
| **API** | `POST /api/projects/{projectId}/plan-studios/{planStudioId}/artifacts/{artfId}/generate` (기존 artf) 또는 `POST /api/projects/{projectId}/plan-studios/{planStudioId}/artifacts/generate` (신규, 저장 + 생성 동시) |
| **트리거** | AI 생성 버튼 클릭 |

**Input**
```typescript
{
  // 현재 편집 중인 폼 전체 (저장 + 생성 통합)
  artfNm: string,
  artfDivCode: string,
  artfFmtCode: string,
  artfIdeaCn: string | null,
  comentCn: string | null,
  contexts: Array<{ ctxtTyCode: string, refId: string, sortOrdr: number }>,
}
```

**Output**
```typescript
{
  artfId: string,               // 신규 생성된 경우 새 ID
  artfCn: string,               // AI 생성 결과 (artf_cn 에 저장됨)
  aiTaskId: string,
  taskSttusCode: 'COMPLETED' | 'FAILED',
}
```

**처리 로직 (서버, 단일 워크플로)**
```
[1단계] 프론트: 확인 다이얼로그
  - "저장 후 AI 요청하시겠습니까?" → 확인 → API 호출

[2단계] 서버: 저장 (FID-PS-08 로직 재사용)
  - artf 신규면 INSERT, 기존이면 UPDATE
  - contexts DELETE + INSERT

[3단계] 서버: 컨텍스트 직조 (프롬프트 빌더)
  a. artf_idea_cn (1순위)
  b. coment_cn (지시사항)
  c. tb_ds_plan_studio_ctxt 조회 (sort_ordr ASC):
     - REQ: tb_rq_requirement 본문 + tb_rq_user_story 자동 동봉 (req_id 기준)
     - ARTF: 참조 artf 본문 로드 (가능하면 good_design_yn='Y' 우선)
     - 순환 차단: 재귀 깊이 최대 3, 방문 set 추적
  d. XML 태그 직조:
     <artifact_request>
       <division>IA|JOURNEY|FLOW|MOCKUP|ERD|PROCESS</division>
       <format>MD|MERMAID|HTML</format>
       <idea>{artf_idea_cn}</idea>
       <instruction>{coment_cn}</instruction>
       <context>
         <requirement id="RQ-00001" name="...">
           <original>...</original>
           <spec>...</spec>
           <user_stories>...</user_stories>
         </requirement>
         <reference_artifact id="PB-00001 > 시스템 정보 구조도" div="IA" format="MERMAID">
           {artf_cn}
         </reference_artifact>
       </context>
     </artifact_request>

[4단계] 서버: tb_ai_task INSERT
  - ai_task_id = nanoid()
  - prjct_id, ref_ty_code='PLAN_STUDIO_ARTF', ref_id=artfId
  - task_ty_code='PLAN_STUDIO_ARTF_GENERATE'
  - task_sttus_code='PENDING'
  - req_cn = 직조된 프롬프트 전체
  - coment_cn = comentCn
  - req_snapshot_data = JSON({
      artfNm, artfDivCode, artfFmtCode, contexts
    })
  - req_mber_id, req_dt=NOW()

[5단계] 서버: Anthropic API 호출
  - tb_ai_task UPDATE → task_sttus_code='PROCESSING'
  - 모델: claude-sonnet-4-6
  - 시스템 프롬프트: artf_div_code + artf_fmt_code 조합별로 로드
    (예: specode.plan_studio.IA.MERMAID.system.md)
  - max_tokens: 8192 ~ 16384
  - 실패 시:
    tb_ai_task UPDATE task_sttus_code='FAILED', reject_rsn_cn=에러, compl_dt=NOW()
    → 502 응답

[6단계] 서버: 결과 저장
  - tb_ds_plan_studio_artf UPDATE
    SET artf_cn = {AI 응답},
        ai_task_id = {현재 ai_task_id},
        mdfr_mber_id = 현재 회원,
        mdfcn_dt = NOW()
    WHERE artf_id = ?
  - tb_ai_task UPDATE → task_sttus_code='COMPLETED',
                        result_cn={AI 응답},
                        compl_dt=NOW(),
                        apply_dt=NOW()

[7단계] 응답 반환
  - {artfId, artfCn, aiTaskId, taskSttusCode}
  - 프론트는 AR-PS-07 결과 뷰어 즉시 갱신 + 그리드 상태 갱신
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_ds_plan_studio_artf | 전체 | 저장 + 결과 업데이트 |
| tb_ds_plan_studio_ctxt | 전체 | 컨텍스트 |
| tb_ai_task | 전체 | 호출 이력 |
| tb_rq_requirement | req_id, req_nm, orgnl_cn, curncy_cn, analy_cn, spec_cn | REQ 컨텍스트 본문 |
| tb_rq_user_story | req_id, story_nm, story_cn | REQ 자동 동봉 |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| artfNm 공백 | 400 | 기획명을 입력해 주세요 |
| 컨텍스트 0건 + idea 공백 | 400 | 컨텍스트 또는 상세 아이디어를 입력해 주세요 |
| 자기참조 감지 | 400 | 자기 자신을 컨텍스트로 추가할 수 없습니다 |
| 간접 순환 감지 | 400 | 순환 참조가 감지되었습니다 |
| AI 호출 실패 | 502 | AI 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요 |
| 토큰 한도 초과 | 413 | 컨텍스트가 너무 큽니다. 일부를 제거해 주세요 |


---

## 7. 구현 우선순위 (참고)

| 순서 | 작업 |
|:-----|:-----|
| 1 | 기획실 목록/생성/삭제 (FID-PS-01, 02, 03) |
| 2 | 기획실 상세 페이지 골격 + 산출물 목록 조회 (FID-PS-04) |
| 3 | 산출물 그리드 + 행 클릭 → 편집 폼 로드 (FID-PS-05) |
| 4 | 컨텍스트 팝업 2종 (FID-PS-11, 12) |
| 5 | 상세 아이디어 + AI 지시사항 입력 영역 |
| 6 | 산출물 저장 - INSERT/UPDATE 통합 (FID-PS-08) |
| 7 | 결과 뷰어 + 원문편집 + 좋은 설계 토글 (FID-PS-09, 10) |
| 8 | AI 생성 통합 + 프롬프트 빌더 (FID-PS-13) |
| 9 | 산출물 삭제 (FID-PS-06) |

> 순서는 의존성 기준 제안일 뿐, 실제 순서는 구현자 판단.
> AI 생성(8번)은 다른 단계 안정화 후 진입 권장.

## 8. 미해결·향후 이슈

| 항목 | 현재 처리 | 향후 |
|:-----|:----------|:-----|
| 시스템 프롬프트 저장 위치 | 파일 기반 (경로는 구현자 판단) | DB 테이블화 검토 |
| 간접 순환 차단 | AI 생성 시 재귀 깊이 3 + 방문 set | 저장 시점 강화 |
| 토큰량 사전 표시 | 미구현 | 칩에 추정 토큰 표시 |
| UNIT, SCREEN 컨텍스트 | 코드값만 정의, UI 미구현 | 향후 추가 |
| AI 비동기 처리 | 동기 호출 (요청-응답) | 큐 + SSE or 폴링 |
| 권한 체크 | 기존 프로젝트 미들웨어 준수 | - |
| "창", "팝" 액션 상세 | 새 탭 / 모달 (상세 미정의) | 필요 시 추가 |

---

## 구현 전 확인 사항 (CC가 반드시 먼저 할 것)

1. **DB 구조** — 제공된 DDL 원본을 기준으로 한다. `schema.prisma`를 introspect 하거나 기존 스타일에 맞춰 수동 추가할 것. 본 PRD에는 Prisma 모델 예시를 포함하지 않는다.
2. **디렉토리·파일 구조** — 기존 메뉴(예: 요구사항 메뉴) 하나를 골라 그 구조와 네이밍 컨벤션을 그대로 따를 것. 본 PRD에는 경로 예시를 포함하지 않는다.
3. **코딩 컨벤션** — 프로젝트의 CLAUDE.md 및 기존 코드 스타일을 우선한다.
4. **화면 이미지 우선** — PRD 텍스트와 첨부 화면 이미지가 어긋나면 **이미지를 기준**으로 한다. 판단이 서지 않으면 구현 전 질문할 것.