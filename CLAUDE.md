<!-- CLAUDE.md -->

# OptionPilot 交接文档（整合版）

**版本**：整合版，更新于 2026-09-07（当天第二轮）。本次更新合并了 2026-09-05（预设风险揭示+到期盈亏小图+9条预设内容修正）、2026-09-06上半（zh.ts/en.ts严重滞后事故的修复与教训）、2026-09-06下半（对比模式健康度/Greeks修正、追踪快照自动回填、一个由此引入又当场修复的布局bug）、2026-09-07上半（竞品调研`FEATURE_PROPOSALS_2026-09.md`第20条里的四项一次性实现：仓位管理提醒、模拟账户交易统计面板、术语悬浮提示、展期前后风险对比图；随后做了一轮完整性/一致性复核，新增开头的"项目现状一览"速览表）、2026-09-07下半（功能精简走查：模块引导弹窗加"不再显示"持久化选项、移除组合级Greeks数字展示面板（保留计算供健康度使用）、修复展期风险对比图在"仅改到期日"场景下曲线失真/看似无变化的bug、备份序列化逻辑去重、评估localStorage容量隐患）、2026-09-07第三轮（UI布局微调：健康度徽章+分析↔对比模式切换按钮从左侧腿位面板搬到`PayoffChart.tsx`标题栏、紧挨着股票代码，`LegListSection.tsx`和`TrackedComboSection.tsx`各自独立的一份"开仓组合"统计网格——股价/时间流逝/隐含波动率——是完全重复的展示，删掉了信息量更少的`LegListSection.tsx`那一份，只保留`TrackedComboSection.tsx`带持仓盈亏列的那份）几轮会话的成果。**这是当前最新、最权威的交接文档版本**，跟仓库其它文件一起push到GitHub main分支后，应视为项目当前状态的唯一事实来源（直到下一次更新）。**这份文档替代了之前"按会话追加"的版本**——旧版本是每轮会话在文末加一个新章节，越滚越长，找一个功能的现状要翻好几个章节、对着时间戳自己判断哪段是最新的。这份文档**按功能/模块组织，只描述"现在是什么样"，不按时间顺序记流水账**。

**维护方式（重要，后续会话都要遵守）**：
- 做完一个功能改动或修复了一个bug，**直接去改对应的章节内容**，让它反映当前状态，不要在文末追加"2026-xx-xx又做了什么"这种新章节。
- 如果改动创建了新文件/新模块，在"三、文件地图"和"四、功能模块详解"里对应位置加进去。
- 如果解决了"六、已知问题"里的一条，从列表里删掉（不是标记"已完成"留着不删）。
- 如果发现了新的已知问题/技术债，加进"六、已知问题"。
- 只有在某个改动本身特殊到值得单独留痕迹时（比如一次重大架构决策、一次踩坑教训——**语言文件那次事故就是这种情况，见下面独立的警示章节**），才写成"设计笔记"/"事故记录"性质的独立小节，正常的功能新增/bug修复不需要。
- 每次改完这份文档，**开头这个"版本"行的日期改成当天**，作为"文档更新到什么程度"的唯一时间戳，不需要维护一份变更日志。

**如果需要查历史会话的详细讨论过程**（比如某个设计决策当初为什么这么定、具体的调试过程），更细粒度的分主题讨论记录都保留在claude.ai的"options pilot"项目文档里（`claude/wiring-check-2026-09-03.md`、`claude/mode-switch-and-restore-2026-09-03.md`、`claude/sim-account-changes-2026-09-02.md`、`claude/preset-risk-disclosure-2026-09-05.md`、`claude/i18n-staleness-incident-2026-09-06.md`、`claude/analysis-compare-mode-review-2026-09-06.md`是几次专项讨论/事故的详细记录）。这份新文档不重复那些讨论过程，只给结论和现状。

**重要提醒（接手第一件事）**：这份文档、以及历次对话里所有的代码交付，都基于Claude自己维护的一份**本地沙盒副本**，不是直接读GitHub实时代码（除非某次会话特意说明是直接读的）。这份副本的准确性依赖于用户本地是否已经把每次交付的文件都正确落地、commit、push。**接手的人第一件事，应该是拿这份文档跟GitHub仓库（`github.com/lixuedenon/OptionPilot`，main分支）的真实文件做一次比对**，确认没有偏差再开始改动。**2026-09-07发现过一次真实的文档/代码不同步**：仓库main分支当时的`CLAUDE.md`落款日期是09-06，但同一次push里的代码其实已经包含了09-07当天新增的`Term.tsx`/`RollComparisonChart.tsx`/`SimStatsPanel.tsx`等文件——即"代码已经改了、文档没跟着改"，这份文档本身也会踩自己警告过的坑，接手时不要预设文档落款日期等于代码的真实进度。

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

## 项目现状一览（30秒读完，先建立整体印象，细节看"四、功能模块详解"对应小节）

| 模块 | 状态 | 一句话备注 |
|---|---|---|
| 分析模式（期权组合编辑器，"四、1"） | ✅ 成熟 | 期权链自动填充、换标的自动重映射行权价、情景滑块、组合健康度、42个内置预设+风险揭示+迷你到期图、术语悬浮提示（范围克制）、决策对比（不动/平仓/展期）。**组合级Greeks数字面板已移除**（2026-09-07下半，见"四、1.4"），计算本身还在，只是不再展示 |
| 跟踪对比模式（"今日组合"，"四、3"） | ✅ 成熟 | 开仓组合（固定）+快照序列（会增长）的数据模型，快照自动回填，开仓↔今日腿位对应关系（`openLegId`）已修复 |
| 策略库（保存/预设/识别，"四、2"） | ✅ 成熟 | 42个内置预设+自定义预设，`matchStrategy.ts`反向识别策略名 |
| 模拟账户（"四、4"） | ✅ 成熟，个别子功能待打磨 | 动态保证金（TIMS式插值）、趋势/悔棋面板（B侧"复盘"已统一改造，A侧"如果没平仓"还没有，见backlog第15条）、仓位管理提醒+交易统计面板、财报IV Crash端到端集成。**备份/自动同步的序列化逻辑已去重**（2026-09-07下半），但底层仍是localStorage单一JSON大对象，见"四、4.4"的容量隐患说明 |
| 财报IV Crash策略（"四、5"） | ✅ 90%档完整 | 80%/70%阈值档、"方向判断"分支目前只有UI占位，没有内容 |
| 场景选择器（"四、6"） | ✅ 方向判断分支完成 | "待定"标签仍是占位，**按xue的决定暂时保留，等做出真内容再考虑要不要先隐藏**（2026-09-07确认，见backlog第20-b条） |
| AI策略推荐（"四、7"） | 🚧 开发预览阶段，**当前最大的未完成模块** | 四模型（Claude/GPT-4o/Grok/Gemini）分析雏形已有，但"每天跑一次Cron+存DB+用户只读缓存"这套正式架构还没搭，现在是"点一下现触发一次"的临时占位行为 |

**语言文件`zh.ts`/`en.ts`出过两次事故**（详见下面独立警示章节）——这是这个项目维护中唯一一件"一步走错会直接让用户界面大面积裂开"的事，任何时候要动这两个文件，先把警示章节读完。

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

`App.tsx`（当前约1699行，是全项目最大、最核心的文件）**同时承担"分析模式"和"跟踪对比模式"两种UI**，不是两个组件——区分靠一个派生状态：

```
isCompareMode = trackedLegs !== null
```

两套并行的数据：
- **`legs`/`spot`/`openingAt`**（开仓组合/分析模式基线）——分析模式下可以自由编辑；对比模式下渲染成"开仓组合"那一块，只读展示（除非通过"恢复"按钮把它对齐回原始数据）
- **`trackedLegs`/`trackedSpot`/`effectiveTrackedSpot`**（持仓组合/今日组合）——只在对比模式下存在，可编辑，代表"这个组合现在的实际状态"

这两套数据通过`trackingStrategyId`（可能为`null`）关联到一条持久化的`SavedStrategy`记录（见"四、2"策略库一节的数据模型）。`App.tsx`内部按功能拆成了几个presentational子组件（见"三、文件地图"），但**状态管理和事件处理逻辑几乎全部留在`App.tsx`本体**，子组件基本是"纯JSX + props透传"，没有自己的state（详见"四、8"App.tsx结构小节）。

**两套数据在健康度等"展示层"计算上如何选边**（2026-09-06确立的原则，见"四、1.4"）：几乎所有派生计算都要问自己"现在到底该读哪套数据"——`isCompareMode`为true时读`trackedLegs`/`effectiveTrackedSpot`一侧（"今日组合"），为false时读`legs`/`spot`/`shifts`一侧（分析模式，跟随情景滑块）。这条分支模式（`positionHealth`/`trackedGreeks`）是这次修复后新立的范式，以后任何新加的"组合级"展示指标，默认都应该照这个模式接入两种模式，而不是像`positionHealth`曾经那样无条件只读`legs`一侧。

---

# 三、文件地图

## 顶层页面（`src/*.tsx`）

| 文件 | 大致行数 | 职责 |
|---|---|---|
| `Shell.tsx` | ~167 | 顶层路由状态机（见上）|
| `HomePage.tsx` | ~205 | 首页四张模块卡片；2026-09-06起还承载右上角「数据」下拉菜单（导出/导入/链接备份文件），从`AppHeader.tsx`搬过来的，见"四、9" |
| `App.tsx` | ~1699 | 分析模式+对比模式，核心工作区（见下方专门小节）|
| `SimulatorPage.tsx` | ~1618 | 模拟账户页面，全项目第二大文件——仓位列表、开平仓、保证金展示、财报仓位面板、趋势/悔棋面板 |
| `ScenarioSelectorPage.tsx` | ~571 | "从场景开始"三标签页：方向判断（场景引擎推荐）/财报（IV Crash入口）/待定（占位）|
| `AIStrategyPage.tsx` | ~146 | AI四模型策略推荐页面，**当前是开发预览版**，见"四、7" |
| `ComingSoonPage.tsx` | ~43 | 通用"敬请期待"占位页 |
| `main.tsx` | 12 | React入口 |

