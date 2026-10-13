-- Rollback of 20261105000000_rls_scale.sql: the previous per-row policies
-- (same visibility, slower with large volumes). Run in one transaction.
begin;

drop policy if exists "read mentions" on public.mentions;
create policy "read mentions" on public.mentions for select to authenticated
  using ((select private.can_read_all(org_id)) or private.mention_routed_to_user(org_id, id));

drop policy if exists "read classifications" on public.classifications;
create policy "read classifications" on public.classifications for select to authenticated
  using ((select private.can_read_all(org_id)) or private.mention_routed_to_user(org_id, mention_id));

drop policy if exists "read tickets" on public.tickets;
create policy "read tickets" on public.tickets for select to authenticated
  using ((select private.can_read_all(org_id)) or department_id = (select private.user_department(org_id)));

drop policy if exists "read case mentions" on public.case_mentions;
create policy "read case mentions" on public.case_mentions for select to authenticated
  using ((select private.can_read_all(org_id)) or private.case_visible_to_department(org_id, case_id));

drop policy if exists "readers read classification reviews" on public.classification_reviews;
create policy "readers read classification reviews" on public.classification_reviews for select to authenticated
  using ((select private.can_read_all(org_id)));

drop function if exists private.department_mention_ids();
drop function if exists private.user_department_ids();

delete from supabase_migrations.schema_migrations where version = '20261105000000';
commit;
