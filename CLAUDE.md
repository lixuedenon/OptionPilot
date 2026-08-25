# OptionPilot — 项目交接文档（第2版）

这份文档写给下一个 Claude 会话（新窗口）。仔细读完再动手，尤其是第8节"操作层面的教训"——里面记录的坑，不看会重蹈覆辙，包括这次新出现的一类 bug（见8.8）。

---

## 1. 这个项目是什么

OptionPilot 是一个期权策略可视化 + 模拟交易 + AI 策略推荐的 Web 应用，面向中文用户（Xue，项目所有者，本人是有实战经验的期权交易者）。核心定位：不只是"分析当下的期权组合长什么样"，还要"理解盈亏是怎么来的、比较不同操作的结果"——这条产品哲学在最近这一轮开发里体现得更明确了（盈亏归因、决策比较、组合健康度这三个功能都是这条哲学的直接延伸）。

**技术栈**：React + TypeScript + Vite + Tailwind CSS，后端是 Supabase（Edge Functions 做数据代理和计算，Postgres 存少量结构化数据），部署走 Supabase CLI 手动 `deploy`，没有 CI/CD。

**开发环境**：Xue 本地 Windows 电脑，VS Code + PowerShell，`C:\Users\lixue\projects\optionpilote`。已经不用 Bolt 了——Bolt 的浏览器内文件系统反复出现"改动没保存住、刷新就丢"的问题（这是 Bolt 平台本身的已知缺陷，不是操作问题），所以中途整个搬到了本地开发。GitHub 仓库 `github.com/lixuedenon/OptionPilot` 是 public 的，是唯一可信的"当前状态"来源（不要相信 Bolt 里的内容，Bolt 已经不用了）。

---

## 2. 四个模块，目前完成度

| 模块 | 状态 | 说明 |
|---|---|---|
| 分析模式 | 成熟，这次改动最集中的地方 | 搭建期权组合，三滑块（价格/时间/IV）推演盈亏；新增盈亏归因、决策比较、组合健康度 |
| 跟踪对比 | 成熟 | 对比开仓 vs 当前，反推股价/IV变化；这次也顺带修了几个细节 |
| 模拟账户 | 基础功能完整，这一轮没动 | 虚拟开平仓，悔棋模式A + B |
| AI推荐策略 | 开发中，这一轮**没有进展**（开发方向切换到了分析模式完善） | 见第5节，状态跟上一版交接文档时一致 |

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

关键约定，改动前必须知道：
- 正股腿（kind:"stock"）盈亏按每股算，不乘 shares（shares 只是显示用）
- 到期日全项目统一 snap 到最近周五，用 nearestFridayDte()（src/lib/dateUtils.ts），但这个函数只在特定路径调用（新建腿位、展期、对冲、保护、套预设），跟踪模式加载已存策略时不会重新 snap（如果旧数据本身不是周五，会一直显示错的日期，这是已知的历史遗留问题，不是当前代码的 bug）
- 期权链数据（Yahoo）不直接提供 IV，全项目统一用"权利金反推 IV"（impliedVol()，src/lib/pricing.ts，bisection 法），不要假设有现成的 IV 字段
- RSI/ATR 的计算实际是简单移动平均，尽管变量名/注释像是在说"标准 Wilder 平滑"——这是故意保留的行为（对齐 Python 原脚本的实际实现），不要"纠正"成教科书算法
- SimAccount 公式：realizedPnl = markValue - costBasis
- **maxProfitLoss/probabilityOfProfit/positionHealth 这几个"到期结果"相关的指标，设计上刻意不跟随分析模式的情景滑块（Shifts）变化**——它们描述的是"这个腿位组合本身、到期那天会怎样"，是leg列表的固有属性，跟"现在滑块摆在哪"无关。只有"组合当前价值"（netValue/priceCombo的shiftedValue）才应该跟着滑块变。这是这一轮反复出现、必须遵守的设计原则，新增任何"到期类"指标时都要延续这个区分

---

## 4. 文件结构（当前实际状态）

