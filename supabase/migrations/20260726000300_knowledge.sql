create table public.knowledge_sources (
    id uuid primary key default extensions.gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    type public.knowledge_source_type not null,
    name text not null check (char_length(name) between 1 and 240),
    source_url text,
    original_object_key text,
    extracted_object_key text,
    status public.ingestion_status not null default 'uploaded',
    active_version integer not null default 1 check (active_version >= 1),
    page_count integer check (page_count is null or page_count >= 0),
    standard_page_count numeric(10, 2)
        check (standard_page_count is null or standard_page_count >= 0),
    document_count integer not null default 0 check (document_count >= 0),
    chunk_count integer not null default 0 check (chunk_count >= 0),
    error_code text,
    error_message text,
    enabled boolean not null default true,
    deleted_at timestamptz,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, organization_id),
    check (
        (type = 'url' and source_url is not null)
        or type <> 'url'
    )
);

create index knowledge_sources_org_status_idx
on public.knowledge_sources (organization_id, status, enabled, updated_at desc);

create index knowledge_sources_created_by_idx
on public.knowledge_sources (created_by)
where created_by is not null;

create table public.knowledge_documents (
    id uuid primary key default extensions.gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    source_id uuid not null,
    version integer not null check (version >= 1),
    title text not null check (char_length(title) between 1 and 500),
    canonical_url text,
    content_hash text not null check (char_length(content_hash) between 32 and 128),
    metadata jsonb not null default '{}'::jsonb
        check (jsonb_typeof(metadata) = 'object'),
    enabled boolean not null default true,
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    unique (source_id, version, content_hash),
    unique (id, organization_id),
    unique (id, source_id, organization_id),
    foreign key (source_id, organization_id)
        references public.knowledge_sources(id, organization_id)
        on delete restrict
);

create index knowledge_documents_source_version_idx
on public.knowledge_documents (source_id, organization_id, version desc, enabled);

create index knowledge_documents_org_enabled_idx
on public.knowledge_documents (organization_id, enabled, version desc);

create table public.knowledge_chunks (
    id uuid primary key default extensions.gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    source_id uuid not null,
    document_id uuid not null,
    document_version integer not null check (document_version >= 1),
    chunk_index integer not null check (chunk_index >= 0),
    content text not null check (char_length(content) between 1 and 12000),
    content_hash text not null check (char_length(content_hash) between 32 and 128),
    embedding extensions.vector(1024),
    source_locator jsonb not null
        check (jsonb_typeof(source_locator) = 'object'),
    metadata jsonb not null default '{}'::jsonb
        check (jsonb_typeof(metadata) = 'object'),
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    unique (document_id, document_version, chunk_index),
    unique (id, organization_id),
    foreign key (source_id, organization_id)
        references public.knowledge_sources(id, organization_id)
        on delete restrict,
    foreign key (document_id, source_id, organization_id)
        references public.knowledge_documents(id, source_id, organization_id)
        on delete restrict
);

create index knowledge_chunks_source_idx
on public.knowledge_chunks (
    source_id,
    organization_id,
    document_version,
    enabled
);

create index knowledge_chunks_document_idx
on public.knowledge_chunks (
    document_id,
    source_id,
    organization_id,
    document_version,
    chunk_index
);

create index knowledge_chunks_org_enabled_idx
on public.knowledge_chunks (organization_id, enabled);

create index knowledge_chunks_content_trgm_idx
on public.knowledge_chunks
using gin (content extensions.gin_trgm_ops)
where enabled = true;

create index knowledge_chunks_embedding_hnsw_idx
on public.knowledge_chunks
using hnsw (embedding extensions.vector_cosine_ops)
where embedding is not null and enabled = true;

create table public.ingestion_jobs (
    id uuid primary key default extensions.gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    source_id uuid not null,
    idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
    status public.ingestion_status not null default 'uploaded',
    progress_percent integer not null default 0
        check (progress_percent between 0 and 100),
    attempt_count integer not null default 0
        check (attempt_count between 0 and 10),
    started_at timestamptz,
    completed_at timestamptz,
    error_code text,
    error_message text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, idempotency_key),
    foreign key (source_id, organization_id)
        references public.knowledge_sources(id, organization_id)
        on delete restrict
);

create index ingestion_jobs_source_status_idx
on public.ingestion_jobs (source_id, organization_id, status, created_at desc);

create trigger knowledge_sources_set_updated_at
before update on public.knowledge_sources
for each row execute function public.set_updated_at();

create trigger ingestion_jobs_set_updated_at
before update on public.ingestion_jobs
for each row execute function public.set_updated_at();

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

revoke all on function public.match_knowledge_chunks(
    uuid,
    extensions.vector,
    real,
    integer,
    text
) from public;

grant execute on function public.match_knowledge_chunks(
    uuid,
    extensions.vector,
    real,
    integer,
    text
) to authenticated, service_role;

alter table public.knowledge_sources enable row level security;
alter table public.knowledge_sources force row level security;
alter table public.knowledge_documents enable row level security;
alter table public.knowledge_documents force row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.knowledge_chunks force row level security;
alter table public.ingestion_jobs enable row level security;
alter table public.ingestion_jobs force row level security;

revoke all on public.knowledge_sources from anon, authenticated;
revoke all on public.knowledge_documents from anon, authenticated;
revoke all on public.knowledge_chunks from anon, authenticated;
revoke all on public.ingestion_jobs from anon, authenticated;

grant select, insert, update on public.knowledge_sources to authenticated;
grant select, insert, update on public.knowledge_documents to authenticated;
grant select, insert, update on public.knowledge_chunks to authenticated;
grant select, insert, update on public.ingestion_jobs to authenticated;
grant all on public.knowledge_sources to service_role;
grant all on public.knowledge_documents to service_role;
grant all on public.knowledge_chunks to service_role;
grant all on public.ingestion_jobs to service_role;

create policy knowledge_sources_select_member
on public.knowledge_sources
for select
to authenticated
using ((select public.is_org_member(organization_id)));

create policy knowledge_sources_insert_admin
on public.knowledge_sources
for insert
to authenticated
with check (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
);

create policy knowledge_sources_update_admin
on public.knowledge_sources
for update
to authenticated
using (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
)
with check (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
);

create policy knowledge_documents_select_member
on public.knowledge_documents
for select
to authenticated
using ((select public.is_org_member(organization_id)));

create policy knowledge_documents_insert_admin
on public.knowledge_documents
for insert
to authenticated
with check (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
);

create policy knowledge_documents_update_admin
on public.knowledge_documents
for update
to authenticated
using (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
)
with check (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
);

create policy knowledge_chunks_select_member
on public.knowledge_chunks
for select
to authenticated
using ((select public.is_org_member(organization_id)));

create policy knowledge_chunks_insert_admin
on public.knowledge_chunks
for insert
to authenticated
with check (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
);

create policy knowledge_chunks_update_admin
on public.knowledge_chunks
for update
to authenticated
using (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
)
with check (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
);

create policy ingestion_jobs_select_admin
on public.ingestion_jobs
for select
to authenticated
using (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
);

create policy ingestion_jobs_insert_admin
on public.ingestion_jobs
for insert
to authenticated
with check (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
);

create policy ingestion_jobs_update_admin
on public.ingestion_jobs
for update
to authenticated
using (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
)
with check (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
);
