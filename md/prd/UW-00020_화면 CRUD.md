# UW-00020 화면 CRUD

> ## 1. 개요
| 항목 | 내용 |
|:-----|:-----|
| **단위업무ID** | UW-00020 |
| **단위업무명** | 화면 CRUD |
| **비즈니스 목적** | 단위업무 하위에 실제 UI 페이지를 관리한다. 유형·메뉴 분류 설정, 목록 순서 조정이 가능하며 하위 영역 목록을 화면 상세에서 확인할 수 있다. |
| **관련 요구사항** | RQ-00020, RQ-00019 |
| **기술 스택** | - |

## 2. 화면 목록
| 화면ID | 화면명 | URL | 유형 | 설명 |
|:-------|:-------|:----|:-----|:-----|
| PID-00043 | 화면 목록 | /projects/{projectId}/screens | LIST | 화면 목록 조회, 드래그앤드롭 순서 조정, 상위 단위업무명 표시 |
| PID-00044 | 화면 상세·편집 | /projects/{projectId}/screens/{screenId} | DETAIL | 화면 생성·수정, 유형·메뉴 분류 설정, 하단 영역 목록 표시 |
| PID-00045 | 화면 삭제 확인 | - | POPUP | 하위 영역 전체 삭제 vs 화면만 삭제 선택 |

## 3. 화면 흐름
~~~
[화면 목록] ──(행 클릭)──▶ [화면 상세·편집]
[화면 목록] ──(신규 등록)──▶ [화면 상세·편집 (신규)]
[화면 목록] ──(삭제 버튼)──▶ [화면 삭제 확인 POPUP]
[화면 목록] ──(단위업무명 클릭)──▶ [단위업무 상세]
[화면 목록] ──(바로가기 아이콘)──▶ [영역 목록]
[화면 상세·편집] ──(하단 영역 행 클릭)──▶ [영역 상세]
[화면 삭제 확인 POPUP] ──(확인)──▶ [화면 목록 (갱신)]
[화면 상세·편집] ──(저장)──▶ [화면 목록]
~~~

| 이동 | 전달 파라미터 | 동작 |
|:-----|:-------------|:-----|
| 화면 목록 → 상세·편집 | screenId | 행 클릭 |
| 화면 목록 → 영역 목록 | screenId | 바로가기 아이콘 클릭 |
| 화면 목록 → 단위업무 상세 | unitWorkId | 단위업무명 클릭 |
| 화면 목록 → 삭제 확인 | screenId | 삭제 버튼 클릭 |
| 화면 상세·편집 → 영역 상세 | areaId | 하단 영역 행 클릭 |

## 4. 권한 정의
| 기능 | VIEWER | PM/DESIGNER/DEVELOPER | ADMIN | OWNER |
|:-----|:-------|:----------------------|:------|:------|
| 화면 목록 조회 | ✅ | ✅ | ✅ | ✅ |
| 화면 생성·수정 | ❌ | ✅ | ✅ | ✅ |
| 화면 삭제 | ❌ | ✅ | ✅ | ✅ |
| 순서 조정 | ❌ | ✅ | ✅ | ✅ |

## 5. 상태 정의
> 상태 전이가 없는 업무는 이 섹션을 생략합니다.

## 6. 참조 테이블
- <TABLE_SCRIPT:tb_ds_screen>
- <TABLE_SCRIPT:tb_ds_unit_work>
- <TABLE_SCRIPT:tb_ds_area>
- <TABLE_SCRIPT:tb_ds_function>
- <TABLE_SCRIPT:tb_ds_design_change>

총 화면 3개 · 영역 4개 · 기능 9개

---

## PID-00043 화면 목록

### AR-00064 화면 목록 그리드 (GRID)

### 영역: [AR-00064] 화면 목록 그리드

**유형:** GRID

**UI 구조**
~~~
+────────────────────────────────────────────────────────────────────+
| 총 N건                                              [신규 등록]    |
|────────────────────────────────────────────────────────────────────|
| ☰ | 단위업무명(링크) | 화면명 | 유형  | 대분류 | 영역수 | 액션        |
| ☰ | [단위업무A]     | 화면1  | LIST  | 회원   | 3      | [→][삭제]   |
| ☰ | [단위업무A]     | 화면2  | DETAIL| 회원   | 2      | [→][삭제]   |
| ☰ | [단위업무B]     | 화면3  | POPUP | 주문   | 1      | [→][삭제]   |
+────────────────────────────────────────────────────────────────────+
~~~

