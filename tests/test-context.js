// 针对新增能力的测试：上下文窗口、自动摘要、HUD 摘要、导出/导入往返
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', 'src', 'index.html');
const PURIFY_PATH = path.join(__dirname, '..', 'src', 'vendor', 'purify.min.js');

let failures = 0;
const fail = (m) => { failures++; console.log('  [FAIL] ' + m); };
const pass = (m) => console.log('  [ ok ] ' + m);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const { buildHtml } = require('./harness');
const dom = new JSDOM(buildHtml({ injectCss: true }), { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://app.local/' });
const { window } = dom;
const doc = window.document;
const $ = (id) => doc.getElementById(id);

const requests = [];      // 记录每次出网请求
let summaryCount = 0;

function sseFor(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += 60) chunks.push(text.slice(i, i + 60));
  return {
    ok: true,
    status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
    body: {
      getReader: () => {
        let i = 0;
        return {
          read: async () => {
            if (i >= chunks.length) return { done: true };
            const line = 'data: ' + JSON.stringify({ choices: [{ delta: { content: chunks[i++] } }] }) + '\n\n';
            return { done: false, value: new TextEncoder().encode(line) };
          }
        };
      }
    }
  };
}

// 统一的 fetch mock：区分「GM 推演」与「记录员摘要」两种请求
window.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  const sys = body.messages[0].content;
  const isSummary = sys.includes('记录员');
  requests.push({ isSummary, system: sys, messages: body.messages, stream: body.stream });
  if (isSummary) {
    summaryCount++;
    return sseFor('【前情提要】玩家已进入灰烬祭坛，与莉薇娅结盟，获得符文短匕，尚未解开石板之谜。');
  }
  const turnText = 'GM 推演内容。\n\n```game_state\n' + JSON.stringify({
    location: '祭坛第' + requests.length + '层',
    inventory: [{ name: '符文短匕', qty: 1, desc: '禁忌符文' }],
    npc_codex: [{ name: '莉薇娅', race: '人类', love_type: '盟友' }],
    suggested_actions: ['前进']
  }) + '\n```';
  return sseFor(turnText);
};

async function waitForInit() {
  for (let i = 0; i < 60; i++) {
    if (doc.querySelectorAll('#hudTabBar .hud-tab-btn').length > 0) return true;
    await sleep(25);
  }
  return false;
}

