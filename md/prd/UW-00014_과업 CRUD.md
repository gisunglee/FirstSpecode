# UW-00014 과업 CRUD

> ## 1. 개요
| 항목 | 내용 |
|:-----|:-----|
| **단위업무ID** | UW-00014 |
| **단위업무명** | 과업 CRUD |
| **비즈니스 목적** | PM이 RFP 대항목 단위로 과업을 생성·수정·삭제하고, 요구사항 건수·진행률 요약 정보를 목록에서 확인한다. 드래그앤드롭으로 순서를 조정하며, 동일 프로젝트 내 복사가 가능하다. |
| **관련 요구사항** | RQ-00014, RQ-00015, RQ-00018 |

## 2. 화면 목록
| 화면ID | 화면명 | URL | 유형 | 설명 |
|:-------|:-------|:----|:-----|:-----|
| PID-00028 | 과업 목록 | /projects/{projectId}/tasks | LIST | 과업 목록, 드래그앤드롭 순서 조정, 요약 정보 표시 |
| PID-00029 | 과업 상세 | /projects/{projectId}/tasks/{taskId} | DETAIL | 과업 생성·수정 공용 폼 |

## 3. 화면 흐름
```
[기획 레이어 > 과업 목록]
    │ 화면 진입 시 → 과업 목록 자동 조회
    │ [과업 추가] 버튼 클릭 → 과업 상세 화면 (신규)
    │ 과업 행 클릭 → 과업 상세 화면 (수정)
    │ 드래그앤드롭 → 순서 즉시 저장
    │ [복사] 버튼 클릭 → 동일 프로젝트 내 즉시 복사
    │ [삭제] 버튼 클릭 → 삭제 옵션 모달
    ▼
[과업 상세]
    │ 저장 완료 → 과업 목록으로 복귀
    │ 취소 → 과업 목록으로 복귀
```

| 이동 | 전달 파라미터 | 동작 |
|:-----|:-------------|:-----|
| 과업 목록 → 과업 상세 (신규) | projectId | [과업 추가] 클릭 |
| 과업 목록 → 과업 상세 (수정) | projectId, taskId | 과업 행 클릭 |
| 과업 상세 → 과업 목록 | - | 저장 완료 또는 취소 |

## 4. 권한 정의
| 기능 | VIEWER | PM/DESIGNER/DEVELOPER | ADMIN | OWNER |
|:-----|:-------|:----------------------|:------|:------|
| 과업 목록 조회 | ✅ | ✅ | ✅ | ✅ |
| 과업 생성·수정 | ❌ | ✅ | ✅ | ✅ |
| 과업 삭제 | ❌ | ✅ | ✅ | ✅ |
| 과업 복사 | ❌ | ✅ | ✅ | ✅ |
| 순서 조정 | ❌ | ✅ | ✅ | ✅ |

## 5. 상태 정의
> 과업은 별도 상태 전이 없음.

## 6. 참조 테이블
- <TABLE_SCRIPT:tb_rq_task>
- <TABLE_SCRIPT:tb_rq_requirement>
- <TABLE_SCRIPT:tb_rq_user_story>
- <TABLE_SCRIPT:tb_rq_acceptance_criteria>

총 화면 2개 · 영역 2개 · 기능 7개

---

## PID-00028 과업 목록

### AR-00040 과업 목록 (GRID)

### 영역: [AR-00040] 과업 목록

**유형:** GRID

**UI 구조**
```
+──────────────────────────────────────────────────────────────────+
| 총 N건                                          [과업 추가]      |
|──────────────────────────────────────────────────────────────────|
| ≡ | 과업명 | 카테고리 | 요구사항 | HIGH/MED/LOW | 진행률 | 액션 |
| ≡ | ...    | 신규개발 | 12건     | 3/6/3        | 45%    | [복사][삭제] |
| ≡ | ...    | 기능개선 | 5건      | 1/3/1        | 80%    | [복사][삭제] |
+──────────────────────────────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 드래그 핸들 | icon (≡) | 드래그앤드롭 순서 조정 | - |
| 과업명 | text (link) | 클릭 시 상세 화면으로 이동 | - |
| 카테고리 | badge | 신규개발/기능개선/유지보수 | - |
| 요구사항 건수 | text | 전체 요구사항 건수 | - |
| 우선순위별 현황 | text | HIGH/MEDIUM/LOW 건수 | - |
| 진행률 | progress bar | 연결된 기능 기준 설계·구현 완료 비율 | - |
| 복사 | button (secondary) | 동일 프로젝트 내 즉시 복사 | - |
| 삭제 | button (danger) | 삭제 옵션 모달 표시 | - |

#### FID-00092 과업 목록 조회

#### 기능: [FID-00092] 과업 목록 조회

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/tasks` |
| **트리거** | 화면 진입 시 자동 실행, 복사·삭제 후 갱신 |

**Output**
| 필드 | 타입 | 설명 |
|:-----|:-----|:-----|
| tasks | array | 과업 목록 (taskId, displayId, name, category, requirementCount, prioritySummary, progressRate, sortOrder) |
| totalCount | number | 전체 과업 수 |

