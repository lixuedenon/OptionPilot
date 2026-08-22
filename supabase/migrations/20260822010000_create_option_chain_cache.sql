-- Shared server-side cache for option chain lookups.
--
-- This is the "everyone shares one fetched copy" layer discussed for
-- reducing load on Yahoo Finance as user count grows: the option-chain
-- Edge Function checks this table before calling Yahoo, and writes back
-- to it after a real fetch. Cache entries are considered fresh for 15
-- minutes (enforced in application code, not here, since Postgres doesn't
-- need to know the TTL policy — it just stores whatever was last written
-- and when).
--
-- This is market data, not user data — no user_id column, no per-user
-- RLS. Read access is public since there's nothing sensitive in an option
-- chain snapshot; only the Edge Function (using the service role key,
-- which bypasses RLS entirely) writes to it.

create table if not exists public.option_chain_cache (
  cache_key text primary key,
  symbol text not null,
  data jsonb not null,
  fetched_at timestamptz not null default now()
);

create index if not exists option_chain_cache_fetched_at_idx
  on public.option_chain_cache (fetched_at);

alter table public.option_chain_cache enable row level security;

-- Public read: this is the same market data Yahoo already serves for free
-- to anyone who asks, cached here purely to cut down on redundant calls.
create policy "option_chain_cache_select_all"
  on public.option_chain_cache
  for select
  using (true);

-- No insert/update/delete policy for anon or authenticated roles — only
-- the service role (used inside the Edge Function) can write, and the
-- service role bypasses RLS by design, so no explicit write policy is
-- needed or added here.