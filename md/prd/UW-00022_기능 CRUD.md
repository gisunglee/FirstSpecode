# UW-00022 기능 CRUD

> ## 1. 개요
| 항목 | 내용 |
|:-----|:-----|
| **단위업무ID** | UW-00022 |
| **단위업무명** | 기능 CRUD |
| **비즈니스 목적** | 사용자가 수행하는 구체적인 동작 단위로 기능을 관리한다. 유형·담당자·일정·복잡도·공수를 관리하며 AI가 명세 누락 검토·영향도 분석·컬럼 매핑 초안 생성을 지원한다. |
| **관련 요구사항** | RQ-00022, RQ-00021, RQ-00023 |
| **기술 스택** | AI Pipeline |

## 2. 화면 목록
| 화면ID | 화면명 | URL | 유형 | 설명 |
|:-------|:-------|:----|:-----|:-----|
| PID-00050 | 기능 목록 | /projects/{projectId}/functions | LIST | 기능 목록 조회, 복잡도·공수 인라인 편집, 드래그앤드롭 순서 조정 |
| PID-00051 | 기능 상세·편집 | /projects/{projectId}/functions/{functionId} | DETAIL | 기능 생성·수정, 명세·이미지·AI 검토·영향도 분석, 하단 컬럼 매핑 목록 |
| PID-00052 | 기능 삭제 확인 | - | POPUP | AI 태스크·이력 포함 삭제 확인 |
| PID-00053 | 컬럼 매핑 관리 | - | POPUP | 테이블 선택, 컬럼 매핑 수정, AI 초안 자동 채움 |

## 3. 화면 흐름
~~~
[기능 목록] ──(행 클릭)──▶ [기능 상세·편집]
[기능 목록] ──(신규 등록)──▶ [기능 상세·편집 (신규)]
[기능 목록] ──(삭제 버튼)──▶ [기능 삭제 확인 POPUP]
[기능 목록] ──(영역명 클릭)──▶ [영역 상세·편집]
[기능 목록] ──(복잡도·공수 셀 클릭)──▶ [인라인 편집]
[기능 상세·편집] ──([매핑 관리] 버튼)──▶ [컬럼 매핑 관리 POPUP]
[컬럼 매핑 관리 POPUP] ──(저장)──▶ [기능 상세·편집 (매핑 목록 갱신)]
[기능 삭제 확인 POPUP] ──(확인)──▶ [기능 목록 (갱신)]
[기능 상세·편집] ──(저장)──▶ [기능 목록]
~~~

| 이동 | 전달 파라미터 | 동작 |
|:-----|:-------------|:-----|
| 기능 목록 → 상세·편집 | functionId | 행 클릭 |
| 기능 목록 → 영역 상세 | areaId | 영역명 클릭 |
| 기능 목록 → 삭제 확인 | functionId | 삭제 버튼 클릭 |
| 기능 상세 → 컬럼 매핑 관리 | functionId | [매핑 관리] 버튼 클릭 |

## 4. 권한 정의
| 기능 | VIEWER | PM/DESIGNER/DEVELOPER | ADMIN | OWNER |
|:-----|:-------|:----------------------|:------|:------|
| 기능 목록 조회 | ✅ | ✅ | ✅ | ✅ |
| 기능 생성·수정 | ❌ | ✅ | ✅ | ✅ |
| 기능 삭제 | ❌ | ✅ | ✅ | ✅ |
| 복잡도·공수 인라인 편집 | ❌ | ✅ | ✅ | ✅ |
| AI 명세 검토·영향도 분석 | ❌ | ✅ | ✅ | ✅ |
| 컬럼 매핑 관리 | ❌ | ✅ | ✅ | ✅ |

## 5. 상태 정의
> 상태 관리는 RQ-00023 기능 상태 흐름 관리에서 별도 처리합니다.

## 6. 참조 테이블
- <TABLE_SCRIPT:tb_ds_function>
- <TABLE_SCRIPT:tb_cm_attach_file>
- <TABLE_SCRIPT:tb_ds_function_column_mapping>
- <TABLE_SCRIPT:tb_ds_db_table>
- <TABLE_SCRIPT:tb_ds_table_column>
- <TABLE_SCRIPT:tb_ai_task>
- <TABLE_SCRIPT:tb_ds_design_change>

