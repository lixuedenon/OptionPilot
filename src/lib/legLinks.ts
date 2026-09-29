// src/lib/legLinks.ts
import type { Leg } from "./types";

export interface LegLinkInfo {
  role: "source" | "derived";
  via: "roll" | "protect" | "hedge";
  otherIndex: number; // 1-based position of the paired leg within the SAME array passed to computeLegLinks
  color: string; // 这一组配对共用的颜色（LegRow用它给两条腿铺同色背景）
}

// 配对颜色，按出现顺序循环使用。深色背景上都要清楚可辨。
export const LEG_LINK_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#f472b6", "#2dd4bf"];

// 把Leg.derivedFrom（展期/保护产生的腿指回原腿）解析成每条腿的配对信息。
// 同一条链（A展期成B、B再展期成C）算一组、共用一种颜色；不同组按出现顺序分配不同颜色。
// 对冲腿没有legId（针对整个组合），不参与配对。原腿被删掉时，这条派生腿就没有配对信息。
export function computeLegLinks(legs: Leg[]): Map<string, LegLinkInfo> {
  const idx = new Map(legs.map((l, i) => [l.id, i]));
  const parent = legs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));

  const pairs: { src: number; dst: number; via: LegLinkInfo["via"] }[] = [];
  legs.forEach((leg, i) => {
    const from = leg.derivedFrom;
    if (!from?.legId) return;
    const s = idx.get(from.legId);
    if (s === undefined) return;
    pairs.push({ src: s, dst: i, via: from.via });
    parent[find(i)] = find(s);
  });

  const groupColor = new Map<number, string>();
  const colorOf = (i: number) => {
    const root = find(i);
    if (!groupColor.has(root)) groupColor.set(root, LEG_LINK_COLORS[groupColor.size % LEG_LINK_COLORS.length]);
    return groupColor.get(root)!;
  };

  const map = new Map<string, LegLinkInfo>();
  [...pairs].sort((a, b) => Math.min(a.src, a.dst) - Math.min(b.src, b.dst)).forEach(({ src, dst, via }) => {
    const color = colorOf(src);
    map.set(legs[dst].id, { role: "derived", via, otherIndex: src + 1, color });
    if (!map.has(legs[src].id)) map.set(legs[src].id, { role: "source", via, otherIndex: dst + 1, color });
  });
  return map;
}
