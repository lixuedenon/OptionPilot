# Option Lab - 项目说明

## 概述
期权策略实验室：可视化工具有期权策略的盈亏、希腊值和持仓追踪。面向中文用户。

## 技术栈
- Vite + React 18 + TypeScript
- Tailwind CSS + lucide-react（图标）
- Supabase（已配置，目前未使用数据库功能）
- 无路由、无后端框架；纯前端 SPA

## 关键约定
- 路径别名 `@/` 映射到 `src/`
- 所有用户可见文本使用中文
- 数据持久化使用 localStorage（策略库、自定义预设、最近股票）
- 颜色主题：深色背景（slate-900/sky-950），sky 蓝色为强调色，禁止紫色

## 核心数据结构
- `Leg`：期权/股票腿（action, type, strike, dte, premium, kind?, shares?, disabled?）
- `Shifts`：情景偏移（dS=股价, dT=时间, dV=波动率）
- `SavedStrategy`：保存的策略，含 `trackedSnapshots[]` 持仓快照时间线，`openingAt?` 开仓时间
- `TrackedSnapshot`：单次保存的持仓快照（id, legs, spot, savedAt）

## 文件结构
- `src/App.tsx` — 主界面，所有状态管理和交互逻辑
- `src/lib/types.ts` — 核心类型定义
- `src/lib/bs.ts` — Black-Scholes 定价和希腊值计算
- `src/lib/presets.ts` — 预设策略模板（中文，按组分类）
- `src/lib/customPresets.ts` — 用户自定义预设
- `src/lib/savedStrategies.ts` — 策略库存储（localStorage）
- `src/lib/pricing.ts` — 价格计算（含股息收益率的 BS 变体）
- `src/lib/matchStrategy.ts` — 策略匹配识别
- `src/lib/useStockQuote.ts` — 股价实时报价 hook
- `src/lib/recentSymbols.ts` — 最近股票代码
- `src/components/` — UI 组件（PayoffChart, LegRow, ShiftSliders 等）
- `supabase/functions/stock-quote/` — 股价代理 Edge Function

## 主要功能
1. **策略构建**：添加/编辑期权腿，实时计算盈亏曲线和希腊值；普通模式可设置开仓时间
2. **预设策略**：30+ 中文预设策略模板，支持自定义保存
3. **情景分析**：股价/时间/波动率滑块，查看策略在不同条件下的表现
4. **策略库**：保存/加载/重命名/删除策略，支持星标和拖拽排序，保存时记录开仓时间
5. **持仓追踪**：对比模式，保存持仓快照时间线，追踪策略实际表现；剩余天数四舍五入显示，IV 变化精确到 0.01pp
6. **实时报价**：输入股票代码自动获取当前股价

## 构建命令
- `npm run build` — 生产构建
- `npm run typecheck` — 类型检查
- `npm run lint` — 代码检查

## UI 结构
- **策略库下拉菜单**：保存策略组合、管理策略、保存追踪快照（仅对比模式显示）
- **数据下拉菜单**：整合文件链接、导入、导出三个功能于一个下拉菜单中（右上角，Database 图标）
- **使用说明按钮**：OptionPilot 标题旁的 HelpCircle 图标按钮，点击弹出使用说明模态框
- **腿位编辑按钮**：添加（+）、清空（垃圾桶）内联在腿位标题旁，不再藏在菜单里
- 已取消"当前策略"下拉菜单，追踪操作统一归入策略库菜单
- 左右窗口比例固定为 3.8:6.2（width: 38%），不可拖动调节

