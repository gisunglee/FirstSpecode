# UW-00016 사용자스토리 CRUD

> ## 1. 개요
| 항목 | 내용 |
|:-----|:-----|
| **단위업무ID** | UW-00016 |
| **단위업무명** | 사용자스토리 CRUD |
| **비즈니스 목적** | PM/기획자가 요구사항을 사용자 관점으로 구체화한 스토리를 생성·수정·삭제한다. 과업·요구사항 맥락을 항상 표시하여 수백 개의 스토리 중에서도 빠르게 탐색할 수 있으며, AI 초안 생성과 Given/When/Then 템플릿으로 작성을 지원한다. |
| **관련 요구사항** | RQ-00016, RQ-00015, RQ-00018 |

## 2. 화면 목록
| 화면ID | 화면명 | URL | 유형 | 설명 |
|:-------|:-------|:----|:-----|:-----|
| PID-00033 | 사용자스토리 목록 | /projects/{projectId}/user-stories | LIST | 카드 형태 목록, 과업·요구사항 필터, 키워드 검색 |
| PID-00034 | 사용자스토리 상세 | /projects/{projectId}/user-stories/{storyId} | DETAIL | 생성·수정 공용 폼, AI 초안 생성 |

## 3. 화면 흐름
```
[기획 레이어 > 사용자스토리 목록]
    │ 화면 진입 시 → 전체 스토리 카드 목록 자동 조회
    │ 과업 필터 선택 → 요구사항 필터 연동 갱신
    │ [스토리 추가] 클릭 → 사용자스토리 상세 (신규)
    │ 카드 클릭 → 사용자스토리 상세 (수정)
    │ 카드 [삭제] 클릭 → 확인 모달 → 삭제 처리
    ▼
[사용자스토리 상세]
    │ [AI 초안 생성] 클릭 → AI 생성 → 폼 바인딩
    │ [저장] 클릭 → 목록으로 복귀
```

| 이동 | 전달 파라미터 | 동작 |
|:-----|:-------------|:-----|
| 목록 → 상세 (신규) | projectId | [스토리 추가] 클릭 |
| 목록 → 상세 (수정) | projectId, storyId | 카드 클릭 |
| 상세 → 목록 | - | 저장 완료 또는 취소 |

## 4. 권한 정의
| 기능 | VIEWER | PM/DESIGNER/DEVELOPER | ADMIN | OWNER |
|:-----|:-------|:----------------------|:------|:------|
| 목록 조회 | ✅ | ✅ | ✅ | ✅ |
| 생성·수정 | ❌ | ✅ | ✅ | ✅ |
| 삭제 | ❌ | ✅ | ✅ | ✅ |
| AI 초안 생성 | ❌ | ✅ | ✅ | ✅ |

## 5. 상태 정의
> 사용자스토리는 별도 상태 전이 없음.

## 6. 참조 테이블
- <TABLE_SCRIPT:tb_rq_user_story>
- <TABLE_SCRIPT:tb_rq_acceptance_criteria>
- <TABLE_SCRIPT:tb_rq_requirement>
- <TABLE_SCRIPT:tb_rq_task>

총 화면 2개 · 영역 4개 · 기능 8개

---

## PID-00033 사용자스토리 목록

### AR-00048 검색 필터 (SEARCH)

### 영역: [AR-00048] 검색 필터

**유형:** SEARCH

**UI 구조**
```
+──────────────────────────────────────────────────────+
| [과업 전체 v]  [요구사항 전체 v]  [키워드 검색...  ] |
+──────────────────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 과업 필터 | select | 프로젝트 내 과업 목록, 선택 시 요구사항 필터 연동 | 전체 |
| 요구사항 필터 | select | 선택된 과업의 요구사항 목록 | 전체 |
| 키워드 검색 | text input | 스토리명·페르소나 부분 일치 검색 | - |

#### FID-00110 필터 및 검색 실행

#### 기능: [FID-00110] 필터 및 검색 실행

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/user-stories?taskId=&requirementId=&keyword=` |
| **트리거** | 과업·요구사항 필터 변경, 키워드 입력 시 |

**Input**
| 파라미터 | 타입 | 필수 | 설명 |
|:---------|:-----|:-----|:-----|
| taskId | string | N | 과업 필터 |
| requirementId | string | N | 요구사항 필터 |
| keyword | string | N | 스토리명·페르소나 검색 |

