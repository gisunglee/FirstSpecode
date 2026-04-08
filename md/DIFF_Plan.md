# SPECODE — Diff Prompt Test 기능 설계서 (Plan.md)

> **목적:** UW/PID/AR/FID 4계층 스펙을 입력·저장하고, 변경 시 자동으로 "차이점 프롬프트(PRD_CHANGE.md)"를 생성하는 테스트 기능
> **스택:** Next.js 14+ (App Router) + PostgreSQL + TypeScript
> **위치:** SPECODE 본 제품 내 테스트 페이지 (`/test/diff-prompt`)

---

## 1. 기능 개요

### 1.1 핵심 시나리오
1. 사용자가 한 화면에서 4개 박스(UW/PID/AR/FID)에 MD 텍스트 입력
2. **저장** 클릭 → 각 노드별로 hash 계산, 변경된 노드만 DB에 새 버전 INSERT
3. 동시에 MASTER 레코드 1건 생성 (저장 이벤트 묶음)
4. **차이 프롬프트** 클릭 → 직전 MASTER와 비교, PRD_CHANGE.md 생성, MASTER에 저장 + 화면에 표시
5. **최종 버전 불러오기** → 가장 최근 MASTER의 4개 노드를 화면에 로드 → 수정 → 저장 반복

### 1.2 4계층 구조 복습
| 레벨 | 약어 | 분량 | 용도 |
|:--|:--|:--|:--|
| 단위업무 | UW | ~50줄 | 개요, 권한, 관련 테이블 |
| 화면 | PID | ~30줄 | URL, 영역 목록, 화면 흐름 |
| 영역 | AR | 50~100줄 | UI 구조, 구성 항목 |
| 기능 | FID | 길다 | 처리 로직, 컬럼 매핑 |

---

## 2. DB 설계

### 2.1 테이블 구조 (3개)

```
tb_sp_diff_test_master    ← 저장 이벤트 단위 (저장 1번 = 1 row)
    ├── tb_sp_diff_test_node  ← 노드별 스냅샷 (UW/PID/AR/FID 4건)
    └── (diff_prompt_md 컬럼에 PRD_CHANGE.md 직접 저장)
```

### 2.2 DDL

```sql
-- ========================================
-- MASTER: 저장 이벤트 (한 번 저장 = 1 row)
-- ========================================
CREATE TABLE tb_sp_diff_test_master (
    master_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_sn             BIGSERIAL NOT NULL,             -- 사람이 보기 쉬운 일련번호
    sj_nm               VARCHAR(200),                    -- 제목 (사용자 입력, optional)
    memo_cn             TEXT,                            -- 메모 (사용자 입력, optional)

    -- 비교 정보
    base_master_id      UUID,                            -- 비교 대상 직전 master (NULL이면 최초)
    chg_node_cnt        INT DEFAULT 0,                   -- 이번 저장에서 변경된 노드 수

    -- diff 결과
    diff_prompt_md      TEXT,                            -- 생성된 PRD_CHANGE.md 전문 (NULL 가능)
    diff_summary_json   JSONB,                           -- 통계: {uw: {mode, lineRatio}, ...}

    -- 메타
    creat_dt            TIMESTAMP NOT NULL DEFAULT NOW(),
    creat_user_id       VARCHAR(50),                     -- 테스트라 NULL OK

    CONSTRAINT fk_diff_test_master_base
        FOREIGN KEY (base_master_id)
        REFERENCES tb_sp_diff_test_master(master_id)
);

CREATE INDEX idx_diff_test_master_creat_dt ON tb_sp_diff_test_master(creat_dt DESC);
CREATE INDEX idx_diff_test_master_test_sn ON tb_sp_diff_test_master(test_sn DESC);

COMMENT ON TABLE tb_sp_diff_test_master IS 'Diff Prompt 테스트 마스터';
COMMENT ON COLUMN tb_sp_diff_test_master.diff_prompt_md IS '생성된 PRD_CHANGE.md 전문';

-- ========================================
-- DETAIL: 노드별 스냅샷 (master 1건당 4건: UW/PID/AR/FID)
-- ========================================
CREATE TABLE tb_sp_diff_test_node (
    node_pk             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id           UUID NOT NULL,

    -- 노드 정보
    node_type_code      VARCHAR(10) NOT NULL,            -- 'UW' | 'PID' | 'AR' | 'FID'
    node_seq            SMALLINT NOT NULL,               -- 1=UW, 2=PID, 3=AR, 4=FID (정렬용)

    -- 콘텐츠
    raw_md_cn           TEXT NOT NULL,                   -- 사용자가 입력한 원본 MD
    parsed_json         JSONB,                           -- Parser가 쪼갠 결과
    content_hash        CHAR(64) NOT NULL,               -- 정규화 후 SHA256

    -- 변경 추적
    is_changed_yn       CHAR(1) DEFAULT 'N',             -- 'Y' = 직전 master 대비 변경
    chg_mode_code       VARCHAR(10),                     -- 'NO_CHANGE' | 'DIFF' | 'FULL' | 'REPLACE'
    chg_line_ratio      DECIMAL(5,4),                    -- 라인 변동률 (0.0000 ~ 1.0000)
    added_line_cnt      INT DEFAULT 0,
    removed_line_cnt    INT DEFAULT 0,
    kept_line_cnt       INT DEFAULT 0,

    creat_dt            TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_diff_test_node_master
        FOREIGN KEY (master_id)
        REFERENCES tb_sp_diff_test_master(master_id)
        ON DELETE CASCADE,
    CONSTRAINT uk_diff_test_node UNIQUE(master_id, node_type_code),
    CONSTRAINT chk_node_type CHECK (node_type_code IN ('UW','PID','AR','FID')),
    CONSTRAINT chk_chg_mode CHECK (chg_mode_code IN ('NO_CHANGE','DIFF','FULL','REPLACE') OR chg_mode_code IS NULL)
);

CREATE INDEX idx_diff_test_node_master ON tb_sp_diff_test_node(master_id, node_seq);
CREATE INDEX idx_diff_test_node_hash ON tb_sp_diff_test_node(content_hash);

COMMENT ON TABLE tb_sp_diff_test_node IS 'Diff Prompt 테스트 노드 스냅샷';
```

