begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(31);

select extensions.ok(
    not pg_catalog.has_table_privilege(
        'authenticated',
        'public.knowledge_gaps',
        'SELECT'
    ),
    'Authenticated clients cannot list knowledge gaps outside the Admin Worker API'
);

select extensions.ok(
    not pg_catalog.has_table_privilege(
        'authenticated',
        'public.knowledge_gaps',
        'UPDATE'
    ),
    'Authenticated clients cannot mutate knowledge gaps directly'
);

select extensions.ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.get_dashboard_summary(uuid,timestamptz,timestamptz)',
        'EXECUTE'
    ),
    'Authenticated clients cannot execute dashboard aggregation directly'
);

select extensions.ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.create_manual_gap_resolution(uuid,uuid,uuid,text,text,numeric,text,text)',
        'EXECUTE'
    ),
    'Authenticated clients cannot create manual gap sources directly'
);

select extensions.ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.manage_knowledge_gap(uuid,uuid,uuid,text,text)',
        'EXECUTE'
    ),
    'Authenticated clients cannot bypass audited gap actions'
);

select extensions.ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.match_knowledge_chunks_for_source(uuid,uuid,extensions.vector,real,integer,text)',
        'EXECUTE'
    ),
    'Authenticated clients cannot execute source-scoped retrieval directly'
);

select extensions.ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.record_knowledge_gap_retest(uuid,uuid,uuid,text,text,text,integer,integer,integer,text,uuid[],uuid[],text,text,text,text,integer,integer,integer)',
        'EXECUTE'
    ),
    'Authenticated clients cannot forge a knowledge-gap re-test audit'
);

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
        '10000000-0000-4000-a000-000000000051',
        'authenticated',
        'authenticated',
        'day5-admin-a@smartservice.test',
        '',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
    ),
    (
        '10000000-0000-4000-a000-000000000052',
        'authenticated',
        'authenticated',
        'day5-admin-b@smartservice.test',
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
        '10000000-0000-4000-a000-000000000051',
        'admin'
    ),
    (
        '00000000-0000-4000-a000-000000000002',
        '10000000-0000-4000-a000-000000000052',
        'admin'
    );

set local role service_role;

insert into public.conversations (
    id,
    organization_id,
    channel,
    status,
    language,
    closed_at
)
values
    (
        '20000000-0000-4000-a000-000000000051',
        '00000000-0000-4000-a000-000000000001',
        'text',
        'closed',
        'en',
        '2026-07-10T12:00:00Z'
    ),
    (
        '20000000-0000-4000-a000-000000000052',
        '00000000-0000-4000-a000-000000000001',
        'text',
        'closed',
        'zh-CN',
        '2026-07-11T12:00:00Z'
    ),
    (
        '20000000-0000-4000-a000-000000000053',
        '00000000-0000-4000-a000-000000000001',
        'text',
        'closed',
        'en',
        '2026-07-12T12:00:00Z'
    ),
    (
        '20000000-0000-4000-a000-000000000054',
        '00000000-0000-4000-a000-000000000001',
        'text',
        'closed',
        'en',
        '2026-07-13T12:00:00Z'
    ),
    (
        '20000000-0000-4000-a000-000000000055',
        '00000000-0000-4000-a000-000000000001',
        'text',
        'closed',
        'en',
        '2025-07-10T12:00:00Z'
    ),
    (
        '20000000-0000-4000-a000-000000000056',
        '00000000-0000-4000-a000-000000000002',
        'text',
        'closed',
        'en',
        '2026-07-14T12:00:00Z'
    );

insert into public.conversation_summaries (
    organization_id,
    conversation_id,
    version,
    is_incremental,
    summary,
    outcome,
    model,
    prompt_version
)
values
    (
        '00000000-0000-4000-a000-000000000001',
        '20000000-0000-4000-a000-000000000051',
        1,
        false,
        'Resolved by AI.',
        'resolved_ai',
        'fixture',
        'day5'
    ),
    (
        '00000000-0000-4000-a000-000000000001',
        '20000000-0000-4000-a000-000000000052',
        1,
        false,
        'Resolved by AI.',
        'resolved_ai',
        'fixture',
        'day5'
    ),
    (
        '00000000-0000-4000-a000-000000000001',
        '20000000-0000-4000-a000-000000000053',
        1,
        false,
        'Resolved by a human.',
        'resolved_human',
        'fixture',
        'day5'
    ),
    (
        '00000000-0000-4000-a000-000000000001',
        '20000000-0000-4000-a000-000000000054',
        1,
        false,
        'Closed without a supported answer.',
        'unresolved',
        'fixture',
        'day5'
    ),
    (
        '00000000-0000-4000-a000-000000000001',
        '20000000-0000-4000-a000-000000000055',
        1,
        false,
        'Old resolved conversation.',
        'resolved_ai',
        'fixture',
        'day5'
    ),
    (
        '00000000-0000-4000-a000-000000000002',
        '20000000-0000-4000-a000-000000000056',
        1,
        false,
        'Other tenant resolved conversation.',
        'resolved_ai',
        'fixture',
        'day5'
    );

