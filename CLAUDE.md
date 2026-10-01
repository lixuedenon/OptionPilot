<!-- CLAUDE.md -->

# OptionPilot 交接文档（整合版）

**版本**：整合版，更新于 2026-09-30。**本轮（第三部分）：胜率模拟的规则按期限比例、买方模式、"假设"改名**——
- **到期前平仓改成按开仓总期限的比例**（`SimRules.closeFrac`取代原来的`closeDaysBefore`）：持有到期 / 剩1/4 / 剩1/3 / 剩1/2时间平仓，选项里显示换算出的天数（30天组合"剩1/4（8天）"、1年期"（90天）"）。总期限=开仓组合最早到期腿的dte（`SimSetup.totalTerm`，对比模式也按开仓时的总期限算，不按今天剩余）；`Prepared.closeAtRemaining`=剩多少天时平仓。原来固定7/14/21天对长期组合没意义，剩余时间不足7天的组合还会一进来就提示"现在就该平仓"。
- **买方模式**（开仓付钱=`!isCreditCombo`）：规则分开存（`localStorage`的`optionpilot.winRateRules2`，`{credit, debit}`），买方止盈赚50%/100%/200%、止损亏成本25%/50%/75%（卖方仍是赚25/50/75%、亏0.5~3倍）；新增"假设年化涨跌"输入（`SimSetup.drift`，默认0，只对买方显示），走势按这个漂移生成。安全垫：买方方向型（起点每张平均|Delta|≥0.3，`deltaPerContract`）改看"盈亏平衡年化涨跌"（`driftCurve`/`findDriftBreakeven`，同一组随机数、年化−60%~+60%九个点再二分细化，路数上限8000）和"方向安全垫"=你填的涨跌比需要的多几个百分点（≥10充足/≥3偏薄，`driftCushion`）；买方非方向型（如买入跨式）仍看盈亏平衡波动率。高级分析加一张"不同年化涨跌下的平均盈亏"曲线。盈亏平衡波动率曲线固定按零漂移算。
- **"假设"改名**：控制栏"假设未来波动"→"你假设的实际波动"，曲线标记"你假设的实际波动 X%"；卡片最后一行"假设："→"模型前提："（买方版本说明按你填的年化涨跌走）。
- 新增2个测试（平仓天数随期限缩放、买入Call需要正漂移才不亏且漂移越大越赚），44/44通过。翻译879/879。

**本轮（第二部分）：今昔对比——先解释"今天为什么是这样"，再往后推演**（xue："对比模式首当其冲是告诉用户现在的情况是什么导致的"）——
- **地形图左半边的逐段盈亏拆解**（`lib/stockOptionMap.ts`的`attributeSegment`/`buildAttributionTimeline`，`App.tsx`的`trackedMap`）：状态序列=开仓点→每条快照（同一天只留最后一条）→今天（今日组合+现价+`pnlOffset`）。相邻两点之间，两边都有的腿（按id/`openLegId`，再按买卖+类型+行权价+张数+到期那天±2天配对）按顺序拆：先只动股价（沿用前一点的剩余天数和隐含波动率）、再加时间、剩下是隐含波动率；其余变化（平仓已实现、展期/保护/对冲新开或去掉的腿）全算"调整"——四项之和严格等于总盈亏变化。左半边底部画一排柱（正的往上叠、负的往下叠；股价蓝/时间黄绿/波动率紫/调整琥珀；估算段半透明），鼠标在左半边时读数加这一段的拆解；图下方一行"开仓至今 X = 股价 + 时间 + 波动率 + 调整"，并给一句"亏损/盈利主要来自…，…抵消了一部分"（跟总结果同方向、贡献最大的一项）。**跟左边`PnlAttributionPanel`的区别**：那个是开仓vs今天一步到位的估算（有交叉项残差、不含已实现）；这里是逐段累计、含已实现，两者数字可能不同。估算段（终点是估算快照）只有股价和时间，隐含波动率变化只在真实快照处体现。
- **胜率模拟对比模式先"回看"**（`WinRateSim.tsx`的`retro` prop，`lib/winRateSim.ts`的`retroDistribution`/`percentileOf`/`moveInSigma`，worker先回传）：站在开仓那天，用开仓组合、开仓价、开仓时平均隐含波动率（市场当时的预期），组合一直不动模拟5000条到今天，给出中间一半的范围、中位数和"你现在比X%的可能情况好"（小直方图+白线"你在这里"）；运气=开仓至今股价走了几个标准差（≥1.5少见大行情、≥1明显、否则正常）；优势=开仓以来实际波动（`realizedVolSince`）对比开仓时隐含波动率（卖方：实际<0.9倍为"波动费值得"、>1.1倍"收少了"；买方反过来）；结论按排名<35%/>65%/中间和运气、优势组合成一句（例如"比多数情况差，主要是方向运气，不是策略本身没有优势"）；中途调整过时加一句说明。下面接原来的"往后看"。
- **快照回填修正**（`savedStrategies.ts`的`backfillTrackedSnapshots`）：估算快照改为从它前面最近的真实状态（开仓点或手动快照）出发推算，沿用那时的腿位和隐含波动率（原来一律用开仓组合+开仓隐含波动率：展期/平仓之后的估算日盈亏会跳，拆解里还会凭空多出波动率影响）；数据窗口（约2个月）内的估算快照每次进入跟踪时按新规则重新生成，窗口外的旧估算保留。**注意：仍然不会每天自动拉，只在进入跟踪时补；股价用当天(开盘+收盘)/2，期权价是理论重算**。
- 新增3个测试（拆解四项之和=总变化、纯时间段主要是时间、平仓算调整；回看分布/排名/标准差），42/42通过。新增43个翻译key（867/867）。

**本轮（第一部分）：新标签"胜率模拟"（蒙特卡洛管理规则模拟）**——
- **标题和模式切换**：图表标签行左边的标题改名——分析模式"推演未来"（原"未来情景模拟"）、跟踪对比模式"今昔对比"（原"情景偏移对比"）（`shift.scenario`/`shift.scenarioFrozen`，ShiftSliders/LockedOverlay里引用同一个key跟着变）。"切换到对比模式/切换到分析模式"按钮从`PayoffChart`标题栏移到图表标签行最右端（电脑版两种模式、三个标签下都在；分析模式在盈亏头部右边），`PayoffChart`不再接收`modeSwitchButton`。
- **位置**：图表区第三个标签"盈亏图 / 股价 vs 期权价 / 胜率模拟"（电脑版，分析模式和跟踪对比模式都有；手机不显示）。切到这个标签时三个情景滑块归零、底部滑块栏隐藏（规则控件在标签内），也算看过第5步引导。组件`WinRateSim.tsx`，计算`lib/winRateSim.ts`，后台线程`lib/winRateSim.worker.ts`（Vite `new Worker(new URL(...), {type:"module"})`，每次输入变化防抖400ms后终止旧线程、新开一个）。
- **算什么**：按"假设未来实际波动"生成随机股价走势（按日历日逐日、零漂移——不预测方向，跟`POP_DRIFT_RATE=0`同一约定），每天用`legShiftedPrice`重算组合（跟priceCombo/地形图同一口径，隐含波动率按起点反推、持有期间不变），按规则出场：止盈（赚到基准的25/50/75%）、止损（亏到基准的0.5/1/1.5/2/3倍）、到期前7/14/21天平仓或持有到期。**基准=开仓组合净权利金的绝对值**（信用组合是收的权利金，借方组合是付的成本；`openingBasis`），含正股腿的组合暂不支持（显示原因）。多到期日组合按最早到期日。规则存`localStorage`的`optionpilot.winRateRules`。
- **10批动画**：自动掷10批×1000条，每批约330ms出现一批（左边画其中60条走势，按出场原因着色：止盈绿/止损红/到期前平仓黄/持有到期蓝；右边每批留一个点，白点=第1批），10批放完才出结论。**稳定性判断**（`batchStability`）：第1批跟10批合计比，止盈比例差≤4个百分点、止损差≤3个百分点、平均差≤基准10%算"相仿"（说第1批可信），否则"以10批合计为准"；两种情况下后面的数字都用1万条合计（xue的规则，只是合计永远更准）。
- **结论卡片**（给新手）：稳定性一句 → 做10次大约几次止盈/止损/到期前平仓/到期（不到半次显示"不到1次"）及各自平均盈亏和天数 → 平均每次、赚钱概率、平均持有天数 → 最坏5%平均 + 仓位建议（"单笔最多能接受亏$X"输入框，存`optionpilot.winRateLossLimit`，按每组最坏亏损算最多开几组；"组"=期权腿最小张数）→ 安全垫（见下）→ 跟踪对比模式的持仓判断 → 规则检查（止损1万条里一次没碰到="形同虚设"；止损出场>35%="太紧"；止盈一次没碰到="调低目标"）→ 基准和假设说明。
- **盈亏平衡波动率/安全垫**：在一组实际波动（`volGrid`，覆盖隐含和假设波动）上用同一组随机数（`mulberry32`固定seed）算平均盈亏增量曲线，找过零点再二分细化（`findBreakeven`），路数按计算量自适应（`curvePathCount`）。卖方（波动越低越赚）安全垫=1−假设/平衡，买方=假设/平衡−1；≥20%充足、5–20%偏薄、<5%没有优势（经验值，可调）。**注意：单一隐含波动率时平衡点≈隐含波动率本身（规则改变的是斜率和尾部，改变不了平衡点）**；真实期权链各腿隐含波动率不同时，这个数才体现组合层面的意义。
- **假设未来波动**：默认最近20个交易日历史波动率（`computeHV(closes, 20)`），可手输或点快捷按钮（历史20日/开仓以来/隐含）；取不到历史数据时退回组合平均隐含波动率。历史价格仍是现用现取（`historical-prices` Edge Function，约2个月），新增`fetchHistoricalSeries`（同一代码10分钟内存缓存，不落盘）和`realizedVolSince`（开仓以来实际波动；开仓早于数据窗口时标"近2个月"）。
- **跟踪对比模式**：从今天出发，用今日组合（`activeTrackedLegs`）、实时现价、剩余天数；盈亏按开仓以来总账（`pnlOffset = trackedResult.change + realizedTrackedPnl`，跟地形图右半边同口径），止盈止损也按总账判断；起点已达止盈/止损线或已进入平仓窗口时直接提示"按规则现在就该平仓"；安全垫"没有优势"时给"考虑落袋/按计划处理"，否则"继续持有"。控制栏里有每股/每张切换（对比模式没有头部）。
- **高级分析**（折叠）：盈亏平衡波动率曲线（标出隐含/假设/平衡三条竖线）、1万条盈亏分布直方图、分位数（最差5%/25%/中位/75%/最好5%）。原计划的规则对比热力图、出场时间分布、单条走势查看留到第二版。
- **顺带**：`bs.ts`新增`bsPrice`（只算价格，跟`blackScholes().price`同一公式），`legShiftedPrice`改用它（全项目定价快约2.5倍，结果不变，全部测试通过）；`I18nContext`的插值改成替换所有同名占位符（原来只替换第一个）。
- 新增`src/lib/__tests__/winRateSim.test.ts`（9个测试：盈亏=priceCombo、卖方正负号、规则生效、2倍止损在这个铁鹰上碰不到、可复现与稳定、平衡波动率≈隐含、买方方向、对比模式起点状态、正股无基准）。新增87个翻译key（824/824）。typecheck/build/eslint（5/12基线）/test 39/39通过；Playwright实测分析模式和跟踪对比模式。

