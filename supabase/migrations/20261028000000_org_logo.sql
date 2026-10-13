-- Client logo for reports: an image in a private "branding" bucket, under
-- <org_id>/…, recorded in organizations.logo_path. Uploaded on the server by
-- an admin action (service role); members of the org may read it.

alter table public.organizations
  add column logo_path text check (logo_path is null or logo_path ~ '^[0-9a-f-]{36}/logo-[0-9]+\.(png|jpg)$'),
  add column logo_updated_at timestamptz;

-- The path must live under the org's own folder.
alter table public.organizations
  add constraint organizations_logo_in_own_folder check (logo_path is null or split_part(logo_path, '/', 1) = id::text);

-- Admins (policy "admins update their org") may also set or clear the logo.
grant update (logo_path, logo_updated_at) on public.organizations to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', false, 1048576, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

create policy "members read their branding" on storage.objects
  for select to authenticated
  using (bucket_id = 'branding' and (select private.is_member(((storage.foldername(name))[1])::uuid)));
-- Uploads and deletions happen on the server with the service role.
