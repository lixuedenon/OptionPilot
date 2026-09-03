# OptionPilot 交接文档

**文档目的**：让接手这个项目的人（或者下一个AI对话实例）能够无缝衔接，不需要重新翻聊天记录。这份文档分两大部分：**第一部分**是这场对话开始之前，项目已经完成的内容（来自会话开始时的交接摘要）；**第二部分**是这场对话里新做的全部工作，按功能模块组织，而不是按时间顺序——方便你按模块查找，而不用从头翻到尾。

**重要提醒（写在最前面）**：这份文档、以及整场对话里所有的代码交付，都是基于Claude自己维护的一份**本地沙盒副本**，不是直接读取GitHub上的真实代码。这份副本的准确性，依赖于：(1) 用户上传/粘贴的文件，(2) Claude自己生成并交付给用户的文件。如果用户在本地做过Claude不知道的手动修改，或者某次"放法"没有真的应用成功，这份本地副本就会跟真实代码库产生偏差。**接手的人第一件事，应该是拿这份文档跟GitHub仓库（`github.com/lixuedenon/OptionPilot`）的真实文件做一次全面比对，确认没有偏差，再继续开发。**

---

## 项目基本信息

- **项目**：OptionPilot — 期权策略可视化 + 模拟交易 + AI推荐的Web应用
- **技术栈**：React + TypeScript + Vite + Tailwind CSS + Supabase（Edge Functions, Postgres）
- **仓库**：`github.com/lixuedenon/OptionPilot`（public，但目前只有1次commit，说明是整体推送，不是逐次提交）
- **本地开发路径**：`C:\Users\lixue\projects\optionpilote`
- **开发环境**：Windows + VS Code + PowerShell
- **数据源**：Yahoo Finance `v7/finance/options`（通过Supabase Edge Function代理，cookie+crumb认证）
- **用户背景**：Xue是资深期权交易者，对实盘细节（保证金动态计算、提前指派机制、财报交易策略等）有深入的实战经验，经常用真实交易经验纠正理论假设

---

# 第一部分：会话开始前已完成的工作

这部分内容来自会话最开始的交接摘要，是这场对话开始之前项目已经达到的状态。

## 已完成的主要模块

### 场景引擎（`scenarioEngine.ts`）
- 从打分算法改为固定查表（`SCENARIO_RULES`），覆盖30种桶组合的完整对照表
- 三标签结构：方向/财报/待定
- 财报标签内部层级：IV Crash vs 方向判断 → IV Crash内部又分90%/80%/70%三档阈值层级
- `BUY_DTE_EXTENSION`：纯买方结构的DTE延展逻辑
- 屏蔽组合检测（`isScenarioBlocked`）

### 财报IV Crash策略端到端流程（早期版本）
- `earningsStrategy.ts`：真实期权链查询（近/中/远三组）、根据账户风险预算反推仓位大小
- `EarningsIvCrashTab.tsx`：开仓流程UI
- `EarningsPositionsPanel.tsx` + `earningsClosing.ts`：财报后平仓指导（三分支：波动小/居中/很大）

### 动态保证金模块（`margin.ts`）
- 从静态"预留最坏情况"重新设计为10%地板到最大亏损之间的动态插值，匹配真实券商行为

### 分析模式增强
- P/L归因面板（滑块驱动 + 跟踪对比两种模式）
- 决策对比功能（`decisionCompare.ts`、`DecisionCompareDialog.tsx`）：针对单条腿对比"不动/平仓/展期"三种结果，用真实期权链数据
- 组合健康度评分（`positionHealth.ts`、`PositionHealthBadge.tsx`）：四个维度各25分——到期盈利概率(POP)、距盈亏平衡点距离、临近到期的Gamma风险、每张合约平均Delta归一化

### 期权链集成
- `option-chain` Supabase Edge Function代理Yahoo Finance（cookie+crumb认证）
- 服务端共享缓存（`option_chain_cache` Postgres表，15分钟TTL）
- 客户端`optionChain.ts`带promise级缓存和最近行权价匹配

### 模拟器
- `simAccount.ts`（localStorage存储）
- `SimulatorPage.tsx`
- 批量平仓功能（按仓位分组的复选框）

## 会话开始前的关键设计原则（这些原则在整场对话中被反复引用和遵守）

