create table public.agent_reply_suggestions (
    id uuid primary key default extensions.gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    conversation_id uuid not null,
    trigger_message_id uuid not null,
    status text not null default 'pending'
        check (status in ('pending', 'ready', 'used', 'superseded', 'failed')),
    kind text
        check (kind is null or kind in ('grounded_answer', 'clarifying_question', 'policy_safe_reply')),
    draft_text text check (draft_text is null or char_length(draft_text) between 1 and 1200),
    error_code text check (error_code is null or char_length(error_code) between 1 and 120),
    ai_run_id uuid,
    used_by uuid references auth.users(id) on delete set null,
    used_at timestamptz,
    human_message_id uuid,
    generated_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, conversation_id, trigger_message_id),
    unique (id, organization_id),
    foreign key (conversation_id, organization_id)
        references public.conversations(id, organization_id)
        on delete cascade,
    foreign key (trigger_message_id, organization_id)
        references public.messages(id, organization_id)
        on delete cascade,
    foreign key (ai_run_id, organization_id)
        references public.ai_runs(id, organization_id)
        on delete set null (ai_run_id),
    foreign key (human_message_id, organization_id)
        references public.messages(id, organization_id)
        on delete set null (human_message_id)
);

create table public.agent_reply_suggestion_citations (
    id uuid primary key default extensions.gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    suggestion_id uuid not null,
    chunk_id uuid not null,
    label text not null check (char_length(label) between 1 and 240),
    supporting_excerpt text not null check (char_length(supporting_excerpt) between 1 and 2000),
    created_at timestamptz not null default now(),
    unique (suggestion_id, chunk_id),
    foreign key (suggestion_id, organization_id)
        references public.agent_reply_suggestions(id, organization_id)
        on delete cascade,
    foreign key (chunk_id, organization_id)
        references public.knowledge_chunks(id, organization_id)
        on delete restrict
);

create index agent_reply_suggestions_conversation_idx
on public.agent_reply_suggestions (organization_id, conversation_id, created_at desc);

create index agent_reply_suggestions_status_idx
on public.agent_reply_suggestions (organization_id, status, updated_at desc);

create index agent_reply_suggestion_citations_suggestion_idx
on public.agent_reply_suggestion_citations (organization_id, suggestion_id);

create trigger agent_reply_suggestions_set_updated_at
before update on public.agent_reply_suggestions
for each row execute function public.set_updated_at();

alter table public.agent_reply_suggestions enable row level security;
alter table public.agent_reply_suggestions force row level security;
alter table public.agent_reply_suggestion_citations enable row level security;
alter table public.agent_reply_suggestion_citations force row level security;

revoke all on public.agent_reply_suggestions from anon, authenticated;
revoke all on public.agent_reply_suggestion_citations from anon, authenticated;
grant all on public.agent_reply_suggestions to service_role;
grant all on public.agent_reply_suggestion_citations to service_role;

