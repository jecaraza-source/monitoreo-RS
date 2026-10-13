-- Client logo up to 5 MB (was 1 MB). The bucket enforces the size and the
-- type (PNG/JPEG) on every upload; the app uploads with a single-use signed
-- URL issued only to Administración and checks the bytes afterwards.
-- Repeatable. Rollback: docs/rollback/20261107000000_logo_5mb.down.sql.
update storage.buckets set file_size_limit = 5242880 where id = 'branding';