- **"到期结果"类指标（maxProfit/maxLoss、POP、健康度评分）默认不跟随情景滑块**——这些描述的是组合的内在属性。组合健康度是刻意做的例外，它跟随滑块
- **决策对比停留在分析模式**：滑块代表对未来情景的预演；从假设情景对比持有/平仓/展期，是设计上的用例
- **IV/HV比值逻辑**：比值低不代表权利金便宜，如果绝对IV仍然很高——三分类：`sellRich`/`buyCheap`/`stillRich`
- **中远期组按近期组的2倍开仓**（财报策略）
- **动态保证金优于静态**：真实券商是动态插值的，静态最坏情况预留是错的
- **`App.tsx`的TDZ（暂时性死区）风险**：新插入的`useMemo`必须手动核实声明顺序，esbuild抓不出这类错误
- **风险回报比这个维度从组合健康度里删掉了**：因为会系统性惩罚卖方策略，不管行权价质量如何
- **`createPortal`用于弹出层**：需要用来逃出滚动面板的overflow裁剪
- **跨式/宽跨式行权价规则**：跨式两腿锁定同一个ATM行权价；宽跨式两腿都要保持OTM
- **`matchStrategy.ts`里的到期日分桶**：需要正确区分对角价差和垂直价差
- **预设库标准**：只收录真正常见、成熟的策略，不为了凑数量加边缘变体

## 会话开始前的代码交付规范（这些规范在本场会话中继续沿用）

- **代码第一行放路径注释**（如`// src/lib/margin.ts`）
- **交付完整文件，不是diff**，减少复制粘贴出错
- **明确说明每个文件是新建还是替换**，以及确切路径
- **交付前彻底核对语法和import**——之前有过漏import导致运行时崩溃的教训
- **直接给结论，不用多选题**
- **GitHub是真理来源**，本地和Bolt的副本可能会分叉

---

# 第二部分：这场会话里做的全部工作

## 一、财报IV Crash策略——从0到完整可用（这是本场会话的主线）

### 1.1 策略设计本身（先讨论清楚，再写代码）

策略核心思路：财报公布前，期权价格里包含"不确定性溢价"，财报一公布这份溢价通常迅速消失——策略赚的是这份溢价消失的钱，不赌方向。

**三组结构**（每组4条腿：卖ATM Call、卖ATM Put、买两侧保护）：

| 组别 | 保护宽度 | 到期日 | 仓位倍数 |
|---|---|---|---|
| 近期组 | ±10% | 本周五（最近到期日） | 1x |
| 中期组 | ±15% | 下个月月期权到期日 | 2x |
| 远期组 | ±20% | 两个月后月期权到期日 | 2x |

**选股条件**：大盘股/热门股，**必须有周期权**（硬性前提），过去3年90%以上的财报后极值波动（最高最低，不是开盘收盘）在10%以内

**下单时机**：盘后财报→当天收盘前建仓；盘前财报→前一天收盘前建仓

**仓位大小**：不是固定份数，是**按账户可用资金的一个百分比（用户输入，默认3%）反推近期组该开几份**，中远期组自动2倍跟随。这个反推逻辑：`预算 = 可用资金 × 风险比例`，`近期组份数 = floor(预算 ÷ 近期组每份最大亏损)`

**平仓规则**：
- 近期组：财报公布开盘后，**尽快平掉保护腿**，两条平值腿（不管盈亏）**2小时内平掉**，除非对方向有明确判断
- 中远期组：按财报后实际波动幅度分三支——
  - 波动<10%：大概率盈利，给"平仓落袋"或"再等等"的选择
  - 波动10%~保护宽度之间：大概率小亏，需要判断趋势，引导去分析模式看图
  - 波动≥保护宽度：亏损已封顶，不急，可以放到期也可以去分析模式看要不要提前离场

**风险提示（写进了用户可见的说明文字里）**：
- 提前指派风险——Call被指派通常跟临近除息日有关（对方图分红）；Put被指派通常跟当前利率环境有关（对方图提前拿现金吃利息），跟除息日无关
- 这不是稳赚不赔策略——极少数情况财报本身制造了新的更大不确定性，IV可能不跌反涨

**明确搁置、没有做的部分**（不是忘了，是这次会话里明确决定先不做）：
- 历史财报涨跌**极值**数据（真正的最高最低，不是开盘收盘）——免费网络搜索查不到这么细的数据，需要用户自己开通类似市场变色龙(MarketChameleon)这样的付费平台账号手动导出
- 历史IV/IV Percentile数据——同样需要付费历史期权数据源
- "过去出现类似幅度波动后接下来1-2个月怎么走"的统计参考——依赖上面两项数据，也搁置
- 用AI（本Claude或其他大模型API）去网上现查历史数据这条路，**已经实测证明走不通**——查到的是定性描述（比如"MSFT这次财报反常"），查不到需要的精确数字（历史极值、历史IV），因为这类数据在付费平台（如市场变色龙）后面，普通网页搜索抓不到表格内容
- 财报"方向判断"分支（跟IV Crash并列的另一条路，用户提过但明确说"等做的时候再告诉你"）——UI占位已经搭好（见`EarningsTabRoot.tsx`），内容没做
- IV Crash策略的80%/70%阈值档（跟90%档并列，同样的策略框架但历史筛选标准更宽松）——UI占位已经搭好，选择90%以外的档位会显示"敬请期待"，逻辑没做