**上一版（2026-09-29）**：新用户引导 + 配对腿显示方式——
- **空白处引导**：分析模式组合还空着时，左边提示改成"输入代码后自动获取现价，再添加期权腿位：点击 + 逐条添加，或从 预设策略 / 策略库 添加策略组合。"（`guide.emptyHint`），其中"+/预设策略/策略库"是链接样式（手型、下划线），点了直接点页面上带`data-guide`属性的原始控件（`lib/guide.ts`的`clickGuideTarget`），下拉菜单在原位置展开、行为跟直接点原控件完全一样。右边图表空白提示：没代码时"请先在左上角输入股票代码"，有代码没腿时"左边的策略组合添加好之后，分析图形会在这里出现"（手机上说"上面"）。两边提示文字从slate-600调亮到slate-400。
- **步骤编号**（`StepBadge.tsx`）：五个步骤各用一种颜色（1琥珀/2天蓝/3翠绿/4紫/5粉，`StepBadge.tsx`的`STEP_COLORS`）。1=代码框、2=预设策略/+/策略库（组合空着时显示，加了腿就消失）；3=开仓价/开仓日期、4=保存策略组合按钮（每次都当新用户：组合空着时出现，保存或打开已存策略后消失，组合再清空又出现——`App.tsx`的`guideSaved`）。5=情景滑块标题"未来情景模拟"（有腿位且滑块还没动过、也没切到过"股价 vs 期权价"时显示，滑动一次或切过去一次就消失，组合清空后复位——`guideSlid`，`ShiftSliders`新增`guideBadge` prop）。手机上只有1、2——手机版以后单独做，现在不再改。悬停立即显示说明、手机上点一下显示（自绘浮层，不用原生title；`guide.step1..4`）。总开关`featureFlags.ts`的`STEP_GUIDE_ENABLED`，以后"设置"里加"是否显示使用步骤提示"时改成读用户设置。手机上只有1、2。`DropdownMenu`新增`guideId`/`badge`，`PresetPicker`新增`badge`。
- **展期/保护配对**：新腿不再加到列表最后，而是紧跟在原腿后面插入（`useLegEditing.ts`的`insertAfter`）；去掉腿号旁的配对小图标，改成一组配对的两条腿铺同色背景+同色边框（`legLinks.ts`按出现顺序给每组分配颜色，6色循环；A展期成B、B再展期成C算同一组同一色），悬停仍显示"由第N条腿展期而来"等说明。被展期的原腿照旧屏蔽变暗；保护的原腿不变暗。对冲针对整个组合、没有配对腿，不变。
- **新标签"股价 vs 期权价"**（盈亏地形图，`StockOptionMap.tsx` + `lib/stockOptionMap.ts`）：右侧图表区顶部加"盈亏图 / 股价 vs 期权价"两个标签（只在电脑版分析模式显示，原"盈亏图"和三个情景滑块完全不变）。新标签：横轴时间（开仓日→最近到期日，按日期标注）、纵轴股价（往上是涨）、颜色是组合盈亏（绿赚红亏，越深越多），行权价横线（高于开仓价绿、低于红、接近白），叠加典型股价走势线；子标签5组——单边（持续涨/持续跌）、横盘、反转（先跌后涨/先涨后跌，回头后冲过起点走到另一侧±1.3倍标准差，不在盈利区附近收尾）、横盘后突破、走完再横盘（先涨/跌再横盘），对立走势同图形成喇叭口。走势幅度=开仓价×开仓时隐含波动率×√(天数/365)（一个标准差，权利金没填好反推出的IV<3%的腿不参与，全不可信时按30%）。每条线终点标到期盈亏，下方列"到期/途中最好/途中最差"。鼠标十字线读数（日期、股价、盈亏、组合净值、每条腿的价值——`MapModel.legValuesAt`）。下方只保留隐含波动率滑块（`somDV`，独立状态、不锁左栏；左边显示基准=开仓时各期权腿IV平均值`comboBaseIv`，右边显示调整后的IV和加减的百分点；只重新上色，不改走势幅度）。盈亏口径与`priceCombo`一致（`legShiftedPrice`之和−开仓净权利金，每股计），数据用`activeLegs`/`analyticsSpot`（第0天=开仓日），有"今天"时画竖线。多到期日组合只画到最早到期日。
- **地形图联动 + 盈亏头部上移**：①盈亏头部（情景日期/盈亏金额/净值+百分比）从`PayoffChart`挪到"盈亏图 / 股价 vs 期权价"标签同一行（新组件`PnlHeadline.tsx`，两个标签共用，数据取`result`；`PayoffChart`新增`hideHeadline`，跟踪对比模式/手机版仍由它自己显示）。②切到"股价 vs 期权价"时三个情景滑块归零（释放左栏锁定，可以改腿位）。③地形图上鼠标所指的点（`mapPoint`，`StockOptionMap`的`onPointChange`节流约70ms上报）换算成`analyticsShifts = {dS: 股价−开仓价, dT: 第几天, dV: IV滑块}`，驱动头部盈亏、左边情景估值、盈亏归因、B/C卡片一起变；鼠标离开后停在最后位置；点一下钉住（琥珀色标记），再点取消。**真实`shifts`始终为0**——`isExploring`锁定、自动拉价、保存策略存的shifts都不受`mapPoint`影响，两者绝不能混用。地形图数据改用`mapLegs`（开仓基准腿位`analyticsLegs`去掉屏蔽的），跟`result`同一份。
- **地形图完善一轮（10项）**：①分析模式`PayoffChart`改用开仓基准腿位`mapLegs`（原来用实时腿位，开仓日在过去时"已过的天数"被重复扣一次，图上点和头部/归因对不上）；②头部亏损加"−"号；③净值改成"平仓收 $x / 平仓付 $x"（`chart.netReceive/netPay`，悬停有解释），`PayoffChart`自己的头部（对比模式/手机）同步；④地形图白色虚线=盈亏平衡线（逐列找网格正负交界、相邻列就近连线）；⑤紫色虚线=按开仓隐含波动率的±1σ/±2σ对数正态范围（`MapModel.cone`），超出图的部分断开不画；⑥上色改成盈利按`maxProfit`、亏损按`maxLoss`分别换算深浅；⑦开仓日在过去时出现"从开仓日看/从今天看"切换，"从今天看"时走势线、概率范围、途中最好最差都从今天+实时现价出发（`buildMapModel`的`opts.start`，今天以前`path`返回NaN不画）；⑧头部"每股/每张"切换（`unitMult`，1或100，存`localStorage`的`optionpilot.pnlUnit`），只影响头部和地形图（读数/终点/汇总）的金额，左边情景估值和盈亏归因仍按每股；⑨"使用说明"分析模块新增"股价 vs 期权价"一节（`help.moduleAnalysisMap`）；没有单独的第6步引导——切到"股价 vs 期权价"标签（`guideMapSeen`）和滑动盈亏图滑块一样，都会让第5步消失，组合清空时复位；⑩新增`src/lib/__tests__/stockOptionMap.test.ts`（12个测试）：锁住"地形图任意点盈亏 = `priceCombo`同偏移下的change"、各腿价值之和−开仓权利金=盈亏、起点/概率范围/"从今天看"、盈亏分开标尺、未填权利金的腿不参与基准IV。
- **跟踪对比模式也有"盈亏图 / 股价 vs 期权价"两个标签**（电脑版；标题显示"情景偏移对比"，`PayoffChart`在对比模式仍自己显示头部）。对比模式的地形图以"今天"为界：**左半边**=开仓至今真实走过的股价（`buildTrackedHistory`：开仓点+按时间排序的快照，圆点按当时总盈亏上色，估算回填的是小点），琥珀色竖线标出展期/保护/对冲第一次出现的那天（按快照里带`derivedFrom`的腿第一次出现判断），这半边不铺颜色（组合中途调整过，拿现在的组合算过去不准），鼠标读数显示最近快照的日期/股价/总盈亏；**右半边**=用"今日组合"（`activeTrackedLegs`、现价`effectiveTrackedSpot`）从今天推演（`buildMapModel`的`timeOffset`=已过天数、`pnlOffset`=开仓至今总盈亏），所有数字（格子颜色、走势终点、途中最好最差、读数）都是**从开仓算起的总盈亏，含已平仓/展期的已实现部分**（`trackedTotalPnl`，跟`trackedResult.change + realizedTrackedPnl`同口径）。注意：对比模式盈亏图头部的数字按原来的约定不含已实现部分（"四、3.6"），所以两边可能差一个已实现金额，地形图上标注"开仓至今（含已实现）"。IV滑块基准改成今日组合的平均IV（"基准（今天）"）。对比模式下鼠标不驱动头部/归因（归因仍是快照口径）。
- **股票代码位置调整**：标题行只留"未来情景模拟"；盈亏图标签里代码放在"切换到对比模式"那一行正中间（`PayoffChart`在`hideHeadline`时居中显示）；地形图标签里代码画在图的上方正中间（`StockOptionMap`的`symbol`）。开仓价旁边的"实时 xx.xx"去掉（顶部已有现价）。
- **盈亏图常驻叠加"到期时的盈亏"曲线**（`PayoffChart.tsx`的`expiryPoints`，用`pnlAtExpiry`，多到期日按最早到期日）：紫色虚线，主曲线（绿色实线，图例改名"情景日期的盈亏"）跟随时间滑块，越接近到期越贴近这条线；只在分析模式画，跟踪对比模式不变；纳入Y轴范围。顺带：图上当前点的数字标签在盈亏≈0时显示"0.00"，不再出现"-0.00"。
- **图表标签改成文件夹式**：标题行下沿一条分隔线，"盈亏图 / 股价 vs 期权价"是带边框、圆角的文件夹标签，当前标签跟下面图表区连在一起；"未来情景模拟 + 代码"在左边、后面用竖线隔开，不会被看成三个并列的功能按钮。没有有效股票代码时（`needSymbol`）两个标签禁用、标题变暗（跟左栏锁定、滑块禁用一致）。
- **图表区标题整理**：电脑版分析模式下"未来情景模拟"标题+股票代码放在图表标签行最前面（"未来情景模拟 TEST ｜ 盈亏图 ｜ 股价 vs 期权价 …… 盈亏头部"），表示两张图都属于情景模拟；`ShiftSliders`新增`hideTitle`，`PayoffChart`在`hideHeadline`时也不再显示代码和"当前盈亏"字样；第5步引导编号跟着标题移到上面。地形图画布上加坐标轴说明：纵轴"↑股价"沿纵轴竖排（中文逐字上下排、英文旋转90°，不带代码——代码在上方标题里）、底部"时间（开仓 → 到期）→"。header的EPS估值按钮图标由靶心改成"$$"。
- **使用顺序：第一步必须先有有效股票代码**（分析模式，`App.tsx`的`needSymbol`）：代码为空、还没取到现价、或报价失败（代码无效）时，左栏整体由`LockedOverlay`锁定（新增`reason`：`explore`/`symbol`/`symbolInvalid`，提示分别是"请先重置情景滑块"/"请先在左上角输入股票代码"/"找不到这个代码的报价"），header的预设策略、右下情景滑块同时禁用。**策略库例外**（`data-lock-exempt-symbol`，只在缺代码时放行、滑块锁定时不放行）：打开已存策略会带上它自己的代码，从首页"跟踪"进来也要能用。开仓价输入框在锁定范围内——否则手填开仓价就能绕过"先有现价"。代码无效时也锁，是为了避免左边留着上一个代码的组合、却显示新代码。跟踪对比模式不受影响（代码和现价来自已存策略）。
- **预设悬停小图标出行权价**（`PayoffSparkline.tsx`）：每个行权价一条竖虚线+底部数字，100白色、高于100绿色、低于100红色，同一行权价多条腿只标一次，相邻太近的数字错开到第二行（自定义预设同样适用）。预设行权价本身不改：108/92、105/95这类非10步长是早期按"典型距离"取的，不是刻意规则；改成步长10需要重算模板权利金，还会影响`matchStrategy`按相对间距识别旧组合，xue决定不改。
- 没有股票代码时的锁定提示/图表空白提示（`chart.noSpot`）改为"请先输入股票代码或在策略库中打开已有的策略组合"。
- **图表"净"值旁的盈亏改成百分比**（`PayoffChart.tsx`）：右上角已有盈亏金额，这里改显示盈亏÷开仓权利金的百分比，方便对照"盈利50%/亏损50%平仓"；含正股腿或开仓权利金≈0时退回显示金额。
新增58个翻译key、改了3个（728/728）。typecheck/build/eslint（5/12基线）/test 27/27通过。**上一版（2026-09-28）**：**本轮：滑块锁定时盈亏归因的"?"说明也打不开**（xue反馈的老bug）——盈亏归因只在滑块离开原点后才有内容，正好是左栏被锁的时候，结果它的说明永远点不开。原则：锁定只管能改数据的东西，只读说明不锁。`LockedOverlay`改为：不再用`inert`；遮罩点击时用`elementFromPoint`看下面是什么，在`data-lock-exempt`区域里（目前只有`PnlAttributionPanel`根节点，B/C卡片里的归因面板自动包含）就把mousedown和click转发过去（mousedown也要转发，否则说明弹窗的"点外面就关"会先把它关掉），否则在点击处弹"请先重置"；键盘焦点进入非豁免区域时`onFocusCapture`直接blur并弹提示，代替原来inert对键盘的拦截。以后再有"锁定时也要能看"的只读说明，给它的容器加`data-lock-exempt`即可。typecheck/build/eslint（5/12基线）/test 15/15通过。**上一版（2026-09-26第四轮）**：**第四轮：手机精简版**——xue真机测试反馈"内容太多、字很小、放不下"，确认手机上只保留主要功能（判断统一用`useIsMobile()`，电脑/iPad完全不变）：
- **分析页**：保留logo/预设策略/标的+现价、腿位的方向/类型/张数/行权价/到期日/权利金（自动填价保留）、"+"/清空/策略库/加入模拟账户、盈亏曲线+当前盈亏+到期盈利/盈亏平衡、三个情景滑块。隐藏：多方案对比B/C、盈亏归因、全选/批量操作、每腿情景估值/腿位盈亏、"⋮"里除屏蔽和删除以外的项（LegRow在手机上不传这些handler）、开仓价/开仓日期（开仓价跟随实时报价、开仓日期=今天）、图表各腿明细/时间衰减开关/缩放提示/底部图例（PayoffChart新增`compact`）、模式切换按钮、header的涨跌幅/EPS/时钟/语言/使用说明。腿位行手机上改为"方向/类型/张数/⋮"+"行权价/到期日/权利金"两行，到期日下拉箭头隐藏（点日期框本身就能选）。页面底部显示"手机版为精简版，完整功能请在电脑上使用"（`mobile.fullFeaturesHint`）。
- **字号**：`index.css`里`.op-mobile`（App.tsx/SimulatorPage.tsx手机时加在根节点）把`text-[8px]`→11px、`[9px]`/`[10px]`→12px、`[11px]`→13px、`text-xs`→14px、输入框15px，SVG图表文字按font-size属性分档放大——集中在一处，不逐个改组件。
- **跟踪对比**：只看不改——不显示开仓组合腿位（统计网格里已有开仓vs当前）、统计网格改2列、今日组合的腿`inert`+提示"手机上只能查看"（`mobile.viewOnlyHint`）、不能存快照/删快照、冻结的滑块不显示；快照选择器保留（可以切换查看）。
- **模拟账户**：看持仓+平仓——隐藏交易统计面板、搜索框、新建仓位/从场景开始、全选/批量平仓、表格的开仓价/现价/市值/盈亏%/代码/操作列（只留到期日/行权价/类型/数量/盈亏）、走势/对比按钮、删除按钮、复盘按钮、重置账户、使用说明、时钟。开新仓从分析页"加入模拟账户"。
- 顺带：`ManageStrategiesDialog`/`SavePresetDialog`加`max-w-[94vw]`（手机上原来会超出屏幕）；`ShiftSliders`手机上数值列加宽、副数值换行；模拟账户"平仓"按钮不再被挤成竖排。
新增2个翻译key（670/670）。typecheck/build/eslint（5/12基线）/test 15/15通过；Playwright实测360/393竖屏、844×390横屏无横向溢出，电脑1440和iPad 768保持完整功能。****第三轮：①滑块锁定改成一处统一处理**——xue反馈"滑动滑块后左边锁死，但点盈亏归因/对比方案没有任何提示，用户会以为出了问题"。现在App.tsx左侧整栏（腿位/盈亏归因/多方案对比/工具栏）只包一层`LockedOverlay`：`isExploring`时内容设为`inert`（鼠标/触屏/键盘都进不去），上面盖透明遮罩，点任意位置都在点击处弹"请先点重置"提示。原来分散在`LegListSection.tsx`/`ComboCompareSlots.tsx`里的两层LockedOverlay、以及App工具栏/LegListSection/ComboCompareSlots/LegRow里二十多处`disabled={locked}`/`|| isExploring`已全部删除；`locked`这个prop现在只剩一个用途——透传给LegRow暂停自动拉价（`canAutoPrice`）。header里的预设/标的输入（在左栏外）和图表标题栏的模式切换按钮仍按原样用`isExploring`禁用。**②注释大清理**——xue指出文件每次改都在变大，主要是注释里堆了大量"2026-xx-xx改/xue反馈/原来是…"的修改历史。按"五、22"的新规则清理了App.tsx（1666→1290行）、useStrategyOrchestration.ts（968→736）、LegRow.tsx（1133→983）、PayoffChart.tsx（990→955）、SimulatorPage.tsx（1701→1657）、LegListSection.tsx（427→369）、ComboCompareSlots.tsx（415→332）：纯历史的删掉，带警告/约束的（TDZ顺序、不能这样改的原因、xue的硬性要求）压缩成一两行保留。**每个文件都做了"去掉注释后代码完全一致"的机器校验**，只动了注释。typecheck/build/eslint（5/12基线）/test 15/15通过。**第二轮（同日）**：移动端第二步手机上下排列布局。**第一轮（同日）**：移动端第一步地基——手机上能正常输入、数据不丢；分析页的手机布局还没改（第二步）。①`numberInput.ts`的`blockInvalidNumberKey`放行安卓虚拟键盘的`Unidentified`/keyCode 229（原来会拦掉所有数字键），全部11个数值输入框加`inputMode`（整数字段`numeric`、其余`decimal`）；②`main.tsx`只在iOS上给viewport追加`maximum-scale=1`阻止点输入框自动放大（iOS对网页只把它用于禁自动放大，双指缩放仍可用；不改输入框字号是为了不撑坏LegRow固定宽度），并调用`navigator.storage.persist()`；③`index.css`在支持dvh的浏览器里把`.h-screen`/`.min-h-screen`覆盖成`100dvh`（组件里的类名没动）；④`tailwind.config.js`开`hoverOnlyWhenSupported`；⑤PWA：`public/manifest.webmanifest`+从logo罗盘裁出的图标（`icon-192/512`、`icon-maskable-512`、`apple-touch-icon`、`favicon.png`），`index.html`加对应标签，**没有加service worker**（避免缓存旧代码干扰调试）；⑥分享备份+7天备份提醒，见"四、9"。新增4个翻译key（`toolbar.shareBackup`、`backup.reminderNever`/`reminderDays`/`later`），zh/en 668/668。`typecheck`/`build`/`eslint`（5错误12警告基线不变）/`test`（15/15）通过。**上一版（2026-09-25）**：AI推荐模块屏蔽（见"四、7"）、移动端研究方案（见"六、22"）、跟踪对比模式`trackedDirty`改派生计算等。
1. **保存快照后切到分析模式/点logo仍误报"有未保存改动"**：xue反馈"对比模式保存了快照之后，切换/退出仍然会问是否保存，确认了会存一份一模一样的重复快照"。根因：`trackedDirty`以前是手动true/false的state，散落在`useLegEditing.ts`（展期/保护/对冲/勾选/关闭/移动六处）和`useStrategyOrchestration.ts`的`updateTrackedLeg`里各自调用`setTrackedDirty(true)`，任何一处调用时机跟`trackedLegs`真实内容不完全同步，这个flag就可能跟真实"有没有改动"脱节而不自知（跟`serializeSlotLegs`/`isSlotDirty`——2026-09-24给A/B/C多方案对比加`baseline`字段时已经用过的同一类教训，见"五、19"）。改成派生计算：新增`serializeTrackedLegs`（`savedStrategies.ts`，只按腿位内容算指纹，不含`trackedSpot`——它会随实时报价轮询自动刷新，纳入会把股价波动也误判成改动）+ `trackedBaseline`（`App.tsx`新state，记"此刻视为已保存"那一份trackedLegs的指纹），`trackedDirty`现在是`trackedLegs!==null && serializeTrackedLegs(trackedLegs)!==trackedBaseline`的现算结果，不再是手动维护、可能跑偏的布尔值。原来分散在`useLegEditing.ts`/`updateTrackedLeg`里的`setTrackedDirty(true)`调用全部移除（不再需要，派生判断自动感知），所有原来`setTrackedDirty(false)`的地方（`saveTrackedSnapshotTo`/`handleTrack`/`handleSwitchToCompare`/`handleSelectSnapshot`/`applyPreset`/`doClearAll`）改成`setTrackedBaseline(serializeTrackedLegs(刚设置的trackedLegs))`或`setTrackedBaseline(null)`（trackedLegs本身被清空时）。
2. **顺带修的另一个方向的bug——点logo退回首页，对比模式下完全不检查未保存改动**：排查过程中发现`AppHeader.tsx`点击logo的逻辑，`isCompareMode`为true时直接`onBackHome?.()`，压根没看`trackedDirty`，未保存的持仓编辑会被无声丢弃——这跟上面报告的"该不问却问"方向相反，但同属"没有用同一套可靠的脏检查"。改成退出图标点击统一调用`onRequestLeave`（不再由`AppHeader.tsx`自己按`isCompareMode`分支），`App.tsx`的`requestLeave`内部按模式分两条路径：跟踪对比模式下看`trackedDirty`（复用`clearAllLegs`已经在用的`confirmSaveTrackedOpen`/`ConfirmSaveTrackedDialog`，一个新的`pendingTrackedLeaveHome` ref区分这次答完该走`onBackHome`还是`doClearAll`），分析模式下走原有的A/B/C逐一确认队列（`leaveQueue`，2026-09-24"逐一提示"功能，见下条）。
3. **补文档：2026-09-24"逐一提示"功能之前没写进这份文档**——多方案对比（A/B/C）退出时的"没有改动的组合不提示，有改动的逐一提示保存"机制（`CompareSlot.baseline`/`isSlotDirty`、`App.tsx`的`requestLeave`/`advanceLeaveQueue`/`leaveQueue`state、`ConfirmLeaveDialog`的`comboLabel`/`remainingCount`），上一轮实现完之后忘了同步进这份文档，这次和本轮的bug修复一起补上，见"四、3"。
4. **"对比方案"（多方案对比A/B/C新建B/C槽位的那个按钮）在方案A腿位区域为空时应该不可用**：xue反馈的第二个问题——`ComboCompareSlots.tsx`里`onAddSlot`按钮原来`disabled={locked || slots.length >= MAX_COMPARE_SLOTS}`，没看`mainLegs.length`。B/C是拿来跟A对比的候选方案，A还没有任何腿位时新建一个对比方案没有意义，加了`mainLegs.length === 0`这个条件，并在按钮title里给出提示（新增`compare.addSlotNeedsMainLegs`翻译key，zh/en都加了，664/664对齐）。
5. **小屏幕/窄窗口笔记本上，`LegRow.tsx`输入框内容显示不下、被挤到换行导致整行布局错乱**——见"四、1.2"新增小节的完整说明。轻量修复（跟xue确认过方向，不是"六、22"移动端适配那种整体重新设计），新增`useNarrowLegRow()`（≤1440px时`narrow=true`），窄窗口下把张数/行权价/权利金/到期日几个固定宽度框、情景估值/腿位盈亏两个`ValueBadge`、以及行内`gap`/`px`都按比例收窄几像素，配合已有的字号自动收缩兜底，两层收缩叠加应对更窄的窗口。

