# UW-00015 요구사항 CRUD

> ## 1. 개요
| 항목 | 내용 |
|:-----|:-----|
| **단위업무ID** | UW-00015 |
| **단위업무명** | 요구사항 CRUD |
| **비즈니스 목적** | 과업 하위에 요구사항을 관리한다. 원문·현행화 내용을 분리하여 계약 근거를 보존하며, AI가 analy_cn 기반으로 spec_cn 초안을 생성해준다. |
| **관련 요구사항** | RQ-00015, RQ-00014, RQ-00016, RQ-00017, RQ-00018 |
| **기술 스택** | - |

## 2. 화면 목록
| 화면ID | 화면명 | URL | 유형 | 설명 |
|:-------|:-------|:----|:-----|:-----|
| PID-00030 | 요구사항 목록 | /projects/{projectId}/requirements | LIST | 요구사항 목록 조회, 드래그앤드롭 순서 조정 |
| PID-00031 | 요구사항 상세·편집 | /projects/{projectId}/requirements/{requirementId} | DETAIL | 요구사항 생성·수정, 원문·현행화, 첨부파일, AI spec 초안 |
| PID-00032 | 요구사항 삭제 확인 | - | POPUP | 하위 전체 삭제 vs 요구사항만 삭제 선택 |

## 3. 화면 흐름
```
[요구사항 목록] ──(요구사항 행 클릭)──▶ [요구사항 상세·편집]
[요구사항 목록] ──(신규 등록 버튼)──▶ [요구사항 상세·편집 (신규)]
[요구사항 목록] ──(삭제 버튼)──▶ [요구사항 삭제 확인 POPUP]
[요구사항 상세·편집] ──(저장)──▶ [요구사항 목록]
[요구사항 상세·편집] ──(AI 초안 생성)──▶ [spec_cn 초안 표시 (인라인)]
```

| 이동 | 전달 파라미터 | 동작 |
|:-----|:-------------|:-----|
| 요구사항 목록 → 상세·편집 | requirementId | 행 클릭 |
| 요구사항 목록 → 삭제 확인 | requirementId | 삭제 버튼 클릭 |
| 요구사항 상세·편집 → 목록 | - | 저장 또는 취소 후 복귀 |

## 4. 권한 정의
| 기능 | VIEWER | PM/DESIGNER/DEVELOPER | ADMIN | OWNER |
|:-----|:-------|:----------------------|:------|:------|
| 요구사항 목록 조회 | ✅ | ✅ | ✅ | ✅ |
| 요구사항 생성·수정 | ❌ | ✅ | ✅ | ✅ |
| 요구사항 삭제 | ❌ | ✅ | ✅ | ✅ |
| 첨부파일 관리 | ❌ | ✅ | ✅ | ✅ |
| AI 초안 생성 | ❌ | ✅ | ✅ | ✅ |
| 순서 조정 | ❌ | ✅ | ✅ | ✅ |

## 5. 상태 정의
> 상태 전이가 없는 업무는 이 섹션을 생략합니다.

## 6. 참조 테이블
- <TABLE_SCRIPT:tb_rq_requirement>
- <TABLE_SCRIPT:tb_rq_requirement_history>
- <TABLE_SCRIPT:tb_rq_task>
- <TABLE_SCRIPT:tb_rq_user_story>
- <TABLE_SCRIPT:tb_cm_attach_file>
- <TABLE_SCRIPT:tb_ds_unit_work>

총 화면 3개 · 영역 6개 · 기능 11개

---

## PID-00030 요구사항 목록

### AR-00042 요구사항 목록 그리드 (GRID)

### 영역: [AR-00042] 요구사항 목록 그리드

**유형:** GRID

**UI 구조**
```
+────────────────────────────────────────────────────────────+
| 총 N건                                    [신규 등록]      |
|────────────────────────────────────────────────────────────|
| ☰ | 과업명(링크) | 요구사항명 | 우선순위 | 출처 | 단위업무 수 | 액션 |
| ☰ | [과업A]     | 요구사항1  | HIGH     | RFP  | 2           | [삭제] |
+────────────────────────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 드래그 핸들 | icon (☰) | 드래그앤드롭 순서 조정 | - |
| 과업명 | text (link) | 상위 과업명, 클릭 시 과업 상세로 이동 | - |
| 요구사항명 | text (link) | 클릭 시 상세·편집 화면으로 이동 | - |
| 우선순위 | badge | HIGH/MEDIUM/LOW | - |
| 출처 | badge | RFP/추가/변경 | - |
| 단위업무 수 | text | 연결된 단위업무 수 | - |
| 삭제 | button (danger) | 삭제 확인 POPUP 표시 | - |

#### FID-00099 요구사항 목록 조회

#### 기능: [FID-00099] 요구사항 목록 조회

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/requirements` |
| **트리거** | 화면 진입 시 자동 실행 |

