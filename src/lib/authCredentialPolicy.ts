export type CredentialType = "SESSION" | "MCP_CLIENT";

const MCP_PROTOCOL_PATH = /^\/api\/mcp\/?$/;
const PROJECT_LIST_PATH = /^\/api\/projects\/?$/;

const MCP_PROTOCOL_METHODS = new Set(["GET", "POST", "DELETE"]);
const PROJECT_SCOPED_METHODS = new Set(["GET", "POST", "PUT", "PATCH"]);

/**
 * MCP CLIENT 키는 MCP 프로토콜과 자신에게 고정된 프로젝트 API만 호출할 수 있다.
 * 계정·관리자 API 및 프로젝트 삭제는 브라우저 세션 자격 증명으로만 허용한다.
 */
export function isMcpClientRequestAllowed(
  method: string,
  pathname: string,
  allowedProjectId: string,
): boolean {
  const normalizedMethod = method.toUpperCase();

  if (MCP_PROTOCOL_PATH.test(pathname)) {
    return MCP_PROTOCOL_METHODS.has(normalizedMethod);
  }

  if (PROJECT_LIST_PATH.test(pathname)) {
    return normalizedMethod === "GET";
  }

  const encodedProjectId = encodeURIComponent(allowedProjectId);
  const projectPath = `/api/projects/${encodedProjectId}`;
  const isAllowedProjectPath =
    pathname === projectPath || pathname.startsWith(`${projectPath}/`);

  return isAllowedProjectPath && PROJECT_SCOPED_METHODS.has(normalizedMethod);
}