### 1.2 具体实现的文件

**`src/lib/earningsStrategy.ts`**（新文件）——策略核心计算
- `EARNINGS_GROUPS`：三组的规格定义（保护宽度%、仓位倍数、目标DTE）
- `pickGroupExpiries(symbol)`：拉一次期权链（覆盖足够远的到期日范围），从真实存在的到期日列表里分别给三组挑最接近目标天数的真实日期——保证三组不会意外撞到同一个到期日
- `buildGroupLegs(symbol, spot, spec, expiryDate, units)`：用真实报价搭出某一组的4条腿，同时算出这一组"每1份"的净收权利金和最大亏损（两翼分别算，取更差的那个，不是假设对称）
- `computeUnitsFromRiskBudget(availableCapital, riskPct, maxLossPerUnitNear)`：仓位大小反推
- `computeEarningsPreview(groupLegs, spot)`：三组聚合预览，复用`margin.ts`的`computeComboMargin`（不是重新发明保证金计算）

**`src/lib/optionChain.ts`**（修改）——导出了原本私有的`nearestStrikeQuote`函数，供`earningsStrategy.ts`复用，避免重复实现同一段逻辑

**`src/components/EarningsTabRoot.tsx`**（新文件）——财报标签的顶层层级导航
- 第一层：IV Crash vs 方向判断（方向判断是占位"敬请期待"）
- 第二层（选了IV Crash后）：90%/80%/70%三档筛选标准（只有90%可点，另外两档标"敬请期待"）
- 第三层（选了90%后）：渲染`EarningsIvCrashTab`

**`src/components/EarningsIvCrashTab.tsx`**（新文件）——90%档IV Crash的完整开仓流程UI
- 标的输入、实时现价、风险比例输入（带详细解释文字，说明这个比例算的是"近期组冲出保护、亏到最坏情况"时愿意亏账户资金的百分比，不是保证金占用比例）
- "生成预览"：调用`earningsStrategy.ts`的函数链，展示三组明细+聚合总计（总最大亏损、总保证金、总净收权利金）
- 保证金超过可用资金时，"确认开仓"按钮自动禁用
- "确认开仓"：依次调用`openSimPosition`三次，把三组分别开成三个独立的模拟仓位，每个都打上标记（见下面"仓位标记机制"），成功后跳转回模拟账户

**`src/lib/earningsClosing.ts`**（新文件）——平仓阶段的核心判断逻辑
- `parseEarningsNote(note)`/`groupEarningsPositions(positions)`：从仓位的`note`字段解析出"这是财报策略的哪一组、属于哪一批"，把属于同一批的仓位重新分组
- `isNearGroupPastWindow(position)`/`nearGroupHoursElapsed(position)`：近期组的2小时窗口判断（按仓位自己的`openedAt`算，不是精确的"财报后市场开盘时间"，这个是已知的简化，因为没有真实的市场日历数据）
- `computeClosingGuidance(position, currentSpot, group)`：中远期组的三分支判断（`small`/`medium`/`large`），边界是10%和这一组自己的保护宽度

**`src/components/EarningsPositionsPanel.tsx`**（新文件，这次会话里改动最多的文件之一）——财报仓位的专属管理面板
- 把同一批的三组仓位聚合展示，不再散落在常规持仓列表里
- 每组显示完整的腿位明细表格（见下面"腿位表格字段"这一节，这是本次会话最后修的）
- 近期组：显示距2小时窗口还剩多久，三个操作按钮（只平保护腿/只平平值腿/全平）
- 中远期组：显示波动百分比+对应分支的指导文字，**永远显示腿位表格和一个通用"平仓"按钮**，分支专属的按钮（平仓落袋/去分析模式）只在实时数据到位后才出现——这是应用"永远展示框架，缺什么就说清楚"这条原则后的结果，之前有一版是"数据没到位就整个隐藏"，被认定为不对的做法

### 1.3 仓位标记机制（`note`字段）

`SimPosition`的`note`字段原本定义了但完全没人用。这次用来标记"这个仓位属于财报策略的哪一批、哪一组"，格式：`earnings-iv-crash:{group}:{batchId}`（`group`是`near`/`mid`/`far`，`batchId`格式是`{symbol}-{时间戳}`）。

**这个字段后来因为另一个功能（添加到对比模式）差点产生冲突**——见下面"三、跟踪对比模式集成"这一节，最终方案是**没有复用这个字段**，而是给`SimPosition`加了第二个独立字段`linkedStrategyId`，两个字段各管各的，不会互相覆盖。

### 1.4 腿位表格字段（本次会话最后一次修改，重要）

`EarningsPositionsPanel.tsx`里的腿位表格，最初版本只有行权价/数量/权利金三个字段，被用户指出"改少了"（对比真实券商thinkorswim的持仓表格截图）。最终版本对齐了真实券商表格的字段：

