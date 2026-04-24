-- ================================================================
-- 설계 양식 시스템 공통 seed — 5계층(REQUIREMENT/UNIT_WORK/SCREEN/AREA/FUNCTION)
--   작성일 : 2026-04-24
--   전제   : tb_ai_design_template 이 이미 존재해야 함
--            (2026-04-24_add_tb_ai_design_template.sql 먼저 실행)
--
--   멱등성 : ON CONFLICT DO NOTHING — 고정 UUID 이므로 재실행해도 중복 insert 안 됨.
--   default_yn = 'Y' → 운영자가 실수로 삭제 불가 (API에서 403)
--
--   원본 : 각 상세 페이지에 하드코딩되어 있던 EXAMPLE/TEMPLATE 상수를 그대로 이식.
--          템플릿 본문의 JS 보간 ${displayId} / ${name} 은 {{displayId}} / {{name}}
--          플레이스홀더로 치환됨. 클라이언트에서 applyTemplateVars() 로 치환한다.
-- ================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1) REQUIREMENT (요구사항 상세 명세)
--    원본: src/app/(main)/projects/[id]/requirements/[reqId]/page.tsx
--          SPEC_EXAMPLE (L31-78), SPEC_TEMPLATE (L81-109)
-- ────────────────────────────────────────────────────────────────
INSERT INTO tb_ai_design_template (
  dsgn_tmpl_id, prjct_id, ref_ty_code, tmpl_nm, tmpl_dc,
  example_cn, template_cn,
  use_yn, default_yn, sort_ordr, creat_mber_id
) VALUES (
  '11111111-1111-1111-1111-000000000001', NULL, 'REQUIREMENT',
  '요구사항 표준 양식', '기능 개요·메뉴·권한·화면·기능상세·처리순서·제약',
  -- example_cn
  '## 기능 개요
다양한 유형의 게시판(공지, 자료실, 묻고답하기 등)을 단일 구조로 통합 관리하며,
관리자가 게시판 유형과 속성을 직접 설정할 수 있는 기능을 제공한다.

## 메뉴 위치
- 사용자: 정보마당 > 게시판
- 관리자: 시스템관리 > 게시판관리

## 사용 대상 / 권한
| 구분 | 대상 | 접근 범위 |
|------|------|-----------|
| 일반사용자 | 로그인 사용자 전체 | 조회, 글쓰기, 댓글 |
| 비로그인 | 일반 방문자 | 조회만 가능 (게시판별 설정) |
| 게시판 관리자 | 지정된 담당자 | 글 관리, 공지 지정, 첨부 삭제 |
| 시스템 관리자 | 관리자 | 게시판 생성/수정/삭제, 권한 설정 |

## 제공 화면 목록
| 화면명 | 설명 |
|--------|------|
| 게시판 목록 | 게시글 목록 조회, 검색, 페이징 |
| 게시글 상세 | 본문, 첨부파일, 댓글 표시 |
| 게시글 등록/수정 | 에디터 포함, 첨부파일 업로드 |
| 게시판 관리 | 관리자용 게시판 유형/속성 설정 |
| 게시글 관리 | 관리자용 전체 글 목록, 일괄 처리 |

## 기능 상세
| 기능명 | 설명 | 비고 |
|--------|------|------|
| 게시판 유형 설정 | 공지/자료실/QnA 등 유형별 속성 ON/OFF | 관리자 전용 |
| 게시글 CRUD | 등록, 수정, 삭제, 조회 | 권한별 차등 |
| 공지 고정 | 상단 고정 공지 지정 | 게시판관리자 이상 |
| 첨부파일 | 다중 파일 업로드, 확장자/용량 제한 설정 | 게시판별 설정 |
| 댓글 | 댓글 등록/삭제, 대댓글 1단계 지원 | 게시판별 ON/OFF |
| 검색 | 제목, 내용, 작성자 검색 | |
| 조회수 | 게시글 조회 시 자동 카운트 | 관리자 조회 제외 |
| 답글 (QnA) | 원글에 대한 답변 글 연결 표시 | QnA 유형만 해당 |

## 업무 처리 순서
1. 관리자가 게시판 유형/속성 생성 (댓글 허용 여부, 첨부 허용 여부 등 설정)
2. 사용자가 게시글 등록 (에디터 작성 + 첨부파일 업로드)
3. 게시판 관리자가 필요 시 공지 지정 또는 글 숨김 처리
4. 일반 사용자 목록 조회 → 상세 조회 → 댓글 작성
5. QnA 유형의 경우 담당자가 답글 등록 → 작성자에게 알림 (알림 연계 시)

## 제외 범위 / 제약 사항 / 협의 사항
- (제외) 이메일 알림 연계는 본 범위 제외
- (제약) 첨부파일 확장자는 보안지침상 exe, sh 등 실행파일 불가
- (협의) 익명 게시 기능은 추후 결정',
  -- template_cn
  '## 기능 개요


## 메뉴 위치
- 사용자:
- 관리자:

## 사용 대상 / 권한
| 구분 | 대상 | 접근 범위 |
|------|------|-----------|
| | | |

## 제공 화면 목록
| 화면명 | 설명 |
|--------|------|
| | |

## 기능 상세
| 기능명 | 설명 | 비고 |
|--------|------|------|
| | | |

## 업무 처리 순서
1.

## 제외 범위 / 제약 사항 / 협의 사항
- (제외)
- (제약)
- (협의)',
  'Y', 'Y', 0, NULL
) ON CONFLICT (dsgn_tmpl_id) DO NOTHING;


