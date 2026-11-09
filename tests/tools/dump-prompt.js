// 一次性排查工具：把真正下发的 system prompt 完整打印出来（改提示词时人眼复核用）
// 用法：node tests/tools/dump-prompt.js [输出文件]
const fs = require('fs');
const path = require('path');
const { boot, waitForInit } = require('../harness');

const out = process.argv[2] || path.join(__dirname, 'prompt-dump.txt');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const dom = boot({ injectCss: false });
  const { window } = dom;
  const doc = window.document;
  await waitForInit(doc);

  doc.getElementById('openApiSettingsBtn').click();
  doc.getElementById('apiProviderSelect').value = 'openai_compatible';
  doc.getElementById('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
  doc.getElementById('apiKeyInput').value = 'sk-x';
  doc.getElementById('saveApiConfigBtn').click();

  let system = '';
  window.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    system = (body.messages && body.messages[0] && body.messages[0].content) || '';
    const text = '正文。\n\n```game_state\n{"location":"某处"}\n```';
    return {
      ok: true, status: 200,
      headers: { get: () => 'text/event-stream' },
      body: { getReader: () => { let d = false; return { read: async () => { if (d) return { done: true }; d = true; return { done: false, value: new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n') }; } }; } }
    };
  };
  doc.getElementById('playerInput').value = '看看四周';
  doc.getElementById('sendActionBtn').click();
  await sleep(500);

  fs.writeFileSync(out, system, 'utf8');
  console.log(`system prompt 共 ${system.length} 字符，已写入 ${out}`);
  console.log('--- 前 40 行 ---');
  console.log(system.split('\n').slice(0, 40).join('\n'));
  process.exit(0);
})().catch(e => { console.log('[FATAL] ' + e.stack); process.exit(1); });
