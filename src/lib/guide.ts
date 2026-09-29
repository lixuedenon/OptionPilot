// src/lib/guide.ts
// 引导文字里的"链接"点击后，直接点一下页面上对应的原始控件（带data-guide属性），
// 效果跟用户自己点那个控件完全一样，下拉菜单也在原位置展开。
export function clickGuideTarget(id: "add-leg" | "preset" | "library") {
  document.querySelector<HTMLElement>(`[data-guide="${id}"]`)?.click();
}