`npm run typecheck`/`build`/`eslint`（5错误12警告基线不变，见"五、5"附近历次记录）、`npm run test`（15/15）全部通过。此前的更新合并了2026-09-24（两个"卡死"bug修复+一批数值输入/对齐类UI问题）、2026-09-19（"解释当前情况"对话框+图表提示条整合成一套逻辑，见"四、11"）、2026-09-11（"持仓处置建议"KB检索方案彻底移除，见"四、10"归档指引）、2026-09-05~07几轮会话（预设风险揭示/到期盈亏小图、zh.ts/en.ts严重滞后事故修复与教训、对比模式健康度/Greeks修正、竞品调研落地四项功能、功能精简走查、UI布局微调）的成果。**这是当前最新、最权威的交接文档版本**，跟仓库其它文件一起push到GitHub main分支后，应视为项目当前状态的唯一事实来源（直到下一次更新）。**这份文档替代了之前"按会话追加"的版本**——旧版本是每轮会话在文末加一个新章节，越滚越长，找一个功能的现状要翻好几个章节、对着时间戳自己判断哪段是最新的。这份文档**按功能/模块组织，只描述"现在是什么样"，不按时间顺序记流水账**。

**维护方式（重要，后续会话都要遵守）**：
- 做完一个功能改动或修复了一个bug，**直接去改对应的章节内容**，让它反映当前状态，不要在文末追加"2026-xx-xx又做了什么"这种新章节。
- 如果改动创建了新文件/新模块，在"三、文件地图"和"四、功能模块详解"里对应位置加进去。
- 如果解决了"六、已知问题"里的一条，从列表里删掉（不是标记"已完成"留着不删）。**功能被彻底放弃、不再打算做时，同样从列表里删掉，不要留着**（这次"持仓处置建议"呈现格式重新设计那条backlog就是这么处理的）。
- 如果发现了新的已知问题/技术债，加进"六、已知问题"。
- 只有在某个改动本身特殊到值得单独留痕迹时（比如一次重大架构决策、一次踩坑教训——**语言文件那次事故就是这种情况，见下面独立的警示章节**），才写成"设计笔记"/"事故记录"性质的独立小节，正常的功能新增/bug修复不需要。
- 每次改完这份文档，**开头这个"版本"行的日期改成当天**，作为"文档更新到什么程度"的唯一时间戳，不需要维护一份变更日志。

**如果需要查历史会话的详细讨论过程**（比如某个设计决策当初为什么这么定、具体的调试过程），更细粒度的分主题讨论记录都保留在claude.ai的"options pilot"项目文档里（`claude/wiring-check-2026-09-03.md`、`claude/mode-switch-and-restore-2026-09-03.md`、`claude/sim-account-changes-2026-09-02.md`、`claude/preset-risk-disclosure-2026-09-05.md`、`claude/i18n-staleness-incident-2026-09-06.md`、`claude/analysis-compare-mode-review-2026-09-06.md`是几次专项讨论/事故的详细记录）。`claude/retrieval-feature-design.md`（持仓处置建议功能的完整设计过程+两个bug的详细记录）和`claude/position-management-kb-status.md`（KB样本积累进展）**现在是已归档的历史文档**——功能本身已经废弃，这两份文档顶部都加了归档说明，留着是为了以后设计"直接调用大模型"方案时，能查到当初为什么放弃检索方案、两个bug的具体教训。这份新文档不重复那些讨论过程，只给结论和现状。

**重要提醒（接手第一件事）**：这份文档、以及历次对话里所有的代码交付，都基于Claude自己维护的一份**本地沙盒副本**，不是直接读GitHub实时代码（除非某次会话特意说明是直接读的）。这份副本的准确性依赖于用户本地是否已经把每次交付的文件都正确落地、commit、push。**2026-09-07发现过一次真实的文档/代码不同步**：仓库main分支当时的`CLAUDE.md`落款日期是09-06，但同一次push里的代码其实已经包含了09-07当天新增的`Term.tsx`/`RollComparisonChart.tsx`/`SimStatsPanel.tsx`等文件——即"代码已经改了、文档没跟着改"。**2026-09-11又发生了一次方向相反的同类事故**：这份文档曾经说"持仓处置建议"的止损/止盈信号失真bug"已修复"，但当时直接读取GitHub main分支实际代码后发现根本没有对应实现——即"文档写了、代码没跟上"，两种方向的不同步这个项目都真实踩过。**这份文档本身也会踩自己警告过的坑，接手时不要预设文档落款日期等于代码的真实进度，关键判断优先直接核实GitHub实际内容。**

---

## ⚠️ 语言文件（`src/i18n/locales/zh.ts` / `en.ts`）维护须知——极高优先级，读完这一节再碰这两个文件

**2026-09-06发生过一次严重事故**，完整记录见`claude/i18n-staleness-incident-2026-09-06.md`，这里只给结论和以后必须遵守的规则。

**发生了什么**：Claude沙箱那一轮会话用来交付`zh.ts`/`en.ts`的基线，跟GitHub真实main分支逐字节完全一致——但用户**本地**实际的开发进度早已远超这个基线，本地已经手工新增了约40个翻译key（对比模式切换、组合健康度、决策比较v2、盈亏归因、财报面板等好几个功能的翻译），这些新增**从未推送到GitHub、也从未发给过Claude**。Claude用"完整文件替换"的方式交付了两版`zh.ts`/`en.ts`（都是在滞后基线上改的），用户拿去替换本地真实文件时，把本地独有、还没同步的那一大批翻译**全部覆盖冲掉了**——界面上大批按钮/文字变回显示裸的翻译key字符串（比如`leg.switchToCompare`）。用户报告了两次才最终定位到根因（第一次报告后Claude的排查方向不对，以为是遗漏了某几个key，实际上是整份文件基线就是旧的）。

**以后但凡要动`zh.ts`/`en.ts`这两个文件，必须遵守**：
1. **不要无脑用"完整文件覆盖"交付这两个文件**，除非确认过沙盒本地版本就是用户本地最新版本。开始改之前，先问用户一句"你本地这两个文件是不是有我这边没见过的最新内容"——尤其是间隔了较长时间、或者用户提到"我这边好像还有别的改动"的时候。
2. **更稳妥的方式是改用最小化的Edit，只加/删自己这次需要改动的那几行key，不整份覆盖**，除非用户明确要求整份替换、或者用户已经把他本地当前真实的完整文件内容贴给了Claude作为基准。
3. **交付前后都要跑一遍key集合一致性检查**：用正则从两份文件里提取所有顶层key（`^\s*"([a-zA-Z0-9_.]+)":`），转成Set后取双向差集，确认zh/en两边key完全对齐（0个单边缺失）——比人工比对快得多也准得多，是这类问题最可靠的自查手段，每次改完这两个文件后都应该顺手跑一次。**2026-09-10给"持仓处置建议"功能加16个`advice.*`key时完整执行过一遍（改前687/687匹配，改后703/703匹配，0缺口），2026-09-11这16个key又随功能一起被删除，删除后同样应该跑一遍确认恢复到687/687**。**2026-09-18~19新一轮改动（见"四、11"）先删了12个`explain.action*`/`posAdvice.*`死key、后又删了16个`alert.*`/`chart.*Zone*`旧提醒key、加了3个新`alert.*`key、再删了2个`explain.attribution*`key，每一步改完都跑过一致性检查，当前稳定在743/743**。
4. **诊断"界面显示裸key"这类问题的最快方法**：全局`grep -rn "<key>" src/`，如果代码引用和翻译定义两处都搜不到，几乎可以确定是"用户本地有、Claude沙箱没有"的同步缺口，而不是这次改动引入的回归；用`curl https://raw.githubusercontent.com/lixuedenon/OptionPilot/main/<path>`拉GitHub当前内容跟本地改动前的commit做对比，可以进一步排除"是不是Claude自己的编辑动作删掉了内容"这种可能性。
5. **这两个文件不在project的GitHub同步白名单里**（见下面"GitHub同步范围滞后"的说明），project_search/project_read读到的很可能是过期版本——**关键判断一律优先直接问用户或者`curl`/WebFetch拉GitHub raw内容核实**，不要相信project工具或者沙盒本地状态的默认假设。

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
| 场景选择器（"四、6"） | ✅ 方向判断分支完成 | "待定"标签仍是占位，**按xue的决定暂时保留，等做出真内容再考虑要不要先隐藏**（2026-09-07确认，见backlog第19-b条） |
| AI策略推荐（`AIStrategyPage.tsx`，"四、7"） | ⛔ **已屏蔽（2026-09-25）**，开发预览阶段，**当前最大的未完成模块** | 首页卡片禁用+路由拦截+Edge Function服务端开关三层屏蔽，代码原样保留，见"四、7"。 四模型（Claude/GPT-4o/Grok/Gemini）分析雏形已有，但"每天跑一次Cron+存DB+用户只读缓存"这套正式架构还没搭，现在是"点一下现触发一次"的临时占位行为。**2026-09-11起，这套四模型基础设施也是未来"直接分析现有持仓"方案的候选落地位置**，见"四、10" |
| 持仓处置建议（原KB检索方案，"四、10"） | ❌ **已彻底移除，2026-09-11** | 原计划检索`position_management_kb`知识库给持仓处置建议，后端一度上线，真实测试暴露两个系统性bug后，xue权衡样本维护成本与大模型灵活性，决定放弃整个方案。前后端代码、Edge Function、数据库表均已/待删除，改为将来直接调用大模型（沿用"四、7"范式），设计尚未开始 |
| "怎么办"建议系统 / 图表提示条（`situationExplainer.ts`，"四、11"） | ✅ 分析+对比模式已统一，仅覆盖两种价差 | 按腿角色分类给建议，熊市Call价差/牛市Put价差两种形状有xue逐条审查过的540格判断表（价格区×时间段×盈亏档），驱动"解释当前情况"对话框、图表顶部提示条、图表内盈亏点颜色三处UI，三处读同一份`action`字段，不会互相矛盾。其它组合形状仍是占位文案，不显示图表提示条 |