-- ────────────────────────────────────────────────────────────────
-- 2) UNIT_WORK (단위업무)
--    원본: src/app/(main)/projects/[id]/unit-works/[unitWorkId]/page.tsx
--          UNIT_WORK_EXAMPLE (L1354-1402), UNIT_WORK_TEMPLATE (L1406-1440)
-- ────────────────────────────────────────────────────────────────
INSERT INTO tb_ai_design_template (
  dsgn_tmpl_id, prjct_id, ref_ty_code, tmpl_nm, tmpl_dc,
  example_cn, template_cn,
  use_yn, default_yn, sort_ordr, creat_mber_id
) VALUES (
  '11111111-1111-1111-1111-000000000002', NULL, 'UNIT_WORK',
  '단위업무 표준 양식', '개요·화면목록·화면흐름·권한·상태·참조테이블',
  -- example_cn
  '## 1. 개요
| 항목 | 내용 |
|:-----|:-----|
| **단위업무ID** | UW-00001 |
| **단위업무명** | 이메일 회원가입 |
| **비즈니스 목적** | 이메일·비밀번호 입력 및 인증 메일 발송을 통해 신규 회원을 등록한다. |
| **관련 요구사항** | - |
| **기술 스택** | - |

## 2. 화면 목록
| 화면ID | 화면명 | URL | 유형 | 설명 |
|:-------|:-------|:----|:-----|:-----|
| PID-00003 | 회원가입 | /auth/register | DETAIL | 이메일·비밀번호 입력 및 유효성 검증 후 인증 메일 발송 요청 |
| PID-00004 | 인증 메일 발송 안내 | /auth/register/verify | DETAIL | 인증 메일 발송 완료 안내 및 재발송 요청 처리 |
| PID-00005 | 이메일 인증 완료 | /auth/register/complete | DETAIL | 인증 링크 클릭 후 가입 완료 처리 및 온보딩 페이지 이동 |

## 3. 화면 흐름
```
[PID-00003 회원가입] ──(가입 요청 성공)──▶ [PID-00004 인증 메일 발송 안내]
[PID-00004 인증 메일 발송 안내] ──(인증 링크 클릭)──▶ [PID-00005 이메일 인증 완료]
[PID-00005 이메일 인증 완료] ──(3초 후 자동/즉시 이동)──▶ [온보딩 페이지]
[PID-00005 토큰 만료·무효] ──(재발송 안내 버튼)──▶ [PID-00004 인증 메일 발송 안내]
```

| 이동 | 전달 파라미터 | 동작 |
|:-----|:-------------|:-----|
| PID-00003 → PID-00004 | email | 가입 요청 성공 후 자동 이동 |
| PID-00004 → PID-00005 | token (URL 파라미터) | 인증 메일 내 링크 클릭 |
| PID-00005 → 온보딩 | - | 3초 카운트다운 후 자동 이동 또는 즉시 이동 |
| PID-00005 → PID-00004 | - | 토큰 만료·무효 시 재발송 안내 버튼 클릭 |

## 4. 권한 정의
| 기능 | 비로그인 | 일반 사용자 | 관리자 |
|:-----|:---------|:-----------|:-------|
| 회원가입 폼 접근 | ✅ | ❌ | ❌ |
| 인증 메일 재발송 | ✅ | ❌ | ❌ |
| 이메일 인증 완료 처리 | ✅ | ❌ | ❌ |

## 5. 상태 정의
| 상태 | 설명 |
|:-----|:-----|
| 미인증 | 가입 요청 후 인증 메일 발송 완료, 아직 인증 링크 미클릭 |
| 인증완료 | 인증 링크 클릭 후 가입 완료 처리된 상태 |
| 인증만료 | 인증 링크 발송 후 1시간 초과로 만료된 상태 |

## 6. 참조 테이블
- <TABLE_SCRIPT:tb_cm_member>
- <TABLE_SCRIPT:tb_cm_email_verification>
- <TABLE_SCRIPT:tb_cm_refresh_token>',
  -- template_cn  (UNIT_WORK_TEMPLATE은 원래 displayId/name 자리 없음 — 그대로 이식)
  '## 1. 개요
| 항목 | 내용 |
|:-----|:-----|
| **단위업무ID** | {{displayId}} |
| **단위업무명** | {{name}} |
| **비즈니스 목적** | |
| **관련 요구사항** | |
| **기술 스택** | |

## 2. 화면 목록
| 화면ID | 화면명 | URL | 유형 | 설명 |
|:-------|:-------|:----|:-----|:-----|
| | | | | |

## 3. 화면 흐름
```
[화면A] ──(조건)──▶ [화면B]
```

| 이동 | 전달 파라미터 | 동작 |
|:-----|:-------------|:-----|
| → | | |

## 4. 권한 정의
| 기능 | 비로그인 | 일반 사용자 | 관리자 |
|:-----|:---------|:-----------|:-------|
| | | | |

## 5. 상태 정의
| 상태 | 설명 |
|:-----|:-----|
| | |

## 6. 참조 테이블
- <TABLE_SCRIPT:>',
  'Y', 'Y', 0, NULL
) ON CONFLICT (dsgn_tmpl_id) DO NOTHING;


