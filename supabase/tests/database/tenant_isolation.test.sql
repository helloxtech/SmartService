begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(16);

insert into auth.users (
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
)
values
    (
        '10000000-0000-4000-a000-000000000001',
        'authenticated',
        'authenticated',
        'admin-a@smartservice.test',
        '',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
    ),
    (
        '10000000-0000-4000-a000-000000000002',
        'authenticated',
        'authenticated',
        'agent-a@smartservice.test',
        '',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
    ),
    (
        '10000000-0000-4000-a000-000000000003',
        'authenticated',
        'authenticated',
        'admin-b@smartservice.test',
        '',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
    );

insert into public.organization_members (
    organization_id,
    user_id,
    role
)
values
    (
        '00000000-0000-4000-a000-000000000001',
        '10000000-0000-4000-a000-000000000001',
        'admin'
    ),
    (
        '00000000-0000-4000-a000-000000000001',
        '10000000-0000-4000-a000-000000000002',
        'agent'
    ),
    (
        '00000000-0000-4000-a000-000000000002',
        '10000000-0000-4000-a000-000000000003',
        'admin'
    );

insert into public.conversations (
    id,
    organization_id,
    channel,
    status,
    language
)
values
    (
        '20000000-0000-4000-a000-000000000001',
        '00000000-0000-4000-a000-000000000001',
        'text',
        'active_ai',
        'zh-CN'
    ),
    (
        '20000000-0000-4000-a000-000000000002',
        '00000000-0000-4000-a000-000000000002',
        'text',
        'active_ai',
        'en'
    );

insert into public.guardrail_events (
    id,
    organization_id,
    conversation_id,
    rule_code,
    severity,
    reason,
    blocked_candidate
)
values (
    '30000000-0000-4000-a000-000000000001',
    '00000000-0000-4000-a000-000000000001',
    '20000000-0000-4000-a000-000000000001',
    'NO_SYSTEM_DISCLOSURE',
    'critical',
    'Fixed isolation test',
    'Sensitive blocked candidate'
);

set local role authenticated;
select set_config(
    'request.jwt.claim.sub',
    '10000000-0000-4000-a000-000000000001',
    true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select extensions.results_eq(
    $$select slug from public.organizations order by slug$$,
    array['novaflow-demo']::text[],
    'Tenant A Admin sees only Tenant A'
);

select extensions.ok(
    public.is_org_member('00000000-0000-4000-a000-000000000001'),
    'Tenant A Admin is recognized as a member'
);

select extensions.ok(
    public.has_org_role(
        '00000000-0000-4000-a000-000000000001',
        array['admin']::public.organization_role[]
    ),
    'Tenant A Admin has the Admin role'
);

select extensions.results_eq(
    $$
        with changed as (
            update public.organization_settings
            set display_name = 'NovaFlow Admin Verified'
            where organization_id = '00000000-0000-4000-a000-000000000001'
            returning organization_id
        )
        select count(*)::bigint from changed
    $$,
    array[1::bigint],
    'Tenant A Admin can update Tenant A settings'
);

select extensions.results_eq(
    $$
        with changed as (
            update public.organization_settings
            set display_name = 'Forbidden Cross Tenant Change'
            where organization_id = '00000000-0000-4000-a000-000000000002'
            returning organization_id
        )
        select count(*)::bigint from changed
    $$,
    array[0::bigint],
    'Tenant A Admin cannot update Tenant B settings'
);

reset role;
set local role authenticated;
select set_config(
    'request.jwt.claim.sub',
    '10000000-0000-4000-a000-000000000002',
    true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select extensions.results_eq(
    $$select slug from public.organizations order by slug$$,
    array['novaflow-demo']::text[],
    'Tenant A Agent sees only Tenant A'
);

select extensions.results_eq(
    $$
        with changed as (
            update public.organization_settings
            set display_name = 'Forbidden Agent Change'
            where organization_id = '00000000-0000-4000-a000-000000000001'
            returning organization_id
        )
        select count(*)::bigint from changed
    $$,
    array[0::bigint],
    'Agent cannot update organization settings'
);

select extensions.results_eq(
    $$
        select id
        from public.conversations
        where id = '20000000-0000-4000-a000-000000000001'
    $$,
    array['20000000-0000-4000-a000-000000000001'::uuid],
    'Agent can read a same-tenant conversation'
);

select extensions.is_empty(
    $$
        select id
        from public.conversations
        where id = '20000000-0000-4000-a000-000000000002'
    $$,
    'Agent cannot read a cross-tenant conversation'
);

select extensions.is_empty(
    $$select id from public.guardrail_events$$,
    'Agent cannot read unredacted guardrail events'
);

select extensions.lives_ok(
    $$
        insert into public.messages (
            organization_id,
            conversation_id,
            sender_type,
            sender_user_id,
            text,
            language
        )
        values (
            '00000000-0000-4000-a000-000000000001',
            '20000000-0000-4000-a000-000000000001',
            'human',
            '10000000-0000-4000-a000-000000000002',
            'Same-tenant human response',
            'zh-CN'
        )
    $$,
    'Agent can add a same-tenant human response'
);

select extensions.throws_ok(
    $$
        insert into public.messages (
            organization_id,
            conversation_id,
            sender_type,
            sender_user_id,
            text,
            language
        )
        values (
            '00000000-0000-4000-a000-000000000002',
            '20000000-0000-4000-a000-000000000002',
            'human',
            '10000000-0000-4000-a000-000000000002',
            'Forbidden cross-tenant response',
            'en'
        )
    $$,
    '42501',
    'new row violates row-level security policy for table "messages"',
    'Agent cannot add a cross-tenant response'
);

select extensions.throws_ok(
    $$
        insert into public.messages (
            organization_id,
            conversation_id,
            sender_type,
            sender_user_id,
            text,
            language
        )
        values (
            '00000000-0000-4000-a000-000000000001',
            '20000000-0000-4000-a000-000000000001',
            'ai',
            '10000000-0000-4000-a000-000000000002',
            'Forbidden AI impersonation',
            'zh-CN'
        )
    $$,
    '42501',
    'new row violates row-level security policy for table "messages"',
    'Agent cannot impersonate the AI sender'
);

reset role;
set local role authenticated;
select set_config(
    'request.jwt.claim.sub',
    '10000000-0000-4000-a000-000000000001',
    true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select extensions.results_eq(
    $$select id from public.guardrail_events$$,
    array['30000000-0000-4000-a000-000000000001'::uuid],
    'Admin can read same-tenant unredacted guardrail events'
);

reset role;
set local role authenticated;
select set_config(
    'request.jwt.claim.sub',
    '10000000-0000-4000-a000-000000000003',
    true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select extensions.results_eq(
    $$select slug from public.organizations order by slug$$,
    array['harborworks-isolation']::text[],
    'Tenant B Admin sees only Tenant B'
);

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);

select extensions.throws_ok(
    $$select id from public.organizations$$,
    '42501',
    'permission denied for table organizations',
    'Anonymous callers have no direct tenant-table permission'
);

reset role;
select extensions.finish();

rollback;