## `src/components/`（可复用UI组件，非页面）

按用途分组：

**分析/对比模式的直接子组件**（专为`App.tsx`拆分出来，语义上属于`App.tsx`的一部分）：
- `AppHeader.tsx`（~211行）——顶部header：标的输入+联想、现价、帮助按钮等。**不再包含分析↔对比模式切换控件**——2026-09-06再次搬家，见下面`legToolbar`的说明。**也不再包含「数据」下拉菜单**（导出/导入/链接备份文件）——2026-09-06搬到`HomePage.tsx`右上角，语言切换按钮旁边，见"四、9"；`App.tsx`里的`useAutoSync()`调用本身没删，后台自动同步继续跑，只是可见的按钮/下拉菜单挪走了
- `LegListSection.tsx`（~258行）——腿位列表区：批量操作工具栏（全选/清空/批量删除/保存策略组合按钮）+ 逐条`LegRow`。**健康度徽章已不在这个组件里**（2026-09-07第三轮搬去了`PayoffChart.tsx`标题栏，见下）；对比模式下原本还有一份"开仓组合"股价/时间流逝/隐含波动率统计网格，跟`TrackedComboSection.tsx`那份几乎完全重复，同一轮里删掉了，`positionHealth`/`effectiveTrackedSpot`/`liveSpot`/`activeTrackedLegs`/`effectiveDaysElapsed`几个只为这两处服务的props和`weightedAvgIV`引用一并从这个组件移除
- `LegPanelTitleRow.tsx`（~37行）——腿位区标题行：**只剩**策略徽章和腿数。模式切换按钮/下拉菜单、"对比模式"文字徽章都已经搬走/移除，见下面`legToolbar`的说明
- `TrackedComboSection.tsx`（~203行）——对比模式"今日组合"整块：快照选择器（含"(估)"估算标记，见"四、3.3"）、保存按钮、开仓vs当前统计网格（股价/时间流逝/隐含波动率/持仓盈亏四列——这是全项目现在唯一一份这样的统计网格，`LegListSection.tsx`原来那份三列的重复版本已删除）、腿位列表。**健康度徽章已不在这个组件里**（2026-09-07第三轮搬去了`PayoffChart.tsx`标题栏，见下）
- `LegActionDialogs.tsx`（~159行）——leg级别弹窗集合（保存预设/清空确认/批量删除确认/丢弃追踪确认/展期/保护/对冲/决策对比/隐含现价说明），纯转发props给各自的真实弹窗组件
- `StrategyPersistenceDialogs.tsx`（~133行）——策略保存/切换/离开相关弹窗集合（预设切换确认/替换确认/离开确认/模式切换确认/保存策略对话框/管理策略对话框）
- `LegRow.tsx`（~752行，全项目最大的单个组件）——单条腿位的编辑行，含**期权链自动填充逻辑**（见"四、1.2"）

**分析模式的其他功能组件**：
- `PayoffChart.tsx`（~1025行）——到期损益图，SVG绘制，含情景滑块联动、对比模式双线叠加。**2026-09-07第三轮新增两个可选prop**：`positionHealth`/`modeSwitchButton`——标题栏股票代码旁边现在会渲染健康度徽章和分析↔对比模式切换按钮（`App.tsx`负责算`positionHealth`、拼`modeSwitchButton`这个`ReactNode`，`PayoffChart.tsx`本身不关心这两样东西具体是什么，只管渲染在`{symbol}`旁边），两者都是可选的、缺省不渲染任何东西。这两样以前分别在`LegListSection.tsx`/`TrackedComboSection.tsx`（健康度徽章）和`legToolbar`最左边（切换按钮）——按xue的要求搬到这里，因为看盘时视线本来就先落在图表旁边的股票代码上。**内部有已知的重复实现问题**，见"六、已知问题"。`getZone()`（判断当前盈亏落在哪个提醒区间：golden/great/danger/stop/neutral）2026-09-06修过一个bug——debit策略分支的"golden"条件原来只有下界（`pnl >= 0.5*maxP`）没有上界，导致后面`pnl > 0.7*maxP`的"great"分支永远进不去，debit策略盈利冲到70%以上还会一直显示止盈提醒而不是正确地安静下来；改成跟credit分支一样加上界（`0.5*maxP ~ 0.7*maxP`）后"great"分支恢复可达
- `PayoffSparkline.tsx`（~78行，2026-09-05新增）——预设悬浮框里的"到期盈亏形状"迷你曲线图，复用`pricing.ts`的`payoffCurvePoints`，不重新发明计算逻辑，见"四、2.2"
- `PnlAttributionPanel.tsx`——P/L归因面板（滑块驱动/跟踪对比两种模式）
- `PositionHealthBadge.tsx`——组合健康度徽章。渲染位置2026-09-07第三轮搬到`PayoffChart.tsx`标题栏（股票代码旁边），组件本身没变，只是调用方从`LegListSection.tsx`/`TrackedComboSection.tsx`换成了`PayoffChart.tsx`
- `ShiftSliders.tsx`——情景滑块（现价/时间/波动率三个维度）
- `StrategyBadge.tsx`——策略名称徽章（含`dirKeyMap`，别处也在用）
- `DecisionCompareDialog.tsx`——决策对比弹窗（不动/平仓/展期三选一对比）
- `RollDialog.tsx` / `ProtectDialog.tsx` / `HedgeDialog.tsx`——展期/保护/对冲三个操作弹窗。`RollDialog.tsx`内嵌`RollComparisonChart.tsx`，见"四、1.5"（**2026-09-07下半修过一个曲线失真bug**）
- `SavePresetDialog.tsx` / `PresetPicker.tsx`（~343行）——自定义预设保存/选择；`PresetPicker.tsx`悬浮框里还渲染风险揭示`RiskDisclosure`和`PayoffSparkline`（见"四、2.2"）
- `SaveStrategyDialog.tsx` / `ManageStrategiesDialog.tsx`——保存策略/管理已存策略（含跟踪、置顶、重命名、删除）
- `DropdownMenu.tsx`——通用下拉菜单（render-prop `children: (close) => ReactNode`）
- `Term.tsx`（2026-09-07新增）——通用"点击查看术语解释"组件，见"四、1.6"。**接入范围2026-09-07下半收窄了**——原来App.tsx标题栏净Delta/Theta/Vega/Gamma四个标签用它，随着那个展示面板整体移除，这四处也一起没了，目前只剩`EarningsIvCrashTab.tsx`的"所需保证金"一处在用
- `RollComparisonChart.tsx`（2026-09-07新增）——`RollDialog.tsx`专用的展期前/后到期盈亏对比迷你图，见"四、1.5"

**财报策略专用**：
- `EarningsTabRoot.tsx`——财报标签顶层导航（IV Crash vs 方向判断 vs 阈值档位选择）
- `EarningsIvCrashTab.tsx`——90%档IV Crash完整开仓流程UI
- `EarningsPositionsPanel.tsx`（~344行）——财报仓位专属管理面板

**其他**：
- `ErrorBoundary.tsx`——React错误边界，每个Shell view都包了一层
- `LanguageSwitcher.tsx`——中英文切换
- `SimStatsPanel.tsx`（2026-09-07新增）——模拟账户交易统计面板，纯展示组件，见"四、4.5"

## `src/components/dialogs/`（小型确认弹窗集合，`index.ts`统一导出）

`AlertCard.tsx`、`HelpPanel.tsx`、`ImpliedSpotInfoPanel.tsx`、`MarginErrorDialog.tsx`、`ConfirmClearDialog.tsx`、`ConfirmBulkDeleteDialog.tsx`、`ConfirmSaveTrackedDialog.tsx`、`ConfirmSnapshotDialog.tsx`（预设切换和模式切换两处复用同一个组件）、`ConfirmReplacePresetDialog.tsx`、`ConfirmLeaveDialog.tsx`、`ConfirmResetAccountDialog.tsx`——全是纯展示型的小确认框，逻辑都在调用方。

`HelpPanel.tsx`是个例外，2026-09-06重构成了模块感知组件（不再是单一的通用说明文档），详见"四、9"。**2026-09-07下半新增持久化"不再显示"**：`gate`变体的确认按钮旁多了一个复选框，勾选后写入`localStorage`（`optionpilot.guideDismissed.<moduleId>`），该模块的首次引导以后永久不再自动弹出（除非清了浏览器数据）；同时导出了`isGuideDismissed(moduleId)`供`App.tsx`/`SimulatorPage.tsx`的初始state判断，避免"先闪一下再关掉"。`variant="info"`（header常驻的"使用说明"按钮）不受影响，永远可以手动重新打开同样的内容。

## `src/hooks/`

- `useAutoSync.ts`——文件系统自动同步hook（配合`lib/autoSync.ts`）
- `useCustomPresets.ts`——自定义预设的加载/增删状态封装
- `useSavedStrategies.ts`——已存策略列表的加载/增删状态封装
- `useLegEditing.ts`——开仓组合单腿的增删改、批量选择/批量屏蔽/批量删除、展期/保护/对冲/比较四个弹窗的目标状态，以及`moveLeg`/`moveTrackedLeg`两个顺序调整函数。从`App.tsx`拆出，接收`{legs, setLegs, trackedLegs, setTrackedLegs}`。展期/保护/对冲三个handler（`handleRoll`/`handleProtect`/`handleHedge`）额外接受一个`source: "legs" | "tracked"`参数（默认`"legs"`），决定操作目标是开仓组合还是今日组合——2026-09-06修复前这三个handler无论从哪调用都写死操作`legs`，今日组合那边点展期/保护/对冲实际改的是开仓组合，见"四、3.6"

## `src/lib/`（核心业务逻辑，无UI）

