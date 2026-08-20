import type { Leg } from "@/lib/types";
import { PRESET_GROUPS } from "@/lib/presets";
import type { CustomPreset } from "@/lib/customPresets";

type Pattern = string;

function patternOf(legs: Leg[]): Pattern {
  const opts = legs.filter((l) => l.kind !== "stock");
  const stockLegs = legs.filter((l) => l.kind === "stock");

  const hasStock = stockLegs.length > 0;
  const stockAction = stockLegs.length > 0 ? stockLegs[0].action : "";

  const uniqueStrikes = [...new Set(opts.map((l) => l.strike))].sort((a, b) => a - b);
  const bucket = (strike: number) => uniqueStrikes.indexOf(strike);

  const sorted = [...opts].sort((a, b) => {
    if (a.strike !== b.strike) return a.strike - b.strike;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    return a.action < b.action ? -1 : 1;
  });

  const optPattern = sorted
    .map((l) => `${l.action[0]}${l.type[0]}${bucket(l.strike)}`)
    .join(",");

  return hasStock ? `S${stockAction[0]}|${optPattern}` : optPattern;
}

export function matchStrategy(
  activeLegs: Leg[],
  _spot: number,
  customPresets: CustomPreset[]
): string {
  if (activeLegs.length === 0) return "";

  const actualPattern = patternOf(activeLegs);

  for (const group of PRESET_GROUPS) {
    for (const item of group.items) {
      if (patternOf(item.legs()) === actualPattern) {
        return item.name.zh;
      }
    }
  }

  for (const custom of customPresets) {
    if (patternOf(custom.legs) === actualPattern) {
      return custom.name;
    }
  }

  return "";
}
