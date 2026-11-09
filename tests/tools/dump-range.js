// 打印 index.html 中某个标记区间的行，便于精确改结构
const fs = require('fs');
const file = process.argv[2] || 'src/index.html';
const from = process.argv[3];
const to = process.argv[4];
const lines = fs.readFileSync(file, 'utf8').split('\n');
const s = lines.findIndex(l => l.includes(from));
const e = lines.findIndex((l, i) => i > s && l.includes(to));
console.log(`区间: 行 ${s + 1} .. ${e}  (共 ${e - s} 行)`);
for (let i = s; i < e; i++) console.log((i + 1) + ': ' + lines[i]);
