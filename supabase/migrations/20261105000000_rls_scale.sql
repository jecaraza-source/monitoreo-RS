-- Stage 12: read policies that scale with the volume of mentions.
--
-- Measured with 100 000 mentions (supabase/perf/map_scale.sql): the inbox
-- failed with "canceling statement due to statement timeout" (8 s for
-- authenticated). The read policies of mentions, classifications, tickets,
-- case_mentions and classification_reviews call a membership check with the
-- row's org_id, so Postgres runs it once per row (~0.1 ms each: 10 s to count
-- the inbox, 23 s for inbox_counts). The same fix stage 8 applied to cases:
-- the policy compares against sets computed once per query (an InitPlan),
-- read_all_org_ids() and the ids routed to the caller's department.
--
-- Who sees what does not change:
--   admin, comunicacion, lectura  -> every row of their organization;
--   dependencia                   -> mentions routed to its department (a
--                                    ticket of its own, or a mention in a case
--                                    assigned to it), their classifications,
--                                    its tickets and the links of its cases.
-- supabase/tests/database/rls_scale.test.sql checks it role by role.
-- Additive and repeatable: only functions and policies. Rollback:
-- docs/rollback/20261105000000_rls_scale.down.sql.

-- Mentions routed to the caller's department: directly by a ticket, or as part
-- of a case that has a ticket of the department (same as mention_routed_to_user).
create or replace function private.department_mention_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.mention_id
  from public.tickets t
  join public.memberships m
    on m.org_id = t.org_id and m.user_id = (select auth.uid()) and m.role = 'dependencia' and m.department_id = t.department_id
  union
  select cm.mention_id
  from public.case_mentions cm
  join public.tickets t on t.case_id = cm.case_id and t.org_id = cm.org_id
  join public.memberships m
    on m.org_id = t.org_id and m.user_id = (select auth.uid()) and m.role = 'dependencia' and m.department_id = t.department_id;
$$;

-- The caller's departments (one per organization where it is dependencia).
create or replace function private.user_department_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.department_id from public.memberships m
  where m.user_id = (select auth.uid()) and m.role = 'dependencia' and m.department_id is not null;
$$;

revoke execute on function private.department_mention_ids(), private.user_department_ids() from public, anon;
-- Called by the RLS policies, as the querying user.
grant execute on function private.department_mention_ids(), private.user_department_ids() to authenticated;

drop policy if exists "read mentions" on public.mentions;
create policy "read mentions" on public.mentions for select to authenticated
  using (org_id in (select private.read_all_org_ids()) or id in (select private.department_mention_ids()));

drop policy if exists "read classifications" on public.classifications;
create policy "read classifications" on public.classifications for select to authenticated
  using (org_id in (select private.read_all_org_ids()) or mention_id in (select private.department_mention_ids()));

drop policy if exists "read tickets" on public.tickets;
create policy "read tickets" on public.tickets for select to authenticated
  using (org_id in (select private.read_all_org_ids()) or department_id in (select private.user_department_ids()));

drop policy if exists "read case mentions" on public.case_mentions;
create policy "read case mentions" on public.case_mentions for select to authenticated
  using (org_id in (select private.read_all_org_ids()) or case_id in (select private.department_case_ids()));

drop policy if exists "readers read classification reviews" on public.classification_reviews;
create policy "readers read classification reviews" on public.classification_reviews for select to authenticated
  using (org_id in (select private.read_all_org_ids()));