### 2.3 저장 정책

| 시나리오 | tb_sp_diff_test_master | tb_sp_diff_test_node |
|:--|:--|:--|
| 저장 버튼 클릭 | 1 row INSERT (diff_prompt_md=NULL) | **항상 4 row INSERT** (변경 없는 노드도 저장) |
| 차이 프롬프트 클릭 | diff_prompt_md UPDATE | 변경 없음 |

> **결정:** 노드는 4건 모두 매번 저장합니다. "변경된 것만 저장"보다 단순하고, 테스트 환경에서 추적이 쉽습니다. hash는 비교용으로만 씁니다.

---

## 3. 모듈 구조

```
/app
  /test
    /diff-prompt
      page.tsx                ← 메인 테스트 페이지
      layout.tsx              ← (선택) 테스트 레이아웃
  /api
    /diff-test
      /save           POST    ← 저장
      /load-latest    GET     ← 최종 버전 불러오기
      /load/[id]      GET     ← 특정 master 불러오기
      /list           GET     ← master 목록 (드롭다운용)
      /diff           POST    ← 차이 프롬프트 생성
      /reset          DELETE  ← 테스트 데이터 초기화

/lib
  /diff-test
    parser.ts                 ← MD → JSON 트리
    normalizer.ts             ← 정규화 + hash
    differ.ts                 ← 섹션별 라인 diff
    strategist.ts             ← DIFF/FULL/REPLACE 모드 결정
    renderer.ts               ← PRD_CHANGE.md 생성
    db.ts                     ← DB 쿼리 모음
    types.ts                  ← 타입 정의

/components
  /diff-test
    NodeBox.tsx               ← 4개 박스 1개 (UW/PID/AR/FID 공통)
    DiffPromptViewer.tsx      ← 생성된 MD 미리보기 (모달/사이드패널)
    MasterHistoryDropdown.tsx ← 과거 master 선택
    SaveButton.tsx
    DiffButton.tsx
    Toolbar.tsx
```

---

## 4. UI 설계

### 4.1 화면 레이아웃

