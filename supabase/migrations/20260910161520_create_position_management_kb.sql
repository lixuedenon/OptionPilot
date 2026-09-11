-- Reference table backing the "持仓处置建议" retrieval feature (对比模式 +
-- 模拟账户 each get a button that queries this table for the closest-matching
-- historical position-management cases and shows their advice).
--
-- This is curated reference content generated offline (see the private
-- position-management-kb project docs / KB build scripts — the source
-- JSONL files live OUTSIDE this repo, never committed here), not user data.
-- No user_id column, no per-user RLS, same convention as
-- option_chain_cache: public read, service-role-only write (the one-time
-- import script uses the service role key and bypasses RLS entirely).
--
-- Deliberately NOT using pgvector / an embedding column — see
-- claude/retrieval-feature-design.md in the project docs for why: the KB is
-- sized so that each (strategy, leg_count, direction, situation_tag)
-- combination only has a handful of records (3-8 typically), so a plain
-- exact-match filter already returns a small, directly-showable result set.
-- No semantic ranking needed at this scale.

create table if not exists public.position_management_kb (
  id text primary key,
  source text not null,
  strategy text not null,
  leg_count integer not null,
  direction text not null check (direction in ('bullish', 'bearish', 'neutral')),
  situation_tag text not null,
  label text not null,
  market_environment text not null,
  entry_state text not null,
  current_state text not null,
  question text not null,
  answer text not null,
  action text not null,
  reasoning text not null,
  risk_factors text not null,
  imported_at timestamptz not null default now()
);

-- The exact filter combination kb-retrieve's three-tier fallback queries
-- use, in the order it tries them (strategy+leg_count+direction+tag, then
-- leg_count+direction+tag, then tag alone) — this one composite index
-- covers all three since Postgres can use a leading-column subset of it.
create index if not exists position_management_kb_filter_idx
  on public.position_management_kb (situation_tag, leg_count, direction, strategy);

alter table public.position_management_kb enable row level security;

create policy "position_management_kb_select_all"
  on public.position_management_kb
  for select
  using (true);

-- No insert/update/delete policy for anon or authenticated roles — only the
-- service role (used by the one-time import script, see
-- scripts/import-kb-to-supabase.mjs) can write, and the service role
-- bypasses RLS by design.
