create or replace function public.is_actionable_knowledge_gap_question(
    p_question text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
    v_question text := trim(normalize(coalesce(p_question, ''), nfkc));
begin
    if v_question = ''
        or v_question !~ '[[:alnum:][:alpha:]]'
    then
        return false;
    end if;

    if v_question ~* '^(你好|您好|嗨|嘿|哈[啰喽罗]|早上好|下午好|晚上好|在吗|hello|hi|hey|good morning|good afternoon|good evening|谢谢|多谢|感谢|谢了|thank you|thanks|many thanks|再见|拜拜|bye|goodbye|好的?|行|可以|明白了?|知道了?|没问题|收到|ok(ay)?|got it|understood|sounds good)[[:space:][:punct:]，。！？～~]*$'
        or v_question ~* '^(吗|么|呢|啊|呀|吧|嗯|呃|哦|诶|这个|那个|它|这|那|刚才那个|为什么|怎么|what|why|how|that|this|it)[[:space:][:punct:]，。！？～~]*$'
        or v_question ~* '^(能|能不能|可以|可不可以)?(听到|听见|听得到)(我)?(说话|的声音)?(吗|么)?[[:space:][:punct:]，。！？～~]*$'
        or v_question ~* '^(can you|do you) (hear|see|read) me[[:space:][:punct:]]*$'
        or v_question ~* '(为什么|怎么|为何).{0,24}(答不了|不能答|没答|没有答|不回答|没回答|不回复|没回复|没反应|查不到|没查到|未能确认)'
        or v_question ~* '(麻烦)?(再试|重试)(一次)?'
        or v_question ~* '(刚才|方才).{0,16}(没反应|没回复|没回答|没答复)'
        or v_question ~* '\m(why|how come).{0,40}(cannot|can''t|did not|didn''t|will not|won''t|could not|couldn''t).{0,30}(answer|reply|respond|find|confirm)\M'
        or v_question ~* '\m(try|please try) again\M'
        or v_question ~* '\m(no|without a) (answer|reply|response)\M'
    then
        return false;
    end if;

    return true;
end;
$$;

create or replace function public.record_nonterminal_knowledge_gap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_customer_question text;
    v_gap_eligible boolean;
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

    select
        nullif(ai_run.metadata #>> '{retrieval,normalizedQuestion}', ''),
        case
            when jsonb_typeof(ai_run.metadata #> '{retrieval,gapEligible}') = 'boolean'
                then (ai_run.metadata #>> '{retrieval,gapEligible}')::boolean
            else null
        end
    into v_normalized_question, v_gap_eligible
    from public.ai_runs as ai_run
    where ai_run.id = new.ai_run_id
      and ai_run.organization_id = new.organization_id
      and ai_run.conversation_id = new.conversation_id;

    if not coalesce(
        v_gap_eligible,
        public.is_actionable_knowledge_gap_question(v_customer_question)
    ) then
        return new;
    end if;

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
        return new;
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

create or replace function public.suppress_nonactionable_knowledge_gap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.is_actionable_knowledge_gap_question(new.example_question) then
        return null;
    end if;

    return new;
end;
$$;

create trigger knowledge_gaps_suppress_nonactionable_insert
before insert on public.knowledge_gaps
for each row execute function public.suppress_nonactionable_knowledge_gap();

create or replace function public.resolve_knowledge_gap_after_grounded_citation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_gap_id uuid;
    v_message public.messages%rowtype;
    v_normalized_question text;
    v_source_id uuid;
begin
    select message.*
    into v_message
    from public.messages as message
    where message.id = new.message_id
      and message.organization_id = new.organization_id
      and message.sender_type = 'ai'
      and message.decision = 'answer';

    if not found or v_message.ai_run_id is null then
        return new;
    end if;

    select nullif(ai_run.metadata #>> '{retrieval,normalizedQuestion}', '')
    into v_normalized_question
    from public.ai_runs as ai_run
    where ai_run.id = v_message.ai_run_id
      and ai_run.organization_id = new.organization_id
      and ai_run.conversation_id = v_message.conversation_id;

    if v_normalized_question is null then
        return new;
    end if;

    select chunk.source_id
    into v_source_id
    from public.knowledge_chunks as chunk
    where chunk.id = new.chunk_id
      and chunk.organization_id = new.organization_id;

    update public.knowledge_gaps as gap
    set
        resolved_source_id = v_source_id,
        status = 'resolved'
    where gap.organization_id = new.organization_id
      and gap.normalized_question = left(v_normalized_question, 500)
      and gap.status = 'open'
      and gap.created_at <= v_message.created_at
    returning gap.id into v_gap_id;

    if v_gap_id is not null then
        insert into public.audit_logs (
            organization_id,
            action,
            entity_type,
            entity_id,
            request_id,
            metadata
        )
        values (
            new.organization_id,
            'knowledge_gap.auto_resolved',
            'knowledge_gap',
            v_gap_id,
            'database:grounded-citation:' || new.id::text,
            jsonb_build_object(
                'conversationId', v_message.conversation_id,
                'messageId', v_message.id,
                'sourceId', v_source_id
            )
        );
    end if;

    return new;
end;
$$;

create trigger message_citations_resolve_knowledge_gap
after insert on public.message_citations
for each row execute function public.resolve_knowledge_gap_after_grounded_citation();

update public.knowledge_gaps as gap
set status = 'ignored'
where gap.status = 'open'
  and not public.is_actionable_knowledge_gap_question(gap.example_question);

with grounded_resolution as (
    select distinct on (gap.id)
        gap.id as gap_id,
        chunk.source_id
    from public.knowledge_gaps as gap
    join public.ai_runs as ai_run
      on ai_run.organization_id = gap.organization_id
     and left(ai_run.metadata #>> '{retrieval,normalizedQuestion}', 500)
        = gap.normalized_question
    join public.messages as message
      on message.ai_run_id = ai_run.id
     and message.organization_id = gap.organization_id
     and message.sender_type = 'ai'
     and message.decision = 'answer'
     and message.created_at >= gap.created_at
    join public.message_citations as citation
      on citation.message_id = message.id
     and citation.organization_id = gap.organization_id
    join public.knowledge_chunks as chunk
      on chunk.id = citation.chunk_id
     and chunk.organization_id = gap.organization_id
    where gap.status = 'open'
    order by gap.id, message.created_at desc, citation.created_at
)
update public.knowledge_gaps as gap
set
    resolved_source_id = grounded_resolution.source_id,
    status = 'resolved'
from grounded_resolution
where gap.id = grounded_resolution.gap_id;

revoke all on function public.is_actionable_knowledge_gap_question(text) from public;
revoke all on function public.is_actionable_knowledge_gap_question(text) from anon, authenticated;
revoke all on function public.record_nonterminal_knowledge_gap() from public;
revoke all on function public.record_nonterminal_knowledge_gap() from anon, authenticated;
revoke all on function public.suppress_nonactionable_knowledge_gap() from public;
revoke all on function public.suppress_nonactionable_knowledge_gap() from anon, authenticated;
revoke all on function public.resolve_knowledge_gap_after_grounded_citation() from public;
revoke all on function public.resolve_knowledge_gap_after_grounded_citation() from anon, authenticated;

grant execute on function public.is_actionable_knowledge_gap_question(text) to service_role;
