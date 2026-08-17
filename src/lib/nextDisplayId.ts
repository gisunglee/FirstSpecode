/**
 * nextDisplayId — "PREFIX-NNNNN" 형식 표시ID의 다음 순번을 계산
 *
 * 역할:
 *   - 프로젝트 내 기존 표시ID 목록 중 "PREFIX-숫자" 형식에 맞는 값만 골라 최댓값을 찾고 +1
 *   - 형식에 맞지 않는 값(수동 입력된 비표준 값, 과거 오염 데이터 등)은 무시
 *
 * 왜 필요한가:
 *   과거에는 DB에서 `ORDER BY display_id DESC LIMIT 1` 로 "최댓값"을 구한 뒤 숫자만 추출했다.
 *   이 방식은 표시ID 하나라도 "PREFIX-숫자" 형식을 벗어나면 문자열 정렬 순서가 깨진다 — 예를
 *   들어 한글처럼 유니코드 값이 큰 문자가 섞인 값("UW-000ㅈㄷ")이 항상 사전식 최댓값으로 뽑히고,
 *   거기서 숫자만 추출하면 0이 되어 이후 모든 채번이 다시 1부터 시작하는 채번 마비가 발생했다.
 *   (실제로 tb_ds_unit_work, tb_rq_task에서 이 문제가 발생해 있었음 — 2026-08-17)
 */
export function maxDisplayIdSeq(existingDisplayIds: string[], prefix: string): number {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let maxSeq = 0;
  for (const id of existingDisplayIds) {
    const matched = id.match(pattern);
    if (!matched) continue;
    const seq = parseInt(matched[1], 10);
    if (seq > maxSeq) maxSeq = seq;
  }
  return maxSeq;
}

export function computeNextDisplayId(existingDisplayIds: string[], prefix: string, pad = 5): string {
  const nextSeq = maxDisplayIdSeq(existingDisplayIds, prefix) + 1;
  return `${prefix}-${String(nextSeq).padStart(pad, "0")}`;
}
