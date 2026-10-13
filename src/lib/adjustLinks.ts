// src/lib/adjustLinks.ts
// 展期/保护/对冲产生的腿用Leg.derivedFrom指回原腿。这里放跟这层关系有关的纯计算：
// 撤销时要不要恢复原腿、已展期的腿再调整时放进对比方案的那份副本。
import type { Leg } from "./types";
import { uid } from "./legFactory";

// 一份组合最多10条腿（腿位区标题显示"n / 10"）；放进对比方案的副本同样不超过这个数。
export const MAX_COMBO_LEGS = 10;

export type AdjustKind = "roll" | "protect" | "hedge";

export function hasRollChild(legs: Leg[], id: string): boolean {
  return legs.some((l) => l.derivedFrom?.via === "roll" && l.derivedFrom.legId === id);
}

// 由这条腿展期/保护出来的所有腿（含再往下展期出来的）。
export function descendantIds(legs: Leg[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => {
    for (const l of legs) {
      if (l.derivedFrom?.legId === pid && !out.has(l.id)) {
        out.add(l.id);
        walk(l.id);
      }
    }
  };
  walk(id);
  return out;
}

// 撤销一次展期（删掉展期出来的腿）后：原腿只有在没有别的展期腿时才恢复，否则会跟另一条展期腿同时算。
export function restoreRollSource(legs: Leg[], sourceId: string, extra: Partial<Leg> = {}): Leg[] {
  if (hasRollChild(legs, sourceId)) return legs;
  return legs.map((l) => (l.id === sourceId ? { ...l, disabled: false, ...extra } : l));
}

// 放进对比方案的腿：新id，去掉展期/保护来源、开仓配对、已落袋这些只属于原组合的字段。
function freshCopy(l: Leg): Leg {
  const { derivedFrom: _d, entryPremium: _e, closedPnl: _c, openLegId: _o, ...rest } = l;
  void _d; void _e; void _c; void _o;
  return { ...rest, id: uid(), disabled: false };
}

// 方案A做一次调整之后的样子（只含生效的腿）：
// 展期=原腿（和它之前展期出来的那条及其下面的腿）换成新腿，放在原腿的位置；保护=原腿后面加一条；对冲=最后加一条。
// 原腿已经展期过时，结果就是"换另一种展期"的组合，可以跟A现在的样子比。
export function adjustedLegs(legs: Leg[], kind: AdjustKind, newLeg: Leg, targetId?: string): Leg[] {
  if (kind === "roll" && targetId) {
    // 原腿自己的保护腿留着（跟在A里展期一样）；原腿之前展期出来的腿连同它下面的都去掉。
    const drop = new Set<string>([targetId]);
    for (const l of legs) {
      if (l.derivedFrom?.via === "roll" && l.derivedFrom.legId === targetId) {
        drop.add(l.id);
        descendantIds(legs, l.id).forEach((d) => drop.add(d));
      }
    }
    const out: Leg[] = [];
    for (const l of legs) {
      if (l.id === targetId) out.push(newLeg);
      else if (!drop.has(l.id) && !l.disabled) out.push(l);
    }
    return out;
  }
  const active = legs.filter((l) => !l.disabled);
  if (kind === "protect" && targetId) {
    const i = active.findIndex((l) => l.id === targetId);
    if (i >= 0) return [...active.slice(0, i + 1), newLeg, ...active.slice(i + 1)];
  }
  return [...active, newLeg];
}

export function adjustedCopy(legs: Leg[], kind: AdjustKind, newLeg: Leg, targetId?: string): Leg[] {
  return adjustedLegs(legs, kind, newLeg, targetId).map(freshCopy);
}
