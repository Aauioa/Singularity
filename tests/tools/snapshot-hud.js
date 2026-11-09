// HUD 快照工具：把右栏渲染结果抓成基线，用于验证"蓝图化改造"是否视觉零变化
//
// 用法：
//   node tests/tools/snapshot-hud.js baseline   → 写入 hud-baseline.json
//   node tests/tools/snapshot-hud.js compare    → 与基线对比并输出差异
const fs = require('fs');
const path = require('path');
const { boot, waitForInit, secRef, sectionEl } = require('../harness');

const OUT = path.join(__dirname, 'hud-snapshot.json');
const BASE = path.join(__dirname, 'hud-baseline.json');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 归一化：折叠标签间空白，只比较结构
function norm(html) {
  return html.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();
}

// 已知的"有意为之"结构变化，比对时抹平，让其余部分必须逐字节一致：
//   1. 右栏改为动态生成：section 内部元素从 id 变成 data-ref，面板外壳 id 消失
//   2. 页签栏从写死的 grid-cols-4 按钮组变成动态生成
//   3. 面板标题栏新增「世界蓝图」入口
//   4. 已删除的空 attributesGrid 占位与 HTML 注释
function stripIntentional(s) {
  // 顺序很重要：先做"需要靠 id/data-ref 辨认"的替换，最后再统一剥掉这些属性
  let t = s
    // 面板标题栏（新：flex 容器包着两个按钮；旧：裸按钮）
    .replace(/<div class="flex items-center gap-2\.5"><button.*?<\/div>/, '<div id="HUDACTIONS"></div>')
    .replace(/<button[^>]*toggleEditHudBtn[^>]*> 微调数值 <\/button>/, '<div id="HUDACTIONS"></div>')
    // 页签栏（新：动态生成；旧：grid-cols-4 写死按钮组）
    .replace(/<div[^>]*hudTabBar[^>]*>.*?<\/div>/, '<div id="TABBAR"></div>')
    .replace(/<div class="grid grid-cols-4[^"]*">.*?<\/div>/, '<div id="TABBAR"></div>');

  return t
    .replace(/ (id|data-ref|data-section-title|data-section|data-tab-panel|data-tab)="[^"]*"/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<div class="grid grid-cols-2 gap-1\.5"><\/div>/g, '')
    // 属性数量徽章原本恒为 "0 项"（死代码），现在会显示真实数量 —— 属于修好的旧 bug
    .replace(/上限: (\d+) ⚙️ \d+ 项/g, '上限: $1 ⚙️ N 项');
}

const RICH_STATE = {
  location: '灰烬祭坛', time: '深夜 / 细雨',
  character_profile: { name: '伊莱亚斯', race: '精灵', class: '游侠', identity: '雇佣兵', gender: '男', age: '24', appearance: '银发，左肩有旧伤，披着磨损的旅行斗篷' },
  bars: [
    { label: '生命 (HP)', current: 72, max: 90, color: 'rose' },
    { label: '能量 (MP)', current: 30, max: 50, color: 'cyan' },
    { label: '体力', current: 5, max: 10, color: 'emerald' },
    { label: '理智', current: 8, max: 10, color: 'amber' },
  ],
  attribute_cap: 20,
  attributes: {
    力量: { current: 12, max: 20 }, 敏捷: { current: 16, max: 20 }, 感知: { current: 14, max: 20 },
    智力: { current: 11, max: 20 }, 体质: { current: 13, max: 20 },
  },
  weapon_mastery: { 弓术: { level: '精通', exp: 40 }, 匕首: { level: '传说', exp: 90 }, 剑类: { level: '生疏' } },
  npc_codex: [
    { name: '莉薇娅', race: '人类', personality: '冷静', love_type: '盟友', affection: 55, affDelta: 5, trust: 40, trustDelta: 0, lust: 10, lustDelta: 0, depth: 20, depthDelta: 1, intimacy: null },
    { name: '灰袍老者', race: '未知', personality: '沉默', love_type: '敌对', affection: -20, affDelta: -5, trust: -30, trustDelta: 0, lust: 0, lustDelta: 0, depth: 5, depthDelta: 0, intimacy: null },
  ],
  spells: [
    { name: '星火术', ring: '一环', mp: 8, desc: '凝聚星光灼烧目标' },
    { name: '影遁', ring: '二环', mp: 15, desc: '短距瞬移' },
  ],
  skills: { known: ['野外追踪', '草药学'], unknown: ['古代语'] },
  status_effects: [
    { name: '中毒', type: 'debuff', desc: '每回合损失 3 点生命' },
    { name: '鹰眼', type: 'buff' },
    { name: '平静', type: 'neutral' },
  ],
  inventory: [
    { name: '暗金符文短匕', qty: 2, icon: '🗡️', desc: '刃身刻有禁忌符文' },
    '干粮',
    { name: '治疗药水', qty: 3, icon: '🧪', desc: '回复 20 点生命' },
  ],
  suggested_actions: ['潜入祭坛', '点燃篝火', '呼叫莉薇娅'],
};

