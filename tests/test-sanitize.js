// 用 jsdom + 真实 vendor/purify.min.js 验证净化逻辑是否真的阻断注入
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PURIFY = path.join(__dirname, '..', 'src', 'vendor', 'purify.min.js');

const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="stage"></div></body></html>', {
  runScripts: 'dangerously',
  pretendToBeVisual: true
});
const window = dom.window;

// 按浏览器的方式加载：注入真实 <script>，走 UMD 全局挂载分支，
// 与 index.html 里 <script src="vendor/purify.min.js"> 的用法完全一致
const scriptEl = window.document.createElement('script');
scriptEl.textContent = fs.readFileSync(PURIFY, 'utf8');
window.document.head.appendChild(scriptEl);

const DOMPurify = window.DOMPurify;

let failures = 0;
const fail = (m) => { failures++; console.log('  [FAIL] ' + m); };
const pass = (m) => console.log('  [ ok ] ' + m);

console.log('\n=== 环境 ===');
console.log('DOMPurify.isSupported =', DOMPurify && DOMPurify.isSupported);
console.log('DOMPurify.version     =', DOMPurify && DOMPurify.version);
if (!DOMPurify || !DOMPurify.isSupported) { console.log('DOMPurify 未就绪，测试无效'); process.exit(1); }

// 与 index.html 中 sanitizeHtml 完全一致的配置
function sanitizeHtml(html) {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'link', 'meta', 'base'],
    FORBID_ATTR: ['style']
  });
}

const payloads = [
  ['img onerror',        '<img src=x onerror="window.__pwned=1">',                'error'],
  ['svg onload',         '<svg onload="window.__pwned=3"></svg>',                 'load'],
  ['a javascript:',      '<a href="javascript:window.__pwned=4">x</a>',           null],
  ['iframe javascript:', '<iframe src="javascript:window.__pwned=5"></iframe>',   null],
  ['div onclick',        '<div onclick="window.__pwned=8">dian</div>',            'click'],
  ['body onload',        '<body onload="window.__pwned=6"></body>',               'load'],
  ['div style overlay',  '<div style="position:fixed;inset:0;z-index:9999">x</div>', null],
  ['style tag',          '<style>body{display:none}</style>',                     null],
  ['form/input',         '<form><input name=x></form>',                           null],
  ['mXSS mglyph',        '<math><mtext><table><mglyph><style><img src=x onerror="window.__pwned=7"></style></mglyph></table></mtext></math>', 'error'],
  ['normal Markdown',    '<p>found <strong>dagger</strong>.</p>',                 null]
];

console.log('\n=== Payload injection test ===');
const stage = window.document.getElementById('stage');

payloads.forEach(([name, raw, evt]) => {
  window.__pwned = undefined;
  let clean;
  try {
    clean = sanitizeHtml(raw);
  } catch (e) {
    fail(name + ' sanitize threw: ' + e.message);
    return;
  }

  stage.innerHTML = clean;

  // 主动派发事件：若 on* 处理器存活，就会真的执行
  const eventTypes = evt ? [evt] : ['error', 'load', 'click', 'mouseover'];
  stage.querySelectorAll('*').forEach((el) => {
    eventTypes.forEach((t) => {
      try { el.dispatchEvent(new window.Event(t)); } catch (e) { /* ignore */ }
    });
  });

  const lower = clean.toLowerCase();
  const problems = [];
  if (window.__pwned !== undefined) problems.push('handler executed __pwned=' + window.__pwned);
  if (/\son[a-z]+\s*=/.test(lower)) problems.push('on* attribute left');
  if (lower.includes('javascript:')) problems.push('javascript: URL left');
  if (/\sstyle\s*=/.test(lower)) problems.push('style attribute left');
  if (/<(script|iframe|style|form|input|object|embed|link|meta|base)\b/.test(lower)) problems.push('dangerous tag left');

  if (problems.length) {
    fail(name + ' -> ' + problems.join(' / '));
    console.log('         output: ' + clean);
  } else {
    pass(name + '  ->  ' + (clean.length > 78 ? clean.slice(0, 78) + '...' : clean));
  }
});

// 保真性：正常 Markdown 必须不被破坏
console.log('\n=== Fidelity check (must not strip normal markup) ===');
const keep = sanitizeHtml('<p>hi <strong>bold</strong> <em>italic</em> <code>x=1</code></p>');
if (keep.includes('<strong>') && keep.includes('<em>') && keep.includes('<code>')) pass('bold/italic/code preserved');
else fail('normal markup stripped: ' + keep);

const keepClass = sanitizeHtml('<span class="privacy-sensitive">secret</span>');
if (keepClass.includes('class="privacy-sensitive"')) pass('class attribute preserved (privacy shield depends on it)');
else fail('class attribute stripped: ' + keepClass);

// 敏感标记替换（与 renderNarrativeMarkdown 一致）
console.log('\n=== Sensitive marker replacement ===');
const markerIn = '<p>before [[敏感]]intimate text[[/敏感]] after</p>';
const markerOut = markerIn.replace(/\[\[敏感\]\]([\s\S]*?)\[\[\/敏感\]\]/g, '<span class="privacy-sensitive">$1</span>');
if (markerOut.includes('class="privacy-sensitive"') && !markerOut.includes('[[敏感]]')) pass('marker replaced: ' + markerOut);
else fail('marker replacement failed: ' + markerOut);

console.log('\n===== ' + (failures === 0 ? 'ALL PASS: injection blocked, markup preserved' : failures + ' FAILED') + ' =====');
process.exit(failures === 0 ? 0 : 1);
