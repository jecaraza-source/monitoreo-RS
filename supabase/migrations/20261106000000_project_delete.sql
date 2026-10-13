-- Deleting a project, only by Administración.
--
-- Until now admin and comunicación could insert, update and delete projects
-- (one ALL policy). Deleting is destructive, so it becomes admin only, in the
-- database and not just in the menu; creating and editing stay as they were.
--
-- public.delete_project() is the only way the app deletes: it checks the role,
-- refuses to delete the organization's last project (classification and the
-- project selector need one), keeps every mention (they are detached from the
-- project's queries: query_id becomes null) and deletes the project with its
-- queries. projects and queries are audited (who, when, before), and so is
-- each detached mention.
-- Additive and repeatable. Rollback: docs/rollback/20261106000000_project_delete.down.sql.

drop policy if exists "editors manage projects" on public.projects;
drop policy if exists "editors add projects" on public.projects;
drop policy if exists "editors edit projects" on public.projects;
drop policy if exists "admin deletes projects" on public.projects;

create policy "editors add projects" on public.projects for insert to authenticated
  with check ((select private.has_role(org_id, '{admin,comunicacion}')));
create policy "editors edit projects" on public.projects for update to authenticated
  using ((select private.has_role(org_id, '{admin,comunicacion}')))
  with check ((select private.has_role(org_id, '{admin,comunicacion}')));
create policy "admin deletes projects" on public.projects for delete to authenticated
  using ((select private.has_role(org_id, '{admin}')));

create or replace function public.delete_project(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_detached integer;
  v_queries integer;
begin
  select p.org_id into v_org from public.projects p where p.id = p_project_id;
  -- Same answer for "does not exist" and "not yours": nothing is revealed.
  if v_org is null or not private.has_role(v_org, '{admin}') then
    raise exception 'Sólo Administración puede borrar proyectos.' using errcode = '42501';
  end if;
  if (select count(*) from public.projects p where p.org_id = v_org) <= 1 then
    raise exception 'Es el único proyecto del municipio; crea otro antes de borrarlo.' using errcode = 'P0001';
  end if;

  select count(*) into v_queries from public.queries q where q.project_id = p_project_id;
  update public.mentions m set query_id = null
  where m.org_id = v_org
    and m.query_id in (select q.id from public.queries q where q.project_id = p_project_id);
  get diagnostics v_detached = row_count;

  delete from public.projects p where p.id = p_project_id;
  return jsonb_build_object('mentions_kept', v_detached, 'queries_removed', v_queries);
end;
$$;

revoke execute on function public.delete_project(uuid) from public, anon;
grant execute on function public.delete_project(uuid) to authenticated;
