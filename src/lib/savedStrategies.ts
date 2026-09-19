// src/lib/savedStrategies.ts
import type { Leg, Shifts } from "./types";
import { formatDateInput, parseDateInput, daysBetweenLocalDates, todayISO, calendarDaysSince, calendarDaysBetween } from "./dateUtils";
import { fetchHistoricalBars, repriceLegsAtDate } from "./historicalBackfill";

export interface TrackedSnapshot {
  id: string;
  legs: Leg[];
  spot: number;
  savedAt: number;
  // true when this entry was reconstructed by backfillTrackedSnapshots()
  // from a historical daily (open+close)/2 average plus theoretical
  // Black-Scholes repricing, rather than a real market refresh the person
  // actually did (addTrackedSnapshot(), via "保存追踪快照"). Same convention
  // as the Simulator's PositionSnapshot.estimated — see historicalBackfill.ts.
  estimated?: boolean;
}

export interface SavedStrategy {
  id: string;
  filename: string;
  symbol: string;
  spot: number;
  legs: Leg[];
  shifts: Shifts;
  createdAt: number;
  openingAt?: number;
  // 2026-09-14新增，修复"到期日二次衰减"bug（CLAUDE.md"六、24"）。`legs[].dte`
  // 不是固定值，而是"以某个时间点为基准算出的剩余天数"——每次打开/跟踪都会
  // 用 calendarDaysSince(基准时间) 重新衰减一次。这个基准时间以前错误地复用
  // 了`openingAt`（真正的开仓日期，只应该用于"已过X天"这类展示，从不改
  // 变），导致每存一次就把已经衰减过的legs，用同一个从未推进的openingAt再
  // 衰减一遍，多存几次到期日就越显示越早。`legsAsOf`是"这份legs的dte是以
  // 哪个时刻为基准算出的"，每次真正保存（新建或覆盖）都盖成Date.now()，
  // 跟openingAt彻底解耦。所有对`legs`做衰减的调用点都应该用
  // `legsAsOf ?? openingAt ?? createdAt`；只有"已过X天"这类回答"这个仓位
  // 真正开了多久"的展示，才继续只用`openingAt ?? createdAt`。`??`兜底链让
  // 没有这个新字段的旧记录行为不变（退化成旧的、有bug但至少一致的行为，
  // 而不是报错）。
  legsAsOf?: number;
  starred?: boolean;
  tracking?: boolean;
  trackedSnapshots?: TrackedSnapshot[];
}

