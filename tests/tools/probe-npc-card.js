// 一次性排查工具：渲染 NPC 卡片，看清名字被谁挤掉（jsdom 没有布局，只看结构）
const { boot, waitForInit, sectionEl } = require('../harness');

const dom = boot({ injectCss: false });
const { window } = dom;
const doc = window.document;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  await waitForInit(doc);

  doc.getElementById('openApiSettingsBtn').click();
  doc.getElementById('apiProviderSelect').value = 'openai_compatible';
  doc.getElementById('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
  doc.getElementById('apiKeyInput').value = 'sk-x';
  doc.getElementById('saveApiConfigBtn').click();

  const state = {
    npc_codex: [
      { name: '阿列克谢·冯·霍恩海姆', race: '人类', personality: '多疑', love_type: '表面冷淡、内心其实非常在意' },
      { name: '莉薇娅', race: '人类', personality: '冷静', love_type: '盟友' }
    ]
  };
  const text = '正文。\n\n```game_state\n' + JSON.stringify(state) + '\n```';
  window.fetch = async () => ({
    ok: true, status: 200,
    headers: { get: () => 'text/event-stream' },
    body: {
      getReader: () => {
        let d = false;
        return { read: async () => { if (d) return { done: true }; d = true; return { done: false, value: new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n') }; } };
      }
    }
  });
  doc.getElementById('playerInput').value = '看看周围';
  doc.getElementById('sendActionBtn').click();
  await sleep(600);

  // 切到 NPC 页签
  const npcTab = doc.querySelector('#hudTabBar .hud-tab-btn[data-tab="npc"]');
  if (npcTab) npcTab.click();
  await sleep(120);

  const sec = sectionEl(doc, 'codex');
  console.log('--- 折叠开关（蓝图）:', sec ? (sec.dataset ? sec.dataset.section : '?') : '未找到 section');

  const cards = [...doc.querySelectorAll('[data-npc-card]')];
  console.log('卡片数:', cards.length);
  cards.forEach((c, i) => {
    const header = c.firstElementChild;
    const nameSpan = c.querySelector('[data-npc-toggle] span:nth-child(2)') || c.querySelector('.truncate');
    console.log(`\n=== 卡片 ${i + 1} ===`);
    console.log('名字元素 class:', nameSpan && nameSpan.className);
    console.log('名字文本长度:', nameSpan && nameSpan.textContent.length);
    console.log('头部行 class:', header.className);
    console.log('头部行结构:');
    console.log(header.outerHTML.replace(/></g, '>\n<').split('\n').map(l => '   ' + l.trim()).join('\n'));
    const detail = c.querySelector('[data-npc-detail]');
    console.log('详情块 hidden?', detail.classList.contains('hidden'));
  });
  process.exit(0);
})().catch(e => { console.log('[FATAL] ' + e.stack); process.exit(1); });