**定价与组合计算**：
- `types.ts`——`Leg`/`Shifts`/`GreekBreakdown`等核心类型定义。`Leg`新增可选字段`openLegId?: string`（2026-09-06），只在`trackedLegs`的腿上有意义，见"四、3.6"
- `bs.ts`——Black-Scholes定价模型+希腊字母
- `pricing.ts`（~533行，核心算法文件）——`priceCombo`（组合定价+归因，返回的`ComboResult.breakdown`含完整的组合级delta/gamma/theta/vega——**这份计算本身2026-09-07下半之后仍然保留**，只是App.tsx里显示这四个数字的面板被移除了，见"四、1.4"）、`payoffCurvePoints`、`probabilityOfProfit`、`findBreakevens`、`maxProfitLoss`、`impliedVol`/`impliedSpotFromPremiums`、`attributePnl`（P/L归因）、`classifySpotOnCurve`（判断某现价在payoff曲线上是"接近峰值/盈利区间/已越过盈亏平衡点"，供模拟账户"复盘"面板用）、`pnlAtExpiry`（**内部对"多到期日组合"有特殊处理**——不同到期日的腿，用最早的到期日作horizon，horizon之外还没到期的腿用Black-Scholes按剩余天数估值而不是直接按内在价值算，这是为了让真正的日历/对角价差算出正确的到期盈亏，见"四、1.5"里`RollComparisonChart`踩过的坑）等。**`RATE`（0.05）和`POP_DRIFT_RATE`（0）是两个刻意分开的常量，不要合并**（2026-09-06）：`RATE`是喂给Black-Scholes定价本身的无风险利率，这个必须是真实的无风险利率，改了会导致所有腿位定价错误；`POP_DRIFT_RATE`只用在`probabilityOfProfit`的对数正态分布漂移项（`mu`那一行），回答的是"到期盈利的真实世界概率"这个完全不同的问题——用无风险利率当真实世界的股价预期漂移，会系统性低估看涨类策略（Sell Put、牛市put价差，这些策略靠股价走平或上涨才赚钱）的POP、高估看跌类策略（Sell Call、熊市call价差）的POP，因为真实股票的预期回报率（股权风险溢价）通常高于无风险利率。真实预期回报率本身没法准确估计（估计多少都是在替市场做主观判断），所以按xue的决定（2026-09-06，讨论10年期美债收益率4.5% vs.这里当时的5% RATE时定的）**统一用零漂移**——跟tastytrade等平台的惯例一致，让POP不因为漂移假设本身而对看涨/看跌策略产生方向性偏袒。`RATE=0.05`这个值本身还分散在7个其它文件里（`PayoffChart.tsx`/`ProtectDialog.tsx`/`RollDialog.tsx`/`HedgeDialog.tsx`/`historicalBackfill.ts`的`BACKFILL_RATE`/`supabase/functions/strategy-analysis/index.ts`/`supabase/functions/_shared/deltaMatch.ts`），但那些全部是喂给各自的Black-Scholes定价调用，跟这里的POP漂移问题无关，不需要跟着改成0——**只有`probabilityOfProfit`这一处用到的是"真实世界概率漂移"这个语义，其它都是定价用途**
- `legRoles.ts`——腿位角色解释（这条腿在组合里扮演什么角色，供逐条腿展示用）
- `legFactory.ts`——`uid`/`blankLeg`/`PRESET_DTE_SET`几个创建腿位用的小helper（从`App.tsx`拆出），2026-09-06新增`asOpeningLeg(leg, newId)`——把一条腿（不论来自开仓组合还是今日组合）克隆成一条新的开仓组合腿，同时去掉`openLegId`字段，见"四、3.6"
- `matchStrategy.ts`——从一组腿位反推策略名字（含"窄体铁鹰"/"玉蜥蜴"两种四腿/三腿结构的区分识别，见"四、2.3"）
- `positionHealth.ts`——组合健康度评分（四维度各25分），**调用方需要按当前模式传入对应的legs/spot/breakdown**，见"四、1.4"
- `decisionCompare.ts`——决策对比的核心计算（不动/平仓/展期三分支）

**策略库/预设**：
- `savedStrategies.ts`（~293行）——`SavedStrategy`/`TrackedSnapshot`数据模型+CRUD（localStorage存储），`TrackedSnapshot`新增`estimated?: boolean`字段，新增`backfillTrackedSnapshots()`自动回填函数，见"四、2.1"和"四、3.3"。**这张表会随时间无上限增长**（每个交易日一条快照，从不清理），见"四、4.4"容量隐患说明
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
- `simAccount.ts`（~492行）——`SimPosition`/`SimAccount`/`PositionSnapshot`数据模型+CRUD、`computeMarginUsed`/`computeAvailableCapital`/`checkMarginForOpen`（保证金检查）、`analyzeBestExit`（悔棋模式用）、`computeCostBasis`/`computeMarkValue`、`backfillSnapshots`（趋势面板回填，2026-09-06起复用`historicalBackfill.ts`的共享逻辑，自身不再维护一份历史K线拉取+重定价实现）。**这张表同样会随时间无上限增长**，见"四、4.4"
- `margin.ts`（~278行）——`computeComboMargin`，动态保证金插值算法（见"四、4.2"）
- `simStats.ts`（2026-09-07新增）——`computeSimStats`，从已平仓仓位算胜率/盈亏比/最大回撤/连胜连亏，见"四、4.5"

**财报策略**：
- `earningsStrategy.ts`（~204行）——三组结构定义、期权链取值、仓位大小反推、聚合预览
- `earningsClosing.ts`——平仓阶段判断逻辑（近期组2小时窗口、中远期组三分支）

**场景引擎**：
- `scenarioEngine.ts`（~697行）——固定查表式场景推荐（`SCENARIO_RULES`覆盖30种桶组合）、`computeBucketBounds`、`rankPresetsForScenario`

**数据备份/同步**：
- `dataTransfer.ts`——导出/导入整个应用数据（`ExportData`，含策略库/自定义预设/最近标的/模拟账户，version 1→2 演进过）。**2026-09-07下半新增`collectBackupPayload()`**——把"从localStorage六个key读出并拼成`ExportData`"这段逻辑收敛成一个导出函数，`exportAllData`和`autoSync.ts`的`autoSyncWrite`都改成调用它，不再各自维护一份一模一样的读取代码，见"四、4.4"
- `autoSync.ts`——File System Access API自动同步到本地文件（IndexedDB存文件句柄）。写入内容现在来自`dataTransfer.ts`的`collectBackupPayload()`，不再是自己手写的第二份序列化代码

## `src/i18n/`

`I18nContext.tsx`（`useI18n()` hook + `t(key, vars?)`）、`translations.ts`、`locales/zh.ts`+`locales/en.ts`（各~630行，键值对翻译文件，**改动前必读上面的"语言文件维护须知"独立章节**）。**2026-09-07下半**：新增`help.gateDontShowAgain`（引导弹窗"不再显示"复选框文案）、`roll.compareSameShapeNote`（展期对比图两条曲线几乎重合时的说明文案）；删掉了`greeks.netDelta`/`netTheta`/`netVega`/`netGamma`/`hint`和`glossary.delta`/`deltaDesc`/`theta`/`thetaDesc`/`vega`/`vegaDesc`/`gamma`/`gammaDesc`共13个key（只有已移除的Greeks展示面板在用，删前`grep -rn`确认过零其它引用，删后照例跑了zh/en双向key差集检查，0缺口）。

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

### 1.4 情景滑块 / P/L归因 / 组合健康度（2026-09-06重构两种模式各读各的数据；2026-09-07下半移除了净Greeks展示面板）

- `ShiftSliders.tsx`：现价（dS）、时间（dT）、波动率（dV）三个维度的滑块，驱动`PayoffChart`和归因面板重算。**对比模式下滑块是冻结的只读遥测**（"对比模式已冻结"），不是推演——对比模式没有"如果价格再变"这种情景推演的语义，滑块UI仍会渲染出来但不接受拖动
- `PnlAttributionPanel.tsx` + `pricing.ts`的`attributePnl`：把盈亏拆成"哪个维度贡献了多少"，滑块驱动模式和跟踪对比模式两种数据源
- **组合健康度**（`PositionHealthBadge.tsx` + `positionHealth.ts`）：四维度各25分——到期盈利概率(POP)、距盈亏平衡点距离、临近到期的Gamma风险、每张合约平均Delta归一化。健康度现在**按当前所在模式选边**（`App.tsx`的`positionHealth`这个`useMemo`）：分析模式下用`activeLegs`/`spot`/`shifts`算（跟随情景滑块，因为POP/盈亏平衡距离/DTE风险三项本来就用`buildShiftedLegs`跟随滑块），对比模式下改用`activeTrackedLegs`/`effectiveTrackedSpot`（零情景偏移，今日组合，因为对比模式滑块本来就是冻结遥测）。**这是2026-09-06修的一个设计错位**——在这之前，对比模式复用分析模式同一个健康度徽章，但看到的数字实际算的是"开仓组合"，不是"今日组合"，跟对比模式"管理一个正在持有的仓位"的定位不符。因为这个计算现在直接依赖`activeTrackedLegs`/`effectiveTrackedSpot`（这两个值本来就会随选中的快照变化），切换不同快照会自动得到不同的健康度，不需要额外的per-snapshot存储
- **组合级Greeks（净Delta/Theta/Vega/Gamma）计算依然存在，但展示面板已移除**（2026-09-07下半，xue的决定）：`pricing.ts`的`priceCombo()`用有限差分算出完整的组合级`delta/gamma/theta/vega`，这份`result.breakdown`（分析模式）/`trackedGreeks.breakdown`（对比模式）**仍然是`positionHealth`的Gamma风险因子和Delta归一化因子的真实数据来源，不能删**。2026-09-06一度在标题栏加了一个直接显示这四个数字的小面板（`displayGreeks`+`fmtGreek`+对应的4个`Term`术语提示），2026-09-07下半xue认为这个面板性价比不高、精简掉了——`displayGreeks`/`fmtGreek`这两个纯展示用的变量和对应的JSX面板、以及专用的`glossary.delta/theta/vega/gamma`系列i18n key都一并删除；`trackedGreeks`这个`useMemo`本身（连同它喂给`positionHealth`的数据流）原样保留，**以后如果要重新展示这四个数字，数据已经现成，只需要重新加回显示层**
- **"到期结果"类指标默认不跟随情景滑块**（maxProfit/maxLoss、POP、健康度评分是刻意的例外）——这条设计原则本身没变，见"五、核心设计原则"

