/**
 * exports/configs-data.ts — 프로젝트 환경설정 데이터 조립 (서버 공용)
 *
 * 화면(GET)은 그룹 묶음(`{ groups: [{ group, items[] }] }`) 으로,
 * 엑셀(export)은 flat 한 row 배열로 노출한다 — 같은 원본 데이터를 다른 형태로 보여줄 뿐.
 */

import { prisma } from "@/lib/prisma";

export type ConfigItem = {
  configId:      string;
  key:           string;
  value:         string;
  label:         string;
  description:   string | null;
  valueType:     string;
  defaultValue:  string | null;
  selectOptions: unknown;
  sortOrder:     number;
};

export type ConfigGroup = {
  group: string;
  items: ConfigItem[];
};

/** 그룹 묶음 — 화면 GET 응답에 사용 */
export type ConfigGroupResponse = ConfigGroup[];

/** flat row — 엑셀 다운로드에 사용 (group 필드 추가) */
export type ConfigFlatRow = ConfigItem & { group: string };

/**
 * fetchProjectConfigs — 프로젝트 환경설정 항목을 그룹별로 묶어 반환.
 *
 *   prjct_id 단위 격리 — 다른 프로젝트의 항목은 절대 보이지 않음.
 *   정렬: config_group asc → sort_ordr asc (화면 그대로)
 */
export async function fetchProjectConfigs(opts: {
  projectId: string;
}): Promise<ConfigGroupResponse> {
  const { projectId } = opts;

  const configs = await prisma.tbPjProjectConfig.findMany({
    where: { prjct_id: projectId },
    orderBy: [{ config_group: "asc" }, { sort_ordr: "asc" }],
  });

  // 그룹별로 묶기
  const groupMap = new Map<string, ConfigItem[]>();
  for (const c of configs) {
    const list = groupMap.get(c.config_group) ?? [];
    list.push({
      configId:      c.config_id,
      key:           c.config_key,
      value:         c.config_value,
      label:         c.config_label,
      description:   c.config_dc,
      valueType:     c.value_type,
      defaultValue:  c.default_value,
      selectOptions: c.select_options,
      sortOrder:     c.sort_ordr,
    });
    groupMap.set(c.config_group, list);
  }

  return Array.from(groupMap.entries()).map(([group, items]) => ({ group, items }));
}

/**
 * fetchProjectConfigsFlat — 엑셀용 flat 변환 (그룹을 row 의 컬럼으로 풀어냄).
 *
 * 화면이 보는 그룹 묶음과 동일한 데이터를 그대로 펴서 내보낸다 → 화면-엑셀 결과 일치.
 */
export async function fetchProjectConfigsFlat(opts: {
  projectId: string;
}): Promise<ConfigFlatRow[]> {
  const groups = await fetchProjectConfigs(opts);
  return groups.flatMap((g) => g.items.map((it) => ({ ...it, group: g.group })));
}
