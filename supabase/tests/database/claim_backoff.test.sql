-- claim_sources backoff never overflows: a source with many consecutive
-- failures waits at most 24 hours and does not break the claim of the others
-- (production, Nov 2026: 35 failures → "interval out of range"). Fictitious data.
begin;
select plan(5);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

-- An RSS feed that has failed 40 times in a row, last error 25 h ago, not read for a week.
update public.sources set is_active = true, consecutive_failures = 40, last_error = 'El feed respondió HTTP 404.',
  last_error_at = now() - interval '25 hours', last_run_at = now() - interval '7 days',
  run_lease_id = null, run_lease_until = null
where id = '00000000-0000-4000-e200-000000000002';

select lives_ok($$ select count(*) from public.claim_sources('00000000-0000-4000-9600-00000000000a', 10, 120,
  '{rss,meta,youtube,x}') $$, 'a cron claim does not overflow with 40 consecutive failures');
update public.sources set run_lease_id = null, run_lease_until = null where id = '00000000-0000-4000-e200-000000000002';

select is((select count(*) from public.claim_sources('00000000-0000-4000-9600-00000000000b', 10, 120, '{rss}',
  '{00000000-0000-4000-e200-000000000002}')), 1::bigint, 'after 24 h the cron retries it (the wait is capped)');
update public.sources set run_lease_id = null, run_lease_until = null where id = '00000000-0000-4000-e200-000000000002';

update public.sources set last_error_at = now() - interval '23 hours' where id = '00000000-0000-4000-e200-000000000002';
select is((select count(*) from public.claim_sources('00000000-0000-4000-9600-00000000000c', 10, 120, '{rss}',
  '{00000000-0000-4000-e200-000000000002}')), 0::bigint, 'within 24 h it still waits');

-- The wait below the cap is unchanged: 4 failures → 2 h.
update public.sources set consecutive_failures = 4, last_error_at = now() - interval '90 minutes' where id = '00000000-0000-4000-e200-000000000002';
select is((select count(*) from public.claim_sources('00000000-0000-4000-9600-00000000000d', 10, 120, '{rss}',
  '{00000000-0000-4000-e200-000000000002}')), 0::bigint, '4 failures wait 2 h');
update public.sources set last_error_at = now() - interval '121 minutes' where id = '00000000-0000-4000-e200-000000000002';
select is((select count(*) from public.claim_sources('00000000-0000-4000-9600-00000000000e', 10, 120, '{rss}',
  '{00000000-0000-4000-e200-000000000002}')), 1::bigint, 'and then it runs');
reset role;

select * from finish();
rollback;