#### 1.5 展期前后风险对比图（`RollComparisonChart.tsx`）

`RollDialog.tsx`新增一个`allLegs: Leg[]` prop（调用方传入这条腿所在的完整组合——`LegActionDialogs.tsx`按`rollTargetSource`传`legs`或`trackedLegsForDialogs`，`SimulatorPage.tsx`传`rollTarget.pos.legs`），对话框内部用`useMemo`算出"展期前"（`allLegs.filter(l => !l.disabled)`，过滤掉之前展期留下的幽灵腿，见"六、已知问题"第19条）和"展期后"（同一份过滤后的数组，把正在展期的那条腿换成当前输入框里的行权价/权利金草稿值，随输入实时更新）两个组合，渲染进`RollComparisonChart.tsx`。

**故意没有复用`PayoffChart.tsx`**：那个组件耦合了对比模式健康度/`onAlert`/情景滑块修正等一堆跟"展期前后到期盈亏"这个单一问题无关的状态。改用`pricing.ts`已有的纯到期盈亏函数（`payoffCurvePoints`/`maxProfitLoss`）自己画一个小SVG双线叠加图（灰色虚线=展期前，蓝色实线=展期后），跟`PayoffSparkline.tsx`是同一路数——小巧、无状态、只依赖传入的legs/spot。两条曲线都用同一个`spot`调`payoffCurvePoints`，取样窗口只由spot决定（跟legs无关），所以两条曲线的x轴天然对齐，不需要额外做窗口对齐处理。

**⚠️ 曲线失真/看似"没变化"的bug，2026-09-07下半修复**：xue实测发现"有的策略展期的比较在图形上没有变化"。排查后是两类现象叠加：

1. **单腿、同行权价、权利金也基本没变的纯展期**（只是往后挪日期）——两条曲线**逐点完全相等，这是数学上正确的行为，不是bug**。`pnlAtExpiry`（`pricing.ts`）算的是"到期时"的盈亏，到期时的内在价值只取决于行权价，跟当初的到期日无关——只挪日期、不动行权价、净成本也不变的展期，在"到期盈亏图"上本来就应该长得一模一样（这类展期的真实价值是换取更多时间/降低提前指派风险，到期盈亏图这个维度天生看不出来）。**2026-09-07下半在图表下方加了一行`roll.compareSameShapeNote`提示文案**（两条曲线PnL逐点误差小于0.5时触发），专门解释这种"看起来没反应"其实是正常的，避免用户以为图表坏了。
2. **多腿组合只展期其中一条腿到不同的到期日时，"展期后"那条曲线曾经会失真、甚至出现非单调的诡异形状**——真正的实现bug。根因：`pnlAtExpiry`对"多到期日组合"有专门处理（这本身是2026-09-06之前为了修真正的日历/对角价差"最大亏损算成正数"的bug加的、是必要且正确的逻辑，见"三、文件地图"`pricing.ts`条目）——只要combo里的腿出现不止一个不同的`dte`值，就判定为"多到期日组合"，取最早到期日作为horizon，horizon之外的腿改用Black-Scholes按剩余天数定价而不是按内在价值算。问题是：`RollDialog`原来把"展期后"草稿腿的`dte`直接设成真实的新到期日——只要新到期日跟组合里其它腿不一样（几乎每次"往后展期"都会这样），"展期后"这一侧就意外触发了"多到期日组合"分支，而"展期前"那一侧（腿位到期日还都一致）没有触发，导致两条曲线在两套不同的定价口径下计算，"展期后"曲线里被展期的那条腿不是按真到期算的内在价值，而是按BS理论价打了折扣，实测会出现过了行权价盈亏反而往回走的非单调曲线。**这套"多到期日"特殊处理对着真正设计成日历/对角价差的组合是对的，但套在"临时预览一次单腿展期"这个场景上是错的**——展期对比图想回答的问题是"这次展期怎么改变了到期盈亏的形状"，不是"如果只有这条腿真的展期到位、其它腿真的到期归零、中间那段时间差要不要打折"。**修复**：`RollDialog.tsx`构造"展期后"草稿腿时，图表专用的`dte`**钉死在这条腿展期前的原始`dte`**（`leg.dte`，不用`newDte`），只让`strike`/`premium`反映真实变化——这样"展期前"和"展期后"两条曲线的腿位`dte`集合完全相同，`pnlAtExpiry`两边走的都是普通单一到期日分支，纯粹比较"新旧行权价+新旧净成本"对到期盈亏形状的影响，不会被"多到期日"分支污染。**注意**：这个`dte`钉死只影响这张迷你对比图内部临时构造的草稿腿，`handleConfirm`提交的真实新腿位（写回`legs`/`trackedLegs`的那条）用的还是真实`newDte`，不受影响。

图表下方还各显示一行展期前/展期后各自的最大亏损数字，方便一眼比较风险有没有变大。`roll.compare*`几个i18n key（`roll.compareTitle`/`roll.compareBefore`/`roll.compareAfter`/`roll.compareMaxLoss`/`roll.compareSameShapeNote`）在`zh.ts`/`en.ts`原有`roll.*`键值旁边。

### 1.6 术语悬浮提示（`Term.tsx`）

通用组件：`<Term titleKey="glossary.xxx" descKey="glossary.xxxDesc">文字</Term>`——点击文字（虚线下划线提示可点），弹出一个小popover显示术语标题+一行解释，再点一次或点外部关闭。复用了`PositionHealthBadge.tsx`已有的portal定位机制（`createPortal`到`document.body`逃出滚动容器裁剪、`useLayoutEffect`按触发按钮的`getBoundingClientRect()`算popover位置、`mousedown`监听器实现点击外部关闭），提炼成一个不跟健康度耦合的通用版本，供任何地方的术语标签使用。用点击而不是CSS `:hover`，触屏设备上行为跟桌面端一致。

**当前接入范围（2026-09-07下半收窄）**：`EarningsIvCrashTab.tsx`财报预览网格里的"所需保证金"标签（`glossary.marginUsed`/`marginUsedDesc`）——**目前是唯一还在用的地方**。原本还接入了`App.tsx`标题栏的净Delta/Theta/Vega/Gamma四个标签，随着那个Greeks展示面板整体移除（见"四、1.4"），这四处连同专用的`glossary.delta`系`i18n` key一起删掉了。**刻意跳过**：`MarginErrorDialog.tsx`里的"所需保证金"——那里已经有一段完整的`margin.explainerNote`说明文字，再加术语提示是重复；POP（到期盈利概率）——这个数字目前是内嵌在`PayoffChart.tsx`的SVG标注里渲染的，不是普通文本标签，接入`Term`需要额外改造SVG渲染路径，留作后续（backlog，见"六"）。以后再挑其它术语接入时，按这个"标签是普通文本、且没有更详细说明文字已经覆盖同样内容、且确实值得为它专门维护一个术语条目"的标准判断值不值得加——`Term.tsx`组件本身继续保留（`EarningsIvCrashTab.tsx`还在用，不是死代码），只是不会再往上堆更多接入点，除非有具体新场景。

### 1.7 决策对比（`DecisionCompareDialog.tsx` + `decisionCompare.ts`）

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

**入口位置几经搬家**：最早在`LegPanelTitleRow.tsx`（腿位区标题行）；一度搬到`AppHeader.tsx`（顶部header，预设策略选择器和代码输入框之间）；2026-09-06又从`AppHeader.tsx`搬回`App.tsx`的`legToolbar`里（跟"+ / 清空 / 策略库"这几个按钮放一排，顺序是切换按钮 → + → 清空 → 策略库），成为最左边第一个按钮；**2026-09-07第三轮又搬了一次，这次搬出了`legToolbar`**——`App.tsx`把这个按钮/下拉菜单单独拆成一个`modeSwitchButton`（`ReactNode`），传给`PayoffChart.tsx`，渲染在图表标题栏的股票代码旁边，跟健康度徽章挨在一起（见"三、文件地图"`PayoffChart.tsx`条目）。`legToolbar`本身还在，只是不再包含切换按钮，剩下"+ / 清空 / 策略库 / 加入模拟仓"，渲染位置没变（分析模式下在开仓价/开仓日期那一行；对比模式下在`LegListSection.tsx`"开仓组合"header行里）。`LegPanelTitleRow.tsx`现在只剩策略徽章和腿数，"对比模式"文字徽章也已按xue的要求去掉。

具体入口：

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

**局限**（跟模拟账户那边的回填共享同样的局限）：这是理论BS重定价，不是真实历史期权成交价（Yahoo不提供）；`historical-prices`只保留2个月窗口，更早的日子回填不了；网络请求失败时（比如本地开发环境没配Supabase）静默跳过、不影响进入对比模式这件事本身。**这也是数据量持续增长的主要来源**——每个被跟踪的策略每个交易日都会攒一条快照且从不清理，见"四、4.4"的容量隐患说明。

### 3.4 "开仓组合"恢复按钮的语义

见"四、1.2"——对比模式上方"开仓组合"的恢复按钮，恢复的是历史开仓数据而不是今天市场价，跟其他地方的恢复按钮语义不同。

### 3.5 对比模式下开仓时间锁定

"开仓价"+"开仓日期"输入框整个包在`{!isCompareMode && (...)}`里，对比模式下不渲染，本来就是锁定的。**容易搞混的点**：对比模式"开仓组合"header里那个日期选择器，改的是**当前选中快照的保存时间**（`activeSnap.savedAt`），不是`openingAt`，是两个不同的字段——命名/tooltip目前没有特别强调这个区别。

