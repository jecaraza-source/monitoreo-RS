-- Rollback of 20261101000000_map_cases.sql (stage 8).
--
-- Run it only together with reverting the app (the stage 8 app reads the
-- location columns and calls map_case_rows, map_unlocated_mentions,
-- set_case_location and clear_case_location).
--
-- Before running it, export what would be lost (confirmed locations and their history):
--   copy (select id, neighborhood_id, location_status, location_source, location_confidence, location_lat, location_lng,
--                location_updated_at, location_updated_by from public.cases where location_status = 'confirmed') to stdout with csv header;
--   copy (select * from public.case_location_events) to stdout with csv header;
-- The colonia of each case (neighborhood_id) stays; a correction made with
-- set_case_location also stays. The case_events rows location_confirmed,
-- location_corrected and location_cleared stay in the history (append-only).

begin;

-- Read policy of cases: back to the stage 4 form (same rule, per row).
drop policy if exists "read cases" on public.cases;
create policy "read cases" on public.cases for select to authenticated
  using ((select private.can_read_all(org_id)) or private.case_visible_to_department(org_id, id));
drop function if exists private.department_case_ids();
drop function if exists private.read_all_org_ids();

drop function if exists public.map_unlocated_mentions(uuid, timestamptz, timestamptz, text, uuid, public.sentiment, integer);
drop function if exists public.map_case_rows(uuid, jsonb);
drop function if exists public.clear_case_location(uuid, text);
drop function if exists public.set_case_location(uuid, uuid, numeric, numeric, text);
drop function if exists private.point_in_geojson(jsonb, numeric, numeric);

drop trigger if exists cases_log_location on public.cases;
drop trigger if exists cases_infer_location on public.cases;
drop function if exists private.log_case_location();
drop function if exists private.infer_case_location();

drop table if exists public.case_location_events;

drop index if exists public.cases_map_idx;
alter table public.cases
  drop constraint if exists cases_location_colonia,
  drop constraint if exists cases_location_point_confirmed,
  drop constraint if exists cases_location_point_pair,
  drop column if exists location_updated_by,
  drop column if exists location_updated_at,
  drop column if exists location_lng,
  drop column if exists location_lat,
  drop column if exists location_confidence,
  drop column if exists location_source,
  drop column if exists location_status;

delete from supabase_migrations.schema_migrations where version = '20261101000000';

commit;
