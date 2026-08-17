BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tb_ds_col_mapping AS mapping
    LEFT JOIN public.tb_ds_col_mapping_group AS mapping_group
      ON mapping_group.grp_id = mapping.grp_id
    WHERE mapping_group.grp_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot restore tb_ds_col_mapping_grp_id_fkey: orphan rows exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tb_ds_col_mapping_grp_id_fkey'
  ) THEN
    ALTER TABLE public.tb_ds_col_mapping
      ADD CONSTRAINT tb_ds_col_mapping_grp_id_fkey
      FOREIGN KEY (grp_id) REFERENCES public.tb_ds_col_mapping_group(grp_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tb_sp_sync_run AS sync_run
    LEFT JOIN public.tb_pj_project AS project
      ON project.prjct_id = sync_run.prjct_id
    WHERE project.prjct_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot restore tb_sp_sync_run_prjct_fk: orphan rows exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tb_sp_sync_run_prjct_fk'
  ) THEN
    ALTER TABLE public.tb_sp_sync_run
      ADD CONSTRAINT tb_sp_sync_run_prjct_fk
      FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tb_sp_sync_run AS sync_run
    LEFT JOIN public.tb_ds_unit_work AS unit_work
      ON unit_work.unit_work_id = sync_run.unit_work_id
    WHERE sync_run.unit_work_id IS NOT NULL
      AND unit_work.unit_work_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot restore tb_sp_sync_run_unit_work_fk: orphan rows exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tb_sp_sync_run_unit_work_fk'
  ) THEN
    ALTER TABLE public.tb_sp_sync_run
      ADD CONSTRAINT tb_sp_sync_run_unit_work_fk
      FOREIGN KEY (unit_work_id) REFERENCES public.tb_ds_unit_work(unit_work_id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tb_sp_sync_item AS sync_item
    LEFT JOIN public.tb_sp_sync_run AS sync_run
      ON sync_run.sync_run_id = sync_item.sync_run_id
    WHERE sync_run.sync_run_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot restore tb_sp_sync_item_run_fk: orphan rows exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tb_sp_sync_item_run_fk'
  ) THEN
    ALTER TABLE public.tb_sp_sync_item
      ADD CONSTRAINT tb_sp_sync_item_run_fk
      FOREIGN KEY (sync_run_id) REFERENCES public.tb_sp_sync_run(sync_run_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tb_sp_sync_item AS sync_item
    LEFT JOIN public.tb_ds_design_change AS design_change
      ON design_change.chg_id = sync_item.design_change_id
    WHERE sync_item.design_change_id IS NOT NULL
      AND design_change.chg_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot restore tb_sp_sync_item_design_change_fk: orphan rows exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tb_sp_sync_item_design_change_fk'
  ) THEN
    ALTER TABLE public.tb_sp_sync_item
      ADD CONSTRAINT tb_sp_sync_item_design_change_fk
      FOREIGN KEY (design_change_id) REFERENCES public.tb_ds_design_change(chg_id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

COMMIT;