총 화면 4개 · 영역 9개 · 기능 15개

---

## PID-00050 기능 목록

### AR-00077 기능 목록 그리드 (GRID)

### 영역: [AR-00077] 기능 목록 그리드

**유형:** GRID

**UI 구조**
~~~
+──────────────────────────────────────────────────────────────────────────+
| 총 N건                                                    [신규 등록]    |
|──────────────────────────────────────────────────────────────────────────|
| ☰ | 영역명(링크) | 기능명     | 유형   | 복잡도  | 공수   | 상태  | 액션      |
| ☰ | [검색영역]  | 검색 실행  | SEARCH | [중 v]  | [2h]   | 설계중| [→][삭제] |
| ☰ | [검색영역]  | 엑셀 다운  | DOWNLOAD| [하 v] | [1h]   | 미착수| [→][삭제] |
+──────────────────────────────────────────────────────────────────────────+
~~~

**구성 항목**
| 항목명 | UI 타입 | 관련 컬럼 | 설명 |
|:-------|:--------|:----------|:-----|
| 드래그 핸들 | icon (☰) | - | 드래그앤드롭 순서 조정 |
| 영역명 | text (link) | tb_ds_area.area_nm | 상위 영역명, 클릭 시 영역 상세 이동 |
| 기능명 | text (link) | tb_ds_function.func_nm | 클릭 시 기능 상세·편집 화면 이동 |
| 유형 | badge | tb_ds_function.func_ty_code | SEARCH/SAVE/DELETE 등 |
| 복잡도 | select (인라인) | tb_ds_function.cmplx_code | 상/중/하 인라인 선택 |
| 공수 | text input (인라인) | tb_ds_function.efrt_val | 시간/일 단위 인라인 입력 |
| 상태 | badge | tb_ds_function.func_sttus_code | 미착수/설계중/설계완료/구현완료 등 |
| 바로가기 | icon button | - | 행 우측, 상세 화면으로 이동 |
| 삭제 | button | - | 클릭 시 삭제 확인 POPUP 표시 |
| 신규 등록 | button | - | 기능 상세·편집 화면(신규)으로 이동 |

#### FID-00167 기능 목록 조회

#### 기능: [FID-00167] 기능 목록 조회

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 조회 | <TABLE_SCRIPT:tb_ds_function> | func_id, area_id, func_display_id, func_nm, func_ty_code, cmplx_code, efrt_val, func_sttus_code, sort_ordr |
| 조인 | <TABLE_SCRIPT:tb_ds_area> | area_nm |

**처리 로직**
~~~
1. prjct_id (및 선택적 areaId) 조건으로 기능 목록 API 호출
2. sort_ordr 기준 오름차순 정렬
3. 각 항목에 조인된 상위 영역명(areaName) 포함
~~~

#### FID-00168 복잡도 인라인 편집

#### 기능: [FID-00168] 복잡도 인라인 편집

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 수정 | <TABLE_SCRIPT:tb_ds_function> | cmplx_code, mdfcn_dt |
| 이력 | <TABLE_SCRIPT:tb_ds_design_change> | ref_tbl_nm, ref_id, snapshot_data |

**처리 로직**
~~~
1. 복잡도 셀 클릭 시 인라인 select 활성화
2. 선택 변경 즉시 UPDATE API 호출
3. 성공 시 셀 값 즉시 갱신 및 tb_ds_design_change 이력 추가
~~~

#### FID-00169 공수 인라인 편집

#### 기능: [FID-00169] 공수 인라인 편집

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 수정 | <TABLE_SCRIPT:tb_ds_function> | efrt_val, mdfcn_dt |
| 이력 | <TABLE_SCRIPT:tb_ds_design_change> | ref_tbl_nm, ref_id, snapshot_data |

**처리 로직**
~~~
1. 공수 셀 클릭 시 인라인 text input 활성화
2. blur 또는 Enter 입력 시 저장 API 호출
3. 성공 시 셀 값 즉시 갱신 및 tb_ds_design_change 이력 추가
~~~

#### FID-00170 드래그앤드롭 순서 조정

