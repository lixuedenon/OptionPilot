// src/lib/numberInput.ts
// 2026-09-24新增：全项目数值输入框的统一校验/clamp工具。之前每个数值输入
// 框（LegRow.tsx的NumField、RollDialog/ProtectDialog/HedgeDialog的行权价
// /权利金、App.tsx现价、SimulatorPage.tsx起始资金等）各自在onChange里手写
// 防护，结果参差不齐——多数完全没有上限/负数防护（行权价输负数会让
// bs.ts的Black-Scholes公式`Math.log(S / K)`算出NaN，一路传染到整个组合
// 定价、图表、组合健康度），只有少数几处（EarningsIvCrashTab.tsx风险百
// 分比、ScenarioSelectorPage.tsx的IV估计）写对了min/max。这个文件把
// "clamp到[min,max]区间+按小数位数四舍五入+拦截键盘输入字母符号"这三件
// 事收敛成一处，以后任何新增的数值字段都应该调用这里，而不是重新手写一
// 遍——同一类校验只应该有一份权威实现，参照CLAUDE.md"五、19"同样的原则。

export interface NumberInputRule {
  min: number;
  max: number;
  /** 小数位数；0表示只能是整数（数量/股数类字段）。 */
  decimals: number;
}

// 各字段的实际业务规则。价格类字段统一保留3位小数（xue明确要求），数量
// 类字段强制正整数。上限数值选取原则：留出远超真实交易场景的余量，只用
// 来挡住"手滑多打几个9"或恶意输入，不是要精确定义业务边界。
export const NUMBER_RULES = {
  // 行权价/现价/正股买入价：不能是0或负数——bs.ts的Black-Scholes公式对
  // K<=0会算出NaN，一路传染到整个组合定价。上限给到50万（覆盖BRK.A这
  // 类天价股，留足余量）。
  price: { min: 0.01, max: 500000, decimals: 3 } as NumberInputRule,
  // 权利金：0是合法的（极度价外、几乎不值钱的期权权利金可以趋近于0），
  // 但不能是负数——期权买方最多亏光权利金，不存在"倒付"的权利金价格。
  premium: { min: 0, max: 500000, decimals: 3 } as NumberInputRule,
  // 期权合约张数：必须是正整数，上限给到9999（单条腿9999张已经是远超
  // 散户账户规模的极端值）。
  qty: { min: 1, max: 9999, decimals: 0 } as NumberInputRule,
  // 正股股数：同样必须是正整数，上限给到1000万股（覆盖对冲用的大额正
  // 股仓位）。
  shares: { min: 1, max: 10000000, decimals: 0 } as NumberInputRule,
  // 模拟账户起始资金：必须是正数，上限给到1亿（美元）。2位小数（货币精
  // 度），不跟随"价格3位小数"这条规则——分以下没有实际意义。
  capital: { min: 1, max: 100000000, decimals: 2 } as NumberInputRule,
  // 百分比类字段（财报风险百分比/场景选择器IV估计）：沿用各自调用点原
  // 本就写对的[min,max]，这里只是给个通用的1位小数规则，实际min/max由
  // 调用点自己的业务含义决定，不从这里读。
  percent1dp: { min: 0, max: 1000, decimals: 1 } as NumberInputRule,
} satisfies Record<string, NumberInputRule>;

/** 把任意原始输入clamp到规则允许的区间，并按小数位数四舍五入。 */
export function clampToRule(raw: number, rule: NumberInputRule): number {
  if (!Number.isFinite(raw)) return rule.min;
  const clamped = Math.min(rule.max, Math.max(rule.min, raw));
  const factor = 10 ** rule.decimals;
  return Math.round(clamped * factor) / factor;
}

/** 跟clampToRule一样，但min/max来自调用点自己（不从NUMBER_RULES读）。 */
export function clamp(raw: number, min: number, max: number, decimals: number): number {
  return clampToRule(raw, { min, max, decimals });
}

// 键盘层面拦截字母/符号——type="number"的原生输入框本身仍然允许键入
// "e"/"E"（科学计数法）、"+"，多数浏览器对连续多个"-"/"."也不做拦截，这
// 些都不会被HTML5的number类型天然挡住，粘贴同样能绕过。这个handler在
// keydown阶段直接拦截：允许数字、控制键（退格/删除/方向键/Tab等）、小
// 数点（仅当decimals>0）、负号（仅当min<0——目前全项目没有任何数值字段
// 允许负数，这个分支是为将来万一有需要而留的开关，不是当前会用到的路
// 径）、以及Ctrl/Cmd组合键（保留复制/粘贴/全选等快捷键，粘贴内容仍然会
// 在onChange里被clampToRule兜底過濾）。
export function blockInvalidNumberKey(
  e: React.KeyboardEvent<HTMLInputElement>,
  rule: Pick<NumberInputRule, "min" | "decimals">
): void {
  const allowedControl = [
    "Backspace", "Delete", "Tab", "Escape", "Enter",
    "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End",
  ];
  if (allowedControl.includes(e.key)) return;
  if (e.ctrlKey || e.metaKey) return;
  if (e.key >= "0" && e.key <= "9") return;
  if (e.key === "." && rule.decimals > 0) return;
  if (e.key === "-" && rule.min < 0) return;
  e.preventDefault();
}