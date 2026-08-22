import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Ports the 4 functions from data_fetcher.py that qqq_data_fetcher.py's
// fetch_market_context() actually calls — fear/greed index, macro
// indicators, economic calendar, and market news. The other 8 functions in
// the original data_fetcher.py (analyst ratings, insider transactions,
// earnings calendar, etc.) are unused by the daily strategy pipeline and
// were deliberately left out per the integration scope discussion, though
// nothing here blocks adding them later as their own functions.
//
// One deliberate deviation from the Python original: fetch_macro_data()
// pulls 5 days of daily bars via yfinance and diffs the last two closes.
// This port instead reuses the same Yahoo Finance chart-endpoint call the
// existing stock-quote function already makes (regularMarketPrice vs.
// chartPreviousClose) — same "today vs. yesterday" percentage change,
// consistent with how the rest of this app already talks to Yahoo, instead
// of introducing a second, different way to ask Yahoo for a daily change.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") ?? "";

// None of the external sources this function talks to (Yahoo, CNN,
// Finnhub, 6 different RSS feeds) are guaranteed to respond quickly, and
// plain fetch() in Deno has no default timeout — one slow or hanging
// source would otherwise stall the entire request indefinitely, since
// everything below is gathered with Promise.all. Every fetch in this file
// goes through this wrapper instead of calling fetch() directly.
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────
// 1. Fear & greed index (CNN, with a VIX-based fallback)
// ─────────────────────────────────────────

interface FearGreed {
  score: number | null;
  rating: string;
  prevClose: number | null;
  trend: string;
  source?: string;
  note?: string;
}

const RATING_CN: Record<string, string> = {
  "Extreme Fear": "极度恐惧",
  "Fear": "恐惧",
  "Neutral": "中性",
  "Greed": "贪婪",
  "Extreme Greed": "极度贪婪",
};

async function fetchYahooQuote(symbol: string): Promise<{ price: number; previousClose: number } | null> {
  try {
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const resp = await fetchWithTimeout(yahooUrl, { headers: { "User-Agent": UA } }, 8000);
    if (!resp.ok) return null;
    const data = await resp.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice ?? 0;
    const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? 0;
    if (!price || !previousClose) return null;
    return { price, previousClose };
  } catch {
    return null;
  }
}

async function fetchFearGreedIndex(): Promise<FearGreed> {
  try {
    const resp = await fetchWithTimeout(
      "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
      {
        headers: {
          "User-Agent": UA,
          "Accept": "application/json",
          "Accept-Language": "en-US,en;q=0.5",
          "Referer": "https://edition.cnn.com/markets/fear-and-greed",
          "Origin": "https://edition.cnn.com",
        },
      },
      8000,
    );
    if (resp.ok) {
      const data = await resp.json();
      const fg = data?.fear_and_greed;
      if (fg) {
        const score = fg.score ?? 0;
        const prev = fg.previous_close ?? score;
        const ratingCn = RATING_CN[fg.rating] ?? fg.rating ?? "未知";
        return {
          score: round(score, 1),
          rating: ratingCn,
          prevClose: round(prev, 1),
          trend: score > prev ? "上升" : "下降",
          source: "cnn",
        };
      }
    }
  } catch {
    // fall through to VIX estimate
  }

  // CNN's endpoint is undocumented and more likely to reject non-browser
  // traffic from a server than from someone's own machine — this fallback
  // is expected to be the common path once this runs from Supabase, not
  // the exception. See the AI-strategy integration notes.
  try {
    const vix = await fetchYahooQuote("^VIX");
    if (vix) {
      const v = vix.price;
      let score: number, rating: string;
      if (v < 13) { score = 80; rating = "极度贪婪"; }
      else if (v < 16) { score = 65; rating = "贪婪"; }
      else if (v < 20) { score = 50; rating = "中性"; }
      else if (v < 25) { score = 35; rating = "恐惧"; }
      else { score = 20; rating = "极度恐惧"; }
      return {
        score, rating, prevClose: null, trend: "未知",
        source: "vix_estimate", note: `基于VIX ${v.toFixed(1)}估算`,
      };
    }
  } catch {
    // fall through to unknown
  }

  return { score: null, rating: "未知", prevClose: null, trend: "未知" };
}

// ─────────────────────────────────────────
// 2. Macro indicators
// ─────────────────────────────────────────

const MACRO_SYMBOLS: Record<string, string> = {
  "^VIX": "vix",
  "^TNX": "treasury10y",
  "^TYX": "treasury30y",
  "DX-Y.NYB": "dxy",
  "^GSPC": "sp500",
  "^NDX": "nasdaq100",
  "GC=F": "gold",
  "CL=F": "oil",
};