```
┌──────────────────────────────────────────────────────────────────────┐
│  SPECODE — Diff Prompt Test                            [⚙ 설정]      │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  [최종 버전 불러오기 ▼] [💾 저장] [🔍 차이 프롬프트] [🗑 초기화]      │
│  제목: [_________________________________]                           │
│  메모: [_________________________________]                           │
│                                                                      │
│  ┌────────────────────────┐  ┌────────────────────────┐             │
│  │ ① 단위업무 (UW)        │  │ ② 화면 (PID)           │             │
│  │ ─────────────────────  │  │ ─────────────────────  │             │
│  │                        │  │                        │             │
│  │   [textarea]           │  │   [textarea]           │             │
│  │                        │  │                        │             │
│  │ 50줄 · hash: a1b2..    │  │ 30줄 · hash: c3d4..    │             │
│  └────────────────────────┘  └────────────────────────┘             │
│                                                                      │
│  ┌────────────────────────┐  ┌────────────────────────┐             │
│  │ ③ 영역 (AR)            │  │ ④ 기능 (FID)           │             │
│  │ ─────────────────────  │  │ ─────────────────────  │             │
│  │                        │  │                        │             │
│  │   [textarea]           │  │   [textarea]           │             │
│  │                        │  │                        │             │
│  │ 80줄 · hash: e5f6..    │  │ 120줄 · hash: 7890..   │             │
│  └────────────────────────┘  └────────────────────────┘             │
│                                                                      │
│  ─── 최근 저장 이력 ──────────────────────────────────────────       │
│  #15  2026-04-08 14:30  "50자 검증 추가"  변경 1건  [보기]          │
│  #14  2026-04-08 14:00  "초안"           변경 4건  [보기]          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 컴포넌트별 동작

#### 4.2.1 NodeBox (4개 공통)
| 항목 | 내용 |
|:--|:--|
| 입력 | textarea (resize: vertical, min-height: 400px) |
| 라벨 | UW/PID/AR/FID 색상 구분 (UW: blue, PID: green, AR: amber, FID: violet) |
| 푸터 | 라인 수 · 글자 수 · 현재 hash 앞 8자 · 변경 여부 뱃지 |
| 변경 뱃지 | 직전 master 대비 변경되었으면 빨간 점, 같으면 회색 점 |
| 폴드/펼치기 | 박스 우상단 [-] 버튼으로 접기 (집중 모드) |

#### 4.2.2 Toolbar
| 버튼 | 동작 |
|:--|:--|
| **최종 버전 불러오기 ▼** | 드롭다운: "직전 저장본" 또는 마스터 목록에서 선택 |
| **💾 저장** | 4개 textarea 내용을 POST `/api/diff-test/save` |
| **🔍 차이 프롬프트** | 직전 master vs 현재 master 비교, 결과 모달 표시 |
| **🗑 초기화** | 모든 master/node 삭제 (확인 모달) |

#### 4.2.3 DiffPromptViewer (모달)
| 구역 | 내용 |
|:--|:--|
| 헤더 | "PRD_CHANGE — Master #15 vs #14" |
| 비교 대상 선택 | "비교 기준" 드롭다운 (Master #14 ▼) ← 다른 버전과도 비교 가능 |
| 본문 | 생성된 MD를 마크다운 렌더링 + 토글로 raw 보기 |
| 통계 패널 | 노드별 모드(DIFF/FULL/REPLACE), 변동률, 추가/삭제 라인 |
| 액션 | [📋 복사] [💾 .md 다운로드] [🤖 Claude Code 형식 복사] |

---

## 5. API 명세

### 5.1 POST `/api/diff-test/save`

**Request**
```typescript
{
  sjNm?: string;        // 제목 optional
  memoCn?: string;      // 메모 optional
  nodes: {
    UW: string;         // raw MD
    PID: string;
    AR: string;
    FID: string;
  };
}
```

**처리 로직**
```
1. 직전 master 1건 조회 (creat_dt DESC LIMIT 1) → baseMasterId
2. 각 노드(UW/PID/AR/FID)에 대해:
   a. parser.parse(rawMd) → parsedJson
   b. normalizer.normalize(parsedJson) → normalizedStr
   c. sha256(normalizedStr) → contentHash
   d. baseMaster의 같은 노드 hash와 비교 → isChanged
   e. 변경되었으면 differ + strategist 실행 → mode, lineRatio, added/removed/kept
