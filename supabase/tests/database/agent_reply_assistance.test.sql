begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(26);

select extensions.ok(
    not pg_catalog.has_table_privilege(
        'authenticated',
        'public.agent_reply_suggestions',
        'SELECT'
    ),
    'Authenticated clients cannot read internal reply suggestions directly'
);

select extensions.ok(
    not pg_catalog.has_table_privilege(
        'authenticated',
        'public.agent_reply_suggestion_citations',
        'SELECT'
    ),
    'Authenticated clients cannot read internal suggestion citations directly'
);

select extensions.ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.queue_agent_reply_suggestion(uuid,uuid,uuid,text)',
        'EXECUTE'
    ),
    'Authenticated clients cannot queue reply suggestions directly'
);

select extensions.ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.complete_agent_reply_suggestion(uuid,uuid,uuid,uuid,text,text,jsonb,text,text,text,integer,integer,integer,text,text,text,jsonb,text)',
        'EXECUTE'
    ),
    'Authenticated clients cannot complete reply suggestions directly'
);

select extensions.ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.settle_agent_reply_suggestions(uuid,uuid,uuid,uuid,uuid,text)',
        'EXECUTE'
    ),
    'Authenticated clients cannot forge suggestion usage directly'
);

select extensions.ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.get_latest_agent_reply_suggestion(uuid,uuid)',
        'EXECUTE'
    ),
    'Authenticated clients cannot bypass the tenant-scoped suggestion API'
);

select extensions.ok(
    public.is_actionable_knowledge_gap_question('古筝呢？'),
    'A short company offering question remains actionable across industries'
);

