# OptionPilot — 项目交接文档（第4版）

这份文档写给下一个 Claude 会话（新窗口）。第3版里"当前未解决"的盈亏归因条形图问题，**这一轮已经定位并修复**，见第7节（原第7节的排查过程整体保留存档，方便理解排查思路，但结论已更新）。这一版是个**过渡版本**——第7节的bug刚修完，还没有开始新功能，下一个开发者接手时项目状态是"干净、待继续"，不是"半成品"。第8节是操作层面反复踩过的坑，这轮新增了一条。

---

## 1. 这个项目是什么

OptionPilot 是一个期权策略可视化 + 模拟交易 + AI 策略推荐的 Web 应用，面向中文用户（Xue，项目所有者，本人是有实战经验的期权交易者）。核心定位：不只是"分析当下的期权组合长什么样"，还要"理解盈亏是怎么来的、比较不同操作的结果"。

**技术栈**：React + TypeScript + Vite + Tailwind CSS，后端是 Supabase（Edge Functions 做数据代理和计算，Postgres 存少量结构化数据），部署走 Supabase CLI 手动 `deploy`，没有 CI/CD。

**开发环境**：Xue 本地 Windows 电脑，VS Code + PowerShell（有时候也用Git Bash，看到 `lixue@intel MINGW64` 这种提示符不用奇怪），`C:\Users\lixue\projects\optionpilote`。已经不用 Bolt 了。GitHub 仓库 `github.com/lixuedenon/OptionPilot` 是 public 的，是唯一可信的"当前状态"来源。

---

## 2. 四个模块，目前完成度

| 模块 | 状态 | 说明 |
|---|---|---|
| 分析模式 | 成熟，这几轮改动最集中的地方 | 三滑块推演盈亏；盈亏归因、决策比较、组合健康度都已加入；**这轮修复了归因条形图的显示bug（见第7节）** |
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
- **maxProfitLoss/probabilityOfProfit 描述"到期结果"，是leg列表的固有属性，跟当前滑块无关**——这条原则被反复强调，但有个明确的例外：Position Health跟随滑块（见6.3），因为Xue明确要求"健康度也该跟着滑块的假设情景走"。**这说明这条设计原则不是铁律，是"默认值"**——新增指标时先问自己：这个指标该反映"真实现状"还是"滑块推演的假设情景"？两种都有正当理由，取决于这个指标是给"了解现状"用的还是给"预演决策"用的，拿不准要问Xue，不要自己套用旧例子想当然

---

## 4. 文件结构

```
src/
  App.tsx              — 分析/跟踪对比模式主界面（约1649行，持续增长中，
                          App.tsx拆分仍是待办，见第10节）
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
    positionHealth.ts — 组合健康度评分，会构造"滑块情景下的假想腿位列表"
      再评分，不是简单读breakdown（见6.3）
    decisionCompare.ts — 决策比较，跟随滑块，展期用真实期权链数据
    optionChain.ts — 期权链客户端缓存 + 拉取封装，配合下面
      supabase/functions/option-chain 使用（服务端共享缓存15分钟TTL）
    miniMarkdown.tsx

  components/
    LegRow.tsx（约671行）— 腿位行组件。除了基础字段编辑，已包含：
      · 行权价/到期日下拉选择，数据来自真实期权链（getOptionChain）
      · 权利金自动填充（strike+dte都设好后600ms防抖拉取，仅在
        premium===0时触发，不会覆盖用户已改的值）
      · "恢复市场价"按钮（handleRestorePrice，强制重新拉取）
      · "..."菜单里"比较方案"跟随情景滑块
    PayoffChart.tsx / ShiftSliders.tsx / PresetPicker.tsx / StrategyBadge.tsx
    RollDialog.tsx / HedgeDialog.tsx / ProtectDialog.tsx
    DecisionCompareDialog.tsx — SVG payoff曲线叠加图，跟随情景滑块
    PnlAttributionPanel.tsx — 接受外部传入的`maxAbs`（固定尺子）prop。
      **这轮修复了内部`Bar`子组件的百分比换算bug**（见第7节）——现在
      pct已正确对半（`visualPct = pct / 2`）再用作左右两半容器内的
      width/left，不会再出现"数值没到上限但视觉已经顶格、且后续拖动
      滑块条形完全不动"的现象
    PositionHealthBadge.tsx — 用`createPortal`渲染（见6.4），跳出滚动
      容器的裁切
    ErrorBoundary.tsx — 已经真实发挥过作用（见8.7）
    ManageStrategiesDialog.tsx / SaveStrategyDialog.tsx / SavePresetDialog.tsx
    LanguageSwitcher.tsx / DropdownMenu.tsx
    dialogs/ — index.ts统一导出

  i18n/
    I18nContext.tsx — 变量插值用单花括号 `{varName}`，不是双花括号
    translations.ts / locales/zh.ts / locales/en.ts

supabase/functions/
  option-chain/index.ts — Yahoo期权链代理，服务端Postgres共享缓存
    （option_chain_cache表，15分钟TTL），保护Yahoo限流
  stock-quote/index.ts — 实时报价代理
  market-context/ — fear/greed指数（CNN，VIX兜底）、宏观指标、新闻
    （Finnhub + RSS），AI推荐策略用
  strategy-analysis/ — 并行调用Claude/GPT-4o/Grok/Gemini四模型，
    AI推荐策略用，见第5节
```