```
src/
  App.tsx              — 分析/跟踪对比模式主界面（约1620行，这次又长了一些，
                          见第7节关于要不要继续拆分的讨论）
  Shell.tsx            — 四个模块的路由壳
  HomePage.tsx          — 首页模块选择
  SimulatorPage.tsx     — 模拟账户（这轮没动）
  AIStrategyPage.tsx    — AI推荐策略页面（临时预览版，这轮没动，见第5节）
  ComingSoonPage.tsx    — 占位页组件（当前没被任何路由使用，但保留）
  main.tsx              — 入口，包了一层最外层 ErrorBoundary

  hooks/
    useSavedStrategies.ts / useCustomPresets.ts / useAutoSync.ts
    — 从 App.tsx 拆出来的三撮独立状态（已存策略/自定义预设/自动同步文件链接）
    — 腿位组合 + 跟踪对比这两撮状态还没拆，耦合太深，这轮又往这两撮里加了
      不少新东西（盈亏归因、健康度、决策比较相关的 state），拆分难度又
      上升了一些，下次真要拆记得先设计"每个hook自己提供reset()方法"

  lib/
    types.ts / bs.ts（Black-Scholes）/ dateUtils.ts / matchStrategy.ts /
      presets.ts / customPresets.ts / savedStrategies.ts / simAccount.ts /
      recentSymbols.ts / useStockQuote.ts / dataTransfer.ts / autoSync.ts
    pricing.ts — 这轮明显变重了，现在导出：impliedVol / legShiftedPrice /
      legGreekBreakdown / priceCombo / pnlAtExpiry（新导出）/ maxProfitLoss
      （新增）/ payoffCurvePoints（新增，给决策比较画图用）/ findBreakevens /
      probabilityOfProfit / impliedSpotFromPremiums / weightedAvgIV /
      attributePnl（新增，盈亏归因用）
    positionHealth.ts   — 新增，组合健康度评分（四个维度：到期盈利概率/距
                          盈亏平衡点/临近到期风险/Delta方向暴露），纯函数，
                          不依赖任何UI
    decisionCompare.ts  — 这轮重写过两次：第一次改成用真实期权链数据（不是
                          理论估算），第二次改成跟随分析模式情景滑块 + 曝露
                          payoff曲线点位给图表用
    optionChain.ts       — 前端期权链客户端，带 Promise 级去重缓存（无过期
                          时间）
    miniMarkdown.tsx     — 手写的轻量 markdown→JSX 渲染器（AI策略结果展示用）

  components/
    LegRow.tsx           — 腿位行组件，分析/跟踪对比模式共用；这轮改动：
                          张数/行权价输入框宽度调整、加了"腿位盈亏"徽章
                          （跟踪模式今日组合专用）、"..."菜单里"比较方案"
                          现在会跟随情景滑块
    PayoffChart.tsx / ShiftSliders.tsx / PresetPicker.tsx / StrategyBadge.tsx
    RollDialog.tsx / HedgeDialog.tsx / ProtectDialog.tsx — 单腿调整对话框
    DecisionCompareDialog.tsx — 决策比较弹窗，这轮重写：加了SVG payoff曲线
                          叠加图（不动/平掉/展期三色曲线），跟随情景滑块，
                          展期日期直接显示在行标签里（不再只在提示文字里说）
    PnlAttributionPanel.tsx   — 盈亏归因面板，**这轮从"只有跟踪对比模式能用"
                          扩展成"分析模式也能用"**——分析模式喂给它的是滑块
                          自己的dS/dT/dV，跟踪对比模式喂给它的是"开仓vs真实
                          当前"反推出来的值，同一个组件两种用法
    PositionHealthBadge.tsx   — 新增，组合健康度徽章，点开展开四项理由，
                          放在头部"到期盈利/盈亏平衡"那个统计区域旁边，两个
                          模式都能看到，且不跟随情景滑块（原因见第3节）
    ErrorBoundary.tsx    — 通用错误边界（class component），**这轮真的救过场**
                          （见8.7），确认有效
    ManageStrategiesDialog.tsx / SaveStrategyDialog.tsx / SavePresetDialog.tsx
    LanguageSwitcher.tsx / DropdownMenu.tsx
    dialogs/             — 从App.tsx拆出的内联弹窗，index.ts统一导出

  i18n/
    I18nContext.tsx      — 注意：变量插值用的是单花括号 `{varName}`，不是
                          `{{varName}}`，这轮写错过一次
    translations.ts      — 纯组装文件，import locales/*
    locales/zh.ts / en.ts — 实际词条，这轮新增了 compare2.*（决策比较）、
                          attribution.*（盈亏归因）、health.*（健康度）
                          等几组key

supabase/
  functions/
    stock-quote/ / option-chain/（已接入服务器端共享缓存，Postgres表
      option_chain_cache，15分钟TTL）/ market-context/ / strategy-analysis/
      — 这四个这轮都没动，状态跟上一版交接文档一致，见第5节
    _shared/
      bs.ts / deltaMatch.ts / technicalIndicators.ts / buildPrompt.ts
      — 前端同名文件的手动同步副本，不是真正共享，这轮没有改动（因为AI
        策略这条线暂停了），但要注意：如果下次有人往 src/lib/bs.ts 或
        pricing.ts 里加通用计算逻辑，记得考虑是否也要同步一份到这里
  migrations/
    20260806061713_create_user_data_tables.sql — 未使用（前端仍是localStorage）
    20260822010000_create_option_chain_cache.sql — 期权链共享缓存表，已生效
```

