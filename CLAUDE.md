<!-- CLAUDE.md -->

# OptionPilot 交接文档（整合版）

**版本**：整合版，更新于 2026-09-06。本次更新合并了 2026-09-05（预设风险揭示+到期盈亏小图+9条预设内容修正）、2026-09-06上半（zh.ts/en.ts严重滞后事故的修复与教训）、2026-09-06下半（对比模式健康度/Greeks修正、追踪快照自动回填、一个由此引入又当场修复的布局bug）三轮会话的成果。**这份文档替代了之前"按会话追加"的版本**——旧版本是每轮会话在文末加一个新章节，越滚越长，找一个功能的现状要翻好几个章节、对着时间戳自己判断哪段是最新的。这份文档**按功能/模块组织，只描述"现在是什么样"，不按时间顺序记流水账**。

**维护方式（重要，后续会话都要遵守）**：
- 做完一个功能改动或修复了一个bug，**直接去改对应的章节内容**，让它反映当前状态，不要在文末追加"2026-xx-xx又做了什么"这种新章节。
- 如果改动创建了新文件/新模块，在"三、文件地图"和"四、功能模块详解"里对应位置加进去。
- 如果解决了"六、已知问题"里的一条，从列表里删掉（不是标记"已完成"留着不删）。
- 如果发现了新的已知问题/技术债，加进"六、已知问题"。
- 只有在某个改动本身特殊到值得单独留痕迹时（比如一次重大架构决策、一次踩坑教训——**语言文件那次事故就是这种情况，见下面独立的警示章节**），才写成"设计笔记"/"事故记录"性质的独立小节，正常的功能新增/bug修复不需要。
- 每次改完这份文档，**开头这个"版本"行的日期改成当天**，作为"文档更新到什么程度"的唯一时间戳，不需要维护一份变更日志。

**如果需要查历史会话的详细讨论过程**（比如某个设计决策当初为什么这么定、具体的调试过程），更细粒度的分主题讨论记录都保留在claude.ai的"options pilot"项目文档里（`claude/wiring-check-2026-09-03.md`、`claude/mode-switch-and-restore-2026-09-03.md`、`claude/sim-account-changes-2026-09-02.md`、`claude/preset-risk-disclosure-2026-09-05.md`、`claude/i18n-staleness-incident-2026-09-06.md`、`claude/analysis-compare-mode-review-2026-09-06.md`是几次专项讨论/事故的详细记录）。这份新文档不重复那些讨论过程，只给结论和现状。

**重要提醒（接手第一件事）**：这份文档、以及历次对话里所有的代码交付，都基于Claude自己维护的一份**本地沙盒副本**，不是直接读GitHub实时代码（除非某次会话特意说明是直接读的）。这份副本的准确性依赖于用户本地是否已经把每次交付的文件都正确落地、commit、push。**接手的人第一件事，应该是拿这份文档跟GitHub仓库（`github.com/lixuedenon/OptionPilot`，main分支）的真实文件做一次比对**，确认没有偏差再开始改动。

---

## ⚠️ 语言文件（`src/i18n/locales/zh.ts` / `en.ts`）维护须知——极高优先级，读完这一节再碰这两个文件

**2026-09-06发生过一次严重事故**，完整记录见`claude/i18n-staleness-incident-2026-09-06.md`，这里只给结论和以后必须遵守的规则。

**发生了什么**：Claude沙箱那一轮会话用来交付`zh.ts`/`en.ts`的基线，跟GitHub真实main分支逐字节完全一致——但用户**本地**实际的开发进度早已远超这个基线，本地已经手工新增了约40个翻译key（对比模式切换、组合健康度、决策比较v2、盈亏归因、财报面板等好几个功能的翻译），这些新增**从未推送到GitHub、也从未发给过Claude**。Claude用"完整文件替换"的方式交付了两版`zh.ts`/`en.ts`（都是在滞后基线上改的），用户拿去替换本地真实文件时，把本地独有、还没同步的那一大批翻译**全部覆盖冲掉了**——界面上大批按钮/文字变回显示裸的翻译key字符串（比如`leg.switchToCompare`）。用户报告了两次才最终定位到根因（第一次报告后Claude的排查方向不对，以为是遗漏了某几个key，实际上是整份文件基线就是旧的）。

**以后但凡要动`zh.ts`/`en.ts`这两个文件，必须遵守**：
1. **不要无脑用"完整文件覆盖"交付这两个文件**，除非确认过沙盒本地版本就是用户本地最新版本。开始改之前，先问用户一句"你本地这两个文件是不是有我这边没见过的最新内容"——尤其是间隔了较长时间、或者用户提到"我这边好像还有别的改动"的时候。
2. **更稳妥的方式是改用最小化的Edit，只加自己这次需要新增/修改的那几行key，不整份覆盖**，除非用户明确要求整份替换、或者用户已经把他本地当前真实的完整文件内容贴给了Claude作为基准。
3. **交付前后都要跑一遍key集合一致性检查**：用正则从两份文件里提取所有顶层key（`^\s*"([a-zA-Z0-9_.]+)":`），转成Set后取双向差集，确认zh/en两边key完全对齐（0个单边缺失）——比人工比对快得多也准得多，是这类问题最可靠的自查手段，每次改完这两个文件后都应该顺手跑一次。
4. **诊断"界面显示裸key"这类问题的最快方法**：全局`grep -rn "<key>" src/`，如果代码引用和翻译定义两处都搜不到，几乎可以确定是"用户本地有、Claude沙箱没有"的同步缺口，而不是这次改动引入的回归；用`curl https://raw.githubusercontent.com/lixuedenon/OptionPilot/main/<path>`拉GitHub当前内容跟本地改动前的commit做对比，可以进一步排除"是不是Claude自己的编辑动作删掉了内容"这种可能性。
5. **这两个文件不在project的GitHub同步白名单里**（见下面"GitHub同步范围滞后"的说明），project_search/project_read读到的很可能是过期版本——**关键判断一律优先直接问用户或者`curl` GitHub raw内容核实**，不要相信project工具或者沙盒本地状态的默认假设。

---

# 一、项目速览

- **项目**：OptionPilot——期权策略可视化 + 模拟交易 + AI策略推荐的Web应用
- **技术栈**：React + TypeScript + Vite + Tailwind CSS + Supabase（Edge Functions + Postgres）
- **仓库**：`github.com/lixuedenon/OptionPilot`（public）
- **本地开发路径**：`C:\Users\lixue\projects\optionpilote`，Windows + VS Code + PowerShell
- **数据源**：Yahoo Finance期权链/报价接口（免费、无需认证），通过Supabase Edge Function代理
- **用户背景**：Xue是资深期权交易者、独立开发者（Android/Flutter背景），对实盘细节（保证金动态计算、提前指派机制、财报交易策略等）有深入实战经验，经常用真实交易经验纠正理论假设

