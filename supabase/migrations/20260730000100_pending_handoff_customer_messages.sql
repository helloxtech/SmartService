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

    if v_status not in ('active_ai', 'handoff_requested', 'active_human') then
        raise exception 'conversation_not_writeable';
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
