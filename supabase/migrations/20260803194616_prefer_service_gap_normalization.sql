-- Reuse the application's canonical question normalization so gap merging matches every turn path.
create or replace function public.record_nonterminal_knowledge_gap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_customer_question text;
    v_normalized_question text;
    v_reason text;
    v_reply_to_message_id uuid;
begin
    if new.sender_type <> 'ai' or new.decision <> 'clarify' then
        return new;
    end if;

    v_reason := new.metadata ->> 'handoffReason';

    if v_reason is null
        or v_reason not in ('missing_knowledge', 'conflicting_knowledge')
    then
        return new;
    end if;

    begin
        v_reply_to_message_id := nullif(new.metadata ->> 'replyToMessageId', '')::uuid;
    exception
        when invalid_text_representation then
            return new;
    end;

    select customer_message.text
    into v_customer_question
    from public.messages as customer_message
    where customer_message.id = v_reply_to_message_id
      and customer_message.organization_id = new.organization_id
      and customer_message.conversation_id = new.conversation_id
      and customer_message.sender_type = 'customer';

    if v_customer_question is null then
        return new;
    end if;

    select nullif(ai_run.metadata #>> '{retrieval,normalizedQuestion}', '')
    into v_normalized_question
    from public.ai_runs as ai_run
    where ai_run.id = new.ai_run_id
      and ai_run.organization_id = new.organization_id
      and ai_run.conversation_id = new.conversation_id;

    if v_normalized_question is null then
        v_normalized_question := trim(
            regexp_replace(
                lower(v_customer_question),
                '[[:space:][:punct:]，。！？；：、“”‘’（）【】《》…]+',
                ' ',
                'g'
            )
        );
    end if;

    v_normalized_question := left(v_normalized_question, 500);

    if v_normalized_question = '' then
        v_normalized_question := left(trim(v_customer_question), 500);
    end if;

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
        new.organization_id,
        v_normalized_question,
        v_customer_question,
        new.conversation_id,
        1,
        v_reason,
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

    return new;
end;
$$;

revoke all on function public.record_nonterminal_knowledge_gap() from public;
revoke all on function public.record_nonterminal_knowledge_gap() from anon, authenticated;