// 2026-09-15新增。分析模式是一个"从第0天(保存那一刻)到最后一天(到期)"的纯
// 模拟沙盒，跟真实"今天"原则上无关（今天只是轴上的一个参考点，不该收窄可
// 探索范围）——见xue的说明和CLAUDE.md"四、1.4"（若已写入）。这个结构把
// "第0天"那一刻的原始存档数据，跟"从第0天到现在真实过了几天/第0天当时总
// 共有多少天"这两个派生数字打包在一起，由`handleOpenStrategy`/
// `handleSaveStrategy`/`handleOverwriteStrategy`统一维护，供ΔT滑块把可探索
// 范围从"只剩几天"（today→到期）拓宽到"完整周期"（第0天→到期），以及
// 支持"精确回到第0天"（不走反推近似，直接用`legs`/`spot`这份原始快照）。
// 2026-09-15新增，同一天第三轮最终定案：daysSinceOpen/originalMaxDte按
// openingAt（真正开仓日期，标题栏显示、用户填写，不随每次覆盖保存变化）
// 算，不用legsAsOf（最近一次真正保存的时间，纯粹是legs.dte衰减基准的技术
// 记账，跟"数据代表哪天"这个语义无关）。
//
// 第二轮中间版本曾经把"第0天精确复现"点也挪去跟着legsAsOf走（理由是"legs
// 这份快照只保证准确到legsAsOf那一刻"）——xue用真实用例否决了这个想法：
// 一条策略完全可能是"今天(legsAsOf)才把9/1(openingAt)那天的真实开仓数据补
// 录进系统"，这种情况下legs/spot里的行权价/权利金本来就是当事人手动核实过
// 的、代表openingAt那天真实发生的事，跟legsAsOf是哪天完全无关（"就像日历
// 一样，无非是今天补打了个点"）。所以精确复现点固定钉在滑块最左边
// （=openingAt），不再有"legsAsOf不等于openingAt就不精确"这回事，也不需要
// mismatch提示。
//
// 但这里有个必须处理的技术细节：`legs`原始存储的`dte`，是"以legsAsOf为基
// 准"算出来的（LegRow编辑时dte永远是"到期日-今天"，而这个"今天"就是保存那
// 一刻，即legsAsOf）——如果legsAsOf比openingAt晚，直接把原始`dte`塞进"第0
// 天"那个点，得到的天数会比真实值小（比如本例：legsAsOf是今天，dte=31，但
// openingAt那天真实剩余应该是45天）。虽然priceCombo在shifts全零时是自洽的
// 反推-重算闭环，所以headline P&L不受这个dte误差影响（依然精确等于premium
// 差值=0）——但Greeks/breakevens/POP等派生指标会算错。所以构造这个快照时，
// 每条期权腿的dte要补上"openingAt到legsAsOf"这段真实天数差，还原成"以
// openingAt为基准"的dte，premium原样不动（这才是xue要的"精确值"）。
export interface OpeningSimBasis {
  legs: Leg[]; // 开仓那一刻(openingAt)的原始腿位快照：premium是原始存储值
               // （代表openingAt当天的真实数据），dte已经从legsAsOf基准修
               // 正回openingAt基准（见上面注释），不是`s.legs`的逐字节原样
  spot: number; // 开仓那一刻(openingAt)的现价
  daysSinceOpen: number; // 从真正开仓日期(openingAt)到"真实今天"，自然日经过
                          // 了几天——决定"今天"点在时间轴上的位置
  originalMaxDte: number; // 从真正开仓日期(openingAt)到到期日的完整周期天数
}

// 2026-09-17修复"情景估值≠权利金"的bug：这个函数以前只在
// handleOpenStrategy/handleSaveStrategy/handleOverwriteStrategy三个保存/加
// 载动作里被调用一次，结果存进useState，此后用户在分析模式里对legs做的任
// 何实时编辑（改权利金/行权价/数量/…）都不会再触发重算——App.tsx喂给图表
// 的analyticsLegs用的还是那份存档时的旧快照，导致"情景估值"跟用户刚编辑
// 的权利金对不上。
//
// 现在改成纯函数，由App.tsx在每次渲染时用useMemo基于当前实时的
// legs/spot/openingAt重新算一遍（legsAsOfTs直接传Date.now()——用户编辑
// leg.dte时，"到期日-今天"里的"今天"本来就是刚才这一刻，所以对实时数据来
// 说legsAsOf永远等于"现在"），而不是只在显式保存/加载那几个时间点才刷新。
// useStrategyOrchestration.ts里仍然直接调用这个函数，但只是为了在
// handleOpenStrategy等动作里检查"这条策略是否已过期"（expiredStrategyPrompt），
// 不再把结果存进App.tsx的state。
export function computeOpeningSimBasis(openTs: number, legsAsOfTs: number, legs: Leg[], spot: number): OpeningSimBasis {
  const daysSinceOpen = calendarDaysBetween(openTs, Date.now());
  const openToLegsAsOfGap = calendarDaysBetween(openTs, legsAsOfTs);
  const dayZeroLegs = openToLegsAsOfGap === 0
    ? legs
    : legs.map((l) => (l.kind === "stock" ? l : { ...l, dte: l.dte + openToLegsAsOfGap }));
  const storedMaxDte = legs.length > 0
    ? Math.max(...legs.filter((l) => l.kind !== "stock").map((l) => l.dte))
    : 0;
  // storedMaxDte是legs这份快照里的dte，本来就只保证准确到legsAsOfTs那一
  // 刻（"从legsAsOf到到期日"的天数）——加上"从openingAt到legsAsOf"这段间
  // 隔，才是"从真正开仓到到期日"的完整周期。
  const originalMaxDte = storedMaxDte + openToLegsAsOfGap;
  return { legs: dayZeroLegs, spot, daysSinceOpen, originalMaxDte };
}