**처리 로직**
```
1. 과업 목록 API 호출
2. 서버 처리:
   a. tb_rq_task에서 prjct_id = 현재 프로젝트, sort_ordr 오름차순 조회
   b. 과업별 tb_rq_requirement COUNT (task_id 기준)
   c. 과업별 tb_rq_requirement에서 priort_code 그룹 카운트 → HIGH/MEDIUM/LOW 현황
   d. 진행률: 과업 → 요구사항 → 단위업무 → 기능 연결 추적, 기능 상태(IMPL_DONE) 비율 계산
3. 과업 목록 sortOrder 기준 오름차순 표시
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_rq_task | task_id | PK |
| tb_rq_task | task_display_id | 표시 ID (SFR-NNNNN) |
| tb_rq_task | task_nm | 과업명 |
| tb_rq_task | ctgry_code | 카테고리 (NEW_DEV/IMPROVE/MAINTAIN) |
| tb_rq_task | sort_ordr | 정렬 순서 |
| tb_rq_requirement | task_id | 과업별 요구사항 카운트 |
| tb_rq_requirement | priort_code | 우선순위별 현황 |

#### FID-00093 과업 순서 조정

#### 기능: [FID-00093] 과업 순서 조정

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | UPDATE |
| **API** | `PUT /api/projects/{projectId}/tasks/sort` |
| **트리거** | 드래그앤드롭으로 순서 변경 완료 시 |

**Input**
| 파라미터 | 타입 | 필수 | 설명 |
|:---------|:-----|:-----|:-----|
| taskIds | array | Y | 변경된 순서대로 정렬된 taskId 배열 |

**처리 로직**
```
1. 드래그 완료 시 현재 순서 배열 추출
2. 순서 저장 API 호출
3. 서버 처리: tb_rq_task.sort_ordr 일괄 UPDATE (배열 인덱스 기반)
4. 성공 시 목록 순서 인라인 갱신
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_rq_task | sort_ordr | 순서 일괄 갱신 |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 서버 오류 | 500 | 순서 저장 중 오류가 발생했습니다 |

#### FID-00094 과업 복사

#### 기능: [FID-00094] 과업 복사

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | INSERT |
| **API** | `POST /api/projects/{projectId}/tasks/{taskId}/copy` |
| **트리거** | [복사] 버튼 클릭 |

**처리 로직**
```
1. 복사 API 호출
2. 서버 처리:
   a. tb_rq_task INSERT (task_nm = '[복사] 원본과업명', task_display_id = MAX+1 자동 채번)
   b. 원본 과업의 tb_rq_requirement 전체 복사 (req_display_id 자동 채번)
   c. 각 요구사항의 tb_rq_user_story 전체 복사 (story_display_id 자동 채번)
   d. 각 스토리의 tb_rq_acceptance_criteria 전체 복사
   e. 연결된 단위업무·화면은 미복사
3. 성공 시 목록 맨 아래 추가 후 갱신
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_rq_task | task_id | 원본 조회 + 복사본 PK 생성 |
| tb_rq_task | task_display_id | MAX+1 자동 채번 |
| tb_rq_requirement | req_id | 하위 요구사항 복사 |
| tb_rq_user_story | story_id | 하위 스토리 복사 |
| tb_rq_acceptance_criteria | ac_id | 하위 인수기준 복사 |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 서버 오류 | 500 | 복사 중 오류가 발생했습니다 |

#### FID-00095 과업 삭제

#### 기능: [FID-00095] 과업 삭제

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | DELETE |
| **API** | `DELETE /api/projects/{projectId}/tasks/{taskId}` |
| **트리거** | 삭제 모달에서 [삭제 확인] 버튼 클릭 |

**Input**
| 파라미터 | 타입 | 필수 | 설명 |
|:---------|:-----|:-----|:-----|
| deleteType | string | Y | ALL(하위 전체 삭제) / TASK_ONLY(과업만 삭제) |

**처리 로직**
```
1. [삭제] 버튼 클릭 → 삭제 옵션 모달 표시
2. [삭제 확인] 클릭 → API 호출
3. 서버 처리:
   a. deleteType = 'ALL':
      - tb_rq_task DELETE (CASCADE → requirement → user_story → acceptance_criteria 전체 삭제)
   b. deleteType = 'TASK_ONLY':
      - tb_rq_requirement UPDATE (task_id = NULL) WHERE task_id = 삭제 대상 (하위 요구사항 미분류로 유지)
      - tb_rq_task DELETE
4. 성공 시 목록에서 해당 행 제거
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_rq_task | task_id | 삭제 대상 PK |
| tb_rq_requirement | task_id | ALL: CASCADE 삭제 / TASK_ONLY: NULL SET |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 서버 오류 | 500 | 삭제 중 오류가 발생했습니다 |

---

## PID-00029 과업 상세

### AR-00041 과업 입력 폼 (FORM)

### 영역: [AR-00041] 과업 입력 폼

**유형:** FORM

