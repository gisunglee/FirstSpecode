/** 구현-설계 동기화 도메인에서 API 상태와 함께 전달하는 오류. */

export class SpecSyncError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