async function fetchMacroData(): Promise<Record<string, { value: number; change: number; trend: string }>> {
  const macro: Record<string, { value: number; change: number; trend: string }> = {};
  const entries = Object.entries(MACRO_SYMBOLS);
  const results = await Promise.all(entries.map(([symbol]) => fetchYahooQuote(symbol)));
  entries.forEach(([, key], i) => {
    const q = results[i];
    if (!q) return;
    const chg = ((q.price - q.previousClose) / q.previousClose) * 100;
    macro[key] = { value: round(q.price, 2), change: round(chg, 2), trend: chg > 0 ? "up" : "down" };
  });
  return macro;
}

// ─────────────────────────────────────────
// 3. Economic calendar (Finnhub, US high/medium impact, next 7 days)
// ─────────────────────────────────────────

interface EconomicEvent {
  date: string;
  event: string;
  impact: string;
  country: string;
  estimate: string;
  prev: string;
}

async function fetchEconomicCalendar(): Promise<{ events: EconomicEvent[]; debug: string }> {
  if (!FINNHUB_KEY) return { events: [], debug: "no FINNHUB_API_KEY set" };
  try {
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const resp = await fetchWithTimeout(
      `https://finnhub.io/api/v1/calendar/economic?from=${today}&to=${future}`,
      { headers: { "X-Finnhub-Token": FINNHUB_KEY } },
      8000,
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return { events: [], debug: `HTTP ${resp.status}: ${body.slice(0, 200)}` };
    }
    const data = await resp.json();
    const rawCount = Array.isArray(data?.economicCalendar) ? data.economicCalendar.length : -1;
    const events: EconomicEvent[] = (data?.economicCalendar ?? [])
      .filter((e: any) => ["high", "medium"].includes(e.impact) && e.country === "US")
      .map((e: any) => ({
        date: e.time ?? "",
        event: e.event ?? "",
        impact: e.impact ?? "",
        country: e.country ?? "",
        estimate: e.estimate ?? "",
        prev: e.prev ?? "",
      }));
    return {
      events: events.slice(0, 8),
      debug: `raw events from Finnhub: ${rawCount}, after US high/medium filter: ${events.length}`,
    };
  } catch (err) {
    return { events: [], debug: `exception: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─────────────────────────────────────────
// 4. Market news (Finnhub categories + RSS + per-ticker Finnhub news)
// ─────────────────────────────────────────

interface NewsItem {
  type: string;
  source: string;
  headline: string;
  summary: string;
  published: string;
}

const RSS_SOURCES: [string, string][] = [
  ["https://feeds.marketwatch.com/marketwatch/topstories/", "MarketWatch"],
  ["https://seekingalpha.com/market_currents.xml", "SeekingAlpha"],
  ["https://finance.yahoo.com/news/rssindex", "YahooFinance"],
  ["https://www.investing.com/rss/news_25.rss", "Investing.com"],
  ["https://www.thestreet.com/rss/main.xml", "TheStreet"],
  ["https://www.barrons.com/xml/rss/3_7514.xml", "Barrons"],
];

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

function formatTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Deno has no built-in XML parser; rather than pull in an external
// dependency for a handful of well-formed RSS feeds, this is a tolerant
// regex extractor — the same fallback strategy data_fetcher.py itself uses
// when its ElementTree parse fails, just promoted to the only method here.
function parseRssItems(xml: string): { title: string; description: string; pubDate: string }[] {
  const items: { title: string; description: string; pubDate: string }[] = [];
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const block of itemBlocks) {
    const title = extractTag(block, "title");
    const description = extractTag(block, "description");
    const pubDate = extractTag(block, "pubDate");
    if (title) items.push({ title, description, pubDate });
  }
  return items;
}

function extractTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").trim();
}

async function fetchMarketNews(keyTickers: string[]): Promise<{ items: NewsItem[]; rssDebug: Record<string, string> }> {
  const newsItems: NewsItem[] = [];
  const seen = new Set<string>();
  const cutoff = Date.now() - 48 * 3600 * 1000;
  const rssDebug: Record<string, string> = {};

  const addIfNew = (item: NewsItem) => {
    const key = item.headline.slice(0, 40);
    if (item.headline.length > 20 && !seen.has(key)) {
      seen.add(key);
      newsItems.push(item);
    }
  };

  // Finnhub general/technology/forex/merger categories
  if (FINNHUB_KEY) {
    const categories = ["general", "technology", "forex", "merger"];
    await Promise.all(categories.map(async (category) => {
      try {
        const resp = await fetchWithTimeout(
          `https://finnhub.io/api/v1/news?category=${category}`,
          { headers: { "X-Finnhub-Token": FINNHUB_KEY } },
          8000,
        );
        if (!resp.ok) return;
        const data = await resp.json();
        for (const item of (data ?? []).slice(0, 10)) {
          const pubTime = item.datetime ? item.datetime * 1000 : 0;
          if (pubTime && pubTime < cutoff) continue;
          addIfNew({
            type: "finnhub",
            source: item.source ?? "",
            headline: item.headline ?? "",
            summary: (item.summary ?? "").slice(0, 150),
            published: pubTime ? formatTime(new Date(pubTime)) : "",
          });
        }
      } catch {
        // skip this category on failure, matching the Python script's bare except
      }
    }));
  }

  // RSS sources — each one records exactly what happened (network failure,
  // non-2xx status, zero <item> blocks found, or items found but all
  // filtered out) instead of silently swallowing the outcome, since "all 6
  // RSS sources returned nothing" needs to be diagnosable rather than just
  // visible as an empty result.
  await Promise.all(RSS_SOURCES.map(async ([url, sourceName]) => {
    try {
      const resp = await fetchWithTimeout(url, { headers: { "User-Agent": UA } }, 8000);
      if (!resp.ok) {
        rssDebug[sourceName] = `HTTP ${resp.status}`;
        return;
      }
      const xml = await resp.text();
      const rawItems = parseRssItems(xml);
      if (rawItems.length === 0) {
        rssDebug[sourceName] = `fetched ${xml.length} bytes but found 0 <item> blocks`;
        return;
      }
      const items = rawItems.slice(0, 8);
      let kept = 0;
      for (const item of items) {
        let publishedStr = "";
        if (item.pubDate) {
          const d = new Date(item.pubDate);
          if (!isNaN(d.getTime())) {
            if (d.getTime() < cutoff) continue;
            publishedStr = formatTime(d);
          }
        }
        if (item.title.length > 15) {
          addIfNew({
            type: "rss",
            source: sourceName,
            headline: item.title,
            summary: stripHtml(item.description).slice(0, 150),
            published: publishedStr,
          });
          kept++;
        }
      }
      rssDebug[sourceName] = `parsed ${rawItems.length} items, kept ${kept} after date/length filters`;
    } catch (err) {
      rssDebug[sourceName] = `exception: ${err instanceof Error ? err.message : String(err)}`;
    }
  }));

  // Per-ticker Finnhub company news (today + yesterday only)
  if (FINNHUB_KEY && keyTickers.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await Promise.all(keyTickers.slice(0, 12).map(async (ticker) => {
      try {
        const resp = await fetchWithTimeout(
          `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(ticker)}&from=${yesterday}&to=${today}`,
          { headers: { "X-Finnhub-Token": FINNHUB_KEY } },
          8000,
        );
        if (!resp.ok) return;
        const data = await resp.json();
        for (const item of (data ?? []).slice(0, 2)) {
          const pubTime = item.datetime ? item.datetime * 1000 : 0;
          if (pubTime && pubTime < cutoff) continue;
          addIfNew({
            type: "stock",
            source: item.source ?? "",
            headline: item.headline ?? "",
            summary: (item.summary ?? "").slice(0, 150),
            published: pubTime ? formatTime(new Date(pubTime)) : "",
          });
        }
      } catch {
        // skip this ticker on failure
      }
    }));
  }

  return { items: newsItems, rssDebug };
}

