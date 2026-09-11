<!-- CLAUDE.md -->

# OptionPilot 交接文档（整合版）

**版本**：整合版，更新于 2026-09-11。本次更新新增"四、10 持仓处置建议"（position-management-kb检索功能：架构、两个真实bug的完整记录、当前暂停状态和原因，见该节）、"六、backlog"新增第22条（建议呈现格式重新设计，待xue决定）和第23条（移动端适配，评估阶段未开始）、"五、核心设计原则"新增第16/17条（这次两个bug各自留下的通用教训）。此前的更新合并了 2026-09-05（预设风险揭示+到期盈亏小图+9条预设内容修正）、2026-09-06上半（zh.ts/en.ts严重滞后事故的修复与教训）、2026-09-06下半（对比模式健康度/Greeks修正、追踪快照自动回填、一个由此引入又当场修复的布局bug）、2026-09-07上半（竞品调研`FEATURE_PROPOSALS_2026-09.md`第20条里的四项一次性实现：仓位管理提醒、模拟账户交易统计面板、术语悬浮提示、展期前后风险对比图；随后做了一轮完整性/一致性复核，新增开头的"项目现状一览"速览表）、2026-09-07下半（功能精简走查：模块引导弹窗加"不再显示"持久化选项、移除组合级Greeks数字展示面板（保留计算供健康度使用）、修复展期风险对比图在"仅改到期日"场景下曲线失真/看似无变化的bug、备份序列化逻辑去重、评估localStorage容量隐患）、2026-09-07第三轮（UI布局微调：健康度徽章+分析↔对比模式切换按钮从左侧腿位面板搬到`PayoffChart.tsx`标题栏、紧挨着股票代码，`LegListSection.tsx`和`TrackedComboSection.tsx`各自独立的一份"开仓组合"统计网格——股价/时间流逝/隐含波动率——是完全重复的展示，删掉了信息量更少的`LegListSection.tsx`那一份，只保留`TrackedComboSection.tsx`带持仓盈亏列的那份）几轮会话的成果。**这是当前最新、最权威的交接文档版本**，跟仓库其它文件一起push到GitHub main分支后，应视为项目当前状态的唯一事实来源（直到下一次更新）。**这份文档替代了之前"按会话追加"的版本**——旧版本是每轮会话在文末加一个新章节，越滚越长，找一个功能的现状要翻好几个章节、对着时间戳自己判断哪段是最新的。这份文档**按功能/模块组织，只描述"现在是什么样"，不按时间顺序记流水账**。

**维护方式（重要，后续会话都要遵守）**：
- 做完一个功能改动或修复了一个bug，**直接去改对应的章节内容**，让它反映当前状态，不要在文末追加"2026-xx-xx又做了什么"这种新章节。
- 如果改动创建了新文件/新模块，在"三、文件地图"和"四、功能模块详解"里对应位置加进去。
- 如果解决了"六、已知问题"里的一条，从列表里删掉（不是标记"已完成"留着不删）。
- 如果发现了新的已知问题/技术债，加进"六、已知问题"。
- 只有在某个改动本身特殊到值得单独留痕迹时（比如一次重大架构决策、一次踩坑教训——**语言文件那次事故就是这种情况，见下面独立的警示章节**），才写成"设计笔记"/"事故记录"性质的独立小节，正常的功能新增/bug修复不需要。
- 每次改完这份文档，**开头这个"版本"行的日期改成当天**，作为"文档更新到什么程度"的唯一时间戳，不需要维护一份变更日志。

**如果需要查历史会话的详细讨论过程**（比如某个设计决策当初为什么这么定、具体的调试过程），更细粒度的分主题讨论记录都保留在claude.ai的"options pilot"项目文档里（`claude/wiring-check-2026-09-03.md`、`claude/mode-switch-and-restore-2026-09-03.md`、`claude/sim-account-changes-2026-09-02.md`、`claude/preset-risk-disclosure-2026-09-05.md`、`claude/i18n-staleness-incident-2026-09-06.md`、`claude/analysis-compare-mode-review-2026-09-06.md`、`claude/retrieval-feature-design.md`（持仓处置建议功能的完整设计过程+两个bug的详细记录，见"四、10"）是几次专项讨论/事故的详细记录）。这份新文档不重复那些讨论过程，只给结论和现状。

**重要提醒（接手第一件事）**：这份文档、以及历次对话里所有的代码交付，都基于Claude自己维护的一份**本地沙盒副本**，不是直接读GitHub实时代码（除非某次会话特意说明是直接读的）。这份副本的准确性依赖于用户本地是否已经把每次交付的文件都正确落地、commit、push。**2026-09-07发现过一次真实的文档/代码不同步**：仓库main分支当时的`CLAUDE.md`落款日期是09-06，但同一次push里的代码其实已经包含了09-07当天新增的`Term.tsx`/`RollComparisonChart.tsx`/`SimStatsPanel.tsx`等文件——即"代码已经改了、文档没跟着改"，这份文档本身也会踩自己警告过的坑，接手时不要预设文档落款日期等于代码的真实进度。

---

## ⚠️ 语言文件（`src/i18n/locales/zh.ts` / `en.ts`）维护须知——极高优先级，读完这一节再碰这两个文件

**2026-09-06发生过一次严重事故**，完整记录见`claude/i18n-staleness-incident-2026-09-06.md`，这里只给结论和以后必须遵守的规则。