#### 기능: [FID-00170] 드래그앤드롭 순서 조정

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 수정 | <TABLE_SCRIPT:tb_ds_function> | sort_ordr, mdfcn_dt |
| 이력 | <TABLE_SCRIPT:tb_ds_design_change> | ref_tbl_nm, ref_id, snapshot_data |

**처리 로직**
~~~
1. 드롭 완료 시 변경된 순서 배열 생성
2. 순서 변경 API 호출
3. 성공 시 목록 순서 즉시 반영 및 tb_ds_design_change 이력 추가
~~~

---

## PID-00051 기능 상세·편집

### AR-00078 기본 정보 폼 (FORM)

### 영역: [AR-00078] 기본 정보 폼

**유형:** FORM

**UI 구조**
~~~
+──────────────────────────────────────────+
| 기능명 * [___________________]         |
| 유형       [SEARCH v]                    |
| 담당자     [멤버 선택 v]                 |
| 구현 시작일 [날짜 선택]                  |
| 구현 종료일 [날짜 선택]                  |
| 복잡도     [중 v]                        |
| 예상 공수  [___] [시간 v / 일 v]         |
|                          [저장]          |
+──────────────────────────────────────────+
~~~

**구성 항목**
| 항목명 | UI 타입 | 관련 컬럼 | 설명 |
|:-------|:--------|:----------|:-----|
| 기능명 | text input | tb_ds_function.func_nm | 필수 입력 |
| 유형 | select | tb_ds_function.func_ty_code | SEARCH/SAVE/DELETE 등 |
| 담당자 | select | tb_ds_function.asign_mber_id | 프로젝트 멤버 목록 |
| 구현시작일 | date picker | tb_ds_function.impl_bgng_de | - |
| 구현종료일 | date picker | tb_ds_function.impl_end_de | 시작일 이후여야 함 |
| 복잡도 | select | tb_ds_function.cmplx_code | HIGH/MEDIUM/LOW |
| 예상공수 | input+select | tb_ds_function.efrt_val | 시간(h) 또는 일(d) 결합 입력 |
| 저장 | button | - | 전체 폼 데이터 일괄 저장 |

#### FID-00171 기능 상세 조회

#### 기능: [FID-00171] 기능 상세 조회

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 조회 | <TABLE_SCRIPT:tb_ds_function> | func_nm, func_ty_code, asign_mber_id, impl_bgng_de, impl_end_de, cmplx_code, efrt_val, spec_cn, area_id |
| 조인 | <TABLE_SCRIPT:tb_ds_area> | area_nm |

**처리 로직**
~~~
1. 기능 상세 API 호출
2. 각 필드 바인딩 (상위 영역명 조인 포함)
3. 신규 모드이면 빈 폼 표시
~~~

#### FID-00172 기능 저장

#### 기능: [FID-00172] 기능 저장

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 저장 | <TABLE_SCRIPT:tb_ds_function> | func_nm, func_ty_code, asign_mber_id, impl_bgng_de, impl_end_de, cmplx_code, efrt_val, spec_cn |
| 이력 | <TABLE_SCRIPT:tb_ds_design_change> | ref_tbl_nm('tb_ds_function'), ref_id, snapshot_data |

**처리 로직**
~~~
1. 기능명 공백 검증, 시작일/종료일 유효성 검증
2. 명세 에디터 내용(spec_cn)을 포함하여 신규/수정 API 호출
3. 변경된 설계 정보 전체를 tb_ds_design_change에 자동 스냅샷 기록
4. 성공 시 토스트 알림 후 이전 목록으로 복귀
~~~

### AR-00079 명세 작성 (FORM)

### 영역: [AR-00079] 명세 작성

**유형:** FORM

**UI 구조**
~~~
+──────────────────────────────────────────+
| ## 기능 명세 (spec)                      |
| [마크다운 에디터_____________________]   |
| [_____________________________________]  |
+──────────────────────────────────────────+
~~~

**구성 항목**
| 항목명 | UI 타입 | 관련 컬럼 | 설명 |
|:-------|:--------|:----------|:-----|
| 명세 에디터 | markdown | tb_ds_function.spec_cn | 마크다운 형식 상세 명세 작성 |

