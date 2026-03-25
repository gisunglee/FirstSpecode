# UW-00019 단위업무 CRUD

> ## 1. 개요
| 항목 | 내용 |
|:-----|:-----|
| **단위업무ID** | UW-00019 |
| **단위업무명** | 단위업무 CRUD |
| **비즈니스 목적** | 요구사항을 실제 개발 단위로 쪼개는 중간 계층으로 화면들의 묶음을 관리한다. 상위 과업·요구사항 정보를 함께 표시하여 컨텍스트 파악이 쉽도록 하며, 담당자·일정·진척률을 직접 관리한다. |
| **관련 요구사항** | RQ-00019, RQ-00015, RQ-00020 |
| **기술 스택** | TanStack Query (목록 캐시), useMutation (CUD), @dnd-kit (드래그앤드롭), TanStack Table (그리드) |

## 2. 화면 목록
| 화면ID | 화면명 | URL | 유형 | 설명 |
|:-------|:-------|:----|:-----|:-----|
| PID-00040 | 단위업무 목록 | /projects/{projectId}/unit-works | LIST | 단위업무 목록 조회, 진척률 인라인 편집, 드래그앤드롭 순서 조정 |
| PID-00041 | 단위업무 상세·편집 | /projects/{projectId}/unit-works/{unitWorkId} | DETAIL | 단위업무 생성·수정, 담당자·일정·진척률·상위 요구사항 변경 |
| PID-00042 | 단위업무 삭제 확인 | - | POPUP | 하위 전체 삭제 vs 단위업무만 삭제 선택 |

## 3. 화면 흐름
~~~
[단위업무 목록] ──(행 클릭)──▶ [단위업무 상세·편집]
[단위업무 목록] ──(신규 등록)──▶ [단위업무 상세·편집 (신규)]
[단위업무 목록] ──(삭제 버튼)──▶ [단위업무 삭제 확인 POPUP]
[단위업무 목록] ──(바로가기 아이콘)──▶ [화면 목록]
[단위업무 목록] ──(요구사항명 클릭)──▶ [요구사항 상세]
[단위업무 삭제 확인 POPUP] ──(확인)──▶ [단위업무 목록 (갱신)]
[단위업무 상세·편집] ──(저장)──▶ [단위업무 목록]
~~~

| 이동 | 전달 파라미터 | 동작 |
|:-----|:-------------|:-----|
| 단위업무 목록 → 상세·편집 | unitWorkId | 행 클릭 |
| 단위업무 목록 → 화면 목록 | unitWorkId | 바로가기 아이콘 클릭 |
| 단위업무 목록 → 요구사항 상세 | requirementId | 요구사항명 클릭 |
| 단위업무 목록 → 삭제 확인 | unitWorkId | 삭제 버튼 클릭 |

## 4. 권한 정의
| 기능 | VIEWER | PM/DESIGNER/DEVELOPER | ADMIN | OWNER |
|:-----|:-------|:----------------------|:------|:------|
| 단위업무 목록 조회 | ✅ | ✅ | ✅ | ✅ |
| 단위업무 생성·수정 | ❌ | ✅ | ✅ | ✅ |
| 단위업무 삭제 | ❌ | ✅ | ✅ | ✅ |
| 진척률 인라인 편집 | ❌ | ✅ | ✅ | ✅ |
| 순서 조정 | ❌ | ✅ | ✅ | ✅ |

## 5. 상태 정의
> 상태 전이가 없는 업무는 이 섹션을 생략합니다.

## 6. 참조 테이블
- <TABLE_SCRIPT:tb_ds_unit_work>
- <TABLE_SCRIPT:tb_rq_requirement>
- <TABLE_SCRIPT:tb_rq_task>
- <TABLE_SCRIPT:tb_pj_project_member>
- <TABLE_SCRIPT:tb_ds_screen>
- <TABLE_SCRIPT:tb_ds_design_change>

총 화면 3개 · 영역 5개 · 기능 10개

---

## PID-00040 단위업무 목록

### AR-00059 단위업무 목록 그리드 (GRID)

### 영역: [AR-00059] 단위업무 목록 그리드

**유형:** GRID

