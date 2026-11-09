// CSS 覆盖率验证：把应用驱动到各种界面状态，收集真实出现在 DOM 上的 class，
// 再逐一核对生成的 tailwind.css 里是否有对应规则。这是"看不见界面"时的安全网。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', 'src');
const HTML_PATH = SRC + '/index.html';
const PURIFY = SRC + '/vendor/purify.min.js';
const MARKED = SRC + '/vendor/marked.min.js';
const TW_CSS = SRC + '/vendor/tailwind.css';

const cssText = fs.readFileSync(TW_CSS, 'utf8');
// Tailwind 会转义选择器里的特殊字符（.pb-1\.5 / .sm\:grid-cols-4 / .bg-slate-900\/70），
// 比对前先去掉反斜杠，否则这些类会被误判为"缺失"
const cssFlat = cssText.replace(/\\/g, '');

// 复用公共引导模块内联资源（它已修正 String.replace 的 $& 陷阱）
const { buildHtml, secRef, sectionEl } = require('./harness');
const html = buildHtml({ injectCss: true });

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://app.local/' });
const { window } = dom;
const doc = window.document;
  const ref = (n) => doc.querySelector(`[data-ref="${n}"]`);

const $ = (id) => doc.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const seenClasses = new Map();   // class -> 第一次出现的上下文
function snapshot(label) {
  doc.querySelectorAll('*').forEach(el => {
    const list = el.classList;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!seenClasses.has(c)) seenClasses.set(c, label);
    }
  });
}

// 已知的自定义类（来自 index.html 内联 <style>），不属于 Tailwind
const CUSTOM = new Set([
  'hl-mode-tag', 'hl-mode-marker', 'hl-mode-neon', 'privacy-shield-active', 'privacy-sensitive',
  'bar-fill', 'animate-pulse-dot', 'writing-vertical', 'btn-deduce', 'stream-caret',
  'user-balloon', 'prose', 'prose-invert',
  'accordion-trigger', 'accordion-arrow', 'style-mode-btn', 'hud-tab-btn', 'narrative-msg',
  // 仅作 DOM 查询钩子、刻意不带样式
  'stream-time', 'stream-body',
]);

