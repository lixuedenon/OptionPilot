<!-- CLAUDE.md -->

# OptionPilot 交接文档（整合版）

**版本**：整合版，更新于 2026-09-05（新增：模拟账户"复盘"曲线缓存过期不刷新的修复+图表x轴日期刻度、跟踪对比模式"已过天数"从连续24小时的`daysSince`改成按日历天数计算的`calendarDaysSince`/`calendarDaysBetween`（`dateUtils.ts`新增，`App.tsx`全部elapsed-day计算切过去）、分析↔对比模式切换入口从腿位区标题行（`LegPanelTitleRow.tsx`）移到顶部工具栏（`AppHeader.tsx`，预设策略和代码之间）、组合健康度弹窗给每项指标加了一行固定的"这项衡量的是什么"说明、**`positionHealth.ts`原来把健康度全部文案硬编码成中文，不随语言切换变化，这次改成全部通过`t()`读`zh.ts`/`en.ts`里的`health.*`键**）。**这份文档替代了之前"按会话追加"的版本**——旧版本是每轮会话在文末加一个新章节，越滚越长，找一个功能的现状要翻好几个章节、对着时间戳自己判断哪段是最新的。这份新文档改成**按功能/模块组织，只描述"现在是什么样"，不按时间顺序记流水账**。

**维护方式（重要，后续会话都要遵守）**：
- 做完一个功能改动或修复了一个bug，**直接去改对应的章节内容**，让它反映当前状态，不要在文末追加"2026-xx-xx又做了什么"这种新章节。
- 如果改动创建了新文件/新模块，在"三、文件地图"和"四、功能模块详解"里对应位置加进去。
- 如果解决了"六、已知问题"里的一条，从列表里删掉（不是标记"已完成"留着不删）。
- 如果发现了新的已知问题/技术债，加进"六、已知问题"。
- 只有在某个改动本身特殊到值得单独留痕迹时（比如一次重大架构决策、一次踩坑教训），才写成"设计笔记"性质的独立小节，正常的功能新增/bug修复不需要。
- 每次改完这份文档，**开头这个"版本"行的日期改成当天**，作为"文档更新到什么程度"的唯一时间戳，不需要维护一份变更日志。

**如果需要查历史会话的详细讨论过程**（比如某个设计决策当初为什么这么定、具体的调试过程），旧版CLAUDE.md的完整内容、以及更细粒度的分主题讨论记录，都保留在claude.ai的"options pilot"项目文档里（`claude/handoff-CLAUDE-2026-09-03.md`是旧版全文备份，`claude/wiring-check-2026-09-03.md`、`claude/mode-switch-and-restore-2026-09-03.md`、`claude/sim-account-changes-2026-09-02.md`是几次专项讨论的详细记录）。这份新文档不重复那些讨论过程，只给结论和现状。

**重要提醒（接手第一件事）**：这份文档、以及历次对话里所有的代码交付，都基于Claude自己维护的一份**本地沙盒副本**，不是直接读GitHub实时代码（除非某次会话特意说明是直接读的）。这份副本的准确性依赖于用户本地是否已经把每次交付的文件都正确落地、commit、push。**接手的人第一件事，应该是拿这份文档跟GitHub仓库（`github.com/lixuedenon/OptionPilot`，main分支）的真实文件做一次比对**，确认没有偏差再开始改动。

---

# 一、项目速览

- **项目**：OptionPilot——期权策略可视化 + 模拟交易 + AI策略推荐的Web应用
- **技术栈**：React + TypeScript + Vite + Tailwind CSS + Supabase（Edge Functions + Postgres）
- **仓库**：`github.com/lixuedenon/OptionPilot`（public）
- **本地开发路径**：`C:\Users\lixue\projects\optionpilote`，Windows + VS Code + PowerShell
- **数据源**：Yahoo Finance期权链/报价接口（免费、无需认证），通过Supabase Edge Function代理
- **用户背景**：Xue是资深期权交易者，对实盘细节（保证金动态计算、提前指派机制、财报交易策略等）有深入实战经验，经常用真实交易经验纠正理论假设

**开发/交付流程约定**（Claude在沙盒里工作，没有push权限，这套流程每轮会话都适用）：
- Claude在自己维护的本地沙盒里clone仓库、改代码、跑验证，不直接操作用户的GitHub
- 验证手段：`npm run typecheck`（`tsc --noEmit -p tsconfig.app.json`，权威的正确性检查）+ `npm run build`（vite构建，**不做类型检查**，只能抓语法/打包错误）+ `npx eslint .`（代码风格/潜在问题）
- 交付方式：完整文件通过对话交付，不是diff，减少复制粘贴出错；**每个文件第一行必须是路径注释**（代码文件`// path/to/file`，markdown文件`<!-- path -->`），这是用户明确的固定要求
- 用户拿到文件后自己本地替换、跑`npm run dev`验证、`git add/commit/push`
- **GitHub是真理来源**：本地沙盒副本可能跟真实仓库产生偏差（比如某次交付用户没应用、或者用户本地手动改过沙盒不知道的地方），涉及关键判断时优先直接读GitHub实际内容核实，不要只信这份文档或者本地沙盒状态

---

# 二、整体架构

## 路由结构

`src/main.tsx` → `src/Shell.tsx`（唯一的顶层路由，一个`useState<View>`手写的状态机，没有用路由库）。`View`的取值和对应页面：

| View | 组件 | 进入方式 |
|---|---|---|
| `home` | `HomePage.tsx` | 默认首页，四张模块卡片：分析/跟踪/模拟/AI |
| `workspace` | `App.tsx`（`isCompareMode = trackedLegs !== null`） | 点"分析"卡片（普通模式）或"跟踪"卡片（`autoOpenManage=true`，进去自动弹策略管理对话框） |
| `simOrigin` | `App.tsx`（`simOrigin` prop为true，不同的"确认开仓"UI） | 模拟账户"新建仓位"、或从场景选择器"使用这个"跳转过来 |
| `simulator` | `SimulatorPage.tsx` | 首页"模拟"卡片、或`simOrigin`确认开仓成功后跳转 |
| `scenarioSelector` | `ScenarioSelectorPage.tsx` | 模拟账户页面里的"从场景开始"入口 |
| `ai` | `AIStrategyPage.tsx` | 首页"AI"卡片 |

`Shell.tsx`自己管理几个跨view状态：`marginError`（保证金不足弹窗，`simOrigin`和`workspace`两个入口都可能触发，渲染在`content`外层做全局覆盖层）、`simOriginInitial`/`cameFromScenario`/`scenarioState`（场景选择器→`simOrigin`往返所需的预填数据和"取消后回哪里"的记忆）。

## `App.tsx`是核心，一个组件承担两种模式

`App.tsx`（当前约1524行，是全项目最大、最核心的文件）**同时承担"分析模式"和"跟踪对比模式"两种UI**，不是两个组件——区分靠一个派生状态：

```
isCompareMode = trackedLegs !== null
```

两套并行的数据：
- **`legs`/`spot`/`openingAt`**（开仓组合/分析模式基线）——分析模式下可以自由编辑；对比模式下渲染成"开仓组合"那一块，只读展示（除非通过"恢复"按钮把它对齐回原始数据）
- **`trackedLegs`/`trackedSpot`/`effectiveTrackedSpot`**（持仓组合/今日组合）——只在对比模式下存在，可编辑，代表"这个组合现在的实际状态"

