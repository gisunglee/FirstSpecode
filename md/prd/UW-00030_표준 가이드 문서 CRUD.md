# UW-00030 표준 가이드 문서 CRUD

> ## 1. 개요
| 항목 | 내용 |
|:-----|:-----|
| **단위업무ID** | UW-00030 |
| **단위업무명** | 표준 가이드 문서 CRUD |
| **비즈니스 목적** | SPECODE 고객이 프로젝트별로 AI에게 전달해야 할 제약사항(권한 정책·회원 스키마·디자인 규칙·API 계약·보안 정책 등)을 카테고리별로 등록·수정·삭제·조회한다. 향후 MCP tool 노출과 AI 태스크 프롬프트 자동 주입의 데이터 소스로 사용된다. |
| **관련 요구사항** | RQ-00030, RQ-00031 |
| **범위 (MVP)** | CRUD + 카테고리 필터 + 사용여부 필터/토글 + 검색 / AI 통합(MCP, 자동 주입)은 차기 PR |

## 2. 화면 목록
| 화면ID | 화면명 | URL | 유형 | 설명 |
|:-------|:-------|:----|:-----|:-----|
| PID-00061 | 표준 가이드 목록 | /projects/{projectId}/standard-guides | LIST | 카테고리 탭 필터 + 제목/본문 검색, 행 클릭 시 상세로 이동 |
| PID-00062 | 표준 가이드 상세 | /projects/{projectId}/standard-guides/{guideId} | DETAIL | 신규 등록·조회·편집 공용 폼 (carriage "new" = 신규) |

## 3. 화면 흐름
```
[표준 가이드 목록]
    │ 화면 진입 시 → 목록 조회 (카테고리=전체, 사용여부=전체)
    │ 카테고리 탭 클릭 → 해당 카테고리만 재조회
    │ 사용여부 탭 클릭 → 전체/사용중/미사용 필터링
    │ 검색어 입력 → 제목/본문 LIKE 검색 재조회
    │ [신규 등록] 클릭 → 상세 화면 (guideId=new)
    │ 행 클릭 → 상세 화면 (guideId=해당 ID)
    ▼
[표준 가이드 상세]
    │ 신규 모드: 빈 폼 (사용여부 기본 Y) / 편집 모드: 기존 데이터 로드
    │ 카테고리·사용여부·제목·본문 편집
    │ [저장] → 신규면 POST, 기존이면 PUT (사용여부 포함)
    │ [삭제] → ConfirmDialog → DELETE (물리 삭제, 작성자/PL/PM만)
    │ [취소] → 목록으로 복귀
```

| 이동 | 전달 파라미터 | 동작 |
|:-----|:-------------|:-----|
| 목록 → 상세 (신규) | projectId | [신규 등록] 클릭 |
| 목록 → 상세 (편집) | projectId, guideId | 행 클릭 |
| 상세 → 목록 | - | 저장·삭제·취소 완료 |

## 4. 권한 정의
> 표준 가이드는 **팀 공용 지식 베이스**다. 개인 메모와 달리 작성자에 관계없이 프로젝트 멤버 전원이 공동 관리한다.

| 기능 | VIEWER | DEV/DESIGNER/QA 등 | PM·PL 직무 | ADMIN | OWNER | 권한 키 |
|:-----|:-------|:--------------------|:------------|:------|:------|:--------|
| 목록·상세 조회 | ✅ | ✅ | ✅ | ✅ | ✅ | content.read |
| 신규 등록 | ❌ | ✅ | ✅ | ✅ | ✅ | content.create |
| 수정 (사용여부 토글 포함) | ❌ | ✅ | ✅ | ✅ | ✅ | content.update |
| 삭제 (물리 삭제) | ❌ | 작성자 본인만 | ✅ | 작성자 본인만 | 작성자 본인만 | content.delete + 추가 게이트 |

**삭제 추가 게이트**: `content.delete` 권한 통과 후 `작성자 본인 OR 직무=PM/PL`인 경우에만 허용. 그 외 403.

## 5. 카테고리 정의
> 프로젝트 초기엔 10종 고정. 추후 카테고리 마스터 테이블로 확장 가능.

| 코드 | 라벨 | 대표 용도 |
|:-----|:-----|:----------|
| UI | UI 가이드 | 디자인 토큰, 컴포넌트 사용 규칙 |
| DATA | 데이터 모델 가이드 | 회원 스키마, 공통 엔티티 |
| AUTH | 인증 가이드 | 로그인 플로우, 토큰 관리 |
| API | API 명세 가이드 | URL 포맷, 응답 구조, 에러 코드 |
| COMMON | 공통 규칙 가이드 | 네이밍, 폴더 구조 |
| SECURITY | 보안 정책 가이드 | XSS/CSRF/SQL injection 방어 |
| FILE | 파일 처리 가이드 | 업로드/다운로드 제약 |
| ERROR | 에러 처리 가이드 | 에러 응답 표준, 로깅 |
| BATCH | 배치 처리 가이드 | 스케줄러, 재시도 |
| REPORT | 리포트 가이드 | 통계, 엑셀 출력 |

