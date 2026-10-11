-- WhatsApp channel, phase 2: the department's responsible gets each routed
-- mention on WhatsApp and works it from there (status buttons, notes).

-- When the WhatsApp notice went out (shown in the inbox).
alter table public.tickets add column whatsapp_notified_at timestamptz;

-- Where a note was written. Set by the database, never by the client: a note
-- is 'whatsapp' only when whatsapp_ticket_action() below writes it.
alter table public.mention_notes add column channel text not null default 'app' check (channel in ('app', 'whatsapp'));

create function private.stamp_note_channel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.channel := case when current_setting('app.channel', true) = 'whatsapp' then 'whatsapp' else 'app' end;
  return new;
end;
$$;
revoke execute on function private.stamp_note_channel() from public, anon, authenticated;

create trigger mention_notes_stamp_channel
  before insert on public.mention_notes
  for each row execute function private.stamp_note_channel();

-- A button or reply from an official on WhatsApp, applied as that official:
-- the same permission as in the app (their department's tickets, or every
-- ticket for admin/comunicacion), notes and audit log signed with their user.
-- Only the server (service role) calls it, after checking Meta's signature.
create function public.whatsapp_ticket_action(
  p_contact_id uuid,
  p_ticket_id uuid,
  p_status public.ticket_status default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.whatsapp_contacts;
  v_ticket public.tickets;
  v_member public.memberships;
  v_labels jsonb := '{"open":"Abierto","in_progress":"En proceso","resolved":"Resuelto","closed":"Cerrado"}';
begin
  select * into v_contact from public.whatsapp_contacts where id = p_contact_id and status = 'active';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;
  select * into v_ticket from public.tickets where id = p_ticket_id and org_id = v_contact.org_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into v_member from public.memberships where org_id = v_contact.org_id and user_id = v_contact.user_id;
  if not found or not (
    v_member.role in ('admin', 'comunicacion')
    or (v_member.role = 'dependencia' and v_member.department_id = v_ticket.department_id)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- From here on, auth.uid() is the official: triggers stamp and audit them.
  perform set_config('request.jwt.claims', json_build_object('sub', v_contact.user_id, 'role', 'authenticated')::text, true);
  perform set_config('app.channel', 'whatsapp', true);

  if p_status is not null and p_status <> v_ticket.status then
    if v_ticket.status = 'closed' then
      return jsonb_build_object('ok', false, 'reason', 'closed', 'status', v_ticket.status);
    end if;
    update public.tickets
    set status = p_status,
        resolved_at = case when p_status in ('resolved', 'closed') then now() else null end
    where id = v_ticket.id;
    insert into public.mention_notes (org_id, mention_id, body)
    values (v_ticket.org_id, v_ticket.mention_id, format('Cambió el turno a «%s» desde WhatsApp.', v_labels ->> p_status::text));
  end if;

  if nullif(btrim(p_note), '') is not null then
    insert into public.mention_notes (org_id, mention_id, body)
    values (v_ticket.org_id, v_ticket.mention_id, left(btrim(p_note), 2000));
  end if;

  perform set_config('app.channel', '', true);
  return jsonb_build_object('ok', true, 'status', coalesce(p_status, v_ticket.status), 'mention_id', v_ticket.mention_id);
end;
$$;

revoke execute on function public.whatsapp_ticket_action(uuid, uuid, public.ticket_status, text) from public, anon, authenticated;
grant execute on function public.whatsapp_ticket_action(uuid, uuid, public.ticket_status, text) to service_role;

-- Routing again (new due date, back to open) is a new assignment: notify again.
create or replace function public.route_mentions(p_mention_ids uuid[], p_department_id uuid, p_due_at timestamptz)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.tickets (org_id, mention_id, department_id, due_at)
  select m.org_id, m.id, p_department_id, p_due_at
  from public.mentions m
  where m.id = any (p_mention_ids)
  on conflict (mention_id, department_id)
    do update set due_at = excluded.due_at, status = 'open', resolved_at = null, whatsapp_notified_at = null;
  get diagnostics v_count = row_count;

  update public.mentions set triage = 'routed' where id = any (p_mention_ids);
  return v_count;
end;
$$;

-- route_mentions runs as the caller and clears the notice stamp on re-routing.
grant update (whatsapp_notified_at) on public.tickets to authenticated;
