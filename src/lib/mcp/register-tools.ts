/**
 * register-tools.ts — MCP 도구 등록
 *
 * 역할:
 *   - McpServer 인스턴스에 SPECODE 도구들을 등록
 *
 * 도구 카테고리:
 *   [프로젝트]     list_projects, get_project, list_members
 *   [기획-과업]    list_tasks, get_task, create_task, update_task
 *   [기획-요구사항] list_requirements, get_requirement, create_requirement, update_requirement
 *   [기획-스토리]  list_user_stories, get_user_story, create_user_story, update_user_story
 *   [기획-트리]    get_planning_tree
 *   [설계-단위업무] list_unit_works, get_unit_work, create_unit_work, update_unit_work
 *   [설계-화면]    list_screens, get_screen, create_screen, update_screen
 *   [설계-영역]    list_areas, get_area, create_area, update_area
 *   [설계-기능]    list_functions, get_function, create_function, update_function
 *   [설계-트리]    get_design_tree (배치 조회 — 단위업무 ID 1~20개 필수, "전체 조회" 미지원)
 *   [DB]           list_db_tables, get_db_table, get_db_table_usage, get_db_column_usage
 *   [스펙 정합성]   source baseline·컨텍스트·Type A/B 제출·검토 결과 조회·보완 확인
 *   [워커 배포]    get_worker_command_files (/run-ai-tasks 커맨드를 고객 로컬에 설치할 파일 내용 제공)
 *
 * 정책 — DELETE 미지원:
 *   MCP에서는 어떤 엔티티도 삭제할 수 없다. AI가 한 번의 잘못된 호출로 cascade 삭제를
 *   일으키지 못하도록 delete_* 도구를 일괄 제거했다. 삭제는 UI(웹) 채널에서만 가능하며,
 *   API DELETE 라우트는 그대로 유지된다.
 *
 * 정책 — 대시보드 summary 미등록:
 *   /api/projects/[id]/dashboard/manage-summary 와 /me-summary 는 의도적으로 등록하지 않는다.
 *   화면 첫 페인트용 집계 응답이라 AI 가 사용해도 의미가 없고(개별 list_* 도구로 동일 정보를
 *   얻을 수 있다), 응답 구조가 UI 카드와 강하게 결합되어 있어 인터페이스 안정성도 낮다.
 *
 * 정책 — 산출물 발행(/documents/release/*) 미등록:
 *   POST/GET/DELETE 모두 의도적으로 MCP 미노출. 발행은 사람이 버전·사유를 입력해야 하는
 *   행위이고(자동화 부적합), 발행 이력 삭제는 박제본을 영구히 없애는 destructive 동작이라
 *   AI 가 한 번의 호출 실수로 협의 결과 산출물을 잃지 않도록 한다.
 *   필요 시 UI(웹) 채널에서만 처리 — DELETE 정책과 같은 맥락.
 *
 * 계층 관계:
 *   기획: 과업(Task) → 요구사항(Requirement) → 사용자스토리(UserStory)
 *   설계: 단위업무(UnitWork) → 화면(Screen) → 영역(Area) → 기능(Function)
 *   연결: 요구사항 ↔ 단위업무 (reqId로 연결)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpecodeFetch } from "@/lib/mcp/api-client";
import { getWorkerCommandFiles, WORKER_COMMAND_SETUP_GUIDE } from "@/lib/mcp/workerCommandFiles";
import { receiptSubmissionSchema } from "@/lib/spec-reconciliation/contracts";

const providerReceiptSubmissionSchema = receiptSubmissionSchema.omit({
  repoProvider: true,
  checkpointType: true,
  headStable: true,
  evidenceTrust: true,
  evidenceVerify: true,
  ancestryVerified: true,
  diffHash: true,
  evidenceVerifyData: true,
  sourceEvidence: true,
  manifest: true,
});

// ─── 공통 헬퍼 ──────────────────────────────────────────────────

/** 도구 결과를 MCP 텍스트 콘텐츠로 래핑 */
function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/** 에러를 MCP 에러 결과로 래핑 */
function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `❌ 오류: ${message}` }],
    isError: true,
  };
}

// ─── 쿼리스트링 빌더 ────────────────────────────────────────────

/** optional 파라미터들을 쿼리스트링으로 변환 */
function buildQs(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      qs.set(key, String(value));
    }
  }
  const str = qs.toString();
  return str ? `?${str}` : "";
}

// ═══════════════════════════════════════════════════════════════════
// 도구 등록 메인 함수
// ═══════════════════════════════════════════════════════════════════

/**
 * MCP 서버에 SPECODE 도구를 등록한다.
 *
 * specodeFetch는 주입 방식으로 전달받는다 — 이유:
 *   HTTP MCP(/api/mcp)에서는 "요청자 토큰"으로 내부 API를 호출해야
 *   그 사용자가 멤버인 프로젝트만 접근되어 타인 데이터 누수가 막힌다.
 *   전역 specodeFetch(env 기반)로 고정하면 누가 호출해도 같은 계정으로
 *   조회되어 권한 누수가 발생하므로, 요청마다 생성된 fetch를 받도록 한다.
 *
 * @param server        McpServer 인스턴스 (요청마다 새로 생성)
 * @param specodeFetch  createSpecodeFetch({ token })로 만든 요청 스코프 fetch
 */