const STORAGE_KEY = "optionpilot_saved_strategies";

function migrateLegacySnapshots(s: SavedStrategy): SavedStrategy {
  if (s.trackedSnapshots) return s;
  const legacyLegs = (s as unknown as { trackedLegs?: Leg[] }).trackedLegs;
  const legacyAt = (s as unknown as { trackedAt?: number }).trackedAt;
  if (legacyLegs && legacyLegs.length > 0) {
    return {
      ...s,
      trackedSnapshots: [{ id: `snap-${s.id}-legacy`, legs: legacyLegs, spot: s.spot, savedAt: legacyAt ?? s.createdAt }],
    };
  }
  return s;
}

function loadFromStorage(): SavedStrategy[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as SavedStrategy[];
    return arr.map(migrateLegacySnapshots);
  } catch {
    return [];
  }
}

function saveToStorage(strategies: SavedStrategy[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(strategies));
}

export async function loadSavedStrategies(): Promise<SavedStrategy[]> {
  return loadFromStorage();
}

export async function saveStrategy(s: Omit<SavedStrategy, "id" | "createdAt">): Promise<SavedStrategy[]> {
  const strategies = loadFromStorage();
  const newStrategy: SavedStrategy = {
    ...s,
    id: `strat-${Date.now()}`,
    createdAt: Date.now(),
    // legsAsOf is what makes `s.legs` correct next time it's loaded — see
    // the field's own doc comment. `s.legs` here (from the caller) is
    // always a freshly-decayed-to-today combo, so "now" is the right stamp.
    legsAsOf: Date.now(),
  };
  strategies.unshift(newStrategy);
  saveToStorage(strategies);
  return strategies;
}

export async function overwriteStrategy(id: string, s: Omit<SavedStrategy, "id" | "createdAt">): Promise<SavedStrategy[]> {
  const strategies = loadFromStorage();
  const idx = strategies.findIndex((st) => st.id === id);
  if (idx >= 0) {
    strategies[idx] = { ...strategies[idx], ...s, id, createdAt: strategies[idx].createdAt, legsAsOf: Date.now() };
    saveToStorage(strategies);
  }
  return strategies;
}

export async function deleteSavedStrategy(id: string): Promise<SavedStrategy[]> {
  const strategies = loadFromStorage().filter((s) => s.id !== id);
  saveToStorage(strategies);
  return strategies;
}

export async function renameSavedStrategy(id: string, filename: string): Promise<SavedStrategy[]> {
  const strategies = loadFromStorage();
  const idx = strategies.findIndex((s) => s.id === id);
  if (idx >= 0) {
    strategies[idx] = { ...strategies[idx], filename };
    saveToStorage(strategies);
  }
  return strategies;
}

export async function reorderSavedStrategies(all: SavedStrategy[]): Promise<SavedStrategy[]> {
  saveToStorage(all);
  return all;
}

export async function toggleStarStrategy(id: string): Promise<SavedStrategy[]> {
  const strategies = loadFromStorage();
  const idx = strategies.findIndex((s) => s.id === id);
  if (idx >= 0) {
    strategies[idx] = { ...strategies[idx], starred: !strategies[idx].starred };
    saveToStorage(strategies);
  }
  return strategies;
}

export async function addTrackedSnapshot(id: string, legs: Leg[], spot: number, savedAt: number): Promise<SavedStrategy[]> {
  const strategies = loadFromStorage();
  const idx = strategies.findIndex((s) => s.id === id);
  if (idx >= 0) {
    const snapshots = strategies[idx].trackedSnapshots ?? [];
    const snap: TrackedSnapshot = { id: `snap-${savedAt}-${Date.now()}`, legs, spot, savedAt };
    strategies[idx] = {
      ...strategies[idx],
      trackedSnapshots: [...snapshots, snap],
      tracking: true,
    };
    saveToStorage(strategies);
  }
  return strategies;
}