**开发/交付流程约定**（Claude在沙盒里工作，没有push权限，这套流程每轮会话都适用）：
- Claude在自己维护的本地沙盒里clone仓库、改代码、跑验证，不直接操作用户的GitHub；用户明确表示**不需要Claude推送**，会自己在本地应用交付的文件、验证、`git add/commit/push`
- 验证手段：`npm run typecheck`（`tsc --noEmit -p tsconfig.app.json`，权威的正确性检查）+ `npm run build`（vite构建，**不做类型检查**，只能抓语法/打包错误）+ `npx eslint .`（代码风格/潜在问题）
- 交付方式：完整文件通过对话交付，不是diff，减少复制粘贴出错；**每个文件第一行必须是路径注释**（代码文件`// path/to/file`，markdown文件`<!-- path -->`），这是用户明确的固定要求
- 用户拿到文件后自己本地替换、跑`npm run dev`验证、`git add/commit/push`
- **GitHub是真理来源**：本地沙盒副本可能跟真实仓库产生偏差（比如某次交付用户没应用、或者用户本地手动改过沙盒不知道的地方，`zh.ts`/`en.ts`就是踩过的真实例子），涉及关键判断时优先直接读GitHub实际内容核实，不要只信这份文档或者本地沙盒状态
- **GitHub同步范围滞后**：claude.ai这个project的GitHub同步源设置了文件过滤白名单，目前不是仓库全量同步——早期发现`optionChain.ts`/`option-chain` Edge Function不在名单里过，此后陆续发现`zh.ts`/`en.ts`等文件也有同样风险。project_search/project_read的结果可能是过期快照，**遇到"这个功能是不是已经做了"这类关键判断，优先用WebFetch/curl直接读GitHub raw内容核实**，而不是只信project工具

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

`App.tsx`（当前约1607行，是全项目最大、最核心的文件）**同时承担"分析模式"和"跟踪对比模式"两种UI**，不是两个组件——区分靠一个派生状态：

```
isCompareMode = trackedLegs !== null
```

两套并行的数据：
- **`legs`/`spot`/`openingAt`**（开仓组合/分析模式基线）——分析模式下可以自由编辑；对比模式下渲染成"开仓组合"那一块，只读展示（除非通过"恢复"按钮把它对齐回原始数据）
- **`trackedLegs`/`trackedSpot`/`effectiveTrackedSpot`**（持仓组合/今日组合）——只在对比模式下存在，可编辑，代表"这个组合现在的实际状态"

这两套数据通过`trackingStrategyId`（可能为`null`）关联到一条持久化的`SavedStrategy`记录（见"四、2"策略库一节的数据模型）。`App.tsx`内部按功能拆成了几个presentational子组件（见"三、文件地图"），但**状态管理和事件处理逻辑几乎全部留在`App.tsx`本体**，子组件基本是"纯JSX + props透传"，没有自己的state（详见"四、8"App.tsx结构小节）。

**两套数据在健康度/Greeks等"展示层"计算上如何选边**（2026-09-06确立的原则，见"四、1.4"）：几乎所有派生计算都要问自己"现在到底该读哪套数据"——`isCompareMode`为true时读`trackedLegs`/`effectiveTrackedSpot`一侧（"今日组合"），为false时读`legs`/`spot`/`shifts`一侧（分析模式，跟随情景滑块）。这条分支模式（`positionHealth`/`trackedGreeks`/`displayGreeks`）是这次修复后新立的范式，以后任何新加的"组合级"展示指标，默认都应该照这个模式接入两种模式，而不是像`positionHealth`曾经那样无条件只读`legs`一侧。

---

# 三、文件地图

## 顶层页面（`src/*.tsx`）

| 文件 | 大致行数 | 职责 |
|---|---|---|
| `Shell.tsx` | ~167 | 顶层路由状态机（见上）|
| `HomePage.tsx` | ~132 | 首页四张模块卡片 |
| `App.tsx` | ~1607 | 分析模式+对比模式，核心工作区（见下方专门小节）|
| `SimulatorPage.tsx` | ~1618 | 模拟账户页面，全项目第二大文件——仓位列表、开平仓、保证金展示、财报仓位面板、趋势/悔棋面板 |
| `ScenarioSelectorPage.tsx` | ~571 | "从场景开始"三标签页：方向判断（场景引擎推荐）/财报（IV Crash入口）/待定（占位）|
| `AIStrategyPage.tsx` | ~146 | AI四模型策略推荐页面，**当前是开发预览版**，见"四、7" |
| `ComingSoonPage.tsx` | ~43 | 通用"敬请期待"占位页 |
| `main.tsx` | 12 | React入口 |

## `src/components/`（可复用UI组件，非页面）

按用途分组：

**分析/对比模式的直接子组件**（专为`App.tsx`拆分出来，语义上属于`App.tsx`的一部分）：
- `AppHeader.tsx`（~289行）——顶部header：标的输入+联想、现价、帮助按钮等
- `LegListSection.tsx`（~288行）——腿位列表区：批量操作工具栏（全选/清空/批量删除/保存策略组合按钮）+ 逐条`LegRow`
- `LegPanelTitleRow.tsx`（~99行）——腿位区标题行：策略徽章、腿数、模式切换按钮/下拉菜单
- `TrackedComboSection.tsx`（~200行）——对比模式"今日组合"整块：快照选择器（含"(估)"估算标记，见"四、3.3"）、保存按钮、开仓vs当前统计网格、腿位列表
- `LegActionDialogs.tsx`（~159行）——leg级别弹窗集合（保存预设/清空确认/批量删除确认/丢弃追踪确认/展期/保护/对冲/决策对比/隐含现价说明），纯转发props给各自的真实弹窗组件
- `StrategyPersistenceDialogs.tsx`（~133行）——策略保存/切换/离开相关弹窗集合（预设切换确认/替换确认/离开确认/模式切换确认/保存策略对话框/管理策略对话框）
- `LegRow.tsx`（~752行，全项目最大的单个组件）——单条腿位的编辑行，含**期权链自动填充逻辑**（见"四、1.2"）

