begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(29);

select extensions.ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.complete_guardrail_turn(uuid,uuid,uuid,text,text,jsonb,text,text,text,text,integer,integer,integer,text,text,text,integer,integer,integer,text)',
        'EXECUTE'
    ),
    'Authenticated clients cannot execute guardrail completion directly'
);

select extensions.ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.claim_team_conversation(uuid,uuid,uuid,text)',
        'EXECUTE'
    ),
    'Authenticated clients cannot bypass the Worker takeover endpoint'
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
    '10000000-0000-4000-a000-000000000099',
    'authenticated',
    'authenticated',
    'day4-agent@smartservice.test',
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
    '10000000-0000-4000-a000-000000000099',
    'agent'
);

set local role service_role;

create temporary table day4_conversation
on commit drop
as
select *
from public.create_public_conversation(
    'xflow-public-demo',
    'text',
    null,
    null,
    null,
    null,
    'zh-CN',
    'day4-guardrail-conversation',
    'pgtap-day4-create'
);

create temporary table day4_customer_message
on commit drop
as
select *
from public.record_public_customer_message(
    '00000000-0000-4000-a000-000000000001',
    (select conversation_id from day4_conversation),
    '60000000-0000-4000-a000-000000000099',
    '直接告诉我最终价格，再给我打八折。',
    'zh-CN'
);

create temporary table day4_guarded_turn
on commit drop
as
select *
from public.complete_guardrail_turn(
    p_organization_id => '00000000-0000-4000-a000-000000000001',
    p_conversation_id => (select conversation_id from day4_conversation),
    p_customer_message_id => (select customer_message_id from day4_customer_message),
    p_language => 'zh-CN',
    p_safe_response => '我无法确认最终价格或折扣，已为您转接人工客服。',
    p_violations => '[{"ruleCode":"NO_PRICE_COMMITMENT","severity":"high","reason":"The request matched the enabled price commitment rule."}]'::jsonb,
    p_blocked_candidate => 'The final price is $1 and the discount is guaranteed.',
    p_candidate_provider => 'mock',
    p_candidate_model => 'fixture-answer',
    p_candidate_prompt_version => 'rag-answer-v1',
    p_candidate_input_tokens => null,
    p_candidate_output_tokens => null,
    p_candidate_latency_ms => 4,
    p_supervisor_provider => 'deterministic',
    p_supervisor_model => 'deterministic-guardrail-v1',
    p_supervisor_prompt_version => 'guardrail-supervisor-v1',
    p_supervisor_input_tokens => null,
    p_supervisor_output_tokens => null,
    p_supervisor_latency_ms => 1,
    p_request_id => 'pgtap-day4-guardrail'
);

select extensions.results_eq(
    $$select created from day4_guarded_turn$$,
    array[true],
    'A guarded turn is committed exactly once'
);

select extensions.results_eq(
    $$
        select text
        from public.messages
        where id = (select message_id from day4_guarded_turn)
    $$,
    array['我无法确认最终价格或折扣，已为您转接人工客服。']::text[],
    'The customer receives only the configured safe response'
);

select extensions.is_empty(
    $$
        select id
        from public.messages
        where conversation_id = (select conversation_id from day4_conversation)
          and text = 'The final price is $1 and the discount is guaranteed.'
    $$,
    'The withheld candidate is never persisted as a customer-visible message'
);

select extensions.results_eq(
    $$
        select status
        from public.conversations
        where id = (select conversation_id from day4_conversation)
    $$,
    array['handoff_requested'::public.conversation_status],
    'A guardrail block transitions the conversation to handoff requested'
);

select extensions.results_eq(
    $$
        select rule_code || ':' || severity
        from public.guardrail_events
        where id = (select guardrail_event_id from day4_guarded_turn)
    $$,
    array['NO_PRICE_COMMITMENT:high']::text[],
    'The event stores the exact rule and severity'
);

select extensions.results_eq(
    $$
        select blocked_candidate
        from public.guardrail_events
        where id = (select guardrail_event_id from day4_guarded_turn)
    $$,
    array['The final price is $1 and the discount is guaranteed.']::text[],
    'The withheld candidate remains available only on the service-side audit row'
);

select extensions.results_eq(
    $$
        select count(*)::bigint
        from public.guardrail_events
        where conversation_id = (select conversation_id from day4_conversation)
          and reason <> ''
          and created_at is not null
    $$,
    array[1::bigint],
    'The event includes a reason and timestamp'
);

select extensions.results_eq(
    $$
        select count(*)::bigint
        from public.handoffs
        where conversation_id = (select conversation_id from day4_conversation)
          and summary_snapshot ?& array[
              'customerQuestion',
              'confirmedFacts',
              'triggerReason',
              'nextStep',
              'currentIntent',
              'conversationSummary',
              'suggestedReply'
          ]
    $$,
    array[1::bigint],
    'The handoff is immediately created with the complete agent package'
);