---

## 5. AI推荐策略模块——这轮暂停，状态原地不动

上一版交接文档写的内容依然完全适用，这轮**没有任何进展**，因为 Xue 决定先把"分析模式完善"这条线做完。原文照抄如下，供参考：

**背景**：Xue 原来有一套本地跑的 Python 脚本（daily_strategy.py + qqq_data_fetcher.py + data_fetcher.py），每天调用 Claude/GPT-4o/Grok/Gemini 四个模型给 QQQ/TQQQ 出期权策略建议。这次是把这套逻辑移植到 Web 应用里。策略逻辑（STRATEGY_REQUIREMENTS常量，在 supabase/functions/_shared/buildPrompt.ts）是逐字从 Python 脚本搬过来的，Xue 明确说过"不要随意修改策略方向定义"，改动前必须跟他确认。

**已经做完、验证过的部分**：技术指标计算、Delta反推与匹配、市场环境数据、prompt拼装、四模型并行调用（真实调用成功过，拿到过真实结果）、期权链共享缓存。

**还没做的部分（按原计划顺序）**：
1. TQQQ参数匹配——方案已想清楚但没写代码：不单独调用AI，直接用deltaMatch.ts的findContractByTargetDelta从QQQ的AI建议里提取目标Delta去TQQQ期权链里匹配
2. 数据库持久化——strategy-analysis现在是"调用即返回"，没存数据库
3. Supabase Cron定时任务——**极其重要，不要跳过或改变这个架构决定**：必须是"每天收盘后自动生成一次"，不能做成"用户点按钮就调用"，否则成本随用户数增长。AIStrategyPage.tsx现在的按钮是临时开发预览用，页面上有橙色警告条说明这一点
4. 前端改造——按钮换成"读取当天缓存结果"的只读展示

**更远期、已讨论但还没定案**：AI管理的另类模拟账户（30个槽位滚动），平仓机制（AI主动判断 vs 固定指标触发）Xue自己还没最终决定，下次做到这一步前必须先跟他确认。

---

## 6. 分析模式完善——这一轮的主战场，四个功能全部做完

Xue的产品思路：不只是"看当下"，还要"理解盈亏来源、比较不同决策"。这轮把他最初提的清单基本做完了。

### 6.1 盈亏归因（P/L Attribution）——已扩展到两个模式

`attributePnl()`（pricing.ts）把观察到的盈亏变化拆解成价格/时间/IV三项贡献 + 一个"交叉项"（因为期权定价不是线性可加的，三项加起来对不上真实总变化是正常数学现象，不是bug）。

**这轮的关键扩展**：这个函数本身设计得足够通用，喂给它不同的"dSpot/dDays/dVolPct/actualChange"就能同时服务两种场景——跟踪对比模式喂"开仓vs真实当前"反推出来的值；**分析模式喂滑块自己的shifts.dS/dT/dV**，`result.change`（已有的，滑块推演出的总变化）直接作为actualChange。滑块一动，归因面板实时联动，UI组件`PnlAttributionPanel.tsx`两边共用同一个。分析模式下只有滑块非零时才显示（归零时没什么可归因的）。

### 6.2 决策比较（Decision Comparison）——设计经历了两次重大调整，最终留在分析模式

这个功能的设计过程值得记录，因为期间有几次方向性调整：

