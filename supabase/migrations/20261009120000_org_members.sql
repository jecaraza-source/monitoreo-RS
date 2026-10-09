-- Members of an organization with their email, for the admin users screen.
-- auth.users is not exposed through the Data API, so this SECURITY DEFINER
-- function returns only what that screen needs, and only to the org's admins.

create function public.org_members(p_org_id uuid)
returns table (
  user_id uuid,
  email text,
  role public.membership_role,
  department_id uuid,
  department_name text,
  invited_at timestamptz,
  last_sign_in_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.user_id,
    u.email::text,
    m.role,
    m.department_id,
    d.name,
    m.created_at,
    u.last_sign_in_at
  from public.memberships m
  join auth.users u on u.id = m.user_id
  left join public.departments d on d.id = m.department_id
  where m.org_id = p_org_id
    and private.has_role(p_org_id, '{admin}')
  order by m.created_at;
$$;

revoke execute on function public.org_members(uuid) from public, anon;
grant execute on function public.org_members(uuid) to authenticated;
