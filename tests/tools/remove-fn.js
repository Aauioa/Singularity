// 按名字删除一个顶层函数（按大括号配平定位结尾），用于清理重构后的死代码
const fs = require('fs');

const [file, fnName] = process.argv.slice(2);
if (!file || !fnName) { console.error('用法: node remove-fn.js <file> <fnName>'); process.exit(1); }

const lines = fs.readFileSync(file, 'utf8').split('\n');
const start = lines.findIndex(l => new RegExp('^\\s{4}(async\\s+)?function\\s+' + fnName + '\\s*\\(').test(l));
if (start < 0) { console.error('找不到函数: ' + fnName); process.exit(1); }

let depth = 0, end = -1;
for (let i = start; i < lines.length; i++) {
  for (const ch of lines[i]) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  if (depth === 0 && i > start) { end = i; break; }
}
if (end < 0) { console.error('未能定位函数结尾'); process.exit(1); }

const removed = end - start + 1;
lines.splice(start, removed);
fs.writeFileSync(file, lines.join('\n'), 'utf8');
console.log(`✅ 已删除 ${fnName}（行 ${start + 1}..${end + 1}，共 ${removed} 行）`);
