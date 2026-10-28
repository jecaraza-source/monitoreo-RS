-- New official sources: Bluesky (AT Protocol) and Reddit (Data API).
-- Only adds the source types; authors, pseudonyms and the verified catalog
-- work the same as for the other platforms. Repeatable.
-- Rollback: docs/rollback/20261111000000_bluesky_reddit.down.sql
alter type public.source_type add value if not exists 'bluesky';
alter type public.source_type add value if not exists 'reddit';
