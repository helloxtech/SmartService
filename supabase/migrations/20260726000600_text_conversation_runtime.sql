alter table public.conversations
add column creation_idempotency_key text
    check (
        creation_idempotency_key is null
        or char_length(creation_idempotency_key) between 8 and 200
    );

create unique index conversations_public_creation_idempotency_idx
on public.conversations (organization_id, creation_idempotency_key)
where creation_idempotency_key is not null;

create table public.public_rate_limit_buckets (
    organization_id uuid not null references public.organizations(id) on delete cascade,
    bucket_hash text not null check (bucket_hash ~ '^[a-f0-9]{64}$'),
    action text not null check (char_length(action) between 1 and 80),
    window_started_at timestamptz not null,
    request_count integer not null check (request_count >= 1),
    updated_at timestamptz not null default now(),
    primary key (organization_id, bucket_hash, action)
);

create index public_rate_limit_buckets_updated_idx
on public.public_rate_limit_buckets (updated_at);

alter table public.public_rate_limit_buckets enable row level security;
alter table public.public_rate_limit_buckets force row level security;

revoke all on public.public_rate_limit_buckets from anon, authenticated;
grant all on public.public_rate_limit_buckets to service_role;

create or replace function public.consume_public_rate_limit(
    p_organization_id uuid,
    p_bucket_hash text,
    p_action text,
    p_limit integer,
    p_window_seconds integer
)
returns table (
    allowed boolean,
    remaining integer,
    reset_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_count integer;
    v_window_start timestamptz;
begin
    if p_bucket_hash !~ '^[a-f0-9]{64}$'
        or char_length(p_action) not between 1 and 80
        or p_limit not between 1 and 1000
        or p_window_seconds not between 1 and 86400
    then
        raise exception 'invalid_rate_limit_input';
    end if;

    insert into public.public_rate_limit_buckets (
        organization_id,
        bucket_hash,
        action,
        window_started_at,
        request_count,
        updated_at
    )
    values (
        p_organization_id,
        p_bucket_hash,
        p_action,
        now(),
        1,
        now()
    )
    on conflict (organization_id, bucket_hash, action)
    do update
    set
        request_count = case
            when public.public_rate_limit_buckets.window_started_at
                <= now() - pg_catalog.make_interval(secs => p_window_seconds)
            then 1
            else public.public_rate_limit_buckets.request_count + 1
        end,
        window_started_at = case
            when public.public_rate_limit_buckets.window_started_at
                <= now() - pg_catalog.make_interval(secs => p_window_seconds)
            then now()
            else public.public_rate_limit_buckets.window_started_at
        end,
        updated_at = now()
    returning
        public.public_rate_limit_buckets.request_count,
        public.public_rate_limit_buckets.window_started_at
    into v_count, v_window_start;

    return query
    select
        v_count <= p_limit,
        greatest(p_limit - v_count, 0),
        v_window_start + pg_catalog.make_interval(secs => p_window_seconds);
end;
$$;

create or replace function public.create_public_conversation(
    p_public_key text,
    p_channel public.conversation_channel,
    p_customer_name text,
    p_customer_email text,
    p_customer_phone text,
    p_customer_company text,
    p_language text,
    p_idempotency_key text,
    p_request_id text
)
returns table (
    conversation_id uuid,
    organization_id uuid,
    display_name text,
    welcome_message text,
    created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_conversation_id uuid;
    v_created boolean := false;
    v_display_name text;
    v_organization_id uuid;
    v_welcome_message text;
begin
    if p_language not in ('zh-CN', 'en')
        or char_length(p_idempotency_key) not between 8 and 200
    then
        raise exception 'invalid_conversation_input';
    end if;

    select
        organization.id,
        organization_setting.display_name,
        organization_setting.chat_welcome_message
    into
        v_organization_id,
        v_display_name,
        v_welcome_message
    from public.organizations as organization
    join public.organization_settings as organization_setting
      on organization_setting.organization_id = organization.id
    where organization.public_key = p_public_key;

    if v_organization_id is null then
        return;
    end if;

    insert into public.conversations (
        organization_id,
        channel,
        status,
        customer_name,
        customer_email,
        customer_phone,
        customer_company,
        language,
        creation_idempotency_key
    )
    values (
        v_organization_id,
        p_channel,
        'active_ai',
        p_customer_name,
        p_customer_email,
        p_customer_phone,
        p_customer_company,
        p_language,
        p_idempotency_key
    )
    on conflict do nothing
    returning id into v_conversation_id;

    if v_conversation_id is not null then
        v_created := true;
    else
        select conversation.id
        into v_conversation_id
        from public.conversations as conversation
        where conversation.organization_id = v_organization_id
          and conversation.creation_idempotency_key = p_idempotency_key;
    end if;

    if v_created then
        insert into public.audit_logs (
            organization_id,
            action,
            entity_type,
            entity_id,
            request_id,
            metadata
        )
        values (
            v_organization_id,
            'public.conversation.created',
            'conversation',
            v_conversation_id,
            p_request_id,
            jsonb_build_object('channel', p_channel, 'language', p_language)
        );
    end if;

    return query
    select
        v_conversation_id,
        v_organization_id,
        v_display_name,
        v_welcome_message,
        v_created;
end;
$$;

create or replace function public.record_public_customer_message(
    p_organization_id uuid,
    p_conversation_id uuid,
    p_client_message_id uuid,
    p_text text,
    p_language text
)
returns table (
    customer_message_id uuid,
    created boolean,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_created_at timestamptz;
    v_existing_text text;
    v_message_id uuid;
    v_status public.conversation_status;
begin
    select conversation.status
    into v_status
    from public.conversations as conversation
    where conversation.id = p_conversation_id
      and conversation.organization_id = p_organization_id
    for update;

    if v_status is null then
        raise exception 'conversation_not_found';
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
        select v_message_id, false, v_created_at;
        return;
    end if;

    if v_status <> 'active_ai' then
        raise exception 'conversation_not_ai_active';
    end if;

    insert into public.messages (
        organization_id,
        conversation_id,
        sender_type,
        text,
        client_message_id,
        language
    )
    values (
        p_organization_id,
        p_conversation_id,
        'customer',
        p_text,
        p_client_message_id,
        p_language
    )
    returning id, public.messages.created_at
    into v_message_id, v_created_at;

    update public.conversations
    set language = p_language
    where id = p_conversation_id
      and organization_id = p_organization_id;

    return query
    select v_message_id, true, v_created_at;
end;
$$;

create or replace function public.complete_public_turn(
    p_organization_id uuid,
    p_conversation_id uuid,
    p_customer_message_id uuid,
    p_decision public.message_decision,
    p_answer text,
    p_language text,
    p_citations jsonb,
    p_retrieved_chunk_ids uuid[],
    p_handoff_reason text,
    p_normalized_question text,
    p_create_gap boolean,
    p_provider text,
    p_model text,
    p_prompt_version text,
    p_input_tokens integer,
    p_output_tokens integer,
    p_latency_ms integer,
    p_ai_status text,
    p_error_code text,
    p_request_id text,
    p_retrieval_metadata jsonb
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
    v_citation_count integer;
    v_existing_ai_run_id uuid;
    v_existing_message_id uuid;
    v_message_id uuid;
    v_status public.conversation_status;
begin
    if p_decision not in ('answer', 'clarify', 'handoff')
        or p_language not in ('zh-CN', 'en')
        or p_ai_status not in ('succeeded', 'failed', 'cancelled')
        or jsonb_typeof(p_citations) <> 'array'
        or jsonb_typeof(p_retrieval_metadata) <> 'object'
    then
        raise exception 'invalid_turn_input';
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

    select jsonb_array_length(p_citations)
    into v_citation_count;

    if (p_decision = 'answer' and v_citation_count not between 1 and 5)
        or (p_decision = 'handoff' and (v_citation_count <> 0 or p_handoff_reason is null))
    then
        raise exception 'invalid_turn_decision';
    end if;

    if exists (
        select 1
        from jsonb_array_elements(p_citations) as citation
        left join public.knowledge_chunks as knowledge_chunk
          on knowledge_chunk.id = (citation ->> 'chunkId')::uuid
         and knowledge_chunk.organization_id = p_organization_id
        left join public.knowledge_sources as knowledge_source
          on knowledge_source.id = knowledge_chunk.source_id
         and knowledge_source.organization_id = knowledge_chunk.organization_id
        left join public.knowledge_documents as knowledge_document
          on knowledge_document.id = knowledge_chunk.document_id
         and knowledge_document.organization_id = knowledge_chunk.organization_id
        where (citation ->> 'chunkId')::uuid
                <> all(coalesce(p_retrieved_chunk_ids, array[]::uuid[]))
           or knowledge_chunk.id is null
           or knowledge_chunk.enabled = false
           or knowledge_source.enabled = false
           or knowledge_source.deleted_at is not null
           or knowledge_source.status <> 'ready'
           or knowledge_document.enabled = false
           or knowledge_document.deleted_at is not null
           or knowledge_document.version <> knowledge_source.active_version
           or knowledge_chunk.document_version <> knowledge_source.active_version
    ) then
        raise exception 'citation_not_in_retrieval';
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
        'rag_answer',
        p_provider,
        p_model,
        p_prompt_version,
        p_input_tokens,
        p_output_tokens,
        p_latency_ms,
        p_ai_status,
        p_error_code,
        jsonb_build_object(
            'retrieval', p_retrieval_metadata,
            'replyToMessageId', p_customer_message_id
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
        p_answer,
        p_decision,
        p_language,
        jsonb_build_object(
            'handoffReason', p_handoff_reason,
            'replyToMessageId', p_customer_message_id
        ),
        v_ai_run_id
    )
    returning id into v_message_id;

    insert into public.message_citations (
        organization_id,
        message_id,
        chunk_id,
        label,
        supporting_excerpt
    )
    select
        p_organization_id,
        v_message_id,
        (citation ->> 'chunkId')::uuid,
        left(citation ->> 'label', 240),
        left(citation ->> 'supportingExcerpt', 2000)
    from jsonb_array_elements(p_citations) as citation;

    if p_decision = 'handoff' then
        update public.conversations
        set
            status = 'handoff_requested',
            handoff_reason = p_handoff_reason,
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
            p_handoff_reason,
            jsonb_build_object(
                'customerQuestion', (
                    select customer_message.text
                    from public.messages as customer_message
                    where customer_message.id = p_customer_message_id
                ),
                'confirmedFacts', jsonb_build_array(),
                'triggerReason', p_handoff_reason,
                'nextStep', 'A human support specialist should review and respond.'
            )
        )
        on conflict (conversation_id)
        do update
        set
            reason = excluded.reason,
            summary_snapshot = excluded.summary_snapshot;

        if p_create_gap then
            insert into public.knowledge_gaps (
                organization_id,
                normalized_question,
                example_question,
                first_conversation_id,
                occurrence_count,
                reason,
                status,
                last_seen_at
            )
            values (
                p_organization_id,
                p_normalized_question,
                (
                    select customer_message.text
                    from public.messages as customer_message
                    where customer_message.id = p_customer_message_id
                ),
                p_conversation_id,
                1,
                p_handoff_reason,
                'open',
                now()
            )
            on conflict (organization_id, normalized_question)
            do update
            set
                example_question = excluded.example_question,
                occurrence_count = public.knowledge_gaps.occurrence_count + 1,
                reason = excluded.reason,
                status = 'open',
                last_seen_at = now();
        end if;
    end if;

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
            'decision', p_decision,
            'citationCount', v_citation_count,
            'handoffReason', p_handoff_reason
        )
    );

    return query
    select v_message_id, v_ai_run_id, true;
end;
$$;

create or replace function public.request_public_handoff(
    p_organization_id uuid,
    p_conversation_id uuid,
    p_idempotency_key text,
    p_reason text,
    p_system_message text,
    p_language text,
    p_request_id text
)
returns table (
    message_id uuid,
    created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_created boolean := false;
    v_message_id uuid;
    v_status public.conversation_status;
begin
    if char_length(p_idempotency_key) not between 8 and 200
        or p_language not in ('zh-CN', 'en')
    then
        raise exception 'invalid_handoff_input';
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

    if v_status = 'closed' then
        raise exception 'conversation_closed';
    end if;

    select message.id
    into v_message_id
    from public.messages as message
    where message.organization_id = p_organization_id
      and message.conversation_id = p_conversation_id
      and message.sender_type = 'system'
      and message.metadata ->> 'handoffIdempotencyKey' = p_idempotency_key
    limit 1;

    if v_message_id is null then
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
            p_system_message,
            'handoff',
            p_language,
            jsonb_build_object(
                'handoffIdempotencyKey', p_idempotency_key,
                'handoffReason', 'customer_requested'
            )
        )
        returning id into v_message_id;

        v_created := true;
    end if;

    update public.conversations
    set
        status = case
            when status = 'active_human' then status
            else 'handoff_requested'
        end,
        handoff_reason = p_reason,
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
        p_reason,
        jsonb_build_object(
            'customerQuestion', 'Customer explicitly requested human support.',
            'confirmedFacts', jsonb_build_array(),
            'triggerReason', 'customer_requested',
            'nextStep', 'A human support specialist should review and respond.'
        )
    )
    on conflict (conversation_id)
    do update
    set
        reason = excluded.reason,
        summary_snapshot = excluded.summary_snapshot;

    if v_created then
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
            'public.handoff.requested',
            'conversation',
            p_conversation_id,
            p_request_id,
            jsonb_build_object('reason', 'customer_requested')
        );
    end if;

    return query
    select v_message_id, v_created;