**到期日、行权价、类型、数量、开仓价（Trade Price）、实时价（Mark）、市值（Mark Value）、未实现盈亏（P/L Open）、盈亏%（P/L %）、期权代码（Option Code）**

- 实时价/市值/未实现盈亏/盈亏%需要拉活的报价才能算，复用了`SimulatorPage.tsx`里已经写好的`fetchLiveLegsAndSpot`函数（通过新增的`onFetchLive`prop传进来，不是在面板组件里重复实现一套拉取逻辑）
- 期权代码是简化版OCC格式（`occCode`函数），比如`AMD260918P400`，不是标准21字符带补零的完整OCC格式，是匹配真实券商界面上显示的那种简写形式
- 市值的正负号方向用用户截图里的真实数字核对过（卖出仓位显示负数，格式对得上"($305.00)"这种会计记法）
- **`P/L Day`（当日盈亏）这一列没有做**——需要"昨天收盘时的权利金"作为基准，项目里没有存这个每日基准数据，这是明确说清楚的、不是漏做的缺口

## 二、动态保证金重新设计（`margin.ts`）

### 背景

用户实测发现：一个刚开仓、现价恰好卡在卖出行权价附近的铁蝶组合，系统算出来的保证金远超真实券商（thinkorswim）的实际占用，导致"明明账户有10万美金，却连最小规模都开不起"。

### 根本原因

原来的价差/铁鹰保证金公式，是**不管现价在哪里，永远按"最坏情况全额预留"**（`width × 100 × qty - 净权利金`）。真实券商用的是**风险度量式保证金**（比如thinkorswim的TIMS）：开仓时如果现价离风险区很远，只收一小部分（大概10%左右）；现价往风险区靠近，保证金逐渐增加；现价又远离风险区，保证金又退回来。

### 解决方案

`computeComboMargin`里价差/铁鹰这部分的公式，从静态改成动态插值：
- `riskFraction`：现价从卖出行权价（安全区）往买入保护行权价（风险区）移动了多少比例，clamp在0到1之间，按方向区分（Call价差的风险在现价往上涨，Put价差的风险在现价往下跌）
- `margin = maxLoss × (MARGIN_FLOOR_PCT + riskFraction × (1 - MARGIN_FLOOR_PCT))`，`MARGIN_FLOOR_PCT = 0.10`（10%地板）

用真实数字验证过：MSFT现价507.29、卖出行权价507.5的近期组，保证金从"最坏情况全额$13800"降到了$1380，正好是10%地板，跟thinkorswim描述的行为吻合。

### 明确没做的部分

**保证金只在"生成预览/开仓"那一刻算得对，仓位开完之后不会跟着股价变动动态调整**——原因是`simAccount.ts`里`computeMarginUsed`用的是每个仓位**开仓时冻结的股价**（`p.spot`），不是实时股价。要做到"持仓过程中动态跟涨跌"，需要在保证金检查的地方改成查实时股价，这牵涉到好几个调用点，属于更大的一次改动，明确留给了以后。

## 三、跟踪对比模式集成——模拟账户持仓可以"添加到对比模式"

### 需求背景

用户观察到：分析模式的"跟踪对比模式"本质上跟模拟账户的持仓管理很像，都是"输入一个组合、看各项指标随时间变化"。希望模拟账户里的某个持仓，能一键"添加到对比模式"，用分析模式那套更丰富的图表/情景滑块工具去分析。

### 底层机制（这个必须先完全搞清楚才能做）

一条`SavedStrategy`记录 = **1个固定不变的"开仓组合"**（腿位/现价/开仓时间，存了就不再变）+ **一串会增长的"快照"**（`trackedSnapshots`，每条是某天的"今日组合"）。

### 实现的逻辑

`SimPosition`加了新字段`linkedStrategyId?: string`（**没有复用`note`字段**，因为`note`已经被财报策略占用，两个功能需要能在同一个仓位上共存，不能有格式冲突风险）。

点击"添加到对比模式"：
- 如果`linkedStrategyId`为空（第一次）：新建一条`SavedStrategy`（开仓组合=这个持仓最初开仓时的数据），**同时**立刻拉实时数据存成第一条快照，把新建的`SavedStrategy`的ID写回`linkedStrategyId`
- 如果`linkedStrategyId`已经有值（不是第一次）：只拉实时数据追加一条新快照，不新建、不覆盖开仓组合

按钮文字会根据`linkedStrategyId`是否已存在，在"添加到对比模式"和"追加快照到对比"之间切换。

### 过程中发现并修复的一个真bug（不是这次新功能引入的，是一直存在的老问题）

