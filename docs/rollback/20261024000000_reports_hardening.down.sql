-- Reversión de supabase/migrations/20261024000000_reports_hardening.sql.
-- Vuelve a la política única "editors manage reports" y al guard anterior.
-- No borra ni modifica filas. Correr en el SQL Editor sólo si la etapa 1 se
-- revierte también en la app (saveReport usa set_report_recipients).
begin;

drop function public.set_report_recipients(uuid, text[]);
drop trigger reports_insert_guard on public.reports;
drop function private.reports_insert_guard();

create or replace function private.reports_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (
       new.content is distinct from old.content or new.facts is distinct from old.facts
       or new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end) then
    raise exception 'El reporte ya fue aprobado y no se puede editar.' using errcode = '42501';
  end if;
  if new.status = 'draft' and old.status <> 'draft' then
    raise exception 'Un reporte aprobado no vuelve a borrador.' using errcode = '42501';
  end if;
  if new.status <> 'draft' and old.status = 'draft' then
    new.approved_at := coalesce(new.approved_at, now());
    new.approved_by := coalesce(new.approved_by, (select auth.uid()));
  end if;
  new.updated_at := now();
  return new;
end;
$$;

alter table public.reports drop constraint reports_recipients_max;

drop policy "editors insert draft reports" on public.reports;
drop policy "editors update draft reports" on public.reports;
drop policy "editors delete draft reports" on public.reports;
create policy "editors manage reports" on public.reports
  for all to authenticated
  using ((select private.has_role(org_id, '{admin,comunicacion}')))
  with check ((select private.has_role(org_id, '{admin,comunicacion}')));

grant insert, update on public.reports to authenticated;
-- anon queda sin privilegios sobre reports (antes los tenía, sin política que los usara).

delete from supabase_migrations.schema_migrations where version = '20261024000000';
commit;
