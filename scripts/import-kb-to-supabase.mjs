// scripts/import-kb-to-supabase.mjs
//
// One-time (well, one-per-KB-update) import of the position-management-kb
// JSONL files into the position_management_kb Supabase table (see the
// 20260910161520_create_position_management_kb.sql migration and
// claude/retrieval-feature-design.md for the full design).
//
// Deliberately a plain script run by hand on your own machine, NOT part of
// the app's build/deploy or a Supabase Edge Function — the KB updates
// rarely (new batches added occasionally), so there's no reason for this to
// be always-on infra. Uses raw fetch() against Supabase's PostgREST API
// (no @supabase/supabase-js dependency added to package.json — the
// frontend doesn't use that client either, see src/lib/kbQuery.ts's
// comment on why the whole app calls Supabase via fetch + Edge Functions
// instead of the JS client).
//
// The KB source JSONL files live OUTSIDE this repo (per the standing rule:
// position-management-kb data must never be committed into OptionPilot) —
// point KB_DATA_DIR at wherever you keep them, e.g.
// ~/OptionPilot-private/kb/.
//
// Usage:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   KB_DATA_DIR=/absolute/path/to/kb-build \
//   node scripts/import-kb-to-supabase.mjs
//
// Re-running is safe: upserts on `id`, so re-importing after fixing a
// record or adding a new batch just updates/adds rows, doesn't duplicate.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KB_DATA_DIR = process.env.KB_DATA_DIR;

if (!SUPABASE_URL || !SERVICE_KEY || !KB_DATA_DIR) {
  console.error("Missing required env vars. Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, KB_DATA_DIR.");
  process.exit(1);
}

const REQUIRED_FIELDS = [
  "id", "source", "strategy", "leg_count", "direction", "situation_tag", "label",
  "market_environment", "entry_state", "current_state", "question", "answer",
  "action", "reasoning", "risk_factors",
];

function loadRecords(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  if (files.length === 0) {
    throw new Error(`No .jsonl files found in ${dir}`);
  }
  const records = [];
  const seenIds = new Set();
  for (const file of files) {
    const raw = readFileSync(join(dir, file), "utf-8");
    let lineNo = 0;
    for (const line of raw.split("\n")) {
      lineNo++;
      if (!line.trim()) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch (err) {
        throw new Error(`${file}:${lineNo} — invalid JSON: ${err.message}`);
      }
      for (const field of REQUIRED_FIELDS) {
        if (rec[field] === undefined || rec[field] === null || rec[field] === "") {
          throw new Error(`${file}:${lineNo} (id=${rec.id ?? "?"}) — missing/empty field "${field}"`);
        }
      }
      if (seenIds.has(rec.id)) {
        throw new Error(`Duplicate id "${rec.id}" (first seen elsewhere, also in ${file}:${lineNo})`);
      }
      seenIds.add(rec.id);
      records.push(rec);
    }
  }
  return records;
}

async function upsertBatch(records) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/position_management_kb`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Prefer": "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(records),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Upsert failed: HTTP ${resp.status} ${body.slice(0, 500)}`);
  }
}

async function main() {
  const records = loadRecords(KB_DATA_DIR);
  console.log(`Loaded ${records.length} records from ${KB_DATA_DIR}.`);

  const BATCH_SIZE = 100;
  let done = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    await upsertBatch(batch);
    done += batch.length;
    console.log(`Imported ${done}/${records.length}...`);
  }

  console.log(`Done. ${records.length} records imported into position_management_kb.`);
}

main().catch((err) => {
  console.error("Import failed:", err.message);
  process.exit(1);
});