---

## 5. AI推荐策略模块——继续暂停，状态原地不动

跟上一版交接文档完全一致，这几轮**没有任何进展**。核心内容（不重复展开，需要时翻上一版）：技术指标、Delta匹配、市场环境数据、prompt拼装、四模型并行调用都已验证过能跑通；TQQQ参数匹配方案已想清楚没写代码；数据库持久化和Cron定时任务没做；**架构上"必须是每天自动生成一次、不能用户点按钮就调用"这个决定不要动摇**。AIStrategyPage.tsx现在的按钮仍是临时开发预览用，页面有橙色警告条说明。

---

## 6. 分析模式完善——历史改动存档

### 6.1 盈亏归因——刻度算法（数据层）

**背景**：原来的条形图是"四个数字（价格/时间/IV/交叉项贡献）里最大的那个当满格"，这种"自相对"刻度会导致：拖滑块时哪怕数字持续增长，最大的那根条永远是100%满格，看起来像是"图不动但数字在动"。

**改法**：换成"固定尺子"——用**这个组合本身的最大盈利/最大亏损**（`maxProfitLoss()`）中绝对值较大的那个当满格，这两个数字不随滑块变化。`PnlAttributionPanel.tsx`接受外部传入的`maxAbs`这个prop，`App.tsx`里的`attributionMaxAbs`这个useMemo负责算，分析模式、跟踪对比模式共用同一把尺子。

**这个"数据层"的改动本身是对的，验证过（见第7节手算过程）。但这个改动之后，条形图视觉表现依然像顶格——原因不在这里，是下面这层的显示bug（见第7节）。**

### 6.2 决策比较——设计定型，留在分析模式

核心设计：跟随情景滑块、SVG图形化叠加"不动/平掉/展期"三条到期payoff曲线、展期用真实期权链数据（弹窗打开时查一次，之后拖滑块不重新查）、最大盈利/最大亏损/到期概率三个数字不跟随滑块（延续第3节的默认原则）。

### 6.3 组合健康度——重构存档

1. **健康度跟随情景滑块**——不只是Delta，到期盈利概率/距盈亏平衡点/剩余天数**这三项也会基于"滑块推演到的假设时点"重新算**。做法：`buildShiftedLegs()`（positionHealth.ts内部）构造一份"如果滑块的情景真的发生了，这些期权腿会变成什么样"的假想腿位列表，再拿这份假想列表去跑到期概率/盈亏平衡点计算。Delta直接用`priceCombo`已经算好的`result.breakdown`（本身就是shift-aware的）。**这是"到期类指标该不该跟随滑块"这条设计默认值被明确打破的一次**，记在第3节了

2. **加了总结句**——`HealthResult`的`summary`字段，根据四项里有没有"bad"/"warning"状态，自动生成一句人话总结

3. **Delta按张数归一化**——用"平均每张合约的Delta"（净Delta ÷ 总张数），避免张数越多的仓位被误判成风险越大

**同时处理的一个UI bug**：健康度弹窗一开始用普通`position:absolute`渲染，被"整体滚动的左侧栏"的`overflow-y-auto`裁切。**修法是用`createPortal`把弹窗传送到`document.body`下渲染**，用按钮的`getBoundingClientRect()`手动计算弹窗该出现在屏幕的什么位置。