**发生了什么**：Claude沙箱那一轮会话用来交付`zh.ts`/`en.ts`的基线，跟GitHub真实main分支逐字节完全一致——但用户**本地**实际的开发进度早已远超这个基线，本地已经手工新增了约40个翻译key（对比模式切换、组合健康度、决策比较v2、盈亏归因、财报面板等好几个功能的翻译），这些新增**从未推送到GitHub、也从未发给过Claude**。Claude用"完整文件替换"的方式交付了两版`zh.ts`/`en.ts`（都是在滞后基线上改的），用户拿去替换本地真实文件时，把本地独有、还没同步的那一大批翻译**全部覆盖冲掉了**——界面上大批按钮/文字变回显示裸的翻译key字符串（比如`leg.switchToCompare`）。用户报告了两次才最终定位到根因（第一次报告后Claude的排查方向不对，以为是遗漏了某几个key，实际上是整份文件基线就是旧的）。

**以后但凡要动`zh.ts`/`en.ts`这两个文件，必须遵守**：
1. **不要无脑用"完整文件覆盖"交付这两个文件**，除非确认过沙盒本地版本就是用户本地最新版本。开始改之前，先问用户一句"你本地这两个文件是不是有我这边没见过的最新内容"——尤其是间隔了较长时间、或者用户提到"我这边好像还有别的改动"的时候。
2. **更稳妥的方式是改用最小化的Edit，只加自己这次需要新增/修改的那几行key，不整份覆盖**，除非用户明确要求整份替换、或者用户已经把他本地当前真实的完整文件内容贴给了Claude作为基准。
3. **交付前后都要跑一遍key集合一致性检查**：用正则从两份文件里提取所有顶层key（`^\s*"([a-zA-Z0-9_.]+)":`），转成Set后取双向差集，确认zh/en两边key完全对齐（0个单边缺失）——比人工比对快得多也准得多，是这类问题最可靠的自查手段，每次改完这两个文件后都应该顺手跑一次。**这个规则2026-09-10给"持仓处置建议"功能加16个`advice.*`key时又完整执行了一遍（改前687/687匹配，改后703/703匹配，0缺口），是这条规则生效后第一次真正有新功能落地验证的案例**。
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
| 持仓处置建议（KB检索，"四、10"） | ⏸️ **已暂停** | 对比模式+模拟账户各一个按钮，检索历史案例给持仓处置建议。后端（数据库表+Edge Function+1170条KB数据）已上线，上线后真实测试发现并修复了两个系统性bug（策略名中英文不匹配、止损/止盈信号对近一半策略失真），但前端两个入口按钮/弹窗目前**注释掉暂停中**，等建议呈现格式重新设计定案后再恢复，见"四、10" |

**语言文件`zh.ts`/`en.ts`出过一次事故**（详见下面独立警示章节）——这是这个项目维护中唯一一件"一步走错会直接让用户界面大面积裂开"的事，任何时候要动这两个文件，先把警示章节读完。

**开发/交付流程约定**（Claude在沙盒里工作，没有push权限，这套流程每轮会话都适用）：
- Claude在自己维护的本地沙盒里clone仓库、改代码、跑验证，不直接操作用户的GitHub；用户明确表示**不需要Claude推送**，会自己在本地应用交付的文件、验证、`git add/commit/push`
- 验证手段：`npm run typecheck`（`tsc --noEmit -p tsconfig.app.json`，权威的正确性检查）+ `npm run build`（vite构建，**不做类型检查**，只能抓语法/打包错误）+ `npx eslint .`（代码风格/潜在问题）
- 交付方式：完整文件通过对话交付，不是diff，减少复制粘贴出错；**每个文件第一行必须是路径注释**（代码文件`// path/to/file`，markdown文件`<!-- path -->`），这是用户明确的固定要求
- 用户拿到文件后自己本地替换、跑`npm run dev`验证、`git add/commit/push`
- **GitHub是真理来源**：本地沙盒副本可能跟真实仓库产生偏差（比如某次交付用户没应用、或者用户本地手动改过沙盒不知道的地方，`zh.ts`/`en.ts`就是踩过的真实例子），涉及关键判断时优先直接读GitHub实际内容核实，不要只信这份文档或者本地沙盒状态
- **GitHub同步范围滞后**：claude.ai这个project的GitHub同步源设置了文件过滤白名单，目前不是仓库全量同步——早期发现`optionChain.ts`/`option-chain` Edge Function不在名单里过，此后陆续发现`zh.ts`/`en.ts`等文件也有同样风险。project_search/project_read的结果可能是过期快照，**遇到"这个功能是不是已经做了"这类关键判断，优先用WebFetch/curl直接读GitHub raw内容核实**，而不是只信project工具
- **position-management-kb的源数据（14个jsonl文件，1170条记录）刻意存放在仓库外**（用户本地单独的目录，通过`KB_DATA_DIR`环境变量传给导入脚本，见"四、10"），不进这个git仓库，任何读取这份数据的代码都要走环境变量、不能硬编码仓库内相对路径——这是产品/隐私层面的刻意决定，不是遗漏

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
| `SimulatorPage.tsx` | ~1725 | 模拟账户页面，全项目第二大文件——仓位列表、开平仓、保证金展示、财报仓位面板、趋势/悔棋面板、（2026-09-10新增又暂停的）持仓处置建议入口，见"四、10" |
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
- `TrackedComboSection.tsx`（~245行）——对比模式"今日组合"整块：快照选择器（含"(估)"估算标记，见"四、3.3"）、保存按钮、开仓vs当前统计网格（股价/时间流逝/隐含波动率/持仓盈亏四列——这是全项目现在唯一一份这样的统计网格，`LegListSection.tsx`原来那份三列的重复版本已删除）、腿位列表。**健康度徽章已不在这个组件里**（2026-09-07第三轮搬去了`PayoffChart.tsx`标题栏，见下）。**2026-09-10曾加过一个"持仓处置建议"按钮+弹窗，现已注释暂停**（搜文件里的`PAUSED`注释可找到，未删除），见"四、10"
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
- `PositionAdviceDialog.tsx`（~139行，2026-09-10新增，**当前调用方已暂停**）——"持仓处置建议"弹窗，检索`position_management_kb`知识库展示相似案例，见"四、10"。组件本身还在、逻辑完整，只是`TrackedComboSection.tsx`/`SimulatorPage.tsx`两处调用它的按钮+渲染代码都注释掉了

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
- `useComboAnalytics.ts`（~271行）——`trackedResult`（今日组合定价+`netPremium`/`shiftedValue`/`change`）、`effectiveDaysElapsed`等对比模式派生计算的封装，"四、10"持仓处置建议功能读取`trackedResult.netPremium`就来自这里

