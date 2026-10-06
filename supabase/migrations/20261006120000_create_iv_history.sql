-- supabase/migrations/20261006120000_create_iv_history.sql
-- 每天收盘前自己记录一份隐含波动率和平值跨式价格（Yahoo只给"现在"的期权价，不给历史，只能从今天起自己攒）。
-- 用途：IV Rank / IV百分位（需要约一年）、IV历史图、财报"市场押多少"（跨式÷股价）的逐次历史。
-- 行情数据，不是用户数据：所有人共用一份，公开只读；只有record-iv这个Edge Function（service role）写。

-- 要记录哪些股票：先放一批最活跃的，用户查过期权链的代码会被option-chain函数自动加进来（source='user'）。
create table if not exists public.iv_watchlist (
  symbol text primary key,
  source text not null default 'seed',
  active boolean not null default true,
  added_at timestamptz not null default now()
);

-- 每个代码每个交易日一行（同一天重跑会覆盖）。dte都是日历天（带小数），iv都是小数（0.30=30%）。
create table if not exists public.iv_daily (
  symbol text not null,
  trade_date date not null,          -- 美东日期
  spot numeric not null,
  iv30 numeric,                      -- 插值成30天的平值IV（两边到期日按方差-时间插值，跟VIX同一种做法）
  e1 date, dte1 numeric, iv1 numeric, -- 30天以内最近的那个到期日（不足7天的不用）
  e2 date, dte2 numeric, iv2 numeric, -- 30天以外最近的那个到期日
  front_exp date, front_dte numeric, front_strike numeric, front_straddle numeric, -- 最近到期日的平值跨式
  earn_date date,                    -- 下一次财报日（Yahoo calendarEvents）
  earn_exp date, earn_dte numeric, earn_strike numeric, earn_straddle numeric, earn_iv numeric, -- 财报后第一个到期日的平值跨式和IV
  yahoo_iv1 numeric,                 -- Yahoo自带的impliedVolatility（e1平值），留作对照
  price_source text,                 -- mid=买卖中间价 / last=最后成交价（收盘后买卖价可能为0）
  quality text,                      -- regular=收盘前记录 / after_close=收盘后补记
  details jsonb,                     -- 每个到期日用到的行权价和价格，方便以后重算
  recorded_at timestamptz not null default now(),
  primary key (symbol, trade_date)
);

create index if not exists iv_daily_trade_date_idx on public.iv_daily (trade_date);

-- 每次运行的记录，方便看定时任务有没有正常跑
create table if not exists public.iv_record_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  shard int,
  shards int,
  ok int not null default 0,
  failed int not null default 0,
  skipped text,
  errors jsonb
);

alter table public.iv_watchlist enable row level security;
alter table public.iv_daily enable row level security;
alter table public.iv_record_runs enable row level security;

drop policy if exists "iv_watchlist_select_all" on public.iv_watchlist;
create policy "iv_watchlist_select_all" on public.iv_watchlist for select using (true);
drop policy if exists "iv_daily_select_all" on public.iv_daily;
create policy "iv_daily_select_all" on public.iv_daily for select using (true);
-- iv_record_runs：不开放给前端，只用service role或在后台SQL里看

insert into public.iv_watchlist (symbol) values
  ('SPY'),('QQQ'),('IWM'),('DIA'),('TLT'),('GLD'),('SLV'),('USO'),('XLF'),('XLE'),('XLK'),('XLV'),('SMH'),('ARKK'),('EEM'),('FXI'),('HYG'),('KRE'),('XBI'),('GDX'),
  ('AAPL'),('MSFT'),('NVDA'),('AMZN'),('GOOGL'),('META'),('TSLA'),('AVGO'),('AMD'),('NFLX'),('ORCL'),('CRM'),('ADBE'),('INTC'),('QCOM'),('MU'),('TXN'),('IBM'),('CSCO'),('UBER'),
  ('SHOP'),('PYPL'),('COIN'),('PLTR'),('SNOW'),('CRWD'),('PANW'),('NOW'),('ABNB'),('ROKU'),('DIS'),('NKE'),('SBUX'),('MCD'),('WMT'),('COST'),('TGT'),('HD'),('LOW'),('LULU'),
  ('JPM'),('BAC'),('C'),('WFC'),('GS'),('MS'),('V'),('MA'),('AXP'),('BA'),('CAT'),('DE'),('GE'),('LMT'),('RTX'),('XOM'),('CVX'),('OXY'),('COP'),('SLB'),
  ('PFE'),('MRK'),('JNJ'),('LLY'),('ABBV'),('UNH'),('CVS'),('MRNA'),('BMY'),('KO'),('PEP'),('PG'),('T'),('VZ'),('F'),('GM'),('RIVN'),('NIO'),('BABA'),('PDD'),
  ('JD'),('MARA'),('SOFI'),('HOOD'),('DKNG'),('ARM'),('SMCI'),('DELL'),('MSTR'),('TSM')
on conflict (symbol) do nothing;
