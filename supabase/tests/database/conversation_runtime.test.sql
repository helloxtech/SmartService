begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(20);

select extensions.ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.create_public_conversation(text,public.conversation_channel,text,text,text,text,text,text,text)',
        'EXECUTE'
    ),
    'Authenticated clients cannot execute public conversation creation directly'
);

select extensions.ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.complete_public_turn(uuid,uuid,uuid,public.message_decision,text,text,jsonb,uuid[],text,text,boolean,text,text,text,integer,integer,integer,text,text,text,jsonb)',
        'EXECUTE'
    ),
    'Authenticated clients cannot execute AI turn completion directly'
);

select extensions.ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.record_nonterminal_knowledge_gap()',
        'EXECUTE'
    ),
    'Authenticated clients cannot execute the internal knowledge-gap trigger function'
);

select extensions.ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.consume_public_rate_limit(uuid,text,text,integer,integer)',
        'EXECUTE'
    ),
    'Authenticated clients cannot consume or inspect the public rate limiter'
);

set local role anon;

select extensions.throws_ok(
    $$select * from public.public_rate_limit_buckets$$,
    '42501',
    'permission denied for table public_rate_limit_buckets',
    'Anonymous clients have no direct rate-limit table access'
);

reset role;
set local role service_role;

create temporary table created_conversation
on commit drop
as
select *
from public.create_public_conversation(
    'smart-service-public-demo',
    'text',
    'Fixture Customer',
    'fixture@example.test',
    null,
    null,
    'en',
    'conversation-runtime-fixture',
    'pgtap-conversation-create'
);

select extensions.results_eq(
    $$
        select organization_id
        from created_conversation
    $$,
    array['00000000-0000-4000-a000-000000000001'::uuid],
    'The public key resolves to the authoritative Smart Service organization'
);

select extensions.results_eq(
    $$
        select replay.conversation_id
        from public.create_public_conversation(
            'smart-service-public-demo',
            'text',
            'Fixture Customer',
            'fixture@example.test',
            null,
            null,
            'en',
            'conversation-runtime-fixture',
            'pgtap-conversation-replay'
        ) as replay
    $$,
    array[(select conversation_id from created_conversation)],
    'Conversation creation replays the same row for the same tenant idempotency key'
);

select extensions.results_eq(
    $$
        select allowed
        from public.consume_public_rate_limit(
            '00000000-0000-4000-a000-000000000001',
            repeat('a', 64),
            'fixture.create',
            1,
            60
        )
    $$,
    array[true],
    'The first request inside a rate-limit window is allowed'
);

select extensions.results_eq(
    $$
        select allowed
        from public.consume_public_rate_limit(
            '00000000-0000-4000-a000-000000000001',
            repeat('a', 64),
            'fixture.create',
            1,
            60
        )
    $$,
    array[false],
    'The request beyond a fixed-window allowance is denied atomically'
);

create temporary table customer_message
on commit drop
as
select *
from public.record_public_customer_message(
    '00000000-0000-4000-a000-000000000001',
    (select conversation_id from created_conversation),
    '60000000-0000-4000-a000-000000000001',
    'What is the maximum flow rate of the NF-500?',
    'en'
);

select extensions.results_eq(
    $$select created from customer_message$$,
    array[true],
    'The first customer message write is created'
);

select extensions.results_eq(
    $$
        select replay.created
        from public.record_public_customer_message(
            '00000000-0000-4000-a000-000000000001',
            (select conversation_id from created_conversation),
            '60000000-0000-4000-a000-000000000001',
            'What is the maximum flow rate of the NF-500?',
            'en'
        ) as replay
    $$,
    array[false],
    'A duplicate customer client-message ID replays without a duplicate row'
);

insert into public.knowledge_sources (
    id,
    organization_id,
    type,
    name,
    status,
    active_version,
    document_count,
    chunk_count,
    enabled
)
values (
    '70000000-0000-4000-a000-000000000001',
    '00000000-0000-4000-a000-000000000001',
    'pdf',
    'Runtime citation fixture',
    'ready',
    1,
    1,
    1,
    true
);

