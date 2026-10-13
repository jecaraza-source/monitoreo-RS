-- Reports: explicit workflow from the API.
--
-- Until now "editors manage reports" was one FOR ALL policy, so an editor
-- calling the API directly could insert a report already approved or sent,
-- delete approved or sent reports, write approved_by / sent_at / delivery /
-- pdf_path, and change recipients after approval without trace.
--
-- After this migration, for admin and comunicacion (authenticated):
--   INSERT  only drafts, with no approval or delivery data; created_by is theirs.
--   UPDATE  only drafts, only title, content and status; draft → approved
--           stamps approved_by = auth.uid() and approved_at = now().
--   DELETE  only drafts.
--   Recipients change only through set_report_recipients (any status,
--           audited in audit_log).
-- The server (service role) renders and sends: approved → approved (pdf_path),
-- approved → sent, sent → sent (resend). Nobody goes back to draft, and the
-- approval stamps never change once set.
--
-- Additive: no table is recreated and no row changes. Rollback: see
-- docs/etapa-1-endurecimiento.md.

-- ---------------------------------------------------------------------------
-- Policies per operation
-- ---------------------------------------------------------------------------
drop policy "editors manage reports" on public.reports;

create policy "editors insert draft reports" on public.reports
  for insert to authenticated
  with check (
    (select private.has_role(org_id, '{admin,comunicacion}'))
    and status = 'draft'
    and approved_by is null and approved_at is null
    and sent_at is null and pdf_path is null and delivery = '{}'::jsonb
    and (schedule_id is null or exists (
      select 1 from public.report_schedules s where s.id = schedule_id and s.org_id = reports.org_id))
  );

create policy "editors update draft reports" on public.reports
  for update to authenticated
  using ((select private.has_role(org_id, '{admin,comunicacion}')) and status = 'draft')
  with check ((select private.has_role(org_id, '{admin,comunicacion}')));

create policy "editors delete draft reports" on public.reports
  for delete to authenticated
  using ((select private.has_role(org_id, '{admin,comunicacion}')) and status = 'draft');

-- Column privileges: what a draft's author may write from the API.
revoke insert, update on public.reports from authenticated;
grant insert (id, org_id, period, period_start, period_end, title, facts, content, model, recipients, schedule_id)
  on public.reports to authenticated;
grant update (title, content, status) on public.reports to authenticated;
revoke all on public.reports from anon;

-- New rows only (existing rows are not checked).
alter table public.reports
  add constraint reports_recipients_max check (cardinality(recipients) <= 30) not valid;

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

-- Both guards tell a request from the API (current_user authenticated or
-- anon) from the server (service_role) and from our security definer
-- functions (which run as their owner). They call no private.* function: the
-- service role has no USAGE on that schema.

create function private.reports_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.created_by := (select auth.uid());
  end if;
  return new;
end;
$$;
revoke execute on function private.reports_insert_guard() from public, anon, authenticated;

create trigger reports_insert_guard before insert on public.reports
  for each row execute function private.reports_insert_guard();

create or replace function private.reports_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
     or new.schedule_id is distinct from old.schedule_id then
    raise exception 'Estos datos del reporte no se pueden cambiar.' using errcode = '42501';
  end if;

  if old.status <> 'draft' and (
       new.content is distinct from old.content or new.facts is distinct from old.facts
       or new.title is distinct from old.title or new.model is distinct from old.model
       or new.period is distinct from old.period
       or new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end) then
    raise exception 'El reporte ya fue aprobado y no se puede editar.' using errcode = '42501';
  end if;
  if new.status = 'draft' and old.status <> 'draft' then
    raise exception 'Un reporte aprobado no vuelve a borrador.' using errcode = '42501';
  end if;
  if old.status <> 'draft' and (new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at) then
    raise exception 'La aprobación de un reporte no se puede cambiar.' using errcode = '42501';
  end if;
  if old.status = 'sent' and new.status <> 'sent' then
    raise exception 'Un reporte enviado no cambia de estado.' using errcode = '42501';
  end if;
  if old.status = 'draft' and new.status = 'sent' then
    raise exception 'Un reporte se aprueba antes de enviarse.' using errcode = '42501';
  end if;

  if current_user in ('authenticated', 'anon') then
    -- Editors: the draft's text, and the draft → approved step. Approval and
    -- delivery data are written here or by the server, never by the caller.
    if old.status <> 'draft' or new.status not in ('draft', 'approved') then
      raise exception 'Sólo el servidor registra el envío de un reporte.' using errcode = '42501';
    end if;
    if new.facts is distinct from old.facts or new.model is distinct from old.model
       or new.period is distinct from old.period
       or new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end
       or new.sent_at is distinct from old.sent_at or new.delivery is distinct from old.delivery
       or new.pdf_path is distinct from old.pdf_path then
      raise exception 'Los datos de aprobación y envío los registra el sistema.' using errcode = '42501';
    end if;
    if new.recipients is distinct from old.recipients then
      raise exception 'Los destinatarios se cambian con set_report_recipients.' using errcode = '42501';
    end if;
    if new.status = 'approved' then
      new.approved_by := (select auth.uid());
      new.approved_at := now();
    else
      new.approved_by := old.approved_by;
      new.approved_at := old.approved_at;
    end if;
  elsif old.status = 'draft' and new.status = 'approved' then
    -- The server approves scheduled reports (auto_approve): no person approved them.
    new.approved_at := coalesce(new.approved_at, now());
  end if;

  if new.status = 'sent' and new.sent_at is null then
    new.sent_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recipients: the only way to change them from the API, in any status
-- ---------------------------------------------------------------------------
create function public.set_report_recipients(p_report_id uuid, p_recipients text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_clean text[];
  v_bad text;
begin
  select org_id into v_org from public.reports where id = p_report_id;
  if v_org is null or not private.has_role(v_org, '{admin,comunicacion}') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- Trimmed, lower case, without repeats, in the order given.
  select coalesce(array_agg(e order by first), '{}') into v_clean
  from (
    select lower(btrim(r)) as e, min(n) as first
    from unnest(coalesce(p_recipients, '{}')) with ordinality as u(r, n)
    where btrim(r) <> ''
    group by 1
  ) d;

  if cardinality(v_clean) > 30 then
    raise exception 'Máximo 30 destinatarios.' using errcode = '22023';
  end if;
  select e into v_bad from unnest(v_clean) as e where e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(e) > 254 limit 1;
  if v_bad is not null then
    raise exception 'Correo inválido: %', v_bad using errcode = '22023';
  end if;

  -- audit_reports logs the change (old and new list) with the caller as actor.
  update public.reports set recipients = v_clean where id = p_report_id;
  return v_clean;
end;
$$;

revoke execute on function public.set_report_recipients(uuid, text[]) from public, anon;
grant execute on function public.set_report_recipients(uuid, text[]) to authenticated;
