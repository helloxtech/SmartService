create index conversations_org_closed_idx
on public.conversations (organization_id, closed_at desc)
where closed_at is not null;

revoke select, update on public.knowledge_gaps from authenticated;

create or replace function public.get_dashboard_summary(
    p_organization_id uuid,
    p_from timestamptz,
    p_to timestamptz
)
returns table (
    total_conversations bigint,
    ai_contained_conversations bigint,
    handed_off_conversations bigint,
    ai_containment_rate numeric,
    handoff_rate numeric,
    open_knowledge_gap_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if p_from is null
       or p_to is null
       or p_to <= p_from
       or p_to - p_from > interval '366 days' then
        raise exception using
            errcode = '22023',
            message = 'Dashboard dates must define a positive range no longer than 366 days.';
    end if;

    return query
    with closed_conversations as (
        select
            conversation.id,
            exists (
                select 1
                from public.handoffs as handoff
                where handoff.organization_id = p_organization_id
                  and handoff.conversation_id = conversation.id
            ) as was_handed_off,
            (
                select conversation_summary.outcome
                from public.conversation_summaries as conversation_summary
                where conversation_summary.organization_id = p_organization_id
                  and conversation_summary.conversation_id = conversation.id
                  and conversation_summary.is_incremental = false
                order by conversation_summary.version desc
                limit 1
            ) as final_outcome
        from public.conversations as conversation
        where conversation.organization_id = p_organization_id
          and conversation.closed_at >= p_from
          and conversation.closed_at < p_to
    ),
    conversation_counts as (
        select
            pg_catalog.count(*)::bigint as total_count,
            pg_catalog.count(*) filter (
                where not closed_conversation.was_handed_off
                  and closed_conversation.final_outcome = 'resolved_ai'
            )::bigint as contained_count,
            pg_catalog.count(*) filter (
                where closed_conversation.was_handed_off
            )::bigint as handoff_count
        from closed_conversations as closed_conversation
    ),
    gap_counts as (
        select pg_catalog.count(*)::bigint as open_count
        from public.knowledge_gaps as knowledge_gap
        where knowledge_gap.organization_id = p_organization_id
          and knowledge_gap.status = 'open'
          and knowledge_gap.last_seen_at >= p_from
          and knowledge_gap.last_seen_at < p_to
    )
    select
        conversation_count.total_count,
        conversation_count.contained_count,
        conversation_count.handoff_count,
        case
            when conversation_count.total_count = 0 then 0::numeric
            else pg_catalog.round(
                conversation_count.contained_count::numeric
                    / conversation_count.total_count::numeric,
                4
            )
        end,
        case
            when conversation_count.total_count = 0 then 0::numeric
            else pg_catalog.round(
                conversation_count.handoff_count::numeric
                    / conversation_count.total_count::numeric,
                4
            )
        end,
        gap_count.open_count
    from conversation_counts as conversation_count
    cross join gap_counts as gap_count;
end;
$$;

create or replace function public.create_manual_gap_resolution(
    p_organization_id uuid,
    p_gap_id uuid,
    p_created_by uuid,
    p_title text,
    p_extracted_object_key text,
    p_standard_page_count numeric,
    p_idempotency_key text,
    p_request_id text
)
returns table (
    gap_id uuid,
    source_id uuid,
    job_id uuid,
    status public.ingestion_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_existing_job public.ingestion_jobs%rowtype;
    v_existing_source public.knowledge_sources%rowtype;
    v_gap public.knowledge_gaps%rowtype;
    v_source_id uuid;
    v_job_id uuid;
begin
    if not exists (
        select 1
        from public.organization_members as organization_member
        where organization_member.organization_id = p_organization_id
          and organization_member.user_id = p_created_by
          and organization_member.role = 'admin'
          and organization_member.is_active = true
    ) then
        raise insufficient_privilege using
            message = 'An active organization Admin membership is required.';
    end if;

    if pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 1 and 240
       or pg_catalog.char_length(p_idempotency_key) not between 8 and 200
       or p_standard_page_count <= 0
       or p_standard_page_count > 100
       or p_extracted_object_key not like (
           'org/' || p_organization_id::text || '/manual-gaps/'
               || p_gap_id::text || '/%'
       ) then
        raise exception using
            errcode = '22023',
            message = 'The manual knowledge intake is invalid.';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            p_organization_id::text || ':' || p_idempotency_key,
            0
        )
    );

    select ingestion_job.*
    into v_existing_job
    from public.ingestion_jobs as ingestion_job
    where ingestion_job.organization_id = p_organization_id
      and ingestion_job.idempotency_key = p_idempotency_key;

    if found then
        select knowledge_source.*
        into v_existing_source
        from public.knowledge_sources as knowledge_source
        where knowledge_source.id = v_existing_job.source_id
          and knowledge_source.organization_id = p_organization_id;

        if not found
           or v_existing_source.type <> 'manual'
           or v_existing_source.extracted_object_key not like (
               'org/' || p_organization_id::text || '/manual-gaps/'
                   || p_gap_id::text || '/%'
           ) then
            raise exception using
                errcode = '22023',
                message = 'The idempotency key belongs to a different knowledge-gap resolution.';
        end if;

        return query
        select
            p_gap_id,
            v_existing_job.source_id,
            v_existing_job.id,
            v_existing_job.status;
        return;
    end if;

    select knowledge_gap.*
    into v_gap
    from public.knowledge_gaps as knowledge_gap
    where knowledge_gap.id = p_gap_id
      and knowledge_gap.organization_id = p_organization_id
    for update;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'The knowledge gap does not exist.';
    end if;

    if v_gap.status = 'resolved' then
        raise exception using
            errcode = '55000',
            message = 'The knowledge gap is already resolved.';
    end if;

    insert into public.knowledge_sources (
        organization_id,
        type,
        name,
        extracted_object_key,
        standard_page_count,
        created_by
    )
    values (
        p_organization_id,
        'manual',
        pg_catalog.btrim(p_title),
        p_extracted_object_key,
        p_standard_page_count,
        p_created_by
    )
    returning id into v_source_id;

    insert into public.ingestion_jobs (
        organization_id,
        source_id,
        idempotency_key,
        target_version
    )
    values (
        p_organization_id,
        v_source_id,
        p_idempotency_key,
        1
    )
    returning id into v_job_id;

    update public.knowledge_gaps
    set
        resolved_source_id = v_source_id,
        status = 'open'
    where id = p_gap_id
      and organization_id = p_organization_id;

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
        p_created_by,
        'knowledge_gap.resolution.queued',
        'knowledge_gap',
        p_gap_id,
        p_request_id,
        pg_catalog.jsonb_build_object(
            'jobId', v_job_id,
            'sourceId', v_source_id
        )
    );

    return query
    select
        p_gap_id,
        v_source_id,
        v_job_id,
        'uploaded'::public.ingestion_status;
