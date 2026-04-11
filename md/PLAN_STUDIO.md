# PRD 기획실 (Plan Studio)

> ## 1. 개요
| 항목 | 내용 |
|:-----|:-----|
| **메뉴명** | 기획실 |
| **비즈니스 목적** | 요구사항·사용자스토리·기획실(자기참조) 등을 컨텍스트로 묶어 AI에게 다양한 형식(MD/Mermaid/HTML)의 산출물(IA·ERD·MOCKUP·PROCESS·JOURNEY·FLOW)을 생성시키는 워크스페이스. 생성된 기획실 자체가 다른 기획실의 컨텍스트로 재참조 가능하여 인사이트가 누적되는 구조. |
| **기술 스택** | Next.js (App Router) · PostgreSQL · Prisma · Anthropic Claude API |
| **신규 테이블** | tb_ds_plan_studio, tb_ds_plan_studio_artf, tb_ds_plan_studio_ctxt |
| **기존 활용 테이블** | tb_pj_project, tb_rq_requirement, tb_rq_user_story, tb_ai_task, tb_cm_member |

## 2. 화면 목록
| 화면ID | 화면명 | URL | 유형 |
|:-------|:-------|:----|:-----|
| PID-PS-01 | 기획실 목록 | `/projects/{projectId}/plan-studio` | LIST |
| PID-PS-02 | 기획실 생성 팝업 | - | POPUP |
| PID-PS-03 | 기획실 상세·편집 | `/projects/{projectId}/plan-studio/{planStudioId}` | DETAIL |
| PID-PS-04 | 변경 이력 패널 | - (PID-PS-03 내 슬라이드오버) | PANEL |
| PID-PS-05 | 컨텍스트 추가 팝업 (요구사항) | - | POPUP |
| PID-PS-06 | 컨텍스트 추가 팝업 (기획실 자기참조) | - | POPUP |

## 3. 화면 흐름
```
[기획실 목록] ──(생성 버튼)──▶ [기획실 생성 팝업] ──(확인)──▶ [기획실 상세·편집 (신규)]
[기획실 목록] ──(행 클릭)────▶ [기획실 상세·편집 (조회)]
[기획실 상세·편집] ──(요구사항 추가)──▶ [컨텍스트 추가 팝업 (요구사항)]
[기획실 상세·편집] ──(기획보드 추가)──▶ [컨텍스트 추가 팝업 (기획실)]
[기획실 상세·편집] ──(변경 이력)────▶ [변경 이력 패널]
[기획실 상세·편집] ──(AI 생성)──────▶ [확인 다이얼로그] ──▶ [저장 + AI 호출] ──▶ [Mermaid/HTML 렌더링]
```

| 이동 | 전달 파라미터 | 동작 |
|:-----|:-------------|:-----|
| 목록 → 생성 팝업 | - | 생성 버튼 클릭 |
| 생성 팝업 → 상세 (신규) | planStudioId (생성 직후) | 기획명 입력 후 확인 |
| 목록 → 상세 (조회) | planStudioId | 행 클릭 |
| 상세 → 컨텍스트 팝업 | projectId, 현재 선택된 ref_id 목록 | 추가 버튼 클릭 |
| 상세 → AI 생성 | 전체 폼 데이터 | AI 생성 버튼 클릭 |

## 4. 권한 정의
| 기능 | VIEWER | PM/DESIGNER/DEVELOPER | ADMIN | OWNER |
|:-----|:-------|:----------------------|:------|:------|
| 기획실 목록 조회 | ✅ | ✅ | ✅ | ✅ |
| 기획실 생성·수정 | ❌ | ✅ | ✅ | ✅ |
| 기획실 삭제 | ❌ | ✅ | ✅ | ✅ |
| AI 생성 | ❌ | ✅ | ✅ | ✅ |
| 좋은 설계 표시 | ❌ | ✅ | ✅ | ✅ |

## 5. 참조 테이블
- `<TABLE_SCRIPT:tb_ds_plan_studio>`
- `<TABLE_SCRIPT:tb_ds_plan_studio_artf>`
- `<TABLE_SCRIPT:tb_ds_plan_studio_ctxt>`
- `<TABLE_SCRIPT:tb_ai_task>`
- `<TABLE_SCRIPT:tb_rq_requirement>`
- `<TABLE_SCRIPT:tb_rq_user_story>` (REQ 컨텍스트 자동 동봉용)

