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

// 每张的价按报价取到分；合计 = 每张 × 张数（不用原始合计），括号里的乘法才对得上：$1.00（×5 张 = $5.00）
export function perUnitParts(v: number, legs: Leg[]): { n: number; per: number; total: number } {
  const n = contractUnit(legs);
  if (n <= 1) return { n: 1, per: v, total: v };
  // 按绝对值取到分再带回符号：Math.round对负数的x.xx5会往上舍，同一个差额正着写和负着写会差一分
  const per = (Math.sign(v) * Math.round(Math.abs(v / n) * 100)) / 100;
  return { n, per, total: Math.round(per * n * 100) / 100 };
}

// 金额都按一张说；不止一张时括号里写"×张数 = 合计"。fmt：把一个金额格式化成文字（usd不带符号、money带正负号）
export function perUnitText(v: number, legs: Leg[], t: T, fmt: (x: number) => string): string {
  const { n, per, total } = perUnitParts(v, legs);
  if (n <= 1) return fmt(v);
  return t(isSingleOption(legs) ? "price.perContract" : "price.perSet", { p: fmt(per), n, v: fmt(total) });
}

// 括号里那部分（单独放在一行小字里用）
export function perUnitTotal(v: number, legs: Leg[], t: T, fmt: (x: number) => string): string | undefined {
  const { n, total } = perUnitParts(v, legs);
  if (n <= 1) return undefined;
  return t(isSingleOption(legs) ? "price.totalContracts" : "price.totalSets", { n, v: fmt(total) });
}

// 只写每张（或每组）的价，不带合计
export function perUnitOnly(v: number, legs: Leg[], t: T, fmt: (x: number) => string): string {
  const { n, per } = perUnitParts(v, legs);
  if (n <= 1) return fmt(v);
  return t(isSingleOption(legs) ? "price.perContractOnly" : "price.perSetOnly", { p: fmt(per) });
}