**Output**
| 필드 | 타입 | 설명 |
|:-----|:-----|:-----|
| items | array | 요구사항 목록 |
| totalCount | number | 전체 건수 |

**처리 로직**
```
1. 요구사항 목록 API 호출
2. 서버 처리:
   a. tb_rq_requirement에서 prjct_id = 현재 프로젝트, sort_ordr 오름차순 조회
   b. tb_rq_task JOIN → task_nm (상위 과업명), task_id NULL이면 '미분류'
   c. tb_ds_unit_work에서 req_id 기준 COUNT → 단위업무 수
3. 각 항목에 taskName, unitWorkCount 포함
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_rq_requirement | req_id | PK |
| tb_rq_requirement | req_display_id | 표시 ID (REQ-NNNNN) |
| tb_rq_requirement | req_nm | 요구사항명 |
| tb_rq_requirement | priort_code | 우선순위 |
| tb_rq_requirement | src_code | 출처 (RFP/추가/변경) |
| tb_rq_requirement | sort_ordr | 정렬 순서 |
| tb_rq_requirement | task_id | 상위 과업 FK (NULL이면 미분류) |
| tb_rq_task | task_nm | 상위 과업명 |
| tb_ds_unit_work | req_id | 연결된 단위업무 카운트 |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 결과 0건 | 200 | '등록된 요구사항이 없습니다' 안내 표시 |

#### FID-00100 과업 상세 화면 이동

#### 기능: [FID-00100] 과업 상세 화면 이동

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | BUTTON |
| **트리거** | 과업명 링크 클릭 시 |

**처리 로직**
```
1. 상위 taskId를 경로 파라미터로 전달
2. 과업 상세 화면으로 이동
```

#### FID-00101 드래그앤드롭 순서 조정

#### 기능: [FID-00101] 드래그앤드롭 순서 조정

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | UPDATE |
| **API** | `PUT /api/projects/{projectId}/requirements/sort` |
| **트리거** | 드래그앤드롭으로 행 위치 변경 완료 시 |

**Input**
| 파라미터 | 타입 | 필수 | 설명 |
|:---------|:-----|:-----|:-----|
| orders | array | Y | [{requirementId, sortOrder}] 전체 순서 배열 |

**처리 로직**
```
1. 드롭 완료 시 변경된 순서 배열 생성
2. 서버 처리: tb_rq_requirement.sort_ordr 일괄 UPDATE
3. 성공 시 목록 순서 즉시 반영
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_rq_requirement | sort_ordr | 순서 일괄 갱신 |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 서버 오류 | 500 | 순서 변경 중 오류가 발생했습니다 |

---

## PID-00031 요구사항 상세·편집

### AR-00043 기본 정보 (FORM)

### 영역: [AR-00043] 기본 정보

**유형:** FORM

**UI 구조**
```
+──────────────────────────────────────────+
| 요구사항명 * [___________________]        |
| 우선순위    [HIGH v]  출처 [RFP v]        |
| RFP 페이지  [___]                         |
+──────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 요구사항명 | text input | 필수 입력 | - |
| 우선순위 | select | HIGH/MEDIUM/LOW | MEDIUM |
| 출처 | select | RFP/추가/변경 | RFP |
| RFP 페이지 번호 | text input | 선택 입력 | - |

#### FID-00102 요구사항 상세 조회

#### 기능: [FID-00102] 요구사항 상세 조회

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/requirements/{requirementId}` |
| **트리거** | 수정 모드 진입 시 자동 실행 |

**Output**
| 필드 | 타입 | 설명 |
|:-----|:-----|:-----|
| name | string | 요구사항명 |
| priority | string | 우선순위 |
| source | string | 출처 |
| rfpPage | string | RFP 페이지 번호 |
| originalContent | string | 원문 (orgnl_cn) |
| currentContent | string | 현행화 (curncy_cn) |
| analysisMemo | string | 분석 메모 (analy_cn) |
| detailSpec | string | 상세 명세 (spec_cn) |