### 3.6 开仓组合↔今日组合的腿位对应关系（`openLegId`字段，2026-09-06新增）

**背景**：`trackedLegs`（今日组合）从`legs`（开仓组合）派生出来的每一处（`handleTrack`/`handleSelectSnapshot`/`handleSwitchToCompare`/`handleUpdateSnapshotTime`），每条腿都会拿到一个全新的`uid()`——`trackedLegs`的id空间跟`legs`完全不重叠，没有任何持久化的"这条今日组合的腿对应哪条开仓组合的腿"映射。历史上好几处代码（`pricing.ts`的`impliedSpotFromPremiums`、`App.tsx`的`trackedResult`、`PayoffChart.tsx`的`calcTrackedPnL`/`calcTrackedPnLAtTime`）隐式假设`trackedLegs[i]`对应`legs[i]`（纯按数组位置配对）——`moveTrackedLeg`重新排序今日组合、或者今日组合单独展期/对冲/保护加了一条开仓组合没有的新腿之后，这个假设就不成立了，会导致把某条腿的当前权利金拿去跟另一条不相关的腿的开仓权利金比较，算出错误的隐含现价/盈亏/成本基准，且没有任何报错。

**修复**：给`Leg`类型（`types.ts`）加了一个可选字段`openLegId?: string`——只在`trackedLegs`的腿上有意义，记录这条腿是从开仓组合哪条腿（当时的`id`）派生出来的。每处生成`trackedLegs`的地方（`handleTrack`/`handleSwitchToCompare`的"没有快照，直接拷贝`legs`"分支）在覆盖`id`之前先把原始`l.id`记进`openLegId`；从快照/已有`trackedLegs`派生的分支（`handleSelectSnapshot`/`handleUpdateSnapshotTime`）本来就是`{...l, id: uid()}`式的spread，`openLegId`跟着原样带过去，不用额外处理；`performSwitchToAnalysis`把`trackedLegs`/某条快照提升成新的开仓组合时，反过来要**去掉**`openLegId`（不然会带着一个已经不指向任何东西的过期引用）——`legFactory.ts`新增的`asOpeningLeg(leg, newId)`helper专门做这件事。

三处positional pairing的调用点全部改成通过新的`pricing.ts`导出函数`resolveOpeningLeg(trackedLeg, index, openingLegs, openingById)`按id查找，这个函数本身还做了向后兼容：优先用`openLegId`查，查不到就退回看`trackedLeg.id`本身是否恰好等于某条开仓腿的id（`historicalBackfill.ts`的`repriceLegsAtDate`回填快照时就是这么做的——它是直接在原始开仓腿上原地改`premium`/`dte`，不换id，所以回填快照的腿永远没有`openLegId`但id本身就能查到），最后才退回纯按数组位置——覆盖了这次修复之前就已经存在的、不可能补上`openLegId`字段的历史数据。

**同一轮顺带修的`useLegEditing.ts`路由bug**：展期/保护/对冲三个操作（`handleRoll`/`handleProtect`/`handleHedge`）原来无论从哪里触发都无条件读写`legs`——`TrackedComboSection.tsx`（"今日组合"）里的行也在调用同一套handler，点了展期实际改的是开仓组合，今日组合那一行的操作看起来完全没反应。现在这三个handler多接受一个`source: "legs" | "tracked"`参数（默认`"legs"`，开仓组合那边的调用点不用改），`App.tsx`传给`TrackedComboSection`的`onRoll`/`onHedge`/`onProtect`显式包一层传`"tracked"`；`LegActionDialogs.tsx`相应新增`rollTargetSource`/`protectTargetSource`/`hedgeTargetSource`三个prop，用来决定`RollDialog`/`ProtectDialog`/`HedgeDialog`该用开仓组合还是今日组合自己的`spot`/`legs`定价。从今日组合展期/对冲/保护新加的那条腿没有开仓组合对应物，`openLegId`留空——这是刻意的，不是遗漏，`resolveOpeningLeg`会正确处理成"这条腿单独存在，没有配对"。

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

**铁鹰折抵的"两条价差"检查曾经不看方向（2026-09-06修）**：折抵逻辑原来只要`notes.filter(kind==="spread")`凑够2条就按"两翼不会同时被行权"打折（取较大值而非相加），但2条价差可能是**同一侧**的（比如两个不同行权价的Bull Call Spread、或者一个Call阶梯），这种情况彼此没有对冲关系，两侧都可能各自被行权，打折会让保证金算少了。`MarginNote`新增`type?: OptionType`字段（只在`kind==="spread"`时有值），折抵逻辑现在要求"恰好一条Call价差+恰好一条Put价差"才触发，同侧的多条价差直接相加，不再打折。

**卖空正股（naked short stock）曾经不占用任何保证金（2026-09-06修）**：`computeComboMargin`里`stockLegs`原来只在"备兑Call是否有正股覆盖"这一处被读取，一条`action==="sell"`的正股腿本身从来没有生成过自己的保证金note——裸卖正股被当成"已经全额付清"处理，跟这个模块"教真实资金占用"的初衷矛盾。现在按Reg-T卖空保证金标准惯例（现价×股数×150%，即100%卖空所得+50%额外保证金）给每条卖空正股腿单独算一条`kind: "short-stock"`的note。

### 4.3 趋势面板 / 悔棋模式（Regret Mode）

`TimelinePanel`（`SimulatorPage.tsx`内部）显示仓位从开仓到现在的历史快照走势和"最佳平仓点 vs 当前"对比，用`TimelineChart`（手写SVG折线，横轴按日历天数比例定位、不是index均分）展示，历史最佳日用琥珀色高亮标出。

**自动回填缺口**：历史快照原本只在手动点"刷新全部持仓"时记录，没刷新过的日子没有数据点。`backfillSnapshots`（打开"趋势"面板时触发，2026-09-06起内部逻辑委托给共享的`historicalBackfill.ts`，见"四、3.3"）对开仓日到今天（或平仓日）之间没有真实快照的每个交易日估算并补一条`PositionSnapshot`，打上`estimated: true`标记，UI用虚线边框+"(估)"标签区分。**限制**：理论重定价、非真实历史成交价；`historical-prices`只保留2个月窗口；今天和平仓当天本身不回填。

**结构信号 + "对比"按钮（真实曲线）**：`classifySpotOnCurve`（`pricing.ts`）判断某个现价在payoff曲线上是"接近峰值/盈利区间/已越过盈亏平衡点"，`analyzeBestExit`（`simAccount.ts`）结合历史最佳快照日和结构位置给出一句话结论+一句解释。`ComparePanel`直接复用`PayoffChart`组件，画出"开仓组合固定曲线 + 当前/平仓组合在曲线上的位置"，持仓和已平仓仓位都有"对比"按钮。

**悔棋模式（"如果没平仓"按钮，Regret Mode A）**：跟"复盘"（B）是一对镜像功能（B是持仓中回看历史某天平仓的结果，A是已平仓后回看假如没平仓到现在的结果），本质都是"最佳平仓点在哪"。**目前只统一改造了B这一侧**，A还没有接入同样的结构信号/统一改造，见"六、已知问题"。

**"某个条件不满足就整个隐藏UI"的设计原则**：用户明确要求——功能框架要永远展示出来，哪怕当前数据/条件不满足导致功能暂时没意义，只需要在界面上解释清楚原因即可，不能因为前置条件没满足就把整个功能/按钮/文字隐藏掉。已应用在`TimelinePanel`最佳点位对比文字、`EarningsPositionsPanel`中远期组的腿位表格和平仓按钮。**后续开发遇到类似写法，默认改成"展示框架+解释原因"，除非有明确理由不这么做。**

### 4.4 数据备份/同步（2026-09-07下半：序列化逻辑去重 + 容量隐患评估）

`dataTransfer.ts`：导出/导入整个应用数据为JSON（策略库+自定义预设+最近标的+模拟账户，version 2起包含模拟账户）。`autoSync.ts`+`useAutoSync.ts`：File System Access API自动同步到用户指定的本地文件（Chromium系浏览器支持，句柄存IndexedDB）。

**序列化逻辑去重**：`exportAllData`（手动导出）和`autoSyncWrite`（自动同步写文件）原来各自手写一份"从localStorage六个key读出、JSON.parse、拼成同一个对象形状"的代码，逐字节一样——`dataTransfer.ts`新增`collectBackupPayload()`把这段逻辑收敛成一个函数，两处都改成调用它。纯重构、不改变任何行为，动机是避免未来加新字段（比如版本3）时只改了一处，导致"手动导出的备份"和"自动同步的备份文件"两种备份悄悄产生不同的数据形状而没人发现。

**容量隐患（评估，暂未改动底层存储）**：当前整个应用的持久化数据——策略库（含每条策略不断累积、从不清理的`trackedSnapshots`）、模拟账户的仓位和历史快照——全部塞在浏览器`localStorage`的六个key下，每个key存一整段JSON字符串。这个模型有三个会随使用时间和数据量放大的隐患：
1. **`localStorage`本身有容量上限**（多数浏览器按origin限制在5～10MB左右），一旦总数据量逼近这个上限，`localStorage.setItem`会抛`QuotaExceededError`——不只是备份会失败，`savedStrategies.ts`/`simAccount.ts`里任何一次新增快照/新增仓位的写入都会失败，是会影响核心功能的真故障，不只是备份边角料的问题。
2. **每次写入都是整段JSON重新序列化+整体覆盖**——不是增量写入。数据越大，每加一条快照/一个仓位的开销就越大（一次`JSON.stringify`+一次`setItem`，同步阻塞主线程），`autoSyncWrite`每次触发也是整个文件重写一遍。
3. **没有任何清理/归档机制**——`backfillTrackedSnapshots`/`backfillSnapshots`两个自动回填功能会持续、无上限地为每个被跟踪的策略/仓位按交易日新增快照，用得越久、跟踪的策略越多，这两张表长得越快，会主动加速触达上面两个问题，不是要等到"数据量意外变大"才会发生。