create or replace function public.queue_agent_reply_suggestion(
    p_organization_id uuid,
    p_conversation_id uuid,
    p_trigger_message_id uuid,
    p_request_id text
)
returns table (
    suggestion_id uuid,
    created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_conversation public.conversations%rowtype;
    v_created boolean := false;
    v_fallback_reply text;
    v_latest_customer_message_id uuid;
    v_question text;
    v_suggestion public.agent_reply_suggestions%rowtype;
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

    if v_conversation.status not in ('handoff_requested', 'active_human') then
        raise exception 'conversation_not_human_routed';
    end if;

    select message.id, message.text
    into v_latest_customer_message_id, v_question
    from public.messages as message
    where message.organization_id = p_organization_id
      and message.conversation_id = p_conversation_id
      and message.sender_type = 'customer'
    order by message.created_at desc, message.id desc
    limit 1;

    if v_latest_customer_message_id is null
        or v_latest_customer_message_id <> p_trigger_message_id
    then
        raise exception 'trigger_message_not_current';
    end if;

    update public.agent_reply_suggestions as suggestion
    set status = 'superseded'
    where suggestion.organization_id = p_organization_id
      and suggestion.conversation_id = p_conversation_id
      and suggestion.trigger_message_id <> p_trigger_message_id
      and suggestion.status in ('pending', 'ready', 'failed');

    select suggestion.*
    into v_suggestion
    from public.agent_reply_suggestions as suggestion
    where suggestion.organization_id = p_organization_id
      and suggestion.conversation_id = p_conversation_id
      and suggestion.trigger_message_id = p_trigger_message_id
    for update;

    if not found then
        insert into public.agent_reply_suggestions (
            organization_id,
            conversation_id,
            trigger_message_id,
            status
        )
        values (
            p_organization_id,
            p_conversation_id,
            p_trigger_message_id,
            'pending'
        )
        returning * into v_suggestion;
        v_created := true;
    elsif v_suggestion.status = 'failed' then
        update public.agent_reply_suggestions as suggestion
        set
            status = 'pending',
            error_code = null
        where suggestion.id = v_suggestion.id
        returning * into v_suggestion;
        v_created := true;
    end if;

    if v_suggestion.status = 'pending' then
        v_fallback_reply := case
            when v_conversation.language = 'zh-CN'
                then '您好，我来继续处理您关于“' || left(v_question, 180) || '”的问题。我先确认一下相关信息。'
            else 'Hello, I will continue helping with your question about “' || left(v_question, 180) || '.” Let me confirm the relevant details first.'
        end;

        update public.handoffs as handoff
        set summary_snapshot = coalesce(handoff.summary_snapshot, '{}'::jsonb)
            || jsonb_build_object(
                'customerQuestion', left(v_question, 4000),
                'confirmedFacts', coalesce(handoff.summary_snapshot -> 'confirmedFacts', '[]'::jsonb),
                'triggerReason', left(coalesce(handoff.summary_snapshot ->> 'triggerReason', handoff.reason), 1000),
                'nextStep', case
                    when v_conversation.language = 'zh-CN'
                        then '查看当前问题的已批准资料，并以人工客服身份准确回复。'
                    else 'Review approved knowledge for the current question and reply as the human customer-service owner.'
                end,
                'currentIntent', left(v_question, 240),
                'conversationSummary', case
                    when v_conversation.language = 'zh-CN'
                        then '客户当前正在咨询：“' || left(v_question, 3600) || '”'
                    else 'The customer is currently asking: “' || left(v_question, 3600) || '”'
                end,
                'suggestedReply', left(v_fallback_reply, 1200)
            )
        where handoff.organization_id = p_organization_id
          and handoff.conversation_id = p_conversation_id;
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
            p_organization_id,
            'agent_reply_suggestion.queued',
            'agent_reply_suggestion',
            v_suggestion.id,
            p_request_id,
            jsonb_build_object('triggerMessageId', p_trigger_message_id)
        );
    end if;

    return query
    select v_suggestion.id, v_created;
end;
$$;