## `src/lib/`（核心业务逻辑，无UI）

**定价与组合计算**：
- `types.ts`——`Leg`/`Shifts`/`GreekBreakdown`等核心类型定义。`Leg`新增可选字段`openLegId?: string`（2026-09-06），只在`trackedLegs`的腿上有意义，见"四、3.6"
- `bs.ts`——Black-Scholes定价模型+希腊字母
- `pricing.ts`（~567行，核心算法文件）——`priceCombo`（组合定价+归因，返回的`ComboResult.breakdown`含完整的组合级delta/gamma/theta/vega——**这份计算本身2026-09-07下半之后仍然保留**，只是App.tsx里显示这四个数字的面板被移除了，见"四、1.4"）、`payoffCurvePoints`、`probabilityOfProfit`、`findBreakevens`、`maxProfitLoss`（**注意：内部按固定±50%现价窗口扫描，这个窗口大小对很多策略会失真，见"四、10"止损/止盈bug的教训**）、`pnlAtExpiry`（**内部对"多到期日组合"有特殊处理**——不同到期日的腿，用最早的到期日作horizon，horizon之外还没到期的腿用Black-Scholes按剩余天数估值而不是直接按内在价值算，这是为了让真正的日历/对角价差算出正确的到期盈亏，见"四、1.5"里`RollComparisonChart`踩过的坑）、`impliedVol`/`impliedSpotFromPremiums`、`attributePnl`（P/L归因）、`classifySpotOnCurve`（判断某现价在payoff曲线上是"接近峰值/盈利区间/已越过盈亏平衡点"，供模拟账户"复盘"面板用）等。**`RATE`（0.05）和`POP_DRIFT_RATE`（0）是两个刻意分开的常量，不要合并**（2026-09-06）：`RATE`是喂给Black-Scholes定价本身的无风险利率，这个必须是真实的无风险利率，改了会导致所有腿位定价错误；`POP_DRIFT_RATE`只用在`probabilityOfProfit`的对数正态分布漂移项，回答的是"到期盈利的真实世界概率"这个完全不同的问题，按xue的决定统一用零漂移（详细理由见本节末尾历史记录，未变动）
- `legRoles.ts`——腿位角色解释（这条腿在组合里扮演什么角色，供逐条腿展示用）
- `legFactory.ts`——`uid`/`blankLeg`/`PRESET_DTE_SET`几个创建腿位用的小helper，`asOpeningLeg(leg, newId)`——把一条腿克隆成一条新的开仓组合腿，同时去掉`openLegId`字段，见"四、3.6"
- `matchStrategy.ts`（~139行）——从一组腿位反推策略名字（含"窄体铁鹰"/"玉蜥蜴"两种四腿/三腿结构的区分识别，见"四、2.3"）。**⚠️返回的是`item.name.zh`（中文显示名），不是`item.name.en`，不管当前UI语言是什么**——这是这个文件一直以来的行为，"四、10"的第一个bug就是因为`kbStrategyMeta.ts`最初误以为它返回英文名踩的坑，以后任何新代码要用这个函数的返回值去匹配别处按英文命名的数据（比如KB的`strategy`字段），都要先过一遍`kbStrategyMeta.ts`的`ZH_TO_EN_STRATEGY_NAME`表
- `positionHealth.ts`——组合健康度评分（四维度各25分），**调用方需要按当前模式传入对应的legs/spot/breakdown**，见"四、1.4"
- `decisionCompare.ts`——决策对比的核心计算（不动/平仓/展期三分支）
- `kbStrategyMeta.ts`（~168行，2026-09-10新增）——"四、10"持仓处置建议功能用，KB48个策略名的`direction`/`leg_count`固定表 + 中文策略名→KB英文策略名的翻译表，详见"四、10"
- `kbQuery.ts`（~266行，2026-09-10新增）——"四、10"持仓处置建议功能用，`computePositionSignals()`（判断止损/止盈/临近到期/pin risk四种situation_tag是否命中）+ `fetchPositionAdvice()`（调用`kb-retrieve` Edge Function），详见"四、10"

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
- `simAccount.ts`（~492行）——`SimPosition`/`SimAccount`/`PositionSnapshot`数据模型+CRUD、`computeMarginUsed`/`computeAvailableCapital`/`checkMarginForOpen`（保证金检查）、`analyzeBestExit`（悔棋模式用）、`computeCostBasis`/`computeMarkValue`（"四、10"持仓处置建议功能用`costBasis`当开仓净权利金）、`backfillSnapshots`（趋势面板回填，2026-09-06起复用`historicalBackfill.ts`的共享逻辑，自身不再维护一份历史K线拉取+重定价实现）。**这张表同样会随时间无上限增长**，见"四、4.4"
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

`I18nContext.tsx`（`useI18n()` hook + `t(key, vars?)`）、`translations.ts`、`locales/zh.ts`+`locales/en.ts`（各~700+行，键值对翻译文件，**改动前必读上面的"语言文件维护须知"独立章节**）。**2026-09-10新增16个`advice.*`key**（"四、10"持仓处置建议功能用：按钮文案、弹窗标题、loading/error/空结果三态、四种situation_tag标签、匹配降级提示、结果字段标签、免责声明），改动前后都跑过key集合一致性检查（687/687 → 703/703，0缺口）。