// Fills the gaps in a tracked strategy's snapshot history: for every
// historical trading day between when it was opened and today that has no
// snapshot yet (real or previously-backfilled) — because nobody had the app
// open in Compare Mode that day to save one — this reconstructs an
// estimated one from that day's (open+close)/2 average price instead of
// leaving the day blank. Real snapshots (from addTrackedSnapshot) always
// win: this never overwrites a day that already has ANY entry. Today itself
// is deliberately left for a live "保存追踪快照" to fill for real, not an
// estimate. Mirrors the Simulator's backfillSnapshots() (simAccount.ts) —
// same historicalBackfill.ts helpers, same flat-vol convention — just
// against SavedStrategy/TrackedSnapshot's shape instead of
// SimPosition/PositionSnapshot's. Called from App.tsx whenever a strategy
// is (re-)entered in Compare Mode (handleTrack / handleSwitchToCompare), so
// "今日组合" doesn't default to whatever was last manually refreshed, even
// if that was days or weeks ago.
export async function backfillTrackedSnapshots(id: string): Promise<SavedStrategy[]> {
  const strategies = loadFromStorage();
  const idx = strategies.findIndex((s) => s.id === id);
  if (idx < 0 || !strategies[idx].symbol) return strategies;

  const strategy = strategies[idx];
  const existing = strategy.trackedSnapshots ?? [];
  const existingDates = new Set(existing.map((snap) => formatDateInput(snap.savedAt)));
  // `strategy.legs` is only guaranteed accurate "as of" legsAsOf (when it
  // was last saved), not openingAt (when the position truly opened) — see
  // SavedStrategy.legsAsOf's doc comment. Backfilling from the wrong
  // baseline date would reprice using the wrong days-elapsed for every bar.
  const openedISO = formatDateInput(strategy.legsAsOf ?? strategy.openingAt ?? strategy.createdAt);
  const todayIso = todayISO();

  let bars;
  try {
    bars = await fetchHistoricalBars(strategy.symbol);
  } catch {
    // No historical data available (thinly-traded symbol, rate-limited,
    // etc.) — leave existing snapshots untouched rather than failing
    // whatever triggered this (entering Compare Mode should still work).
    return strategies;
  }

  const toAdd: TrackedSnapshot[] = [];
  for (const bar of bars) {
    if (bar.dateISO < openedISO) continue; // before this strategy existed
    if (bar.dateISO >= todayIso) continue; // today — a live save's job, not an estimate's
    if (existingDates.has(bar.dateISO)) continue; // already has a real or backfilled entry

    const daysElapsed = daysBetweenLocalDates(openedISO, bar.dateISO);
    const repriced = repriceLegsAtDate(strategy.legs, strategy.spot, bar.avgPrice, daysElapsed);
    toAdd.push({
      id: `snap-${bar.dateISO}-backfill`,
      legs: repriced,
      spot: bar.avgPrice,
      savedAt: parseDateInput(bar.dateISO) ?? Date.now(),
      estimated: true,
    });
  }

  if (toAdd.length === 0) return strategies;

  const merged = [...existing, ...toAdd].sort((a, b) => a.savedAt - b.savedAt);
  strategies[idx] = { ...strategy, trackedSnapshots: merged, tracking: true };
  saveToStorage(strategies);
  return strategies;
}

export async function updateSnapshotTime(strategyId: string, snapshotId: string, savedAt: number): Promise<SavedStrategy[]> {
  const strategies = loadFromStorage();
  const idx = strategies.findIndex((s) => s.id === strategyId);
  if (idx >= 0) {
    const snapshots = strategies[idx].trackedSnapshots ?? [];
    strategies[idx] = {
      ...strategies[idx],
      trackedSnapshots: snapshots.map((snap) => (snap.id === snapshotId ? { ...snap, savedAt } : snap)),
    };
    saveToStorage(strategies);
  }
  return strategies;
}