insert into public.handoffs (
    organization_id,
    conversation_id,
    reason,
    summary_snapshot
)
values (
    '00000000-0000-4000-a000-000000000001',
    '20000000-0000-4000-a000-000000000053',
    'customer_requested',
    '{"summary":"Fixture handoff"}'::jsonb
);

insert into public.knowledge_gaps (
    id,
    organization_id,
    normalized_question,
    example_question,
    first_conversation_id,
    occurrence_count,
    reason,
    status,
    last_seen_at
)
values
    (
        '70000000-0000-4000-a000-000000000051',
        '00000000-0000-4000-a000-000000000001',
        'what is the nf-500 warranty',
        'What is the NF-500 warranty?',
        '20000000-0000-4000-a000-000000000051',
        3,
        'No approved evidence was retrieved.',
        'open',
        '2026-07-15T12:00:00Z'
    ),
    (
        '70000000-0000-4000-a000-000000000052',
        '00000000-0000-4000-a000-000000000001',
        'does the nf-500 work under water',
        'Does the NF-500 work under water?',
        '20000000-0000-4000-a000-000000000052',
        2,
        'No approved evidence was retrieved.',
        'open',
        '2026-07-16T12:00:00Z'
    ),
    (
        '70000000-0000-4000-a000-000000000053',
        '00000000-0000-4000-a000-000000000001',
        'ignored fixture question',
        'Ignored fixture question?',
        null,
        1,
        'Ignored fixture.',
        'ignored',
        '2026-07-17T12:00:00Z'
    ),
    (
        '70000000-0000-4000-a000-000000000054',
        '00000000-0000-4000-a000-000000000001',
        'old unresolved fixture',
        'Old unresolved fixture?',
        null,
        1,
        'Outside selected period.',
        'open',
        '2025-07-17T12:00:00Z'
    ),
    (
        '70000000-0000-4000-a000-000000000055',
        '00000000-0000-4000-a000-000000000002',
        'other tenant unresolved fixture',
        'Other tenant unresolved fixture?',
        '20000000-0000-4000-a000-000000000056',
        1,
        'Other tenant.',
        'open',
        '2026-07-18T12:00:00Z'
    );

select extensions.results_eq(
    $$
        select total_conversations
        from public.get_dashboard_summary(
            '00000000-0000-4000-a000-000000000001',
            '2026-07-01T00:00:00Z',
            '2026-08-01T00:00:00Z'
        )
    $$,
    array[4::bigint],
    'Dashboard counts only tenant A closed conversations in the selected period'
);

select extensions.results_eq(
    $$
        select ai_contained_conversations
        from public.get_dashboard_summary(
            '00000000-0000-4000-a000-000000000001',
            '2026-07-01T00:00:00Z',
            '2026-08-01T00:00:00Z'
        )
    $$,
    array[2::bigint],
    'Containment requires a final AI-resolved outcome and no handoff'
);

select extensions.results_eq(
    $$
        select handed_off_conversations
        from public.get_dashboard_summary(
            '00000000-0000-4000-a000-000000000001',
            '2026-07-01T00:00:00Z',
            '2026-08-01T00:00:00Z'
        )
    $$,
    array[1::bigint],
    'Handoff counts conversations that ever entered the handoff path'
);

select extensions.results_eq(
    $$
        select ai_containment_rate
        from public.get_dashboard_summary(
            '00000000-0000-4000-a000-000000000001',
            '2026-07-01T00:00:00Z',
            '2026-08-01T00:00:00Z'
        )
    $$,
    array[0.5000::numeric],
    'AI containment rate uses all closed conversations as its denominator'
);

select extensions.results_eq(
    $$
        select handoff_rate
        from public.get_dashboard_summary(
            '00000000-0000-4000-a000-000000000001',
            '2026-07-01T00:00:00Z',
            '2026-08-01T00:00:00Z'
        )
    $$,
    array[0.2500::numeric],
    'Handoff rate uses all closed conversations as its denominator'
);

select extensions.results_eq(
    $$
        select open_knowledge_gap_count
        from public.get_dashboard_summary(
            '00000000-0000-4000-a000-000000000001',
            '2026-07-01T00:00:00Z',
            '2026-08-01T00:00:00Z'
        )
    $$,
    array[2::bigint],
    'Dashboard gaps count only unresolved questions last seen in the period'
);

