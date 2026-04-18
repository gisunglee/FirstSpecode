# /review-uw — SPECODE UW 구현 품질 검토

PRD 기반으로 특정 UW(단위업무) 구현을 3개 서브에이전트로 **병렬 검토**하고 종합 리포트를 출력한다.

## 사용법

```
/review-uw <UW번호>
```

예시:
```
/review-uw UW-00014
/review-uw UW-00035
/review-uw 14          ← 숫자만 전달해도 UW-00014 로 정규화
```

## 실행 지시사항

### 0단계: 인자 검증 및 정규화

`$ARGUMENTS` 를 공백으로 토큰 분리.

- **토큰 0개**: 사용법 안내 후 종료.
- **토큰 2개 이상**: 사용법 안내 후 종료.
- **토큰 1개**:
  - `UW-XXXXX` 형식 → 그대로 사용
  - 숫자만 (예: `14`, `35`) → `UW-00014`, `UW-00035` 로 정규화 (5자리 zero-pad)
  - 그 외 형식 → 거부

정규화된 값을 `$UW` 변수로 이후 단계에서 사용.

### 1단계: PRD 파일 존재 확인

Glob으로 `md/prd/{UW}_*.md` 매칭 확인.
- 파일 없으면 "PRD 파일이 없습니다: {UW}" 출력 후 종료.
- 여러 개 매칭되면 가장 첫 파일 사용하고 리포트에 경고 기재.

### 2단계: 3개 서브에이전트 병렬 호출

**반드시 한 번의 응답에서 Agent 툴을 3번 호출 (병렬 실행)**.

각 에이전트에게 동일한 입력 전달:
```
대상: {UW}
검토해서 JSON 리포트 + 한국어 요약으로 리턴해줘.
반드시 .claude/agents/_shared/report-format.md 포맷 준수.
```

호출할 서브에이전트:
1. `prd-compliance-reviewer`
2. `code-quality-reviewer`
3. `ui-design-reviewer`

**주의**:
- 세 에이전트는 **isolation 불필요** (읽기 전용 작업). 워크트리 옵션 주지 말 것.
- 백그라운드(run_in_background) 금지. 결과를 다음 단계에서 바로 써야 함.
- 세 개의 JSON 블록이 모두 돌아올 때까지 대기.

### 3단계: 3개 리포트 수집 및 파싱

각 에이전트 응답에서 ```json 블록 추출 → 파싱.

파싱 실패 시:
- 해당 에이전트 이슈는 "리포트 파싱 실패"로 기록
- 종합 판정은 나머지로 진행

### 4단계: 종합 판정

**verdict 집계 규칙** (가장 나쁜 것 따라감):
- 하나라도 FAIL → **종합 FAIL**
- 하나라도 WARN → **종합 WARN**
- 셋 다 PASS → **종합 PASS**

**score 종합**: 세 리포트 score의 **최솟값** (약한 고리가 기준).

**counts 합산**: critical/major/minor 각각 합산.

### 5단계: 종합 리포트 출력

사용자에게 아래 구조로 출력:

```markdown
# 🔍 UW 검토 리포트: {UW}

**종합 판정**: ✅ PASS / ⚠️ WARN / ❌ FAIL
**종합 점수**: {min_score} / 100
**이슈 합계**: 🔴 {critical} · 🟡 {major} · 🟢 {minor}

---

## 📋 PRD 준수 (prd-compliance)
**판정**: {verdict} · **점수**: {score}

{summary_ko}

**주요 이슈** (critical/major만 표시, 최대 5개):
- 🔴 [{location}] {rule}: {description}
  → 수정: {fix}
- ...

---

## 🛠 코드 품질 (code-quality)
**판정**: {verdict} · **점수**: {score}

{summary_ko}

**주요 이슈**:
- ...

---

## 🎨 UI 디자인 (ui-design)
**판정**: {verdict} · **점수**: {score}

{summary_ko}

**주요 이슈**:
- ...

---

## 🎯 권장 액션

{FAIL 또는 WARN인 경우, 우선순위 top 3 수정 지시}
{PASS 인 경우, "검토 완료. 머지/배포 가능." 출력}

---

## 📎 전체 리포트 원본 (JSON)

<details>
<summary>prd-compliance JSON</summary>

```json
{prd_json}
```

</details>

<details>
<summary>code-quality JSON</summary>

```json
{code_json}
```

</details>

<details>
<summary>ui-design JSON</summary>

```json
{ui_json}
```

</details>
```

### 6단계: 자동 수정 여부

**디폴트: 자동 수정 금지**. 리포트만 출력하고 종료.

사용자가 이어서 "critical 부터 고쳐줘" 같은 지시 주면 그때 수정 진행.

---

## 주의사항 (체크리스트)

- [ ] UW 번호 없으면 사용법만 출력하고 종료
- [ ] PRD 파일 존재 확인 후 에이전트 호출
- [ ] Agent 툴 3개를 **같은 응답에 병렬 호출** (순차 금지)
- [ ] 세 리포트 모두 수신 후 종합 판정
- [ ] JSON 파싱 실패 시 해당 에이전트만 skip, 전체 중단 금지
- [ ] 디폴트는 **리포트 출력만**. 자동 수정 금지
- [ ] 출력은 한국어로

---

## 설계 메모

- 루프 깊이: **1회** (자동 반복 수정 안 함. 리스크 관리)
- UI 리뷰 범위: **토큰 검사 + 패턴 비교**. 스크린샷 비교는 미지원
- 에이전트는 읽기만. Edit/Write 권한 없음 (tools 필드에서 제한됨)
- 필요 시 `/review-uw` 리포트 받은 뒤 메인에게 "이슈 수정해줘" 하면 메인이 수정