export async function deleteTrackedSnapshot(strategyId: string, snapshotId: string): Promise<SavedStrategy[]> {
  const strategies = loadFromStorage();
  const idx = strategies.findIndex((s) => s.id === strategyId);
  if (idx >= 0) {
    const snapshots = strategies[idx].trackedSnapshots ?? [];
    strategies[idx] = {
      ...strategies[idx],
      trackedSnapshots: snapshots.filter((snap) => snap.id !== snapshotId),
    };
    saveToStorage(strategies);
  }
  return strategies;
}

export function generateFilename(
  symbol: string,
  direction: "buy" | "sell",
  strategyName: string,
  legs: Leg[],
): string {
  const sym = symbol.trim().toLowerCase() || "unknown";

  const name = strategyName
    ? strategyName.toLowerCase().replace(/\s+/g, "")
    : "custom";

  const optLegs = legs.filter((l) => l.kind !== "stock");
  const strikeLeg = optLegs.length > 0 ? optLegs[0] : legs[0];
  const strike = strikeLeg ? Math.round(strikeLeg.strike) : 0;

  const dteLeg = optLegs.length > 0 ? optLegs[0] : legs[0];
  const dte = dteLeg?.dte ?? 30;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + Math.round(dte));
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = String(d.getFullYear());

  const today = new Date();
  const todayStr =
    `${today.getFullYear()}` +
    `${String(today.getMonth() + 1).padStart(2, "0")}` +
    `${String(today.getDate()).padStart(2, "0")}`;

  return `${sym}_${direction}_${todayStr}_${name}_${strike}_${mm}${dd}${yyyy}`;
}

// Serializes a combo's full comparable state (legs + shifts + opening
// time) into one string, so App.tsx can detect "has anything changed since
// the last save" with a cheap !== against a previously-stored baseline
// string, instead of a deep-equality check. Deliberately broader than
// findDuplicate's norm() above (which only compares leg composition, for
// "is this the same combo as an existing saved one" duplicate detection) —
// this one also folds in disabled/shares/shifts/openingAt because ANY of
// those changing should mark the combo as dirty relative to its baseline.
export function serializeStrategyState(sym: string, ls: Leg[], sh: Shifts, oa: number): string {
  const norm = (l: Leg) => `${l.action}-${l.type}-${l.strike}-${l.dte}-${l.premium}-${l.kind ?? "option"}-${l.shares ?? 100}-${l.qty ?? 1}-${l.disabled ?? false}`;
  return `${sym}|${ls.map(norm).join("|")}|${sh.dS}|${sh.dT}|${sh.dV}|${oa}`;
}

export function findDuplicate(
  candidate: { symbol: string; spot: number; legs: Leg[]; shifts: Shifts },
  existing: SavedStrategy[],
): SavedStrategy | null {
  const norm = (l: Leg) => `${l.action}-${l.type}-${l.strike}-${l.dte}-${l.premium}-${l.kind ?? "option"}-${l.qty ?? 1}`;
  const candidateKey = candidate.legs.map(norm).join("|");
  for (const s of existing) {
    if (s.symbol !== candidate.symbol) continue;
    // `candidate` (handleOpenStrategy/handleTrack's in-editor combo) always
    // arrives with dte already decayed to "today" — but `s.legs` (the saved
    // opening combo) never decays, it's frozen at save time. Comparing them
    // raw made a strategy opened from the library, then switched into
    // compare mode after any days had passed, fail to re-link via
    // trackingStrategyId (its dte no longer matched byte-for-byte) — see
    // 2026-09-12 bug report. Decay s.legs by the same elapsed-days amount
    // before comparing so both sides are on the same footing. Uses
    // `legsAsOf` (when it was saved), not `openingAt` (when it truly
    // opened) — see SavedStrategy.legsAsOf's doc comment; using openingAt
    // here was the root cause of the "到期日二次衰减" bug (CLAUDE.md"六、24").
    const daysElapsed = calendarDaysSince(s.legsAsOf ?? s.openingAt ?? s.createdAt);
    const sLegsDecayed = s.legs.map((l) =>
      l.kind === "stock" ? l : { ...l, dte: Math.max(0, l.dte - daysElapsed) },
    );
    const sKey = sLegsDecayed.map(norm).join("|");
    if (sKey === candidateKey) return s;
  }
  return null;
}