## 6. 코드값 정의 (앱 상수)
```typescript
// constants/planStudio.ts
export const PLAN_STUDIO_DIV = {
  IA:      { code: 'IA',      name: '정보구조도',   group: '기획' },
  JOURNEY: { code: 'JOURNEY', name: '사용자여정',   group: '기획' },
  FLOW:    { code: 'FLOW',    name: '화면흐름',     group: '기획' },
  MOCKUP:  { code: 'MOCKUP',  name: '목업',         group: '기획' },
  ERD:     { code: 'ERD',     name: 'ERD',          group: '개발' },
  PROCESS: { code: 'PROCESS', name: '업무프로세스', group: '개발' },
} as const;

export const ARTF_FMT = {
  MD:      { code: 'MD',      name: '마크다운' },
  MERMAID: { code: 'MERMAID', name: 'Mermaid' },
  HTML:    { code: 'HTML',    name: 'HTML' },
} as const;

export const CTXT_TY = {
  REQ:    { code: 'REQ',    name: '요구사항' },
  PLAN:   { code: 'PLAN',   name: '기획실' },
  UNIT:   { code: 'UNIT',   name: '단위업무' },   // 향후
  SCREEN: { code: 'SCREEN', name: '화면설계' },   // 향후
} as const;

export const AI_TASK_REF_TY_PLAN_STUDIO = 'PLAN_STUDIO';
export const AI_TASK_TY_PLAN_STUDIO_GENERATE = 'PLAN_STUDIO_GENERATE';
```

---

## PID-PS-01 기획실 목록

### AR-PS-01 기획실 목록 그리드 (GRID)

**유형:** GRID

**UI 구조**
```
+──────────────────────────────────────────────────────────────────+
| 총 N건                                              [+ 생성]     |
|──────────────────────────────────────────────────────────────────|
| 기획명           | 구분    | AI상태    | 액션     | 수정일시      |
| 시스템 정보 구조도 | IA      | 대기      | 창 팝 X  | 2026-02-01    |
| 전체 프로세스    | PROCESS | 생성완료  | 창 팝 X  | 2026-01-31    |
| 전체 요구사항 목업 | MOCKUP  | 작업중    | 창 팝 X  | 2026-01-22    |
+──────────────────────────────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 기획명 | text (link) | 클릭 시 상세로 이동 | - |
| 구분 | badge | IA/JOURNEY/FLOW/MOCKUP/ERD/PROCESS | - |
| AI 상태 | badge | 대기/작업중/생성완료/실패 (최신 ai_task 기준) | - |
| 창 | button (icon) | 새 탭으로 상세 열기 | - |
| 팝 | button (icon) | 모달로 상세 열기 (옵션) | - |
| X | button (danger) | 삭제 확인 후 삭제 | - |
| 수정일시 | text | YYYY-MM-DD | - |
| 생성 | button (primary) | 생성 팝업 표시 | - |

#### FID-PS-01 기획실 목록 조회

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/plan-studios` |
| **트리거** | 화면 진입 시 자동 |

**Output**
| 필드 | 타입 | 설명 |
|:-----|:-----|:-----|
| items | array | 기획실 목록 |
| totalCount | number | 전체 건수 |

각 item:
```typescript
{
  planStudioId: string,
  planStudioDisplayId: string,    // PB-00001
  planStudioNm: string,
  planStudioDivCode: string,
  aiStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | null,
  mdfcnDt: string,
}
```

**처리 로직**
```
1. 목록 API 호출
2. 서버 처리:
   a. tb_ds_plan_studio 에서 prjct_id = 현재 프로젝트, sort_ordr ASC
   b. 각 행마다 tb_ai_task 에서
      ref_ty_code = 'PLAN_STUDIO' AND ref_id = plan_studio_id
      중 가장 최근 (req_dt DESC) 1건의 task_sttus_code를 aiStatus로 매핑
   c. 결과 배열 반환
3. 목록 0건이면 '등록된 기획실이 없습니다' 안내
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_ds_plan_studio | plan_studio_id, plan_studio_display_id, plan_studio_nm, plan_studio_div_code, mdfcn_dt | 목록 본체 |
| tb_ai_task | ref_ty_code, ref_id, task_sttus_code, req_dt | 최신 AI 상태 |

#### FID-PS-02 기획실 삭제

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | DELETE |
| **API** | `DELETE /api/projects/{projectId}/plan-studios/{planStudioId}` |
| **트리거** | X 버튼 클릭 → confirm 후 |

**처리 로직**
```
1. confirm('삭제하시겠습니까? 산출물과 컨텍스트 매핑이 함께 삭제됩니다')
2. 삭제 API 호출
3. 서버 처리:
   a. tb_ds_plan_studio DELETE (CASCADE → artf, ctxt 자동 삭제)
   b. tb_ai_task 는 CASCADE 없음 — 별도 처리 안함 (이력 보존)
4. 성공 시 목록 새로고침
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_ds_plan_studio | plan_studio_id | 삭제 대상 |
| tb_ds_plan_studio_artf | plan_studio_id | CASCADE 삭제 |
| tb_ds_plan_studio_ctxt | plan_studio_id | CASCADE 삭제 |

---

## PID-PS-02 기획실 생성 팝업

### AR-PS-02 생성 팝업 폼 (POPUP)

**유형:** POPUP