## 6. 참조 테이블
- <TABLE_SCRIPT:tb_sg_std_guide>

총 화면 2개 · 영역 2개 · 기능 5개

---

## PID-00061 표준 가이드 목록

### AR-00098 표준 가이드 목록 (GRID)

### 영역: [AR-00098] 표준 가이드 목록

**유형:** GRID

**UI 구조**
```
+───────────────────────────────────────────────────────────────────+
| 표준 가이드                                         [신규 등록]   |
|───────────────────────────────────────────────────────────────────|
| [전체][UI][DATA][AUTH][API][COMMON][SECURITY][FILE][ERROR][BATCH][REPORT] |
| 검색: [________________]                            총 N건        |
|───────────────────────────────────────────────────────────────────|
| 카테고리 | 제목                     | 작성자    | 최근 수정일     |
| [UI]     | 디자인 토큰 사용 규칙     | 홍길동    | 2026-04-23 14:32 |
| [DATA]   | 회원 테이블 필드 명명     | 김철수    | 2026-04-22 09:15 |
+───────────────────────────────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 카테고리 탭 | button group | 10종 + 전체, 선택 시 필터 즉시 반영 | 전체 |
| 검색 | text input | 제목+본문 LIKE 검색 (300ms debounce) | 빈 값 |
| 카테고리 배지 | badge | 카테고리별 색상 구분 | - |
| 제목 | text | 행 클릭 시 상세로 이동 | - |
| 작성자 | text | tb_cm_member.mber_nm 조회 | - |
| 최근 수정일 | text | mdfcn_dt 우선, 없으면 creat_dt | - |
| 신규 등록 | button (primary) | 상세 화면(guideId=new)으로 이동 | - |

#### FID-00207 표준 가이드 목록 조회

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/standard-guides` |
| **트리거** | 화면 진입, 카테고리/검색 변경 시 자동 |

**Input (Query)**
| 파라미터 | 타입 | 필수 | 설명 |
|:---------|:-----|:-----|:-----|
| category | string | N | UI/DATA/AUTH/API/COMMON/SECURITY/FILE/ERROR/BATCH/REPORT (미지정 시 전체) |
| use | string | N | Y=사용중만, N=미사용만, 미지정=전체 |
| search | string | N | 제목+본문 부분일치 검색 |
| page | number | N | 기본 1 |
| pageSize | number | N | 기본 50 |

**Output**
| 필드 | 타입 | 설명 |
|:-----|:-----|:-----|
| items | array | { guideId, category, subject, useYn, creatMberName, creatDt, mdfcnDt } |
| pagination | object | { page, pageSize, total, totalPages } |

**처리 로직**
```
1. requirePermission(content.read) 통과 확인
2. where = { prjct_id } — use_yn 기본 필터 없음 (사용여부 필터가 별도로 있음)
3. use 지정 시 where.use_yn = "Y" | "N"
4. category 지정 시 where.guide_ctgry_code 추가
5. search 지정 시 OR( guide_sj contains, guide_cn contains )
6. mdfcn_dt DESC NULLS LAST, creat_dt DESC 정렬
7. tb_cm_member 병렬 조회로 작성자명 매핑
```

**참조 테이블**
| 테이블 | 컬럼 | 용도 |
|:-------|:-----|:-----|
| tb_sg_std_guide | * | 목록 조회 |
| tb_cm_member | mber_id, mber_nm | 작성자명 매핑 |

---

## PID-00062 표준 가이드 상세

### AR-00099 표준 가이드 입력 폼 (FORM)

### 영역: [AR-00099] 표준 가이드 입력 폼

**유형:** FORM

**UI 구조**
```
+─────────────────────────────────────────────+
| ← 표준 가이드 상세                          |
|─────────────────────────────────────────────|
| [배지: UI] · 작성자 홍길동 · 2026-04-23      |  (기존만 표시)
|─────────────────────────────────────────────|
| 카테고리 *                                  |
| [UI ▼]                                      |
|                                             |
| 제목 *                                      |
| [___________________________________________]|
|                                             |
| 본문 (마크다운)                             |
| +─────────────────────────────────────────+ |
| |                                         | |
| +─────────────────────────────────────────+ |
|                                             |
| [삭제]                 [취소]  [저장]       |
+─────────────────────────────────────────────+
```

