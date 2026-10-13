-- Rollback of 20261106000000_project_delete.sql: comunicación can delete projects
-- again (one ALL policy) and the delete function goes away. Deleted projects are
-- not restored (use the audit log or a backup). Run in one transaction.
begin;
drop function if exists public.delete_project(uuid);
drop policy if exists "editors add projects" on public.projects;
drop policy if exists "editors edit projects" on public.projects;
drop policy if exists "admin deletes projects" on public.projects;
drop policy if exists "editors manage projects" on public.projects;
create policy "editors manage projects" on public.projects for all to authenticated
  using ((select private.has_role(org_id, '{admin,comunicacion}')))
  with check ((select private.has_role(org_id, '{admin,comunicacion}')));
delete from supabase_migrations.schema_migrations where version = '20261106000000';
commit;