**语言文件`zh.ts`/`en.ts`出过一次事故**（详见下面独立警示章节）——这是这个项目维护中唯一一件"一步走错会直接让用户界面大面积裂开"的事，任何时候要动这两个文件，先把警示章节读完。

**开发/交付流程约定**（Claude在沙盒里工作，没有push权限，这套流程每轮会话都适用）：
- Claude在自己维护的本地沙盒里clone仓库、改代码、跑验证，不直接操作用户的GitHub；用户明确表示**不需要Claude推送**，会自己在本地应用交付的文件、验证、`git add/commit/push`
- 验证手段：`npm run typecheck`（`tsc --noEmit -p tsconfig.app.json`，权威的正确性检查）+ `npm run build`（vite构建，**不做类型检查**，只能抓语法/打包错误）+ `npx eslint .`（代码风格/潜在问题）
- 交付方式：完整文件通过对话交付，不是diff，减少复制粘贴出错；**每个文件第一行必须是路径注释**（代码文件`// path/to/file`，markdown文件`<!-- path -->`），这是用户明确的固定要求。**当Claude只能通过间接方式（比如WebFetch转述）核实一个大文件的部分内容、没有把握完整还原全文时，应该改为交付精确的查找-替换补丁说明而不是硬造一份"完整文件"**——2026-09-11一次实践：`SimulatorPage.tsx`（1725行）通过WebFetch抓取时出现过一次上下文拼接不连贯的迹象，最终选择交付补丁指令而不是重新构造整份文件，这个判断原则值得后续会话遵守
- 用户拿到文件后自己本地替换、跑`npm run dev`验证、`git add/commit/push`
- **GitHub是真理来源**：本地沙盒副本可能跟真实仓库产生偏差（比如某次交付用户没应用、或者用户本地手动改过沙盒不知道的地方，`zh.ts`/`en.ts`就是踩过的真实例子），涉及关键判断时优先直接读GitHub实际内容核实，不要只信这份文档或者本地沙盒状态
- **GitHub同步范围滞后**：claude.ai这个project的GitHub同步源设置了文件过滤白名单，目前不是仓库全量同步——早期发现`optionChain.ts`/`option-chain` Edge Function不在名单里过，此后陆续发现`zh.ts`/`en.ts`等文件也有同样风险，`TrackedComboSection.tsx`/`SimulatorPage.tsx`/`PositionAdviceDialog.tsx`/`kbQuery.ts`等也都不在名单里。project_search/project_read的结果可能是过期快照，**遇到"这个功能是不是已经做了"这类关键判断，优先用WebFetch直接读GitHub raw内容核实**，而不是只信project工具。**2026-09-11实测：直接给WebFetch传`raw.githubusercontent.com`的文件URL，对几百行以内的文件能拿到可信的逐字内容（交叉核对过两次结果一致），但对1725行的大文件，转述用的小模型在精确复现大段行级上下文时出现过明显的拼接错误——这类大文件的精确编辑，更稳妥的做法是让用户直接贴文件内容，而不是完全依赖WebFetch的转述结果**

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

**两套数据在健康度等"展示层"计算上如何选边**（2026-09-06确立的原则，见"四、1.4"）：几乎所有派生计算都要问自己"现在到底该读哪套数据"——`isCompareMode`为true时读`trackedLegs`/`effectiveTrackedSpot`一侧（"今日组合"），为false时读`legs`/`spot`/`shifts`一侧（分析模式，跟随情景滑块）。这条分支模式（`positionHealth`/`trackedGreeks`）是这次修复后新立的范式，以后任何新加的"组合级"展示指标，默认都应该照这个模式接入两种模式，而不是像`positionHealth`曾经那样无条件只读`legs`一侧。**"怎么办"建议系统（见"四、11"）同样遵守这条原则**——`explainTrackedPositionAdvice`读`trackedLegs`侧，`explainAnalysisScenario`读跟随滑块的`legs`侧，两者2026-09-19起共用同一套按腿角色分类的核心逻辑（`buildLegAdviceSections`），不再是两套独立实现。

---

# 三、文件地图

## 顶层页面（`src/*.tsx`）

| 文件 | 大致行数 | 职责 |
|---|---|---|
| `Shell.tsx` | ~167 | 顶层路由状态机（见上）|
| `HomePage.tsx` | ~205 | 首页四张模块卡片；2026-09-06起还承载右上角「数据」下拉菜单（导出/导入/链接备份文件），从`AppHeader.tsx`搬过来的，见"四、9" |
| `App.tsx` | ~1699 | 分析模式+对比模式，核心工作区（见下方专门小节）|
| `SimulatorPage.tsx` | ~1725（**2026-09-11起因移除持仓处置建议的PAUSED注释块而略微缩短**） | 模拟账户页面，全项目第二大文件——仓位列表、开平仓、保证金展示、财报仓位面板、趋势/悔棋面板，见"四、4" |
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
- `TrackedComboSection.tsx`（~245行，**2026-09-11起因移除持仓处置建议略微缩短**）——对比模式"今日组合"整块：快照选择器（含"(估)"估算标记，见"四、3.3"）、保存按钮、开仓vs当前统计网格（股价/时间流逝/隐含波动率/持仓盈亏四列——这是全项目现在唯一一份这样的统计网格，`LegListSection.tsx`原来那份三列的重复版本已删除）、腿位列表。**健康度徽章已不在这个组件里**（2026-09-07第三轮搬去了`PayoffChart.tsx`标题栏，见下）
- `LegActionDialogs.tsx`（~159行）——leg级别弹窗集合（保存预设/清空确认/批量删除确认/丢弃追踪确认/展期/保护/对冲/决策对比/隐含现价说明），纯转发props给各自的真实弹窗组件
- `StrategyPersistenceDialogs.tsx`（~133行）——策略保存/切换/离开相关弹窗集合（预设切换确认/替换确认/离开确认/模式切换确认/保存策略对话框/管理策略对话框）
- `LegRow.tsx`（~1080行，全项目最大的单个组件，2026-09-24因下述修复略微增长）——单条腿位的编辑行，含**期权链自动填充逻辑**（见"四、1.2"）。**数值输入统一走`numberInput.ts`的`useClampedNumberField`**（`NumField`内部，2026-09-24，见该文件条目）；**张数框/情景估值/腿位盈亏三处按xue"容器尺寸不能变、不能靠滚动"的硬性要求，改成固定宽度+字号自动收缩**（张数52px→38px，情景估值/腿位盈亏改用新增的`ValueBadge`组件，56px固定宽），公共的`shrinkFontSize`收缩公式两处共用，不是各写一份

**分析模式的其他功能组件**：
- `PayoffChart.tsx`（~1000行）——到期损益图，SVG绘制，含情景滑块联动、对比模式双线叠加。标题栏股票代码旁边渲染健康度徽章和分析↔对比模式切换按钮（`positionHealth`/`modeSwitchButton`，2026-09-07第三轮从`LegListSection.tsx`/`TrackedComboSection.tsx`和`legToolbar`搬过来的，两者都是可选prop，缺省不渲染）。**Y轴刻度生成的无上限步进循环，2026-09-24修复**——`step`原来的取值在跨度超过`500×6`后固定钉死在500不再放大，极端的qty×price组合（比如张数打到超大数字）下这个循环能迭代到百万级，直接卡死浏览器；改成`step`按跨度量级动态放大（10倍递增直到满足`span/step<=6`），并加`MAX_TICKS=20`硬上限兜底，跟全项目其它到期盈亏计算（`pricing.ts`的`payoffCurvePoints`等）一样，改成不受数值量级影响的有界循环。**图表提示条/盈亏点颜色改用`alertSeverity`一个prop驱动，2026-09-19**——原来自己内部算的`getZone()`/`zoneBands`那套（按净收权利金固定比例算golden/danger/stop三档，跟"四、11"540格表各算各的、同一仓位能给出两个不一样的判断）已整个删除，改成接收`App.tsx`从`situationExplanation`里派生出的`alertSeverity?: "takeProfit"|"stopLoss"|"monitor"`，只用来决定当前盈亏点`<circle>`的填充色（三态色 vs 原有的`accent`盈亏符号色兜底），组件自己不再做任何提醒判断，见"四、11"。**仍然已知的重复实现问题**（未受本次改动影响），见"六、已知问题"第12条
- `PayoffSparkline.tsx`（~78行，2026-09-05新增）——预设悬浮框里的"到期盈亏形状"迷你曲线图，复用`pricing.ts`的`payoffCurvePoints`，不重新发明计算逻辑，见"四、2.2"
- `PnlAttributionPanel.tsx`——P/L归因面板（滑块驱动/跟踪对比两种模式）。**分析模式"解释当前情况"对话框里原本还有一段文字复述同样的价格/时间/IV贡献数字（"盈亏来源"section），2026-09-19确认是真重复后已从对话框里删除**，这个面板本身没变，现在是唯一的展示位置，见"四、11"
- `PositionHealthBadge.tsx`——组合健康度徽章。渲染位置2026-09-07第三轮搬到`PayoffChart.tsx`标题栏（股票代码旁边），组件本身没变，只是调用方从`LegListSection.tsx`/`TrackedComboSection.tsx`换成了`PayoffChart.tsx`
- `ShiftSliders.tsx`——情景滑块（现价/时间/波动率三个维度）
- `PnlHeadline.tsx`——图表区盈亏头部（日期/盈亏/净值+百分比），电脑版分析模式放在图表标签那一行
- `WinRateSim.tsx`——"胜率模拟"标签（规则控件、10批动画、结论卡片、高级分析），计算在`lib/winRateSim.ts`+`lib/winRateSim.worker.ts`，见开头版本说明
- `StockOptionMap.tsx`——"股价 vs 期权价"标签的地形图（分析模式/跟踪对比模式`tracked`两种）+走势子标签+鼠标读数；同文件导出`IvShiftSlider`（该标签下唯一的滑块）。计算在`lib/stockOptionMap.ts`（`buildMapModel`/`summarizePath`/`PATH_GROUPS`）
- `StrategyBadge.tsx`——策略名称徽章（含`dirKeyMap`，别处也在用）
- `DecisionCompareDialog.tsx`——决策对比弹窗（不动/平仓/展期三选一对比）
- `RollDialog.tsx` / `ProtectDialog.tsx` / `HedgeDialog.tsx`——展期/保护/对冲三个操作弹窗。`RollDialog.tsx`内嵌`RollComparisonChart.tsx`，见"四、1.5"（**2026-09-07下半修过一个曲线失真bug**）
- `SavePresetDialog.tsx` / `PresetPicker.tsx`（~343行）——自定义预设保存/选择；`PresetPicker.tsx`悬浮框里还渲染风险揭示`RiskDisclosure`和`PayoffSparkline`（见"四、2.2"）
- `SaveStrategyDialog.tsx` / `ManageStrategiesDialog.tsx`——保存策略/管理已存策略（含跟踪、置顶、重命名、删除）
- `DropdownMenu.tsx`——通用下拉菜单（render-prop `children: (close) => ReactNode`）
- `LockedOverlay.tsx`——锁定App.tsx整个左栏的唯一实现（两种原因：情景滑块离开原点`isExploring`、还没有有效股票代码`needSymbol`）：透明遮罩+点击处弹"请先重置"提示+键盘焦点拦截；带`data-lock-exempt`的只读区域（盈亏归因面板）点击会被转发、不受锁定。子组件不再各自处理锁定
- `Term.tsx`（2026-09-07新增）——通用"点击查看术语解释"组件，见"四、1.6"。**接入范围2026-09-07下半收窄了**——原来App.tsx标题栏净Delta/Theta/Vega/Gamma四个标签用它，随着那个展示面板整体移除，这四处也一起没了，目前只剩`EarningsIvCrashTab.tsx`的"所需保证金"一处在用
- `RollComparisonChart.tsx`（2026-09-07新增）——`RollDialog.tsx`专用的展期前/后到期盈亏对比迷你图，见"四、1.5"
- `ComboCompareSlots.tsx`（2026-09-21新增，**这份文档之前一直没收录，2026-09-24补上**）——"多方案对比"（方案B/C）UI，只在分析模式渲染。跟主combo（`LegListSection.tsx`，方案A）并列展示，每个槽位独立的腿位列表+统计（策略识别/到期盈利+盈亏平衡/归因/情景估值），"激活"哪个槽位（点击容器任意区域）决定策略库预设应用去哪个combo，也决定批量操作工具栏/复选框是否显示（未激活的槽位仍可逐条编辑，只是没有全选/批量/统一操作）。**2026-09-24修过一个跟主combo缩进不一致的对齐bug**——外层容器原来`px-3`+每个卡片自己又`p-2`两层叠加，比主combo多出十几像素，导致同一屏里B/C的"..."菜单跟A对不上；改成外层去掉横向padding、只留卡片自己一层

**财报策略专用**：
- `EarningsTabRoot.tsx`——财报标签顶层导航（IV Crash vs 方向判断 vs 阈值档位选择）
- `EarningsIvCrashTab.tsx`——90%档IV Crash完整开仓流程UI
- `EarningsPositionsPanel.tsx`（~344行）——财报仓位专属管理面板

**其他**：
- `ErrorBoundary.tsx`——React错误边界，每个Shell view都包了一层
- `LanguageSwitcher.tsx`——中英文切换
- `SimStatsPanel.tsx`（2026-09-07新增）——模拟账户交易统计面板，纯展示组件，见"四、4.5"

## `src/components/dialogs/`（小型弹窗集合，`index.ts`统一导出）

