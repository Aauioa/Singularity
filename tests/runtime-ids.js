// app.js 在运行时动态创建的 id（不在 index.html 里，属于预期）。
//
// 放在这里而不是各自抄一份：verify-app.js（npm test 的一部分）和
// tools/check-ids.js（排错工具）都要用这份名单，抄两份必然漂移 ——
// 事实上 check-ids.js 就因为少抄了两个 id 而误报过一次。
//
//   addSectionType / addCreationType —— 结构树与创建表单编辑器里的「新增项」输入框
//   addProfileKey / addProfileLabel  —— 角色卡版式编辑器里的「新增字段」输入框
module.exports = new Set([
  'addSectionType',
  'addCreationType',
  'addProfileKey',
  'addProfileLabel',
]);
