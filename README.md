# 奇点 · 语境引擎 (Singularity: Interactive Spoken English & Story Worlds Engine)

[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](./LICENSE)
[![Tauri 2.0](https://img.shields.io/badge/Tauri-2.0-24C8DB?logo=tauri&logoColor=white)](https://v2.tauri.app/)
[![LLM Ready](https://img.shields.io/badge/LLM-DeepSeek%20%7C%20OpenAI%20%7C%20Gemini-10b981)](#多模型与语音接口架构)
[![Automated Tests](https://img.shields.io/badge/Tests-7%20Suites%20Passing-22c55e)](#自动化测试与质量守卫)

**奇点 (Singularity)** 是一款基于 **Tauri 2 + 零运行时框架依赖前端** 构建的 **AI 实时生成内容（Real-time Generative）英语口语情境互动与叙事引擎**。

它将传统「开放式互动叙事（Interactive Fiction / TRPG）」的强沉浸感与「第二语言习得（SLA — 可理解性输入、语用得体性训练、按需母语级润色 Recast）」深度融合：学习者不再面对枯燥的句型填空，而是直接走进**旧金山 SoMa 咖啡馆路演**、**常春藤大学 Seminar 研讨课**或任意自定义故事世界，与性格鲜明的 AI 语伴（NPC）实时用英语交锋、破冰、辩论与共创。
安装包[![Download](https://img.shields.io/badge/Download-v0.1.0-blue)](https://github.com/Aauioa/trpg/releases/latest)

---

## ✨ 核心特性 (Key Highlights)

### 1. 🎭 沉浸式故事世界 × 零剧透口语交锋 (Immersive Story Worlds)
- **纯粹情境对话流**：正常对话回合只输出剧中人物的地道英语台词与神态动作，绝不强行打断对话塞入说教式纠错，也不替玩家做机械的 A/B/C 选择。
- **开箱即用双旗舰口语世界包**（支持首页一键载入，或从 `worldpacks/` 导入）：
  - ☕ **`worldpacks/01-silicon-valley-pitch.json`（硅谷路演与咖啡馆口语实战）**：旧金山 SoMa 街区 Blue Bottle 点单破冰、与 AI 工程师探讨技术瓶颈、向早期风投合伙人完成 3 分钟 Elevator Pitch。
  - 🎓 **`worldpacks/02-ivy-campus-seminar.json`（常春藤校园研讨与社团破冰）**：北美名校中央草坪社团招新寒暄、Seminar 圆桌研讨课抢话与辩证反驳（Play devil's advocate）、教授 Office Hours 课题汇报。
- 同时支持创建或导入任意自定义故事世界包（`.json` / `.md` / `.txt`）。

### 2. 💡 按需触发的 AI 口语私教 (On-Demand AI Speaking Tutor)
- **不主动剧透，把思考与开口权还给学习者**：学习者先独立组织语言开口表达；当遇到卡壳或想知道更地道的说法时，随时点击控制台或消息气泡上的 **「💡 获取 AI 导师建议」**。
- **结构化 JSON 诊断与分级示范**：独立调用 LLM 生成针对上一句发言的 **母语级润色（Recast）**，并同步给出 **CEFR B1（自然基础）/ B2（进阶流利）/ C1（母语地道 + 融入目标词汇）** 三档可一键跟读、一键填入的回应建议。

### 3. 🎙️ 双模语音交互引擎 (Dual-Mode Voice Engine: TTS & STT)
- **🔊 地道英语朗读 (TTS)**：
  - 智能剥离中文旁白，精准提取场景中的英文对白与地道表达进行合成。
  - 支持 **浏览器原生离线美音 (`SpeechSynthesis`)** 与 **OpenAI TTS 兼容云端神经语音 (`/v1/audio/speech`，支持 `tts-1` / `gpt-4o-mini-tts` 及 `alloy` / `nova` 等多音色与 0.75x~1.25x 语速调节)**，云端异常时自动优雅降级。
- **🎙️ 英语语音开口识别 (STT)**：
  - 支持 **Web Speech API 实时英语语音转写** 与 **OpenAI Whisper 兼容云端语音识别 (`/v1/audio/transcriptions`)**，真正实现「听 NPC 说英语 → 直接对着麦克风开口回应」的闭环。

### 4. ✦ 高亮词汇五维联动 × 逐句精听跟读工坊 (Interactive Highlight Linkage & Sentence Studio)
正文中每一个加粗高亮表达（`.prose strong` / `.prose b`）都不再只是静态视觉标记，而是贯穿全模块的**口语实战枢纽**：
- **实时词库状态角标**：正文高亮胶囊自动与右侧【技能】栏实时比对——待激活目标词自动浮现 `🎯` 角标，已实战掌握词汇自动点亮 `✓` 翡翠印记。
- **点击呼出「✦ 高亮表达联动工作台」浮层 (`#highlightWordPopover`)**：点击正文任意高亮词即刻弹出联动卡片，自动提取所在原句语境并提供 **5 项深度联动**：
  1. **🔊 朗读词与原句**：调用 TTS 连读核心词块与所在原句。
  2. **✍️ 填入造句实战**：一键提取地道英文词核插入底部开口输入框。
  3. **📌 收入/解锁技能词库**：新词一键收入右侧【技能】生词本，待激活词一键升格为「已掌握」并奖励流利度。
  4. **🧠 钉入记忆锚点**：将高亮表达及原句一键写入左侧【长线记忆锚点 (`memoryPins`)】，让 AI 在后续回合剧情中自然复现并考察。
  5. **🎓 AI 语境释义与地道造句示范**：即时展开中文地道释义、母语者使用窍门及 2 句可一键填入的下一轮英文回应示范（支持离线造句脚手架兜底）。
- **底部操控台「本幕高亮词联动条」(`#activeHighlightBar`) & 实时命中亮灯**：输入框上方动态陈列本幕高亮词胶囊；玩家打字或语音输入一旦命中目标表达，对应胶囊**实时变绿点亮（`🔥 已命中·发送即激活`）**，发送回合后自动解锁至「技能掌握」并奖励 `+2` 流利度。
- **🎧 逐句精听 · 点词入库 · 跟读评分工坊 (`Sentence Studio`)**：每条世界消息均支持展开分句精听面板，句中任意英文单词可**点词即读并收入技能生词本**，单句支持 **🎙️ 跟读发音评测**（输出准确度 Accuracy、完整度 Completeness 与 S/A/B/C 评级，对漏读词标红提示重读）。

### 5. 📜 1930s 复古文学画报美学 × 6 套舒适全局配色 (Literary Broadsheet & 6 Global Palettes)
摒弃千篇一律的科技黑框模板，采用 **1930s 复古文学画报（Literary Broadsheet）** 纸本排版美学，并在右上角【设置】中内置 **6 套护眼高对比全局配色**（一键切换，自动同步全界面纸张底色、墨色、强调色与 SVG 雷达图）：
- 📜 **羊皮原浆 (`classic`)**：暖调古籍米黄纸面 + 炭黑活字印刷墨色 + 朱砂红印章点缀（默认日间）
- 🌿 **鼠尾草绿 (`sage`)**：清晨草本雾绿纸面 + 森林深墨 + 松石绿点缀，长文阅读极度舒缓
- 🏛️ **牛津藏青 (`oxford`)**：冷调亚麻纸面 + 学院派深海蓝墨，清爽知性
- ☕ **烘焙摩卡 (`roast`)**：暖杏拿铁纸面 + 浓缩咖啡深棕字墨，温润醇厚
- 🍷 **绛紫绒幕 (`plum`)**：古典剧院粉雾纸面 + 勃艮第酒红强调色，戏剧张力十足
- 🌙 **深海夜航 (`midnight`)**：低眩光午夜蓝黑底色 + 暖金羊皮纸字色，专为夜间暗光口语练习调校

### 6. 🧩 Schema 驱动的动态口语状态面板 (Schema-Driven Speaking HUD)
右侧栏由每个世界的 `worldSchema` 动态声明与渲染（零硬编码 DOM，默认四大页签：**属性 / NPC / 行囊 / 技能**）：
- **实时口语维生指标 (Speaking Vitals)**：流利度 (Fluency)、表达自信 (Confidence)、语用得体度 (Pragmatics) 实时随对话表现涨跌。
- **五维口语能力 SVG 雷达图**：动态绘制流利度、词汇量、语法准确、语用得体、逻辑/学术思辨五维能力。
- **技能与词汇迷宫 (Skills & Word Maze)**：统一管理核心句型卡与「已掌握 (`known`) / 待激活 (`unknown`)」词汇，支持点击发音与造句实战自动解锁。
- **NPC 关系图鉴与关键事件流 (`recent_events`)**：自动记录每次好感度/信任度变动背后的剧情原因（如 `路演问答：信任度+5`），让社交反馈有迹可循。
- **口语实战数据复盘 (`#tacticsSessionStats`)**：在【口语锦囊】弹窗顶部实时统计本局开口回合数、累计英文词数、已掌握词汇与待激活生词数。

---

## 🗂️ 仓库目录结构

```text
.
├── src/                        # 前端源码（零构建框架依赖，直接嵌入 Tauri 安装包）
│   ├── index.html              # 1930s 复古文学画报布局、模态框与自研样式系统
│   ├── app.js                  # 核心引擎：LLM 流式通信、高亮词五维联动、逐句精听跟读、语音 TTS/STT、动态 HUD 蓝图
│   └── vendor/
│       ├── tailwind.css        # 静态编译的 Tailwind CSS 产物
│       ├── marked.min.js       # Markdown 渲染引擎
│       ├── purify.min.js       # DOMPurify XSS 防护防线
│       └── three.min.js        # 轻量 3D 舞台与环境光晕渲染支持
├── src-tauri/                  # Tauri 2 (Rust) 桌面宿主与原生安全桥
│   ├── src/lib.rs              # Windows DPAPI 密钥加密存储与窗口宿主
│   ├── tauri.conf.json         # 严格 CSP 策略、窗口与打包配置
│   └── capabilities/           # 最小权限声明
├── worldpacks/                 # 官方旗舰英语口语互动剧本包 (.json)
│   ├── 01-silicon-valley-pitch.json  # 硅谷路演与咖啡馆口语实战 (CEFR B1-C1)
│   └── 02-ivy-campus-seminar.json    # 常春藤校园研讨与社团破冰 (CEFR B1-C1)
├── scripts/                    # 开发者辅助与接口连通性自检脚本
│   ├── check-api.ps1
│   └── check-api.cmd
├── docs/
│   └── screenshots/            # 界面预览截图目录
├── tests/                      # 7 套自动化测试与静态守卫套件
│   ├── run-all.js              # 一键测试总入口 (npm test)
│   ├── harness.js              # jsdom 离线沙箱引导器
│   ├── verify-app.js           # 静态安全与架构契约检查
│   ├── test-css-coverage.js    # 运行时 Tailwind 类名 100% 覆盖率校验
│   ├── test-schema.js          # 动态蓝图引擎与安全公式求值测试
│   ├── test-sanitize.js        # XSS 注入拦截专项测试
│   ├── test-integration.js     # 端到端 UI + 高亮词五维联动集成测试
│   ├── test-context.js         # 滑动窗口、滚动摘要与世界包导入导出测试
│   └── test-deepseek.js        # 多模型端点、思考模式与 DPAPI 密钥存储测试
├── tailwind.config.cjs         # Tailwind 扫描配置
└── package.json
```

---

## 🚀 快速开始 (Quick Start)

### 1. 环境准备与浏览器直接体验
本项目前端已将全部依赖本地化（位于 `src/vendor/`）。若仅体验 Web 端：
- 使用任意静态文件服务器（如 VS Code `Live Server` 或 `npx serve src`）打开 `src/index.html` 即可直接在 Chrome / Edge 中运行。

### 2. 桌面端开发与打包 (Tauri 2)

```bash
# 1. 安装前端开发与测试依赖
npm install

# 2. 启动 Tauri 桌面开发窗口
npm run tauri dev

# 3. 修改 HTML/JS 中的 Tailwind 类名后重新编译 CSS
npm run build:css

# 4. 运行全部 7 套自动化校验套件
npm test

# 5. 构建 Windows NSIS 桌面安装包
npm run tauri build -- --bundles nsis
```

---

## 🔌 多模型与语音接口架构

在界面右上角点击 **「API 设置」** 即可灵活配置：
1. **文本生成大模型 (LLM)**：
   - **OpenAI 兼容接口**：原生支持 DeepSeek (`deepseek-chat`)、OpenAI (`gpt-4o` / `gpt-4o-mini`)、Claude (经 OpenRouter / 网关)、硅基流动等。
   - **Google Gemini 官方接口**：支持 `gemini-2.5-flash` / `gemini-2.5-pro` 流式 SSE 响应。
   - **自定义端点模式**：支持任意完整 Endpoint、自定义 JSON Body 扩展参数与自定义 Header。
2. **语音合成与识别 (Voice API)**：
   - **零配置模式（默认）**：直接调用系统与浏览器内置的 `SpeechSynthesis`（优先匹配美式英语自然音色）与 `webkitSpeechRecognition`。
   - **云端高拟真模式**：支持接入 OpenAI `/v1/audio/speech` 与 `/v1/audio/transcriptions` 兼容接口，独立配置 Voice Base URL 与 Key。
3. **本机密钥安全**：
   - 桌面端通过 Rust 原生命令调用 **Windows DPAPI (`CryptProtectData`)** 将 API Key 加密存储于本机，绝不明文落盘或上传第三方服务器。

---

## 🛡️ 自动化测试与质量守卫

每次提交代码前可执行 `npm test`，一次性跑通 7 套零外部网络依赖的测试守卫：
1. **静态与安全校验 (`verify-app.js`)**：CSP 严格策略、禁止内联事件处理器、DOMPurify 净化链路校验。
2. **单元测试 (`test-unit.js`)**：JSON 围栏解析、HUD 增量深度合并、长线上下文摘要拼接。
3. **集成测试 (`test-integration.js`)**：角色创建向导、流式推演、XSS 注入拦截、世界包导入导出闭环。
4. **多世界隔离回归 (`test-import-isolation.js`)**：多槽位切换与存档隔离验证。
5. **动态蓝图引擎测试 (`test-world-schema.js`)**：Schema 归一化、可视化结构编辑器、无 `eval` 安全公式求值器。
6. **CSS 覆盖率实测 (`test-css-coverage.js`)**：在 jsdom 中渲染全部组件并断言每一个 Tailwind 类名均在 `src/vendor/tailwind.css` 中存在编译规则。
7. **自定义端点协议测试 (`test-custom-endpoint.js`)**：多厂商 URL 归一化、Header 过滤与错误诊断回显。

---

## 📄 开源协议 (License)

本项目基于 [MIT License](./LICENSE) 开源。
