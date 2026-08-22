import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { computeIndicators, type OhlcvRow } from "../_shared/technicalIndicators.ts";
import { impliedVol } from "../_shared/deltaMatch.ts";
import { buildPrompt, type PromptMode } from "../_shared/buildPrompt.ts";

// AI strategy pipeline: fetches real QQQ data, builds the real prompt, and
// calls all four models (Claude, GPT-4o, Grok, Gemini) in parallel. TQQQ
// delta-matching, database storage, and Cron scheduling are still not in
// this version — see the integration plan.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const RATE = 0.05;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 210 daily bars via the same Yahoo chart endpoint stock-quote already
// uses (no cookie/crumb needed for this one — that's only required for the
// options endpoint, per option-chain's own comments).
async function fetchOhlcv(symbol: string, days: number): Promise<OhlcvRow[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
  const resp = await fetchWithTimeout(url, { headers: { "User-Agent": UA } }, 10000);
  if (!resp.ok) throw new Error(`Yahoo chart returned ${resp.status} for ${symbol}`);
  const data = await resp.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${symbol}`);

  const timestamps: number[] = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const rows: OhlcvRow[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    const volume = quote.volume?.[i];
    if ([open, high, low, close, volume].some((v) => v === null || v === undefined)) continue;
    rows.push({
      date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      open: round(open, 2), high: round(high, 2), low: round(low, 2), close: round(close, 2),
      volume: Math.round(volume),
    });
  }
  return rows.slice(-days);
}

function round(v: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

interface OptionChainResponse {
  usedExpiryDate: string;
  calls: { strike: number; bid: number; ask: number; lastPrice: number }[];
}

async function fetchOptionChain(symbol: string, targetDateISO: string): Promise<OptionChainResponse> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const url = `${supabaseUrl}/functions/v1/option-chain?symbol=${encodeURIComponent(symbol)}&date=${targetDateISO}`;
  const resp = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${anonKey}` } }, 15000);
  if (!resp.ok) throw new Error(`option-chain returned ${resp.status}`);
  return await resp.json();
}

interface MarketContext {
  fearGreed: { score: number | null; rating: string };
  macro: Record<string, { value: number; change: number }>;
  news: { headline: string }[];
}

async function fetchMarketContext(): Promise<MarketContext> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const url = `${supabaseUrl}/functions/v1/market-context`;
  const resp = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${anonKey}` } }, 20000);
  if (!resp.ok) throw new Error(`market-context returned ${resp.status}`);
  return await resp.json();
}

async function callClaude(prompt: string, mode: PromptMode): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return "❌ Claude失败: ANTHROPIC_API_KEY未配置";
  try {
    const maxTokens = mode === "1" ? 800 : 3000;
    const resp = await fetchWithTimeout(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        }),
      },
      100000,
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return `❌ Claude失败: HTTP ${resp.status} ${body.slice(0, 300)}`;
    }
    const data = await resp.json();
    const text = data?.content?.[0]?.text;
    return typeof text === "string" ? text.trim() : "❌ Claude失败: 返回格式异常";
  } catch (err) {
    return `❌ Claude失败: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// GPT-4o, Grok, and Gemini are all called through this one function because
// all three are OpenAI-SDK-compatible in daily_strategy.py — same request/
// response shape, just a different base_url/api_key/model. Matches the
// Python original's behavior of treating a missing key as "this model is
// unavailable" rather than a hard failure (Grok/Gemini are optional there
// too — see xai_key/gemini_key being allowed to be None).
interface OpenAICompatibleOpts {
  label: string;
  envKey: string;
  baseUrl: string; // no trailing slash
  model: string;
  maxTokensConcise: number;
  maxTokensDetailed: number;
}