end;
$$;

create or replace function public.manage_knowledge_gap(
    p_organization_id uuid,
    p_gap_id uuid,
    p_actor_user_id uuid,
    p_action text,
    p_request_id text
)
returns public.gap_status
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_gap public.knowledge_gaps%rowtype;
    v_status public.gap_status;
begin
    if not exists (
        select 1
        from public.organization_members as organization_member
        where organization_member.organization_id = p_organization_id
          and organization_member.user_id = p_actor_user_id
          and organization_member.role = 'admin'
          and organization_member.is_active = true
    ) then
        raise insufficient_privilege using
            message = 'An active organization Admin membership is required.';
    end if;

    select knowledge_gap.*
    into v_gap
    from public.knowledge_gaps as knowledge_gap
    where knowledge_gap.id = p_gap_id
      and knowledge_gap.organization_id = p_organization_id
    for update;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'The knowledge gap does not exist.';
    end if;

    if p_action = 'ignore' and v_gap.status = 'ignored' then
        return 'ignored'::public.gap_status;
    elsif p_action = 'reopen' and v_gap.status = 'open' then
        return 'open'::public.gap_status;
    elsif p_action = 'ignore' and v_gap.status = 'open' then
        v_status := 'ignored';
    elsif p_action = 'reopen' and v_gap.status = 'ignored' then
        v_status := 'open';
    else
        raise exception using
            errcode = '55000',
            message = 'The knowledge-gap action is not valid in its current state.';
    end if;

    update public.knowledge_gaps
    set status = v_status
    where id = p_gap_id
      and organization_id = p_organization_id;

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
        'knowledge_gap.' || p_action,
        'knowledge_gap',
        p_gap_id,
        p_request_id,
        pg_catalog.jsonb_build_object('status', v_status)
    );

    return v_status;
