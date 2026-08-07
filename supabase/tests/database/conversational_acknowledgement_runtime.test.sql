begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(8);

select extensions.ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.complete_public_acknowledgement_turn(uuid,uuid,uuid,text,text,integer,text)',
        'EXECUTE'
    ),
    'Authenticated clients cannot persist acknowledgements directly'
);

select extensions.results_eq(
    $$
        select enum_value.value::text
        from pg_catalog.unnest(
            pg_catalog.enum_range(null::public.message_decision)
        ) as enum_value(value)
        where enum_value.value::text = 'acknowledge'
    $$,
    array['acknowledge'::text],
    'The message decision enum includes conversational acknowledgements'
);

set local role service_role;

create temporary table acknowledgement_conversation
on commit drop
as
select *
from public.create_public_conversation(
    'smart-service-public-demo',
    'voice',
    null,
    null,
    null,
    null,
    'en',
    'pgtap-conversational-acknowledgement',
    'pgtap-conversational-acknowledgement-create'
);

create temporary table acknowledgement_customer_message
on commit drop
as
select *
from public.record_public_customer_message(
    '00000000-0000-4000-a000-000000000001',
    (select conversation_id from acknowledgement_conversation),
    '60000000-0000-4000-a000-000000000081',
    'Can you hear me?',
    'en'
);

create temporary table completed_acknowledgement
on commit drop
as
select *
from public.complete_public_acknowledgement_turn(
    p_organization_id => '00000000-0000-4000-a000-000000000001',
    p_conversation_id => (select conversation_id from acknowledgement_conversation),
    p_customer_message_id => (
        select customer_message_id
        from acknowledgement_customer_message
    ),
    p_answer => 'Yes, I can hear you. What would you like help with?',
    p_language => 'en',
    p_latency_ms => 1,
    p_request_id => 'pgtap-conversational-acknowledgement-complete'
);

select extensions.results_eq(
    $$select created from completed_acknowledgement$$,
    array[true],
    'The first acknowledgement completion creates one AI message'
);

select extensions.results_eq(
    $$
        select message.decision::text
        from public.messages as message
        where message.id = (select message_id from completed_acknowledgement)
          and message.sender_type = 'ai'
          and message.metadata ->> 'handoffReason' is null
          and not exists (
              select 1
              from public.message_citations as citation
              where citation.message_id = message.id
          )
    $$,
    array['acknowledge'::text],
    'The acknowledgement has no citation or handoff metadata'
);

select extensions.results_eq(
    $$
        select ai_run.task_type
        from public.ai_runs as ai_run
        where ai_run.id = (select ai_run_id from completed_acknowledgement)
          and ai_run.provider = 'deterministic'
          and ai_run.model = 'conversation-act-v1'
          and ai_run.metadata ->> 'retrievalSkipped' = 'true'
    $$,
    array['conversation_acknowledgement'::text],
    'The acknowledgement records a deterministic retrieval-free audit run'
);

select extensions.results_eq(
    $$
        select conversation.status::text
        from public.conversations as conversation
        where conversation.id = (
            select conversation_id
            from acknowledgement_conversation
        )
          and not exists (
              select 1
              from public.handoffs as handoff
              where handoff.conversation_id = conversation.id
          )
          and not exists (
              select 1
              from public.knowledge_gaps as gap
              where gap.first_conversation_id = conversation.id
          )
    $$,
    array['active_ai'::text],
    'The acknowledgement keeps the conversation active without a handoff or gap'
);

select extensions.results_eq(
    $$
        select replay.created
        from public.complete_public_acknowledgement_turn(
            p_organization_id => '00000000-0000-4000-a000-000000000001',
            p_conversation_id => (select conversation_id from acknowledgement_conversation),
            p_customer_message_id => (
                select customer_message_id
                from acknowledgement_customer_message
            ),
            p_answer => 'Yes, I can hear you. What would you like help with?',
            p_language => 'en',
            p_latency_ms => 1,
            p_request_id => 'pgtap-conversational-acknowledgement-replay'
        ) as replay
    $$,
    array[false],
    'A repeated completion replays the existing acknowledgement'
);

select extensions.results_eq(
    $$
        select count(*)::bigint
        from public.messages as message
        where message.conversation_id = (
            select conversation_id
            from acknowledgement_conversation
        )
          and message.sender_type = 'ai'
    $$,
    array[1::bigint],
    'Acknowledgement replay creates no duplicate AI message'
);

reset role;
select extensions.finish();

rollback;
