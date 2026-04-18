# 리뷰 리포트 출력 포맷 (모든 리뷰어 공통)

> 3개 리뷰어 모두 이 포맷을 **반드시** 따른다.
> 출력은 **반드시 ```json 코드블록** 안에 넣는다 (파싱을 위해).

---

## 출력 구조

````
```json
{
  "agent": "prd-compliance" | "code-quality" | "ui-design",
  "target": "UW-XXXXX",
  "verdict": "PASS" | "WARN" | "FAIL",
  "score": 0-100,
  "counts": {
    "critical": 0,
    "major": 0,
    "minor": 0
  },
  "issues": [
    {
      "severity": "critical" | "major" | "minor",
      "rule": "위반한 규칙의 이름 (한국어 가능)",
      "location": "src/app/.../page.tsx:45",
      "description": "무엇이 문제인가 (1~2줄)",
      "fix": "어떻게 고쳐야 하는가 (구체적으로)"
    }
  ],
  "summary_ko": "한국어 한 문단 요약 — 메인 Claude와 사용자가 읽을 부분"
}
```
````

그리고 JSON 블록 **다음에** 한국어 자유형 요약을 붙인다 (사람 읽기용).

---

## 필드 작성 규칙

### `verdict` 판정 로직 (severity-rules.md와 일치)

- `critical ≥ 1` → **FAIL**
- `critical = 0` AND `major ≤ 3` → **PASS**
- `critical = 0` AND `major > 3` → **WARN**

### `score` 계산

```
감점 = critical*15 + major*5 + minor*1
score = max(0, 100 - 감점)
```

### `location`

- 반드시 **상대 경로**(프로젝트 루트 기준) + 가능하면 **라인 번호**
- 파일 단위 이슈는 라인 번호 생략 가능
- 여러 파일에 걸친 이슈는 대표 1~2개만 location에 쓰고 description에 "등 N곳"

### `description` / `fix`

- `description`: **무엇이** 문제인지. 관찰 사실만.
- `fix`: **어떻게** 고칠지. 코드 스니펫 금지 (길어짐). 1~2줄 구체 지시.

### `summary_ko`

- 한 문단(3~5줄)
- 전체 판정 + 주요 critical/major 이슈 요약 + 다음 액션 제안

---

## 예시

````
```json
{
  "agent": "prd-compliance",
  "target": "UW-00014",
  "verdict": "WARN",
  "score": 78,
  "counts": { "critical": 0, "major": 3, "minor": 2 },
  "issues": [
    {
      "severity": "major",
      "rule": "PRD 기능 누락 - 과업 복사",
      "location": "src/app/(main)/projects/[id]/tasks/page.tsx",
      "description": "FID-00094(과업 복사) 기능이 UI에서 호출되지 않음. API는 구현되어 있음.",
      "fix": "목록 행의 [복사] 버튼에 POST /api/projects/{id}/tasks/{taskId}/copy 호출 추가"
    },
    {
      "severity": "major",
      "rule": "삭제 옵션 모달 누락",
      "location": "src/app/(main)/projects/[id]/tasks/page.tsx",
      "description": "PRD PID-00028의 삭제 옵션 모달(ALL / TASK_ONLY 선택)이 단순 confirm으로 처리됨",
      "fix": "ConfirmDialog 확장 또는 전용 삭제 옵션 모달 컴포넌트 추가"
    },
    {
      "severity": "minor",
      "rule": "우선순위 현황 표시 누락",
      "location": "src/app/(main)/projects/[id]/tasks/page.tsx",
      "description": "HIGH/MEDIUM/LOW 건수 요약이 목록 행에 표시되지 않음",
      "fix": "prioritySummary 필드 바인딩 + 'H/M/L 3/6/3' 형식으로 렌더"
    }
  ],
  "summary_ko": "UW-00014 과업 CRUD 검토 결과 WARN. API는 전부 구현되었으나 UI에서 '과업 복사' 버튼과 '삭제 옵션 모달'이 누락되어 PRD 사양을 충족하지 못함. 우선순위 요약 표시 같은 minor 이슈 2건도 함께 발견. 복사/삭제 모달부터 우선 보완 권고."
}
```
````
