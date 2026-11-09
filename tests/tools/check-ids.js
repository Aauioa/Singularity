// 检查 app.js 是否还在引用已不存在的 HTML id（重构后最容易踩的坑）
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'src');
const js = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

// app.js 里动态创建的 id（目前没有），以及 tab/section 生成的元素不算
const used = [...new Set([...js.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]))];
// app.js 运行时动态创建的 id（不在 index.html 里）。名单与 verify-app.js 共用一份，
// 之前这里自己抄了一份、漏抄了新 id，结果这个工具误报"引用了不存在的 id"。
const RUNTIME_IDS = require('../runtime-ids');
const missing = used.filter(x => !ids.has(x) && !RUNTIME_IDS.has(x));

console.log(`HTML id 共 ${ids.size} 个；app.js 引用了 ${used.length} 个不同的 id`);
if (missing.length) {
  console.log('❌ 引用了不存在的 id:');
  missing.forEach(m => console.log('   ' + m));
  process.exit(1);
}
console.log('✅ 所有 getElementById 引用都存在于 index.html');

// 顺带检查是否还残留静态 HUD section 标记
const hudIds = ['hudStatsSection', 'hudNpcSection', 'hudBagSection', 'hudSpellsSection',
  'inventoryGrid', 'npcCodexContainer', 'spellsListContainer', 'weaponMasteryGrid',
  'statusBadges', 'attributesHoneycombContainer', 'vitalBarsContainer'];
const left = hudIds.filter(i => html.includes(`id="${i}"`) || js.includes(`getElementById('${i}')`));
if (left.length) {
  console.log('❌ 仍残留静态右栏标记: ' + left.join(', '));
  process.exit(1);
}
console.log('✅ 右栏已无静态 section 标记（完全由蓝图生成）');