**UI 구조**
```
+─────────────────────────────────────────────+
| 과업명 *                                    |
| [___________________________________________]|
|                                             |
| 카테고리 *              RFP 페이지 번호      |
| [신규개발 v]            [________]           |
|                                             |
| 정의                                        |
| [___________________________________________]|
|                                             |
| 세부내용 (마크다운 에디터)                   |
| [편집] [미리보기]                            |
| +─────────────────────────────────────────+ |
| |                                         | |
| +─────────────────────────────────────────+ |
|                                             |
| 산출물                                      |
| [___________________________________________]|
|                                             |
|              [취소]  [저장]                 |
+─────────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 과업명 | text input | 필수 | - |
| 카테고리 | select | 신규개발/기능개선/유지보수, 필수 | 신규개발 |
| RFP 페이지 번호 | text input | 선택, 원문 추적용 | - |
| 정의 | textarea | 과업 범위 요약, 선택 | - |
| 세부내용 | 마크다운 에디터 | RFP 원문 전체, 편집/미리보기 탭 전환 | - |
| 산출물 | textarea | 산출물 목록, 선택 | - |
| 취소 | button (secondary) | 과업 목록으로 복귀 | - |
| 저장 | button (primary) | 유효성 검증 후 저장 API 호출 | - |

#### FID-00096 과업 데이터 로드

#### 기능: [FID-00096] 과업 데이터 로드

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/tasks/{taskId}` |
| **트리거** | 수정 모드 진입 시 자동 실행 (taskId 존재하는 경우) |

**Output**
| 필드 | 타입 | 설명 |
|:-----|:-----|:-----|
| taskId | string | 과업 ID |
| displayId | string | 표시 ID (SFR-NNNNN) |
| name | string | 과업명 |
| category | string | 카테고리 |
| definition | string | 정의 |
| content | string | 세부내용 (마크다운) |
| outputInfo | string | 산출물 |
| rfpPage | string | RFP 페이지 번호 |

**처리 로직**
```
1. taskId가 있으면 API 호출
2. 서버 처리: tb_rq_task에서 task_id로 조회
3. 폼에 데이터 바인딩
4. taskId가 없으면 (신규) → 빈 폼 표시
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_rq_task | task_nm | 과업명 |
| tb_rq_task | ctgry_code | 카테고리 |
| tb_rq_task | defn_cn | 정의 |
| tb_rq_task | dtl_cn | 세부내용 (마크다운) |
| tb_rq_task | output_info_cn | 산출물 |
| tb_rq_task | rfp_page_no | RFP 페이지 번호 |

#### FID-00097 과업 저장

#### 기능: [FID-00097] 과업 저장

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | INSERT / UPDATE |
| **API** | 신규: `POST /api/projects/{projectId}/tasks` / 수정: `PUT /api/projects/{projectId}/tasks/{taskId}` |
| **트리거** | [저장] 버튼 클릭 |

**Input**
| 파라미터 | 타입 | 필수 | 설명 |
|:---------|:-----|:-----|:-----|
| name | string | Y | 과업명 |
| category | string | Y | NEW_DEV/IMPROVE/MAINTAIN |
| definition | string | N | 정의 |
| content | string | N | 세부내용 (마크다운) |
| outputInfo | string | N | 산출물 |
| rfpPage | string | N | RFP 페이지 번호 |

**처리 로직**
```
1. 과업명·카테고리 필수 검증
2. API 호출 (신규: POST, 수정: PUT)
3. 서버 처리:
   a. 신규: tb_rq_task INSERT (task_display_id = MAX+1 자동 채번, sort_ordr = 마지막+1)
   b. 수정: tb_rq_task UPDATE (task_nm, ctgry_code, defn_cn, dtl_cn, output_info_cn, rfp_page_no, mdfcn_dt = NOW())
4. 성공 시 과업 목록으로 복귀
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_rq_task | task_id | PK, UUID 자동 생성 (신규) |
| tb_rq_task | task_display_id | MAX+1 자동 채번 (신규) |
| tb_rq_task | task_nm | 과업명 |
| tb_rq_task | ctgry_code | 카테고리 |
| tb_rq_task | defn_cn | 정의 |
| tb_rq_task | dtl_cn | 세부내용 |
| tb_rq_task | output_info_cn | 산출물 |
| tb_rq_task | rfp_page_no | RFP 페이지 번호 |
| tb_rq_task | sort_ordr | 정렬 순서 (신규 시 마지막+1) |
| tb_rq_task | mdfcn_dt | 수정 일시 갱신 |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 과업명 미입력 | - | 과업명을 입력해 주세요 |
| 카테고리 미선택 | - | 카테고리를 선택해 주세요 |
| 서버 오류 | 500 | 저장 중 오류가 발생했습니다 |

#### FID-00098 마크다운 미리보기 저장

#### 기능: [FID-00098] 마크다운 미리보기 저장

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | BUTTON |
| **트리거** | [미리보기] 탭 클릭 시 |

**처리 로직**
```
1. 마크다운 원문을 HTML로 렌더링
2. 편집/미리보기 탭 전환은 클라이언트 사이드 처리
```

---