create or replace function public.complete_agent_reply_suggestion(
    p_organization_id uuid,
    p_conversation_id uuid,
    p_suggestion_id uuid,
    p_trigger_message_id uuid,
    p_kind text,
    p_draft_text text,
    p_citations jsonb,
    p_provider text,
    p_model text,
    p_prompt_version text,
    p_input_tokens integer,
    p_output_tokens integer,
    p_latency_ms integer,
    p_conversation_summary text,
    p_current_intent text,
    p_next_step text,
    p_metadata jsonb,
    p_request_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_ai_run_id uuid;
    v_citation_count integer;
    v_conversation_status public.conversation_status;
    v_language text;
    v_latest_customer_message_id uuid;
    v_suggestion public.agent_reply_suggestions%rowtype;
    v_valid_citation_count integer;
begin
    if p_kind not in ('grounded_answer', 'clarifying_question', 'policy_safe_reply') then
        raise exception 'invalid_suggestion_kind';
    end if;

    if char_length(p_draft_text) not between 1 and 1200
        or char_length(p_conversation_summary) not between 1 and 4000
        or char_length(p_current_intent) not between 1 and 240
        or char_length(p_next_step) not between 1 and 1000
        or p_latency_ms < 0
    then
        raise exception 'invalid_suggestion_payload';
    end if;

    if p_citations is null
        or jsonb_typeof(p_citations) <> 'array'
        or jsonb_array_length(p_citations) > 5
        or p_metadata is null
        or jsonb_typeof(p_metadata) <> 'object'
    then
        raise exception 'invalid_suggestion_citations';
    end if;

    v_citation_count := jsonb_array_length(p_citations);

    if p_kind = 'grounded_answer' and v_citation_count = 0 then
        raise exception 'grounded_suggestion_requires_citation';
    end if;

    if exists (
        select 1
        from jsonb_array_elements(p_citations) as citation
        where jsonb_typeof(citation) <> 'object'
           or nullif(citation ->> 'chunkId', '') is null
           or char_length(coalesce(citation ->> 'label', '')) not between 1 and 240
           or char_length(coalesce(citation ->> 'supportingExcerpt', '')) not between 1 and 2000
    ) then
        raise exception 'invalid_suggestion_citation';
    end if;

    if (
        select count(*)
        from (
            select distinct (citation ->> 'chunkId')::uuid as chunk_id
            from jsonb_array_elements(p_citations) as citation
        ) as unique_citations
    ) <> v_citation_count then
        raise exception 'duplicate_suggestion_citation';
    end if;

    select suggestion.*
    into v_suggestion
    from public.agent_reply_suggestions as suggestion
    where suggestion.id = p_suggestion_id
      and suggestion.organization_id = p_organization_id
      and suggestion.conversation_id = p_conversation_id
      and suggestion.trigger_message_id = p_trigger_message_id
    for update;

    if not found then
        raise exception 'suggestion_not_found';
    end if;

    if v_suggestion.status not in ('pending', 'failed') then
        return false;
    end if;

    select conversation.status, conversation.language
    into v_conversation_status, v_language
    from public.conversations as conversation
    where conversation.id = p_conversation_id
      and conversation.organization_id = p_organization_id
    for update;

    select message.id
    into v_latest_customer_message_id
    from public.messages as message
    where message.organization_id = p_organization_id
      and message.conversation_id = p_conversation_id
      and message.sender_type = 'customer'
    order by message.created_at desc, message.id desc
    limit 1;

    if v_conversation_status not in ('handoff_requested', 'active_human')
        or v_latest_customer_message_id is distinct from p_trigger_message_id
    then
        update public.agent_reply_suggestions
        set status = 'superseded'
        where id = p_suggestion_id;
        return false;
    end if;

    select count(*)
    into v_valid_citation_count
    from jsonb_array_elements(p_citations) as citation
    join public.knowledge_chunks as chunk
      on chunk.id = (citation ->> 'chunkId')::uuid
     and chunk.organization_id = p_organization_id
     and chunk.enabled = true
    join public.knowledge_documents as document
     on document.id = chunk.document_id
     and document.organization_id = p_organization_id
     and document.enabled = true
     and document.deleted_at is null
    join public.knowledge_sources as source
      on source.id = chunk.source_id
     and source.organization_id = p_organization_id
     and source.enabled = true
     and source.deleted_at is null
     and source.status = 'ready'
     and source.active_version = chunk.document_version
     and source.active_version = document.version;

    if v_valid_citation_count <> v_citation_count then
        raise exception 'suggestion_citation_not_approved';
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
        'agent_reply_suggestion',
        left(p_provider, 80),
        left(p_model, 160),
        left(p_prompt_version, 120),
        p_input_tokens,
        p_output_tokens,
        p_latency_ms,
        'succeeded',
        coalesce(p_metadata, '{}'::jsonb)
            || jsonb_build_object(
                'suggestionId', p_suggestion_id,
                'triggerMessageId', p_trigger_message_id,
                'citationCount', v_citation_count
            )
    )
    returning id into v_ai_run_id;

    update public.agent_reply_suggestions
    set
        status = 'ready',
        kind = p_kind,
        draft_text = p_draft_text,
        error_code = null,
        ai_run_id = v_ai_run_id,
        generated_at = now()
    where id = p_suggestion_id;

    delete from public.agent_reply_suggestion_citations
    where suggestion_id = p_suggestion_id
      and organization_id = p_organization_id;

    insert into public.agent_reply_suggestion_citations (
        organization_id,
        suggestion_id,
        chunk_id,
        label,
        supporting_excerpt
    )
    select
        p_organization_id,
        p_suggestion_id,
        (citation.value ->> 'chunkId')::uuid,
        citation.value ->> 'label',
        citation.value ->> 'supportingExcerpt'
    from jsonb_array_elements(p_citations) with ordinality as citation(value, position)
    order by citation.position;

    update public.handoffs as handoff
    set summary_snapshot = coalesce(handoff.summary_snapshot, '{}'::jsonb)
        || jsonb_build_object(
            'conversationSummary', p_conversation_summary,
            'currentIntent', p_current_intent,
            'nextStep', p_next_step,
            'suggestedReply', p_draft_text
        )
    where handoff.organization_id = p_organization_id
      and handoff.conversation_id = p_conversation_id;

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
        'agent_reply_suggestion.ready',
        'agent_reply_suggestion',
        p_suggestion_id,
        p_request_id,
        jsonb_build_object(
            'triggerMessageId', p_trigger_message_id,
            'kind', p_kind,
            'citationCount', v_citation_count,
            'language', v_language
        )
    );

    return true;