insert into public.knowledge_documents (
    id,
    organization_id,
    source_id,
    version,
    title,
    content_hash,
    enabled
)
values (
    '71000000-0000-4000-a000-000000000001',
    '00000000-0000-4000-a000-000000000001',
    '70000000-0000-4000-a000-000000000001',
    1,
    'NF-Series Product Manual',
    repeat('b', 64),
    true
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
    source_locator,
    enabled
)
values (
    '72000000-0000-4000-a000-000000000001',
    '00000000-0000-4000-a000-000000000001',
    '70000000-0000-4000-a000-000000000001',
    '71000000-0000-4000-a000-000000000001',
    1,
    0,
    'NF-500 specifications. Maximum flow: 300 litres per minute.',
    repeat('c', 64),
    (
        '['
        || array_to_string(array_fill(0.01::real, array[1024]), ',')
        || ']'
    )::extensions.vector(1024),
    '{"kind":"pdf","title":"NF-Series Product Manual","pageStart":4}'::jsonb,
    true
);

select extensions.throws_ok(
    $$
        select *
        from public.complete_public_turn(
            p_organization_id => '00000000-0000-4000-a000-000000000001',
            p_conversation_id => (select conversation_id from created_conversation),
            p_customer_message_id => (select customer_message_id from customer_message),
            p_decision => 'answer',
            p_answer => 'The maximum flow is 300 litres per minute.',
            p_language => 'en',
            p_citations => '[{"chunkId":"72000000-0000-4000-a000-000000000001","label":"Manual, p. 4","supportingExcerpt":"Maximum flow: 300 litres per minute."}]'::jsonb,
            p_retrieved_chunk_ids => array[]::uuid[],
            p_handoff_reason => null,
            p_normalized_question => 'maximum flow nf-500',
            p_create_gap => false,
            p_provider => 'mock',
            p_model => 'fixture',
            p_prompt_version => 'rag-answer-v1',
            p_input_tokens => null,
            p_output_tokens => null,
            p_latency_ms => 5,
            p_ai_status => 'succeeded',
            p_error_code => null,
            p_request_id => 'pgtap-invalid-citation',
            p_retrieval_metadata => '{"count":1}'::jsonb
        )
    $$,
    'P0001',
    'citation_not_in_retrieval',
    'Turn completion rejects a citation outside the exact retrieval set'
);

create temporary table completed_turn
on commit drop
as
select *
from public.complete_public_turn(
    p_organization_id => '00000000-0000-4000-a000-000000000001',
    p_conversation_id => (select conversation_id from created_conversation),
    p_customer_message_id => (select customer_message_id from customer_message),
    p_decision => 'answer',
    p_answer => 'The maximum flow is 300 litres per minute.',
    p_language => 'en',
    p_citations => '[{"chunkId":"72000000-0000-4000-a000-000000000001","label":"Manual, p. 4","supportingExcerpt":"Maximum flow: 300 litres per minute."}]'::jsonb,
    p_retrieved_chunk_ids => array['72000000-0000-4000-a000-000000000001'::uuid],
    p_handoff_reason => null,
    p_normalized_question => 'maximum flow nf-500',
    p_create_gap => false,
    p_provider => 'mock',
    p_model => 'fixture',
    p_prompt_version => 'rag-answer-v1',
    p_input_tokens => null,
    p_output_tokens => null,
    p_latency_ms => 5,
    p_ai_status => 'succeeded',
    p_error_code => null,
    p_request_id => 'pgtap-valid-citation',
    p_retrieval_metadata => '{"count":1}'::jsonb
);

select extensions.results_eq(
    $$select created from completed_turn$$,
    array[true],
    'A grounded answer and its audit artifacts commit in one turn transaction'
);

select extensions.results_eq(
    $$
        select count(*)::bigint
        from public.message_citations
        where message_id = (select message_id from completed_turn)
    $$,
    array[1::bigint],
    'The grounded answer stores exactly one citation'
);

select extensions.results_eq(
    $$
        select count(*)::bigint
        from public.ai_runs
        where id = (select ai_run_id from completed_turn)
          and task_type = 'rag_answer'
          and status = 'succeeded'
    $$,
    array[1::bigint],
    'Every persisted AI answer is linked to a complete AI run'
);