3. tb_sp_diff_test_master INSERT (diff_prompt_md=NULL, base_master_id=baseMasterId)
4. tb_sp_diff_test_node 4건 INSERT
5. chg_node_cnt 업데이트
6. 응답: { masterId, testSn, changedNodes: ['FID', ...] }
```

**Response**
```typescript
{
  ok: true,
  masterId: string,
  testSn: number,
  baseMasterId: string | null,
  changedNodes: string[],   // ['FID']
  nodeStats: {
    UW: { changed: false, hash: 'a1b2...' },
    PID: { changed: false, hash: 'c3d4...' },
    AR: { changed: false, hash: 'e5f6...' },
    FID: { changed: true, hash: '7890...', mode: 'FULL', lineRatio: 0.35 }
  }
}
```

### 5.2 GET `/api/diff-test/load-latest`

가장 최근 master의 4개 노드를 반환.

**Response**
```typescript
{
  masterId: string,
  testSn: number,
  sjNm: string | null,
  creatDt: string,
  nodes: {
    UW: { rawMd: string, hash: string },
    PID: { ... },
    AR: { ... },
    FID: { ... }
  }
}
```

### 5.3 GET `/api/diff-test/load/[masterId]`

특정 master 불러오기. 응답 구조는 5.2와 동일.

### 5.4 GET `/api/diff-test/list`

```typescript
{
  items: [
    {
      masterId: string,
      testSn: number,
      sjNm: string | null,
      creatDt: string,
      chgNodeCnt: number,
      hasDiffPrompt: boolean
    }
  ]
}
```

### 5.5 POST `/api/diff-test/diff`

**Request**
```typescript
{
  targetMasterId: string,    // 비교 기준점 (현재 master)
  baseMasterId?: string      // 비교 대상 (생략 시 직전 master 자동)
}
```

**처리 로직**
```
1. target과 base의 4개 노드 모두 로드
2. 노드별로:
   a. differ.diffSection(beforeJson, afterJson)
   b. strategist.decideMode(diff)
3. renderer.render({ context, changes }) → MD 문자열
4. tb_sp_diff_test_master.diff_prompt_md UPDATE
5. tb_sp_diff_test_master.diff_summary_json UPDATE
6. 응답: 생성된 MD + 통계
```

**Response**
```typescript
{
  ok: true,
  diffPromptMd: string,         // 전문
  summary: {
    UW: { mode: 'NO_CHANGE' },
    PID: { mode: 'NO_CHANGE' },
    AR: { mode: 'DIFF', changedSections: ['UI 구조'], lineRatio: 0.05 },
    FID: { mode: 'FULL', changedSections: ['처리_로직', '에러_처리'], lineRatio: 0.35,
           added: 12, removed: 8, kept: 22 }
  }
}
```

### 5.6 DELETE `/api/diff-test/reset`

테스트 데이터 전체 삭제 (master CASCADE → node 같이 삭제).

---

## 6. 핵심 로직 설계

### 6.1 Parser (`lib/diff-test/parser.ts`)

**책임:** raw MD → JSON 트리 (섹션별 분할)

```typescript
// 노드 타입별로 다른 파싱 규칙
parseUW(md: string): UWParsed
parsePID(md: string): PIDParsed
parseAR(md: string): ARParsed
parseFID(md: string): FIDParsed

// 공통: remark + remark-gfm 사용
// 섹션 인식 규칙: ## 또는 **bold** 라벨 다음 오는 표/코드/리스트
```

**라이브러리:** `unified`, `remark-parse`, `remark-gfm`

**FID 파싱 결과 예시:**
```json
{
  "id": "FID-00076",
  "name": "기본정보 저장",
  "sections": {
    "기능유형": "UPDATE",
    "API": "PUT /api/projects/{projectId}",
    "처리_로직": ["1. ...", "2. ..."],
    "에러_처리": [{"상황": "...", "메시지": "..."}],
    "참조_테이블": ["tb_pj_project"]
  }
}
```

### 6.2 Normalizer (`lib/diff-test/normalizer.ts`)

```typescript
function normalize(parsed: any): string {
  // 1. 키 알파벳 정렬
  // 2. 문자열 trim + 공백 압축
  // 3. JSON.stringify
}

