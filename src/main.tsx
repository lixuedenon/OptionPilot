// src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Shell from './Shell.tsx';
import { I18nProvider } from './i18n/I18nContext';
import './index.css';

// 2026-09-26 移动端第一步：
// ① iOS上输入框字号<16px时，点输入框页面会自动放大且不缩回（本项目输入框
//   普遍是11px）。只在iOS上给viewport追加maximum-scale=1来阻止这个自动放
//   大——iOS 10起Safari对网页的maximum-scale只作用于"自动放大"，用户双指
//   缩放照样可用，不影响无障碍。安卓不会自动放大，而且安卓上加这个会真的
//   禁掉双指缩放，所以只对iOS加。不采用"输入框改16px"的办法，是因为那会
//   撑坏LegRow等固定宽度的输入框布局。
// ② 申请持久存储：安卓Chrome据此把本站存储标为持久，空间紧张时不会被系统
//   回收；iOS上"添加到主屏幕"的网页应用不受Safari"7天清空"限制。失败或不
//   支持时静默忽略。
function applyMobilePlatformTweaks() {
  try {
    const ua = navigator.userAgent;
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 13+ 伪装成Mac
    if (isIOS) {
      const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
      if (meta && !/maximum-scale/.test(meta.content)) {
        meta.content = `${meta.content}, maximum-scale=1`;
      }
    }
  } catch {
    // ignore
  }
  try {
    void navigator.storage?.persist?.();
  } catch {
    // ignore
  }
}
applyMobilePlatformTweaks();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <Shell />
    </I18nProvider>
  </StrictMode>
);