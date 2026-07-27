create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create type public.organization_role as enum ('admin', 'agent');
create type public.knowledge_source_type as enum ('pdf', 'docx', 'url', 'manual');
create type public.ingestion_status as enum (
    'uploaded',
    'extracting',
    'chunking',
    'embedding',
    'ready',
    'failed',
    'disabled'
);
create type public.conversation_channel as enum ('text');
create type public.conversation_status as enum (
    'active_ai',
    'resolved_ai',
    'handoff_requested',
    'active_human',
    'closed'
);
create type public.message_sender_type as enum ('customer', 'ai', 'human', 'system');
create type public.message_decision as enum ('answer', 'clarify', 'handoff', 'human');
create type public.gap_status as enum ('open', 'resolved', 'ignored');

revoke all on type public.organization_role from public;
revoke all on type public.knowledge_source_type from public;
revoke all on type public.ingestion_status from public;
revoke all on type public.conversation_channel from public;
revoke all on type public.conversation_status from public;
revoke all on type public.message_sender_type from public;
revoke all on type public.message_decision from public;
revoke all on type public.gap_status from public;

grant usage on type public.organization_role to authenticated, service_role;
grant usage on type public.knowledge_source_type to authenticated, service_role;
grant usage on type public.ingestion_status to authenticated, service_role;
grant usage on type public.conversation_channel to authenticated, service_role;
grant usage on type public.conversation_status to authenticated, service_role;
grant usage on type public.message_sender_type to authenticated, service_role;
grant usage on type public.message_decision to authenticated, service_role;
grant usage on type public.gap_status to authenticated, service_role;
