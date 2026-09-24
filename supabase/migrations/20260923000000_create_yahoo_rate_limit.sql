-- supabase/migrations/20260923000000_create_yahoo_rate_limit.sql
-- Global circuit breaker for outbound calls to Yahoo Finance.
--
-- Everyone who uses the app hits Yahoo through the SAME Edge Function, so
-- Yahoo sees one shared IP no matter how many distinct visitors there are
-- (see the option-chain shared cache's own comment). The 15-minute cache
-- already cuts most repeat requests, but a burst of DIFFERENT symbols/
-- expiries in a short window can still ramp up real Yahoo traffic fast
-- enough to risk a block. This table is a hard, global "no more than N
-- real Yahoo calls per window" ceiling that sits in front of the fetch —
-- a last-resort brake, not a substitute for the cache.
--
-- Single-row fixed-key counter (one row per named limiter, id='yahoo'),
-- reset on a rolling fixed window. Uses a Postgres function
-- (check_and_increment_rate_limit) instead of a plain
-- read-then-write-from-the-edge-function so the check+increment is
-- ATOMIC under concurrent requests (row-level lock via SELECT ... FOR
-- UPDATE) — two Edge Function invocations racing each other can't both
-- read "9 out of 10" and both proceed, blowing past the limit.

create table if not exists public.api_rate_limit (
  id text primary key,
  window_start timestamptz not null default now(),
  request_count int not null default 0
);

alter table public.api_rate_limit enable row level security;

-- No select/insert/update policy for anon/authenticated — this table has
-- no useful information for a client and is only ever touched through the
-- SECURITY DEFINER function below (which runs as the function owner,
-- bypassing RLS) or the service role.

-- Atomically checks whether another call is allowed under (limit_count
-- calls per window_seconds), and if so, counts it — in one round trip, one
-- row lock, no read-modify-write race. Returns true = go ahead and call
-- Yahoo; false = over budget, caller should serve cache/stale data or a
-- friendly "try again shortly" response instead of calling out.
create or replace function public.check_and_increment_rate_limit(
  limiter_id text,
  window_seconds int,
  limit_count int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  row_record record;
  now_ts timestamptz := now();
begin
  -- Ensure a row exists for this limiter, then lock it for the duration
  -- of this transaction so concurrent callers serialize here instead of
  -- racing on the read.
  insert into public.api_rate_limit (id, window_start, request_count)
  values (limiter_id, now_ts, 0)
  on conflict (id) do nothing;

  select * into row_record
  from public.api_rate_limit
  where id = limiter_id
  for update;

  if now_ts - row_record.window_start > make_interval(secs => window_seconds) then
    -- Window has rolled over — start a fresh one at count 1 (this call).
    update public.api_rate_limit
    set window_start = now_ts, request_count = 1
    where id = limiter_id;
    return true;
  end if;

  if row_record.request_count >= limit_count then
    return false; -- over budget for the current window
  end if;

  update public.api_rate_limit
  set request_count = row_record.request_count + 1
  where id = limiter_id;
  return true;
end;
$$;