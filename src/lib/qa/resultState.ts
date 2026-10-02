/** 새 결과는 미실행으로 구분한다. 과거 완료 회차의 NA는 그대로 보존한다. */
export function effectiveResultCode(result: {
  result_code: string;
  test_dt: Date | string | null;
  testCase: { applicable_yn: string };
}, roundStatus: string): string {
  if (roundStatus === "IN_PROGRESS" && result.result_code === "NA"
      && !result.test_dt && result.testCase.applicable_yn !== "N") {
    return "PENDING";
  }
  return result.result_code;
}
