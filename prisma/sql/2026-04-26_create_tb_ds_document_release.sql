-- ================================================================
-- 산출물 발행 이력 테이블 신설 — tb_ds_document_release
--
-- 배경:
--   요구사항·단위업무·화면 등 산출물 문서(.docx) 가 출력될 때, 사용자가 "공식 발행"
--   이벤트를 명시적으로 기록할 수 있는 자리가 없었다. 출력 양식의 "변경 이력" 표가
--   fallback "최초 작성" 1행으로만 표시되던 한계를 해결하기 위해, 발행 이벤트를
--   별도 테이블로 추적한다.
--
-- 기존 이력 테이블과의 분리 이유:
--   - tb_rq_requirement_history       : 요구사항 본문 스냅샷 (Diff 뷰어용, 자주 발생)
--   - tb_ds_design_change             : 디자인 도메인 자동/수동 변경 추적 (자주 발생)
--   - tb_ds_document_release (이 표)   : 산출물 발행 이벤트 (드물게 발생, 공식 버전 라벨)
--   라이프사이클·트리거·필수 컬럼(승인자) 모두 다르므로 별 테이블로 둔다.
--
-- snapshot_data 컬럼:
--   발행 시점의 양식 입력 객체(RequirementExportInput) 를 JSON 으로 박제.
--   원본 도메인 데이터가 변경되어도 발행본은 그대로 복원 가능 — "그 시점의 docx"
--   를 다시 다운로드할 수 있도록 하는 시점 일관성 보장 장치.
--
-- doc_kind:
--   "REQUIREMENT" | "UNIT_WORK" | "SCREEN" | "AREA" | "FUNCTION" 등.
--   현재는 REQUIREMENT 만 발행 대상이지만 모델 자체는 모든 산출물에 재사용.
--   CHECK 제약을 두지 않은 이유: 향후 산출물 종류 추가 시 ALTER 부담을 줄이기 위함.
--   (애플리케이션 레이어에서 화이트리스트 검증)
--
-- 멤버 FK 미설정 (release_mber_id):
--   기존 도메인 패턴과 동일 — 발행자 멤버가 프로젝트 탈퇴해도 이력 보존.
--
-- 인덱스:
--   Word 출력 핸들러가 "이 산출물의 모든 발행 이력" 을 자주 조회하므로
--   (prjct_id, doc_kind, ref_id) 복합 인덱스 필수.
--
-- 마이그레이션 안전성:
--   IF NOT EXISTS 로 재실행 안전 (멱등). DROP 없이 ADD 만.
--
-- 작성일 : 2026-04-26
-- ================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS tb_ds_document_release (
  release_id      VARCHAR(36)  PRIMARY KEY,
  prjct_id        VARCHAR(36)  NOT NULL,
  doc_kind        VARCHAR(40)  NOT NULL,
  ref_id          VARCHAR(36)  NOT NULL,
  vrsn_no         VARCHAR(50)  NOT NULL,
  change_cn       TEXT,
  author_nm       VARCHAR(100),
  approver_nm     VARCHAR(100),
  release_mber_id VARCHAR(36),
  snapshot_data   JSONB        NOT NULL,
  released_dt     TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- 산출물별 발행 이력 조회용 복합 인덱스
CREATE INDEX IF NOT EXISTS tb_ds_doc_release_target_idx
  ON tb_ds_document_release (prjct_id, doc_kind, ref_id);

COMMIT;

-- ================================================================
-- 검증 쿼리 (참고용 — 실행 후 수동 확인)
-- ================================================================
-- 1) 테이블 존재 확인:
--    \d+ tb_ds_document_release
--
-- 2) 인덱스 존재 확인:
--    SELECT indexname FROM pg_indexes WHERE tablename = 'tb_ds_document_release';
--
-- 3) 발행 1건 INSERT 테스트:
--    INSERT INTO tb_ds_document_release
--      (release_id, prjct_id, doc_kind, ref_id, vrsn_no, change_cn,
--       author_nm, approver_nm, snapshot_data)
--    VALUES (gen_random_uuid()::text, 'PRJ_TEST', 'REQUIREMENT', 'REQ_TEST',
--            'v1.0', '최초 발행', '이기성', '이제형', '{}'::jsonb);
