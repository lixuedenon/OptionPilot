# OptionPilot — 项目交接文档

**这份文档写给下一个 Claude 会话（新窗口），目的是让你不用重新问一遍就能直接接着干活。仔细读完再动手，尤其是"关键约定与教训"那一节——里面全是踩过的坑，不看会重蹈覆辙。**

---

## 1. 这个项目是什么

OptionPilot 是一个期权策略可视化 + 模拟交易 + AI 策略推荐的 Web 应用，面向中文用户（Xue，项目所有者，本人是有实战经验的期权交易者）。核心定位：不只是"分析当下的期权组合长什么样"，还要"理解盈亏是怎么来的、比较不同操作的结果"。

**技术栈**：React + TypeScript + Vite + Tailwind CSS，后端是 Supabase（Edge Functions 做数据代理和计算，Postgres 存少量结构化数据），部署走 Supabase CLI 手动 `deploy`，没有 CI/CD。

**开发环境**：Xue 本地 Windows 电脑，VS Code + PowerShell，`C:\Users\lixue\projects\optionpilote`。已经不用 Bolt 了——Bolt 的浏览器内文件系统反复出现"改动没保存住、刷新就丢"的问题（这是 Bolt 平台本身的已知缺陷，不是操作问题），所以中途整个搬到了本地开发。GitHub 仓库 `github.com/lixuedenon/OptionPilot` 是 public 的，是唯一可信的"当前状态"来源（不要相信 Bolt 里的内容，Bolt 已经不用了）。

---

## 2. 四个模块，目前完成度

| 模块 | 状态 | 说明 |
|---|---|---|
| 分析模式 | 成熟，持续在加功能 | 搭建期权组合，三滑块（价格/时间/IV）推演盈亏 |
| 跟踪对比 | 成熟，持续在加功能 | 对比开仓 vs 当前，反推股价/IV变化 |
| 模拟账户 | 基础功能完整 | 虚拟开平仓，悔棋模式A（已平仓仓位事后对比）+ B（时间线快照回放） |
| AI推荐策略 | 开发中，核心链路已打通但未完全生产化 | 见第5节详细说明 |

---

## 3. 核心数据模型（src/lib/types.ts）

```
interface Leg {
  id, action("buy"|"sell"), type("call"|"put"), strike, dte, premium,
  kind?("stock"), shares?, qty?（份数，默认1）, disabled?
}
interface Shifts { dS, dT, dV } // 价格/天数/波动率百分点的情景偏移
```

关键约定，改动前必须知道：
- 正股腿（kind:"stock"）盈亏按每股算，不乘 shares（shares 只是显示用）
- 到期日全项目统一 snap 到最近周五，用 nearestFridayDte()（src/lib/dateUtils.ts），但这个函数只在特定路径调用（新建腿位、展期、对冲、保护、套预设），跟踪模式加载已存策略时不会重新 snap（如果旧数据本身不是周五，会一直显示错的日期，这是已知的历史遗留问题，不是当前代码的 bug）
- 期权链数据（Yahoo）不直接提供 IV，全项目统一用"权利金反推 IV"（impliedVol()，src/lib/pricing.ts，bisection 法），不要假设有现成的 IV 字段
- RSI/ATR 的计算实际是简单移动平均，尽管变量名/注释像是在说"标准 Wilder 平滑"——这是故意保留的行为（对齐 Python 原脚本的实际实现），不要"纠正"成教科书算法
- SimAccount 公式：realizedPnl = markValue - costBasis

---

## 4. 文件结构（当前实际状态，2026-08-22）