**分析模式的其他功能组件**：
- `PayoffChart.tsx`（~994行）——到期损益图，SVG绘制，含情景滑块联动、对比模式双线叠加。**内部有已知的重复实现问题**，见"六、已知问题"
- `PayoffSparkline.tsx`（~78行，2026-09-05新增）——预设悬浮框里的"到期盈亏形状"迷你曲线图，复用`pricing.ts`的`payoffCurvePoints`，不重新发明计算逻辑，见"四、2.2"
- `PnlAttributionPanel.tsx`——P/L归因面板（滑块驱动/跟踪对比两种模式）
- `PositionHealthBadge.tsx`——组合健康度徽章
- `ShiftSliders.tsx`——情景滑块（现价/时间/波动率三个维度）
- `StrategyBadge.tsx`——策略名称徽章（含`dirKeyMap`，别处也在用）
- `DecisionCompareDialog.tsx`——决策对比弹窗（不动/平仓/展期三选一对比）
- `RollDialog.tsx` / `ProtectDialog.tsx` / `HedgeDialog.tsx`——展期/保护/对冲三个操作弹窗
- `SavePresetDialog.tsx` / `PresetPicker.tsx`（~343行）——自定义预设保存/选择；`PresetPicker.tsx`悬浮框里还渲染风险揭示`RiskDisclosure`和`PayoffSparkline`（见"四、2.2"）
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
- `useLegEditing.ts`——开仓组合单腿的增删改、批量选择/批量屏蔽/批量删除、展期/保护/对冲/比较四个弹窗的目标状态，以及`moveLeg`/`moveTrackedLeg`两个顺序调整函数。从`App.tsx`拆出，接收`{legs, setLegs, setTrackedLegs}`

## `src/lib/`（核心业务逻辑，无UI）

**定价与组合计算**：
- `types.ts`——`Leg`/`Shifts`/`GreekBreakdown`等核心类型定义
- `bs.ts`——Black-Scholes定价模型+希腊字母
- `pricing.ts`（~478行，核心算法文件）——`priceCombo`（组合定价+归因，返回的`ComboResult.breakdown`含完整的组合级delta/gamma/theta/vega）、`payoffCurvePoints`、`probabilityOfProfit`、`findBreakevens`、`maxProfitLoss`、`impliedVol`/`impliedSpotFromPremiums`、`attributePnl`（P/L归因）、`classifySpotOnCurve`（判断某现价在payoff曲线上是"接近峰值/盈利区间/已越过盈亏平衡点"，供模拟账户"复盘"面板用）等
- `legRoles.ts`——腿位角色解释（这条腿在组合里扮演什么角色，供逐条腿展示用）
- `legFactory.ts`——`uid`/`blankLeg`/`PRESET_DTE_SET`几个创建腿位用的小helper（从`App.tsx`拆出）
- `matchStrategy.ts`——从一组腿位反推策略名字（含"窄体铁鹰"/"玉蜥蜴"两种四腿/三腿结构的区分识别，见"四、2.3"）
- `positionHealth.ts`——组合健康度评分（四维度各25分），**调用方需要按当前模式传入对应的legs/spot/breakdown**，见"四、1.4"
- `decisionCompare.ts`——决策对比的核心计算（不动/平仓/展期三分支）

**策略库/预设**：
- `savedStrategies.ts`（~293行）——`SavedStrategy`/`TrackedSnapshot`数据模型+CRUD（localStorage存储），`TrackedSnapshot`新增`estimated?: boolean`字段，新增`backfillTrackedSnapshots()`自动回填函数，见"四、2.1"和"四、3.3"
- `presets.ts`（~786行）——内置策略预设库（42个模板，含`RiskLine`/`RiskSeverity`风险揭示数据），见"四、2.2"
- `customPresets.ts`——用户自定义预设的类型+存储
- `historicalBackfill.ts`（~85行，2026-09-06新增）——历史K线拉取+flat-vol理论重定价的共享逻辑，从`simAccount.ts`抽出，供模拟账户的`Timeline`回填和策略库的`backfillTrackedSnapshots`共用，避免第三份近似实现，见"四、3.3"

**期权链/行情**：
- `optionChain.ts`（~192行）——客户端期权链库：`getOptionChain`/`peekResolvedChain`/`fetchLegPremium`/`nearestStrikeToSpot`/`nearestStrikeQuote`/`resolveFromCache`，调用`option-chain` Edge Function，带promise级缓存
- `useStockQuote.ts`——实时现价hook+`fetchSpotPrice`
- `historicalVolatility.ts`——历史波动率计算（`computeHV`）+ IV/HV比值判断（`computeIvHvNote`：`sellRich`/`buyCheap`/`stillRich`三分类）
- `recentSymbols.ts`——最近查询过的标的记录（localStorage）

**日期/工具**：
- `dateUtils.ts`——`todayISO`/`dateFromDte`/`dteFromDate`/`nearestFridayDte`/`formatDateInput`/`parseDateInput`/`daysSince`/`daysBetweenLocalDates`/`calendarDaysSince`——统一的日历天数（而非24小时周期）算法，多处历史bug修复都落在这个文件的正确使用上，改动前先确认用的是这几个helper而不是自己手写日期运算
- `miniMarkdown.tsx`——极简markdown渲染（AI策略页面用）

**模拟账户**：
- `simAccount.ts`（~492行）——`SimPosition`/`SimAccount`/`PositionSnapshot`数据模型+CRUD、`computeMarginUsed`/`computeAvailableCapital`/`checkMarginForOpen`（保证金检查）、`analyzeBestExit`（悔棋模式用）、`computeCostBasis`/`computeMarkValue`、`backfillSnapshots`（趋势面板回填，2026-09-06起复用`historicalBackfill.ts`的共享逻辑，自身不再维护一份历史K线拉取+重定价实现）
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

`I18nContext.tsx`（`useI18n()` hook + `t(key, vars?)`）、`translations.ts`、`locales/zh.ts`+`locales/en.ts`（各~640行，键值对翻译文件，**改动前必读上面的"语言文件维护须知"独立章节**）

## `supabase/`

**Edge Functions**（`supabase/functions/`）：
- `stock-quote/index.ts`——实时现价代理
- `option-chain/index.ts`——期权链代理（Yahoo Finance `v7/finance/options`，cookie+crumb认证，服务端共享缓存`option_chain_cache`表15分钟TTL）
- `historical-prices/index.ts`——历史价格代理（同时返回`opens`/`closes`/`timestamps`，供趋势面板和`historicalBackfill.ts`回填用，只保留2个月窗口）
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

### 1.4 情景滑块 / P/L归因 / 组合健康度 / 组合级Greeks（2026-09-06重构，两种模式各读各的数据）

