-- Perception of public officials: what citizens say about the mayor and the
-- officials' own performance (not only about services). Restricted module:
-- each user needs explicit access, every query is logged, and citizens stay
-- anonymous (only media and public figures are named).

-- ---------------------------------------------------------------------------
-- Access: an explicit grant per member (admins always have it)
-- ---------------------------------------------------------------------------

alter table public.memberships add column can_view_officials boolean not null default false;

create function private.can_view_officials(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = p_org_id
      and m.user_id = (select auth.uid())
      and (m.role = 'admin' or (m.can_view_officials and m.role in ('comunicacion', 'lectura')))
  );
$$;
revoke execute on function private.can_view_officials(uuid) from public, anon;
grant execute on function private.can_view_officials(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Catalog of officials (public figures in their public role)
-- ---------------------------------------------------------------------------

create table public.officials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 3 and 120),
  position text not null check (char_length(position) between 2 and 120),
  -- Ways citizens refer to them ("la alcaldesa", "@usuario", apellido…).
  aliases text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, name),
  unique (org_id, id)
);

alter table public.officials enable row level security;
create policy "authorized read officials" on public.officials
  for select to authenticated using ((select private.can_view_officials(org_id)));
create policy "admins manage officials" on public.officials
  for all to authenticated
  using ((select private.has_role(org_id, '{admin}')))
  with check ((select private.has_role(org_id, '{admin}')));
revoke all on public.officials from anon;

create trigger audit_officials after insert or update or delete on public.officials
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- Which mentions talk about which official (name or alias as a phrase in the
-- accent-insensitive search vector). Kept by triggers; read only via RPCs.
-- ---------------------------------------------------------------------------

create table public.official_mentions (
  org_id uuid not null,
  official_id uuid not null,
  mention_id uuid not null,
  published_at timestamptz not null,
  primary key (official_id, mention_id),
  foreign key (org_id, official_id) references public.officials (org_id, id) on delete cascade,
  foreign key (org_id, mention_id) references public.mentions (org_id, id) on delete cascade
);
create index official_mentions_org_published_idx on public.official_mentions (org_id, published_at);
create index official_mentions_mention_idx on public.official_mentions (mention_id);

alter table public.official_mentions enable row level security;
revoke all on public.official_mentions from anon, authenticated;

-- Search terms of an official: the name plus aliases, without '@' or blanks.
create function private.official_terms(p_name text, p_aliases text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct t), '{}')
  from (
    select nullif(btrim(regexp_replace(x, '^@', '')), '') as t
    from unnest(array_prepend(p_name, p_aliases)) as x
  ) s
  where t is not null and char_length(t) >= 3;
$$;

create function private.match_official_mentions(p_official_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_official public.officials;
begin
  select * into v_official from public.officials where id = p_official_id;
  delete from public.official_mentions where official_id = p_official_id;
  if v_official.id is null or not v_official.is_active then
    return;
  end if;
  insert into public.official_mentions (org_id, official_id, mention_id, published_at)
  select distinct m.org_id, v_official.id, m.id, m.published_at
  from public.mentions m
  cross join unnest(private.official_terms(v_official.name, v_official.aliases)) as term
  where m.org_id = v_official.org_id
    and m.search @@ phraseto_tsquery('public.spanish_unaccent', term)
  on conflict do nothing;
end;
$$;
revoke execute on function private.match_official_mentions(uuid) from public, anon, authenticated;

create function private.officials_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.match_official_mentions(new.id);
  return null;
end;
$$;
revoke execute on function private.officials_changed() from public, anon, authenticated;

create trigger officials_match
  after insert or update of name, aliases, is_active on public.officials
  for each row execute function private.officials_changed();

create function private.mention_match_officials()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.official_mentions (org_id, official_id, mention_id, published_at)
  select distinct new.org_id, o.id, new.id, new.published_at
  from public.officials o
  cross join unnest(private.official_terms(o.name, o.aliases)) as term
  where o.org_id = new.org_id
    and o.is_active
    and new.search @@ phraseto_tsquery('public.spanish_unaccent', term)
  on conflict do nothing;
  return null;
end;
$$;
revoke execute on function private.mention_match_officials() from public, anon, authenticated;

create trigger mentions_match_officials
  after insert on public.mentions
  for each row execute function private.mention_match_officials();

-- ---------------------------------------------------------------------------
-- Audit: each consultation of the module is logged ('view')
-- ---------------------------------------------------------------------------

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('insert', 'update', 'delete', 'export', 'send', 'purge', 'view'));

-- ---------------------------------------------------------------------------
-- Aggregates per official for a period (and the previous one, for change)
-- ---------------------------------------------------------------------------

