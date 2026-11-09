// P1 蓝图引擎验证：证明"世界蓝图真的能改变界面与提示词契约"，而不只是空转
const { boot, waitForInit, clickTab, secRef, sectionEl } = require('./harness');

let failures = 0;
const fail = (m) => { failures++; console.log('  [FAIL] ' + m); };
const pass = (m) => console.log('  [ ok ] ' + m);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 一个"赛博废土"蓝图：没有法术页签、NPC 只有 3 个自定义维度、改名若干
const CYBER = {
  version: 1,
  name: '赛博废土',
  profileFields: [{ key: 'name', label: '代号' }, { key: 'class', label: '义体型号' }],
  tabs: [
    {
      id: 'stats', label: '档案',
      sections: [
        { id: 'profile', type: 'profile', label: '档案' },
        { id: 'vitals', type: 'bars', label: '生命体征', source: 'bars' },
        { id: 'attrs', type: 'stats', label: '神经参数', source: 'attributes', radar: true }
      ]
    },
    {
      id: 'npc', label: '人际',
      sections: [{
        id: 'codex', type: 'entities', label: '人际网络', source: 'npc_codex',
        badgeKey: 'faction',
        dimensions: [
          { key: 'trust', deltaKey: 'trustDelta', label: '信任', max: 100, tone: 'cyan' },
          { key: 'fear', deltaKey: 'fearDelta', label: '畏惧', max: 100, tone: 'violet' },
          { key: 'debt', deltaKey: 'debtDelta', label: '人情债', max: 50, tone: 'amber' }
        ],
        emptyText: '尚未建立人际网络。'
      }]
    },
    {
      id: 'bag', label: '装备',
      sections: [{ id: 'items', type: 'list', label: '随身装备', source: 'inventory', layout: 'grid' }]
    }
    // 刻意不给 spells 页签
  ]
};

function bootWithSchema(schema) {
  return boot({
    injectCss: true,
    preScript: `localStorage.setItem('chronicle_slot_custom_1_schema', ${JSON.stringify(JSON.stringify(schema))});`
  });
}

// 从蓝图面板的 JSON 文本域取出当前蓝图（用于在测试里改一处再应用）
function getSchemaFromTextarea($) {
  return JSON.parse($('schemaJsonTextarea').value);
}

// 走真实 UI 路径应用一份新蓝图（世界蓝图面板 → 编辑 JSON → 应用）
function applySchemaTo(dom, schema) {
  const doc = dom.window.document;
  doc.getElementById('openSchemaModalBtn').click();
  doc.getElementById('schemaJsonTextarea').value = JSON.stringify(schema);
  doc.getElementById('applySchemaBtn').click();
}