- `ShiftSliders.tsx`：现价（dS）、时间（dT）、波动率（dV）三个维度的滑块，驱动`PayoffChart`和归因面板重算。**对比模式下滑块是冻结的只读遥测**（"对比模式已冻结"），不是推演——对比模式没有"如果价格再变"这种情景推演的语义，滑块UI仍会渲染出来但不接受拖动
- `PnlAttributionPanel.tsx` + `pricing.ts`的`attributePnl`：把盈亏拆成"哪个维度贡献了多少"，滑块驱动模式和跟踪对比模式两种数据源
- **组合健康度**（`PositionHealthBadge.tsx` + `positionHealth.ts`）：四维度各25分——到期盈利概率(POP)、距盈亏平衡点距离、临近到期的Gamma风险、每张合约平均Delta归一化。健康度现在**按当前所在模式选边**（`App.tsx`的`positionHealth`这个`useMemo`）：分析模式下用`activeLegs`/`spot`/`shifts`算（跟随情景滑块，因为POP/盈亏平衡距离/DTE风险三项本来就用`buildShiftedLegs`跟随滑块），对比模式下改用`activeTrackedLegs`/`effectiveTrackedSpot`（零情景偏移，今日组合，因为对比模式滑块本来就是冻结遥测）。**这是2026-09-06修的一个设计错位**——在这之前，对比模式复用分析模式同一个健康度徽章，但看到的数字实际算的是"开仓组合"，不是"今日组合"，跟对比模式"管理一个正在持有的仓位"的定位不符。因为这个计算现在直接依赖`activeTrackedLegs`/`effectiveTrackedSpot`（这两个值本来就会随选中的快照变化），切换不同快照会自动得到不同的健康度，不需要额外的per-snapshot存储
- **组合级Greeks（净Delta/Theta/Vega/Gamma）**：`pricing.ts`的`priceCombo()`用有限差分算出完整的组合级`delta/gamma/theta/vega`，2026-09-06之前这份数据只在健康度内部用（用户看不到具体数值），现在两个模式的标题栏都新增了一个小面板直接显示这四个数字（`App.tsx`里的`displayGreeks`+`fmtGreek`）。数据来源同样按模式分支：分析模式读`result.breakdown`（跟随滑块）；对比模式读新增的`trackedGreeks`这个独立`useMemo`（对`activeTrackedLegs`单独跑一次`priceCombo`，零情景偏移）——**故意没有复用`trackedResult`**（对比模式已有的P&L计算，"四、3"），因为`trackedResult`每条腿的Greeks变化字段是硬编码成`{delta:0,gamma:0,theta:0,vega:0}`的、只有`.total`是真的算出来的，为了不动这块已经在正常工作的P&L逻辑，才另开了`trackedGreeks`专门喂给健康度和这个新面板
- **这个面板引入时顺手暴露并修复了一个布局bug**：标题栏内容变宽后，在较窄的左侧面板宽度下会把健康度徽章挤出可视区域（不报错，是静默被裁切/自动横向滚动掉，肉眼几乎发现不了）。修法是把这一整行以及Greeks小面板自身都从`whitespace-nowrap`+`shrink-0`改成`flex-wrap`，允许在空间不够时自动换行——1150px到1900px左侧面板宽度都验证过健康度徽章和Greeks面板始终可见，不会重现被挤没的情况。**以后往这一行（`App.tsx`里`col-start-2 row-start-1`那个grid cell）加新的展示项时，注意它已经是flex-wrap的，新加的东西太宽会自动换行而不是把后面的项挤出视野，但如果单个新增块本身就很宽（超过整行可用宽度），还是需要让它自己内部也能wrap，不能指望外层wrap单独解决**
- **"到期结果"类指标默认不跟随情景滑块**（maxProfit/maxLoss、POP、健康度评分是刻意的例外）——这条设计原则本身没变，见"五、核心设计原则"

### 1.5 决策对比（`DecisionCompareDialog.tsx` + `decisionCompare.ts`）

针对单条腿，用真实期权链数据对比"不动/平仓/展期"三种结果的盈亏。**没有"对冲"这第四个对比分支**——`HedgeDialog.tsx`已经是成熟功能，理论上可以复用其默认方案逻辑做成四选一，属于backlog（见"六"）。决策对比停留在分析模式，不受情景滑块影响的语义是"预演未来"，跟归因面板的滑块驱动是并列的不同用例。**"决策比较"弹窗里的展期分支是硬编码+30天**，不像正式`RollDialog`那样给+7/+14/+30快捷键和自定义日期可选，见"六、已知问题"。

## 2. 策略库（保存/加载/管理/预设）

### 2.1 数据模型（`savedStrategies.ts`）

一条`SavedStrategy` = **1个固定不变的"开仓组合"**（`legs`/`spot`/`shifts`/`openingAt`，存了就不再变）+ **一串会增长的"快照"**（`trackedSnapshots: TrackedSnapshot[]`，每条是某天的"今日组合"实际数据）。存储在localStorage。

`TrackedSnapshot`新增了`estimated?: boolean`字段（2026-09-06）——`true`表示这条快照是`backfillTrackedSnapshots()`用历史股价+理论重定价自动补出来的，不是用户真实手动刷新保存的，见"四、3.3"。

关键函数：`saveStrategy`/`overwriteStrategy`/`deleteSavedStrategy`/`renameSavedStrategy`/`toggleStarStrategy`/`toggleTrackStrategy`/`addTrackedSnapshot`/`updateSnapshotTime`/`deleteTrackedSnapshot`/`generateFilename`（自动生成文件名）/`findDuplicate`（判重）/`serializeStrategyState`（把整个组合状态序列化成字符串，供`trackedDirty`用`!==`做脏检查，比深比较便宜）/`backfillTrackedSnapshots`（2026-09-06新增，见"四、3.3"）。

### 2.2 预设库（`presets.ts` + `customPresets.ts` + `PresetPicker.tsx`）

内置42个策略预设模板（跨式/宽跨式/垂直价差/铁鹰/铁蝶/日历价差/双对角等），"只收录真正常见、成熟的策略，不为了凑数量加边缘变体"。用户可以从预设开始搭建，也可以自己搭完存成`CustomPreset`。跨式两腿锁定同一个ATM行权价；宽跨式两腿都要保持OTM。

