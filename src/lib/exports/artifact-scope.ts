/**
 * exports/artifact-scope.ts — 산출물 출력 범위 조회 (서버 공용)
 *
 * 역할:
 *   - 프로젝트 설정(tb_pj_project_settings.artifact_scope_code)에 저장된
 *     산출물 출력 범위를 읽어 온다.
 *
 * 왜 별도 파일인가:
 *   엑셀·docx 산출물 핸들러 여러 곳에서 같은 값을 읽는다. 각자 prisma 를
 *   호출하면 "어떤 산출물은 설정을 반영하고 어떤 산출물은 안 하는" 상태가
 *   생기기 쉬워서, 조회 지점을 하나로 묶어 둔다.
 *
 * 주의:
 *   웹 목록 API 는 이 함수를 쓰면 안 된다. 작업 화면에서는 이전 사업분도
 *   보여야 한다 — 필터는 산출물 출력에만 적용한다.
 */

import { prisma } from "@/lib/prisma";
import { ARTIFACT_SCOPE_DEFAULT, isArtifactScopeCode, type ArtifactScopeCode } from "@/lib/scopeStatus";

/**
 * getArtifactScope — 프로젝트의 산출물 출력 범위
 *
 * 설정 행이 없거나(정상 경로에선 발생 안 함) 알 수 없는 값이 저장돼 있으면
 * ALL 로 떨어진다. 산출물에서 항목이 조용히 빠지는 것보다, 다 나오고 사람이
 * 이상하다고 느끼는 편이 안전하기 때문.
 */
export async function getArtifactScope(projectId: string): Promise<ArtifactScopeCode> {
  const settings = await prisma.tbPjProjectSettings.findUnique({
    where:  { prjct_id: projectId },
    select: { artifact_scope_code: true },
  });

  return isArtifactScopeCode(settings?.artifact_scope_code)
    ? settings.artifact_scope_code
    : ARTIFACT_SCOPE_DEFAULT;
}
