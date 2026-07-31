begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(30);

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
    array['xflow-demo']::text[],
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
            set display_name = 'XFlow Admin Verified'
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
    array['xflow-demo']::text[],
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

select extensions.ok(
    not pg_catalog.has_table_privilege(
        'authenticated',
        'public.guardrail_events',
        'SELECT'
    ),
    'Authenticated clients cannot query unredacted guardrail events directly'
);

select extensions.ok(
    not pg_catalog.has_table_privilege(
        'authenticated',
        'public.messages',
        'INSERT'
    ),
    'Authenticated clients must use the Worker state transition to send human messages'
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
    'permission denied for table messages',
    'Agent cannot bypass the Worker to add a cross-tenant response'
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
    'permission denied for table messages',
    'Agent cannot bypass the Worker to impersonate the AI sender'
);

reset role;
set local role authenticated;
select set_config(
    'request.jwt.claim.sub',
    '10000000-0000-4000-a000-000000000001',
    true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select extensions.ok(
    not pg_catalog.has_table_privilege(
        'authenticated',
        'public.guardrail_events',
        'SELECT'
    ),
    'Admin must use the explicit Worker endpoint to read a blocked candidate'
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

select extensions.ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.create_knowledge_ingestion(uuid,uuid,public.knowledge_source_type,text,text,text,text,integer,numeric,integer,integer,text,text)',
        'EXECUTE'
    ),
    'Authenticated clients cannot execute the service-only intake function'
);

select extensions.ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.complete_knowledge_ingestion(uuid,jsonb,jsonb)',
        'EXECUTE'
    ),
    'Authenticated clients cannot execute the service-only completion function'
);

reset role;
set local role service_role;

create temporary table day2_ingestion_fixture
on commit drop
as
select *
from public.create_knowledge_ingestion(
    '00000000-0000-4000-a000-000000000001',
    '10000000-0000-4000-a000-000000000001',
    'pdf',
    'Day 2 ingestion fixture',
    null,
    'org/00000000-0000-4000-a000-000000000001/uploads/original/day2.pdf',
    'org/00000000-0000-4000-a000-000000000001/uploads/extracted/day2.json',
    1,
    0.25,
    null,
    null,
    'day2-ingestion-fixture',
    'pgtap-day2-create'
);

select extensions.results_eq(
    $$
        select
            knowledge_source.organization_id::text
                || ':' || ingestion_job.target_version::text
                || ':' || ingestion_job.status::text
        from day2_ingestion_fixture as fixture
        join public.knowledge_sources as knowledge_source
          on knowledge_source.id = fixture.source_id
        join public.ingestion_jobs as ingestion_job
          on ingestion_job.id = fixture.job_id
    $$,
    array['00000000-0000-4000-a000-000000000001:1:uploaded']::text[],
    'Service intake creates a tenant-routed version-one source and job'
);

create temporary table day2_duplicate_fixture
on commit drop
as
select *
from public.create_knowledge_ingestion(
    '00000000-0000-4000-a000-000000000001',
    '10000000-0000-4000-a000-000000000001',
    'pdf',
    'Ignored duplicate title',
    null,
    'org/00000000-0000-4000-a000-000000000001/uploads/original/ignored.pdf',
    'org/00000000-0000-4000-a000-000000000001/uploads/extracted/ignored.json',
    1,
    0.25,
    null,
    null,
    'day2-ingestion-fixture',
    'pgtap-day2-duplicate'
);

select extensions.results_eq(
    $$
        select count(*)::bigint
        from public.knowledge_sources
        where name = 'Day 2 ingestion fixture'
    $$,
    array[1::bigint],
    'Repeated intake idempotency keys do not create duplicate sources'
);

do $day2_complete$
declare
    v_job_id uuid;
    v_embedding text;
