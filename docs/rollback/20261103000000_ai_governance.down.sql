-- Rollback of stage 10 (20261103000000_ai_governance.sql).
--
-- Order: first deploy the previous app version (it does not know ai_calls,
-- upsert_authors or verified_authors), then run this script, then delete the
-- row of schema_migrations. Run in a transaction.
--
-- What is NOT restored: the real handles, names and followers of the accounts
-- pseudonymized by the backfill (by design they were not kept anywhere). Those
-- rows stay as kind 'citizen' with their pseudonym; mentions keep their links.
-- Authors verified by the catalog keep their real handle and kind.
begin;

-- Authors: constraints and functions first, then the columns.
alter table public.authors drop constraint if exists authors_unverified_without_identity;
alter table public.authors drop constraint if exists authors_verified_kind;
drop function if exists public.upsert_authors(uuid, uuid, jsonb);
drop function if exists public.verify_author(uuid, public.source_type, text, public.author_kind, text, text, text);
drop function if exists public.revoke_author(uuid, text);
drop function if exists private.apply_verified_author(public.verified_authors);
drop function if exists private.pseudonymize_author(uuid, text, uuid, text);
drop function if exists private.member_name(uuid);
alter table public.authors
  drop constraint if exists authors_verified_author_fk,
  drop constraint if exists authors_vouching_source_fk,
  drop column if exists verification,
  drop column if exists verified_author_id,
  drop column if exists vouching_source_id,
  drop column if exists pseudonymized_at;
drop table if exists public.author_events;
drop table if exists public.verified_authors;
drop function if exists private.author_pseudonym(uuid, public.source_type, text);
drop table if exists private.author_salts;

-- AI governance.
drop function if exists public.reserve_ai(uuid, uuid, text, text, numeric, bigint, integer);
drop function if exists public.settle_ai(uuid, text, bigint, bigint, bigint, bigint, numeric, text);
drop function if exists public.release_ai(uuid, text);
drop function if exists public.acquire_ai_lease(uuid, text, uuid, integer);
drop function if exists public.release_ai_lease(uuid, text, uuid);
drop table if exists public.ai_invoices;
drop table if exists public.ai_leases;
drop table if exists public.ai_calls;
drop table if exists public.ai_limits;
drop function if exists private.ai_purpose_label(text);
drop function if exists private.ai_default_concurrency();
drop function if exists private.ai_purposes();

-- ai_usage keeps cost_usd (priced calls); the unknown-cost counters go away.
alter table public.ai_usage
  drop column if exists unpriced_requests,
  drop column if exists unpriced_tokens,
  drop column if exists tariff_version;
comment on column public.ai_usage.cost_usd is null;

delete from supabase_migrations.schema_migrations where version = '20261103000000';
commit;