## `supabase/`

**Edge Functions**（`supabase/functions/`）：
- `stock-quote/index.ts`——实时现价代理
- `option-chain/index.ts`——期权链代理（Yahoo Finance `v7/finance/options`，cookie+crumb认证，服务端共享缓存`option_chain_cache`表15分钟TTL）
- `historical-prices/index.ts`——历史价格代理（同时返回`opens`/`closes`/`timestamps`，供趋势面板和`historicalBackfill.ts`回填用，只保留2个月窗口）
- `market-context/index.ts`——市场大盘背景数据（AI策略推荐用）
- `strategy-analysis/index.ts`——AI策略分析（对应`AIStrategyPage.tsx`的后端，目前是开发预览阶段，见"四、7"）
- `kb-retrieve/index.ts`（2026-09-10新增）——"四、10"持仓处置建议功能的检索接口，三级降级过滤查`position_management_kb`表，详见"四、10"
- `_shared/`——`bs.ts`（服务端BS定价副本）、`deltaMatch.ts`、`buildPrompt.ts`、`technicalIndicators.ts`

**数据库迁移**（`supabase/migrations/`）：`create_option_chain_cache.sql`、`create_user_data_tables.sql`、`20260910161520_create_position_management_kb.sql`（2026-09-10新增，"四、10"用）

**其它新增目录**：`scripts/import-kb-to-supabase.mjs`（2026-09-10新增，一次性/手动重跑的KB数据导入脚本，见"四、10"）——这个项目目前唯一的手动运维脚本

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
- **组合级Greeks（净Delta/Theta/Vega/Gamma）计算依然存在，但展示面板已移除**（2026-09-07下半，xue的决定）：`pricing.ts`的`priceCombo()`用有限差分算出完整的组合级`delta/gamma/theta/vega`，这份`result.breakdown`（分析模式）/`trackedGreeks.breakdown`（对比模式）**仍然是`positionHealth`的Gamma风险因子和Delta归一化因子的真实数据来源，不能删**。**以后如果要重新展示这四个数字，数据已经现成，只需要重新加回显示层**
- **"到期结果"类指标默认不跟随情景滑块**（maxProfit/maxLoss、POP、健康度评分是刻意的例外）——这条设计原则本身没变，见"五、核心设计原则"

#### 1.5 展期前后风险对比图（`RollComparisonChart.tsx`）

`RollDialog.tsx`新增一个`allLegs: Leg[]` prop（调用方传入这条腿所在的完整组合），对话框内部用`useMemo`算出"展期前"和"展期后"两个组合，渲染进`RollComparisonChart.tsx`（灰色虚线=展期前，蓝色实线=展期后）。**故意没有复用`PayoffChart.tsx`**——那个组件耦合了对比模式健康度/情景滑块修正等一堆无关状态。

**⚠️ 曲线失真/看似"没变化"的bug，2026-09-07下半修复**：单腿、只挪日期不动行权价的纯展期，两条曲线逐点完全相等是数学上正确的行为（到期盈亏图这个维度天生看不出"只是换了到期日"这种变化），加了`roll.compareSameShapeNote`提示文案避免用户误以为图表坏了。多腿组合只展期其中一条腿到不同到期日时，`pnlAtExpiry`的"多到期日组合"特殊处理（专为真正的日历/对角价差设计）会被临时构造的展期草稿意外触发，导致"展期后"那条曲线用BS理论价而不是到期内在价值计算，出现非单调的诡异形状——修复是把图表专用草稿腿的`dte`钉死在原始值，只让`strike`/`premium`反映变化，绕开"多到期日"分支。**这是"任何临时构造的、腿位到期日碰巧不一致的草稿组合，如果不是真的要用多到期日定价，必须主动对齐dte"这条教训的来源**，见"五、15"，"四、10"持仓处置建议的两个bug里，第二个（止损/止盈信号失真）跟这条是同一类"内部实现细节被意外触发"的问题，但触发机制不同（那边是`maxProfitLoss`固定扫描窗口，不是多到期日分支）。

### 1.6 术语悬浮提示（`Term.tsx`）

通用组件：`<Term titleKey="glossary.xxx" descKey="glossary.xxxDesc">文字</Term>`——点击弹出popover显示术语标题+一行解释。用点击而不是CSS `:hover`，触屏设备上行为跟桌面端一致（**这个"用点击不用hover"的先例，值得"六、backlog"里手机适配那一条参考**——当时就是为了让触屏也能用同一套交互）。**当前接入范围**：`EarningsIvCrashTab.tsx`财报预览网格里的"所需保证金"标签——目前唯一接入点。

### 1.7 决策对比（`DecisionCompareDialog.tsx` + `decisionCompare.ts`）

针对单条腿，用真实期权链数据对比"不动/平仓/展期"三种结果的盈亏。**没有"对冲"这第四个对比分支**，属于backlog（见"六"）。**"决策比较"弹窗里的展期分支是硬编码+30天**，见"六、已知问题"。

## 2. 策略库（保存/加载/管理/预设）

### 2.1 数据模型（`savedStrategies.ts`）

一条`SavedStrategy` = **1个固定不变的"开仓组合"**（`legs`/`spot`/`shifts`/`openingAt`，存了就不再变）+ **一串会增长的"快照"**（`trackedSnapshots: TrackedSnapshot[]`，每条是某天的"今日组合"实际数据）。存储在localStorage。

`TrackedSnapshot`新增了`estimated?: boolean`字段（2026-09-06）——`true`表示这条快照是`backfillTrackedSnapshots()`用历史股价+理论重定价自动补出来的，不是用户真实手动刷新保存的，见"四、3.3"。