end;
$$;

create or replace function public.fail_agent_reply_suggestion(
    p_organization_id uuid,
    p_conversation_id uuid,
    p_suggestion_id uuid,
    p_error_code text,
    p_provider text,
    p_model text,
    p_prompt_version text,
    p_latency_ms integer,
    p_request_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_ai_run_id uuid;
begin
    if char_length(p_error_code) not between 1 and 120 or p_latency_ms < 0 then
        raise exception 'invalid_suggestion_failure';
    end if;

    if not exists (
        select 1
        from public.agent_reply_suggestions as suggestion
        where suggestion.id = p_suggestion_id
          and suggestion.organization_id = p_organization_id
          and suggestion.conversation_id = p_conversation_id
          and suggestion.status in ('pending', 'failed')
    ) then
        return;
    end if;

    insert into public.ai_runs (
        organization_id,
        conversation_id,
        task_type,
        provider,
        model,
        prompt_version,
        latency_ms,
        status,
        error_code,
        metadata
    )
    values (
        p_organization_id,
        p_conversation_id,
        'agent_reply_suggestion',
        left(p_provider, 80),
        left(p_model, 160),
        left(p_prompt_version, 120),
        p_latency_ms,
        'failed',
        p_error_code,
        jsonb_build_object('suggestionId', p_suggestion_id)
    )
    returning id into v_ai_run_id;

    update public.agent_reply_suggestions
    set
        status = 'failed',
        error_code = p_error_code,
        ai_run_id = v_ai_run_id
    where id = p_suggestion_id
      and organization_id = p_organization_id
      and conversation_id = p_conversation_id
      and status in ('pending', 'failed');

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
        'agent_reply_suggestion.failed',
        'agent_reply_suggestion',
        p_suggestion_id,
        p_request_id,
        jsonb_build_object('errorCode', p_error_code)
    );
end;
$$;

