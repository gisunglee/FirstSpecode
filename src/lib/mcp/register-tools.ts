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
 *   [DB]           list_db_tables, get_db_table, create_db_table, update_db_table, get_db_table_usage, get_db_column_usage
 *   [스펙 동기화]   UW 실행 시작·구조화 결과 제출·실행/항목 조회 (적용은 웹 전용)
 *   [AS-IS 온보딩] create_asis_question, list_asis_questions(조건 필수), answer_asis_question
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
import { syncResultSubmissionSchema } from "@/lib/spec-sync/contracts";

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
      "update_* 도구의 assignMemberId(담당자 지정)에 쓸 멤버 ID를 찾을 때 사용하세요. 생성 시 담당자 지정은 OWNER/ADMIN 또는 PM/PL만 가능합니다. " +
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
      category: z.string().describe("카테고리 (필수). 허용값: NEW_DEV(신규개발) | IMPROVE(기능개선)"),
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
    "과업 수정 — OWNER/ADMIN·PM/PL, 담당자, 또는 생성 후 30분 이내 생성자만 가능합니다. 권한이 없으면 구체적인 사유를 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      taskId: z.string().describe("과업 ID"),
      name: z.string().describe("과업명 (필수)"),
      category: z.string().describe("카테고리 (필수). 허용값: NEW_DEV | IMPROVE"),
      definition: z.string().optional().describe("과업 정의"),
      content: z.string().optional().describe("상세 내용"),
      outputInfo: z.string().optional().describe("산출물 정보"),
      rfpPage: z.string().optional().describe("RFP 페이지 번호"),
      assignMemberId: z.string().optional().describe("담당자 회원 ID (OWNER/ADMIN 또는 PM/PL만 변경 가능, list_members로 조회)"),
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
    "요구사항 수정 — OWNER/ADMIN·PM/PL, 가장 가까운 담당자, 또는 생성 후 30분 이내 생성자만 가능합니다. 권한이 없으면 구체적인 사유를 반환합니다",
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
    "사용자스토리 수정 — OWNER/ADMIN·PM/PL, 상위 요구사항/과업의 가장 가까운 담당자, 또는 생성 후 30분 이내 생성자만 가능합니다. 권한이 없으면 구체적인 사유를 반환합니다",
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
    "단위업무 생성 — 새 단위업무를 등록합니다. displayId(UW-NNNNN)는 자동 채번됩니다. 선행: list_requirements로 reqId를 조회하세요 (상위 요구사항 필수). 담당자·일정 지정은 OWNER/ADMIN 또는 PM/PL만 가능합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      reqId: z.string().describe("상위 요구사항 ID (필수). list_requirements에서 조회 가능"),
      name: z.string().describe("단위업무명 (필수)"),
      description: z.string().optional().describe("단위업무 설명 (마크다운 지원)"),
      assignMemberId: z.string().optional().describe("담당자 회원 ID (생성 시 OWNER/ADMIN 또는 PM/PL만 지정 가능)"),
      startDate: z.string().optional().describe("시작일 (YYYY-MM-DD, 생성 시 OWNER/ADMIN 또는 PM/PL만 지정 가능)"),
      endDate: z.string().optional().describe("종료일 (YYYY-MM-DD, 생성 시 OWNER/ADMIN 또는 PM/PL만 지정 가능)"),
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
    "단위업무 수정 — OWNER/ADMIN·PM/PL, 자신 또는 상위 요구사항/과업의 가장 가까운 담당자, 또는 생성 후 30분 이내 생성자만 가능합니다. 권한이 없으면 구체적인 사유를 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      unitWorkId: z.string().describe("단위업무 ID"),
      name: z.string().describe("단위업무명 (필수)"),
      displayId: z.string().optional().describe("단위업무 표시 ID (OWNER/ADMIN 또는 PM/PL만 변경 가능)"),
      description: z.string().optional().describe("단위업무 설명 (마크다운 지원)"),
      comment: z.string().optional().describe("코멘트"),
      assignMemberId: z.string().optional().describe("담당자 회원 ID (OWNER/ADMIN 또는 PM/PL만 변경 가능)"),
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
      displayId: z.string().optional().describe("화면 표시 ID (생성 시 OWNER/ADMIN 또는 PM/PL만 지정 가능; 생략 시 자동 채번)"),
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
    "화면 수정 — OWNER/ADMIN·PM/PL, 자신 또는 상위 단위업무/요구사항/과업의 가장 가까운 담당자, 또는 생성 후 30분 이내 생성자만 가능합니다. 권한이 없으면 구체적인 사유를 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      screenId: z.string().describe("화면 ID"),
      name: z.string().optional().describe("화면명"),
      description: z.string().optional().describe("화면 설명"),
      comment: z.string().optional().describe("코멘트"),
      displayId: z.string().optional().describe("화면 표시 ID (OWNER/ADMIN 또는 PM/PL만 변경 가능)"),
      type: z.string().optional().describe("화면 유형. 허용값: LIST | DETAIL | GRID | TAB | FULL_SCREEN. 기본: LIST"),
      categoryL: z.string().optional().describe("대분류"),
      categoryM: z.string().optional().describe("중분류"),
      categoryS: z.string().optional().describe("소분류"),
      assignMemberId: z.string().optional().describe("담당자 회원 ID (OWNER/ADMIN 또는 PM/PL만 변경 가능, list_members로 조회)"),
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
    "영역 생성 — 새 영역을 등록합니다. 화면에 소속시키려면 screenId를 전달하세요 (선행: list_screens로 조회). 정렬 순서 지정은 OWNER/ADMIN 또는 PM/PL만 가능합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      name: z.string().describe("영역명 (필수)"),
      screenId: z.string().optional().describe("소속 화면 ID"),
      type: z.string().optional().describe("영역 유형. 허용값: SEARCH | GRID | FORM | DETAIL | BUTTON | TAB | CHART | OTHER. 기본: LIST"),
      description: z.string().optional().describe("영역 설명"),
      sortOrder: z.number().optional().describe("정렬 순서 (생성 시 OWNER/ADMIN 또는 PM/PL만 지정 가능)"),
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
    "영역 수정 — OWNER/ADMIN·PM/PL, 상위 화면/단위업무/요구사항/과업의 가장 가까운 담당자, 또는 생성 후 30분 이내 생성자만 가능합니다. 권한이 없으면 구체적인 사유를 반환합니다",
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
    "기능 생성 — 새 기능을 등록합니다. 영역에 소속시키려면 areaId를 전달하세요 (선행: list_areas로 조회). 복잡도·공수·담당자·정렬 지정은 OWNER/ADMIN 또는 PM/PL만 가능합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      name: z.string().describe("기능명 (필수)"),
      areaId: z.string().optional().describe("소속 영역 ID"),
      type: z.string().optional().describe("기능 유형. 허용값: SEARCH | SAVE | DELETE | DOWNLOAD | UPLOAD | NAVIGATE | VALIDATE | OTHER. 기본: OTHER"),
      description: z.string().optional().describe("기능 설명"),
      priority: z.string().optional().describe("우선순위. 허용값: HIGH | MEDIUM | LOW. 기본: MEDIUM"),
      complexity: z.string().optional().describe("복잡도. 허용값: HIGH | MEDIUM | LOW (생성 시 OWNER/ADMIN 또는 PM/PL만 지정 가능; 생략 시 MEDIUM)"),
      effort: z.string().optional().describe("구현 공수 (생성 시 OWNER/ADMIN 또는 PM/PL만 지정 가능)"),
      assignMemberId: z.string().optional().describe("담당자 회원 ID (생성 시 OWNER/ADMIN 또는 PM/PL만 지정 가능)"),
      sortOrder: z.number().optional().describe("정렬 순서 (생성 시 OWNER/ADMIN 또는 PM/PL만 지정 가능)"),
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
    "기능 수정 — OWNER/ADMIN·PM/PL, 자신 또는 상위 화면/단위업무/요구사항/과업의 가장 가까운 담당자, 또는 생성 후 30분 이내 생성자만 가능합니다. 권한이 없으면 구체적인 사유를 반환합니다",
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
      assignMemberId: z.string().optional().describe("담당자 회원 ID (OWNER/ADMIN 또는 PM/PL만 변경 가능)"),
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
    "create_db_table",
    "DB 테이블 생성 — 물리 테이블명만 필수입니다. 컬럼은 이 도구로 만들 수 없고, " +
      "생성 후 update_db_table로 별도 설정해야 합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      tblPhysclNm: z.string().describe("물리 테이블명 (필수)"),
      tblLgclNm: z.string().optional().describe("논리 테이블명"),
      tblDc: z.string().optional().describe("테이블 설명"),
      assignMemberId: z.string().optional().describe("담당자 회원 ID"),
    },
    async ({ projectId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/db-tables`,
          { method: "POST", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "update_db_table",
    "DB 테이블 정보와 컬럼을 갱신합니다. columns는 부분 추가가 아니라 전체 교체입니다 " +
      "— 이 목록에 없는 기존 컬럼은 삭제됩니다. 컬럼을 추가할 때도 반드시 기존 컬럼 " +
      "전체를 함께 전달하세요 (먼저 get_db_table로 현재 컬럼 목록을 조회한 뒤, 거기에 " +
      "새 컬럼을 더해서 호출하는 방식을 권장합니다)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      tableId: z.string().describe("테이블 ID"),
      tblPhysclNm: z.string().describe("물리 테이블명 (필수 — 기존 값 그대로라도 전달)"),
      tblLgclNm: z.string().optional().describe("논리 테이블명"),
      tblDc: z.string().optional().describe("테이블 설명"),
      assignMemberId: z.string().optional().describe("담당자 회원 ID"),
      columns: z
        .array(
          z.object({
            colId: z.string().optional().describe("기존 컬럼 수정 시 지정, 신규 컬럼은 생략"),
            colPhysclNm: z.string().describe("물리 컬럼명 (필수)"),
            colLgclNm: z.string().optional().describe("논리 컬럼명"),
            dataTyNm: z.string().optional().describe("데이터 타입"),
            colDc: z.string().optional().describe("컬럼 설명"),
          })
        )
        .optional()
        .describe("전체 컬럼 목록 (부분 아님 — 전체 교체). 생략하면 기존 컬럼 전체 삭제됨에 주의"),
    },
    async ({ projectId, tableId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/db-tables/${tableId}`,
          { method: "PUT", body: JSON.stringify(body) }
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
  // 11. 구현-설계 동기화 V2 (Spec Sync)
  // ═══════════════════════════════════════════════════════════════
  // 실행과 분석 결과 제출·조회만 제공한다. 실제 설계 반영은 근거를 본 사람이
  // 웹 화면에서 승인해야 하므로 MCP에 decision/apply 도구를 등록하지 않는다.

  server.tool(
    "start_spec_sync",
    "지정 UW의 현재 설계 snapshot을 만들고 구현-설계 비교 실행을 시작합니다. " +
      "기본 CHECK는 설계 구현 여부와 중요한 설계 누락 후보만 확인합니다.",
    {
      projectId: z.string().describe("프로젝트 ID"),
      unitWorkRef: z.string().describe("단위업무 UUID 또는 UW-XXXXX 표시 ID"),
      mode: z.enum(["CHECK", "DEEP_SYNC"]).optional().describe("기본 CHECK"),
      clientSubmissionKey: z
        .string()
        .max(100)
        .optional()
        .describe("재시도 중 중복 실행 방지용 클라이언트 키"),
    },
    async ({ projectId, unitWorkRef, mode, clientSubmissionKey }) => {
      try {
        const data = await specodeFetch(`/api/projects/${projectId}/spec-syncs`, {
          method: "POST",
          body: JSON.stringify({
            unitWorkRef,
            mode: mode ?? "CHECK",
            clientSubmissionKey,
          }),
        });
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "submit_spec_sync_result",
    "로컬 저장소에서 탐색·검증한 구조화 결과를 저장합니다. " +
      "설계는 수정하지 않고 웹 검토 대기 항목만 만듭니다.",
    {
      projectId: z.string().describe("프로젝트 ID"),
      runId: z.string().describe("start_spec_sync에서 받은 실행 ID"),
      result: syncResultSubmissionSchema,
    },
    async ({ projectId, runId, result }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/spec-syncs/${runId}/result`,
          { method: "POST", body: JSON.stringify(result) },
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "list_spec_syncs",
    "구현-설계 동기화 실행 목록과 검토 대기 수를 조회합니다.",
    {
      projectId: z.string().describe("프로젝트 ID"),
      status: z
        .enum([
          "RUNNING",
          "NEEDS_INPUT",
          "NEEDS_REVIEW",
          "COMPLETED",
          "FAILED",
          "CANCELLED",
        ])
        .optional(),
      unitWork: z.string().optional().describe("단위업무 UUID 또는 UW 표시 ID"),
      limit: z.number().int().min(1).max(200).optional(),
    },
    async ({ projectId, status, unitWork, limit }) => {
      try {
        const qs = buildQs({ status, unitWork, limit });
        const data = await specodeFetch(`/api/projects/${projectId}/spec-syncs${qs}`);
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "get_spec_sync",
    "동기화 실행의 구현 판정, 설계 누락 후보, 코드 근거와 사람 결정 상태를 조회합니다.",
    {
      projectId: z.string().describe("프로젝트 ID"),
      runId: z.string().describe("동기화 실행 ID"),
    },
    async ({ projectId, runId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/spec-syncs/${runId}`,
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════
  // 12. AS-IS 온보딩 — 미해결 질문 (AS-IS Question Tracking)
  // ═══════════════════════════════════════════════════════════════
  // 2차 사업(기존 시스템 위 증축) 프로젝트를 온보딩할 때, 소스 분석이나 대화로
  // 확인 못한 사실을 추적하는 용도. tb_ds_review_request(동료 피어리뷰)와는
  // 별개 — 만족도 평가가 없는 대신 purpose_code로 용도를 태깅해서, 여러 세션이
  // 같은 저장소를 공유해도 서로 다른 목적의 질문끼리 섞이지 않게 한다.

  server.tool(
    "create_asis_question",
    "AS-IS 온보딩 중 소스나 대화로 확인하지 못한 사실을 질문으로 남깁니다. " +
      "이 도구는 온보딩/AS-IS 분석 목적 전용입니다 — 일반적인 작업 메모나 " +
      "TODO 용도로 사용하지 마세요. purposeCode는 온보딩 세션 내내 일관된 " +
      "값을 지정하세요 (예: ASIS_ONBOARDING). 대상 엔티티(refTblNm/refId)의 " +
      "description에도 별도로 '미확인' 표시를 남기는 걸 권장합니다.",
    {
      projectId: z.string().describe("프로젝트 ID"),
      purposeCode: z.string().describe("용도 태그 (필수) — 예: ASIS_ONBOARDING"),
      batchId: z.string().optional().describe("온보딩 회차 식별자, 예: '2026-08-17 1차 온보딩 1회차'"),
      refTblNm: z.string().describe("대상 엔티티 테이블명 (필수), 예: tb_ds_screen"),
      refId: z.string().describe("대상 엔티티 ID (필수)"),
      questionCn: z.string().describe("질문 내용"),
      revwrMemberId: z.string().optional().describe("답변 예정 회원 ID (list_members로 조회)"),
    },
    async ({ projectId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/asis-questions`,
          { method: "POST", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "list_asis_questions",
    "AS-IS 미해결 질문을 조회합니다. purposeCode, batchId, refTblNm+refId 중 " +
      "최소 하나는 반드시 지정해야 합니다 — 조건 없이 전체를 조회할 수 없습니다 " +
      "(여러 세션/용도가 이 저장소를 공유하므로 무분별한 전체 조회를 막습니다).",
    {
      projectId: z.string().describe("프로젝트 ID"),
      purposeCode: z.string().optional().describe("용도 태그로 필터"),
      batchId: z.string().optional().describe("온보딩 회차로 필터"),
      refTblNm: z.string().optional().describe("대상 엔티티 테이블명 (refId와 함께 지정)"),
      refId: z.string().optional().describe("대상 엔티티 ID (refTblNm과 함께 지정)"),
      statusCode: z.string().optional().describe("OPEN | ANSWERED | CLOSED"),
    },
    async ({ projectId, ...query }) => {
      try {
        const params = new URLSearchParams(
          Object.entries(query).filter(([, v]) => v !== undefined) as [string, string][]
        );
        const data = await specodeFetch(
          `/api/projects/${projectId}/asis-questions?${params.toString()}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "answer_asis_question",
    "AS-IS 미해결 질문에 답변을 등록합니다. 상태가 ANSWERED로 바뀝니다. " +
      "답변을 실제 스펙(화면/기능 등의 description)에 반영하는 건 이 도구의 " +
      "역할이 아닙니다 — update_screen 등으로 별도로 반영하세요.",
    {
      projectId: z.string().describe("프로젝트 ID"),
      questionId: z.string().describe("질문 ID"),
      answerCn: z.string().describe("답변 내용"),
    },
    async ({ projectId, questionId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/asis-questions/${questionId}`,
          { method: "PATCH", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 13. 워커 커맨드 배포 (Worker Command Distribution)
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
