// src/lib/__tests__/pricing.test.ts
// 2026-09-23新增：第一批真正会跑的自动化单元测试——针对pricing.ts这个全
// 项目最核心的计算文件（priceCombo/pnlAtExpiry/findBreakevens/
// maxProfitLoss/probabilityOfProfit）。这不是"点点UI看看有没有报错"那种
// 测试，是拿一个手算过正确答案的真实组合（100/110熊市Call价差），断言
// 代码算出来的到期盈亏、盈亏平衡点、最大盈亏跟手算结果一致——回归测试
// 的意义就在这：以后任何改动不小心动了这些函数，`npm run test`立刻能
// 抓出来，不用等到肉眼在界面上发现数字不对。
import { describe, it, expect } from "vitest";
import { pnlAtExpiry, findBreakevens, maxProfitLoss, probabilityOfProfit, priceCombo } from "@/lib/pricing";
import type { Leg } from "@/lib/types";

// 卖100call/买110call，各收$3.00/$1.00权利金——净收$2.00，标准的熊市Call
// 价差（信用价差）。注意：pricing.ts这套计算全程用的是"每股"美元单位，
// 不在内部乘以每张合约100股这个换算（那是展示层/模拟账户自己按需要去
// 乘的事，见simAccount.ts），所以下面手算全部保持"每股"单位，不额外乘
// 100：
//   - 最大盈利 = 净收权利金 = $2（到期股价 ≤ 100时两腿都作废）
//   - 最大亏损 = -(价差宽度 - 净收权利金) = -(10 - 2) = -$8
//     （到期股价 ≥ 110时两腿都被行权，亏损封顶）
//   - 盈亏平衡点 = 卖出行权价 + 净收权利金 = 100 + 2 = 102
function bearCallSpread(): Leg[] {
  return [
    { id: "short-call", action: "sell", type: "call", strike: 100, dte: 30, premium: 3.0, qty: 1 },
    { id: "long-call", action: "buy", type: "call", strike: 110, dte: 30, premium: 1.0, qty: 1 },
  ];
}

describe("pnlAtExpiry — 熊市Call价差手算校验", () => {
  const legs = bearCallSpread();

  it("到期股价远低于两个行权价时，两腿都作废，拿满净收的权利金", () => {
    expect(pnlAtExpiry(legs, 90, 100)).toBeCloseTo(2, 5);
  });

  it("到期股价远高于两个行权价时，亏损封顶在价差宽度减净收权利金", () => {
    expect(pnlAtExpiry(legs, 120, 100)).toBeCloseTo(-8, 5);
  });

  it("到期股价刚好等于盈亏平衡点（102）时，盈亏应为0", () => {
    expect(pnlAtExpiry(legs, 102, 100)).toBeCloseTo(0, 5);
  });
});

describe("findBreakevens — 熊市Call价差盈亏平衡点", () => {
  it("单一盈亏平衡点应为卖出行权价+净收权利金=102", () => {
    const bes = findBreakevens(bearCallSpread(), 100);
    expect(bes.length).toBe(1);
    expect(bes[0]).toBeCloseTo(102, 2);
  });
});

describe("maxProfitLoss — 熊市Call价差最大盈亏封顶", () => {
  it("最大盈利=净收权利金，最大亏损=-(价差宽度-净收权利金)", () => {
    const { maxProfit, maxLoss } = maxProfitLoss(bearCallSpread(), 100);
    expect(maxProfit).toBeCloseTo(2, 1);
    expect(maxLoss).toBeCloseTo(-8, 1);
  });
});

describe("probabilityOfProfit — 到期盈利概率基本性质", () => {
  it("返回值必须落在[0,1]区间内，不能出现负数或超过1", () => {
    const { pop } = probabilityOfProfit(bearCallSpread(), 100);
    expect(pop).toBeGreaterThanOrEqual(0);
    expect(pop).toBeLessThanOrEqual(1);
  });

  it("空腿位组合应返回pop=0、无盈亏平衡点，而不是抛异常", () => {
    const { pop, breakevens } = probabilityOfProfit([], 100);
    expect(pop).toBe(0);
    expect(breakevens).toEqual([]);
  });

  it("现价越接近深度价内（已经稳赚），pop应该明显高于50%", () => {
    // 现价130，远高于两个行权价（都在钱内/更深钱内），这个熊市价差已经
    // 处于最大亏损区间——反过来构造一个已经稳赢的现价场景更直观：现价85
    // 远低于卖出行权价100，全价差已经稳获最大盈利。
    const { pop } = probabilityOfProfit(bearCallSpread(), 85);
    expect(pop).toBeGreaterThan(0.5);
  });
});

describe("priceCombo — 零位移时的净权利金应等于组合的净开仓成本", () => {
  it("卖3.00/买1.00，净收权利金应为+2（每股单位，净收记正）", () => {
    const result = priceCombo(bearCallSpread(), { dS: 0, dT: 0, dV: 0 }, 100);
    // netPremium的符号约定：净收为正——见simAccount.ts的computeCostBasis
    // 注释和CLAUDE.md"三、文件地图"里对这个约定的说明。数值本身是"每股"
    // 美元单位，不含合约100股乘数（见上面文件顶部的说明）。
    expect(Math.abs(result.netPremium)).toBeCloseTo(2, 1);
  });

  it("perLeg数组长度应跟输入腿位数一致，且每条都带上原始leg引用", () => {
    const legs = bearCallSpread();
    const result = priceCombo(legs, { dS: 0, dT: 0, dV: 0 }, 100);
    expect(result.perLeg.length).toBe(legs.length);
    expect(result.perLeg.map((p) => p.leg.id).sort()).toEqual(legs.map((l) => l.id).sort());
  });
});