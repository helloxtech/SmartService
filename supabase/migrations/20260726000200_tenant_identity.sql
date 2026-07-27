create table public.organizations (
    id uuid primary key default extensions.gen_random_uuid(),
    name text not null check (char_length(name) between 1 and 120),
    slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    public_key text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

revoke all on schema public from public;
grant usage on schema public to authenticated, service_role;

create table public.organization_members (
    organization_id uuid not null references public.organizations(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role public.organization_role not null,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (organization_id, user_id)
);

create index organization_members_user_active_idx
on public.organization_members (user_id, is_active, organization_id);

create table public.organization_settings (
    organization_id uuid primary key references public.organizations(id) on delete cascade,
    display_name text not null check (char_length(display_name) between 1 and 120),
    default_language text not null default 'zh-CN'
        check (default_language in ('zh-CN', 'en')),
    chat_welcome_message text not null default '您好，请问有什么可以帮您？'
        check (char_length(chat_welcome_message) between 1 and 500),
    voice_enabled boolean not null default false
        check (voice_enabled = false),
    r11_enabled boolean not null default false
        check (r11_enabled = false),
    retention_days integer not null default 30
        check (retention_days between 1 and 365),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create trigger organization_members_set_updated_at
before update on public.organization_members
for each row execute function public.set_updated_at();

create trigger organization_settings_set_updated_at
before update on public.organization_settings
for each row execute function public.set_updated_at();

create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.organization_members as organization_member
        where organization_member.organization_id = p_organization_id
          and organization_member.user_id = (select auth.uid())
          and organization_member.is_active = true
    );
$$;

create or replace function public.has_org_role(
    p_organization_id uuid,
    p_roles public.organization_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.organization_members as organization_member
        where organization_member.organization_id = p_organization_id
          and organization_member.user_id = (select auth.uid())
          and organization_member.is_active = true
          and organization_member.role = any(p_roles)
    );
$$;

revoke all on function public.set_updated_at() from public;
revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_org_role(uuid, public.organization_role[]) from public;

grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.has_org_role(uuid, public.organization_role[]) to authenticated, service_role;

alter table public.organizations enable row level security;
alter table public.organizations force row level security;
alter table public.organization_members enable row level security;
alter table public.organization_members force row level security;
alter table public.organization_settings enable row level security;
alter table public.organization_settings force row level security;

revoke all on public.organizations from anon, authenticated;
revoke all on public.organization_members from anon, authenticated;
revoke all on public.organization_settings from anon, authenticated;

grant select on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_members to authenticated;
grant select, insert, update on public.organization_settings to authenticated;
grant all on public.organizations to service_role;
grant all on public.organization_members to service_role;
grant all on public.organization_settings to service_role;

create policy organizations_select_member
on public.organizations
for select
to authenticated
using ((select public.is_org_member(id)));

create policy organization_members_select_member
on public.organization_members
for select
to authenticated
using ((select public.is_org_member(organization_id)));

create policy organization_members_insert_admin
on public.organization_members
for insert
to authenticated
with check (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
);

create policy organization_members_update_admin
on public.organization_members
for update
to authenticated
using (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
)
with check (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
);

create policy organization_members_delete_admin
on public.organization_members
for delete
to authenticated
using (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
);

create policy organization_settings_select_member
on public.organization_settings
for select
to authenticated
using ((select public.is_org_member(organization_id)));

create policy organization_settings_insert_admin
on public.organization_settings
for insert
to authenticated
with check (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
);

create policy organization_settings_update_admin
on public.organization_settings
for update
to authenticated
using (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
)
with check (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
);