这两套数据通过`trackingStrategyId`（可能为`null`）关联到一条持久化的`SavedStrategy`记录（见下面"策略库"一节的数据模型）。`App.tsx`内部按功能拆成了几个presentational子组件（见"三、文件地图"），但**状态管理和事件处理逻辑几乎全部留在`App.tsx`本体**，子组件基本是"纯JSX + props透传"，没有自己的state（详见"四、6"App.tsx结构小节）。

---

# 三、文件地图

## 顶层页面（`src/*.tsx`）

| 文件 | 行数 | 职责 |
|---|---|---|
| `Shell.tsx` | ~167 | 顶层路由状态机（见上）|
| `HomePage.tsx` | ~132 | 首页四张模块卡片 |
| `App.tsx` | ~1524 | 分析模式+对比模式，核心工作区（见下方专门小节）|
| `SimulatorPage.tsx` | ~1618 | 模拟账户页面，全项目第二大文件——仓位列表、开平仓、保证金展示、财报仓位面板、趋势/悔棋面板 |
| `ScenarioSelectorPage.tsx` | ~571 | "从场景开始"三标签页：方向判断（场景引擎推荐）/财报（IV Crash入口）/待定（占位）|
| `AIStrategyPage.tsx` | ~146 | AI四模型策略推荐页面，**当前是开发预览版**，见"四、7" |
| `ComingSoonPage.tsx` | ~43 | 通用"敬请期待"占位页 |
| `main.tsx` | 12 | React入口 |

## `src/components/`（可复用UI组件，非页面）

按用途分组：

**分析/对比模式的直接子组件**（专为`App.tsx`拆分出来，语义上属于`App.tsx`的一部分）：
- `AppHeader.tsx`（~300行）——顶部header：预设策略、**分析↔对比模式切换按钮/下拉菜单**（2026-09-05从`LegPanelTitleRow.tsx`移过来，位置固定在"预设策略"和"代码"输入框之间）、标的输入+联想、现价、帮助按钮等
- `LegListSection.tsx`（~288行）——腿位列表区：批量操作工具栏（全选/清空/批量删除/保存策略组合按钮）+ 逐条`LegRow`
- `LegPanelTitleRow.tsx`（~44行）——腿位区标题行：策略徽章、腿数、"对比模式"状态徽章。**模式切换按钮/下拉菜单2026-09-05移到了`AppHeader.tsx`**，这里现在只负责展示当前处于哪个模式，不再负责切换
- `TrackedComboSection.tsx`（~190行）——对比模式"今日组合"整块：快照选择器、保存按钮、开仓vs当前统计网格、腿位列表
- `LegActionDialogs.tsx`（~159行）——leg级别弹窗集合（保存预设/清空确认/批量删除确认/丢弃追踪确认/展期/保护/对冲/决策对比/隐含现价说明），纯转发props给各自的真实弹窗组件
- `StrategyPersistenceDialogs.tsx`（~133行）——策略保存/切换/离开相关弹窗集合（预设切换确认/替换确认/离开确认/模式切换确认/保存策略对话框/管理策略对话框）
- `LegRow.tsx`（~752行，全项目最大的单个组件）——单条腿位的编辑行，含**期权链自动填充逻辑**（见"四、1.2"）

**分析模式的其他功能组件**：
- `PayoffChart.tsx`（~934行）——到期损益图，SVG绘制，含情景滑块联动、对比模式双线叠加
- `PnlAttributionPanel.tsx`——P/L归因面板（滑块驱动/跟踪对比两种模式）
- `PositionHealthBadge.tsx`——组合健康度徽章
- `ShiftSliders.tsx`——情景滑块（现价/时间/波动率三个维度）
- `StrategyBadge.tsx`——策略名称徽章（含`dirKeyMap`，别处也在用）
- `DecisionCompareDialog.tsx`——决策对比弹窗（不动/平仓/展期三选一对比）
- `RollDialog.tsx` / `ProtectDialog.tsx` / `HedgeDialog.tsx`——展期/保护/对冲三个操作弹窗
- `SavePresetDialog.tsx` / `PresetPicker.tsx`——自定义预设保存/选择
- `SaveStrategyDialog.tsx` / `ManageStrategiesDialog.tsx`——保存策略/管理已存策略（含跟踪、置顶、重命名、删除）
- `DropdownMenu.tsx`——通用下拉菜单（render-prop `children: (close) => ReactNode`）

**财报策略专用**：
- `EarningsTabRoot.tsx`——财报标签顶层导航（IV Crash vs 方向判断 vs 阈值档位选择）
- `EarningsIvCrashTab.tsx`——90%档IV Crash完整开仓流程UI
- `EarningsPositionsPanel.tsx`（~344行）——财报仓位专属管理面板

**其他**：
- `ErrorBoundary.tsx`——React错误边界，每个Shell view都包了一层
- `LanguageSwitcher.tsx`——中英文切换

## `src/components/dialogs/`（小型确认弹窗集合，`index.ts`统一导出）

`AlertCard.tsx`、`HelpPanel.tsx`、`ImpliedSpotInfoPanel.tsx`、`MarginErrorDialog.tsx`、`ConfirmClearDialog.tsx`、`ConfirmBulkDeleteDialog.tsx`、`ConfirmSaveTrackedDialog.tsx`、`ConfirmSnapshotDialog.tsx`（预设切换和模式切换两处复用同一个组件）、`ConfirmReplacePresetDialog.tsx`、`ConfirmLeaveDialog.tsx`、`ConfirmResetAccountDialog.tsx`——全是纯展示型的小确认框，逻辑都在调用方。

## `src/hooks/`

- `useAutoSync.ts`——文件系统自动同步hook（配合`lib/autoSync.ts`）
- `useCustomPresets.ts`——自定义预设的加载/增删状态封装
- `useSavedStrategies.ts`——已存策略列表的加载/增删状态封装
- `useLegEditing.ts`——（2026-09-04新增）开仓组合单腿的增删改、批量选择/批量屏蔽/批量删除、展期/保护/对冲/比较四个弹窗的目标状态，以及`moveLeg`/`moveTrackedLeg`两个顺序调整函数。从`App.tsx`拆出，接收`{legs, setLegs, setTrackedLegs}`

## `src/lib/`（核心业务逻辑，无UI）

**定价与组合计算**：
- `types.ts`——`Leg`/`Shifts`/`GreekBreakdown`等核心类型定义
- `bs.ts`——Black-Scholes定价模型+希腊字母
- `pricing.ts`（~478行，核心算法文件）——`priceCombo`（组合定价+归因）、`payoffCurvePoints`、`probabilityOfProfit`、`findBreakevens`、`maxProfitLoss`、`impliedVol`/`impliedSpotFromPremiums`、`attributePnl`（P/L归因）等
- `legRoles.ts`——腿位角色解释（这条腿在组合里扮演什么角色，供逐条腿展示用）
- `legFactory.ts`——`uid`/`blankLeg`/`PRESET_DTE_SET`几个创建腿位用的小helper（从`App.tsx`拆出）
- `matchStrategy.ts`——从一组腿位反推策略名字（含"不对称铁蝶"结构识别，见"四、2.3"）
- `positionHealth.ts`——组合健康度评分（四维度各25分）。`computeHealth(legs, spot, shifts, breakdown, t)`**必须传入`t`**（`useI18n()`的翻译函数）——文件里没有React/JSX，故意不从`I18nContext.tsx`导入类型，本地声明了一个结构相同的`TFunc`别名；每条`HealthFactor`除了`label`/`status`/`note`，还有一个`meaning`字段（2026-09-05新增），是独立于当前数值的固定说明句，比如"距盈亏平衡点"的`meaning`固定解释"盈亏平衡点是什么、距离越大越安全"，展示在弹窗里`note`下面一行、颜色更淡，帮用户理解这个指标本身在测什么，不用每次都去问。调用方（`App.tsx`里的`positionHealth`那个`useMemo`）依赖数组必须包含`t`（或它依赖的`lang`），否则切换语言健康度文案不会跟着变
- `decisionCompare.ts`——决策对比的核心计算（不动/平仓/展期三分支）