`App.tsx`的`handleTrack`函数（点击"跟踪"触发）**从来没有读取任何快照数据**——直接拿"开仓组合"的腿位，只把到期日按经过天数减一减就当"今日组合"显示，代码里甚至显式设置了`activeSnapshotId = null`。这导致不管一个策略有没有快照，点"跟踪"进去的第一眼永远显示"开仓组合的权利金原样复制一份"，需要手动从下拉列表里选中快照才能看到真实数据。

**已修复**：`handleTrack`现在会检查`trackedSnapshots`，如果有快照，默认加载**最新那一条**的真实数据；如果确实没有快照（比如很早以前用"保存策略"存的、从没跟踪过的老记录），才退回到原来那种"用开仓数据现算"的兜底方式。

## 四、"确认开仓"没有正确传递开仓日期——已修复

### 问题

用户发现：从分析模式点"确认开仓"转到模拟账户，**开仓日期应该是分析模式里设置的`openingAt`，但实际上永远是点击那一刻的`Date.now()`**。这导致"经过天数"显示不对，也连带影响财报策略近期组的2小时窗口计算、悔棋模式时间线的起点。

### 根本原因

`LegListSection.tsx`里"确认开仓"按钮的payload只有`{symbol, legs, spot}`，`openingAt`从来没有被带上；`openSimPosition`内部永远用`Date.now()`，没有接受覆盖的入口。

### 修复涉及的完整链路

`App.tsx`（把`openingAt`状态传给`LegListSection`）→ `LegListSection.tsx`（新增`openingAt`prop，payload里带上）→ `Shell.tsx`的`handleConfirmSimOpen`（类型更新，映射`openingAt`→`openedAt`）→ `simAccount.ts`的`openSimPosition`（新增可选的`openedAt`参数，覆盖默认的`Date.now()`）。

**另一个独立的入口`handleAddToSimAccount`（在`Shell.tsx`里，是一条不同的"快速添加到模拟账户"路径）没有做这个修复**，仍然用`Date.now()`，因为不确定这个入口具体从哪个界面触发、要不要也接上开仓日期，留给用户后续确认。

## 五、一键跳转"去分析模式看看"——从临时方案升级成真正的跳转

### 背景

财报仓位面板的"去分析模式看看"按钮，最初的实现是"把当前腿位存进策略库，提示用户去策略库手动打开"，是个临时的、多一步操作的方案。

### 升级方案

发现`App.tsx`的`simOriginInitial`预填机制（"从场景开始"流程用的那套）实际上是**通用的**——只是用来给`symbol`/`spot`/`legs`这几个`useState`设初始值，跟`simOrigin`这个布尔开关完全独立，没有任何地方写死"只有simOrigin模式才能用"。

于是给`Shell.tsx`加了一份独立的`workspaceInitial`状态，复用`App.tsx`的`simOriginInitial`prop（但这次用在**普通**分析模式视图上，不是simOrigin那个"确认开仓"界面），实现真正的一键跳转：点击后现拉实时报价，直接把腿位/现价灌进普通分析模式，落地就是一个可以正常编辑的组合。`workspaceInitial`在离开分析模式时会被清空（`handleBackFromWorkspace`），避免下次普通点开"分析模式"卡片时误加载了这条陈旧数据。

## 六、`matchStrategy.ts`——新增"不对称铁蝶"结构识别

### 问题

财报策略搭出来的近期组/远期组（真实市场行权价，两翼保护宽度几乎不可能精确对称），在UI上显示不出策略名字（空白），只有恰好对称的那一组能被认成"铁蝶策略"。

### 排查过程

先尝试"加一个新预设"（"不对称铁蝶"，示例数字是某个特定比例），发现**这条路走不通**——`matchStrategy.ts`是靠"跟某个具体预设的比例做精确匹配"，一个固定示例只能匹配到跟它比例完全一样的组合，真实市场随便搭出来的不对称比例几乎不可能跟这一个固定示例的比例吻合。

### 最终方案

在`matchStrategy`函数里加了一条**结构判断规则**（`checkIronButterflyFamily`），运行在通用的预设匹配循环之前——专门识别"两条卖出腿卡在同一个行权价（真正的ATM）+两条保护腿分居两侧"这个形状族：**两翼宽度相等就判"铁蝶策略"，不相等就判"不对称铁蝶"**，不依赖跟某个固定预设的比例是否吻合。这条规则同时检查了到期日必须一致（否则会把"双对角价差"这种到期日不同但行权价形状相似的结构也误判进来——这个问题在测试过程中被抓到并修复了）。

`presets.ts`里仍然新增了"不对称铁蝶"这个预设条目，但它现在的作用只是给预设选择器/策略库用（方便用户手动选一个模板开始搭建），实际的**识别**靠上面那条结构规则，不靠这个预设本身的比例匹配。

全部41个预设（40个原有+1个新增）跑过自我识别回归测试，0失败。

