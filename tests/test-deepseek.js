// DeepSeek 默认配置与思考模式行为验证
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', 'src', 'index.html');
const PURIFY_PATH = path.join(__dirname, '..', 'src', 'vendor', 'purify.min.js');

let failures = 0;
const fail = (m) => { failures++; console.log('  [FAIL] ' + m); };
const pass = (m) => console.log('  [ ok ] ' + m);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const harness = require('./harness');

function boot(opts = {}) {
  return new JSDOM(harness.buildHtml(Object.assign({ injectCss: true }, opts)), { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://app.local/' });
}

let captured = [];
function installFetch(window) {
  window.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    captured.push({ url, body });
    const text = 'GM 输出。\n\n```game_state\n{"location":"测试地"}\n```';
    return {
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
              return { done: false, value: new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n') };
            }
          };
        }
      }
    };
  };
}

async function waitForInit(doc) {
  for (let i = 0; i < 80; i++) {
    if (doc.querySelectorAll('#hudTabBar .hud-tab-btn').length > 0) return true;
    await sleep(25);
  }
  return false;
}

(async () => {
  const dom = boot();
  const { window } = dom;
  const doc = window.document;
  const $ = (id) => doc.getElementById(id);
  installFetch(window);

  console.log('\n=== A. 默认配置 ===');
  if (!(await waitForInit(doc))) { console.log('启动失败'); process.exit(1); }
  pass('应用已启动');

  $('openApiSettingsBtn').click();
  if ($('apiProviderSelect').value === 'openai_compatible') pass('默认协议 = openai_compatible（不再是 gemini）');
  else fail('默认协议异常: ' + $('apiProviderSelect').value);
  if ($('apiBaseUrlInput').value === 'https://api.deepseek.com') pass('默认 Base URL = https://api.deepseek.com（不带 /v1，符合官方文档）');
  else fail('默认 Base URL 异常: ' + $('apiBaseUrlInput').value);
  if ($('apiModelInput').value === 'deepseek-flash') pass('默认模型 = deepseek-flash');
  else fail('默认模型异常: ' + $('apiModelInput').value);
  if ($('settingThinkingMode').checked === true) pass('默认开启深度思考模式（长约束提示词下更稳）');
  else fail('默认关闭了深度思考');
  if (!$('baseUrlRow').classList.contains('hidden')) pass('Base URL 输入行默认可见（因为默认是兼容协议）');
  else fail('Base URL 行被隐藏了');
  if ($('apiProviderSelect').options[0].value === 'openai_compatible') pass('下拉框首项是 DeepSeek/兼容协议');
  else fail('下拉框首项不是兼容协议');

  // 默认值已改成开启，这里显式关掉再保存，让 B 组继续覆盖"用户自己关掉"这条路径
  $('settingThinkingMode').checked = false;
  $('apiKeyInput').value = 'sk-deepseek-test';
  $('saveApiConfigBtn').click();

  // ---- 关闭思考模式（用户显式关闭）----
  console.log('\n=== B. 思考模式关闭（用户显式关闭）===');
  captured = [];
  $('playerInput').value = '测试行动一';
  $('sendActionBtn').click();
  await sleep(350);

  let req = captured[0];
  if (!req) { fail('未捕获请求'); process.exit(1); }
  if (req.url === 'https://api.deepseek.com/chat/completions') pass('请求 URL 正确: ' + req.url);
  else fail('请求 URL 异常: ' + req.url);
  if (req.body.thinking && req.body.thinking.type === 'disabled') pass('已下发 thinking:{type:"disabled"}（用户显式关闭时生效，没被新默认值顶掉）');
  else fail('thinking 参数异常: ' + JSON.stringify(req.body.thinking));
  if (typeof req.body.temperature === 'number') pass('非思考模式下 temperature 正常下发: ' + req.body.temperature);
  else fail('temperature 缺失');
  if (req.body.stream === true) pass('stream 仍为 true');
  if (req.body.model === 'deepseek-flash') pass('模型名正确');

  // ---- 开启思考模式 ----
  console.log('\n=== C. 思考模式开启 ===');
  $('openApiSettingsBtn').click();
  $('settingThinkingMode').checked = true;
  $('saveApiConfigBtn').click();
  captured = [];
  $('playerInput').value = '测试行动二';
  $('sendActionBtn').click();
  await sleep(350);

  req = captured[0];
  if (req.body.thinking && req.body.thinking.type === 'enabled') pass('thinking 切换为 enabled');
  else fail('thinking 未切换: ' + JSON.stringify(req.body.thinking));
  if (!('temperature' in req.body)) pass('思考模式下不再下发 temperature（官方会忽略它，发了反而误导）');
  else fail('思考模式下仍下发了 temperature: ' + req.body.temperature);

  // ---- 非 DeepSeek 端点不应收到 thinking ----
  console.log('\n=== D. 其它兼容后端不受影响 ===');
  $('openApiSettingsBtn').click();
  $('apiBaseUrlInput').value = 'http://localhost:11434/v1';
  $('apiModelInput').value = 'llama3';
  $('saveApiConfigBtn').click();
  captured = [];
  $('playerInput').value = '测试行动三';
  $('sendActionBtn').click();
  await sleep(350);

  req = captured[0];
  if (req.url === 'http://localhost:11434/v1/chat/completions') pass('Ollama 风格地址拼接正确: ' + req.url);
  else fail('地址拼接异常: ' + req.url);
  if (!('thinking' in req.body)) pass('非 DeepSeek 端点不下发 thinking（避免未知参数 400）');
  else fail('向非 DeepSeek 端点下发了 thinking');
  if (typeof req.body.temperature === 'number') pass('非 DeepSeek 端点保留 temperature');
  else fail('temperature 丢失');

  // ---- 提示词缓存友好性：稳定内容在前，动态内容在后 ----
  console.log('\n=== E. 提示词前缀缓存友好性 ===');
  const sys = req.body.messages[0].content;
  const iWorld = sys.indexOf('【核心世界观设定】');
  const iRules = sys.indexOf('【主持风格与游戏法则】');
  const iSpec = sys.indexOf('【数值与状态分离格式】');
  const iDynamic = sys.indexOf('以下为每回合变化的动态信息');
  const iSummary = sys.indexOf('【前情提要');
  const iDigest = sys.indexOf('【系统记录的当前数值');

  if (iDynamic > 0) pass('存在动态信息分界标记');
  else fail('缺少动态信息分界标记');
  if (iWorld >= 0 && iWorld < iRules && iRules < iSpec && iSpec < iDynamic) pass('稳定内容（世界观→法则→格式规范）全在动态区之前');
  else fail(`顺序异常 world=${iWorld} rules=${iRules} spec=${iSpec} dynamic=${iDynamic}`);
  if (iSummary > iDynamic && iDigest > iDynamic) pass('前情提要与当前数值都在动态区之后（保证可缓存前缀最大化）');
  else fail(`动态内容位置异常 summary=${iSummary} digest=${iDigest}`);

  // 切换协议时自动纠正地址/模型
  console.log('\n=== F. 协议切换自动纠正地址与模型 ===');
  $('openApiSettingsBtn').click();

  // F1: 自定义地址必须被保留，不能被协议切换覆盖
  $('apiBaseUrlInput').value = 'http://localhost:11434/v1';
  $('apiModelInput').value = 'llama3';
  $('apiProviderSelect').value = 'gemini';
  $('apiProviderSelect').onchange({ target: { value: 'gemini' } });
  if ($('apiBaseUrlInput').value === 'http://localhost:11434/v1' && $('apiModelInput').value === 'llama3') {
    pass('自定义 Ollama 配置在切协议时被保留（不被误覆盖）');
  } else {
    fail(`自定义配置被覆盖: ${$('apiBaseUrlInput').value} / ${$('apiModelInput').value}`);
  }
  if ($('baseUrlRow').classList.contains('hidden')) pass('Gemini 下隐藏 Base URL 行');
  else fail('Gemini 下未隐藏 Base URL 行');

  // F2: 从 DeepSeek 默认值切到 Gemini，应自动纠正
  $('apiBaseUrlInput').value = 'https://api.deepseek.com';
  $('apiModelInput').value = 'deepseek-flash';
  $('apiProviderSelect').value = 'gemini';
  $('apiProviderSelect').onchange({ target: { value: 'gemini' } });
  if ($('apiBaseUrlInput').value === 'https://generativelanguage.googleapis.com') pass('切到 Gemini 时 DeepSeek 地址被自动纠正');
  else fail('地址未纠正: ' + $('apiBaseUrlInput').value);
  if ($('apiModelInput').value === 'gemini-2.5-flash') pass('切到 Gemini 时模型自动换成 gemini-2.5-flash');
  else fail('模型未纠正: ' + $('apiModelInput').value);

  // F3: 再切回兼容协议，应恢复 DeepSeek 默认值
  $('apiProviderSelect').value = 'openai_compatible';
  $('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
  if ($('apiBaseUrlInput').value === 'https://api.deepseek.com' && $('apiModelInput').value === 'deepseek-flash') {
    pass('切回兼容协议时自动恢复 DeepSeek 默认值');
  } else {
    fail(`切回失败: ${$('apiBaseUrlInput').value} / ${$('apiModelInput').value}`);
  }
  if (!$('thinkingModeRow').classList.contains('hidden')) pass('兼容协议下显示思考模式开关');
  else fail('思考模式开关未显示');

  console.log('\n=== G. API Key 安全存储（DPAPI）与老存档迁移 ===');
  {
    // 用假的原生桥模拟 Rust 侧的 secret_* 命令。真实实现把值交给 Windows DPAPI 加密
    // 后写进应用数据目录；这里只要保证「进桥、出桥、localStorage 里不留明文」这条契约。
    // 注意要模拟"存的是密文、读回来是明文"：只加密不解密的话，
    // 自检的往返比对必然失败（这正是自检要抓的那类错误）。
    const FAKE_BRIDGE = `
      window.__secretStore = {};
      window.__invokeLog = [];
      window.__TAURI_INTERNALS__ = {
        invoke(cmd, args) {
          window.__invokeLog.push(cmd);
          if (cmd === 'secret_set') {
            if (args.value) window.__secretStore[args.name] = 'dpapi:' + args.value;
            else delete window.__secretStore[args.name];
            return Promise.resolve(null);
          }
          if (cmd === 'secret_get') {
            const v = window.__secretStore[args.name];
            return Promise.resolve(v ? String(v).replace(/^dpapi:/, '') : null);
          }
          if (cmd === 'secret_delete') { delete window.__secretStore[args.name]; return Promise.resolve(null); }
          return Promise.reject(new Error('未知命令 ' + cmd));
        }
      };
    `;

    // ---- G1 老存档迁移：明文 Key 应被收进 DPAPI，并从 localStorage 抹掉 ----
    const legacyDom = boot({
      preScript: `localStorage.setItem('chronicle_api_config', JSON.stringify({apiKey:'sk-legacy-123',provider:'openai_compatible',model:'deepseek-flash'}));` + FAKE_BRIDGE,
    });
    const lw = legacyDom.window;
    const ldoc = lw.document;
    const l$ = (id) => ldoc.getElementById(id);
    if (!(await waitForInit(ldoc))) { fail('迁移场景启动失败'); }
    await sleep(200);

    if (lw.__secretStore.api_key === 'dpapi:sk-legacy-123') pass('老存档里的明文 Key 已迁移进安全存储');
    else fail('未迁移进安全存储: ' + JSON.stringify(lw.__secretStore));

    const legacyCfg = JSON.parse(lw.localStorage.getItem('chronicle_api_config') || '{}');
    if (!('apiKey' in legacyCfg)) pass('迁移后 localStorage 不再含明文 apiKey');
    else fail('localStorage 仍留明文 Key: ' + legacyCfg.apiKey);
    if (legacyCfg.model === 'deepseek-flash') pass('迁移只搬走 Key，其余配置原样保留');
    else fail('其余配置被破坏: ' + JSON.stringify(legacyCfg));

    l$('openApiSettingsBtn').click();
    await sleep(60);
    if (l$('apiKeyInput').value === 'sk-legacy-123') pass('迁移后的 Key 能正常回填到设置面板');
    else fail('Key 未回填: ' + l$('apiKeyInput').value);
    if (/DPAPI/.test(l$('apiKeyStorageNote').textContent)) pass('设置面板如实告知使用的是 DPAPI 加密存储');
    else fail('存储说明未更新: ' + l$('apiKeyStorageNote').textContent);

    // ---- G2 保存新 Key：只进安全存储，不落 localStorage 明文 ----
    l$('apiKeyInput').value = 'sk-new-456';
    l$('saveApiConfigBtn').click();
    await sleep(200);
    if (lw.__secretStore.api_key === 'dpapi:sk-new-456') pass('保存后安全存储里的值已更新');
    else fail('安全存储未更新: ' + JSON.stringify(lw.__secretStore));
    const cfg2 = JSON.parse(lw.localStorage.getItem('chronicle_api_config') || '{}');
    if (!('apiKey' in cfg2)) pass('保存后 localStorage 仍不含明文 apiKey');
    else fail('保存后又写回了明文: ' + cfg2.apiKey);

    const cmds = [...new Set(lw.__invokeLog)].sort().join(',');
    if (cmds === 'secret_get,secret_set') pass('只调用了白名单内的安全存储命令: ' + cmds);
    else fail('出现了预期外的原生命令调用: ' + cmds);

    // ---- G2b 自检按钮：走真实完整链路（写 → 读回 → 比对 → 清理）----
    const stBtn = l$('secureStorageSelfTestBtn');
    const stOut = l$('secureStorageSelfTestResult');
    if (stBtn && stOut) pass('设置面板里有「测试安全存储」按钮');
    else fail('找不到自检按钮');
    stBtn.click();
    await sleep(200);
    if (/自检通过/.test(stOut.textContent)) pass('有原生桥时自检通过: ' + stOut.textContent);
    else fail('自检未通过: ' + stOut.textContent);
    if (!('selftest' in lw.__secretStore)) pass('自检用过的探针值已被清理，不留垃圾');
    else fail('自检残留了探针值: ' + JSON.stringify(lw.__secretStore));
    if (lw.__secretStore.api_key === 'dpapi:sk-new-456') pass('自检没有碰真正的 api_key');
    else fail('自检污染了真正的 api_key: ' + JSON.stringify(lw.__secretStore));

    // 自检必须能真的报错：让桥在写入时抛异常
    const brokenInvoke = lw.__TAURI_INTERNALS__.invoke;
    lw.__TAURI_INTERNALS__.invoke = (cmd) => (cmd === 'secret_set'
      ? Promise.reject(new Error('模拟磁盘写失败'))
      : brokenInvoke(cmd));
    stBtn.click();
    await sleep(200);
    if (/自检失败/.test(stOut.textContent) && /模拟磁盘写失败/.test(stOut.textContent)) {
      pass('安全存储写入失败时自检如实报错: ' + stOut.textContent);
    } else {
      fail('写入失败却没有报错: ' + stOut.textContent);
    }
    lw.__TAURI_INTERNALS__.invoke = brokenInvoke;

    legacyDom.window.close();

    // ---- G3 没有原生桥时（浏览器直开 / jsdom）退回旧行为，且如实说明 ----
    const plainDom = boot();
    const pw = plainDom.window;
    const pdoc = pw.document;
    const p$ = (id) => pdoc.getElementById(id);
    if (!(await waitForInit(pdoc))) { fail('回退场景启动失败'); }
    p$('openApiSettingsBtn').click();
    p$('apiKeyInput').value = 'sk-plain-789';
    p$('saveApiConfigBtn').click();
    await sleep(120);

    const cfg3 = JSON.parse(pw.localStorage.getItem('chronicle_api_config') || '{}');
    if (cfg3.apiKey === 'sk-plain-789') pass('无原生桥时仍按旧行为存 localStorage（不会把 Key 弄丢）');
    else fail('回退路径丢了 Key: ' + JSON.stringify(cfg3));
    if (/localStorage/.test(p$('apiKeyStorageNote').textContent)) pass('无原生桥时如实说明是明文 localStorage');
    else fail('回退路径的说明不准确: ' + p$('apiKeyStorageNote').textContent);
    p$('secureStorageSelfTestBtn').click();
    await sleep(150);
    if (/没有原生桥/.test(p$('secureStorageSelfTestResult').textContent)) pass('无原生桥时自检直接说明原因，不会假装通过');
    else fail('无原生桥时自检结果不对: ' + p$('secureStorageSelfTestResult').textContent);
    plainDom.window.close();
  }

  console.log('\n=== H. 世界观文本上限：65000 字 ===');
  {
    const dom = boot();
    const doc = dom.window.document;
    const $ = (id) => doc.getElementById(id);
    const reqs = [];
    const mockLlm = (text) => {
      dom.window.fetch = async (url, opts) => {
        reqs.push({ url, body: JSON.parse(opts.body) });
        return {
          ok: true, status: 200,
          headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
          body: {
            getReader: () => {
              let done = false;
              return { read: async () => { if (done) return { done: true }; done = true; return { done: false, value: new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n') }; } };
            }
          }
        };
      };
    };
    const lastPrompt = () => {
      const r = reqs[reqs.length - 1];
      const msgs = r && r.body && r.body.messages;
      return (msgs && msgs.length) ? msgs[msgs.length - 1].content : '';
    };

    if (!(await waitForInit(doc))) fail('启动失败');
    $('openApiSettingsBtn').click();
    $('apiProviderSelect').value = 'openai_compatible';
    $('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
    $('apiKeyInput').value = 'sk-x';
    $('saveApiConfigBtn').click();

    const ANALYSIS_OK = '```json\n' + JSON.stringify({
      races: ['人族'], classes: ['剑修'], identities: ['弟子'],
      attributes: ['根骨'], pointBudget: 25, maxPerStat: 8
    }) + '\n```';

    // 标记刻意放在第 40000 字：旧的分析上限 30000 与生成蓝图上限 12000 都会把它截掉
    const MARK = '【雪山派标记】';
    const longLore = '甲'.repeat(40000) + MARK + '乙'.repeat(22000);

    // H1 分析世界观：40000 字处的内容必须进提示词
    mockLlm(ANALYSIS_OK);
    reqs.length = 0;
    $('toastContainer').innerHTML = '';
    $('worldLoreInput').value = longLore;
    $('analyzeLoreBtn').click();
    await sleep(500);
    if (lastPrompt().includes(MARK)) pass('分析世界观：第 40000 字处的内容确实进了提示词（旧上限 30000 会截掉它）');
    else fail('分析世界观时仍被截断，提示词长度 ' + lastPrompt().length);
    if (!$('toastContainer').textContent.includes('超出')) pass('未超限时不会多弹一个提示打扰用户');
    else fail('未超限却提示截断: ' + $('toastContainer').textContent.replace(/\s+/g, ' ').slice(0, 80));

    // H2 超出 65000：尾部必须被截掉，而且必须明确告知
    mockLlm(ANALYSIS_OK);
    reqs.length = 0;
    $('toastContainer').innerHTML = '';
    const TAIL = '【结尾标记】';
    $('worldLoreInput').value = '甲'.repeat(66000) + TAIL;
    $('analyzeLoreBtn').click();
    await sleep(500);
    const p2 = lastPrompt();
    if (!p2.includes(TAIL)) pass('超出 65000 字的部分没有被送进模型（截断仍然生效，没有无上限外发）');
    else fail('超限内容没有被截断');
    if (p2.length >= 65000 && p2.length < 68000) pass('实际送入的正文长度符合 65000 上限（提示词共 ' + p2.length + ' 字符）');
    else fail('送入长度异常: ' + p2.length);
    if ($('toastContainer').textContent.includes('65000')) pass('超限时明确提示了上限数值');
    else fail('超限却没有提示: ' + $('toastContainer').textContent.replace(/\s+/g, ' ').slice(0, 80));

    // H3 生成蓝图：这条以前静默截断在 12000，同样必须拿到 40000 字处的内容
    mockLlm(JSON.stringify({ name: '雪山世界', profileFields: [{ key: 'name', label: '姓名' }] }));
    reqs.length = 0;
    $('worldLoreInput').value = longLore;
    $('saveLoreBtn').click();
    $('openSchemaModalBtn').click();
    $('aiGenerateSchemaBtn').click();
    await sleep(700);
    const p3 = lastPrompt();
    if (p3.includes(MARK)) pass('生成蓝图：第 40000 字处的内容也进了提示词（旧代码静默截断在 12000）');
    else fail('生成蓝图时被截断，提示词长度 ' + p3.length);
    if (/世界观设定[\s\S]*甲{1000}/.test(p3)) pass('蓝图提示词里确实带上了完整的世界观正文');
    else fail('蓝图提示词里没有世界观正文');

    dom.window.close();
  }

  console.log('\n=== I. 长线记忆锚点：手动提炼 + 每 N 回合自动刷新 ===');
  {
    const dom = boot();
    const doc = dom.window.document;
    const $ = (id) => doc.getElementById(id);
    const calls = [];
    const isPinsCall = (body) => /长线记忆管理员/.test((body.messages && body.messages[0].content) || '');
    const sse = (text) => ({
      ok: true, status: 200,
      headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
      body: {
        getReader: () => {
          let done = false;
          return { read: async () => { if (done) return { done: true }; done = true; return { done: false, value: new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n') }; } };
        }
      }
    });
    let pinsReply = '```\n- 已与雪山派结仇\n- 老张死于断崖\n```';
    dom.window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      const pins = isPinsCall(body);
      calls.push({ pins, body });
      return sse(pins ? pinsReply : 'GM 正文。\n\n```game_state\n{"location":"雪山"}\n```');
    };
    const pinsCalls = () => calls.filter(c => c.pins);
    const lastPinsPrompt = () => {
      const c = pinsCalls()[pinsCalls().length - 1];
      const msgs = c && c.body.messages;
      return (msgs && msgs.length) ? msgs[msgs.length - 1].content : '';
    };

    if (!(await waitForInit(doc))) fail('启动失败');

    // I1 没配 API Key 时点击应提示且不发请求
    $('extractPinsBtn').click();
    await sleep(150);
    if (pinsCalls().length === 0) pass('未配置 API Key 时不会发请求');
    else fail('未配置 API Key 却发了请求');
    if (/API Key/.test($('toastContainer').textContent)) pass('未配置 API Key 时给出明确提示');
    else fail('未配置 API Key 时没有提示');

    // 配置 API + 世界观
    $('openApiSettingsBtn').click();
    $('apiProviderSelect').value = 'openai_compatible';
    $('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
    $('apiKeyInput').value = 'sk-x';
    $('saveApiConfigBtn').click();
    $('worldLoreInput').value = '雪山派与主角有血仇，断崖一役老张坠亡。';
    $('memoryPinsInput').value = '- 旧锚点：欠王二两银子';
    $('saveLoreBtn').click();

    // I2 手动提炼：提示词里必须带上世界观、现有锚点
    calls.length = 0;
    $('extractPinsBtn').click();
    await sleep(400);
    if (pinsCalls().length === 1) pass('手动点按钮会发起一次提炼请求');
    else fail('提炼请求次数异常: ' + pinsCalls().length);
    const p1 = lastPinsPrompt();
    if (p1.includes('雪山派与主角有血仇')) pass('提炼提示词里带上了世界观正文');
    else fail('提炼提示词缺少世界观');
    if (p1.includes('旧锚点：欠王二两银子')) pass('提炼提示词里带上了现有锚点（便于合并而不是覆盖）');
    else fail('提炼提示词缺少现有锚点');
    if (!$('extractPinsBtn').disabled) pass('提炼结束后按钮恢复可用');
    else fail('提炼结束后按钮仍处于禁用状态');

    // I3 返回值要洗干净并落盘（不再依赖用户点「保存全部设定」）
    const pinsVal = $('memoryPinsInput').value;
    if (pinsVal.includes('- 已与雪山派结仇') && !pinsVal.includes('```')) pass('提炼结果已写入文本框，且代码块围栏被剥掉');
    else fail('提炼结果处理异常: ' + JSON.stringify(pinsVal.slice(0, 80)));
    const slotId = dom.window.localStorage.getItem('chronicle_active_slot_id');
    const savedLore = JSON.parse(dom.window.localStorage.getItem('chronicle_' + slotId + '_lore') || '{}');
    if (savedLore.memoryPins === pinsVal) pass('提炼结果已直接存档（无需再点保存按钮）');
    else fail('提炼结果没有落盘: ' + JSON.stringify(savedLore.memoryPins));

    // I4 超长返回要被截断，避免锚点越滚越长
    pinsReply = '- 很长的条目\n'.repeat(500);   // 3500 字
    calls.length = 0;
    $('extractPinsBtn').click();
    await sleep(400);
    if ($('memoryPinsInput').value.length <= 2000) pass('超长返回被截到上限内（' + $('memoryPinsInput').value.length + ' 字）');
    else fail('超长返回没有被截断: ' + $('memoryPinsInput').value.length);

    // I5 自动刷新：间隔 2 回合，第 1 回合不该触发，第 2 回合触发一次
    pinsReply = '- 自动刷新的锚点';
    $('pinsAutoIntervalInput').value = '2';
    $('pinsAutoIntervalInput').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await sleep(80);
    if (dom.window.localStorage.getItem('chronicle_pins_auto_interval') === '2') pass('自动刷新间隔已持久化: 2');
    else fail('间隔没有持久化: ' + dom.window.localStorage.getItem('chronicle_pins_auto_interval'));

    calls.length = 0;
    $('playerInput').value = '第一回合';
    $('sendActionBtn').click();
    await sleep(400);
    if (pinsCalls().length === 0) pass('第 1 回合不触发自动刷新（2 的倍数还没到）');
    else fail('第 1 回合就触发了自动刷新');

    $('playerInput').value = '第二回合';
    $('sendActionBtn').click();
    await sleep(600);
    if (pinsCalls().length === 1) pass('第 2 回合触发了一次自动刷新');
    else fail('第 2 回合自动刷新次数异常: ' + pinsCalls().length);
    if ($('memoryPinsInput').value.includes('自动刷新的锚点')) pass('自动刷新结果同样写回文本框与存档');
    else fail('自动刷新结果没有写回: ' + JSON.stringify($('memoryPinsInput').value.slice(0, 60)));
    if (/已自动刷新长线记忆锚点/.test($('toastContainer').textContent)) pass('自动刷新后有提示（知道它动过锚点）');
    else fail('自动刷新后没有提示');

    // I6 间隔设回 0 → 不再自动触发
    $('pinsAutoIntervalInput').value = '0';
    $('pinsAutoIntervalInput').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await sleep(80);
    calls.length = 0;
    $('playerInput').value = '第三回合';
    $('sendActionBtn').click();
    await sleep(400);
    $('playerInput').value = '第四回合';
    $('sendActionBtn').click();
    await sleep(400);
    if (pinsCalls().length === 0) pass('间隔设为 0 后彻底不再自动刷新（手动按钮仍可用）');
    else fail('间隔为 0 却仍在自动刷新: ' + pinsCalls().length);

    dom.window.close();
  }

  console.log('\n=== J. 主持风格与规则约束（GM Rules）进提示词 ===');
  {
    const dom = boot();
    const doc = dom.window.document;
    const $ = (id) => doc.getElementById(id);
    const calls = [];
    dom.window.fetch = async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      const text = 'GM 正文。\n\n```game_state\n{"location":"测试地"}\n```';
      return {
        ok: true, status: 200,
        headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
        body: { getReader: () => { let d = false; return { read: async () => { if (d) return { done: true }; d = true; return { done: false, value: new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n') }; } }; } }
      };
    };
    const sys = () => {
      const c = calls[calls.length - 1];
      return (c && c.messages) ? c.messages[0].content : '';
    };
    const turn = async (label) => {
      $('playerInput').value = label;
      $('sendActionBtn').click();
      await sleep(400);
    };

    if (!(await waitForInit(doc))) fail('启动失败');
    $('openApiSettingsBtn').click();
    $('apiProviderSelect').value = 'openai_compatible';
    $('apiProviderSelect').onchange({ target: { value: 'openai_compatible' } });
    $('apiKeyInput').value = 'sk-x';
    $('saveApiConfigBtn').click();

    const MARK = 'RULE-MARKER-全程使用第二人称';
    const UNSAVED = 'RULE-UNSAVED-不该出现';

    // J0 没填 GM Rules 时，必须用带文风约束的默认值
    // （起因：提示词里原本完全没有文风约束，模型自由发挥成辞藻堆砌 + 电报体省略）
    await turn('行动零');
    if (/【文风要求】/.test(sys())) pass('未填 GM Rules 时使用了带文风约束的默认值');
    else fail('默认 GM Rules 里没有文风约束');
    if (/电报体/.test(sys()) && /堆砌形容词/.test(sys())) pass('默认文风约束点名了具体的坏毛病（电报体 / 堆砌形容词）');
    else fail('默认文风约束太笼统，没点名具体症状');
    if (/不要在正文里给建议或列选项/.test(sys())) pass('默认文风约束禁止了正文里的建议与选项列表');
    else fail('默认文风约束未禁止正文列选项');

    // J1 保存后必须进提示词，且要顶掉内置兜底
    $('rulesInput').value = MARK;
    $('saveLoreBtn').click();
    await sleep(80);
    await turn('行动一');
    if (sys().includes(MARK)) pass('填写的 GM Rules 已进入 system prompt');
    else fail('GM Rules 没有进提示词');
    if (!sys().includes('严格遵守因果律，若玩家输入包含')) pass('用户填了规则后，内置兜底规则不再出现（不会两套规则打架）');
    else fail('内置兜底与用户规则同时出现在提示词里');
    if (!/【文风要求】/.test(sys())) pass('用户填了规则后，默认文风约束同样被替换（尊重用户自己的风格）');
    else fail('用户规则与默认文风约束同时生效，可能互相矛盾');

    // J2 位置必须在动态分界之前，否则每回合都变、前缀缓存全失效
    const iRules = sys().indexOf('【主持风格与游戏法则】');
    const iDyn = sys().indexOf('以下为每回合变化的动态信息');
    if (iRules > 0 && iRules < iDyn) pass('规则段位于动态分界之前（前缀缓存友好）');
    else fail(`规则段位置异常 rules=${iRules} dynamic=${iDyn}`);

    // J3 改了但不点保存 → 不生效（已知的坑，这里固化成预期行为）
    $('rulesInput').value = UNSAVED;
    await sleep(50);
    await turn('行动二');
    if (!sys().includes(UNSAVED)) pass('未点「保存全部设定」的改动不会悄悄生效（与界面一致）');
    else fail('未保存的规则也生效了，行为与界面的「保存」按钮不一致');
    if (sys().includes(MARK)) pass('此时提示词里仍是上一次保存的规则');
    else fail('已保存的规则被未保存内容覆盖了');

    // J4 存档往返
    const slotId = dom.window.localStorage.getItem('chronicle_active_slot_id');
    const saved = JSON.parse(dom.window.localStorage.getItem('chronicle_' + slotId + '_lore') || '{}');
    if (saved.rules === MARK) pass('GM Rules 已写入该世界的存档键');
    else fail('GM Rules 没有落盘: ' + JSON.stringify(saved.rules));

    dom.window.close();

    // J5 重开一个实例应能从存档回填文本框
    const dom2 = boot({
      injectCss: true,
      preScript: `localStorage.setItem('chronicle_active_slot_id','slot_custom_1');`
        + `localStorage.setItem('chronicle_slot_custom_1_lore', ${JSON.stringify(JSON.stringify({ world: 'W', character: '', rules: 'RELOADED-RULES', memoryPins: '' }))});`
    });
    await waitForInit(dom2.window.document);
    await sleep(120);
    const back = dom2.window.document.getElementById('rulesInput').value;
    if (back === 'RELOADED-RULES') pass('重新加载后 GM Rules 正确回填到左侧文本框');
    else fail('重新加载后未回填: ' + JSON.stringify(back));
    dom2.window.close();
  }

  // ---- K. 关闭思考模式时的一次性提示 ----
  // 默认值已改成开启，但老存档里存的是旧默认值 false，不会自动被覆盖（开启更慢更贵，
  // 不能替用户决定）。所以启动时提示一次，并且只提示一次。
  console.log('\n=== K. 关闭思考模式的一次性提示 ===');
  const HINT_FLAG = 'chronicle_thinking_hint_shown';
  const cfgWith = (enabled) => JSON.stringify({
    provider: 'openai_compatible', apiKey: 'sk-old-save', baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash', temperature: 0.8, maxTokens: 0, thinkingEnabled: enabled
  });
  const bootWith = async (preScript) => {
    const d = boot({ injectCss: false, preScript });
    await waitForInit(d.window.document);
    await sleep(1200);   // 提示走 900ms 延时，等它出来
    return d;
  };
  const toastsOf = (d) => (d.window.document.getElementById('toastContainer').textContent || '');

  const domOff = await bootWith(`localStorage.setItem('chronicle_api_config', ${JSON.stringify(cfgWith(false))});`);
  if (toastsOf(domOff).includes('思考模式当前关闭')) pass('老存档（thinkingEnabled:false）启动时提示了一次');
  else fail('没有提示关闭思考模式的影响: ' + JSON.stringify(toastsOf(domOff).slice(0, 60)));
  if (domOff.window.localStorage.getItem(HINT_FLAG) === '1') pass('提示标记已落盘（只提示一次，不会每次启动都烦人）');
  else fail('提示标记没落盘，会反复打扰');
  domOff.window.close();

  const domAgain = await bootWith(`localStorage.setItem('chronicle_api_config', ${JSON.stringify(cfgWith(false))});`
    + `localStorage.setItem('${HINT_FLAG}', '1');`);
  if (!toastsOf(domAgain).includes('思考模式当前关闭')) pass('标记已存在时不再重复提示');
  else fail('提示重复出现了');
  domAgain.window.close();

  const domOn = await bootWith(`localStorage.setItem('chronicle_api_config', ${JSON.stringify(cfgWith(true))});`);
  if (!toastsOf(domOn).includes('思考模式当前关闭')) pass('思考模式开启时不会提示（不打扰已按建议设置的用户）');
  else fail('开启思考模式却仍然提示');
  domOn.window.close();

  // ---- L. 自定义端点：任意第三方 / 自建 OpenAI 兼容服务 ----
  // 原来只放行 DeepSeek 与 Gemini，OpenRouter、硅基流动、公司内网网关都接不进来。
  // 现在协议下拉里有「自定义」：地址可填到 /v1 或完整 endpoint，另加额外请求参数与自定义头。
  console.log('\n=== L. 自定义端点（第三方 / 自建兼容服务）===');
  {
    const dom = boot();
    const doc = dom.window.document;
    const $ = (id) => doc.getElementById(id);
    const calls = [];
    const sse = (text) => ({
      ok: true, status: 200,
      headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
      body: {
        getReader: () => {
          let done = false;
          return { read: async () => { if (done) return { done: true }; done = true; return { done: false, value: new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n') }; } };
        }
      }
    });
    dom.window.fetch = async (url, opts) => {
      calls.push({ url, headers: opts.headers || {}, body: JSON.parse((opts && opts.body) || '{}') });
      return sse('GM 正文。\n\n```game_state\n{"location":"测试地"}\n```');
    };
    const turn = async (label) => {
      $('playerInput').value = label;
      $('sendActionBtn').click();
      await sleep(400);
    };
    const openModal = () => { $('openApiSettingsBtn').click(); return sleep(30); };
    const chooseProvider = (value) => {
      $('apiProviderSelect').value = value;
      $('apiProviderSelect').onchange({ target: { value } });
    };

    if (!(await waitForInit(doc))) fail('启动失败');

    // L1 下拉里有自定义协议；选中后面板切换正确
    await openModal();
    if ($('apiProviderSelect').querySelector('option[value="custom"]')) pass('协议下拉框新增了「自定义」选项');
    else fail('协议下拉框里没有自定义选项');

    chooseProvider('custom');
    if (!$('customEndpointRows').classList.contains('hidden')) pass('选自定义后显示端点专属选项（完整地址 / 额外参数 / 额外请求头）');
    else fail('自定义端点选项没有显示');
    if (!$('baseUrlRow').classList.contains('hidden')) pass('自定义端点下 Base URL 行可见');
    else fail('自定义端点下 Base URL 行被隐藏');
    if ($('thinkingModeRow').classList.contains('hidden')) pass('自定义端点下隐藏 DeepSeek 私有的思考模式开关');
    else fail('自定义端点下仍显示思考模式开关');

    // L1b 从 Gemini 切到自定义：清掉 Gemini 的内置地址/模型，但不替用户猜第三方域名
    $('apiBaseUrlInput').value = 'https://generativelanguage.googleapis.com';
    $('apiModelInput').value = 'gemini-2.5-flash';
    chooseProvider('custom');
    if ($('apiBaseUrlInput').value === '' && $('apiModelInput').value === '') {
      pass('切到自定义时清掉 Gemini 的内置地址与模型（不替用户猜域名）');
    } else {
      fail('切到自定义时残留 Gemini 配置: ' + $('apiBaseUrlInput').value + ' / ' + $('apiModelInput').value);
    }

    // L2 只填到 /v1：自动补 /chat/completions；额外参数与自定义头合并进请求
    $('apiBaseUrlInput').value = 'https://openrouter.ai/api/v1';
    $('apiBaseUrlInput').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    if ($('customEndpointPreview').textContent.includes('https://openrouter.ai/api/v1/chat/completions')) {
      pass('面板上的「实际请求地址」预览与真实请求一致');
    } else {
      fail('地址预览不正确: ' + $('customEndpointPreview').textContent);
    }

    $('apiModelInput').value = 'anthropic/claude-3.5-sonnet';
    $('apiKeyInput').value = 'sk-or-test';
    $('customExtraParamsInput').value = '{"top_p": 0.9, "presence_penalty": 0.2}';
    $('customExtraHeadersInput').value = '{"HTTP-Referer": "https://example.com", "X-Title": "QD"}';
    $('saveApiConfigBtn').click();
    await sleep(60);

    calls.length = 0;
    await turn('自定义端点第一回合');
    const req = calls[0];
    if (!req) {
      fail('自定义端点没有发出请求');
    } else {
      if (req.url === 'https://openrouter.ai/api/v1/chat/completions') pass('自定义地址正确补全: ' + req.url);
      else fail('自定义地址异常: ' + req.url);
      if (req.body.top_p === 0.9 && req.body.presence_penalty === 0.2) pass('额外请求参数已合并进请求体');
      else fail('额外请求参数未合并: ' + JSON.stringify(req.body).slice(0, 120));
      if (req.headers['HTTP-Referer'] === 'https://example.com' && req.headers['X-Title'] === 'QD') pass('自定义请求头已随请求发出（OpenRouter 站点标识）');
      else fail('自定义请求头缺失: ' + JSON.stringify(req.headers));
      if (req.headers.Authorization === 'Bearer sk-or-test') pass('有 Key 时 Authorization 仍按 Bearer 下发');
      else fail('Authorization 异常: ' + req.headers.Authorization);
      if (!('thinking' in req.body)) pass('自定义端点不会被塞 DeepSeek 私有的 thinking 字段');
      else fail('自定义端点收到了 thinking 字段');
    }

    // L3 额外参数可以覆盖内置默认值
    await openModal();
    $('customExtraParamsInput').value = '{"temperature": 0.2, "max_tokens": 123}';
    $('apiKeyInput').value = 'sk-or-test';
    $('saveApiConfigBtn').click();
    await sleep(60);
    calls.length = 0;
    await turn('覆盖默认参数');
    if (calls[0] && calls[0].body.temperature === 0.2 && calls[0].body.max_tokens === 123) pass('额外参数能覆盖 temperature / max_tokens 等默认值');
    else fail('额外参数没有覆盖默认值: ' + (calls[0] ? JSON.stringify(calls[0].body).slice(0, 120) : '无请求'));

    // L4 勾选「完整请求地址」：原样请求非标准路径
    await openModal();
    $('apiBaseUrlInput').value = 'https://gw.example.com/api/generate';
    $('customFullEndpointCheckbox').checked = true;
    $('customFullEndpointCheckbox').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    $('apiKeyInput').value = 'sk-gw';
    $('saveApiConfigBtn').click();
    await sleep(60);
    calls.length = 0;
    await turn('完整地址');
    if (calls[0] && calls[0].url === 'https://gw.example.com/api/generate') pass('勾选完整地址后原样请求，不再拼接 /chat/completions');
    else fail('完整地址模式异常: ' + (calls[0] ? calls[0].url : '无请求'));

    // L5 已经是 .../chat/completions 的地址不会重复拼接
    await openModal();
    $('apiBaseUrlInput').value = 'https://gw.example.com/v1/chat/completions';
    $('customFullEndpointCheckbox').checked = false;
    $('customFullEndpointCheckbox').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    $('apiKeyInput').value = 'sk-gw';
    $('saveApiConfigBtn').click();
    await sleep(60);
    calls.length = 0;
    await turn('已完整路径');
    if (calls[0] && calls[0].url === 'https://gw.example.com/v1/chat/completions') pass('已经是完整 completions 路径时不会重复拼接');
    else fail('重复拼接: ' + (calls[0] ? calls[0].url : '无请求'));

    // L5b 没写协议时的补全：本机按 http，其它按 https（绝不改写域名）
    await openModal();
    $('apiBaseUrlInput').value = 'openrouter.ai/api/v1';
    $('apiBaseUrlInput').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    if ($('customEndpointPreview').textContent.includes('https://openrouter.ai/api/v1/chat/completions')) {
      pass('地址没写协议时按 https 补全');
    } else {
      fail('缺协议补全异常: ' + $('customEndpointPreview').textContent);
    }
    $('apiBaseUrlInput').value = 'localhost:11434/v1';
    $('apiBaseUrlInput').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    if ($('customEndpointPreview').textContent.includes('http://localhost:11434/v1/chat/completions')) {
      pass('本机地址没写协议时按 http 补全（本地推理服务多为明文）');
    } else {
      fail('本机地址补全异常: ' + $('customEndpointPreview').textContent);
    }
    $('saveApiConfigBtn').click();
    await sleep(60);

    // L6 自定义端点允许无 Key（本地 Ollama / vLLM / 内网网关）
    await openModal();
    $('apiBaseUrlInput').value = 'http://localhost:8000/v1';
    $('apiKeyInput').value = '';
    $('saveApiConfigBtn').click();
    await sleep(60);
    calls.length = 0;
    await turn('本地无鉴权端点');
    if (calls[0]) pass('自定义端点不填 Key 也能发请求（本地无鉴权服务可用）');
    else fail('自定义端点不填 Key 时被拦下了');
    if (calls[0] && !calls[0].headers.Authorization) pass('没填 Key 时不会发出空的 Authorization 头');
    else fail('空 Key 仍发了 Authorization: ' + (calls[0] && calls[0].headers.Authorization));

    // L7 非法 JSON 拦下保存，且不污染已保存配置
    await openModal();
    $('customExtraParamsInput').value = '{oops';
    $('saveApiConfigBtn').click();
    await sleep(60);
    if (!$('apiModal').classList.contains('hidden')) pass('额外参数 JSON 写错时保存被拦下（弹窗不关闭）');
    else fail('JSON 写错仍然保存并关闭了弹窗');
    if (/额外请求参数.*JSON/.test($('toastContainer').textContent)) pass('给出了明确的 JSON 错误提示');
    else fail('没有提示 JSON 错误: ' + $('toastContainer').textContent.slice(0, 80));
    const stillSaved = JSON.parse(dom.window.localStorage.getItem('chronicle_api_config') || '{}');
    if (stillSaved.extraParams && stillSaved.extraParams.temperature === 0.2) pass('写错的 JSON 没有污染已保存配置');
    else fail('配置被半截写入: ' + JSON.stringify(stillSaved.extraParams));

    // L8 非法请求头名拦下
    $('customExtraParamsInput').value = '{}';
    $('customExtraHeadersInput').value = '{"Bad Header": "x"}';
    $('saveApiConfigBtn').click();
    await sleep(60);
    if (!$('apiModal').classList.contains('hidden') && /请求头名不合法/.test($('toastContainer').textContent)) pass('非法请求头名被拦下并说明原因');
    else fail('非法头名未被拦下: ' + $('toastContainer').textContent.slice(0, 80));

    // L8b 请求头的值不能是对象（否则会被序列化成 "[object Object]" 发出去）
    $('customExtraHeadersInput').value = '{"X-Trace": {"nested": 1}}';
    $('saveApiConfigBtn').click();
    await sleep(60);
    if (!$('apiModal').classList.contains('hidden') && /值必须是字符串或数字/.test($('toastContainer').textContent)) pass('非字符串的请求头值被拦下');
    else fail('嵌套对象头值未被拦下: ' + $('toastContainer').textContent.slice(0, 80));

    // L9 配置持久化 + 重新打开面板回填
    $('customExtraHeadersInput').value = '{"X-Org": "team-a"}';
    $('apiKeyInput').value = 'sk-gw';
    $('saveApiConfigBtn').click();
    await sleep(60);
    const savedCfg = JSON.parse(dom.window.localStorage.getItem('chronicle_api_config') || '{}');
    if (savedCfg.provider === 'custom' && savedCfg.customFullEndpoint === false
      && savedCfg.extraHeaders && savedCfg.extraHeaders['X-Org'] === 'team-a') {
      pass('自定义端点配置（地址模式 / 额外参数 / 额外请求头）已持久化');
    } else {
      fail('配置未持久化: ' + JSON.stringify(savedCfg).slice(0, 160));
    }
    await openModal();
    const paramsBack = $('customExtraParamsInput').value.trim();
    if ($('customExtraHeadersInput').value.includes('X-Org') && (paramsBack === '' || paramsBack === '{}')) {
      pass('重新打开设置面板能回填自定义请求头与额外参数');
    } else {
      fail('回填异常: headers=' + $('customExtraHeadersInput').value + ' params=' + paramsBack);
    }

    // L10 切回内置协议：自定义选项隐藏，额外参数/请求头不再混进内置请求
    chooseProvider('openai_compatible');
    if ($('customEndpointRows').classList.contains('hidden')) pass('切回内置协议后自定义选项隐藏');
    else fail('切回内置协议后自定义选项仍显示');
    if (!$('thinkingModeRow').classList.contains('hidden')) pass('切回内置协议后思考模式开关恢复显示');
    else fail('切回内置协议后思考模式开关未恢复');
    $('apiKeyInput').value = 'sk-x';
    $('saveApiConfigBtn').click();
    await sleep(60);
    calls.length = 0;
    await turn('切回内置协议');
    if (calls[0] && !calls[0].headers['X-Org'] && calls[0].body.temperature !== 0.2) {
      pass('切回内置协议后额外参数 / 请求头不再生效（不会污染 DeepSeek 请求）');
    } else {
      fail('内置协议请求里混进了自定义配置: ' + (calls[0] ? JSON.stringify(calls[0].body).slice(0, 100) : '无请求'));
    }

    // L10b 内置协议下填了完整 completions 地址也不会被重复拼接（老用户很容易这么填）
    await openModal();
    $('apiBaseUrlInput').value = 'http://localhost:11434/v1/chat/completions';
    $('apiKeyInput').value = 'sk-x';
    $('saveApiConfigBtn').click();
    await sleep(60);
    calls.length = 0;
    await turn('内置协议完整地址');
    if (calls[0] && calls[0].url === 'http://localhost:11434/v1/chat/completions') pass('内置协议填完整 completions 地址时同样不会重复拼接');
    else fail('内置协议重复拼接: ' + (calls[0] ? calls[0].url : '无请求'));

    // L11 「测试连接」按钮：不保存也能把 HTTP 状态与服务端原话显示出来
    await openModal();
    const realFetch = dom.window.fetch;
    let testedUrl = null;
    dom.window.fetch = async (url) => {
      testedUrl = url;
      return {
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({ choices: [{ message: { content: 'Hello there!' } }] })
      };
    };
    $('testApiConnBtn').click();
    await sleep(150);
    if (testedUrl === 'http://localhost:11434/v1/chat/completions') pass('测试连接请求的是解析后的真实地址: ' + testedUrl);
    else fail('测试连接地址异常: ' + testedUrl);
    if (/连接成功/.test($('apiTestResult').textContent) && /Hello there!/.test($('apiTestResult').textContent)) {
      pass('测试连接成功时显示 HTTP 200 与模型回答');
    } else {
      fail('成功态显示异常: ' + $('apiTestResult').textContent);
    }

    dom.window.fetch = async () => ({
      ok: false, status: 503,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({
        error: { message: 'No available channel for model gemini-3.8-flash-high under group Gemini' }
      })
    });
    $('testApiConnBtn').click();
    await sleep(150);
    const testFailText = $('apiTestResult').textContent;
    if (/503/.test(testFailText) && /No available channel/.test(testFailText)) {
      pass('测试连接失败时显示 HTTP 状态 + 服务端原话（中转站无渠道能被当场看清）');
    } else {
      fail('失败态显示异常: ' + testFailText);
    }
    dom.window.fetch = realFetch;

    dom.window.close();
  }

  console.log('\n===== ' + (failures === 0 ? '全部通过' : failures + ' 项失败') + ' =====');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.log('\n[FATAL] ' + e.stack); process.exit(1); });
