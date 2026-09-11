// supabase/functions/kb-retrieve/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Backs the "持仓处置建议" buttons in 对比模式 (TrackedComboSection.tsx) and
// 模拟账户 (SimulatorPage.tsx) — see claude/retrieval-feature-design.md for
// the full design. Given a structured description of the current position
// (strategy name if matched, leg count, direction, and the situation_tag
// the frontend already computed from its own DTE/breakeven/P&L-zone
// signals — see src/lib/kbQuery.ts), returns the closest-matching records
// from position_management_kb.
//
// Deliberately three-tier EXACT-MATCH filtering, no embedding/similarity
// ranking (see the migration's comment and the design doc for why — the KB
// is sized so each exact combination already has only a handful of
// records):
//   1. strategy + leg_count + direction + situation_tag
//   2. leg_count + direction + situation_tag (strategy omitted or tier 1 empty)
//   3. situation_tag alone (tier 2 still empty — should be rare; the KB
//      covers all 4 target tags across every strategy)
// The frontend is told which tier actually matched (`matchLevel`) so it can
// show "this isn't an exact structural match" instead of pretending it is.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const VALID_TAGS = new Set(["near_expiry", "pin_risk", "take_profit_target", "stop_loss_trigger"]);
const VALID_DIRECTIONS = new Set(["bullish", "bearish", "neutral"]);
const RESULT_LIMIT = 5;

const SELECT_COLUMNS =
  "id, source, strategy, leg_count, direction, situation_tag, label, question, answer, action, reasoning, risk_factors";
// market_environment/entry_state/current_state deliberately excluded — those
// are the generation-time scene-setting text for the KB's own authoring
// process, not content meant to be shown to app users (see the design doc's
// "结果展示粒度" decision).

function getSupabaseClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, serviceKey);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const legCountRaw = url.searchParams.get("legCount");
    const direction = url.searchParams.get("direction") ?? "";
    const tag = url.searchParams.get("tag") ?? "";
    const strategy = url.searchParams.get("strategy"); // optional — null when the live position didn't match a known KB strategy name

    const legCount = legCountRaw !== null ? parseInt(legCountRaw, 10) : NaN;
    if (!Number.isFinite(legCount) || legCount <= 0) {
      return json({ error: `Invalid legCount: ${legCountRaw}` }, 400);
    }
    if (!VALID_DIRECTIONS.has(direction)) {
      return json({ error: `Invalid direction: ${direction}` }, 400);
    }
    if (!VALID_TAGS.has(tag)) {
      return json({ error: `Invalid tag: ${tag}` }, 400);
    }

    const supabase = getSupabaseClient();

    if (strategy) {
      const { data, error } = await supabase
        .from("position_management_kb")
        .select(SELECT_COLUMNS)
        .eq("strategy", strategy)
        .eq("leg_count", legCount)
        .eq("direction", direction)
        .eq("situation_tag", tag)
        .limit(RESULT_LIMIT);
      if (error) throw error;
      if (data && data.length > 0) {
        return json({ records: data, matchLevel: "strategy" });
      }
    }

    {
      const { data, error } = await supabase
        .from("position_management_kb")
        .select(SELECT_COLUMNS)
        .eq("leg_count", legCount)
        .eq("direction", direction)
        .eq("situation_tag", tag)
        .limit(RESULT_LIMIT);
      if (error) throw error;
      if (data && data.length > 0) {
        return json({ records: data, matchLevel: "leg_direction" });
      }
    }

    {
      const { data, error } = await supabase
        .from("position_management_kb")
        .select(SELECT_COLUMNS)
        .eq("situation_tag", tag)
        .limit(RESULT_LIMIT);
      if (error) throw error;
      return json({ records: data ?? [], matchLevel: data && data.length > 0 ? "tag_only" : "none" });
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});