#### FID-00173 명세 편집

#### 기능: [FID-00173] 명세 편집

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 상태관리 | UI State | - (저장 클릭 시 tb_ds_function.spec_cn으로 일괄 전송) |

**처리 로직**
~~~
1. 마크다운 에디터에서 자유 형식으로 명세 작성 (로컬 State 유지)
2. [저장] 버튼 클릭 시 기본 정보와 함께 일괄 전송 처리
~~~

### AR-00080 AI 지원 (FORM)

### 영역: [AR-00080] AI 지원

**유형:** FORM

**UI 구조**
~~~
+──────────────────────────────────────────────+
| ## AI 명세 누락 검토                         |
| AI 요청 코멘트 [________________________]    |
|                    [AI 명세 누락 검토 요청]  |
| [검토 결과 인라인 표시_________________]     |
|                                              |
| ## AI 영향도 분석                            |
| AI 요청 코멘트 [________________________]    |
|                    [AI 영향도 분석 요청]     |
| [분석 결과 인라인 표시_________________]     |
+──────────────────────────────────────────────+
~~~

**구성 항목**
| 항목명 | UI 타입 | 관련 컬럼 | 설명 |
|:-------|:--------|:----------|:-----|
| 검토 코멘트 | textarea | tb_ai_task.coment_cn | 명세 누락 검토 지시사항 |
| 검토 요청 | button | - | AI API 호출 |
| 검토 결과 | text | tb_ai_task.result_cn | AI 응답 누락 리스트 표시 |
| 영향도 코멘트 | textarea | tb_ai_task.coment_cn | 영향도 분석 지시사항 |
| 영향도 요청 | button | - | 전체 프로젝트 기반 분석 요청 |
| 분석 결과 | text | tb_ai_task.result_cn | 분석 결과 인라인 표시 |

#### FID-00174 AI 명세 누락 검토 요청

#### 기능: [FID-00174] AI 명세 누락 검토 요청

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 요청 | <TABLE_SCRIPT:tb_ai_task> | ref_ty_code('FUNCTION'), ref_id, task_ty_code('INSPECT'), coment_cn, req_snapshot_data |

**처리 로직**
~~~
1. 현재 작성된 spec_cn이 존재하는지 검증
2. 스냅샷 데이터(명세)와 코멘트를 tb_ai_task(INSPECT)로 전달
3. 처리 중 로딩 표시 후 완료 시 결과(result_cn)를 인라인에 파싱하여 표시
~~~

#### FID-00175 AI 영향도 분석 요청

#### 기능: [FID-00175] AI 영향도 분석 요청

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 요청 | <TABLE_SCRIPT:tb_ai_task> | ref_ty_code('FUNCTION'), ref_id, task_ty_code('IMPACT'), coment_cn, req_snapshot_data |

**처리 로직**
~~~
1. 전체 프로젝트 관련 DB 매핑 정보 및 현재 기능 정보를 포함하여 tb_ai_task(IMPACT) 생성
2. 분석 파이프라인 대기 후 결과(result_cn)를 화면에 렌더링하여 영향을 받는 타 기능/화면 목록 제공
~~~

### AR-00081 참고 이미지 (FORM)

### 영역: [AR-00081] 참고 이미지

**유형:** FORM

**UI 구조**
~~~
+──────────────────────────────────────────+
| ## 참고 이미지                           |
| [이미지1 썸네일] [이미지2 썸네일]        |
|              [+ 이미지 첨부]             |
+──────────────────────────────────────────+
~~~

**구성 항목**
| 항목명 | UI 타입 | 관련 컬럼 | 설명 |
|:-------|:--------|:----------|:-----|
| 썸네일 | image | tb_cm_attach_file | 업로드된 이미지 표시 |
| 삭제 | icon (x) | - | 이미지 개별 삭제 |
| 첨부 | button | - | 다중 이미지 선택 (jpg/png 등) |

#### FID-00176 참고 이미지 업로드

#### 기능: [FID-00176] 참고 이미지 업로드

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 업로드 | <TABLE_SCRIPT:tb_cm_attach_file> | ref_tbl_nm('tb_ds_function'), ref_id, file_ty_code('IMAGE'), orgnl_file_nm, stor_file_nm |