### 6.4 关于Portal模式——技术决定存档

`PositionHealthBadge.tsx`用`createPortal`渲染，是这个项目第一次用这个模式。背景：App.tsx的左侧栏是"整体滚动"（外层容器`overflow-y-auto`），**任何普通的`position:absolute`弹窗/下拉菜单，只要嵌套在这个滚动容器内部，理论上都有被裁切的风险**。

项目里还有几个类似组件是**普通absolute定位、没有用Portal**：`LegRow.tsx`里的`LegMenu`、行权价/到期日选择下拉、`DropdownMenu.tsx`、`PresetPicker.tsx`、头部的股票代码历史下拉等。**目前没有被报告出问题**，但如果以后反馈"某个下拉菜单显示不全/被切掉"，大概率是同一类问题，直接抄`PositionHealthBadge.tsx`的Portal写法即可。

### 6.5 期权链自动填充——已完成，非本轮新增（补记）

上一版交接文档遗漏了这部分该写入"已完成"清单，这里补记，避免以后又被当成待办重新做一遍：`LegRow.tsx`已集成`src/lib/optionChain.ts`，行权价/到期日可从真实期权链下拉选择，权利金在strike+dte都设好后自动防抖拉取（不覆盖用户已有值），并提供"恢复市场价"按钮强制刷新。后端是`supabase/functions/option-chain`，Postgres共享缓存15分钟TTL。

---

## 7. 盈亏归因条形图"疑似顶格"问题——已定位并修复

**这是上一版文档里"当前未解决"的问题，这一轮排查清楚了，根因和6.1的刻度算法完全无关。**

### 7.1 现象回顾

Xue用Sell Call 220 + Sell Put 220（52天，权利金29.7+30.45）实测，价格贡献条形图看起来始终顶格，哪怕数值（如-31.69、-36.64）按`maxAbs`（60.15）计算出的比例明明只有52.7%、60.9%，远没到100%。继续拖滑块，数字持续变化，但条形图不再有任何视觉变化。

### 7.2 排查过程（存档，避免以后遇到类似"数字对但界面错"的问题时重复走弯路）

1. 逐行核对`attributionMaxAbs`的计算、两处`PnlAttributionPanel`调用点、`maxProfitLoss()`本身——**全部确认逻辑正确**，用文档里的具体例子手算过，60.15/-49.85跟代码算出来的完全吻合
2. 排除了"两份重复渲染逻辑"——全仓库搜索确认`PnlAttributionPanel`只有一份
3. 一度怀疑是Vite HMR缓存导致浏览器没跑上最新代码——按标准流程清了`node_modules/.vite`缓存、重启dev server、硬刷新浏览器，**问题依旧**
4. **关键验证步骤**：直接在浏览器DevTools的Sources面板里搜索`attributionMaxAbs`字符串，**确认浏览器实际加载、执行的就是最新代码**（能搜到`maxAbs: attributionMaxAbs`这行）。这一步排除了"代码没更新到浏览器"这整条方向，把问题范围从"构建/缓存层"收窄到"运行时的具体计算或渲染逻辑"

### 7.3 真正的根因：`Bar`子组件的百分比换算bug（显示层，不是数据层）

`PnlAttributionPanel.tsx`内部的`Bar`组件设计是"以中线（50%）为轴心，正值往右长、负值往左长"的双向条形图。bug出在：

```tsx
// 修复前
const pct = maxAbs > 0 ? Math.min(100, (Math.abs(value) / maxAbs) * 100) : 0;
// ...
style={{ width: `${pct}%`, left: positive ? "50%" : `${50 - pct}%` }}
```

`pct`是"相对整条maxAbs的0~100比例"，但容器以中线为轴，**每一侧实际只有50个百分点的可视空间**。当`pct`超过50（也就是数值超过maxAbs一半，很容易发生），负值分支`left = 50 - pct`会算出负数，超出容器左边界，被`overflow-hidden`直接裁掉——视觉上就是"从裁切处一路填到中线，正好填满整个左半边"，跟真正顶格（100%）在视觉上**完全无法区分**。而且`pct`一旦超过50继续增大，`left`只会更负，裁切后可见部分不再变化——这精确对应了"数字在变、条形图不动"的现象。

**修复**：把`pct`再除以2，映射到每侧实际拥有的50个百分点空间里：