`HelpPanel.tsx`、`ImpliedSpotInfoPanel.tsx`、`MarginErrorDialog.tsx`、`ConfirmClearDialog.tsx`、`ConfirmBulkDeleteDialog.tsx`、`ConfirmSaveTrackedDialog.tsx`、`ConfirmSnapshotDialog.tsx`（预设切换和模式切换两处复用同一个组件）、`ConfirmReplacePresetDialog.tsx`、`ConfirmLeaveDialog.tsx`、`ConfirmResetAccountDialog.tsx`——全是纯展示型的小确认框，逻辑都在调用方。

`AlertCard.tsx`不是确认框，是图表下方常驻的建议提示条——**2026-09-19整个重写**，见"四、11"：原来接收`AlertInfo`（`{zone, pnl, netCredit, capturedPct, days, stock, maxProfit, maxLoss}`，自己在内部按netCredit百分比算文案），现在只接收`{severity: "takeProfit"|"stopLoss"|"monitor", body: string} | null`，三态三色渲染，文案直接来自"四、11"540格表的`advice`原文，不再自己拼数字；`severity`为对应态时展示，`alert`为`null`时不渲染（三态之外——HOLD/WAIT，或不支持的组合形状——都是`null`）。

`HelpPanel.tsx`是个例外，2026-09-06重构成了模块感知组件（不再是单一的通用说明文档），详见"四、9"。**2026-09-07下半新增持久化"不再显示"**：`gate`变体的确认按钮旁多了一个复选框，勾选后写入`localStorage`（`optionpilot.guideDismissed.<moduleId>`），该模块的首次引导以后永久不再自动弹出（除非清了浏览器数据）；同时导出了`isGuideDismissed(moduleId)`供`App.tsx`/`SimulatorPage.tsx`的初始state判断，避免"先闪一下再关掉"。`variant="info"`（header常驻的"使用说明"按钮）不受影响，永远可以手动重新打开同样的内容。

## `src/hooks/`

- `useAutoSync.ts`——文件系统自动同步hook（配合`lib/autoSync.ts`）
- `useCustomPresets.ts`——自定义预设的加载/增删状态封装
- `useSavedStrategies.ts`——已存策略列表的加载/增删状态封装
- `useLegEditing.ts`——开仓组合单腿的增删改、批量选择/批量屏蔽/批量删除、展期/保护/对冲/比较四个弹窗的目标状态，以及`moveLeg`/`moveTrackedLeg`两个顺序调整函数。从`App.tsx`拆出，接收`{legs, setLegs, trackedLegs, setTrackedLegs}`。展期/保护/对冲三个handler（`handleRoll`/`handleProtect`/`handleHedge`）额外接受一个`source: "legs" | "tracked"`参数（默认`"legs"`），决定操作目标是开仓组合还是今日组合——2026-09-06修复前这三个handler无论从哪调用都写死操作`legs`，今日组合那边点展期/保护/对冲实际改的是开仓组合，见"四、3.6"
- `useComboAnalytics.ts`（~271行）——`trackedResult`（今日组合定价+`netPremium`/`shiftedValue`/`change`）、`effectiveDaysElapsed`等对比模式派生计算的封装

## `src/lib/`（核心业务逻辑，无UI）

**定价与组合计算**：
- `types.ts`——`Leg`/`Shifts`/`GreekBreakdown`等核心类型定义。`Leg`新增可选字段`openLegId?: string`（2026-09-06），只在`trackedLegs`的腿上有意义，见"四、3.6"
- `bs.ts`——Black-Scholes定价模型+希腊字母
- `pricing.ts`（~567行，核心算法文件）——`priceCombo`（组合定价+归因，返回的`ComboResult.breakdown`含完整的组合级delta/gamma/theta/vega——**这份计算本身2026-09-07下半之后仍然保留**，只是App.tsx里显示这四个数字的面板被移除了，见"四、1.4"）、`payoffCurvePoints`、`probabilityOfProfit`、`findBreakevens`、`maxProfitLoss`（**注意：内部按固定±50%现价窗口扫描，这个窗口大小对很多策略会失真——2026-09-10"持仓处置建议"止损/止盈信号bug就是这个教训的来源，该功能本身已移除，但这条关于`maxProfitLoss()`本身的教训仍然有效，见"五、16"**）、`pnlAtExpiry`（**内部对"多到期日组合"有特殊处理**——不同到期日的腿，用最早的到期日作horizon，horizon之外还没到期的腿用Black-Scholes按剩余天数估值而不是直接按内在价值算，这是为了让真正的日历/对角价差算出正确的到期盈亏，见"四、1.5"里`RollComparisonChart`踩过的坑）、`impliedVol`/`impliedSpotFromPremiums`、`attributePnl`（P/L归因）、`classifySpotOnCurve`（判断某现价在payoff曲线上是"接近峰值/盈利区间/已越过盈亏平衡点"，供模拟账户"复盘"面板用）等。**`RATE`（0.05）和`POP_DRIFT_RATE`（0）是两个刻意分开的常量，不要合并**（2026-09-06）：`RATE`是喂给Black-Scholes定价本身的无风险利率，这个必须是真实的无风险利率，改了会导致所有腿位定价错误；`POP_DRIFT_RATE`只用在`probabilityOfProfit`的对数正态分布漂移项，回答的是"到期盈利的真实世界概率"这个完全不同的问题，按xue的决定统一用零漂移（详细理由见本节末尾历史记录，未变动）
- `legRoles.ts`——腿位角色解释（这条腿在组合里扮演什么角色，供逐条腿展示用）
- `legFactory.ts`——`uid`/`blankLeg`/`PRESET_DTE_SET`几个创建腿位用的小helper，`asOpeningLeg(leg, newId)`——把一条腿克隆成一条新的开仓组合腿，同时去掉`openLegId`字段，见"四、3.6"
- `matchStrategy.ts`（~139行）——从一组腿位反推策略名字（含"窄体铁鹰"/"玉蜥蜴"两种四腿/三腿结构的区分识别，见"四、2.3"）。**⚠️返回的是`item.name.zh`（中文显示名），不是`item.name.en`，不管当前UI语言是什么**——这是这个文件一直以来的行为，以后任何新代码要用这个函数的返回值去匹配别处按英文命名的数据，都要先做一次中英文映射，不能想当然假设一致（2026-09-10"持仓处置建议"功能就在这上面踩过坑，该功能虽已移除，但`matchStrategy()`本身还在被策略徽章等其它地方使用，这条教训对未来任何类似用途仍然有效）
- `positionHealth.ts`——组合健康度评分（四维度各25分），**调用方需要按当前模式传入对应的legs/spot/breakdown**，见"四、1.4"
- `decisionCompare.ts`——决策对比的核心计算（不动/平仓/展期三分支）
- `situationExplainer.ts`（~900行，2026-09-14起大幅扩充，**之前的版本此文档一直没收录，属于文档滞后**）——"解释当前情况"对话框+图表提示条的全部文案逻辑，`explainAnalysisScenario`（分析模式）/`explainTrackedPositionAdvice`（对比模式）两个导出入口，详见"四、11"
- `bearCallSpreadTable.ts` / `bullPutSpreadTable.ts`（各约540个条目，2026-09-18新增）——熊市Call价差/牛市Put价差专用的审查表：5个价格区×9个时间段×12个盈亏档，每格`[action, desc, advice]`三元组。详见"四、11"

**策略库/预设**：
- `savedStrategies.ts`（~293行）——`SavedStrategy`/`TrackedSnapshot`数据模型+CRUD（localStorage存储），`TrackedSnapshot`新增`estimated?: boolean`字段，新增`backfillTrackedSnapshots()`自动回填函数，见"四、2.1"和"四、3.3"。**这张表会随时间无上限增长**（每个交易日一条快照，从不清理），见"四、4.4"容量隐患说明。**2026-09-25新增`serializeTrackedLegs(ls)`**——只按腿位内容算指纹（不含spot/shifts/openingAt），驱动`App.tsx`里`trackedDirty`的派生计算，见"四、3.1"
- `presets.ts`（~786行）——内置策略预设库（42个模板，含`RiskLine`/`RiskSeverity`风险揭示数据），见"四、2.2"
- `customPresets.ts`——用户自定义预设的类型+存储
- `historicalBackfill.ts`（~85行，2026-09-06新增）——历史K线拉取+flat-vol理论重定价的共享逻辑，从`simAccount.ts`抽出，供模拟账户的`Timeline`回填和策略库的`backfillTrackedSnapshots`共用，避免第三份近似实现，见"四、3.3"

**期权链/行情**：
- `optionChain.ts`（~192行）——客户端期权链库：`getOptionChain`/`peekResolvedChain`/`fetchLegPremium`/`nearestStrikeToSpot`/`nearestStrikeQuote`/`resolveFromCache`，调用`option-chain` Edge Function，带promise级缓存
- `useStockQuote.ts`——实时现价hook+`fetchSpotPrice`
- `winRateSim.ts` / `winRateSim.worker.ts`——胜率模拟计算层（走势生成、规则出场、统计、批次稳定性、盈亏平衡波动率/安全垫）和后台线程
- `historicalVolatility.ts`——历史波动率计算（`computeHV`）、`fetchHistoricalSeries`（带10分钟内存缓存）/`realizedVolSince`+ IV/HV比值判断（`computeIvHvNote`：`sellRich`/`buyCheap`/`stillRich`三分类）
- `recentSymbols.ts`——最近查询过的标的记录（localStorage）

**数值输入**：
- `numberInput.ts`（2026-09-24新增，**这份文档之前一直没收录这个文件**）——`NumberInputRule`接口 + `NUMBER_RULES`（price/premium/qty/shares/capital/percent1dp各字段的min/max/小数位规则）+ `clampToRule`/`clamp`/`blockInvalidNumberKey`/`formatNumForDisplay`，以及核心的**`useClampedNumberField(value, rule, onChange)`hook**——修复"输入多位数就卡死"bug的权威实现：受控数值输入框如果每次keystroke都直接`onChange(clampToRule(...))`，清空框准备重打时会瞬间被clamp回`rule.min`，形成打字-弹回的死循环。这个hook把"框内正在打的字符串"（`text`，本地state）和"提交给外部的、真正clamp过的数值"（只在`onBlur`或已经是语法完整数字时才`onChange`）解耦，全项目所有同类数值输入框（`LegRow.tsx`的`NumField`、`HedgeDialog.tsx`/`RollDialog.tsx`/`ProtectDialog.tsx`的行权价/权利金字段）统一改用这一个hook，不再各自重复实现，同一时刻只有一份权威逻辑（见"五、19"同一条原则）

**日期/工具**：
- `dateUtils.ts`——`todayISO`/`dateFromDte`/`dteFromDate`/`nearestFridayDte`/`formatDateInput`/`parseDateInput`/`daysSince`/`daysBetweenLocalDates`/`calendarDaysSince`——统一的日历天数（而非24小时周期）算法，多处历史bug修复都落在这个文件的正确使用上，改动前先确认用的是这几个helper而不是自己手写日期运算
- `miniMarkdown.tsx`——极简markdown渲染（AI策略页面用）

**模拟账户**：
- `simAccount.ts`（~492行）——`SimPosition`/`SimAccount`/`PositionSnapshot`数据模型+CRUD、`computeMarginUsed`/`computeAvailableCapital`/`checkMarginForOpen`（保证金检查）、`analyzeBestExit`（悔棋模式用）、`computeCostBasis`/`computeMarkValue`（开仓/当前市值计算，符号约定：净收权利金为负、净付权利金为正——2026-09-11确认过这个约定，跟`pricing.ts`的`priceCombo().netPremium`一致）、`backfillSnapshots`（趋势面板回填，2026-09-06起复用`historicalBackfill.ts`的共享逻辑，自身不再维护一份历史K线拉取+重定价实现）。**这张表同样会随时间无上限增长**，见"四、4.4"
- `margin.ts`（~278行）——`computeComboMargin`，动态保证金插值算法（见"四、4.2"）
- `simStats.ts`（2026-09-07新增）——`computeSimStats`，从已平仓仓位算胜率/盈亏比/最大回撤/连胜连亏，见"四、4.5"

**财报策略**：
- `earningsStrategy.ts`（~204行）——三组结构定义、期权链取值、仓位大小反推、聚合预览
- `earningsClosing.ts`——平仓阶段判断逻辑（近期组2小时窗口、中远期组三分支）

**场景引擎**：
- `scenarioEngine.ts`（~697行）——固定查表式场景推荐（`SCENARIO_RULES`覆盖30种桶组合）、`computeBucketBounds`、`rankPresetsForScenario`

**功能开关**：
- `featureFlags.ts`（2026-09-25新增）——`AI_MODULE_ENABLED`（当前`false`），临时屏蔽模块时只改这一处，见"四、7"

**数据备份/同步**：
- `dataTransfer.ts`——导出/导入整个应用数据（`ExportData`，含策略库/自定义预设/最近标的/模拟账户，version 1→2 演进过）。**2026-09-07下半新增`collectBackupPayload()`**——把"从localStorage六个key读出并拼成`ExportData`"这段逻辑收敛成一个导出函数，`exportAllData`和`autoSync.ts`的`autoSyncWrite`都改成调用它，不再各自维护一份一模一样的读取代码，见"四、4.4"
- `autoSync.ts`——File System Access API自动同步到本地文件（IndexedDB存文件句柄）。写入内容现在来自`dataTransfer.ts`的`collectBackupPayload()`，不再是自己手写的第二份序列化代码

## `src/i18n/`

`I18nContext.tsx`（`useI18n()` hook + `t(key, vars?)`，插值用`{varName}`占位符+`Record<string, string|number>`）、`translations.ts`、`locales/zh.ts`+`locales/en.ts`（各~745行，键值对翻译文件，**改动前必读上面的"语言文件维护须知"独立章节**）。**当前key总数879/879（zh/en对齐，2026-09-30）**，见"四、11"里这一轮的具体增删明细。

## `supabase/`

**Edge Functions**（`supabase/functions/`）：
- `stock-quote/index.ts`——实时现价代理
- `option-chain/index.ts`——期权链代理（Yahoo Finance `v7/finance/options`，cookie+crumb认证，服务端共享缓存`option_chain_cache`表15分钟TTL）
- `historical-prices/index.ts`——历史价格代理（同时返回`opens`/`closes`/`timestamps`，供趋势面板和`historicalBackfill.ts`回填用，只保留2个月窗口）
- `market-context/index.ts`——市场大盘背景数据（AI策略推荐用）
- `strategy-analysis/index.ts`——AI策略分析（对应`AIStrategyPage.tsx`的后端，目前是开发预览阶段，见"四、7"）
- `_shared/`——`bs.ts`（服务端BS定价副本）、`deltaMatch.ts`、`buildPrompt.ts`、`technicalIndicators.ts`