```
src/
  App.tsx              — 分析/跟踪对比模式主界面（约1580行，还在持续加功能）
  Shell.tsx            — 四个模块的路由壳
  HomePage.tsx          — 首页模块选择
  SimulatorPage.tsx     — 模拟账户
  AIStrategyPage.tsx    — AI推荐策略页面（临时预览版，见第5节）
  ComingSoonPage.tsx    — 占位页组件（当前没被任何路由使用，但保留）
  main.tsx              — 入口，包了一层最外层 ErrorBoundary

  hooks/
    useSavedStrategies.ts / useCustomPresets.ts / useAutoSync.ts
    — 从 App.tsx 拆出来的三撮独立状态（已存策略/自定义预设/自动同步文件链接）
    — 腿位组合 + 跟踪对比这两撮状态还没拆，耦合太深（applyPreset/doClearAll等
      好几个函数会一次性跨好几撮状态重置），下次要拆记得先设计"每个hook自己提供
      reset()方法"，不要直接搬

  lib/
    types.ts / bs.ts（Black-Scholes）/ pricing.ts（定价+PoP+归因+决策比较用的
      maxProfitLoss）/ dateUtils.ts / matchStrategy.ts / presets.ts /
      customPresets.ts / savedStrategies.ts / simAccount.ts / recentSymbols.ts /
      useStockQuote.ts / dataTransfer.ts（导出导入备份，已包含模拟账户数据）/
      autoSync.ts（本地文件自动同步备份）
    optionChain.ts       — 前端期权链客户端，带 Promise 级去重缓存（无过期时间，
                            改进空间见第7节）
    decisionCompare.ts   — 决策比较（不动/平掉/展期），展期用真实期权链数据
    miniMarkdown.tsx     — 手写的轻量 markdown→JSX 渲染器（AI策略结果展示用，
                            没引入第三方依赖）

  components/
    LegRow.tsx           — 腿位行组件，分析/跟踪对比模式共用；"..."菜单里有
                            屏蔽/删除/展期/对冲/保护/比较方案/上移下移
    PayoffChart.tsx / ShiftSliders.tsx / PresetPicker.tsx / StrategyBadge.tsx
    RollDialog.tsx / HedgeDialog.tsx / ProtectDialog.tsx — 单腿调整对话框
    DecisionCompareDialog.tsx — 决策比较弹窗
    PnlAttributionPanel.tsx   — 盈亏归因面板（跟踪对比模式）
    ErrorBoundary.tsx    — 通用错误边界（class component）
    ManageStrategiesDialog.tsx / SaveStrategyDialog.tsx / SavePresetDialog.tsx
    LanguageSwitcher.tsx / DropdownMenu.tsx
    dialogs/             — 从App.tsx拆出的内联弹窗（AlertCard, ConfirmClearDialog,
                            ConfirmBulkDeleteDialog, ConfirmReplacePresetDialog,
                            ConfirmSnapshotDialog, ConfirmSaveTrackedDialog,
                            HelpPanel, ImpliedSpotInfoPanel），index.ts统一导出

  i18n/
    I18nContext.tsx
    translations.ts      — 纯组装文件，import locales/*，加新语言只需要新建
                            一个 locales/<code>.ts + 改这里两行
    locales/zh.ts / en.ts — 实际词条

supabase/
  functions/
    stock-quote/         — 单只股票实时报价代理（Yahoo v8/finance/chart，不需要
                            cookie/crumb）
    option-chain/        — 期权链代理（Yahoo v7/finance/options，需要cookie+crumb
                            握手）。已接入服务器端共享缓存（Postgres表
                            option_chain_cache，15分钟TTL，见第7节）
    market-context/       — AI策略用：恐贪指数(CNN+VIX兜底)/宏观指标/经济日历
                            (Finnhub，免费版可能无权限)/新闻(Finnhub分类+6个RSS源，
                            实测4/6源能用，2个403)。支持?debug=true查看诊断信息
    strategy-analysis/    — AI策略主流程：拉QQQ数据→算指标→期权→市场环境→拼
                            prompt→并行调用Claude+GPT-4o+Grok+Gemini四个模型→
                            返回。见第5节，这是当前唯一还没做完的大块
    _shared/
      bs.ts / deltaMatch.ts / technicalIndicators.ts / buildPrompt.ts
      — 这几个是前端同名文件（src/lib/）的手动同步副本，不是真正共享
        （Deno边缘函数和Vite前端是两个独立运行环境，模块系统不通），改动
        逻辑要两边都改，文件头部注释里都写了这个提醒
  migrations/
    20260806061713_create_user_data_tables.sql — saved_strategies/custom_presets/
      recent_symbols 三张表（当前实际未使用，前端仍是localStorage，这是早期
      规划的云同步基建，没接上）
    20260822010000_create_option_chain_cache.sql — 期权链共享缓存表
```

---

## 5. AI推荐策略模块——当前最活跃、最没做完的部分

背景：Xue 原来有一套本地跑的 Python 脚本（daily_strategy.py + qqq_data_fetcher.py + data_fetcher.py），每天调用 Claude/GPT-4o/Grok/Gemini 四个模型给 QQQ/TQQQ 出期权策略建议。这次是把这套逻辑移植到 Web 应用里。

策略逻辑（STRATEGY_REQUIREMENTS常量，在 supabase/functions/_shared/buildPrompt.ts）是逐字从 Python 脚本搬过来的，Xue 明确说过"不要随意修改策略方向定义"，改动前必须跟他确认。

