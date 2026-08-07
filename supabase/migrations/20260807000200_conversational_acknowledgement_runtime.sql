create or replace function public.complete_public_acknowledgement_turn(
    p_organization_id uuid,
    p_conversation_id uuid,
    p_customer_message_id uuid,
    p_answer text,
    p_language text,
    p_latency_ms integer,
    p_request_id text
)
returns table (
    message_id uuid,
    ai_run_id uuid,
    created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_ai_run_id uuid;
    v_existing_ai_run_id uuid;
    v_existing_message_id uuid;
    v_message_id uuid;
    v_status public.conversation_status;
begin
    if p_answer is null
        or p_language is null
        or p_latency_ms is null
        or p_request_id is null
        or p_language not in ('zh-CN', 'en')
        or pg_catalog.char_length(pg_catalog.btrim(p_answer)) not between 1 and 1600
        or p_latency_ms < 0
        or pg_catalog.char_length(p_request_id) not between 1 and 200
    then
        raise exception 'invalid_acknowledgement_input';
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

    select message.id, message.ai_run_id
    into v_existing_message_id, v_existing_ai_run_id
    from public.messages as message
    where message.organization_id = p_organization_id
      and message.conversation_id = p_conversation_id
      and message.sender_type = 'ai'
      and message.metadata ->> 'replyToMessageId' = p_customer_message_id::text
    order by message.created_at
    limit 1;

    if v_existing_message_id is not null then
        return query
        select v_existing_message_id, v_existing_ai_run_id, false;
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
        error_code,
        metadata
    )
    values (
        p_organization_id,
        p_conversation_id,
        'conversation_acknowledgement',
        'deterministic',
        'conversation-act-v1',
        'conversation-act-v1',
        null,
        null,
        p_latency_ms,
        'succeeded',
        null,
        jsonb_build_object(
            'replyToMessageId', p_customer_message_id,
            'retrievalSkipped', true
        )
    )
    returning id into v_ai_run_id;

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
        pg_catalog.btrim(p_answer),
        'acknowledge',
        p_language,
        jsonb_build_object(
            'handoffReason', null,
            'replyToMessageId', p_customer_message_id
        ),
        v_ai_run_id
    )
    returning id into v_message_id;

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
        'public.turn.completed',
        'message',
        v_message_id,
        p_request_id,
        jsonb_build_object(
            'citationCount', 0,
            'decision', 'acknowledge',
            'handoffReason', null
        )
    );

    return query
    select v_message_id, v_ai_run_id, true;
end;
$$;

revoke all on function public.complete_public_acknowledgement_turn(
    uuid,
    uuid,
    uuid,
    text,
    text,
    integer,
    text
) from public, anon, authenticated;

grant execute on function public.complete_public_acknowledgement_turn(
    uuid,
    uuid,
    uuid,
    text,
    text,
    integer,
    text
) to service_role;