**风险揭示**（2026-09-05新增）：每个内置预设的悬浮框里新增一个"风险揭示"区块（`preset.risk`），三层颜色分级、默认全展开（不需要点击交互）——`danger`（红，风险定性/最坏情况形状）、`caution`（琥珀，保证金&指派风险，只在有裸卖/空头腿时出现）、`info`（蓝，波动率影响，只在真正受IV crush/spike影响时出现）。数据模型是`presets.ts`里的`RiskSeverity`/`RiskLine`类型，`PresetMeta.risk?: RiskLine[]`是**可选字段**（`CustomPreset`没有risk数据，不提供也要能通过类型检查）。**每条预设的风险文案都是单独撰写的，不是模板套话**——加新预设时风险揭示也要单独写，不能复制粘贴改几个字了事。UI实现在`PresetPicker.tsx`的`RiskDisclosure`子组件，只在内置预设生效（自定义预设没有risk数据）。

**到期盈亏形状迷你图**（2026-09-05新增，`PayoffSparkline.tsx`）：悬浮框里desc下方新增一个220×68px的SVG折线图，复用`pricing.ts`的`payoffCurvePoints`/`pnlAtExpiry`（这两个函数本来就正确处理跨到期日结构——日历/对角/双对角/反向日历），不重新发明计算逻辑。参考现价固定为100（跟所有预设示例行权价的约定一致）。内置预设和自定义预设都会渲染（两者都有真实legs数据）。

**内容修正历史**（2026-09-05一次性走查修完，具体条目见`claude/preset-risk-disclosure-2026-09-05.md`）：Bull Put Spread方向描述曾经写反；Christmas Tree系列腿位比例注释曾经错误；原"玉蜥蜴"实际是4腿双侧保护结构、更名为"窄体铁鹰"，新增了真正的3腿裸Put结构作为"玉蜥蜴/Jade Lizard"；"双对角价差"曾经不是真正的双对角（只是近月Put价差+远月Call价差），已重建为真正的双侧对角结构；卖出跨式/宽跨式的"理论无限亏损"措辞已改成分Call/Put侧分别说明（只有Call侧真正无上限）。**这些都已经落地在当前代码里，不是待办**。

### 2.3 策略识别（`matchStrategy.ts`）

反过来，从一组腿位识别出策略名字给徽章用。除了跟42个预设做比例匹配之外，有一条独立的**结构判断规则**`checkIronButterflyFamily`，专门识别"两条卖出腿卡在同一行权价+两条保护腿分居两侧"这个形状族，不依赖固定预设的比例是否吻合——两翼宽度相等判"铁蝶"，不相等判"**窄体铁鹰**"（2026-09-05从"玉蜥蜴"改名，真实市场搭出来的财报策略组合两翼宽度几乎不可能精确对称，这条规则就是为了覆盖这种情况新加的；新的3腿真正Jade Lizard结构因为卖出腿不在同一行权价，不会被这条4腿规则误判）。这条规则同时检查到期日必须一致，避免误判"双对角价差"。

### 2.4 管理界面（`ManageStrategiesDialog.tsx`）

列表、置顶、重命名、删除、"跟踪"（进入对比模式，见"四、3"）。

## 3. 跟踪对比模式（"今日组合"）

### 3.1 进入方式

三条路径，行为略有不同：
1. **首页"跟踪"卡片** → `App.tsx`的`autoOpenManage=true` → 自动弹出管理策略对话框选一条已存策略"跟踪"
2. **`handleTrack`**（点已存策略的"跟踪"按钮）：**先调用`backfillTrackedSnapshots(strategyId)`补齐漏掉的交易日快照**（2026-09-06新增，见"四、3.3"），再检查这条策略（回填后）的`trackedSnapshots`，如果有快照，默认加载**最新那一条**的真实/估算数据（决定DTE的衰减也是从这条快照自己的`savedAt`算起，不是从策略的`openingAt`算——跟`handleSelectSnapshot`选某条快照时的算法一致）；没有快照（比如很早以前用"保存策略"存的、从没跟踪过、且回填也没拿到任何历史数据的老记录）才退回用开仓数据现算今日DTE
3. **模式直接切换**（`handleSwitchToCompare`，分析模式左上角按钮，2026-09-06起也是`async`）：把当前正在编辑的`legs`/`spot`/`openingAt`直接作为对比模式的开仓组合+持仓组合初始值（`trackedLegs`就是`legs`的一份新拷贝，"已过0天"）。`trackingStrategyId`**不是无条件设为`null`**——用`findDuplicate`检查当前开仓组合是不是跟某条已存策略完全一致，一致的话把`trackingStrategyId`设成那条策略的id，**并且如果找到了匹配也会调用`backfillTrackedSnapshots`补齐快照**，这样快照选择器会正常出现，用户可以从下拉框里挑历史快照，也可以正常续存到同一条策略上

### 3.2 模式直接切换（分析模式 ↔ 对比模式，不用退回首页）

左侧腿位区标题栏（`LegPanelTitleRow.tsx`）有直接切换入口：

- **分析→对比**（`handleSwitchToCompare`）：见上
- **对比→分析**（`handleSwitchToAnalysis`，下拉菜单三选一）：
  - **原始基准数据**：`legs`/`spot`/`openingAt`原样不变
  - **调整后的数据**：当前"持仓组合"这份（`trackedLegs`/`effectiveTrackedSpot`），开仓日期改成"现在"
  - **某条快照**：从快照列表选一条，开仓日期改成那条快照的保存日期
  - **为什么后两种情况开仓日期要重置**：这些腿位的DTE已经被对比模式按经过天数减过一次了，如果开仓日期还留最早那天，以后再存成策略、再"追踪"回对比模式，会拿这个过旧的开仓日期重新算一次经过天数、再减一次DTE，等于减了两次。选"原始基准数据"不存在这个问题（DTE本来没减过）
- 分析模式的payoff曲线本身不读`openingAt`（`priceCombo(activeLegs, shifts, spot)`），三种选择切回来曲线立刻按新基准正确显示

**丢数据保护**：切到分析模式时，如果"持仓组合"有未保存改动（`trackedDirty === true`）且选的不是"调整后的数据"（选这个改动本身会被带过去，不存在丢失），会先弹确认框（取消/不保存直接切/先存一条快照再切）——复用`ConfirmSnapshotDialog`（跟预设切换共用同一个组件），机制是`pendingSwitchSource`ref + `confirmSwitchOpen`state，`handleSwitchToAnalysis`是对外守卫入口，`performSwitchToAnalysis`是内部真正执行切换的函数。

### 3.3 保存快照 / 保存策略组合 / 快照自动回填（2026-09-06新增自动回填）

入口位置：**保存追踪快照**在"持仓组合"（今日组合）那一行最右边，常驻按钮，`disabled={!trackedDirty}`；**保存策略组合**在"全选"那一行最右边（`LegListSection.tsx`的`canSaveStrategy`/`onSaveStrategy`props），常驻显示，不依赖是否有腿位被选中。左上角"策略库"下拉菜单现在只剩"管理策略"一项。

