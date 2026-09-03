// src/lib/earningsClosing.ts
import type { SimPosition } from "./simAccount";
import { EARNINGS_GROUPS, type EarningsGroup } from "./earningsStrategy";

// ── Recognizing an earnings-batch position ──
// EarningsIvCrashTab tags each of the 3 groups it opens with a note of
// the form "earnings-iv-crash:{group}:{batchId}" (see its handleConfirmOpen)
// — this is the only place that format is written, and this is the only
// place it's read back. A position with no note, or a note that doesn't
// match this exact prefix, is just an ordinary position and is left alone
// by everything in this file.
export interface ParsedEarningsNote {
  group: EarningsGroup;
  batchId: string;
}

export function parseEarningsNote(note: string | undefined): ParsedEarningsNote | null {
  if (!note || !note.startsWith("earnings-iv-crash:")) return null;
  const rest = note.slice("earnings-iv-crash:".length);
  const sepIdx = rest.indexOf(":");
  if (sepIdx < 0) return null;
  const group = rest.slice(0, sepIdx);
  const batchId = rest.slice(sepIdx + 1);
  if (group !== "near" && group !== "mid" && group !== "far") return null;
  if (!batchId) return null;
  return { group, batchId };
}

export interface EarningsBatch {
  batchId: string;
  symbol: string;
  openingSpot: number; // shared across all 3 groups — they're opened together at the same pre-earnings close
  positions: Partial<Record<EarningsGroup, SimPosition>>;
}

// Groups OPEN positions back into their original 3-group batches. A batch
// missing one or two groups (because the person already closed them) is
// still returned with whichever groups remain — the UI decides what a
// partial batch means, this function just reports what's actually there.
export function groupEarningsPositions(positions: SimPosition[]): EarningsBatch[] {
  const batches = new Map<string, EarningsBatch>();
  for (const p of positions) {
    if (p.status !== "open") continue;
    const parsed = parseEarningsNote(p.note);
    if (!parsed) continue;
    if (!batches.has(parsed.batchId)) {
      batches.set(parsed.batchId, { batchId: parsed.batchId, symbol: p.symbol, openingSpot: p.spot, positions: {} });
    }
    batches.get(parsed.batchId)!.positions[parsed.group] = p;
  }
  return [...batches.values()];
}

// ── Near group: time-based, not move-based ──
// The near group's closing rule from the design doc isn't "wait and see
// how far price moved" — it's "close protection immediately once the
// market opens post-earnings, close both ATM legs within 2 hours no
// matter what they're worth, unless there's a specific directional call."
// There's no branch logic to compute here; this just answers "is this
// still within — or already past — that 2-hour window," since that's the
// one piece of information the UI can't work out just by looking at the
// position's legs. Measured from the position's OWN openedAt rather than
// trying to detect "the market's open time following the earnings release"
// precisely (which would need real market-calendar data this app doesn't
// have) — an approximation flagged here rather than silently assumed.
const NEAR_GROUP_WINDOW_HOURS = 2;

export function nearGroupHoursElapsed(position: SimPosition): number {
  return (Date.now() - position.openedAt) / 3600000;
}

export function isNearGroupPastWindow(position: SimPosition): boolean {
  return nearGroupHoursElapsed(position) >= NEAR_GROUP_WINDOW_HOURS;
}

// ── Mid/far groups: the three-branch move-based guidance ──
export type MoveBranch = "small" | "medium" | "large";

export interface ClosingGuidance {
  branch: MoveBranch;
  movePct: number; // absolute value, e.g. 0.08 = 8%
  protectionPct: number; // this group's own protection width, for display
}

// Branch cutoffs: below 10% (the same bar used to screen INTO this
// strategy in the first place) is the "small move" branch; from 10% up to
// this group's own protection width is "medium"; at or past the
// protection width the loss is already capped, so it's "large" — see the
// design doc worked out in chat for why each branch gets different
// guidance (small: probably profitable already, offer an easy exit;
// medium: probably a small loss, needs a real trend judgment via Analysis
// Mode; large: loss is locked in, no urgency either way).
const SMALL_MOVE_CUTOFF = 0.10;

export function computeClosingGuidance(position: SimPosition, currentSpot: number, group: EarningsGroup): ClosingGuidance | null {
  if (group === "near") return null;
  const spec = EARNINGS_GROUPS.find((g) => g.group === group);
  if (!spec || position.spot <= 0) return null;

  const movePct = Math.abs(currentSpot - position.spot) / position.spot;
  const branch: MoveBranch = movePct < SMALL_MOVE_CUTOFF
    ? "small"
    : movePct < spec.protectionPct
    ? "medium"
    : "large";

  return { branch, movePct, protectionPct: spec.protectionPct };
}