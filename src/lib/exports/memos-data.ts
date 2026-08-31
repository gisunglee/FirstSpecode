/**
 * exports/memos-data.ts — 메모 목록 데이터 조립 (서버 공용)
 */

import { prisma } from "@/lib/prisma";

export type MemoListItem = {
  memoId:        string;
  subject:       string;
  memoTyCode:    string;
  visbltyCode:   string;
  purposeCode:   string;
  refTyCode:     string | null;
  refId:         string | null;
  refName:       string;
  viewCnt:       number;
  creatMberId:   string;
  creatMberName: string;
  isMine:        boolean;
  canEdit:       boolean;
  creatDt:       Date;
};

/**
 * fetchProjectMemos — 메모 목록 + 작성자 + 연결 엔티티 이름 조회
 *
 *   - mberId : 인증된 사용자. "내 메모" 식별 + 본인 메모 + 팀공개 메모 OR 조건 구성
 *   - visibility : "mine" | "team" | undefined(전체 — 본인 전체 + 타인의 PRIVATE 아닌 것)
 *   - refType + refId : 특정 엔티티에 연결된 메모만
 *   - search : 제목 부분 일치
 *   - purpose : 용도 구분(GENERAL/MEETING) — 회의록 메뉴는 이 값을 MEETING으로 고정해 진입
 */
export async function fetchProjectMemos(opts: {
  projectId:  string;
  mberId:     string;
  refType?:   string;
  refId?:     string;
  search?:    string;
  visibility?: string;
  purpose?:   string;
}): Promise<MemoListItem[]> {
  const { projectId, mberId, refType, refId, search, visibility, purpose } = opts;

  // 조회 범위: 기본은 본인 메모 전체 + 타인의 PRIVATE 아닌 메모(OR)
  const where: Record<string, unknown> = {
    prjct_id: projectId,
    OR: [
      { creat_mber_id: mberId },
      { visblty_code: { not: "PRIVATE" } },
    ],
  };

  if (refType && refId) {
    where.ref_ty_code = refType;
    where.ref_id      = refId;
  }
  if (search) {
    where.memo_sj = { contains: search, mode: "insensitive" };
  }
  if (purpose) {
    where.memo_purps_code = purpose;
  }
  if (visibility === "mine") {
    delete where.OR;
    where.creat_mber_id = mberId;
  } else if (visibility === "team") {
    delete where.OR;
    where.visblty_code = { not: "PRIVATE" };
  }

  // select로 필요한 컬럼만 — memo_cn(본문)/sheet_data(표 전체, 이미지 base64 포함)는
  // 목록 화면에서 전혀 안 쓰는데 select 없이 조회하면 매번 통째로 읽어와 낭비된다
  // (엑셀형 메모 하나가 최대 1.5MB라 목록에 여러 개 있으면 체감되는 낭비였음).
  const memos = await prisma.tbDsMemo.findMany({
    where,
    orderBy: { creat_dt: "desc" },
    take: 200,
    select: {
      memo_id: true, memo_sj: true, memo_ty_code: true, visblty_code: true, memo_purps_code: true,
      ref_ty_code: true, ref_id: true, view_cnt: true, creat_mber_id: true, creat_dt: true,
    },
  });

  // 작성자 이름 일괄 조회
  const mberIds = [...new Set(memos.map((m) => m.creat_mber_id))];
  const members = mberIds.length > 0
    ? await prisma.tbCmMember.findMany({
        where:  { mber_id: { in: mberIds } },
        select: { mber_id: true, mber_nm: true },
      })
    : [];
  const mberMap = new Map(members.map((m) => [m.mber_id, m.mber_nm]));

  // 연결 엔티티 이름 일괄 조회 (ref_ty_code 별)
  const refNameMap = await resolveRefNames(memos);

  return memos.map((m) => ({
    memoId:        m.memo_id,
    subject:       m.memo_sj,
    memoTyCode:    m.memo_ty_code,
    visbltyCode:   m.visblty_code,
    purposeCode:   m.memo_purps_code,
    refTyCode:     m.ref_ty_code,
    refId:         m.ref_id,
    refName:       m.ref_id ? (refNameMap.get(m.ref_id) ?? "") : "",
    viewCnt:       m.view_cnt,
    creatMberId:   m.creat_mber_id,
    creatMberName: mberMap.get(m.creat_mber_id) ?? "",
    isMine:        m.creat_mber_id === mberId,
    // TEAM_EDIT는 작성자 외 프로젝트 멤버도 수정 가능
    canEdit:       m.creat_mber_id === mberId || m.visblty_code === "TEAM_EDIT",
    creatDt:       m.creat_dt,
  }));
}

// ─── 연결 엔티티 이름 일괄 조회 유틸 ─────────────────────────────────────────

async function resolveRefNames(
  memos: { ref_ty_code: string | null; ref_id: string | null }[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const groups: Record<string, string[]> = {};
  for (const m of memos) {
    if (!m.ref_ty_code || !m.ref_id) continue;
    if (!groups[m.ref_ty_code]) groups[m.ref_ty_code] = [];
    groups[m.ref_ty_code].push(m.ref_id);
  }

  const queries: Promise<void>[] = [];
  if (groups.REQUIREMENT?.length) {
    queries.push(
      prisma.tbRqRequirement.findMany({
        where:  { req_id: { in: groups.REQUIREMENT } },
        select: { req_id: true, req_nm: true },
      }).then((rows) => rows.forEach((r) => map.set(r.req_id, r.req_nm))),
    );
  }
  if (groups.TASK?.length) {
    queries.push(
      prisma.tbRqTask.findMany({
        where:  { task_id: { in: groups.TASK } },
        select: { task_id: true, task_nm: true },
      }).then((rows) => rows.forEach((r) => map.set(r.task_id, r.task_nm))),
    );
  }
  if (groups.FUNCTION?.length) {
    queries.push(
      prisma.tbDsFunction.findMany({
        where:  { func_id: { in: groups.FUNCTION } },
        select: { func_id: true, func_nm: true },
      }).then((rows) => rows.forEach((r) => map.set(r.func_id, r.func_nm))),
    );
  }
  if (groups.AREA?.length) {
    queries.push(
      prisma.tbDsArea.findMany({
        where:  { area_id: { in: groups.AREA } },
        select: { area_id: true, area_nm: true },
      }).then((rows) => rows.forEach((r) => map.set(r.area_id, r.area_nm))),
    );
  }
  if (groups.SCREEN?.length) {
    queries.push(
      prisma.tbDsScreen.findMany({
        where:  { scrn_id: { in: groups.SCREEN } },
        select: { scrn_id: true, scrn_nm: true },
      }).then((rows) => rows.forEach((r) => map.set(r.scrn_id, r.scrn_nm))),
    );
  }
  if (groups.UNIT_WORK?.length) {
    queries.push(
      prisma.tbDsUnitWork.findMany({
        where:  { unit_work_id: { in: groups.UNIT_WORK } },
        select: { unit_work_id: true, unit_work_nm: true },
      }).then((rows) => rows.forEach((r) => map.set(r.unit_work_id, r.unit_work_nm))),
    );
  }

  await Promise.all(queries);
  return map;
}