**数据库迁移**（`supabase/migrations/`）：`create_option_chain_cache.sql`、`create_user_data_tables.sql`。**`20260910161520_create_position_management_kb.sql`已被`20260911000000_drop_position_management_kb.sql`回滚**（"持仓处置建议"功能移除，见"四、10"）——历史迁移文件本身保留不删（migration history的一贯做法），但对应的表已经不存在了，接手时不要以为这张表还在。

⚠️ Edge Function改动需要用户手动`supabase functions deploy <name>`部署，Claude在沙盒里改的代码不会自动生效到线上；删除Edge Function同理需要手动`supabase functions delete <name>`。

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
- `PnlAttributionPanel.tsx` + `pricing.ts`的`attributePnl`：把盈亏拆成"哪个维度贡献了多少"，滑块驱动模式和跟踪对比模式两种数据源。**这是这份归因数字唯一的展示位置**——"解释当前情况"对话框里原本重复展示同一组数字的"盈亏来源"文字段落，2026-09-19已删除，见"四、11"
- **组合健康度**（`PositionHealthBadge.tsx` + `positionHealth.ts`）：四维度各25分——到期盈利概率(POP)、距盈亏平衡点距离、临近到期的Gamma风险、每张合约平均Delta归一化。健康度现在**按当前所在模式选边**（`App.tsx`的`positionHealth`这个`useMemo`）：分析模式下用`activeLegs`/`spot`/`shifts`算（跟随情景滑块，因为POP/盈亏平衡距离/DTE风险三项本来就用`buildShiftedLegs`跟随滑块），对比模式下改用`activeTrackedLegs`/`effectiveTrackedSpot`（零情景偏移，今日组合，因为对比模式滑块本来就是冻结遥测）。**这是2026-09-06修的一个设计错位**——在这之前，对比模式复用分析模式同一个健康度徽章，但看到的数字实际算的是"开仓组合"，不是"今日组合"，跟对比模式"管理一个正在持有的仓位"的定位不符。因为这个计算现在直接依赖`activeTrackedLegs`/`effectiveTrackedSpot`（这两个值本来就会随选中的快照变化），切换不同快照会自动得到不同的健康度，不需要额外的per-snapshot存储
- **组合级Greeks（净Delta/Theta/Vega/Gamma）计算依然存在，但展示面板已移除**（2026-09-07下半，xue的决定）：`pricing.ts`的`priceCombo()`用有限差分算出完整的组合级`delta/gamma/theta/vega`，这份`result.breakdown`（分析模式）/`trackedGreeks.breakdown`（对比模式）**仍然是`positionHealth`的Gamma风险因子和Delta归一化因子的真实数据来源，不能删**。**以后如果要重新展示这四个数字，数据已经现成，只需要重新加回显示层**
- **"到期结果"类指标默认不跟随情景滑块**（maxProfit/maxLoss、POP、健康度评分是刻意的例外）——这条设计原则本身没变，见"五、核心设计原则"

#### 1.5 展期前后风险对比图（`RollComparisonChart.tsx`）

`RollDialog.tsx`新增一个`allLegs: Leg[]` prop（调用方传入这条腿所在的完整组合），对话框内部用`useMemo`算出"展期前"和"展期后"两个组合，渲染进`RollComparisonChart.tsx`（灰色虚线=展期前，蓝色实线=展期后）。**故意没有复用`PayoffChart.tsx`**——那个组件耦合了对比模式健康度/情景滑块修正等一堆无关状态。

**⚠️ 曲线失真/看似"没变化"的bug，2026-09-07下半修复**：单腿、只挪日期不动行权价的纯展期，两条曲线逐点完全相等是数学上正确的行为（到期盈亏图这个维度天生看不出"只是换了到期日"这种变化），加了`roll.compareSameShapeNote`提示文案避免用户误以为图表坏了。多腿组合只展期其中一条腿到不同到期日时，`pnlAtExpiry`的"多到期日组合"特殊处理（专为真正的日历/对角价差设计）会被临时构造的展期草稿意外触发，导致"展期后"那条曲线用BS理论价而不是到期内在价值计算，出现非单调的诡异形状——修复是把图表专用草稿腿的`dte`钉死在原始值，只让`strike`/`premium`反映变化，绕开"多到期日"分支。**这是"任何临时构造的、腿位到期日碰巧不一致的草稿组合，如果不是真的要用多到期日定价，必须主动对齐dte"这条教训的来源**，见"五、15"。

### 1.6 术语悬浮提示（`Term.tsx`）

通用组件：`<Term titleKey="glossary.xxx" descKey="glossary.xxxDesc">文字</Term>`——点击弹出popover显示术语标题+一行解释。用点击而不是CSS `:hover`，触屏设备上行为跟桌面端一致（**这个"用点击不用hover"的先例，值得"六、backlog"里手机适配那一条参考**——当时就是为了让触屏也能用同一套交互）。**当前接入范围**：`EarningsIvCrashTab.tsx`财报预览网格里的"所需保证金"标签——目前唯一接入点。

### 1.7 决策对比（`DecisionCompareDialog.tsx` + `decisionCompare.ts`）

针对单条腿，用真实期权链数据对比"不动/平仓/展期"三种结果的盈亏。**没有"对冲"这第四个对比分支**，属于backlog（见"六"）。**"决策比较"弹窗里的展期分支是硬编码+30天**，见"六、已知问题"。

### 1.8 窄窗口下的行布局收缩（`LegRow.tsx`的`useNarrowLegRow`，2026-09-25）

`LegRow.tsx`每一行（复选框+腿号+方向/类型切换+张数/行权价/到期日/权利金四个输入框+情景估值/腿位盈亏两个徽章+"..."菜单）里所有列都是`shrink-0`——这是故意的（2026-09-24就定下的规则：数字不能因为容器变窄被截断或滚动查看，只能靠字号自动收缩，`shrinkFontSize`/`NumField`/`ValueBadge`），但列本身的固定宽度不会跟着变窄。窗口比设计基准（约1440px宽的笔记本）更窄时，这一整行会比左侧面板容器更宽，被挤到换行，整体布局跟着乱——xue反馈"大显示器上正常，换到小一点的笔记本上输入框内容显示不下、被迫换行导致结构错乱"就是这个。

**轻量修复**（跟xue确认过方向，不是"六、22"移动端适配那种要整体重新设计核心组件布局的量级）：新增`useNarrowLegRow(breakpointPx = 1440)`——用`matchMedia('(max-width: 1440px)')`监听窗口宽度，返回一个`narrow: boolean`。`narrow`为`true`时：
- 行容器的`gap-1 px-2`收窄到`gap-0.5 px-1.5`
- 张数38→30px、行权价52→44px、权利金76→62px、到期日框84→70px（正股腿的买入价72→60px、股数56→46px）
- 情景估值/腿位盈亏两个`ValueBadge`56→46px
- `ToggleBtn`（方向/类型切换按钮）新增`compact?: boolean` prop，`px-2`收窄到`px-1`

窄宽度收缩 + 已有的字号自动收缩两层叠加，让整行在更窄的窗口下也能不换行地放进去。**阈值1440px是常见笔记本原生分辨率的粗略估计，不是精确计算出来的**——如果后续发现某个具体分辨率下还是不够，直接调整这个数字或者上面各列收窄后的宽度即可，不需要改动`useNarrowLegRow`机制本身。`useNarrowLegRow`目前只在这一个文件里用（每个`LegRow`实例各自注册一个`matchMedia` listener，一屏最多10条腿位，代价可忽略）；如果以后有其它组件也需要同样的窄窗口判断，再考虑提出去做成共享hook。

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

（核心机制未变动，详见文件地图与前述章节引用：三条进入路径、模式互相切换、保存快照/保存策略组合、快照自动回填、开仓组合↔今日组合腿位对应关系`openLegId`。"解释当前情况"内容2026-09-19起跟分析模式共用同一套逻辑，见"四、11"。完整细节保留在本文档历史版本描述中。）

### 3.1 "有没有未保存改动"的判断——`trackedDirty`（2026-09-25改成派生计算）

判断"今日组合（`trackedLegs`）相对上一次保存/加载有没有改动"，驱动两处提示：①"保存追踪快照"按钮的`disabled`；②切换/离开对比模式前"要不要先保存"的确认框（`handleSwitchToAnalysis`的`trackedDirty && source !== "current"`分支、`clearAllLegs`、`App.tsx`的`requestLeave`）。

**`trackedDirty`不是手动维护的state**（2026-09-12~2026-09-25那段时间是，已改掉）——`App.tsx`里是一行派生计算：
```
const trackedDirty = trackedLegs !== null && serializeTrackedLegs(trackedLegs) !== trackedBaseline;
```
`serializeTrackedLegs`（`savedStrategies.ts`）只按腿位内容算一份指纹字符串（跟`serializeStrategyState`共用同一份leg级别字段清单，但不含symbol/shifts/openingAt），`trackedBaseline`是`App.tsx`的一个`string | null` state，记录"此刻视为已保存"那一份`trackedLegs`的指纹。任何真正改了`trackedLegs`内容的地方（展期/保护/对冲确认、逐条编辑、勾选/关闭/移动、换标的后的行权价重映射）**不需要**额外调用任何"标脏"的setter——这些地方本来就在调`setTrackedLegs`，派生判断会自动感知。只有"此刻应该视为已保存"的几个地方（`saveTrackedSnapshotTo`保存成功后、`handleTrack`/`handleSwitchToCompare`/`handleSelectSnapshot`进入/切换对比模式或选中某个快照时、`applyPreset`/`doClearAll`清空trackedLegs时）需要显式调用`setTrackedBaseline(serializeTrackedLegs(刚生效的trackedLegs))`（清空成null时传`null`）。

**为什么不含`trackedSpot`**：`trackedSpot`会随实时报价轮询（`App.tsx`的quote effect）每隔几秒自动刷新一次，如果指纹里也带上它，用户完全没编辑任何腿位也会因为股价自然波动被判定成"有未保存改动"，反而制造新的误报——跟不该把它纳入是同一类考量。

**这次修复的bug**：xue反馈"对比模式保存了快照之后，切换到分析模式（左上角下拉）仍然会问是否保存，确认了会存一份一模一样的重复快照"。旧的手动flag写法里，`useLegEditing.ts`（展期/保护/对冲/勾选/关闭/移动六处）和`useStrategyOrchestration.ts`的`updateTrackedLeg`各自调用`setTrackedDirty(true)`，任何一处的调用时机跟`trackedLegs`真实是否变化不完全对应，这个flag就可能跟真实内容脱节而没人能一眼看出是哪一处。改成派生计算后，这类bug整个类别都不再可能发生——`trackedDirty`不可能跟`trackedLegs`真实内容不一致，因为它就是现场比较出来的。

同一轮顺带修了logo点击的对称bug：`AppHeader.tsx`以前对`isCompareMode`单独分支，点logo直接`onBackHome?.()`，完全不检查`trackedDirty`，未保存的持仓编辑会被无声丢弃。现在退出图标点击统一调用`onRequestLeave`，`App.tsx`的`requestLeave`内部按`isCompareMode`分两条路径处理（跟踪对比模式看`trackedDirty`并复用`clearAllLegs`已经在用的`ConfirmSaveTrackedDialog`，一个`pendingTrackedLeaveHome` ref区分这次答完该走`onBackHome`还是`doClearAll`；分析模式走"3.2"下面提到的A/B/C逐一确认队列），`AppHeader.tsx`不再自己判断该不该提示。

### 3.2 退出/切换分析模式前的"逐一提示"（多方案对比A/B/C，2026-09-24）

跟3.1是两个不同层面的"有没有改动"判断——3.1管的是"今日组合"（跟踪对比模式），这一节管的是"多方案对比"（分析模式下的A/B/C三个候选方案，`ComboCompareSlots.tsx`/`useCompareSlots.ts`），退出图标点击时的行为：**打开的对比方案里，没有任何改动的不提示，有改动的逐一提示保存**（xue的明确要求）。

机制：`CompareSlot`（`useCompareSlots.ts`）新增`baseline: string`字段（`serializeSlotLegs(legs)`，跟`serializeTrackedLegs`同一种"只按leg内容算指纹"的思路），`isSlotDirty(slot)`现算比较；`addCompareSlot`/`applyPresetToSlot`/`applyStrategyToSlot`在创建/加载时设置baseline，`markSlotSaved(slotId)`在保存成功后更新baseline，逐条编辑（`updateCompareSlotLeg`等）故意不碰baseline（只有加载/保存才算"新的已保存基准"）。

`App.tsx`的`requestLeave`（分析模式分支）一次性算出当前有哪些combo脏了（0=A/主combo，用`canSaveStrategy`；1/2=`compareSlots[0]/[1]`，用`isSlotDirty`），全干净直接`onBackHome`，否则把脏combo的索引灌进`leaveQueue` state，弹出队首那个的确认框（`ConfirmLeaveDialog`，标题旁带`comboLabel`——"方案A/B/C"——和`remainingCount`——"还有几个待确认"，避免看起来像同一个提示弹了两次）。`advanceLeaveQueue()`在队首那个被处理完（跳过不保存，或保存成功）后调用，队列空了才真正`onBackHome`。"保存"分支会临时把`activeComboIndex`切到目标combo（B/C时），让`SaveStrategyDialog`读到正确的槽位。

## 4. 模拟账户（`SimulatorPage.tsx` + `simAccount.ts`）

（本节内容未变动：动态保证金、趋势面板/悔棋模式、数据备份/同步容量隐患评估、仓位管理提醒/交易统计面板。2026-09-07后无功能性变化，2026-09-11随"持仓处置建议"移除，`SimulatorPage.tsx`里的相关PAUSED注释块被清除，不影响其它逻辑。）

## 5. 财报IV Crash策略（端到端）

（本节内容未变动，见前述章节：三组结构、平仓规则、`earningsStrategy.ts`/`earningsClosing.ts`实现、明确搁置的部分。）

## 6. 场景选择器（`ScenarioSelectorPage.tsx` + `scenarioEngine.ts`）

（本节内容未变动，见前述章节。）

## 7. AI策略推荐（`AIStrategyPage.tsx`）——开发预览阶段，2026-09-25起屏蔽