(async () => {
  for (let i = 0; i < 60; i++) {
    if (doc.querySelectorAll('#hudTabBar .hud-tab-btn').length > 0) break;
    await sleep(25);
  }
  snapshot('启动');

  // 配上 API 以便走完整回合
  $('openApiSettingsBtn').click();
  snapshot('API 弹窗');
  $('apiProviderSelect').value = 'openai_compatible';
  $('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
  $('apiKeyInput').value = 'sk-x';
  $('saveApiConfigBtn').click();

  // 打一个回合，带丰富的 game_state，触发各 HUD 渲染分支
  window.fetch = async () => {
    const text = '你踏入祭坛。\n\n```game_state\n' + JSON.stringify({
      location: '祭坛', time: '深夜',
      character_profile: { name: '伊莱亚斯', race: '精灵', class: '游侠', identity: '雇佣兵', gender: '男', age: '24', appearance: '银发，左肩有旧伤，披着磨损的旅行斗篷' },
      bars: [
        { label: '生命 (HP)', current: 72, max: 90, color: 'rose' },
        { label: '能量 (MP)', current: 30, max: 50, color: 'cyan' },
        { label: '体力', current: 5, max: 10, color: 'emerald' },
        { label: '理智', current: 8, max: 10, color: 'amber' },
      ],
      attributes: { 力量: { current: 12, max: 20 }, 敏捷: { current: 16, max: 20 }, 感知: { current: 14, max: 20 }, 智力: { current: 11, max: 20 }, 体质: { current: 13, max: 20 } },
      weapon_mastery: { 弓术: { level: '精通', exp: 40 }, 匕首: { level: '传说', exp: 90 }, 剑类: { level: '生疏' } },
      spells: [{ name: '星火术', ring: '一环', mp: 8, desc: 'd' }],
      skills: { known: ['野外追踪'], unknown: ['古代语'] },
      inventory: [{ name: '符文短匕', qty: 2, icon: '🗡️', desc: 'd' }, '干粮'],
      status_effects: [{ name: '中毒', type: 'debuff', desc: 'x' }, { name: '鹰眼', type: 'buff' }, { name: '平静', type: 'neutral' }],
      npc_codex: [{ name: '莉薇娅', race: '人类', personality: '冷静', love_type: '盟友' }],
      suggested_actions: ['潜入', '点火', '呼叫']
    }) + '\n```';
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
  $('playerInput').value = '进入祭坛';
  $('sendActionBtn').click();
  await sleep(500);
  snapshot('推演完成');

  // 遍历 HUD 页签
  for (const t of ['npc', 'bag', 'spells', 'stats']) {
    doc.querySelector(`#hudTabBar .hud-tab-btn[data-tab="${t}"]`).click();
    await sleep(60);
    snapshot('HUD页签:' + t);
  }

  // 物品详情
  const firstItem = secRef(doc, 'items', 'body').querySelector('button[data-item-index]');
  if (firstItem) { doc.querySelector('#hudTabBar .hud-tab-btn[data-tab="bag"]').click(); firstItem.click(); snapshot('物品详情'); }

  // 各弹窗
  $('openSlotModalBtn').click(); snapshot('槽位弹窗');
  $('closeSlotModalBtn').click();
  $('openTacticsModalBtn').click(); snapshot('战术轮盘');
  $('closeTacticsBtn').click();

  $('openWizardBtn').click(); snapshot('角色向导');
  $('toggleWizardConfigBtn').click(); snapshot('向导配置面板');
  $('closeWizardModalBtn').click();

  $('openSettingsModalBtn').click(); snapshot('偏好设置');
  doc.querySelectorAll('#settingsAccordionContainer .accordion-trigger').forEach(b => {
    b.click();
    snapshot('手风琴:' + b.getAttribute('data-target'));
  });
  $('closeSettingsModalBtn').click();

  secRef(doc, 'attrs', 'capBtn').click(); snapshot('属性上限弹窗');
  $('cancelCapModalBtn').click();
  $('newSessionBtn').click(); snapshot('重置确认');
  $('cancelResetBtn').click();
  $('toggleEditHudBtn').click(); snapshot('HUD JSON 编辑');
  $('cancelManualHudBtn').click();

  // 骰子
  $('playerInput').value = '占位';
  doc.querySelector('[data-action="roll-dice"][data-sides="20"]').click();
  snapshot('骰子确认');

  // 错误态 Toast
  $('playerInput').value = '';
  $('sendActionBtn').click();
  await sleep(60);
  snapshot('Toast');

  // ---- 比对 ----
  const missing = [];
  const notTailwind = [];
  for (const [cls, where] of seenClasses) {
    if (CUSTOM.has(cls)) continue;
    const safe = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\.' + safe + '(?![\\w-])');
    if (re.test(cssFlat)) continue;
    // 猜测：是否像 Tailwind 工具类（含连字符且不是明显的自定义/语义类）
    if (/^[a-z]+[-:]/.test(cls) || /\[/.test(cls)) missing.push({ cls, where });
    else notTailwind.push({ cls, where });
  }

  console.log(`\n收集到 ${seenClasses.size} 个不同的 class（覆盖 ${new Set([...seenClasses.values()]).size} 个界面状态）`);
  console.log(`tailwind.css 中未找到规则的「疑似工具类」: ${missing.length}`);
  if (missing.length) {
    missing.forEach(m => console.log(`  [缺失] ${m.cls}   (首次出现于: ${m.where})`));
  } else {
    console.log('  ✅ 全部工具类都能在生成的 CSS 中找到规则');
  }
  if (notTailwind.length) {
    console.log(`\n非 Tailwind 形态的类（多半是自定义语义类，供人工确认）: ${notTailwind.length}`);
    notTailwind.forEach(m => console.log(`  [非工具类] ${m.cls}   (${m.where})`));
  }

  process.exit(missing.length === 0 ? 0 : 1);
})().catch(e => { console.log('[FATAL] ' + e.stack); process.exit(1); });