(async () => {
  console.log('\n=== 初始化 ===');
  if (!(await waitForInit())) { console.log('启动失败'); process.exit(1); }
  pass('应用已启动');

  // 配置 API
  $('openApiSettingsBtn').click();
  $('apiProviderSelect').value = 'openai_compatible';
  $('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
  $('apiKeyInput').value = 'sk-test';
  $('apiBaseUrlInput').value = 'https://api.example.com/v1';
  $('apiModelInput').value = 'test-model';
  $('saveApiConfigBtn').click();

  // ---- 收紧上下文窗口，便于在少量回合内触发摘要 ----
  console.log('\n=== A. 上下文设置面板 ===');
  $('openSettingsModalBtn').click();
  if ($('cfgRecentTurnsInput') && $('cfgSummaryTriggerInput') && $('settingAutoSummary')) pass('上下文设置面板已存在');
  else fail('上下文设置面板缺失');

  $('cfgRecentTurnsInput').value = '2';
  $('cfgSummaryTriggerInput').value = '2';
  $('settingAutoSummary').checked = true;
  $('saveContextConfigBtn').click();
  if ($('contextUsageSummary').textContent.includes('发送')) pass('上下文占用徽章已更新: ' + $('contextUsageSummary').textContent);
  else fail('上下文占用徽章未更新');
  $('closeSettingsModalBtn').click();

  // ---- 跑多回合 ----
  console.log('\n=== B. 多回合推演 ===');
  for (let i = 1; i <= 5; i++) {
    $('playerInput').value = '第' + i + '回合行动';
    $('sendActionBtn').click();
    await sleep(260);
  }
  const turnReqs = requests.filter(r => !r.isSummary);
  if (turnReqs.length === 5) pass('完成 5 回合推演');
  else fail('推演回合数异常: ' + turnReqs.length);

  // ---- 上下文窗口 ----
  console.log('\n=== C. 滑动窗口生效 ===');
  const last = turnReqs[turnReqs.length - 1];
  const nonSystem = last.messages.filter(m => m.role !== 'system');
  if (nonSystem.length <= 5) pass(`最后一回合只发送了 ${nonSystem.length} 条消息（窗口=2 回合 → 上限 4~5 条）`);
  else fail(`窗口未生效，仍发送了 ${nonSystem.length} 条消息`);
  if (nonSystem.length < 9) pass('确实少于完整历史（9 条）');
  else fail('发送了完整历史，窗口没起作用');
  if (last.messages[0].role === 'system') pass('system 消息仍在首位');
  if (nonSystem.length && nonSystem[0].role === 'user') pass('裁剪后以 user 消息开头');
  else fail('裁剪后首条不是 user: ' + (nonSystem[0] && nonSystem[0].role));

  // ---- 助手历史必须带上 game_state 数据块 ----
  // 以前历史里只留正文（数据块被剥掉），模型每回合看到的"自己上一轮"都是不带数据块的
  // 文本 —— 等于用上下文反复教它"别写数据块"，system 提示里再强调也压不过这个示范。
  const assistantMsgs = nonSystem.filter(m => m.role === 'assistant');
  if (assistantMsgs.length > 0 && assistantMsgs.every(m => m.content.includes('```game_state'))) {
    pass(`发送的历史里 ${assistantMsgs.length} 条助手消息都带着 game_state 数据块`);
  } else {
    fail('助手历史里缺少 game_state 数据块（模型会照着"不带数据块"的示范继续漏块）');
  }
  if (nonSystem.some(m => m.role === 'assistant' && m.content.includes('GM 推演内容'))) {
    pass('数据块是追加在正文之后的（正文内容没有被改动）');
  } else {
    fail('助手历史里的正文丢失了');
  }

  // ---- 自动摘要 ----
  console.log('\n=== D. 自动摘要 ===');
  if (summaryCount >= 1) pass(`已触发 ${summaryCount} 次剧情压缩请求`);
  else fail('从未触发摘要请求');
  if (summaryCount >= 1) {
    const sreq = requests.find(r => r.isSummary);
    if (sreq.system.includes('记录员')) pass('摘要请求使用了精简 system prompt（不携带世界观人设）');
    else fail('摘要请求的 system prompt 不正确');
    if (sreq.messages[0].content.includes('前情提要')) pass('摘要 prompt 含前情提要结构要求');
  }

  await sleep(200);
  $('openSettingsModalBtn').click();
  const summaryText = $('contextSummaryTextarea').value;
  if (summaryText.includes('灰烬祭坛')) pass('前情提要已写入并展示: ' + summaryText.slice(0, 40) + '...');
  else fail('前情提要为空: ' + summaryText);
  $('closeSettingsModalBtn').click();

  // 后续回合的 system prompt 必须带上摘要
  $('playerInput').value = '第六回合行动';
  $('sendActionBtn').click();
  await sleep(300);
  const after = requests.filter(r => !r.isSummary).pop();
  if (after.system.includes('灰烬祭坛')) pass('后续请求的 system prompt 已包含前情提要');
  else fail('前情提要未进入 system prompt');
  if (after.system.includes('前情提要')) pass('system prompt 含「前情提要」小节标题');
  else fail('缺少前情提要小节');

  // ---- HUD 摘要 ----
  console.log('\n=== E. HUD 摘要进入 system prompt ===');
  if (after.system.includes('系统记录的当前数值')) pass('含「系统记录的当前数值」小节');
  else fail('缺少 HUD 摘要小节');
  if (after.system.includes('莉薇娅')) pass('HUD 摘要包含 NPC 关系');
  else fail('HUD 摘要缺少 NPC');
  if (after.system.includes('符文短匕')) pass('HUD 摘要包含行囊物品');
  else fail('HUD 摘要缺少行囊');

  // ---- 导出 / 导入往返 ----
  console.log('\n=== F. 导出 → 导入 往返一致 ===');
  let captured = null;
  window.Blob = class { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; } };
  window.URL.createObjectURL = (b) => { captured = b; return 'blob:fake'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { /* 阻断 jsdom 导航 */ };

  $('exportSessionBtn').click();
  if (captured) pass('导出产生了 Blob');
  else { fail('导出未产生 Blob'); }

  let pack = null;
  if (captured) {
    pack = JSON.parse(captured.parts.join(''));
    if (pack.format === 'singularity-world-pack') pass('含统一格式标识: ' + pack.format + ' v' + pack.version);
    else fail('缺少格式标识: ' + pack.format);
    if (pack.worldName) pass('含 worldName: ' + pack.worldName);
    else fail('缺少 worldName');
    if (Array.isArray(pack.history) && pack.history.length > 0) pass('对局导出含 ' + pack.history.length + ' 条历史');
    else fail('对局导出缺 history');
    if (typeof pack.contextSummary === 'string' && pack.contextSummary.length) pass('导出含前情提要');
    else fail('导出缺 contextSummary');
  }

  // 纯设定包不应包含历史
  captured = null;
  $('openSlotModalBtn').click();
  $('exportCurrentSlotBtn').click();
  if (captured) {
    const slotPack = JSON.parse(captured.parts.join(''));
    if (Array.isArray(slotPack.history) && slotPack.history.length === 0) pass('世界设定包不含推演记录（符合设计）');
    else fail('世界设定包意外包含历史');
    if (slotPack.format === 'singularity-world-pack') pass('设定包同样使用统一格式');
  } else fail('设定包导出未产生 Blob');

  // 导入新格式
  const beforeSlots = JSON.parse(window.localStorage.getItem('chronicle_user_slots') || '[]').length;
  async function doImport(obj, fname) {
    const file = new window.File([JSON.stringify(obj)], fname, { type: 'application/json' });
    const input = $('slotJsonFileInput');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new window.Event('change'));
    await sleep(350);
  }

  await doImport(pack, 'roundtrip.json');
  const slots2 = JSON.parse(window.localStorage.getItem('chronicle_user_slots') || '[]');
  if (slots2.length === beforeSlots + 1) pass('新格式导入成功');
  else fail('新格式导入失败');
  const newSlot = slots2[slots2.length - 1];
  if ($('headerSlotNameDisplay').textContent.includes(pack.worldName)) pass('导入后世界名正确: ' + pack.worldName);
  else fail('世界名不符: ' + $('headerSlotNameDisplay').textContent);
  const importedStory = JSON.parse(window.localStorage.getItem('chronicle_' + newSlot.id + '_story') || '[]');
  if (importedStory.length === pack.history.length) pass(`历史条数一致 (${importedStory.length})`);
  else fail(`历史条数不符: ${importedStory.length} vs ${pack.history.length}`);
  const importedCtx = JSON.parse(window.localStorage.getItem('chronicle_' + newSlot.id + '_ctx') || '{}');
  if (importedCtx.summary && importedCtx.summary.includes('灰烬祭坛')) pass('前情提要随包导入');
  else fail('前情提要未导入');
  if ($('narrativeContainer').querySelectorAll('.narrative-msg').length > 0) pass('导入后推演历史已渲染出来');
  else fail('导入后历史未渲染');

  // 导入旧格式（title 命名的「导出对局」）
  console.log('\n=== G. 旧格式兼容 ===');
  const before2 = JSON.parse(window.localStorage.getItem('chronicle_user_slots') || '[]').length;
  await doImport({ title: '旧版对局_魔法学院', lore: { world: '魔法学院设定', character: '', rules: '', memoryPins: '' }, history: [{ role: 'user', text: '旧历史', time: '00:00:00' }] }, 'legacy.json');
  const slots3 = JSON.parse(window.localStorage.getItem('chronicle_user_slots') || '[]');
  if (slots3.length === before2 + 1) pass('旧 title 格式可导入');
  else fail('旧 title 格式导入失败');
  if ($('headerSlotNameDisplay').textContent.includes('旧版对局_魔法学院')) pass('旧格式的世界名被正确识别（此前会退化成文件名）');
  else fail('旧格式世界名未识别: ' + $('headerSlotNameDisplay').textContent);

  const before3 = JSON.parse(window.localStorage.getItem('chronicle_user_slots') || '[]').length;
  await doImport({ worldName: '旧版世界包', desc: 'd', lore: { world: 'w', character: '', rules: '', memoryPins: '' } }, 'legacy2.json');
  const slots4 = JSON.parse(window.localStorage.getItem('chronicle_user_slots') || '[]');
  if (slots4.length === before3 + 1) pass('旧 worldName 格式仍可导入');
  else fail('旧 worldName 格式导入失败');

  console.log('\n===== ' + (failures === 0 ? '全部通过' : failures + ' 项失败') + ' =====');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
  console.log('\n[FATAL] ' + e.stack);
  process.exit(1);
});
