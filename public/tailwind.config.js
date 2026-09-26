// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  // 2026-09-26 移动端：hover:样式只在真正有悬停能力的设备（鼠标/触控板）上
  // 生效，手机上点完按钮不会一直停在高亮状态。桌面端行为不变。
  future: {
    hoverOnlyWhenSupported: true,
  },
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
