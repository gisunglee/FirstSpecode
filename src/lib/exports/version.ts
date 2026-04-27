/**
 * exports/version.ts — 산출물 발행 버전 라벨 유틸
 *
 * 역할:
 *   - "v1.0", "v2.3", "1.0.0" 같은 자유 텍스트 버전 라벨에서 마지막 숫자만 +1.
 *   - 발행 모달의 "버전" 입력 기본값과, 변경이력 표의 "현재 작업 중" 행 라벨에서 동일 사용.
 *
 * 정책:
 *   - 마이너만 자동(+1). 메이저 변경(v1.x → v2.0) 은 시스템이 알 길이 없어 사용자 수동 입력.
 *   - 라벨 형식이 자유 — 정규식으로 "끝에 붙은 정수 + 그 뒤 비숫자" 만 검출.
 *   - 숫자 없는 라벨이면 원본 그대로 반환 (안전 fallback).
 *
 * 동작 예:
 *   bumpMinorVersion("v1.0")          → "v1.1"
 *   bumpMinorVersion("v2.3")          → "v2.4"
 *   bumpMinorVersion("1.0.0")         → "1.0.1"
 *   bumpMinorVersion("v0.1-alpha")    → "v0.2-alpha"   (끝의 비숫자 보존)
 *   bumpMinorVersion("draft")         → "draft"        (숫자 없으면 원본)
 */

/**
 * 라벨 끝의 마지막 정수에 +1.
 *
 * 정규식 그룹:
 *   1) prefix       : 라벨 앞부분 (lazy match)
 *   2) lastNumber   : 마지막 정수
 *   3) suffix       : 그 뒤 비숫자 (alpha 같은 pre-release 표기 보존용)
 */
export function bumpMinorVersion(label: string): string {
  if (!label) return label;
  const m = label.match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return label;
  const next = parseInt(m[2], 10) + 1;
  return `${m[1]}${next}${m[3]}`;
}