**如果数据量真的变大，建议的解决路径**（按投入递增排列，评估阶段，未实施）：
- **立即可做、低风险**：`autoSyncWrite`目前对写入失败是整体`catch`后静默跳过——如果失败原因是上游`localStorage.setItem`已经先炸了（数据读不出来）而不是文件本身的问题，用户会长期以为自动同步在正常工作，实际上早就没在写新内容。值得把这类失败从"静默"改成至少在UI上露出一次性的警示（不需要每次都打扰用户）。
- **中等投入、能从根上解决**：把`SavedStrategy`/`TrackedSnapshot`/`SimPosition`/`PositionSnapshot`这几张持续增长的表，从"一个localStorage key存一整个JSON数组"迁移到`IndexedDB`（项目里`autoSync.ts`已经在用IndexedDB存文件句柄，不是引入新技术栈）——IndexedDB支持按记录级别增删改（加一条快照只写一条记录，不用整表重新序列化），单个origin的容量上限也比localStorage高得多（通常以几百MB到GB计，随浏览器/磁盘余量浮动）。`recentSymbols`这种小体量、低频的数据可以继续留在localStorage，不需要一起搬。
- **长期、视需求决定要不要做**：如果以后有换设备/多端同步的真实需求，再考虑把这些数据落到Supabase Postgres（项目里已经有`create_user_data_tables.sql`这张迁移，值得先确认现状是否已经覆盖部分场景）——这一步需要引入用户账号体系和同步/冲突处理，投入明显更大，**不建议在没有真实多端同步需求之前提前做**。

### 4.5 仓位管理提醒 / 交易统计面板（2026-09-07新增；这一节此前在文档里被引用了三次但从没写过，2026-09-07第三轮补上这个缺口）

**仓位管理提醒**（`computePositionAlerts`，`SimulatorPage.tsx`）：对每个持仓仓位按两个维度判断是否值得关注——**DTE ≤ 21天**（`DTE_ALERT_THRESHOLD`）、**任意卖出期权腿的|Delta| > 0.30**（`DELTA_ALERT_THRESHOLD`，用当前mark数据现算的实际Delta，不是开仓当天冻结的Delta）。两个阈值是tastytrade式"21 DTE / 30 delta管理"的行业惯例默认值，**不是根据xue自己的交易规则推导的**，目前是硬编码常量，以后如果要个性化，应该做成可调设置而不是改代码里的数字。没有mark数据（还没刷新过、或刷新失败）时不报警——跟旁边"未实现盈亏"数字的"算不出来就不显示"是同一个惯例。命中阈值时在仓位行内联渲染一个琥珀色徽章（`AlertTriangle`图标+说明文案），纯提示性质，不会自动做任何操作（比如自动平仓/展期）。

**交易统计面板**（`SimStatsPanel.tsx` + `simStats.ts`的`computeSimStats`）：从已平仓仓位（`status === "closed"`且有`realizedPnl`/`closedAt`）算胜率、盈亏比（`profitFactor = Σ盈利 ÷ Σ|亏损|`，全赢无亏时是`Infinity`，还没有已平仓交易时是`null`）、最大回撤（对**累计已实现盈亏序列**取peak-to-trough，不是逐日mark-to-market权益曲线——账户级别的逐日汇总现有数据模型做不到，`PositionSnapshot`是per-position的，不是账户级汇总）、最大连胜/连亏场次。

**v1范围刻意不含保证金调整后的收益率指标**（比如年化收益率/资金效率）——`simStats.ts`源码里自己的注释说明了原因：`SimPosition`目前不持久化"开仓那一刻占用了多少保证金"这个字段（`margin.ts`的`computeMarginUsed`只对**当前**持仓仓位实时算，一个仓位平仓之后这个历史值就没地方找了，没法事后补算），要做资金效率类指标必须先加这个存储字段。**这跟"六、backlog"第13条"年化收益率"是同一个未完成拼图的两块，不是两件独立的事**：`simStats.ts`回答的是"这批已平仓交易赢面质量好不好"（胜率/盈亏比/回撤/连胜连亏），第13条想回答的是"资金效率高不高"（净收权利金÷保证金占用），两者都卡在同一个缺失的margin-at-open字段上，应该一起做，不建议先在`simStats.ts`里单独补一个窄口径的版本。

**面板渲染惯例**：`SimStatsPanel`始终渲染（不是等有已平仓仓位才出现），没有数据时用"-"占位+`sim.statsEmptyHint`说明文字——跟"四、4.3"提到的"展示框架+解释原因"是同一条设计原则（见"五、8"）的又一处应用。

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

从模拟账户"从场景开始"入口进入，三个标签页：**方向判断**（主体，`scenarioEngine.ts`固定查表`SCENARIO_RULES`覆盖30种桶组合，三标签结构：方向/财报/待定，财报标签内部又分IV Crash vs 方向判断、IV Crash内部再分90%/80%/70%三档阈值层级；`BUY_DTE_EXTENSION`纯买方结构的DTE延展逻辑；`isScenarioBlocked`屏蔽组合检测）、**财报**（`EarningsTabRoot`，见"四、5"）、**待定**（占位，**xue确认暂时保留这个空标签，等真正做出方向判断以外的第三类内容再回头看要不要先隐藏**，2026-09-07）。选中候选后"使用这个"跳转到`simOrigin`（`Shell.tsx`的`simOriginInitial`机制）确认开仓。

IV/HV比值判断（`historicalVolatility.ts`的`computeIvHvNote`）目前只在这个页面用——比值低不代表权利金便宜，如果绝对IV仍然很高，三分类`sellRich`/`buyCheap`/`stillRich`。**分析模式手动搭建组合时看不到这个指标**，见"六、已知问题"。

## 7. AI策略推荐（`AIStrategyPage.tsx`）——开发预览阶段

对应项目说明里"策略方向"部分：以卖方为主（80%）——Sell Put、Bull Put Spread、Iron Condor；买方为辅（20%）——Leap Call，Delta 0.7-0.8，6-12个月；四个模型对比——Claude、GPT-4o、Grok、Gemini。

**当前状态是TEMPORARY dev-preview版本**：真正的设计是每天由一个Supabase Cron job预先跑一次四模型分析、存进数据库，用户打开页面只是读当天已经算好的缓存结果，避免"成本随用户数线性增长"（每个用户打开都现触发一次四个大模型API调用是不可接受的）。**这个每日Cron + DB表的基础设施还没有搭**，现在页面上的按钮是"点击触发一次分析"这种临时占位行为，不是最终形态。`supabase/functions/strategy-analysis/index.ts`是对应的后端函数雏形。这是当前项目的核心未完成模块（对照项目说明"AI分析部分，后续集成"）。

## 8. `App.tsx`内部结构（拆分现状）

`App.tsx`目前约1701行（历史上到过1623行，之后做过两轮结构性瘦身降到1378/1418行左右，2026-09-05/06又因为预设风险揭示联动、对比模式健康度/Greeks重构、切换控件从AppHeader搬回`legToolbar`、开仓↔今日组合腿位对应关系修复（`openLegId`/`resolveOpeningLeg`/`useLegEditing.ts`的roll/protect/hedge目标路由）等新功能/调整陆续长回1699行；2026-09-07下半移除Greeks展示面板又省回一些行数，但同一时间加了引导弹窗持久化的判断逻辑，两边大致抵消；2026-09-07第三轮把`legToolbar`拆成`modeSwitchButton`+精简版`legToolbar`两个变量、又新增了几行注释，行数基本没变——这是正常的功能增减，不代表瘦身失败，拆分成果本身没有被撤销）。已经拆出去、留在`App.tsx`里只剩一行调用/一次hook调用的部分：
- 见"三、文件地图"里列的`AppHeader`/`LegListSection`/`LegPanelTitleRow`/`TrackedComboSection`/`LegActionDialogs`/`StrategyPersistenceDialogs`六个组件
- `legFactory.ts`/`dateUtils.ts`（`daysSince`）/`savedStrategies.ts`（`serializeStrategyState`）几个纯helper函数
- `useLegEditing.ts`——`updateLeg`/`toggleLeg`/`deleteLeg`、批量选择四件套（`toggleLegSelection`/`clearLegSelection`/`selectAllLegs`/`selectedCount`/`allSelectedDisabled`/`bulkToggleDisable`/`requestBulkDelete`/`confirmBulkDelete`）、`handleRoll`/`handleRollConfirm`/`handleProtect`/`handleProtectConfirm`/`handleCompare`/`handleHedge`/`handleHedgeConfirm`、`moveLeg`/`moveTrackedLeg`，一共约130行。`App.tsx`里改成一次`useLegEditing({legs, setLegs, setTrackedLegs})`调用后解构使用，JSX里的prop名字全部没变

**2026-09-06新增的计算/展示逻辑**（见"四、1.4"）：`trackedGreeks`（新`useMemo`，**保留**）、重写的`positionHealth`（按模式分支，**保留**）；`displayGreeks`/`fmtGreek`（纯展示用派生变量，**2026-09-07下半已删除**）。这批memo插在`activeLegs`→`activeTrackedLegs`/`isCompareMode`→`result`→`scenarioPriceById`→`impliedSpot`/`effectiveTrackedSpot`→`trackedGreeks`→`positionHealth`→`pop`/`breakevens`→`analysisAttribution`→`attributionMaxAbs`→`effectiveDaysElapsed`这条链路里（`displayGreeks`/`fmtGreek`原来夹在`positionHealth`和`pop`之间，删除后链路少了这一环，其余顺序不变），**声明顺序是精心排过的**（TDZ风险，见"五、核心设计原则"），以后要在这批memo中间插入新的，先看清楚自己依赖谁、被谁依赖，不要图省事插在文件末尾。