select extensions.results_eq(
    $$
        select total_conversations, open_knowledge_gap_count
        from public.get_dashboard_summary(
            '00000000-0000-4000-a000-000000000002',
            '2026-07-01T00:00:00Z',
            '2026-08-01T00:00:00Z'
        )
    $$,
    $$
        values (1::bigint, 1::bigint)
    $$,
    'Dashboard aggregation stays isolated for tenant B'
);

create temporary table day5_resolution
on commit drop
as
select *
from public.create_manual_gap_resolution(
    '00000000-0000-4000-a000-000000000001',
    '70000000-0000-4000-a000-000000000051',
    '10000000-0000-4000-a000-000000000051',
    'NF-500 approved warranty',
    'org/00000000-0000-4000-a000-000000000001/manual-gaps/70000000-0000-4000-a000-000000000051/fixture.json',
    0.05,
    'day5-resolution-0001',
    'pgtap-day5-resolution'
);

select extensions.results_eq(
    $$select status from day5_resolution$$,
    array['uploaded'::public.ingestion_status],
    'One-click resolution creates an uploaded ingestion job'
);

select extensions.results_eq(
    $$
        select type
        from public.knowledge_sources
        where id = (select source_id from day5_resolution)
    $$,
    array['manual'::public.knowledge_source_type],
    'One-click resolution creates a manual knowledge source'
);

select extensions.results_eq(
    $$
        select count(*)::bigint
        from public.ingestion_jobs
        where id = (select job_id from day5_resolution)
          and source_id = (select source_id from day5_resolution)
    $$,
    array[1::bigint],
    'The manual source and ingestion job are linked'
);

select extensions.results_eq(
    $$
        select status
        from public.knowledge_gaps
        where id = '70000000-0000-4000-a000-000000000051'
          and resolved_source_id = (select source_id from day5_resolution)
    $$,
    array['open'::public.gap_status],
    'The gap remains open while manual knowledge is processing'
);

select extensions.results_eq(
    $$
        select action
        from public.audit_logs
        where entity_id = '70000000-0000-4000-a000-000000000051'
          and action = 'knowledge_gap.resolution.queued'
    $$,
    array['knowledge_gap.resolution.queued'::text],
    'One-click resolution is audited'
);

select extensions.results_eq(
    $$
        select source_id
        from public.create_manual_gap_resolution(
            '00000000-0000-4000-a000-000000000001',
            '70000000-0000-4000-a000-000000000051',
            '10000000-0000-4000-a000-000000000051',
            'NF-500 approved warranty',
            'org/00000000-0000-4000-a000-000000000001/manual-gaps/70000000-0000-4000-a000-000000000051/fixture.json',
            0.05,
            'day5-resolution-0001',
            'pgtap-day5-resolution-retry'
        )
    $$,
    $$select source_id from day5_resolution$$,
    'A retried resolution reuses the same source and job'
);

select extensions.throws_ok(
    $$
        select *
        from public.create_manual_gap_resolution(
            '00000000-0000-4000-a000-000000000002',
            '70000000-0000-4000-a000-000000000055',
            '10000000-0000-4000-a000-000000000051',
            'Cross-tenant attempt',
            'org/00000000-0000-4000-a000-000000000002/manual-gaps/70000000-0000-4000-a000-000000000055/fixture.json',
            0.05,
            'cross-tenant-resolution',
            'pgtap-day5-cross-tenant'
        )
    $$,
    '42501',
    'An active organization Admin membership is required.',
    'An Admin cannot create knowledge for another tenant'
);

select extensions.results_eq(
    $$
        select public.manage_knowledge_gap(
            '00000000-0000-4000-a000-000000000001',
            '70000000-0000-4000-a000-000000000052',
            '10000000-0000-4000-a000-000000000051',
            'ignore',
            'pgtap-day5-ignore'
        )
    $$,
    array['ignored'::public.gap_status],
    'An Admin can ignore one open grouped gap'
);

select extensions.results_eq(
    $$
        select public.manage_knowledge_gap(
            '00000000-0000-4000-a000-000000000001',
            '70000000-0000-4000-a000-000000000052',
            '10000000-0000-4000-a000-000000000051',
            'ignore',
            'pgtap-day5-ignore-retry'
        )
    $$,
    array['ignored'::public.gap_status],
    'A retried ignore action is idempotent'
);

select extensions.results_eq(
    $$
        select public.manage_knowledge_gap(
            '00000000-0000-4000-a000-000000000001',
            '70000000-0000-4000-a000-000000000052',
            '10000000-0000-4000-a000-000000000051',
            'reopen',
            'pgtap-day5-reopen'
        )
    $$,
    array['open'::public.gap_status],
    'An Admin can reopen one ignored grouped gap'
);