begin
    select job_id
    into v_job_id
    from day2_ingestion_fixture;

    v_embedding := '['
        || pg_catalog.array_to_string(
            pg_catalog.array_fill(0.001::numeric, array[1024]),
            ','
        )
        || ']';

    perform public.complete_knowledge_ingestion(
        v_job_id,
        pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'id', '41000000-0000-4000-a000-000000000001',
                'title', 'Day 2 document',
                'canonical_url', null,
                'content_hash', pg_catalog.repeat('a', 64),
                'metadata', '{}'::jsonb
            )
        ),
        pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'id', '42000000-0000-4000-a000-000000000001',
                'document_id', '41000000-0000-4000-a000-000000000001',
                'chunk_index', 0,
                'content', 'Day 2 grounded retrieval fixture content.',
                'content_hash', pg_catalog.repeat('b', 64),
                'embedding', v_embedding,
                'source_locator', '{"pageStart":1,"pageEnd":1}'::jsonb,
                'metadata', '{}'::jsonb
            )
        )
    );
end;
$day2_complete$;

select extensions.results_eq(
    $$
        select
            knowledge_source.status::text
                || ':' || knowledge_source.active_version::text
                || ':' || knowledge_source.document_count::text
                || ':' || knowledge_source.chunk_count::text
                || ':' || extensions.vector_dims(knowledge_chunk.embedding)::text
        from day2_ingestion_fixture as fixture
        join public.knowledge_sources as knowledge_source
          on knowledge_source.id = fixture.source_id
        join public.knowledge_chunks as knowledge_chunk
          on knowledge_chunk.source_id = fixture.source_id
    $$,
    array['ready:1:1:1:1024']::text[],
    'Atomic completion stores one 1024-dimension chunk and activates version one'
);

do $day2_repeat_complete$
declare
    v_job_id uuid;
begin
    select job_id
    into v_job_id
    from day2_ingestion_fixture;

    perform public.complete_knowledge_ingestion(
        v_job_id,
        '[{}]'::jsonb,
        '[{}]'::jsonb
    );
end;
$day2_repeat_complete$;

select extensions.results_eq(
    $$
        select count(*)::bigint
        from public.knowledge_chunks
        where source_id = (
            select source_id
            from day2_ingestion_fixture
        )
    $$,
    array[1::bigint],
    'A completed ingestion job ignores duplicate Queue delivery without creating rows'
);

