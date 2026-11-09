// 一次性核对工具：并排渲染"改动前(git HEAD)"与"改动后(工作区)"的 NPC 卡片，
// 比对文本内容与 class 集合。用途：重建 hud-baseline.json 之前证明内容零丢失。
//
// 先准备旧版本文件（沙箱内 Node 不能捕获管道输出，所以这一步交给 shell）：
//   git show HEAD:src/app.js | Set-Content -Encoding UTF8 tests\tools\.tmp-app-old.js
// ⚠️ 必须显式 -Encoding UTF8：PowerShell 5.1 的 `>` 重定向会写成 UTF-16LE，
//    读出来是乱码（node --check 直接报 Invalid or unexpected token）。
// 用完删掉：Remove-Item tests\tools\.tmp-app-old.js
const fs = require('fs');
const path = require('path');

const harness = require('../harness');
const ROOT = path.join(__dirname, '..', '..');
const OLD_APP = path.join(__dirname, '.tmp-app-old.js');

if (!fs.existsSync(OLD_APP)) {
  console.log('[FATAL] 缺少旧版本文件。请先执行：');
  console.log('  git show HEAD:src/app.js > tests/tools/.tmp-app-old.js');
  process.exit(1);
}

const FIXTURE = {
  npc_codex: [
    { name: '阿列克谢·冯·霍恩海姆', race: '人类', personality: '多疑', love_type: '表面冷淡、内心其实非常在意' },
    { name: '莉薇娅', race: '人类', personality: '冷静', love_type: '盟友' },
    { name: '没有定位的家伙' }
  ]
};

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

// 可见文本（跳过 hidden 子树）——快照工具的判据就是这个
function visibleText(el) {
  let out = '';
  const walk = (n) => {
    if (n.nodeType === 3) { out += n.nodeValue; return; }
    if (n.nodeType !== 1) return;
    if (n.classList && n.classList.contains('hidden')) return;
    for (const c of n.childNodes) walk(c);
  };
  walk(el);
  return norm(out);
}

async function capture(appPath, label) {
  harness.paths.app = appPath;
  const dom = harness.boot({ injectCss: false });
  const { window } = dom;
  const doc = window.document;
  await harness.waitForInit(doc);

  doc.getElementById('openApiSettingsBtn').click();
  doc.getElementById('apiProviderSelect').value = 'openai_compatible';
  doc.getElementById('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
  doc.getElementById('apiKeyInput').value = 'sk-x';
  doc.getElementById('saveApiConfigBtn').click();

  const text = '正文。\n\n```game_state\n' + JSON.stringify(FIXTURE) + '\n```';
  window.fetch = async () => ({
    ok: true, status: 200,
    headers: { get: () => 'text/event-stream' },
    body: { getReader: () => { let d = false; return { read: async () => { if (d) return { done: true }; d = true; return { done: false, value: new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n') }; } }; } }
  });
  doc.getElementById('playerInput').value = '看看周围';
  doc.getElementById('sendActionBtn').click();
  await new Promise(r => setTimeout(r, 700));

  const tab = doc.querySelector('#hudTabBar .hud-tab-btn[data-tab="npc"]');
  if (tab) tab.click();
  await new Promise(r => setTimeout(r, 150));

  const sec = harness.sectionEl(doc, 'codex');
  const cards = [...doc.querySelectorAll('[data-npc-card]')];
  const classes = new Set();
  sec.querySelectorAll('*').forEach(el => el.classList.forEach(c => classes.add(c)));

  console.log(`\n===== ${label} =====`);
  cards.forEach((c, i) => {
    console.log(`卡片${i + 1} 全文: ${norm(c.textContent)}`);
    console.log(`卡片${i + 1} 可见: ${visibleText(c)}`);
  });

  return {
    sectionText: norm(sec.textContent),
    sectionTokens: norm(sec.textContent).split(' ').sort(),
    cardTexts: cards.map(c => norm(c.textContent)),
    visibleCards: cards.map(c => visibleText(c)),
    classes: [...classes].sort(),
  };
}

(async () => {
  const before = await capture(OLD_APP, '改动前 (git HEAD)');
  const after = await capture(path.join(ROOT, 'src', 'app.js'), '改动后 (工作区)');

  console.log('\n===== 内容保全结论 =====');
  const sameMultiset = JSON.stringify(before.sectionTokens) === JSON.stringify(after.sectionTokens);
  console.log(`整段文本（排序后按词多重集比对，规避"徽章换位置"造成的顺序差）: ${sameMultiset ? '✅ 完全一致（零内容丢失）' : '❌ 有增删'}`);
  if (!sameMultiset) {
    const onlyBefore = before.sectionTokens.filter(t => !after.sectionTokens.includes(t));
    const onlyAfter = after.sectionTokens.filter(t => !before.sectionTokens.includes(t));
    console.log('  仅改动前有:', JSON.stringify(onlyBefore));
    console.log('  仅改动后有:', JSON.stringify(onlyAfter));
  }

  console.log('\n--- 逐卡"可见文本"变化（折叠态下徽章不再可见，属预期）---');
  before.visibleCards.forEach((b, i) => {
    const a = after.visibleCards[i] || '';
    console.log(`卡片${i + 1}: ${b === a ? '一致' : '变化'}`);
    if (b !== a) {
      console.log(`   前: ${b}`);
      console.log(`   后: ${a}`);
    }
  });

  const removed = before.classes.filter(c => !after.classes.includes(c));
  const added = after.classes.filter(c => !before.classes.includes(c));
  console.log('\n--- class 变化 ---');
  console.log('移除:', JSON.stringify(removed));
  console.log('新增:', JSON.stringify(added));

  process.exit(sameMultiset ? 0 : 1);
})().catch(e => { console.log('[FATAL] ' + e.stack); process.exit(1); });