end;
$$;

create or replace function public.match_knowledge_chunks_for_source(
    p_organization_id uuid,
    p_source_id uuid,
    p_query_embedding extensions.vector(1024),
    p_match_threshold real,
    p_match_count integer,
    p_query_text text default ''
)
returns table (
    chunk_id uuid,
    content text,
    source_locator jsonb,
    semantic_similarity real,
    lexical_score real,
    combined_score real
)
language sql
stable
security definer
set search_path = ''
as $$
    with ranked as (
        select
            knowledge_chunk.id as chunk_id,
            knowledge_chunk.content,
            knowledge_chunk.source_locator,
            (
                1 - (
                    knowledge_chunk.embedding
                    operator(extensions.<=>)
                    p_query_embedding
                )
            )::real as semantic_similarity,
            greatest(
                extensions.similarity(
                    knowledge_chunk.content,
                    coalesce(p_query_text, '')
                ),
                extensions.word_similarity(
                    coalesce(p_query_text, ''),
                    knowledge_chunk.content
                ),
                0
            )::real as lexical_score
        from public.knowledge_chunks as knowledge_chunk
        join public.knowledge_documents as knowledge_document
          on knowledge_document.id = knowledge_chunk.document_id
         and knowledge_document.organization_id = knowledge_chunk.organization_id
        join public.knowledge_sources as knowledge_source
          on knowledge_source.id = knowledge_chunk.source_id
         and knowledge_source.organization_id = knowledge_chunk.organization_id
        where knowledge_chunk.organization_id = p_organization_id
          and knowledge_chunk.source_id = p_source_id
          and knowledge_chunk.enabled = true
          and knowledge_document.enabled = true
          and knowledge_document.deleted_at is null
          and knowledge_document.version = knowledge_source.active_version
          and knowledge_source.enabled = true
          and knowledge_source.deleted_at is null
          and knowledge_source.status = 'ready'
          and knowledge_chunk.document_version = knowledge_source.active_version
          and knowledge_chunk.embedding is not null
    ),
    scored as (
        select
            ranked.chunk_id,
            ranked.content,
            ranked.source_locator,
            ranked.semantic_similarity,
            ranked.lexical_score,
            least(
                1.0,
                0.80 * ranked.semantic_similarity
                    + 0.20 * ranked.lexical_score
            )::real as combined_score
        from ranked
    )
    select
        scored.chunk_id,
        scored.content,
        scored.source_locator,
        scored.semantic_similarity,
        scored.lexical_score,
        scored.combined_score
    from scored
    where scored.combined_score >= p_match_threshold
    order by scored.combined_score desc
    limit least(greatest(p_match_count, 1), 20);
$$;

