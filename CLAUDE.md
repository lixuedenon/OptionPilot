# OptionPilot — 项目交接文档（第3版）

这份文档写给下一个 Claude 会话（新窗口）。仔细读完再动手。第7节有一个**当前未解决**的谜团，务必先看，不然容易在同一个坑上重复排查。第8节是操作层面反复踩过的坑。

---

## 1. 这个项目是什么

OptionPilot 是一个期权策略可视化 + 模拟交易 + AI 策略推荐的 Web 应用，面向中文用户（Xue，项目所有者，本人是有实战经验的期权交易者）。核心定位：不只是"分析当下的期权组合长什么样"，还要"理解盈亏是怎么来的、比较不同操作的结果"。

**技术栈**：React + TypeScript + Vite + Tailwind CSS，后端是 Supabase（Edge Functions 做数据代理和计算，Postgres 存少量结构化数据），部署走 Supabase CLI 手动 `deploy`，没有 CI/CD。

**开发环境**：Xue 本地 Windows 电脑，VS Code + PowerShell（有时候也用Git Bash，看到 `lixue@intel MINGW64` 这种提示符不用奇怪），`C:\Users\lixue\projects\optionpilote`。已经不用 Bolt 了。GitHub 仓库 `github.com/lixuedenon/OptionPilot` 是 public 的，是唯一可信的"当前状态"来源。

---

## 2. 四个模块，目前完成度

| 模块 | 状态 | 说明 |
|---|---|---|
| 分析模式 | 成熟，这几轮改动最集中的地方 | 三滑块推演盈亏；盈亏归因、决策比较、组合健康度都已加入 |
| 跟踪对比 | 成熟 | 对比开仓 vs 当前，反推股价/IV变化 |
| 模拟账户 | 基础功能完整，好几轮没动了 | 虚拟开平仓，悔棋模式A + B |
| AI推荐策略 | 开发中，好几轮没有进展（开发方向切到了分析模式完善） | 见第5节 |

---

## 3. 核心数据模型（src/lib/types.ts）

```
interface Leg {
  id, action("buy"|"sell"), type("call"|"put"), strike, dte, premium,
  kind?("stock"), shares?, qty?（份数，默认1）, disabled?
}
interface Shifts { dS, dT, dV } // 价格/天数/波动率百分点的情景偏移
interface GreekBreakdown { delta, gamma, theta, vega, total }
```

关键约定：
- 正股腿（kind:"stock"）盈亏按每股算，不乘 shares
- 到期日全项目统一 snap 到最近周五，用 nearestFridayDte()，但跟踪模式加载已存策略时不会重新 snap（历史遗留，不是bug）
- Yahoo期权链不直接提供IV，全项目统一用权利金反推IV（impliedVol()，bisection法）
- RSI/ATR 用简单移动平均，故意对齐Python原脚本，不要"纠正"成教科书算法
- SimAccount 公式：realizedPnl = markValue - costBasis
- **maxProfitLoss/probabilityOfProfit 描述"到期结果"，是leg列表的固有属性，跟当前滑块无关**——这条原则这几轮被反复强调，但**这一轮又出现了例外情况**：Position Health这一次改成了会跟随滑块（见6.3），因为Xue明确要求"健康度也该跟着滑块的假设情景走"。**这说明这条设计原则不是铁律，是"默认值"**——新增指标时先问自己：这个指标该反映"真实现状"还是"滑块推演的假设情景"？两种都有正当理由，取决于这个指标是给"了解现状"用的还是给"预演决策"用的，拿不准要问Xue，不要自己套用旧例子想当然

---

## 4. 文件结构