function installFetch(window, text) {  window.fetch = async (url, opts) => {
    window.__lastSystem = JSON.parse(opts.body).messages[0].content;
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
}

const CUSTOM_TURN = [
  '你在霓虹雨夜里找到了凯尔。',
  '',
  '情感状态列表：',
  '【凯尔】',
  '信任：60（变动：+5）畏惧：20（变动：0）人情债：10（变动：+2）',
  '',
  '```game_state',
  JSON.stringify({
    location: '下城区', time: '深夜',
    npc_codex: [{ name: '凯尔', race: '义体人', personality: '多疑', faction: '夜枭帮' }],
    bars: [{ label: '生命', current: 80, max: 100, color: 'rose' }],
    inventory: [{ name: '电磁撬棍', qty: 1, desc: 'x' }]
  }),
  '```'
].join('\n');

(async () => {
  console.log('\n=== A. 自定义蓝图：页签与 section 受蓝图控制 ===');
  {
    const dom = bootWithSchema(CYBER);
    const doc = dom.window.document;
    const ref = (n) => doc.querySelector(`[data-ref="${n}"]`);
    const $ = (id) => doc.getElementById(id);
    if (!(await waitForInit(doc))) { fail('启动失败'); process.exit(1); }

    const labels = [...doc.querySelectorAll('#hudTabBar .hud-tab-btn')].map(b => b.textContent);
    if (labels.length === 3 && labels.join('/') === '档案/人际/装备') pass('页签完全由蓝图生成: ' + labels.join(' / '));
    else fail('页签不符: ' + labels.join(' / '));
    if (!labels.includes('法术')) pass('没有法术页签（该世界观无此概念）');
    else fail('仍出现法术页签');

    if (!doc.querySelector('[data-tab-panel="spells"]')) pass('法术面板未生成（蓝图未声明该页签）');
    else fail('仍生成了法术面板');

    if (!doc.querySelector('[data-section="mastery"]')) pass('武器熟练度 section 未生成（蓝图未声明）');
    else fail('仍生成了武器熟练度 section');

    const vitalsTitle = doc.querySelector('[data-section-title="vitals"]');
    if (vitalsTitle.textContent === '生命体征') pass('section 标题按蓝图改写: ' + vitalsTitle.textContent);
    else fail('标题未改写: ' + vitalsTitle.textContent);

    const attrsTitle = doc.querySelector('[data-section-title="attrs"]');
    if (attrsTitle.textContent === '神经参数') pass('属性 section 改名生效');
    else fail('属性标题未改写: ' + attrsTitle.textContent);

    const statsChildren = [...doc.querySelector('[data-tab-panel="stats"]').children]
      .filter(el => !el.classList.contains('hidden'))
      .map(el => el.getAttribute('data-section'));
    if (statsChildren.join(',') === 'profile,vitals,attrs') pass('仅蓝图声明的 section 可见，且顺序一致: ' + statsChildren.join(','));
    else fail('可见 section 不符: ' + statsChildren.join(','));

    if (dom.window.localStorage.getItem('chronicle_slot_custom_1_schema')) pass('蓝图已按世界持久化');
    else fail('蓝图未持久化');
    dom.window.close();
  }

  console.log('\n=== B. 自定义 NPC 维度：解析 + 渲染 + 提示词契约三处同步 ===');
  {
    const dom = bootWithSchema(CYBER);
    const doc = dom.window.document;
    const $ = (id) => doc.getElementById(id);
    await waitForInit(doc);
    installFetch(dom.window, CUSTOM_TURN);

    // 必须先配好 API Key，否则 executePlayerTurn 会提前返回、根本不发请求
    $('openApiSettingsBtn').click();
    $('apiProviderSelect').value = 'openai_compatible';
    $('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
    $('apiKeyInput').value = 'sk-x';
    $('saveApiConfigBtn').click();

    clickTab(doc, 'npc');
    $('playerInput').value = '寻找凯尔';
    $('sendActionBtn').click();
    await sleep(500);

    const codex = secRef(doc, 'codex', 'body').textContent;
    if (codex.includes('信任') && codex.includes('畏惧') && codex.includes('人情债')) pass('三个自定义维度均已渲染');
    else fail('自定义维度未渲染: ' + codex.slice(0, 120));
    if (!codex.includes('好感度') && !codex.includes('肉欲度') && !codex.includes('情感深度')) pass('原写死的四维已彻底消失');
    else fail('仍出现写死的旧维度名');
    if (codex.includes('60') && codex.includes('50')) pass('维度数值与自定义上限正确 (信任60/100, 人情债10/50)');
    else fail('数值渲染异常');

    const dimCount = secRef(doc, 'codex', 'body').querySelectorAll('.h-1\\.5').length;
    if (dimCount === 3) pass('维度条数量 = 3（由蓝图决定，非写死 4）');
    else fail('维度条数量异常: ' + dimCount);

    const sys = dom.window.__lastSystem || '';
    // 正文不再要求「情感状态列表」（B2），自定义维度改由 game_state.npc_codex 契约承载：
    // 标签出现在"数值一律走数据块"那一节，键名出现在 JSON 示例里，两者都由蓝图派生。
    if (sys.includes('人情债') && /"trust":\s*50/.test(sys) && /"debtDelta":\s*0/.test(sys)) pass('提示词契约按蓝图生成 npc_codex 维度键');
    else fail('提示词未反映自定义维度');
    if (!sys.includes('肉欲度')) pass('提示词里已无写死的旧维度');
    else fail('提示词仍含肉欲度');
    if (!sys.includes('情感状态列表')) pass('提示词不再要求正文输出情感状态列表（数值全部走 game_state）');
    else fail('提示词仍在要求正文机制清单');

    // B2 新契约：正文一个数值都不写，自定义维度直接由 game_state 驱动（变动键同样由蓝图派生）
    installFetch(dom.window, 'GM 正文，正文里没有任何数值。\n\n```game_state\n'
      + JSON.stringify({ npc_codex: [{ name: '凯尔', trust: 88, trustDelta: -4 }] }) + '\n```');
    clickTab(doc, 'npc');
    $('playerInput').value = '继续追查';
    $('sendActionBtn').click();
    await sleep(500);
    const codex2 = secRef(doc, 'codex', 'body').textContent;
    if (codex2.includes('信任') && codex2.includes('88') && codex2.includes('-4')) pass('自定义维度可由 game_state.npc_codex 驱动（数值 + 变动键）');
    else fail('game_state 路径未更新自定义维度: ' + codex2.slice(0, 110));
    dom.window.close();
  }

  console.log('\n=== C. 蓝图校验：畸形蓝图必须被拦下并回退 ===');
  {
    const bad = { version: 1, tabs: [{ id: 'x', label: 'X', sections: [{ id: 'a', type: '不存在的渲染器' }] }] };
    const dom = bootWithSchema(bad);
    const doc = dom.window.document;
    await waitForInit(doc);
    const labels = [...doc.querySelectorAll('#hudTabBar .hud-tab-btn')].map(b => b.textContent);
    if (labels.length === 4 && labels.includes('技能')) pass('非法渲染器类型 → 整体回退默认蓝图（4 页签）');
    else fail('未回退默认蓝图: ' + labels.join('/'));
    dom.window.close();
  }

  console.log('\n=== D. 选择器注入防护：恶意 id 不得进入 querySelector ===');
  {
    const evil = {
      version: 1,
      tabs: [{ id: '"><img src=x onerror="window.__pwned=1">', label: '注入', sections: [{ id: 'a"; ', type: 'profile', label: 'x' }] }]
    };
    const dom = bootWithSchema(evil);
    const doc = dom.window.document;
    await waitForInit(doc);
    const bar = doc.getElementById('hudTabBar');
    if (!bar.querySelector('img')) pass('恶意 id 中的标签未进入 DOM');
    else fail('注入成功，产生了 img 元素');
    if (dom.window.__pwned === undefined) pass('注入脚本未执行');
    else fail('注入脚本被执行');
    const ids = [...doc.querySelectorAll('#hudTabBar .hud-tab-btn')].map(b => b.dataset.tab);
    if (ids.every(i => /^[A-Za-z0-9_-]+$/.test(i))) pass('页签 id 已被规整为安全字符: ' + ids.join(','));
    else fail('id 未净化: ' + ids.join(','));
    dom.window.close();
  }

  console.log('\n=== E. 没有蓝图时行为与从前一致（向后兼容）===');
  {
    const dom = boot({ injectCss: true });   // 不预置任何蓝图
    const doc = dom.window.document;
    await waitForInit(doc);
    const labels = [...doc.querySelectorAll('#hudTabBar .hud-tab-btn')].map(b => b.textContent);
    if (labels.join('/') === '属性/NPC/行囊/技能') pass('默认蓝图精确复刻原界面: ' + labels.join('/'));
    else fail('默认页签异常: ' + labels.join('/'));
    dom.window.close();
  }

  console.log('\n=== F. 世界类型预设 ===');
  {
    const dom = boot({ injectCss: true });
    const doc = dom.window.document;
    const $ = (id) => doc.getElementById(id);
    await waitForInit(doc);

    $('openSchemaModalBtn').click();
    const grid = $('presetGrid');
    const presets = [...grid.querySelectorAll('button[data-preset]')].map(b => b.dataset.preset);
    if (presets.length === 6) pass('提供 6 个世界类型预设: ' + presets.join(','));
    else fail('预设数量异常: ' + presets.length);
    if (!$('schemaModal').classList.contains('hidden')) pass('蓝图面板可打开');
    else fail('蓝图面板未打开');

    grid.querySelector('button[data-preset="xianxia"]').click();
    await sleep(120);

    const labels = [...doc.querySelectorAll('#hudTabBar .hud-tab-btn')].map(b => b.textContent);
    if (labels.join('/') === '根基/人情/储物袋/功法') pass('修仙预设页签: ' + labels.join('/'));
    else fail('修仙预设页签异常: ' + labels.join('/'));

    const masteryTitle = doc.querySelector('[data-section-title="mastery"]');
    if (masteryTitle.textContent === '境界') pass('阶梯标题按预设变为「境界」');
    else fail('阶梯标题异常: ' + masteryTitle.textContent);

    const vitalsTitle = doc.querySelector('[data-section-title="vitals"]');
    if (vitalsTitle.textContent === '修为状态') pass('状态条标题按预设变为「修为状态」');
    else fail('状态条标题异常: ' + vitalsTitle.textContent);

    const json = $('schemaJsonTextarea').value;
    if (json.includes('筑基') && json.includes('情分')) pass('蓝图 JSON 含修仙阶梯与因果维度');
    else fail('蓝图 JSON 内容不符');
    dom.window.close();
  }

  console.log('\n=== G. AI 生成：结构被骨架锁定 + 标签安全 ===');
  {
    const dom = boot({ injectCss: true });
    const doc = dom.window.document;
    const $ = (id) => doc.getElementById(id);
    await waitForInit(doc);

    $('openApiSettingsBtn').click();
    $('apiProviderSelect').value = 'openai_compatible';
    $('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
    $('apiKeyInput').value = 'sk-x';
    $('saveApiConfigBtn').click();
    $('worldLoreInput').value = '一个以梦境为货币的世界';
    $('saveLoreBtn').click();

    // 模型"乱来"：改 id、多给页签、标签里塞脚本
    const evil = {
      name: '梦境世界',
      profileFields: [{ key: 'name', label: '梦境之名' }],
      tabs: [
        { id: 'HACKED', label: '<img src=x onerror="window.__pwned=1">', sections: [{ id: 'zzz', type: 'profile', label: '伪造档案' }] },
        { id: 'evil2', label: '多出来的页签', sections: [{ id: 'e2', type: 'list', label: 'x' }] }
      ]
    };
    installFetch(dom.window, JSON.stringify(evil));

    $('openSchemaModalBtn').click();
    $('aiGenerateSchemaBtn').click();
    await sleep(700);

    const tabs = [...doc.querySelectorAll('#hudTabBar .hud-tab-btn')];
    if (tabs.length === 4) pass('页签数量仍为骨架的 4 个（模型多加的页签被丢弃）');
    else fail('页签数量被模型改动: ' + tabs.length);

    const ids = tabs.map(b => b.dataset.tab).join(',');
    if (ids === 'stats,npc,bag,spells') pass('页签 id 仍为骨架原值（模型改的 id 被忽略）');
    else fail('页签 id 被模型改动: ' + ids);

    if (!$('hudTabBar').querySelector('img')) pass('标签中的 <img> 未变成真实元素');
    else fail('标签注入成功');
    if (dom.window.__pwned === undefined) pass('标签内的脚本未执行');
    else fail('脚本被执行');

    const firstLabel = tabs[0].textContent;
    if (!/[<>]/.test(firstLabel)) pass('标签中的尖括号已被剥离: ' + firstLabel);
    else fail('标签仍含尖括号: ' + firstLabel);

    if ($('schemaCurrentBadge').textContent === '梦境世界') pass('模型给的世界名被采用');
    else fail('世界名未采用: ' + $('schemaCurrentBadge').textContent);
    dom.window.close();
  }

  console.log('\n=== H. 同类型多面板：任意增删栏位（真正的"不死板"）===');
  {
    const TWO_LISTS = {
      version: 1, name: '双列表世界',
      profileFields: [{ key: 'name', label: '道号' }, { key: 'appearance', label: '容貌' }],
      tabs: [{
        id: 'stats', label: '总览',
        sections: [
          { id: 'profile', type: 'profile', label: '档案' },
          {
            id: 'arts', type: 'list', label: '功法', source: 'arts', layout: 'cards',
            costKey: 'mp', costLabel: '灵力', tagKey: 'tier', tagFallback: '未定',
            action: { label: '施展', template: '【施展】{name}（消耗 {cost} 灵力）。' }, emptyText: '尚未习得功法'
          },
          {
            id: 'relics', type: 'list', label: '法宝', source: 'relics', layout: 'cards',
            costKey: 'qi', costLabel: '真元', tagKey: 'grade', tagFallback: '下品',
            action: { label: '祭出', template: '【祭出】{name}（消耗 {cost} 真元）。' }, emptyText: '尚无法宝'
          }
        ]
      }]
    };

    const dom = bootWithSchema(TWO_LISTS);
    const doc = dom.window.document;
    const $ = (id) => doc.getElementById(id);
    await waitForInit(doc);
    installFetch(dom.window, CUSTOM_TURN);

    const artsEl = doc.querySelector('[data-section="arts"]');
    const relicsEl = doc.querySelector('[data-section="relics"]');
    if (artsEl && relicsEl) pass('同一页签内成功生成两个同类型（list）面板 —— 栏位不再受类型限制');
    else fail('同类型面板未生成');

    // 按蓝图声明的 source 灌入数据（走 game_state 真实通道）
    const twoTurn = [
      '你祭出了法宝。',
      '',
      '```game_state',
      JSON.stringify({
        arts: [{ name: '太清剑诀', tier: '玄阶', mp: 12, desc: '御剑千里' }],
        relics: [{ name: '镇魂铃', grade: '上品', qi: 30, desc: '镇慑神魂' }]
      }),
      '```'
    ].join('\n');
    installFetch(dom.window, twoTurn);

    $('openApiSettingsBtn').click();
    $('apiProviderSelect').value = 'openai_compatible';
    $('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
    $('apiKeyInput').value = 'sk-x';
    $('saveApiConfigBtn').click();
    $('playerInput').value = '查看功法与法宝';
    $('sendActionBtn').click();
    await sleep(500);

    const artsText = secRef(doc, 'arts', 'body') ? secRef(doc, 'arts', 'body').textContent : '';
    const relicsText = secRef(doc, 'relics', 'body') ? secRef(doc, 'relics', 'body').textContent : '';
    if (artsText.includes('太清剑诀') && artsText.includes('玄阶') && artsText.includes('灵力')) {
      pass('第一个自定义列表拿到数据并按自己的字段渲染: ' + artsText.replace(/\s+/g, ' ').trim().slice(0, 44));
    } else fail('自定义列表1未渲染: ' + artsText.slice(0, 80));

    if (relicsText.includes('镇魂铃') && relicsText.includes('上品') && relicsText.includes('真元')) {
      pass('第二个自定义列表独立渲染（字段/单位与第一个不同）');
    } else fail('自定义列表2未渲染: ' + relicsText.slice(0, 80));

    if (relicsText.includes('祭出')) pass('行动按钮文案来自各自蓝图: 祭出');
    else fail('行动按钮文案未按蓝图生成');

    const sys = dom.window.__lastSystem || '';
    if (sys.includes('arts:') && sys.includes('relics:')) pass('提示词契约列出了两个自定义数据键');
    else fail('提示词未列出自定义数据键');

    // 面板数量可自由增减
    const THREE = JSON.parse(JSON.stringify(TWO_LISTS));
    THREE.tabs[0].sections.push({ id: 'pets', type: 'list', label: '灵宠', source: 'pets', layout: 'cards', emptyText: '无灵宠' });
    applySchemaTo(dom, THREE);
    await sleep(150);
    if (doc.querySelectorAll('[data-section]').length === 4) pass('新增第三个列表面板后 section 数变为 4');
    else fail('增删栏位未生效: ' + doc.querySelectorAll('[data-section]').length);

    const FOUR = JSON.parse(JSON.stringify(TWO_LISTS));
    FOUR.tabs[0].sections = FOUR.tabs[0].sections.filter(s => s.id !== 'arts');
    applySchemaTo(dom, FOUR);
    await sleep(150);
    if (!doc.querySelector('[data-section="arts"]') && doc.querySelector('[data-section="relics"]')) {
      pass('删除栏位后该面板确实消失，其余面板不受影响');
    } else fail('删除栏位未生效');
    dom.window.close();
  }

  console.log('\n=== I. 可视化结构编辑器（自己微调）===');
  {
    const dom = boot({ injectCss: true });
    const doc = dom.window.document;
    const $ = (id) => doc.getElementById(id);
    await waitForInit(doc);

    $('openSchemaModalBtn').click();
    const tree = $('schemaTree');
    if (tree.querySelectorAll('input[data-act="rename-tab"]').length === 4) pass('结构树列出全部 4 个页签');
    else fail('页签行数异常: ' + tree.querySelectorAll('input[data-act="rename-tab"]').length);
    if (tree.querySelectorAll('input[data-act="rename-sec"]').length > 0) pass('结构树列出各页签内的面板');
    else fail('未列出面板');

    const secCount = () => doc.querySelectorAll('#hudScrollContainer [data-section]').length;
    const before = secCount();

    // 添加上限：找到 stats 页签行的 ＋面板
    const addBtn = tree.querySelector('button[data-act="add-sec"]');
    addBtn.click();
    await sleep(120);
    if (secCount() === before + 1) pass(`点「＋面板」后右栏面板数 ${before} → ${secCount()}`);
    else fail('添加面板未生效: ' + secCount());

    // 改名（挑一个有可见标题的 section —— profile 面板按设计没有标题）
    const firstSecInput = $('schemaTree').querySelector('input[data-act="rename-sec"][data-sid="vitals"]');
    if (!firstSecInput) { fail('未找到 vitals 的改名输入框'); }
    else {
      firstSecInput.value = '改名测试';
      firstSecInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      await sleep(120);
      const titleEls = [...doc.querySelectorAll('[data-section-title]')].map(e => e.textContent);
      if (titleEls.includes('改名测试')) pass('改名即时反映到右栏标题');
      else fail('改名未生效: ' + titleEls.join('/'));
    }

    // 删除
    const afterRename = secCount();
    const delBtn = $('schemaTree').querySelector('button[data-act="del-sec"]');
    delBtn.click();
    await sleep(120);
    if (secCount() === afterRename - 1) pass(`点「✕」后面板数 ${afterRename} → ${secCount()}`);
    else fail('删除面板未生效: ' + secCount());

    // 排序：把第一个页签的第二个 section 上移
    const orderBefore = [...doc.querySelectorAll('#hudScrollContainer [data-tab-panel="stats"] [data-section]')].map(e => e.dataset.section);
    const upBtn = $('schemaTree').querySelector('button[data-act="sec-up"][data-si="1"]');
    if (upBtn) {
      upBtn.click();
      await sleep(120);
      const orderAfter = [...doc.querySelectorAll('#hudScrollContainer [data-tab-panel="stats"] [data-section]')].map(e => e.dataset.section);
      if (orderAfter[0] === orderBefore[1] && orderAfter[1] === orderBefore[0]) {
        pass(`上移生效: ${orderBefore.slice(0, 2).join(',')} → ${orderAfter.slice(0, 2).join(',')}`);
      } else fail('排序未生效: ' + orderAfter.join(','));
    } else fail('未找到上移按钮');

    // 添加页签
    const tabsBefore = doc.querySelectorAll('#hudTabBar .hud-tab-btn').length;
    $('addTabBtn').click();
    await sleep(120);
    if (doc.querySelectorAll('#hudTabBar .hud-tab-btn').length === tabsBefore + 1) pass('可添加新页签');
    else fail('添加页签未生效');
    dom.window.close();
  }

  console.log('\n=== J. 角色创建也可高度自定义 ===');
  {
    const dom = boot({ injectCss: true });
    const doc = dom.window.document;
    const $ = (id) => doc.getElementById(id);
    await waitForInit(doc);

    const fieldLabels = () => [...doc.querySelectorAll('#wizardFields label')].map(l => l.textContent.replace(/\s*\*$/, ''));
    const fieldKeys = () => [...doc.querySelectorAll('#wizardFields [data-ref]')].map(e => e.dataset.ref);

    // J1 默认蓝图
    $('openWizardBtn').click();
    await sleep(120);
    const defLabels = fieldLabels();
    if (defLabels.includes('角色姓名') && defLabels.includes('性别') && defLabels.includes('种族') && defLabels.includes('外貌细节与随身装备描述')) {
      pass('默认蓝图复刻原创建表单: ' + defLabels.join('/'));
    } else fail('默认创建字段异常: ' + defLabels.join('/'));
    if ((doc.getElementById('wizDiceLabel').textContent || '').includes('D6')) pass('默认投骰为 D6');
    else fail('投骰标签异常');
    $('closeWizardModalBtn').click();

    // J2 切到修仙预设
    $('openSchemaModalBtn').click();
    $('presetGrid').querySelector('button[data-preset="xianxia"]').click();
    await sleep(150);
    $('closeSchemaModalBtn').click();
    $('openWizardBtn').click();
    await sleep(150);

    const xyLabels = fieldLabels();
    if (xyLabels.includes('道号') && xyLabels.includes('宗门') && xyLabels.includes('容貌与随身法器')) {
      pass('修仙预设换成自己的创建项: ' + xyLabels.join('/'));
    } else fail('修仙创建字段异常: ' + xyLabels.join('/'));
    if (!$('wizardFields').querySelector('[data-ref="name"]').placeholder.includes('伊莱亚斯')) pass('占位提示也随蓝图变化');
    else fail('占位提示未变');
    if ($('wizDiceResultLabel').textContent.includes('气运')) pass('投骰项改为「气运」: ' + $('wizDiceResultLabel').textContent);
    else fail('投骰项未变: ' + $('wizDiceResultLabel').textContent);

    const attrKeys = [...$('pointBuyGrid').querySelectorAll('[data-stat-value]')].map(e => e.dataset.statIndex);
    const attrNames = [...$('pointBuyGrid').children].map(c => c.querySelector('span').textContent);
    if (attrNames.includes('根骨') && attrNames.includes('悟性')) pass('属性表也随预设切换: ' + attrNames.join('/'));
    else fail('属性表未切换: ' + attrNames.join('/'));

    // J3 完成创建 → HUD 初始数值来自蓝图派生公式
    $('wizardFields').querySelector('[data-ref="name"]').value = '清虚子';
    $('completeWizardBtn').click();
    await sleep(150);

    const barText = secRef(doc, 'vitals', 'body').textContent.replace(/\s+/g, ' ').trim();
    if (barText.includes('气血') && barText.includes('灵力') && barText.includes('神识')) {
      pass('初始数值按蓝图派生: ' + barText.slice(0, 60));
    } else fail('派生数值异常: ' + barText.slice(0, 80));

    const card = $('characterLoreInput').value;
    if (card.includes('道号：清虚子') && card.includes('宗门：')) pass('角色卡文本用蓝图字段名生成');
    else fail('角色卡文本异常: ' + card.split('\n')[1]);

    // 校验公式真的生效：气血 = 20 + 根骨*8，而根骨初始为 5（25 点 / 5 项）
    const hpMatch = barText.match(/气血 (\d+) \/ (\d+)/);
    if (hpMatch && Number(hpMatch[1]) === 20 + 5 * 8) pass(`派生公式计算正确（根骨5 → 气血${hpMatch[1]}）`);
    else fail('派生公式结果不符: ' + barText.slice(0, 40));

    // J4 自定义公式
    $('openWizardBtn').click();
    await sleep(100);
    $('toggleWizardConfigBtn').click();
    $('cfgAttributesInput').value = '根骨';
    $('cfgPointsPoolInput').value = '10';
    $('cfgMaxPerStatInput').value = '8';
    $('saveWizardConfigBtn').click();
    await sleep(150);

    // 直接改蓝图里的派生公式
    const custom = JSON.parse(JSON.stringify(getSchemaFromTextarea($)));
    custom.creation.derived = [{ label: '真气', cardLabel: '真气', tone: 'cyan', formula: '根骨 * 10 + 3' }];
    $('openSchemaModalBtn').click();
    $('schemaJsonTextarea').value = JSON.stringify(custom);
    $('applySchemaBtn').click();
    await sleep(150);

    $('openWizardBtn').click();
    await sleep(150);
    $('wizardFields').querySelector('[data-ref="name"]').value = '测试者';
    $('completeWizardBtn').click();
    await sleep(150);

    const bar2 = secRef(doc, 'vitals', 'body').textContent.replace(/\s+/g, ' ').trim();
    const m2 = bar2.match(/真气 (\d+) \/ (\d+)/);
    if (m2 && Number(m2[1]) === 8 * 10 + 3) pass(`自定义派生公式生效（根骨8 → 真气${m2[1]}）`);
    else fail('自定义公式未生效: ' + bar2.slice(0, 60));
    dom.window.close();
  }

  console.log('\n=== K. 创建表单可视化编辑 + AI 微调 creation ===');
  {
    const dom = boot({ injectCss: true });
    const doc = dom.window.document;
    const $ = (id) => doc.getElementById(id);
    await waitForInit(doc);

    const cTree = () => $('creationTree');
    const fieldRows = () => cTree().querySelectorAll('input[data-act="c-rename"]');
    const fieldLabels = () => [...doc.querySelectorAll('#wizardFields label')].map(l => l.textContent.replace(/\s*\*$/, ''));

    $('openSchemaModalBtn').click();
    if (fieldRows().length === 7) pass('创建表单结构树列出全部 7 个字段');
    else fail('创建字段行数异常: ' + fieldRows().length);

    const nameInput = cTree().querySelector('input[data-act="c-rename"][data-ri="0"][data-fi="0"]');
    nameInput.value = '英雄之名';
    nameInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await sleep(120);

    const faceSel = cTree().querySelector('select[data-act="c-dice-sides"]');
    faceSel.value = '8';
    faceSel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await sleep(120);

    const fInput = cTree().querySelector('input[data-act="c-drv-formula"][data-di="0"]');
    fInput.value = '体质 * 3 + 7';
    fInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await sleep(120);

    const beforeAdd = fieldRows().length;
    cTree().querySelector('button[data-act="c-add-field-last"]').click();
    await sleep(120);
    if (fieldRows().length === beforeAdd + 1) pass(`点「＋ 添加创建项」后字段数 ${beforeAdd} → ${fieldRows().length}`);
    else fail('添加创建项未生效');

    // 删除最后一个字段（不能删 name —— 后面还要用它填表）
    const delBtns = cTree().querySelectorAll('button[data-act="c-del-field"]');
    delBtns[delBtns.length - 1].click();
    await sleep(120);
    if (fieldRows().length === beforeAdd) pass('点「✕」后字段数回落');
    else fail('删除创建项未生效');

    $('closeSchemaModalBtn').click();
    $('openWizardBtn').click();
    await sleep(150);

    if (fieldLabels().includes('英雄之名')) pass('改名生效于创建表单: ' + fieldLabels().slice(0, 3).join('/'));
    else fail('改名未生效: ' + fieldLabels().join('/'));
    if ((doc.querySelector('#wizardDice button[data-action="roll-charisma"]').textContent || '').includes('D8')) pass('投骰骰面改为 D8');
    else fail('骰面未生效');

    $('wizardFields').querySelector('[data-ref="name"]').value = '测试者';
    $('completeWizardBtn').click();
    await sleep(150);
    const barTxt = secRef(doc, 'vitals', 'body').textContent.replace(/\s+/g, ' ').trim();
    const mm = barTxt.match(/生命 \(HP\) (\d+)/);
    if (mm && Number(mm[1]) === 5 * 3 + 7) pass(`编辑器改的派生公式生效（体质5 → ${mm[1]}）`);
    else fail('派生公式未生效: ' + barTxt.slice(0, 50));
    dom.window.close();
  }

  {
    const dom = boot({ injectCss: true });
    const doc = dom.window.document;
    const $ = (id) => doc.getElementById(id);
    await waitForInit(doc);

    $('openApiSettingsBtn').click();
    $('apiProviderSelect').value = 'openai_compatible';
    $('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
    $('apiKeyInput').value = 'sk-x';
    $('saveApiConfigBtn').click();
    $('worldLoreInput').value = '一个以梦境为货币的世界';
    $('saveLoreBtn').click();

    // 模型试图把 name 字段改成 number 类型
    const evil = {
      name: '梦境世界',
      creation: {
        rows: [
          { fields: [{ key: 'name', label: '梦名', type: 'number' }, { key: 'gender' }, { key: 'age' }] },
          { fields: [{ key: 'race', label: '梦族' }, { key: 'class', label: '梦职' }, { key: 'identity' }] },
          { fields: [{ key: 'appearance', label: '梦貌' }] }
        ],
        dice: { key: '梦运', label: '梦境骰', sides: 8, base: 3, map: { 1: -2, 8: 5 } },
        derived: [{ label: '梦力', formula: '体质 * 3 + 7' }]
      }
    };
    installFetch(dom.window, JSON.stringify(evil));

    $('openSchemaModalBtn').click();
    $('aiGenerateSchemaBtn').click();
    await sleep(800);
    $('closeSchemaModalBtn').click();
    $('openWizardBtn').click();
    await sleep(150);

    const labels = [...doc.querySelectorAll('#wizardFields label')].map(l => l.textContent.replace(/\s*\*$/, ''));
    if (labels.includes('梦名') && labels.includes('梦族') && labels.includes('梦职')) pass('AI 改的字段标签已生效: ' + labels.slice(0, 3).join('/'));
    else fail('AI 标签未生效: ' + labels.join('/'));

    const nameEl = $('wizardFields').querySelector('[data-ref="name"]');
    if (nameEl.tagName === 'INPUT' && nameEl.type === 'text') pass('字段类型仍为骨架的 text（AI 改的 number 被忽略）');
    else fail('字段类型被 AI 改动: ' + nameEl.tagName + '/' + nameEl.type);

    if ((doc.getElementById('wizDiceResultLabel').textContent || '').includes('梦运')) pass('AI 改的投骰项生效: 梦运');
    else fail('投骰项未生效');
    if ((doc.querySelector('#wizardDice button[data-action="roll-charisma"]').textContent || '').includes('D8')) pass('AI 改的骰面 D8 生效');
    else fail('骰面未生效');

    $('wizardFields').querySelector('[data-ref="name"]').value = '梦行者';
    $('completeWizardBtn').click();
    await sleep(150);
    const bt = secRef(doc, 'vitals', 'body').textContent.replace(/\s+/g, ' ').trim();
    const m3 = bt.match(/梦力 (\d+)/);
    if (m3 && Number(m3[1]) === 5 * 3 + 7) pass(`AI 给的派生公式生效（体质5 → 梦力${m3[1]}）`);
    else fail('AI 派生公式未生效: ' + bt.slice(0, 50));
    dom.window.close();
  }

  console.log('\n=== L. 角色卡字段版式：位置由蓝图决定 ===');
  {
    const dom = boot({ injectCss: true });
    const doc = dom.window.document;
    const $ = (id) => doc.getElementById(id);
    await waitForInit(doc);

    // 与改造前写死的版式刻意错开，才能证明"位置真的可配"：
    //   age 从字段格提升为大标题第二个
    //   gender 顶掉 class 当第 3 个徽章，class 被贬到字段格
    //   realm / origin 是蓝图新增的键（老版写死的契约里根本没有它们）
    const SLOTS = {
      version: 1,
      name: '版式世界',
      profileFields: [
        { key: 'name', label: '道号', slot: 'title' },
        { key: 'age', label: '骨龄', slot: 'title' },
        { key: 'race', label: '种族', slot: 'badge' },
        { key: 'identity', label: '身份', slot: 'badge' },
        { key: 'gender', label: '性别', slot: 'badge' },
        { key: 'class', label: '宗门', slot: 'field' },
        { key: 'realm', label: '境界', slot: 'field' },
        { key: 'origin', label: '出身', slot: 'field', emptyText: '未知出身' },
        { key: 'appearance', label: '容貌', slot: 'appearance' }
      ],
      tabs: [{ id: 'stats', label: '属性', sections: [
        { id: 'profile', type: 'profile', label: '档案' },
        { id: 'location', type: 'location', label: '地点' }
      ] }]
    };

    applySchemaTo(dom, SLOTS);
    await sleep(200);

    $('openApiSettingsBtn').click();
    $('apiProviderSelect').value = 'openai_compatible';
    $('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
    $('apiKeyInput').value = 'sk-x';
    $('saveApiConfigBtn').click();

    // 刻意不给 origin 赋值，用来验证 emptyText
    installFetch(dom.window, [
      '你在青云宗后山打坐。',
      '```game_state',
      JSON.stringify({
        location: '青云宗', time: '清晨',
        character_profile: {
          name: '清虚子', age: '24', race: '人族', identity: '外门弟子',
          gender: '男', class: '剑修', realm: '筑基', appearance: '青衫仗剑'
        }
      }),
      '```'
    ].join('\n'));

    $('playerInput').value = '打坐';
    $('sendActionBtn').click();
    await sleep(500);

    const sec = () => sectionEl(doc, 'profile');
    const texts = (root) => [...root.children].map(c => c.textContent.trim());

    // L1 大标题可多个，且顺序跟随蓝图
    const titles = [...sec().querySelectorAll('.font-bold')].map(e => e.textContent.trim());
    if (titles.length === 2 && titles.join('/') === '清虚子/24') pass('蓝图把 age 提升为第二个大标题，顺序跟随字段声明: ' + titles.join(' / '));
    else fail('大标题渲染不符: ' + JSON.stringify(titles));

    // L2 徽章分区：前两个在左侧换行容器，第三个在右上角
    const left = texts(sec().querySelector('[data-ref="badgesLeft"]'));
    const right = texts(sec().querySelector('[data-ref="badgesRight"]'));
    if (left.join('/') === '人族/外门弟子') pass('badge 槽位前两个进左侧容器: ' + left.join(' / '));
    else fail('左侧徽章不符: ' + JSON.stringify(left));
    if (right.join('/') === '男') pass('badge 槽位第三个进右上角容器: ' + right.join('/'));
    else fail('右侧徽章不符: ' + JSON.stringify(right));

    // L3 class 被从徽章改到字段格 —— 位置确实由蓝图决定，不是写死的
    const grid = sec().querySelector('[data-ref="fields"]').textContent;
    if (grid.includes('宗门') && grid.includes('剑修')) pass('class 从徽章挪到字段格生效（宗门：剑修）');
    else fail('字段格缺少宗门: ' + grid.slice(0, 60));
    if (!grid.includes('种族')) pass('race 已不在字段格（它现在是徽章）');
    else fail('race 仍出现在字段格');

    // L4 emptyText 生效
    if (grid.includes('未知出身')) pass('字段级 emptyText 生效: 未知出身');
    else fail('emptyText 未生效: ' + grid.slice(0, 80));

    // L5 外貌段的标签与内容都随蓝图
    if (sec().querySelector('[data-ref="appearanceLabel"]').textContent === '容貌') pass('外貌段标签随蓝图改为「容貌」');
    else fail('外貌段标签未改写: ' + sec().querySelector('[data-ref="appearanceLabel"]').textContent);
    if (sec().querySelector('[data-ref="appearance"]').textContent === '青衫仗剑') pass('外貌段内容正确');
    else fail('外貌段内容错误');

    // L6 提示词契约由蓝图派生：老版写死的 character_profile 示例里没有 realm/origin
    // （提示词里的 JSON 是 2 空格缩进的美化格式，所以用正则匹配冒号后的空白）
    const sys = dom.window.__lastSystem || '';
    if (/"realm":\s*"境界"/.test(sys) && /"origin":\s*"出身"/.test(sys)) pass('game_state 的 character_profile 示例键已由蓝图派生（realm/origin 出现在提示词里）');
    else fail('提示词契约未随蓝图派生（仍是写死的 7 个键）');
    // 正文已不再要求角色卡区块（B2），标题标签改由 game_state.character_profile 契约承载：
    // 蓝图把 title 字段的标签改成「道号」，契约里的示例值就必须是「道号」。
    if (/"name":\s*"道号"/.test(sys)) pass('角色卡标题标签随蓝图派生进 game_state 契约（道号）');
    else fail('game_state 契约未派生蓝图改名的标题标签');
    if (!sys.includes('【角色卡—')) pass('提示词不再要求正文输出角色卡区块（数值全部走 game_state）');
    else fail('提示词仍在要求正文角色卡区块');

    // L7 存读往返不丢 slot / emptyText
    $('openSchemaModalBtn').click();
    await sleep(80);
    const roundTrip = getSchemaFromTextarea($);
    const rtClass = roundTrip.profileFields.find(f => f.key === 'class');
    const rtOrigin = roundTrip.profileFields.find(f => f.key === 'origin');
    if (rtClass && rtClass.slot === 'field') pass('蓝图 JSON 往返后 class 的 slot 仍是 field（normalize 不再吞掉新属性）');
    else fail('slot 在往返中丢失: ' + JSON.stringify(rtClass));
    if (rtOrigin && rtOrigin.emptyText === '未知出身') pass('emptyText 往返后仍在');
    else fail('emptyText 在往返中丢失: ' + JSON.stringify(rtOrigin));

    // L8 非法 slot 不得被采纳，且必须回退而非让字段消失。
    // 回退规则是"按 key 推出的老版式"：name 有 legacy 映射→title；gender 没有→field。
    const bad = JSON.parse(JSON.stringify(SLOTS));
    bad.profileFields.find(f => f.key === 'name').slot = '<img src=x onerror=alert(1)>';
    bad.profileFields.find(f => f.key === 'gender').slot = 'legendary';
    applySchemaTo(dom, bad);
    await sleep(250);

    const badSec = sectionEl(doc, 'profile');
    const badTitles = [...badSec.querySelectorAll('.font-bold')].map(e => e.textContent.trim());
    if (badTitles.length === 2 && badTitles[0] === '清虚子') pass('非法 slot 被忽略，name 回退到按 key 推出的 title');
    else fail('非法 slot 处理异常: ' + JSON.stringify(badTitles));

    const badGrid = badSec.querySelector('[data-ref="fields"]').textContent;
    if (badGrid.includes('性别')) pass('自创槽位的 gender 回退进字段格（legacy 无此 key → field）');
    else fail('gender 未回退进字段格: ' + badGrid.slice(0, 80));
    if (badSec.querySelector('[data-ref="badgesRight"]').children.length === 0) pass('gender 已离开右上角徽章位（回退生效）');
    else fail('gender 仍占着右上角徽章位');

    const badAll = badSec.textContent;
    if (badAll.includes('剑修') && badAll.includes('筑基')) pass('回退过程中没有任何字段的数据丢失');
    else fail('有字段丢失: ' + badAll.replace(/\s+/g, ' ').slice(0, 80));
    if (dom.window.__pwned === undefined) pass('slot 里的注入串未被执行');
    else fail('slot 注入成功');

    dom.window.close();
  }

  console.log('\n=== M. AI 微调角色卡版式：只认白名单槽位 ===');
  {
    const dom = boot({ injectCss: true });
    const doc = dom.window.document;
    const $ = (id) => doc.getElementById(id);
    await waitForInit(doc);

    $('openApiSettingsBtn').click();
    $('apiProviderSelect').value = 'openai_compatible';
    $('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
    $('apiKeyInput').value = 'sk-x';
    $('saveApiConfigBtn').click();
    $('worldLoreInput').value = '一个以梦境为货币的世界';
    $('saveLoreBtn').click();

    // 模型只给两个字段：name 给合法 slot，class 给自创的第五个槽位
    const evil = {
      name: '梦境世界',
      profileFields: [
        { key: 'name', label: '梦境之名', slot: 'title' },
        { key: 'class', label: '梦职', slot: 'legendary' }
      ]
    };
    installFetch(dom.window, JSON.stringify(evil));

    $('openSchemaModalBtn').click();
    $('aiGenerateSchemaBtn').click();
    await sleep(800);
    $('closeSchemaModalBtn').click();
    await sleep(150);

    const sec = () => sectionEl(doc, 'profile');
    const titles = [...sec().querySelectorAll('.font-bold')].map(e => e.textContent.trim());
    if (titles.length === 1) pass('AI 给的合法 slot（title）已生效');
    else fail('AI 的 title slot 未生效: ' + JSON.stringify(titles));

    const leftCount = sec().querySelector('[data-ref="badgesLeft"]').children.length;
    const rightCount = sec().querySelector('[data-ref="badgesRight"]').children.length;
    if (leftCount === 1 && rightCount === 0) pass('AI 自创的第五个槽位被拒绝，class 回退为按 key 推出的 badge');
    else fail(`自创槽位处理异常 left=${leftCount} right=${rightCount}`);

    dom.window.close();
  }

  console.log('\n=== N. 角色卡版式可视化编辑器 ===');
  {
    const dom = boot({ injectCss: true });
    const doc = dom.window.document;
    const $ = (id) => doc.getElementById(id);
    await waitForInit(doc);

    $('openSchemaModalBtn').click();
    await sleep(100);

    const tree = () => $('profileTree');
    const sels = () => tree().querySelectorAll('select[data-act="p-slot"]');
    const labelsNow = () => [...tree().querySelectorAll('input[data-act="p-rename"]')].map(i => i.value);
    const badgeCounts = () => {
      const sec = doc.querySelector('[data-section="profile"]');
      return [sec.querySelector('[data-ref="badgesLeft"]').children.length,
        sec.querySelector('[data-ref="badgesRight"]').children.length];
    };

    if (sels().length === 7) pass('版式编辑器列出默认蓝图的全部 7 个字段');
    else fail('字段行数异常: ' + sels().length);
    if (sels()[0].value === 'title') pass('默认蓝图已把 slot 显式写进 JSON，下拉显示 title');
    else fail('默认槽位不对: ' + sels()[0].value);

    // N1 下拉改槽位：gender 从 field 变成 badge，徽章数应当 +1
    const b0 = badgeCounts();
    const gSel = tree().querySelector('select[data-act="p-slot"][data-fi="4"]');
    gSel.value = 'badge';
    gSel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await sleep(200);
    const b1 = badgeCounts();
    if (b1[0] === b0[0] + 1) pass(`槽位下拉立即改版式（左侧徽章 ${b0[0]} → ${b1[0]}）`);
    else fail(`槽位下拉未生效: ${b0.join('/')} → ${b1.join('/')}`);

    // N2 改名走 input，不重建树（否则会丢焦点）
    const nameInput = tree().querySelector('input[data-act="p-rename"][data-fi="0"]');
    nameInput.value = '尊号';
    nameInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await sleep(150);
    if (labelsNow()[0] === '尊号') pass('改名生效且输入框未被重建打断');
    else fail('改名失败: ' + labelsNow()[0]);
    if (doc.querySelector('[data-section="profile"] [data-ref="fields"]').textContent !== undefined
      && $('schemaJsonTextarea').value.includes('尊号')) pass('改名同步进了蓝图 JSON');
    else fail('改名未同步到 JSON');

    // N3 添加字段
    $('addProfileKey').value = 'realm';
    $('addProfileLabel').value = '境界';
    tree().querySelector('button[data-act="p-add"]').click();
    await sleep(200);
    if (sels().length === 8) pass('＋ 添加字段后字段数 7 → 8');
    else fail('添加字段失败: ' + sels().length);
    if (doc.querySelector('[data-section="profile"]').textContent.includes('境界')) pass('新字段立即出现在角色卡上');
    else fail('新字段未渲染');
    if (sels()[7].value === 'field') pass('新字段默认槽位为 field');

    // N4 键名冲突与非法字符
    $('addProfileKey').value = 'realm';
    tree().querySelector('button[data-act="p-add"]').click();
    await sleep(150);
    if (sels().length === 8) pass('重复键名被拒绝，字段数不变');
    else fail('重复键名被接受: ' + sels().length);
    $('addProfileKey').value = 'my realm-2!';
    tree().querySelector('button[data-act="p-add"]').click();
    await sleep(180);
    const keys = [...tree().querySelectorAll('span[title^="数据键"]')].map(s => s.textContent);
    if (keys.includes('myrealm2')) pass('非法字符被清洗为安全键名: my realm-2! → myrealm2');
    else fail('键名清洗异常: ' + keys.join('/'));

    // N5 删除
    const beforeDel = sels().length;
    tree().querySelector(`button[data-act="p-del"][data-fi="${beforeDel - 1}"]`).click();
    await sleep(180);
    if (sels().length === beforeDel - 1) pass('✕ 删除字段生效');
    else fail('删除失败: ' + sels().length);

    // N6 排序
    const two = labelsNow().slice(0, 2);
    tree().querySelector('button[data-act="p-up"][data-fi="1"]').click();
    await sleep(180);
    if (labelsNow().slice(0, 2).join('/') === [two[1], two[0]].join('/')) pass('↑ 排序生效: ' + labelsNow().slice(0, 2).join(' / '));
    else fail('排序未生效: ' + labelsNow().slice(0, 2).join('/'));

    // N7 新增字段能拿到模型数据（键名进了 game_state 契约）
    installFetch(dom.window, '```game_state\n' + JSON.stringify({ character_profile: { realm: '筑基' } }) + '\n```');
    $('closeSchemaModalBtn').click();
    await sleep(120);
    $('openApiSettingsBtn').click();
    $('apiProviderSelect').value = 'openai_compatible';
    $('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
    $('apiKeyInput').value = 'sk-x';
    $('saveApiConfigBtn').click();
    $('playerInput').value = '查看境界';
    $('sendActionBtn').click();
    await sleep(400);
    const sys = dom.window.__lastSystem || '';
    if (/"realm":\s*"境界"/.test(sys)) pass('编辑器新增的字段已进入 game_state 契约（模型知道要填它）');
    else fail('新增字段不在提示词契约里');

    dom.window.close();
  }

  console.log('\n=== O. 创建项可直接编辑选项内容与占位提示 ===');
  {
    const dom = boot({ injectCss: true });
    const doc = dom.window.document;
    const $ = (id) => doc.getElementById(id);
    await waitForInit(doc);

    $('openSchemaModalBtn').click();
    await sleep(120);
    const tree = () => $('creationTree');
    const optInput = () => tree().querySelector('input[data-act="c-options"][data-ri="0"][data-fi="1"]');
    const phInput = () => tree().querySelector('input[data-act="c-placeholder"][data-ri="0"][data-fi="0"]');
    const jsonCreation = () => JSON.parse($('schemaJsonTextarea').value).creation;
    const fieldAt = (ri, fi) => jsonCreation().rows[ri].fields[fi];

    if (optInput() && optInput().value === '男，女，其他') pass('下拉字段有了选项编辑框，并回填当前选项');
    else fail('选项编辑框缺失或未回填: ' + (optInput() ? optInput().value : '(无)'));
    if (phInput() && phInput().value === '例如：伊莱亚斯') pass('文本字段有了占位提示编辑框并回填');
    else fail('占位编辑框缺失: ' + (phInput() ? phInput().value : '(无)'));
    if (!tree().querySelector('input[data-act="c-options"][data-fi="2"]')) pass('数字字段不会多出无关的选项框');
    else fail('数字字段不该有选项框');
    if (tree().textContent.includes('胶囊内容来自')) pass('胶囊字段提示其内容来自「创建配置」，不再让人白找');
    else fail('胶囊字段缺少来源提示');

    // 选项被清空时必须回退成一个可用默认值，不能留下空下拉
    const oi = optInput();
    oi.value = '';
    oi.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await sleep(120);
    const cleared = fieldAt(0, 1).options;
    if (Array.isArray(cleared) && cleared.length === 1 && cleared[0] === '选项一') pass('选项清空后回退为单个默认项，不会留下空下拉');
    else fail('清空选项后状态异常: ' + JSON.stringify(cleared));

    // 正常编辑：逗号与顿号都当分隔符
    const oi2 = optInput();
    oi2.value = '剑修, 丹修、器修';
    oi2.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await sleep(120);
    const pi = phInput();
    pi.value = '请输入道号';
    pi.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await sleep(120);

    if (fieldAt(0, 1).options.join('/') === '剑修/丹修/器修') pass('逗号与顿号都被当作选项分隔符: ' + fieldAt(0, 1).options.join(' / '));
    else fail('选项解析异常: ' + JSON.stringify(fieldAt(0, 1).options));
    if (fieldAt(0, 0).placeholder === '请输入道号') pass('占位提示已写入蓝图');
    else fail('占位未写入: ' + fieldAt(0, 0).placeholder);

    // 去真实的创建表单里验证确实生效
    $('closeSchemaModalBtn').click();
    $('openWizardBtn').click();
    await sleep(220);

    const sel = $('wizardFields').querySelector('[data-ref="gender"]');
    const opts = sel ? [...sel.options].map(o => o.value) : [];
    if (opts.join('/') === '剑修/丹修/器修') pass('编辑后的选项在创建表单里生效: ' + opts.join(' / '));
    else fail('选项未在创建表单里生效: ' + opts.join('/'));

    const nameInp = $('wizardFields').querySelector('[data-ref="name"]');
    if (nameInp && nameInp.placeholder === '请输入道号') pass('编辑后的占位提示在创建表单里生效');
    else fail('占位提示未生效: ' + (nameInp ? nameInp.placeholder : '(无)'));

    dom.window.close();
  }

  console.log('\n=== P. 拖拽排序（三个编辑器共用一套重排逻辑）===');
  {
    const dom = boot({ injectCss: true });
    const doc = dom.window.document;
    const $ = (id) => doc.getElementById(id);
    await waitForInit(doc);

    // jsdom 没有布局也没有 DragEvent，这里手工派发拖拽事件并挂一个假的 dataTransfer。
    // 测的是"事件 → 重排"这条逻辑链；拖拽的视觉反馈仍需人眼确认。
    const drag = (type, target) => {
      const e = new dom.window.Event(type, { bubbles: true, cancelable: true });
      e.dataTransfer = { setData() {}, effectAllowed: '', dropEffect: '' };
      target.dispatchEvent(e);
      return e;
    };
    const rowsOf = (boxId) => [...$(boxId).querySelectorAll('[data-drag-row]')];
    const profileKeys = () => JSON.parse($('schemaJsonTextarea').value).profileFields.map(f => f.key);
    const creationKeys = (ri) => JSON.parse($('schemaJsonTextarea').value).creation.rows[ri].fields.map(f => f.key);
    const sectionIds = (ti) => JSON.parse($('schemaJsonTextarea').value).tabs[ti].sections.map(s => s.id);

    $('openSchemaModalBtn').click();
    await sleep(150);

    // P1 三棵树的行都标成了可拖拽
    if (rowsOf('profileTree').length === 7) pass('角色卡版式：7 个字段行都可拖拽');
    else fail('角色卡可拖拽行数异常: ' + rowsOf('profileTree').length);
    if (rowsOf('schemaTree').length === 10) pass('结构编辑器：4 个页签共 10 个面板都可拖拽');
    else fail('结构面板可拖拽行数异常: ' + rowsOf('schemaTree').length);
    const tab0Rows = () => [...$('schemaTree').querySelector('[data-ti="0"]').querySelectorAll('[data-drag-row]')];
    if (tab0Rows().length === 6) pass('首个页签内 6 个面板各自成行（拖拽只在页签内生效）');
    else fail('首页签可拖拽行数异常: ' + tab0Rows().length);
    if (rowsOf('creationTree').length === 7) pass('创建表单：7 个创建项都可拖拽');
    else fail('创建项可拖拽行数异常: ' + rowsOf('creationTree').length);

    // P2 拖拽时有视觉反馈，结束后必须清掉
    const rows = rowsOf('profileTree');
    const before0 = profileKeys();
    drag('dragstart', rows[0]);
    if (rows[0].classList.contains('opacity-50')) pass('拖拽开始时该行有 opacity-50 反馈');
    else fail('拖拽开始没有视觉反馈');
    drag('dragover', rows[2]);
    drag('drop', rows[2]);
    if (!doc.querySelector('#profileTree [data-drag-row]').classList.contains('opacity-50')) pass('放下后视觉反馈已清除');
    else fail('放下后 opacity-50 残留');

    // P3 角色卡字段：把第 1 个拖到第 3 个的位置
    const after0 = profileKeys();
    const expect0 = before0.slice();
    expect0.splice(2, 0, expect0.splice(0, 1)[0]);
    if (after0.join(',') === expect0.join(',')) pass('拖拽重排角色卡字段生效: ' + after0.join(' → '));
    else fail(`角色卡重排结果不对: ${after0.join(',')} 期望 ${expect0.join(',')}`);

    // P4 创建表单：同一字段行内换位（name, gender, age → gender, age, name）
    const cRows = rowsOf('creationTree');
    const cBefore = creationKeys(0);
    drag('dragstart', cRows[0]);
    drag('dragover', cRows[2]);
    drag('drop', cRows[2]);
    await sleep(120);
    const cAfter = creationKeys(0);
    if (cAfter.join(',') === 'gender,age,name') pass('拖拽重排创建项生效（同一字段行内）: ' + cAfter.join(' / '));
    else fail(`创建项重排结果不对: ${cAfter.join(',')}（原 ${cBefore.join(',')}）`);

    // P5 跨字段行拖拽必须被忽略：不同父容器不允许互换，否则会串行
    const cRows2 = rowsOf('creationTree');
    const row0Keys = creationKeys(0).join(',');
    const row1Keys = creationKeys(1).join(',');
    drag('dragstart', cRows2[0]);          // 第 1 行的某个创建项
    drag('dragover', cRows2[3]);           // 落到第 2 行的某个创建项上
    drag('drop', cRows2[3]);
    await sleep(120);
    if (creationKeys(0).join(',') === row0Keys && creationKeys(1).join(',') === row1Keys) {
      pass('跨字段行的拖拽被忽略（不会把创建项串到别的行）');
    } else {
      fail(`跨行拖拽污染了数据: 行0=${creationKeys(0).join(',')} 行1=${creationKeys(1).join(',')}`);
    }

    // P6 结构编辑器：同一页签内换位
    const sRows = rowsOf('schemaTree');
    const sBefore = sectionIds(0);
    drag('dragstart', sRows[0]);
    drag('dragover', sRows[2]);
    drag('drop', sRows[2]);
    await sleep(120);
    const sAfter = sectionIds(0);
    const expectS = sBefore.slice();
    expectS.splice(2, 0, expectS.splice(0, 1)[0]);
    if (sAfter.join(',') === expectS.join(',')) pass('拖拽重排结构面板生效: ' + sAfter.join(' → '));
    else fail(`结构重排结果不对: ${sAfter.join(',')} 期望 ${expectS.join(',')}`);
    if (sAfter.length === sBefore.length) pass('重排没有丢面板或多出面板');

    // P7 拖到自己身上应当没有任何变化
    const pRows = rowsOf('profileTree');
    const selfBefore = profileKeys().join(',');
    drag('dragstart', pRows[1]);
    drag('dragover', pRows[1]);
    drag('drop', pRows[1]);
    await sleep(120);
    if (profileKeys().join(',') === selfBefore) pass('拖回自己身上不产生任何变化');
    else fail('拖到自己身上却改了顺序');

    // P8 ↑↓ 按钮仍然可用（键盘/无鼠标场景，且这是可自动验证的那条路）
    const bt = rowsOf('profileTree');
    const upBefore = profileKeys().join(',');
    $('profileTree').querySelector('button[data-act="p-up"][data-fi="1"]').click();
    await sleep(120);
    if (profileKeys().join(',') !== upBefore) pass('↑ 按钮仍然可用，两条路共用同一套重排逻辑');
    else fail('↑ 按钮失效了');

    dom.window.close();
  }

  console.log('\n=== Q. 面板折叠开关（蓝图可配：不折叠 / 逐项 / 整块）===');
  {
    const dom = boot({ injectCss: true });
    const doc = dom.window.document;
    const $ = (id) => doc.getElementById(id);
    await waitForInit(doc);

    const NPCS = JSON.stringify({
      bars: [{ label: '生命', current: 80, max: 100, color: 'rose' }],
      npc_codex: [{ name: '莉薇娅', race: '人类', personality: '冷静', love_type: '盟友' }]
    });
    installFetch(dom.window, 'GM 正文。\n\n```game_state\n' + NPCS + '\n```');

    $('openApiSettingsBtn').click();
    $('apiProviderSelect').value = 'openai_compatible';
    $('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
    $('apiKeyInput').value = 'sk-x';
    $('saveApiConfigBtn').click();

    const SCHEMA = {
      version: 1, name: '折叠测试',
      tabs: [{
        id: 'stats', label: '属性',
        sections: [
          { id: 'vitals', type: 'bars', label: '资源条', source: 'bars', collapse: 'section' },
          { id: 'codex', type: 'entities', label: 'NPC', source: 'npc_codex', collapse: 'none',
            dimensions: [{ key: 'trust', deltaKey: 'trustDelta', label: '信任', max: 100, tone: 'cyan' }] },
          { id: 'states', type: 'tags', label: '状态', source: 'status_effects', collapse: 'hack' }
        ]
      }]
    };
    applySchemaTo(dom, SCHEMA);
    await sleep(200);
    $('playerInput').value = '开一局';
    $('sendActionBtn').click();
    await sleep(450);

    const secEl = (id) => sectionEl(doc, id);
    // section 根节点的"标题行"= 含标题的那个直接子元素；其余直接子元素就是可折叠体
    const headerOf = (id) => secEl(id).children[0];
    const bodiesOf = (id) => [...secEl(id).children].slice(1);
    const allBodiesHidden = (id) => bodiesOf(id).every(b => b.classList.contains('hidden'));

    // Q1 整块折叠：默认收起，只留标题行
    if (allBodiesHidden('vitals')) pass('collapse=section 的面板默认收起（只留标题行）');
    else fail('整块折叠没有生效');
    const chev = headerOf('vitals').querySelector('[data-sec-chevron]');
    if (chev && chev.textContent === '▸') pass('收起态显示 ▸ 箭头');
    else fail('缺少 ▸ 箭头: ' + (chev ? chev.textContent : '(无)'));
    if (headerOf('vitals').getAttribute('aria-expanded') === 'false') pass('收起态 aria-expanded=false');
    else fail('aria-expanded 不对');

    // Q2 点标题展开
    headerOf('vitals').click();
    await sleep(60);
    if (!allBodiesHidden('vitals')) pass('点标题后可展开');
    else fail('点标题没有展开');
    if (chev.textContent === '▾') pass('展开态箭头变为 ▾');
    else fail('展开态箭头异常: ' + chev.textContent);
    if (secEl('vitals').textContent.includes('80 / 100')) pass('展开后能看到内容（生命 80/100）');
    else fail('展开后内容异常');

    // Q3 展开状态要扛得住蓝图重建（外壳会被整段重建）
    applySchemaTo(dom, SCHEMA);
    await sleep(250);
    if (!allBodiesHidden('vitals')) pass('蓝图重建后展开状态被保留（状态不在 DOM 上）');
    else fail('蓝图重建后展开状态丢了');

    // Q4 collapse=none：NPC 卡片不折叠、也不该出现折叠开关
    if (!doc.querySelector('[data-npc-toggle]')) pass('collapse=none 时 NPC 卡片没有折叠开关');
    else fail('collapse=none 却还有折叠开关');
    const detail = doc.querySelector('[data-npc-detail]');
    if (detail && !detail.classList.contains('hidden')) pass('collapse=none 时 NPC 详情直接展开');
    else fail('collapse=none 时详情仍被折叠');

    // Q5 非法值按默认处理（tags 不是 entities，默认 none → 不折叠、无箭头）
    if (!headerOf('states').querySelector('[data-sec-chevron]')) pass('非法 collapse 值被忽略（tags 回落到默认的不折叠）');
    else fail('非法值被当成了 section 折叠');

    // Q6 编辑器里的折叠下拉：存在、值正确、改动会写进蓝图
    $('openSchemaModalBtn').click();
    await sleep(120);
    const sels = () => [...$('schemaTree').querySelectorAll('select[data-act="sec-collapse"]')];
    if (sels().length === 3) pass('结构编辑器里每个面板都有折叠下拉（3 个）');
    else fail('折叠下拉数量异常: ' + sels().length);
    const codexSel = sels().find(s => s.dataset.si === '1') || $('schemaTree').querySelector('select[data-act="sec-collapse"][data-si="1"]');
    if (codexSel && codexSel.value === 'none') pass('下拉回填当前值（entities 这里是 none）');
    else fail('下拉未回填: ' + (codexSel ? codexSel.value : '(无)'));
    if (![...($('schemaTree').querySelector('select[data-act="sec-collapse"][data-si="0"]') || {}).options || []].some(o => o.value === 'items')) {
      pass('非 entities 面板不给「逐项折叠」这个无意义的选项');
    } else {
      fail('bars 面板竟然提供了「逐项折叠」选项');
    }

    codexSel.value = 'items';
    codexSel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await sleep(250);
    const json = getSchemaFromTextarea($);
    if (json.tabs[0].sections[1].collapse === 'items') pass('下拉改动已写入蓝图 JSON');
    else fail('改动没写进蓝图: ' + JSON.stringify(json.tabs[0].sections[1].collapse));

    $('closeSchemaModalBtn').click();
    await sleep(150);
    if (doc.querySelector('[data-npc-toggle]')) pass('改成「逐项折叠」后 NPC 卡片出现了折叠开关');
    else fail('改成 items 后仍没有折叠开关');
    const d2 = doc.querySelector('[data-npc-detail]');
    if (d2 && d2.classList.contains('hidden')) pass('改动后 NPC 详情默认收起');
    else fail('改动后 NPC 详情没有收起');

    // Q7 显式 none 必须能覆盖 entities 的默认值
    $('openSchemaModalBtn').click();
    await sleep(120);
    const codexSel2 = $('schemaTree').querySelector('select[data-act="sec-collapse"][data-si="1"]');
    codexSel2.value = 'none';
    codexSel2.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await sleep(250);
    const json2 = getSchemaFromTextarea($);
    if (json2.tabs[0].sections[1].collapse === 'none') pass('显式选「不折叠」会写进蓝图（否则 entities 会回落到默认的 items）');
    else fail('显式 none 没有写入: ' + JSON.stringify(json2.tabs[0].sections[1].collapse));

    dom.window.close();
  }

  console.log('\n=== R. NPC 静态字段（种族/性格 类）：蓝图声明 → 渲染 → 提示词契约 ===');
  {
    // 这份蓝图刻意**不含** race / personality，只声明两个自定义静态字段：
    // 渲染器或提示词契约里只要还写死着默认那套，这一组就会红。
    const INFO_SCHEMA = {
      version: 1, name: '静态字段测试',
      profileFields: [{ key: 'name', label: '姓名' }],
      tabs: [
        { id: 'stats', label: '属性', sections: [{ id: 'profile', type: 'profile', label: '档案' }] },
        {
          id: 'npc', label: '人际',
          sections: [{
            id: 'codex', type: 'entities', label: '人际网络', source: 'npc_codex',
            badgeKey: 'attitude',
            infoFields: [{ key: 'faction', label: '所属势力' }, { key: 'species', label: '物种' }],
            dimensions: [{ key: 'trust', deltaKey: 'trustDelta', label: '信任', max: 100, tone: 'cyan' }]
          }]
        }
      ]
    };

    const dom = bootWithSchema(INFO_SCHEMA);
    const doc = dom.window.document;
    const $ = (id) => doc.getElementById(id);
    await waitForInit(doc);

    const XSS = '<img src=x onerror="window.__pwned=1">';
    installFetch(dom.window, [
      'GM 正文。',
      '',
      '```game_state',
      JSON.stringify({
        npc_codex: [
          { name: '凯尔', faction: '夜枭帮', species: XSS, attitude: '提防' },
          { name: '无名者', faction: '路人' }
        ]
      }),
      '```'
    ].join('\n'));

    $('openApiSettingsBtn').click();
    $('apiProviderSelect').value = 'openai_compatible';
    $('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
    $('apiKeyInput').value = 'sk-x';
    $('saveApiConfigBtn').click();

    clickTab(doc, 'npc');
    $('playerInput').value = '打探消息';
    $('sendActionBtn').click();
    await sleep(500);

    const cards = [...doc.querySelectorAll('[data-npc-card]')];
    const cardOf = (n) => cards.find(c => c.textContent.includes(n));
    const kyle = cardOf('凯尔');
    if (!kyle) fail('自定义静态字段的 NPC 卡片没有渲染');
    else {
      kyle.querySelector('[data-npc-toggle]').click();
      await sleep(60);
      const detail = kyle.querySelector('[data-npc-detail]');
      const text = detail ? detail.textContent : '';
      if (text.includes('所属势力：夜枭帮')) pass('蓝图声明的 infoFields 键（faction）已渲染');
      else fail('自定义静态字段未渲染: ' + text.slice(0, 120));
      if (text.includes('物种：')) pass('标签照蓝图显示（物种），不是写死的"种族/性格"');
      else fail('标签未按蓝图显示');
      if (!kyle.textContent.includes('种族：') && !kyle.textContent.includes('性格：')) pass('没有渲染写死的 race / personality 那套');
      else fail('仍在渲染写死的默认静态字段');

      // 契约必须同步：否则模型永远不知道要输出 faction / species
      const sys = dom.window.__lastSystem || '';
      if (/"faction":\s*"所属势力"/.test(sys) && /"species":\s*"物种"/.test(sys)) pass('game_state 契约的 npc_codex 示例按蓝图生成');
      else fail('提示词未反映自定义静态字段');
      if (!/"race":/.test(sys) && !/"personality":/.test(sys)) pass('提示词里已不再写死 race / personality');
      else fail('提示词仍写死默认静态字段');
      if (/"attitude":/.test(sys)) pass('badgeKey（关系定位）也在契约里');
      else fail('契约缺少 badgeKey');

      // 模型输出里的 HTML 只能当文本
      if (kyle.querySelector('img') === null) pass('静态字段值里的 <img> 没有被当作 HTML 解析');
      else fail('静态字段值被当 HTML 插入了！');
      if (dom.window.__pwned === undefined) pass('XSS payload 未执行');
      else fail('XSS payload 被执行了');
    }

    const other = cardOf('无名者');
    if (!other) fail('第二个 NPC 未渲染');
    else {
      other.querySelector('[data-npc-toggle]').click();
      await sleep(60);
      const t2 = other.querySelector('[data-npc-detail]').textContent;
      if (t2.includes('所属势力：路人') && !t2.includes('物种：')) pass('缺值的字段被跳过，不会留下空的「物种：」');
      else fail('缺值字段处理异常: ' + t2.slice(0, 120));
    }
    dom.window.close();
  }

  console.log('\n===== ' + (failures === 0 ? '全部通过' : failures + ' 项失败') + ' =====');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.log('[FATAL] ' + e.stack); process.exit(1); });