**`legToolbar`拆分（2026-09-07第三轮）**：原来定义`legToolbar`那段JSX，第一段（切换按钮/下拉菜单）被抽成独立的`modeSwitchButton`变量，定义顺序在`legToolbar`之前；`legToolbar`本身只剩"+ / 清空 / 策略库 / 加入模拟仓"四项，渲染位置不变。`positionHealth`这个`useMemo`本身没变，只是它的值现在额外传给了`<PayoffChart>`（新增`positionHealth`/`modeSwitchButton`两个prop），不再传给`<LegListSection>`/`<TrackedComboSection>`——这两个组件对应的prop已经删掉，见"三、文件地图"里两者的条目。同一轮里`<LegListSection>`调用还少传了四个prop（`effectiveTrackedSpot`/`liveSpot`/`activeTrackedLegs`/`effectiveDaysElapsed`），因为那个组件里唯一用到它们的统计网格被删了（详见"三、文件地图"），但这四个值本身在`App.tsx`里其它地方（尤其是`<TrackedComboSection>`）还在用，不要误删。

**故意没有拆的部分**（如果还要继续瘦身，这是候选，但风险更高，不建议随便动）：
- 一串策略管理相关的`useCallback`（`handleSaveStrategy`/`handleOverwriteStrategy`/`handleTrack`/`handleSaveTracked`/`handleSelectSnapshot`/`handleDeleteSnapshot`/`handleUpdateSnapshotTime`/`handleOpenStrategy`/`handleSwitchToCompare`/`performSwitchToAnalysis`/`handleSwitchToAnalysis`，加起来超过300行）——互相调用、共享十几个state/ref，还反向依赖`applyPreset`这种在它们之后才定义的函数，硬拆容易在依赖数组或调用顺序上出错，这类bug`npm run typecheck`不一定能抓出来。这个集群历史上是全项目bug密度最高的地方（换标的不重算、`handleTrack`快照加载、保存快照多余的二次确认这几个真实bug根源都在这里），越是这样越不能在没有充分行为测试的情况下动它的结构
- 一串纯计算的`useMemo`（`result`/`scenarioPriceById`/`positionHealth`/`pop`/`breakevens`/`activeTrackedLegs`/`isCompareMode`/`analysisAttribution`/`attributionMaxAbs`/`impliedSpot`/`effectiveTrackedSpot`/`effectiveDaysElapsed`/`trackedResult`/`trackedGreeks`/`trackedLegPnlById`/`trackedLegRolesById`/`trackedStrategy`/`trackedVolShift`/`pnlAttribution`，约180行）——互相之间有链式依赖（比如`trackedResult`依赖`effectiveTrackedSpot`依赖`impliedSpot`），抽成hook需要把整条依赖链一起搬

这两块理论上都可以像`useAutoSync`/`useCustomPresets`/`useSavedStrategies`/`useLegEditing`那样抽成自定义hook，但工作量和风险都明显更高，需要单独开一轮专门做，而且不能只靠typecheck验证，需要实际操作路径测试（Playwright跑遍真实交互路径确认没问题）。

## 9. 模块使用说明书 + 首页数据管理

**背景**：之前首页有一份"整体说明书"（`HomePage.tsx`里的`HELP_SECTIONS`，混合了分析模式建仓、情景滑块、策略库、对比模式追踪、图表、数据导入导出六段内容），分析/对比模式header的「使用说明」按钮点开也是同一份通用文档，不区分当前在哪个模块。Xue反馈这份文档定位不清楚——首页整体说明书已删除，改成三个模块各自独立、简短的说明书。

**`HelpPanel.tsx`重构**：从`Props: { onClose }`（硬编码通用内容）改成`Props: { moduleId: "analysis" | "compare" | "simulator"; onClose; variant?: "info" | "gate" }`。`MODULE_SECTIONS`常量按`moduleId`映射到各自的`{titleKey, sections[]}`i18n键（`help.moduleAnalysisTitle`/`help.moduleCompareTitle`/`help.moduleSimulatorTitle`及各自四段小节，`zh.ts`/`en.ts`里新增，见文件开头警示章节的key对等性检查）：
- `variant="info"`（默认）：普通可关闭弹窗，背景点击/右上角X都能关，供header「使用说明」按钮使用
- `variant="gate"`：首次进入模块的强制引导，没有X、点背景不关，出口除了底部「明白了，继续」按钮，**2026-09-07下半新增了一个「不再显示」复选框**（见下）

**三个模块各自的触发时机**：
- 分析模式（`App.tsx`）：`showAnalysisGuide`状态，初始值`!autoOpenManage && !simOrigin && !isGuideDismissed("analysis")`（避免跟"从跟踪卡片进入自动弹管理策略"、`simOrigin`确认开仓流程的引导冲突；`isGuideDismissed`见下）——即普通新开一次分析模式会话时会先看到这个gate，除非之前勾选过"不再显示"
- 对比模式（`App.tsx`）：`showCompareGuide`状态 + `compareGuideShown`这个`useRef`守卫，在`isCompareMode`第一次从false变true时触发一次（`useEffect`监听`isCompareMode`，触发前先查`isGuideDismissed("compare")`），保证同一次挂载周期内只出现一次，也不会对已经永久关闭过的用户重复弹
- 模拟账户（`SimulatorPage.tsx`）：`showGuide`状态，初始值`!isGuideDismissed("simulator")`，组件挂载即触发一次（除非已被永久关闭）（这个模块之前完全没有说明书/帮助按钮，本轮新增了一个和分析/对比模式风格一致的「使用说明」按钮，放在标题栏，账户创建前也能点）

**持久化"不再显示"（2026-09-07下半新增）**：`HelpPanel.tsx`新增并导出`isGuideDismissed(moduleId)`——读`localStorage["optionpilot.guideDismissed.<moduleId>"]`是否为`"1"`；`gate`变体内部新增一个受控的`dontShowAgain`复选框状态，点击「明白了，继续」时如果勾选了就顺手写入这个key（`setGuideDismissed`，写失败也不影响正常关闭，纯尽力而为）。三处调用方（`App.tsx`两处、`SimulatorPage.tsx`一处）改成在**初始state里**就调用`isGuideDismissed`，而不是挂载后再用effect关掉——避免用户已经永久关闭过引导、但每次进入模块时引导还是先闪一帧再消失的观感问题。三个模块的开关key互相独立（`optionpilot.guideDismissed.analysis`/`.compare`/`.simulator`），只关一个模块不影响其它两个；`variant="info"`（header的「使用说明」按钮）完全不受这个开关影响，永远可以手动重新打开。

header的「使用说明」按钮（`App.tsx`里的`helpOpen`状态、`SimulatorPage.tsx`里新增的同名`helpOpen`状态）现在打开的是`variant="info"`的模块专属内容，`moduleId`按当前`isCompareMode`动态选择`"analysis"`或`"compare"`。

**首页「数据」下拉菜单**（`HomePage.tsx`，从`AppHeader.tsx`搬来，位置在语言切换按钮旁边）：导出/导入JSON、链接本地备份文件三个功能的UI和逻辑原样搬过来，`exportAllData`/`importAllData`（`dataTransfer.ts`）本身直接读写localStorage，不依赖调用方状态，所以`HomePage.tsx`不需要真的维护`savedStrategies`/`customPresets`/`recentSymbols`这些state；`useAutoSync({ savedStrategies: null, customPresets: null, recentSymbols: null })`只是为了拿到`autoSyncName`/`autoSyncSupported`等UI状态和link/unlink/syncNow三个action，导入成功后手动调用`lib/autoSync.ts`导出的`autoSyncWrite()`把最新数据立刻推给已链接的备份文件（而不是像`App.tsx`那样靠"deps变化"触发）。`App.tsx`里原来的`useAutoSync({ savedStrategies, customPresets, recentSymbols })`调用**保留**、返回值不再解构使用——这是故意的，为的是编辑分析/对比模式期间后台自动同步继续写入已链接文件，不用户退回首页才同步。两个独立的`useAutoSync()`实例能同时安全存在，是因为`lib/autoSync.ts`里的文件句柄是模块级单例（配合IndexedDB持久化），且`Shell.tsx`的view路由决定了`HomePage`和`App.tsx`不会同时挂载。

**顺带修的一个不一致**：`HomePage.tsx`的`MODULES`数组里`simulator`卡片一直标着`comingSoon: true`，但`SimulatorPage.tsx`本身早就是完整可用的模块——之前只是徽章文案没跟上，点击卡片本来就能正常跳转（`comingSoon`只影响是否显示"规划中"徽章，不影响`onSelectModule`点击行为）。本轮顺手改成`false`。`ai`卡片的`comingSoon: true`保留，因为"四、7"里说的AI每日Cron+缓存基础设施确实还没做。

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
15. **`pnlAtExpiry`的"多到期日"特殊处理只适用于真正设计成多到期日的组合（日历/对角价差）**——任何临时构造的、只是"恰好几条腿到期日不同"的草稿组合（比如展期对话框里正在编辑的草稿）如果不打算利用这个特殊处理，要主动把dte对齐，否则会意外触发Black-Scholes分支、算出不是"到期盈亏"的东西，见"四、1.5"的踩坑记录

---

# 六、当前已知问题 / backlog

产品功能层面的待办，按提及顺序列出（不代表优先级，跟具体某次改动引入的bug是两回事）。2026-09-06/07做过一轮竞品调研（tastytrade/thinkorswim/OptionStrat/Option Alpha等），完整建议清单见`FEATURE_PROPOSALS_2026-09.md`——下面第4/5/13/14条被那份调研独立佐证为高价值项，已标注。