**保存追踪快照的完整逻辑**（`handleSaveTracked`）：
- 有`trackingStrategyId`（比如通过`handleTrack`进来的）：直接调用`saveTrackedSnapshotTo(strategyId)`，追加一条快照
- 没有`trackingStrategyId`：先用`findDuplicate`看当前"开仓组合"是不是已经跟某条已存策略完全一致——是的话直接静默把那条已存策略的id写回`trackingStrategyId`，调用`saveTrackedSnapshotTo`存快照，不弹任何对话框；只有真的找不到匹配，才弹出`SaveStrategyDialog`让用户起名保存，保存成功后自动把新建/被覆盖的策略id写回`trackingStrategyId`，再存这次的快照

**快照自动回填**（`backfillTrackedSnapshots`，`savedStrategies.ts`，2026-09-06新增）：为了让"复盘"这类依赖快照密度的功能不完全依赖用户每天手动点刷新，每次通过`handleTrack`或`handleSwitchToCompare`（命中已存策略时）进入对比模式，都会自动跑一遍这个函数——对开仓以来到今天之间、还没有任何快照（真实或已估算）的每个交易日，调`historical-prices` Edge Function拿(open+close)/2当日估算spot，用开仓时反推的IV（flat vol假设）+ 调整后dte，走Black-Scholes重定价，补一条`estimated: true`的快照。**今天本身永远不回填**（留给真实的"保存追踪快照"）。UI上`TrackedComboSection.tsx`的快照选择器会在估算快照后面加"(估)"标记（`compare.estimatedTag`），跟真实快照区分。

**实现上刻意避免了第三份近似实现**：模拟账户的`Timeline`面板（"四、4.3"）早就有一套几乎一样的逻辑（`simAccount.ts`的`backfillSnapshots`），这次没有为对比模式再写一份，而是把"拉历史K线+flat-vol反推IV+理论重定价"这部分抽成了独立的`historicalBackfill.ts`（`fetchHistoricalBars`/`repriceLegsAtDate`），`simAccount.ts`和`savedStrategies.ts`都改成调用这个共享模块，各自只保留自己那部分特有的（`SimPosition`/`SavedStrategy`两种不同数据形状的）拼装逻辑。

**局限**（跟模拟账户那边的回填共享同样的局限）：这是理论BS重定价，不是真实历史期权成交价（Yahoo不提供）；`historical-prices`只保留2个月窗口，更早的日子回填不了；网络请求失败时（比如本地开发环境没配Supabase）静默跳过、不影响进入对比模式这件事本身。

### 3.4 "开仓组合"恢复按钮的语义

见"四、1.2"——对比模式上方"开仓组合"的恢复按钮，恢复的是历史开仓数据而不是今天市场价，跟其他地方的恢复按钮语义不同。

### 3.5 对比模式下开仓时间锁定

"开仓价"+"开仓日期"输入框整个包在`{!isCompareMode && (...)}`里，对比模式下不渲染，本来就是锁定的。**容易搞混的点**：对比模式"开仓组合"header里那个日期选择器，改的是**当前选中快照的保存时间**（`activeSnap.savedAt`），不是`openingAt`，是两个不同的字段——命名/tooltip目前没有特别强调这个区别。

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

`TimelinePanel`（`SimulatorPage.tsx`内部）显示仓位从开仓到现在的历史快照走势和"最佳平仓点 vs 当前"对比，用`TimelineChart`（手写SVG折线，横轴按日历天数比例定位、不是index均分）展示，历史最佳日用琥珀色高亮标出。

**自动回填缺口**：历史快照原本只在手动点"刷新全部持仓"时记录，没刷新过的日子没有数据点。`backfillSnapshots`（打开"趋势"面板时触发，2026-09-06起内部逻辑委托给共享的`historicalBackfill.ts`，见"四、3.3"）对开仓日到今天（或平仓日）之间没有真实快照的每个交易日估算并补一条`PositionSnapshot`，打上`estimated: true`标记，UI用虚线边框+"(估)"标签区分。**限制**：理论重定价、非真实历史成交价；`historical-prices`只保留2个月窗口；今天和平仓当天本身不回填。

**结构信号 + "对比"按钮（真实曲线）**：`classifySpotOnCurve`（`pricing.ts`）判断某个现价在payoff曲线上是"接近峰值/盈利区间/已越过盈亏平衡点"，`analyzeBestExit`（`simAccount.ts`）结合历史最佳快照日和结构位置给出一句话结论+一句解释。`ComparePanel`直接复用`PayoffChart`组件，画出"开仓组合固定曲线 + 当前/平仓组合在曲线上的位置"，持仓和已平仓仓位都有"对比"按钮。

**悔棋模式（"如果没平仓"按钮，Regret Mode A）**：跟"复盘"（B）是一对镜像功能（B是持仓中回看历史某天平仓的结果，A是已平仓后回看假如没平仓到现在的结果），本质都是"最佳平仓点在哪"。**目前只统一改造了B这一侧**，A还没有接入同样的结构信号/统一改造，见"六、已知问题"。

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

IV/HV比值判断（`historicalVolatility.ts`的`computeIvHvNote`）目前只在这个页面用——比值低不代表权利金便宜，如果绝对IV仍然很高，三分类`sellRich`/`buyCheap`/`stillRich`。**分析模式手动搭建组合时看不到这个指标**，见"六、已知问题"。

## 7. AI策略推荐（`AIStrategyPage.tsx`）——开发预览阶段

对应项目说明里"策略方向"部分：以卖方为主（80%）——Sell Put、Bull Put Spread、Iron Condor；买方为辅（20%）——Leap Call，Delta 0.7-0.8，6-12个月；四个模型对比——Claude、GPT-4o、Grok、Gemini。

**当前状态是TEMPORARY dev-preview版本**：真正的设计是每天由一个Supabase Cron job预先跑一次四模型分析、存进数据库，用户打开页面只是读当天已经算好的缓存结果，避免"成本随用户数线性增长"（每个用户打开都现触发一次四个大模型API调用是不可接受的）。**这个每日Cron + DB表的基础设施还没有搭**，现在页面上的按钮是"点击触发一次分析"这种临时占位行为，不是最终形态。`supabase/functions/strategy-analysis/index.ts`是对应的后端函数雏形。这是当前项目的核心未完成模块（对照项目说明"AI分析部分，后续集成"）。

## 8. `App.tsx`内部结构（拆分现状）