**屏蔽状态（2026-09-25，xue的要求："先屏蔽掉，不让人使用"）**——重新开放时几层都要打开：
1. **前端开关**`src/lib/featureFlags.ts`：`AI_MODULE_ENABLED = false`。唯一的前端开关位置，不要在别处另加判断。
2. **首页卡片**（`HomePage.tsx`）：`ModuleCard`新增`disabled?: boolean`字段（跟只控制徽章的`comingSoon`分开），AI卡片`disabled: !AI_MODULE_ENABLED`——卡片仍然显示（"规划中"徽章、半透明、`cursor-not-allowed`），按钮`disabled`点不进去。**刻意没有整个隐藏**，遵守"五、8"。
3. **路由拦截**（`Shell.tsx`）：`handleSelectModule`里`"ai"`分支加了`AI_MODULE_ENABLED`判断，关闭时直接忽略、留在首页。
4. **服务端开关**（`supabase/functions/strategy-analysis/index.ts`）：OPTIONS预检之后、任何数据拉取/模型调用之前，`Deno.env.get("AI_ANALYSIS_ENABLED") !== "true"`就返回503。**这一层才是真正防花钱的**——anon key打包在前端，任何人都能绕过界面直接请求这个函数。默认（没设这个secret）就是屏蔽状态，需要`supabase functions deploy strategy-analysis`部署后生效。重新开放：`supabase secrets set AI_ANALYSIS_ENABLED=true`（不用重新部署）。

`AIStrategyPage.tsx`、`strategy-analysis`其余代码、`_shared/buildPrompt.ts`等全部原样保留。

（本节内容未变动，见前述章节：当前最大的未完成模块，每日Cron+DB缓存架构还没搭。**2026-09-11新增待办**：这套四模型基础设施是未来"直接调用大模型分析现有持仓"方案的候选落地位置——见下面"四、10"——设计时可以考虑是否跟"新开仓策略推荐"共用同一套模型调用/展示基础设施，还是做成独立的第二个入口，这个还没决定。）

## 8. `App.tsx`内部结构（拆分现状）

（本节内容未变动，见前述章节：已拆出的六个子组件+`useLegEditing.ts`，故意没拆的策略管理handler集群+计算useMemo集群，TDZ风险提醒。）

## 9. 模块使用说明书 + 首页数据管理

**分享备份 + 7天备份提醒（2026-09-26，`dataTransfer.ts` + `HomePage.tsx`）**：手机上"链接备份文件"（File System Access API）不可用，iOS Safari还会清空7天未访问网站的localStorage，所以加了手机友好的备份方式。`shareBackup()`用Web Share API调起系统分享面板（选邮件=附件发到自己邮箱，也可选微信/网盘/存储到文件），不经过服务器；浏览器不支持分享文件时退回普通下载。**分享的文件是`.txt`/`text/plain`（内容仍是同一份JSON）**——Chrome的Web Share文件类型白名单不含`application/json`；导入入口因此同时接受`.json`/`.txt`。`markBackedUp()`在导出下载、分享成功、`autoSyncWrite`写文件成功时记录`optionpilot.lastBackupAt`；`needsBackupReminder()`在有用户数据且距上次备份/上次"稍后提醒"超过7天时为true，首页显示提醒条（"分享备份"或"导出数据" + "稍后提醒"）。"数据"菜单里的"分享备份"只在`canShareBackup()`为true时出现（手机基本都有，部分桌面浏览器没有）。⚠️ iOS上"添加到主屏幕"的应用和Safari里的网页**存储是分开的**，用户第一次从Safari换到主屏幕图标时，需要在Safari里导出、在主屏幕应用里导入一次。

（本节内容未变动，见前述章节：`HelpPanel.tsx`按模块拆分、gate/info两种variant、"不再显示"持久化、首页「数据」下拉菜单。）

## 10. 持仓处置建议——已废弃（原KB检索方案，2026-09-10上线，2026-09-11移除）

**这一节只做简短回顾，完整的设计过程、决策记录、两个真实bug的详细技术分析保留在已归档的项目文档`claude/retrieval-feature-design.md`和`claude/position-management-kb-status.md`里（两份文档顶部都加了归档说明）——需要查历史细节时去读那两份，不在这里重复。**

**注意跟"四、11"的区别**：这一节说的是2026-09-10~11那次**检索1170条人工样本**的方案，已彻底放弃；"四、11"是2026-09-14起另起的**规则表驱动**方案（不检索样本，直接按腿角色+540格审查表判断），两者是完全不同的技术路线，"四、11"不是这一节"未来方向"里说的"直接调用大模型"那个方向（那个方向仍未开始）。

**做过什么**：2026-09-10上线过一版——对比模式"今日组合"和模拟账户每个持仓行各一个"持仓处置建议"按钮，点开检索`position_management_kb`知识库（1170条人工审核过的持仓处置案例，纯精确匹配`strategy`+`leg_count`+`direction`+`situation_tag`四级降级过滤，不用embedding）里最接近的案例展示建议。真实测试中发现并修复了两个系统性bug：①`matchStrategy()`返回中文策略名导致策略精确匹配从未生效（改名映射表修复）；②止损/止盈信号判断用的`maxProfitLoss()`固定±50%扫描窗口对约45%（19/42）内置预设产生"假封顶"，导致信号失真（改成宽窗口复扫自动检测+权利金倍数兜底判断修复）。修复后xue提出建议呈现格式需要重新设计（数字摘要+分类结论），期间前端两个入口按钮暂停。

**为什么放弃**：2026-09-11，xue权衡"样本积累+维护成本"（1170条样本、schema/受控词表定型、"零市场叙事"清理规则、后续每新增一个场景都要补样本）对比"直接调用大模型的灵活性"（不需要预先覆盖每种场景组合，能针对具体持仓做更细致的推理），认为检索方案投入产出比不划算，决定**整个方案废弃，不是暂停**。

**已移除的东西**：`src/lib/kbQuery.ts`、`src/lib/kbStrategyMeta.ts`、`src/components/PositionAdviceDialog.tsx`三个文件整个删除；`TrackedComboSection.tsx`/`SimulatorPage.tsx`里原本`PAUSED`的按钮/弹窗代码块（之前是注释暂停，这次是整段删除，不再保留注释）；`App.tsx`里专为这个按钮加的`breakevens`透传prop；`zh.ts`/`en.ts`里的16个`advice.*`翻译key；`supabase/functions/kb-retrieve/index.ts`Edge Function（连带需要手动`supabase functions delete kb-retrieve`下线）；`position_management_kb`数据库表（新增`20260911000000_drop_position_management_kb.sql`迁移回滚，历史创建迁移文件本身不删）；`scripts/import-kb-to-supabase.mjs`一次性导入脚本。**1170条KB样本源数据（jsonl文件）本来就存放在仓库外的用户本地目录，不受这次代码清理影响，删不删由xue自己决定**。

**值得带去下一个方案的东西**：`computePositionSignals()`风格的本地信号计算（DTE、距盈亏平衡点距离、浮亏/浮盈相对开仓权利金的倍数）——这些是确定性、零成本、不会让大模型瞎编数字的"事实依据"，不管未来用什么AI方案分析持仓，都值得算好了喂给模型当上下文，而不是让模型自己去猜这些数字。这部分逻辑已经随`kbQuery.ts`一起删除，但设计思路值得在下一版方案里重新实现。

**未来方向（2026-09-11，尚未设计）**：将来想直接调用大模型分析现有持仓给处置建议，候选落地位置是复用"四、7"AI策略推荐的四模型（Claude/GPT-4o/Grok/Gemini）基础设施。设计时要留意xue对KB样本提过的硬性要求（零市场叙事、不主动判断支撑压力位强弱）在换成大模型之后不会自动继承，需要在prompt设计和测试里重新落实，这个约束换个技术方案不代表可以放松。**这个方向截至本次更新（2026-09-19）仍未开始**——"四、11"是一条独立的、规则表驱动的路线，不是这个方向的落地。

## 11. "怎么办"建议系统 / 图表提示条（`situationExplainer.ts` + `bearCallSpreadTable.ts` + `bullPutSpreadTable.ts`，2026-09-14起，2026-09-18~19本轮重点）

这是当前"解释当前情况"对话框（分析模式情景滑块下方"解释当前情况"按钮、对比模式今日组合区域）背后的核心逻辑，也是图表顶部提示条（`AlertCard.tsx`）和图表内当前盈亏点颜色的唯一数据来源。**跟"四、10"已废弃的KB检索方案是两条完全不同的技术路线**，不要混淆。

### 11.1 两个入口函数，2026-09-19起共用同一套核心逻辑

- `explainTrackedPositionAdvice`（对比模式，`App.tsx`里`isCompareMode`分支调用）——读`trackedLegs`/`effectiveTrackedSpot`
- `explainAnalysisScenario`（分析模式，情景滑块下方，读`legs`/`shifts`跟随滑块推演）——**2026-09-19之前，这个函数走的是另一套独立的通用阈值提示（`actionHints`：按dte/delta/距盈亏平衡点距离/是否接近最大盈亏几个固定阈值判断，文案笼统），跟对比模式的具体建议是两套并行的解释内容**。xue 2026-09-18明确要求"两套解释内容不需要老版本了，只保留现在最新的多情况样板版本"——`actionHints`函数本体，连同只服务于它的`DTE_HINT_THRESHOLD`/`BREAKEVEN_HINT_THRESHOLD`/`minShiftedDte`/`nearestBreakevenPct`四个helper，**已整个删除**。`explainAnalysisScenario`现在改成把当前滑块位移换算成一份"情景后腿位克隆"（`shiftLegForAdvice`，逆向还原`result.perLeg[].shifted`得到单腿权利金），调用跟对比模式完全相同的`buildLegAdviceSections`，两种模式现在给出的具体建议逻辑完全一致，不再有第二套。

两个函数的返回结构都是`SituationExplanation | null`（`{headline, sections}`），`sections: ExplainSection[]`，`ExplainSection`当前有4个字段：`{title, body, severity?, alertBody?}`——`severity`/`alertBody`是2026-09-19新增的两个字段，只有熊市Call/牛市Put价差的建议函数会赋值，用来驱动图表提示条（见11.4），跟`body`（对话框里展示的完整句子）解耦。

`explainAnalysisScenario`除了`buildLegAdviceSections`给出的具体建议之外，前面还会拼几段基础描述（当前情景/盈亏情况/方向暴露/组合健康度摘要），这些不是"老系统"遗留、是分析模式本来就有的情景描述，**不支持540格建议的组合形状（比如三条腿以上）全靠这几段撑住对话框内容，不能删**。其中"盈亏来源"（`attribution`归因数字）那一段2026-09-19确认是跟`PnlAttributionPanel.tsx`侧边栏面板完全重复的展示，已删除（连同`explain.attributionTitle`/`explain.attributionBody`两个i18n key），`attribution`参数也从函数签名里一并移除。

### 11.2 `buildLegAdviceSections`：按腿角色分类给建议

把组合的活跃腿位配对/分类，能识别的形状给出具体建议，识别不了的用占位文案（`posAdvice.notImplementedBody`）：
- **裸卖出单腿**（`nakedShortAdvice`）——5态优先级：危险（高delta）> 临近到期贴着行权价 > 利润提前 > 被测试(+速度异常提示) > 正常持有
- **信用价差——熊市Call价差 / 牛市Put价差**（`bearCallSpreadAdvice`/`bullPutSpreadAdvice`）——见11.3，颗粒度远细于其它形状
- 借方价差 / 卖出跨式——沿用一套共用的旧版阈值逻辑（未受本轮改动影响，未来如果要给这两种形状也做540格级别的细化，是可以预见的后续工作，未列入backlog是因为xue还没明确提出）
- 三条腿以上、日历/对角、纯买方单腿等——占位文案，不给具体建议，图表也不显示提示条

### 11.3 熊市Call/牛市Put价差专用540格审查表（`bearCallSpreadTable.ts` / `bullPutSpreadTable.ts`，2026-09-18）

xue针对熊市Call价差（例：卖100call/买110call）逐条审查了540种组合（5个价格区×9个时间段×12个盈亏档）给出具体建议文案，颗粒度远细于原来的5态判断。5个价格区：深盈区/近盈利区/中间偏空（贴短腿）/中间偏多（贴长腿）/深亏区（按`classifyBearCallZone`/`classifyBullPutZone`用价差宽度的固定比例算带宽分类，不是按标的价格的固定百分比）；9个时间段按`elapsedPct`（已过天数占总dte比例）落进`[15,25,35,45,55,65,75,85,100]`这9档边界；12个盈亏档从"赚50%+"到"亏50%+"，含"微盈0-15%"和"赚10-20%"之间、"微亏0-15%"和"亏10-20%"之间刻意保留的一点重叠（540格原文档标签本身的写法，不是本轮引入的新误差）。每格是一个`[action, desc, advice]`三元组，`action`取值`"CLOSE"|"HOLD"|"MONITOR"|"WAIT"`。

牛市Put价差的540格内容是从熊市Call价差那份**程序化镜像**过去的（价格区左右对调、"裸空正股"措辞按put指派机制改成"裸多"），**没有像熊市Call价差那样经过xue逐条人工复核**，以后如果发现具体问题，用审查熊市Call价差同样的方式（分组交叉核对）来查。

**已知且刻意绕开的表内缺陷**（两个方向共有）：540格里"深盈区"和"近盈利区"（两个结构上最安全的价格区）的浮亏格，除了"刚开仓"那一档，其余8个时间段原文一律是"止损离场"，不看亏损到底多大——跟这两个区自己"结构安全"的描述矛盾。**这两个区的亏损分支不走表格**，改成统一的70%止损线（`VERTICAL_DANGER_LOSS_PCT`，call/put共用），其余格子照表格原文。

### 11.4 图表提示条 + 盈亏点颜色：`AlertSeverity`机制（2026-09-19新增，取代`getZone`/`zoneBands`/`AlertCard`旧系统）

**背景**：图表`PayoffChart.tsx`原来自己内部有第三套、完全独立的止盈/止损判断——`getZone()`，按**净收权利金**的固定百分比算三档（golden止盈50-70%、danger/stop止损超100%/150%），跟11.1~11.3这套按**价格区+时间段+盈亏档**判断的540格表各算各的，同一个仓位能同时给出两个不一样、甚至互相矛盾的判断。这套旧系统同时驱动三处UI：图表下方`AlertCard.tsx`文字提示条、图表背景的"止盈区/止损区"两条彩色色带（+对应的虚线标签）、当前盈亏点`<circle>`的填充色。**2026-09-19确认后（xue："如果可以一起改最好"）三处一起换成读11.1~11.3这套统一逻辑**，不再单独维护。

**新机制**：`severityFromAction(action: BearCallAction, pnl: number): AlertSeverity | undefined`（`situationExplainer.ts`）——`CLOSE`→`pnl>=0`则`"takeProfit"`否则`"stopLoss"`，`MONITOR`→`"monitor"`，`HOLD`/`WAIT`→`undefined`（不显示提示）。`bearCallSpreadAdvice`/`bullPutSpreadAdvice`用这个函数给`ExplainSection.severity`赋值，`alertBody`字段存这一格的`advice`原文（跟`body`里完整拼接的句子解耦，提示条只需要这一句，不需要`desc`/`cellDesc`那部分上下文）。