reset role;
set local role authenticated;
select set_config(
    'request.jwt.claim.sub',
    '10000000-0000-4000-a000-000000000003',
    true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select extensions.is_empty(
    $$
        select id
        from public.knowledge_sources
        where name = 'Day 2 ingestion fixture'
    $$,
    'Tenant B cannot read Tenant A knowledge created by the ingestion service'
);

reset role;
set local role service_role;

select *
from public.manage_knowledge_source(
    '00000000-0000-4000-a000-000000000001',
    (select source_id from day2_ingestion_fixture),
    '10000000-0000-4000-a000-000000000001',
    'disable',
    'pgtap-day2-disable'
);

select extensions.results_eq(
    $$
        select
            knowledge_source.status::text
                || ':' || knowledge_source.enabled::text
                || ':' || knowledge_chunk.enabled::text
        from day2_ingestion_fixture as fixture
        join public.knowledge_sources as knowledge_source
          on knowledge_source.id = fixture.source_id
        join public.knowledge_chunks as knowledge_chunk
          on knowledge_chunk.source_id = fixture.source_id
    $$,
    array['disabled:false:false']::text[],
    'Disabling a source atomically removes its active chunks from retrieval'
);

select *
from public.manage_knowledge_source(
    '00000000-0000-4000-a000-000000000001',
    (select source_id from day2_ingestion_fixture),
    '10000000-0000-4000-a000-000000000001',
    'enable',
    'pgtap-day2-enable'
);

select extensions.results_eq(
    $$
        select
            knowledge_source.status::text
                || ':' || knowledge_source.enabled::text
                || ':' || knowledge_chunk.enabled::text
        from day2_ingestion_fixture as fixture
        join public.knowledge_sources as knowledge_source
          on knowledge_source.id = fixture.source_id
        join public.knowledge_chunks as knowledge_chunk
          on knowledge_chunk.source_id = fixture.source_id
    $$,
    array['ready:true:true']::text[],
    'Enabling a source restores only its active-version chunks'
);

create temporary table day2_retry_fixture
on commit drop
as
select *
from public.retry_knowledge_ingestion(
    '00000000-0000-4000-a000-000000000001',
    (select source_id from day2_ingestion_fixture),
    '10000000-0000-4000-a000-000000000001',
    'day2-retry-fixture',
    'pgtap-day2-retry'
);

select extensions.results_eq(
    $$
        select
            ingestion_job.target_version::text
                || ':' || knowledge_source.active_version::text
                || ':' || knowledge_chunk.enabled::text
        from day2_retry_fixture as retry_fixture
        join public.ingestion_jobs as ingestion_job
          on ingestion_job.id = retry_fixture.job_id
        join public.knowledge_sources as knowledge_source
          on knowledge_source.id = retry_fixture.source_id
        join public.knowledge_chunks as knowledge_chunk
          on knowledge_chunk.source_id = retry_fixture.source_id
    $$,
    array['2:1:true']::text[],
    'Reprocessing targets version two while version one remains retrievable until completion'
);

create temporary table day2_duplicate_retry_fixture
on commit drop
as
select *
from public.retry_knowledge_ingestion(
    '00000000-0000-4000-a000-000000000001',
    (select source_id from day2_ingestion_fixture),
    '10000000-0000-4000-a000-000000000001',
    'day2-retry-fixture',
    'pgtap-day2-retry-duplicate'
);

select extensions.results_eq(
    $$
        select retry_fixture.job_id = duplicate_fixture.job_id
        from day2_retry_fixture as retry_fixture
        cross join day2_duplicate_retry_fixture as duplicate_fixture
    $$,
    array[true],
    'A repeated retry idempotency key returns the existing in-progress job'
);

select extensions.results_eq(
    $$
        select count(*)::bigint
        from public.match_knowledge_chunks(
            '00000000-0000-4000-a000-000000000001',
            (
                '['
                || pg_catalog.array_to_string(
                    pg_catalog.array_fill(0.001::numeric, array[1024]),
                    ','
                )
                || ']'
            )::extensions.vector(1024),
            0,
            10,
            'Day 2 fixture'
        )
        where chunk_id = '42000000-0000-4000-a000-000000000001'
    $$,
    array[1::bigint],
    'The prior active version remains retrievable while reprocessing is in progress'
);

select public.fail_knowledge_ingestion(
    (select job_id from day2_retry_fixture),
    'FIXTURE_REPROCESS_FAILED',
    'Bounded fixture failure'
);

create temporary table day2_failed_retry_fixture
on commit drop
as
select *
from public.retry_knowledge_ingestion(
    '00000000-0000-4000-a000-000000000001',
    (select source_id from day2_ingestion_fixture),
    '10000000-0000-4000-a000-000000000001',
    'day2-failed-retry-fixture',
    'pgtap-day2-failed-retry'
);

select extensions.results_eq(
    $$
        select ingestion_job.target_version
        from day2_failed_retry_fixture as retry_fixture
        join public.ingestion_jobs as ingestion_job
          on ingestion_job.id = retry_fixture.job_id
    $$,
    array[2],
    'Retrying a failed version-two rebuild preserves its intended target version'
);

select extensions.throws_ok(
    $$
        select *
        from public.create_knowledge_ingestion(
            '00000000-0000-4000-a000-000000000002',
            '10000000-0000-4000-a000-000000000001',
            'url',
            'Forbidden cross-tenant source',
            'https://example.com',
            null,
            null,
            null,
            null,
            1,
            0,
            'day2-forbidden-cross-tenant',
            'pgtap-day2-forbidden'
        )
    $$,
    '42501',
    'An active organization Admin membership is required.',
    'The service function refuses a cross-tenant actor and organization pair'
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