export function registerTools(
  server: McpServer,
  specodeFetch: SpecodeFetch
): void {

  // ═══════════════════════════════════════════════════════════════
  // 1. 프로젝트 (Project)
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "list_projects",
    "프로젝트 목록 조회 — 서비스 계정이 접근 가능한 프로젝트 목록을 반환합니다",
    {},
    async () => {
      try {
        const data = await specodeFetch("/api/projects");
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_project",
    "프로젝트 상세 조회 — 프로젝트 기본 정보와 내 역할을 반환합니다",
    { projectId: z.string().describe("프로젝트 ID") },
    async ({ projectId }) => {
      try {
        const data = await specodeFetch(`/api/projects/${projectId}`);
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "list_members",
    "프로젝트 멤버 목록 조회 — 이름/이메일/역할/직무를 가진 멤버 목록을 반환합니다. " +
      "create_*/update_* 도구의 assignMemberId(담당자 지정)에 쓸 멤버 ID를 찾을 때 사용하세요. " +
      "응답의 myMemberId가 요청자 본인의 멤버 ID입니다",
    { projectId: z.string().describe("프로젝트 ID") },
    async ({ projectId }) => {
      try {
        const data = await specodeFetch(`/api/projects/${projectId}/members`);
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 2. 기획 — 과업 (Task)
  //    displayId 자동채번: SFR-NNNNN
  //    계층: 과업 → 요구사항 → 사용자스토리
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "list_tasks",
    "과업 목록 조회 — 프로젝트의 과업 목록과 요구사항 수/우선순위 집계를 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
    },
    async ({ projectId }) => {
      try {
        const data = await specodeFetch(`/api/projects/${projectId}/tasks`);
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_task",
    "과업 상세 조회 — 과업명, 카테고리, 정의, 상세내용 등을 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      taskId: z.string().describe("과업 ID"),
    },
    async ({ projectId, taskId }) => {
      try {
        const data = await specodeFetch(`/api/projects/${projectId}/tasks/${taskId}`);
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "create_task",
    "과업 생성 — 새 과업을 등록합니다. displayId(SFR-NNNNN)는 자동 채번됩니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      name: z.string().describe("과업명 (필수)"),
      category: z.string().describe("카테고리 (필수). 허용값: NEW_DEV(신규개발) | IMPROVE(기능개선) | MAINTAIN(유지보수)"),
      definition: z.string().optional().describe("과업 정의"),
      content: z.string().optional().describe("상세 내용"),
      outputInfo: z.string().optional().describe("산출물 정보"),
      rfpPage: z.string().optional().describe("RFP 페이지 번호"),
    },
    async ({ projectId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/tasks`,
          { method: "POST", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "update_task",
    "과업 수정 — 기존 과업 정보를 업데이트합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      taskId: z.string().describe("과업 ID"),
      name: z.string().describe("과업명 (필수)"),
      category: z.string().describe("카테고리 (필수). 허용값: NEW_DEV | IMPROVE | MAINTAIN"),
      definition: z.string().optional().describe("과업 정의"),
      content: z.string().optional().describe("상세 내용"),
      outputInfo: z.string().optional().describe("산출물 정보"),
      rfpPage: z.string().optional().describe("RFP 페이지 번호"),
      assignMemberId: z.string().optional().describe("담당자 회원 ID (list_members로 조회 가능)"),
    },
    async ({ projectId, taskId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/tasks/${taskId}`,
          { method: "PUT", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 3. 기획 — 요구사항 (Requirement)
  //    displayId 자동채번: REQ-NNNNN
  //    FK: taskId (선택 — 없으면 미분류)
  //    계층: 과업 → [요구사항] → 사용자스토리
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "list_requirements",
    "요구사항 목록 조회 — 프로젝트의 요구사항 목록을 반환합니다 (검색, 페이지네이션 지원)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      page: z.number().optional().describe("페이지 번호 (기본: 1)"),
      pageSize: z.number().optional().describe("페이지 크기 (기본: 20)"),
      search: z.string().optional().describe("검색어"),
    },
    async ({ projectId, page, pageSize, search }) => {
      try {
        const qs = buildQs({ page, pageSize, search });
        const data = await specodeFetch(
          `/api/projects/${projectId}/requirements${qs}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_requirement",
    "요구사항 상세 조회 — 요구사항 정보와 연결된 사용자스토리를 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      requirementId: z.string().describe("요구사항 ID"),
    },
    async ({ projectId, requirementId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/requirements/${requirementId}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "create_requirement",
    "요구사항 생성 — 새 요구사항을 등록합니다. displayId(REQ-NNNNN)는 자동 채번됩니다. 과업에 소속시키려면 taskId를 전달하세요 (선행: list_tasks 또는 get_planning_tree로 taskId 조회)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      name: z.string().describe("요구사항명 (필수)"),
      priority: z.string().describe("우선순위 (필수). 허용값: HIGH | MEDIUM | LOW"),
      source: z.string().describe("출처 (필수). 허용값: RFP | ADD(추가) | CHANGE(변경)"),
      taskId: z.string().optional().describe("소속 과업 ID (선택 — 미입력 시 미분류)"),
      rfpPage: z.string().optional().describe("RFP 페이지 번호"),
      originalContent: z.string().optional().describe("요구사항 원문"),
      currentContent: z.string().optional().describe("현행화 내용"),
      analysisMemo: z.string().optional().describe("분석 메모"),
      detailSpec: z.string().optional().describe("상세 명세"),
    },
    async ({ projectId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/requirements`,
          { method: "POST", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "update_requirement",
    "요구사항 수정 — 기존 요구사항 정보를 업데이트합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      requirementId: z.string().describe("요구사항 ID"),
      name: z.string().describe("요구사항명 (필수)"),
      priority: z.string().describe("우선순위 (필수). 허용값: HIGH | MEDIUM | LOW"),
      source: z.string().describe("출처 (필수). 허용값: RFP | ADD | CHANGE"),
      taskId: z.string().optional().describe("소속 과업 ID"),
      rfpPage: z.string().optional().describe("RFP 페이지 번호"),
      originalContent: z.string().optional().describe("요구사항 원문"),
      currentContent: z.string().optional().describe("현행화 내용"),
      analysisMemo: z.string().optional().describe("분석 메모"),
      detailSpec: z.string().optional().describe("상세 명세"),
      analysisStart: z.string().optional().describe("분석 시작일 (YYYY-MM-DD)"),
      analysisEnd: z.string().optional().describe("분석 종료일 (YYYY-MM-DD)"),
      analysisEffort: z.string().optional().describe("분석 공수"),
      progress: z.number().optional().describe("분석 진행률 (0~100)"),
    },
    async ({ projectId, requirementId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/requirements/${requirementId}`,
          { method: "PUT", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 4. 기획 — 사용자스토리 (User Story)
  //    displayId 자동채번: STR-NNNNN
  //    FK: requirementId (필수)
  //    계층: 과업 → 요구사항 → [사용자스토리]
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "list_user_stories",
    "사용자스토리 목록 조회 — 프로젝트의 사용자스토리 목록을 반환합니다 (요구사항별, 과업별 필터 가능)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      requirementId: z.string().optional().describe("요구사항 ID (필터 — 특정 요구사항의 스토리만)"),
      taskId: z.string().optional().describe("과업 ID (필터 — 해당 과업 소속 요구사항의 스토리만)"),
      keyword: z.string().optional().describe("검색어 (스토리명 또는 페르소나 부분 일치)"),
    },
    async ({ projectId, requirementId, taskId, keyword }) => {
      try {
        const qs = buildQs({ requirementId, taskId, keyword });
        const data = await specodeFetch(
          `/api/projects/${projectId}/user-stories${qs}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_user_story",
    "사용자스토리 상세 조회 — 스토리 정보, 인수기준, 상위 요구사항/과업 정보를 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      storyId: z.string().describe("사용자스토리 ID"),
    },
    async ({ projectId, storyId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/user-stories/${storyId}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "create_user_story",
    "사용자스토리 생성 — 새 사용자스토리를 등록합니다. displayId(STR-NNNNN)는 자동 채번됩니다. 선행: list_requirements 또는 get_planning_tree로 requirementId를 조회하세요",
    {
      projectId: z.string().describe("프로젝트 ID"),
      requirementId: z.string().describe("소속 요구사항 ID (필수)"),
      name: z.string().describe("스토리명 (필수)"),
      persona: z.string().optional().describe("페르소나 (예: '신규 가입자', '관리자')"),
      scenario: z.string().optional().describe("시나리오 설명"),
      acceptanceCriteria: z.array(z.object({
        given: z.string().optional().describe("Given (조건)"),
        when: z.string().optional().describe("When (행동)"),
        then: z.string().optional().describe("Then (결과)"),
      })).optional().describe("인수기준 목록 (Given/When/Then)"),
    },
    async ({ projectId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/user-stories`,
          { method: "POST", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "update_user_story",
    "사용자스토리 수정 — 기존 사용자스토리를 업데이트합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      storyId: z.string().describe("사용자스토리 ID"),
      requirementId: z.string().describe("소속 요구사항 ID (필수)"),
      name: z.string().describe("스토리명 (필수)"),
      persona: z.string().describe("페르소나 (필수)"),
      scenario: z.string().describe("시나리오 설명 (필수)"),
      acceptanceCriteria: z.array(z.object({
        given: z.string().optional().describe("Given (조건)"),
        when: z.string().optional().describe("When (행동)"),
        then: z.string().optional().describe("Then (결과)"),
      })).optional().describe(
        "인수기준 목록 (Given/When/Then). 주의: 이 파라미터를 생략하면 기존 인수기준이 전부 삭제됩니다 " +
        "— 유지하려면 get_user_story로 현재 값을 먼저 읽어서 그대로 다시 전달하세요"
      ),
    },
    async ({ projectId, storyId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/user-stories/${storyId}`,
          { method: "PUT", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 5. 기획 — 트리 (Planning Tree)
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "get_planning_tree",
    "기획 트리 조회 — 과업 > 요구사항 > 사용자스토리 계층 구조를 반환합니다. 전체 기획 데이터를 한눈에 파악할 때 사용하세요",
    { projectId: z.string().describe("프로젝트 ID") },
    async ({ projectId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/planning/tree`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 6. 설계 — 단위업무 (Unit Work)
  //    displayId 자동채번: UW-NNNNN
  //    FK: reqId (필수 — 상위 요구사항)
  //    계층: [단위업무] → 화면 → 영역 → 기능
  //    연결: 요구사항(reqId) ↔ 단위업무
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "list_unit_works",
    "단위업무 목록 조회 — 프로젝트의 단위업무 목록을 반환합니다 (요구사항별 필터 가능). 진척률, 화면 수, AI 구현 요청 상태 포함",
    {
      projectId: z.string().describe("프로젝트 ID"),
      reqId: z.string().optional().describe("요구사항 ID (필터 — 특정 요구사항의 단위업무만)"),
    },
    async ({ projectId, reqId }) => {
      try {
        const qs = buildQs({ reqId });
        const data = await specodeFetch(
          `/api/projects/${projectId}/unit-works${qs}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_unit_work",
    "단위업무 상세 조회 — 단위업무 정보, 설명, 하위 화면 목록을 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      unitWorkId: z.string().describe("단위업무 ID"),
    },
    async ({ projectId, unitWorkId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/unit-works/${unitWorkId}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "create_unit_work",
    "단위업무 생성 — 새 단위업무를 등록합니다. displayId(UW-NNNNN)는 자동 채번됩니다. 선행: list_requirements로 reqId를 조회하세요 (상위 요구사항 필수)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      reqId: z.string().describe("상위 요구사항 ID (필수). list_requirements에서 조회 가능"),
      name: z.string().describe("단위업무명 (필수)"),
      description: z.string().optional().describe("단위업무 설명 (마크다운 지원)"),
      assignMemberId: z.string().optional().describe("담당자 회원 ID"),
      startDate: z.string().optional().describe("시작일 (YYYY-MM-DD)"),
      endDate: z.string().optional().describe("종료일 (YYYY-MM-DD)"),
    },
    async ({ projectId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/unit-works`,
          { method: "POST", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "update_unit_work",
    "단위업무 수정 — 기존 단위업무 정보를 업데이트합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      unitWorkId: z.string().describe("단위업무 ID"),
      name: z.string().describe("단위업무명 (필수)"),
      description: z.string().optional().describe("단위업무 설명 (마크다운 지원)"),
      comment: z.string().optional().describe("코멘트"),
      assignMemberId: z.string().optional().describe("담당자 회원 ID"),
      planStartDate: z.string().optional().describe("계획설계 시작일 (YYYY-MM-DD) — PM이 잡는 상위 마일스톤"),
      planEndDate: z.string().optional().describe("계획설계 종료일 (YYYY-MM-DD)"),
      planEffort: z.string().optional().describe("계획설계 공수"),
      docStatus: z.string().optional().describe("단위업무 설계서 작성 상태 (BEFORE/DOING/DONE)"),
      sortOrder: z.number().optional().describe("정렬 순서"),
    },
    // 실적 진행률(progress)은 2026-07-28부터 하위 화면·기능 롤업 자동계산값이라 여기서 설정 불가
    async ({ projectId, unitWorkId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/unit-works/${unitWorkId}`,
          { method: "PUT", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 7. 설계 — 화면 (Screen)
  //    displayId 자동채번: SCR-NNNNN
  //    FK: unitWorkId (선택 — 소속 단위업무)
  //    계층: 단위업무 → [화면] → 영역 → 기능
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "list_screens",
    "화면 목록 조회 — 프로젝트 내 화면 목록을 반환합니다 (단위업무별 필터 가능)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      unitWorkId: z.string().optional().describe("단위업무 ID (필터)"),
    },
    async ({ projectId, unitWorkId }) => {
      try {
        const qs = buildQs({ unitWorkId });
        const data = await specodeFetch(
          `/api/projects/${projectId}/screens${qs}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_screen",
    "화면 상세 조회 — 화면 정보, 설명, 연결된 영역 목록을 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      screenId: z.string().describe("화면 ID"),
    },
    async ({ projectId, screenId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/screens/${screenId}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "create_screen",
    "화면 생성 — 새 화면을 등록합니다. 단위업무에 소속시키려면 unitWorkId를 전달하세요 (선행: list_unit_works로 조회)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      name: z.string().describe("화면명 (필수)"),
      unitWorkId: z.string().optional().describe("소속 단위업무 ID"),
      description: z.string().optional().describe("화면 설명 (마크다운 지원)"),
      displayCode: z.string().optional().describe("화면 표시 코드"),
      type: z.string().optional().describe("화면 유형. 허용값: LIST | DETAIL | GRID | TAB | FULL_SCREEN. 기본: LIST"),
      categoryL: z.string().optional().describe("대분류"),
      categoryM: z.string().optional().describe("중분류"),
      categoryS: z.string().optional().describe("소분류"),
    },
    async ({ projectId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/screens`,
          { method: "POST", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "update_screen",
    "화면 수정 — 기존 화면 정보를 업데이트합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      screenId: z.string().describe("화면 ID"),
      name: z.string().optional().describe("화면명"),
      description: z.string().optional().describe("화면 설명"),
      comment: z.string().optional().describe("코멘트"),
      displayCode: z.string().optional().describe("화면 표시 코드"),
      type: z.string().optional().describe("화면 유형. 허용값: LIST | DETAIL | GRID | TAB | FULL_SCREEN. 기본: LIST"),
      categoryL: z.string().optional().describe("대분류"),
      categoryM: z.string().optional().describe("중분류"),
      categoryS: z.string().optional().describe("소분류"),
      assignMemberId: z.string().optional().describe("담당자 회원 ID (list_members로 조회 가능)"),
      implBgngDe: z.string().optional().describe("실질구현 시작일 (YYYY-MM-DD) — 기능은 일정이 없고 화면 단위로 관리. 설계 일정은 화면에 없음(update_unit_work로 관리)"),
      implEndDe: z.string().optional().describe("실질구현 종료일 (YYYY-MM-DD)"),
      docStatus: z.string().optional().describe("화면정의서 작성 상태 (BEFORE/DOING/DONE)"),
    },
    async ({ projectId, screenId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/screens/${screenId}`,
          { method: "PUT", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 8. 설계 — 영역 (Area)
  //    FK: screenId (선택 — 소속 화면)
  //    계층: 단위업무 → 화면 → [영역] → 기능
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "list_areas",
    "영역 목록 조회 — 프로젝트 내 영역 목록을 반환합니다 (화면별 필터 가능)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      screenId: z.string().optional().describe("화면 ID (필터)"),
    },
    async ({ projectId, screenId }) => {
      try {
        const qs = buildQs({ screenId });
        const data = await specodeFetch(
          `/api/projects/${projectId}/areas${qs}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_area",
    "영역 상세 조회 — 영역 정보, 설명, 연결된 기능 목록을 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      areaId: z.string().describe("영역 ID"),
    },
    async ({ projectId, areaId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/areas/${areaId}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "create_area",
    "영역 생성 — 새 영역을 등록합니다. 화면에 소속시키려면 screenId를 전달하세요 (선행: list_screens로 조회)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      name: z.string().describe("영역명 (필수)"),
      screenId: z.string().optional().describe("소속 화면 ID"),
      type: z.string().optional().describe("영역 유형. 허용값: SEARCH | GRID | FORM | DETAIL | BUTTON | TAB | CHART | OTHER. 기본: LIST"),
      description: z.string().optional().describe("영역 설명"),
      sortOrder: z.number().optional().describe("정렬 순서"),
    },
    async ({ projectId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/areas`,
          { method: "POST", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "update_area",
    "영역 수정 — 기존 영역 정보를 업데이트합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      areaId: z.string().describe("영역 ID"),
      name: z.string().describe("영역명 (필수)"),
      screenId: z.string().optional().describe("소속 화면 ID"),
      type: z.string().optional().describe("영역 유형. 허용값: SEARCH | GRID | FORM | DETAIL | BUTTON | TAB | CHART | OTHER. 생략 시 기존 값 유지"),
      description: z.string().optional().describe("영역 설명"),
      commentCn: z.string().optional().describe("코멘트"),
      sortOrder: z.number().optional().describe("정렬 순서"),
      docStatus: z.string().optional().describe("영역 설계(와이어프레임) 작성 상태 (BEFORE/DOING/DONE)"),
    },
    async ({ projectId, areaId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/areas/${areaId}`,
          { method: "PUT", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 9. 설계 — 기능 (Function)
  //    FK: areaId (선택 — 소속 영역)
  //    계층: 단위업무 → 화면 → 영역 → [기능]
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "list_functions",
    "기능 목록 조회 — 프로젝트 내 기능 목록을 반환합니다 (영역별 필터 가능)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      areaId: z.string().optional().describe("영역 ID (필터)"),
    },
    async ({ projectId, areaId }) => {
      try {
        const qs = buildQs({ areaId });
        const data = await specodeFetch(
          `/api/projects/${projectId}/functions${qs}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_function",
    "기능 상세 조회 — 기능 정보, 입출력 항목, 비즈니스 규칙을 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      functionId: z.string().describe("기능 ID"),
    },
    async ({ projectId, functionId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/functions/${functionId}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "create_function",
    "기능 생성 — 새 기능을 등록합니다. 영역에 소속시키려면 areaId를 전달하세요 (선행: list_areas로 조회)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      name: z.string().describe("기능명 (필수)"),
      areaId: z.string().optional().describe("소속 영역 ID"),
      type: z.string().optional().describe("기능 유형. 허용값: SEARCH | SAVE | DELETE | DOWNLOAD | UPLOAD | NAVIGATE | VALIDATE | OTHER. 기본: OTHER"),
      description: z.string().optional().describe("기능 설명"),
      priority: z.string().optional().describe("우선순위. 허용값: HIGH | MEDIUM | LOW. 기본: MEDIUM"),
      complexity: z.string().optional().describe("복잡도. 허용값: HIGH | MEDIUM | LOW. 기본: MEDIUM"),
      effort: z.string().optional().describe("구현 공수"),
      assignMemberId: z.string().optional().describe("담당자 회원 ID"),
      sortOrder: z.number().optional().describe("정렬 순서"),
    },
    // 기능 자신은 구현 일정이 없음 — 구현 마감은 소속 화면(update_screen의 implStartDate/implEndDate)에서 관리(2026-07-28)
    async ({ projectId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/functions`,
          { method: "POST", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "update_function",
    "기능 수정 — 기존 기능 정보를 업데이트합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      functionId: z.string().describe("기능 ID"),
      name: z.string().optional().describe("기능명"),
      areaId: z.string().optional().describe("소속 영역 ID"),
      type: z.string().optional().describe("기능 유형. 허용값: SEARCH | SAVE | DELETE | DOWNLOAD | UPLOAD | NAVIGATE | VALIDATE | OTHER. 기본: OTHER"),
      description: z.string().optional().describe("기능 설명"),
      commentCn: z.string().optional().describe("코멘트"),
      priority: z.string().optional().describe("우선순위. 허용값: HIGH | MEDIUM | LOW. 기본: MEDIUM"),
      complexity: z.string().optional().describe("복잡도. 허용값: HIGH | MEDIUM | LOW. 기본: MEDIUM"),
      effort: z.string().optional().describe("구현 공수"),
      assignMemberId: z.string().optional().describe("담당자 회원 ID"),
      docStatus: z.string().optional().describe("기능정의서 작성 상태 (BEFORE/DOING/DONE)"),
      sortOrder: z.number().optional().describe("정렬 순서"),
    },
    // 기능 자신은 구현 일정이 없음 — 구현 마감은 소속 화면(update_screen)에서 관리(2026-07-28)
    async ({ projectId, functionId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/functions/${functionId}`,
          { method: "PUT", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 9-1. 설계 — 트리 (Design Tree, 배치 조회 전용)
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "get_design_tree",
    "설계 트리 배치 조회 — 지정한 단위업무들의 화면>영역>기능 계층을 한 번에 반환합니다. " +
      "여러 단위업무 사이의 설계 일관성을 점검할 때 사용하세요 (예: B와 C 단위업무가 서로 모순되지 않는지 확인). " +
      "unitWorkIds는 최대 20개까지만 허용됩니다 — 그 이상이거나 '프로젝트 전체'를 한 번에 조회하는 것은 " +
      "지원하지 않습니다(응답 payload와 컨텍스트 소진 방지). 20개보다 많은 단위업무를 점검하려면 " +
      "list_unit_works로 전체 ID 목록을 먼저 받은 뒤 20개씩 나눠서 여러 번 호출하세요.",
    {
      projectId: z.string().describe("프로젝트 ID"),
      unitWorkIds: z
        .array(z.string())
        .min(1, "unitWorkIds는 최소 1개 이상이어야 합니다")
        .max(20, "unitWorkIds는 최대 20개까지만 지정할 수 있습니다. 여러 배치로 나눠서 호출하세요")
        .describe("점검할 단위업무 ID 배열 (1~20개, 필수). list_unit_works로 조회한 unitWorkId를 사용하세요"),
    },
    async ({ projectId, unitWorkIds }) => {
      try {
        const qs = buildQs({ unitWorkIds: unitWorkIds.join(",") });
        const data = await specodeFetch(
          `/api/projects/${projectId}/design/tree${qs}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 10. DB 테이블
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "list_db_tables",
    "DB 테이블 목록 조회 — 프로젝트에 등록된 데이터베이스 테이블 목록을 반환합니다. " +
      "매핑 인사이트 필드 포함: functionCount(이 테이블을 쓰는 기능 수), " +
      "usedColCount(매핑된 컬럼 수), ioProfile(READ_HEAVY|WRITE_HEAVY|MIXED|NONE), " +
      "lastUsedDt(가장 최근 매핑 저장 시각, ISO)",
    {
      projectId: z.string().describe("프로젝트 ID"),
    },
    async ({ projectId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/db-tables`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_db_table",
    "DB 테이블 상세 조회 — 테이블 스키마와 컬럼 정보를 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      tableId: z.string().describe("테이블 ID"),
    },
    async ({ projectId, tableId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/db-tables/${tableId}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_db_table_usage",
    "DB 테이블 사용 현황 조회 — 이 테이블을 참조하는 기능/영역/화면 목록과 " +
      "컬럼별 사용 통계, IO 분포, 마지막 매핑 시각을 반환합니다. " +
      "매핑 인사이트 드릴다운에 사용",
    {
      projectId: z.string().describe("프로젝트 ID"),
      tableId:   z.string().describe("테이블 ID"),
    },
    async ({ projectId, tableId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/db-tables/${tableId}/usage`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_db_column_usage",
    "DB 컬럼 사용처 드릴다운 — 단일 컬럼이 어떤 기능/영역/화면에서 " +
      "INPUT/OUTPUT/INOUT 으로 쓰이는지 매핑 목록을 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      tableId:   z.string().describe("테이블 ID"),
      colId:     z.string().describe("컬럼 ID"),
    },
    async ({ projectId, tableId, colId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/db-tables/${tableId}/columns/${colId}/usage`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 11. 구현 변경 스펙 정합성 (Spec Reconciliation)
  // ═══════════════════════════════════════════════════════════════
  // 제출·조회·FIX_SOURCE 보완 확인은 MCP로 제공한다. APPLY_SPEC은 소스 사실과
  // Diff를 사람이 확인하고 웹에서 승인해야 하므로 자동 호출 경로를 만들지 않는다.

  server.tool(
    "get_source_baselines",
    "프로젝트·저장소·브랜치별 마지막 정합성 확정 source checkpoint 조회. " +
      "후속 변경은 반드시 이 응답의 checkpoint를 base로 사용하세요.",
    {
      projectId: z.string().describe("프로젝트 ID"),
    },
    async ({ projectId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/source-baselines`,
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "get_reconciliation_context",
    "변경 경로 또는 UW를 기준으로 4계층 설계 원문/hash와 확정된 스펙-소스 연결 후보 조회. " +
      "proposal의 beforeValue/beforeHash는 이 응답을 그대로 사용하세요.",
    {
      projectId: z.string().describe("프로젝트 ID"),
      unitWork: z.string().optional().describe("선택적 단위업무 UUID 또는 UW 표시 ID"),
      changedPaths: z.array(z.string()).max(200).optional().describe("변경된 저장소 상대 경로"),
      includeProjectIndex: z.boolean().optional().describe("연결 후보가 없을 때 전체 설계 인덱스 포함"),
    },
    async ({ projectId, unitWork, changedPaths, includeProjectIndex }) => {
      try {
        const qs = new URLSearchParams();
        if (unitWork) qs.set("unitWork", unitWork);
        if (includeProjectIndex) qs.set("includeProjectIndex", "true");
        for (const path of changedPaths ?? []) qs.append("path", path);
        const data = await specodeFetch(
          `/api/projects/${projectId}/spec-reconciliation-context?${qs}`,
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "submit_implementation_receipt",
    "최초 IMPLEMENT 작업의 실제 소스 증거와 요청 당시 스펙 편차를 스펙 반영함에 제출. " +
      "스펙을 직접 수정하지 않으며 웹 승인을 기다리는 receipt를 만듭니다.",
    {
      projectId: z.string().describe("프로젝트 ID"),
      aiTaskId: z.string().describe("원 IMPLEMENT AI 태스크 ID"),
      receipt: receiptSubmissionSchema,
    },
    async ({ projectId, aiTaskId, receipt }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/impl-receipts`,
          {
            method: "POST",
            body: JSON.stringify({
              originType: "IMPLEMENTATION",
              aiTaskId,
              receipt,
            }),
          },
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "submit_maintenance_change",
    "구현 완료 후 직접 수정된 source를 마지막 source baseline과 비교한 Type B receipt로 제출. " +
      "미커밋이면 headStable=false로 DRAFT 분석만 저장하세요.",
    {
      projectId: z.string().describe("프로젝트 ID"),
      receipt: receiptSubmissionSchema,
    },
    async ({ projectId, receipt }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/impl-receipts`,
          {
            method: "POST",
            body: JSON.stringify({
              originType: "MAINTENANCE",
              receipt,
            }),
          },
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "list_spec_reconciliations",
    "스펙 반영함 목록 조회 — 구현 결과와 스펙이 달라 사람이 검토해야 하는 접수, " +
      "확정 완료, source baseline 충돌 건을 반환합니다.",
    {
      projectId: z.string().describe("프로젝트 ID"),
      status: z
        .enum([
          "DRAFT",
          "NEEDS_REVIEW",
          "CLOSED",
          "STALE_BASELINE",
        ])
        .optional()
        .describe("접수 상태 필터"),
      limit: z.number().int().min(1).max(200).optional().describe("최대 건수"),
    },
    async ({ projectId, status, limit }) => {
      try {
        const qs = buildQs({ status, limit });
        const data = await specodeFetch(
          `/api/projects/${projectId}/spec-reconciliations${qs}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "submit_provider_verified_change",
    "연결된 GitHub/GitLab에서 base/head와 실제 Diff를 SPECODE 서버가 직접 조회한 뒤 " +
      "PROVIDER_VERIFIED 후속 변경으로 제출합니다. provider 연결과 기존 baseline이 필요합니다.",
    {
      projectId: z.string().describe("프로젝트 ID"),
      receipt: providerReceiptSubmissionSchema,
    },
    async ({ projectId, receipt }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/impl-receipts/provider`,
          {
            method: "POST",
            body: JSON.stringify({ receipt }),
          },
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "queue_reconciliation_analysis",
    "저장된 source evidence를 SPECODE 서버 AI 큐에서 다시 분석합니다. " +
      "단위업무, 변경 경로 또는 전체 인덱스 중 분석 범위를 반드시 지정하세요.",
    {
      projectId: z.string().describe("프로젝트 ID"),
      receiptId: z.string().describe("구현 변경 접수 ID"),
      unitWorkRef: z
        .string()
        .optional()
        .describe("단위업무 UUID 또는 UW 표시 ID"),
      changedPaths: z
        .array(z.string())
        .max(5_000)
        .optional()
        .describe("변경된 저장소 상대 경로"),
      includeProjectIndex: z
        .boolean()
        .optional()
        .describe("연결 후보가 없을 때 프로젝트 전체 설계 인덱스 포함"),
      instruction: z
        .string()
        .max(4000)
        .optional()
        .describe("분석 시 추가로 확인할 내용"),
      replaceExisting: z
        .boolean()
        .optional()
        .describe("사람 결정 전 기존 배치를 이전 분석으로 보존하고 새 실행을 계획"),
    },
    async ({
      projectId,
      receiptId,
      unitWorkRef,
      changedPaths,
      includeProjectIndex,
      instruction,
      replaceExisting,
    }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/impl-receipts/${receiptId}/analyze`,
          {
            method: "POST",
            body: JSON.stringify({
              unitWorkRef,
              changedPaths: changedPaths ?? [],
              includeProjectIndex: includeProjectIndex ?? false,
              instruction,
              replaceExisting: replaceExisting ?? false,
            }),
          },
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "retry_reconciliation_batch",
    "실패한 자동 비교 배치 하나만 새 AI 작업으로 재등록합니다. 완료 배치와 receipt 전체는 다시 실행하지 않습니다.",
    {
      projectId: z.string().describe("프로젝트 ID"),
      receiptId: z.string().describe("구현 변경 접수 ID"),
      batchId: z.string().describe("FAILED 상태의 비교 배치 ID"),
    },
    async ({ projectId, receiptId, batchId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/spec-reconciliations/${receiptId}` +
            `/batches/${batchId}/retry`,
          { method: "POST" },
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "confirm_reconciliation_resolution",
    "FIX_SOURCE 결정 후 수정된 commit/manifest 증거를 같은 항목에 제출해 재검증과 " +
      "baseline 전진을 요청합니다. USER_UPLOADED 증거는 웹 관리자 override가 추가로 필요합니다.",
    {
      projectId: z.string().describe("프로젝트 ID"),
      receiptId: z.string().describe("스펙 변경 접수 ID"),
      itemId: z.string().describe("FIX_SOURCE 항목 ID"),
      checkpointType: z.enum(["GIT_COMMIT", "SOURCE_MANIFEST"]),
      headCheckpoint: z.string(),
      evidenceTrust: z.enum(["LOCAL_AGENT_ATTESTED", "USER_UPLOADED"]),
      ancestryVerified: z.boolean().nullable().optional(),
      diffHash: z.string().optional(),
      evidence: z.record(z.string(), z.unknown()),
      sourceFact: z.string(),
      reason: z.string(),
    },
    async ({
      projectId,
      receiptId,
      itemId,
      checkpointType,
      headCheckpoint,
      evidenceTrust,
      ancestryVerified,
      diffHash,
      evidence,
      sourceFact,
      reason,
    }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/spec-reconciliations/${receiptId}` +
            `/items/${itemId}/confirm-resolution`,
          {
            method: "POST",
            body: JSON.stringify({
              checkpointType,
              headCheckpoint,
              evidenceTrust,
              ancestryVerified,
              diffHash,
              evidence,
              sourceFact,
              reason,
            }),
          },
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "get_spec_reconciliation",
    "스펙 변경 접수 상세 조회 — 확인된 소스 사실, AI 영향 추론, 기능 설명 before/after, " +
      "위험도와 현재 결정 상태를 반환합니다. 실제 적용 승인은 웹 스펙 반영함에서 수행하세요.",
    {
      projectId: z.string().describe("프로젝트 ID"),
      receiptId: z.string().describe("스펙 변경 접수 ID"),
    },
    async ({ projectId, receiptId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/spec-reconciliations/${receiptId}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "check_reconciliation_gate",
    "CI·merge·배포 전에 source baseline과 미해결 스펙 정합성 receipt를 확인합니다. " +
      "기본 정책은 WARN이며 allowed=false와 reasons를 CI 정책에서 사용할 수 있습니다.",
    {
      projectId: z.string().describe("프로젝트 ID"),
      repoKey: z.string().describe("저장소 고정 식별자"),
      branch: z.string().describe("브랜치명"),
      head: z
        .string()
        .optional()
        .describe("현재 배포 또는 merge 대상 checkpoint"),
    },
    async ({ projectId, repoKey, branch, head }) => {
      try {
        const qs = buildQs({ repoKey, branch, head });
        const data = await specodeFetch(
          `/api/projects/${projectId}/spec-reconciliations/gate${qs}`,
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════
  // 12. 워커 커맨드 배포 (Worker Command Distribution)
  // ═══════════════════════════════════════════════════════════════
  // SPECODE를 이용하는 고객사도 /run-ai-tasks 로컬 커맨드가 있어야 AI 태스크를
  // 처리할 수 있다. 매번 파일을 복사해 안내하는 대신, MCP로 원본 파일 내용을
  // 그대로 내려줘서 고객 Claude Code가 스스로 로컬에 설치하게 한다.
  // DB 접근 없이 정적 파일만 읽으므로 project 무관 — specodeFetch(프로젝트 스코프)
  // 대신 fs로 직접 읽는다 (getWorkerCommandFiles 내부에서 처리).

  server.tool(
    "get_worker_command_files",
    "/run-ai-tasks 슬래시커맨드 설치 파일 제공 — 고객 로컬 저장소에 " +
      "AI 태스크 워커 커맨드를 설치할 때 사용합니다. 반환된 files 배열의 " +
      "각 항목을 path 그대로 로컬 프로젝트에 저장하세요. setupGuide에 " +
      "이어서 해야 할 .env.local 설정과 사용법이 안내되어 있습니다.",
    {},
    async () => {
      try {
        const files = getWorkerCommandFiles();
        return textResult({ files, setupGuide: WORKER_COMMAND_SETUP_GUIDE });
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}