1. **第一版**：组合层面对比"不动/平掉这条腿/展期"，展期用理论BS估算 → 被指出"展期不该是估算，要用真实数据"
2. **改成用真实期权链数据**——服务器端共享缓存表`option_chain_cache`就是为了配合这个改动做的（不然每次点开弹窗都要连Yahoo，用户多了有峰值风险）
3. **讨论过要不要把这个功能挪到跟踪对比模式**（因为"要不要展期"这类决策理论上该针对"真实持有的仓位"才有意义）——**最终决定：留在分析模式**，理由是分析模式本身就有PayoffChart可视化，"预览/总结"这个定位跟分析模式的"可视化推演"更贴合；而且单纯做单腿数字对比"太抽象、看不出对交易者的实际帮助"（Xue原话），组合层面配图形化展示反而更直观
4. **最终版设计**（当前状态）：
   - **跟随情景滑块**——三个方案（不动/平掉/展期）的"组合当前价值"，按滑块**当前的假设情景**去算，不是固定按"现在的真实市场状态"。这是刻意设计：让交易者能把滑块拖到某个假设的未来情景（"如果跌5%、过10天"），当场比较三种应对方式，等真的遇到类似情况时已经有预案了。滑块非零时弹窗顶部有黄色提示条说明这一点
   - **图形化**——SVG小图叠加显示三种方案到期时的payoff曲线（灰=不动，橙=平仓，紫=展期），用`payoffCurvePoints()`（pricing.ts新增）取样，跟数字表格并列，不是二选一
   - **展期这一档用真实数据**：真实的最近似到期日 + 真实报价，弹窗打开那一刻查一次，之后哪怕继续拖滑块也不会重新查（滑块只影响"这个新腿位现在值多少"，不影响"该展到哪个真实日期"）
   - **最大盈利/最大亏损/到期概率这三个数字不跟随滑块**（跟第3节说的设计原则一致）
   - "对冲"没有纳入对比——它是往组合里加一条全新结构的腿，没有一个天然的"默认方案"可以比

### 6.3 组合健康度（Position Health）——新增，一次性做完，中途调整过打分维度

`positionHealth.ts`，纯函数，四个维度各占25分：到期盈利概率、距最近盈亏平衡点的百分比、临近到期的Gamma风险（剩余天数）、组合净Delta方向暴露。

**中途发现并修正的一个设计问题，值得记录**：最初设计了第五个维度"风险回报比"（最大亏损/最大盈利），**用两个对比场景（保守的远虚值Sell Put vs 高风险近到期裸Call）测试时发现这个维度对两个场景都判"bad"**——因为这个应用的核心策略就是卖方收权利金，天生是"权利金收得少、理论最大亏损很大"的结构，不是选得不好，是策略类型的数学特性使然。用这个维度打分会导致Xue最常用的策略永远被扣分，**已经去掉这个维度**，把权重分给了其他四项（这四项在测试里区分度很好）。这是一个"验证发现问题、及时调整"的例子，说明每个新指标上线前，最好都拿正反两个例子实际测一遍，不要只测一个"看起来对"的场景。

**UI**：`PositionHealthBadge.tsx`，头部"到期盈利/盈亏平衡"那个统计区域旁边，点开展开四条具体理由，两个模式都能看到，且**不跟随情景滑块**（同第3节的设计原则）。

### 6.4 还没做的：Leg Purpose

Xue原始建议清单里的最后一项——每条腿的"角色"标签（比如"收租中" vs "已变方向性"，根据当前Delta跟开仓时Delta的偏移判断）。这轮没有开始，改动预计集中在`LegRow.tsx`。

---

## 7. 已知问题 / 技术债

1. **App.tsx 持续增长**（约1620行），这轮盈亏归因/决策比较/健康度都往里加了新的useMemo和state，腿位组合+跟踪对比这两撮状态依然没拆分成hook。之前建议"下次单独拆"，现在文件更大了，拆分的必要性在上升，但风险也在上升（见8.8的教训，文件里useMemo/useState的相互依赖链条已经很长）
2. option-chain前端客户端缓存（src/lib/optionChain.ts）没有过期时间——没有最终拍板要不要加
3. 没有排队限速机制——Xue倾向于等真的有用户量再做
4. 没有单元测试
5. supabase/migrations/20260806061713那三张表没接上，前端仍是localStorage
6. 移动端适配几乎没做
7. **Position Health的四个阈值（POP 30%/70%，距离2%/8%，DTE 7天/30天，Delta 0.3/1.0）是我按经验设的，没有跟Xue逐条确认过是否符合他的实际风险偏好**，如果他反馈"某个场景打分跟直觉不符"，先看是不是阈值需要调整，不要急着改算法结构

---

## 8. 反复出现、必须知道的"操作层面"教训

