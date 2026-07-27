alter table public.ingestion_jobs
add column target_version integer not null default 1
    check (target_version >= 1);

alter table public.knowledge_sources
add column crawl_max_pages integer
    check (crawl_max_pages is null or crawl_max_pages between 1 and 30),
add column crawl_max_depth integer
    check (crawl_max_depth is null or crawl_max_depth between 0 and 2);

create index ingestion_jobs_org_target_version_idx
on public.ingestion_jobs (
    organization_id,
    source_id,
    target_version,
    created_at desc
);

create or replace function public.create_knowledge_ingestion(
    p_organization_id uuid,
    p_created_by uuid,
    p_source_type public.knowledge_source_type,
    p_name text,
    p_source_url text,
    p_original_object_key text,
    p_extracted_object_key text,
    p_page_count integer,
    p_standard_page_count numeric,
    p_crawl_max_pages integer,
    p_crawl_max_depth integer,
    p_idempotency_key text,
    p_request_id text
)
returns table (
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

    if p_source_type in ('pdf', 'docx') then
        if p_original_object_key is null or p_extracted_object_key is null then
            raise exception using
                errcode = '22023',
                message = 'File ingestion requires original and extracted object keys.';
        end if;

        if p_original_object_key not like (
            'org/' || p_organization_id::text || '/%'
        ) or p_extracted_object_key not like (
            'org/' || p_organization_id::text || '/%'
        ) then
            raise exception using
                errcode = '22023',
                message = 'Object keys must belong to the authenticated organization.';
        end if;
    elsif p_source_type = 'url' then
        if p_source_url is null then
            raise exception using
                errcode = '22023',
                message = 'URL ingestion requires a source URL.';
        end if;
    else
        raise exception using
            errcode = '22023',
            message = 'This intake function supports PDF, DOCX, and URL sources.';
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
        return query
        select
            v_existing_job.source_id,
            v_existing_job.id,
            v_existing_job.status;
        return;
    end if;

    insert into public.knowledge_sources (
        organization_id,
        type,
        name,
        source_url,
        original_object_key,
        extracted_object_key,
        page_count,
        standard_page_count,
        crawl_max_pages,
        crawl_max_depth,
        created_by
    )
    values (
        p_organization_id,
        p_source_type,
        p_name,
        p_source_url,
        p_original_object_key,
        p_extracted_object_key,
        p_page_count,
        p_standard_page_count,
        p_crawl_max_pages,
        p_crawl_max_depth,
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
        'knowledge.ingestion.created',
        'knowledge_source',
        v_source_id,
        p_request_id,
        pg_catalog.jsonb_build_object(
            'jobId', v_job_id,
            'sourceType', p_source_type
        )
    );

    return query
    select
        v_source_id,
        v_job_id,
        'uploaded'::public.ingestion_status;
end;
$$;

create or replace function public.retry_knowledge_ingestion(
    p_organization_id uuid,
    p_source_id uuid,
    p_created_by uuid,
    p_idempotency_key text,
    p_request_id text
)
returns table (
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
    v_source public.knowledge_sources%rowtype;
    v_target_version integer;
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
        if v_existing_job.source_id <> p_source_id then
            raise exception using
                errcode = '22023',
                message = 'The idempotency key belongs to a different knowledge source.';
        end if;

        return query
        select
            v_existing_job.source_id,
            v_existing_job.id,
            v_existing_job.status;
        return;
    end if;

    select knowledge_source.*
    into v_source
    from public.knowledge_sources as knowledge_source
    where knowledge_source.id = p_source_id
      and knowledge_source.organization_id = p_organization_id
    for update;

    if not found or v_source.deleted_at is not null then
        raise exception using
            errcode = 'P0002',
            message = 'The knowledge source does not exist.';
    end if;

    if not v_source.enabled then
        raise exception using
            errcode = '22023',
            message = 'Enable the knowledge source before retrying it.';
    end if;

    if v_source.status not in ('failed', 'ready') then
        raise exception using
            errcode = '55000',
            message = 'Only failed or ready knowledge sources can be reprocessed.';
    end if;

    v_target_version := case
        when v_source.status = 'ready' then v_source.active_version + 1
        else greatest(
            v_source.active_version,
            coalesce(
                (
                    select pg_catalog.max(ingestion_job.target_version)
                    from public.ingestion_jobs as ingestion_job
                    where ingestion_job.organization_id = p_organization_id
                      and ingestion_job.source_id = p_source_id
                ),
                v_source.active_version
            )
        )
    end;

    insert into public.ingestion_jobs (
        organization_id,
        source_id,
        idempotency_key,
        target_version
    )
    values (
        p_organization_id,
        p_source_id,
        p_idempotency_key,
        v_target_version
    )
    returning id into v_job_id;

    update public.knowledge_sources
    set
        status = 'uploaded',
        error_code = null,
        error_message = null
    where id = p_source_id
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
        'knowledge.ingestion.retried',
        'knowledge_source',
        p_source_id,
        p_request_id,
        pg_catalog.jsonb_build_object(
            'jobId', v_job_id,
            'targetVersion', v_target_version
        )
    );

    return query
    select
        p_source_id,
        v_job_id,
        'uploaded'::public.ingestion_status;
end;
$$;

create or replace function public.set_knowledge_ingestion_stage(
    p_job_id uuid,
    p_status public.ingestion_status,
    p_progress_percent integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_job public.ingestion_jobs%rowtype;
begin
    if p_status not in ('extracting', 'chunking', 'embedding') then
        raise exception using
            errcode = '22023',
            message = 'The requested ingestion stage is not a processing stage.';
    end if;

    if p_progress_percent not between 1 and 99 then
        raise exception using
            errcode = '22023',
            message = 'Processing progress must be between 1 and 99.';
    end if;

    select ingestion_job.*
    into v_job
    from public.ingestion_jobs as ingestion_job
    where ingestion_job.id = p_job_id
    for update;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'The ingestion job does not exist.';
    end if;

    if v_job.completed_at is not null or v_job.status = 'ready' then
        return;
    end if;

    update public.ingestion_jobs
    set
        status = p_status,
        progress_percent = p_progress_percent,
        attempt_count = case
            when started_at is null then attempt_count + 1
            else attempt_count
        end,
        started_at = coalesce(started_at, pg_catalog.now()),
        error_code = null,
        error_message = null
    where id = p_job_id;

    update public.knowledge_sources
    set
        status = p_status,
        error_code = null,
        error_message = null
    where id = v_job.source_id
      and organization_id = v_job.organization_id
      and deleted_at is null;
end;
$$;

create or replace function public.complete_knowledge_ingestion(
    p_job_id uuid,
    p_documents jsonb,
    p_chunks jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_job public.ingestion_jobs%rowtype;
    v_source public.knowledge_sources%rowtype;
    v_document_count integer;
    v_chunk_count integer;
    v_document record;
    v_chunk record;
begin
    if pg_catalog.jsonb_typeof(p_documents) <> 'array'
       or pg_catalog.jsonb_typeof(p_chunks) <> 'array' then
        raise exception using
            errcode = '22023',
            message = 'Documents and chunks must be JSON arrays.';
    end if;

    v_document_count := pg_catalog.jsonb_array_length(p_documents);
    v_chunk_count := pg_catalog.jsonb_array_length(p_chunks);

    if v_document_count not between 1 and 30
       or v_chunk_count not between 1 and 2000 then
        raise exception using
            errcode = '22023',
            message = 'The ingestion plan exceeds the bounded document or chunk count.';
    end if;

    select ingestion_job.*
    into v_job
    from public.ingestion_jobs as ingestion_job
    where ingestion_job.id = p_job_id
    for update;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'The ingestion job does not exist.';
    end if;

    if v_job.completed_at is not null and v_job.status = 'ready' then
        return;
    end if;

    select knowledge_source.*
    into v_source
    from public.knowledge_sources as knowledge_source
    where knowledge_source.id = v_job.source_id
      and knowledge_source.organization_id = v_job.organization_id
    for update;

    if not found or v_source.deleted_at is not null or not v_source.enabled then
        raise exception using
            errcode = '55000',
            message = 'The knowledge source cannot accept ingestion results.';
    end if;

    for v_document in
        select *
        from pg_catalog.jsonb_to_recordset(p_documents) as document_record (
            id uuid,
            title text,
            canonical_url text,
            content_hash text,
            metadata jsonb
        )
    loop
        insert into public.knowledge_documents (
            id,
            organization_id,
            source_id,
            version,
            title,
            canonical_url,
            content_hash,
            metadata,
            enabled
        )
        values (
            v_document.id,
            v_job.organization_id,
            v_job.source_id,
            v_job.target_version,
            v_document.title,
            v_document.canonical_url,
            v_document.content_hash,
            coalesce(v_document.metadata, '{}'::jsonb),
            true
        )
        on conflict (id)
        do update set
            title = excluded.title,
            canonical_url = excluded.canonical_url,
            content_hash = excluded.content_hash,
            metadata = excluded.metadata,
            enabled = true,
            deleted_at = null;
    end loop;

    for v_chunk in
        select *
        from pg_catalog.jsonb_to_recordset(p_chunks) as chunk_record (
            id uuid,
            document_id uuid,
            chunk_index integer,
            content text,
            content_hash text,
            embedding text,
            source_locator jsonb,
            metadata jsonb
        )
    loop
        if not exists (
            select 1
            from public.knowledge_documents as knowledge_document
            where knowledge_document.id = v_chunk.document_id
              and knowledge_document.source_id = v_job.source_id
              and knowledge_document.organization_id = v_job.organization_id
              and knowledge_document.version = v_job.target_version
        ) then
            raise exception using
                errcode = '23503',
                message = 'A chunk referenced a document outside the ingestion plan.';
        end if;

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
            metadata,
            enabled
        )
        values (
            v_chunk.id,
            v_job.organization_id,
            v_job.source_id,
            v_chunk.document_id,
            v_job.target_version,
            v_chunk.chunk_index,
            v_chunk.content,
            v_chunk.content_hash,
            v_chunk.embedding::extensions.vector(1024),
            v_chunk.source_locator,
            coalesce(v_chunk.metadata, '{}'::jsonb),
            true
        )
        on conflict (id)
        do update set
            content = excluded.content,
            content_hash = excluded.content_hash,
            embedding = excluded.embedding,
            source_locator = excluded.source_locator,
            metadata = excluded.metadata,
            enabled = true;
    end loop;

    update public.knowledge_documents
    set enabled = (version = v_job.target_version)
    where source_id = v_job.source_id
      and organization_id = v_job.organization_id;

    update public.knowledge_chunks
    set enabled = (document_version = v_job.target_version)
    where source_id = v_job.source_id
      and organization_id = v_job.organization_id;

    update public.knowledge_sources
    set
        active_version = v_job.target_version,
        document_count = v_document_count,
        chunk_count = v_chunk_count,
        status = 'ready',
        error_code = null,
        error_message = null
    where id = v_job.source_id
      and organization_id = v_job.organization_id;

    update public.ingestion_jobs
    set
        status = 'ready',
        progress_percent = 100,
        completed_at = pg_catalog.now(),
        error_code = null,
        error_message = null
    where id = p_job_id;
end;
$$;

create or replace function public.fail_knowledge_ingestion(
    p_job_id uuid,
    p_error_code text,
    p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_job public.ingestion_jobs%rowtype;
begin
    select ingestion_job.*
    into v_job
    from public.ingestion_jobs as ingestion_job
    where ingestion_job.id = p_job_id
    for update;

    if not found then
        return;
    end if;

    if v_job.completed_at is not null or v_job.status = 'ready' then
        return;
    end if;

    update public.ingestion_jobs
    set
        status = 'failed',
        progress_percent = least(progress_percent, 99),
        error_code = pg_catalog.left(p_error_code, 120),
        error_message = pg_catalog.left(p_error_message, 1000)
    where id = p_job_id;

    update public.knowledge_sources
    set
        status = 'failed',
        error_code = pg_catalog.left(p_error_code, 120),
        error_message = pg_catalog.left(p_error_message, 1000)
    where id = v_job.source_id
      and organization_id = v_job.organization_id
      and deleted_at is null;
end;
$$;

create or replace function public.manage_knowledge_source(
    p_organization_id uuid,
    p_source_id uuid,
    p_actor_user_id uuid,
    p_action text,
    p_request_id text
)
returns table (
    original_object_key text,
    extracted_object_key text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_source public.knowledge_sources%rowtype;
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

    select knowledge_source.*
    into v_source
    from public.knowledge_sources as knowledge_source
    where knowledge_source.id = p_source_id
      and knowledge_source.organization_id = p_organization_id
    for update;

    if not found or v_source.deleted_at is not null then
        raise exception using
            errcode = 'P0002',
            message = 'The knowledge source does not exist.';
    end if;

    if p_action = 'disable' then
        if v_source.status not in ('ready', 'failed') then
            raise exception using
                errcode = '55000',
                message = 'A processing source cannot be disabled.';
        end if;

        update public.knowledge_sources
        set
            enabled = false,
            status = 'disabled'
        where id = p_source_id
          and organization_id = p_organization_id;

        update public.knowledge_documents
        set enabled = false
        where source_id = p_source_id
          and organization_id = p_organization_id;

        update public.knowledge_chunks
        set enabled = false
        where source_id = p_source_id
          and organization_id = p_organization_id;
    elsif p_action = 'enable' then
        if v_source.status <> 'disabled' then
            raise exception using
                errcode = '55000',
                message = 'Only a disabled source can be enabled.';
        end if;

        update public.knowledge_sources
        set
            enabled = true,
            status = case
                when v_source.document_count > 0 then 'ready'::public.ingestion_status
                else 'failed'::public.ingestion_status
            end
        where id = p_source_id
          and organization_id = p_organization_id;

        update public.knowledge_documents
        set enabled = (version = v_source.active_version)
        where source_id = p_source_id
          and organization_id = p_organization_id;

        update public.knowledge_chunks
        set enabled = (document_version = v_source.active_version)
        where source_id = p_source_id
          and organization_id = p_organization_id;
    elsif p_action = 'delete' then
        update public.knowledge_sources
        set
            enabled = false,
            status = 'disabled',
            deleted_at = pg_catalog.now()
        where id = p_source_id
          and organization_id = p_organization_id;

        update public.knowledge_documents
        set
            enabled = false,
            deleted_at = pg_catalog.now()
        where source_id = p_source_id
          and organization_id = p_organization_id;

        update public.knowledge_chunks
        set enabled = false
        where source_id = p_source_id
          and organization_id = p_organization_id;
    else
        raise exception using
            errcode = '22023',
            message = 'Unknown knowledge-source action.';
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
        'knowledge.source.' || p_action,
        'knowledge_source',
        p_source_id,
        p_request_id,
        '{}'::jsonb
    );

    return query
    select
        v_source.original_object_key,
        v_source.extracted_object_key;
end;
$$;

revoke all on function public.create_knowledge_ingestion(
    uuid,
    uuid,
    public.knowledge_source_type,
    text,
    text,
    text,
    text,
    integer,
    numeric,
    integer,
    integer,
    text,
    text
) from public;
revoke all on function public.retry_knowledge_ingestion(
    uuid,
    uuid,
    uuid,
    text,
    text
) from public;
revoke all on function public.set_knowledge_ingestion_stage(
    uuid,
    public.ingestion_status,
    integer
) from public;
revoke all on function public.complete_knowledge_ingestion(
    uuid,
    jsonb,
    jsonb
) from public;
revoke all on function public.fail_knowledge_ingestion(
    uuid,
    text,
    text
) from public;
revoke all on function public.manage_knowledge_source(
    uuid,
    uuid,
    uuid,
    text,
    text
) from public;

grant execute on function public.create_knowledge_ingestion(
    uuid,
    uuid,
    public.knowledge_source_type,
    text,
    text,
    text,
    text,
    integer,
    numeric,
    integer,
    integer,
    text,
    text
) to service_role;
grant execute on function public.retry_knowledge_ingestion(
    uuid,
    uuid,
    uuid,
    text,
    text
) to service_role;
grant execute on function public.set_knowledge_ingestion_stage(
    uuid,
    public.ingestion_status,
    integer
) to service_role;
grant execute on function public.complete_knowledge_ingestion(
    uuid,
    jsonb,
    jsonb
) to service_role;
grant execute on function public.fail_knowledge_ingestion(
    uuid,
    text,
    text
) to service_role;
grant execute on function public.manage_knowledge_source(
    uuid,
    uuid,
    uuid,
    text,
    text
) to service_role;

create or replace function public.match_knowledge_chunks(
    p_organization_id uuid,
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
security invoker
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
                case
                    when exists (
                        select 1
                        from pg_catalog.regexp_split_to_table(
                            pg_catalog.lower(coalesce(p_query_text, '')),
                            '[^[:alnum:]-]+'
                        ) as query_terms(term)
                        where pg_catalog.char_length(query_terms.term) >= 2
                          and query_terms.term ~ '[0-9]'
                          and pg_catalog.strpos(
                              pg_catalog.lower(knowledge_chunk.content),
                              query_terms.term
                          ) > 0
                    )
                    then 1.0
                    else 0.0
                end,
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
          and knowledge_chunk.enabled = true
          and knowledge_document.enabled = true
          and knowledge_document.deleted_at is null
          and knowledge_document.version = knowledge_source.active_version
          and knowledge_source.enabled = true
          and knowledge_source.deleted_at is null
          and knowledge_source.status <> 'disabled'
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