### 已经做完、验证过的部分

1. 技术指标计算（MA/EMA/MACD/RSI/布林带/ATR等）——用合成数据交叉验证过，跟Python原版逐字段完全一致
2. Delta反推与匹配（_shared/deltaMatch.ts）——从权利金反推IV再算Delta，验证过已知性质（ATM约0.5、深度实值/虚值趋近1/0、单调性）
3. 市场环境数据（market-context）——已部署，实测CNN恐贪指数、宏观数据、大部分新闻源都能连通
4. prompt拼装（_shared/buildPrompt.ts）——生成的prompt跟Python原版格式对得上，已用真实数据验证过输出
5. 四模型并行调用（strategy-analysis）——已经真实调用成功过，拿到过四个模型的真实返回结果，前端AIStrategyPage.tsx能正确渲染（包括处理不同模型markdown风格不一致的问题，见miniMarkdown.tsx）
6. 期权链共享缓存——已上线，减少对Yahoo的请求压力

### 还没做的部分（按原计划顺序）

1. TQQQ参数匹配——已经想清楚方案但没写代码：TQQQ不单独调用AI（避免和QQQ策略类型不一致的风险，也省一次模型调用成本），而是用deltaMatch.ts已经验证过的逻辑，从QQQ的AI建议里提取"目标Delta"，在TQQQ自己的期权链里找Delta最接近的合约，代码上直接复用现有的findContractByTargetDelta函数即可，这个是最快能补上的一块
2. 数据库持久化——现在strategy-analysis是"调用即返回"，没有存数据库。需要建一张新表（类似option_chain_cache的模式）存每天的分析结果
3. Supabase Cron定时任务——极其重要的架构决定，不要跳过或改变：AI模型调用必须是"每天收盘后自动触发一次"，不能做成"用户点按钮就调用"——后者会导致成本随用户数增长（当前AIStrategyPage.tsx的按钮是临时开发预览用，点了会真实花钱调用四个模型，页面上有明确的橙色警告条说明这一点，正式上线前必须换成"读数据库里已有结果"）
4. 前端改造——AIStrategyPage.tsx现在的"生成"按钮要换成"读取当天缓存结果"的只读展示，不再现场调用

### 更远期、已讨论但还没定案的功能

- "AI管理的另类模拟账户"——挂在AI推荐模块内部（不是模拟账户模块），全应用共享、纯只读，用户能做的只是把某个槽位的策略"加入到自己的模拟账户"。30个账户槽位滚动，每个策略最多持有30天。平仓机制Xue自己还没最终决定（AI主动判断平仓 vs 固定指标触发平仓，两条路径成本/复杂度差很多），下次做到这一步前必须先跟他确认选哪条路，不要自己替他决定
- 历史记录必须留档，不能被下一轮覆盖

---

## 6. 最近做完的功能（分析模式完善方向）

Xue的产品思路：不只是"看当下"，还要"理解盈亏来源、比较不同决策"。已完成两项：

1. 盈亏归因（P/L Attribution，PnlAttributionPanel.tsx + pricing.ts里的attributePnl）——跟踪对比模式下，把观察到的盈亏变化拆解成价格贡献/时间贡献/IV贡献三项，加一个"交叉项"（因为期权定价不是线性可加的，三项加起来对不上真实总变化是正常的数学现象，不是bug）。布局踩过坑：这个面板一开始塞进了一个高度受限的容器（max-h-[40%]），把腿位编辑列表挤没了，后来挪到不受高度限制的位置才解决；顺带把整个左侧栏从"每个小区块各自内部滚动"改成了"整体一起滚动，顶部工具栏sticky"

2. 决策比较（Decision Comparison，decisionCompare.ts + DecisionCompareDialog.tsx）——每条腿的"..."菜单新增"比较方案"，对比不动/平掉/展期+30天三种情况下整个组合的最大盈利/最大亏损/到期概率。展期这一档用真实期权链数据（不是理论估算），因为Xue明确要求"尽量真实地模拟实际情况"，这也是这次做服务器端期权链共享缓存的直接触发原因（不然每次点开弹窗都要连Yahoo，用户多了会有峰值风险）

还没做的两项（Xue的原始建议清单里排在后面）：
- Position Health（组合健康度评分，小组件，可以随时插入任何页面）
- Leg Purpose（每条腿的"角色"标签，比如"收租中"vs"已变方向性"，改动集中在LegRow.tsx）

---

## 7. 已知问题 / 技术债 / 值得做但没做的