**구성 항목**
| 항목명 | UI 타입 | 관련 컬럼 | 설명 |
|:-------|:--------|:----------|:-----|
| 드래그 핸들 | icon (☰) | - | 드래그앤드롭 순서 조정 |
| 단위업무명 | text (link) | tb_ds_unit_work.unit_work_nm | 상위 단위업무명, 클릭 시 단위업무 상세 이동 |
| 화면명 | text (link) | tb_ds_screen.scrn_nm | 클릭 시 화면 상세·편집 화면 이동 |
| 유형 | badge | tb_ds_screen.scrn_ty_code | LIST/DETAIL/POPUP/TAB |
| 대분류 | text | tb_ds_screen.ctgry_l_nm | 메뉴 대분류명, 미설정 시 '-' |
| 영역 수 | text | tb_ds_area COUNT | 하위 영역 개수 |
| 바로가기 | icon button | - | 행 우측, 클릭 시 하위 영역 목록으로 이동 |
| 삭제 | button | - | 클릭 시 삭제 확인 POPUP 표시 |
| 신규 등록 | button | - | 화면 상세·편집 화면(신규)으로 이동 |

#### FID-00142 화면 목록 조회

#### 기능: [FID-00142] 화면 목록 조회

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 조회 | <TABLE_SCRIPT:tb_ds_screen> | scrn_id, unit_work_id, scrn_nm, scrn_ty_code, ctgry_l_nm, sort_ordr |
| 조인 | <TABLE_SCRIPT:tb_ds_unit_work> | unit_work_nm |
| 서브쿼리 | <TABLE_SCRIPT:tb_ds_area> | COUNT(area_id) |

**처리 로직**
~~~
1. prjct_id (및 선택적 unitWorkId) 조건으로 화면 목록 조회
2. sort_ordr 기준 오름차순 정렬
3. 각 항목에 단위업무명(unitWorkName), 하위 영역 수(areaCount) 조인하여 포함
~~~

#### FID-00143 영역 목록 바로가기

#### 기능: [FID-00143] 영역 목록 바로가기

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | BUTTON |
| **트리거** | 행 우측 바로가기 아이콘(→) 클릭 시 |

**처리 로직**
~~~
1. 해당 화면의 screenId를 파라미터로 전달
2. 영역 목록(/projects/{projectId}/areas?screenId={screenId})으로 이동
~~~

#### FID-00144 단위업무 상세 화면 이동

#### 기능: [FID-00144] 단위업무 상세 화면 이동

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | BUTTON |
| **트리거** | 단위업무명 링크 클릭 시 |

**처리 로직**
~~~
1. 클릭한 화면의 unitWorkId를 경로 파라미터로 전달
2. 단위업무 상세 화면(/projects/{projectId}/unit-works/{unitWorkId})으로 이동
~~~

#### FID-00145 드래그앤드롭 순서 조정

#### 기능: [FID-00145] 드래그앤드롭 순서 조정

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 수정 | <TABLE_SCRIPT:tb_ds_screen> | sort_ordr, mdfcn_dt |
| 이력 | <TABLE_SCRIPT:tb_ds_design_change> | ref_tbl_nm, ref_id, snapshot_data |

**처리 로직**
~~~
1. 드롭 완료 시 변경된 순서 배열 생성
2. 순서 변경 API 호출
3. 성공 시 목록 순서 즉시 반영 및 설계 변경 이력(tb_ds_design_change) 기록
~~~

---

## PID-00044 화면 상세·편집

### AR-00065 기본 정보 폼 (FORM)

### 영역: [AR-00065] 기본 정보 폼

**유형:** FORM

**UI 구조**
~~~
+──────────────────────────────────────────+
| 화면명 * [___________________]         |
| 표시코드    [___________________]         |
| 화면 유형   [LIST v]                      |
| 대분류      [___________________]         |
| 중분류      [___________________]         |
| 소분류      [___________________]         |
| 정렬순서    [___]                         |
|                          [저장]           |
+──────────────────────────────────────────+
~~~

**구성 항목**
| 항목명 | UI 타입 | 관련 컬럼 | 설명 |
|:-------|:--------|:----------|:-----|
| 화면명 | text input | tb_ds_screen.scrn_nm | 필수 입력 |
| 표시코드 | text input | tb_ds_screen.dsply_code | 개발자 참조 코드 (예: MBR_LIST) |
| 화면 유형 | select | tb_ds_screen.scrn_ty_code | LIST/DETAIL/POPUP/TAB |
| 대분류 | text input | tb_ds_screen.ctgry_l_nm | 메뉴 대분류 |
| 중분류 | text input | tb_ds_screen.ctgry_m_nm | 메뉴 중분류 |
| 소분류 | text input | tb_ds_screen.ctgry_s_nm | 메뉴 소분류 |
| 정렬순서 | number input | tb_ds_screen.sort_ordr | 목록 표시 순서 |
| 저장 | button | - | 유효성 검증 후 저장 API 호출 |

#### FID-00146 화면 상세 조회

#### 기능: [FID-00146] 화면 상세 조회

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 조회 | <TABLE_SCRIPT:tb_ds_screen> | scrn_nm, dsply_code, scrn_ty_code, ctgry_l_nm, ctgry_m_nm, ctgry_s_nm, sort_ordr, unit_work_id |
| 조인 | <TABLE_SCRIPT:tb_ds_unit_work> | unit_work_nm |

**처리 로직**
~~~
1. 화면 상세 API 호출
2. 각 필드 바인딩 (상위 단위업무명 포함)
3. 신규 모드이면 빈 폼 표시
~~~

