-- Reversión de supabase/migrations/20261028000000_org_logo.sql.
-- Se pierde la referencia al logotipo; los archivos del bucket "branding" se
-- borran desde Storage (el panel o la API) antes de eliminar el bucket.
begin;
drop policy "members read their branding" on storage.objects;
revoke update (logo_path, logo_updated_at) on public.organizations from authenticated;
alter table public.organizations drop constraint organizations_logo_in_own_folder;
alter table public.organizations drop column logo_path, drop column logo_updated_at;
delete from supabase_migrations.schema_migrations where version = '20261028000000';
commit;
-- Después, borrar el bucket "branding" desde el panel de Storage o la API (Supabase no permite
-- borrarlo por SQL). Si se deja, no afecta: nadie lo usa sin la columna logo_path.
