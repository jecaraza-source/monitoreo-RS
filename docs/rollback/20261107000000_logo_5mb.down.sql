-- Rollback of 20261107000000_logo_5mb.sql: back to 1 MB. Logos already
-- uploaded keep working; new ones above 1 MB are rejected again.
begin;
update storage.buckets set file_size_limit = 1048576 where id = 'branding';
delete from supabase_migrations.schema_migrations where version = '20261107000000';
commit;