`App.tsx`新增`chartAlert`一个`useMemo`：从`situationExplanation.sections`里找第一条带`severity`的section，取出`{severity, body: alertBody ?? body}`传给两处：
- `<AlertCard alert={chartAlert} />`——三态三色文字提示条（绿色落袋/红色止损/黄色观察），`alert`为`null`时不渲染
- `<PayoffChart alertSeverity={chartAlert?.severity} .../>`——只用来决定当前盈亏点`<circle>`的填充色：`takeProfit`绿/`stopLoss`红/`monitor`黄，`undefined`时退回原有的、按纯盈亏符号判断的`accent`变量（这是唯一的兜底色，不是又一套判断逻辑）

`PayoffChart.tsx`内部原来的`getZone()`函数、`Zone`类型、`hasStock()`、`netCredit`useMemo、`currentZone`/`capturedPct`/`alertZone`+对应`useEffect`（原来靠这个`useEffect`把算出的`AlertInfo`报给`App.tsx`）、`zoneBands`计算、四段渲染色带/标签的JSX、`AlertInfo`/`AlertZone`两个导出类型，**全部删除**。`Props`接口的`onAlert?: (info: AlertInfo) => void`改成`alertSeverity?: AlertSeverity`（只读，`PayoffChart.tsx`自己不再计算、不再往外报任何东西）。`AlertCard.tsx`同步整个重写，见"三、文件地图"。

**三处UI现在读的是同一份`action`字段，不会再出现互相矛盾的判断**——但也意味着**这套提示条/色点只覆盖熊市Call价差和牛市Put价差两种形状**，其它组合（裸卖出单腿、借方价差、三条腿以上等）`severity`永远是`undefined`，图表提示条不显示，盈亏点用原有的纯盈亏符号色。这是刻意的范围限制，不是bug——11.2里没有540格表覆盖的形状，本来就没有这个粒度的判断依据。

**已验证**（2026-09-19）：熊市Call/牛市Put价差深盈利/深亏损/不支持形状（3腿）几个场景端到端跑过`explainAnalysisScenario`，确认`severity`正确落在`takeProfit`/`stopLoss`/`undefined`，3腿形状全程`severity`均为`undefined`；同一区/同一时间段内相邻盈亏档的建议做过横向交叉核对（比如"中间偏空、55-65%已过时间"这一格附近的赚10-20%/微盈0-15%/微亏0-15%三档全部一致给CLOSE，不是某个边界值的偶然结果）。`npm run typecheck`/`npm run build`/`npx eslint .`（4个错误12个警告，跟改动前的基线完全一致，见"五、5"）、zh/en key集合一致性检查（743/743）均已通过。

**这一轮改动涉及的文件**：`src/App.tsx`、`src/components/PayoffChart.tsx`、`src/components/dialogs/AlertCard.tsx`、`src/lib/situationExplainer.ts`、`src/i18n/locales/zh.ts`、`src/i18n/locales/en.ts`。`bearCallSpreadTable.ts`/`bullPutSpreadTable.ts`两张表本身这一轮没有改动（540格内容还是2026-09-18审查过的版本）。

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
16. **`pricing.ts`里任何按固定窗口/固定阈值扫描的函数（比如`maxProfitLoss`的±50%现价窗口），在被新用途复用之前要先确认这个固定窗口对新用途是否仍然成立**——已废弃的"持仓处置建议"止损/止盈信号失真bug就是`maxProfitLoss`原本只用于展示"图表上的理论极值参考"，被直接挪用去做"浮亏占比例判断"这个新用途时，没人意识到固定窗口对45%的策略会失真。跟第15条是同一类教训，但触发点不同。**这条教训是通用的，即使具体触发它的功能已经被删除，教训本身仍然适用于未来任何类似复用场景**
17. **`matchStrategy()`返回中文策略名**（`item.name.zh`），不是英文——任何要用这个返回值去匹配别处按英文/其它语言命名的数据的新代码，都要先经过一次翻译映射，不能假设它和`presets.ts`里的`name.en`一致
18. **文档说"已修复"/"已实现"不等于代码真的这样**——2026-09-11发现过一次真实反例：文档描述的止损/止盈信号修复细节（`entryNetPremium`+双窗口扫描）在GitHub主分支代码里完全不存在。关键判断（尤其是"这个bug是不是真修了"这类）优先直接读GitHub实际代码核实，不要只信文档描述，哪怕文档写得再具体
19. **一个组合形状/一套判断逻辑，同一时刻只应该有一份权威实现**——"四、11"是这条原则的一次实践：旧`getZone`（按净收权利金固定比例）、旧`actionHints`（按dte/delta固定阈值）、新540格表三套逻辑曾经并存，同一仓位能给出互相矛盾的建议。以后任何新的"提醒/建议"类需求，先确认是否已有类似判断逻辑，优先扩展/复用而不是并行新增一套；确认某套逻辑要被取代时，**连同它驱动的所有UI（文字/色带/图标颜色等）一次性一起换掉**，不要只换掉看得见的那一处、留下背后逻辑或其它UI表现继续用旧的
20. **一个数字/一段结论如果已经在另一处UI固定展示，新增的解释性文案不要重复陈述同一组数字**——"盈亏来源"归因数字在侧边栏`PnlAttributionPanel.tsx`和"解释当前情况"对话框里重复展示过，2026-09-19删除了对话框里那份。新增"解释当前情况"类文案前，先确认要说的内容是不是已经在页面其它地方常驻展示
21. **"这个东西有没有改动/脏了"这类判断，优先用"现场比较内容指纹 vs 上次已保存指纹"（派生值），不要用手动到处调用的true/false state**——`trackedDirty`（2026-09-25之前）、以及更早的分析模式`canSaveStrategy`都踩过/绕开过同一个坑：手动flag散落在好几个调用点各自维护，一旦某处调用时机跟真实内容不完全同步，flag就会跟"真实有没有改动"脱节，且很难从代码上一眼看出是哪一处。`serializeStrategyState`/`serializeSlotLegs`/`serializeTrackedLegs`+现场`!==`比较是这个项目里验证过可靠的写法，新增任何类似"未保存改动"判断，优先复用这个模式而不是再引入一个手动flag

22. **代码注释只写"为什么"和"坑"，不写修改历史**（2026-09-26，xue的要求）——修改日期、谁反馈的、原来是什么样、这一轮改了什么，这些写进这份CLAUDE.md（或commit信息），不写进代码注释。注释控制在一两行：这段代码为什么要这样写、改它时会踩什么坑（TDZ顺序、不能这样做的原因、xue定下的硬性约束）。改代码时顺手把跟改动相关的过期注释删掉或更新，不要在旧注释后面继续追加一段新的。大规模清理注释时，用"TypeScript printer去掉注释后前后输出完全一致"来校验没碰到代码

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
12. **`PayoffChart.tsx`里有4份几乎重复的情景计算逻辑，3份IV反推实现**——2026-09-06只解决了`pricing.ts`内部一个更小范围的子集，`PayoffChart.tsx`那4份独立实现仍是原样。**2026-09-19移除了这个文件里另一套独立的`getZone`提醒逻辑（见"四、11.4"），但这条关于情景计算/IV反推重复实现的问题不在那次改动范围内，仍然存在**
13. **年化收益率（Return on Margin）没有算**——`SimPosition`需要先新增"开仓当时的保证金占用"持久化字段，这也是`simStats.ts`（"四、4.5"）v1没做资金效率类指标的同一个卡点
14. **IV/HV比值目前只在场景选择器里用**——手动在分析模式搭建自定义组合时看不到
15. **悔棋模式（Regret Mode A，"如果没平仓"按钮）**——用户反馈"问题比较大"，下次动手前要先问清楚设计诉求
16. **AI策略推荐（`AIStrategyPage.tsx`）的每日Cron+缓存基础设施还没搭**——当前最大的未完成模块。**2026-09-25起整个模块已屏蔽**（见"四、7"），重新开放前需要先把这套基础设施搭好，否则开放后每次点击都是真实的四模型调用费用。**2026-09-11新增**：这套基础设施同时也是未来"直接调用大模型分析现有持仓"方案的候选落地位置，设计时可以一并考虑
17. **`App.tsx`还有约400-480行策略管理handler+计算useMemo没有拆分**——风险较高，需要单独一轮细致处理
18. **claude.ai项目的GitHub同步白名单持续滞后于main分支实际文件**
19. **展期会留下永久的"幽灵腿"，占用10腿上限的名额**
20. **竞品调研（2026-09-06/07）里发现、backlog没提过的剩余建议**：模拟账户组合级保证金/Greeks汇总；仓位管理提醒未来可以跟AI四模型联动；历史期权链回放（thinkBack式）。
    - **20-b. 场景选择器"待定"标签页**——xue确认暂时保留，不算独立待办
21. **localStorage容量隐患**——见"四、4.4"，建议路径按投入递增：`autoSyncWrite`失败提示 → 迁移到IndexedDB → 更长期视多端同步需求决定要不要上Supabase
22. **移动端（手机浏览器）适配（进行中，第一步已完成2026-09-26）**——完整方案见项目文档`claude/mobile-adaptation-plan-2026-09-25.md`。方向：不做设备识别/独立手机代码库，同一份组件按屏幕宽度/方向切换布局，`src/lib/`+`src/hooks/`不动。**2026-09-25实测结论**（Playwright 360/375/393/430/768/1024）：真正坏掉的只有工作区`App.tsx`——左栏`minWidth: 380`把手机屏幕占满、图表被挤成十几像素；首页/模拟账户基本可用；iPad工作区已可用；LegRow在左栏全宽后基本放得下，不需要重写成卡片。**2026-09-26 xue确认的设计**：①手机竖屏和横屏都上下排列（电脑版左栏在上、右栏图表+滑块在下），图表固定约六成屏高——横屏原计划的"左右两栏+紧凑模式+⇔切换"xue真机试过后否掉（太窄），已不做；③悬停提示：点击直接执行，需要解释的地方加"ⓘ"点开看说明（`Term.tsx`模式），纯图标按钮手机上补文字；预设策略例外，先点开预览（风险揭示+迷你图）再点"使用"；不用长按（跟系统长按菜单冲突、不可发现）；④邮件备份走系统分享面板，不做服务器发邮件（数据只在浏览器里服务器读不到，任意收件人发信接口会被滥用）。**分期**：1地基（✅2026-09-26）→2布局（✅2026-09-26：上下排/整页滚动/header合并换行/LegRow两行；`viewport-fit=cover`+safe-area留白还没加）→**手机精简版（✅2026-09-26，见开头版本说明：分析页只留核心、跟踪对比只看、模拟账户看+平仓、字号整体放大）**→3触屏交互（`PayoffChart`/`SimulatorPage`趋势图改Pointer Events且`touch-action: pan-y`、`PresetPicker`/`StrategyBadge`点击化、关键`title=`改ⓘ、`ManageStrategiesDialog`的HTML5拖放排序改上移/下移按钮、常用小按钮44px触控区）→4真机收尾（模拟账户有持仓时的表格、滑块重算若卡顿用rAF节流）。
23. **未来"直接调用大模型分析现有持仓"方案设计（2026-09-11新增）**——见"四、10"，落地位置候选是"四、7"AI策略推荐的四模型基础设施，需要重新设计prompt（保留xue对KB样本提过的"零市场叙事、不判断支撑压力位强弱"约束）、决定是否复用本地信号计算（DTE/盈亏区间/权利金倍数）当模型上下文，还没开始。**注意跟"四、11"的区别**——"四、11"是规则表驱动、已经上线的独立路线，不是这一条的落地
24. **借方价差/卖出跨式仍是旧版共用阈值逻辑，没有540格级别的细化**（2026-09-19新增，见"四、11.2"）——熊市Call/牛市Put价差这两种信用价差已经有xue逐条审查过的540格表，其它形状（借方价差、卖出跨式、裸卖出单腿）还是原来那套更粗粒度的判断。是否要为这些形状也做同等粒度的细化，xue还没提出明确诉求，暂不列入进行中工作
25. **牛市Put价差540格表没有经过人工逐条复核**（2026-09-19新增，见"四、11.3"）——是从熊市Call价差程序化镜像过去的，理论上应该对称正确，但没有像熊市Call价差那样一条条人工审查过。以后如果发现该形状的建议文案有问题，用审查熊市Call价差同样的方法（分组交叉核对）去查
26. **胜率模拟的局限和第二版**（2026-09-30）：不知道财报日期（历史波动率在财报前会低估未来波动，本应提示"安全垫不可靠"，需要先有财报日期数据）；含正股的组合不支持；隐含波动率持有期间不变、无跳空；高级分析第二版待做：规则对比热力图（止损倍数×止盈比例）、出场时间分布、点选单条走势看每天盈亏

---

# 七、给接手的人（无论是人类开发者还是下一个AI会话）

1. **第一步永远是跟GitHub真实代码做一次全面比对**，确认这份文档反映的状态和实际代码库一致，再开始改动——**包括文档自己**，2026-09-11刚发生过一次"文档写了修复、代码没有"的真实反例，见"五、18"
2. **动`zh.ts`/`en.ts`之前，务必读完文档开头的独立警示章节**
3. "六、已知问题"是最直接能接手的任务列表——13（年化收益率）和12（PayoffChart重复实现）性价比较高、22（移动端适配）规模较大需要先决定要不要启动、23（大模型分析持仓方案）需要先做设计，21（localStorage容量隐患）如果用户反馈过卡顿/同步异常，优先级应该提前，24/25（价差建议细化/牛市Put表复核）是"四、11"这套新系统的自然延伸，性价比取决于xue是否提出诉求
4. 遇到"某个条件不满足就整个隐藏UI"的写法，默认改成"展示框架+解释原因"（"五、8"）
5. `App.tsx`新增`useMemo`/`useCallback`时注意TDZ风险；新增"组合级"展示指标时按`isCompareMode`分支选数据源（"五、12"）
6. 财报相关改动注意`note`和`linkedStrategyId`是两个独立字段
7. 涉及"到期盈亏"类计算（`pnlAtExpiry`/`payoffCurvePoints`/`maxProfitLoss`）时，注意"多到期日"特殊处理只该用在真正的日历/对角价差上；`maxProfitLoss`的固定±50%扫描窗口在被新用途复用前要先确认是否成立（"五、15"、"五、16"）
8. `matchStrategy()`返回的是中文策略名，不是英文（"五、17"）
9. 交付代码遵守"一、开发/交付流程约定"里的规范（完整文件、路径注释、typecheck验证；**对大文件没有把握完整还原时，交付精确补丁说明而不是硬造完整文件**）
10. 这份文档改完之后按开头"维护方式"的约定去改，不要退回按会话追加的旧模式
11. **动"解释当前情况"/图表提示条相关代码前，先读"四、11"整节**——这是当前项目里"一个功能有三套并行判断逻辑"踩过坑、刚清理干净的地方（"五、19"），新增类似"提醒/建议"需求时优先复用这套`ExplainSection`/`AlertSeverity`机制，不要再起第四套