1. option-chain前端客户端缓存（src/lib/optionChain.ts）没有过期时间——只在页面刷新时清空，讨论过要不要加15分钟TTL但没有最终拍板，可以问Xue要不要做
2. 没有排队限速机制——服务器端共享缓存能挡住"同一时刻查同一标的"的重复请求，但挡不住"同一时刻查很多不同标的"的峰值。讨论过用排队限速兜底（比如一秒处理一个），没有实现，Xue倾向于等真的有用户量再做
3. App.tsx腿位组合+跟踪对比状态没拆分成hook——见第4节
4. 没有单元测试——Xue自己说"可以先看计算结果是否正确"，暂缓
5. supabase/migrations/20260806061713_create_user_data_tables.sql那三张表没接上——前端仍是localStorage，这是早期规划但没执行的云同步
6. 移动端适配几乎没做

---

## 8. 反复出现、必须知道的"操作层面"教训

这些不是代码问题，是这次开发过程中反复踩过的坑，写出来避免下一个会话重蹈覆辙：

1. Bolt已经不用了，如果Xue的消息里提到"Bolt"，大概率是在回忆旧事或者问怎么彻底断开，不代表还在用它开发
2. Xue在本地用VS Code + PowerShell + npm run dev，每次改完文件要提醒他保存、确认dev server还在跑（npm run dev异常容易被误操作中断，建议固定用一个窗口跑它，Supabase CLI相关命令用另一个窗口）
3. 一定要按文件路径给完整文件内容（不是diff），Xue会自己复制粘贴替换整个文件。反复发生过"粘贴到错误文件"的情况（比如把Edge Function的内容粘进了前端组件），每次交付多个文件时，建议提醒他核对文件名再粘贴
4. 反复发生过"文件之前建过，但后来发现本地没有"的情况——这是历史上Bolt不稳定阶段的遗留问题，不是每次都需要惊慌，但每次改动前如果依赖某个之前做过的文件，最好先确认它真的存在（可以让Xue用Select-String或Get-Content搜关键词确认），不要假设"之前做过的东西现在肯定还在"
5. 代码交付前，永远先用esbuild做语法检查（这个沙盒装了esbuild，node_modules/.bin/esbuild <file> --bundle=false --outfile=/dev/null），能用真实数据交叉验证的（比如Python原脚本的计算逻辑），一定要验证，不要空口保证"这样应该对"
6. 部署流程：改完前端文件 → 保存 → npm run dev本地过一遍 → 涉及Edge Function的要额外supabase functions deploy <name> → 涉及数据库改动的要额外supabase secrets set（新key）或supabase db push（新迁移）→ 全部确认没问题后 → git add . && git commit && git push固化到GitHub
7. Supabase项目本身当初是从Bolt认领过来的（bolt-native-database-70052271，已认领到Xue自己的Supabase账号lixuedenon's Org，项目ref是oyotvdhlffxodyfzqfxt），认领时Bolt保留了对整个Supabase组织的大范围API权限，Xue还没去检查/收回这个权限，如果他问起这个事，可以提醒他去Supabase后台的组织设置里看一下

---

## 9. 环境变量 / Secrets 清单

前端 .env（本地文件，从没推送到GitHub）：
```
VITE_SUPABASE_URL=https://oyotvdhlffxodyfzqfxt.supabase.co
VITE_SUPABASE_ANON_KEY=<已知，需要时Xue可以直接给，这个key设计上可以公开>
```

Supabase Secrets（supabase secrets set设置，已确认配置完成）：
```
ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY / GEMINI_API_KEY  — 四个AI模型
FINNHUB_API_KEY  — market-context用
```
以上都已经设置好，不需要重新问Xue要。SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY等是Supabase自动提供给每个Edge Function的，不需要手动设置。

---

## 10. 建议的下一步（按优先级）

1. TQQQ参数匹配——AI策略模块里最快能补上的一块，逻辑已经想清楚，复用现有代码
2. 数据库持久化 + Cron定时任务——把AI策略从"临时按钮调用"变成真正的生产架构，这是上线前必须做的
3. Position Health / Leg Purpose——分析模式完善方向剩下的两项，工作量都不大
4. 其他的看Xue想先做哪个，他是那种会主动说清楚需求、也会主动纠正理解偏差的人，不确定的地方直接问他，不要自己瞎猜着往下做——这份文档里能讲清楚的都讲了，讲不清楚的地方（比如AI账户的平仓机制）就是因为他自己也还没想好，遇到这种情况提醒他而不是替他做决定。