**UI 구조**
```
+──────────────────────────────────+
| 새 기획실 생성                    |
|──────────────────────────────────|
| 기획명을 입력해 주세요.           |
| [____________________________]   |
|                                  |
|              [취소]  [확인]      |
+──────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 기획명 | text input | 필수 | - |
| 취소 | button (secondary) | 팝업 닫기 | - |
| 확인 | button (primary) | 생성 후 상세 이동 | - |

#### FID-PS-03 기획실 신규 생성

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | INSERT |
| **API** | `POST /api/projects/{projectId}/plan-studios` |
| **트리거** | 확인 버튼 클릭 |

**Input**
| 파라미터 | 타입 | 필수 | 설명 |
|:---------|:-----|:-----|:-----|
| planStudioNm | string | Y | 기획명 |

**Output**
```typescript
{
  planStudioId: string,
  planStudioDisplayId: string,  // PB-NNNNN
}
```

**처리 로직**
```
1. 기획명 공백 검증
2. API 호출
3. 서버 처리:
   a. plan_studio_id = nanoid() 또는 cuid()
   b. plan_studio_display_id 채번:
      SELECT MAX(CAST(SUBSTRING(plan_studio_display_id FROM 4) AS INT))
      FROM tb_ds_plan_studio
      WHERE prjct_id = ? AND plan_studio_display_id LIKE 'PB-%'
      → MAX + 1, 5자리 zero-padding ('PB-00001')
   c. sort_ordr 채번: MAX(sort_ordr) + 1 (프로젝트 내)
   d. tb_ds_plan_studio INSERT (
        plan_studio_id, prjct_id, plan_studio_display_id,
        plan_studio_nm, plan_studio_div_code='IA' (디폴트),
        sort_ordr, creat_mber_id, creat_dt
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
| 기획명 공백 | 400 | 기획명을 입력해 주세요 |
| 서버 오류 | 500 | 생성 중 오류가 발생했습니다 |

---

## PID-PS-03 기획실 상세·편집

전체 레이아웃:
```
+───────────────────────────────────────────────────────────────────+
| ← 기획실명 (display_id)                       [AI 생성] [저장]    |
|───────────────────────────────────────────────────────────────────|
| AR-PS-03 기본 정보                       | AR-PS-06 산출물 뷰어    |
| AR-PS-04 컨텍스트                        |  - 미리보기/원문편집    |
| AR-PS-05 상세 아이디어 + AI 지시사항      |  - MD/Mermaid/HTML 토글|
|                                          |  - 변경 이력 버튼       |
+───────────────────────────────────────────────────────────────────+
```

### AR-PS-03 기본 정보 (FORM)

**유형:** FORM

**UI 구조**
```
+──────────────────────────────────────────+
| 기획명 [_______________________]          |
| 구분   [IA ▾]                             |
+──────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 기획명 | text input | 필수 | - |
| 구분 | select (그룹핑) | 기획/개발 그룹으로 분류 | IA |

**구분 select 옵션 그룹핑:**
```
─ 기획 ─
  IA      정보구조도
  JOURNEY 사용자여정
  FLOW    화면흐름
  MOCKUP  목업
─ 개발 ─
  ERD     데이터모델
  PROCESS 업무프로세스
```

#### FID-PS-04 기획실 상세 조회

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/plan-studios/{planStudioId}` |
| **트리거** | 화면 진입 시 자동 |

**Output**
```typescript
{
  planStudioId: string,
  planStudioDisplayId: string,
  planStudioNm: string,
  planStudioDivCode: string,
  planCn: string | null,           // 상세 아이디어 (마크다운)
  comentCn: string | null,         // AI 지시사항
  contexts: Array<{
    ctxtId: string,
    ctxtTyCode: 'REQ' | 'PLAN',
    refId: string,
    sortOrdr: number,
    refLabel: string,              // 'RQ-00001 회원가입' or 'PB-00003 전체 프로세스'
  }>,
  artifacts: {
    MD:      Artifact | null,      // good_design_yn='Y' 가 있으면 그것, 없으면 최신
    MERMAID: Artifact | null,
    HTML:    Artifact | null,
  },
  latestAiTask: {
    aiTaskId: string,
    taskSttusCode: string,
  } | null,
}

type Artifact = {
  artfId: string,
  verNo: number,
  artfCn: string,
  goodDesignYn: 'Y' | 'N',
  creatDt: string,
}
```

**처리 로직**
```
1. tb_ds_plan_studio 본체 조회
2. tb_ds_plan_studio_ctxt 전체 조회 (sort_ordr ASC)
   - ctxt_ty_code='REQ': tb_rq_requirement JOIN → req_display_id, req_nm
   - ctxt_ty_code='PLAN': tb_ds_plan_studio JOIN → plan_studio_display_id, plan_studio_nm
   - refLabel 조립
3. tb_ds_plan_studio_artf 형식별 1건씩 조회:
   - good_design_yn='Y' 우선
   - 없으면 ver_no DESC LIMIT 1
4. tb_ai_task 최신 1건 (ref_ty_code='PLAN_STUDIO', ref_id=planStudioId)
5. 통합 결과 반환
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_ds_plan_studio | 전체 | 본체 |
| tb_ds_plan_studio_ctxt | 전체 | 컨텍스트 매핑 |
| tb_rq_requirement | req_display_id, req_nm | REQ 컨텍스트 라벨 |
| tb_ds_plan_studio_artf | 전체 | 산출물 |
| tb_ai_task | task_sttus_code | AI 상태 |

#### FID-PS-05 기획실 저장 (수동 저장)

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | UPDATE |
| **API** | `PUT /api/projects/{projectId}/plan-studios/{planStudioId}` |
| **트리거** | 저장 버튼 클릭 |

**Input**
```typescript
{
  planStudioNm: string,
  planStudioDivCode: string,
  planCn: string,
  comentCn: string,
  contexts: Array<{ ctxtTyCode: string, refId: string, sortOrdr: number }>,
}
```

**처리 로직**
```
1. 기획명 공백 검증
2. API 호출
3. 서버 처리 (단일 트랜잭션):
   a. tb_ds_plan_studio UPDATE (
        plan_studio_nm, plan_studio_div_code, plan_cn, coment_cn,
        mdfcn_dt = NOW()
      )
   b. 컨텍스트 동기화 — 단순 전략: 전체 DELETE 후 재INSERT
      DELETE FROM tb_ds_plan_studio_ctxt WHERE plan_studio_id = ?
      INSERT 새 contexts 배열 (ctxt_id = nanoid() 부여, sort_ordr 순차)
   c. 자기참조 검증: ctxtTyCode='PLAN' AND refId=planStudioId 면 400 반환
4. 성공 시 토스트 '저장되었습니다'
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_ds_plan_studio | 본체 컬럼 + mdfcn_dt | UPDATE |
| tb_ds_plan_studio_ctxt | 전체 | DELETE + INSERT |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 기획명 공백 | 400 | 기획명을 입력해 주세요 |
| 자기참조 시도 | 400 | 자기 자신을 컨텍스트로 추가할 수 없습니다 |

---

### AR-PS-04 컨텍스트 (FORM)

**유형:** FORM

**UI 구조**
```
+──────────────────────────────────────────+
| 컨텍스트                                  |
|──────────────────────────────────────────|
| 요구사항                  [+ 요구사항 추가]|
| [RQ-00001 이메일 회원가입 X]              |
| [RQ-00002 이메일/비번 로그인 X]           |
| [RQ-00006 회원 프로필 관리 X] ...         |
|                                          |
| 기획보드                  [+ 기획보드 추가]|
| [PB-00001 시스템 정보 구조도 X]           |
| [PB-00002 전체 프로세스 X]                |
+──────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 요구사항 칩 영역 | chip list | refLabel + 삭제 X | - |
| 요구사항 추가 | button (secondary) | PID-PS-05 팝업 | - |
| 기획보드 칩 영역 | chip list | refLabel + 삭제 X | - |
| 기획보드 추가 | button (secondary) | PID-PS-06 팝업 | - |

#### FID-PS-06 컨텍스트 칩 추가/제거 (클라이언트 상태)

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | CLIENT_STATE |
| **API** | - (저장 시 FID-PS-05에서 일괄 처리) |
| **트리거** | 팝업에서 항목 선택 / 칩 X 버튼 |

**처리 로직**
```
1. 추가:
   - 팝업에서 선택된 항목들을 contexts 배열에 push
   - 중복 체크: (ctxtTyCode, refId) 동일하면 무시
   - 자기참조 체크: ctxtTyCode='PLAN' AND refId=현재 planStudioId 면 거부 + alert
   - sort_ordr = 현재 배열 길이
2. 제거:
   - 해당 항목을 contexts 배열에서 splice
   - sort_ordr 재정렬
3. 변경된 contexts는 dirty 표시 → 저장 버튼 활성화
```

---

### AR-PS-05 상세 아이디어·AI 지시사항 (FORM)

**유형:** FORM

**UI 구조**
```
+──────────────────────────────────────────+
| 상세 아이디어 (AI 1순위 참조)             |
| [편집] [미리보기]                         |
| ┌──────────────────────────────────────┐ |
| │ 마크다운 에디터                       │ |
| └──────────────────────────────────────┘ |
|                                          |
| AI 지시사항 (comment)                    |
| ┌──────────────────────────────────────┐ |
| │ 텍스트영역                            │ |
| └──────────────────────────────────────┘ |
+──────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 상세 아이디어 | markdown editor | plan_cn, 편집/미리보기 토글 | - |
| AI 지시사항 | textarea | coment_cn, 일반 텍스트 | - |

> **클라이언트 상태만 관리** — 저장은 FID-PS-05에서 일괄. 별도 API 없음.

---

### AR-PS-06 산출물 뷰어 (PANEL)

**유형:** PANEL

**UI 구조**
```
+──────────────────────────────────────────+
| [미리보기] [원문편집]   [MD][Mermaid][HTML]| [⛶] [⟲ 변경이력]
|──────────────────────────────────────────|
| ┌──────────────────────────────────────┐ |
| │ (Mermaid 렌더링 결과 또는 MD 미리보기) │ |
| │                                      │ |
| └──────────────────────────────────────┘ |
+──────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 미리보기/원문편집 | toggle | MD는 미리보기/소스, Mermaid는 렌더링/소스, HTML은 iframe/소스 | 미리보기 |
| 형식 토글 | tab | MD/MERMAID/HTML | MD |
| 형식 토글 비활성화 | - | artifacts[fmt] === null 인 형식은 disabled | - |
| 좋은 설계 표시 | toggle button | good_design_yn 토글 (★) | - |
| 변경 이력 | button | 변경 이력 패널 (PID-PS-04) 열기 | - |
| 확대 | icon button | 풀스크린 모달 | - |

#### FID-PS-07 산출물 미리보기 렌더링 (클라이언트)

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | CLIENT_RENDER |
| **트리거** | 형식 토글 변경 / 미리보기 모드 진입 |

**처리 로직**
```
1. 현재 선택된 fmt에 해당하는 artifacts[fmt] 조회
2. null이면 '아직 생성되지 않은 형식입니다' 표시
3. fmt별 렌더링:
   - MD: react-markdown
   - MERMAID: mermaid.render() (CSP 주의: 외부 스크립트 허용 필요)
   - HTML: <iframe sandbox="allow-same-origin"> 에 srcDoc으로 주입
4. 원문편집 모드: <textarea> 에 artfCn 표시 (수정 시 dirty 표시)
```

#### FID-PS-08 좋은 설계 표시 토글

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | UPDATE |
| **API** | `PUT /api/projects/{projectId}/plan-studios/{planStudioId}/artifacts/{artfId}/good-design` |
| **트리거** | ★ 버튼 클릭 |

**Input**
```typescript
{ goodDesignYn: 'Y' | 'N' }
```

**처리 로직**
```
1. API 호출
2. 서버 처리 (단일 트랜잭션):
   a. 대상 artf의 plan_studio_id, artf_fmt_code 조회
   b. goodDesignYn='Y' 인 경우:
      - 동일 (plan_studio_id, artf_fmt_code) 그룹의 다른 모든 row를 'N'으로 UPDATE
        (DB unique partial index가 강제하므로 반드시 먼저 처리)
      - 대상 row를 'Y'로 UPDATE
   c. goodDesignYn='N' 인 경우:
      - 대상 row만 'N'으로 UPDATE
   d. mdfcn_dt = NOW(), mdfr_mber_id = 현재 회원
3. 성공 시 화면 상태 갱신
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_ds_plan_studio_artf | good_design_yn, mdfcn_dt, mdfr_mber_id | 토글 |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| unique 위반 | 500 | 동일 형식 내 좋은 설계는 1건만 가능합니다 (트랜잭션 누락 시) |

#### FID-PS-09 산출물 원문 직접 수정

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | INSERT (신규 버전) |
| **API** | `POST /api/projects/{projectId}/plan-studios/{planStudioId}/artifacts` |
| **트리거** | 원문편집 모드에서 저장 |

**Input**
```typescript
{
  artfFmtCode: 'MD' | 'MERMAID' | 'HTML',
  artfCn: string,
}
```

**처리 로직**
```
1. API 호출
2. 서버 처리 (단일 트랜잭션):
   a. ver_no 채번: SELECT MAX(ver_no) FROM tb_ds_plan_studio_artf
                   WHERE plan_studio_id = ? AND artf_fmt_code = ?
                   → MAX + 1 (없으면 1)
   b. tb_ds_plan_studio_artf INSERT (
        artf_id = nanoid(),
        plan_studio_id, ver_no, artf_fmt_code, artf_cn,
        good_design_yn = 'N',
        ai_task_id = NULL,           ← 사람 손 = NULL
        creat_mber_id, creat_dt
      )
3. 성공 시 화면 상태 갱신
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_ds_plan_studio_artf | 전체 | 신규 버전 INSERT |

---

## PID-PS-04 변경 이력 패널

### AR-PS-07 변경 이력 (PANEL)

**유형:** PANEL (슬라이드오버)

**UI 구조**
```
+──────────────────────────────────────────+
| 변경 이력 (MD)                       [X]|
|──────────────────────────────────────────|
| v3 ★  2026-02-01 14:30  AI생성  [보기] |
| v2    2026-01-31 10:15  수동편집 [보기] |
| v1    2026-01-30 09:00  AI생성  [보기] |
+──────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 형식 탭 | tab | MD/MERMAID/HTML 별 이력 | 현재 보고있던 형식 |
| 버전 row | list item | ver_no, 생성일시, 출처(AI/수동), ★ 표시 | - |
| 보기 | button (secondary) | 해당 버전 산출물 뷰어에 로드 | - |

#### FID-PS-10 변경 이력 조회

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/plan-studios/{planStudioId}/artifacts?fmt={fmt}` |
| **트리거** | 변경 이력 버튼 클릭 / 형식 탭 전환 |

**Output**
```typescript
{
  items: Array<{
    artfId: string,
    verNo: number,
    artfFmtCode: string,
    goodDesignYn: 'Y' | 'N',
    source: 'AI' | 'MANUAL',       // ai_task_id IS NULL ? 'MANUAL' : 'AI'
    creatDt: string,
    creatMberNm: string,
  }>
}
```

**처리 로직**
```
1. tb_ds_plan_studio_artf SELECT (plan_studio_id=?, artf_fmt_code=?, ORDER BY ver_no DESC)
2. tb_cm_member JOIN으로 등록자명 조회
3. ai_task_id IS NULL → source='MANUAL', 아니면 'AI'
```

---

## PID-PS-05 컨텍스트 추가 팝업 (요구사항)

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
| [☑] RQ-00002 이메일/비번 로그인 (선택됨) |
| [☐] RQ-00003 ...                         |
|                                          |
|                       [취소]  [추가]     |
+──────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 검색 | text input | req_display_id, req_nm 부분일치 | - |
| 체크박스 목록 | checkbox list | 이미 선택된 항목은 disabled+체크 | - |
| 추가 | button (primary) | 신규 선택분만 부모로 콜백 | - |

#### FID-PS-11 요구사항 검색·조회

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/requirements?q={keyword}` |
| **트리거** | 팝업 진입 / 검색어 변경 (debounce 300ms) |

**처리 로직**
```
1. tb_rq_requirement SELECT (prjct_id=?, req_display_id LIKE ? OR req_nm LIKE ?)
2. 결과 반환 (LIMIT 100)
3. 부모 화면에서 이미 선택된 refId 목록을 받아 disabled 처리
```

> **API 신규 생성 X** — 기존 요구사항 목록 API 재활용 가능 (FID-00099). 검색어 파라미터만 추가되어 있으면 OK.

---

## PID-PS-06 컨텍스트 추가 팝업 (기획실 자기참조)

### AR-PS-09 기획실 선택 (POPUP)

PID-PS-05와 동일 구조, 데이터 소스만 다름.

#### FID-PS-12 기획실 검색·조회 (자기 제외)

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/plan-studios?q={keyword}&excludeId={planStudioId}` |
| **트리거** | 팝업 진입 / 검색어 변경 |

**처리 로직**
```
1. tb_ds_plan_studio SELECT (
     prjct_id=?,
     plan_studio_display_id LIKE ? OR plan_studio_nm LIKE ?,
     plan_studio_id != excludeId   ← 자기 자신 제외
   )
2. (선택) 간접 순환 사전 차단 — 본 PRD에서는 생략, 저장 시 검증
3. 결과 반환
```

---

## AI 생성 (전역 액션)

### FID-PS-13 AI 생성 — 통합 흐름

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | INSERT (저장 + AI 호출 + 결과 저장) |
| **API** | `POST /api/projects/{projectId}/plan-studios/{planStudioId}/generate` |
| **트리거** | AI 생성 버튼 클릭 |

**Input**
```typescript
{
  // 폼이 dirty면 함께 저장 (저장+생성 통합)
  planStudioNm: string,
  planStudioDivCode: string,
  planCn: string,
  comentCn: string,
  contexts: Array<{ ctxtTyCode: string, refId: string, sortOrdr: number }>,
  // 생성 옵션
  targetFormats: Array<'MD' | 'MERMAID' | 'HTML'>,  // 멀티 선택 가능
}
```

**Output**
```typescript
{
  aiTaskId: string,
  artifacts: Array<{
    artfId: string,
    artfFmtCode: string,
    artfCn: string,
    verNo: number,
  }>
}
```

**처리 로직 (서버, 단일 워크플로)**
```
[1단계] 프론트 확인 다이얼로그
  - "저장 후 요청하시겠습니까?" → 확인 → API 호출

[2단계] 서버: 저장
  - FID-PS-05와 동일한 UPDATE + ctxt 동기화 (단일 트랜잭션)

[3단계] 서버: 컨텍스트 직조 (프롬프트 빌더)
  a. plan_cn (1순위)
  b. coment_cn (지시사항)
  c. tb_ds_plan_studio_ctxt 전체 조회 (sort_ordr ASC)
     - REQ: tb_rq_requirement 본문 + tb_rq_user_story 자동 동봉 (req_id 기준)
     - PLAN: 참조 기획실의 good_design_yn='Y' artifact 우선, 없으면 최신 ver
     - 간접 순환 차단: 재귀 깊이 최대 3, 방문 set 추적
  d. XML 태그로 직조:
     <plan_studio>
       <division>{planStudioDivCode}</division>
       <plan>{plan_cn}</plan>
       <instruction>{coment_cn}</instruction>
       <context>
         <requirement id="RQ-00001" name="...">{...}
           <user_stories>{...}</user_stories>
         </requirement>
         <plan_studio_ref id="PB-00003" name="...">{artf_cn}</plan_studio_ref>
       </context>
       <output_formats>MD,MERMAID,HTML</output_formats>
     </plan_studio>

[4단계] 서버: tb_ai_task INSERT (PENDING)
  - ai_task_id = nanoid()
  - prjct_id, ref_ty_code='PLAN_STUDIO', ref_id=planStudioId
  - task_ty_code='PLAN_STUDIO_GENERATE'
  - req_cn = 직조된 프롬프트
  - coment_cn = comentCn
  - task_sttus_code='PENDING'
  - req_snapshot_data = JSON({contexts, planStudioDivCode, targetFormats})
  - req_mber_id, req_dt=NOW()

[5단계] 서버: Anthropic API 호출
  - tb_ai_task UPDATE → task_sttus_code='PROCESSING'
  - claude-sonnet-4-6 모델로 호출
  - 시스템 프롬프트는 별도 prompt repo에서 plan_studio_div_code 별로 로드
    (예: ds_plan_studio.IA.system.md, ds_plan_studio.ERD.system.md)
  - max_tokens 충분히 (8192~)
  - 실패 시 → tb_ai_task UPDATE task_sttus_code='FAILED', reject_rsn_cn 기록

[6단계] 서버: 응답 파싱 + 산출물 저장
  - LLM 응답을 형식별로 분리 (XML 또는 마커 기반)
  - 각 형식에 대해:
    a. ver_no = MAX + 1
    b. tb_ds_plan_studio_artf INSERT (
         artf_id=nanoid(),
         plan_studio_id, ver_no, artf_fmt_code, artf_cn,
         good_design_yn='N', ai_task_id=현재 task,
         creat_mber_id, creat_dt
       )
  - tb_ai_task UPDATE → task_sttus_code='COMPLETED', result_cn=원문, compl_dt=NOW()

[7단계] 응답 반환
  - aiTaskId + 생성된 artifacts 배열
  - 프론트는 산출물 뷰어에 즉시 반영
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_ds_plan_studio | 본체 | 저장 |
| tb_ds_plan_studio_ctxt | 전체 | 저장 + 컨텍스트 조회 |
| tb_ds_plan_studio_artf | 전체 | 신규 버전 INSERT |
| tb_ai_task | 전체 | 호출 이력 |
| tb_rq_requirement | req_id, req_nm, orgnl_cn, curncy_cn, spec_cn | REQ 컨텍스트 본문 |
| tb_rq_user_story | req_id, story_nm, story_cn | REQ 컨텍스트 자동 동봉 |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 컨텍스트 0건 + plan_cn 공백 | 400 | 컨텍스트 또는 상세 아이디어를 입력해 주세요 |
| 자기참조 감지 | 400 | 자기 자신을 컨텍스트로 추가할 수 없습니다 |
| 간접 순환 감지 | 400 | 순환 참조가 감지되었습니다 (PB-XXX → ...) |
| AI 호출 실패 | 502 | AI 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요 |
| 토큰 한도 초과 | 413 | 컨텍스트가 너무 큽니다. 일부를 제거해 주세요 |

---

## 7. 디렉토리 구조 (구현 가이드)

```
src/
├── app/
│   ├── projects/[projectId]/plan-studio/
│   │   ├── page.tsx                          # PID-PS-01 목록
│   │   └── [planStudioId]/
│   │       └── page.tsx                      # PID-PS-03 상세
│   └── api/projects/[projectId]/plan-studios/
│       ├── route.ts                          # GET 목록, POST 생성
│       └── [planStudioId]/
│           ├── route.ts                      # GET 상세, PUT 저장, DELETE
│           ├── generate/route.ts             # POST AI 생성
│           └── artifacts/
│               ├── route.ts                  # GET 이력, POST 수동 INSERT
│               └── [artfId]/
│                   └── good-design/route.ts  # PUT 토글
├── components/plan-studio/
│   ├── PlanStudioList.tsx
│   ├── PlanStudioCreatePopup.tsx
│   ├── PlanStudioDetail.tsx
│   ├── PlanStudioBasicForm.tsx
│   ├── PlanStudioContextSection.tsx
│   ├── PlanStudioIdeaEditor.tsx
│   ├── PlanStudioArtifactViewer.tsx
│   ├── PlanStudioHistoryPanel.tsx
│   ├── ContextPickerRequirement.tsx
│   └── ContextPickerPlanStudio.tsx
├── lib/plan-studio/
│   ├── repository.ts                         # Prisma 쿼리
│   ├── prompt-builder.ts                     # 컨텍스트 직조
│   ├── ai-client.ts                          # Anthropic API 호출
│   ├── display-id.ts                         # PB-NNNNN 채번
│   └── cycle-detector.ts                     # 자기참조/순환 감지
└── constants/planStudio.ts                   # 코드값 상수
```

## 8. Prisma 스키마 추가 (참고용 의사 코드)

```prisma
model TbDsPlanStudio {
  planStudioId          String    @id @map("plan_studio_id")
  prjctId               String    @map("prjct_id")
  planStudioDisplayId   String    @map("plan_studio_display_id")
  planStudioNm          String    @default("") @map("plan_studio_nm")
  planStudioDivCode     String    @default("IA") @map("plan_studio_div_code")
  planCn                String?   @map("plan_cn")
  comentCn              String?   @map("coment_cn")
  sortOrdr              Int       @default(0) @map("sort_ordr")
  creatMberId           String?   @map("creat_mber_id")
  creatDt               DateTime  @default(now()) @map("creat_dt") @db.Timestamp(3)
  mdfcnDt               DateTime? @map("mdfcn_dt") @db.Timestamp(3)

  project   TbPjProject              @relation(fields: [prjctId], references: [prjctId], onDelete: Cascade)
  artifacts TbDsPlanStudioArtf[]
  contexts  TbDsPlanStudioCtxt[]

  @@unique([prjctId, planStudioDisplayId], map: "tb_ds_plan_studio_display_id_uk")
  @@index([prjctId, sortOrdr])
  @@index([prjctId, planStudioDivCode])
  @@map("tb_ds_plan_studio")
}

model TbDsPlanStudioArtf {
  artfId          String    @id @map("artf_id")
  planStudioId    String    @map("plan_studio_id")
  verNo           Int       @default(1) @map("ver_no")
  artfFmtCode     String    @default("MD") @map("artf_fmt_code")
  artfCn          String?   @map("artf_cn")
  goodDesignYn    String    @default("N") @map("good_design_yn") @db.Char(1)
  aiTaskId        String?   @map("ai_task_id")
  creatMberId     String?   @map("creat_mber_id")
  creatDt         DateTime  @default(now()) @map("creat_dt") @db.Timestamp(3)
  mdfrMberId      String?   @map("mdfr_mber_id")
  mdfcnDt         DateTime? @map("mdfcn_dt") @db.Timestamp(3)

  planStudio TbDsPlanStudio @relation(fields: [planStudioId], references: [planStudioId], onDelete: Cascade)

  @@index([planStudioId, artfFmtCode, verNo(sort: Desc)])
  @@index([aiTaskId])
  @@map("tb_ds_plan_studio_artf")
}

model TbDsPlanStudioCtxt {
  ctxtId        String    @id @map("ctxt_id")
  planStudioId  String    @map("plan_studio_id")
  ctxtTyCode    String    @map("ctxt_ty_code")
  refId         String    @map("ref_id")
  sortOrdr      Int       @default(0) @map("sort_ordr")
  creatMberId   String?   @map("creat_mber_id")
  creatDt       DateTime  @default(now()) @map("creat_dt") @db.Timestamp(3)

  planStudio TbDsPlanStudio @relation(fields: [planStudioId], references: [planStudioId], onDelete: Cascade)

  @@unique([planStudioId, ctxtTyCode, refId])
  @@index([ctxtTyCode, refId])
  @@map("tb_ds_plan_studio_ctxt")
}
```

> **주의:** `good_design_yn`의 partial unique index와 CHECK 제약은 Prisma가 직접 표현 못함. `prisma db pull` 시 무시되거나 raw SQL 마이그레이션으로 별도 관리 필요. **이미 DDL을 직접 실행했으므로 Prisma 모델은 introspect 결과를 그대로 사용**할 것.

## 9. 구현 우선순위 (Claude Code 작업 순서 권장)

| 순서 | 작업 | 산출물 |
|:-----|:-----|:-------|
| 1 | Prisma introspect → 3개 모델 추가 | `schema.prisma` |
| 2 | 코드 상수 + 디렉토리 골격 | `constants/planStudio.ts` |
| 3 | 목록 + 생성 (FID-PS-01, 02, 03) | API + 페이지 |
| 4 | 상세 조회 (FID-PS-04) | API + 페이지 |
| 5 | 수동 저장 (FID-PS-05) | API |
| 6 | 컨텍스트 팝업 2종 (FID-PS-11, 12) | 컴포넌트 + API 검색 파라미터 |
| 7 | 산출물 뷰어 + 미리보기 (FID-PS-07) | 컴포넌트 |
| 8 | AI 생성 통합 (FID-PS-13) | API + 프롬프트 빌더 + AI 클라이언트 |
| 9 | 변경 이력 + 좋은 설계 토글 (FID-PS-08, 10) | API + 패널 |
| 10 | 원문 직접 수정 (FID-PS-09) | API |

> 각 단계는 독립적으로 동작 가능하도록 설계됨. Claude Code에서 단계별 커밋 권장.

## 10. 미해결·향후 이슈

| 항목 | 현재 처리 | 향후 |
|:-----|:---------|:-----|
| 간접 순환 차단 (A→B→A) | AI 생성 시 재귀 깊이 3 + 방문 set | 저장 시점 차단으로 강화 가능 |
| 토큰량 사전 표시 | 미구현 | 칩에 추정 토큰 표시 (tiktoken 또는 단순 char/4) |
| UNIT, SCREEN 컨텍스트 | 코드값만 정의, UI 미구현 | 매핑 테이블 동일 사용 |
| 시스템 프롬프트 외부 관리 | 별도 prompt repo 가정 | tb_ds_prompt 같은 테이블화 검토 |
| AI 비동기 처리 | 동기 처리 (요청-응답) | 큐 + 폴링 또는 SSE 검토 |
| 권한 상세 검증 | RBAC 미들웨어 가정 | 기존 시스템 정책 따름 |