create or replace function public.record_knowledge_gap_retest(
    p_organization_id uuid,
    p_gap_id uuid,
    p_actor_user_id uuid,
    p_provider text,
    p_model text,
    p_prompt_version text,
    p_input_tokens integer,
    p_output_tokens integer,
    p_latency_ms integer,
    p_decision text,
    p_retrieved_chunk_ids uuid[],
    p_citation_chunk_ids uuid[],
    p_request_id text,
    p_supervisor_provider text,
    p_supervisor_model text,
    p_supervisor_prompt_version text,
    p_supervisor_input_tokens integer,
    p_supervisor_output_tokens integer,
    p_supervisor_latency_ms integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_ai_run_id uuid;
    v_gap public.knowledge_gaps%rowtype;
    v_invalid_chunk_count integer;
begin
    if not exists (
        select 1
        from public.organization_members as organization_member
        where organization_member.organization_id = p_organization_id
          and organization_member.user_id = p_actor_user_id
          and organization_member.role = 'admin'
          and organization_member.is_active = true
    ) then
        raise insufficient_privilege using
            message = 'An active organization Admin membership is required.';
    end if;

    select knowledge_gap.*
    into v_gap
    from public.knowledge_gaps as knowledge_gap
    where knowledge_gap.id = p_gap_id
      and knowledge_gap.organization_id = p_organization_id;

    if not found
       or v_gap.status <> 'resolved'
       or v_gap.resolved_source_id is null then
        raise exception using
            errcode = '55000',
            message = 'The knowledge gap is not ready for re-test.';
    end if;

    if p_decision not in ('answer', 'clarify', 'handoff')
       or p_latency_ms < 0
       or p_retrieved_chunk_ids is null
       or p_citation_chunk_ids is null
       or (
           p_decision in ('answer', 'clarify')
           and (
               pg_catalog.cardinality(p_retrieved_chunk_ids) not between 1 and 20
               or pg_catalog.cardinality(p_citation_chunk_ids) not between 1 and 5
           )
       )
       or (
           p_decision = 'handoff'
           and (
               pg_catalog.cardinality(p_retrieved_chunk_ids) not between 0 and 20
               or pg_catalog.cardinality(p_citation_chunk_ids) not between 0 and 5
           )
       )
       or not (p_citation_chunk_ids <@ p_retrieved_chunk_ids) then
        raise exception using
            errcode = '22023',
            message = 'The knowledge-gap re-test audit is invalid.';
    end if;

    if (
        p_supervisor_provider is null
        or p_supervisor_model is null
        or p_supervisor_prompt_version is null
        or p_supervisor_latency_ms is null
    ) and not (
        p_supervisor_provider is null
        and p_supervisor_model is null
        and p_supervisor_prompt_version is null
        and p_supervisor_input_tokens is null
        and p_supervisor_output_tokens is null
        and p_supervisor_latency_ms is null
    ) then
        raise exception using
            errcode = '22023',
            message = 'The knowledge-gap supervisor audit is incomplete.';
    end if;

    if p_supervisor_latency_ms is not null
       and (
           p_supervisor_latency_ms < 0
           or pg_catalog.char_length(p_supervisor_provider) not between 1 and 80
           or pg_catalog.char_length(p_supervisor_model) not between 1 and 160
           or pg_catalog.char_length(p_supervisor_prompt_version) not between 1 and 120
       ) then
        raise exception using
            errcode = '22023',
            message = 'The knowledge-gap supervisor audit is invalid.';
    end if;

    select pg_catalog.count(*)::integer
    into v_invalid_chunk_count
    from pg_catalog.unnest(p_retrieved_chunk_ids) as retrieved_chunk_id
    where not exists (
        select 1
        from public.knowledge_chunks as knowledge_chunk
        join public.knowledge_sources as knowledge_source
          on knowledge_source.id = knowledge_chunk.source_id
         and knowledge_source.organization_id = knowledge_chunk.organization_id
        where knowledge_chunk.id = retrieved_chunk_id
          and knowledge_chunk.organization_id = p_organization_id
          and knowledge_chunk.source_id = v_gap.resolved_source_id
          and knowledge_chunk.enabled = true
          and knowledge_chunk.document_version = knowledge_source.active_version
          and knowledge_source.status = 'ready'
          and knowledge_source.enabled = true
          and knowledge_source.deleted_at is null
    );

    if v_invalid_chunk_count > 0 then
        raise exception using
            errcode = '22023',
            message = 'The re-test evidence does not belong to the resolved knowledge source.';
    end if;

    insert into public.ai_runs (
        organization_id,
        task_type,
        provider,
        model,
        prompt_version,
        input_tokens,
        output_tokens,
        latency_ms,
        estimated_cost_usd,
        status,
        metadata
    )
    values (
        p_organization_id,
        'knowledge_gap_retest',
        pg_catalog.left(p_provider, 80),
        pg_catalog.left(p_model, 160),
        pg_catalog.left(p_prompt_version, 120),
        p_input_tokens,
        p_output_tokens,
        p_latency_ms,
        0,
        'succeeded',
        pg_catalog.jsonb_build_object(
            'gapId', p_gap_id,
            'sourceId', v_gap.resolved_source_id,
            'decision', p_decision,
            'retrievedChunkCount', pg_catalog.cardinality(p_retrieved_chunk_ids),
            'citationCount', pg_catalog.cardinality(p_citation_chunk_ids)
        )
    )
    returning id into v_ai_run_id;

    if p_supervisor_latency_ms is not null then
        insert into public.ai_runs (
            organization_id,
            task_type,
            provider,
            model,
            prompt_version,
            input_tokens,
            output_tokens,
            latency_ms,
            estimated_cost_usd,
            status,
            metadata
        )
        values (
            p_organization_id,
            'knowledge_gap_retest_guardrail',
            p_supervisor_provider,
            p_supervisor_model,
            p_supervisor_prompt_version,
            p_supervisor_input_tokens,
            p_supervisor_output_tokens,
            p_supervisor_latency_ms,
            0,
            'succeeded',
            pg_catalog.jsonb_build_object(
                'gapId', p_gap_id,
                'sourceId', v_gap.resolved_source_id,
                'decision', p_decision,
                'retestAiRunId', v_ai_run_id
            )
        );
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
        'knowledge_gap.retested',
        'knowledge_gap',
        p_gap_id,
        p_request_id,
        pg_catalog.jsonb_build_object(
            'aiRunId', v_ai_run_id,
            'decision', p_decision
        )
    );

    return v_ai_run_id;