**처리 로직**
~~~
1. 다중 이미지 파일 선택 (포맷 유효성 검사)
2. v3 공통 첨부파일 테이블에 INSERT API 호출
3. 완료 시 썸네일 목록 즉시 갱신
~~~

#### FID-00177 참고 이미지 삭제

#### 기능: [FID-00177] 참고 이미지 삭제

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 삭제 | <TABLE_SCRIPT:tb_cm_attach_file> | attach_file_id |

**처리 로직**
~~~
1. 인라인 삭제 재확인
2. 공통 첨부파일 레코드 및 물리 파일 삭제 API 호출
~~~

### AR-00082 하단 컬럼 매핑 목록 (GRID)

### 영역: [AR-00082] 하단 컬럼 매핑 목록

**유형:** GRID

**UI 구조**
~~~
+──────────────────────────────────────────────+
| ## 컬럼 매핑               [매핑 관리]       |
|──────────────────────────────────────────────|
| 테이블명       | 컬럼명    | 용도            |
| tb_cm_member   | email_addr| 조회 조건       |
| tb_cm_member   | mber_nm   | 조회 결과       |
+──────────────────────────────────────────────+
~~~

**구성 항목**
| 항목명 | UI 타입 | 관련 컬럼 | 설명 |
|:-------|:--------|:----------|:-----|
| 테이블명 | text | tb_ds_db_table.tbl_physcl_nm | 매핑된 DB 테이블명 |
| 컬럼명 | text | tb_ds_table_column.col_physcl_nm | 매핑된 컬럼명 |
| 용도 | text | tb_ds_function_column_mapping.use_purps_cn | 컬럼 사용 용도 (조회조건 등) |
| 매핑 관리 | button | - | 클릭 시 컬럼 매핑 관리 POPUP 진입 |

#### FID-00178 컬럼 매핑 목록 조회

#### 기능: [FID-00178] 컬럼 매핑 목록 조회

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 조회 | <TABLE_SCRIPT:tb_ds_function_column_mapping> | mapping_id, col_id, use_purps_cn, sort_ordr |
| 조인 | <TABLE_SCRIPT:tb_ds_table_column> | tbl_id, col_physcl_nm |
| 조인 | <TABLE_SCRIPT:tb_ds_db_table> | tbl_physcl_nm |

**처리 로직**
~~~
1. 해당 기능(func_id)에 연결된 컬럼 매핑 정보 조회
2. 관련 테이블과 컬럼 정보를 JOIN하여 테이블명/컬럼명 표시
3. 읽기 전용 렌더링
~~~

---

## PID-00052 기능 삭제 확인

### AR-00083 삭제 확인 폼 (FORM)

### 영역: [AR-00083] 삭제 확인 폼

**유형:** FORM

**UI 구조**
~~~
+──────────────────────────────────────+
| 기능을 삭제하시겠습니까?             |
| '[기능명]'                            |
|                                      |
| 연결된 AI 태스크·이력이 함께         |
| 삭제되며 복구할 수 없습니다.         |
|                                      |
|         [취소]  [삭제]               |
+──────────────────────────────────────+
~~~

**구성 항목**
| 항목명 | UI 타입 | 관련 컬럼 | 설명 |
|:-------|:--------|:----------|:-----|
| 대상 기능명 | text | tb_ds_function.func_nm | 삭제 대상 명칭 |
| 취소 | button | - | 팝업 닫기 |
| 삭제 | button | - | 삭제 실행 |

#### FID-00179 기능 삭제 실행

#### 기능: [FID-00179] 기능 삭제 실행

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 삭제 | <TABLE_SCRIPT:tb_ds_function> | func_id |
| 삭제 | <TABLE_SCRIPT:tb_ds_function_column_mapping> | func_id (CASCADE) |
| 삭제 | <TABLE_SCRIPT:tb_ai_task> | ref_id (CASCADE, ref_ty_code='FUNCTION') |
| 이력 | <TABLE_SCRIPT:tb_ds_design_change> | ref_tbl_nm('tb_ds_function'), ref_id |