## 当前状态
- 快照时间线功能完成（trackedSnapshots 替代旧的单一 trackedLegs）
- 旧数据自动迁移到快照格式
- 对比模式支持快照选择器切换历史持仓记录
- "当前策略"下拉已移除，清空/添加改为内联按钮，保存追踪移入策略库菜单
- 普通模式新增开仓时间选择器，保存策略时一并保存
- 对比模式剩余天数改为四舍五入整数显示，IV 变化精度提升至 0.01pp
- 进入对比模式不再自动追加快照；仅在用户修改持仓内容后退出时提示是否保存快照
- 持仓组合区域新增实时变化信息面板：股价变化、时间流逝、IV 变化、持仓盈亏
- 图表盈亏标记点修正为沿持仓曲线定位（calcTrackedPnL），不再固定在抛物线顶端
- PayoffChart 中 trackedLegs 即为持仓腿，无 activeTrackedLegs 变量；hasTracked 为存在性判断（非 hasTrackedData）
- 对比模式 currentPnL（右上角盈亏数字）使用 netChange（实际权利金差额），不再用 calcTrackedPnL 重新定价；BS 曲线仅用于不同股价下的盈亏投影
- trackedResult（App.tsx）中 shifted=当前权利金×sign、base=开仓权利金×sign、change=shifted-base；netChange=Σshifted-Σbase
- 持仓曲线（红色虚线）以实际权利金盈亏为锚点：先算 BS 模型在当前股价的值，再用 netChange - 模型值 作为偏移量平移整条曲线，确保曲线在当前股价处经过实际盈亏点
- 当前股价竖线与持仓曲线交点处新增盈亏数值标签（绿/红色圆角矩形），图上可直接读出当前盈亏
- 对比模式当前股价通过权利金反推（impliedSpotFromPremiums），不使用实时行情价；用户输入的持仓权利金隐含了股价变化信息（如 short straddle 的 call 权利金下降+put 权利金上升→股价下跌），反推得到的隐含股价用于图表盈亏标记、信息面板股价变化、滑块打点；仅当反推失败（如只有正腿）时回退到实时行情价
- 右上角数据按钮（链接文件、导入、导出）已整合为单个下拉菜单（Database 图标）
- 选择预设策略时清空所有内容（包括对比模式），若对比模式有未保存修改则提示保存快照
- 左上角副标题文字已删除，改为使用说明按钮
- "保存策略组合"按钮带脏检测：保存或加载策略后记录基线快照（symbol/spot/legs/shifts/openingAt），当前状态与基线一致时按钮禁用；修改任一字段后按钮重新可用。应用预设或清空时基线置 null（按钮可用，因为未保存）。非对比模式下加载策略后，实时报价更新股价时会自动同步基线（pendingBaselineSync），避免报价覆盖保存价导致按钮误启用
- 已移除顶部"保存策略"按钮（与"保存策略组合"易混淆）；原功能改为通过每条腿的三点菜单中"添加到预设（全部）"触发，打开保存预设对话框
- LegRow 三点菜单结构：添加到预设（全部）、屏蔽（单腿）、删除（单腿）、对冲（单腿）、展期（单腿）、保护（单腿）
- **展期功能**：RollDialog 组件，点击三点菜单→展期，弹出对话框显示原腿信息，预设 +7d/+14d/+30d 快捷按钮，行权价默认沿用原腿（可改），权利金参考估算（同 IV Black-Scholes），确认后原腿标记 disabled 保留可见，新腿添加到列表末尾；裸卖 call 展期、行权价下移、新到期日更近时显示风险警告，勾选"持有正股"取消裸 call 警告
- **保护功能**：ProtectDialog 组件，点击三点菜单→保护，根据原腿自动建议保护腿方向（short call→buy call 更高行权价，short put→buy put 更低行权价），行权价/到期日/权利金预填建议值，确认后保护腿加入组合
- **对冲功能**：HedgeDialog 组件，点击三点菜单→对冲，显示组合实时总 Delta，提供正股对冲（自动算股数）和期权对冲（建议行权价/到期日/参考权利金）两种方式，确认后对冲腿加入组合
- **拖拽排序**：LegRow 左侧拖拽手柄（GripVertical 图标），支持拖拽重新排序，分析和对比模式均支持；App.tsx 中 dragIndex/dragOverIndex 状态管理，handleDragStart/handleDragEnter/handleDragEnd 处理排序逻辑
- "保存追踪快照"按钮带脏检测（trackedDirty）：保存快照后或加载快照后重置为 false，修改持仓腿时置为 true；按钮在未修改时禁用（disabled={!trackedDirty}）
- 快照删除：快照选择器旁有删除按钮（Trash2 图标），调用 deleteTrackedSnapshot；至少保留一条快照，删除最后一条时按钮禁用；删除后自动切换到最后一条快照，无快照时清空 activeSnapshotId
- **顶部信息栏布局**：固定两行 CSS Grid（grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_auto]），不使用 flex-wrap 自动换行
  - 第一行：左侧策略信息（期权腿位、策略名称、N/总数），右侧到期盈利、盈亏平衡、策略库按钮（whitespace-nowrap 防止换行）
  - 第二行：开仓价、开仓日期（col-span-2）
  - 指标块用 border-r 分隔，gap-2 间距
- **开仓价输入**：type="number" step="0.01"，onChange 用 `v >= 0`（不是 `v > 0`）允许输入 0 开头的小数；onWheel 调用 `e.currentTarget.blur()` 阻止滚轮改值（浏览器原生行为会在聚焦时按 step 增减）
- **开仓日期输入**：type="date" 原生日历控件，value 通过 `formatDateInput(ts)` 转为 `YYYY-MM-DD`（本地时区，不用 `toLocaleDateString("en-CA")` 避免时区偏移），onChange 通过 `parseDateInput(value)` 解析为时间戳；用户可直接输入数字或点击日历选择
- **开仓数据持久化**：开仓价（spot）和开仓日期（openingAt）在保存策略组合时一并写入 SavedStrategy；加载策略时回填到顶部信息栏；对比模式以保存的 openingAt 作为基础数据计算时间流逝（daysSince）。保存确认框（SaveStrategyDialog）显示开仓价和开仓日期供用户确认

## 多语言待办（尚未实现）
- **按钮/标签文字自适应**：多语言切换时，按钮和标签内的文字应通过缩小字号自适应按钮/标签的自身尺寸，确保所有文字完整显示在按钮或标签当中。**禁止使用 truncate 截断 + 鼠标悬停显示全部的方式**，必须缩小字号让所有文字可见。按钮和标签的尺寸保持固定，不因文字长度变化而撑开。
- **翻译范围**：仅按钮文字、标签文字、说明文字需要多语言；期权术语（Call/Put/Straddle/Greek 等）保持英文不翻译，减少不必要的翻译量。
- **隐含股价说明同步**：对比模式下"权利金反推股价"的说明文字出现在两处——(1) 顶部信息栏旁的说明弹窗，(2) 图表底端的说明区域。这两处说明内容必须完全一致，包括警告文字（权利金偏差大则股价偏差大）和"修正"按钮。点击任一处的"修正"按钮后，获取实时真实股价替换当前反推值，同时关闭说明弹窗。用户再次修改任意权利金后，修正值清除，恢复反推模式。