**처리 로직**
```
1. 과업 선택 시 tb_rq_requirement에서 task_id 기준 요구사항 목록 조회 → 요구사항 필터 갱신
2. 조건 적용하여 tb_rq_user_story 목록 재조회
3. story_nm, persona_cn 부분 일치 검색
4. 결과 0건 시 안내 표시
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_rq_task | task_id | 과업 필터 옵션 |
| tb_rq_requirement | req_id | 요구사항 필터 옵션 (task_id 연동) |
| tb_rq_user_story | story_nm | 키워드 검색 대상 |
| tb_rq_user_story | persona_cn | 키워드 검색 대상 |

### AR-00049 스토리 카드 목록 (GRID)

### 영역: [AR-00049] 스토리 카드 목록

**유형:** GRID

**UI 구조**
```
+──────────────────────────────────────────────────────+
| 총 N건                              [스토리 추가]    |
|──────────────────────────────────────────────────────|
| +──────────────────────+  +──────────────────────+   |
| | [과업명] > [요구사항] |  | [과업명] > [요구사항] |  |
| | 스토리명              |  | 스토리명              |  |
| | 페르소나: ...         |  | 페르소나: ...         |  |
| | 인수기준 N개          |  | 인수기준 N개          |  |
| |              [삭제]   |  |              [삭제]   |  |
| +──────────────────────+  +──────────────────────+   |
+──────────────────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 총 건수 | text | 좌측 상단 '총 N건' | - |
| 스토리 추가 | button (primary) | 상세 화면(신규)으로 이동 | - |
| 과업명 > 요구사항명 | text (breadcrumb) | 카드 상단 맥락 표시 | - |
| 스토리명 | text (bold) | 카드 제목, 클릭 시 상세 화면으로 이동 | - |
| 페르소나 | text | 페르소나 요약 표시 | - |
| 인수기준 건수 | badge | 등록된 인수기준 수 | - |
| 삭제 | button (danger) | 확인 모달 후 삭제 처리 | - |

#### FID-00111 스토리 카드 목록 조회

#### 기능: [FID-00111] 스토리 카드 목록 조회

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/user-stories` |
| **트리거** | 화면 진입 시 자동 실행, 삭제 후 갱신 |

**Output**
| 필드 | 타입 | 설명 |
|:-----|:-----|:-----|
| stories | array | 스토리 목록 |
| totalCount | number | 전체 건수 |

**처리 로직**
```
1. 전체 스토리 조회 API 호출
2. 서버 처리:
   a. tb_rq_user_story에서 prjct_id = 현재 프로젝트 조회
   b. tb_rq_requirement JOIN → req_nm (요구사항명)
   c. tb_rq_task JOIN (requirement 경유) → task_nm (과업명)
   d. tb_rq_acceptance_criteria에서 story_id 기준 COUNT → 인수기준 수
3. 요구사항 기준 그룹, 최신 등록순 정렬
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_rq_user_story | story_id | PK |
| tb_rq_user_story | story_nm | 스토리명 |
| tb_rq_user_story | persona_cn | 페르소나 |
| tb_rq_user_story | req_id | 요구사항 FK |
| tb_rq_requirement | req_nm | 요구사항명 |
| tb_rq_requirement | task_id | 과업 FK |
| tb_rq_task | task_nm | 과업명 |
| tb_rq_acceptance_criteria | story_id | 인수기준 카운트 |

#### FID-00112 스토리 삭제

#### 기능: [FID-00112] 스토리 삭제

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | DELETE |
| **API** | `DELETE /api/projects/{projectId}/user-stories/{storyId}` |
| **트리거** | 카드 [삭제] 버튼 클릭 |