**UI 구조**
~~~
+──────────────────────────────────────────────────────────────────────────+
| 총 N건                                                    [신규 등록]    |
|──────────────────────────────────────────────────────────────────────────|
| ☰ | 요구사항ID | 요구사항명(링크) | 단위업무명 | 화면수 | 담당자 | 진척률 | 액션         |
| ☰ | RQ-00001  | [요구사항A]     | 단위업무1  | 3      | hong   | [75%]  | [→][삭제]    |
| ☰ | RQ-00001  | [요구사항A]     | 단위업무2  | 1      | kim    | [40%]  | [→][삭제]    |
| ☰ | RQ-00002  | [요구사항B]     | 단위업무3  | 5      | -      | [0%]   | [→][삭제]    |
+──────────────────────────────────────────────────────────────────────────+
~~~

**구성 항목**
| 항목명 | UI 타입 | 관련 컬럼 | 설명 |
|:-------|:--------|:----------|:-----|
| 드래그 핸들 | icon (☰) | - | 드래그앤드롭 순서 조정 |
| 요구사항 ID | text | tb_rq_requirement.req_display_id | 상위 요구사항 ID 표시 (예: REQ-00001) |
| 요구사항명 | text (link) | tb_rq_requirement.req_nm | 상위 요구사항명, 클릭 시 요구사항 상세 화면 이동 |
| 단위업무명 | text (link) | tb_ds_unit_work.unit_work_nm | 클릭 시 단위업무 상세·편집 화면 이동 |
| 화면 수 | text | tb_ds_screen COUNT | 하위 화면 개수 |
| 담당자 | text | tb_pj_project_member.mber_nm | 지정된 담당자명, 미지정 시 '-' |
| 진척률 | number input | tb_ds_unit_work.progrs_rt | 클릭 시 0~100 직접 입력 가능 (인라인) |
| 바로가기 | icon button (→) | - | 클릭 시 하위 화면 목록으로 이동 |
| 삭제 | button (danger) | - | 클릭 시 삭제 확인 POPUP 표시 |
| 신규 등록 | button (primary) | - | 단위업무 상세·편집 화면(신규)으로 이동 |

---

#### FID-00193 단위업무 목록 조회