end;
$$;

revoke all on function public.consume_public_rate_limit(
    uuid,
    text,
    text,
    integer,
    integer
) from public;
revoke all on function public.create_public_conversation(
    text,
    public.conversation_channel,
    text,
    text,
    text,
    text,
    text,
    text,
    text
) from public;
revoke all on function public.record_public_customer_message(
    uuid,
    uuid,
    uuid,
    text,
    text
) from public;
revoke all on function public.complete_public_turn(
    uuid,
    uuid,
    uuid,
    public.message_decision,
    text,
    text,
    jsonb,
    uuid[],
    text,
    text,
    boolean,
    text,
    text,
    text,
    integer,
    integer,
    integer,
    text,
    text,
    text,
    jsonb
) from public;
revoke all on function public.request_public_handoff(
    uuid,
    uuid,
    text,
    text,
    text,
    text,
    text
) from public;

grant execute on function public.consume_public_rate_limit(
    uuid,
    text,
    text,
    integer,
    integer
) to service_role;
grant execute on function public.create_public_conversation(
    text,
    public.conversation_channel,
    text,
    text,
    text,
    text,
    text,
    text,
    text
) to service_role;
grant execute on function public.record_public_customer_message(
    uuid,
    uuid,
    uuid,
    text,
    text
) to service_role;
grant execute on function public.complete_public_turn(
    uuid,
    uuid,
    uuid,
    public.message_decision,
    text,
    text,
    jsonb,
    uuid[],
    text,
    text,
    boolean,
    text,
    text,
    text,
    integer,
    integer,
    integer,
    text,
    text,
    text,
    jsonb
) to service_role;
grant execute on function public.request_public_handoff(
    uuid,
    uuid,
    text,
    text,
    text,
    text,
    text
) to service_role;
