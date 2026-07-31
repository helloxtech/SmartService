begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(12);

select extensions.has_table(
    'public',
    'voice_sessions',
    'Voice sessions are persisted in a dedicated tenant-owned table'
);

select extensions.results_eq(
    $$
        select enum_value
        from unnest(enum_range(null::public.conversation_channel)) as enum_value
        order by enum_value::text
    $$,
    array['text'::public.conversation_channel, 'voice'::public.conversation_channel],
    'Conversation channels include the Day 6 voice path'
);

select extensions.ok(
    (
        select relrowsecurity and relforcerowsecurity
        from pg_catalog.pg_class
        where oid = 'public.voice_sessions'::regclass
    ),
    'Voice sessions enable and force row-level security'
);

select extensions.ok(
    not pg_catalog.has_table_privilege(
        'authenticated',
        'public.voice_sessions',
        'SELECT'
    ),
    'Authenticated browser clients cannot read voice sessions directly'
);

select extensions.ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.create_voice_session(uuid,uuid,text,text,text,text)',
        'EXECUTE'
    ),
    'Authenticated browser clients cannot create voice sessions directly'
);

set local role service_role;

create temporary table created_voice_conversation
on commit drop
as
select *
from public.create_public_conversation(
    'smart-service-public-demo',
    'voice',
    'Voice Fixture',
    null,
    null,
    null,
    'zh-CN',
    'voice-runtime-fixture',
    'pgtap-voice-conversation'
);

create temporary table created_voice_session
on commit drop
as
select *
from public.create_voice_session(
    '00000000-0000-4000-a000-000000000001',
    (select conversation_id from created_voice_conversation),
    'ss-voice-runtime-fixture',
    'customer-voice-runtime-fixture',
    'mock',
    'pgtap-voice-session'
);

select extensions.results_eq(
    $$select created from created_voice_session$$,
    array[true],
    'The first token exchange creates one voice session'
);

select extensions.results_eq(
    $$
        select replay.voice_session_id
        from public.create_voice_session(
            '00000000-0000-4000-a000-000000000001',
            (select conversation_id from created_voice_conversation),
            'different-replay-room-is-ignored',
            'different-replay-identity-is-ignored',
            'mock',
            'pgtap-voice-session-replay'
        ) as replay
    $$,
    array[(select voice_session_id from created_voice_session)],
    'Voice-session creation is idempotent per tenant conversation'
);

select extensions.throws_ok(
    $$
        select *
        from public.create_voice_session(
            '00000000-0000-4000-a000-000000000002',
            (select conversation_id from created_voice_conversation),
            'cross-tenant-room',
            'cross-tenant-participant',
            'mock',
            'pgtap-cross-tenant-voice'
        )
    $$,
    'P0001',
    'voice_conversation_not_available',
    'A voice session cannot be created across tenant boundaries'
);

select extensions.ok(
    public.update_voice_session_status(
        (select voice_session_id from created_voice_session),
        'ready',
        null,
        'pgtap-voice-ready'
    ),
    'The internal runtime can mark the exact voice session Ready'
);

select extensions.results_eq(
    $$
        select status
        from public.voice_sessions
        where id = (select voice_session_id from created_voice_session)
    $$,
    array['ready'::text],
    'Ready status is persisted'
);

select extensions.ok(
    (
        select ready_at is not null
        from public.voice_sessions
        where id = (select voice_session_id from created_voice_session)
    ),
    'Ready status records its lifecycle timestamp'
);

select extensions.is(
    (
        select count(*)::integer
        from public.voice_sessions
        where organization_id = '00000000-0000-4000-a000-000000000001'
          and conversation_id = (select conversation_id from created_voice_conversation)
    ),
    1,
    'Only one voice session exists for the conversation'
);

select * from extensions.finish();

rollback;