**처리 로직**
```
1. 요구사항 상세 API 호출
2. 서버 처리: tb_rq_requirement에서 req_id로 조회
3. 각 필드 바인딩
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_rq_requirement | req_nm | 요구사항명 |
| tb_rq_requirement | priort_code | 우선순위 |
| tb_rq_requirement | src_code | 출처 |
| tb_rq_requirement | rfp_page_no | RFP 페이지 |
| tb_rq_requirement | orgnl_cn | 원문 |
| tb_rq_requirement | curncy_cn | 현행화 |
| tb_rq_requirement | analy_cn | 분석 메모 |
| tb_rq_requirement | spec_cn | 상세 명세 |

#### FID-00103 요구사항 저장

#### 기능: [FID-00103] 요구사항 저장

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | INSERT / UPDATE |
| **API** | `POST /api/projects/{projectId}/requirements` (신규) / `PUT /api/projects/{projectId}/requirements/{requirementId}` (수정) |
| **트리거** | [저장] 버튼 클릭 시 |

**Input**
| 파라미터 | 타입 | 필수 | 설명 |
|:---------|:-----|:-----|:-----|
| taskId | string | N | 상위 과업 ID (미선택 시 미분류) |
| name | string | Y | 요구사항명 |
| priority | string | Y | 우선순위 |
| source | string | Y | 출처 |
| rfpPage | string | N | RFP 페이지 번호 |
| originalContent | string | N | 원문 |
| currentContent | string | N | 현행화 |
| analysisMemo | string | N | 분석 메모 |
| detailSpec | string | N | 상세 명세 |

**처리 로직**
```
1. 요구사항명 공백 검증
2. API 호출 (신규: POST, 수정: PUT)
3. 서버 처리:
   a. 신규: tb_rq_requirement INSERT (req_display_id = MAX+1 자동 채번, sort_ordr = 마지막+1)
   b. 수정: tb_rq_requirement UPDATE (req_nm, priort_code, src_code, rfp_page_no, orgnl_cn, curncy_cn, analy_cn, spec_cn, mdfcn_dt = NOW())
   c. 수정 시 자동 이력 생성: tb_rq_requirement_history INSERT
      - vrsn_no = 현재 최대 내부 버전 + 0.1 (V1.1 → V1.2)
      - vrsn_ty_code = 'INTERNAL'
      - orgnl_cn, curncy_cn, spec_cn 스냅샷 저장
      - chg_mber_id = 현재 회원
4. 성공 시 '저장되었습니다' 토스트 표시 후 목록으로 복귀
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_rq_requirement | req_id | PK, UUID (신규) |
| tb_rq_requirement | req_display_id | MAX+1 자동 채번 (신규) |
| tb_rq_requirement | req_nm | 요구사항명 |
| tb_rq_requirement | priort_code | 우선순위 |
| tb_rq_requirement | src_code | 출처 |
| tb_rq_requirement | orgnl_cn | 원문 |
| tb_rq_requirement | curncy_cn | 현행화 |
| tb_rq_requirement | analy_cn | 분석 메모 |
| tb_rq_requirement | spec_cn | 상세 명세 |
| tb_rq_requirement | mdfcn_dt | 수정 일시 갱신 |
| tb_rq_requirement_history | req_hist_id | 이력 PK |
| tb_rq_requirement_history | vrsn_no | 자동 채번 (V1.1 등) |
| tb_rq_requirement_history | vrsn_ty_code | 'INTERNAL' |
| tb_rq_requirement_history | orgnl_cn | 원문 스냅샷 |
| tb_rq_requirement_history | curncy_cn | 현행화 스냅샷 |
| tb_rq_requirement_history | spec_cn | 명세 스냅샷 |
| tb_rq_requirement_history | chg_mber_id | 변경자 FK |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 요구사항명 공백 | - | 요구사항명을 입력해 주세요 |
| 서버 오류 | 500 | 저장 중 오류가 발생했습니다 |

### AR-00044 원문·현행화 (FORM)

### 영역: [AR-00044] 원문·현행화

**유형:** FORM