select extensions.results_eq(
    $$
        select replay.created
        from public.complete_public_turn(
            p_organization_id => '00000000-0000-4000-a000-000000000001',
            p_conversation_id => (select conversation_id from created_conversation),
            p_customer_message_id => (select customer_message_id from customer_message),
            p_decision => 'answer',
            p_answer => 'The maximum flow is 300 litres per minute.',
            p_language => 'en',
            p_citations => '[{"chunkId":"72000000-0000-4000-a000-000000000001","label":"Manual, p. 4","supportingExcerpt":"Maximum flow: 300 litres per minute."}]'::jsonb,
            p_retrieved_chunk_ids => array['72000000-0000-4000-a000-000000000001'::uuid],
            p_handoff_reason => null,
            p_normalized_question => 'maximum flow nf-500',
            p_create_gap => false,
            p_provider => 'mock',
            p_model => 'fixture',
            p_prompt_version => 'rag-answer-v1',
            p_input_tokens => null,
            p_output_tokens => null,
            p_latency_ms => 5,
            p_ai_status => 'succeeded',
            p_error_code => null,
            p_request_id => 'pgtap-turn-replay',
            p_retrieval_metadata => '{"count":1}'::jsonb
        ) as replay
    $$,
    array[false],
    'A repeated completion returns the existing AI message without duplicate cost artifacts'
);

create temporary table clarification_conversations
on commit drop
as
select created_row.conversation_id
from (
    values
        ('clarification-runtime-fixture-one'),
        ('clarification-runtime-fixture-two')
) as fixture(idempotency_key)
cross join lateral public.create_public_conversation(
    'smart-service-public-demo',
    'text',
    null,
    null,
    null,
    null,
    'zh-CN',
    fixture.idempotency_key,
    'pgtap-clarification-create'
) as created_row;

create temporary table prior_gap_occurrence
on commit drop
as
select coalesce(max(occurrence_count), 0) as occurrence_count
from public.knowledge_gaps
where organization_id = '00000000-0000-4000-a000-000000000001'
  and normalized_question = '产品有没有 atex 认证';

create temporary table clarification_messages
on commit drop
as
select recorded.customer_message_id, clarification_conversation.conversation_id
from clarification_conversations as clarification_conversation
cross join lateral public.record_public_customer_message(
    '00000000-0000-4000-a000-000000000001',
    clarification_conversation.conversation_id,
    extensions.gen_random_uuid(),
    '产品有没有 ATEX 认证？',
    'zh-CN'
) as recorded;

select completed.*
from clarification_messages as clarification_message
cross join lateral public.complete_public_turn(
    p_organization_id => '00000000-0000-4000-a000-000000000001',
    p_conversation_id => clarification_message.conversation_id,
    p_customer_message_id => clarification_message.customer_message_id,
    p_decision => 'clarify',
    p_answer => '现有的已批准资料不足以可靠回答这个问题。您可以补充问题，或选择人工客服帮助。',
    p_language => 'zh-CN',
    p_citations => '[]'::jsonb,
    p_retrieved_chunk_ids => array[]::uuid[],
    p_handoff_reason => 'missing_knowledge',
    p_normalized_question => '产品有没有 atex 认证',
    p_create_gap => false,
    p_provider => 'retrieval-gate',
    p_model => 'no-evidence-v2',
    p_prompt_version => 'rag-answer-v2',
    p_input_tokens => null,
    p_output_tokens => null,
    p_latency_ms => 2,
    p_ai_status => 'succeeded',
    p_error_code => null,
    p_request_id => 'pgtap-missing-knowledge-clarification',
    p_retrieval_metadata => '{"count":0}'::jsonb
) as completed;

select extensions.results_eq(
    $$
        select count(*)::bigint
        from public.conversations
        where id in (select conversation_id from clarification_conversations)
          and status = 'active_ai'
    $$,
    array[2::bigint],
    'Missing knowledge keeps every affected conversation AI-active'
);

select extensions.results_eq(
    $$
        select knowledge_gap.occurrence_count - prior_gap.occurrence_count
        from public.knowledge_gaps as knowledge_gap
        cross join prior_gap_occurrence as prior_gap
        where knowledge_gap.organization_id = '00000000-0000-4000-a000-000000000001'
          and knowledge_gap.normalized_question = '产品有没有 atex 认证'
    $$,
    array[2],
    'Repeated normalized missing questions add two occurrences to one knowledge gap'
);

select extensions.results_eq(
    $$
        select count(*)::bigint
        from public.handoffs
        where conversation_id in (select conversation_id from clarification_conversations)
    $$,
    array[0::bigint],
    'Missing knowledge does not create a handoff until the customer explicitly requests one'
);

select extensions.throws_ok(
    $$
        select *
        from public.record_public_customer_message(
            '00000000-0000-4000-a000-000000000002',
            (select conversation_id from created_conversation),
            '60000000-0000-4000-a000-000000000099',
            'Forbidden cross-tenant message',
            'en'
        )
    $$,
    'P0001',
    'conversation_not_found',
    'The service-only message function rejects an organization and conversation mismatch'
);

reset role;
select extensions.finish();

rollback;