#### 기능: [FID-00193] 단위업무 목록 조회

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/unit-works` |
| **트리거** | 화면 진입 시 자동 실행 |

**Output**
| 필드 | 타입 | 설명 |
|:-----|:-----|:-----|
| items | array | 단위업무 목록 |
| items[].unitWorkId | string | 단위업무 UUID |
| items[].displayId | string | UW-NNNNN 표시 ID |
| items[].name | string | 단위업무명 |
| items[].requirementId | string | 상위 요구사항 UUID |
| items[].requirementDisplayId | string | REQ-NNNNN |
| items[].requirementName | string | 상위 요구사항명 |
| items[].assigneeName | string\|null | 담당자명 |
| items[].screenCount | number | 하위 화면 수 |
| items[].progress | number | 진척률 (0~100) |
| items[].sortOrder | number | 정렬 순서 |
| totalCount | number | 전체 건수 |

**처리 로직**
~~~
1. prjct_id 조건으로 tb_ds_unit_work 목록을 sort_ordr 오름차순 조회
2. tb_rq_requirement JOIN → requirementDisplayId, requirementName
3. tb_pj_project_member JOIN → assigneeName (asign_mber_id 기준)
4. tb_ds_screen 서브쿼리 COUNT → screenCount
~~~

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_ds_unit_work | unit_work_id, req_id, unit_work_display_id, unit_work_nm, asign_mber_id, progrs_rt, sort_ordr | 목록 기본 데이터 |
| tb_rq_requirement | req_display_id, req_nm | 상위 요구사항 정보 JOIN |
| tb_pj_project_member | mber_id, mber_nm | 담당자명 JOIN |
| tb_ds_screen | unit_work_id | 하위 화면 수 COUNT |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 결과 0건 | 200 | '등록된 단위업무가 없습니다' 안내 표시 |
| 프로젝트 비멤버 | 403 | 접근 권한이 없습니다 |
| DB 오류 | 500 | 목록 조회 중 오류가 발생했습니다 |

---

#### FID-00133 진척률 인라인 편집

#### 기능: [FID-00133] 진척률 인라인 편집

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | UPDATE |
| **API** | `PATCH /api/projects/{projectId}/unit-works/{unitWorkId}/progress` |
| **트리거** | 진척률 셀 클릭 후 blur 또는 Enter 입력 시 |

**Input**
| 파라미터 | 타입 | 필수 | 설명 |
|:---------|:-----|:-----|:-----|
| progress | number | Y | 0~100 정수 |

**처리 로직**
~~~
1. 진척률 셀 클릭 시 number input 활성화 (현재 값 자동 선택)
2. 0~100 범위 클라이언트 검증
3. blur 또는 Enter 입력 시 PATCH API 호출
4. 서버 처리:
   a. tb_ds_unit_work.progrs_rt, mdfcn_dt = NOW() UPDATE
   b. tb_ds_design_change INSERT (변경 이력 자동 기록)
      - ref_tbl_nm = 'tb_ds_unit_work'
      - ref_id = unitWorkId
      - snapshot_data = {before: 이전값, after: 새값, field: 'progrs_rt'}
5. 성공 시 셀 값 즉시 갱신
~~~

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_ds_unit_work | unit_work_id, progrs_rt, mdfcn_dt | 진척률 업데이트 |
| tb_ds_design_change | chg_id, prjct_id, ref_tbl_nm, ref_id, snapshot_data, chg_mber_id, chg_dt | 변경 이력 자동 기록 |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 범위 초과 (0~100 외) | - (클라이언트) | 0~100 사이 값을 입력해 주세요 |
| 권한 없음 | 403 | 접근 권한이 없습니다 |
| 서버 오류 | 500 | 저장 중 오류가 발생했습니다 |

---

#### FID-00134 하위 화면 목록 바로가기

#### 기능: [FID-00134] 하위 화면 목록 바로가기

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | BUTTON |
| **API** | 없음 (클라이언트 라우팅) |
| **트리거** | 행 우측 바로가기 아이콘(→) 클릭 시 |

**처리 로직**
~~~
1. 해당 행의 unitWorkId를 쿼리 파라미터로 전달
2. router.push('/projects/{projectId}/screens?unitWorkId={unitWorkId}')
~~~

---

#### FID-00135 요구사항 상세 화면 이동

#### 기능: [FID-00135] 요구사항 상세 화면 이동

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | BUTTON |
| **API** | 없음 (클라이언트 라우팅) |
| **트리거** | 요구사항명 링크 클릭 시 |

**처리 로직**
~~~
1. 해당 행의 requirementId를 경로 파라미터로 전달
2. router.push('/projects/{projectId}/requirements/{requirementId}')
~~~

---

#### FID-00136 드래그앤드롭 순서 조정

#### 기능: [FID-00136] 드래그앤드롭 순서 조정

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | UPDATE |
| **API** | `PUT /api/projects/{projectId}/unit-works/sort` |
| **트리거** | 드래그앤드롭으로 행 위치 변경 완료(onDragEnd) 시 |

**Input**
| 파라미터 | 타입 | 필수 | 설명 |
|:---------|:-----|:-----|:-----|
| orders | array | Y | [{unitWorkId, sortOrder}] 전체 순서 배열 |

**처리 로직**
~~~
1. onDragEnd 이벤트에서 변경된 순서 배열 생성
2. 순서 변경 API 호출
3. 서버 처리: tb_ds_unit_work.sort_ordr 일괄 UPDATE
4. 성공 시 목록 순서 즉시 반영 (캐시 무효화)
~~~

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_ds_unit_work | unit_work_id, sort_ordr, mdfcn_dt | 순서 일괄 갱신 |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 권한 없음 | 403 | 접근 권한이 없습니다 |
| 서버 오류 | 500 | 순서 변경 중 오류가 발생했습니다 |

---

## PID-00041 단위업무 상세·편집

### AR-00060 breadcrumb 컨텍스트 (INFO_CARD)

### 영역: [AR-00060] breadcrumb 컨텍스트

**유형:** INFO_CARD

**UI 구조**
~~~
+──────────────────────────────────────────+
| [과업명] > [요구사항명] > 단위업무명     |
+──────────────────────────────────────────+
~~~

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 과업명 | text (link) | 상위 과업명, 클릭 시 과업 상세 이동 | - |
| 요구사항명 | text (link) | 상위 요구사항명, 클릭 시 요구사항 상세 이동 | - |
| 단위업무명 | text | 현재 단위업무명 (신규 시 '신규 단위업무') | - |

---

#### FID-00137 breadcrumb 표시

#### 기능: [FID-00137] breadcrumb 표시

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | 없음 (FID-00139 상세 조회 응답값 재사용) |
| **트리거** | 화면 진입 시 자동 표시 |

**처리 로직**
~~~
1. FID-00139 상세 조회 응답의 taskName, requirementName 값으로 breadcrumb 구성
2. 신규 모드 시 '신규 단위업무' 텍스트 표시
3. 과업명 클릭 → /projects/{projectId}/tasks/{taskId}
4. 요구사항명 클릭 → /projects/{projectId}/requirements/{requirementId}
~~~

---

### AR-00061 요약 정보 (INFO_CARD)

### 영역: [AR-00061] 요약 정보

**유형:** INFO_CARD

**UI 구조**
~~~
+──────────────────────────────────────────+
| 화면 수: 3    기능 수: 12                |
| 설계율: 75%   구현율: 40%               |
| 직접 진척률: 70%                         |
+──────────────────────────────────────────+
~~~

**구성 항목**
| 항목명 | UI 타입 | 관련 컬럼 | 설명 |
|:-------|:--------|:----------|:-----|
| 화면 수 | text | tb_ds_screen COUNT | 하위 화면 개수 |
| 기능 수 | text | tb_ds_function COUNT | 하위 기능 개수 |
| 설계율 | text | - | 화면 상태 기반 서버 연산 (설계 완료 화면 / 전체 화면) |
| 구현율 | text | - | 기능 상태 기반 서버 연산 (구현 완료 기능 / 전체 기능) |
| 직접 진척률 | text | tb_ds_unit_work.progrs_rt | PM 직접 입력값 |

---

#### FID-00138 요약 정보 조회

#### 기능: [FID-00138] 요약 정보 조회

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/unit-works/{unitWorkId}` (FID-00139와 동일 API) |
| **트리거** | 화면 진입 시 FID-00139와 함께 자동 표시 |

