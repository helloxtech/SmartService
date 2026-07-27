alter table public.conversations
add column closed_by uuid references auth.users(id) on delete set null,
add column finalization_queued_at timestamptz;

create index conversations_closed_by_idx
on public.conversations (closed_by, closed_at desc)
where closed_by is not null;

alter table public.conversation_summaries
add constraint conversation_summaries_intent_level_check
check (
    intent_level is null
    or intent_level in ('low', 'medium', 'high', 'unknown')
),
add constraint conversation_summaries_outcome_check
check (
    outcome is null
    or outcome in (
        'resolved_ai',
        'resolved_human',
        'unresolved',
        'follow_up_required'
    )
);

create or replace function public.build_handoff_snapshot(
    p_organization_id uuid,
    p_conversation_id uuid,
    p_trigger_reason text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_conversation public.conversations%rowtype;
    v_confirmed_facts jsonb := '[]'::jsonb;
    v_customer_question text;
    v_summary public.conversation_summaries%rowtype;
    v_transcript text;
begin
    select conversation.*
    into v_conversation
    from public.conversations as conversation
    where conversation.id = p_conversation_id
      and conversation.organization_id = p_organization_id;

    if not found then
        raise exception 'conversation_not_found';
    end if;

    select message.text
    into v_customer_question
    from public.messages as message
    where message.organization_id = p_organization_id
      and message.conversation_id = p_conversation_id
      and message.sender_type = 'customer'
    order by message.created_at desc, message.id desc
    limit 1;

    select summary.*
    into v_summary
    from public.conversation_summaries as summary
    where summary.organization_id = p_organization_id
      and summary.conversation_id = p_conversation_id
    order by summary.is_incremental desc, summary.version desc
    limit 1;

    if v_summary.id is not null then
        select coalesce(
            jsonb_agg(left(fact ->> 'value', 500))
                filter (where fact ->> 'value' is not null),
            '[]'::jsonb
        )
        into v_confirmed_facts
        from jsonb_array_elements(v_summary.customer_facts) as fact;
    end if;

    select left(
        coalesce(
            string_agg(
                recent.sender_type::text || ': ' || left(recent.text, 500),
                E'\n'
                order by recent.created_at, recent.id
            ),
            case
                when v_conversation.language = 'zh-CN'
                    then '会话中尚无可用消息。'
                else 'No conversation messages are available.'
            end
        ),
        4000
    )
    into v_transcript
    from (
        select message.id, message.sender_type, message.text, message.created_at
        from public.messages as message
        where message.organization_id = p_organization_id
          and message.conversation_id = p_conversation_id
        order by message.created_at desc, message.id desc
        limit 12
    ) as recent;

    return jsonb_build_object(
        'customerQuestion',
        coalesce(
            v_customer_question,
            case
                when v_conversation.language = 'zh-CN' then '未提供'
                else 'Not provided'
            end
        ),
        'confirmedFacts',
        v_confirmed_facts,
        'triggerReason',
        left(p_trigger_reason, 1000),
        'nextStep',
        case
            when v_conversation.language = 'zh-CN'
                then '人工客服应查看会话、确认客户需求并安全回复。'
            else 'A human support specialist should review the conversation, confirm the request, and respond safely.'
        end,
        'currentIntent',
        left(
            coalesce(
                v_summary.primary_intent,
                v_conversation.primary_intent,
                case
                    when v_conversation.language = 'zh-CN' then '未提供'
                    else 'Not provided'
                end
            ),
            240
        ),
        'conversationSummary',
        left(coalesce(v_summary.summary, v_transcript), 4000),
        'suggestedReply',
        left(
            coalesce(
                v_summary.suggested_script,
                case
                    when v_conversation.language = 'zh-CN'
                        then '您好，我已查看目前的会话记录。请允许我先确认您的具体需求。'
                    else 'Hello, I have reviewed the conversation so far. Let me first confirm your specific request.'
                end
            ),
            1200
        )
    );
end;
$$;

create or replace function public.refresh_incremental_conversation_summary(
    p_organization_id uuid,
    p_conversation_id uuid,
    p_request_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_ai_run_id uuid;
    v_conversation public.conversations%rowtype;
    v_first_question text;
    v_summary_id uuid;
    v_summary_text text;
    v_version integer;
begin
    select conversation.*
    into v_conversation
    from public.conversations as conversation
    where conversation.id = p_conversation_id
      and conversation.organization_id = p_organization_id
    for update;

    if not found then
        raise exception 'conversation_not_found';
    end if;

    select message.text
    into v_first_question
    from public.messages as message
    where message.organization_id = p_organization_id
      and message.conversation_id = p_conversation_id
      and message.sender_type = 'customer'
    order by message.created_at, message.id
    limit 1;

    select left(
        coalesce(
            string_agg(
                recent.sender_type::text || ': ' || left(recent.text, 500),
                E'\n'
                order by recent.created_at, recent.id
            ),
            case
                when v_conversation.language = 'zh-CN'
                    then '会话中尚无可用消息。'
                else 'No conversation messages are available.'
            end
        ),
        4000
    )
    into v_summary_text
    from (
        select message.id, message.sender_type, message.text, message.created_at
        from public.messages as message
        where message.organization_id = p_organization_id
          and message.conversation_id = p_conversation_id
        order by message.created_at desc, message.id desc
        limit 12
    ) as recent;

    select coalesce(max(summary.version), 0) + 1
    into v_version
    from public.conversation_summaries as summary
    where summary.organization_id = p_organization_id
      and summary.conversation_id = p_conversation_id
      and summary.is_incremental = true;

    insert into public.ai_runs (
        organization_id,
        conversation_id,
        task_type,
        provider,
        model,
        prompt_version,
        latency_ms,
        status,
        metadata
    )
    values (
        p_organization_id,
        p_conversation_id,
        'incremental_summary',
        'deterministic',
        'transcript-snapshot-v1',
        'incremental-summary-v1',
        0,
        'succeeded',
        jsonb_build_object('summaryVersion', v_version)
    )
    returning id into v_ai_run_id;

    insert into public.conversation_summaries (
        organization_id,
        conversation_id,
        version,
        is_incremental,
        summary,
        primary_intent,
        intent_level,
        outcome,
        customer_facts,
        follow_up_actions,
        suggested_script,
        model,
        prompt_version,
        ai_run_id
    )
    values (
        p_organization_id,
        p_conversation_id,
        v_version,
        true,
        v_summary_text,
        left(coalesce(v_first_question, 'General customer-service request'), 200),
        'unknown',
        null,
        '[]'::jsonb,
        '[]'::jsonb,
        case
            when v_conversation.language = 'zh-CN'
                then '您好，我已查看目前的会话记录。请允许我先确认您的具体需求。'
            else 'Hello, I have reviewed the conversation so far. Let me first confirm your specific request.'
        end,
        'transcript-snapshot-v1',
        'incremental-summary-v1',
        v_ai_run_id
    )
    returning id into v_summary_id;

    update public.conversations
    set primary_intent = coalesce(
        primary_intent,
        left(coalesce(v_first_question, 'General customer-service request'), 200)
    )
    where id = p_conversation_id
      and organization_id = p_organization_id;

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
        'conversation.incremental_summary.refreshed',
        'conversation_summary',
        v_summary_id,
        p_request_id,
        jsonb_build_object('version', v_version)
    );

    return v_summary_id;
end;
$$;

create or replace function public.refresh_handoff_snapshot(
    p_organization_id uuid,
    p_conversation_id uuid,
    p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_reason text;
    v_snapshot jsonb;
begin
    select handoff.reason
    into v_reason
    from public.handoffs as handoff
    where handoff.organization_id = p_organization_id
      and handoff.conversation_id = p_conversation_id
    for update;

    if v_reason is null then
        raise exception 'handoff_not_found';
    end if;

    v_snapshot := public.build_handoff_snapshot(
        p_organization_id,
        p_conversation_id,
        v_reason
    );

    update public.handoffs
    set summary_snapshot = v_snapshot
    where organization_id = p_organization_id
      and conversation_id = p_conversation_id;

    return v_snapshot;
end;
$$;

create or replace function public.complete_guardrail_turn(
    p_organization_id uuid,
    p_conversation_id uuid,
    p_customer_message_id uuid,
    p_language text,
    p_safe_response text,
    p_violations jsonb,
    p_blocked_candidate text,
    p_candidate_provider text,
    p_candidate_model text,
    p_candidate_prompt_version text,
    p_candidate_input_tokens integer,
    p_candidate_output_tokens integer,
    p_candidate_latency_ms integer,
    p_supervisor_provider text,
    p_supervisor_model text,
    p_supervisor_prompt_version text,
    p_supervisor_input_tokens integer,
    p_supervisor_output_tokens integer,
    p_supervisor_latency_ms integer,
    p_request_id text
)
returns table (
    message_id uuid,
    guardrail_event_id uuid,
    supervisor_ai_run_id uuid,
    created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_candidate_ai_run_id uuid;
    v_event_id uuid;
    v_existing_message_id uuid;
    v_message_id uuid;
    v_status public.conversation_status;
    v_supervisor_ai_run_id uuid;
begin
    if p_language not in ('zh-CN', 'en')
        or char_length(p_safe_response) not between 1 and 600
        or jsonb_typeof(p_violations) <> 'array'
        or jsonb_array_length(p_violations) not between 1 and 20
    then
        raise exception 'invalid_guardrail_input';
    end if;

    if exists (
        select 1
        from jsonb_array_elements(p_violations) as violation
        left join public.guardrail_rules as rule
          on rule.organization_id = p_organization_id
         and rule.code = violation ->> 'ruleCode'
         and rule.enabled = true
        where rule.id is null
           or violation ->> 'severity' <> rule.severity
           or char_length(coalesce(violation ->> 'reason', '')) not between 1 and 500
    ) then
        raise exception 'guardrail_rule_invalid';
    end if;

    select conversation.status
    into v_status
    from public.conversations as conversation
    where conversation.id = p_conversation_id
      and conversation.organization_id = p_organization_id
    for update;

    if v_status is null then
        raise exception 'conversation_not_found';
    end if;

    select message.id
    into v_existing_message_id
    from public.messages as message
    where message.organization_id = p_organization_id
      and message.conversation_id = p_conversation_id
      and message.sender_type = 'ai'
      and message.metadata ->> 'replyToMessageId' = p_customer_message_id::text
    order by message.created_at
    limit 1;

    if v_existing_message_id is not null then
        select guardrail_event.id, guardrail_event.ai_run_id
        into v_event_id, v_supervisor_ai_run_id
        from public.guardrail_events as guardrail_event
        where guardrail_event.organization_id = p_organization_id
          and guardrail_event.conversation_id = p_conversation_id
          and guardrail_event.customer_message_id = p_customer_message_id
        order by guardrail_event.created_at, guardrail_event.id
        limit 1;

        return query
        select
            v_existing_message_id,
            v_event_id,
            v_supervisor_ai_run_id,
            false;
        return;
    end if;

    if v_status <> 'active_ai' then
        raise exception 'conversation_not_ai_active';
    end if;

    if not exists (
        select 1
        from public.messages as customer_message
        where customer_message.id = p_customer_message_id
          and customer_message.organization_id = p_organization_id
          and customer_message.conversation_id = p_conversation_id
          and customer_message.sender_type = 'customer'
    ) then
        raise exception 'customer_message_not_found';
    end if;

    if p_candidate_provider is not null then
        insert into public.ai_runs (
            organization_id,
            conversation_id,
            task_type,
            provider,
            model,
            prompt_version,
            input_tokens,
            output_tokens,
            latency_ms,
            status,
            metadata
        )
        values (
            p_organization_id,
            p_conversation_id,
            'rag_answer',
            p_candidate_provider,
            coalesce(p_candidate_model, 'unknown'),
            coalesce(p_candidate_prompt_version, 'unknown'),
            p_candidate_input_tokens,
            p_candidate_output_tokens,
            greatest(coalesce(p_candidate_latency_ms, 0), 0),
            'succeeded',
            jsonb_build_object(
                'blockedByGuardrail', true,
                'replyToMessageId', p_customer_message_id
            )
        )
        returning id into v_candidate_ai_run_id;
    end if;

    insert into public.ai_runs (
        organization_id,
        conversation_id,
        task_type,
        provider,
        model,
        prompt_version,
        input_tokens,
        output_tokens,
        latency_ms,
        status,
        metadata
    )
    values (
        p_organization_id,
        p_conversation_id,
        'guardrail',
        p_supervisor_provider,
        p_supervisor_model,
        p_supervisor_prompt_version,
        p_supervisor_input_tokens,
        p_supervisor_output_tokens,
        greatest(p_supervisor_latency_ms, 0),
        'succeeded',
        jsonb_build_object(
            'candidateAiRunId', v_candidate_ai_run_id,
            'replyToMessageId', p_customer_message_id,
            'violationCount', jsonb_array_length(p_violations)
        )
    )
    returning id into v_supervisor_ai_run_id;

    insert into public.messages (
        organization_id,
        conversation_id,
        sender_type,
        text,
        decision,
        language,
        metadata,
        ai_run_id
    )
    values (
        p_organization_id,
        p_conversation_id,
        'ai',
        p_safe_response,
        'handoff',
        p_language,
        jsonb_build_object(
            'handoffReason', 'guardrail',
            'replyToMessageId', p_customer_message_id
        ),
        v_supervisor_ai_run_id
    )
    returning id into v_message_id;

    insert into public.guardrail_events (
        organization_id,
        conversation_id,
        customer_message_id,
        rule_id,
        rule_code,
        severity,
        reason,
        blocked_candidate,
        model,
        prompt_version,
        ai_run_id
    )
    select
        p_organization_id,
        p_conversation_id,
        p_customer_message_id,
        rule.id,
        violation ->> 'ruleCode',
        violation ->> 'severity',
        violation ->> 'reason',
        p_blocked_candidate,
        p_supervisor_model,
        p_supervisor_prompt_version,
        v_supervisor_ai_run_id
    from jsonb_array_elements(p_violations) as violation
    join public.guardrail_rules as rule
      on rule.organization_id = p_organization_id
     and rule.code = violation ->> 'ruleCode'
     and rule.enabled = true;

    select guardrail_event.id
    into v_event_id
    from public.guardrail_events as guardrail_event
    where guardrail_event.organization_id = p_organization_id
      and guardrail_event.conversation_id = p_conversation_id
      and guardrail_event.customer_message_id = p_customer_message_id
    order by guardrail_event.created_at, guardrail_event.id
    limit 1;

    update public.conversations
    set
        status = 'handoff_requested',
        handoff_reason = 'guardrail',
        handoff_requested_at = coalesce(handoff_requested_at, now())
    where id = p_conversation_id
      and organization_id = p_organization_id;

    insert into public.handoffs (
        organization_id,
        conversation_id,
        reason,
        summary_snapshot
    )
    values (
        p_organization_id,
        p_conversation_id,
        'guardrail',
        public.build_handoff_snapshot(
            p_organization_id,
            p_conversation_id,
            'guardrail'
        )
    )
    on conflict (conversation_id)
    do update
    set
        reason = excluded.reason,
        summary_snapshot = excluded.summary_snapshot;

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
        'guardrail.turn.blocked',
        'guardrail_event',
        v_event_id,
        p_request_id,
        jsonb_build_object(
            'customerMessageId', p_customer_message_id,
            'violationCount', jsonb_array_length(p_violations)
        )
    );

    return query
    select v_message_id, v_event_id, v_supervisor_ai_run_id, true;
end;
$$;

create or replace function public.manage_guardrail_rule(
    p_organization_id uuid,
    p_actor_user_id uuid,
    p_rule_id uuid,
    p_code text,
    p_name text,
    p_description text,
    p_severity text,
    p_rule_type text,
    p_safe_response text,
    p_enabled boolean,
    p_request_id text
)
returns table (
    id uuid,
    code text,
    name text,
    description text,
    severity text,
    rule_type text,
    safe_response text,
    enabled boolean,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rule public.guardrail_rules%rowtype;
begin
    if not exists (
        select 1
        from public.organization_members as member
        where member.organization_id = p_organization_id
          and member.user_id = p_actor_user_id
          and member.role = 'admin'
          and member.is_active = true
    ) then
        raise exception 'admin_required';
    end if;

    if p_code !~ '^[A-Z][A-Z0-9_]{2,79}$'
        or char_length(p_name) not between 1 and 160
        or char_length(p_description) not between 1 and 2000
        or p_severity not in ('low', 'medium', 'high', 'critical')
        or p_rule_type not in (
            'price',
            'delivery',
            'competitor',
            'security',
            'unsupported_claim',
            'safety',
            'custom'
        )
        or char_length(p_safe_response) not between 1 and 4000
    then
        raise exception 'invalid_guardrail_rule';
    end if;

    if p_rule_id is null then
        insert into public.guardrail_rules (
            organization_id,
            code,
            name,
            description,
            severity,
            rule_type,
            safe_response,
            enabled
        )
        values (
            p_organization_id,
            p_code,
            p_name,
            p_description,
            p_severity,
            p_rule_type,
            p_safe_response,
            p_enabled
        )
        returning * into v_rule;
    else
        update public.guardrail_rules as rule
        set
            name = p_name,
            description = p_description,
            severity = p_severity,
            rule_type = p_rule_type,
            safe_response = p_safe_response,
            enabled = p_enabled
        where rule.id = p_rule_id
          and rule.organization_id = p_organization_id
          and rule.code = p_code
        returning * into v_rule;

        if v_rule.id is null then
            raise exception 'guardrail_rule_not_found';
        end if;
    end if;

    insert into public.audit_logs (
        organization_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        request_id,
        metadata
    )
    values (
        p_organization_id,
        p_actor_user_id,
        case when p_rule_id is null
            then 'guardrail_rule.created'
            else 'guardrail_rule.updated'
        end,
        'guardrail_rule',
        v_rule.id,
        p_request_id,
        jsonb_build_object(
            'code', v_rule.code,
            'enabled', v_rule.enabled
        )
    );

    return query
    select
        v_rule.id,
        v_rule.code,
        v_rule.name,
        v_rule.description,
        v_rule.severity,
        v_rule.rule_type,
        v_rule.safe_response,
        v_rule.enabled,
        v_rule.created_at,
        v_rule.updated_at;
end;
$$;

create or replace function public.claim_team_conversation(
    p_organization_id uuid,
    p_conversation_id uuid,
    p_actor_user_id uuid,
    p_request_id text
)
returns table (
    accepted_by uuid,
    accepted_at timestamptz,
    status public.conversation_status,
    created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_accepted_at timestamptz;
    v_accepted_by uuid;
    v_language text;
    v_status public.conversation_status;
begin
    if not exists (
        select 1
        from public.organization_members as member
        where member.organization_id = p_organization_id
          and member.user_id = p_actor_user_id
          and member.role in ('admin', 'agent')
          and member.is_active = true
    ) then
        raise exception 'member_required';
    end if;

    select conversation.status, conversation.language
    into v_status, v_language
    from public.conversations as conversation
    where conversation.id = p_conversation_id
      and conversation.organization_id = p_organization_id
    for update;

    if v_status is null then
        raise exception 'conversation_not_found';
    end if;

    select handoff.accepted_by, handoff.accepted_at
    into v_accepted_by, v_accepted_at
    from public.handoffs as handoff
    where handoff.organization_id = p_organization_id
      and handoff.conversation_id = p_conversation_id
    for update;

    if not found then
        raise exception 'handoff_not_found';
    end if;

    if v_status = 'active_human' and v_accepted_by = p_actor_user_id then
        return query
        select v_accepted_by, v_accepted_at, v_status, false;
        return;
    end if;

    if v_status <> 'handoff_requested' or v_accepted_by is not null then
        raise exception 'handoff_already_claimed';
    end if;

    update public.handoffs
    set
        accepted_by = p_actor_user_id,
        accepted_at = now()
    where organization_id = p_organization_id
      and conversation_id = p_conversation_id
    returning public.handoffs.accepted_at
    into v_accepted_at;

    update public.conversations
    set status = 'active_human'
    where id = p_conversation_id
      and organization_id = p_organization_id;

    insert into public.messages (
        organization_id,
        conversation_id,
        sender_type,
        text,
        decision,
        language,
        metadata
    )
    values (
        p_organization_id,
        p_conversation_id,
        'system',
        case
            when v_language = 'zh-CN' then '人工客服已接手此会话。'
            else 'A human support specialist has joined the conversation.'
        end,
        'human',
        v_language,
        jsonb_build_object('handoffClaimedBy', p_actor_user_id)
    );

    insert into public.audit_logs (
        organization_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        request_id,
        metadata
    )
    values (
        p_organization_id,
        p_actor_user_id,
        'handoff.claimed',
        'conversation',
        p_conversation_id,
        p_request_id,
        '{}'::jsonb
    );

    return query
    select p_actor_user_id, v_accepted_at, 'active_human'::public.conversation_status, true;
end;
$$;

create or replace function public.send_team_human_message(
    p_organization_id uuid,
    p_conversation_id uuid,
    p_actor_user_id uuid,
    p_client_message_id uuid,
    p_text text,
    p_request_id text
)
returns table (
    message_id uuid,
    created_at timestamptz,
    created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_created_at timestamptz;
    v_existing_text text;
    v_message_id uuid;
begin
    if char_length(p_text) not between 1 and 5000 then
        raise exception 'invalid_human_message';
    end if;

    if not exists (
        select 1
        from public.organization_members as member
        where member.organization_id = p_organization_id
          and member.user_id = p_actor_user_id
          and member.role in ('admin', 'agent')
          and member.is_active = true
    ) then
        raise exception 'member_required';
    end if;

    if not exists (
        select 1
        from public.conversations as conversation
        join public.handoffs as handoff
          on handoff.conversation_id = conversation.id
         and handoff.organization_id = conversation.organization_id
        where conversation.id = p_conversation_id
          and conversation.organization_id = p_organization_id
          and conversation.status = 'active_human'
          and handoff.accepted_by = p_actor_user_id
    ) then
        raise exception 'conversation_not_owned';
    end if;

    select message.id, message.text, message.created_at
    into v_message_id, v_existing_text, v_created_at
    from public.messages as message
    where message.organization_id = p_organization_id
      and message.conversation_id = p_conversation_id
      and message.client_message_id = p_client_message_id;

    if v_message_id is not null then
        if v_existing_text <> p_text then
            raise exception 'idempotency_payload_mismatch';
        end if;

        return query
        select v_message_id, v_created_at, false;
        return;
    end if;

    insert into public.messages (
        organization_id,
        conversation_id,
        sender_type,
        sender_user_id,
        text,
        decision,
        client_message_id,
        language
    )
    select
        p_organization_id,
        p_conversation_id,
        'human',
        p_actor_user_id,
        p_text,
        'human',
        p_client_message_id,
        conversation.language
    from public.conversations as conversation
    where conversation.id = p_conversation_id
      and conversation.organization_id = p_organization_id
    returning id, public.messages.created_at
    into v_message_id, v_created_at;

    insert into public.audit_logs (
        organization_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        request_id,
        metadata
    )
    values (
        p_organization_id,
        p_actor_user_id,
        'human_message.sent',
        'message',
        v_message_id,
        p_request_id,
        jsonb_build_object('conversationId', p_conversation_id)
    );

    return query
    select v_message_id, v_created_at, true;
end;
$$;

create or replace function public.close_team_conversation(
    p_organization_id uuid,
    p_conversation_id uuid,
    p_actor_user_id uuid,
    p_request_id text
)
returns table (
    status public.conversation_status,
    language text,
    created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_language text;
    v_status public.conversation_status;
begin
    if not exists (
        select 1
        from public.organization_members as member
        where member.organization_id = p_organization_id
          and member.user_id = p_actor_user_id
          and member.role in ('admin', 'agent')
          and member.is_active = true
    ) then
        raise exception 'member_required';
    end if;

    select conversation.status, conversation.language
    into v_status, v_language
    from public.conversations as conversation
    where conversation.id = p_conversation_id
      and conversation.organization_id = p_organization_id
    for update;

    if v_status is null then
        raise exception 'conversation_not_found';
    end if;

    if v_status = 'closed' then
        return query
        select v_status, v_language, false;
        return;
    end if;

    if v_status <> 'active_human'
        or not exists (
            select 1
            from public.handoffs as handoff
            where handoff.organization_id = p_organization_id
              and handoff.conversation_id = p_conversation_id
              and handoff.accepted_by = p_actor_user_id
        )
    then
        raise exception 'conversation_not_owned';
    end if;

    update public.conversations
    set
        status = 'closed',
        closed_at = now(),
        closed_by = p_actor_user_id
    where id = p_conversation_id
      and organization_id = p_organization_id;

    insert into public.messages (
        organization_id,
        conversation_id,
        sender_type,
        text,
        decision,
        language,
        metadata
    )
    values (
        p_organization_id,
        p_conversation_id,
        'system',
        case
            when v_language = 'zh-CN' then '此会话已由人工客服结束。'
            else 'This conversation was closed by the human support specialist.'
        end,
        'human',
        v_language,
        jsonb_build_object('conversationClosed', true)
    );

    insert into public.audit_logs (
        organization_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        request_id,
        metadata
    )
    values (
        p_organization_id,
        p_actor_user_id,
        'conversation.closed',
        'conversation',
        p_conversation_id,
        p_request_id,
        '{}'::jsonb
    );

    return query
    select 'closed'::public.conversation_status, v_language, true;
end;
$$;

create or replace function public.mark_conversation_finalization_queued(
    p_organization_id uuid,
    p_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.conversations
    set finalization_queued_at = coalesce(finalization_queued_at, now())
    where id = p_conversation_id
      and organization_id = p_organization_id
      and status = 'closed';

    if not found then
        raise exception 'closed_conversation_not_found';
    end if;
end;
$$;

create or replace function public.complete_conversation_finalization(
    p_organization_id uuid,
    p_conversation_id uuid,
    p_finalization jsonb,
    p_provider text,
    p_model text,
    p_prompt_version text,
    p_input_tokens integer,
    p_output_tokens integer,
    p_latency_ms integer,
    p_request_id text
)
returns table (
    summary_id uuid,
    ai_run_id uuid,
    created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_ai_run_id uuid;
    v_status public.conversation_status;
    v_summary_id uuid;
begin
    if jsonb_typeof(p_finalization) <> 'object'
        or not (
            p_finalization ?& array[
                'summary',
                'primaryIntent',
                'intentLevel',
                'outcome',
                'customerFacts',
                'followUpActions',
                'suggestedScript',
                'ticket'
            ]
        )
        or p_finalization -> 'ticket' is distinct from 'null'::jsonb
        or char_length(coalesce(p_finalization ->> 'summary', '')) not between 1 and 2000
        or char_length(coalesce(p_finalization ->> 'primaryIntent', '')) not between 1 and 200
        or p_finalization ->> 'intentLevel' not in ('low', 'medium', 'high', 'unknown')
        or p_finalization ->> 'outcome' not in (
            'resolved_ai',
            'resolved_human',
            'unresolved',
            'follow_up_required'
        )
        or jsonb_typeof(p_finalization -> 'customerFacts') <> 'array'
        or jsonb_array_length(p_finalization -> 'customerFacts') > 20
        or jsonb_typeof(p_finalization -> 'followUpActions') <> 'array'
        or jsonb_array_length(p_finalization -> 'followUpActions') > 10
        or char_length(coalesce(p_finalization ->> 'suggestedScript', '')) not between 1 and 1200
        or char_length(coalesce(p_provider, '')) not between 1 and 120
        or char_length(coalesce(p_model, '')) not between 1 and 160
        or char_length(coalesce(p_prompt_version, '')) not between 1 and 160
        or exists (
            select 1
            from jsonb_array_elements(p_finalization -> 'customerFacts') as fact
            where jsonb_typeof(fact) <> 'object'
               or char_length(coalesce(fact ->> 'key', '')) not between 1 and 100
               or char_length(coalesce(fact ->> 'value', '')) not between 1 and 300
               or not (fact ? 'sourceMessageId')
               or (
                    jsonb_typeof(fact -> 'sourceMessageId') not in ('null', 'string')
               )
               or (
                    jsonb_typeof(fact -> 'sourceMessageId') = 'string'
                    and (fact ->> 'sourceMessageId') !~
                        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
               )
        )
        or exists (
            select 1
            from jsonb_array_elements(p_finalization -> 'followUpActions') as action
            where jsonb_typeof(action) <> 'string'
               or char_length(action #>> '{}') not between 1 and 300
        )
    then
        raise exception 'invalid_finalization';
    end if;

    select conversation.status
    into v_status
    from public.conversations as conversation
    where conversation.id = p_conversation_id
      and conversation.organization_id = p_organization_id
    for update;

    if v_status is null then
        raise exception 'conversation_not_found';
    end if;

    if v_status <> 'closed' then
        raise exception 'conversation_not_closed';
    end if;

    if exists (
        select 1
        from jsonb_array_elements(p_finalization -> 'customerFacts') as fact
        where jsonb_typeof(fact -> 'sourceMessageId') = 'string'
          and not exists (
                select 1
                from public.messages as message
                where message.id = (fact ->> 'sourceMessageId')::uuid
                  and message.organization_id = p_organization_id
                  and message.conversation_id = p_conversation_id
                  and message.sender_type = 'customer'
          )
    ) then
        raise exception 'customer_fact_source_invalid';
    end if;

    select summary.id, summary.ai_run_id
    into v_summary_id, v_ai_run_id
    from public.conversation_summaries as summary
    where summary.organization_id = p_organization_id
      and summary.conversation_id = p_conversation_id
      and summary.is_incremental = false
    order by summary.version desc
    limit 1;

    if v_summary_id is not null then
        return query
        select v_summary_id, v_ai_run_id, false;
        return;
    end if;

    insert into public.ai_runs (
        organization_id,
        conversation_id,
        task_type,
        provider,
        model,
        prompt_version,
        input_tokens,
        output_tokens,
        latency_ms,
        status,
        metadata
    )
    values (
        p_organization_id,
        p_conversation_id,
        'conversation_finalize',
        p_provider,
        p_model,
        p_prompt_version,
        p_input_tokens,
        p_output_tokens,
        greatest(p_latency_ms, 0),
        'succeeded',
        jsonb_build_object('ticketClassificationIncluded', false)
    )
    returning id into v_ai_run_id;

    insert into public.conversation_summaries (
        organization_id,
        conversation_id,
        version,
        is_incremental,
        summary,
        primary_intent,
        intent_level,
        outcome,
        customer_facts,
        follow_up_actions,
        suggested_script,
        model,
        prompt_version,
        ai_run_id
    )
    values (
        p_organization_id,
        p_conversation_id,
        1,
        false,
        p_finalization ->> 'summary',
        p_finalization ->> 'primaryIntent',
        p_finalization ->> 'intentLevel',
        p_finalization ->> 'outcome',
        p_finalization -> 'customerFacts',
        p_finalization -> 'followUpActions',
        p_finalization ->> 'suggestedScript',
        p_model,
        p_prompt_version,
        v_ai_run_id
    )
    returning id into v_summary_id;

    update public.conversations
    set primary_intent = left(p_finalization ->> 'primaryIntent', 240)
    where id = p_conversation_id
      and organization_id = p_organization_id;

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
        'conversation.finalized',
        'conversation_summary',
        v_summary_id,
        p_request_id,
        jsonb_build_object('ticketClassificationIncluded', false)
    );

    return query
    select v_summary_id, v_ai_run_id, true;
end;
$$;

revoke update on public.conversations from authenticated;
revoke insert on public.messages from authenticated;
revoke insert, update on public.guardrail_rules from authenticated;
revoke select on public.guardrail_events from authenticated;
revoke update on public.handoffs from authenticated;

revoke all on function public.build_handoff_snapshot(uuid, uuid, text) from public;
revoke all on function public.refresh_incremental_conversation_summary(uuid, uuid, text) from public;
revoke all on function public.refresh_handoff_snapshot(uuid, uuid, text) from public;
revoke all on function public.complete_guardrail_turn(
    uuid,
    uuid,
    uuid,
    text,
    text,
    jsonb,
    text,
    text,
    text,
    text,
    integer,
    integer,
    integer,
    text,
    text,
    text,
    integer,
    integer,
    integer,
    text
) from public;
revoke all on function public.manage_guardrail_rule(
    uuid,
    uuid,
    uuid,
    text,
    text,
    text,
    text,
    text,
    text,
    boolean,
    text
) from public;
revoke all on function public.claim_team_conversation(uuid, uuid, uuid, text) from public;
revoke all on function public.send_team_human_message(uuid, uuid, uuid, uuid, text, text) from public;
revoke all on function public.close_team_conversation(uuid, uuid, uuid, text) from public;
revoke all on function public.mark_conversation_finalization_queued(uuid, uuid) from public;
revoke all on function public.complete_conversation_finalization(
    uuid,
    uuid,
    jsonb,
    text,
    text,
    text,
    integer,
    integer,
    integer,
    text
) from public;

grant execute on function public.build_handoff_snapshot(uuid, uuid, text) to service_role;
grant execute on function public.refresh_incremental_conversation_summary(uuid, uuid, text) to service_role;
grant execute on function public.refresh_handoff_snapshot(uuid, uuid, text) to service_role;
grant execute on function public.complete_guardrail_turn(
    uuid,
    uuid,
    uuid,
    text,
    text,
    jsonb,
    text,
    text,
    text,
    text,
    integer,
    integer,
    integer,
    text,
    text,
    text,
    integer,
    integer,
    integer,
    text
) to service_role;
grant execute on function public.manage_guardrail_rule(
    uuid,
    uuid,
    uuid,
    text,
    text,
    text,
    text,
    text,
    text,
    boolean,
    text
) to service_role;
grant execute on function public.claim_team_conversation(uuid, uuid, uuid, text) to service_role;
grant execute on function public.send_team_human_message(uuid, uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.close_team_conversation(uuid, uuid, uuid, text) to service_role;
grant execute on function public.mark_conversation_finalization_queued(uuid, uuid) to service_role;
grant execute on function public.complete_conversation_finalization(
    uuid,
    uuid,
    jsonb,
    text,
    text,
    text,
    integer,
    integer,
    integer,
    text
) to service_role;
