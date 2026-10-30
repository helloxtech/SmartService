-- Dedicated Shifa database only. No relationship to SmartService customer data.
create schema if not exists shifa_private;
revoke all on schema shifa_private from public, anon, authenticated;
grant usage on schema shifa_private to service_role;

create table shifa_private.shares (
    id uuid primary key,
    code text unique not null check (code ~ '^[0-9]{4}$' and code <> '1234'),
    owner_hash text not null check (length(owner_hash) = 64),
    ciphertext text not null check (length(ciphertext) <= 6000000),
    expires_at timestamptz not null,
    created_at timestamptz not null default clock_timestamp()
);
create index on shifa_private.shares(expires_at);
create table shifa_private.requests (
    id uuid primary key,
    share_id uuid references shifa_private.shares(id) on delete cascade,
    token_hash text not null check (length(token_hash) = 64),
    phrase text not null,
    status text not null default 'pending' check (status in ('pending','approved','denied')),
    expires_at timestamptz not null
);
create index on shifa_private.requests(share_id);
create table shifa_private.rate_limits (
    key text primary key,
    count integer not null,
    reset_at timestamptz not null
);
alter table shifa_private.shares enable row level security;
alter table shifa_private.requests enable row level security;
alter table shifa_private.rate_limits enable row level security;
revoke all on all tables in schema shifa_private from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema shifa_private to service_role;

-- Security invoker: only service_role can execute or access these private tables.
-- The Worker validates payloads, encrypts snapshots, and hashes capabilities.
create function public.shifa_command(operation text, payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
    instant timestamptz := clock_timestamp();
    share shifa_private.shares;
    request shifa_private.requests;
    expires timestamptz;
    candidate text;
    assigned text;
    counter integer;
    limit_count integer;
    throttle_key text;
    attempts integer;
begin
    -- Enforce deletion on every API call as well as the five-minute scheduled job.
    delete from shifa_private.shares where expires_at <= instant;
    delete from shifa_private.requests where expires_at <= instant;
    delete from shifa_private.rate_limits where reset_at <= instant;
    if operation = 'cleanup' then return jsonb_build_object('status','ok'); end if;

    if operation in ('create','request') then
        throttle_key := operation || ':' || (payload->>'clientHash');
        limit_count := case when operation = 'create' then 10 else 30 end;
        insert into shifa_private.rate_limits(key,count,reset_at)
        values(throttle_key,1,instant + interval '15 minutes')
        on conflict(key) do update set count = shifa_private.rate_limits.count + 1
        returning count into counter;
        if counter > limit_count then return jsonb_build_object('status','limited'); end if;
    end if;

    if operation = 'create' then
        if (payload->>'durationMinutes')::int not in (15,60,240) then
            return jsonb_build_object('status','invalid');
        end if;
        expires := instant + make_interval(mins => (payload->>'durationMinutes')::int);
        -- Visit each possible code once from a cryptographically randomized start.
        -- UNIQUE/ON CONFLICT arbitrates concurrent allocations without overwrites.
        for attempts in 0..9999 loop
            candidate := lpad((((payload->>'codeStart')::int + attempts) % 10000)::text,4,'0');
            if candidate = '1234' then continue; end if;
            insert into shifa_private.shares(id,code,owner_hash,ciphertext,expires_at)
            values((payload->>'shareId')::uuid,candidate,payload->>'ownerHash',payload->>'ciphertext',expires)
            on conflict(code) do nothing returning code into assigned;
            if assigned is not null then
                return jsonb_build_object('code',assigned,'expiresAt',expires);
            end if;
        end loop;
        return jsonb_build_object('status','full');
    elsif operation = 'request' then
        -- Serialize per-share request limits against other requests and revocation.
        select * into share from shifa_private.shares
        where code = payload->>'code' and expires_at > instant for update;
        if share.id is not null then
            select count(*) into counter from shifa_private.requests
            where share_id = share.id and status = 'pending' and expires_at > instant;
            if counter >= 3 then share.id := null; end if;
        end if;
        expires := instant + interval '2 minutes';
        -- Unknown codes get the same shape/timing without patient information.
        insert into shifa_private.requests(id,share_id,token_hash,phrase,expires_at)
        values((payload->>'requestId')::uuid,share.id,payload->>'requestHash',payload->>'phrase',expires);
        return jsonb_build_object('expiresAt',expires);
    elsif operation in ('owner','decide','revoke') then
        select * into share from shifa_private.shares
        where id = (payload->>'shareId')::uuid and owner_hash = payload->>'ownerHash'
          and expires_at > instant for update;
        if share.id is null then return jsonb_build_object('status','expired'); end if;
        if operation = 'owner' then
            return jsonb_build_object('status','active','expiresAt',share.expires_at,
                'requests',coalesce((select jsonb_agg(jsonb_build_object('requestId',id,'phrase',phrase,'expiresAt',expires_at))
                from shifa_private.requests where share_id = share.id and status = 'pending' and expires_at > instant),'[]'::jsonb));
        elsif operation = 'revoke' then
            delete from shifa_private.shares where id = share.id;
            return jsonb_build_object('status','revoked');
        else
            update shifa_private.requests set
                status = case when (payload->>'approve')::boolean then 'approved' else 'denied' end,
                expires_at = case when (payload->>'approve')::boolean then share.expires_at else expires_at end
            where id = (payload->>'requestId')::uuid and share_id = share.id and status = 'pending' and expires_at > instant;
            if not found then return jsonb_build_object('status','expired'); end if;
            return jsonb_build_object('status','ok');
        end if;
    elsif operation = 'read' then
        select * into request from shifa_private.requests
        where id = (payload->>'requestId')::uuid and token_hash = payload->>'requestHash' and expires_at > instant;
        if request.id is null then return jsonb_build_object('status','expired'); end if;
        if request.status <> 'approved' then
            return jsonb_build_object('status',request.status,'expiresAt',request.expires_at);
        end if;
        select * into share from shifa_private.shares where id = request.share_id and expires_at > instant;
        if share.id is null then return jsonb_build_object('status','expired'); end if;
        return jsonb_build_object('status','approved','expiresAt',share.expires_at,'shareId',share.id,'ciphertext',share.ciphertext);
    end if;
    return jsonb_build_object('status','invalid');
end;
$$;
revoke all on function public.shifa_command(text,jsonb) from public, anon, authenticated;
grant execute on function public.shifa_command(text,jsonb) to service_role;
