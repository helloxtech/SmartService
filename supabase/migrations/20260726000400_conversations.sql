create table public.conversations (
    id uuid primary key default extensions.gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    channel public.conversation_channel not null default 'text',
    status public.conversation_status not null default 'active_ai',
    customer_name text check (customer_name is null or char_length(customer_name) <= 160),
    customer_email text check (customer_email is null or char_length(customer_email) <= 320),
    customer_phone text check (customer_phone is null or char_length(customer_phone) <= 80),
    customer_company text check (customer_company is null or char_length(customer_company) <= 200),
    language text not null default 'zh-CN' check (language in ('zh-CN', 'en')),
    primary_intent text check (primary_intent is null or char_length(primary_intent) <= 240),
    handoff_reason text check (handoff_reason is null or char_length(handoff_reason) <= 1000),
    started_at timestamptz not null default now(),
    handoff_requested_at timestamptz,
    closed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, organization_id)
);

create index conversations_org_status_idx
on public.conversations (organization_id, status, created_at desc);

create table public.ai_runs (
    id uuid primary key default extensions.gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    conversation_id uuid,
    task_type text not null check (char_length(task_type) between 1 and 80),
    provider text not null check (char_length(provider) between 1 and 80),
    model text not null check (char_length(model) between 1 and 160),
    prompt_version text not null check (char_length(prompt_version) between 1 and 120),
    input_tokens integer check (input_tokens is null or input_tokens >= 0),
    output_tokens integer check (output_tokens is null or output_tokens >= 0),
    latency_ms integer not null check (latency_ms >= 0),
    estimated_cost_usd numeric(12, 8)
        check (estimated_cost_usd is null or estimated_cost_usd >= 0),
    status text not null check (status in ('succeeded', 'failed', 'cancelled')),
    error_code text,
    metadata jsonb not null default '{}'::jsonb
        check (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz not null default now(),
    unique (id, organization_id),
    foreign key (conversation_id, organization_id)
        references public.conversations(id, organization_id)
        on delete set null (conversation_id)
);

create index ai_runs_org_created_idx
on public.ai_runs (organization_id, created_at desc);

create index ai_runs_conversation_idx
on public.ai_runs (conversation_id, organization_id, created_at desc)
where conversation_id is not null;

create table public.messages (
    id uuid primary key default extensions.gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    conversation_id uuid not null,
    sender_type public.message_sender_type not null,
    sender_user_id uuid references auth.users(id) on delete set null,
    text text not null check (char_length(text) between 1 and 20000),
    decision public.message_decision,
    client_message_id uuid,
    language text check (language is null or language in ('zh-CN', 'en')),
    metadata jsonb not null default '{}'::jsonb
        check (jsonb_typeof(metadata) = 'object'),
    ai_run_id uuid,
    created_at timestamptz not null default now(),
    unique (conversation_id, client_message_id),
    unique (id, organization_id),
    foreign key (conversation_id, organization_id)
        references public.conversations(id, organization_id)
        on delete cascade,
    foreign key (ai_run_id, organization_id)
        references public.ai_runs(id, organization_id)
        on delete set null (ai_run_id)
);

create index messages_conversation_created_idx
on public.messages (conversation_id, organization_id, created_at);

create index messages_org_created_idx
on public.messages (organization_id, created_at desc);

create index messages_sender_user_idx
on public.messages (sender_user_id, created_at desc)
where sender_user_id is not null;

create index messages_ai_run_idx
on public.messages (ai_run_id, organization_id)
where ai_run_id is not null;

create table public.message_citations (
    id uuid primary key default extensions.gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    message_id uuid not null,
    chunk_id uuid not null,
    label text not null check (char_length(label) between 1 and 240),
    supporting_excerpt text not null
        check (char_length(supporting_excerpt) between 1 and 2000),
    created_at timestamptz not null default now(),
    unique (message_id, chunk_id),
    foreign key (message_id, organization_id)
        references public.messages(id, organization_id)
        on delete cascade,
    foreign key (chunk_id, organization_id)
        references public.knowledge_chunks(id, organization_id)
        on delete restrict
);

create index message_citations_chunk_idx
on public.message_citations (chunk_id, organization_id);

create index message_citations_message_idx
on public.message_citations (message_id, organization_id);

create index message_citations_org_idx
on public.message_citations (organization_id, created_at desc);

create table public.guardrail_rules (
    id uuid primary key default extensions.gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    code text not null check (code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
    name text not null check (char_length(name) between 1 and 160),
    description text not null check (char_length(description) between 1 and 2000),
    severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
    rule_type text not null check (
        rule_type in (
            'price',
            'delivery',
            'competitor',
            'security',
            'unsupported_claim',
            'safety',
            'custom'
        )
    ),
    safe_response text not null check (char_length(safe_response) between 1 and 4000),
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, code),
    unique (id, organization_id)
);

create index guardrail_rules_org_enabled_idx
on public.guardrail_rules (organization_id, enabled, code);

create table public.guardrail_events (
    id uuid primary key default extensions.gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    conversation_id uuid not null,
    customer_message_id uuid,
    rule_id uuid,
    rule_code text not null check (char_length(rule_code) between 1 and 80),
    severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
    reason text not null check (char_length(reason) between 1 and 4000),
    blocked_candidate text,
    model text,
    prompt_version text,
    ai_run_id uuid,
    created_at timestamptz not null default now(),
    foreign key (conversation_id, organization_id)
        references public.conversations(id, organization_id)
        on delete cascade,
    foreign key (customer_message_id, organization_id)
        references public.messages(id, organization_id)
        on delete set null (customer_message_id),
    foreign key (rule_id, organization_id)
        references public.guardrail_rules(id, organization_id)
        on delete set null (rule_id),
    foreign key (ai_run_id, organization_id)
        references public.ai_runs(id, organization_id)
        on delete set null (ai_run_id)
);

create index guardrail_events_org_created_idx
on public.guardrail_events (organization_id, created_at desc);

create index guardrail_events_conversation_idx
on public.guardrail_events (conversation_id, organization_id, created_at);

create index guardrail_events_customer_message_idx
on public.guardrail_events (customer_message_id, organization_id)
where customer_message_id is not null;

create index guardrail_events_rule_idx
on public.guardrail_events (rule_id, organization_id)
where rule_id is not null;

create index guardrail_events_ai_run_idx
on public.guardrail_events (ai_run_id, organization_id)
where ai_run_id is not null;

create table public.handoffs (
    id uuid primary key default extensions.gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    conversation_id uuid not null,
    reason text not null check (char_length(reason) between 1 and 2000),
    summary_snapshot jsonb not null default '{}'::jsonb
        check (jsonb_typeof(summary_snapshot) = 'object'),
    requested_at timestamptz not null default now(),
    accepted_by uuid references auth.users(id) on delete set null,
    accepted_at timestamptz,
    unique (conversation_id),
    foreign key (conversation_id, organization_id)
        references public.conversations(id, organization_id)
        on delete cascade
);

create index handoffs_org_requested_idx
on public.handoffs (organization_id, requested_at desc);

create index handoffs_conversation_idx
on public.handoffs (conversation_id, organization_id);

create index handoffs_accepted_by_idx
on public.handoffs (accepted_by)
where accepted_by is not null;

create table public.conversation_summaries (
    id uuid primary key default extensions.gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    conversation_id uuid not null,
    version integer not null default 1 check (version >= 1),
    is_incremental boolean not null default false,
    summary text not null check (char_length(summary) between 1 and 20000),
    primary_intent text,
    intent_level text,
    outcome text,
    customer_facts jsonb not null default '[]'::jsonb
        check (jsonb_typeof(customer_facts) = 'array'),
    follow_up_actions jsonb not null default '[]'::jsonb
        check (jsonb_typeof(follow_up_actions) = 'array'),
    suggested_script text,
    model text not null,
    prompt_version text not null,
    ai_run_id uuid,
    created_at timestamptz not null default now(),
    unique (conversation_id, version, is_incremental),
    foreign key (conversation_id, organization_id)
        references public.conversations(id, organization_id)
        on delete cascade,
    foreign key (ai_run_id, organization_id)
        references public.ai_runs(id, organization_id)
        on delete set null (ai_run_id)
);

create index conversation_summaries_org_created_idx
on public.conversation_summaries (organization_id, created_at desc);

create index conversation_summaries_conversation_idx
on public.conversation_summaries (conversation_id, organization_id);

create index conversation_summaries_ai_run_idx
on public.conversation_summaries (ai_run_id, organization_id)
where ai_run_id is not null;

create table public.knowledge_gaps (
    id uuid primary key default extensions.gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    normalized_question text not null
        check (char_length(normalized_question) between 1 and 2000),
    example_question text not null
        check (char_length(example_question) between 1 and 4000),
    first_conversation_id uuid,
    occurrence_count integer not null default 1 check (occurrence_count >= 1),
    reason text not null check (char_length(reason) between 1 and 2000),
    status public.gap_status not null default 'open',
    resolved_source_id uuid,
    last_seen_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, normalized_question),
    foreign key (first_conversation_id, organization_id)
        references public.conversations(id, organization_id)
        on delete set null (first_conversation_id),
    foreign key (resolved_source_id, organization_id)
        references public.knowledge_sources(id, organization_id)
        on delete set null (resolved_source_id)
);