### 2.2 预设库（`presets.ts` + `customPresets.ts` + `PresetPicker.tsx`）

内置42个策略预设模板（跨式/宽跨式/垂直价差/铁鹰/铁蝶/日历价差/双对角等）。**风险揭示**（`preset.risk`，三层颜色分级）+ **到期盈亏形状迷你图**（`PayoffSparkline.tsx`）。**每条预设的风险文案都是单独撰写的，不是模板套话**。

### 2.3 策略识别（`matchStrategy.ts`）

从一组腿位识别出策略名字给徽章用。除了跟42个预设做比例匹配之外，有一条独立的**结构判断规则**`checkIronButterflyFamily`，专门识别"两条卖出腿卡在同一行权价+两条保护腿分居两侧"这个形状族。**⚠️返回值是中文名（`item.name.zh`），见"三、文件地图"`matchStrategy.ts`条目的提醒**。

### 2.4 管理界面（`ManageStrategiesDialog.tsx`）

列表、置顶、重命名、删除、"跟踪"（进入对比模式，见"四、3"）。

## 3. 跟踪对比模式（"今日组合"）

（本节内容未变动，详见文件地图与前述章节引用；核心机制：三条进入路径、模式互相切换、保存快照/保存策略组合、快照自动回填、开仓组合↔今日组合腿位对应关系`openLegId`。完整细节保留在本文档历史版本描述中，2026-09-07后无变化。）

## 4. 模拟账户（`SimulatorPage.tsx` + `simAccount.ts`）

（本节内容未变动：动态保证金、趋势面板/悔棋模式、数据备份/同步容量隐患评估、仓位管理提醒/交易统计面板。2026-09-07后无变化，见前述章节。）

## 5. 财报IV Crash策略（端到端）

（本节内容未变动，见前述章节：三组结构、平仓规则、`earningsStrategy.ts`/`earningsClosing.ts`实现、明确搁置的部分。）

## 6. 场景选择器（`ScenarioSelectorPage.tsx` + `scenarioEngine.ts`）

（本节内容未变动，见前述章节。）

## 7. AI策略推荐（`AIStrategyPage.tsx`）——开发预览阶段

（本节内容未变动，见前述章节：当前最大的未完成模块，每日Cron+DB缓存架构还没搭。）

## 8. `App.tsx`内部结构（拆分现状）

（本节内容未变动，见前述章节：已拆出的六个子组件+`useLegEditing.ts`，故意没拆的策略管理handler集群+计算useMemo集群，TDZ风险提醒。）

## 9. 模块使用说明书 + 首页数据管理

（本节内容未变动，见前述章节：`HelpPanel.tsx`按模块拆分、gate/info两种variant、"不再显示"持久化、首页「数据」下拉菜单。）

## 10. 持仓处置建议（position-management-kb检索，2026-09-10新增，**⏸️前端入口已暂停**）

对比模式"今日组合"（`TrackedComboSection.tsx`header栏）和模拟账户每个持仓行（`SimulatorPage.tsx`），本来各有一个"持仓处置建议"按钮（`Sparkles`图标），点开弹出`PositionAdviceDialog.tsx`，检索`position_management_kb`知识库（1170条人工审核过的持仓处置案例，源数据**刻意存放在仓库外**，见"一、项目速览"末尾）里跟当前持仓最接近的3-5条真实案例，展示它们的建议/理由/风险。**KB内容范围是刻意限定的**：只基于持仓的技术/结构状态给建议（DTE、盈亏区间、距盈亏平衡点距离等），不含任何市场事件叙事（财报/新闻）、不含任何真实公司名。完整设计过程见claude.ai项目文档`claude/retrieval-feature-design.md`。

**跟"解释当前情况"（"四、1.8"，本文档历史版本已收录，2026-09-09新增）是两个独立功能，不叠加**：那个是纯本地同步规则引擎，服务分析模式+对比模式；这个是异步查数据库，服务对比模式+模拟账户。

**检索方式：纯精确匹配，不用embedding**——`strategy`+`leg_count`+`direction`+`situation_tag`四个字段逐级过滤（查不到就依次去掉strategy、再去掉tag以外的所有维度），不做向量相似度排序。**决策原因**（xue当面问过"不用OpenAI效果差多少、以后样本多了会怎样"）：KB刻意控制规模，每个精确组合本来就只有3-8条，候选集足够小，不需要再排序挑"最像的1条"——直接全部（封顶5条）展示。不用OpenAI/pgvector，没有任何API调用成本，纯Supabase Postgres查询。**如果以后KB规模数量级增长（比如到几万条）**，这个决策需要重新评估，届时再考虑embedding方案。

**部署状态**：migration已应用、`kb-retrieve` Edge Function已部署（项目`oyotvdhlffxodyfzqfxt`）、1170条KB记录已导入`position_management_kb`表——**后端完整上线，没有回滚**。

**关键实现文件**：见"三、文件地图"里`kbStrategyMeta.ts`/`kbQuery.ts`/`PositionAdviceDialog.tsx`/`kb-retrieve/index.ts`/迁移文件/导入脚本各条目。`kbStrategyMeta.ts`是KB48个策略名的`direction`/`leg_count`固定表（从全部1170条数据验证过，每个策略名只对应唯一一组leg_count/direction，是categorical标签，不是per-position现算的）；`kbQuery.ts`的`computePositionSignals()`判断当前持仓命中哪个`situation_tag`（`near_expiry`/`pin_risk`/`take_profit_target`/`stop_loss_trigger`四种，跟"四、1.8"解释当前情况用同一套DTE≤21/breakeven<3%/70%盈亏分区阈值，但两个功能各自独立实现，没有共享代码——那边的内部函数没有导出，为这个功能加export有改动`App.tsx`精心排序的memo链的风险，划不来）。