`App.tsx`目前约1607行（历史上到过1623行，之后做过两轮结构性瘦身降到1378/1418行左右，2026-09-05/06又因为预设风险揭示联动、对比模式健康度/Greeks重构等新功能陆续长回1607行——这是正常的功能增长，不代表瘦身失败，拆分成果本身没有被撤销）。已经拆出去、留在`App.tsx`里只剩一行调用/一次hook调用的部分：
- 见"三、文件地图"里列的`AppHeader`/`LegListSection`/`LegPanelTitleRow`/`TrackedComboSection`/`LegActionDialogs`/`StrategyPersistenceDialogs`六个组件
- `legFactory.ts`/`dateUtils.ts`（`daysSince`）/`savedStrategies.ts`（`serializeStrategyState`）几个纯helper函数
- `useLegEditing.ts`——`updateLeg`/`toggleLeg`/`deleteLeg`、批量选择四件套（`toggleLegSelection`/`clearLegSelection`/`selectAllLegs`/`selectedCount`/`allSelectedDisabled`/`bulkToggleDisable`/`requestBulkDelete`/`confirmBulkDelete`）、`handleRoll`/`handleRollConfirm`/`handleProtect`/`handleProtectConfirm`/`handleCompare`/`handleHedge`/`handleHedgeConfirm`、`moveLeg`/`moveTrackedLeg`，一共约130行。`App.tsx`里改成一次`useLegEditing({legs, setLegs, setTrackedLegs})`调用后解构使用，JSX里的prop名字全部没变

**2026-09-06新增的计算/展示逻辑**（见"四、1.4"）：`trackedGreeks`（新`useMemo`）、重写的`positionHealth`（按模式分支）、`displayGreeks`/`fmtGreek`（派生常量/helper）。这批memo插在`activeLegs`→`activeTrackedLegs`/`isCompareMode`→`result`→`scenarioPriceById`→`impliedSpot`/`effectiveTrackedSpot`→`trackedGreeks`→`positionHealth`→`displayGreeks`→`pop`/`breakevens`→`analysisAttribution`→`attributionMaxAbs`→`effectiveDaysElapsed`这条链路里，**声明顺序是精心排过的**（TDZ风险，见"五、核心设计原则"），以后要在这批memo中间插入新的，先看清楚自己依赖谁、被谁依赖，不要图省事插在文件末尾。

**故意没有拆的部分**（如果还要继续瘦身，这是候选，但风险更高，不建议随便动）：
- 一串策略管理相关的`useCallback`（`handleSaveStrategy`/`handleOverwriteStrategy`/`handleTrack`/`handleSaveTracked`/`handleSelectSnapshot`/`handleDeleteSnapshot`/`handleUpdateSnapshotTime`/`handleOpenStrategy`/`handleSwitchToCompare`/`performSwitchToAnalysis`/`handleSwitchToAnalysis`，加起来超过300行）——互相调用、共享十几个state/ref，还反向依赖`applyPreset`这种在它们之后才定义的函数，硬拆容易在依赖数组或调用顺序上出错，这类bug`npm run typecheck`不一定能抓出来。这个集群历史上是全项目bug密度最高的地方（换标的不重算、`handleTrack`快照加载、保存快照多余的二次确认这几个真实bug根源都在这里），越是这样越不能在没有充分行为测试的情况下动它的结构
- 一串纯计算的`useMemo`（`result`/`scenarioPriceById`/`positionHealth`/`pop`/`breakevens`/`activeTrackedLegs`/`isCompareMode`/`analysisAttribution`/`attributionMaxAbs`/`impliedSpot`/`effectiveTrackedSpot`/`effectiveDaysElapsed`/`trackedResult`/`trackedGreeks`/`displayGreeks`/`trackedLegPnlById`/`trackedLegRolesById`/`trackedStrategy`/`trackedVolShift`/`pnlAttribution`，约180行）——互相之间有链式依赖（比如`trackedResult`依赖`effectiveTrackedSpot`依赖`impliedSpot`），抽成hook需要把整条依赖链一起搬

这两块理论上都可以像`useAutoSync`/`useCustomPresets`/`useSavedStrategies`/`useLegEditing`那样抽成自定义hook，但工作量和风险都明显更高，需要单独开一轮专门做，而且不能只靠typecheck验证，需要实际操作路径测试（Playwright跑遍真实交互路径确认没问题）。

---

# 五、核心设计原则（接手人应该遵守）

1. **"到期结果"类指标默认不跟随情景滑块**（maxProfit/maxLoss、POP、健康度评分），组合健康度是刻意的例外
2. **决策对比停留在分析模式**——滑块是预演未来情景，跟持有/平仓/展期对比是并列用例
3. **IV/HV比值不能直接当"便宜/贵"的结论**——比值低不代表权利金便宜，如果绝对IV仍然很高（三分类`sellRich`/`buyCheap`/`stillRich`）
4. **动态保证金优于静态**——真实券商是风险度量式动态插值的，静态最坏情况预留是错的
5. **`App.tsx`的TDZ风险**——新插入`useMemo`/`useCallback`必须手动核实声明顺序，esbuild/vite build抓不出这类错误，只有`npm run typecheck`能抓一部分，很多时候连typecheck也抓不出来（类型层面合法），需要实际测试
6. **跨式/宽跨式行权价规则**——跨式两腿锁定同一个ATM行权价；宽跨式两腿都要保持OTM
7. **预设库标准**——只收录真正常见、成熟的策略，不为了凑数量加边缘变体；风险揭示文案每条单独撰写，不用模板套话
8. **"展示框架+解释原因"优于"条件不满足就隐藏UI"**——见"四、4.3"
9. **`createPortal`用于弹出层**——需要用来逃出滚动面板的overflow裁剪
10. **`note`字段（财报组标记）和`linkedStrategyId`字段（对比模式关联）是两个独立字段**，不要混用
11. **一个功能让某个state从"总有值"变成"可能为null"时，要回头检查所有假设它有值的地方**——typecheck抓不出来，只能靠实测
12. **"组合级"展示指标（健康度、Greeks等）要按`isCompareMode`分支选数据源**——分析模式读跟随滑块的开仓组合，对比模式读今日组合（零情景偏移），不能像`positionHealth`曾经那样无条件只读一侧，见"四、1.4"
13. **修改共享逻辑前，先确认哪些模块在复用它**——`historicalBackfill.ts`同时被模拟账户和策略库用，`priceCombo`/`pricing.ts`几乎全项目都在用，改动前搜一遍调用方
14. **`zh.ts`/`en.ts`绝不能无脑"完整文件覆盖"**——见文档开头独立的警示章节，这是本文档里唯一标红级别的规则