**策略库/预设**：
- `savedStrategies.ts`（~224行）——`SavedStrategy`/`TrackedSnapshot`数据模型+CRUD（localStorage存储），见"四、2.1"
- `presets.ts`（~578行）——内置策略预设库（41个模板）
- `customPresets.ts`——用户自定义预设的类型+存储

**期权链/行情**：
- `optionChain.ts`（~192行）——客户端期权链库：`getOptionChain`/`peekResolvedChain`/`fetchLegPremium`/`nearestStrikeToSpot`/`nearestStrikeQuote`/`resolveFromCache`，调用`option-chain` Edge Function，带promise级缓存
- `useStockQuote.ts`——实时现价hook+`fetchSpotPrice`
- `historicalVolatility.ts`——历史波动率计算（`computeHV`）+ IV/HV比值判断（`computeIvHvNote`：`sellRich`/`buyCheap`/`stillRich`三分类）
- `recentSymbols.ts`——最近查询过的标的记录（localStorage）

**日期/工具**：
- `dateUtils.ts`——`todayISO`/`dateFromDte`/`dteFromDate`/`nearestFridayDte`/`formatDateInput`/`parseDateInput`/`daysSince`（旧的、按连续24小时算的"距今天数"，`daysSince(ts) = (Date.now()-ts)/86400000`）/**`daysBetweenLocalDates`/`calendarDaysBetween`/`calendarDaysSince`**（2026-09-05新增，按日历日期算天数，不受时分秒影响；`daysBetweenLocalDates`原本定义在`simAccount.ts`里，这次挪到这里作为全项目统一实现，`simAccount.ts`改成从这里导入+`export`回去保持原有导入路径不变）。`App.tsx`里所有"已过X天"相关计算（`handleTrack`/`handleSelectSnapshot`/`handleUpdateSnapshotTime`/`handleSwitchToCompare`）已经全部从`daysSince`切到`calendarDaysSince`——**教训**：`daysSince`是连续24小时窗口，9月1日23点开仓、9月4日早上8点查看，只经过了约2.05天，`Math.round`出来是"2天"，但从日历日期上看已经跨过了9/1→9/2→9/3→9/4三个日期边界，用户直觉认为应该是"3天"；`SimulatorPage.tsx`模拟账户那边的复盘功能一直用的是日历天数（`daysBetweenLocalDates`），这次是把跟踪对比模式也统一到同一套约定上。**新代码凡是给用户看的"已过几天"，一律用`calendarDaysSince`/`calendarDaysBetween`，不要再引入新的`daysSince`调用**——`daysSince`本身没删，只是不再是"已过天数"这类展示用途的正确选择
- `miniMarkdown.tsx`——极简markdown渲染（AI策略页面用）

**模拟账户**：
- `simAccount.ts`（~553行）——`SimPosition`/`SimAccount`/`PositionSnapshot`数据模型+CRUD、`computeMarginUsed`/`computeAvailableCapital`/`checkMarginForOpen`（保证金检查）、`analyzeBestExit`（悔棋模式用）、`computeCostBasis`/`computeMarkValue`
- `margin.ts`（~243行）——`computeComboMargin`，动态保证金插值算法（见"四、4.2"）

**财报策略**：
- `earningsStrategy.ts`（~204行）——三组结构定义、期权链取值、仓位大小反推、聚合预览
- `earningsClosing.ts`——平仓阶段判断逻辑（近期组2小时窗口、中远期组三分支）

**场景引擎**：
- `scenarioEngine.ts`（~697行）——固定查表式场景推荐（`SCENARIO_RULES`覆盖30种桶组合）、`computeBucketBounds`、`rankPresetsForScenario`

**数据备份/同步**：
- `dataTransfer.ts`——导出/导入整个应用数据（`ExportData`，含策略库/自定义预设/最近标的/模拟账户，version 1→2 演进过）
- `autoSync.ts`——File System Access API自动同步到本地文件（IndexedDB存文件句柄）

## `src/i18n/`

`I18nContext.tsx`（`useI18n()` hook + `t(key, vars?)`，`vars`按`{key}`占位符做字符串替换）、`translations.ts`、`locales/zh.ts`+`locales/en.ts`（各~620+行，键值对翻译文件，两个文件的key必须一一对应、顺序保持一致，方便对照检查有没有漏翻）。**`health.*`一组键（2026-09-05新增）是目前唯一一处"非组件的纯lib文件也要吃i18n"的例子**——`positionHealth.ts`把标签/数值模板/状态后缀/静态说明/summary拼接逻辑全部读自这组键，包括容易被忽略的标点符号（比如标签后面的"："在中文是全角冒号、英文应该是"`: `"，这次连这个都单独做了`health.labelSeparator`键，之前是直接硬编码在`PositionHealthBadge.tsx`的JSX里）。

## `supabase/`

**Edge Functions**（`supabase/functions/`）：
- `stock-quote/index.ts`——实时现价代理
- `option-chain/index.ts`——期权链代理（Yahoo Finance `v7/finance/options`，cookie+crumb认证，服务端共享缓存`option_chain_cache`表15分钟TTL）
- `historical-prices/index.ts`——历史价格代理（同时返回`opens`/`closes`/`timestamps`，供趋势面板回填用，只保留2个月窗口）
- `market-context/index.ts`——市场大盘背景数据（AI策略推荐用）
- `strategy-analysis/index.ts`——AI策略分析（对应`AIStrategyPage.tsx`的后端，目前是开发预览阶段，见"四、7"）
- `_shared/`——`bs.ts`（服务端BS定价副本）、`deltaMatch.ts`、`buildPrompt.ts`、`technicalIndicators.ts`

**数据库迁移**（`supabase/migrations/`）：`create_option_chain_cache.sql`、`create_user_data_tables.sql`

⚠️ Edge Function改动需要用户手动`supabase functions deploy <name>`部署，Claude在沙盒里改的代码不会自动生效到线上。

---

# 四、功能模块详解

## 1. 期权组合编辑器（分析模式核心）

### 1.1 基本交互

用户在`LegListSection.tsx`里逐条添加/编辑腿位（`LegRow.tsx`）：方向（买/卖）、类型（call/put/正股）、行权价、到期日（DTE或具体日期）、权利金、数量。`pricing.ts`的`priceCombo`实时计算组合净权利金、情景滑块下的盈亏、希腊字母归因。`PayoffChart.tsx`画到期损益曲线。`matchStrategy.ts`尝试识别出这是什么策略并显示徽章。

### 1.2 期权链自动填充（`LegRow.tsx` + `optionChain.ts` + `option-chain` Edge Function）

**触发时机**：行权价和到期日都填好、且当前权利金为0时，600ms防抖后自动调用`fetchLegPremium`拉市场权利金。

**恢复按钮**：`RefreshCw`图标，`handleRestorePrice`，`force`参数可以绕过缓存强制重新拉取。**这个按钮在两个地方语义不同**：
- 分析模式本身、以及对比模式下方的"持仓组合"——按钮拉**今天的实时市场价**（原本的行为）
- 对比模式上方的"开仓组合"——按钮恢复成**当初分析模式记录的历史开仓数据**（`LegRow.tsx`的`restoreOriginal?: {strike, dte, premium}`prop，传了这个prop时恢复变成同步操作、不发网络请求；`LegListSection.tsx`按**位置索引**匹配对应`SavedStrategy`的原始腿位算出这个值；没有backing的`SavedStrategy`时自动退回拉实时价的行为）

**行权价/到期日容错**：无精确匹配时自动"贴"到最近可用值，通过`priceNote`提示用户。

### 1.3 换标的代码时，现有组合按比例重新映射行权价

**行为**：分析模式和对比模式下，只要现有组合不是空的，改标的代码（不是同一标的的报价刷新，是真的换了一个新symbol）会自动把所有腿位的行权价按新旧现价的比例重新计算，优先命中新标的真实挂牌的行权价（`resolveFromCache`），命中不了就退回等比例估算+权利金置0，交给"四、1.2"提到的per-leg自动填充effect后续纠正。对比模式下，"开仓组合"（`legs`）和"今日组合"（`trackedLegs`）两边都会一起重新映射，不是只映射一边。

**实现**：`App.tsx`里`rescaleForNewSymbol`这个共用函数，被一个统一的`useEffect`（依赖`[quote, spot]`，实时报价一到就跑）调用。判断"是不是真的换了标的"，靠`legBaseSpot`/`legBaseSymbol`这两个ref记录的"上一次的基准现价/基准标的"跟当前`symbol`是否一致——一致就是同一标的的报价刷新（只更新spot/trackedSpot，不碰行权价），不一致且组合不为空、且这两个ref之前已经有过基准值，才判定为"换标的"，触发重新映射。

**丢数据保护**：对比模式下如果"今日组合"有未保存的改动（`trackedDirty`），换标的会先弹`ConfirmSnapshotDialog`（取消/不保存直接换/先存一条快照再换），跟预设切换、模式切换用的是同一个确认框组件——见"四、3.2"。取消会把标的代码输入框还原回原来的标的（避免输入框显示新标的、但组合还是旧标的行权价这种不一致状态）。

**这个功能之前是坏的，这次修复的根因**：`spotManuallySet`这个ref本来的用途应该是"用户手动在现价输入框敲了一个跟实时报价不一样的数字，之后live quote刷新不要把它悄悄覆盖掉"——但打开已存策略、追踪策略、模式切换这几个正常操作路径，都会把这个ref设成`true`且从不重置回`false`。现实中只要用户不是完全从空组合手搭一遍（几乎不可能），这个ref迟早会变成`true`，之后不管改哪个标的，行权价和现价display全部原地不动，因为原来的换标的重新映射逻辑被挡在`if (spotManuallySet.current) return;`后面。对比模式下更彻底——那段effect一进对比模式分支就直接`setTrackedSpot(...); return;`，完全没走到重新映射那段代码，不管`spotManuallySet`是什么状态都不会生效。修复方式：把"换标的"这件事从`spotManuallySet`的管辖范围里独立出来，只要检测到symbol真的变了，不管`spotManuallySet`是什么状态都强制重新映射，并把`spotManuallySet`重置为`false`（旧标的下的手动现价覆盖，对新标的没有意义）；对比模式也补上了同样的重新映射，不再只更新`trackedSpot`就return。

### 1.4 情景滑块 / P/L归因 / 组合健康度

- `ShiftSliders.tsx`：现价（dS）、时间（dT）、波动率（dV）三个维度的滑块，驱动`PayoffChart`和归因面板重算
- `PnlAttributionPanel.tsx` + `pricing.ts`的`attributePnl`：把盈亏拆成"哪个维度贡献了多少"，滑块驱动模式和跟踪对比模式两种数据源
- `PositionHealthBadge.tsx` + `positionHealth.ts`：四维度各25分——到期盈利概率(POP)、距盈亏平衡点距离、临近到期的Gamma风险、每张合约平均Delta归一化。**"到期结果"类指标（maxProfit/maxLoss、POP、健康度评分）默认不跟随情景滑块**——这些描述的是组合的内在属性，健康度是刻意做的例外，它跟随滑块。风险回报比这个维度被从健康度里删掉了（会系统性惩罚卖方策略）

### 1.5 决策对比（`DecisionCompareDialog.tsx` + `decisionCompare.ts`）

针对单条腿，用真实期权链数据对比"不动/平仓/展期"三种结果的盈亏。**没有"对冲"这第四个对比分支**——`HedgeDialog.tsx`已经是成熟功能，理论上可以复用其默认方案逻辑做成四选一，属于backlog（见"六"）。决策对比停留在分析模式，不受情景滑块影响的语义是"预演未来"，跟归因面板的滑块驱动是并列的不同用例。

## 2. 策略库（保存/加载/管理/预设）

### 2.1 数据模型（`savedStrategies.ts`）

一条`SavedStrategy` = **1个固定不变的"开仓组合"**（`legs`/`spot`/`shifts`/`openingAt`，存了就不再变）+ **一串会增长的"快照"**（`trackedSnapshots: TrackedSnapshot[]`，每条是某天的"今日组合"实际数据）。存储在localStorage。

关键函数：`saveStrategy`/`overwriteStrategy`/`deleteSavedStrategy`/`renameSavedStrategy`/`toggleStarStrategy`/`toggleTrackStrategy`/`addTrackedSnapshot`/`updateSnapshotTime`/`deleteTrackedSnapshot`/`generateFilename`（自动生成文件名）/`findDuplicate`（判重）/`serializeStrategyState`（把整个组合状态序列化成字符串，供`trackedDirty`用`!==`做脏检查，比深比较便宜）。

### 2.2 预设库（`presets.ts` + `customPresets.ts` + `PresetPicker.tsx`）

内置41个策略预设模板（跨式/宽跨式/垂直价差/铁鹰/铁蝶/日历价差等），"只收录真正常见、成熟的策略，不为了凑数量加边缘变体"。用户可以从预设开始搭建，也可以自己搭完存成`CustomPreset`。跨式两腿锁定同一个ATM行权价；宽跨式两腿都要保持OTM。

### 2.3 策略识别（`matchStrategy.ts`）

反过来，从一组腿位识别出策略名字给徽章用。除了跟41个预设做比例匹配之外，有一条独立的**结构判断规则**`checkIronButterflyFamily`，专门识别"两条卖出腿卡在同一行权价+两条保护腿分居两侧"这个形状族，不依赖固定预设的比例是否吻合——两翼宽度相等判"铁蝶"，不相等判"不对称铁蝶"（真实市场搭出来的财报策略组合，两翼宽度几乎不可能精确对称，这条规则就是为了覆盖这种情况新加的）。这条规则同时检查到期日必须一致，避免误判"双对角价差"。

### 2.4 管理界面（`ManageStrategiesDialog.tsx`）

列表、置顶、重命名、删除、"跟踪"（进入对比模式，见"四、3"）。

## 3. 跟踪对比模式（"今日组合"）

### 3.1 进入方式

三条路径，行为略有不同：
1. **首页"跟踪"卡片** → `App.tsx`的`autoOpenManage=true` → 自动弹出管理策略对话框选一条已存策略"跟踪"
2. **`handleTrack`**（点已存策略的"跟踪"按钮）：检查这条策略的`trackedSnapshots`，如果有快照，默认加载**最新那一条**的真实数据（决定DTE的衰减也是从这条快照自己的`savedAt`算起，不是从策略的`openingAt`算——跟`handleSelectSnapshot`选某条快照时的算法一致）；没有快照（比如很早以前用"保存策略"存的、从没跟踪过的老记录）才退回用开仓数据现算今日DTE。**这条逻辑2026-09-04发现在代码里丢失过一次**——`App.tsx`实际代码曾经退化成"不管有没有快照，永远从开仓组合现算"，导致已经追踪过的策略，点"跟踪"进去"今日组合"显示的是开仓组合的权利金，不是上次保存的真实数据；点"保存追踪快照"时表面看是保存了当前显示的内容，但因为显示的内容本身就是错的（等于开仓组合），看起来就像"保存的是策略组合的内容"。已经用真实操作路径（不是只靠typecheck）验证过重新修好。**这类"文档说已经修复，但代码实际退化回去了"的偏差，是这份本地沙盒副本的已知风险（见文档开头的提醒）——遇到"这个不是应该已经修好了吗"的报告，先去读实际代码确认，不要直接相信文档的描述。**
3. **模式直接切换**（`handleSwitchToCompare`，分析模式左上角按钮）：把当前正在编辑的`legs`/`spot`/`openingAt`直接作为对比模式的开仓组合+持仓组合初始值（`trackedLegs`就是`legs`的一份新拷贝，"已过0天"）。`trackingStrategyId`**不是无条件设为`null`**——2026-09-04修过一个bug：以前这里永远设`null`，导致"打开策略"（`handleOpenStrategy`，同样把`trackingStrategyId`留空）之后直接点"切换到对比模式"，哪怕这条策略之前已经跟踪过、存过快照，"持仓组合"header也完全看不到快照选择器（`TrackedComboSection.tsx`里`trackedStrategy?.trackedSnapshots`读到的是`undefined`），跟用户报的"以前保存的跟踪快照看不到"完全对应。现在改成先用`findDuplicate`（跟`handleSaveTracked`那次判重是同一个函数/同一个思路）检查当前开仓组合是不是跟某条已存策略完全一致，一致的话把`trackingStrategyId`设成那条策略的id——`trackedLegs`本身还是保持"刚切换、等于开仓组合"不变（这个入口的语义就是"现在"，不代表要把用户拉回某条历史快照），但快照选择器会重新出现，用户可以自己从下拉框里挑一条历史快照看，也可以正常点"保存追踪快照"续存到同一条策略上，不会另外产生一条重复记录。

### 3.2 模式直接切换（分析模式 ↔ 对比模式，不用退回首页）

顶部工具栏（`AppHeader.tsx`，"预设策略"和"代码"输入框之间，2026-09-05从`LegPanelTitleRow.tsx`移过来的）有直接切换入口：

- **分析→对比**（`handleSwitchToCompare`）：见上，`trackingStrategyId`视`findDuplicate`结果而定，不再无条件为`null`
- **对比→分析**（`handleSwitchToAnalysis`，下拉菜单三选一）：
  - **原始基准数据**：`legs`/`spot`/`openingAt`原样不变
  - **调整后的数据**：当前"持仓组合"这份（`trackedLegs`/`effectiveTrackedSpot`），开仓日期改成"现在"
  - **某条快照**：从快照列表选一条，开仓日期改成那条快照的保存日期
  - **为什么后两种情况开仓日期要重置**：这些腿位的DTE已经被对比模式按经过天数减过一次了，如果开仓日期还留最早那天，以后再存成策略、再"追踪"回对比模式，会拿这个过旧的开仓日期重新算一次经过天数、再减一次DTE，等于减了两次。选"原始基准数据"不存在这个问题（DTE本来没减过）
- 分析模式的payoff曲线本身不读`openingAt`（`priceCombo(activeLegs, shifts, spot)`），三种选择切回来曲线立刻按新基准正确显示

**丢数据保护**：切到分析模式时，如果"持仓组合"有未保存改动（`trackedDirty === true`）且选的不是"调整后的数据"（选这个改动本身会被带过去，不存在丢失），会先弹确认框（取消/不保存直接切/先存一条快照再切）——复用`ConfirmSnapshotDialog`（跟预设切换共用同一个组件），机制是`pendingSwitchSource`ref + `confirmSwitchOpen`state，`handleSwitchToAnalysis`是对外守卫入口，`performSwitchToAnalysis`是内部真正执行切换的函数。

### 3.3 保存快照 / 保存策略组合

入口位置：**保存追踪快照**在"持仓组合"（今日组合）那一行最右边，常驻按钮，`disabled={!trackedDirty}`；**保存策略组合**在"全选"那一行最右边（`LegListSection.tsx`的`canSaveStrategy`/`onSaveStrategy`props），常驻显示，不依赖是否有腿位被选中。左上角"策略库"下拉菜单现在只剩"管理策略"一项。

**保存追踪快照的完整逻辑**（`handleSaveTracked`）：
- 有`trackingStrategyId`（比如通过`handleTrack`进来的）：直接调用`saveTrackedSnapshotTo(strategyId)`，追加一条快照
- 没有`trackingStrategyId`（比如通过"模式直接切换"进来、或者"打开策略"之后又直接切到对比模式而不是走"跟踪"，都还没有`trackingStrategyId`）：先用`findDuplicate`（跟`SaveStrategyDialog`自己保存前做的判重检查是同一个函数）看当前"开仓组合"（symbol+legs组合，不含快照/今日组合那部分）是不是已经跟某条已存策略完全一致——**是的话直接静默把那条已存策略的id写回`trackingStrategyId`，调用`saveTrackedSnapshotTo`存快照，不弹任何对话框**；只有真的找不到匹配（这个组合从没存过），才设置`pendingSaveTrackedAfterStrategy`ref、弹出`SaveStrategyDialog`让用户起名保存，保存成功后（`handleSaveStrategy`/`handleOverwriteStrategy`内部检查这个ref）自动把新建/被覆盖的策略id写回`trackingStrategyId`，再调用`saveTrackedSnapshotTo`存上这次的快照。之后同一session里再点保存就是正常的追加路径。

这条"没有`trackingStrategyId`就先弹保存策略对话框"的分支，最早是修复一个真实bug后加上的——早期版本`handleSaveTracked`第一行直接`if (!trackingStrategyId) return;`，"模式直接切换"这条路径加进来之后，会让"保存追踪快照"按钮在这条路径下完全无反应，没有任何提示。**这类"一个功能让某个state从总是有值变成可能为null，导致另一个假设它有值的功能静默失效"的bug，`npm run typecheck`抓不出来**（类型层面`trackingStrategyId`本来就是`string | null`，完全合法），只能靠实际操作路径测试。加新功能时如果会改变某个已有state"总有值"的假设，值得回头检查所有依赖这个假设的地方。

但这个"先弹SaveStrategyDialog"的兜底本身后来又暴露了第二层问题（2026-09-04修复）：如果这个开仓组合其实**已经**存过（比如"打开策略"打开的、或者刚点过"保存策略组合"），`SaveStrategyDialog`自己内部的判重逻辑会检测到重复，弹出"已经存在，是否覆盖"的二次确认——用户在对比模式切回分析模式、只是想顺手存一条快照的场景下，会连续经历"是否保存快照→保存策略组合对话框→已存在是否覆盖"三层确认，而其中第2、3层完全是多余的（这条策略组合本身不需要改动，只是缺一个id可以挂快照）。修法就是上面说的先做`findDuplicate`判重、命中就跳过整个`SaveStrategyDialog`。

### 3.4 "开仓组合"恢复按钮的语义

见"四、1.2"——对比模式上方"开仓组合"的恢复按钮，恢复的是历史开仓数据而不是今天市场价，跟其他地方的恢复按钮语义不同。

### 3.5 对比模式下开仓时间锁定

"开仓价"+"开仓日期"输入框整个包在`{!isCompareMode && (...)}`里，对比模式下不渲染，本来就是锁定的。**容易搞混的点**：对比模式"开仓组合"header里那个日期选择器，改的是**当前选中快照的保存时间**（`activeSnap.savedAt`），不是`openingAt`，是两个不同字段——命名/tooltip目前没有特别强调这个区别。

## 4. 模拟账户（`SimulatorPage.tsx` + `simAccount.ts`）

### 4.1 基本机制

`SimAccount`（余额）+ `SimPosition[]`（开仓/平仓仓位，localStorage存储）。开仓来源：`Shell.tsx`的`handleConfirmSimOpen`（`simOrigin`流程，走`App.tsx`的确认开仓界面）和`handleAddToSimAccount`（分析模式的"添加到模拟账户"快捷方式）。批量平仓支持按仓位分组的复选框。

`SimPosition`有两个独立的标记字段，**不要混用**：
- `note`：财报策略仓位标记，格式`earnings-iv-crash:{group}:{batchId}`（见"四、5.3"）
- `linkedStrategyId`：跟踪对比模式关联（见"四、3.1"第2点相关，模拟仓位一键"添加到对比模式"用）

### 4.2 动态保证金（`margin.ts`）

**背景**：原来的价差/铁鹰保证金公式不管现价在哪里永远按"最坏情况全额预留"（`width × 100 × qty - 净权利金`），导致刚开仓、现价卡在卖出行权价附近的组合，算出来的保证金远超真实券商（thinkorswim）实际占用。

**方案**：改成动态插值，模拟真实券商的风险度量式保证金（TIMS）行为——`riskFraction`（现价从卖出行权价往买入保护行权价方向移动了多少比例，clamp在0~1，按Call/Put方向区分）→ `margin = maxLoss × (0.10 + riskFraction × 0.90)`（10%地板）。用MSFT真实数字验证过：保证金从"最坏情况全额$13800"降到$1380，正好10%地板，跟thinkorswim行为吻合。

**已知限制**：只在"生成预览/开仓"那一刻算得对，**仓位开完之后不会跟着股价变动动态调整**——`computeMarginUsed`用的是每个仓位开仓时冻结的股价（`p.spot`），不是实时股价，要做到动态跟涨跌需要改成查实时股价，牵涉多个调用点（见"六"backlog）。

### 4.3 趋势面板 / 悔棋模式（Regret Mode）

`TimelinePanel`（`SimulatorPage.tsx`内部）显示仓位从开仓到现在的历史快照走势和"最佳平仓点 vs 当前"对比。

**自动回填缺口**：历史快照原本只在手动点"刷新全部持仓"时记录，没刷新过的日子没有数据点。`backfillSnapshots`（打开"趋势"面板时触发）对开仓日到今天（或平仓日）之间没有真实快照的每个交易日：调`historical-prices` Edge Function拿(open+close)/2估算当日spot → 用开仓时反推的IV（flat vol假设）+ 调整后dte + 估算spot走Black-Scholes算理论权利金 → 存成`PositionSnapshot`并打上`estimated: true`标记。UI上用虚线边框+"(估)"标签区分估算值和真实成交快照，避免误认成真实市场价。**限制**：这是理论BS重定价，不是真实历史期权成交价（Yahoo不提供）；`historical-prices`只保留2个月窗口，更早的日子回填不了；今天和平仓当天本身不回填。

**悔棋模式（"如果没平仓"按钮）**：用户反馈过"问题比较大"，具体怎么改还没有讨论清楚，是backlog（见"六"）。

**"复盘"曲线缓存过期不刷新的修复（2026-09-05）**：`toggleTimeline`原来只在`!timelines[pos.id]`（这个仓位从没加载过Timeline）时才去请求数据，加载过一次之后不管后台又通过"刷新全部持仓"记录了多少条新的真实快照，面板里展示的曲线永远是第一次打开时的旧数据——症状是"明明这个仓位已经开了好几天，复盘曲线却只往前走了一天"，而同一时间从财报流程开仓的仓位曲线是正常的（因为财报那批仓位打开复盘面板的时机凑巧跟快照记录时机没有错开，掩盖了这个问题）。修法：新增`timelinesDate`（记录每个仓位当前缓存的Timeline是哪一天算出来的），`toggleTimeline`的判断条件改成`!timelines[pos.id] || timelinesDate[pos.id] !== todayISO`；`refreshAllPositions`里每次`recordSnapshot`成功后主动清空这个仓位的Timeline缓存，如果面板当前是展开状态就立即重新`backfillSnapshots`拉一份新的。**图表x轴日期刻度**：同一批修复顺手加的，`SimulatorPage.tsx`里`xAtElapsed`基础上新增起点/中点/终点三个刻度（按最小像素间距`MIN_TICK_PX=34`去重），图表高度为此预留了`TICK_AREA_H=11`的刻度区。

**"某个条件不满足就整个隐藏UI"的设计原则**：用户明确要求——功能框架要永远展示出来，哪怕当前数据/条件不满足导致功能暂时没意义，只需要在界面上解释清楚原因即可，不能因为前置条件没满足就把整个功能/按钮/文字隐藏掉。已应用在`TimelinePanel`最佳点位对比文字、`EarningsPositionsPanel`中远期组的腿位表格和平仓按钮。**后续开发遇到类似写法，默认改成"展示框架+解释原因"，除非有明确理由不这么做。**

### 4.4 数据备份/同步

`dataTransfer.ts`：导出/导入整个应用数据为JSON（策略库+自定义预设+最近标的+模拟账户，version 2起包含模拟账户）。`autoSync.ts`+`useAutoSync.ts`：File System Access API自动同步到用户指定的本地文件（Chromium系浏览器支持，句柄存IndexedDB）。

## 5. 财报IV Crash策略（端到端）

### 5.1 策略逻辑

财报公布前期权价格包含"不确定性溢价"，财报一公布这份溢价通常迅速消失——策略赚的是溢价消失的钱，不赌方向。**三组结构**（每组4条腿：卖ATM Call、卖ATM Put、买两侧保护）：

| 组别 | 保护宽度 | 到期日 | 仓位倍数 |
|---|---|---|---|
| 近期组 | ±10% | 本周五（最近到期日） | 1x |
| 中期组 | ±15% | 下个月月期权到期日 | 2x |
| 远期组 | ±20% | 两个月后月期权到期日 | 2x |

选股条件：大盘股/热门股，必须有周期权，过去3年90%以上的财报后极值波动在10%以内。下单时机：盘后财报→当天收盘前建仓；盘前财报→前一天收盘前建仓。仓位大小按账户可用资金的百分比（用户输入，默认3%）反推近期组份数，中远期组自动2倍跟随：`预算 = 可用资金 × 风险比例`，`近期组份数 = floor(预算 ÷ 近期组每份最大亏损)`。

**风险提示**：提前指派风险（Call被指派通常跟临近除息日有关；Put被指派通常跟当前利率环境有关，跟除息日无关）；这不是稳赚不赔策略，极少数情况财报本身制造新的更大不确定性，IV可能不跌反涨。

### 5.2 平仓规则

近期组：财报公布开盘后尽快平掉保护腿，两条平值腿（不管盈亏）2小时内平掉，除非对方向有明确判断。中远期组按财报后实际波动幅度分三支：波动<10%（大概率盈利，"平仓落袋"或"再等等"）、10%~保护宽度之间（大概率小亏，需判断趋势，引导去分析模式看图）、≥保护宽度（亏损已封顶，不急）。

### 5.3 实现

`earningsStrategy.ts`（三组规格`EARNINGS_GROUPS`、`pickGroupExpiries`选真实到期日、`buildGroupLegs`搭腿、`computeUnitsFromRiskBudget`仓位反推、`computeEarningsPreview`聚合预览）→ `EarningsIvCrashTab.tsx`（开仓流程UI）→ 依次调用`openSimPosition`三次开成三个独立模拟仓位，每个打上`note: earnings-iv-crash:{group}:{batchId}`标记 → `earningsClosing.ts`（`parseEarningsNote`/`groupEarningsPositions`重新按批分组、`isNearGroupPastWindow`/`nearGroupHoursElapsed`近期组2小时窗口判断——按仓位自己的`openedAt`算，不是精确市场日历、`computeClosingGuidance`中远期组三分支判断）→ `EarningsPositionsPanel.tsx`专属管理面板展示。

腿位表格字段对齐了真实券商（thinkorswim）持仓表格：到期日、行权价、类型、数量、开仓价、实时价、市值、未实现盈亏、盈亏%、期权代码（简化版OCC格式，如`AMD260918P400`）。**`P/L Day`（当日盈亏）没有做**——需要"昨天收盘时权利金"作为基准，项目里没存这个每日基准数据。

### 5.4 明确搁置的部分

历史财报涨跌极值数据、历史IV/IV Percentile数据、"过去类似波动后接下来怎么走"的统计参考——都需要付费历史期权数据源（免费网络搜索查不到这类精确数字，已实测证明"用AI现查"这条路走不通）。财报"方向判断"分支——UI占位已搭好（`EarningsTabRoot.tsx`），内容没做。IV Crash策略80%/70%阈值档——UI占位已搭好，选择90%以外的档位显示"敬请期待"。

## 6. 场景选择器（`ScenarioSelectorPage.tsx` + `scenarioEngine.ts`）

从模拟账户"从场景开始"入口进入，三个标签页：**方向判断**（主体，`scenarioEngine.ts`固定查表`SCENARIO_RULES`覆盖30种桶组合，三标签结构：方向/财报/待定，财报标签内部又分IV Crash vs 方向判断、IV Crash内部再分90%/80%/70%三档阈值层级；`BUY_DTE_EXTENSION`纯买方结构的DTE延展逻辑；`isScenarioBlocked`屏蔽组合检测）、**财报**（`EarningsTabRoot`，见"四、5"）、**待定**（占位）。选中候选后"使用这个"跳转到`simOrigin`（`Shell.tsx`的`simOriginInitial`机制）确认开仓。

IV/HV比值判断（`historicalVolatility.ts`的`computeIvHvNote`）目前只在这个页面用——比值低不代表权利金便宜，如果绝对IV仍然很高，三分类`sellRich`/`buyCheap`/`stillRich`。

## 7. AI策略推荐（`AIStrategyPage.tsx`）——开发预览阶段

对应项目说明里"策略方向"部分：以卖方为主（80%）——Sell Put、Bull Put Spread、Iron Condor；买方为辅（20%）——Leap Call，Delta 0.7-0.8，6-12个月；四个模型对比——Claude、GPT-4o、Grok、Gemini。

**当前状态是TEMPORARY dev-preview版本**：真正的设计是每天由一个Supabase Cron job预先跑一次四模型分析、存进数据库，用户打开页面只是读当天已经算好的缓存结果，避免"成本随用户数线性增长"（每个用户打开都现触发一次四个大模型API调用是不可接受的）。**这个每日Cron + DB表的基础设施还没有搭**，现在页面上的按钮是"点击触发一次分析"这种临时占位行为，不是最终形态。`supabase/functions/strategy-analysis/index.ts`是对应的后端函数雏形。这是当前项目的核心未完成模块（对照项目说明"AI分析部分，后续集成"）。

## 8. `App.tsx`内部结构（拆分现状）

`App.tsx`目前约1524行（历史上到过1623行；2026-09-04做过两轮结构性瘦身，都不改逻辑：第一轮把六个展示型组件/弹窗聚合组件拆出去，第二轮——同一天——把单腿编辑相关的state/handler拆进`useLegEditing.ts`。之后几天陆续修的bug——换标的重算、`handleTrack`快照加载、已过天数改日历天数、模式切换按钮搬家等——又长回来一截，属于正常波动，不是瘦身失败）。已经拆出去、留在`App.tsx`里只剩一行调用/一次hook调用的部分：
- 见"三、文件地图"里列的`AppHeader`/`LegListSection`/`LegPanelTitleRow`/`TrackedComboSection`/`LegActionDialogs`/`StrategyPersistenceDialogs`六个组件
- `legFactory.ts`/`dateUtils.ts`（`daysSince`）/`savedStrategies.ts`（`serializeStrategyState`）几个纯helper函数
- `useLegEditing.ts`（2026-09-04新增，见"三、`src/hooks/`"）——`updateLeg`/`toggleLeg`/`deleteLeg`、批量选择四件套（`toggleLegSelection`/`clearLegSelection`/`selectAllLegs`/`selectedCount`/`allSelectedDisabled`/`bulkToggleDisable`/`requestBulkDelete`/`confirmBulkDelete`）、`handleRoll`/`handleRollConfirm`/`handleProtect`/`handleProtectConfirm`/`handleCompare`/`handleHedge`/`handleHedgeConfirm`、`moveLeg`/`moveTrackedLeg`，一共约130行。`App.tsx`里改成一次`useLegEditing({legs, setLegs, setTrackedLegs})`调用后解构使用，JSX里的prop名字全部没变。副作用：`clearLegSelection`现在是从这个hook返回的，ESLint的`exhaustive-deps`规则没法再像它是`App.tsx`本地`const`时那样"看穿"它是稳定的，导致`handleTrack`/`handleSaveTracked`/`handleOpenStrategy`/`performSwitchToAnalysis`几个`useCallback`新增了"缺少`clearLegSelection`依赖"的warning——这跟`setManageStrategyOpen`/`setStrategyBaseline`（来自`useSavedStrategies`）已经存在的同类warning是一回事，属于跨自定义hook边界的已知ESLint局限，不是bug，**新的ESLint基线是`src/App.tsx`固定12个error+10个warning**（之前是9个warning，涨的这1个就是这次拆分导致的）

**故意没有拆的部分**（如果还要继续瘦身，这是候选，但风险更高，不建议随便动）：
- 一串策略管理相关的`useCallback`（`handleSaveStrategy`/`handleOverwriteStrategy`/`handleTrack`/`handleSaveTracked`/`handleSelectSnapshot`/`handleDeleteSnapshot`/`handleUpdateSnapshotTime`/`handleOpenStrategy`/`handleSwitchToCompare`/`performSwitchToAnalysis`/`handleSwitchToAnalysis`，加起来超过300行）——互相调用、共享十几个state/ref，还反向依赖`applyPreset`这种在它们之后才定义的函数，硬拆容易在依赖数组或调用顺序上出错，这类bug`npm run typecheck`不一定能抓出来。**这份文档要特别提醒**：这次会话（2026-09-04）报的四个bug里有三个（换标的不重算、`handleTrack`快照加载、保存快照多余的二次确认）根源都在这个集群里，说明这块本来就是全项目bug密度最高的地方，越是这样越不能在没有充分行为测试的情况下动它的结构
- 一串纯计算的`useMemo`（`result`/`scenarioPriceById`/`positionHealth`/`pop`/`breakevens`/`activeTrackedLegs`/`isCompareMode`/`analysisAttribution`/`attributionMaxAbs`/`impliedSpot`/`effectiveTrackedSpot`/`effectiveDaysElapsed`/`trackedResult`/`trackedLegPnlById`/`trackedLegRolesById`/`trackedStrategy`/`trackedVolShift`/`pnlAttribution`，约150行）——互相之间有链式依赖（比如`trackedResult`依赖`effectiveTrackedSpot`依赖`impliedSpot`），抽成hook需要把整条依赖链一起搬

这两块理论上都可以像`useAutoSync`/`useCustomPresets`/`useSavedStrategies`/`useLegEditing`那样抽成自定义hook，但工作量和风险都明显更高，需要单独开一轮专门做，而且不能只靠typecheck验证，需要实际操作路径测试（参考"四、3.3"那次"两个功能交界处"的bug教训，以及这次拆`useLegEditing`时用Playwright跑遍加腿/删腿/编辑/拖动排序/批量选择/批量屏蔽/批量删除/展期/保护/对冲弹窗的真实操作路径才确认没问题的做法）。

---

# 五、核心设计原则（接手人应该遵守）

1. **"到期结果"类指标默认不跟随情景滑块**（maxProfit/maxLoss、POP、健康度评分），组合健康度是刻意的例外
2. **决策对比停留在分析模式**——滑块是预演未来情景，跟持有/平仓/展期对比是并列用例
3. **IV/HV比值不能直接当"便宜/贵"的结论**——比值低不代表权利金便宜，如果绝对IV仍然很高（三分类`sellRich`/`buyCheap`/`stillRich`）
4. **动态保证金优于静态**——真实券商是风险度量式动态插值的，静态最坏情况预留是错的
5. **`App.tsx`的TDZ风险**——新插入`useMemo`/`useCallback`必须手动核实声明顺序，esbuild/vite build抓不出这类错误，只有`npm run typecheck`能抓一部分，很多时候连typecheck也抓不出来（类型层面合法），需要实际测试
6. **跨式/宽跨式行权价规则**——跨式两腿锁定同一个ATM行权价；宽跨式两腿都要保持OTM
7. **预设库标准**——只收录真正常见、成熟的策略，不为了凑数量加边缘变体
8. **"展示框架+解释原因"优于"条件不满足就隐藏UI"**——见"四、4.3"
9. **`createPortal`用于弹出层**——需要用来逃出滚动面板的overflow裁剪
10. **`note`字段（财报组标记）和`linkedStrategyId`字段（对比模式关联）是两个独立字段**，不要混用
11. **一个功能让某个state从"总有值"变成"可能为null"时，要回头检查所有假设它有值的地方**——typecheck抓不出来，只能靠实测（见"四、3.3"）
12. **给用户看的"已过几天"一律用日历天数（`calendarDaysSince`/`calendarDaysBetween`），不用连续24小时的`daysSince`**——见"三、`src/lib/`"里`dateUtils.ts`条目的教训
13. **面向用户的文案，包括纯lib文件（非React组件）里拼出来的字符串，一律通过`t()`读`zh.ts`/`en.ts`，不写死任何一种语言**——`positionHealth.ts`之前整个文件是硬编码中文，用户直接指出"无论中英文健康度内容都是中文，你把它写成硬编码了"，这类bug`typecheck`/`build`都不会报错，因为类型层面完全合法，只有真的切到英文界面才会暴露；连标点分隔符（"、" vs ", "、全角"：" vs "`: `"）都要走i18n键，不要因为"看起来是标点不是内容"就跳过

---

# 六、当前已知问题 / backlog

产品功能层面的待办，按提及顺序列出（不代表优先级，跟具体某次改动引入的bug是两回事）：

1. **保证金持仓后不会动态跟涨跌**——只有开仓/预览那一刻算得对，需要把`computeMarginUsed`改成用实时股价而不是开仓时冻结的股价，牵涉多个调用点
2. **财报策略80%/70%阈值档**——UI占位已搭好，逻辑没做
3. **财报"方向判断"分支**——UI占位已搭好，内容没做
4. **IV Rank/Percentile真实数据**——卡在要不要接付费历史数据源，还没决定
5. **期限结构（Term Structure）可视化**——同一标的不同到期日的IV放一张图上对比，主要用于日历价差选到期日，提过想法但没开始做
6. **历史快照不会自动积累，只在手动点"刷新全部持仓"或打开趋势面板（回填）时记录**——讨论过"每次打开模拟账户页面自动记一次快照"这个方向，涉及组件内部函数声明顺序（TDZ风险），没做
7. **`handleAddToSimAccount`这个独立的"快速添加到模拟账户"入口，没有接上`openingAt`**——不确定这个入口具体从哪里触发，暂时继续用`Date.now()`
8. **决策对比没有"对冲"这第四个对比分支**——`HedgeDialog.tsx`已经成熟，理论上可以复用其默认方案逻辑做成四选一
9. **`PayoffChart.tsx`里有4份几乎一样的情景偏移计算逻辑**——重复代码，修复日历价差定价bug时顺手发现的技术债
10. **IV/HV这套指标目前只在场景选择器里用**——建议接入分析模式手动搭建组合的场景
11. **悔棋模式（Regret Mode A，"如果没平仓"按钮）**——用户反馈"问题比较大"，具体怎么改还没讨论清楚，下次动手前要先问清楚设计诉求
12. **AI策略推荐（`AIStrategyPage.tsx`）的每日Cron+缓存基础设施还没搭**——见"四、7"，是当前最大的未完成模块
13. **`App.tsx`还有约400行策略管理handler+计算useMemo没有拆分**——见"四、8"，风险较高，需要单独一轮细致处理
14. **claude.ai项目的GitHub同步白名单可能滞后于main分支实际文件**——如果发现新加的`src/lib`或`supabase/functions`文件没被project索引到，遇到关键判断优先直接读GitHub raw内容核实，不要只信`project_search`

---

# 七、给接手的人（无论是人类开发者还是下一个AI会话）

1. **第一步永远是跟GitHub真实代码做一次全面比对**，确认这份文档反映的状态和实际代码库一致，再开始改动
2. "六、已知问题"是最直接能接手的任务列表，按当下兴趣或优先级挑一项
3. 遇到"某个条件不满足就整个隐藏UI"的写法，默认改成"展示框架+解释原因"（"五、8"）
4. `App.tsx`新增`useMemo`/`useCallback`时注意TDZ风险，手动核对声明顺序
5. 财报相关改动注意`note`和`linkedStrategyId`是两个独立字段
6. 交付代码遵守"一、开发/交付流程约定"里的规范（完整文件、路径注释、typecheck验证）
7. 这份文档改完之后按开头"维护方式"的约定去改，不要退回按会话追加的旧模式