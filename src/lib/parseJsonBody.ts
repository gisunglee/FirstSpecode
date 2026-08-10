import { z } from "zod";
import { apiError } from "@/lib/apiResponse";

export async function parseJsonBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema
): Promise<{ data: z.output<TSchema> } | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const parsed = schema.safeParse(body);
  if (parsed.success) return { data: parsed.data };

  const issue = parsed.error.issues[0];
  const field = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  return apiError(
    "VALIDATION_ERROR",
    `${field}${issue?.message ?? "요청 값이 올바르지 않습니다."}`,
    400,
    { issues: parsed.error.issues }
  );
}
