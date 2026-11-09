// 一键跑完全部校验：npm test
//
// 注意：子进程用 stdio:'inherit'，既能在受限沙箱里正常工作，
// 也能让各个套件自己带颜色/缩进地输出到终端。
const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  ['静态校验（语法 / id / 注入面 / 本地化 / CSP）', 'verify-app.js'],
  ['CSS 覆盖率（改动样式后最关键的一道网）', 'test-css-coverage.js'],
  ['世界蓝图（自适应页签 / 自定义维度 / 校验 / 注入防护）', 'test-schema.js'],
  ['净化逻辑（XSS payload 阻断）', 'test-sanitize.js'],
  ['端到端集成（真实 UI 驱动）', 'test-integration.js'],
  ['上下文 / 摘要 / 导入导出往返', 'test-context.js'],
  ['DeepSeek 默认配置与思考模式', 'test-deepseek.js'],
];

const results = [];

for (const [name, file] of SUITES) {
  console.log('\n' + '━'.repeat(64));
  console.log(`▶ ${name}`);
  console.log('  ' + file);
  console.log('━'.repeat(64));
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  results.push({ name, code: r.status === null ? 1 : r.status });
}

const failed = results.filter(r => r.code !== 0);
console.log('\n' + '━'.repeat(64));
console.log('汇总');
console.log('━'.repeat(64));
results.forEach(r => console.log(`  ${r.code === 0 ? '✅' : '❌'}  ${r.name}`));
console.log(failed.length === 0
  ? '\n✅ 全部通过'
  : `\n❌ ${failed.length} / ${results.length} 套失败`);
process.exit(failed.length === 0 ? 0 : 1);