create or replace function public.settle_agent_reply_suggestions(
    p_organization_id uuid,
    p_conversation_id uuid,
    p_actor_user_id uuid,
    p_human_message_id uuid,
    p_used_suggestion_id uuid,
    p_request_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_used boolean := false;
begin
    if not exists (
        select 1
        from public.organization_members as member
        join public.handoffs as handoff
          on handoff.organization_id = member.organization_id
         and handoff.accepted_by = member.user_id
        join public.conversations as conversation
          on conversation.id = handoff.conversation_id
         and conversation.organization_id = handoff.organization_id
        where member.organization_id = p_organization_id
          and member.user_id = p_actor_user_id
          and member.role in ('admin', 'agent')
          and member.is_active = true
          and handoff.conversation_id = p_conversation_id
          and conversation.status = 'active_human'
    ) then
        raise exception 'conversation_not_owned';
    end if;

    if not exists (
        select 1
        from public.messages as message
        where message.id = p_human_message_id
          and message.organization_id = p_organization_id
          and message.conversation_id = p_conversation_id
          and message.sender_type = 'human'
          and message.sender_user_id = p_actor_user_id
    ) then
        raise exception 'human_message_not_found';
    end if;

    if p_used_suggestion_id is not null then
        update public.agent_reply_suggestions as suggestion
        set
            status = 'used',
            used_by = p_actor_user_id,
            used_at = now(),
            human_message_id = p_human_message_id
        where suggestion.id = p_used_suggestion_id
          and suggestion.organization_id = p_organization_id
          and suggestion.conversation_id = p_conversation_id
          and suggestion.status = 'ready'
          and suggestion.trigger_message_id = (
              select message.id
              from public.messages as message
              where message.organization_id = p_organization_id
                and message.conversation_id = p_conversation_id
                and message.sender_type = 'customer'
              order by message.created_at desc, message.id desc
              limit 1
          );

        v_used := found;

        if not v_used then
            if exists (
                select 1
                from public.agent_reply_suggestions as suggestion
                where suggestion.id = p_used_suggestion_id
                  and suggestion.organization_id = p_organization_id
                  and suggestion.conversation_id = p_conversation_id
                  and suggestion.status = 'used'
                  and suggestion.used_by = p_actor_user_id
                  and suggestion.human_message_id = p_human_message_id
            ) then
                return true;
            end if;

            raise exception 'suggestion_not_current';
        end if;
    end if;

    update public.agent_reply_suggestions as suggestion
    set status = 'superseded'
    where suggestion.organization_id = p_organization_id
      and suggestion.conversation_id = p_conversation_id
      and suggestion.status in ('pending', 'ready', 'failed')
      and (p_used_suggestion_id is null or suggestion.id <> p_used_suggestion_id);

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
        case when v_used
            then 'agent_reply_suggestion.used'
            else 'agent_reply_suggestion.bypassed'
        end,
        'conversation',
        p_conversation_id,
        p_request_id,
        jsonb_build_object(
            'humanMessageId', p_human_message_id,
            'suggestionId', p_used_suggestion_id
        )
    );

    return v_used;
end;
$$;

create or replace function public.get_latest_agent_reply_suggestion(
    p_organization_id uuid,
    p_conversation_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'id', suggestion.id,
        'triggerMessageId', suggestion.trigger_message_id,
        'status', suggestion.status,
        'kind', suggestion.kind,
        'draftText', suggestion.draft_text,
        'errorCode', suggestion.error_code,
        'generatedAt', suggestion.generated_at,
        'usedAt', suggestion.used_at,
        'createdAt', suggestion.created_at,
        'updatedAt', suggestion.updated_at,
        'citations', (
            select coalesce(
                jsonb_agg(
                    jsonb_build_object(
                        'citationId', citation.id,
                        'label', citation.label,
                        'sourceType', source.type,
                        'sourceUrl', case
                            when source.type = 'url'
                                then coalesce(
                                    nullif(chunk.source_locator ->> 'url', ''),
                                    source.source_url
                                )
                            else source.source_url
                        end,
                        'supportingExcerpt', citation.supporting_excerpt
                    )
                    order by citation.created_at, citation.id
                ),
                '[]'::jsonb
            )
            from public.agent_reply_suggestion_citations as citation
            join public.knowledge_chunks as chunk
              on chunk.id = citation.chunk_id
             and chunk.organization_id = citation.organization_id
            join public.knowledge_sources as source
              on source.id = chunk.source_id
             and source.organization_id = chunk.organization_id
            where citation.organization_id = suggestion.organization_id
              and citation.suggestion_id = suggestion.id
        )
    )
    from public.agent_reply_suggestions as suggestion
    where suggestion.organization_id = p_organization_id
      and suggestion.conversation_id = p_conversation_id
      and suggestion.status in ('pending', 'ready', 'used', 'failed')
    order by suggestion.created_at desc, suggestion.id desc
    limit 1;
