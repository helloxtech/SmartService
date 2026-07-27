alter table public.organization_settings
drop constraint if exists organization_settings_voice_enabled_check;

update public.organization_settings
set voice_enabled = true,
    updated_at = now()
where organization_id = '00000000-0000-4000-a000-000000000001';

create table public.voice_sessions (
    id uuid primary key default extensions.gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    conversation_id uuid not null,
    room_name text not null check (char_length(room_name) between 1 and 180),
    participant_identity text not null check (char_length(participant_identity) between 1 and 180),
    provider text not null check (provider in ('livekit', 'mock')),
    status text not null default 'warming'
        check (status in ('warming', 'ready', 'active', 'handoff', 'closed', 'failed')),
    error_code text check (error_code is null or char_length(error_code) between 1 and 120),
    ready_at timestamptz,
    started_at timestamptz,
    ended_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, conversation_id),
    unique (organization_id, room_name),
    unique (id, organization_id),
    foreign key (conversation_id, organization_id)
        references public.conversations(id, organization_id)
        on delete cascade
);

create index voice_sessions_org_status_idx
on public.voice_sessions (organization_id, status, created_at desc);

create index voice_sessions_conversation_idx
on public.voice_sessions (conversation_id, organization_id);

alter table public.voice_sessions enable row level security;
alter table public.voice_sessions force row level security;

revoke all on table public.voice_sessions from public, anon, authenticated;
grant all on table public.voice_sessions to service_role;

create or replace function public.create_voice_session(
    p_organization_id uuid,
    p_conversation_id uuid,
    p_room_name text,
    p_participant_identity text,
    p_provider text,
    p_request_id text
)
returns table (
    voice_session_id uuid,
    created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_created boolean := false;
    v_voice_session_id uuid;
begin
    if char_length(p_room_name) not between 1 and 180
        or char_length(p_participant_identity) not between 1 and 180
        or p_provider not in ('livekit', 'mock')
    then
        raise exception 'invalid_voice_session_input';
    end if;

    if not exists (
        select 1
        from public.conversations as conversation
        join public.organization_settings as setting
          on setting.organization_id = conversation.organization_id
        where conversation.id = p_conversation_id
          and conversation.organization_id = p_organization_id
          and conversation.channel = 'voice'
          and conversation.status = 'active_ai'
          and setting.voice_enabled
    ) then
        raise exception 'voice_conversation_not_available';
    end if;

    insert into public.voice_sessions (
        organization_id,
        conversation_id,
        room_name,
        participant_identity,
        provider
    )
    values (
        p_organization_id,
        p_conversation_id,
        p_room_name,
        p_participant_identity,
        p_provider
    )
    on conflict (organization_id, conversation_id) do nothing
    returning id into v_voice_session_id;

    if v_voice_session_id is not null then
        v_created := true;
    else
        select voice_session.id
        into v_voice_session_id
        from public.voice_sessions as voice_session
        where voice_session.organization_id = p_organization_id
          and voice_session.conversation_id = p_conversation_id;
    end if;

    if v_created then
        insert into public.audit_logs (
            organization_id,
            action,
            entity_type,
            entity_id,
            request_id,
            metadata
        )
        values (
            p_organization_id,
            'voice.session.created',
            'voice_session',
            v_voice_session_id,
            p_request_id,
            jsonb_build_object('provider', p_provider)
        );
    end if;

    return query select v_voice_session_id, v_created;
end;
$$;

create or replace function public.update_voice_session_status(
    p_voice_session_id uuid,
    p_status text,
    p_error_code text,
    p_request_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_organization_id uuid;
begin
    if p_status not in ('warming', 'ready', 'active', 'handoff', 'closed', 'failed')
        or (p_error_code is not null and char_length(p_error_code) not between 1 and 120)
    then
        raise exception 'invalid_voice_session_status';
    end if;

    update public.voice_sessions
    set status = p_status,
        error_code = p_error_code,
        ready_at = case
            when p_status = 'ready' then coalesce(ready_at, now())
            else ready_at
        end,
        started_at = case
            when p_status = 'active' then coalesce(started_at, now())
            else started_at
        end,
        ended_at = case
            when p_status in ('closed', 'failed') then coalesce(ended_at, now())
            else ended_at
        end,
        updated_at = now()
    where id = p_voice_session_id
    returning organization_id into v_organization_id;

    if v_organization_id is null then
        return false;
    end if;

    insert into public.audit_logs (
        organization_id,
        action,
        entity_type,
        entity_id,
        request_id,
        metadata
    )
    values (
        v_organization_id,
        'voice.session.status_updated',
        'voice_session',
        p_voice_session_id,
        p_request_id,
        jsonb_build_object('status', p_status, 'errorCode', p_error_code)
    );

    return true;
end;
$$;

revoke all on function public.create_voice_session(
    uuid,
    uuid,
    text,
    text,
    text,
    text
) from public;
revoke all on function public.update_voice_session_status(
    uuid,
    text,
    text,
    text
) from public;

grant execute on function public.create_voice_session(
    uuid,
    uuid,
    text,
    text,
    text,
    text
) to service_role;
grant execute on function public.update_voice_session_status(
    uuid,
    text,
    text,
    text
) to service_role;