select extensions.ok(
    not public.is_actionable_knowledge_gap_question('为什么刚才没有回答？麻烦再试一次。'),
    'A response complaint and retry command is not a knowledge gap'
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
values (
    '10000000-0000-4000-a000-000000000088',
    'authenticated',
    'authenticated',
    'agent-assist@smartservice.test',
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
values (
    '00000000-0000-4000-a000-000000000001',
    '10000000-0000-4000-a000-000000000088',
    'agent'
);

set local role service_role;

insert into public.knowledge_sources (
    id,
    organization_id,
    type,
    name,
    source_url,
    status,
    active_version,
    document_count,
    chunk_count,
    enabled
)
values (
    '70000000-0000-4000-a000-000000000088',
    '00000000-0000-4000-a000-000000000001',
    'url',
    'Approved service guide',
    'https://example.test/services',
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
    '71000000-0000-4000-a000-000000000088',
    '00000000-0000-4000-a000-000000000001',
    '70000000-0000-4000-a000-000000000088',
    1,
    'Approved service guide',
    repeat('8', 64),
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
    '72000000-0000-4000-a000-000000000088',
    '00000000-0000-4000-a000-000000000001',
    '70000000-0000-4000-a000-000000000088',
    '71000000-0000-4000-a000-000000000088',
    1,
    0,
    'The company offers the requested service.',
    repeat('9', 64),
    (
        '['
        || array_to_string(array_fill(0.01::real, array[1024]), ',')
        || ']'
    )::extensions.vector(1024),
    '{"kind":"url","title":"Approved service guide","url":"https://example.test/services"}'::jsonb,
    true
);

create temporary table assist_conversation
on commit drop
as
select *
from public.create_public_conversation(
    'smart-service-public-demo',
    'text',
    null,
    null,
    null,
    null,
    'en',
    'pgtap-agent-assist-conversation',
    'pgtap-agent-assist-create'
);

create temporary table assist_customer_message
on commit drop
as
select *
from public.record_public_customer_message(
    '00000000-0000-4000-a000-000000000001',
    (select conversation_id from assist_conversation),
    '60000000-0000-4000-a000-000000000088',
    'Do you offer the requested service?',
    'en'
);

select *
from public.request_public_handoff(
    '00000000-0000-4000-a000-000000000001',
    (select conversation_id from assist_conversation),
    'agent-assist-handoff-key',
    'customer_requested',
    'A support specialist will continue with you.',
    'en',
    'pgtap-agent-assist-handoff'
);

create temporary table queued_suggestion
on commit drop
as
select *
from public.queue_agent_reply_suggestion(
    '00000000-0000-4000-a000-000000000001',
    (select conversation_id from assist_conversation),
    (select customer_message_id from assist_customer_message),
    'pgtap-agent-assist-queue'
);

select extensions.results_eq(
    $$select created from queued_suggestion$$,
    array[true],
    'The latest human-routed customer message creates one pending suggestion'
);

select extensions.results_eq(
    $$
        select status
        from public.agent_reply_suggestions
        where id = (select suggestion_id from queued_suggestion)
    $$,
    array['pending'::text],
    'A new suggestion starts pending'
);

select extensions.ok(
    (
        select summary_snapshot ->> 'suggestedReply'
        from public.handoffs
        where conversation_id = (select conversation_id from assist_conversation)
    ) like '%Do you offer the requested service?%',
    'The immediate handoff fallback references the current customer question'
);

select extensions.results_eq(
    $$
        select created
        from public.queue_agent_reply_suggestion(
            '00000000-0000-4000-a000-000000000001',
            (select conversation_id from assist_conversation),
            (select customer_message_id from assist_customer_message),
            'pgtap-agent-assist-queue-replay'
        )
    $$,
    array[false],
    'Queueing the same trigger is idempotent'
);

select extensions.throws_ok(
    $$
        select *
        from public.queue_agent_reply_suggestion(
            '00000000-0000-4000-a000-000000000002',
            (select conversation_id from assist_conversation),
            (select customer_message_id from assist_customer_message),
            'pgtap-agent-assist-cross-tenant'
        )
    $$,
    'P0001',
    'conversation_not_found',
    'A cross-tenant queue command fails closed'
);

select extensions.results_eq(
    $$
        select public.complete_agent_reply_suggestion(
            p_organization_id => '00000000-0000-4000-a000-000000000001',
            p_conversation_id => (select conversation_id from assist_conversation),
            p_suggestion_id => (select suggestion_id from queued_suggestion),
            p_trigger_message_id => (select customer_message_id from assist_customer_message),
            p_kind => 'grounded_answer',
            p_draft_text => 'Yes, we offer the requested service. What would you like to arrange?',
            p_citations => '[{"chunkId":"72000000-0000-4000-a000-000000000088","label":"Approved service guide","supportingExcerpt":"The company offers the requested service."}]'::jsonb,
            p_provider => 'deterministic',
            p_model => 'fixture-grounded-v1',
            p_prompt_version => 'rag-answer-v11:agent-assist-v1',
            p_input_tokens => null,
            p_output_tokens => null,
            p_latency_ms => 5,
            p_conversation_summary => 'The customer asked whether the company offers the requested service.',
            p_current_intent => 'Confirm the requested service',
            p_next_step => 'Review the source and send the human reply.',
            p_metadata => '{"fixture":true}'::jsonb,
            p_request_id => 'pgtap-agent-assist-complete'
        )
    $$,
    array[true],
    'A current grounded suggestion completes atomically'
);

select extensions.results_eq(
    $$
        select status || ':' || kind
        from public.agent_reply_suggestions
        where id = (select suggestion_id from queued_suggestion)
    $$,
    array['ready:grounded_answer'::text],
    'The completed draft is ready and explicitly grounded'
);

select extensions.results_eq(
    $$
        select count(*)::bigint
        from public.agent_reply_suggestion_citations
        where suggestion_id = (select suggestion_id from queued_suggestion)
          and chunk_id = '72000000-0000-4000-a000-000000000088'
    $$,
    array[1::bigint],
    'The ready draft retains only its validated approved citation'
);

select extensions.results_eq(
    $$
        select summary_snapshot ->> 'suggestedReply'
        from public.handoffs
        where conversation_id = (select conversation_id from assist_conversation)
    $$,
    array['Yes, we offer the requested service. What would you like to arrange?'::text],
    'The handoff package refreshes to the grounded current draft'
);

select *
from public.claim_team_conversation(
    '00000000-0000-4000-a000-000000000001',
    (select conversation_id from assist_conversation),
    '10000000-0000-4000-a000-000000000088',
    'pgtap-agent-assist-claim'
);

create temporary table assist_human_message
on commit drop
as
select *
from public.send_team_human_message(
    '00000000-0000-4000-a000-000000000001',
    (select conversation_id from assist_conversation),
    '10000000-0000-4000-a000-000000000088',
    '80000000-0000-4000-a000-000000000088',
    'Yes, we offer the requested service. What would you like to arrange?',
    'pgtap-agent-assist-human-message'
);

select extensions.results_eq(
    $$
        select public.settle_agent_reply_suggestions(
            '00000000-0000-4000-a000-000000000001',
            (select conversation_id from assist_conversation),
            '10000000-0000-4000-a000-000000000088',
            (select message_id from assist_human_message),
            (select suggestion_id from queued_suggestion),
            'pgtap-agent-assist-settle'
        )
    $$,
    array[true],
    'Only the owning human can mark the current ready suggestion used'
);

select extensions.results_eq(
    $$
        select status || ':' || (human_message_id is not null)::text
        from public.agent_reply_suggestions
        where id = (select suggestion_id from queued_suggestion)
    $$,
    array['used:true'::text],
    'Suggestion use is linked to the actual human message'
);

create temporary table assist_customer_follow_up
on commit drop
as
select *
from public.record_public_customer_message(
    '00000000-0000-4000-a000-000000000001',
    (select conversation_id from assist_conversation),
    '60000000-0000-4000-a000-000000000089',
    'What times are available?',
    'en'
);

create temporary table queued_follow_up
on commit drop
as
select *
from public.queue_agent_reply_suggestion(
    '00000000-0000-4000-a000-000000000001',
    (select conversation_id from assist_conversation),
    (select customer_message_id from assist_customer_follow_up),
    'pgtap-agent-assist-follow-up'
);

select extensions.results_eq(
    $$select created from queued_follow_up$$,
    array[true],
    'A later customer turn receives one new suggestion job'
);

select extensions.results_eq(
    $$
        select string_agg(status, ',' order by created_at)
        from public.agent_reply_suggestions
        where conversation_id = (select conversation_id from assist_conversation)
    $$,
    array['used,pending'::text],
    'A used draft remains audited while only the latest turn stays pending'
);

select *
from public.close_team_conversation(
    '00000000-0000-4000-a000-000000000001',
    (select conversation_id from assist_conversation),
    '10000000-0000-4000-a000-000000000088',
    'pgtap-agent-assist-close'
);

select extensions.results_eq(
    $$
        select status
        from public.agent_reply_suggestions
        where id = (select suggestion_id from queued_follow_up)
    $$,
    array['superseded'::text],
    'Closing a conversation invalidates every unsent draft'
);

select extensions.results_eq(
    $$
        with attempted as (
            insert into public.knowledge_gaps (
                organization_id,
                normalized_question,
                example_question,
                reason
            )
            values (
                '00000000-0000-4000-a000-000000000001',
                'why no answer try again',
                'Why did you not answer? Please try again.',
                'missing_knowledge'
            )
            returning id
        )
        select count(*)::bigint from attempted
    $$,
    array[0::bigint],
    'Meta retry turns are suppressed even at the database boundary'
);

select extensions.results_eq(
    $$
        with inserted as (
            insert into public.knowledge_gaps (
                organization_id,
                normalized_question,
                example_question,
                reason
            )
            values (
                '00000000-0000-4000-a000-000000000001',
                'do you offer the requested service',
                'Do you offer the requested service?',
                'missing_knowledge'
            )
            returning id
        )
        select count(*)::bigint from inserted
    $$,
    array[1::bigint],
    'An actionable company-information question remains a knowledge gap'
);

create temporary table resolved_gap_conversation
on commit drop
as
select *
from public.create_public_conversation(
    'smart-service-public-demo',
    'text',
    null,
    null,
    null,
    null,
    'en',
    'pgtap-gap-resolution-conversation',
    'pgtap-gap-resolution-create'
);

create temporary table resolved_gap_customer_message
on commit drop
as
select *
from public.record_public_customer_message(
    '00000000-0000-4000-a000-000000000001',
    (select conversation_id from resolved_gap_conversation),
    '60000000-0000-4000-a000-000000000090',
    'Do you offer the requested service?',
    'en'
);

select *
from public.complete_public_turn(
    p_organization_id => '00000000-0000-4000-a000-000000000001',
    p_conversation_id => (select conversation_id from resolved_gap_conversation),
    p_customer_message_id => (select customer_message_id from resolved_gap_customer_message),
    p_decision => 'answer',
    p_answer => 'Yes, we offer the requested service.',
    p_language => 'en',
    p_citations => '[{"chunkId":"72000000-0000-4000-a000-000000000088","label":"Approved service guide","supportingExcerpt":"The company offers the requested service."}]'::jsonb,
    p_retrieved_chunk_ids => array['72000000-0000-4000-a000-000000000088'::uuid],
    p_handoff_reason => null,
    p_normalized_question => 'do you offer the requested service',
    p_create_gap => false,
    p_provider => 'deterministic',
    p_model => 'fixture-grounded-v1',
    p_prompt_version => 'rag-answer-v11',
    p_input_tokens => null,
    p_output_tokens => null,
    p_latency_ms => 3,
    p_ai_status => 'succeeded',
    p_error_code => null,
    p_request_id => 'pgtap-gap-resolution-answer',
    p_retrieval_metadata => '{"normalizedQuestion":"do you offer the requested service","gapEligible":true}'::jsonb
);

select extensions.results_eq(
    $$
        select status::text || ':' || resolved_source_id::text
        from public.knowledge_gaps
        where organization_id = '00000000-0000-4000-a000-000000000001'
          and normalized_question = 'do you offer the requested service'
    $$,
    array['resolved:70000000-0000-4000-a000-000000000088'::text],
    'A later cited answer automatically resolves the exact matching open gap'
);

select extensions.results_eq(
    $$
        select count(*)::bigint
        from public.audit_logs
        where action = 'knowledge_gap.auto_resolved'
          and entity_id = (
              select id
              from public.knowledge_gaps
              where organization_id = '00000000-0000-4000-a000-000000000001'
                and normalized_question = 'do you offer the requested service'
          )
    $$,
    array[1::bigint],
    'Automatic gap resolution creates one durable audit record'
);

reset role;
select extensions.finish();

rollback;
