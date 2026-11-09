// 测试公共引导模块：把 index.html 的外部资源全部内联进 jsdom，无需联网
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', 'src');
const paths = {
  html: ROOT + '/index.html',
  app: ROOT + '/app.js',
  purify: ROOT + '/vendor/purify.min.js',
  marked: ROOT + '/vendor/marked.min.js',
  three: ROOT + '/vendor/three.min.js',
  css: ROOT + '/vendor/tailwind.css',
};

const read = (p) => fs.readFileSync(p, 'utf8');
const closeTag = '<' + '/script>';

function buildHtml(opts = {}) {
  let html = read(paths.html);

  // 注意：替换串里必须用「函数形式」的 replacer。
  // 若直接传字符串，内容中的 $& / $1 等会被 String.replace 当成替换模式解释，
  // 从而破坏被内联的脚本（escapeRegExp 里的 '\\$&' 就踩过这个坑）。
  const inlineTag = (marker, code) =>
    html.replace(marker, () => '<script>' + code + closeTag);

  html = inlineTag('<script src="vendor/marked.min.js"></script>', read(paths.marked));
  html = inlineTag('<script src="vendor/purify.min.js"></script>', read(paths.purify));
  if (fs.existsSync(paths.three)) {
    html = inlineTag('<script src="vendor/three.min.js"></script>', read(paths.three));
  }
  html = inlineTag('<script src="app.js"></script>', read(paths.app));

  if (opts.injectCss) {
    html = html.replace('</head>', () => '<style id="__tw">' + read(paths.css) + '</style></head>');
  }
  if (opts.preScript) {
    html = html.replace('<head>', () => '<head><script>' + opts.preScript + closeTag);
  }
  return html;
}

function boot(opts = {}) {
  return new JSDOM(buildHtml(opts), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: opts.url || 'https://app.local/',
  });
}

// 页签栏现在由世界蓝图动态生成，因此等"页签按钮被创建出来"作为就绪信号
async function waitForInit(doc, tries = 80, gapMs = 25) {
  for (let i = 0; i < tries; i++) {
    if (doc.querySelectorAll('#hudTabBar .hud-tab-btn').length > 0) return true;
    await new Promise(r => setTimeout(r, gapMs));
  }
  return false;
}

// 按蓝图 id 点击页签（已不再有 hudTabStats 这类固定 id）
function clickTab(doc, tabId) {
  const btn = doc.querySelector(`#hudTabBar .hud-tab-btn[data-tab="${tabId}"]`);
  if (btn) btn.click();
  return !!btn;
}

// 右栏 section 内部的元素用 data-ref 定位（面板可被复制多份，不能再依赖 id）
function ref(doc, name) {
  return doc.querySelector(`[data-ref="${name}"]`);
}

// 同类型 section 可能有多个实例，通用名（body/badge/title…）必须按 section 限定作用域
function sectionEl(doc, sectionId) {
  return doc.querySelector(`[data-section="${sectionId}"]`);
}

function secRef(doc, sectionId, name) {
  const s = sectionEl(doc, sectionId);
  return s ? s.querySelector(`[data-ref="${name}"]`) : null;
}

// 构造一个返回 SSE 流的 fetch mock
function sseResponse(text, chunkSize = 60) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) chunks.push(text.slice(i, i + chunkSize));
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

module.exports = { buildHtml, boot, waitForInit, clickTab, ref, sectionEl, secRef, sseResponse, paths, read };
