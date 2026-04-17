/**
 * register-tools.ts — MCP 도구 등록
 *
 * 역할:
 *   - McpServer 인스턴스에 SPECODE 도구들을 등록
 *
 * 도구 카테고리 (38개):
 *   [프로젝트]     list_projects, get_project
 *   [기획-과업]    list_tasks, get_task, create_task, update_task, delete_task
 *   [기획-요구사항] list_requirements, get_requirement, create_requirement, update_requirement, delete_requirement
 *   [기획-스토리]  list_user_stories, get_user_story, create_user_story, update_user_story, delete_user_story
 *   [기획-트리]    get_planning_tree
 *   [설계-단위업무] list_unit_works, get_unit_work, create_unit_work, update_unit_work, delete_unit_work
 *   [설계-화면]    list_screens, get_screen, create_screen, update_screen, delete_screen
 *   [설계-영역]    list_areas, get_area, create_area, update_area, delete_area
 *   [설계-기능]    list_functions, get_function, create_function, update_function, delete_function
 *   [DB]           list_db_tables, get_db_table
 *
 * 계층 관계:
 *   기획: 과업(Task) → 요구사항(Requirement) → 사용자스토리(UserStory)
 *   설계: 단위업무(UnitWork) → 화면(Screen) → 영역(Area) → 기능(Function)
 *   연결: 요구사항 ↔ 단위업무 (reqId로 연결)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerTools(server: McpServer): void;