```
src/
  App.tsx              — 分析/跟踪对比模式主界面（约1660行，持续增长中，
                          见7.1关于拆分的讨论）
  Shell.tsx / HomePage.tsx / SimulatorPage.tsx / AIStrategyPage.tsx /
  ComingSoonPage.tsx（未使用但保留）/ main.tsx

  hooks/
    useSavedStrategies.ts / useCustomPresets.ts / useAutoSync.ts
    — 腿位组合+跟踪对比这两撮状态依然没拆，耦合更深了

  lib/
    types.ts / bs.ts / dateUtils.ts / matchStrategy.ts / presets.ts /
      customPresets.ts / savedStrategies.ts / simAccount.ts /
      recentSymbols.ts / useStockQuote.ts / dataTransfer.ts / autoSync.ts
    pricing.ts — 核心计算文件，导出：impliedVol / legShiftedPrice /
      legGreekBreakdown / priceCombo / pnlAtExpiry / maxProfitLoss /
      payoffCurvePoints / findBreakevens / probabilityOfProfit /
      impliedSpotFromPremiums / weightedAvgIV / attributePnl
    positionHealth.ts — 组合健康度评分，**这轮重写过一次**（见6.3），
      现在会构造"滑块情景下的假想腿位列表"再评分，不是简单读breakdown
    decisionCompare.ts — 决策比较，跟随滑块，展期用真实期权链数据
    optionChain.ts / miniMarkdown.tsx

  components/
    LegRow.tsx — 腿位行组件，"..."菜单里"比较方案"跟随情景滑块
    PayoffChart.tsx / ShiftSliders.tsx / PresetPicker.tsx / StrategyBadge.tsx
    RollDialog.tsx / HedgeDialog.tsx / ProtectDialog.tsx
    DecisionCompareDialog.tsx — SVG payoff曲线叠加图，跟随情景滑块
    PnlAttributionPanel.tsx — **这轮改了刻度算法**（见6.1和第7节的未解决
      问题），现在接受外部传入的`maxAbs`（固定尺子），不再自己算
    PositionHealthBadge.tsx — **这轮改成了Portal渲染**（见6.4），不再是
      普通的absolute定位子元素
    ErrorBoundary.tsx — 已经真实发挥过作用（见8.7）
    ManageStrategiesDialog.tsx / SaveStrategyDialog.tsx / SavePresetDialog.tsx
    LanguageSwitcher.tsx / DropdownMenu.tsx
    dialogs/ — index.ts统一导出

  i18n/
    I18nContext.tsx — 变量插值用单花括号 `{varName}`，不是双花括号
    translations.ts / locales/zh.ts / locales/en.ts

supabase/ — 这几轮完全没动，状态跟AI策略部分一致，见第5节
```

---

## 5. AI推荐策略模块——继续暂停，状态原地不动

跟上一版交接文档完全一致，这几轮**没有任何进展**。核心内容（不重复展开，需要时翻上一版）：技术指标、Delta匹配、市场环境数据、prompt拼装、四模型并行调用都已验证过能跑通；TQQQ参数匹配方案已想清楚没写代码；数据库持久化和Cron定时任务没做；**架构上"必须是每天自动生成一次、不能用户点按钮就调用"这个决定不要动摇**。AIStrategyPage.tsx现在的按钮仍是临时开发预览用，页面有橙色警告条说明。

---

## 6. 分析模式完善——这几轮的主战场

### 6.1 盈亏归因——刻度算法这轮重做过

**背景**：Xue发现原来的条形图设计有问题——原来是"四个数字（价格/时间/IV/交叉项贡献）里最大的那个当满格"，这种"自相对"刻度会导致：拖滑块时哪怕数字持续增长，最大的那根条永远是100%满格（因为尺子本身跟着数据一起在变），看起来像是"图不动但数字在动"。

**改法**：换成"固定尺子"——用**这个组合本身的最大盈利/最大亏损**（`maxProfitLoss()`）中绝对值较大的那个当满格，这两个数字不随滑块变化，尺子稳定，条形图能真实反映每次变化占组合总风险的比例。`PnlAttributionPanel.tsx`现在需要外部传入`maxAbs`这个prop，`App.tsx`里新增了`attributionMaxAbs`这个useMemo，两个使用场景（分析模式、跟踪对比模式）共用同一把尺子（因为两边的归因计算都是基于`activeLegs`/`spot`）。

**已知的正常副作用**：这把尺子有上限，如果价格/时间/IV贡献的绝对值本身就接近甚至超过组合的最大盈亏（比如滑块拖得很猛），条形图会封顶（`Math.min(100,...)`），这是设计本身决定的，不是bug——见第7节详细讨论这个"封顶"现象跟"当前遇到的诡异问题"的区别。

### 6.2 决策比较——设计定型，留在分析模式

这个功能上一轮已经定型，这轮没有进一步改动。核心设计：跟随情景滑块、SVG图形化叠加"不动/平掉/展期"三条到期payoff曲线、展期用真实期权链数据（弹窗打开时查一次，之后拖滑块不重新查）、最大盈利/最大亏损/到期概率三个数字不跟随滑块（延续第3节的默认原则）。

### 6.3 组合健康度——这轮经历了一次实质性重构

上一轮做出来的第一版有三个被Xue指出的问题，这轮全部处理了：