create function public.officials_stats(p_org_id uuid, p_from timestamptz, p_to timestamptz, p_prev_from timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.can_view_officials(p_org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, changes)
  values (p_org_id, (select auth.uid()), 'view', 'officials', null,
          jsonb_build_object('from', p_from, 'to', p_to));

  with base as (
    select om.official_id, m.published_at, c.sentiment, c.topic, c.emotion,
           coalesce((m.metrics ->> 'likes')::bigint, 0) + coalesce((m.metrics ->> 'shares')::bigint, 0)
             + coalesce((m.metrics ->> 'comments')::bigint, 0) as interactions
    from public.official_mentions om
    join public.mentions m on m.id = om.mention_id
    left join public.classifications c on c.mention_id = m.id
    where om.org_id = p_org_id and om.published_at >= p_prev_from and om.published_at < p_to
  ),
  cur as (select * from base where published_at >= p_from),
  per_official as (
    select o.id, o.name, o.position,
      count(cur.official_id) as mentions,
      count(*) filter (where cur.sentiment = 'positive') as positive,
      count(*) filter (where cur.sentiment = 'neutral') as neutral,
      count(*) filter (where cur.sentiment = 'negative') as negative,
      coalesce(sum(cur.interactions), 0) as interactions,
      (select count(*) from base b where b.official_id = o.id and b.published_at < p_from) as prev_mentions,
      (select count(*) filter (where b.sentiment = 'negative') from base b where b.official_id = o.id and b.published_at < p_from) as prev_negative,
      (select count(*) filter (where b.sentiment = 'positive') from base b where b.official_id = o.id and b.published_at < p_from) as prev_positive
    from public.officials o
    left join cur on cur.official_id = o.id
    where o.org_id = p_org_id and o.is_active
    group by o.id, o.name, o.position
  )
  select jsonb_build_object(
    'officials', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'position', p.position,
        'mentions', p.mentions, 'positive', p.positive, 'neutral', p.neutral, 'negative', p.negative,
        'interactions', p.interactions,
        'prev_mentions', p.prev_mentions, 'prev_positive', p.prev_positive, 'prev_negative', p.prev_negative,
        'daily', coalesce((
          select jsonb_agg(jsonb_build_object('day', d.day, 'positive', d.positive, 'neutral', d.neutral, 'negative', d.negative) order by d.day)
          from (
            select (date_trunc('day', cur.published_at at time zone 'America/Mexico_City'))::date as day,
                   count(*) filter (where cur.sentiment = 'positive') as positive,
                   count(*) filter (where cur.sentiment = 'neutral' or cur.sentiment is null) as neutral,
                   count(*) filter (where cur.sentiment = 'negative') as negative
            from cur where cur.official_id = p.id group by 1
          ) d
        ), '[]'::jsonb),
        'topics', coalesce((
          select jsonb_agg(jsonb_build_object('topic', t.topic, 'mentions', t.n, 'negative', t.neg) order by t.n desc)
          from (
            select coalesce(cur.topic, 'sin tema') as topic, count(*) as n, count(*) filter (where cur.sentiment = 'negative') as neg
            from cur where cur.official_id = p.id group by 1 order by 2 desc limit 6
          ) t
        ), '[]'::jsonb),
        'emotions', coalesce((
          select jsonb_agg(jsonb_build_object('emotion', e.emotion, 'mentions', e.n) order by e.n desc)
          from (
            select cur.emotion, count(*) as n
            from cur where cur.official_id = p.id and cur.emotion is not null and cur.emotion <> 'neutral'
            group by 1 order by 2 desc limit 5
          ) e
        ), '[]'::jsonb)
      ) order by p.mentions desc, p.name)
      from per_official p
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke execute on function public.officials_stats(uuid, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.officials_stats(uuid, timestamptz, timestamptz, timestamptz) to authenticated;

-- Mentions about one official. Citizens are anonymous: no author, handle or
-- link unless the author is a media outlet or a public figure.
create function public.official_mentions_list(
  p_org_id uuid,
  p_official_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_sentiment public.sentiment default null,
  p_limit integer default 30
)
returns table (
  mention_id uuid,
  published_at timestamptz,
  text text,
  sentiment public.sentiment,
  topic text,
  emotion text,
  source text,
  author text,
  url text,
  interactions bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_view_officials(p_org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select m.id, m.published_at, m.text, c.sentiment, c.topic, c.emotion, s.name,
         case when a.kind in ('media', 'public_figure') then coalesce(a.display_name, a.handle) end,
         case when a.kind in ('media', 'public_figure') then m.url end,
         coalesce((m.metrics ->> 'likes')::bigint, 0) + coalesce((m.metrics ->> 'shares')::bigint, 0)
           + coalesce((m.metrics ->> 'comments')::bigint, 0)
  from public.official_mentions om
  join public.mentions m on m.id = om.mention_id
  left join public.classifications c on c.mention_id = m.id
  left join public.sources s on s.id = m.source_id
  left join public.authors a on a.id = m.author_id
  where om.org_id = p_org_id
    and om.official_id = p_official_id
    and om.published_at >= p_from and om.published_at < p_to
    and (p_sentiment is null or c.sentiment = p_sentiment)
  order by m.published_at desc
  limit least(greatest(p_limit, 1), 100);
end;
$$;

revoke execute on function public.official_mentions_list(uuid, uuid, timestamptz, timestamptz, public.sentiment, integer) from public, anon;
grant execute on function public.official_mentions_list(uuid, uuid, timestamptz, timestamptz, public.sentiment, integer) to authenticated;

-- Whether the current user may open the module (for the menu).
create function public.can_view_officials(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_view_officials(p_org_id);
$$;
revoke execute on function public.can_view_officials(uuid) from public, anon;
grant execute on function public.can_view_officials(uuid) to authenticated;