**⚠️ 已修复的bug之一：策略名中英文不匹配（2026-09-10，xue真实测试发现）**。`matchStrategy()`返回的一直是策略的中文显示名（如"裸卖 Put"），而`kbStrategyMeta.ts`最初的映射表是按英文策略名建的，两者对不上，导致`toKbStrategyMeta()`对**任何**仓位都返回null——"精确匹配策略"这一档查询从上线起就从未真正生效过，全部静默降级到最粗的"只按leg_count+direction"档，会把结构不相关的策略（比如裸卖Put和LEAPS Call，两者恰好leg_count/direction相同）混在一起推荐。**修复**：新增`ZH_TO_EN_STRATEGY_NAME`映射表（42条，从`presets.ts`的中英文名字段提取），`toKbStrategyMeta()`先把中文名翻译成英文再查表。纯前端改动，不涉及数据库/Edge Function/KB数据。

**⚠️ 已修复的bug之二：止损/止盈信号对近一半策略失真（同一次测试深挖发现，范围比bug之一更大）**。原判断逻辑是"当前浮亏(盈)÷`maxProfitLoss()`扫描出的理论极值≥70%"，而`maxProfitLoss()`（`pricing.ts`）只在±(现价50%)这个固定窗口内扫描。对有固定封顶结构的策略（价差、铁鹰、蝶式、Collar等）这个极值就是真实理论值；但对**单边无保护**的策略——所有裸卖单腿期权、卖出跨式/宽跨式、备兑组合的无保护一侧、比率价差、海鸥、玉蜥蜴（止损侧失真），以及所有裸买单腿期权、买入跨式/宽跨式、反向比率价差、保护性组合（止盈侧失真）——扫描到的"极值"只是窗口边界恰好在哪，不是真实理论极值，导致这个比例永远够不到70%，止损/止盈信号形同虚设，一直静默退化成"临近到期"这种弱信号。**用脚本把`presets.ts`全部42个内置预设都用两种扫描窗口宽度（±50%、±150%）对比验证过：45%（19/42）的预设至少有一侧受影响**，包括这个项目最核心的两类策略（裸卖Put——止损侧；LEAPS Call——止盈侧）。**修复**：`kbQuery.ts`新增一次更宽窗口的复扫（`scanPnlExtremes`），判断某一侧的极值是否随窗口变宽显著变大（`isMeaningfullyLarger`）——若是，说明这一侧本来就没有真实封顶，改用行业惯用的"浮亏(盈)达到开仓权利金的N倍"判断（`STOP_LOSS_CREDIT_MULTIPLE=2`：净收权利金策略浮亏达2倍权利金算止损；`TAKE_PROFIT_DEBIT_MULTIPLE=1`：净付权利金策略浮盈达1倍成本即翻倍算止盈——这两个数是常见经验值，不是精确计算，可调）；若某一侧本来就有真实封顶，完全不改动原来的比例判断逻辑（用两种窗口宽度扫描的差异自动判断，不是靠策略名单硬编码，覆盖所有策略包括KB独有的7个）。需要"开仓时的净权利金"这个新数据（`entryNetPremium`，对比模式从`trackedResult.netPremium`取，模拟账户从`SimPosition.costBasis`取，两处原本就有这个数只是没往下传）。**这条bug教训跟"四、1.5"展期对比图那次bug是同一类模式**：`pricing.ts`里一个为了某个具体场景（多到期日定价/固定扫描窗口）设计的内部实现细节，被一个它没预料到的新场景（临时展期草稿/止损止盈判断）意外触发，产生看起来合理实则错误的结果——以后往`pricing.ts`现有函数上叠加新用途时，要主动确认自己的输入形状有没有踩中类似的隐藏假设。

**⏸️2026-09-10暂停原因**：xue看完两个bug的修复效果后，指出建议的呈现格式需要重新设计——不能只展示KB原文，应该在最上面先加一段本地计算的持仓数字摘要（开仓/当前的日期、股价、权利金、涨跌幅、盈亏、时间已过去的比例），再给一个"继续持有/平仓/展期/保护"式的分类结论。分析结论（详见`claude/retrieval-feature-design.md`"下一步：建议格式重新设计"）：
1. 数字摘要部分**完全不需要KB样本**，是当前持仓自身字段的本地计算，app里数据本来就有，应该做成打开弹窗时直接算出显示在最上面，不需要网络请求。
2. "继续持有/平仓/展期/保护"这个分类结论——**样本本来就支持，只是没用上**：KB每条记录都有一个`action`字段（`STOP_LOSS`/`TAKE_PROFIT`/`HOLD_NO_ACTION`/`CLOSE_PARTIAL`/`CLOSE_POSITION`/`ROLL_OUT`/`ROLL_UP`/`ROLL_DOWN`/`HEDGE_WITH_OPTION`/`CONVERT_TO_COLLAR`等20种细分类），`kb-retrieve`查询结果里一直带着这个字段，但`PositionAdviceDialog.tsx`只渲染了`label`/`answer`/`reasoning`/`risk_factors`，**漏渲染了`action`**——这是待修的UI疏漏，不是数据缺失。
3. 支撑位一类的补充说明——抽查过1170条样本，约24条（2%）在理由文字里有类似"如果标的仍维持在关键支撑位以上可以继续持有，跌破则应止损"的条件式表述，但这是个别匹配到的样本自带的文字，系统不会主动判断用户自己仓位的具体支撑位在哪、离多远（免责声明里也写了"本系统不判断支撑/压力位的强弱"，这个限制是刻意的）。
4. **待xue决定**：`kb-retrieve`一次最多返回5条样本，可能`action`不完全一致（例如3条止损、2条持有）——是只取最相关的第一条做单一结论，还是列出建议分布，还是保留逐条展示、每条加上自己的action标签。这个决定完，再重新设计`PositionAdviceDialog.tsx`的渲染结构，然后取消`TrackedComboSection.tsx`/`SimulatorPage.tsx`里标了`PAUSED`的注释、恢复两处入口。

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
15. **`pnlAtExpiry`的"多到期日"特殊处理只适用于真正设计成多到期日的组合（日历/对角价差）**——任何临时构造的、只是"恰好几条腿到期日不同"的草稿组合如果不打算利用这个特殊处理，要主动把dte对齐，见"四、1.5"
16. **`pricing.ts`里任何按固定窗口/固定阈值扫描的函数（比如`maxProfitLoss`的±50%现价窗口），在被新用途复用之前要先确认这个固定窗口对新用途是否仍然成立**——"四、10"止损/止盈信号失真的bug就是`maxProfitLoss`原本只用于展示"图表上的理论极值参考"，被直接挪用去做"浮亏占比例判断"这个新用途时，没人意识到固定窗口对45%的策略会失真。跟第15条是同一类教训，但触发点不同
17. **`matchStrategy()`返回中文策略名**（`item.name.zh`），不是英文——任何要用这个返回值去匹配别处按英文/其它语言命名的数据的新代码，都要先经过一次翻译映射，不能假设它和`presets.ts`里的`name.en`一致，见"四、10"bug之一

