/**
 * 보안 경계 회귀 테스트
 *
 * 사용자 HTML 정화가 실제 공격 문자열을 제거하는지 확인하고, 프로젝트 소속 검증과
 * 리뷰 관리자 판정이 실수로 다시 빠지지 않도록 핵심 라우트의 보안 불변식을 고정한다.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { renderMarkdown, sanitizeHtml } from "../src/lib/renderMarkdown";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

test("Markdown과 Rich HTML에서 실행 가능한 XSS를 제거한다", () => {
  const markdown = renderMarkdown('<img src="x" onerror="alert(1)"><script>alert(2)</script>');
  const richHtml = sanitizeHtml(
    '<a href="javascript:alert(1)">링크</a><svg><a xlink:href="javascript:alert(2)">x</a></svg>',
  );

  assert.equal(markdown.includes("onerror"), false);
  assert.equal(markdown.includes("<script"), false);
  assert.equal(markdown.includes("alert(2)"), false);
  assert.equal(richHtml.toLowerCase().includes("javascript:"), false);

  const planStudio = source("src/app/(main)/projects/[id]/plan-studio/[planStudioId]/page.tsx");
  assert.equal(planStudio.includes('sandbox="allow-same-origin allow-scripts"'), false);
});

test("안전한 문서 서식은 유지한다", () => {
  const html = sanitizeHtml('<p style="color:red"><strong>안전</strong></p>');

  assert.match(html, /<p/);
  assert.match(html, /<strong>안전<\/strong>/);
});

test("다형 참조 API는 실제 대상의 프로젝트 소속을 검증한다", () => {
  const implTree = source("src/app/api/projects/[id]/impl-tree/route.ts");
  const mappings = source("src/app/api/projects/[id]/col-mappings/route.ts");
  const groups = source("src/app/api/projects/[id]/col-mapping-groups/[groupId]/route.ts");
  const progress = source("src/app/api/projects/[id]/phase-progress/route.ts");

  for (const route of [implTree, mappings, groups, progress]) {
    assert.match(route, /projectEntityBelongsToProject\(projectId,/);
  }
});

test("리뷰 관리자 판정과 댓글 부모 프로젝트 경계를 유지한다", () => {
  const review = source("src/app/api/projects/[id]/reviews/[reviewId]/route.ts");
  const comment = source("src/app/api/projects/[id]/reviews/[reviewId]/comments/[commentId]/route.ts");
  const comments = source("src/app/api/projects/[id]/reviews/[reviewId]/comments/route.ts");

  assert.equal((review.match(/checkRole\([^\n]+\) === null/g) ?? []).length, 2);
  assert.equal((comment.match(/checkRole\([^\n]+\) === null/g) ?? []).length, 1);
  assert.match(comment, /review_id: reviewId, prjct_id: projectId/);
  assert.match(comments, /review_id: reviewId, prjct_id: projectId/);
});
