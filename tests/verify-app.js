// 静态校验：语法、DOM id 交叉校验、注入面、本地化完整性、严格 CSP 前置条件、Tauri 收紧
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.join(__dirname, '..');
const SRC = path.join(ROOT_DIR, 'src');
const html = fs.readFileSync(SRC + '/index.html', 'utf8');
const js = fs.readFileSync(SRC + '/app.js', 'utf8');
const combined = html + '\n' + js;

let failures = 0;
const fail = (m) => { failures++; console.log('  [FAIL] ' + m); };
const pass = (m) => console.log('  [ ok ] ' + m);

// ---------- 1. app.js 语法 ----------
console.log('\n[1] app.js 语法');
try {
  new vm.Script(js, { filename: 'app.js' });
  pass(`app.js 语法通过（${js.split('\n').length} 行）`);
} catch (e) {
  fail('app.js 语法错误: ' + e.message);
}

// ---------- 2. getElementById 交叉校验 ----------
console.log('\n[2] getElementById 交叉校验');
const htmlIds = new Set();
let m;
const idRe = /\bid="([^"]+)"/g;
while ((m = idRe.exec(html)) !== null) htmlIds.add(m[1]);

const jsIds = new Set();
const getByIdRe = /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
while ((m = getByIdRe.exec(js)) !== null) jsIds.add(m[1]);

// app.js 运行时动态创建的 id（不在 index.html 中，属于预期）。
// 名单与 tools/check-ids.js 共用一份，避免两边漂移。
const RUNTIME_IDS = require('./runtime-ids');
const missing = [...jsIds].filter(id => !htmlIds.has(id) && !RUNTIME_IDS.has(id));
console.log(`  HTML id ${htmlIds.size} 个，JS 引用 ${jsIds.size} 个`);
if (missing.length) missing.forEach(id => fail(`JS 引用了不存在的 id: ${id}`));
else pass('所有 getElementById 引用都能在 HTML 中找到');