**구성 항목**
| 항목명 | UI 타입 | 설명 | 기본값 |
|:-------|:--------|:-----|:-------|
| 카테고리 | select | 10종 중 선택, 필수 | UI |
| 제목 | text input | 필수 | - |
| 본문 | textarea | 마크다운 원문 (MVP는 plain textarea) | - |
| 삭제 | button (danger) | ConfirmDialog 경유, 기존 모드만 표시 | - |
| 취소 | button (secondary) | 목록으로 복귀 | - |
| 저장 | button (primary) | 유효성 검증 후 API 호출 | - |

#### FID-00208 표준 가이드 상세 조회

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | SELECT |
| **API** | `GET /api/projects/{projectId}/standard-guides/{guideId}` |
| **트리거** | 편집 모드 진입 시 (guideId ≠ "new") |

**Output**
| 필드 | 타입 | 설명 |
|:-----|:-----|:-----|
| guideId | string | PK |
| category | string | 카테고리 코드 |
| subject | string | 제목 |
| content | string | 본문 (마크다운) |
| creatMberName | string | 작성자명 |
| creatDt | string | 작성일 |
| mdfcnDt | string\|null | 최근 수정일 |

**처리 로직**
```
1. requirePermission(content.read)
2. findUnique(guide_id) + prjct_id 일치 확인
3. use_yn='N' 이면 NOT_FOUND (소프트 삭제된 건)
4. tb_cm_member 조회로 작성자명 포함
```

#### FID-00209 표준 가이드 저장 (신규·수정 공용)

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | INSERT / UPDATE |
| **API** | 신규: `POST /api/projects/{projectId}/standard-guides` / 수정: `PUT /api/projects/{projectId}/standard-guides/{guideId}` |
| **트리거** | [저장] 버튼 클릭 |

**Input (Body)**
| 파라미터 | 타입 | 필수 | 설명 |
|:---------|:-----|:-----|:-----|
| category | string | Y (신규) / N (수정) | 10종 중 하나 |
| subject | string | Y (신규) / N (수정) | 제목 |
| content | string | N | 본문 마크다운 |
| useYn | string | N | Y=사용중, N=미사용 (신규 시 기본 Y, 수정 시 미지정이면 변경 없음) |

**처리 로직**
```
1. requirePermission(신규: content.create / 수정: content.update)
2. category 유효성 검증 (10종 enum)
3. subject 공백 trim 후 빈 값이면 VALIDATION_ERROR
4. useYn 전달된 경우 Y/N 검증
5. 신규: INSERT (creat_mber_id = gate.mberId, use_yn 기본 Y)
   수정: UPDATE 지정 필드만 (mdfr_mber_id, mdfcn_dt = now())
6. 성공 응답 { guideId }
```

**에러 처리**
| 상황 | HTTP | 메시지 |
|:-----|:-----|:-------|
| 제목 미입력 | 400 | 제목을 입력해 주세요 |
| 카테고리 유효성 오류 | 400 | 유효하지 않은 카테고리입니다 |
| 찾을 수 없음 | 404 | 가이드를 찾을 수 없습니다 |
| 서버 오류 | 500 | 저장 중 오류가 발생했습니다 |

#### FID-00210 표준 가이드 삭제 (물리)

| 항목 | 내용 |
|:-----|:-----|
| **기능유형** | DELETE (물리 삭제) |
| **API** | `DELETE /api/projects/{projectId}/standard-guides/{guideId}` |
| **트리거** | [삭제] 클릭 → ConfirmDialog 확인 후 |

**처리 로직**
```
1. requirePermission(content.delete)
2. 대상 가이드 존재 확인 (prjct_id 일치)
3. 추가 게이트: 작성자 본인 OR 직무=PM/PL (아니면 403)
4. tbSgStdGuide.delete() 물리 삭제
```

> 참고: `use_yn`은 "삭제" 용도가 아니라 "사용중/미사용" 비즈니스 속성이므로
> 실제 삭제는 물리 DELETE로 처리한다. 보관하되 AI에 전달하지 않으려면 사용여부를 N으로 변경.

---

## 7. 향후 확장 (차기 PR 이연)
- **UW-00031**: 카테고리 마스터 테이블 (사용자 정의 카테고리)
- **UW-00032**: AI 표준 가이드 검토 (AI가 가이드 품질/일관성 리뷰)
- **UW-00034**: 풀텍스트 검색 (PostgreSQL tsvector)
- **MCP 도구**: `search_standard_guides`, `get_standard_guide` 노출 (`src/lib/mcp/register-tools.ts` 수정)
- **AI 프롬프트 자동 주입**: `/run-ai-task` 실행 시 task의 ref_ty_code에 따라 관련 카테고리 가이드 자동 주입
- **CLAUDE.md export**: 개발자 로컬 Claude Code에서 참조 가능한 md 파일 export