**UI 구조**
```
+──────────────────────────────────────────+
| ## 원문 (orgnl_cn)                       |
| [___________________________________]    |
|                                          |
| ## 현행화 (curncy_cn)                    |
| [___________________________________]    |
+──────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 원문 | textarea | RFP·계약서 원문 그대로 입력 | - |
| 현행화 | textarea | 협의·변경 반영된 최종본 입력 | - |

#### FID-00104 원문·현행화 편집

#### 기능: [FID-00104] 원문·현행화 편집

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | UPDATE |
| **API** | - (저장 버튼 클릭 시 기본 정보와 함께 저장) |
| **트리거** | 각 textarea 입력 시 |

**처리 로직**
```
1. 원문·현행화 각각 독립적으로 편집
2. [저장] 버튼 클릭 시 기본 정보와 함께 일괄 저장
```

### AR-00045 분석메모·상세명세 (FORM)

### 영역: [AR-00045] 분석메모·상세명세

**유형:** FORM

**UI 구조**
```
+──────────────────────────────────────────+
| ## 분석 메모 (analy_cn)                  |
| [마크다운 에디터___________________]     |
|                   [AI spec 초안 생성]    |
|                                          |
| ## 상세 명세 (spec_cn)                   |
| [마크다운 에디터___________________]     |
+──────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| analy_cn | markdown editor | 자유 형식 분석 메모 | - |
| AI 초안 생성 | button (secondary) | analy_cn 기반 spec_cn 초안 생성 | - |
| spec_cn | markdown editor | AI 초안 또는 직접 작성 | - |

#### FID-00105 AI spec 초안 생성

#### 기능: [FID-00105] AI spec 초안 생성

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | INSERT |
| **API** | `POST /api/projects/{projectId}/requirements/{requirementId}/ai/spec` |
| **트리거** | [AI spec 초안 생성] 버튼 클릭 시 |

**Input**
| 파라미터 | 타입 | 필수 | 설명 |
|:---------|:-----|:-----|:-----|
| analysisMemo | string | Y | AI 초안 생성 기반 분석 메모 (analy_cn) |

**Output**
| 필드 | 타입 | 설명 |
|:-----|:-----|:-----|
| spec | string | 생성된 spec_cn 초안 (마크다운) |

**처리 로직**
```
1. analy_cn 공백 검증
2. AI 초안 생성 API 호출 (처리 중 버튼 비활성화 및 로딩 표시)
3. 성공 시 spec_cn 에디터에 초안 자동 입력
4. 기존 spec_cn 내용이 있으면 덮어쓰기 전 확인 안내
```

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| analy_cn 공백 | - | 분석 메모를 먼저 작성해 주세요 |
| AI 오류 | 500 | AI 초안 생성 중 오류가 발생했습니다 |

### AR-00046 첨부파일 (FORM)

### 영역: [AR-00046] 첨부파일

**유형:** FORM

**UI 구조**
```
+──────────────────────────────────────────+
| ## 근거 파일                             |
| [파일명A.pdf]  [다운로드] [삭제]         |
| [파일명B.docx] [다운로드] [삭제]         |
|              [+ 파일 첨부]               |
+──────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 첨부파일 목록 | list | 파일명·크기 표시 | - |
| 다운로드 | button (secondary) | 파일 다운로드 | - |
| 삭제 | button (danger) | 인라인 확인 후 파일 삭제 | - |
| 파일 첨부 | button (secondary) | 다중 파일 선택 | - |

#### FID-00106 첨부파일 업로드

#### 기능: [FID-00106] 첨부파일 업로드

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | INSERT |
| **API** | `POST /api/projects/{projectId}/requirements/{requirementId}/files` |
| **트리거** | 파일 선택 완료 시 |

**Input**
| 파라미터 | 타입 | 필수 | 설명 |
|:---------|:-----|:-----|:-----|
| files | file[] | Y | 다중 파일 |

**처리 로직**
```
1. 파일 선택 다이얼로그 표시 (다중 선택)
2. 업로드 API 호출
3. 서버 처리: tb_cm_attach_file INSERT
   - ref_tbl_nm = 'tb_rq_requirement'
   - ref_id = requirementId
   - file_ty_code = 'FILE'
   - orgnl_file_nm, stor_file_nm, file_path_nm, file_sz, file_extsn_nm
