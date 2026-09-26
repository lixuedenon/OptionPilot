// src/lib/featureFlags.ts
// 功能开关——临时屏蔽某个模块时只改这里一处，不去删模块本身的代码。
//
// AI_MODULE_ENABLED（2026-09-25，xue的要求：AI推荐模块先屏蔽，不让人使用）：
//   false 时——首页"AI推荐策略"卡片仍然显示（带"规划中"徽章，遵守"展示框架
//   +解释原因、不整个隐藏"的原则），但按钮禁用、点不进去；Shell.tsx的路由也
//   拒绝进入"ai"视图，双保险。AIStrategyPage.tsx和strategy-analysis Edge
//   Function的代码原样保留，以后重新开放时把这里改成true即可。
//   注意：这个前端开关只挡住界面入口。strategy-analysis Edge Function本身
//   另有服务端开关（环境变量AI_ANALYSIS_ENABLED，见该函数文件顶部说明），
//   那个才是真正防止别人绕过界面直接调用、产生模型费用的那一道闸。
export const AI_MODULE_ENABLED = false;