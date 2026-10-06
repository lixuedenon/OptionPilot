-- supabase/migrations/20261006180000_create_price_history_cache.sql
-- 每日收盘价的共享缓存（第2组：万次推演"这只股票历史上的真实走法"要拉1～10年的日线）。
-- historical-prices函数先查这张表，新鲜就直接返回，不新鲜才去Yahoo拉、拉完写回来——所有用户共用一份，
-- 同一个代码同一个区间6小时内只打一次Yahoo（新鲜度在函数里判断；日线只有最后一根在变，推演和历史波动率用不着更新）。
-- 行情数据，不是用户数据：公开只读，只有Edge Function（service role）写。
create table if not exists public.price_history_cache (
  symbol text not null,
  range text not null,          -- 2mo / 6mo / 1y / 2y / 5y / 10y …
  data jsonb not null,          -- historical-prices的返回体（closes/opens/timestamps）
  fetched_at timestamptz not null default now(),
  primary key (symbol, range)
);

create index if not exists price_history_cache_fetched_at_idx on public.price_history_cache (fetched_at);

alter table public.price_history_cache enable row level security;

drop policy if exists "price_history_cache_select_all" on public.price_history_cache;
create policy "price_history_cache_select_all" on public.price_history_cache for select using (true);