// ---------- 3. 动态拼接 id ----------
const dyn = [...js.matchAll(/getElementById\(\s*`([^`]+)`\s*\)/g)].map(x => x[1]);
if (dyn.length === 0) pass('无动态拼接 id');
else dyn.forEach(d => console.log(`  [note] 动态 id: ${d}`));

// ---------- 4. 注入面 ----------
console.log('\n[4] 注入面扫描');
const inlineOn = [...html.matchAll(/\son[a-z]+\s*=\s*"/g)].map(x => x[0]);
if (inlineOn.length === 0) pass('HTML 中已无任何内联 on* 事件属性');
else { fail(`仍存在 ${inlineOn.length} 处内联事件属性`); inlineOn.slice(0, 5).forEach(x => console.log('         ' + x)); }

const inlineScript = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)];
if (inlineScript.length === 0) pass('HTML 中已无内联 <script> 块（严格 CSP 前提）');
else fail(`仍有 ${inlineScript.length} 个内联 script 块`);

const tmplOnclick = [...html.matchAll(/onclick="[^"]*\$\{[^"]*"/g)];
if (tmplOnclick.length === 0) pass('无把变量拼进 onclick 的写法');
else tmplOnclick.forEach(x => fail('内联事件拼接: ' + x[0].slice(0, 80)));

const rawMarked = /innerHTML\s*=\s*[^;]*marked\.parse/.test(js);
if (!rawMarked) pass('未发现未净化的 marked.parse → innerHTML');
else fail('存在未净化的 marked.parse → innerHTML');

// ---------- 5. 本地化完整性 ----------
console.log('\n[5] 本地化完整性（离线可用）');
const externalRefs = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map(x => x[1]);
if (externalRefs.length === 0) pass('index.html 不再引用任何外部 URL');
else externalRefs.forEach(u => fail('仍引用外部资源: ' + u));

const vendorFiles = ['vendor/tailwind.css', 'vendor/marked.min.js', 'vendor/purify.min.js', 'vendor/three.min.js'];
vendorFiles.forEach(f => {
  if (fs.existsSync(SRC + '/' + f)) {
    const size = fs.statSync(SRC + '/' + f).size;
    pass(`存在 ${f} (${size} 字节)`);
  } else fail(`缺少 ${f}`);
});

vendorFiles.forEach(f => {
  const tag = f.endsWith('.css') ? `<link rel="stylesheet" href="${f}">` : `<script src="${f}"></script>`;
  if (html.includes(tag)) pass(`index.html 已引用 ${f}`);
  else fail(`index.html 未引用 ${f}`);
});

if (html.includes('<script src="app.js"></script>')) pass('index.html 已引用 app.js');
else fail('index.html 未引用 app.js');

// tailwind.css 不能为空且应含 preflight
const tw = fs.readFileSync(SRC + '/vendor/tailwind.css', 'utf8');
if (tw.length > 5000 && tw.includes('--tw-')) pass('tailwind.css 内容正常');
else fail('tailwind.css 内容异常');

// ---------- 6. 关键修复点 ----------
console.log('\n[6] 关键修复点存在性');
const markers = [
  ['DeepSeek 默认端点', /baseUrl: 'https:\/\/api\.deepseek\.com'/, combined],
  ['默认模型 deepseek-flash', /model: 'deepseek-flash'/, combined],
  ['思考模式可控', /body\.thinking = \{ type:/, combined],
  ['动态信息后置（缓存友好）', /以下为每回合变化的动态信息/, combined],
  ['上下文滑动窗口', /function buildPromptHistory/, combined],
  ['自动滚动摘要', /function maybeSummarizeContext/, combined],
  ['HUD 摘要注入', /function buildHudDigest/, combined],
  ['统一世界包格式', /singularity-world-pack/, combined],
  ['不再全量发送历史', /callLlmApiStream\(AppState\.narrativeHistory/, combined, true],
  ['不再用 ?key= 传 Key', /generativelanguage[\s\S]{0,160}\?key=/, combined, true],
  ['Gemini 用请求头传 Key', /x-goog-api-key/, combined],
  ['流式调用', /callLlmApiStream/, combined],
  ['取消/超时控制器', /AbortController/, combined],
  ['增量渲染计数', /renderedNarrativeCount/, combined],
  ['敏感内容标记', /\[\[敏感\]\]/, combined],
  ['导入修复（写新槽位键）', /getSlotStorageKey\(newId,\s*'lore'\)/, combined],
  ['删除槽位清理孤儿键', /chronicle_\$\{slotId\}_/, combined],
  ['data-action 事件委托', /function initActionDelegation/, combined],
  ['模态框 Esc 关闭', /function initModalA11y/, combined],
  ['GM 规则可拖拽/选文件导入', /function handleRulesFile/, combined],
  ['拖拽落点按区域路由', /const dropKindAt/, combined],
  // 自定义端点（第三方 / 自建 OpenAI 兼容服务）：地址解析、额外参数注入、无 Key 判定、UI 入口
  ['自定义端点地址解析', /function resolveChatEndpoint/, combined],
  ['自定义端点额外参数 / 请求头注入', /function applyCustomRequestOverrides/, combined],
  ['自定义端点允许无 Key', /function hasApiCredential/, combined],
  ['自定义端点 UI 选项', /id="customEndpointRows"/, combined],
];
markers.forEach(([name, re, src, invert]) => {
  const hit = re.test(src);
  if (invert ? !hit : hit) pass(name);
  else fail(name);
});

// ---------- 7. Tauri 收紧 ----------
console.log('\n[7] Tauri 侧安全收紧');
const tauriFiles = {
  cargo: fs.readFileSync(path.join(ROOT_DIR, 'src-tauri/Cargo.toml'), 'utf8'),
  lib: fs.readFileSync(path.join(ROOT_DIR, 'src-tauri/src/lib.rs'), 'utf8'),
  caps: fs.readFileSync(path.join(ROOT_DIR, 'src-tauri/capabilities/default.json'), 'utf8'),
  conf: fs.readFileSync(path.join(ROOT_DIR, 'src-tauri/tauri.conf.json'), 'utf8'),
};
const libCode = tauriFiles.lib.replace(/^\s*\/\/.*$/gm, '');
if (!/tauri-plugin-opener/.test(tauriFiles.cargo)) pass('Cargo.toml 已移除 opener 依赖');
else fail('Cargo.toml 仍含 tauri-plugin-opener');
if (!/tauri_plugin_opener/.test(libCode)) pass('lib.rs 已不再注册 opener 插件');
else fail('lib.rs 仍注册 opener');
// 模板遗留的 greet 示例命令必须消失。
// 判据要盯住 greet 本身，而不能再拿 generate_handler 当替身 ——
// 现在 lib.rs 合法地通过它注册了安全存储的三个命令。
const greetLeft = /fn\s+greet\b/.test(libCode)
  || /generate_handler!\s*\[[^\]]*\bgreet\b/.test(libCode);
if (!greetLeft) pass('lib.rs 已移除 greet 死代码');
else fail('lib.rs 仍含 greet');
if (!/tauri_plugin_/.test(libCode)) pass('lib.rs 未注册任何 Tauri 插件');
else fail('lib.rs 注册了插件');

// 原生命令面必须是"白名单且可枚举"的：多注册一个命令就是多一份攻击面，
// 所以这里逐字比对清单，而不是只检查"包含某几个"。
const handlerArgs = (libCode.match(/generate_handler!\s*\[([^\]]*)\]/) || [, ''])[1];
const registeredCmds = handlerArgs.split(/[\s,]+/).filter(Boolean);
if (registeredCmds.join(',') === 'secret_set,secret_get,secret_delete') {
  pass('lib.rs 只注册了安全存储三个命令: ' + registeredCmds.join(', '));
} else {
  fail('注册的原生命令清单异常: ' + (registeredCmds.join(',') || '(空)'));
}
if (!/opener:default/.test(tauriFiles.caps)) pass('capabilities 已移除 opener:default');
else fail('capabilities 仍含 opener:default');
if (/"withGlobalTauri":\s*false/.test(tauriFiles.conf)) pass('withGlobalTauri 已关闭');
else fail('withGlobalTauri 仍为 true');
if (/"identifier":\s*"com\.singularity\.trpg"/.test(tauriFiles.conf)) pass('identifier 未改动（用户存档可保留）');
else fail('identifier 被改动，会导致用户存档丢失');

// 打包后 HTML5 拖拽（文件导入 / 编辑器内拖拽排序）能不能用，全看这一行：
// Tauri 默认 dragDropEnabled=true 时，wry 会给窗口装一个原生 IDropTarget，
// 并调用 WebView2 的 SetAllowExternalDrop(false)（wry webview2/mod.rs 里那句注释：
// "Disable file drops, so our handler can capture it"），渲染进程从此收不到 drop。
// jsdom 里没有这层原生宿主，所以这类"只在安装包里失效"的回归只能在这里静态守住。
if (/"dragDropEnabled":\s*false/.test(tauriFiles.conf)) pass('dragDropEnabled 已关闭（打包后 HTML5 拖拽可用）');
else fail('dragDropEnabled 未关闭：打包后拖拽导入与拖拽排序会被 Tauri 的原生 drop 目标截走');
const nativeDrag = /tauri:\/\/drag|onDragDropEvent/.test(combined);
if (!nativeDrag) pass('前端未依赖 Tauri 原生拖拽事件（与 dragDropEnabled:false 一致）');
else fail('前端监听了 Tauri 原生拖拽事件，但配置已把它关掉');

// ---------- 8. CSP ----------
console.log('\n[8] CSP 配置');
const cspMatch = tauriFiles.conf.match(/"csp":\s*(null|"([^"]*)")/);
if (!cspMatch) fail('未找到 csp 配置项');
else if (cspMatch[1] === 'null') fail('csp 仍为 null（未启用内容安全策略）');
else {
  const csp = cspMatch[2];
  console.log('  当前 CSP: ' + csp);
  if (/script-src 'self'/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp)) pass("script-src 为 'self' 且未放行 unsafe-inline");
  else fail('script-src 未收紧到 \'self\'');
  if (/object-src 'none'/.test(csp)) pass("object-src 'none'");
  else fail('缺少 object-src none');
  if (/base-uri 'none'/.test(csp)) pass("base-uri 'none'");
  else fail('缺少 base-uri none');
  if (/frame-src 'none'/.test(csp)) pass("frame-src 'none'");
  else fail('缺少 frame-src none');
  if (/connect-src/.test(csp)) pass('已声明 connect-src');
  else fail('缺少 connect-src');
  // 自定义端点（HANDOFF §4.7）必须能打到任意 HTTPS 第三方；这条一旦被人改回白名单，
  // 用户「填了地址却连不上」的故障会重现，所以用测试锁住。
  if (/connect-src[^;]*\shttps:(\s|;|$)/.test(csp)) pass('connect-src 放行任意 HTTPS（自定义端点前提）');
  else fail('connect-src 未放行 https:：自定义端点会被 CSP 拦下');
  if (/connect-src[^;]*http:\/\/localhost/.test(csp)) pass('connect-src 仍放行本机 http（本地推理服务）');
  else fail('connect-src 丢了 localhost http 放行');
}

console.log(`\n===== 结果: ${failures === 0 ? '全部通过' : failures + ' 项失败'} =====`);
process.exit(failures === 0 ? 0 : 1);
