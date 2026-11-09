// 端到端集成测试：在 jsdom 里加载真实应用，通过真实 UI 事件驱动
const { boot, waitForInit, clickTab, secRef, sectionEl } = require('./harness');

let failures = 0;
const fail = (m) => { failures++; console.log('  [FAIL] ' + m); };
const pass = (m) => console.log('  [ ok ] ' + m);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 真实 marked（不做转义，会原样透传原始 HTML）——正好用来验证净化层是否真的拦住了注入
const dom = boot({ injectCss: true });
const { window } = dom;
const doc = window.document;
  const ref = (n) => doc.querySelector(`[data-ref="${n}"]`);

const $ = (id) => doc.getElementById(id);

const consoleErrors = [];
window.addEventListener('error', (e) => consoleErrors.push(e.message));
window.console.error = (...a) => consoleErrors.push(a.map(String).join(' '));
window.__pwned = undefined;

(async () => {
  console.log('\n=== A. 启动 ===');
  const inited = await waitForInit(doc);
  if (inited) pass('load 处理器已执行，事件绑定完成');
  else fail('启动失败：load 处理器未完成绑定');

  if (typeof window.DOMPurify !== 'undefined') pass('DOMPurify 已全局挂载 v' + window.DOMPurify.version);
  else fail('DOMPurify 未挂载');

  if ($('headerSlotNameDisplay').textContent.trim()) pass('默认世界名已渲染: ' + $('headerSlotNameDisplay').textContent.trim());
  else fail('世界名未渲染');

  if ($('narrativeContainer').querySelector('#emptyStoryNotice')) pass('空状态提示正常显示');
  else fail('空状态提示缺失');

  // ---- B. API 配置（走真实弹窗事件）----
  console.log('\n=== B. API 配置（走真实 UI）===');
  $('openApiSettingsBtn').click();
  $('apiProviderSelect').value = 'openai_compatible';
  $('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
  $('apiKeyInput').value = 'sk-test-key';
  $('apiBaseUrlInput').value = 'https://api.example.com/v1';
  $('apiModelInput').value = 'test-model';
  $('saveApiConfigBtn').click();
  if ($('apiModal').classList.contains('hidden')) pass('API 设置已保存并关闭弹窗');
  else fail('API 弹窗未关闭');
  if ($('apiStatusText').textContent.includes('test-model')) pass('顶部状态显示已激活模型');
  else fail('状态徽章未更新: ' + $('apiStatusText').textContent);

  if (window.localStorage.getItem('chronicle_api_config')) pass('API 配置已写入 localStorage');
  else fail('API 配置未落盘');

  // ---- C. 流式推演 + HUD 契约 ----
  console.log('\n=== C. 流式推演 + game_state 契约 ===');

  const gameState = {
    location: '灰烬祭坛',
    time: '深夜 / 细雨',
    character_profile: { name: '伊莱亚斯', race: '精灵', class: '游侠', identity: '雇佣兵', gender: '男', age: '24', appearance: '银发，左肩有旧伤' },
    bars: [{ label: '生命 (HP)', current: 72, max: 90, color: 'rose' }],
    attributes: { 力量: { current: 12, max: 20 }, 敏捷: { current: 16, max: 20 }, 感知: { current: 14, max: 20 } },
    weapon_mastery: { 弓术: { level: '精通', exp: 40 } },
    spells: [{ name: '星火术', ring: '一环', mp: 8, desc: '凝聚星光灼烧目标' }],
    skills: { known: ['野外追踪', '草药学'], unknown: ['古代语'] },
    inventory: [{ name: '暗金符文短匕', qty: 2, icon: '🗡️', desc: '刃身刻有禁忌符文' }, '干粮'],
    status_effects: [{ name: '中毒', type: 'debuff', desc: '每回合损失 3 点生命' }, { name: '鹰眼', type: 'buff' }],
    npc_codex: [{ name: '莉薇娅', race: '人类', personality: '冷静', love_type: '盟友' }],
    suggested_actions: ['潜入祭坛', '点燃篝火', '呼叫莉薇娅']
  };

  const narrativeText = '你踏入了灰烬祭坛。<img src=x onerror="window.__pwned=1">\n\n【莉薇娅】\n好感度：55（变动：+5）信任度：40（变动：0）肉欲度：10（变动：0）情感深度：20（变动：+1）\n\n```game_state\n' + JSON.stringify(gameState) + '\n```';

  // 分片模拟 SSE 流
  const parts = [narrativeText.slice(0, 40), narrativeText.slice(40, 400), narrativeText.slice(400)];
  let fetchCalls = 0;
  window.fetch = async (url, opts) => {
    fetchCalls++;
    window.__lastRequest = { url, opts };
    let idx = 0;
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
      body: {
        getReader: () => ({
          read: async () => {
            if (idx >= parts.length) return { done: true, value: undefined };
            const line = 'data: ' + JSON.stringify({ choices: [{ delta: { content: parts[idx++] } }] }) + '\n\n';
            return { done: false, value: new TextEncoder().encode(line) };
          }
        })
      }
    };
  };

  $('playerInput').value = '我推开祭坛的大门';
  $('sendActionBtn').click();
  await sleep(600);

  if (fetchCalls === 1) pass('已发起 1 次 LLM 请求');
  else fail('fetch 调用次数异常: ' + fetchCalls);

  const req = window.__lastRequest;
  if (req && req.url === 'https://api.example.com/v1/chat/completions') pass('请求 URL 正确: ' + req.url);
  else fail('请求 URL 异常: ' + (req && req.url));
  if (req && JSON.parse(req.opts.body).stream === true) pass('已开启 stream: true');
  else fail('未开启流式');

  // 叙事渲染
  const container = $('narrativeContainer');
  const msgs = container.querySelectorAll('.narrative-msg');
  if (msgs.length === 2) pass('叙事区渲染了 2 条消息（玩家 + 世界）');
  else fail('叙事消息数异常: ' + msgs.length);

  const rendered = container.textContent;
  if (rendered.includes('你踏入了灰烬祭坛')) pass('模型文本已渲染');
  else fail('模型文本缺失');

  if (!rendered.includes('game_state')) pass('game_state 数据块已从正文剥离');
  else fail('game_state 数据块残留在正文里');

  // === 关键：XSS 必须被阻断 ===
  if (window.__pwned === undefined) pass('注入未执行（window.__pwned 未被赋值）');
  else fail('注入被执行！window.__pwned=' + window.__pwned);
  if (!container.innerHTML.includes('onerror')) pass('渲染结果中无 onerror 属性');
  else fail('渲染结果残留 onerror');

  // === HUD 契约：以前永远是空的四个页签 ===
  clickTab(doc, 'spells');
  if (secRef(doc, 'spells', 'body').textContent.includes('星火术')) pass('法术页签已填充: 星火术');
  else fail('法术未渲染');
  if (secRef(doc, 'skills', 'body').textContent.includes('野外追踪')) pass('技能已渲染: 野外追踪');
  else fail('技能未渲染');

  clickTab(doc, 'bag');
  if (secRef(doc, 'items', 'badge').textContent.includes('2')) pass('行囊计数正确 (' + secRef(doc, 'items', 'badge').textContent + ')');
  else fail('行囊计数异常: ' + secRef(doc, 'items', 'badge').textContent);
  if (secRef(doc, 'items', 'body').textContent.includes('暗金符文短匕')) pass('物品已渲染');
  else fail('物品未渲染');

  // 物品详情卡（此前是死代码）
  const firstItem = secRef(doc, 'items', 'body').querySelector('button[data-item-index]');
  if (firstItem) {
    firstItem.click();
    if (!secRef(doc, 'items', 'detail').classList.contains('hidden')) pass('点击物品后详情卡显示');
    else fail('详情卡未显示');
    if (secRef(doc, 'items', 'detailDesc').textContent.includes('符文')) pass('详情卡内容正确');
    else fail('详情卡内容异常: ' + secRef(doc, 'items', 'detailDesc').textContent);
  } else fail('未找到物品按钮');

  clickTab(doc, 'npc');
  if (secRef(doc, 'codex', 'body').textContent.includes('莉薇娅')) pass('NPC 图鉴已填充');
  else fail('NPC 未渲染');
  if (secRef(doc, 'codex', 'body').textContent.includes('55')) pass('情感数值已从列表解析 (好感度 55)');
  else fail('情感数值未解析');

  clickTab(doc, 'stats');
  if (secRef(doc, 'states', 'body').textContent.includes('中毒')) pass('状态效果已渲染（此前完全没人写入）');
  else fail('状态效果未渲染');
  if (secRef(doc, 'states', 'body').textContent.includes('鹰眼')) pass('多个状态效果均渲染');
  else fail('buff 状态缺失');
  if (secRef(doc, 'attrs', 'radar').querySelector('svg')) pass('属性饼图已渲染 SVG');
  else fail('属性饼图未渲染');

  // 存档落盘
  const story = window.localStorage.getItem('chronicle_slot_custom_1_story');
  if (story && story.includes('灰烬祭坛')) pass('叙事已持久化到 localStorage');
  else fail('叙事未落盘');
  const hudSaved = window.localStorage.getItem('chronicle_slot_custom_1_hud');
  if (hudSaved && JSON.parse(hudSaved).spells && JSON.parse(hudSaved).spells.length === 1) pass('HUD(含法术)已持久化');
  else fail('HUD 未正确落盘');

  // ---- D. 世界包导入（回归：以前会覆盖当前世界 + 导入内容丢失）----
  console.log('\n=== D. 世界包导入回归 ===');
  const beforeSlots = JSON.parse(window.localStorage.getItem('chronicle_user_slots') || '[]').length;
  const beforeLore = window.localStorage.getItem('chronicle_slot_custom_1_lore');

  const pack = {
    worldName: '导入的废土世界',
    desc: '辐射废土',
    lore: { world: '废土法则：辐射与变异', character: '', rules: '', memoryPins: '' },
    wizardConfig: { races: ['人类', '变种人'], classes: ['拾荒者'], identities: ['流浪者'], attributes: ['力量', '耐力'], pointBudget: 20, maxPerStat: 8 },
    hudState: Object.assign({}, gameState, { location: '废土营地' }),
    history: [{ role: 'user', text: '导入的历史', time: '00:00:00' }]
  };
  const file = new window.File([JSON.stringify(pack)], 'wasteland.json', { type: 'application/json' });
  const fileInput = $('slotJsonFileInput');
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
  fileInput.dispatchEvent(new window.Event('change'));
  await sleep(400);

  const afterSlots = JSON.parse(window.localStorage.getItem('chronicle_user_slots') || '[]');
  if (afterSlots.length === beforeSlots + 1) pass('新世界已加入列表 (' + beforeSlots + ' -> ' + afterSlots.length + ')');
  else fail('世界数量异常: ' + beforeSlots + ' -> ' + afterSlots.length);

  const newSlot = afterSlots[afterSlots.length - 1];
  if ($('headerSlotNameDisplay').textContent.includes('导入的废土世界')) pass('已切换到导入的世界');
  else fail('未切换到导入的世界: ' + $('headerSlotNameDisplay').textContent);

  const importedLore = window.localStorage.getItem('chronicle_' + newSlot.id + '_lore');
  if (importedLore && importedLore.includes('辐射与变异')) pass('导入的世界观已写入新槽位键');
  else fail('导入内容丢失: ' + importedLore);

  const importedHud = window.localStorage.getItem('chronicle_' + newSlot.id + '_hud');
  if (importedHud && JSON.parse(importedHud).location === '废土营地') pass('导入的 HUD 已写入新槽位键');
  else fail('导入 HUD 丢失');

  const importedStory = window.localStorage.getItem('chronicle_' + newSlot.id + '_story');
  if (importedStory && importedStory.includes('导入的历史')) pass('导入的推演历史已写入');
  else fail('导入历史丢失');

  // 最关键：原世界不能被污染
  const afterLore = window.localStorage.getItem('chronicle_slot_custom_1_lore');
  if (beforeLore === afterLore) pass('原世界存档未被污染（回归修复生效）');
  else fail('原世界存档被导入内容覆盖了！');

  if (secRef(doc, 'location', 'location').textContent.includes('废土营地')) pass('导入后 HUD 已刷新为导入数据');
  else fail('导入后 HUD 未刷新: ' + secRef(doc, 'location', 'location').textContent);

  // ---- E. 删除世界应清理孤儿键 ----
  console.log('\n=== E. 删除世界清理存档键 ===');
  $('openSlotModalBtn').click();
  const rows = $('slotsListContainer').querySelectorAll('button[data-slot-action="delete"]');
  if (rows.length >= 1) {
    const targetId = rows[0].dataset.slotId;
    rows[0].click();
    await sleep(150);
    const orphan = Object.keys(window.localStorage).filter(k => k.startsWith('chronicle_' + targetId + '_'));
    if (orphan.length === 0) pass('已删除世界的存档键被清理干净');
    else fail('仍残留孤儿键: ' + orphan.join(', '));
  } else fail('未找到删除按钮');

  // ---- G. 取消推演（AbortController 路径）----
  console.log('\n=== G. 取消推演 ===');
  window.fetch = async (url, opts) => {
    const signal = opts.signal;
    let sent = 0;
    const chunks = ['data: ' + JSON.stringify({ choices: [{ delta: { content: '推演到一半的内容' } }] }) + '\n\n'];
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
      body: {
        getReader: () => ({
          read: () => new Promise((resolve, reject) => {
            if (sent < chunks.length) {
              return resolve({ done: false, value: new TextEncoder().encode(chunks[sent++]) });
            }
            // 之后再无数据，直到被中止
            const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            if (signal.aborted) return onAbort();
            signal.addEventListener('abort', onAbort, { once: true });
          })
        })
      }
    };
  };

  $('playerInput').value = '测试取消推演';
  $('sendActionBtn').click();
  await sleep(300);

  if ($('sendBtnText').textContent.includes('取消')) pass('推演中按钮已变为「取消推演」');
  else fail('取消态按钮未生效: ' + $('sendBtnText').textContent);

  $('sendActionBtn').click();   // 触发取消
  await sleep(400);

  if ($('sendBtnText').textContent.includes('行动推演')) pass('取消后按钮已恢复');
  else fail('按钮未恢复: ' + $('sendBtnText').textContent);

  const afterCancel = $('narrativeContainer').textContent;
  if (afterCancel.includes('推演到一半的内容')) pass('已生成的部分内容被保留');
  else fail('部分内容被丢弃');
  if (afterCancel.includes('推演被中断')) pass('已标注中断提示');
  else fail('缺少中断提示');

  // 再次发送应当正常可用（未卡死）
  window.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
    body: {
      getReader: () => {
        let done = false;
        return {
          read: async () => {
            if (done) return { done: true };
            done = true;
            return { done: false, value: new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: '第二次推演成功' } }] }) + '\n\n') };
          }
        };
      }
    }
  });
  $('playerInput').value = '第二次行动';
  $('sendActionBtn').click();
  await sleep(400);
  if ($('narrativeContainer').textContent.includes('第二次推演成功')) pass('取消后仍可正常发起推演（未卡死）');
  else fail('取消后无法再次推演');

  // ---- F. 边界与回归 ----
  console.log('\n=== F. 边界与回归 ===');
  $('newSessionBtn').click();
  $('confirmResetBtn').click();
  await sleep(100);
  if (container.querySelector('#emptyStoryNotice')) pass('重置后回到空状态提示');
  else fail('重置后空状态异常');
  if (!window.__pwned) pass('全程无脚本注入执行');
  else fail('注入执行: ' + window.__pwned);

  const realErrors = consoleErrors.filter(e => !/AudioContext|Not implemented|Could not parse CSS|scrollTo/i.test(e));
  if (realErrors.length === 0) pass('无未预期的运行时错误');
  else { fail('存在运行时错误:'); realErrors.slice(0, 8).forEach(e => console.log('         ' + e.slice(0, 200))); }

  // ---- G. 模态框焦点陷阱 ----
  console.log('\n=== G. 模态框焦点陷阱 ===');
  {
    // 前置：前面的用例（E 打开过存档弹窗）会留下没关的弹窗。
    // 焦点归还的前提是"所有弹窗都关掉了"，不先清干净就测不出真实行为。
    const ALL_MODALS = ['wizardModal', 'slotModal', 'tacticsModal', 'apiModal', 'settingsModal',
      'attributeCapModal', 'resetConfirmModal', 'diceConfirmModal', 'manualHudModal', 'schemaModal'];
    ALL_MODALS.forEach(id => { if ($(id)) $(id).classList.add('hidden'); });
    await sleep(60);

    // jsdom 不实现 Tab 的默认行为（不会自动移动焦点），所以这里断言的是
    // "处理函数主动移动焦点"的两个绕回点，以及开/关时的焦点进出。
    const key = (k, shift) => doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, shiftKey: !!shift, bubbles: true }));
    const modal = $('apiModal');
    const SEL = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const visibleFocusables = (m) => [...m.querySelectorAll(SEL)]
      .filter(el => el.type !== 'hidden')
      .filter(el => {
        let n = el;
        while (n && n !== m) {
          if (n.classList && n.classList.contains('hidden')) return false;
          if (n.style && n.style.display === 'none') return false;
          n = n.parentElement;
        }
        return true;
      });

    if (ALL_MODALS.every(id => !$(id) || $(id).classList.contains('hidden'))) pass('前置清理：当前没有任何弹窗处于打开状态');
    else fail('前置清理失败，仍有弹窗开着');

    $('openApiSettingsBtn').focus();
    const beforeFocus = doc.activeElement;
    $('openApiSettingsBtn').click();
    await sleep(60);   // MutationObserver 是异步的

    if (!modal.classList.contains('hidden')) pass('API 弹窗已打开');
    else fail('API 弹窗未打开');
    if (modal.contains(doc.activeElement)) pass('打开弹窗后焦点被移入弹窗');
    else fail('焦点没有进入弹窗，仍在: ' + (doc.activeElement && doc.activeElement.tagName));

    const list = visibleFocusables(modal);
    if (list.length > 2) pass('弹窗内识别到 ' + list.length + ' 个可聚焦元素');
    else fail('可聚焦元素数量异常: ' + list.length);

    // 末尾按 Tab → 绕回第一个
    list[list.length - 1].focus();
    key('Tab');
    if (doc.activeElement === list[0]) pass('在最后一个元素上按 Tab 绕回第一个（不会跑到弹窗背后）');
    else fail('Tab 未绕回，焦点落在: ' + (doc.activeElement && (doc.activeElement.id || doc.activeElement.tagName)));

    // 开头按 Shift+Tab → 绕回最后一个
    list[0].focus();
    key('Tab', true);
    if (doc.activeElement === list[list.length - 1]) pass('在第一个元素上按 Shift+Tab 绕回最后一个');
    else fail('Shift+Tab 未绕回，焦点落在: ' + (doc.activeElement && (doc.activeElement.id || doc.activeElement.tagName)));

    // 被隐藏的子元素必须排除在循环之外
    const tail = list[list.length - 1];
    tail.classList.add('hidden');
    const list2 = visibleFocusables(modal);
    if (list2.length === list.length - 1) pass('隐藏一个元素后，可聚焦集合随之缩小（说明隐藏项被排除）');
    else fail('隐藏项仍在可聚焦集合里: ' + list2.length + ' vs ' + list.length);
    list2[list2.length - 1].focus();
    key('Tab');
    if (doc.activeElement === list2[0]) pass('按 Tab 时跳过被隐藏的元素，直接绕回第一个');
    else fail('被隐藏的元素仍被当作循环终点');
    tail.classList.remove('hidden');

    // Esc 关闭后焦点应还给打开弹窗的那个元素
    key('Escape');
    await sleep(60);
    if (modal.classList.contains('hidden')) pass('Esc 仍能关闭弹窗（原有行为未被破坏）');
    else fail('Esc 关闭失效');
    if (doc.activeElement === beforeFocus) pass('关闭弹窗后焦点回到原处: ' + (beforeFocus.id || beforeFocus.tagName));
    else fail('焦点未归还，落在: ' + (doc.activeElement && (doc.activeElement.id || doc.activeElement.tagName)));

    // 没有弹窗时，Tab 不应被拦截
    const freeTab = new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    doc.dispatchEvent(freeTab);
    if (!freeTab.defaultPrevented) pass('无弹窗时不拦截 Tab（不影响主界面键盘操作）');
    else fail('无弹窗时也拦截了 Tab');
  }

  // ---- H. game_state 数据块：漏块 / 非标准围栏 / 自动补全 ----
  console.log('\n=== H. game_state 数据块：漏块、非标准围栏与自动补全 ===');
  {
    // 这一组原先整组在测"建议行动"栏位。用户明确表示不需要那三个栏位
    //（他要的是一个不替他做决定的 GM），栏位已整体移除：
    // 先钉住"移除得干净"，再验证真正该保住的东西 —— 漏块不静默、围栏不标准也认、只补一次。
    if ($('suggestedActionsRow') === null && $('actionChips') === null) {
      pass('建议行动栏位与容器已从界面移除');
    } else fail('建议栏位仍在 DOM 里');
    if (!/下一步行动推荐|按键 1 \/ 2 \/ 3/.test(doc.body.textContent)) pass('连文案与 1/2/3 快捷键说明也一并移除');
    else fail('界面上仍残留建议行动文案');

    let nextState = {};
    let lastSystem = '';

    $('openApiSettingsBtn').click();
    $('apiProviderSelect').value = 'openai_compatible';
    $('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
    $('apiKeyInput').value = 'sk-x';
    $('saveApiConfigBtn').click();

    window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      lastSystem = (body.messages && body.messages[0] && body.messages[0].content) || '';
      const text = 'GM 正文。\n\n```game_state\n' + JSON.stringify(nextState) + '\n```';
      return {
        ok: true, status: 200,
        headers: { get: () => 'text/event-stream' },
        body: {
          getReader: () => {
            let done = false;
            return { read: async () => { if (done) return { done: true }; done = true; return { done: false, value: new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n') }; } };
          }
        }
      };
    };
    const doTurn = async (label, state) => {
      nextState = state;
      $('playerInput').value = label;
      $('sendActionBtn').click();
      await sleep(420);
    };

    await doTurn('往祭坛里走', { location: '祭坛' });

    // H7 提示词：不能再有建议行动的残留要求；同时必须带上新的口吻硬性要求
    if (!/suggested_actions/.test(lastSystem)) pass('提示词里已彻底不再出现 suggested_actions');
    else fail('提示词仍有 suggested_actions 残留');
    if (/叙事口吻（硬性要求/.test(lastSystem)) pass('提示词带有【叙事口吻】硬性要求');
    else fail('提示词缺少叙事口吻要求');
    for (const bad of ['不扣积分', '新手礼', '建议你', '你可以选择', '说明书腔']) {
      if (lastSystem.includes(bad)) pass(`口吻要求点名了「${bad}」`);
      else fail(`口吻要求缺少「${bad}」`);
    }
    // H7b 口吻禁令只能管"GM 自己的旁白语域"：不能把「系统/任务/奖励/面板」这类
    // 剧中存在一起禁掉。用户的世界观是系统流（金手指系统发布任务、结算奖励、给面板），
    // 禁掉这些词模型就只能把系统写成哑巴（实测过："系统在你意识里沉了声……不是那种会
    // 说话的东西"），开局整回合零任务零奖励。
    const banScope = lastSystem.slice(
      lastSystem.indexOf('不要用客服、策划、说明书'),
      lastSystem.indexOf('玩家在故事里，不在菜单里'));
    for (const w of ['系统', '任务', '奖励', '面板']) {
      if (banScope.length > 0 && !banScope.includes(w)) pass(`禁用词表不再波及剧中存在「${w}」`);
      else fail(`禁用词表把「${w}」也禁了（系统流世界观会被写成哑巴）`);
    }
    if (/让它按设定正常说话/.test(lastSystem)) pass('提示词要求剧中存在的系统照设定正常说话');
    else fail('提示词缺少"剧中系统正常说话"的要求');
    // B2 之后正文不再需要任何机制块：提示词里不该再出现"在正文中输出角色卡 / 情感状态列表"，
    // 数值全部走 game_state（npc_codex 的示例必须带上蓝图声明的维度与变动键）。
    if (!/【角色卡—姓名】|情感状态列表/.test(lastSystem)) pass('正文不再被要求输出角色卡 / 情感状态清单（数值全部走 game_state）');
    else fail('提示词仍在要求正文输出机制清单，与口吻要求互相矛盾');
    if (/"affection":\s*50/.test(lastSystem) && /"affDelta":\s*2/.test(lastSystem)) pass('npc_codex 契约已带上关系维度与变动键（蓝图派生）');
    else fail('npc_codex 契约缺少关系维度/变动键');
    if (/全部只写在 game_state 里/.test(lastSystem)) pass('提示词明确要求数值只写进 game_state');
    else fail('提示词没有要求数值只走数据块');

    // ---- H8 上一版漏掉的关键场景：模型整段 game_state 都没输出 ----
    // 这时 applyGameState(null) 会在第一行 return，HUD 停在原地，
    // 玩家只看到"场景推进了、右边一动不动"，而且**完全没有提示**（最要命的其实是这个静默）。
    const RAW = (state, fence) => 'GM 正文。\n\n```' + fence + '\n' + JSON.stringify(state) + '\n```';
    const rawTurn = async (label, text) => {
      nextState = null;
      window.__rawText = text;
      $('playerInput').value = label;
      $('sendActionBtn').click();
      await sleep(420);
    };
    // 让 fetch 直接返回指定原文（而不是复用 nextState）
    const origFetch = window.fetch;
    window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      lastSystem = (body.messages && body.messages[0] && body.messages[0].content) || '';
      const text = window.__rawText;
      return {
        ok: true, status: 200,
        headers: { get: () => 'text/event-stream' },
        body: { getReader: () => { let d = false; return { read: async () => { if (d) return { done: true }; d = true; return { done: false, value: new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n') }; } }; } }
      };
    };

    await doTurn('先站定', { location: '祭坛' });
    if ((secRef(doc, 'location', 'location') || {}).textContent.includes('祭坛')) pass('前置：地点为祭坛');
    else fail('前置失败，地点不是祭坛');

    await rawTurn('完全不带 game_state 的一回合', 'GM 只是写了正文，没有任何数据块。');
    if ((secRef(doc, 'location', 'location') || {}).textContent.includes('祭坛')) {
      pass('模型整段没给 game_state → 数值维持原状（不会因为漏块就把状态清空）');
    } else fail('漏块时数值被清掉了: ' + (secRef(doc, 'location', 'location') || {}).textContent);
    if (/本回合右侧数值未刷新|自动补全也没成功/.test($('toastContainer').textContent)) pass('同时明确提示"为什么界面没刷新"（以前是完全静默的）');
    else fail('没有给出"未刷新"的提示: ' + $('toastContainer').textContent.replace(/\s+/g, ' ').slice(0, 120));

    // ---- H9 围栏标签不标准（```json）时也必须认，否则整个 HUD 永远不动 ----
    await rawTurn('标签写成 json', 'GM 正文。\n\n```json\n' + JSON.stringify({ location: '冰原' }) + '\n```');
    if (secRef(doc, 'location', 'location') && secRef(doc, 'location', 'location').textContent.includes('冰原')) pass('围栏标签写成 ```json 也能识别并刷新（否则 HUD 会永远卡住）');
    else fail('标签不标准时没有识别: ' + (secRef(doc, 'location', 'location') || {}).textContent);

    // ---- H10 无关的 json 块不能被误当成 game_state ----
    await rawTurn('正文里带无关 json', 'GM 正文。\n\n```json\n{"foo":"bar","count":1}\n```\n继续叙述。');
    if ((secRef(doc, 'location', 'location') || {}).textContent.includes('冰原')) pass('无关的 json 块不会被误判成 game_state（地点没有被乱改）');
    else fail('无关 json 被误判: ' + (secRef(doc, 'location', 'location') || {}).textContent);

    // ---- H11 漏了就自动补一次（治本之外的最后一道保险）----
    // 让第 1 次调用返回没有数据块的正文，第 2 次（补数据块的请求）返回合法 JSON
    let repairCallCount = 0;
    window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      lastSystem = (body.messages && body.messages[0] && body.messages[0].content) || '';
      const isRepair = /漏掉了 game_state 数据块/.test(JSON.stringify(body));
      if (isRepair) repairCallCount++;
      const text = isRepair
        ? '```game_state\n{"location":"补出来的地点"}\n```'
        : 'GM 这次忘了写数据块。';
      return {
        ok: true, status: 200,
        headers: { get: () => 'text/event-stream' },
        body: { getReader: () => { let d = false; return { read: async () => { if (d) return { done: true }; d = true; return { done: false, value: new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n') }; } }; } }
      };
    };
    $('toastContainer').innerHTML = '';
    $('playerInput').value = '触发自动补全';
    $('sendActionBtn').click();
    await sleep(900);

    if (repairCallCount === 1) pass('检测到漏数据块后，自动发起了 1 次补全请求');
    else fail('补全请求次数异常: ' + repairCallCount);
    if (secRef(doc, 'location', 'location').textContent.includes('补出来的地点')) pass('补全回来的数据块已生效（地点已更新）');
    else fail('补全结果未生效: ' + (secRef(doc, 'location', 'location') || {}).textContent);
    if (/已自动补全并刷新/.test($('toastContainer').textContent)) pass('明确告知玩家"已自动补全"（不再是静默失败）');
    else fail('没有补全成功的提示: ' + $('toastContainer').textContent.replace(/\s+/g, ' ').slice(0, 80));

    // 正文不能被补全流程吞掉或报错
    if ($('narrativeContainer').textContent.includes('GM 这次忘了写数据块')) pass('正文照常显示，补全流程没有影响它');
    else fail('正文丢失');

    // ---- H12 补全也失败时：只提示、不崩、不无限重试 ----
    const before = repairCallCount;
    window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      const isRepair = /漏掉了 game_state 数据块/.test(JSON.stringify(body));
      if (isRepair) repairCallCount++;
      const text = isRepair ? '抱歉，我还是没给出数据块。' : 'GM 又忘了写数据块。';
      return {
        ok: true, status: 200,
        headers: { get: () => 'text/event-stream' },
        body: { getReader: () => { let d = false; return { read: async () => { if (d) return { done: true }; d = true; return { done: false, value: new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n') }; } }; } }
      };
    };
    $('toastContainer').innerHTML = '';
    $('playerInput').value = '补全也失败的一回合';
    $('sendActionBtn').click();
    await sleep(900);
    if (repairCallCount === before + 1) pass('补全失败时只重试一次，不会反复轰炸 API');
    else fail('重试次数异常: ' + (repairCallCount - before));
    if (/自动补全也没成功/.test($('toastContainer').textContent)) pass('补全失败时如实告知，且给出"本回合未刷新"');
    else fail('补全失败没有提示: ' + $('toastContainer').textContent.replace(/\s+/g, ' ').slice(0, 80));
    if (/GM 又忘了写数据块/.test($('narrativeContainer').textContent)) pass('补全失败也不影响正文落盘');
    else fail('补全失败时正文丢失');

    // ---- H13 提示词末尾的硬性要求 ----
    if (/输出格式硬性要求（最高优先级/.test(lastSystem)) pass('提示词末尾已附加最高优先级的格式硬性要求');
    else fail('提示词末尾缺少硬性要求');
    if (/缺少该数据块视为回复不合格/.test(lastSystem)) pass('明确写清"缺少数据块 = 回复不合格"');
    else fail('缺少后果说明');
    const iHard = lastSystem.indexOf('输出格式硬性要求（最高优先级');
    const iDigest = lastSystem.indexOf('系统记录的当前数值');
    if (iHard > iDigest) pass('该要求在提示词最末尾（模型注意力最强的位置）');
    else fail(`硬性要求位置不对: hard=${iHard} digest=${iDigest}`);

    window.fetch = origFetch;
  }

  // ---- I. NPC 卡片默认折叠 ----
  console.log('\n=== I. NPC 卡片：默认折叠，点击展开 ===');
  {
    const cards = () => [...doc.querySelectorAll('[data-npc-card]')];
    const detailOf = (c) => c.querySelector('[data-npc-detail]');
    const toggleOf = (c) => c.querySelector('[data-npc-toggle]');
    const chevOf = (c) => c.querySelector('[data-npc-chevron]');
    const isOpen = (c) => !detailOf(c).classList.contains('hidden');

    const npcTurn = async (label, stateDims) => {
      window.fetch = async () => {
        const npc = { name: '莉薇娅', race: '人类', personality: '冷静', love_type: '盟友' };
        if (stateDims) Object.assign(npc, stateDims);
        // stateDims 模式下刻意让正文一个数值都没有：验证"数值只走数据块"这条新契约
        const text = stateDims
          ? 'GM 正文，正文里没有任何数值。\n\n```game_state\n' + JSON.stringify({ npc_codex: [npc] }) + '\n```'
          : [
            'GM 正文。',
            '',
            '情感状态列表：',
            '【莉薇娅】',
            '好感度：55（变动：+5）信任度：40（变动：0）肉欲度：10（变动：0）情感深度：20（变动：+1）',
            '',
            '```game_state',
            JSON.stringify({ npc_codex: [{ name: '莉薇娅', race: '人类', personality: '冷静', love_type: '盟友' }] }),
            '```'
          ].join('\n');
        return {
          ok: true, status: 200,
          headers: { get: () => 'text/event-stream' },
          body: { getReader: () => { let d = false; return { read: async () => { if (d) return { done: true }; d = true; return { done: false, value: new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n') }; } }; } }
        };
      };
      $('playerInput').value = label;
      $('sendActionBtn').click();
      await sleep(450);
    };

    await npcTurn('第一回合');
    if (cards().length >= 1) pass('NPC 卡片已渲染（' + cards().length + ' 张）');
    else fail('没有渲染出 NPC 卡片');

    // 默认必须折叠
    if (cards().every(c => !isOpen(c))) pass('默认全部折叠（详细信息不占空间）');
    else fail('默认没有折叠');
    if (chevOf(cards()[0]).textContent === '▸') pass('折叠态显示 ▸ 箭头指示可展开');
    else fail('折叠态箭头异常: ' + JSON.stringify(chevOf(cards()[0]).textContent));
    if (toggleOf(cards()[0]).getAttribute('aria-expanded') === 'false') pass('折叠态 aria-expanded=false（读屏可识别）');
    else fail('缺少 aria-expanded 或值不对');

    // 点击标题展开
    toggleOf(cards()[0]).click();
    await sleep(60);
    if (isOpen(cards()[0])) pass('点击 NPC 名字后展开');
    else fail('点击后没有展开');
    if (chevOf(cards()[0]).textContent === '▾') pass('展开态箭头变为 ▾');
    else fail('展开态箭头异常: ' + JSON.stringify(chevOf(cards()[0]).textContent));
    if (toggleOf(cards()[0]).getAttribute('aria-expanded') === 'true') pass('展开态 aria-expanded=true');
    else fail('展开后 aria-expanded 未更新');
    const detailText = detailOf(cards()[0]).textContent.replace(/\s+/g, ' ');
    if (/好感度 \(55\/100\)/.test(detailText)) pass('展开后能看到关系数值（兼容路径：老契约的正文情感状态列表仍能解析）');
    else fail('展开后数值异常: ' + detailText.slice(0, 80));

    // B2 新契约：正文一个数值都不写，关系数值直接由 game_state.npc_codex 驱动
    await npcTurn('第三回合（数值只走数据块）', { affection: 77, affDelta: 9 });
    const stateDriven = detailOf(cards()[0]).textContent.replace(/\s+/g, ' ');
    if (/好感度 \(77\/100\)/.test(stateDriven) && /变动: \+9/.test(stateDriven)) pass('关系数值可直接由 game_state.npc_codex 驱动（正文无需任何机制块）');
    else fail('game_state 路径没有更新关系数值: ' + stateDriven.slice(0, 90));

    // 关键：renderHud 每回合整段重建，展开状态必须活下来
    await npcTurn('第二回合');
    if (cards().length >= 1 && isOpen(cards()[0])) pass('下一回合整段重建后，展开状态被保留（状态不在 DOM 上）');
    else fail('重建后展开状态丢了');
    if (chevOf(cards()[0]).textContent === '▾') pass('重建后箭头仍与展开状态一致');
    else fail('重建后箭头状态不一致');

    // 「面板 / 亲密」按钮不能被折叠开关吃掉
    const before = $('playerInput').value;
    cards()[0].querySelector('button[data-npc-name][data-npc-mode="status"]').click();
    await sleep(60);
    if (/查看莉薇娅面板/.test($('playerInput').value)) pass('「面板」按钮仍然正常工作（没被折叠开关拦截）');
    else fail('「面板」按钮失效: ' + $('playerInput').value);
    if (isOpen(cards()[0])) pass('点「面板」不会顺带把卡片折叠掉');
    else fail('点「面板」误触发了折叠');

    // 再点一次收起
    toggleOf(cards()[0]).click();
    await sleep(60);
    if (!isOpen(cards()[0])) pass('再次点击可收起');
    else fail('再次点击没有收起');
  }

  // ---- J. 文件导入：拖拽落点路由 + GM 规则导入 ----
  console.log('\n=== J. 文件导入：拖拽落点与 GM 规则 ===');
  {
    const sidebar = $('leftSidebar');
    const overlay = $('sidebarDropOverlay');
    const rulesBlock = $('rulesDropBlock');
    const rulesInput = $('rulesInput');
    const loreInput = $('worldLoreInput');

    // jsdom 没有 DragEvent / DataTransfer：手工造事件再挂一个假 dataTransfer
    // （与 test-schema 里那几组拖拽排序测试同一套办法）
    const dragEvent = (type, target, file) => {
      const ev = new window.Event(type, { bubbles: true, cancelable: true });
      ev.dataTransfer = { files: file ? [file] : [], dropEffect: '', effectAllowed: '', setData() {} };
      target.dispatchEvent(ev);
      return ev;
    };
    const textFile = (name, text) => new window.File([text], name, { type: 'text/plain' });
    const jsonFile = (name, obj) => new window.File([JSON.stringify(obj)], name, { type: 'application/json' });
    const savedLore = () => JSON.parse(
      window.localStorage.getItem('chronicle_' + window.localStorage.getItem('chronicle_active_slot_id') + '_lore') || '{}'
    );
    const toastText = () => $('toastContainer').textContent;

    if (rulesBlock && $('rulesFileInput')) pass('GM 规则有自己的落点与选文件入口');
    else fail('缺少 rulesDropBlock / rulesFileInput');

    // 先存一份已知内容，用来验证"导入规则不会连带覆盖世界法则"
    loreInput.value = '原有世界法则';
    rulesInput.value = '原有规则';
    $('saveLoreBtn').click();

    // 1) 拖到 GM 规则栏：只高亮这一块，不显示"导入世界设定"的整栏遮罩
    dragEvent('dragenter', sidebar);
    dragEvent('dragover', rulesInput);
    if (rulesBlock.hasAttribute('data-drop-active')) pass('拖到规则栏时该栏高亮');
    else fail('拖到规则栏没有高亮');
    if (overlay.classList.contains('hidden')) pass('拖到规则栏时不显示整栏"导入世界设定"遮罩（落点不误导）');
    else fail('拖到规则栏仍盖着整栏遮罩');

    // 2) 拖到左侧栏其它位置：回到"整份世界设定"落点
    dragEvent('dragover', loreInput);
    if (!rulesBlock.hasAttribute('data-drop-active') && !overlay.classList.contains('hidden')) {
      pass('拖到其它位置时落点提示切回整份世界设定');
    } else fail('落点提示没有跟着落点切换');

    // 3) 真的丢下一个规则文件
    dragEvent('drop', rulesInput, textFile('table-rules.md', '判定：一律 2d6 + 修正值'));
    await sleep(150);
    if (rulesInput.value === '判定：一律 2d6 + 修正值') pass('拖拽导入 GM 规则成功');
    else fail('拖拽导入后规则栏内容异常: ' + JSON.stringify(rulesInput.value));
    if (savedLore().rules === '判定：一律 2d6 + 修正值') pass('导入的规则已直接落盘（不必再点保存）');
    else fail('导入的规则没有落盘: ' + JSON.stringify(savedLore().rules));
    if (savedLore().world === '原有世界法则') pass('只替换规则栏，没有连带覆盖世界法则');
    else fail('导入规则时把世界法则也改了: ' + JSON.stringify(savedLore().world));
    if (!rulesBlock.hasAttribute('data-drop-active') && overlay.classList.contains('hidden')) {
      pass('丢下之后高亮与遮罩都收干净（不会留下不消失的遮罩）');
    } else fail('drop 之后遮罩/高亮没有清理');

    // 4) 世界包 JSON 里的 rules 字段同样能取出来
    dragEvent('drop', rulesInput, jsonFile('pack.json', { lore: { world: '别的世界', rules: '来自世界包的规则' } }));
    await sleep(150);
    if (rulesInput.value === '来自世界包的规则') pass('从 .json 的 lore.rules 导入规则');
    else fail('.json 规则导入异常: ' + JSON.stringify(rulesInput.value));
    if (savedLore().world === '原有世界法则') pass('从 .json 取规则同样不会覆盖世界法则');
    else fail('.json 导入把世界法则覆盖了');

    // 5) 没有 rules 字段的 JSON：明确报错，而不是把整包 JSON 灌进规则栏
    const rulesSnapshot = rulesInput.value;
    dragEvent('drop', rulesInput, jsonFile('no-rules.json', { worldName: '无规则的世界' }));
    await sleep(150);
    if (rulesInput.value === rulesSnapshot) pass('无 rules 字段的 JSON 不会把整包内容灌进规则栏');
    else fail('无 rules 字段的 JSON 污染了规则栏');
    if (/没有 GM 规则字段/.test(toastText())) pass('无 rules 字段时给出明确指引（而不是静默失败）');
    else fail('无 rules 字段时没有提示');

    // 6) 选文件导入走的是同一套导入逻辑
    const pickInput = $('rulesFileInput');
    Object.defineProperty(pickInput, 'files', { value: [textFile('picked.txt', '选文件导入的规则')], configurable: true });
    pickInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await sleep(150);
    if (rulesInput.value === '选文件导入的规则') pass('「导入文件」这条路也能导入规则');
    else fail('选文件导入规则失败: ' + JSON.stringify(rulesInput.value));

    // 7) 左侧栏其它位置丢文件仍然按"整份世界设定"处理（原功能不能被改坏）
    // 纯文本导入会顺手调一次 API 分析；这条用例只验证落点，所以用桩把请求按住，
    // 并临时闭嘴那条"分析失败"的 warn —— 它在这里是预期噪音，不是被测对象。
    window.fetch = async () => { throw new Error('测试桩：这条用例不需要真的分析世界观'); };
    const origWarn = window.console.warn;
    window.console.warn = () => {};
    dragEvent('drop', loreInput, textFile('world.md', '一个全新的世界法则'));
    await sleep(200);
    window.console.warn = origWarn;
    if (loreInput.value === '一个全新的世界法则') pass('拖到其它位置仍按整份世界设定导入（原落点没被改坏）');
    else fail('世界设定落点被改坏了: ' + JSON.stringify(loreInput.value));
  }

  // ---- K. NPC 卡片：名字完整显示，关系定位（介绍）收进展开区 ----
  console.log('\n=== K. NPC 卡片：名字不被截断，关系定位收进展开区 ===');
  {
    const LONG_NAME = '阿列克谢·冯·霍恩海姆';
    const LONG_TYPE = '表面冷淡、内心其实非常在意';

    window.fetch = async () => {
      const text = 'GM 正文。\n\n```game_state\n' + JSON.stringify({
        npc_codex: [{ name: LONG_NAME, race: '人类', personality: '多疑', love_type: LONG_TYPE }]
      }) + '\n```';
      return {
        ok: true, status: 200,
        headers: { get: () => 'text/event-stream' },
        body: { getReader: () => { let d = false; return { read: async () => { if (d) return { done: true }; d = true; return { done: false, value: new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n') }; } }; } }
      };
    };
    $('playerInput').value = '试探他的态度';
    $('sendActionBtn').click();
    await sleep(500);
    clickTab(doc, 'npc');
    await sleep(80);

    const card = [...doc.querySelectorAll('[data-npc-card]')].find(c => c.textContent.includes(LONG_NAME));
    if (!card) fail('没有渲染出长名字的 NPC 卡片');
    else {
      const header = card.firstElementChild;
      const detail = card.querySelector('[data-npc-detail]');
      const nameEl = [...card.querySelectorAll('span')].find(s => s.textContent === LONG_NAME);

      if (nameEl && !nameEl.classList.contains('truncate') && nameEl.classList.contains('break-words')) {
        pass('名字不再用 truncate 截断（改为 break-words，长名换行完整显示）');
      } else fail('名字仍是截断样式: ' + (nameEl && nameEl.className));
      if (nameEl && header.contains(nameEl)) pass('名字完整保留在标题行（不是被裁掉的残段）');
      else fail('名字不在标题行里');

      // 关系定位（介绍）必须落在展开区，而不是标题行里和名字抢宽度
      const badgeInHeader = [...header.querySelectorAll('span')].some(s => s.textContent === LONG_TYPE);
      const badgeInDetail = !!detail && detail.textContent.includes(LONG_TYPE);
      if (!badgeInHeader && badgeInDetail) pass('关系定位（介绍）已移入详情区，不再与名字争宽度');
      else fail(`关系定位位置不对（标题行内: ${badgeInHeader} / 详情内: ${badgeInDetail}）`);
      if (detail && detail.classList.contains('hidden')) pass('默认折叠：关系定位与关系数值一起收起');
      else fail('默认没有折叠');

      card.querySelector('[data-npc-toggle]').click();
      await sleep(60);
      if (detail && !detail.classList.contains('hidden') && detail.textContent.includes(LONG_TYPE)) {
        pass('展开后能看到关系定位（介绍）与关系数值');
      } else fail('展开后看不到关系定位');

      // 种族 / 性格：蓝图 infoFields 声明的静态字段，跟着详情一起折叠
      if (detail && detail.textContent.includes('种族：人类') && detail.textContent.includes('性格：多疑')) {
        pass('种族 / 性格 已按蓝图渲染在展开区');
      } else fail('种族 / 性格 未渲染: ' + (detail ? detail.textContent.slice(0, 120) : '(无详情块)'));
      if (detail && !header.textContent.includes('种族：')) {
        pass('静态字段不在标题行（不与名字抢宽度，只随详情出现）');
      } else fail('静态字段跑到了标题行');

      // 折叠开关不能吃掉那两个"秘密查看"按钮
      const statusBtn = card.querySelector('button[data-npc-name][data-npc-mode="status"]');
      if (statusBtn && header.contains(statusBtn)) pass('「👁️ 面板」按钮仍在标题行（未被折叠开关吃掉）');
      else fail('「面板」按钮不见了');
      if (header.lastElementChild.contains(statusBtn)) pass('按钮组独立在标题行右侧，不与名字共用一段宽度');
      else fail('按钮组位置异常');
    }
  }

  // ---- L. 高亮词汇跨模块全功能联动 ----
  console.log('\n=== L. 高亮词汇跨模块全功能联动（浮层操作卡 + 底部高亮联动条 + 造句实战命中解锁）===');
  {
    window.fetch = async () => {
      const text = 'Chloe smiles: "We should **build on that** and **think outside the box** for the mixer."\n\n```game_state\n' + JSON.stringify({
        bars: [{ label: '流利度 (Fluency)', current: 70, max: 100, color: 'emerald' }],
        skills: {
          known: ['settle in (安顿适应下来)'],
          unknown: ['build on that (在此基础上补充)']
        }
      }) + '\n```';
      return {
        ok: true, status: 200,
        headers: { get: () => 'text/event-stream' },
        body: { getReader: () => { let d = false; return { read: async () => { if (d) return { done: true }; d = true; return { done: false, value: new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n') }; } }; } }
      };
    };
    $('playerInput').value = 'Let us discuss the club plan.';
    $('sendActionBtn').click();
    await sleep(500);

    const strongs = [...doc.querySelectorAll('#narrativeContainer .prose strong')];
    const targetStrong = strongs.find(el => el.textContent.includes('build on that'));
    const newStrong = strongs.find(el => el.textContent.includes('think outside the box'));

    if (targetStrong && targetStrong.dataset.hlState === 'unknown') {
      pass('正文高亮词自动同步 HUD 技能库状态（待激活词显示 data-hl-state="unknown"）');
    } else {
      fail('正文高亮词未同步状态: ' + (targetStrong && targetStrong.dataset.hlState));
    }

    const activeBar = $('activeHighlightBar');
    if (activeBar && !activeBar.classList.contains('hidden') && activeBar.textContent.includes('build on that')) {
      pass('底部操控台渲染了本幕高亮词联动条 (#activeHighlightBar)');
    } else {
      fail('底部高亮词联动条未正常渲染');
    }

    // 点击高亮词打开联动浮层
    if (newStrong) {
      newStrong.click();
      await sleep(50);
      const pop = $('highlightWordPopover');
      if (pop && !pop.classList.contains('hidden') && $('hlPopoverTerm').textContent === 'think outside the box') {
        pass('点击正文高亮词弹出 #highlightWordPopover 联动工作台');
      } else {
        fail('点击高亮词未弹出联动工作台');
      }

      // 测试「钉入记忆锚点」联动
      const pinBtn = pop.querySelector('[data-action="hl-pop-pin"]');
      if (pinBtn) {
        pinBtn.click();
        await sleep(50);
        if ($('memoryPinsInput').value.includes('think outside the box')) {
          pass('点击「钉入记忆锚点」成功将高亮词及原句写入左栏长线记忆锚点');
        } else {
          fail('钉入记忆锚点未生效');
        }
      }

      // 测试「填入造句实战」联动 + 底部高亮条实时命中变绿
      const insertBtn = pop.querySelector('[data-action="hl-pop-insert"]');
      if (insertBtn) {
        insertBtn.click();
        await sleep(50);
        if ($('playerInput').value.includes('think outside the box') && activeBar.textContent.includes('已命中')) {
          pass('点击「填入造句实战」自动填入输入框，且底部高亮词胶囊实时变绿提示「已命中」');
        } else {
          fail('填入造句或实时命中检测未生效: ' + $('playerInput').value);
        }
      }
    }

    // 测试玩家发送包含目标高亮词的句子时，自动解锁至 skills.known 并提升流利度
    $('playerInput').value = 'I agree, let us build on that and think outside the box right now!';
    $('sendActionBtn').click();
    await sleep(500);

    if (targetStrong && targetStrong.dataset.hlState === 'known') {
      pass('玩家造句使用高亮词发送后，自动将其从待激活升级为「已掌握 (known)」并同步更新正文高亮徽章');
    } else {
      fail('造句使用高亮词后未自动升级为 known: ' + (targetStrong && targetStrong.dataset.hlState));
    }
  }

  console.log('\n===== ' + (failures === 0 ? '全部通过' : failures + ' 项失败') + ' =====');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
  console.log('\n[FATAL] 测试脚本异常: ' + e.stack);
  process.exit(1);
});
