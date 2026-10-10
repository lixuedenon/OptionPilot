// src/lib/perContract.ts
// 全项目金额按"每股×张数"算（5张卖0.35的Put，开仓收的就是$1.75）。说开仓收/付多少、理论上值多少时，
// 用户习惯看报价那个数（每张0.35），所以有多张时写成"每张 $0.35（5张共 $1.75）"。
import type { Leg } from "@/lib/types";

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

// 各期权腿张数的最大公约数（5张、5张→5；2张、4张→2）。含正股腿或算不出整数时按1（只写合计）。
export function contractUnit(legs: Leg[]): number {
  if (legs.some((l) => l.kind === "stock")) return 1;
  const qs = legs.map((l) => Math.round(l.qty ?? 1)).filter((q) => q > 0);
  if (!qs.length) return 1;
  return qs.reduce((a, b) => gcd(a, b));
}

// 单条期权腿=每张，多条=每组
export function isSingleOption(legs: Leg[]): boolean {
  return legs.filter((l) => l.kind !== "stock").length === 1;
}

type T = (k: string, v?: Record<string, string | number>) => string;

// fmt：把一个金额格式化成文字（usd不带符号、money带正负号），合计和每张用同一种
export function perUnitText(v: number, legs: Leg[], t: T, fmt: (x: number) => string): string {
  const n = contractUnit(legs);
  if (n <= 1) return fmt(v);
  return t(isSingleOption(legs) ? "price.perContract" : "price.perSet", { p: fmt(v / n), n, v: fmt(v) });
}

// 短写法：拆成几项一起列时用"−$0.57/张（共 −$2.85）"，免得每项都重复"5 张"
export function perUnitShort(v: number, legs: Leg[], t: T, fmt: (x: number) => string): string {
  const n = contractUnit(legs);
  if (n <= 1) return fmt(v);
  return t(isSingleOption(legs) ? "price.perContractShort" : "price.perSetShort", { p: fmt(v / n), v: fmt(v) });
}

// 只写每张（或每组）的价，不带合计
export function perUnitOnly(v: number, legs: Leg[], t: T, fmt: (x: number) => string): string {
  const n = contractUnit(legs);
  if (n <= 1) return fmt(v);
  return t(isSingleOption(legs) ? "price.perContractOnly" : "price.perSetOnly", { p: fmt(v / n) });
}