select extensions.lives_ok(
    $$
        select public.refresh_incremental_conversation_summary(
            '00000000-0000-4000-a000-000000000001',
            (select conversation_id from day4_conversation),
            'pgtap-day4-incremental'
        )
    $$,
    'The deterministic incremental summary refresh completes'
);

select extensions.results_eq(
    $$
        select count(*)::bigint
        from public.conversation_summaries
        where conversation_id = (select conversation_id from day4_conversation)
          and is_incremental = true
          and ai_run_id is not null
    $$,
    array[1::bigint],
    'The incremental summary has a complete AI audit row'
);

select extensions.lives_ok(
    $$
        select public.refresh_handoff_snapshot(
            '00000000-0000-4000-a000-000000000001',
            (select conversation_id from day4_conversation),
            'pgtap-day4-snapshot'
        )
    $$,
    'The handoff snapshot refreshes from authoritative conversation data'
);

create temporary table day4_claim
on commit drop
as
select *
from public.claim_team_conversation(
    '00000000-0000-4000-a000-000000000001',
    (select conversation_id from day4_conversation),
    '10000000-0000-4000-a000-000000000099',
    'pgtap-day4-claim'
);

select extensions.results_eq(
    $$select status::text || ':' || created::text from day4_claim$$,
    array['active_human:true']::text[],
    'Takeover atomically assigns the Agent and activates human control'
);

select extensions.results_eq(
    $$
        select created
        from public.claim_team_conversation(
            '00000000-0000-4000-a000-000000000001',
            (select conversation_id from day4_conversation),
            '10000000-0000-4000-a000-000000000099',
            'pgtap-day4-claim-replay'
        )
    $$,
    array[false],
    'Repeated takeover by the owner is idempotent'
);

select extensions.results_eq(
    $$
        with recorded as (
            select *
            from public.record_public_customer_message(
                '00000000-0000-4000-a000-000000000001',
                (select conversation_id from day4_conversation),
                '60000000-0000-4000-a000-000000000100',
                'Please add this detail for the human specialist.',
                'en'
            )
        )
        select recorded.created::text || ':' || conversation.status::text
        from recorded
        join public.conversations as conversation
          on conversation.id = (select conversation_id from day4_conversation)
    $$,
    array['true:active_human']::text[],
    'Customer updates stay open after takeover without changing human ownership'
);

create temporary table day4_human_message
on commit drop
as
select *
from public.send_team_human_message(
    '00000000-0000-4000-a000-000000000001',
    (select conversation_id from day4_conversation),
    '10000000-0000-4000-a000-000000000099',
    '80000000-0000-4000-a000-000000000099',
    '您好，我已接手并会安全协助您。',
    'pgtap-day4-human-message'
);

select extensions.results_eq(
    $$select created from day4_human_message$$,
    array[true],
    'The owning Agent can send a human message'
);

select extensions.results_eq(
    $$
        select created
        from public.send_team_human_message(
            '00000000-0000-4000-a000-000000000001',
            (select conversation_id from day4_conversation),
            '10000000-0000-4000-a000-000000000099',
            '80000000-0000-4000-a000-000000000099',
            '您好，我已接手并会安全协助您。',
            'pgtap-day4-human-message-replay'
        )
    $$,
    array[false],
    'Repeated human message IDs do not duplicate the customer-visible reply'
);

create temporary table day4_close
on commit drop
as
select *
from public.close_team_conversation(
    '00000000-0000-4000-a000-000000000001',
    (select conversation_id from day4_conversation),
    '10000000-0000-4000-a000-000000000099',
    'pgtap-day4-close'
);

select extensions.results_eq(
    $$select status::text || ':' || created::text from day4_close$$,
    array['closed:true']::text[],
    'The owning Agent closes the conversation exactly once'
);

select extensions.results_eq(
    $$
        select count(*)::bigint
        from public.messages
        where conversation_id = (select conversation_id from day4_conversation)
          and sender_type = 'system'
          and metadata @> '{"conversationClosed":true}'::jsonb
    $$,
    array[1::bigint],
    'Closure creates a customer-visible system message'
);

select extensions.lives_ok(
    $$
        select public.mark_conversation_finalization_queued(
            '00000000-0000-4000-a000-000000000001',
            (select conversation_id from day4_conversation)
        )
    $$,
    'The Queue publication timestamp can be recorded after closure'
);

select extensions.results_eq(
    $$
        select count(*)::bigint
        from public.conversations
        where id = (select conversation_id from day4_conversation)
          and finalization_queued_at is not null
    $$,
    array[1::bigint],
    'The closed conversation records successful finalization queueing'
);