**처리 로직**
```
1. 확인 모달 표시: '사용자스토리를 삭제하면 인수기준도 함께 삭제됩니다.'
2. 확인 클릭 시 삭제 API 호출
3. 서버 처리:
   a. tb_rq_user_story DELETE (CASCADE → tb_rq_acceptance_criteria 자동 삭제)
4. 성공 시 카드 목록에서 제거
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_rq_user_story | story_id | 삭제 대상 PK |
| tb_rq_acceptance_criteria | story_id | CASCADE 삭제 |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 서버 오류 | 500 | 삭제 중 오류가 발생했습니다 |

---

## PID-00034 사용자스토리 상세

### AR-00050 브레드크럼 (INFO_CARD)

### 영역: [AR-00050] 브레드크럼

**유형:** INFO_CARD

**UI 구조**
```
+──────────────────────────────────────────────────────+
| 기획 레이어 > [과업명] > [요구사항명] > 사용자스토리  |
+──────────────────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 브레드크럼 | text (link) | 과업·요구사항 클릭 시 해당 화면으로 이동 | - |

#### FID-00113 브레드크럼 맥락 로드

#### 기능: [FID-00113] 브레드크럼 맥락 로드

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **트리거** | 화면 진입 시 자동 실행 |

**처리 로직**
```
1. 요구사항 ID 기반으로 tb_rq_requirement → tb_rq_task JOIN 조회
2. 과업명·요구사항명 브레드크럼에 표시
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_rq_requirement | req_nm | 요구사항명 |
| tb_rq_requirement | task_id | 과업 FK |
| tb_rq_task | task_nm | 과업명 |

### AR-00051 스토리 입력 폼 (FORM)

### 영역: [AR-00051] 스토리 입력 폼

**유형:** FORM

**UI 구조**
```
+──────────────────────────────────────────────────────+
|                          [AI 초안 생성]               |
| 스토리명 *                                            |
| [________________________________________________]    |
| 페르소나 *                                           |
| [________________________________________________]    |
| 시나리오 *                                           |
| [________________________________________________]    |
|                                                      |
| 인수기준                          [+ 인수기준 추가]  |
| +──────────────────────────────────────────────────+ |
| | Given: [________________________________]  [x]   | |
| | When:  [________________________________]        | |
| | Then:  [________________________________]        | |
| +──────────────────────────────────────────────────+ |
|                           [취소]  [저장]             |
+──────────────────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| AI 초안 생성 | button (secondary) | 요구사항 원문 기반 AI 초안 생성 | - |
| 스토리명 | text input | 필수 | - |
| 페르소나 | text input | 필수 | - |
| 시나리오 | textarea | 필수 | - |
| 인수기준 추가 | text button | Given/When/Then 행 추가 | - |
| Given | text input | 주어진 조건 | - |
| When | text input | 사용자 행동 | - |
| Then | text input | 기대 결과 | - |
| 인수기준 삭제 | icon button (x) | 해당 행 제거 | - |
| 취소 | button (secondary) | 목록으로 복귀 | - |
| 저장 | button (primary) | 유효성 검증 후 저장 | - |

#### FID-00114 스토리 데이터 로드

#### 기능: [FID-00114] 스토리 데이터 로드

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/user-stories/{storyId}` |
| **트리거** | 수정 모드 진입 시 자동 실행 |

**Output**
| 필드 | 타입 | 설명 |
|:-----|:-----|:-----|
| storyId | string | 스토리 ID |
| name | string | 스토리명 |
| persona | string | 페르소나 |
| scenario | string | 시나리오 |
| acceptanceCriteria | array | 인수기준 [{given, when, then}] |

**처리 로직**
```
1. storyId 존재 시 API 호출
2. 서버 처리:
   a. tb_rq_user_story에서 story_id로 조회 (story_nm, persona_cn, scenario_cn)
   b. tb_rq_acceptance_criteria에서 story_id로 조회 (given_cn, when_cn, then_cn, sort_ordr)
3. 폼 바인딩
4. 신규면 빈 폼, 인수기준 1행 기본 표시
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_rq_user_story | story_nm | 스토리명 |
| tb_rq_user_story | persona_cn | 페르소나 |
| tb_rq_user_story | scenario_cn | 시나리오 |
| tb_rq_acceptance_criteria | given_cn | Given 조건 |
| tb_rq_acceptance_criteria | when_cn | When 행동 |
| tb_rq_acceptance_criteria | then_cn | Then 결과 |
| tb_rq_acceptance_criteria | sort_ordr | 인수기준 순서 |

#### FID-00115 AI 초안 생성