function computeHash(normalized: string): string {
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
```

### 6.3 Differ (`lib/diff-test/differ.ts`)

```typescript
function diffNode(before: any, after: any): NodeDiff {
  // 1. 섹션 단위 비교 → changedSections 추출
  // 2. 변경된 섹션마다 diffLines 호출
  // 3. 통계 합산 (added/removed/kept)
  return { changedSections, sectionDiffs, stats };
}
```

**라이브러리:** `diff` (npm: jsdiff)

### 6.4 Strategist (`lib/diff-test/strategist.ts`)

```typescript
function decideMode(diff: NodeDiff): ChangeMode {
  if (diff.stats.changedLines === 0) return 'NO_CHANGE';

  const ratio = diff.stats.changedLines / diff.stats.totalLines;
  const sectionCnt = diff.changedSections.length;

  if (ratio < 0.2 && sectionCnt <= 2) return 'DIFF';
  if (ratio < 0.7) return 'FULL';
  return 'REPLACE';
}
```

### 6.5 Renderer (`lib/diff-test/renderer.ts`)

**책임:** 4개 노드의 변경 정보를 받아 PRD_CHANGE.md 문자열 생성

**구조 (이전 답변에서 정의한 계층형 인터리브):**
```
1. 헤더 + AI 작업 지침
2. UW 풀버전 + (변경 있으면) 변경 블록
3. PID 풀버전 + (변경 있으면) 변경 블록
4. AR 풀버전 + (변경 있으면) 변경 블록
5. FID 변경 블록 (모드별로 DIFF/FULL/REPLACE 다르게)
6. 형제 정보 (이번 테스트에선 생략 가능)
7. 금지선
```

**라이브러리:** `eta` (템플릿 엔진)

**템플릿 파일:** `lib/diff-test/templates/`
- `change_packet.md.eta` (메인 템플릿)
- `partials/uw_block.eta`
- `partials/pid_block.eta`
- `partials/ar_block.eta`
- `partials/fid_block.eta`
- `partials/diff_section.eta` (DIFF 모드용)
- `partials/full_section.eta` (FULL 모드용)
- `partials/replace_section.eta` (REPLACE 모드용)

---

## 7. 테스트 도우미 기능

테스트 환경이니 디버깅·검증이 쉽도록 추가합니다.

### 7.1 샘플 데이터 로드 버튼
| 버튼 | 동작 |
|:--|:--|
| 📋 샘플 #1 (UW-00012) | 4개 박스에 UW-00012 샘플 자동 입력 |
| 📋 샘플 #2 (게시판) | 게시판 CRUD 샘플 |
| 🎲 가상 변경 적용 | 현재 내용에 자동으로 작은 변경 (50자 검증 추가 등) |

### 7.2 hash 시각화 패널
화면 우측 사이드바에 토글 가능:
```
[현재 입력]                [직전 저장본]
UW:  a1b2c3d4 ✓ 동일       a1b2c3d4
PID: c3d4e5f6 ✓ 동일       c3d4e5f6
AR:  e5f6a7b8 ⚠ 변경       e5f6XXXX
FID: 78909abc ⚠ 변경       7890YYYY
```

### 7.3 master 비교 매트릭스
"이력" 탭에서 master 2건 선택 → 매트릭스 표시:
```
        UW    PID   AR    FID
#15     ✓     ✓     ⚠     ⚠
#14     ✓     ✓     ⚠     ✓
#13     ✓     ✓     ✓     ✓
#12     초기  초기  초기  초기
```

### 7.4 raw JSON 디버그 뷰
DiffPromptViewer 모달에 탭 추가:
- **MD 렌더링** (기본)
- **Raw MD** (생성된 원본 텍스트)
- **diff_summary_json** (계산 통계)
- **parsed_json (Before/After)** (Parser 결과 검증용)

### 7.5 단축키
| 키 | 동작 |
|:--|:--|
| `Ctrl+S` | 저장 |
| `Ctrl+D` | 차이 프롬프트 |
| `Ctrl+L` | 최종 버전 불러오기 |
| `Ctrl+1~4` | 각 박스로 포커스 이동 |

### 7.6 상태 표시줄 (화면 하단 고정)
```
Master: #15 (방금 저장됨) · 변경 노드: FID · DB 노드 수: 60건 · 직전 비교: 가능
```

---

## 8. 패키지 의존성

```json
{
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "pg": "^8.11.0",
    "unified": "^11.0.0",
    "remark-parse": "^11.0.0",
    "remark-gfm": "^4.0.0",
    "diff": "^5.2.0",
    "eta": "^3.4.0",
    "react-markdown": "^9.0.0",
    "remark-gfm": "^4.0.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "@types/diff": "^5.0.0",
    "@types/uuid": "^9.0.0"
  }
}
```

---

## 9. 구현 순서 (Phase별)

### Phase 1: DB + 기본 저장 (반나절)
- [ ] DDL 실행 (tb_sp_diff_test_master, tb_sp_diff_test_node)
- [ ] `lib/diff-test/db.ts` — pg 클라이언트 + 기본 쿼리
- [ ] `POST /api/diff-test/save` — Parser/Normalizer 없이 raw 저장만
- [ ] 화면: 4개 textarea + 저장 버튼만

### Phase 2: Parser + Hash (반나절)
- [ ] `parser.ts` — UW/PID/AR/FID 파싱 (간단히 시작, 점진 보강)
- [ ] `normalizer.ts` — hash 계산
- [ ] save API에 Parser/Hash 결합
- [ ] 화면: 박스 푸터에 hash·라인 수 표시

### Phase 3: 불러오기 + 이력 (반나절)
- [ ] `GET /api/diff-test/load-latest`
- [ ] `GET /api/diff-test/list`
- [ ] 화면: 최종 버전 불러오기 드롭다운, 이력 패널

### Phase 4: Differ + Strategist (반나절)
- [ ] `differ.ts` — 섹션별 라인 diff
- [ ] `strategist.ts` — 모드 결정
- [ ] save API에 변경 추적 결합 (is_changed_yn, chg_mode_code)

### Phase 5: Renderer + 차이 프롬프트 (1일)
- [ ] eta 템플릿 5종 작성 (메인 + DIFF/FULL/REPLACE/NO_CHANGE 부분)
- [ ] `renderer.ts`
- [ ] `POST /api/diff-test/diff`
- [ ] DiffPromptViewer 모달 컴포넌트

### Phase 6: 테스트 도우미 (반나절)
- [ ] 샘플 데이터 로드
- [ ] hash 시각화 패널
- [ ] 단축키
- [ ] reset API

---

## 10. 핵심 결정 사항 요약

| 항목 | 결정 | 이유 |
|:--|:--|:--|
| **DB** | PostgreSQL (SPECODE 본 제품과 동일) | 본 제품 통합 대비 |
| **테이블 수** | 2개 (master + node) | 단순함 |
| **노드 저장 정책** | 매번 4건 모두 INSERT | 추적 단순, 테스트 용이 |
| **변경 감지** | hash 비교 (LLM 안 씀) | 결정성 보장 |
| **diff 단위** | 섹션별 라인 diff | 구조 정보 보존 |
| **모드 분기** | DIFF / FULL / REPLACE | 변경량 따라 적절히 |
| **Renderer** | 계층형 인터리브 (UW→PID→AR→FID 순) | 컨텍스트와 변경을 함께 |
| **diff 결과 저장** | master.diff_prompt_md 컬럼에 직접 | 테스트 환경 단순화 |
| **입력 방식** | textarea (raw MD 직접) | 가장 빠른 테스트 |
| **비교 대상** | 자동(직전) + 선택(드롭다운) | 둘 다 필요 |

---

## 11. 향후 확장 (테스트 후 본 제품 통합 시)

| 확장 항목 | 내용 |
|:--|:--|
| 형제 노드 시그니처 | 같은 AR 안의 다른 FID 자동 추출 + 표시 |
| UW 영향 분석기 | UW 권한 변경 시 영향 FID 자동 추정 |
| Claude Code 직접 송신 | 생성된 MD를 CC API로 바로 전달 |
| 변경 이력 그래프 | master 간 변경 흐름 시각화 |
| 다중 프로젝트 | prjct_id로 격리 |
| 사용자 권한 | OWNER/ADMIN만 reset 가능 등 |

---

## 12. 작업 시작 전 체크리스트

- [ ] PostgreSQL DB 준비 (SPECODE 본 제품 DB 또는 별도 스키마)
- [ ] Next.js 프로젝트에 위 패키지 설치
- [ ] DDL 실행
- [ ] `/test/diff-prompt` 라우트 구조 생성
- [ ] 환경변수: `DATABASE_URL` 설정 확인

---

**끝.** 이 Plan.md를 Claude Code에 던지면 Phase 1부터 순차 구현 가능합니다.