---

# 六、当前已知问题 / backlog

产品功能层面的待办，按提及顺序列出（不代表优先级，跟具体某次改动引入的bug是两回事）：

1. **保证金持仓后不会动态跟涨跌**——只有开仓/预览那一刻算得对，需要把`computeMarginUsed`改成用实时股价而不是开仓时冻结的股价，牵涉多个调用点
2. **财报策略80%/70%阈值档**——UI占位已搭好，逻辑没做
3. **财报"方向判断"分支**——UI占位已搭好，内容没做
4. **IV Rank/Percentile真实数据**——卡在要不要接付费历史数据源，还没决定
5. **期限结构（Term Structure）可视化**——同一标的不同到期日的IV放一张图上对比，主要用于日历价差选到期日，提过想法但没开始做
6. **模拟账户的历史快照不会"自动"积累，仍然只在手动点"刷新全部持仓"或打开趋势面板（回填）时记录**——讨论过"每次打开模拟账户页面自动记一次快照"这个方向，涉及组件内部函数声明顺序（TDZ风险），没做。**注意跟对比模式的`backfillTrackedSnapshots`（"四、3.3"，2026-09-06已上线）不是同一件事**——那个解决的是策略库/对比模式的快照密度问题，这一条是模拟账户自己的、仍未解决
7. **`handleAddToSimAccount`这个独立的"快速添加到模拟账户"入口，没有接上`openingAt`**——不确定这个入口具体从哪里触发，暂时继续用`Date.now()`
8. **决策对比没有"对冲"这第四个对比分支**——`HedgeDialog.tsx`已经成熟，理论上可以复用其默认方案逻辑做成四选一
9. **决策比较（compare2）弹窗的展期分支写死+30天**——不像正式`RollDialog`那样有+7/+14/+30快捷键和自定义日期，想比较"展期到下周 vs 下月"哪个划算目前做不到，得去正式展期弹窗手动试错
10. **`HedgeDialog`期权对冲路径没有真正解到目标Delta**——正股对冲精确算出份数打到Delta=0，期权对冲只是"选个行权价、估个权利金"，没有反过来根据残余Delta解应该买卖几张/哪个行权价能刚好对冲掉，达不到真正delta-neutral
11. **全局是每条腿一个扁平IV，没有波动率微笑/skew/期限结构**——情景滑块的波动率偏移统一加减同一个百分点，不同行权价/到期日的IV现实中不会同步涨跌，尤其财报IV Crash策略里各行权价IV回落速度本身不一致。这是几乎所有轻量级期权模拟工具的通用简化，工程量大（需要真实多点IV数据），优先级放低
12. **`PayoffChart.tsx`里有4份几乎重复的情景计算逻辑，3份IV反推实现**——`calcPnL`/`calcPnLAtTime`/`calcTrackedPnL`/`calcTrackedPnLAtTime`四个函数各自独立实现同一套"反推IV+重新定价"逻辑，`impliedVol`本身在`pricing.ts`和`PayoffChart.tsx`里各有一份几乎一样的实现。不是功能缺陷，但每次修一个定价细节的bug都有忘记同步改另外几处的风险，建议找机会收敛成共享函数。2026-09-06复盘时曾怀疑`positionHealth`的Delta因子读取处也有类似重复问题，核实后确认那里没有重复代码（只是一条过时注释），这条才是真正待处理的
13. **年化收益率（Return on Margin）没有算**——`margin.ts`已经算出保证金占用，但系统里没有"净收权利金÷保证金占用，按天数年化"这个数字。专业期权卖方选仓位比较的通常是资金效率而非绝对收益，这个数据现成、加一个字段工作量不大，对"以卖方为主"的策略philosophy来说是目前明显缺失的核心指标，价值较高
14. **IV/HV比值目前只在场景选择器里用**——`scenarioEngine.ts`那套`sellRich`/`buyCheap`/`stillRich`三分类逻辑只在"从场景开始"引导流程里用，手动在分析模式搭建自定义组合时看不到，建议在分析模式股票输入区域旁边也露出
15. **悔棋模式（Regret Mode A，"如果没平仓"按钮）**——用户反馈"问题比较大"，具体怎么改还没讨论清楚，下次动手前要先问清楚设计诉求。B（"复盘"）已经统一改造过，A还没有
16. **AI策略推荐（`AIStrategyPage.tsx`）的每日Cron+缓存基础设施还没搭**——见"四、7"，是当前最大的未完成模块
17. **`App.tsx`还有约400-480行策略管理handler+计算useMemo没有拆分**——见"四、8"，风险较高，需要单独一轮细致处理
18. **claude.ai项目的GitHub同步白名单持续滞后于main分支实际文件**——`zh.ts`/`en.ts`是最新踩过的例子（见文档开头独立警示章节），如果发现新加的文件没被project索引到，遇到关键判断优先直接读GitHub raw内容核实，不要只信`project_search`
19. **展期会留下永久的"幽灵腿"，占用10腿上限的名额**——`RollDialog`确认展期后旧腿位标记`disabled:true`永久留在数组里，`addLeg`的10腿上限按数组总长度判断、不是有效腿数，一个仓位展期两三次可能在无意识中顶到上限。建议给disabled的腿单独归档不占用上限，或至少提示"还剩几个可用腿位额度"

---

# 七、给接手的人（无论是人类开发者还是下一个AI会话）

1. **第一步永远是跟GitHub真实代码做一次全面比对**，确认这份文档反映的状态和实际代码库一致，再开始改动
2. **动`zh.ts`/`en.ts`之前，务必读完文档开头的独立警示章节**——完整文件覆盖对这两个文件是有回归风险的真实教训，不是假设性提醒
3. "六、已知问题"是最直接能接手的任务列表，按当下兴趣或优先级挑一项——13（年化收益率）和12（PayoffChart重复实现）目前看是性价比较高的候选
4. 遇到"某个条件不满足就整个隐藏UI"的写法，默认改成"展示框架+解释原因"（"五、8"）
5. `App.tsx`新增`useMemo`/`useCallback`时注意TDZ风险，手动核对声明顺序；新增"组合级"展示指标时按`isCompareMode`分支选数据源（"五、12"）
6. 财报相关改动注意`note`和`linkedStrategyId`是两个独立字段
7. 交付代码遵守"一、开发/交付流程约定"里的规范（完整文件、路径注释、typecheck验证）
8. 这份文档改完之后按开头"维护方式"的约定去改，不要退回按会话追加的旧模式