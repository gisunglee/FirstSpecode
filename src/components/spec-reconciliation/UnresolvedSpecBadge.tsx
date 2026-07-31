"use client";

/**
 * 단위업무·화면·영역·기능 상세에서 미해결 구현 변경을 바로 보여준다.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

type TargetType = "UNIT_WORK" | "SCREEN" | "AREA" | "FUNCTION";

export function UnresolvedSpecBadge({
  projectId,
  targetType,
  targetId,
  enabled = true,
}: {
  projectId: string;
  targetType: TargetType;
  targetId: string;
  enabled?: boolean;
}) {
  const { data } = useQuery({
    queryKey: [
      "spec-reconciliation-unresolved-target",
      projectId,
      targetType,
      targetId,
    ],
    queryFn: () => {
      const query = new URLSearchParams({ targetType, targetId });
      return authFetch<{
        data: {
          count: number;
          maxRisk: string;
          latestReceiptId: string | null;
        };
      }>(
        `/api/projects/${projectId}/spec-reconciliations/unresolved-target?${query}`,
      ).then((response) => response.data);
    },
    enabled: enabled && Boolean(targetId),
  });

  if (!data?.count || !data.latestReceiptId) return null;
  return (
    <Link
      href={
        `/projects/${projectId}/spec-reconciliations/` +
        data.latestReceiptId
      }
      className={`sp-badge ${
        ["HIGH", "CRITICAL"].includes(data.maxRisk)
          ? "sp-badge-error"
          : "sp-badge-warning"
      }`}
    >
      미반영 변경 {data.count}건
    </Link>
  );
}
