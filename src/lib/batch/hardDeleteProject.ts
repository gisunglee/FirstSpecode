/**
 * hardDeleteProject — 프로젝트 1건의 영구 삭제 (DB + 디스크)
 *
 * 호출자:
 *   - 정기 배치 (/api/admin/batch/run/project-hard-delete)
 *   - 어드민 수동 정리 (/api/admin/cleanup/projects/execute)
 *
 * 두 호출 경로가 같은 정리 로직을 공유해야 결과 차이가 없다. 그래서 본
 * 함수에 모았다 — 호출자는 prjctId 만 넘기면 된다.
 *
 * 동작:
 *   1) 첨부파일의 디스크 경로 목록을 미리 수집 (CASCADE 전)
 *   2) 트랜잭션 안에서:
 *      - tbPjProjectSettings deleteMany  (CASCADE 안 걸린 잔여)
 *      - tbPjProjectMember   deleteMany  (CASCADE 안 걸린 잔여)
 *      - tbPjProject         delete      (CASCADE 로 도메인 23+ 자동 정리)
 *   3) 트랜잭션 커밋 후 디스크 파일 best-effort 삭제
 *      - 이미 사라진 파일(ENOENT)은 정상 — 카운트만 안 올림
 *      - 그 외 디스크 실패는 WARN 로그만 — DB 는 이미 정리됐으므로 잡 자체는 성공
 *
 * 반환:
 *   처리 메타(첨부파일 수 / 디스크 삭제 성공·실패 수). 호출자는 이 값을
 *   tb_cm_batch_job_item.meta_json 에 그대로 적재할 수 있다.
 *
 * 예외:
 *   DB 삭제가 실패하면 throw — 호출자(runJob 등)가 잡아 FAILED 로 마킹.
 *   디스크 삭제 실패는 throw 하지 않음(=DB 일관성을 우선시).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { UPLOAD_ROOT } from "@/lib/fileStorage";

export interface HardDeleteProjectResult {
  attachFileCnt:   number;
  diskDeleted:     number;
  diskFailed:      number;
  /**
   * UPLOAD_ROOT 경계 밖을 가리키는 file_path_nm 으로 인해 차단된 건수.
   * 0 이 아니면 운영자 / 보안 관점에서 즉시 조사가 필요한 신호다.
   */
  diskBlockedUnsafe: number;

  /**
   * 디스크 삭제에 실패한 파일 경로 목록 (보강 A 도입).
   *
   * 운영자가 어드민 화면에서 어떤 파일이 처리되지 못했는지 즉시 식별할
   * 수 있도록 잡 항목 메타에 그대로 적재된다. DB 행은 이미 사라졌으므로
   * 이 목록만이 사후 추적 단서다.
   *
   * 길이는 PATH_LIST_MAX 로 캡 — 비정상 다량 실패 시 잡 메타가 비대해지는
   * 것을 방지. 초과분이 있으면 failedTruncated=true 로 신호.
   */
  failedPaths:      string[];
  failedTruncated:  boolean;
  /** 보안 가드(SECURITY_BLOCK)로 차단된 경로 목록 — 즉시 조사 대상 */
  blockedPaths:     string[];
  blockedTruncated: boolean;
}

/** 잡 메타 비대화 방지용 경로 목록 길이 캡 */
const PATH_LIST_MAX = 100;

/**
 * 절대경로가 UPLOAD_ROOT 하위인지 확인하는 가드.
 *
 * 보안 의의:
 *   file_path_nm 이 어떤 경로로 들어왔든(절대/상대/심볼릭/`..` 포함),
 *   resolve 한 결과가 UPLOAD_ROOT 의 자식이 아니면 거부한다. 디스크 삭제
 *   시점의 마지막 방어선 — 업로드 단계의 검증이 뚫렸더라도 임의 파일이
 *   날아가는 사고는 막는다.
 */
function isInsideUploadRoot(absPath: string): boolean {
  const rel = path.relative(UPLOAD_ROOT, absPath);
  // 비어있지 않고, 상위로 빠져나가지 않으며, 절대경로도 아니어야 안전.
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export async function hardDeleteProject(prjctId: string): Promise<HardDeleteProjectResult> {
  // ① 디스크 파일 경로 미리 수집 (CASCADE 전)
  const attachFiles = await prisma.tbCmAttachFile.findMany({
    where:  { prjct_id: prjctId },
    select: { file_path_nm: true },
  });

  // ② DB 트랜잭션 — CASCADE 가 도메인 23+ 테이블을 자동 정리.
  //    Phase 0 핫픽스로 invitation/apikey/settingsHistory CASCADE 보강 →
  //    이제는 tbPjProjectSettings/tbPjProjectMember 만 수동 처리.
  //
  //    timeout 60초 / maxWait 10초 — Prisma 기본(5초)으로는 요구사항·화면·
  //    AI 태스크 등이 대량인 큰 프로젝트에서 P2028 timeout 으로 부분 실패할
  //    수 있다. 충분한 여유로 잡되, 더 큰 폭은 잠금 길이 측면에서 위험.
  await prisma.$transaction(async (tx) => {
    await tx.tbPjProjectSettings.deleteMany({ where: { prjct_id: prjctId } });
    await tx.tbPjProjectMember.deleteMany  ({ where: { prjct_id: prjctId } });
    await tx.tbPjProject.delete            ({ where: { prjct_id: prjctId } });
  }, {
    timeout: 60_000,
    maxWait: 10_000,
  });

  // ③ 디스크 파일 best-effort 삭제 (DB 는 이미 정리됨)
  //    - 모든 경로는 UPLOAD_ROOT 경계 안인지 가드 후에만 unlink.
  //    - 경계 밖이면 ERROR 로깅하고 카운트만 증가시킨 채 건너뜀.
  //    - 실패/차단 경로는 배열로 모아 반환 → 호출자가 잡 메타에 적재해
  //      어드민이 사후 추적할 수 있게 한다(보강 A).
  let diskDeleted       = 0;
  let diskFailed        = 0;
  let diskBlockedUnsafe = 0;
  const failedPaths:  string[] = [];
  const blockedPaths: string[] = [];

  for (const f of attachFiles) {
    // file_path_nm 이 상대경로면 UPLOAD_ROOT 기준으로, 절대경로면 그대로 resolve
    const absPath = path.resolve(UPLOAD_ROOT, f.file_path_nm);

    if (!isInsideUploadRoot(absPath)) {
      diskBlockedUnsafe++;
      if (blockedPaths.length < PATH_LIST_MAX) blockedPaths.push(absPath);
      console.error(
        `[hardDeleteProject] SECURITY_BLOCK 업로드 경계 밖 경로 — 삭제 거부: ${f.file_path_nm}`
      );
      continue;
    }

    try {
      await fs.unlink(absPath);
      diskDeleted++;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        diskFailed++;
        if (failedPaths.length < PATH_LIST_MAX) failedPaths.push(absPath);
        console.warn(
          `[hardDeleteProject] 디스크 파일 삭제 실패: ${absPath}`,
          e
        );
      }
    }
  }

  return {
    attachFileCnt: attachFiles.length,
    diskDeleted,
    diskFailed,
    diskBlockedUnsafe,
    failedPaths,
    failedTruncated:  diskFailed        > PATH_LIST_MAX,
    blockedPaths,
    blockedTruncated: diskBlockedUnsafe > PATH_LIST_MAX,
  };
}