// 右栏改成动态生成后，"逐字节相同"不再是合适的判据（面板多了一层 section 包裹）。
// 真正要保证的是：① 可见文本完全一致 ② 没有丢失任何 Tailwind class。
function textOf(s) {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function classBag(s) {
  const bag = {};
  for (const m of s.matchAll(/class="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) {
      if (c) bag[c] = (bag[c] || 0) + 1;
    }
  }
  return bag;
}
// 允许因为"多一层包裹"而多出来的布局类
const WRAPPER_ONLY = new Set(['space-y-1', 'space-y-1.5', 'space-y-2', 'space-y-2.5', 'space-y-3', 'space-y-4', 'hidden']);

async function main() {
  const mode = process.argv[2] || 'baseline';
  const dom = boot({ injectCss: true });
  const { window } = dom;
  const doc = window.document;
  const ref = (n) => doc.querySelector(`[data-ref="${n}"]`);
  const $ = (id) => doc.getElementById(id);

  if (!(await waitForInit(doc))) { console.error('启动失败'); process.exit(1); }

  // 用真实的 game_state 通道灌入数据（而不是直接改内部状态），保证测的是真实渲染路径
  $('openApiSettingsBtn').click();
  $('apiProviderSelect').value = 'openai_compatible';
  $('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
  $('apiKeyInput').value = 'sk-x';
  $('saveApiConfigBtn').click();

  window.fetch = async () => {
    const text = 'GM 推演。\n\n```game_state\n' + JSON.stringify(RICH_STATE) + '\n```';
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

  const shots = {};
  const snap = (name) => {
    // 分开记录：滚动区（各 section 内容）与右侧栏整体（含页签栏）
    shots[name + '::body'] = norm($('hudScrollContainer').innerHTML);
    shots[name + '::full'] = norm($('rightSidebar').innerHTML);
  };

  // 1. 空状态
  snap('empty');

  // 2. 灌入数据后，逐个页签
  $('playerInput').value = '进入祭坛';
  $('sendActionBtn').click();
  await sleep(500);

  for (const t of ['stats', 'npc', 'bag', 'spells']) {
    const btn = doc.querySelector(`.hud-tab-btn[data-tab="${t}"]`);
    if (btn) btn.click();
    await sleep(80);
    snap('tab:' + t);
  }

  // 3. 物品详情展开
  doc.querySelector('.hud-tab-btn[data-tab="bag"]').click();
  await sleep(60);
  const item = secRef(doc, 'items', 'body').querySelector('button[data-item-index]');
  if (item) { item.click(); await sleep(60); }
  snap('item-detail');

  // 4. 属性上限弹窗的徽章显示
  doc.querySelector('.hud-tab-btn[data-tab="stats"]').click();
  await sleep(60);
  snap('stats-after-cap');

  // 5. 空历史重置后
  $('newSessionBtn').click();
  $('confirmResetBtn').click();
  await sleep(120);
  snap('after-reset');

  const payload = { capturedAt: new Date().toISOString(), shots };
  fs.writeFileSync(mode === 'baseline' ? BASE : OUT, JSON.stringify(payload, null, 2), 'utf8');

  if (mode === 'baseline') {
    console.log(`✅ 基线已写入 ${path.basename(BASE)}`);
    Object.keys(shots).forEach(k => console.log(`   ${k}: ${shots[k].length} 字符`));
    process.exit(0);
  }

  // compare
  if (!fs.existsSync(BASE)) { console.error('找不到基线，请先跑 baseline'); process.exit(1); }
  const base = JSON.parse(fs.readFileSync(BASE, 'utf8')).shots;
  let textBad = 0;
  let classBad = 0;
  let structural = 0;

  for (const k of Object.keys(shots)) {
    if (!(k in base)) { console.log(`  [新增] ${k}`); continue; }
    const b = stripIntentional(base[k]);
    const c = stripIntentional(shots[k]);

    // ① 可见文本必须完全一致
    const bt = textOf(b), ct = textOf(c);
    // ② 不允许丢失 class，只允许因为多一层包裹而多出布局类
    const bb = classBag(b), cb = classBag(c);
    const lost = Object.keys(bb).filter(x => (cb[x] || 0) < bb[x]);
    const extra = Object.keys(cb).filter(x => (cb[x] || 0) > (bb[x] || 0));
    const realExtra = extra.filter(x => !WRAPPER_ONLY.has(x));

    const problems = [];
    if (bt !== ct) problems.push('文本不一致');
    if (lost.length) problems.push('丢失 class: ' + lost.join(', '));
    if (realExtra.length) problems.push('新增未知 class: ' + realExtra.join(', '));

    if (problems.length === 0) {
      if (b !== c) structural++;
      console.log(`  [一致] ${k}${b === c ? '（逐字节）' : '（文本与 class 一致，仅包裹层不同）'}`);
    } else {
      if (bt !== ct) textBad++; if (lost.length || realExtra.length) classBad++;
      console.log(`  [差异] ${k}: ${problems.join(' / ')}`);
      if (bt !== ct) {
        let i = 0;
        while (i < bt.length && i < ct.length && bt[i] === ct[i]) i++;
        console.log(`         文本首个分歧位于第 ${i} 字符`);
        console.log(`         基线: ...${bt.slice(Math.max(0, i - 60), i + 120)}...`);
        console.log(`         现在: ...${ct.slice(Math.max(0, i - 60), i + 120)}...`);
      }
    }
  }

  const total = textBad + classBad;
  if (total === 0) {
    console.log(`\n✅ 全部状态可见文本一致、无 class 丢失` +
      (structural ? `（其中 ${structural} 个状态因"面板多一层 section 包裹"而结构不同，视觉等价）` : ''));
  } else {
    console.log(`\n⚠ ${total} 个状态存在问题（文本 ${textBad} / class ${classBad}）`);
  }
  process.exit(total === 0 ? 0 : 1);
}

main().catch(e => { console.error('[FATAL] ' + e.stack); process.exit(1); });