**처리 로직**
~~~
1. 삭제 API 호출
2. tb_ds_function 삭제 시 매핑된 컬럼 및 AI 태스크(tb_ai_task) 일괄 삭제 (또는 CASCADE 적용 확인)
3. 설계 변경 이력(tb_ds_design_change)에 기능 삭제 사실 기록
4. 성공 시 POPUP 닫기 및 기능 목록 갱신
~~~

---

## PID-00053 컬럼 매핑 관리

### AR-00084 테이블 선택 및 AI 초안 (FORM)

### 영역: [AR-00084] 테이블 선택 및 AI 초안

**유형:** FORM

**UI 구조**
~~~
+──────────────────────────────────────────────+
| 테이블 선택  [tb_cm_member v] [AI 초안 생성] |
+──────────────────────────────────────────────+
~~~

**구성 항목**
| 항목명 | UI 타입 | 관련 컬럼 | 설명 |
|:-------|:--------|:----------|:-----|
| 테이블 선택 | select | tb_ds_db_table.tbl_id | SPECODE에 등록된 DB 스키마 테이블 목록 |
| 초안 생성 | button | - | AI 태스크 파이프라인 트리거 |

#### FID-00180 AI 컬럼 매핑 초안 생성

#### 기능: [FID-00180] AI 컬럼 매핑 초안 생성

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 요청 | <TABLE_SCRIPT:tb_ai_task> | ref_ty_code('FUNCTION'), ref_id, task_ty_code('DESIGN'), req_snapshot_data |

**처리 로직**
~~~
1. 사용자가 테이블(tbl_id) 선택 시 유효성 검사
2. 해당 테이블 정보 + 기능 유형 + 명세를 묶어 tb_ai_task 에 매핑 초안 생성 요청(DESIGN) 생성
3. AI 응답으로 온 컬럼 리스트(col_id, use_purps_cn)를 하단 편집 그리드의 State(임시 상태)로 덮어쓰기 로드
~~~

### AR-00085 컬럼 매핑 편집 목록 (GRID)

### 영역: [AR-00085] 컬럼 매핑 편집 목록

**유형:** GRID

**UI 구조**
~~~
+──────────────────────────────────────────────────+
| 테이블명      | 컬럼명    | 용도       | 액션    |
| tb_cm_member  | email_addr| [조회조건] | [삭제]  |
| tb_cm_member  | mber_nm   | [조회결과] | [삭제]  |
|                              [+ 컬럼 직접 추가]  |
|                              [취소]  [저장]      |
+──────────────────────────────────────────────────+
~~~

**구성 항목**
| 항목명 | UI 타입 | 관련 컬럼 | 설명 |
|:-------|:--------|:----------|:-----|
| 테이블명 | text | tb_ds_db_table.tbl_physcl_nm | - |
| 컬럼명 | select | tb_ds_table_column.col_id | 테이블 종속 컬럼 목록 |
| 용도 | text input | tb_ds_function_column_mapping.use_purps_cn | 인라인 입력 |
| 삭제 | icon (x) | - | 편집 행 삭제 |
| 컬럼 추가 | button | - | 빈 매핑 행 추가 |
| 저장 | button | - | 전체 매핑 리스트 일괄 저장 |

#### FID-00181 컬럼 매핑 저장

#### 기능: [FID-00181] 컬럼 매핑 저장

**기술 매핑**
| 구분 | 테이블 | 주요 컬럼 |
|:-----|:-------|:----------|
| 삭제/생성 | <TABLE_SCRIPT:tb_ds_function_column_mapping> | func_id, col_id, use_purps_cn, sort_ordr |
| 이력 | <TABLE_SCRIPT:tb_ds_design_change> | ref_tbl_nm('tb_ds_function_column_mapping'), ref_id, snapshot_data |

**처리 로직**
~~~
1. 현재 UI에 존재하는 전체 매핑(mappings) 배열을 서버로 전송
2. 서버는 해당 기능의 기존 매핑을 전체 DELETE 후 새로 받은 목록으로 일괄 INSERT (대체)
3. 변경 사항은 설계 변경 이력(tb_ds_design_change)에 기록
4. POPUP 닫기 및 기능 상세 화면의 컬럼 매핑 목록 갱신
~~~

---