**Output (요약 부분)**
| 필드 | 타입 | 설명 |
|:-----|:-----|:-----|
| screenCount | number | 하위 화면 수 |
| functionCount | number | 하위 기능 수 |
| designRate | number | 설계율 (0~100) |
| implRate | number | 구현율 (0~100) |
| progress | number | 직접 진척률 (progrs_rt) |

**처리 로직**
~~~
1. 상세 조회 응답의 screenCount, functionCount, designRate, implRate, progress 값 표시
2. 설계율·구현율은 서버 자동 계산값 (화면·기능 상태 집계)
3. 직접 진척률은 PM 입력값 (progrs_rt)
4. 신규 모드 시 요약 영역 숨김
~~~

---

### AR-00062 기본 정보 폼 (FORM)

### 영역: [AR-00062] 기본 정보 폼

**유형:** FORM

**UI 구조**
~~~
+──────────────────────────────────────────+
| 단위업무명 * [___________________]        |
| 설명         [___________________]        |
| 상위 요구사항 [요구사항A (RQ-00001) v]   |
| 담당자       [멤버 선택 v]                |
| 시작일       [날짜 선택]                  |
| 종료일       [날짜 선택]                  |
| 직접 진척률 [___] %                      |
|                              [저장]       |
+──────────────────────────────────────────+
~~~

**구성 항목**
| 항목명 | UI 타입 | 관련 컬럼 | 설명 |
|:-------|:--------|:----------|:-----|
| 단위업무명 | text input | tb_ds_unit_work.unit_work_nm | 필수 입력 |
| 설명 | textarea | tb_ds_unit_work.unit_work_dc | 선택 입력 |
| 상위 요구사항 | select | tb_ds_unit_work.req_id | 프로젝트 내 요구사항 목록 (req_display_id + req_nm) |
| 담당자 | select | tb_ds_unit_work.asign_mber_id | 프로젝트 활성 멤버 목록 |
| 시작일 | date picker | tb_ds_unit_work.bgng_de | YYYY-MM-DD |
| 종료일 | date picker | tb_ds_unit_work.end_de | YYYY-MM-DD, 시작일 이후여야 함 |
| 진척률 | number input | tb_ds_unit_work.progrs_rt | 0~100 정수 |
| 저장 | button (primary) | - | 저장 실행 |