-- ────────────────────────────────────────────────────────────────
-- 3) SCREEN (화면)
--    원본: src/app/(main)/projects/[id]/screens/[screenId]/page.tsx
--          DESCRIPTION_EXAMPLE (L1097-1117), DESCRIPTION_TEMPLATE (L1119-1137)
-- ────────────────────────────────────────────────────────────────
INSERT INTO tb_ai_design_template (
  dsgn_tmpl_id, prjct_id, ref_ty_code, tmpl_nm, tmpl_dc,
  example_cn, template_cn,
  use_yn, default_yn, sort_ordr, creat_mber_id
) VALUES (
  '11111111-1111-1111-1111-000000000003', NULL, 'SCREEN',
  '화면 표준 양식', '화면 개요·영역 목록·영역 간 흐름',
  -- example_cn
  '## [PID-00001] 게시판 목록

### 화면 개요

| 항목 | 내용 |
|:-----|:-----|
| **비즈니스 목적** | 프로젝트 내 공지사항을 한눈에 확인하고, 제목·유형·기간 조건으로 필요한 글을 빠르게 찾는다. |
| **진입 경로** | 메뉴 클릭, 등록/수정 완료 후 리다이렉트 |

### 영역 목록

| 영역ID | 영역명 | 유형 | 설명 |
|:-------|:-------|:-----|:-----|
| AR-00001 | 검색 영역 | SEARCH_FORM | 유형·기간·제목 조건 검색 |
| AR-00002 | 목록 영역 | DATA_GRID | 게시글 목록 표시, 페이징, 글쓰기 버튼 |

### 영역 간 흐름

- 화면 진입 시 → 검색 조건 초기화 → 자동 조회 → 목록 표시
- 검색 버튼 클릭 → 검색 조건으로 재조회 → 목록 갱신 (1페이지 초기화)
- 행 클릭 → PID-00002 상세 화면 이동',
  -- template_cn  (${displayId} → {{displayId}}, ${name} → {{name}})
  '## [{{displayId}}] {{name}}

### 화면 개요

| 항목 | 내용 |
|:-----|:-----|
| **비즈니스 목적** |  |
| **진입 경로** |  |

### 영역 목록

| 영역ID | 영역명 | 유형 | 설명 |
|:-------|:-------|:-----|:-----|
|  |  |  |  |

### 영역 간 흐름

- ',
  'Y', 'Y', 0, NULL
) ON CONFLICT (dsgn_tmpl_id) DO NOTHING;


