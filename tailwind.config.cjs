/** 奇点 TRPG · Tailwind 静态构建配置
 *
 * 扫描前端源码，把实际用到的 Tailwind 类编译成静态 CSS，
 * 取代原先运行时的 Play CDN（cdn.tailwindcss.com）——那玩意儿断网就整个界面没样式。
 *
 * 改了 HTML/JS 里的类名后，请重新执行：npm run build:css
 */
module.exports = {
  content: [
    './src/index.html',
    './src/app.js',
  ],
  theme: { extend: {} },
  plugins: [],
};