end;
$$;

create or replace function public.resolve_knowledge_gap_after_ingestion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_gap record;
    v_created_by uuid;
begin
    if new.status <> 'ready' or old.status = 'ready' then
        return new;
    end if;

    select knowledge_source.created_by
    into v_created_by
    from public.knowledge_sources as knowledge_source
    where knowledge_source.id = new.source_id
      and knowledge_source.organization_id = new.organization_id
      and knowledge_source.type = 'manual';

    if not found then
        return new;
    end if;

    for v_gap in
        update public.knowledge_gaps
        set status = 'resolved'
        where organization_id = new.organization_id
          and resolved_source_id = new.source_id
          and status <> 'resolved'
        returning id
    loop
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
            new.organization_id,
            v_created_by,
            'knowledge_gap.resolved',
            'knowledge_gap',
            v_gap.id,
            'ingestion:' || new.id::text,
            pg_catalog.jsonb_build_object(
                'jobId', new.id,
                'sourceId', new.source_id
            )
        );
    end loop;

    return new;
end;
$$;

create trigger ingestion_jobs_resolve_knowledge_gap
after update of status on public.ingestion_jobs
for each row
execute function public.resolve_knowledge_gap_after_ingestion();

revoke all on function public.get_dashboard_summary(
    uuid,
    timestamptz,
    timestamptz
) from public, anon, authenticated;
revoke all on function public.create_manual_gap_resolution(
    uuid,
    uuid,
    uuid,
    text,
    text,
    numeric,
    text,
    text
) from public, anon, authenticated;
revoke all on function public.manage_knowledge_gap(
    uuid,
    uuid,
    uuid,
    text,
    text
) from public, anon, authenticated;
revoke all on function public.match_knowledge_chunks_for_source(
    uuid,
    uuid,
    extensions.vector,
    real,
    integer,
    text
) from public, anon, authenticated;
revoke all on function public.record_knowledge_gap_retest(
    uuid,
    uuid,
    uuid,
    text,
    text,
    text,
    integer,
    integer,
    integer,
    text,
    uuid[],
    uuid[],
    text,
    text,
    text,
    text,
    integer,
    integer,
    integer
) from public, anon, authenticated;
revoke all on function public.resolve_knowledge_gap_after_ingestion()
from public, anon, authenticated;

grant execute on function public.get_dashboard_summary(
    uuid,
    timestamptz,
    timestamptz
) to service_role;
grant execute on function public.create_manual_gap_resolution(
    uuid,
    uuid,
    uuid,
    text,
    text,
    numeric,
    text,
    text
) to service_role;
grant execute on function public.manage_knowledge_gap(
    uuid,
    uuid,
    uuid,
    text,
    text
) to service_role;
grant execute on function public.match_knowledge_chunks_for_source(
    uuid,
    uuid,
    extensions.vector,
    real,
    integer,
    text
) to service_role;
grant execute on function public.record_knowledge_gap_retest(
    uuid,
    uuid,
    uuid,
    text,
    text,
    text,
    integer,
    integer,
    integer,
    text,
    uuid[],
    uuid[],
    text,
    text,
    text,
    text,
    integer,
    integer,
    integer
) to service_role;