select extensions.results_eq(
    $$
        select public.manage_knowledge_gap(
            '00000000-0000-4000-a000-000000000001',
            '70000000-0000-4000-a000-000000000052',
            '10000000-0000-4000-a000-000000000051',
            'reopen',
            'pgtap-day5-reopen-retry'
        )
    $$,
    array['open'::public.gap_status],
    'A retried reopen action is idempotent'
);

update public.knowledge_sources
set
    status = 'ready',
    chunk_count = 1
where id = (select source_id from day5_resolution);

insert into public.knowledge_documents (
    id,
    organization_id,
    source_id,
    version,
    title,
    content_hash
)
values (
    '41000000-0000-4000-a000-000000000051',
    '00000000-0000-4000-a000-000000000001',
    (select source_id from day5_resolution),
    1,
    'NF-500 approved warranty',
    pg_catalog.repeat('a', 64)
);

insert into public.knowledge_chunks (
    id,
    organization_id,
    source_id,
    document_id,
    document_version,
    chunk_index,
    content,
    content_hash,
    embedding,
    source_locator
)
values (
    '42000000-0000-4000-a000-000000000051',
    '00000000-0000-4000-a000-000000000001',
    (select source_id from day5_resolution),
    '41000000-0000-4000-a000-000000000051',
    1,
    0,
    'Question: What is the NF-500 warranty? Answer: The approved warranty is two years.',
    pg_catalog.repeat('b', 64),
    pg_catalog.array_fill(0.01::real, array[1024])::extensions.vector,
    '{"title":"NF-500 approved warranty","section":"Approved manual answer"}'::jsonb
);

update public.ingestion_jobs
set
    status = 'ready',
    progress_percent = 100,
    completed_at = now()
where id = (select job_id from day5_resolution);

select extensions.results_eq(
    $$
        select status
        from public.knowledge_gaps
        where id = '70000000-0000-4000-a000-000000000051'
    $$,
    array['resolved'::public.gap_status],
    'The gap resolves only after its linked ingestion job becomes ready'
);

select extensions.results_eq(
    $$
        select action
        from public.audit_logs
        where entity_id = '70000000-0000-4000-a000-000000000051'
          and action = 'knowledge_gap.resolved'
    $$,
    array['knowledge_gap.resolved'::text],
    'Automatic gap resolution is audited'
);

select extensions.results_eq(
    $$
        select chunk_id
        from public.match_knowledge_chunks_for_source(
            '00000000-0000-4000-a000-000000000001',
            (select source_id from day5_resolution),
            pg_catalog.array_fill(0.01::real, array[1024])::extensions.vector,
            -1,
            8,
            'What is the NF-500 warranty?'
        )
    $$,
    array['42000000-0000-4000-a000-000000000051'::uuid],
    'Re-test retrieval returns evidence from the exact resolved source'
);

select extensions.lives_ok(
    $$
        select public.record_knowledge_gap_retest(
            '00000000-0000-4000-a000-000000000001',
            '70000000-0000-4000-a000-000000000051',
            '10000000-0000-4000-a000-000000000051',
            'deterministic',
            'fixture-answer',
            'rag-answer-v1',
            null,
            null,
            5,
            'answer',
            array['42000000-0000-4000-a000-000000000051'::uuid],
            array['42000000-0000-4000-a000-000000000051'::uuid],
            'pgtap-day5-retest',
            'deterministic',
            'deterministic-guardrail-v1',
            'guardrail-supervisor-v1',
            null,
            null,
            1
        )
    $$,
    'A source-scoped cited re-test creates its audit atomically'
);

select extensions.results_eq(
    $$
        select count(*)::bigint
        from public.ai_runs
        where organization_id = '00000000-0000-4000-a000-000000000001'
          and task_type = 'knowledge_gap_retest'
          and metadata ->> 'gapId' = '70000000-0000-4000-a000-000000000051'
    $$,
    array[1::bigint],
    'The re-test AI run records its gap, decision, and evidence counts'
);

select extensions.throws_ok(
    $$
        select public.record_knowledge_gap_retest(
            '00000000-0000-4000-a000-000000000001',
            '70000000-0000-4000-a000-000000000051',
            '10000000-0000-4000-a000-000000000051',
            'deterministic',
            'fixture-answer',
            'rag-answer-v1',
            null,
            null,
            5,
            'answer',
            array['42000000-0000-4000-a000-000000000051'::uuid],
            array['42000000-0000-4000-a000-000000000099'::uuid],
            'pgtap-day5-invalid-citation',
            'deterministic',
            'deterministic-guardrail-v1',
            'guardrail-supervisor-v1',
            null,
            null,
            1
        )
    $$,
    '22023',
    'The knowledge-gap re-test audit is invalid.',
    'The database rejects citations outside the retrieved evidence set'
);

select * from extensions.finish();

rollback;