```tsx
// 修复后
const pct = maxAbs > 0 ? Math.min(100, (Math.abs(value) / maxAbs) * 100) : 0;
const visualPct = pct / 2;
// ...
style={{ width: `${visualPct}%`, left: positive ? "50%" : `${50 - visualPct}%` }}
```

代入验证：value=-31.69时，`visualPct=26.35`，`left=23.65%`——条形落在左半边内部，不再触碰边界；只有当`|value|`真正逼近`maxAbs`时（`pct`接近100，`visualPct`接近50），条形才会触到最左/最右边缘，这才是"固定尺子"该有的行为。

### 7.4 这次排查留下的经验（已写入第8节）

"代码逻辑正确"、"浏览器加载的是最新代码"，都不等于"界面表现正确"——中间还有一层纯CSS/布局的百分比换算，是逻辑review和"搜字符串确认新代码"这两步都查不出来的，必须真的把数值代入具体的CSS属性里手算一遍，或者靠视觉实测。以后遇到"数字看着对、但界面表现明显不对"的问题，除了缓存/构建层，一定要单独怀疑一遍纯展示层的计算（百分比、坐标、单位换算）。

---

## 8. 反复出现、必须知道的"操作层面"教训

1. Bolt已经不用了
2. Xue在本地用VS Code + PowerShell/Git Bash + npm run dev，每次改完文件提醒他保存、确认dev server还在跑
3. 一定要按文件路径给完整文件内容（不是diff）
4. **反复发生"文件之前建过，但后来发现本地没有"的情况**——每次改动前如果依赖某个之前做过的文件，最好先用`Select-String`确认它真的存在
5. 代码交付前，永远先用esbuild做语法检查，能用真实数据交叉验证的一定要验证——但"语法正确"、"逻辑经过确认存在于文件里"，都不等于"浏览器里跑的就是这份代码"，也不等于"界面表现正确"（见第7节，这轮暴露了后者）
6. 部署流程：改前端文件 → 保存 → npm run dev本地过一遍 → 涉及Edge Function的额外`supabase functions deploy` → 涉及数据库改动的额外`supabase secrets set`或`supabase db push` → 确认无误后 → `git add . && git commit && git push`
7. ErrorBoundary这几轮真实发挥过作用（运行时崩溃时只影响局部，没有变成完全白屏），印证了这个防护的价值
8. **"暂时性死区"（TDZ）报错**：App.tsx里几十个`useMemo`/`const`前后互相依赖，往文件中间插入新代码时如果引用了在插入点之后才声明的变量，会导致`Uncaught ReferenceError: Cannot access 'xxx' before initialization`，esbuild查不出来。**每次往App.tsx中间插入新的useMemo/const，必须手动确认引用的每个变量是否都排在它前面**
9. Portal是解决"弹窗被滚动容器裁切"的标准方案——见6.4，目前只在`PositionHealthBadge.tsx`用过一次，如果后续还有其他下拉/弹窗被反馈"显示不全"，大概率是同一类问题，直接复用这个写法
10. Supabase项目当初是从Bolt认领过来的，认领时Bolt保留了对整个Supabase组织的大范围API权限，Xue还没去检查/收回，如果他问起可以提醒
11. **新增：排查"数字对但界面表现不对"的问题时，缓存/构建层排查完之后，别忘了单独审查纯CSS/布局的百分比、坐标、单位换算逻辑**——这类bug逻辑review容易看漏（因为数据本身是对的），必须把具体数值代入CSS属性手算，或者靠实际视觉效果验证。第7节这次排查在排除缓存问题后才找到真正原因，走了不少弯路，下次遇到类似"看着像旧代码在跑"的现象，可以把这层检查提前

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

1. **Leg Purpose**——分析模式完善清单最后一项还没做
2. **重新评估AI推荐策略那条线的优先级**——技术方案都想清楚了，随时可以捡起来（TQQQ匹配 → 数据库持久化 → Cron）
3. **App.tsx拆分**——文件持续增长（约1649行），第8.8节的教训说明可维护性在下降
4. 其他的看Xue想先做哪个，不确定的地方直接问他，不要自己瞎猜着往下做

**本版本状态**：第7节的bug已修复并等待Xue本地验证+提交，除此之外没有其他进行中的改动——这是个干净的过渡点，下一步是上面1-3里任选一个开始新一轮开发。