---

#### FID-00139 단위업무 상세 조회

#### 기능: [FID-00139] 단위업무 상세 조회

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/unit-works/{unitWorkId}` |
| **트리거** | 수정 모드 진입 시 자동 실행 (신규 모드 시 호출 안 함) |

**Output**
| 필드 | 타입 | 설명 |
|:-----|:-----|:-----|
| unitWorkId | string | 단위업무 UUID |
| displayId | string | UW-NNNNN |
| name | string | 단위업무명 |
| description | string\|null | 설명 (unit_work_dc) |
| requirementId | string | 상위 요구사항 UUID |
| requirementDisplayId | string | REQ-NNNNN |
| requirementName | string | 상위 요구사항명 |
| taskId | string\|null | 상위 과업 UUID |
| taskName | string\|null | 상위 과업명 (breadcrumb용) |
| assigneeMemberId | string\|null | 담당자 회원 UUID |
| assigneeName | string\|null | 담당자명 |
| startDate | string\|null | 시작일 (YYYY-MM-DD) |
| endDate | string\|null | 종료일 (YYYY-MM-DD) |
| progress | number | 진척률 (0~100) |
| screenCount | number | 하위 화면 수 |
| functionCount | number | 하위 기능 수 |
| designRate | number | 설계율 |
| implRate | number | 구현율 |

**처리 로직**
~~~
1. unitWorkId로 tb_ds_unit_work 단건 조회
2. tb_rq_requirement JOIN → requirementDisplayId, requirementName, taskId
3. tb_rq_task JOIN → taskName (breadcrumb용)
4. tb_pj_project_member JOIN → assigneeName
5. tb_ds_screen 서브쿼리 COUNT → screenCount, designRate
6. tb_ds_function 서브쿼리 COUNT → functionCount, implRate
~~~

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_ds_unit_work | unit_work_id, unit_work_nm, unit_work_dc, req_id, asign_mber_id, bgng_de, end_de, progrs_rt | 기본 정보 |
| tb_rq_requirement | req_display_id, req_nm, task_id | 상위 요구사항 JOIN |
| tb_rq_task | task_nm | 과업명 (breadcrumb) JOIN |
| tb_pj_project_member | mber_id, mber_nm | 담당자명 JOIN |
| tb_ds_screen | unit_work_id | 하위 화면 수 / 설계율 집계 |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 항목 없음 | 404 | 단위업무를 찾을 수 없습니다 |
| 서버 오류 | 500 | 조회 중 오류가 발생했습니다 |

---

#### FID-00140 단위업무 저장

#### 기능: [FID-00140] 단위업무 저장

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | INSERT / UPDATE |
| **API** | 신규: `POST /api/projects/{projectId}/unit-works` / 수정: `PUT /api/projects/{projectId}/unit-works/{unitWorkId}` |
| **트리거** | [저장] 버튼 클릭 시 |

**Input**
| 파라미터 | 타입 | 필수 | 설명 |
|:---------|:-----|:-----|:-----|
| name | string | Y | 단위업무명 |
| description | string | N | 설명 |
| requirementId | string | Y | 상위 요구사항 UUID |
| assigneeMemberId | string | N | 담당자 회원 UUID (미선택 시 null) |
| startDate | string | N | 시작일 (YYYY-MM-DD) |
| endDate | string | N | 종료일 (YYYY-MM-DD) |
| progress | number | N | 직접 진척률 (0~100, 기본값 0) |

**Output**
| 필드 | 타입 | 설명 |
|:-----|:-----|:-----|
| unitWorkId | string | 생성/수정된 단위업무 UUID |

**처리 로직**
~~~
1. 단위업무명 공백 검증
2. 종료일 < 시작일 시 오류 반환
3. 신규/수정 분기:
   a. 신규: tb_ds_unit_work INSERT
      - unit_work_display_id = 해당 프로젝트 내 MAX+1 (UW-NNNNN)
      - sort_ordr = 전체 마지막 + 1
   b. 수정: tb_ds_unit_work UPDATE + mdfcn_dt = NOW()
4. 저장 완료 후 tb_ds_design_change INSERT (설계 변경 이력 자동 기록)
   - ref_tbl_nm = 'tb_ds_unit_work', ref_id = unitWorkId
5. 성공 시 '저장되었습니다' 토스트 표시 후 목록으로 복귀
~~~

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_ds_unit_work | unit_work_id(PK), unit_work_display_id(MAX+1 신규), unit_work_nm, unit_work_dc, req_id, asign_mber_id, bgng_de, end_de, progrs_rt, sort_ordr, mdfcn_dt | 신규/수정 |
| tb_ds_design_change | chg_id, prjct_id, ref_tbl_nm, ref_id, snapshot_data, chg_mber_id, chg_dt | 변경 이력 자동 기록 |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 단위업무명 공백 | - (클라이언트) | 단위업무명을 입력해 주세요 |
| 종료일 < 시작일 | - (클라이언트) | 종료일은 시작일 이후여야 합니다 |
| 권한 없음 | 403 | 접근 권한이 없습니다 |
| 서버 오류 | 500 | 저장 중 오류가 발생했습니다 |

---

## PID-00042 단위업무 삭제 확인

### AR-00063 삭제 확인 폼 (FORM)

### 영역: [AR-00063] 삭제 확인 폼

**유형:** FORM

**UI 구조**
~~~
+──────────────────────────────────────+
| 단위업무를 삭제하시겠습니까?         |
| '[단위업무명]'                        |
|                                      |
| 하위 데이터 처리 방법을 선택하세요.  |
| ( ) 하위 화면·영역·기능 전체 삭제    |
| ( ) 단위업무만 삭제                  |
|     (화면은 미분류 상태로 유지)      |
|                                      |
|         [취소]  [삭제]               |
+──────────────────────────────────────+
~~~

**구성 항목**
| 항목명 | UI 타입 | 설명 |
|:-------|:--------|:-----|
| 단위업무명 | text | 삭제 대상 명칭 표시 |
| 삭제 방식 | radio | 하위 전체 삭제 vs 단위업무만 삭제 |
| 취소 | button (secondary) | POPUP 닫기 |
| 삭제 | button (danger) | 삭제 API 호출 |

---

#### FID-00141 단위업무 삭제 실행

#### 기능: [FID-00141] 단위업무 삭제 실행

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | DELETE |
| **API** | `DELETE /api/projects/{projectId}/unit-works/{unitWorkId}?deleteChildren={true\|false}` |
| **트리거** | [삭제] 버튼 클릭 시 |

**Input**
| 파라미터 | 타입 | 필수 | 설명 |
|:---------|:-----|:-----|:-----|
| deleteChildren | boolean | Y | true: 하위 전체 삭제 / false: 단위업무만 삭제 (화면 미분류 유지) |

**처리 로직**
~~~
1. deleteChildren 파라미터 확인
2. deleteChildren = true:
   - tb_ds_screen, tb_ds_area, tb_ds_function CASCADE 전체 삭제
   - tb_ds_unit_work DELETE
3. deleteChildren = false:
   - tb_ds_screen.unit_work_id = NULL UPDATE (미분류 유지)
   - tb_ds_unit_work DELETE
4. tb_ds_design_change INSERT (삭제 이력 기록)
5. 성공 시 POPUP 닫기 + ["unit-works"] 캐시 무효화
~~~

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_ds_unit_work | unit_work_id | 삭제 대상 PK |
| tb_ds_screen | unit_work_id | CASCADE 삭제 또는 NULL 업데이트 |
| tb_ds_design_change | ref_tbl_nm, ref_id | 삭제 이력 기록 |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 삭제 방식 미선택 | - (클라이언트) | 하위 데이터 처리 방법을 선택해 주세요 |
| 항목 없음 | 404 | 단위업무를 찾을 수 없습니다 |
| 권한 없음 | 403 | 접근 권한이 없습니다 |
| 서버 오류 | 500 | 삭제 중 오류가 발생했습니다 |

---