1. **健康度现在跟随情景滑块**——不只是Delta，到期盈利概率/距盈亏平衡点/剩余天数**这三项也会基于"滑块推演到的假设时点"重新算**。做法：新增了`buildShiftedLegs()`（positionHealth.ts内部），构造一份"如果滑块的情景真的发生了，这些期权腿会变成什么样"的假想腿位列表（用`legShiftedPrice()`重新算每条腿在新时点的权利金、dte减去`shifts.dT`），再拿这份假想列表去跑到期概率/盈亏平衡点计算。Delta则直接用`priceCombo`已经算好的`result.breakdown`（本身就是shift-aware的）。**这是本轮"到期类指标该不该跟随滑块"这条设计默认值被明确打破的一次**，记在第3节了

2. **加了总结句**——`HealthResult`新增`summary`字段，根据四项里有没有"bad"/"warning"状态，自动生成一句人话总结（比如"存在明显风险点：距盈亏平衡点偏弱，建议重点关注"），不是让用户自己拼四条

3. **Delta改成按张数归一化**——原来用组合净Delta的绝对值判断方向暴露，被Xue指出"这样张数越多的仓位会被误判成风险越大，哪怕每张合约本身风险控制得一样好"。改成"平均每张合约的Delta"（净Delta ÷ 总张数）。**验证过**：1张和10张完全相同结构的仓位，改完之后打分完全一致，改之前会因为张数不同而分数不同

**同时发现并处理的一个UI bug**：健康度弹窗一开始用普通的`position: absolute`渲染，文字会被截断——排查发现两层原因：(a) 外层容器有`whitespace-nowrap`，被子元素继承导致文字被迫挤成一行；(b) 更深层的原因是这个弹窗现在渲染在"整体滚动的左侧栏"内部，可能被这个滚动容器的`overflow-y-auto`裁切掉超出可视范围的部分。**最终修法是用`createPortal`把弹窗传送到`document.body`下渲染**，彻底跳出任何祖先容器的裁切影响，用按钮的`getBoundingClientRect()`手动计算弹窗该出现在屏幕的什么位置。**这是本轮唯一引入的新技术模式（Portal），下面会展开说**

### 6.4 关于Portal模式——一个值得注意的、可能影响其他组件的技术决定

`PositionHealthBadge.tsx`这次改成了`createPortal`渲染，是**这个项目第一次用这个模式**。背景：App.tsx的左侧栏在更早一轮被改成了"整体滚动"（外层容器`overflow-y-auto`），从那以后，**任何普通的`position:absolute`弹窗/下拉菜单，只要嵌套在这个滚动容器内部，理论上都有被裁切的风险**——不是只有健康度弹窗会中招。

项目里现在还有好几个类似的下拉/弹窗组件是**普通absolute定位、没有用Portal**：`LegRow.tsx`里的`LegMenu`（"..."菜单）、行权价选择下拉、`DropdownMenu.tsx`、`PresetPicker.tsx`、头部的股票代码历史下拉等等。**这些目前没有被报告出问题，可能是因为它们弹出的位置、大小恰好没有触发裁切**，但如果以后Xue反馈"某个下拉菜单显示不全/被切掉"，大概率是同一类问题，直接抄`PositionHealthBadge.tsx`这次的Portal写法即可，不用重新摸索。

---

## 7. 【当前未解决】盈亏归因条形图疑似仍在用旧刻度——需要下一步排查

这是这份交接文档最需要下一个开发者重点关注的地方。

**现象**：6.1提到的"固定尺子"改动，代码经过`Select-String`确认已经存在于`App.tsx`（`attributionMaxAbs`、两处`maxAbs={attributionMaxAbs}`）和`PnlAttributionPanel.tsx`（`maxAbs: number`这个prop）里，**代码本身是对的**。但Xue用一个具体组合（Sell Call 220 + Sell Put 220，52天，权利金29.7+30.45）实测，观察到的条形图行为**看起来仍然是旧算法**（价格贡献这一条顶格封顶，IV和交叉项按照"相对价格的比例"缩小显示）。

**已经做的验证**：拿这个组合的真实数据算过，`maxProfitLoss()`算出来 maxProfit=60.15，maxLoss=-49.85，尺子应该是60.15。截图里价格贡献是-36.64，按新算法应该只占尺子的**60.9%**，不该顶格。但视觉上明显顶格了，这跟"旧算法"（拿四个数字里最大的当满格，价格自己最大，必然100%）的特征完全吻合。

**已经排除的可能性**：不是代码没写对（`Select-String`确认过）。