#### FID-00147 화면 저장

#### 기능: [FID-00147] 화면 저장

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 저장 | <TABLE_SCRIPT:tb_ds_screen> | scrn_nm, dsply_code, scrn_ty_code, ctgry_l_nm, ctgry_m_nm, ctgry_s_nm, sort_ordr |
| 이력 | <TABLE_SCRIPT:tb_ds_design_change> | ref_tbl_nm(tb_ds_screen), ref_id, snapshot_data |

**처리 로직**
~~~
1. 화면명 공백 검증
2. 신규/수정 분기하여 DB 반영
3. 저장 완료 후 설계 변경 이력(tb_ds_design_change) 자동 기록 (v3 정책)
4. 성공 시 '저장되었습니다' 토스트 표시 후 목록으로 복귀
~~~

### AR-00066 하단 영역 목록 (GRID)

### 영역: [AR-00066] 하단 영역 목록

**유형:** GRID

**UI 구조**
~~~
+──────────────────────────────────────────+
| ## 영역 목록                총 N개       |
|──────────────────────────────────────────|
| 순서 | 영역명      | 유형   | 기능 수    |
| 1    | 검색 조건   | SEARCH | 3          |
| 2    | 데이터 목록 | GRID   | 5          |
| 3    | 상세 폼     | FORM   | 4          |
+──────────────────────────────────────────+
~~~

**구성 항목**
| 항목명 | UI 타입 | 관련 컬럼 | 설명 |
|:-------|:--------|:----------|:-----|
| 순서 | text | tb_ds_area.sort_ordr | 영역 정렬 순서 |
| 영역명 | text (link) | tb_ds_area.area_nm | 클릭 시 영역 상세 화면으로 이동 |
| 유형 | badge | tb_ds_area.area_ty_code | SEARCH/GRID/FORM/INFO_CARD/TAB/FULL_SCREEN |
| 기능 수 | text | tb_ds_function COUNT | 해당 영역의 하위 기능 개수 |

#### FID-00148 하단 영역 목록 조회

#### 기능: [FID-00148] 하단 영역 목록 조회

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 조회 | <TABLE_SCRIPT:tb_ds_area> | area_id, area_nm, area_ty_code, sort_ordr |
| 서브쿼리 | <TABLE_SCRIPT:tb_ds_function> | COUNT(func_id) |

**처리 로직**
~~~
1. 해당 화면(scrn_id)의 영역 목록 API 호출
2. sort_ordr 기준 오름차순 정렬
3. 각 항목에 영역명, 유형, 기능 수(functionCount) 포함
4. 읽기 전용으로 표시 (수정·삭제 버튼 미표시)
~~~

#### FID-00149 영역 상세 이동

#### 기능: [FID-00149] 영역 상세 이동

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | BUTTON |
| **트리거** | 하단 영역 목록 행 클릭 시 |

**처리 로직**
~~~
1. 클릭한 영역의 areaId를 경로 파라미터로 전달
2. 영역 상세 화면(/projects/{projectId}/areas/{areaId})으로 이동
~~~

---

## PID-00045 화면 삭제 확인

### AR-00067 삭제 확인 폼 (FORM)

### 영역: [AR-00067] 삭제 확인 폼

**유형:** FORM

**UI 구조**
~~~
+──────────────────────────────────────+
| 화면을 삭제하시겠습니까?             |
| '[화면명]'                            |
|                                      |
| 하위 데이터 처리 방법을 선택하세요.  |
| ( ) 하위 영역·기능 전체 삭제         |
| ( ) 화면만 삭제                      |
|     (영역은 미분류 상태로 유지)      |
|                                      |
|         [취소]  [삭제]               |
+──────────────────────────────────────+
~~~

**구성 항목**
| 항목명 | UI 타입 | 관련 컬럼 | 설명 |
|:-------|:--------|:----------|:-----|
| 대상 화면명 | text | - | 삭제 대상 화면명 표시 |
| 삭제 방식 | radio | - | 하위 전체 삭제 vs 화면만 삭제 |
| 삭제 | button | - | 삭제 API 호출 |

#### FID-00150 화면 삭제 실행

#### 기능: [FID-00150] 화면 삭제 실행

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 삭제 | <TABLE_SCRIPT:tb_ds_screen> | scrn_id |
| 수정/삭제 | <TABLE_SCRIPT:tb_ds_area> | scrn_id (NULL 처리 또는 CASCADE) |
| 이력 | <TABLE_SCRIPT:tb_ds_design_change> | ref_tbl_nm, ref_id |

**처리 로직**
~~~
1. deleteChildren 파라미터 확인
2. deleteChildren=true: 영역(tb_ds_area) 등 하위 엔티티 전체 삭제 (CASCADE)
3. deleteChildren=false: 하위 영역의 scrn_id를 NULL로 업데이트 (미분류 유지)
4. 화면 삭제 내역을 설계 변경 이력(tb_ds_design_change)에 기록
5. 성공 시 POPUP 닫기 + 목록 갱신
~~~

---