1. **保证金持仓后不会动态跟涨跌**——只有开仓/预览那一刻算得对，需要把`computeMarginUsed`改成用实时股价而不是开仓时冻结的股价，牵涉多个调用点
2. **财报策略80%/70%阈值档**——UI占位已搭好，逻辑没做
3. **财报"方向判断"分支**——UI占位已搭好，内容没做
4. **IV Rank/Percentile真实数据**——卡在要不要接付费历史数据源，还没决定（调研佐证：见`FEATURE_PROPOSALS_2026-09.md`第一部分第2条，thinkorswim/tastytrade标配指标；如果暂不接付费源，可以先用Yahoo Finance能拿到的近期IV序列做简化版相对高低判断）
5. **期限结构（Term Structure）可视化**——同一标的不同到期日的IV放一张图上对比，主要用于日历价差选到期日，提过想法但没开始做（调研佐证：见`FEATURE_PROPOSALS_2026-09.md`第一部分第3条）
6. **模拟账户的历史快照不会"自动"积累，仍然只在手动点"刷新全部持仓"或打开趋势面板（回填）时记录**——讨论过"每次打开模拟账户页面自动记一次快照"这个方向，涉及组件内部函数声明顺序（TDZ风险），没做。**注意跟对比模式的`backfillTrackedSnapshots`（"四、3.3"，2026-09-06已上线）不是同一件事**——那个解决的是策略库/对比模式的快照密度问题，这一条是模拟账户自己的、仍未解决
7. **`handleAddToSimAccount`这个独立的"快速添加到模拟账户"入口，没有接上`openingAt`**——不确定这个入口具体从哪里触发，暂时继续用`Date.now()`
8. **决策对比没有"对冲"这第四个对比分支**——`HedgeDialog.tsx`已经成熟，理论上可以复用其默认方案逻辑做成四选一
9. **决策比较（compare2）弹窗的展期分支写死+30天**——不像正式`RollDialog`那样有+7/+14/+30快捷键和自定义日期，想比较"展期到下周 vs 下月"哪个划算目前做不到，得去正式展期弹窗手动试错
10. **`HedgeDialog`期权对冲路径没有真正解到目标Delta**——正股对冲精确算出份数打到Delta=0，期权对冲只是"选个行权价、估个权利金"，没有反过来根据残余Delta解应该买卖几张/哪个行权价能刚好对冲掉，达不到真正delta-neutral
11. **全局是每条腿一个扁平IV，没有波动率微笑/skew/期限结构**——情景滑块的波动率偏移统一加减同一个百分点，不同行权价/到期日的IV现实中不会同步涨跌，尤其财报IV Crash策略里各行权价IV回落速度本身不一致。这是几乎所有轻量级期权模拟工具的通用简化，工程量大（需要真实多点IV数据），优先级放低
12. **`PayoffChart.tsx`里有4份几乎重复的情景计算逻辑，3份IV反推实现**——`calcPnL`/`calcPnLAtTime`/`calcTrackedPnL`/`calcTrackedPnLAtTime`四个函数各自独立实现同一套"反推IV+重新定价"逻辑，`impliedVol`本身在`pricing.ts`和`PayoffChart.tsx`里各有一份几乎一样的实现——**这条本身还没解决，仍是待办**。2026-09-06只解决了同类问题里范围更小的一个子集：`pricing.ts`内部`legShiftedPrice`/`legGreekBreakdown`两个函数各自独立反推同一条腿的IV，改成了`priceCombo`统一算一次、通过新增的可选参数`ivOverride`传给两边（`positionHealth.ts`等其它外部直接调用`legShiftedPrice`/`legGreekBreakdown`的调用点不受影响，`ivOverride`省略时行为不变）——这只是`pricing.ts`一个文件内部的收敛，`PayoffChart.tsx`那4份独立实现、以及`pricing.ts`↔`PayoffChart.tsx`之间的重复，都还是原样。2026-09-06复盘时曾怀疑`positionHealth`的Delta因子读取处也有类似重复问题，核实后确认那里没有重复代码（只是一条过时注释）
13. **年化收益率（Return on Margin）没有算**——`margin.ts`已经算出保证金占用，但系统里没有"净收权利金÷保证金占用，按天数年化"这个数字。专业期权卖方选仓位比较的通常是资金效率而非绝对收益，对"以卖方为主"的策略philosophy来说是目前明显缺失的核心指标，价值较高（调研佐证：见`FEATURE_PROPOSALS_2026-09.md`第一部分第1条，tastytrade/Option Alpha回测报告里的核心指标，目前看是全部backlog里性价比最高的单项）。**对当前持仓仓位**，`computeMarginUsed`能实时算，加这个字段工作量不大；但**要覆盖已平仓仓位**（"这笔已经平掉的交易资金效率到底怎么样"，通常更有参考价值），`SimPosition`需要先新增一个"开仓当时的保证金占用"持久化字段——这也是`simStats.ts`（"四、4.5"）v1没做资金效率类指标的同一个卡点，两边应该一起做，不要分别在各自模块里补一个窄口径版本
14. **IV/HV比值目前只在场景选择器里用**——`scenarioEngine.ts`那套`sellRich`/`buyCheap`/`stillRich`三分类逻辑只在"从场景开始"引导流程里用，手动在分析模式搭建自定义组合时看不到，建议在分析模式股票输入区域旁边也露出（调研佐证：见`FEATURE_PROPOSALS_2026-09.md`第一部分第2条）
15. **悔棋模式（Regret Mode A，"如果没平仓"按钮）**——用户反馈"问题比较大"，具体怎么改还没讨论清楚，下次动手前要先问清楚设计诉求。B（"复盘"）已经统一改造过，A还没有
16. **AI策略推荐（`AIStrategyPage.tsx`）的每日Cron+缓存基础设施还没搭**——见"四、7"，是当前最大的未完成模块
17. **`App.tsx`还有约400-480行策略管理handler+计算useMemo没有拆分**——见"四、8"，风险较高，需要单独一轮细致处理
18. **claude.ai项目的GitHub同步白名单持续滞后于main分支实际文件**——`zh.ts`/`en.ts`是最新踩过的例子（见文档开头独立警示章节），如果发现新加的文件没被project索引到，遇到关键判断优先直接读GitHub raw内容核实，不要只信`project_search`
19. **展期会留下永久的"幽灵腿"，占用10腿上限的名额**——`RollDialog`确认展期后旧腿位标记`disabled:true`永久留在数组里，`addLeg`的10腿上限按数组总长度判断、不是有效腿数，一个仓位展期两三次可能在无意识中顶到上限。建议给disabled的腿单独归档不占用上限，或至少提示"还剩几个可用腿位额度"
20. **竞品调研（2026-09-06/07，`FEATURE_PROPOSALS_2026-09.md`）里发现、目前backlog没提过的剩余建议**——还没做的：**模拟账户组合级保证金/Greeks汇总**（每个持仓仓位现在只能逐条看，没有一个"我现在总共占用多少保证金、组合净Delta/Theta是多少"的汇总视图——注意这跟"四、1.4"里刚移除的分析/对比模式单组合Greeks面板不是同一件事，这一条说的是模拟账户里*跨多个仓位*的汇总，目前完全没有）；仓位管理提醒未来可以跟AI四模型联动，给出具体的展期/平仓建议，不只是视觉标记。较长期/依赖付费数据源的：历史期权链回放（thinkBack式，区别于现有的"回填已开仓位估算价格"）。
    - **20-b. 场景选择器"待定"标签页**——目前是空占位，2026-09-07 xue确认暂时保留（不隐藏），等真正想清楚方向判断/财报之外还要放什么内容再处理，不算独立待办，只是记录一下这个决定别被误认为遗漏
21. **localStorage容量隐患**（2026-09-07下半评估，见"四、4.4"）——策略库的`trackedSnapshots`和模拟账户的`PositionSnapshot`都会随使用时间无上限增长，全部挤在localStorage几个key下，存在容量上限（`QuotaExceededError`会连累核心写入功能，不只是备份）、每次整表重写的性能开销、以及`autoSyncWrite`失败时静默吞掉错误、用户可能长期不知道自动同步已经停摆这三个风险。建议路径（未实施，按投入递增）：给`autoSyncWrite`的失败加一次性用户可见提示 → 把这几张持续增长的表从localStorage迁移到IndexedDB（按记录写入，容量上限也高得多，`autoSync.ts`已经在用IndexedDB存别的东西，不是引入新依赖）→ 更长期如果有多端同步的真实需求，再考虑挪到Supabase Postgres（`create_user_data_tables.sql`这张迁移可能已经覆盖部分场景，需要先确认现状）

---

# 七、给接手的人（无论是人类开发者还是下一个AI会话）

1. **第一步永远是跟GitHub真实代码做一次全面比对**，确认这份文档反映的状态和实际代码库一致，再开始改动——**包括文档自己**，2026-09-07发现过文档落款日期落后于代码实际进度的真实案例，见文档开头
2. **动`zh.ts`/`en.ts`之前，务必读完文档开头的独立警示章节**——完整文件覆盖对这两个文件是有回归风险的真实教训，不是假设性提醒
3. "六、已知问题"是最直接能接手的任务列表，按当下兴趣或优先级挑一项——13（年化收益率）和12（PayoffChart重复实现）目前看是性价比较高的候选，21（localStorage容量隐患）如果用户反馈过卡顿/同步异常，优先级应该提前
4. 遇到"某个条件不满足就整个隐藏UI"的写法，默认改成"展示框架+解释原因"（"五、8"）
5. `App.tsx`新增`useMemo`/`useCallback`时注意TDZ风险，手动核对声明顺序；新增"组合级"展示指标时按`isCompareMode`分支选数据源（"五、12"）
6. 财报相关改动注意`note`和`linkedStrategyId`是两个独立字段
7. 涉及"到期盈亏"类计算（`pnlAtExpiry`/`payoffCurvePoints`/`maxProfitLoss`）时，注意"多到期日"特殊处理只该用在真正的日历/对角价差上，临时构造的草稿组合如果腿位dte碰巧不一致，要主动决定是否需要对齐，见"五、15"
8. 交付代码遵守"一、开发/交付流程约定"里的规范（完整文件、路径注释、typecheck验证）
9. 这份文档改完之后按开头"维护方式"的约定去改，不要退回按会话追加的旧模式