4. 성공 시 첨부파일 목록 갱신
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_cm_attach_file | attach_file_id | PK, UUID 자동 생성 |
| tb_cm_attach_file | prjct_id | 프로젝트 FK |
| tb_cm_attach_file | ref_tbl_nm | 'tb_rq_requirement' |
| tb_cm_attach_file | ref_id | 요구사항 ID |
| tb_cm_attach_file | file_ty_code | 'FILE' |
| tb_cm_attach_file | orgnl_file_nm | 원본 파일명 |
| tb_cm_attach_file | stor_file_nm | 저장 파일명 |
| tb_cm_attach_file | file_path_nm | 파일 경로 |
| tb_cm_attach_file | file_sz | 파일 크기 |
| tb_cm_attach_file | file_extsn_nm | 확장자 |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 서버 오류 | 500 | 파일 업로드 중 오류가 발생했습니다 |

#### FID-00107 첨부파일 다운로드

#### 기능: [FID-00107] 첨부파일 다운로드

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/requirements/{requirementId}/files/{fileId}/download` |
| **트리거** | [다운로드] 버튼 클릭 시 |

**처리 로직**
```
1. 파일 다운로드 API 호출
2. 브라우저 파일 다운로드 실행
```

#### FID-00108 첨부파일 삭제

#### 기능: [FID-00108] 첨부파일 삭제

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | DELETE |
| **API** | `DELETE /api/projects/{projectId}/requirements/{requirementId}/files/{fileId}` |
| **트리거** | [삭제] 버튼 클릭 시 |

**처리 로직**
```
1. 인라인 확인 후 삭제 API 호출
2. 서버 처리: tb_cm_attach_file DELETE (해당 attach_file_id)
3. 성공 시 첨부파일 목록에서 제거
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_cm_attach_file | attach_file_id | 삭제 대상 PK |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 서버 오류 | 500 | 파일 삭제 중 오류가 발생했습니다 |

---

## PID-00032 요구사항 삭제 확인

### AR-00047 삭제 확인 폼 (FORM)

### 영역: [AR-00047] 삭제 확인 폼

**유형:** FORM

**UI 구조**
```
+──────────────────────────────────────+
| 요구사항을 삭제하시겠습니까?         |
| '[요구사항명]'                        |
|                                      |
| ( ) 하위 사용자스토리 전체 삭제      |
| ( ) 요구사항만 삭제                  |
|         [취소]  [삭제]               |
+──────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 대상 요구사항명 | text | 삭제 대상 표시 | - |
| 하위 전체 삭제 | radio | 스토리·인수기준 포함 전체 삭제 | - |
| 요구사항만 삭제 | radio | 스토리 미분류 유지 | 기본 선택 |
| 취소 | button (secondary) | POPUP 닫기 | - |
| 삭제 | button (danger) | 삭제 API 호출 | - |

#### FID-00109 요구사항 삭제 실행

#### 기능: [FID-00109] 요구사항 삭제 실행

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | DELETE |
| **API** | `DELETE /api/projects/{projectId}/requirements/{requirementId}` |
| **트리거** | [삭제] 버튼 클릭 시 |

**Input**
| 파라미터 | 타입 | 필수 | 설명 |
|:---------|:-----|:-----|:-----|
| deleteChildren | boolean | Y | true: 하위 전체 삭제 / false: 요구사항만 삭제 |

**처리 로직**
```
1. 선택된 삭제 방식 확인
2. 삭제 API 호출
3. 서버 처리:
   a. deleteChildren = true:
      - tb_rq_requirement DELETE (CASCADE → user_story → acceptance_criteria 전체 삭제)
      - tb_rq_requirement_history DELETE (CASCADE)
      - tb_cm_attach_file DELETE (ref_tbl_nm = 'tb_rq_requirement', ref_id = 해당 ID)
   b. deleteChildren = false:
      - tb_rq_user_story UPDATE (req_id는 NOT NULL이므로 스토리도 함께 삭제됨)
      - 실제로는 DDL 상 req_id NOT NULL + CASCADE이므로 요구사항 삭제 시 스토리도 삭제됨
      - 미분류 유지가 필요하면 별도 처리 필요 (현재 DDL 구조상 제약)
4. 성공 시 POPUP 닫기 + 목록 갱신
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_rq_requirement | req_id | 삭제 대상 PK |
| tb_rq_user_story | req_id | CASCADE 삭제 (NOT NULL FK) |
| tb_rq_acceptance_criteria | story_id | CASCADE 삭제 |
| tb_rq_requirement_history | req_id | CASCADE 삭제 |
| tb_cm_attach_file | ref_id | 첨부파일 삭제 |

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 삭제 방식 미선택 | - | 하위 데이터 처리 방법을 선택해 주세요 |
| 서버 오류 | 500 | 삭제 중 오류가 발생했습니다 |

---