## 七、模拟账户界面的一系列小修复

这些是用户在实际测试过程中发现、逐个修复的问题，按发现顺序列出：

1. **重置账户对话框错位**（这个其实是会话开始前遗留的问题，这次会话早期修复）：`ConfirmResetAccountDialog`的渲染代码被错放在`TimelinePanel`子组件内部，导致重置功能长期不工作
2. **`openSimPosition`的ID生成有碰撞风险**：原来用`Date.now()`生成仓位ID，财报策略连续开3个仓位的场景下，如果执行够快可能落在同一毫秒导致ID重复。已修复为`Date.now() + 随机后缀`
3. **财报仓位在常规持仓列表里重复显示**：财报策略的仓位既在专属面板显示，又在下面的常规分组列表里显示了一遍。已修复为常规列表排除掉带财报标记的仓位，但"持仓中(N)"这个计数保留统计全部持仓（包括财报的），避免"计数说4、下面列表只看到1"这种视觉上的不一致
4. **"趋势"面板（`TimelinePanel`）静默隐藏对比文字**：当仓位还没有被刷新过（`marks`缓存为空）时，"最佳点位vs当前"这段对比文字直接不渲染，看起来像功能不存在。已修复为**永远显示某种文字**——数据不够就明确提示"需要先刷新才能看到对比"，不是留白

## 八、这次会话应用的一条通用设计原则（用户明确提出，要求后续都遵守）

> 功能框架要永远展示出来，哪怕当前数据或条件不满足导致功能暂时没有意义，只需要在界面上解释清楚原因即可——不能因为某个前置条件没满足就把整个功能/按钮/文字隐藏掉，否则用户可能很久都不会发现这个功能存在，甚至在发现之前就已经放弃了。

这条原则已经应用在：`TimelinePanel`的最佳点位对比文字、`EarningsPositionsPanel`里中远期组的腿位表格和平仓按钮（不再因为实时数据没加载就整体隐藏）。**接手的人在后续开发中遇到类似"某个条件不满足就隐藏UI"的写法，应该默认改成"展示框架+解释原因"，除非有明确理由不这么做。**

---

# 三、垃圾代码清理情况

这场会话中途做过一次全面的死代码扫描，确认的清单（**用户说了要自己手动清理，Claude没有交付删除后的文件**）：

1. `src/components/LegRolesPanel.tsx`——整个文件是死代码。这是"腿位作用解释"功能最早的实现方式（悬浮面板一次性列出所有腿位说明），后来改成了"每条腿自己菜单里显示"（这个逻辑现在在`legRoles.ts`里，还在用），旧的展示组件被弃用但没删
2. `src/lib/autoSync.ts`里的`isAutoSyncActive`函数——定义了但整个项目哪里都没调用过
3. `src/i18n/locales/zh.ts`和`en.ts`里11个失效的翻译key（`common.confirm`/`common.delete`/`common.none`/`common.save`/`error.appCrashDesc`/`error.appCrashTitle`/`error.reloadPage`/`leg.deselectAll`/`preset.shortStockWarning`/`roll.plusDays`/`sim.templateComingSoon`）——多数是"改了实现方式但没删旧文案"造成的

**这三类东西，截至本文档写就的时候，可能还没有被清理**（用户说自己清理，Claude没有跟进确认是否已经完成），接手的人可以核实一下现状。

---

# 四、当前已知的、明确留待后续处理的事项

按之前几轮对话里明确提到、但还没做的顺序列出：

1. **保证金持仓后不会动态跟涨跌**——只有开仓/预览那一刻算得对，需要把`computeMarginUsed`改成用实时股价而不是开仓时冻结的股价，牵涉多个调用点
2. **财报策略80%/70%阈值档**——UI占位已搭好，逻辑没做
3. **财报"方向判断"分支**——UI占位已搭好，内容没做，用户说"等做的时候会告诉你"
4. **IV Rank/Percentile真实数据**——卡在要不要接付费历史数据源，用户还没决定
5. **期限结构（Term Structure）可视化**——同一标的不同到期日的IV放一张图上对比，主要用于日历价差选到期日，提过想法但没开始做
6. **历史快照不会自动积累，只在手动点"刷新全部持仓"时记录**——讨论过"每次打开模拟账户页面自动记一次快照"这个改进方向，但因为涉及组件内部函数声明顺序（TDZ风险），特意没有在当时顺手做，留给单独一轮专门处理
7. **`handleAddToSimAccount`这个独立的"快速添加到模拟账户"入口，没有像主流程那样接上`openingAt`**，因为不确定这个入口具体从哪里触发
8. **分析模式的决策对比（`DecisionCompareDialog`）没有"对冲"这第四个对比分支**——代码注释里说是因为"对冲没有唯一确定的默认动作"，但`HedgeDialog.tsx`已经是成熟功能了，理论上可以复用它的默认方案逻辑做成四选一对比，这个是聊天中提过的改进建议，没有动手做
9. **`PayoffChart.tsx`里有4份几乎一样的情景偏移计算逻辑，是重复代码**，是修复日历价差定价bug的时候顺手发现的，不是新问题，属于技术债，没有处理
10. **IV/HV这套指标目前只在场景选择器里用**，建议接入分析模式手动搭建组合的场景，这个是聊天中提过的改进建议，没有动手做