---

# 六、当前已知问题 / backlog

产品功能层面的待办，按提及顺序列出（不代表优先级，跟具体某次改动引入的bug是两回事）。2026-09-06/07做过一轮竞品调研（tastytrade/thinkorswim/OptionStrat/Option Alpha等），完整建议清单见`FEATURE_PROPOSALS_2026-09.md`——下面第4/5/13/14条被那份调研独立佐证为高价值项，已标注。

1. **保证金持仓后不会动态跟涨跌**——只有开仓/预览那一刻算得对，需要把`computeMarginUsed`改成用实时股价而不是开仓时冻结的股价，牵涉多个调用点
2. **财报策略80%/70%阈值档**——UI占位已搭好，逻辑没做
3. **财报"方向判断"分支**——UI占位已搭好，内容没做
4. **IV Rank/Percentile真实数据**——卡在要不要接付费历史数据源，还没决定
5. **期限结构（Term Structure）可视化**——同一标的不同到期日的IV放一张图上对比，提过想法但没开始做
6. **模拟账户的历史快照不会"自动"积累，仍然只在手动点"刷新全部持仓"或打开趋势面板（回填）时记录**
7. **`handleAddToSimAccount`这个独立的"快速添加到模拟账户"入口，没有接上`openingAt`**
8. **决策对比没有"对冲"这第四个对比分支**
9. **决策比较（compare2）弹窗的展期分支写死+30天**
10. **`HedgeDialog`期权对冲路径没有真正解到目标Delta**
11. **全局是每条腿一个扁平IV，没有波动率微笑/skew/期限结构**
12. **`PayoffChart.tsx`里有4份几乎重复的情景计算逻辑，3份IV反推实现**——2026-09-06只解决了`pricing.ts`内部一个更小范围的子集，`PayoffChart.tsx`那4份独立实现仍是原样
13. **年化收益率（Return on Margin）没有算**——`SimPosition`需要先新增"开仓当时的保证金占用"持久化字段，这也是`simStats.ts`（"四、4.5"）v1没做资金效率类指标的同一个卡点
14. **IV/HV比值目前只在场景选择器里用**——手动在分析模式搭建自定义组合时看不到
15. **悔棋模式（Regret Mode A，"如果没平仓"按钮）**——用户反馈"问题比较大"，下次动手前要先问清楚设计诉求
16. **AI策略推荐（`AIStrategyPage.tsx`）的每日Cron+缓存基础设施还没搭**——当前最大的未完成模块
17. **`App.tsx`还有约400-480行策略管理handler+计算useMemo没有拆分**——风险较高，需要单独一轮细致处理
18. **claude.ai项目的GitHub同步白名单持续滞后于main分支实际文件**
19. **展期会留下永久的"幽灵腿"，占用10腿上限的名额**
20. **竞品调研（2026-09-06/07）里发现、backlog没提过的剩余建议**：模拟账户组合级保证金/Greeks汇总；仓位管理提醒未来可以跟AI四模型联动；历史期权链回放（thinkBack式）。
    - **20-b. 场景选择器"待定"标签页**——xue确认暂时保留，不算独立待办
21. **localStorage容量隐患**——见"四、4.4"，建议路径按投入递增：`autoSyncWrite`失败提示 → 迁移到IndexedDB → 更长期视多端同步需求决定要不要上Supabase
22. **"持仓处置建议"呈现格式重新设计（2026-09-10，待xue决定）**——见"四、10"末尾，需要先定下"5条样本action不一致时怎么归纳成一句结论"这个问题，再恢复`PositionAdviceDialog.tsx`的渲染结构和两处入口按钮
23. **移动端（手机浏览器）适配（2026-09-10/11评估阶段，未开始）**——xue提出想做一个绝大部分手机能用的竖屏版本，讨论后达成的方向：不做设备识别/不做独立手机代码库，走Tailwind响应式断点（同一份组件按屏幕宽度切换布局），这样能保持"改一次bug两边都好"这个当前架构的优点（逻辑层`src/lib/`+`src/hooks/`完全不用动）。**代价评估**：现在的UI几乎是纯桌面思路，全代码库目前只有3处用了响应式断点类，246处依赖鼠标hover的交互、47处原生hover提示框（手机上都要换成点击展开，`Term.tsx`的点击式popover是现成的可参考先例，见"四、1.6"）、多个写死420-640px宽度的弹窗（手机屏幕通常375-430px宽会溢出）、多处3-5列并排的网格布局需要收窄成1-2列，最关键的`LegRow.tsx`（752行，全项目最高频组件）是一整条横向平铺的输入框，大概率要重新设计成竖向堆叠的卡片，`PayoffChart.tsx`（1025行）的鼠标悬停十字线交互也要改成手指点/拖动。这是一次"重新设计核心组件在窄屏下的布局"的独立工作量，不是简单加几个CSS断点能完成的，还没有决定要不要启动，也还没挑选试点组件。

