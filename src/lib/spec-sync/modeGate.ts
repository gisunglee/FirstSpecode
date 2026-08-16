/** Shadow 승인 상태에 따라 CHECK와 DEEP_SYNC 실행을 결정적으로 차단한다. */

import type { SyncMode } from "./contracts";
import { SpecSyncError } from "./errors";

export function assertSyncModeEnabled(
  mode: SyncMode,
  flags: {
    syncEnabled?: string;
    deepEnabled?: string;
  } = {
    syncEnabled: process.env.SPEC_SYNC_ENABLED,
    deepEnabled: process.env.SPEC_SYNC_DEEP_ENABLED,
  },
) {
  if (flags.syncEnabled !== "true") {
    throw new SpecSyncError(
      "SPEC_SYNC_NOT_ENABLED",
      "CHECK Shadow 검증 승인 뒤 SPEC_SYNC_ENABLED=true로 활성화하세요.",
      409,
    );
  }
  if (mode === "DEEP_SYNC" && flags.deepEnabled !== "true") {
    throw new SpecSyncError(
      "DEEP_SYNC_NOT_ENABLED",
      "DEEP_SYNC는 별도 Shadow 검증을 통과한 뒤 활성화됩니다. 현재는 CHECK를 사용하세요.",
      409,
    );
  }
}