**建议下一步排查的方向（还没做，按怀疑程度排序）**：
1. **最可能**：这是Vite的HMR（热更新）在"给组件新增必填prop"这种改动上失效导致的——建议的第一步是重启`npm run dev`（不只是浏览器刷新），必要时删掉`node_modules/.vite`缓存目录再重启，这是最常见也最容易被忽略的原因
2. 其次：确认Xue截图那次操作，是不是**在同一个浏览器标签页里、没有重新触发组件重新挂载**的情况下测的
3. 再次：检查是不是存在**两份`PnlAttributionPanel`渲染逻辑**——`Select-String`只搜了关键词，没有排查"是否所有渲染路径都用的是新组件"
4. 最不可能但要写出来存档：`maxProfitLoss()`本身的计算是否在某些leg组合下有边界条件bug——这次用的验证例子已经手动算过、结果合理，暂不怀疑这个函数本身，除非1-3排查完还是没找到原因，再回头怀疑这里

**给下一个开发者的建议**：先做1（重启dev server + 清vite缓存），如果解决了，在这里补一笔"确认是HMR缓存问题"；如果没解决，按2→3→4顺序继续排查，不要跳过步骤瞎猜。

---

## 8. 反复出现、必须知道的"操作层面"教训

1. Bolt已经不用了
2. Xue在本地用VS Code + PowerShell/Git Bash + npm run dev，每次改完文件提醒他保存、确认dev server还在跑
3. 一定要按文件路径给完整文件内容（不是diff）
4. **反复发生"文件之前建过，但后来发现本地没有"的情况**——每次改动前如果依赖某个之前做过的文件，最好先用`Select-String`确认它真的存在
5. 代码交付前，永远先用esbuild做语法检查，能用真实数据交叉验证的一定要验证——**但这轮也暴露了esbuild语法检查的局限**：第7节这个诡异问题提醒我们，"语法正确"、"逻辑经过Select-String确认存在于文件里"，都不等于"浏览器里跑的就是这份代码"，中间还隔着一层"是否真的重新构建/热更新生效"，这一层esbuild检查不了，只能靠重启dev server或硬刷新来排除
6. 部署流程：改前端文件 → 保存 → npm run dev本地过一遍 → 涉及Edge Function的额外`supabase functions deploy` → 涉及数据库改动的额外`supabase secrets set`或`supabase db push` → 确认无误后 → `git add . && git commit && git push`
7. ErrorBoundary这几轮真实发挥过作用（运行时崩溃时只影响局部，没有变成完全白屏），印证了这个防护的价值
8. **"暂时性死区"（TDZ）报错**：App.tsx里几十个`useMemo`/`const`前后互相依赖，往文件中间插入新代码时如果引用了在插入点之后才声明的变量，会导致`Uncaught ReferenceError: Cannot access 'xxx' before initialization`，esbuild查不出来（运行时顺序问题不是语法问题）。这几轮已经踩过两次。**每次往App.tsx中间插入新的useMemo/const，必须手动确认引用的每个变量是否都排在它前面**
9. **新增：Portal是解决"弹窗被滚动容器裁切"的标准方案**——见6.4，这个模式目前只在`PositionHealthBadge.tsx`用过一次，如果后续还有其他下拉/弹窗被反馈"显示不全"，大概率是同一类问题，直接复用这个写法
10. Supabase项目当初是从Bolt认领过来的，认领时Bolt保留了对整个Supabase组织的大范围API权限，Xue还没去检查/收回，如果他问起可以提醒

---

## 9. 环境变量 / Secrets 清单

前端 .env（本地文件，从没推送到GitHub）：
```
VITE_SUPABASE_URL=https://oyotvdhlffxodyfzqfxt.supabase.co
VITE_SUPABASE_ANON_KEY=<已知，需要时Xue可以直接给，这个key设计上可以公开>
```

Supabase Secrets（已确认配置完成）：
```
ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY / GEMINI_API_KEY  — 四个AI模型
FINNHUB_API_KEY  — market-context用
```

---

## 10. 建议的下一步（按优先级）

1. **先解决第7节的未解决问题**——这是当前最紧急的，不确认清楚，后续在这个基础上继续开发风险很高
2. **Leg Purpose**——分析模式完善清单最后一项还没做
3. **重新评估AI推荐策略那条线的优先级**——技术方案都想清楚了，随时可以捡起来（TQQQ匹配 → 数据库持久化 → Cron）
4. **App.tsx拆分**——文件持续增长，第8.8节的教训说明可维护性在下降
5. 其他的看Xue想先做哪个，不确定的地方直接问他，不要自己瞎猜着往下做