// ─────────────────────────────────────────

function round(v: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    // Matches data_fetcher.py's key_tickers usage: news pulls in a few
    // extra per-ticker headlines for whichever symbols the caller cares
    // about (QQQ/TQQQ/NDX for the daily strategy pipeline).
    const tickersParam = url.searchParams.get("tickers");
    const keyTickers = tickersParam ? tickersParam.split(",").map((t) => t.trim()).filter(Boolean) : ["QQQ", "TQQQ", "NDX"];

    // Diagnostics (which RSS sources succeeded, why economic calendar
    // came back empty, etc.) are opt-in via ?debug=true rather than always
    // in the response — useful while chasing down an issue, noise once a
    // source's behavior is understood and stable.
    const debugMode = url.searchParams.get("debug") === "true";

    const [fearGreed, macro, calendarResult, newsResult] = await Promise.all([
      fetchFearGreedIndex(),
      fetchMacroData(),
      fetchEconomicCalendar(),
      fetchMarketNews(keyTickers),
    ]);

    const body: Record<string, unknown> = {
      fearGreed,
      macro,
      economicCalendar: calendarResult.events,
      news: newsResult.items.slice(0, 15),
    };
    if (debugMode) {
      body.debug = {
        economicCalendar: calendarResult.debug,
        rssSources: newsResult.rssDebug,
      };
    }

    return new Response(
      JSON.stringify(body),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});