1. Bolt已经不用了，如果Xue的消息里提到"Bolt"，大概率是在回忆旧事，不代表还在用它开发
2. Xue在本地用VS Code + PowerShell + npm run dev，每次改完文件要提醒他保存、确认dev server还在跑，建议固定用一个窗口跑它，Supabase CLI相关命令用另一个窗口
3. 一定要按文件路径给完整文件内容（不是diff），Xue会自己复制粘贴替换整个文件
4. **反复发生"文件之前建过，但后来发现本地没有"的情况**——历史上Bolt不稳定阶段的遗留问题，每次改动前如果依赖某个之前做过的文件，最好先用`Select-String`确认它真的存在，不要假设"之前做过的东西现在肯定还在"。这轮又发生过好几次（`LegRow.tsx`里的`onCompare`丢过、`ErrorBoundary.tsx`丢过、`CLAUDE.md`本身也丢过一次内容没更新成功的情况）
5. 代码交付前，永远先用esbuild做语法检查（`node_modules/.bin/esbuild <file> --bundle=false --outfile=/dev/null`），能用真实数据交叉验证的一定要验证
6. 部署流程：改前端文件 → 保存 → npm run dev本地过一遍 → 涉及Edge Function的额外`supabase functions deploy <name>` → 涉及数据库改动的额外`supabase secrets set`或`supabase db push` → 确认无误后 → `git add . && git commit && git push`
7. **ErrorBoundary这轮真的发挥作用了**——一次运行时报错（见8.8）导致分析/跟踪对比模式同时崩溃，因为有错误边界兜底，页面显示的是"这里出错了/重试/返回首页"，没有变成完全白屏，用户体验上是可控的。这印证了当初做这个功能的判断是对的
8. **新出现的一类bug，这轮踩了两次，下次必须提前规避**：`App.tsx`里几十个`useMemo`/`const`前后互相依赖，**往文件中间插入新的计算逻辑时，如果引用了在插入点之后才声明的变量，会触发JavaScript的"暂时性死区"报错**（`Uncaught ReferenceError: Cannot access 'xxx' before initialization`），表现为运行时崩溃、esbuild语法检查完全查不出来（这是运行时顺序问题，不是语法问题）。这轮先后在`trackedResult`和`isCompareMode`上犯过这个错——都是把新代码加在了引用对象声明**之前**。**以后每次往App.tsx中间插入新的useMemo/const时，必须手动确认：这段新代码引用的每一个变量，是否都在文件里排在它前面已经声明过**，不能只做语法检查就自信地交付。最好的做法是插入到文件末尾附近（在所有会被引用的东西都已经声明完之后），而不是图方便插在中间某个看起来相关的位置
9. Supabase项目当初是从Bolt认领过来的（bolt-native-database-70052271，已认领到`lixuedenon's Org`，项目ref是`oyotvdhlffxodyfzqfxt`），认领时Bolt保留了对整个Supabase组织的大范围API权限，Xue还没去检查/收回，如果他问起可以提醒

---

## 9. 环境变量 / Secrets 清单

前端 .env（本地文件，从没推送到GitHub）：
```
VITE_SUPABASE_URL=https://oyotvdhlffxodyfzqfxt.supabase.co
VITE_SUPABASE_ANON_KEY=<已知，需要时Xue可以直接给，这个key设计上可以公开>
```

Supabase Secrets（已确认配置完成，不需要重新问Xue要）：
```
ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY / GEMINI_API_KEY  — 四个AI模型
FINNHUB_API_KEY  — market-context用
```
SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY等是Supabase自动提供的，不需要手动设置。

---

## 10. 建议的下一步（按优先级）

1. **Leg Purpose**——分析模式完善清单里最后一项，工作量不大，做完这条产品线上Xue最初提的功能建议就算全部落地了
2. **重新评估要不要继续AI推荐策略那条线**（TQQQ匹配 → 数据库持久化 → Cron定时），还是Xue有别的优先级；这条线技术方案都已经想清楚了，随时可以捡起来
3. **App.tsx拆分**——这轮又长了不少，且第8.8节的教训说明这个文件的可维护性正在下降，值得找一个专门的时间段，小步拆分、每步都verify，参照第7.1节
4. Position Health的评分阈值，如果Xue用了一段时间后反馈"跟直觉不符"，回来调整第7.7节提到的那几个数字
5. 其他的看Xue想先做哪个，他是那种会主动说清楚需求、也会主动纠正理解偏差的人，不确定的地方直接问他，不要自己瞎猜着往下做