---

# 七、给接手的人（无论是人类开发者还是下一个AI会话）

1. **第一步永远是跟GitHub真实代码做一次全面比对**，确认这份文档反映的状态和实际代码库一致，再开始改动——**包括文档自己**
2. **动`zh.ts`/`en.ts`之前，务必读完文档开头的独立警示章节**
3. "六、已知问题"是最直接能接手的任务列表——22（持仓处置建议格式重新设计）目前有xue明确提出的具体诉求、13（年化收益率）和12（PayoffChart重复实现）性价比较高、23（移动端适配）规模较大需要先决定要不要启动，21（localStorage容量隐患）如果用户反馈过卡顿/同步异常，优先级应该提前
4. 遇到"某个条件不满足就整个隐藏UI"的写法，默认改成"展示框架+解释原因"（"五、8"）
5. `App.tsx`新增`useMemo`/`useCallback`时注意TDZ风险；新增"组合级"展示指标时按`isCompareMode`分支选数据源（"五、12"）
6. 财报相关改动注意`note`和`linkedStrategyId`是两个独立字段
7. 涉及"到期盈亏"类计算（`pnlAtExpiry`/`payoffCurvePoints`/`maxProfitLoss`）时，注意"多到期日"特殊处理只该用在真正的日历/对角价差上；`maxProfitLoss`的固定±50%扫描窗口在被新用途复用前要先确认是否成立（"五、15"、"五、16"）
8. `matchStrategy()`返回的是中文策略名，不是英文（"五、17"）
9. 交付代码遵守"一、开发/交付流程约定"里的规范（完整文件、路径注释、typecheck验证）
10. 这份文档改完之后按开头"维护方式"的约定去改，不要退回按会话追加的旧模式

<!-- claude/CLAUDE-handover.md 追加片段——建议放在"四、10 持仓处置建议"的"⏸️2026-09-10暂停"小节之后，作为紧接着的一条设计笔记 -->

### 设计笔记：呈现格式重新设计引出的方案根本讨论（2026-09-11）

**背景**：xue用真实持仓案例复测完两个bug的修复效果、也给出了建议呈现格式的模板之后，指出一个更根本的问题——即使有了数字化模板，也不清楚现有的1170条KB样本（静态预写文本，设计上从来不是为了往里填用户实时数字的）该怎么"套用"到具体数字情境里。这不是bug，是纯检索方案本身的结构性局限：检索返回的是别人过去写好的案例文本，"这段案例文本"和"我这个持仓现在的数字"之间怎么桥接，一直留给用户自己脑补，从未真正解决过。

**讨论出的两条路径**：
1. **本地规则引擎**——把已经算出来的`situation_tag`信号直接映射成"继续持有/平仓/展期/保护"结论，零成本、纯本地，KB样本降级成旁边的参考案例文本，不再是唯一输出。
2. **真正的RAG（检索增强生成）**——检索到的3-5条KB案例连同持仓当前实时数字一起喂给大模型，让模型基于真实案例生成针对这个具体持仓的个性化建议。这条路天然可以跟已规划的"AI策略推荐"四模型（Claude/GPT-4o/Grok/Gemini）基础设施合并，不用另起一套。

**xue追问：如果直接让大模型给建议，1170条样本是不是就没意义了？——结论：样本依然有价值，只是用途变了**：
- 样本的新角色是"喂给大模型的高质量上下文"，不是"最终答案"本身——先用现有的四字段精确匹配从1170条里挑出3-5条真正相关的，再连同实时数字一起交给大模型组织语言、给结论，让输出锚定在真实、经过审核的历史案例上，而不是模型凭通用知识现场编。
- 对比"完全不用KB、直接把问题扔给大模型"：会丢掉一致性（同样情况不同次问出现不同结论）、丢掉内容边界的强制约束（KB本身已经过滤掉市场叙事/真实公司名，纯甩给大模型没有这层过滤）、也更难审计"为什么给这个建议"。

**关于微调开源模型的问题（xue另外问的）**：技术上可行（LoRA/QLoRA是标准做法），但不建议——1170条对微调来说规模偏小，容易过拟合/死记硬背而不是泛化；而且"开源权重"不等于"免费运行"，自己托管一样要花GPU/推理成本，量级跟直接调用商用API接近，效果通常还不如后者。

**如果要做一次App内可点击原型验证效果，工作量拆解（2026-09-11评估）**：
- 关键发现：`supabase/functions/strategy-analysis/index.ts`里已经有跑通的`callClaude()`（以及GPT-4o/Grok/Gemini共用的`callOpenAICompatible()`）——服务端直接`fetch`调用各家API，key放在Edge Function环境变量里，不是耦合在前端组件里，**可以直接复用，不用重新搭调用链路**。
- 检索后加一步"组装prompt（检索到的案例+持仓实时数字）→复用现成的`callClaude()`→返回生成文本"，约0.5天。
- `PositionAdviceDialog.tsx`加一块生成文本展示区+loading态，约0.5天。
- 恢复两处入口按钮（`TrackedComboSection.tsx`/`SimulatorPage.tsx`里搜"PAUSED"），几分钟。
- 拿几个真实持仓案例跑一遍人工评估效果，约0.5天。
- 合计约1.5天。

**状态：讨论阶段，未拍板，未动代码**——走"本地规则引擎"还是"RAG"、要不要现在就做验证原型，等xue决定。