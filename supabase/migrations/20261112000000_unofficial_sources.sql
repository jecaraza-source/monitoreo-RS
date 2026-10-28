-- Unofficial sources (Radar Social, delivery 3): feeds built by a self-hosted
-- RSSHub / RSS-Bridge ('rss_bridge') and results of Apify scraper tasks
-- ('apify'). They read public content through third parties, outside the
-- networks' official APIs, so connecting or reconfiguring one is an admin
-- decision: comunicación can still see, test, pause or delete them. Authors
-- are never stored for these types (the connectors return none). Repeatable.
-- Rollback: docs/rollback/20261112000000_unofficial_sources.down.sql
alter type public.source_type add value if not exists 'rss_bridge';
alter type public.source_type add value if not exists 'apify';

create or replace function private.guard_unofficial_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Compared as text: the new enum values cannot be used as literals in the transaction that adds them.
  if new.type::text not in ('rss_bridge', 'apify') then
    return new;
  end if;
  -- The ingest worker (service role, no user) updates watermarks and errors.
  if (select auth.uid()) is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.name is not distinct from old.name and new.config is not distinct from old.config then
    return new; -- pausing, resuming or tuning freshness thresholds
  end if;
  if not private.has_role(new.org_id, '{admin}') then
    raise exception 'Sólo administración puede conectar o configurar fuentes no oficiales.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_unofficial_source on public.sources;
create trigger guard_unofficial_source before insert or update on public.sources
  for each row execute function private.guard_unofficial_source();
