/**
 * GET /api/admin/billing/payments/export — 결제 이력 엑셀 (SUPER_ADMIN)
 *
 * 목록 API 와 같은 필터를 받아 전량(최대 MAX_EXPORT_ROWS)을 xlsx 로 내린다.
 * PG 정산 내역과 월별로 대조하는 용도. 관리자 세션 전용이라 지원 세션 문제는 없다.
 */

import type { NextRequest } from "next/server";
import { apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { buildWorkbook } from "@/lib/exports/excel/buildWorkbook";
import { buildExportFilename } from "@/lib/exports/excel/filename";
import { MAX_EXPORT_ROWS, type ExcelColumn } from "@/lib/exports/excel/types";
import { fetchPaymentsForExport, type AdminPaymentRow } from "@/lib/billing/admin";
import { parsePaymentFilters } from "../filters";

const TYPE_LABEL: Record<string, string> = { INITIAL: "구독 시작", RECURRING: "정기 결제", SEAT_ADD: "좌석 추가", REFUND: "환불" };
const STATUS_LABEL: Record<string, string> = { PAID: "완료", FAILED: "실패", REFUNDED: "환불" };

const kst = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19) : "");

const columns: ExcelColumn<AdminPaymentRow>[] = [
  { key: "createdAt",  header: "일시(KST)",  width: 20, format: (r) => kst(r.approvedAt ?? r.createdAt) },
  { key: "email",      header: "회원 이메일", width: 28, format: (r) => r.member.email ?? "" },
  { key: "name",       header: "회원 이름",   width: 14, format: (r) => r.member.name ?? "" },
  { key: "type",       header: "구분",        width: 12, format: (r) => TYPE_LABEL[r.type] ?? r.type },
  { key: "status",     header: "상태",        width: 10, format: (r) => STATUS_LABEL[r.status] ?? r.status },
  { key: "amount",     header: "금액(원)",    width: 12, format: (r) => r.amount },
  { key: "seatCnt",    header: "좌석",        width: 8,  format: (r) => r.seatCnt },
  { key: "periodStart",header: "기간 시작",   width: 20, format: (r) => kst(r.periodStart) },
  { key: "periodEnd",  header: "기간 종료",   width: 20, format: (r) => kst(r.periodEnd) },
  { key: "orderId",    header: "주문 ID",     width: 30 },
  { key: "paymentKey", header: "PG 결제 키",  width: 30, format: (r) => r.paymentKey ?? "" },
  { key: "provider",   header: "PG",          width: 8 },
  { key: "failReason", header: "실패·환불 사유", width: 40, format: (r) => r.failReason ?? "" },
];

export async function GET(req: NextRequest): Promise<Response> {
  const gate = await requireSystemAdmin(req);
  if (gate instanceof Response) return gate;

  const filters = parsePaymentFilters(req.nextUrl.searchParams);
  if (filters instanceof Response) return filters;

  let rows: AdminPaymentRow[];
  try {
    rows = await fetchPaymentsForExport(filters, MAX_EXPORT_ROWS + 1);
  } catch (err) {
    console.error("[GET /api/admin/billing/payments/export] 조회 실패:", err);
    return apiError("DB_ERROR", "결제 이력 조회에 실패했습니다.", 500);
  }
  if (rows.length > MAX_EXPORT_ROWS) {
    return apiError("EXPORT_TOO_LARGE", `한 번에 ${MAX_EXPORT_ROWS.toLocaleString()}건까지 다운로드할 수 있습니다. 기간을 좁혀 주세요.`, 400);
  }

  let buffer: Buffer;
  try {
    buffer = await buildWorkbook({ sheetName: "결제 이력", columns, rows });
  } catch (err) {
    console.error("[GET /api/admin/billing/payments/export] 워크북 생성 실패:", err);
    return apiError("EXPORT_BUILD_ERROR", "엑셀 파일 생성에 실패했습니다.", 500);
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${buildExportFilename("billing-payments")}"`,
      "Cache-Control": "no-store",
    },
  });
}