create index knowledge_gaps_org_status_idx
on public.knowledge_gaps (organization_id, status, occurrence_count desc, last_seen_at desc);

create index knowledge_gaps_first_conversation_idx
on public.knowledge_gaps (first_conversation_id, organization_id)
where first_conversation_id is not null;

create index knowledge_gaps_resolved_source_idx
on public.knowledge_gaps (resolved_source_id, organization_id)
where resolved_source_id is not null;

create table public.audit_logs (
    id uuid primary key default extensions.gen_random_uuid(),
    organization_id uuid references public.organizations(id) on delete cascade,
    actor_user_id uuid references auth.users(id) on delete set null,
    action text not null check (char_length(action) between 1 and 160),
    entity_type text not null check (char_length(entity_type) between 1 and 120),
    entity_id uuid,
    request_id text check (request_id is null or char_length(request_id) <= 200),
    metadata jsonb not null default '{}'::jsonb
        check (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz not null default now()
);

create index audit_logs_org_created_idx
on public.audit_logs (organization_id, created_at desc);

create index audit_logs_actor_created_idx
on public.audit_logs (actor_user_id, created_at desc)
where actor_user_id is not null;

create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

create trigger guardrail_rules_set_updated_at
before update on public.guardrail_rules
for each row execute function public.set_updated_at();

create trigger knowledge_gaps_set_updated_at
before update on public.knowledge_gaps
for each row execute function public.set_updated_at();

alter table public.conversations enable row level security;
alter table public.conversations force row level security;
alter table public.ai_runs enable row level security;
alter table public.ai_runs force row level security;
alter table public.messages enable row level security;
alter table public.messages force row level security;
alter table public.message_citations enable row level security;
alter table public.message_citations force row level security;
alter table public.guardrail_rules enable row level security;
alter table public.guardrail_rules force row level security;
alter table public.guardrail_events enable row level security;
alter table public.guardrail_events force row level security;
alter table public.handoffs enable row level security;
alter table public.handoffs force row level security;
alter table public.conversation_summaries enable row level security;
alter table public.conversation_summaries force row level security;
alter table public.knowledge_gaps enable row level security;
alter table public.knowledge_gaps force row level security;
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;

revoke all on public.conversations from anon, authenticated;
revoke all on public.ai_runs from anon, authenticated;
revoke all on public.messages from anon, authenticated;
revoke all on public.message_citations from anon, authenticated;
revoke all on public.guardrail_rules from anon, authenticated;
revoke all on public.guardrail_events from anon, authenticated;
revoke all on public.handoffs from anon, authenticated;
revoke all on public.conversation_summaries from anon, authenticated;
revoke all on public.knowledge_gaps from anon, authenticated;
revoke all on public.audit_logs from anon, authenticated;

grant select, insert, update on public.conversations to authenticated;
grant select on public.ai_runs to authenticated;
grant select, insert on public.messages to authenticated;
grant select on public.message_citations to authenticated;
grant select, insert, update on public.guardrail_rules to authenticated;
grant select on public.guardrail_events to authenticated;
grant select, update on public.handoffs to authenticated;
grant select on public.conversation_summaries to authenticated;
grant select, update on public.knowledge_gaps to authenticated;
grant select on public.audit_logs to authenticated;
grant all on public.conversations to service_role;
grant all on public.ai_runs to service_role;
grant all on public.messages to service_role;
grant all on public.message_citations to service_role;
grant all on public.guardrail_rules to service_role;
grant all on public.guardrail_events to service_role;
grant all on public.handoffs to service_role;
grant all on public.conversation_summaries to service_role;
grant all on public.knowledge_gaps to service_role;
grant all on public.audit_logs to service_role;

create policy conversations_select_member
on public.conversations
for select
to authenticated
using ((select public.is_org_member(organization_id)));

create policy conversations_insert_member
on public.conversations
for insert
to authenticated
with check ((select public.is_org_member(organization_id)));

create policy conversations_update_member
on public.conversations
for update
to authenticated
using (
    (select public.has_org_role(
        organization_id,
        array['admin', 'agent']::public.organization_role[]
    ))
)
with check (
    (select public.has_org_role(
        organization_id,
        array['admin', 'agent']::public.organization_role[]
    ))
);

create policy ai_runs_select_admin
on public.ai_runs
for select
to authenticated
using (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
);

create policy messages_select_member
on public.messages
for select
to authenticated
using ((select public.is_org_member(organization_id)));

create policy messages_insert_human_member
on public.messages
for insert
to authenticated
with check (
    sender_type = 'human'
    and sender_user_id = (select auth.uid())
    and (select public.has_org_role(
        organization_id,
        array['admin', 'agent']::public.organization_role[]
    ))
);

create policy message_citations_select_member
on public.message_citations
for select
to authenticated
using ((select public.is_org_member(organization_id)));

create policy guardrail_rules_select_member
on public.guardrail_rules
for select
to authenticated
using ((select public.is_org_member(organization_id)));

create policy guardrail_rules_insert_admin
on public.guardrail_rules
for insert
to authenticated
with check (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
);

create policy guardrail_rules_update_admin
on public.guardrail_rules
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

create policy guardrail_events_select_admin
on public.guardrail_events
for select
to authenticated
using (
    (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
);

create policy handoffs_select_member
on public.handoffs
for select
to authenticated
using ((select public.is_org_member(organization_id)));

create policy handoffs_update_member
on public.handoffs
for update
to authenticated
using (
    (select public.has_org_role(
        organization_id,
        array['admin', 'agent']::public.organization_role[]
    ))
)
with check (
    (select public.has_org_role(
        organization_id,
        array['admin', 'agent']::public.organization_role[]
    ))
);

create policy conversation_summaries_select_member
on public.conversation_summaries
for select
to authenticated
using ((select public.is_org_member(organization_id)));

create policy knowledge_gaps_select_member
on public.knowledge_gaps
for select
to authenticated
using ((select public.is_org_member(organization_id)));

create policy knowledge_gaps_update_admin
on public.knowledge_gaps
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

create policy audit_logs_select_admin
on public.audit_logs
for select
to authenticated
using (
    organization_id is not null
    and (select public.has_org_role(
        organization_id,
        array['admin']::public.organization_role[]
    ))
);
