// src/lib/__tests__/matchStrategy.test.ts
// 2026-09-23新增——`matchStrategy()`返回中文策略名这个行为（CLAUDE.md
// "五、17"反复强调过的一条真实教训来源）值得有一个测试钉住它，以后如果
// 有人不小心把它改成返回`item.name.en`或别的什么，这个测试会先炸，而
// 不是等到某处按中文比对的代码突然全部匹配失败才被发现。
import { describe, it, expect } from "vitest";
import { matchStrategy } from "@/lib/matchStrategy";
import type { Leg } from "@/lib/types";
import type { CustomPreset } from "@/lib/customPresets";

describe("matchStrategy — 基本行为", () => {
  it("空腿位数组应返回空字符串，不抛异常", () => {
    expect(matchStrategy([], 100, [])).toBe("");
  });

  it("对称铁蝶（两条卖出腿同行权价+两条保护腿等宽两侧）应识别为'铁蝶策略'", () => {
    const legs: Leg[] = [
      { id: "1", action: "sell", type: "call", strike: 100, dte: 30, premium: 5, qty: 1 },
      { id: "2", action: "sell", type: "put", strike: 100, dte: 30, premium: 5, qty: 1 },
      { id: "3", action: "buy", type: "call", strike: 110, dte: 30, premium: 1, qty: 1 },
      { id: "4", action: "buy", type: "put", strike: 90, dte: 30, premium: 1, qty: 1 },
    ];
    expect(matchStrategy(legs, 100, [])).toBe("铁蝶策略");
  });

  it("不对称铁蝶（两侧保护腿宽度不相等）应识别为'不对称铁蝶'，不是'铁蝶策略'", () => {
    const legs: Leg[] = [
      { id: "1", action: "sell", type: "call", strike: 100, dte: 30, premium: 5, qty: 1 },
      { id: "2", action: "sell", type: "put", strike: 100, dte: 30, premium: 5, qty: 1 },
      { id: "3", action: "buy", type: "call", strike: 115, dte: 30, premium: 1, qty: 1 }, // 上方宽15
      { id: "4", action: "buy", type: "put", strike: 90, dte: 30, premium: 1, qty: 1 },   // 下方宽10
    ];
    expect(matchStrategy(legs, 100, [])).toBe("不对称铁蝶");
  });

  it("返回值应该是中文名，不是英文——这是CLAUDE.md明确记录过的既有行为，任何改动都不应该动这一点", () => {
    const legs: Leg[] = [
      { id: "1", action: "sell", type: "call", strike: 100, dte: 30, premium: 5, qty: 1 },
      { id: "2", action: "sell", type: "put", strike: 100, dte: 30, premium: 5, qty: 1 },
      { id: "3", action: "buy", type: "call", strike: 110, dte: 30, premium: 1, qty: 1 },
      { id: "4", action: "buy", type: "put", strike: 90, dte: 30, premium: 1, qty: 1 },
    ];
    const name = matchStrategy(legs, 100, []);
    // 粗略但有效的中文检测：结果里应该含有CJK字符范围内的字符。
    expect(/[一-龥]/.test(name)).toBe(true);
  });

  it("自定义预设匹配应返回用户自己起的名字（不经过中英文映射）", () => {
    // 用一个5条腿、行权价/到期日都不规则的组合——42个内置预设里没有任何
    // 一个是5条腿的结构，这样可以确定不会先被PRESET_GROUPS按比例误匹配
    // 掉，真正测到"落到customPresets那条分支"这条路径本身。
    const legs: Leg[] = [
      { id: "1", action: "buy", type: "call", strike: 97, dte: 14, premium: 4.2, qty: 1 },
      { id: "2", action: "sell", type: "call", strike: 103, dte: 30, premium: 2.1, qty: 2 },
      { id: "3", action: "buy", type: "put", strike: 89, dte: 45, premium: 1.4, qty: 1 },
      { id: "4", action: "sell", type: "put", strike: 111, dte: 60, premium: 0.7, qty: 3 },
      { id: "5", action: "buy", type: "call", strike: 121, dte: 90, premium: 0.3, qty: 1 },
    ];
    const custom: CustomPreset[] = [{
      id: "c1", name: "我的看涨策略", direction: "看涨", legs, desc: "", market: "", stocks: "", createdAt: Date.now(),
    }];
    expect(matchStrategy(legs, 100, custom)).toBe("我的看涨策略");
  });
});