async function callOpenAICompatible(prompt: string, mode: PromptMode, opts: OpenAICompatibleOpts): Promise<string> {
  const apiKey = Deno.env.get(opts.envKey);
  if (!apiKey) return `❌ ${opts.label}失败: ${opts.envKey}未配置`;
  try {
    const maxTokens = mode === "1" ? opts.maxTokensConcise : opts.maxTokensDetailed;
    const resp = await fetchWithTimeout(
      `${opts.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        }),
      },
      100000,
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return `❌ ${opts.label}失败: HTTP ${resp.status} ${body.slice(0, 300)}`;
    }
    const raw = await resp.text();
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      return `❌ ${opts.label}失败: 返回内容不是合法JSON: ${raw.slice(0, 300)}`;
    }
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      // Structure mismatch — surface the actual shape instead of a generic
      // message, since this provider's response didn't match the OpenAI
      // Chat Completions shape we assumed.
      return `❌ ${opts.label}失败: 返回格式异常，原始内容: ${raw.slice(0, 500)}`;
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      // The call succeeded (2xx) but the model produced no text — this
      // used to pass through silently as an "empty but not failed" result,
      // which just looked like a blank tab with no explanation. Surfacing
      // the full response here shows why (safety filter, finish_reason,
      // etc.) instead of leaving it unexplained.
      return `❌ ${opts.label}失败: 返回内容为空。完整响应: ${raw.slice(0, 500)}`;
    }
    return trimmed;
  } catch (err) {
    return `❌ ${opts.label}失败: ${err instanceof Error ? err.message : String(err)}`;
  }
}

const GPT4O_OPTS: OpenAICompatibleOpts = {
  label: "GPT-4o", envKey: "OPENAI_API_KEY", baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o", maxTokensConcise: 800, maxTokensDetailed: 3000,
};
const GROK_OPTS: OpenAICompatibleOpts = {
  label: "Grok", envKey: "XAI_API_KEY", baseUrl: "https://api.x.ai/v1",
  model: "grok-4.3", maxTokensConcise: 800, maxTokensDetailed: 3000,
};
const GEMINI_OPTS: OpenAICompatibleOpts = {
  label: "Gemini", envKey: "GEMINI_API_KEY", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  model: "gemini-3.1-flash-lite", maxTokensConcise: 2000, maxTokensDetailed: 4000,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const mode = (url.searchParams.get("mode") === "1" ? "1" : "2") as PromptMode;
    const includePrompt = url.searchParams.get("includePrompt") === "true";

    // 1. Price history + indicators
    const ohlcv = await fetchOhlcv("QQQ", 210);
    if (ohlcv.length < 60) throw new Error("Insufficient QQQ price history returned by Yahoo");
    const indicators = computeIndicators(ohlcv);
    if (!indicators) throw new Error("computeIndicators returned null despite having enough rows");
    const currentPrice = indicators.currentPrice;

    // 2. Option chain — target ~30 days out, then back-solve ATM implied vol
    const targetExpiry = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const chain = await fetchOptionChain("QQQ", targetExpiry);
    const dte = Math.max(1, Math.round((new Date(chain.usedExpiryDate).getTime() - Date.now()) / 86400000));
    let atmIv: number | null = null;
    if (chain.calls.length > 0) {
      const atmCall = chain.calls.reduce((best, c) =>
        Math.abs(c.strike - currentPrice) < Math.abs(best.strike - currentPrice) ? c : best
      , chain.calls[0]);
      const premium = atmCall.bid > 0 && atmCall.ask > 0 ? (atmCall.bid + atmCall.ask) / 2 : atmCall.lastPrice;
      if (premium > 0) atmIv = impliedVol(currentPrice, atmCall.strike, dte, premium, "call");
    }

    // 3. Market context (fear/greed, macro, news)
    const market = await fetchMarketContext();

    // 4. Build the prompt
    const prompt = buildPrompt({
      ticker: "QQQ",
      currentPrice,
      date: new Date().toISOString().slice(0, 10),
      ohlcv: ohlcv.slice(-180),
      indicators,
      options: { expDate: chain.usedExpiryDate, daysToExp: dte, atmIv },
      macro: {
        vix: market.macro?.vix,
        treasury10y: market.macro?.treasury10y,
        sp500: market.macro?.sp500,
      },
      fearGreed: market.fearGreed,
      news: market.news,
      mode,
    });

    // 5. Call all four models in parallel — same "missing key = unavailable,
    // not a hard failure" behavior as daily_strategy.py.
    const [claudeResult, gpt4oResult, grokResult, geminiResult] = await Promise.all([
      callClaude(prompt, mode),
      callOpenAICompatible(prompt, mode, GPT4O_OPTS),
      callOpenAICompatible(prompt, mode, GROK_OPTS),
      callOpenAICompatible(prompt, mode, GEMINI_OPTS),
    ]);

    const body: Record<string, unknown> = {
      ticker: "QQQ",
      currentPrice,
      generatedAt: new Date().toISOString(),
      claude: claudeResult,
      gpt4o: gpt4oResult,
      grok: grokResult,
      gemini: geminiResult,
    };
    if (includePrompt) body.prompt = prompt;

    return new Response(JSON.stringify(body), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});