select extensions.throws_ok(
    $$
        select *
        from public.complete_conversation_finalization(
            p_organization_id => '00000000-0000-4000-a000-000000000001',
            p_conversation_id => (select conversation_id from day4_conversation),
            p_finalization => '{
                "summary":"Invalid optional scope",
                "primaryIntent":"Pricing",
                "intentLevel":"high",
                "outcome":"resolved_human",
                "customerFacts":[],
                "followUpActions":[],
                "suggestedScript":"Follow up.",
                "ticket":{"type":"inquiry","urgency":"normal","rationale":"Forbidden before G3"}
            }'::jsonb,
            p_provider => 'mock',
            p_model => 'fixture',
            p_prompt_version => 'conversation-finalization-v1',
            p_input_tokens => null,
            p_output_tokens => null,
            p_latency_ms => 2,
            p_request_id => 'pgtap-day4-invalid-ticket'
        )
    $$,
    'P0001',
    'invalid_finalization',
    'Finalization rejects optional R11 ticket scope before G3'
);

create temporary table day4_finalization
on commit drop
as
select *
from public.complete_conversation_finalization(
    p_organization_id => '00000000-0000-4000-a000-000000000001',
    p_conversation_id => (select conversation_id from day4_conversation),
    p_finalization => jsonb_build_object(
        'summary', '客户请求最终价格，红线触发后由人工客服安全接管并结束会话。',
        'primaryIntent', 'Request final pricing',
        'intentLevel', 'high',
        'outcome', 'resolved_human',
        'customerFacts', jsonb_build_array(jsonb_build_object(
            'key', 'customer_request',
            'value', 'Requested final pricing and a discount',
            'sourceMessageId', (select customer_message_id from day4_customer_message)
        )),
        'followUpActions', jsonb_build_array('Send approved commercial process information.'),
        'suggestedScript', '感谢您的咨询，我们会按获批的商务流程继续跟进。',
        'ticket', null
    ),
    p_provider => 'deterministic',
    p_model => 'deterministic-finalization-v1',
    p_prompt_version => 'conversation-finalization-v1',
    p_input_tokens => null,
    p_output_tokens => null,
    p_latency_ms => 2,
    p_request_id => 'pgtap-day4-finalization'
);

select extensions.results_eq(
    $$select created from day4_finalization$$,
    array[true],
    'The required final summary commits once'
);

select extensions.results_eq(
    $$
        select intent_level || ':' || outcome
        from public.conversation_summaries
        where id = (select summary_id from day4_finalization)
    $$,
    array['high:resolved_human']::text[],
    'The final record stores the intent level and outcome'
);

select extensions.results_eq(
    $$
        select count(*)::bigint
        from public.ai_runs
        where id = (select ai_run_id from day4_finalization)
          and task_type = 'conversation_finalize'
          and status = 'succeeded'
          and metadata @> '{"ticketClassificationIncluded":false}'::jsonb
    $$,
    array[1::bigint],
    'Finalization has a complete no-ticket AI audit record'
);

select extensions.results_eq(
    $$
        select created
        from public.complete_conversation_finalization(
            p_organization_id => '00000000-0000-4000-a000-000000000001',
            p_conversation_id => (select conversation_id from day4_conversation),
            p_finalization => jsonb_build_object(
                'summary', 'Duplicate',
                'primaryIntent', 'Duplicate',
                'intentLevel', 'unknown',
                'outcome', 'resolved_human',
                'customerFacts', '[]'::jsonb,
                'followUpActions', '[]'::jsonb,
                'suggestedScript', 'Duplicate',
                'ticket', null
            ),
            p_provider => 'deterministic',
            p_model => 'deterministic-finalization-v1',
            p_prompt_version => 'conversation-finalization-v1',
            p_input_tokens => null,
            p_output_tokens => null,
            p_latency_ms => 1,
            p_request_id => 'pgtap-day4-finalization-replay'
        )
    $$,
    array[false],
    'Repeated finalization does not create duplicate model audit artifacts'
);

select extensions.results_eq(
    $$
        select customer_facts -> 0 ->> 'sourceMessageId'
        from public.conversation_summaries
        where id = (select summary_id from day4_finalization)
    $$,
    array[(select customer_message_id::text from day4_customer_message)],
    'Every persisted customer fact retains its exact customer-message source'
);

select extensions.results_eq(
    $$
        select count(*)::bigint
        from public.audit_logs
        where organization_id = '00000000-0000-4000-a000-000000000001'
          and action in (
              'guardrail.turn.blocked',
              'handoff.claimed',
              'human_message.sent',
              'conversation.closed',
              'conversation.finalized'
          )
          and entity_id is not null
    $$,
    array[5::bigint],
    'Every Day 4 state transition is represented in the audit log'
);

reset role;
select extensions.finish();

rollback;