---

# 五、文件清单速查（本次会话新建/修改的所有文件）

## 新建文件
- `src/lib/earningsStrategy.ts`
- `src/lib/earningsClosing.ts`
- `src/lib/historicalVolatility.ts`（历史波动率相关，早期财报模块讨论中建的）
- `src/components/EarningsTabRoot.tsx`
- `src/components/EarningsIvCrashTab.tsx`
- `src/components/EarningsPositionsPanel.tsx`
- `src/components/AppHeader.tsx`（App.tsx拆分出来的）
- `src/components/LegListSection.tsx`（App.tsx拆分出来的）
- `src/components/dialogs/ConfirmResetAccountDialog.tsx`
- `src/components/dialogs/ConfirmLeaveDialog.tsx`
- `src/components/dialogs/MarginErrorDialog.tsx`
- `src/lib/legRoles.ts`
- `src/lib/dateUtils.ts`（部分函数从App.tsx移出来的）
- `supabase/functions/historical-prices/index.ts`（⚠️需要手动`supabase functions deploy`部署）

## 本次会话修改过的主要文件
`App.tsx`、`Shell.tsx`、`SimulatorPage.tsx`、`ScenarioSelectorPage.tsx`、`lib/simAccount.ts`、`lib/margin.ts`、`lib/matchStrategy.ts`、`lib/presets.ts`、`lib/pricing.ts`、`lib/optionChain.ts`、`lib/scenarioEngine.ts`、`components/LegRow.tsx`、`components/StrategyBadge.tsx`、`components/ShiftSliders.tsx`、`components/ProtectDialog.tsx`、`components/RollDialog.tsx`、`components/HedgeDialog.tsx`、`i18n/locales/zh.ts`、`i18n/locales/en.ts`

## 明确标记为死代码、用户说自己清理的
`src/components/LegRolesPanel.tsx`（整个文件）、`src/lib/autoSync.ts`里的`isAutoSyncActive`函数、`zh.ts`/`en.ts`里的11个失效翻译key（清单见上面第三节）

---

# 六、给接手的人的建议

1. **第一步，先跟GitHub真实代码做一次全面比对**，确认这份文档反映的状态和实际代码库一致，再开始改动——这份文档和之前所有的代码交付，都基于Claude自己维护的本地副本，不是直接读取GitHub
2. 第四节"已知留待后续处理的事项"是最直接能接手的任务列表，按优先级或者用户当下的兴趣挑一项开始
3. 遇到"某个条件不满足就整个隐藏UI"的写法，参考第八节那条设计原则，默认改成"展示框架+解释原因"
4. 涉及`App.tsx`内部新增`useMemo`/`useCallback`的时候，注意声明顺序的TDZ风险（第一部分"关键设计原则"提过），esbuild语法检查不会抓出这类问题，需要手动核对
5. 财报策略相关的改动，注意`note`字段（财报组标记）和`linkedStrategyId`字段（对比模式关联）是两个独立字段，不要混用

已知问题：GitHub同步范围与CLAUDE.md滞后（2026-09-02发现）
问题

这个project的GitHub同步源（lixuedenon/OptionPilot, main分支）设置了文件过滤白名单，目前只包含：

/src/App.tsx
/src/lib/types.ts
/src/lib/pricing.ts
/src/lib/dateUtils.ts
/src/lib/useStockQuote.ts
/src/components/LegRow.tsx
/supabase/functions/stock-quote/index.ts

这份白名单已经过期 —— 权利金自动填充功能已经在main分支实际开发完成并上线，但相关的两个核心文件不在同步范围内，导致project内的project_search/project_read会返回旧版LegRow.tsx（没有自动填充逻辑），产生误判：

/src/lib/optionChain.ts —— 新建的客户端库，导出 fetchLegPremium / getOptionChain / premiumFromQuote，调用 option-chain Edge Function
/supabase/functions/option-chain/index.ts —— 新建的Edge Function，走Yahoo Finance期权链接口（v7/finance/options/{symbol}，含cookie+crumb令牌获取），15分钟共享缓存

已确认的实现细节：LegRow.tsx里有600ms防抖的useEffect，行权价+到期日填好且premium为0时自动调用fetchLegPremium；配一个RefreshCw图标的"恢复市场价"按钮（handleRestorePrice，force参数绕过缓存）；行权价/到期日无精确匹配时自动"贴"到最近可用值并通过priceNote提示用户。