#### 기능: [FID-00115] AI 초안 생성

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | INSERT |
| **API** | `POST /api/projects/{projectId}/user-stories/ai-draft` |
| **트리거** | [AI 초안 생성] 버튼 클릭 |

**Input**
| 파라미터 | 타입 | 필수 | 설명 |
|:---------|:-----|:-----|:-----|
| requirementId | string | Y | 기반이 되는 요구사항 ID |

**Output**
| 필드 | 타입 | 설명 |
|:-----|:-----|:-----|
| name | string | 생성된 스토리명 |
| persona | string | 생성된 페르소나 |
| scenario | string | 생성된 시나리오 |
| acceptanceCriteria | array | 생성된 인수기준 [{given, when, then}] |

**처리 로직**
```
1. 버튼 클릭 시 로딩 상태 표시
2. 서버 처리: tb_rq_requirement에서 orgnl_cn, curncy_cn, spec_cn 조회 → AI에 전달
3. 생성 결과를 폼에 바인딩 (기존 입력값 덮어씀)
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_rq_requirement | orgnl_cn | AI 입력 (원문) |
| tb_rq_requirement | curncy_cn | AI 입력 (현행화) |
| tb_rq_requirement | spec_cn | AI 입력 (명세) |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| AI 생성 실패 | 500 | 초안 생성 중 오류가 발생했습니다 |

#### FID-00116 스토리 저장

#### 기능: [FID-00116] 스토리 저장

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | INSERT / UPDATE |
| **API** | 신규: `POST /api/projects/{projectId}/user-stories` / 수정: `PUT /api/projects/{projectId}/user-stories/{storyId}` |
| **트리거** | [저장] 버튼 클릭 |

**Input**
| 파라미터 | 타입 | 필수 | 설명 |
|:---------|:-----|:-----|:-----|
| requirementId | string | Y | 연결된 요구사항 ID |
| name | string | Y | 스토리명 |
| persona | string | Y | 페르소나 |
| scenario | string | Y | 시나리오 |
| acceptanceCriteria | array | N | [{given, when, then}] |

**처리 로직**
```
1. 스토리명·페르소나·시나리오 필수 검증
2. API 호출 (신규: POST, 수정: PUT)
3. 서버 처리:
   a. 신규: tb_rq_user_story INSERT (story_display_id = MAX+1 자동 채번, sort_ordr = 마지막+1)
   b. 수정: tb_rq_user_story UPDATE (story_nm, persona_cn, scenario_cn, mdfcn_dt = NOW())
   c. 인수기준 일괄 처리:
      - 수정 시: tb_rq_acceptance_criteria DELETE WHERE story_id (기존 전체 삭제)
      - tb_rq_acceptance_criteria INSERT (배열 순서대로, sort_ordr = 인덱스)
4. 성공 시 목록으로 복귀
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_rq_user_story | story_id | PK, UUID (신규) |
| tb_rq_user_story | story_display_id | MAX+1 자동 채번 (STR-NNNNN) |
| tb_rq_user_story | req_id | 요구사항 FK |
| tb_rq_user_story | story_nm | 스토리명 |
| tb_rq_user_story | persona_cn | 페르소나 |
| tb_rq_user_story | scenario_cn | 시나리오 |
| tb_rq_user_story | sort_ordr | 정렬 순서 |
| tb_rq_user_story | mdfcn_dt | 수정 일시 |
| tb_rq_acceptance_criteria | ac_id | PK, UUID |
| tb_rq_acceptance_criteria | story_id | 스토리 FK |
| tb_rq_acceptance_criteria | given_cn | Given 조건 |
| tb_rq_acceptance_criteria | when_cn | When 행동 |
| tb_rq_acceptance_criteria | then_cn | Then 결과 |
| tb_rq_acceptance_criteria | sort_ordr | 인수기준 순서 |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 필수 항목 미입력 | - | 스토리명·페르소나·시나리오를 입력해 주세요 |
| 서버 오류 | 500 | 저장 중 오류가 발생했습니다 |

#### FID-00117 인수기준 행 추가

#### 기능: [FID-00117] 인수기준 행 추가

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | BUTTON |
| **트리거** | [+ 인수기준 추가] 버튼 클릭 |

**처리 로직**
```
1. Given/When/Then 입력 행 1개 추가
2. 빈 상태로 포커스 이동
```

---