-- ────────────────────────────────────────────────────────────────
-- 4) AREA (영역)
--    원본: src/app/(main)/projects/[id]/areas/[areaId]/page.tsx
--          DESCRIPTION_EXAMPLE (L1429-1465), DESCRIPTION_TEMPLATE (L1467-1483)
-- ────────────────────────────────────────────────────────────────
INSERT INTO tb_ai_design_template (
  dsgn_tmpl_id, prjct_id, ref_ty_code, tmpl_nm, tmpl_dc,
  example_cn, template_cn,
  use_yn, default_yn, sort_ordr, creat_mber_id
) VALUES (
  '11111111-1111-1111-1111-000000000004', NULL, 'AREA',
  '영역 표준 양식', 'UI 구조 + 구성 항목',
  -- example_cn
  '### 영역: [AR-00003] 상세 영역

**유형:** DETAIL_VIEW

**UI 구조**

```text
+───────────────────────────────────────────────────+
│ [공지] 시스템 점검 안내                              │
│ 작성자: 관리자 │ 등록일: 2026-03-15 14:30 │ 조회: 121 │
│───────────────────────────────────────────────────│
│                                                   │
│ (마크다운 렌더링된 본문 내용)                         │
│                                                   │
│───────────────────────────────────────────────────│
│ 📎 첨부파일                                        │
│   점검안내서.pdf (2.1MB)  [다운로드]                 │
│   일정표.xlsx (340KB)     [다운로드]                │
│───────────────────────────────────────────────────│
│                              [목록]  [수정]  [삭제] │
+───────────────────────────────────────────────────+
```

**구성 항목**

| 항목명 | UI 타입 | 비고 |
|:-------|:--------|:-----|
| 유형 배지 | badge | NOTICE(빨강) / NORMAL(회색) |
| 제목 | heading (h2) | |
| 작성자 | text | |
| 등록일 | datetime | yyyy-MM-dd HH:mm |
| 조회수 | number | |
| 본문 | markdown render | 마크다운 → HTML 렌더링 |
| 첨부파일 목록 | file list | 파일명(크기) + 다운로드 버튼 |
| 목록 버튼 | button (default) | → PID-00001 (검색조건 유지) |
| 수정 버튼 | button (primary) | → PID-00003, 작성자/관리자만 표시 |
| 삭제 버튼 | button (danger) | 확인 후 논리삭제, 작성자/관리자만 표시 |',
  -- template_cn  (${displayId} → {{displayId}}, ${name} → {{name}})
  '### 영역: [{{displayId}}] {{name}} | 테이블명 그룹코드 | cm/pj/rq/ds

**유형:**

**UI 구조**
```
+─────────────────────────────────+
│                                 │
+─────────────────────────────────+
```

**구성 항목**

| 항목명 | UI 타입 | 비고 |
|:-------|:--------|:-----|
|  |  |  |',
  'Y', 'Y', 0, NULL
) ON CONFLICT (dsgn_tmpl_id) DO NOTHING;