待办（需要xue在claude.ai网页端project设置里手动操作，Claude没有改sync filter的工具权限）
在project的GitHub同步源设置里，把上面两个新文件加入过滤白名单，让project索引跟上main分支实际状态。
CLAUDE.md（第4版）里完全没提这个已上线的功能，"下一步优先级"三条（Leg Purpose收尾、AI推荐策略重新评估、App.tsx拆分）也应该在改的时候顺手确认这个功能已完成、不用再排期。
以后有新文件加入src/lib或supabase/functions但没同时加进同步白名单时，Claude在这个project里给出的"功能是否已完成"判断可能基于过期快照 —— 遇到关键判断时优先用WebFetch直接读GitHub raw内容核实，而不是只信project_search。
建议追加到CLAUDE.md的内容（草稿，供xue复制粘贴/改写后提交）

在"模块完成度"表格的分析模式一行备注里可以加一句：期权链权利金自动填充（LegRow行权价+到期日→自动拉市场权利金+恢复按钮）已完成并上线，数据源为Yahoo Finance期权链（供参考，具体措辞由你定）。

# 模拟账户改动记录（2026-09-02）

对应对话里排查的两个问题里的前两项（第三项"悔棋模式"单独处理，本轮未动）。改动已在Claude沙箱里clone仓库、实际改代码、跑esbuild+完整tsc类型检查（无新增错误，pre-existing的8个类型错误跟这次改动无关，改动前后对比过），完整文件已通过SendUserFile交付给xue，本地覆盖对应路径即可。**这些改动还没有推送到GitHub**，需要xue在本地跑`npm run dev`验证、涉及Edge Function的部分要`supabase functions deploy historical-prices`，确认无误后自己`git add && git commit && git push`。

## 改动1：分析模式→模拟账户 开仓日期丢失（已修复）

**根因**：`onAddToSimAccount`/`openSimPosition`整条payload类型链（App.tsx → Shell.tsx → simAccount.ts）从来没有`openingAt`字段，`openSimPosition`第256行写死`openedAt: Date.now()`。分析模式的`openingAt`状态本身是对的（`handleOpenStrategy`正确从保存的策略里恢复），只是没被带到模拟账户这一步。

**修法**：payload类型加`openingAt?: number`（可选），App.tsx的`handleAddToSimAccount`把当前`openingAt`状态传过去；`openSimPosition`改成`openedAt: params.openingAt ?? Date.now()`。模拟账户自己新建仓位那条路径（`handleConfirmSimOpen`，simOrigin流程）没传这个字段，继续正确落回`Date.now()`，不用动。

**涉及文件**：`src/App.tsx`、`src/Shell.tsx`、`src/lib/simAccount.ts`

## 改动2：趋势面板（Regret Mode B）缺口自动回填

**原状态**：`TimelinePanel`只显示`recordSnapshot()`记录过的真实刷新数据，没手动刷新过的日子完全没有数据点。

**新逻辑**：新增`backfillSnapshots(position)`（simAccount.ts），打开"趋势"面板时触发（`SimulatorPage.tsx`的`toggleTimeline`，改成接收整个`SimPosition`而不只是id）。对开仓日到今天（已平仓则到平仓日，两端都不含）之间、没有真实快照的每个交易日：

1. 调用`historical-prices` Edge Function拿(open+close)/2作为当日估算spot（**Edge Function本身也改了**：原来只返回`closes`，现在同时返回index对齐的`opens`和`timestamps`，供前端换算(open+close)/2 —— `historicalVolatility.ts`现有的HV计算只读`closes`字段，不受影响，已确认）
2. 用开仓时反推的IV（`impliedVol`，flat vol假设，跟`legShiftedPrice`/`decisionCompare.ts`同一套约定）+ 调整后的dte + 估算spot，走`blackScholes`算理论权利金
3. 存成`PositionSnapshot`，打上`estimated: true`标记，真实快照不会被覆盖

**UI**：`estimated`的快照用虚线边框+"(估)"标签区分，"最佳平仓点"文案如果落在估算日也会额外提示"该最佳点为估算值"。避免用户把理论估算当成真实市场成交价。

**已知限制**：这是理论BS重定价，不是真实历史期权成交价（Yahoo不提供历史期权链数据）；`historical-prices`只保留2个月窗口，仓位开仓超过2个月的更早的日子仍然回填不了；今天和已平仓日当天本身不回填（留给真实刷新/`realizedPnl`）。

## 待办（下一轮对话前情提要）

- 悔棋模式（Regret Mode A，"如果没平仓"按钮）——xue反馈"问题比较大，需要单独更改"，具体怎么改还没讨论，下次对话要先问清楚设计诉求再动手
- 本轮改动xue还没在本地验证/部署/提交