$$;

create or replace function public.supersede_agent_reply_suggestions_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if old.status is distinct from new.status and new.status = 'closed' then
        update public.agent_reply_suggestions as suggestion
        set status = 'superseded'
        where suggestion.organization_id = new.organization_id
          and suggestion.conversation_id = new.id
          and suggestion.status in ('pending', 'ready', 'failed');
    end if;

    return new;
end;
$$;

create trigger conversations_supersede_agent_reply_suggestions
after update of status on public.conversations
for each row execute function public.supersede_agent_reply_suggestions_on_close();

create or replace function public.supersede_agent_reply_suggestions_on_source_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if (
        old.enabled is distinct from new.enabled
        or old.status is distinct from new.status
        or old.active_version is distinct from new.active_version
        or old.deleted_at is distinct from new.deleted_at
    ) and (
        new.enabled = false
        or new.status <> 'ready'
        or new.active_version is distinct from old.active_version
        or new.deleted_at is not null
    ) then
        update public.agent_reply_suggestions as suggestion
        set status = 'superseded'
        where suggestion.organization_id = new.organization_id
          and suggestion.status = 'ready'
          and exists (
              select 1
              from public.agent_reply_suggestion_citations as citation
              join public.knowledge_chunks as chunk
                on chunk.id = citation.chunk_id
               and chunk.organization_id = citation.organization_id
              where citation.organization_id = suggestion.organization_id
                and citation.suggestion_id = suggestion.id
                and chunk.source_id = new.id
          );
    end if;

    return new;
end;
$$;

create trigger knowledge_sources_supersede_agent_reply_suggestions
after update of enabled, status, active_version, deleted_at on public.knowledge_sources
for each row execute function public.supersede_agent_reply_suggestions_on_source_change();

revoke all on function public.queue_agent_reply_suggestion(uuid, uuid, uuid, text) from public;
revoke all on function public.queue_agent_reply_suggestion(uuid, uuid, uuid, text) from anon, authenticated;
revoke all on function public.complete_agent_reply_suggestion(uuid, uuid, uuid, uuid, text, text, jsonb, text, text, text, integer, integer, integer, text, text, text, jsonb, text) from public;
revoke all on function public.complete_agent_reply_suggestion(uuid, uuid, uuid, uuid, text, text, jsonb, text, text, text, integer, integer, integer, text, text, text, jsonb, text) from anon, authenticated;
revoke all on function public.fail_agent_reply_suggestion(uuid, uuid, uuid, text, text, text, text, integer, text) from public;
revoke all on function public.fail_agent_reply_suggestion(uuid, uuid, uuid, text, text, text, text, integer, text) from anon, authenticated;
revoke all on function public.settle_agent_reply_suggestions(uuid, uuid, uuid, uuid, uuid, text) from public;
revoke all on function public.settle_agent_reply_suggestions(uuid, uuid, uuid, uuid, uuid, text) from anon, authenticated;
revoke all on function public.get_latest_agent_reply_suggestion(uuid, uuid) from public;
revoke all on function public.get_latest_agent_reply_suggestion(uuid, uuid) from anon, authenticated;
revoke all on function public.supersede_agent_reply_suggestions_on_close() from public;
revoke all on function public.supersede_agent_reply_suggestions_on_close() from anon, authenticated;
revoke all on function public.supersede_agent_reply_suggestions_on_source_change() from public;
revoke all on function public.supersede_agent_reply_suggestions_on_source_change() from anon, authenticated;

grant execute on function public.queue_agent_reply_suggestion(uuid, uuid, uuid, text) to service_role;
grant execute on function public.complete_agent_reply_suggestion(uuid, uuid, uuid, uuid, text, text, jsonb, text, text, text, integer, integer, integer, text, text, text, jsonb, text) to service_role;
grant execute on function public.fail_agent_reply_suggestion(uuid, uuid, uuid, text, text, text, text, integer, text) to service_role;
grant execute on function public.settle_agent_reply_suggestions(uuid, uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.get_latest_agent_reply_suggestion(uuid, uuid) to service_role;