-- ────────────────────────────────────────────────────────────────
-- 5) FUNCTION (기능)
--    원본: src/app/(main)/projects/[id]/functions/[functionId]/page.tsx
--          DESCRIPTION_EXAMPLE (L1466-1521), DESCRIPTION_TEMPLATE (L1523-1555)
--    주의: 본문에 SQL 리터럴 '' 이스케이프 필요
--          ('BOARD' → ''BOARD'', 'N' → ''N'')
-- ────────────────────────────────────────────────────────────────
INSERT INTO tb_ai_design_template (
  dsgn_tmpl_id, prjct_id, ref_ty_code, tmpl_nm, tmpl_dc,
  example_cn, template_cn,
  use_yn, default_yn, sort_ordr, creat_mber_id
) VALUES (
  '11111111-1111-1111-1111-000000000005', NULL, 'FUNCTION',
  '기능 표준 양식', '기능 헤더·Input/Output·테이블 관계·처리 로직·업무 규칙',
  -- example_cn  (내부 홑따옴표 ''로 escape)
  '#### 기능: [FN-00001] 게시판 목록 조회

| 항목 | 내용 |
|:-----|:-----|
| 기능ID | FN-00001 |
| 기능명 | 게시판 목록 조회 |
| 기능유형 | SELECT |
| API | `GET /api/board` |
| 트리거 | 화면 진입(자동), 검색 버튼 클릭 |

**Input**

| 파라미터 | 타입 | 필수 | DB 매핑 | 설명 |
|:---------|:-----|:-----|:--------|:-----|
| projectId | number | Y (세션) | project_id | |
| boardTypeCd | string | N | board_type_cd | null이면 전체 |
| keyword | string | N | board_title_nm | LIKE 검색 |
| startDt | string | N | reg_dt | >= 조건 (yyyy-MM-dd) |
| endDt | string | N | reg_dt | <= 조건 (yyyy-MM-dd) |
| page | number | Y | - | 1부터 시작 |
| size | number | Y | - | 기본 20 |

**Output**

| 필드 | 타입 | DB 매핑 | 설명 |
|:-----|:-----|:--------|:-----|
| boardId | number | board_id | |
| boardTypeCd | string | board_type_cd | |
| boardTitleNm | string | board_title_nm | |
| regUserNm | string | (JOIN) | 작성자명 |
| regDt | string | reg_dt | |
| viewCnt | number | view_cnt | |
| fixYn | string | fix_yn | |
| attachYn | string | (서브쿼리) | 첨부파일 존재 Y/N |
| totalCount | number | COUNT(*) OVER() | 총 건수 |

**참조 테이블 관계**
```
tb_cm_board b
  LEFT JOIN tb_cm_user u ON u.user_id = b.reg_user_id
```
- 첨부파일 존재 여부: `EXISTS (SELECT 1 FROM tb_cm_attach_file WHERE ref_type_cd = ''BOARD'' AND ref_id = b.board_id AND del_yn = ''N'')`

**처리 로직**
```
1. project_id 세션에서 획득
2. del_yn = ''N'' 필터
3. 검색 조건 적용 (boardTypeCd, keyword LIKE, startDt >=, endDt <= +1일)
4. 정렬: fix_yn DESC, reg_dt DESC (상단고정 우선, 최신순)
5. 페이징: LIMIT :size OFFSET (:page - 1) * :size
```

**업무 규칙**
- 검색 결과 0건 → "등록된 게시글이 없습니다" 안내
- 상단고정 게시글은 페이지와 무관하게 항상 최상단
- 기간 종료일은 해당일 23:59:59까지 포함',
  -- template_cn  (${displayId} → {{displayId}}, ${name} → {{name}})
  '#### 기능: [{{displayId}}] {{name}}

| 항목 | 내용 |
|:-----|:-----|
| 기능ID | {{displayId}} |
| 기능명 | {{name}} |
| 기능유형 | |
| API | `` |
| 트리거 | |

**Input**

| 파라미터 | 타입 | 필수 | DB 매핑 | 설명 |
|:---------|:-----|:-----|:--------|:-----|
| | | | | |

**Output**

| 필드 | 타입 | DB 매핑 | 설명 |
|:-----|:-----|:--------|:-----|
| | | | |

**참조 테이블 관계**
```
```

**처리 로직**
```
1.
```

**업무 규칙**
- ',
  'Y', 'Y', 0, NULL
) ON CONFLICT (dsgn_tmpl_id) DO NOTHING;

COMMIT;


-- ================================================================
-- 검증 쿼리
-- ================================================================
-- SELECT ref_ty_code, tmpl_nm, default_yn, use_yn,
--        length(example_cn) AS ex_len, length(template_cn) AS tp_len
--   FROM tb_ai_design_template
--  WHERE prjct_id IS NULL
--  ORDER BY
--    CASE ref_ty_code
--      WHEN 'REQUIREMENT' THEN 1
--      WHEN 'UNIT_WORK'   THEN 2
--      WHEN 'SCREEN'      THEN 3
--      WHEN 'AREA'        THEN 4
--      WHEN 'FUNCTION'    THEN 5
--    END;
