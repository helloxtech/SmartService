-- SmartService schema blueprint
-- Codex: split this file into ordered Supabase migrations and add integration tests.
-- Phase gates: omit voice-only types/tables until P1 and omit ticket types/tables until G3.

create extension if not exists pgcrypto;
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm;

create type public.organization_role as enum ('admin', 'agent');
create type public.knowledge_source_type as enum ('pdf', 'docx', 'url', 'manual');
create type public.ingestion_status as enum ('uploaded', 'extracting', 'chunking', 'embedding', 'ready', 'failed', 'disabled');
create type public.conversation_channel as enum ('text', 'voice');
create type public.conversation_status as enum ('active_ai', 'resolved_ai', 'handoff_requested', 'active_human', 'closed');
create type public.message_sender_type as enum ('customer', 'ai', 'human', 'system');
create type public.message_decision as enum ('answer', 'clarify', 'handoff', 'human');
create type public.gap_status as enum ('open', 'resolved', 'ignored');
create type public.ticket_type as enum ('inquiry', 'complaint', 'after_sales', 'other');
create type public.urgency_level as enum ('low', 'normal', 'high', 'critical');
create type public.ticket_status as enum ('open', 'in_progress', 'resolved', 'closed');

create table public.organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique,
    public_key text not null unique default encode(gen_random_bytes(18), 'hex'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.organization_members (
    organization_id uuid not null references public.organizations(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role public.organization_role not null,
    created_at timestamptz not null default now(),
    primary key (organization_id, user_id)
);

create table public.organization_settings (
    organization_id uuid primary key references public.organizations(id) on delete cascade,
    display_name text not null,
    default_language text not null default 'zh-CN',
    chat_welcome_message text not null default '您好，请问有什么可以帮您？',
    voice_enabled boolean not null default false,
    r11_enabled boolean not null default false,
    retention_days integer not null default 30 check (retention_days between 1 and 365),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.knowledge_sources (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    type public.knowledge_source_type not null,
    name text not null,
    source_url text,
    original_object_key text,
    extracted_object_key text,
    status public.ingestion_status not null default 'uploaded',
    active_version integer not null default 1,
    page_count integer,
    standard_page_count numeric(10,2),
    document_count integer not null default 0,
    chunk_count integer not null default 0,
    error_code text,
    error_message text,
    enabled boolean not null default true,
    created_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.knowledge_documents (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    source_id uuid not null references public.knowledge_sources(id) on delete cascade,
    version integer not null,
    title text not null,
    canonical_url text,
    content_hash text not null,
    metadata jsonb not null default '{}'::jsonb,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    unique (source_id, version, content_hash)
);

create table public.knowledge_chunks (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    source_id uuid not null references public.knowledge_sources(id) on delete cascade,
    document_id uuid not null references public.knowledge_documents(id) on delete cascade,
    document_version integer not null,
    chunk_index integer not null,
    content text not null,
    content_hash text not null,
    embedding extensions.vector(1024),
    source_locator jsonb not null,
    metadata jsonb not null default '{}'::jsonb,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    unique (document_id, document_version, chunk_index)
);

create index knowledge_chunks_org_enabled_idx on public.knowledge_chunks (organization_id, enabled);
create index knowledge_chunks_content_trgm_idx on public.knowledge_chunks using gin (content gin_trgm_ops);
create index knowledge_chunks_embedding_hnsw_idx on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);

create table public.ingestion_jobs (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    source_id uuid not null references public.knowledge_sources(id) on delete cascade,
    idempotency_key text not null,
    status public.ingestion_status not null default 'uploaded',
    progress_percent integer not null default 0 check (progress_percent between 0 and 100),
    attempt_count integer not null default 0,
    started_at timestamptz,
    completed_at timestamptz,
    error_code text,
    error_message text,
    created_at timestamptz not null default now(),
    unique (organization_id, idempotency_key)
);

create table public.conversations (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    channel public.conversation_channel not null,
    status public.conversation_status not null default 'active_ai',
    customer_name text,
    customer_email text,
    customer_phone text,
    customer_company text,
    language text not null default 'zh-CN',
    primary_intent text,
    handoff_reason text,
    started_at timestamptz not null default now(),
    handoff_requested_at timestamptz,
    closed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index conversations_org_status_idx on public.conversations (organization_id, status, created_at desc);

create table public.messages (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    conversation_id uuid not null references public.conversations(id) on delete cascade,
    sender_type public.message_sender_type not null,
    sender_user_id uuid references auth.users(id),
    text text not null,
    decision public.message_decision,
    client_message_id uuid,
    language text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (conversation_id, client_message_id)
);

create index messages_conversation_created_idx on public.messages (conversation_id, created_at);

create table public.message_citations (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    message_id uuid not null references public.messages(id) on delete cascade,
    chunk_id uuid not null references public.knowledge_chunks(id) on delete restrict,
    label text not null,
    supporting_excerpt text not null,
    created_at timestamptz not null default now(),
    unique (message_id, chunk_id)
);

create table public.guardrail_rules (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    code text not null,
    name text not null,
    description text not null,
    severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
    rule_type text not null check (rule_type in ('price', 'delivery', 'competitor', 'security', 'unsupported_claim', 'safety', 'custom')),
    safe_response text not null,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, code)
);

create table public.guardrail_events (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    conversation_id uuid not null references public.conversations(id) on delete cascade,
    customer_message_id uuid references public.messages(id) on delete set null,
    rule_id uuid references public.guardrail_rules(id) on delete set null,
    rule_code text not null,
    severity text not null,
    reason text not null,
    blocked_candidate text,
    model text,
    prompt_version text,
    created_at timestamptz not null default now()
);

create table public.handoffs (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    conversation_id uuid not null references public.conversations(id) on delete cascade,
    reason text not null,
    summary_snapshot jsonb not null default '{}'::jsonb,
    requested_at timestamptz not null default now(),
    accepted_by uuid references auth.users(id),
    accepted_at timestamptz,
    unique (conversation_id)
);

create table public.conversation_summaries (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    conversation_id uuid not null references public.conversations(id) on delete cascade,
    version integer not null default 1,
    is_incremental boolean not null default false,
    summary text not null,
    primary_intent text,
    intent_level text,
    outcome text,
    customer_facts jsonb not null default '[]'::jsonb,
    follow_up_actions jsonb not null default '[]'::jsonb,
    suggested_script text,
    model text not null,
    prompt_version text not null,
    created_at timestamptz not null default now(),
    unique (conversation_id, version, is_incremental)
);

create table public.knowledge_gaps (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    normalized_question text not null,
    example_question text not null,
    first_conversation_id uuid references public.conversations(id) on delete set null,
    occurrence_count integer not null default 1,
    reason text not null,
    status public.gap_status not null default 'open',
    resolved_source_id uuid references public.knowledge_sources(id) on delete set null,
    last_seen_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, normalized_question)
);

create table public.tickets (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    conversation_id uuid not null references public.conversations(id) on delete cascade,
    type public.ticket_type not null,
    urgency public.urgency_level not null,
    status public.ticket_status not null default 'open',
    rationale text not null,
    assigned_to uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (conversation_id)
);

create table public.ai_runs (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    conversation_id uuid references public.conversations(id) on delete set null,
    task_type text not null,
    provider text not null,
    model text not null,
    prompt_version text not null,
    input_tokens integer,
    output_tokens integer,
    latency_ms integer not null,
    estimated_cost_usd numeric(12,8),
    status text not null check (status in ('succeeded', 'failed', 'cancelled')),
    error_code text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

-- Link every AI-derived artifact to its complete model/token/latency/cost audit row.
alter table public.messages
    add column ai_run_id uuid references public.ai_runs(id) on delete set null;

alter table public.guardrail_events
    add column ai_run_id uuid references public.ai_runs(id) on delete set null;

alter table public.conversation_summaries
    add column ai_run_id uuid references public.ai_runs(id) on delete set null;

alter table public.tickets
    add column ai_run_id uuid references public.ai_runs(id) on delete set null;

create table public.voice_sessions (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    conversation_id uuid not null references public.conversations(id) on delete cascade,
    livekit_room_name text not null,
    livekit_participant_identity text not null,
    status text not null check (status in ('warming', 'ready', 'active', 'handoff', 'closed', 'failed')),
    started_at timestamptz,
    ended_at timestamptz,
    latency_metrics jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    unique (conversation_id)
);

create table public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid references public.organizations(id) on delete cascade,
    actor_user_id uuid references auth.users(id),
    action text not null,
    entity_type text not null,
    entity_id uuid,
    request_id text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.organization_members om
        where om.organization_id = p_organization_id
          and om.user_id = auth.uid()
    );
$$;

create or replace function public.has_org_role(p_organization_id uuid, p_roles public.organization_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.organization_members om
        where om.organization_id = p_organization_id
          and om.user_id = auth.uid()
          and om.role = any(p_roles)
    );
$$;

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
set search_path = public, extensions
as $$
    with ranked as (
        select
            kc.id as chunk_id,
            kc.content,
            kc.source_locator,
            (1 - (kc.embedding <=> p_query_embedding))::real as semantic_similarity,
            greatest(
                similarity(kc.content, coalesce(p_query_text, '')),
                word_similarity(coalesce(p_query_text, ''), kc.content),
                case
                    when exists (
                        select 1
                        from regexp_split_to_table(
                            lower(coalesce(p_query_text, '')),
                            '[^[:alnum:]-]+'
                        ) as query_terms(term)
                        where char_length(query_terms.term) >= 2
                          and query_terms.term ~ '[0-9]'
                          and position(query_terms.term in lower(kc.content)) > 0
                    )
                    then 1.0
                    else 0.0
                end,
                0
            )::real as lexical_score
        from public.knowledge_chunks kc
        join public.knowledge_documents kd
          on kd.id = kc.document_id
        join public.knowledge_sources ks on ks.id = kc.source_id
        where kc.organization_id = p_organization_id
          and kc.enabled = true
          and kd.organization_id = p_organization_id
          and kd.enabled = true
          and kd.version = ks.active_version
          and ks.enabled = true
          and ks.status = 'ready'
          and kc.document_version = ks.active_version
          and kc.embedding is not null
    ),
    scored as (
        select
            ranked.chunk_id,
            ranked.content,
            ranked.source_locator,
            ranked.semantic_similarity,
            ranked.lexical_score,
            least(1.0, 0.80 * ranked.semantic_similarity + 0.20 * ranked.lexical_score)::real as combined_score
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

-- Enable RLS on all exposed business tables.
do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'organizations','organization_members','organization_settings',
        'knowledge_sources','knowledge_documents','knowledge_chunks','ingestion_jobs',
        'conversations','messages','message_citations','guardrail_rules','guardrail_events',
        'handoffs','conversation_summaries','knowledge_gaps','tickets','ai_runs',
        'voice_sessions','audit_logs'
    ]
    loop
        execute format('alter table public.%I enable row level security', table_name);
    end loop;
end $$;

-- Representative policies. Codex must generate explicit policies for every table and operation.
-- Do not grant agents direct select access to guardrail_events.blocked_candidate.
-- The Worker returns a redacted agent DTO and exposes candidate text only through an admin-only route.
create policy organizations_select_member
on public.organizations for select
to authenticated
using (public.is_org_member(id));

create policy organization_members_select_member
on public.organization_members for select
to authenticated
using (public.is_org_member(organization_id));

create policy knowledge_sources_select_member
on public.knowledge_sources for select
to authenticated
using (public.is_org_member(organization_id));

create policy knowledge_sources_write_admin
on public.knowledge_sources for all
to authenticated
using (public.has_org_role(organization_id, array['admin']::public.organization_role[]))
with check (public.has_org_role(organization_id, array['admin']::public.organization_role[]));

create policy conversations_select_member
on public.conversations for select
to authenticated
using (public.is_org_member(organization_id));

create policy conversations_update_agent_or_admin
on public.conversations for update
to authenticated
using (public.has_org_role(organization_id, array['admin','agent']::public.organization_role[]))
with check (public.has_org_role(organization_id, array['admin','agent']::public.organization_role[]));

-- Important: public customers do not receive direct anon policies. Worker/service role mediates public access.
