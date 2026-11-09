    function defaultWizardConfig() {
      return {
        races: ['人类', '精灵', '矮人'],
        classes: ['战士', '法师', '游侠'],
        identities: ['平民', '雇佣兵'],
        attributes: ['力量', '敏捷', '体质', '智力', '感知'],
        pointBudget: 25,
        maxPerStat: 8
      };
    }

    function defaultHudState() {
      return {
        character_profile: { name: '', gender: '', age: '', race: '', class: '', identity: '', appearance: '' },
        location: '新起点',
        time: '初章',
        bars: [],
        attribute_cap: 20,
        attributes: {},
        weapon_mastery: {},
        npc_codex: [],
        spells: [],
        skills: { known: [], unknown: [] },
        status_effects: [],
        inventory: []
      };
    }

    // ===== 角色创建配置（也由蓝图驱动）=====
    // 不同世界观要问的东西完全不同：奇幻问种族职业，修仙问道号宗门灵根。
    function defaultCreationConfig() {
      return {
        rows: [
          {
            cols: 'grid-cols-2 sm:grid-cols-4',
            fields: [
              { key: 'name', label: '角色姓名', cardLabel: '姓名', type: 'text', span: 2, required: true, placeholder: '例如：伊莱亚斯' },
              { key: 'gender', label: '性别', type: 'select', options: ['男', '女', '其他'] },
              { key: 'age', label: '年龄', type: 'number', value: 24 }
            ]
          },
          {
            cols: 'grid-cols-1 sm:grid-cols-3',
            fields: [
              { key: 'race', label: '种族', type: 'chips', source: 'races' },
              { key: 'class', label: '职业 / 流派', type: 'chips', source: 'classes' },
              { key: 'identity', label: '身份 / 出身', type: 'chips', source: 'identities' }
            ]
          },
          {
            cols: 'grid-cols-1',
            fields: [
              { key: 'appearance', label: '外貌细节与随身装备描述', type: 'textarea', rows: 2, placeholder: '发色、瞳色、身材轮廓、服饰与初始随身物品描述...' }
            ]
          }
        ],
        dice: {
          key: '魅力', label: '魅力 / 社交特质随机投骰 (D6)',
          sides: 6, base: 2, map: { 1: -1, 2: 0, 3: 1, 4: 1, 5: 2, 6: 3 }
        },
        // 派生初始数值：公式里可以引用属性名，由 evalFormula 安全求值（不用 eval）
        derived: [
          { label: '生命 (HP)', cardLabel: 'HP', tone: 'rose', formula: '10 + 体质 * 5' },
          { label: '能量 (MP)', cardLabel: 'MP', tone: 'cyan', formula: '智力 * 5' }
        ]
      };
    }

    // 极小的安全表达式求值器。
    // 刻意不用 eval / new Function —— 严格 CSP 会拦掉它们，而且蓝图可能来自 AI。
    // 支持：数字、变量名（含中文）、+ - * / ( )、以及 min/max/floor/ceil/round/abs
    function evalFormula(expr, vars) {
      const src = String(expr == null ? '' : expr);
      let i = 0;
      const isNameChar = (c) => /[A-Za-z0-9_\u4e00-\u9fff]/.test(c);
      const skip = () => { while (i < src.length && /\s/.test(src[i])) i++; };
      const peek = () => { skip(); return src[i]; };

      function parseExpr() {
        let v = parseTerm();
        for (;;) {
          const c = peek();
          if (c === '+') { i++; v += parseTerm(); }
          else if (c === '-') { i++; v -= parseTerm(); }
          else return v;
        }
      }
      function parseTerm() {
        let v = parseFactor();
        for (;;) {
          const c = peek();
          if (c === '*') { i++; v *= parseFactor(); }
          else if (c === '/') { i++; const d = parseFactor(); v = d === 0 ? 0 : v / d; }
          else return v;
        }
      }
      function parseFactor() {
        skip();
        if (src[i] === '-') { i++; return -parseFactor(); }
        if (src[i] === '+') { i++; return parseFactor(); }
        if (src[i] === '(') {
          i++;
          const v = parseExpr();
          skip();
          if (src[i] === ')') i++;
          return v;
        }
        const start = i;
        while (i < src.length && isNameChar(src[i])) i++;
        const tok = src.slice(start, i);
        if (!tok) { i++; return 0; }   // 无法识别的字符：跳过，避免死循环
        if (/^\d+(\.\d+)?$/.test(tok)) return parseFloat(tok);

        if (src[i] === '(') {          // 函数调用
          i++;
          const args = [];
          skip();
          if (src[i] !== ')') {
            for (;;) {
              args.push(parseExpr());
              skip();
              if (src[i] === ',') { i++; continue; }
              break;
            }
          }
          skip();
          if (src[i] === ')') i++;
          const f = tok.toLowerCase();
          if (f === 'min') return Math.min.apply(null, args);
          if (f === 'max') return Math.max.apply(null, args);
          if (f === 'floor') return Math.floor(args[0] || 0);
          if (f === 'ceil') return Math.ceil(args[0] || 0);
          if (f === 'round') return Math.round(args[0] || 0);
          if (f === 'abs') return Math.abs(args[0] || 0);
          return 0;
        }

        const v = (vars && Object.prototype.hasOwnProperty.call(vars, tok)) ? Number(vars[tok]) : 0;
        return Number.isFinite(v) ? v : 0;
      }

      const out = parseExpr();
      return Number.isFinite(out) ? Math.round(out * 100) / 100 : 0;
    }

    function defaultContextConfig() {
      return {
        recentTurns: 12,        // 完整发送给模型的最近回合数
        autoSummary: true,      // 自动把更早的剧情压缩为「前情提要」
        summaryTriggerTurns: 8  // 累积多少回合未压缩就触发一次摘要
      };
    }

    // ===== 世界蓝图（World Schema）=====
    // 描述"这个世界有哪些面板、叫什么名字、里面有哪些字段"。
    // 默认蓝图精确复刻原有界面，因此没有蓝图的老存档行为完全不变。
    //
    // 设计原则：约束渲染器，放开数据 —— 渲染器类型是固定的几种，
    // 模型/用户只能决定"用哪些、叫什么、字段有哪些"，不能凭空发明界面。
    function defaultWorldSchema() {
      return {
        version: 1,
        preset: 'generic-fantasy',
        name: '通用奇幻',
        creation: defaultCreationConfig(),

        // 角色卡字段（替代原先写死的 7 项）。
        // slot 决定字段摆在角色卡的哪个位置：title 大标题 / badge 徽章 / field 两列小格 /
        // appearance 底部外貌段。默认值与改造前写死的版式完全一致。
        profileFields: [
          { key: 'name', label: '姓名', slot: 'title' },
          { key: 'race', label: '种族', slot: 'badge' },
          { key: 'class', label: '职业', slot: 'badge' },
          { key: 'identity', label: '身份', slot: 'badge' },
          { key: 'gender', label: '性别', slot: 'field' },
          { key: 'age', label: '年龄', slot: 'field' },
          { key: 'appearance', label: '外貌与着装特征', slot: 'appearance' }
        ],

        tabs: [
          {
            id: 'stats', label: '属性', panelClass: 'space-y-4',
            sections: [
              { id: 'profile', type: 'profile', label: '角色档案' },
              { id: 'location', type: 'location', label: '地点' },
              { id: 'vitals', type: 'bars', label: '生存状态', source: 'bars' },
              { id: 'attrs', type: 'stats', label: '基础属性', source: 'attributes', radar: true },
              {
                id: 'mastery', type: 'tiers', label: '武器熟练度', source: 'weapon_mastery',
                ladder: ['生疏', '初级', '中级', '精通', '大师', '宗师', '传说'],
                emptyText: '暂无熟练度记录'
              },
              { id: 'states', type: 'tags', label: '状态效果', source: 'status_effects', emptyText: '正常 (无特殊状态)' }
            ]
          },
          {
            id: 'npc', label: 'NPC', panelClass: 'space-y-3',
            sections: [{
              id: 'codex', type: 'entities', label: '已知 NPC 关系与情感', source: 'npc_codex',
              badgeKey: 'love_type',
              infoFields: [{ key: 'race', label: '种族' }, { key: 'personality', label: '性格' }],
              // 数值维度的数量与名称完全由蓝图决定（原先写死 4 个）
              dimensions: [
                { key: 'affection', deltaKey: 'affDelta', label: '好感度', max: 100, tone: 'rose' },
                { key: 'trust', deltaKey: 'trustDelta', label: '信任度', max: 100, tone: 'cyan' },
                { key: 'lust', deltaKey: 'lustDelta', label: '肉欲度', max: 100, tone: 'violet' },
                { key: 'depth', deltaKey: 'depthDelta', label: '情感深度', max: 100, tone: 'amber' }
              ],
              emptyText: '当前尚未结识任何 NPC。\n产生互动后将自动记录图鉴。'
            }]
          },
          {
            id: 'bag', label: '行囊', panelClass: 'space-y-2.5',
            sections: [{ id: 'items', type: 'list', label: '随身行囊', source: 'inventory', layout: 'grid' }]
          },
          {
            id: 'spells', label: '技能', panelClass: 'space-y-3',
            sections: [
              {
                id: 'spells', type: 'list', label: '已掌握技能', source: 'spells', layout: 'cards',
                costKey: 'mp', costLabel: 'MP', tagKey: 'ring', tagFallback: '通用',
                action: { label: '施展', template: '【技能检定】施展【{name}】(消耗 {cost} MP)。' },
                emptyText: '暂未掌握任何技能'
              },
              { id: 'skills', type: 'skills', label: '技能掌握', source: 'skills', emptyText: '暂无技能记录' }
            ]
          }
        ]
      };
    }

    const AppState = {
      apiConfig: {
        // 默认走 DeepSeek（OpenAI 兼容协议）：base_url 不带 /v1，模型名用 deepseek-flash
        provider: 'openai_compatible',
        apiKey: '',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-flash',
        temperature: 0.8,
        maxTokens: 0,
        // 思考模式默认开启：本应用的 system prompt 是一大堆互相牵制的硬性约束
        //（口吻禁忌、两处结构化区块、game_state 字段契约），关掉思考后小模型明显更容易
        // 漏 game_state、说重复话、把机制语域带进正文 —— 用户实测反馈的"回答很愚蠢"里
        // 就有这一份。代价是更慢更贵，且官方在思考模式下会静默忽略 temperature
        //（buildLlmRequest 里已据此删掉该字段，避免发一个无效参数误导人）。
        // 想省钱可以在【API 设置】里关掉；关掉后 temperature 重新生效。
        thinkingEnabled: true,
        // 自定义端点（协议选 custom 时生效）：地址是否已是完整请求地址 + 额外请求参数 / 请求头。
        // 这两份 JSON 只在 custom 协议下参与请求，切回内置协议时原样保留、不会被清空。
        customFullEndpoint: false,
        extraParams: {},
        extraHeaders: {}
      },
      currentSlotId: 'slot_custom_1',
      slots: [
        { id: 'slot_custom_1', name: '我的世界', desc: '自由自定义世界观与法则' }
      ],
      themeTone: 'classic',
      artStyle: 'editorial',
      stageFocus: false,
      privacyShield: false,
      highlightConfig: {
        color: '#fbbf24',
        style: 'tag'
      },
      soundConfig: {
        diceSound: true,
        turnSound: true
      },
      voiceConfig: {
        ttsProvider: 'browser',
        sttProvider: 'browser',
        apiBaseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        ttsModel: 'tts-1',
        ttsVoice: 'nova',
        sttModel: 'whisper-1',
        speechRate: 1.0,
        autoPlayNpc: false
      },
      fontSize: 'text-sm',
      isSidebarOpen: false,
      activeHudTab: 'stats',
      selectedItemName: null,
      lore: {
        world: '',
        character: '',
        rules: '',
        memoryPins: ''
      },
      wizardConfig: defaultWizardConfig(),
      narrativeHistory: [],
      hudState: defaultHudState(),
      worldSchema: defaultWorldSchema(),
      contextConfig: defaultContextConfig(),
      contextSummary: '',
      summarizedUpTo: 0,
      isGenerating: false
    };

    // 全局复古画报舒适配色方案（在「偏好设置」中一键切换，实时联动纸张底色、铅字墨色、印泥主色与图表色调）
    const THEME_PRESETS = [
      {
        id: 'classic',
        name: '📜 经典朱砂棉纸',
        subtitle: '纽约客古典暖棉纸 · 朱砂印泥与常春藤墨绿',
        bgMain: '#f2eadb',
        bgPanel: '#ece1cc',
        bgSurface: '#faf6ee',
        bgElevated: '#e5d8c0',
        bgModal: '#faf6ee',
        ink: '#181512',
        inkMuted: '#5c5245',
        border: '#181512',
        borderSoft: '#b8a686',
        primary: '#a62620',
        primaryHover: '#8b1e19',
        primaryTint: '#f8ebe8',
        accent: '#1b4332',
        accentTint: '#e8f1eb',
        glow: 'rgba(166, 38, 32, 0.2)',
        isLight: true
      },
      {
        id: 'sage',
        name: '🌿 剑桥鼠尾草绿',
        subtitle: '护眼草本羊皮纸 · 剑桥松柏绿与琥珀铜棕',
        bgMain: '#ebf0e8',
        bgPanel: '#dfe7da',
        bgSurface: '#f7faf5',
        bgElevated: '#d3decb',
        bgModal: '#f7faf5',
        ink: '#15221b',
        inkMuted: '#4a5d52',
        border: '#15221b',
        borderSoft: '#9cb0a2',
        primary: '#1f5c44',
        primaryHover: '#174734',
        primaryTint: '#e3f0ea',
        accent: '#945818',
        accentTint: '#f5ece0',
        glow: 'rgba(31, 92, 68, 0.2)',
        isLight: true
      },
      {
        id: 'oxford',
        name: '🌊 牛津亚麻雾蓝',
        subtitle: '清爽亚麻书页 · 牛津学院蓝与藏书印绯红',
        bgMain: '#eaeff5',
        bgPanel: '#dde5ef',
        bgSurface: '#f7f9fc',
        bgElevated: '#cfdae8',
        bgModal: '#f7f9fc',
        ink: '#141f2e',
        inkMuted: '#4c5b70',
        border: '#141f2e',
        borderSoft: '#9fb0c7',
        primary: '#1e4d82',
        primaryHover: '#163a63',
        primaryTint: '#e4eef9',
        accent: '#992b2b',
        accentTint: '#f9e8e8',
        glow: 'rgba(30, 77, 130, 0.2)',
        isLight: true
      },
      {
        id: 'roast',
        name: '☕ 京都焙茶和纸',
        subtitle: '温润低眩光日晒和纸 · 焦糖琥珀棕与青苔绿',
        bgMain: '#eee3d0',
        bgPanel: '#e4d6be',
        bgSurface: '#f8f2e7',
        bgElevated: '#d8c7ab',
        bgModal: '#f8f2e7',
        ink: '#221a13',
        inkMuted: '#635344',
        border: '#221a13',
        borderSoft: '#b5a084',
        primary: '#8a481d',
        primaryHover: '#6e3815',
        primaryTint: '#f5e8de',
        accent: '#365942',
        accentTint: '#e5efe8',
        glow: 'rgba(138, 72, 29, 0.2)',
        isLight: true
      },
      {
        id: 'plum',
        name: '🌸 巴黎沙龙玫瑰',
        subtitle: '奶油石英粉纸 · 波尔多酒红与冷杉灰绿',
        bgMain: '#f2e9eb',
        bgPanel: '#e8dcdf',
        bgSurface: '#fbf7f8',
        bgElevated: '#ddd0d4',
        bgModal: '#fbf7f8',
        ink: '#24161b',
        inkMuted: '#634d55',
        border: '#24161b',
        borderSoft: '#bba5ad',
        primary: '#872844',
        primaryHover: '#6b1e35',
        primaryTint: '#f7e6eb',
        accent: '#2e5447',
        accentTint: '#e5f0ec',
        glow: 'rgba(135, 40, 68, 0.2)',
        isLight: true
      },
      {
        id: 'midnight',
        name: '🌙 午夜善本暗房',
        subtitle: '夜间护眼柔炭黑底 · 鎏金琥珀与松石青绿',
        bgMain: '#171614',
        bgPanel: '#1f1d1a',
        bgSurface: '#25231f',
        bgElevated: '#302d28',
        bgModal: '#1f1d1a',
        ink: '#e6ddd0',
        inkMuted: '#a39887',
        border: '#4a4339',
        borderSoft: '#3b352d',
        primary: '#d4842a',
        primaryHover: '#b86f1f',
        primaryTint: '#332618',
        accent: '#4fa394',
        accentTint: '#1c2e2b',
        glow: 'rgba(212, 132, 42, 0.24)',
        isLight: false
      }
    ];

    const ART_STYLE_PRESETS = THEME_PRESETS;

    const HIGHLIGHT_PRESETS = [
      { name: '金色', color: '#fbbf24' },
      { name: '青色', color: '#22d3ee' },
      { name: '紫色', color: '#c084fc' },
      { name: '绿色', color: '#34d399' },
      { name: '红色', color: '#f87171' },
      { name: '橙色', color: '#fb923c' }
    ];

    function hexToRgba(hex, alpha = 1) {
      let cleanHex = hex.replace('#', '').trim();
      if (cleanHex.length === 3) cleanHex = cleanHex.split('').map(x => x + x).join('');
      if (cleanHex.length !== 6) return `rgba(251, 191, 36, ${alpha})`;
      const num = parseInt(cleanHex, 16);
      return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
    }

    function applyThemeTone(themeId, opts = {}) {
      const theme = THEME_PRESETS.find(t => t.id === themeId) || THEME_PRESETS[0];
      AppState.themeTone = theme.id;
      document.body.setAttribute('data-art-style', 'editorial');

      const root = document.documentElement;
      root.style.setProperty('--ed-bg-main', theme.bgMain);
      root.style.setProperty('--ed-bg-panel', theme.bgPanel);
      root.style.setProperty('--ed-bg-surface', theme.bgSurface);
      root.style.setProperty('--ed-bg-elevated', theme.bgElevated);
      root.style.setProperty('--ed-ink', theme.ink);
      root.style.setProperty('--ed-ink-muted', theme.inkMuted);
      root.style.setProperty('--ed-border', theme.border);
      root.style.setProperty('--ed-border-soft', theme.borderSoft);
      root.style.setProperty('--ed-primary', theme.primary);
      root.style.setProperty('--ed-primary-hover', theme.primaryHover);
      root.style.setProperty('--ed-primary-tint', theme.primaryTint);
      root.style.setProperty('--ed-accent', theme.accent);
      root.style.setProperty('--ed-accent-tint', theme.accentTint);
      root.style.setProperty('--ed-paper-dot-1', theme.isLight ? 'rgba(24, 21, 18, 0.045)' : 'rgba(230, 221, 208, 0.04)');
      root.style.setProperty('--ed-paper-dot-2', hexToRgba(theme.primary, 0.035));
      root.style.setProperty('--ed-card-shadow', theme.isLight ? 'rgba(24, 21, 18, 0.16)' : 'rgba(0, 0, 0, 0.45)');

      const headerDot = document.getElementById('headerThemeDot');
      if (headerDot) {
        headerDot.style.backgroundColor = theme.primary;
        headerDot.style.boxShadow = `0 0 8px ${theme.glow}`;
      }
      const brandBadge = document.getElementById('headerBrandBadge');
      if (brandBadge) {
        brandBadge.style.background = theme.primary;
      }
      const curLabelEl = document.getElementById('currentThemeLabel');
      if (curLabelEl) {
        curLabelEl.textContent = theme.name;
      }

      const styleEl = document.getElementById('dynamicAppThemeStyles');
      if (styleEl) {
        styleEl.innerHTML = `
          body { background-color: ${theme.bgMain} !important; color: ${theme.ink} !important; }
          header, #sidebarRail, #leftSidebar, #rightSidebar, #bottomCommandDeck {
            background-color: ${theme.bgPanel} !important; border-color: ${theme.border} !important; color: ${theme.ink} !important;
          }
          #apiModal > div, #settingsModal > div, #manualHudModal > div, #resetConfirmModal > div, #diceConfirmModal > div, #attributeCapModal > div, #wizardModal > div, #slotModal > div, #tacticsModal > div {
            background-color: ${theme.bgModal} !important; border-color: ${theme.border} !important; color: ${theme.ink} !important;
          }
          textarea, input[type="text"], input[type="password"], input[type="number"], select {
            background-color: ${theme.bgSurface} !important; border-color: ${theme.borderSoft} !important; color: ${theme.ink} !important;
          }
          textarea:focus, input:focus, select:focus {
            border-color: ${theme.primary} !important; box-shadow: 0 0 0 1px ${theme.primary} !important;
          }
          #sendActionBtn, #saveSettingsConfigBtn, #saveApiConfigBtn, #confirmDiceBtn, #saveCapModalBtn, #completeWizardBtn {
            background: ${theme.primary} !important;
            color: #faf6ee !important;
          }
        `;
      }

      if (typeof renderHud === 'function' && AppState.hudState) {
        try { renderHud(); } catch (e) {}
      }

      try {
        localStorage.setItem('chronicle_theme_tone', theme.id);
      } catch (e) {}

      if (!opts.silent) {
        showToast(`已切换全局画报配色：「${theme.name}」`, 'success');
      }
    }

    function applyHighlightConfig(config) {
      const color = config.color || '#fbbf24';
      const style = config.style || 'tag';
      const root = document.documentElement;
      root.style.setProperty('--hl-color', color);
      root.style.setProperty('--hl-bg', hexToRgba(color, style === 'marker' ? 0.35 : 0.16));
      root.style.setProperty('--hl-border', hexToRgba(color, 0.4));
      root.style.setProperty('--hl-glow', hexToRgba(color, 0.3));
      document.body.classList.remove('hl-mode-tag', 'hl-mode-marker', 'hl-mode-neon');
      document.body.classList.add(`hl-mode-${style}`);
    }

    // ===== Three.js 3D 实时交互几何与粒子舞台 =====
    const threeStageState = {
      renderer: null,
      scene: null,
      camera: null,
      rootGroup: null,
      primaryMesh: null,
      secondaryMesh: null,
      ringGroup: null,
      particles: null,
      gridHelper: null,
      mouseX: 0,
      mouseY: 0,
      targetCamX: 0,
      targetCamY: 0,
      pulseEnergy: 0,
      voiceEnergy: 0,
      rafId: null,
      styleId: 'acid'
    };

    function triggerThreeStagePulse(amount = 1.2) {
      threeStageState.pulseEnergy = Math.min(3.5, threeStageState.pulseEnergy + amount);
    }

    function buildParticleCloud(count, radius, hexColor, styleId) {
      if (typeof THREE === 'undefined') return null;
      const geo = new THREE.BufferGeometry();
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        if (styleId === 'abyss' || styleId === 'acid') {
          // 螺旋星旋/吸积盘分布
          const angle = i * 0.24;
          const r = 0.8 + (i / count) * radius;
          positions[i * 3] = Math.cos(angle) * r;
          positions[i * 3 + 1] = (Math.random() - 0.5) * 2.2;
          positions[i * 3 + 2] = Math.sin(angle) * r;
        } else {
          positions[i * 3] = (Math.random() - 0.5) * radius * 2.2;
          positions[i * 3 + 1] = (Math.random() - 0.5) * radius * 1.6;
          positions[i * 3 + 2] = (Math.random() - 0.5) * radius * 2.0;
        }
      }
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({
        color: hexColor,
        size: styleId === 'brutalist' ? 2.6 : 1.9,
        opacity: styleId === 'editorial' ? 0.35 : 0.65,
        transparent: true
      });
      return new THREE.Points(geo, mat);
    }

    function rebuildThreeSceneForArtStyle(styleId) {
      if (typeof THREE === 'undefined' || !threeStageState.scene) return;
      threeStageState.styleId = styleId;
      const scene = threeStageState.scene;
      scene.clear();
      scene.userData.customBackdrop = null;
      scene.userData.customForeground = null;

      const rootGroup = new THREE.Group();
      threeStageState.rootGroup = rootGroup;
      threeStageState.primaryMesh = null;
      threeStageState.secondaryMesh = null;
      threeStageState.ringGroup = null;
      threeStageState.particles = null;
      threeStageState.gridHelper = null;

      if (styleId === 'acid') {
        // 🧪 酸性千禧：3D 液态铬与酸性荧光环面扭结 (Lit TorusKnot) + 逆向旋转二十面体晶格 + Y2K 战术十字准星背景
        scene.userData.customBackdrop = (ctx, w, h) => {
          const cx = w * 0.5, cy = h * 0.42;
          const r = Math.min(w, h) * 0.34;
          const grad = ctx.createRadialGradient(cx, cy, r * 0.08, cx, cy, r * 1.35);
          grad.addColorStop(0, 'rgba(204, 255, 0, 0.16)');
          grad.addColorStop(0.5, 'rgba(255, 0, 160, 0.08)');
          grad.addColorStop(1, 'rgba(5, 6, 8, 0)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, w, h);

          ctx.save();
          ctx.strokeStyle = 'rgba(204, 255, 0, 0.28)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();

          ctx.strokeStyle = 'rgba(255, 0, 160, 0.24)';
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.arc(cx, cy, r * 1.18, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);

          // Y2K 刻度环与十字准星
          for (let i = 0; i < 24; i++) {
            const ang = (i / 24) * Math.PI * 2;
            const r1 = r * 0.96;
            const r2 = (i % 3 === 0) ? r * 1.05 : r * 1.01;
            ctx.strokeStyle = (i % 6 === 0) ? 'rgba(255, 0, 160, 0.65)' : 'rgba(204, 255, 0, 0.38)';
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
            ctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
            ctx.stroke();
          }
          ctx.restore();
        };

        const knotGeo = new THREE.TorusKnotGeometry(1.38, 0.34, 80, 12, 3, 4);
        const knotMat = new THREE.MeshBasicMaterial({
          color: '#1b2414',
          rimColor: '#ccff00',
          edgeColor: '#ccff00',
          wireframe: false,
          opacity: 0.72,
          fillOpacity: 0.68,
          metallic: 0.92,
          glow: 8,
          transparent: true,
          linewidth: 1.15
        });
        const knotMesh = new THREE.Mesh(knotGeo, knotMat);

        const cageGeo = new THREE.IcosahedronGeometry(2.38, 1);
        const cageMat = new THREE.MeshBasicMaterial({
          color: '#ff00a0',
          wireframe: true,
          opacity: 0.42,
          glow: 6,
          transparent: true,
          linewidth: 1.1
        });
        const cageMesh = new THREE.Mesh(cageGeo, cageMat);

        const ringGroup = new THREE.Group();
        const rGeo = new THREE.RingGeometry(2.75, 2.83, 48);
        const rMat = new THREE.MeshBasicMaterial({ color: '#00ffcc', wireframe: true, opacity: 0.48, transparent: true });
        const ring = new THREE.Mesh(rGeo, rMat);
        ring.rotation.x = 1.08;
        ringGroup.add(ring);

        const pts = buildParticleCloud(150, 4.8, '#ccff00', 'acid');
        rootGroup.add(knotMesh, cageMesh, ringGroup, pts);
        threeStageState.primaryMesh = knotMesh;
        threeStageState.secondaryMesh = cageMesh;
        threeStageState.ringGroup = ringGroup;
        threeStageState.particles = pts;
      } else if (styleId === 'brutalist') {
        // ⚡ 新野兽派波普：包豪斯几何色块背景 + 3D 赛璐璐着色八面体 + 嵌套立方体 + 建筑网格
        scene.userData.customBackdrop = (ctx, w, h) => {
          const cx = w * 0.5, cy = h * 0.42;
          const r = Math.min(w, h) * 0.25;
          ctx.save();
          // 粗野派硬边投影圆盘
          ctx.fillStyle = 'rgba(255, 87, 34, 0.28)';
          ctx.fillRect(cx - r * 1.1 + 10, cy - r * 0.75 + 10, r * 2.2, r * 1.5);
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 2.5;
          ctx.strokeRect(cx - r * 1.1, cy - r * 0.75, r * 2.2, r * 1.5);

          ctx.beginPath();
          ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(250, 204, 21, 0.14)';
          ctx.fill();
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = '#38bdf8';
          ctx.stroke();
          ctx.restore();
        };

        const octGeo = new THREE.OctahedronGeometry(1.75);
        const octMat = new THREE.MeshBasicMaterial({
          color: '#ff5722',
          rimColor: '#facc15',
          edgeColor: '#facc15',
          wireframe: false,
          opacity: 0.85,
          fillOpacity: 0.78,
          metallic: 0.35,
          transparent: true,
          linewidth: 2.2
        });
        const octMesh = new THREE.Mesh(octGeo, octMat);

        const boxGeo = new THREE.BoxGeometry(2.35, 2.35, 2.35);
        const boxMat = new THREE.MeshBasicMaterial({
          color: '#38bdf8',
          wireframe: true,
          opacity: 0.72,
          transparent: true,
          linewidth: 2.0
        });
        const boxMesh = new THREE.Mesh(boxGeo, boxMat);

        const grid = new THREE.GridHelper(12, 10, '#38bdf8', '#facc15');
        grid.position.y = -2.05;
        grid.rotation.x = 0.18;

        const pts = buildParticleCloud(85, 4.5, '#facc15', 'brutalist');
        rootGroup.add(octMesh, boxMesh, grid, pts);
        threeStageState.primaryMesh = octMesh;
        threeStageState.secondaryMesh = boxMesh;
        threeStageState.gridHelper = grid;
        threeStageState.particles = pts;
      } else if (styleId === 'cyber') {
        // 🌆 赛博故障流体：合成波切割落日 (Synthwave Sun) + 双核全息测地线球体 + 霓虹地平线网格
        scene.userData.customBackdrop = (ctx, w, h) => {
          const cx = w * 0.5, cy = h * 0.43;
          const sunR = Math.min(w, h) * 0.27;
          ctx.save();
          const sunGrad = ctx.createLinearGradient(cx, cy - sunR, cx, cy + sunR);
          sunGrad.addColorStop(0, 'rgba(255, 0, 127, 0.52)');
          sunGrad.addColorStop(0.55, 'rgba(255, 102, 0, 0.38)');
          sunGrad.addColorStop(1, 'rgba(0, 240, 255, 0.15)');

          ctx.beginPath();
          ctx.arc(cx, cy, sunR, 0, Math.PI * 2);
          ctx.fillStyle = sunGrad;
          ctx.fill();

          // 合成波落日横向扫描切割条
          ctx.fillStyle = '#040612';
          for (let i = 0; i < 6; i++) {
            const sliceY = cy + sunR * (0.12 + i * 0.14);
            const sliceH = 2.5 + i * 1.8;
            ctx.fillRect(cx - sunR - 4, sliceY, sunR * 2 + 8, sliceH);
          }

          ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(cx, cy, sunR * 1.12, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        };

        const sphereGeo = new THREE.IcosahedronGeometry(1.55, 2);
        const sphereMat = new THREE.MeshBasicMaterial({
          color: '#071c30',
          rimColor: '#00f0ff',
          edgeColor: '#00f0ff',
          wireframe: false,
          opacity: 0.62,
          fillOpacity: 0.48,
          metallic: 0.85,
          glow: 10,
          transparent: true,
          linewidth: 1.15
        });
        const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);

        const coreGeo = new THREE.OctahedronGeometry(0.96);
        const coreMat = new THREE.MeshBasicMaterial({
          color: '#ff007f',
          rimColor: '#ffffff',
          edgeColor: '#ff007f',
          wireframe: false,
          opacity: 0.86,
          fillOpacity: 0.8,
          glow: 12,
          transparent: true,
          linewidth: 1.5
        });
        const coreMesh = new THREE.Mesh(coreGeo, coreMat);

        const grid = new THREE.GridHelper(16, 14, '#ff007f', '#00f0ff');
        grid.position.y = -1.92;
        grid.rotation.x = 0.14;

        const pts = buildParticleCloud(160, 5.2, '#00f0ff', 'cyber');
        rootGroup.add(sphereMesh, coreMesh, grid, pts);
        threeStageState.primaryMesh = sphereMesh;
        threeStageState.secondaryMesh = coreMesh;
        threeStageState.gridHelper = grid;
        threeStageState.particles = pts;
      } else if (styleId === 'editorial') {
        // 📜 常春藤复古画报：达芬奇星盘罗盘底图 + 黄金比例浑天仪星环 (Celestial Astrolabe)
        scene.userData.customBackdrop = (ctx, w, h) => {
          const cx = w * 0.5, cy = h * 0.42;
          const r = Math.min(w, h) * 0.32;
          ctx.save();
          ctx.strokeStyle = 'rgba(180, 83, 9, 0.28)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();

          ctx.strokeStyle = 'rgba(21, 128, 61, 0.22)';
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);

          // 古典星盘子午线
          for (let i = 0; i < 8; i++) {
            const ang = (i / 8) * Math.PI;
            ctx.strokeStyle = 'rgba(180, 83, 9, 0.16)';
            ctx.beginPath();
            ctx.moveTo(cx - Math.cos(ang) * r * 1.15, cy - Math.sin(ang) * r * 1.15);
            ctx.lineTo(cx + Math.cos(ang) * r * 1.15, cy + Math.sin(ang) * r * 1.15);
            ctx.stroke();
          }
          ctx.restore();
        };

        const coreGeo = new THREE.IcosahedronGeometry(1.08, 1);
        const coreMat = new THREE.MeshBasicMaterial({
          color: '#d6c7a9',
          rimColor: '#15803d',
          edgeColor: '#b45309',
          wireframe: false,
          opacity: 0.75,
          fillOpacity: 0.65,
          metallic: 0.65,
          transparent: true,
          linewidth: 1.25
        });
        const coreMesh = new THREE.Mesh(coreGeo, coreMat);

        const ringGroup = new THREE.Group();
        [
          { r1: 1.62, r2: 1.68, col: '#b45309', rx: 0.7, ry: 0.3 },
          { r1: 2.12, r2: 2.18, col: '#15803d', rx: -0.5, ry: 0.9 },
          { r1: 2.62, r2: 2.68, col: '#78716c', rx: 1.2, ry: -0.4 }
        ].forEach(cfg => {
          const rg = new THREE.RingGeometry(cfg.r1, cfg.r2, 48);
          const rm = new THREE.MeshBasicMaterial({ color: cfg.col, wireframe: true, opacity: 0.55, transparent: true });
          const mesh = new THREE.Mesh(rg, rm);
          mesh.rotation.set(cfg.rx, cfg.ry, 0);
          ringGroup.add(mesh);
        });

        const pts = buildParticleCloud(95, 4.4, '#b45309', 'editorial');
        rootGroup.add(coreMesh, ringGroup, pts);
        threeStageState.primaryMesh = coreMesh;
        threeStageState.ringGroup = ringGroup;
        threeStageState.particles = pts;
      } else {
        // 🌌 奇点深空流体：黑洞事件视界光子环 + 引力吸积盘与多维流形晶体
        scene.userData.customBackdrop = (ctx, w, h) => {
          const cx = w * 0.5, cy = h * 0.42;
          const r = Math.min(w, h) * 0.28;
          ctx.save();
          const halo = ctx.createRadialGradient(cx, cy, r * 0.25, cx, cy, r * 1.45);
          halo.addColorStop(0, 'rgba(5, 3, 14, 0.95)');
          halo.addColorStop(0.38, 'rgba(139, 92, 246, 0.34)');
          halo.addColorStop(0.62, 'rgba(56, 189, 248, 0.18)');
          halo.addColorStop(1, 'rgba(5, 3, 14, 0)');
          ctx.fillStyle = halo;
          ctx.fillRect(0, 0, w, h);

          ctx.strokeStyle = 'rgba(251, 191, 36, 0.42)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        };

        const coreGeo = new THREE.IcosahedronGeometry(1.18, 1);
        const coreMat = new THREE.MeshBasicMaterial({
          color: '#170b36',
          rimColor: '#c084fc',
          edgeColor: '#8b5cf6',
          wireframe: false,
          opacity: 0.82,
          fillOpacity: 0.76,
          metallic: 0.88,
          glow: 12,
          transparent: true,
          linewidth: 1.25
        });
        const coreMesh = new THREE.Mesh(coreGeo, coreMat);

        const knotGeo = new THREE.TorusKnotGeometry(1.92, 0.18, 72, 8, 2, 5);
        const knotMat = new THREE.MeshBasicMaterial({
          color: '#38bdf8',
          wireframe: true,
          opacity: 0.45,
          glow: 8,
          transparent: true
        });
        const knotMesh = new THREE.Mesh(knotGeo, knotMat);
        knotMesh.rotation.x = 0.85;

        const pts = buildParticleCloud(180, 5.2, '#c084fc', 'abyss');
        rootGroup.add(coreMesh, knotMesh, pts);
        threeStageState.primaryMesh = coreMesh;
        threeStageState.secondaryMesh = knotMesh;
        threeStageState.particles = pts;
      }

      // 将 3D 核心雕塑略微上移，使其精准悬浮于首页顶部 3D 取景窗 (#threeStageShowcase) 正中央
      rootGroup.position.y = 0.48;

      scene.add(rootGroup);
      if (threeStageState.renderer && threeStageState.camera) {
        threeStageState.renderer.render(scene, threeStageState.camera);
      }
    }

    function initThreeStage() {
      if (typeof THREE === 'undefined') return;
      const canvas = document.getElementById('threeStageCanvas');
      const wrap = document.getElementById('threeStageWrap');
      if (!canvas || !wrap) return;

      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(typeof window !== 'undefined' ? window.devicePixelRatio : 1);
      const rect = wrap.getBoundingClientRect();
      const w = Math.max(320, rect.width || 800);
      const h = Math.max(240, rect.height || 600);
      renderer.setSize(w, h);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(58, w / h, 0.1, 100);
      camera.position.set(0, 0, 5.8);

      threeStageState.renderer = renderer;
      threeStageState.scene = scene;
      threeStageState.camera = camera;

      rebuildThreeSceneForArtStyle(AppState.artStyle || 'acid');

      window.addEventListener('mousemove', (e) => {
        const vw = window.innerWidth || 1200;
        const vh = window.innerHeight || 800;
        threeStageState.mouseX = ((e.clientX / vw) - 0.5) * 2;
        threeStageState.mouseY = ((e.clientY / vh) - 0.5) * 2;
      }, { passive: true });

      window.addEventListener('resize', () => {
        if (!threeStageState.renderer || !threeStageState.camera) return;
        const r = wrap.getBoundingClientRect();
        const nw = Math.max(320, r.width || window.innerWidth || 800);
        const nh = Math.max(240, r.height || window.innerHeight || 600);
        threeStageState.renderer.setSize(nw, nh);
        threeStageState.camera.aspect = nw / nh;
        threeStageState.camera.updateProjectionMatrix();
      });

      // jsdom 测试环境下无需启动 60fps 无限循环，渲染首帧即可保证快照与性能
      const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '');
      if (isJsdom) {
        renderer.render(scene, camera);
        return;
      }

      const clock = new THREE.Clock();
      const animate = () => {
        threeStageState.rafId = requestAnimationFrame(animate);
        const dt = Math.min(0.05, clock.getDelta());
        const elapsed = clock.getElapsedTime();

        // 衰减脉冲与语音能量
        threeStageState.pulseEnergy *= Math.pow(0.18, dt);
        const activeEnergy = 1 + threeStageState.pulseEnergy + threeStageState.voiceEnergy * 1.4;

        // 丝滑阻尼跟随鼠标视差
        threeStageState.targetCamX += (threeStageState.mouseX * 1.15 - threeStageState.targetCamX) * 0.06;
        threeStageState.targetCamY += (-threeStageState.mouseY * 0.85 - threeStageState.targetCamY) * 0.06;
        camera.position.x = threeStageState.targetCamX;
        camera.position.y = threeStageState.targetCamY;

        if (threeStageState.primaryMesh) {
          threeStageState.primaryMesh.rotation.y += dt * 0.42 * activeEnergy;
          threeStageState.primaryMesh.rotation.x += dt * 0.24 * activeEnergy;
          const s = 1 + Math.sin(elapsed * 2.2) * 0.045 + (threeStageState.pulseEnergy + threeStageState.voiceEnergy) * 0.14;
          threeStageState.primaryMesh.scale.set(s, s, s);
        }
        if (threeStageState.secondaryMesh) {
          threeStageState.secondaryMesh.rotation.y -= dt * 0.28 * activeEnergy;
          threeStageState.secondaryMesh.rotation.z += dt * 0.18 * activeEnergy;
        }
        if (threeStageState.ringGroup) {
          threeStageState.ringGroup.rotation.z += dt * 0.32 * activeEnergy;
          threeStageState.ringGroup.rotation.y += dt * 0.19;
        }
        if (threeStageState.particles) {
          threeStageState.particles.rotation.y += dt * 0.12 * activeEnergy;
        }
        if (threeStageState.gridHelper) {
          threeStageState.gridHelper.position.z = (elapsed * 0.85) % 1.2;
        }

        renderer.render(scene, camera);
      };
      animate();
    }

    function applyArtStyle(styleId, opts = {}) {
      applyThemeTone(AppState.themeTone || 'classic', opts);
    }

    function cycleArtStyle() {
      const idx = THEME_PRESETS.findIndex(t => t.id === AppState.themeTone);
      const next = THEME_PRESETS[(idx + 1) % THEME_PRESETS.length];
      applyThemeTone(next.id, { silent: false });
      renderThemeGrid();
    }

    function toggleStageFocus() {
      AppState.stageFocus = !AppState.stageFocus;
      if (AppState.stageFocus) {
        document.body.setAttribute('data-stage-focus', '1');
      } else {
        document.body.removeAttribute('data-stage-focus');
      }
      const txt = document.getElementById('stageFocusBtnText');
      if (txt) txt.textContent = AppState.stageFocus ? '退出专注' : '剧场专注';
      triggerThreeStagePulse(1.4);
      if (threeStageState.renderer) {
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
      }
      showToast(AppState.stageFocus
        ? '🎭 已开启 3D 剧场专注模式：侧栏已收起，尽情沉浸口语交锋'
        : '已恢复三栏完整工作台视图', 'info');
    }

    class SoundEngine {
      constructor() { this.ctx = null; }
      init() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      playDiceRoll() {
        if (!AppState.soundConfig.diceSound) return;
        try {
          this.init();
          for (let i = 0; i < 4; i++) {
            setTimeout(() => {
              const osc = this.ctx.createOscillator();
              const gain = this.ctx.createGain();
              osc.type = 'triangle';
              osc.frequency.setValueAtTime(300 + Math.random() * 400, this.ctx.currentTime);
              gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);
              osc.connect(gain);
              gain.connect(this.ctx.destination);
              osc.start();
              osc.stop(this.ctx.currentTime + 0.08);
            }, i * 45);
          }
        } catch (e) {}
      }
      playTurnBeep() {
        if (!AppState.soundConfig.turnSound) return;
        try {
          this.init();
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(587.33, this.ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.15);
          gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.25);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start();
          osc.stop(this.ctx.currentTime + 0.25);
        } catch (e) {}
      }
    }
    const sounds = new SoundEngine();

    function getSlotStorageKey(slotId, itemKey) {
      return `chronicle_${slotId}_${itemKey}`;
    }

    // ===== 敏感值安全存储（Windows DPAPI，走 Rust 侧 secret_* 三个命令）=====
    // localStorage 是明文的：备份、同步盘、以及任何能读用户 profile 目录的程序都能
    // 直接把 API Key 拿走。所以有原生侧可用时，Key 交给 DPAPI 加密后落到应用数据目录，
    // localStorage 里只保留不含 Key 的其余配置。
    //
    // 这里直接用 window.__TAURI_INTERNALS__.invoke：它是 Tauri 始终注入的 IPC 桥，
    // withGlobalTauri 只决定要不要额外暴露 window.__TAURI__ 那层公开 API，
    // 所以用它不扩大攻击面（当初关掉 withGlobalTauri 的收益仍然保留）。
    // 非 Tauri 环境（浏览器直开 / jsdom 测试）没有这个桥，自动退回 localStorage 旧行为。
    const SECRET_API_KEY = 'api_key';

    function tauriInvoke() {
      const it = (typeof window !== 'undefined') ? window.__TAURI_INTERNALS__ : null;
      return (it && typeof it.invoke === 'function') ? it.invoke.bind(it) : null;
    }

    function isSecureStorageAvailable() {
      return !!tauriInvoke();
    }

    async function secretSet(name, value) {
      const invoke = tauriInvoke();
      if (!invoke) throw new Error('当前环境没有安全存储');
      return invoke('secret_set', { name, value });
    }

    async function secretGet(name) {
      const invoke = tauriInvoke();
      if (!invoke) return null;
      const v = await invoke('secret_get', { name });
      return (typeof v === 'string' && v) ? v : null;
    }

    async function secretDelete(name) {
      const invoke = tauriInvoke();
      if (!invoke) return false;
      await invoke('secret_delete', { name });
      return true;
    }

    // 安全存储里是否已经有一份可信的 Key。只有它为 true 时才敢把 localStorage 里的
    // 明文 Key 抹掉 —— 否则万一 DPAPI 写入失败，用户的 Key 就真的没了。
    let secureKeySynced = false;
    let lastSyncedApiKey = null;

    function apiConfigSnapshot() {
      const cfg = Object.assign({}, AppState.apiConfig);
      if (isSecureStorageAvailable() && secureKeySynced) delete cfg.apiKey;
      return cfg;
    }

    function refreshApiKeyStorageNote() {
      const el = document.getElementById('apiKeyStorageNote');
      if (!el) return;
      if (isSecureStorageAvailable()) {
        el.textContent = 'Key 由系统 DPAPI 加密后保存在本机（只有当前用户能解密），不会上传到任何中间服务器。';
      } else {
        el.textContent = '当前环境没有系统级安全存储，Key 只能明文存在 localStorage；桌面版会用 Windows DPAPI 加密。';
      }
    }

    // 用户实测反馈"回答非常愚蠢"。诊断里有一份因素是思考模式被关掉了：本应用的 system prompt
    // 是一大堆互相牵制的硬性约束（口吻禁忌、两处结构化区块、game_state 契约），关掉思考后
    // 小模型更容易漏 game_state、说重复话、把机制语域带进正文。
    // 默认值已改成开启，但**老存档里存的是旧默认值 false**，不会被新默认覆盖；
    // 开启更慢更贵，不能替用户决定 —— 所以这里只提示一次，改不改他自己定。
    const THINKING_HINT_KEY = 'chronicle_thinking_hint_shown';

    function maybeHintThinkingMode() {
      const cfg = AppState.apiConfig || {};
      if (cfg.thinkingEnabled) return;
      if (cfg.provider !== 'openai_compatible') return;   // Gemini 没有这个开关
      if (!cfg.apiKey) return;                            // 还没配 Key 就先别打扰
      let host = '';
      try { host = new URL(cfg.baseUrl || 'https://api.deepseek.com').hostname.toLowerCase(); } catch (e) { return; }
      if (!(host === 'api.deepseek.com' || host.endsWith('.deepseek.com'))) return; // 别的后端根本不下发 thinking
      try {
        if (localStorage.getItem(THINKING_HINT_KEY)) return;
        localStorage.setItem(THINKING_HINT_KEY, '1');
      } catch (e) { /* 配额问题不该拦住主流程：提示一次与不提示都能接受 */ }
      setTimeout(() => showToast(
        '思考模式当前关闭：本应用的长约束提示词在关闭后更容易漏 game_state、说重复话。' +
        '建议在【API 设置】里开启（会更慢、略贵）。', 'info'), 900);
    }

    function refreshApiStatusBadge() {
      const hasKey = hasApiCredential();
      const apiBadge = document.getElementById('apiStatusBadge');
      const apiText = document.getElementById('apiStatusText');
      if (!apiBadge || !apiText || !hasKey) return;
      apiBadge.className = 'flex items-center space-x-1.5 text-xs px-2.5 py-1.5 rounded-full border border-emerald-800/50 bg-emerald-950/40 text-emerald-300';
      apiBadge.querySelector('span').className = 'w-2 h-2 rounded-full bg-emerald-400';
      apiText.textContent = `已激活: ${AppState.apiConfig.model}`;
    }

    // Key 变了才写盘：saveCurrentSlotToStorage 每回合都会被调用，
    // 不能每次存档都做一轮 DPAPI 加解密。
    function syncApiKeyToSecureStore() {
      if (!isSecureStorageAvailable()) return;
      const key = AppState.apiConfig.apiKey || '';
      if (secureKeySynced && key === lastSyncedApiKey) return;
      secretSet(SECRET_API_KEY, key)
        .then(() => {
          secureKeySynced = true;
          lastSyncedApiKey = key;
          // 同步成功后立刻把可能残留在 localStorage 里的明文 Key 清掉
          try { localStorage.setItem('chronicle_api_config', JSON.stringify(apiConfigSnapshot())); } catch (e) { /* 配额问题不该影响主流程 */ }
          refreshApiKeyStorageNote();
        })
        .catch(e => console.warn('[奇点] API Key 写入安全存储失败，暂时沿用原存储方式:', e));
    }

    async function loadApiKeyFromSecureStore() {
      if (!isSecureStorageAvailable()) { refreshApiKeyStorageNote(); return; }
      let stored = null;
      try {
        stored = await secretGet(SECRET_API_KEY);
      } catch (e) {
        console.warn('[奇点] 读取安全存储失败:', e);
      }

      // 老版本把 Key 明文写在 localStorage 里 —— 这里迁移一次
      let legacy = null;
      try {
        const raw = localStorage.getItem('chronicle_api_config');
        if (raw) legacy = JSON.parse(raw).apiKey || null;
      } catch (e) { /* 配置损坏时按没有 Key 处理 */ }

      if (!stored && legacy) {
        try {
          await secretSet(SECRET_API_KEY, legacy);
          stored = legacy;
          console.info('[奇点] 已把 localStorage 里的明文 API Key 迁移到 DPAPI 安全存储');
        } catch (e) {
          console.warn('[奇点] 明文 Key 迁移失败，继续沿用原存储:', e);
        }
      }

      if (stored) {
        AppState.apiConfig.apiKey = stored;
        lastSyncedApiKey = stored;
        // 注意顺序：先标记已同步，apiConfigSnapshot() 才会去掉 apiKey
        secureKeySynced = true;
      } else if (legacy) {
        // 安全存储里没有、迁移也没成功 —— 说明原生侧读不到可信值
        secureKeySynced = false;
      }

      if (legacy && secureKeySynced) {
        try { localStorage.setItem('chronicle_api_config', JSON.stringify(apiConfigSnapshot())); } catch (e) { /* 同上 */ }
      }

      refreshApiKeyStorageNote();
      refreshApiStatusBadge();
    }

    // 安全存储自检：走一遍真实完整链路（前端 IPC → Rust 命令 → DPAPI 落盘 → 读回 → 清理）。
    // 这是唯一能证实"前端与 Rust 之间那根线真的通了"的办法：
    // jsdom 测试用的是假桥，Rust 测试又直接调 DPAPI，中间那段谁也没验过。
    // 用一个独立的探针名，绝不碰真正的 api_key。
    async function runSecureStorageSelfTest(statusEl) {
      const say = (text, tone) => {
        if (statusEl) {
          statusEl.textContent = text;
          statusEl.className = 'text-[10px] ' + (
            tone === 'ok' ? 'text-emerald-400' : tone === 'bad' ? 'text-rose-400' : 'text-slate-500');
        }
        return text;
      };

      if (!isSecureStorageAvailable()) {
        return say('当前环境没有原生桥，无法自检（浏览器直开时只能明文存 localStorage）', 'bad');
      }

      const probe = 'selftest';
      const payload = 'ping-' + Date.now().toString(36);
      try {
        await secretSet(probe, payload);
        const back = await secretGet(probe);
        if (back !== payload) return say('自检失败：写进去又读出来对不上（DPAPI 或落盘有问题）', 'bad');
        await secretDelete(probe);
        const after = await secretGet(probe);
        if (after !== null) return say('自检失败：测试值没有被清理掉', 'bad');
        return say('自检通过：加密写入 → 读回一致 → 已清理', 'ok');
      } catch (e) {
        // 失败也尽量别留下垃圾
        try { await secretDelete(probe); } catch (err) { /* 忽略 */ }
        return say('自检失败：' + ((e && e.message) ? e.message : String(e)), 'bad');
      }
    }

    // ===== 长线记忆锚点的 AI 提炼 =====
    // 锚点原本只能手写，而且必须点「保存全部设定」才生效（很容易改完忘了点）。
    // 现在可以手动点按钮提炼，也可以设成每 N 回合自动刷新。
    //
    // 自动刷新会把锚点写进 system prompt 的稳定区（那是刻意为了前缀缓存排的），
    // 所以 N 越小、缓存被冲掉的越频繁 —— 界面上的说明里写了这条，默认是 0（关闭）。
    const PINS_AUTO_KEY = 'chronicle_pins_auto_interval';
    const PINS_MAX_CHARS = 2000;      // 锚点自身长度上限，防止越滚越长把上下文吃掉
    const PINS_STORY_ENTRIES = 16;    // 提炼时回看的最近剧情条数
    let isExtractingPins = false;

    function getPinsAutoInterval() {
      const n = parseInt(localStorage.getItem(PINS_AUTO_KEY), 10);
      return Number.isFinite(n) && n > 0 ? Math.min(n, 99) : 0;
    }

    function setPinsAutoInterval(n) {
      const v = (Number.isFinite(n) && n > 0) ? Math.min(Math.round(n), 99) : 0;
      try { localStorage.setItem(PINS_AUTO_KEY, String(v)); } catch (e) { /* 配额问题不该拦住主流程 */ }
      const inp = document.getElementById('pinsAutoIntervalInput');
      if (inp && String(inp.value) !== String(v)) inp.value = String(v);
      return v;
    }

    function setPinsBusy(busy) {
      const btn = document.getElementById('extractPinsBtn');
      const icon = document.getElementById('extractPinsIcon');
      const text = document.getElementById('extractPinsText');
      if (btn) btn.disabled = busy;
      if (icon) icon.className = busy ? 'inline-block animate-spin' : 'inline-block';
      if (text) text.textContent = busy ? '提炼中...' : '让 AI 提炼锚点';
    }

    // 提炼时回看的那一段最近剧情（只取正文，不带角色前缀）
    function buildRecentStoryForPins() {
      const history = AppState.narrativeHistory || [];
      const start = Math.max(0, history.length - PINS_STORY_ENTRIES);
      return history.slice(start)
        .map(m => (m.text || '').trim())
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 12000);
    }

    // 把模型返回的整段文本洗成纯条目：剥掉代码块与标题，限长
    function cleanPinsText(raw) {
      let t = String(raw == null ? '' : raw).trim();
      t = t.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '');
      t = t.replace(/^\s*【?长线记忆锚点】?\s*$/gm, '');
      t = t.replace(/^\s*(长线记忆锚点|锚点)\s*[:：]\s*$/gm, '');
      return t.trim().slice(0, PINS_MAX_CHARS);
    }

    const PINS_SYSTEM_PROMPT = [
      '你是语境口语引擎的长线记忆管理员，负责维护一份跨回合持久化的「长线记忆锚点」，供后续场景与 AI 导师随时引用。',
      '要求：',
      '1. 只保留跨回合仍然重要的两类核心信息：',
      '   · 【学习记忆】：学习者暴露出的高频语法/语用薄弱点、发音与句式习惯、已在词汇迷宫中成功激活掌握的地道表达、当前 CEFR 目标进展。',
      '   · 【故事记忆】：关键剧情拐点、NPC 关系与立场变化、未兑现的承诺与关键抉择。',
      '2. 不要收录每回合都在变的临时数值（当前状态条、当前小地点、临时 buff）。',
      '3. 必须合并现有锚点里仍然有效的内容；已完全掌握的旧纠错点或已了结的支线可以精简。',
      '4. 每条一行，以「- 」开头，简明扼要。',
      `5. 总长度不超过 ${PINS_MAX_CHARS} 字。`,
      '6. 只输出条目本身：不要开场白、不要总结、不要代码块、不要标题。'
    ].join('\n');

    async function extractMemoryPins(auto = false) {
      if (isExtractingPins) return false;

      if (!hasApiCredential()) {
        if (!auto) {
          showToast('请先配置 API Key 才能让 AI 提炼锚点', 'error');
          const b = document.getElementById('openApiSettingsBtn');
          if (b) b.click();
        }
        return false;
      }

      const world = (AppState.lore.world || '').trim();
      const story = buildRecentStoryForPins();
      if (!world && !story) {
        if (!auto) showToast('还没有世界观或剧情可供提炼', 'info');
        return false;
      }

      isExtractingPins = true;
      setPinsBusy(true);
      try {
        // 指令放 system（固定不变），用户消息里把"一局之内不变"的世界观放在最前面，
        // 这样前缀缓存仍然能覆盖住最长的那一段。
        const userText = [
          '【世界观设定】',
          world ? world.slice(0, LORE_PROMPT_LIMIT) : '（未填写）',
          '',
          '【前情提要】',
          AppState.contextSummary || '（无）',
          '',
          '【最近的剧情】',
          story || '（尚无剧情）',
          '',
          '【现有锚点】（仍然有效的必须保留，已了结的可以删掉）',
          (AppState.lore.memoryPins || '').trim() || '（空）'
        ].join('\n');

        const raw = await callLlmApi([{ role: 'user', text: userText }], PINS_SYSTEM_PROMPT);
        const pins = cleanPinsText(raw);

        if (!pins) {
          showToast('AI 没有返回可用的锚点，已保留原有内容', 'error');
          return false;
        }

        // 写回文本框与状态；不依赖用户再点一次「保存全部设定」
        document.getElementById('memoryPinsInput').value = pins;
        AppState.lore.memoryPins = pins;
        saveCurrentSlotToStorage();
        updateRailIndicator();
        showToast(auto ? '已自动刷新长线记忆锚点' : '已提炼长线记忆锚点', 'success');
        return true;
      } catch (e) {
        // 自动刷新失败不该打扰正在游玩的人，只留控制台痕迹
        if (auto) console.warn('[奇点] 自动刷新记忆锚点失败:', e);
        else showToast('提炼锚点失败: ' + (e && e.message ? e.message : e), 'error');
        return false;
      } finally {
        isExtractingPins = false;
        setPinsBusy(false);
      }
    }

    // 每回合结束后调用：到了间隔倍数就自动刷新一次
    function maybeAutoUpdateMemoryPins() {
      const n = getPinsAutoInterval();
      if (n <= 0 || isExtractingPins) return;
      const turns = (AppState.narrativeHistory || []).filter(m => m && m.role === 'user').length;
      if (turns === 0 || turns % n !== 0) return;
      extractMemoryPins(true);
    }

    let storageWarned = false;
    let renderedNarrativeCount = 0;

    function saveCurrentSlotToStorage() {
      const sId = AppState.currentSlotId;
      try {
        localStorage.setItem('chronicle_active_slot_id', sId);
        localStorage.setItem('chronicle_user_slots', JSON.stringify(AppState.slots));
        localStorage.setItem(getSlotStorageKey(sId, 'lore'), JSON.stringify(AppState.lore));
        localStorage.setItem(getSlotStorageKey(sId, 'story'), JSON.stringify(AppState.narrativeHistory));
        localStorage.setItem(getSlotStorageKey(sId, 'hud'), JSON.stringify(AppState.hudState));
        localStorage.setItem(getSlotStorageKey(sId, 'wizard_cfg'), JSON.stringify(AppState.wizardConfig));
        localStorage.setItem(getSlotStorageKey(sId, 'schema'), JSON.stringify(AppState.worldSchema));
        localStorage.setItem(getSlotStorageKey(sId, 'ctx'), JSON.stringify({
          summary: AppState.contextSummary,
          summarizedUpTo: AppState.summarizedUpTo,
          config: AppState.contextConfig
        }));

        localStorage.setItem('chronicle_api_config', JSON.stringify(apiConfigSnapshot()));
        syncApiKeyToSecureStore();
        localStorage.setItem('chronicle_theme_tone', AppState.themeTone);
        localStorage.setItem('chronicle_highlight_config', JSON.stringify(AppState.highlightConfig));
        localStorage.setItem('chronicle_sound_config', JSON.stringify(AppState.soundConfig));
        localStorage.setItem('chronicle_privacy_shield', JSON.stringify(AppState.privacyShield));
        storageWarned = false;
        return true;
      } catch (e) {
        // 这里以前是空的 catch：一旦超出 localStorage 配额，存档会静默失效，玩家毫无察觉
        console.error('[奇点] 存档写入失败:', e);
        if (!storageWarned) {
          storageWarned = true;
          const isQuota = !!e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
          showToast(isQuota
            ? '存档空间已满，本回合未能保存！请先导出战报，再重置本局或删除不用的世界。'
            : `存档写入失败：${(e && e.message) || e}`, 'error');
        }
        return false;
      }
    }

    function loadSlotState(slotId) {
      AppState.currentSlotId = slotId;
      const sId = slotId;
      try {
        localStorage.setItem('chronicle_active_slot_id', sId);
        const savedLore = localStorage.getItem(getSlotStorageKey(sId, 'lore'));
        AppState.lore = savedLore ? JSON.parse(savedLore) : { world: '', character: '', rules: '', memoryPins: '' };

        document.getElementById('worldLoreInput').value = AppState.lore.world || '';
        document.getElementById('characterLoreInput').value = AppState.lore.character || '';
        document.getElementById('rulesInput').value = AppState.lore.rules || '';
        document.getElementById('memoryPinsInput').value = AppState.lore.memoryPins || '';

        const savedWizardCfg = localStorage.getItem(getSlotStorageKey(sId, 'wizard_cfg'));
        AppState.wizardConfig = savedWizardCfg
          ? Object.assign(defaultWizardConfig(), JSON.parse(savedWizardCfg))
          : defaultWizardConfig();

        const savedStory = localStorage.getItem(getSlotStorageKey(sId, 'story'));
        AppState.narrativeHistory = savedStory ? JSON.parse(savedStory) : [];

        // 世界蓝图按世界独立存储；老存档没有该键 → 用默认蓝图（等价于原界面）
        const savedSchema = localStorage.getItem(getSlotStorageKey(sId, 'schema'));
        AppState.worldSchema = savedSchema ? normalizeWorldSchema(JSON.parse(savedSchema)) : defaultWorldSchema();

        // 上下文摘要与窗口配置也按世界独立存储
        const savedCtx = localStorage.getItem(getSlotStorageKey(sId, 'ctx'));
        if (savedCtx) {
          const ctx = JSON.parse(savedCtx);
          AppState.contextSummary = typeof ctx.summary === 'string' ? ctx.summary : '';
          AppState.summarizedUpTo = Number(ctx.summarizedUpTo) || 0;
          AppState.contextConfig = Object.assign(defaultContextConfig(), ctx.config || {});
        } else {
          AppState.contextSummary = '';
          AppState.summarizedUpTo = 0;
          AppState.contextConfig = defaultContextConfig();
        }

        const savedHud = localStorage.getItem(getSlotStorageKey(sId, 'hud'));
        AppState.hudState = savedHud
          ? Object.assign(defaultHudState(), JSON.parse(savedHud))
          : defaultHudState();
      } catch (e) {
        console.error('[奇点] 读取存档失败，已回退到默认状态:', e);
        resetHudDefaults();
        showToast('存档数据损坏，已载入默认状态。原数据仍保留在本地，可导出排查。', 'error');
      }

      const activeSlot = AppState.slots.find(s => s.id === sId) || AppState.slots[0];
      const headerDisplay = document.getElementById('headerSlotNameDisplay');
      if (headerDisplay) headerDisplay.textContent = activeSlot.name;

      renderedNarrativeCount = 0;
      renderAllNarratives();
      buildHudFromSchema();
      renderHud();
      renderContextPanel();
      updateRailIndicator();
      syncWizardOptionsAndChips();
    }

    function resetHudDefaults() {
      AppState.hudState = defaultHudState();
    }

    function updateRailIndicator() {
      const hasLore = !!((AppState.lore.world && AppState.lore.world.trim()) ||
                         (AppState.lore.character && AppState.lore.character.trim()) ||
                         (AppState.lore.memoryPins && AppState.lore.memoryPins.trim()));
      const ind = document.getElementById('railWorldIndicator');
      if (ind) {
        ind.className = hasLore ? 'w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50 my-2 transition' : 'w-2 h-2 rounded-full bg-slate-700 my-2 transition';
      }
    }

    function showToast(message, type = 'info') {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      const colors = {
        info: 'border-purple-700 bg-slate-900 text-purple-200',
        error: 'border-red-700 bg-red-950 text-red-200',
        success: 'border-emerald-700 bg-emerald-950 text-emerald-200'
      };
      toast.className = `px-3.5 py-2 rounded-lg border shadow-xl text-xs flex items-center gap-2 pointer-events-auto transition transform duration-300 translate-y-2 opacity-0 ${colors[type] || colors.info}`;
      // 用 textContent 而非 innerHTML：提示文案里含用户输入的世界名等不可信内容
      const msgSpan = document.createElement('span');
      msgSpan.textContent = message;
      toast.appendChild(msgSpan);
      container.appendChild(toast);
      requestAnimationFrame(() => toast.classList.remove('translate-y-2', 'opacity-0'));
      setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-x-4');
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }

    let currentPointBuyAlloc = {};
    let wizD6Bonus = 1;
    let wizDiceValue = 3;

    // 蓝图里的创建配置（没有就回落到默认）
    function getCreationConfig() {
      const c = getWorldSchema().creation;
      return (c && Array.isArray(c.rows) && c.rows.length) ? c : defaultCreationConfig();
    }

    function creationFields() {
      const out = [];
      (getCreationConfig().rows || []).forEach(row => (row.fields || []).forEach(f => out.push(f)));
      return out;
    }

    function findCreationField(key) {
      return creationFields().find(f => f.key === key) || null;
    }

    function renderChipsInto(container, input, list) {
      if (!container || !input) return;
      container.innerHTML = '';
      (list || []).forEach(item => {
        const chip = document.createElement('button');
        chip.type = 'button';
        const isSelected = input.value.trim() === item;
        chip.className = `px-2 py-0.5 rounded text-[10px] transition border select-none ${
          isSelected
            ? 'bg-purple-600 border-purple-400 text-white font-semibold shadow-sm'
            : 'bg-slate-900/90 hover:bg-slate-800 text-slate-300 border-slate-800 hover:border-purple-700/60'
        }`;
        chip.textContent = item;
        chip.onclick = () => {
          input.value = item;
          renderChipsInto(container, input, list);
        };
        container.appendChild(chip);
      });
    }

    function buildCreationField(f) {
      const wrap = document.createElement('div');
      if (f.span === 2) wrap.className = 'col-span-2';
      else if (f.span === 3) wrap.className = 'col-span-3';

      const label = document.createElement('label');
      label.className = 'block font-medium text-slate-300 mb-1';
      label.textContent = f.label + (f.required ? ' *' : '');
      wrap.appendChild(label);

      const common = 'w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-purple-500';
      let el;
      if (f.type === 'select') {
        el = document.createElement('select');
        el.className = common;
        (f.options || []).forEach(o => {
          const opt = document.createElement('option');
          opt.value = String(o);
          opt.textContent = String(o);
          el.appendChild(opt);
        });
      } else if (f.type === 'textarea') {
        el = document.createElement('textarea');
        el.className = common;
        el.rows = Number(f.rows) || 2;
        if (f.placeholder) el.placeholder = f.placeholder;
      } else {
        el = document.createElement('input');
        el.type = f.type === 'number' ? 'number' : 'text';
        el.className = common;
        if (f.placeholder) el.placeholder = f.placeholder;
        if (f.value !== undefined) el.value = f.value;
      }
      el.dataset.ref = f.key;
      wrap.appendChild(el);

      if (f.type === 'chips') {
        const chips = document.createElement('div');
        chips.className = 'flex flex-wrap gap-1 mt-1.5 max-h-20 overflow-y-auto';
        chips.dataset.chipsFor = f.key;
        wrap.appendChild(chips);

        const list = AppState.wizardConfig[f.source] || [];
        if (!el.value && list.length) el.value = list[0];
        el.oninput = () => renderChipsInto(chips, el, AppState.wizardConfig[f.source] || []);
        renderChipsInto(chips, el, list);
      }
      return wrap;
    }

    // 依蓝图生成整个角色创建表单
    function renderWizardFromSchema() {
      const box = document.getElementById('wizardFields');
      if (!box) return;
      const cfg = getCreationConfig();

      box.innerHTML = '';
      (cfg.rows || []).forEach(row => {
        const rowEl = document.createElement('div');
        rowEl.className = `grid ${row.cols || 'grid-cols-1 sm:grid-cols-3'} gap-2`;
        (row.fields || []).forEach(f => rowEl.appendChild(buildCreationField(f)));
        box.appendChild(rowEl);
      });

      // 属性分配器
      const hasAttrs = (AppState.wizardConfig.attributes || []).length > 0;
      const pb = document.getElementById('wizardPointBuy');
      if (pb) pb.classList.toggle('hidden', !hasAttrs);

      // 投骰区
      const diceBox = document.getElementById('wizardDice');
      const dice = cfg.dice;
      if (diceBox) diceBox.classList.toggle('hidden', !dice);
      if (dice && diceBox) {
        const lbl = document.getElementById('wizDiceLabel');
        if (lbl) lbl.textContent = dice.label || '随机投骰';
        const rl = document.getElementById('wizDiceResultLabel');
        if (rl) rl.textContent = (dice.key || '结果') + '值';
        const btn = diceBox.querySelector('[data-action="roll-charisma"]');
        if (btn) btn.textContent = `🎲 掷骰 D${Number(dice.sides) || 6}`;
      }

      if (hasAttrs) initWizardAllocators();
      if (dice) rollWizardD6Charisma(true);
    }

    function syncWizardOptionsAndChips() {
      const cfg = AppState.wizardConfig;
      syncWizardRuleInputs(cfg);

      const box = document.getElementById('wizardFields');
      if (!box) return;

      box.querySelectorAll('[data-chips-for]').forEach(container => {
        const key = container.dataset.chipsFor;
        const field = findCreationField(key);
        const input = box.querySelector(`[data-ref="${key}"]`);
        if (!field || !input) return;
        const list = cfg[field.source] || [];
        if (!input.value && list.length) input.value = list[0];
        renderChipsInto(container, input, list);
      });
    }

    function syncWizardRuleInputs(cfg) {
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      set('cfgRacesInput', (cfg.races || []).join('，'));
      set('cfgClassesInput', (cfg.classes || []).join('，'));
      set('cfgIdentitiesInput', (cfg.identities || []).join('，'));
      set('cfgAttributesInput', (cfg.attributes || []).join('，'));
      set('cfgPointsPoolInput', cfg.pointBudget || 25);
      set('cfgMaxPerStatInput', cfg.maxPerStat || 8);
    }


    function initWizardAllocators() {
      syncWizardOptionsAndChips();
      const grid = document.getElementById('pointBuyGrid');
      if (!grid) return;
      grid.innerHTML = '';

      const attrs = AppState.wizardConfig.attributes || ['力量', '敏捷', '体质', '智力', '感知'];
      const budget = AppState.wizardConfig.pointBudget || 25;
      const maxPerStat = AppState.wizardConfig.maxPerStat || 8;

      const titleEl = document.getElementById('pointBuyTitle');
      if (titleEl) titleEl.textContent = `属性分配器 (总额 ${budget} 点，单项上限 ${maxPerStat})`;
      const limitEl = document.getElementById('wizTotalPointsLimit');
      if (limitEl) limitEl.textContent = budget;

      const baseVal = Math.max(1, Math.floor(budget / (attrs.length || 1)));
      currentPointBuyAlloc = {};

      attrs.forEach(attr => {
        currentPointBuyAlloc[attr] = Math.min(maxPerStat, baseVal);
      });

      attrs.forEach((k, idx) => {
        const div = document.createElement('div');
        div.className = 'p-2 rounded-lg bg-slate-900/80 border border-slate-800 flex flex-col items-center justify-between text-center';

        const labelEl = document.createElement('span');
        labelEl.className = 'text-[11px] font-medium text-slate-300 truncate w-full';
        labelEl.textContent = k;

        const valEl = document.createElement('div');
        valEl.className = 'font-mono text-base font-bold text-slate-100 my-1';
        valEl.dataset.statValue = '';
        valEl.dataset.statIndex = String(idx);
        valEl.textContent = currentPointBuyAlloc[k];

        const ctrlEl = document.createElement('div');
        ctrlEl.className = 'flex items-center gap-1';
        [['-', -1], ['+', 1]].forEach(pair => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono font-bold';
          btn.dataset.statIndex = String(idx);
          btn.dataset.statDelta = String(pair[1]);
          btn.textContent = pair[0];
          ctrlEl.appendChild(btn);
        });

        div.append(labelEl, valEl, ctrlEl);
        grid.appendChild(div);
      });

      // 事件委托：属性名来自 LLM 解析结果，绝不拼进 onclick 字符串
      grid.onclick = (e) => {
        const btn = e.target.closest('button[data-stat-delta]');
        if (!btn) return;
        const idx = parseInt(btn.dataset.statIndex, 10);
        const delta = parseInt(btn.dataset.statDelta, 10);
        const attrName = (AppState.wizardConfig.attributes || [])[idx];
        if (attrName) adjustWizStat(attrName, delta);
      };

      updateWizPointsDisplay();
    }

    function adjustWizStat(stat, delta) {
      const cur = currentPointBuyAlloc[stat] || 0;
      const budget = AppState.wizardConfig.pointBudget || 25;
      const maxPerStat = AppState.wizardConfig.maxPerStat || 8;
      const sum = Object.values(currentPointBuyAlloc).reduce((a, b) => a + b, 0);
      const remaining = budget - sum;

      if (delta > 0) {
        if (remaining <= 0) { showToast(`可用点数已分配完毕 (${budget}点)`, 'info'); return; }
        if (cur >= maxPerStat) { showToast(`单项属性初始上限为 ${maxPerStat} 点`, 'info'); return; }
        currentPointBuyAlloc[stat] = cur + 1;
      } else {
        if (cur <= 1) return;
        currentPointBuyAlloc[stat] = cur - 1;
      }
      const idx = (AppState.wizardConfig.attributes || []).indexOf(stat);
      const el = idx >= 0 ? document.querySelector(`#pointBuyGrid [data-stat-value][data-stat-index="${idx}"]`) : null;
      if (el) el.textContent = currentPointBuyAlloc[stat];
      updateWizPointsDisplay();
    }

    function updateWizPointsDisplay() {
      const budget = AppState.wizardConfig.pointBudget || 25;
      const sum = Object.values(currentPointBuyAlloc).reduce((a, b) => a + b, 0);
      const remaining = budget - sum;
      const el = document.getElementById('wizRemainingPoints');
      if (el) {
        el.textContent = remaining;
        el.className = remaining < 0 ? 'text-rose-400 font-bold' : (remaining === 0 ? 'text-emerald-400 font-bold' : 'text-purple-300 font-bold');
      }
    }

    // 投骰规则（骰面、基数、映射表）全部来自蓝图
    function rollWizardD6Charisma(silent) {
      const dice = getCreationConfig().dice || { sides: 6, base: 2, map: { 1: -1, 2: 0, 3: 1, 4: 1, 5: 2, 6: 3 } };
      const sides = Math.max(2, Number(dice.sides) || 6);
      const base = Number(dice.base) || 0;
      const map = dice.map || {};

      if (!silent) sounds.playDiceRoll();
      const raw = Math.floor(Math.random() * sides) + 1;
      const bonus = map[raw] !== undefined ? Number(map[raw]) : 0;
      wizD6Bonus = bonus;
      wizDiceValue = Math.max(1, base + bonus);

      const chaEl = document.getElementById('wizFinalCha');
      if (chaEl) chaEl.textContent = wizDiceValue;
      const formulaEl = document.getElementById('wizChaFormulaDisplay');
      if (formulaEl) {
        formulaEl.textContent = silent
          ? `公式：基数 ${base} + D${sides}投骰波动`
          : `公式：基数 ${base} + D${sides}骰点(${raw} => ${bonus >= 0 ? '+' : ''}${bonus})`;
      }
    }

    // 世界观文本送进大模型的单次上限。
    // 以前这里是两个不同的魔法数字：分析世界观 30000、生成蓝图 12000，
    // 而且生成蓝图那条**静默截断、连提示都没有** —— 长设定会莫名其妙只生效一半。
    // 现在统一成一个常量，两处都超限都会提示。
    const LORE_PROMPT_LIMIT = 65000;

    async function analyzeWorldLoreWithApi(rawText, silent = false) {
      if (!rawText || !rawText.trim()) {
        if (!silent) showToast('请先输入或导入世界观设定文本', 'info');
        return;
      }

      if (!hasApiCredential()) {
        if (!silent) {
          showToast('请先在顶部【API 设置】中配置 API Key，方可调用大模型智能分析', 'error');
          document.getElementById('openApiSettingsBtn')?.click();
        }
        return;
      }

      const btn1 = document.getElementById('analyzeLoreBtn');
      const icon1 = document.getElementById('analyzeLoreIcon');
      const text1 = document.getElementById('analyzeLoreText');
      const icon2 = document.getElementById('autoExtractIcon');
      const text2 = document.getElementById('autoExtractText');

      if (btn1) btn1.disabled = true;
      if (icon1) icon1.className = 'inline-block animate-spin';
      if (text1) text1.textContent = '大模型正在分析世界法则体系...';
      if (icon2) icon2.className = 'inline-block animate-spin';
      if (text2) text2.textContent = 'API 分析中...';

      // 超出上限时必须提示：以前是硬截断到 14000 字且完全不告知，长设定被无声吞掉
      const loreTruncated = rawText.length > LORE_PROMPT_LIMIT;
      const loreForAnalysis = rawText.slice(0, LORE_PROMPT_LIMIT);
      if (loreTruncated && !silent) {
        showToast(`设定共 ${rawText.length} 字，超出单次分析上限，本次仅分析前 ${LORE_PROMPT_LIMIT} 字`, 'info');
      }

      const promptText = `你是一名专业的互动故事世界与英语口语课程架构师。请阅读以下世界观/场景设定文本，提取适合该世界的学习者角色创建预设与核心能力维度。
必须严格输出且仅输出一个合法的 JSON 对象，不要输出任何额外的问候或解释：

\`\`\`json
{
  "races": ["可选文化背景/母语背景1", "可选背景2"],
  "classes": ["可选职场/社交角色定位1", "可选角色定位2"],
  "identities": ["可选英语水平(CEFR)与目标1", "可选目标2"],
  "attributes": ["核心能力维度1", "核心能力维度2"],
  "pointBudget": 25,
  "maxPerStat": 8
}
\`\`\`

提取规范要求：
1. races：提取可选的文化背景、国籍出身或种族列表（至少 4~8 个，如口语场景的「双语创业者」「国际交换生」「数字游民」或故事世界的种族）。
2. classes：提取主要职业定位、沟通风格或专长流派（至少 4~8 个，如「Product Manager」「AI Engineer」「商务谈判者」等）。
3. identities：提取可选英语水平（CEFR B1/B2/C1）或当前场景身份目标（至少 3~6 个）。
4. attributes：提取最契合该世界的 4~6 项核心能力属性名称（如英语口语学习的「流利度」「词汇量」「语法准确」「语用得体」「逻辑说服」或故事对应属性）。
5. pointBudget：初始分配点数总额（默认 25）。
6. maxPerStat：单项初始上限（默认 8 或 10）。

【世界观设定文本】：
${loreForAnalysis}`;

      try {
        const promptHistory = [{ role: 'user', text: promptText }];
        const responseText = await callLlmApi(promptHistory);

        let parsedJson = null;
        const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (codeBlockMatch) {
          try { parsedJson = JSON.parse(codeBlockMatch[1].trim()); } catch (e) {}
        }
        if (!parsedJson) {
          const directMatch = responseText.match(/\{[\s\S]*\}/);
          if (directMatch) {
            try { parsedJson = JSON.parse(directMatch[0]); } catch (e) {}
          }
        }

        if (parsedJson && (parsedJson.races || parsedJson.classes || parsedJson.attributes)) {
          if (Array.isArray(parsedJson.races) && parsedJson.races.length > 0) {
            AppState.wizardConfig.races = parsedJson.races.map(s => String(s).trim()).filter(Boolean);
          }
          if (Array.isArray(parsedJson.classes) && parsedJson.classes.length > 0) {
            AppState.wizardConfig.classes = parsedJson.classes.map(s => String(s).trim()).filter(Boolean);
          }
          if (Array.isArray(parsedJson.identities) && parsedJson.identities.length > 0) {
            AppState.wizardConfig.identities = parsedJson.identities.map(s => String(s).trim()).filter(Boolean);
          }
          if (Array.isArray(parsedJson.attributes) && parsedJson.attributes.length >= 3) {
            AppState.wizardConfig.attributes = parsedJson.attributes.map(s => String(s).trim()).filter(Boolean);
          }
          if (typeof parsedJson.pointBudget === 'number' && parsedJson.pointBudget > 0) {
            AppState.wizardConfig.pointBudget = parsedJson.pointBudget;
          }
          if (typeof parsedJson.maxPerStat === 'number' && parsedJson.maxPerStat > 0) {
            AppState.wizardConfig.maxPerStat = parsedJson.maxPerStat;
          }

          syncWizardOptionsAndChips();
          initWizardAllocators();
          saveCurrentSlotToStorage();

          if (!silent) {
            showToast(`API 识别成功：已动态装载 ${AppState.wizardConfig.races.length}种族、${AppState.wizardConfig.classes.length}职业、${AppState.wizardConfig.attributes.length}维属性`, 'success');
          }
          return;
        }
        throw new Error('未能从模型返回内容中解析到有效规范的 JSON');
      } catch (err) {
        console.warn('API 分析提取失败:', err);
        if (!silent) {
          showToast(`API 分析未完成（${err.message}），请检查 API Key 或重试`, 'error');
        }
      } finally {
        if (btn1) btn1.disabled = false;
        if (icon1) icon1.className = '';
        if (text1) text1.textContent = '通过 API 智能分析世界观并更新创建规则';
        if (icon2) icon2.className = '';
        if (text2) text2.textContent = '调用 API 自动从当前世界设定提取';
      }
    }

    // 角色卡文本：字段名与派生数值行都按蓝图生成
    function buildCharacterCardText(cfg, values, attrObj, bars) {
      const allFields = (cfg.rows || []).flatMap(r => r.fields || []);
      const nameField = allFields.find(f => f.key === 'name');
      const appField = allFields.find(f => f.type === 'textarea') || allFields.find(f => f.key === 'appearance');
      const name = values.name || '无名旅者';

      const inline = allFields
        .filter(f => f !== appField)
        .map(f => `${f.cardLabel || f.label}：${values[f.key] || '—'}`)
        .join(' / ');

      const lines = [
        `【角色卡—${name}】`,
        inline,
        `外貌：${(appField ? values[appField.key] : '') || '旅行装束，神色专注'}`,
        `属性：${Object.entries(attrObj).map(([k, v]) => `${k}：${v.current}`).join(' / ')}`
      ];
      if (bars.length) {
        lines.push(bars.map((b, i) => {
          const d = (cfg.derived || [])[i] || {};
          return `${d.cardLabel || b.label}：${b.current}`;
        }).join(' / '));
      }
      return lines.join('\n').trim();
    }

    function completeCharacterCreation() {
      const cfg = getCreationConfig();
      const box = document.getElementById('wizardFields');

      // 按蓝图字段收集输入（不再写死姓名/种族/职业…）
      const values = {};
      (cfg.rows || []).forEach(row => (row.fields || []).forEach(f => {
        const el = box ? box.querySelector(`[data-ref="${f.key}"]`) : null;
        const raw = el ? String(el.value || '').trim() : '';
        values[f.key] = raw || (f.required ? '无名旅者' : '—');
      }));

      AppState.hudState.character_profile = Object.assign(
        { name: '', gender: '', age: '', race: '', class: '', identity: '', appearance: '' },
        values
      );

      // 属性：点购结果 + 投骰结果
      const attrObj = {};
      Object.keys(currentPointBuyAlloc).forEach(k => {
        attrObj[k] = { current: currentPointBuyAlloc[k], max: AppState.hudState.attribute_cap || 20 };
      });
      const diceKey = cfg.dice && cfg.dice.key;
      if (diceKey && !attrObj[diceKey]) {
        attrObj[diceKey] = { current: wizDiceValue, max: AppState.hudState.attribute_cap || 20 };
      }
      AppState.hudState.attributes = attrObj;

      // 初始数值由蓝图的公式派生（安全求值，不用 eval）
      const vars = {};
      Object.keys(currentPointBuyAlloc).forEach(k => { vars[k] = currentPointBuyAlloc[k]; });
      if (diceKey) vars[diceKey] = wizDiceValue;

      const bars = (cfg.derived || []).map(d => {
        const v = Math.max(0, Math.round(evalFormula(d.formula, vars)));
        return { label: d.label, current: v, max: v, color: d.tone || 'violet' };
      });
      if (bars.length) AppState.hudState.bars = bars;

      const cardMd = buildCharacterCardText(cfg, values, attrObj, bars);
      document.getElementById('characterLoreInput').value = cardMd;
      AppState.lore.character = cardMd;

      document.getElementById('wizardModal').classList.add('hidden');
      renderHud();
      saveCurrentSlotToStorage();

      const summary = [values.race, values.class].filter(v => v && v !== '—').join(' / ');
      const input = document.getElementById('playerInput');
      input.value = `开始创建角色：我已确认角色卡【${values.name}】${summary ? '（' + summary + '）' : ''}，正式踏入世界。`;
      showToast('角色卡创建完成！', 'success');
    }

    // 兼容路径（正文里不再要求输出角色卡区块，数值一律走 game_state.character_profile /
    // bars）。老存档、老模型、以及用户自己写进【玩家角色档案】的角色卡文本仍可能带这些行，
    // 所以解析留着；game_state 在它之后应用，因此结构化数据总是赢。
    function parseCharacterCardFromText(narrativeText) {
      if (!narrativeText) return;
      const cardMatch = narrativeText.match(/【角色卡[—\-](.*?)】([\s\S]*?)(?=(?:【|$|\n\n\n))/i);
      if (!cardMatch) return;

      const block = cardMatch[0];
      const name = cardMatch[1].trim();
      if (name) AppState.hudState.character_profile.name = name;

      const extractField = (regex) => {
        const m = block.match(regex);
        return m ? m[1].trim() : null;
      };

      const race = extractField(/种族[：:]\s*([^\s\/、,[\]\n]+)/);
      if (race) AppState.hudState.character_profile.race = race;

      const charClass = extractField(/职业[：:]\s*([^\s\/、,[\]\n]+)/);
      if (charClass) AppState.hudState.character_profile.class = charClass;

      const identity = extractField(/身份[：:]\s*([^\s\/、,[\]\n]+)/);
      if (identity) AppState.hudState.character_profile.identity = identity;

      const gender = extractField(/性别[：:]\s*([^\s\/、,[\]\n]+)/);
      if (gender) AppState.hudState.character_profile.gender = gender;

      const age = extractField(/年龄[：:]\s*(\d+)/);
      if (age) AppState.hudState.character_profile.age = age;

      const appearance = extractField(/外貌[：:]\s*([^\n]+(?:\n[^\n]+)?)/);
      if (appearance) AppState.hudState.character_profile.appearance = appearance;

      const hpMatch = block.match(/HP[：:]\s*(\d+)(?:\/(\d+))?/i);
      const mpMatch = block.match(/MP[：:]\s*(\d+)(?:\/(\d+))?/i);
      if (hpMatch) {
        const cur = parseInt(hpMatch[1], 10);
        const max = hpMatch[2] ? parseInt(hpMatch[2], 10) : cur;
        let bar = (AppState.hudState.bars || []).find(b => b.label.includes('HP') || b.label.includes('生命'));
        if (bar) { bar.current = cur; bar.max = max; }
        else { AppState.hudState.bars.push({ label: '生命 (HP)', current: cur, max, color: 'rose' }); }
      }
      if (mpMatch) {
        const cur = parseInt(mpMatch[1], 10);
        const max = mpMatch[2] ? parseInt(mpMatch[2], 10) : cur;
        let bar = (AppState.hudState.bars || []).find(b => b.label.includes('MP') || b.label.includes('法力') || b.label.includes('能量'));
        if (bar) { bar.current = cur; bar.max = max; }
        else { AppState.hudState.bars.push({ label: '能量 (MP)', current: cur, max, color: 'cyan' }); }
      }
    }

    // 兼容路径（正文里不再要求「情感状态列表」，NPC 关系数值现在由 game_state.npc_codex
    // 直接提供，见 applyGameState / buildNpcCodexExample）。留着它是为了老存档与老模型：
    // 它们仍按旧契约在正文里写列表时，右栏四维照样能更新。
    function parseNpcEmotionsFromText(rawText) {
      if (!rawText) return;
      const dims = getNpcDimensions();

      // 依蓝图动态拼出解析正则：维度数量与名称都来自蓝图，而非写死 4 个
      const parts = dims.map(d =>
        `${escapeRegExp(d.label)}[：:]\\s*(\\d+)(?:[（(]变动[：:]\\s*([+\\-]?\\d+)[）)])?`
      );
      const listRegex = new RegExp(`【([^】]+)】\\s*` + parts.join('\\s*'), 'g');

      let match;
      while ((match = listRegex.exec(rawText)) !== null) {
        const name = match[1].trim();
        const values = {};
        dims.forEach((d, i) => {
          const v = match[2 + i * 2];
          const dv = match[3 + i * 2];
          values[d.key] = v === undefined ? 0 : parseInt(v, 10);
          values[d.deltaKey || (d.key + 'Delta')] = dv ? parseInt(dv, 10) : 0;
        });

        let existing = AppState.hudState.npc_codex.find(n => n.name === name);
        if (!existing) {
          existing = {
            name: name,
            race: '未知',
            personality: '尚未深入了解',
            love_type: '待定',
            intimacy: null
          };
          AppState.hudState.npc_codex.push(existing);
        }
        Object.assign(existing, values);
      }
    }

    // NPC 卡片的展开状态。
    // 关键点：renderHud() 每回合都会把 section 整段重建，展开状态放在 DOM 上会被立刻抹掉，
    // 所以按「section id + NPC 名」记在模块级 Set 里，重建后按它还原。
    const expandedNpcKeys = new Set();

    function npcExpandKey(sec, name) {
      return ((sec && sec.id) || 'codex') + '::' + String(name == null ? '' : name);
    }

    function renderNpcCodex(el, sec) {
      el.__sec = sec;
      const container = q(el, 'body');
      const badge = q(el, 'badge');
      if (!container) return;

      const list = AppState.hudState[(sec && sec.source) || 'npc_codex'] || [];
      if (badge) badge.textContent = `${list.length} 人`;

      if (list.length === 0) {
        const emptyText = (sec && sec.emptyText) || '当前尚未结识任何 NPC。\n产生互动后将自动记录图鉴。';
        container.innerHTML = `
          <div class="text-[11px] text-slate-500 text-center py-6 bg-slate-950/40 rounded-lg border border-slate-800/60">
            ${escapeHtml(emptyText).replace(/\n/g, '<br>')}
          </div>
        `;
        return;
      }

      container.innerHTML = '';

      // 事件委托：NPC 名来自 LLM 输出，绝不拼进 onclick 字符串
      container.onclick = (e) => {
        // 两个"秘密查看"按钮优先，别被折叠开关吃掉
        const btn = e.target.closest('button[data-npc-name]');
        if (btn) {
          secretInspectNpc(btn.dataset.npcName, btn.dataset.npcMode);
          return;
        }
        const toggle = e.target.closest('[data-npc-toggle]');
        if (!toggle) return;
        const key = toggle.dataset.npcToggle;
        const card = toggle.closest('[data-npc-card]');
        const detail = card ? card.querySelector('[data-npc-detail]') : null;
        const open = !expandedNpcKeys.has(key);
        if (open) expandedNpcKeys.add(key); else expandedNpcKeys.delete(key);
        // 就地改 DOM，不重渲染：避免闪一下，也省掉整段重建
        if (detail) detail.classList.toggle('hidden', !open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        const chev = toggle.querySelector('[data-npc-chevron]');
        if (chev) chev.textContent = open ? '▾' : '▸';
      };

      list.forEach((npc, idx) => {
        const card = document.createElement('div');
        card.className = 'p-3 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2.5 shadow-md';
        card.setAttribute('data-npc-card', '');
        const formatDelta = (d) => {
          if (d > 0) return `<span class="text-emerald-400 font-mono font-bold">+${d}</span>`;
          if (d < 0) return `<span class="text-rose-400 font-mono font-bold">${d}</span>`;
          return `<span class="text-slate-500 font-mono">0</span>`;
        };

        const dims = getNpcDimensions(sec);
        const badgeKey = getNpcBadgeKey(sec);

        // 维度条按蓝图生成：数量、名称、上限、色调全部来自蓝图
        const dimBlocks = dims.map(d => {
          const val = Number(npc[d.key]) || 0;
          const max = Number(d.max) || 100;
          const pct = Math.min(100, (val / max) * 100);
          const grad = NPC_TONE_GRADIENT[d.tone] || NPC_TONE_GRADIENT.slate;
          const delta = npc[d.deltaKey || (d.key + 'Delta')];
          return `
            <div>
              <div class="flex justify-between text-slate-400 mb-0.5">
                <span>${escapeHtml(d.label)} (${val}/${max})</span>
                <div>变动: ${formatDelta(delta)}</div>
              </div>
              <div class="h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                <div class="h-full bg-gradient-to-r ${grad} rounded-full" style="width: ${pct}%"></div>
              </div>
            </div>`;
        }).join('');

        const key = npcExpandKey(sec, npc.name);
        // 蓝图开关决定这张卡片怎么折叠：
        //   items  → 逐项折叠（默认）：只显示名字，点开看数值
        //   section→ 逐项展开：折叠交给整个面板的标题去做
        //   none   → 逐项展开且不给开关
        const itemCollapsible = sectionCollapseOf(sec) === 'items';
        const open = itemCollapsible ? expandedNpcKeys.has(key) : true;

        // 名字必须完整显示：以前名字与"关系定位"徽章挤在同一行，徽章还是 shrink-0，
        // 模型把关系定位写长（"表面冷淡、内心其实非常在意"）时，名字就被 truncate 成省略号。
        // 现在名字独占标题行（可换行、不截断），两个按钮仍在右侧且不受折叠开关影响。
        const namePart = itemCollapsible
          ? `<button type="button" data-npc-toggle="${escapeHtml(key)}" aria-expanded="${open ? 'true' : 'false'}"
              class="flex-1 min-w-0 flex items-start gap-1.5 text-left hover:text-purple-200 transition"
              title="展开 / 收起该 NPC 的关系与情感">
              <span data-npc-chevron class="text-[10px] text-slate-500 w-3 shrink-0">${open ? '▾' : '▸'}</span>
              <span class="font-bold text-slate-100 text-xs break-words min-w-0">${escapeHtml(npc.name)}</span>
            </button>`
          : `<div class="flex-1 min-w-0 flex items-start gap-1.5">
              <span class="font-bold text-slate-100 text-xs break-words min-w-0">${escapeHtml(npc.name)}</span>
            </div>`;

        // 关系定位（也就是"介绍"）跟着数值一起折叠：它属于详情，
        // 不该常驻标题行去和名字抢宽度
        const badgeRow = `
            <div>
              <span class="inline-block px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 break-words">${escapeHtml(npc[badgeKey] || '待定')}</span>
            </div>`;

        // 静态信息行（默认蓝图里是种族 / 性格）：键、标签全部来自蓝图的 infoFields，
        // 渲染器不写死任何字段名。某个字段没有值就跳过那一格，全都没有则整行不出现。
        const infoCells = getNpcInfoFields(sec).map(f => {
          const raw = npc[f.key];
          const val = (raw == null ? '' : String(raw)).trim();
          if (!val) return '';
          return `<span>${escapeHtml(f.label)}：<span class="text-slate-200">${escapeHtml(val)}</span></span>`;
        }).filter(Boolean).join('');
        const infoRow = infoCells
          ? `<div class="flex flex-wrap gap-x-3 gap-y-0.5 text-slate-400">${infoCells}</div>`
          : '';

        const recentEvents = Array.isArray(npc.recent_events) ? npc.recent_events.slice(-3) : [];
        const eventsRow = recentEvents.length
          ? `<div class="pt-1 border-t border-slate-800/80 space-y-0.5">
              <div class="text-[9px] text-slate-500 font-mono">📜 互动关系轨迹：</div>
              ${recentEvents.map(ev => `<div class="text-[10px] text-slate-300 leading-snug">· ${escapeHtml(ev)}</div>`).join('')}
            </div>`
          : '';

        card.innerHTML = `
          <div class="flex items-start justify-between gap-2 border-b border-slate-800 pb-1.5">
            ${namePart}
            <div class="flex items-center gap-1 shrink-0">
              <button type="button" data-npc-name="${escapeHtml(npc.name)}" data-npc-mode="status" class="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]" title="查看该角色的背景与沟通风格">
                👁️ 面板
              </button>
              <button type="button" data-npc-name="${escapeHtml(npc.name)}" data-npc-mode="intimacy" class="px-1.5 py-0.5 rounded bg-purple-950/60 hover:bg-purple-900/80 text-purple-300 border border-purple-800/50 text-[10px]" title="向 AI Tutor 请求针对该角色的英语表达建议">
                💬 语伴提示
              </button>
            </div>
          </div>

          <div data-npc-detail class="space-y-1.5 text-[10px] ${open ? '' : 'hidden'}">${badgeRow}${infoRow}${dimBlocks}${eventsRow}
          </div>
        `;
        container.appendChild(card);
      });
    }

    function secretInspectNpc(name, type) {
      const input = document.getElementById('playerInput');
      input.value = type === 'intimacy'
        ? `[AI Tutor Hint] 请针对 ${name} 当前的态度和语境，给我 2 句地道自然的英语回应建议（附简短语用说明）`
        : `查看${name}面板`;
      input.focus();
      showToast(type === 'intimacy' ? `已填入 AI Tutor 表达求助指令` : `已填入角色面板查看指令`, 'info');
    }

    function renderWeaponMastery(el, sec) {
      const container = q(el, 'body');
      if (!container) return;
      const mastery = AppState.hudState[(sec && sec.source) || 'weapon_mastery'] || {};
      const keys = Object.keys(mastery);
      container.innerHTML = '';

      if (keys.length === 0) {
        container.innerHTML = `<div class="text-[10px] text-slate-500 text-center py-2">${escapeHtml((sec && sec.emptyText) || '暂无记录')}</div>`;
        return;
      }

      const ladder = getLadderLevels(sec);
      keys.forEach(k => {
        const item = mastery[k] || { level: (ladder[0] || '生疏'), exp: 0 };
        const starCount = (ladder.indexOf(item.level) + 1) || 1;

        const row = document.createElement('div');
        row.className = 'flex items-center justify-between text-[11px] p-1.5 rounded bg-slate-900/50 border border-slate-800/60';
        row.innerHTML = `
          <span class="text-slate-300">${escapeHtml(k)}</span>
          <div class="flex items-center gap-1.5 font-mono">
            <span class="text-amber-400 font-semibold text-[10px]">${item.level}</span>
            <span class="text-purple-400 text-[10px]">${'★'.repeat(starCount)}</span>
          </div>
        `;
        container.appendChild(row);
      });
    }

    // 通用「列表」渲染器：同一类型可以有任意多个实例，各自读自己的 source
    function renderList(el, sec) {
      el.__sec = sec;
      const container = q(el, 'body');
      const badge = q(el, 'badge');
      if (!container) return;

      const source = sec.source || 'inventory';
      const items = AppState.hudState[source] || [];
      const isCards = sec.layout === 'cards';
      const emptyText = sec.emptyText || (isCards ? '暂无内容' : '空无一物');

      if (badge) badge.textContent = isCards ? `${items.length} 项` : `${items.length} 件`;

      // 列表一旦重绘，之前展开的详情卡可能已是过期数据 → 先收起
      const detail = q(el, 'detail');
      if (detail) detail.classList.add('hidden');

      if (items.length === 0) {
        container.innerHTML = `
          <div class="text-[11px] text-slate-500 text-center py-4 bg-slate-950/40 rounded-lg border border-slate-800/60">
            ${escapeHtml(emptyText)}
          </div>
        `;
        return;
      }

      const costKey = sec.costKey || 'mp';
      const costLabel = sec.costLabel || 'MP';
      const tagKey = sec.tagKey || 'ring';
      const actionLabel = (sec.action && sec.action.label) || '施放';

      container.innerHTML = '';
      items.forEach((raw, idx) => {
        const item = (typeof raw === 'string') ? { name: raw } : (raw || {});

        if (!isCards) {
          const slot = document.createElement('button');
          slot.type = 'button';
          slot.dataset.itemIndex = String(idx);
          slot.className = 'aspect-square rounded-lg border border-slate-800 bg-slate-950/80 p-1 flex flex-col justify-between text-left hover:border-purple-500 transition';

          const iconEl = document.createElement('span');
          iconEl.className = 'text-sm';
          iconEl.textContent = item.icon || '📦';

          const nameEl = document.createElement('span');
          nameEl.className = 'text-[10px] text-slate-300 truncate w-full font-medium';
          nameEl.textContent = item.name || '';

          slot.append(iconEl, nameEl);
          const qty = Number(item.qty);
          if (qty > 1) slot.title = `${item.name} ×${qty}`;
          container.appendChild(slot);
          return;
        }

        const card = document.createElement('div');
        card.className = 'p-2 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between text-[11px]';
        card.innerHTML = `
          <div>
            <div class="font-semibold text-cyan-300">${escapeHtml(item.name)} <span class="text-[10px] text-slate-500 font-normal">(${escapeHtml(item[tagKey] || sec.tagFallback || '—')})</span></div>
            <div class="text-[10px] text-slate-400">消耗: ${Number(item[costKey]) || 0} ${escapeHtml(costLabel)}</div>
          </div>
          <button type="button" data-spell-name="${escapeHtml(item.name)}" data-spell-mp="${Number(item[costKey]) || 0}" class="px-2 py-1 rounded bg-cyan-950/60 hover:bg-cyan-900 text-cyan-200 border border-cyan-800 text-[10px] font-mono">
            ${escapeHtml(actionLabel)}
          </button>
        `;
        container.appendChild(card);
      });

      // 事件委托：名称来自 LLM 输出，绝不拼进 onclick 字符串
      container.onclick = (e) => {
        const itemBtn = e.target.closest('button[data-item-index]');
        if (itemBtn) { showItemDetail(el, parseInt(itemBtn.dataset.itemIndex, 10)); return; }
        const spellBtn = e.target.closest('button[data-spell-name]');
        if (spellBtn) castSpellQuick(el, sec, spellBtn.dataset.spellName, parseInt(spellBtn.dataset.spellMp, 10) || 0);
      };
    }

    function renderSkills(el, sec) {
      const container = q(el, 'body');
      if (!container) return;
      const known = (AppState.hudState.skills && AppState.hudState.skills.known) || [];
      const unknown = (AppState.hudState.skills && AppState.hudState.skills.unknown) || [];
      container.innerHTML = '';

      if (known.length === 0 && unknown.length === 0) {
        container.innerHTML = `<span class="text-[11px] text-slate-500">${escapeHtml(sec.emptyText || '暂无技能记录')}</span>`;
        return;
      }
      known.forEach(sk => {
        const badgeEl = document.createElement('button');
        badgeEl.type = 'button';
        badgeEl.dataset.action = 'speak-text';
        badgeEl.dataset.speech = sk;
        badgeEl.title = '已掌握 · 点击朗读发音';
        badgeEl.className = 'px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 text-[10px] transition';
        badgeEl.textContent = `✓ ${sk}`;
        container.appendChild(badgeEl);
      });
      unknown.forEach(sk => {
        const badgeEl = document.createElement('button');
        badgeEl.type = 'button';
        badgeEl.dataset.action = 'collect-word';
        badgeEl.dataset.word = sk;
        badgeEl.title = '待激活 / 生词本 · 点击朗读并标记为已掌握';
        badgeEl.className = 'px-2 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/60 text-[10px] transition';
        badgeEl.textContent = `○ ${sk}`;
        container.appendChild(badgeEl);
      });
    }

    function castSpellQuick(el, sec, spellName, cost) {
      const input = document.getElementById('playerInput');
      const tpl = (sec && sec.action && sec.action.template) || '【施法检定】施展【{name}】(消耗 {cost} MP)。';
      input.value = tpl.replace(/\{name\}/g, spellName).replace(/\{cost\}/g, cost);
      input.focus();
    }

    function renderStatusEffects(el, sec) {
      const container = q(el, 'body');
      const countEl = q(el, 'badge');
      if (!container) return;

      const list = AppState.hudState[(sec && sec.source) || 'status_effects'] || [];
      if (countEl) countEl.textContent = `${list.length} 项`;

      if (list.length === 0) {
        container.innerHTML = `<span class="text-[11px] text-slate-500">${escapeHtml((sec && sec.emptyText) || '正常 (无特殊状态)')}</span>`;
        return;
      }

      const toneMap = {
        buff: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
        debuff: 'bg-rose-950/60 text-rose-300 border-rose-800/60',
        neutral: 'bg-slate-800/80 text-slate-300 border-slate-700'
      };

      container.innerHTML = '';
      list.forEach(effect => {
        const item = (typeof effect === 'string') ? { name: effect } : (effect || {});
        const badge = document.createElement('span');
        badge.className = `px-2 py-0.5 rounded border text-[10px] ${toneMap[item.type] || toneMap.neutral}`;
        badge.textContent = item.name || '未知状态';
        if (item.desc) badge.title = item.desc;
        container.appendChild(badge);
      });
    }

    function showItemDetail(el, index) {
      const sec = (el && el.__sec) || {};
      const list = AppState.hudState[sec.source || 'inventory'] || [];
      const raw = list[index];
      if (raw === undefined) return;

      const item = (typeof raw === 'string') ? { name: raw } : (raw || {});
      const card = q(el, 'detail');
      if (!card) return;

      const iconEl = q(el, 'detailIcon');
      if (iconEl) iconEl.textContent = item.icon || '📦';
      const nameEl = q(el, 'detailName');
      if (nameEl) nameEl.textContent = item.name || '未知物品';
      const qtyEl = q(el, 'detailQty');
      if (qtyEl) qtyEl.textContent = `数量: ${Number(item.qty) || 1}`;
      const descEl = q(el, 'detailDesc');
      if (descEl) descEl.textContent = item.desc || '暂无详细描述。';
      card.classList.remove('hidden');
    }

    function renderContextPanel() {
      const cfg = AppState.contextConfig || defaultContextConfig();

      const turnsEl = document.getElementById('cfgRecentTurnsInput');
      if (turnsEl) turnsEl.value = Number(cfg.recentTurns) || 12;
      const trigEl = document.getElementById('cfgSummaryTriggerInput');
      if (trigEl) trigEl.value = Number(cfg.summaryTriggerTurns) || 8;
      const autoEl = document.getElementById('settingAutoSummary');
      if (autoEl) autoEl.checked = !!cfg.autoSummary;

      const ta = document.getElementById('contextSummaryTextarea');
      // 正在输入的框不要被后台摘要覆盖
      if (ta && document.activeElement !== ta) ta.value = AppState.contextSummary || '';

      const badge = document.getElementById('contextUsageSummary');
      if (badge) {
        const total = (AppState.narrativeHistory || []).length;
        const sent = buildPromptHistory().length;
        badge.textContent = `发送 ${sent}/${total} 条 · 约 ${Math.round(estimateContextChars() / 1000)}k 字`;
      }
    }

    function renderAttributesHoneycomb(container, attrs) {
      if (!container) return;
      const keys = Object.keys(attrs || {});
      if (keys.length === 0) {
        container.innerHTML = '<div class="text-[11px] text-slate-500 text-center py-8">暂无属性数据</div>';
        return;
      }

      const theme = THEME_PRESETS.find(t => t.id === AppState.themeTone) || THEME_PRESETS[0];
      const isPaper = Boolean(theme.isLight !== false);
      const primaryColor = theme.primary || '#a62620';
      const baseCap = AppState.hudState.attribute_cap || 20;

      const parsedStats = keys.map(k => {
        const item = attrs[k];
        let cur = 10, max = baseCap;
        if (typeof item === 'object' && item !== null) {
          cur = parseFloat(item.current ?? 10);
          max = parseFloat(item.max ?? baseCap);
        } else {
          cur = parseFloat(item) || 10;
        }
        return { key: k, current: cur, max: max };
      });

      const count = keys.length;
      const width = 270, height = 215, cx = width / 2, cy = height / 2, radius = 64;

      const getCoord = (index, r) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
        return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), angle };
      };

      const outerBgFill = hexToRgba(theme.bgMain || '#f2eadb', 0.78);
      const strokeBase = isPaper ? '24, 21, 18' : '230, 221, 208';
      const labelTextFill = theme.ink || '#181512';
      const maxTextFill = theme.inkMuted || '#5c5245';

      const levels = [0.25, 0.5, 0.75, 1.0];
      let gridSvg = '';
      levels.forEach((lvl, lvlIdx) => {
        const pts = [];
        for (let i = 0; i < count; i++) {
          const pt = getCoord(i, radius * lvl);
          pts.push(`${pt.x.toFixed(1)},${pt.y.toFixed(1)}`);
        }
        const isOuter = lvlIdx === levels.length - 1;
        gridSvg += `<polygon points="${pts.join(' ')}" fill="${isOuter ? outerBgFill : 'none'}" stroke="rgba(${strokeBase}, ${isOuter ? 0.45 : 0.18})" stroke-width="${isOuter ? '1.3' : '0.8'}" ${!isOuter && isPaper ? 'stroke-dasharray="2,2"' : ''} />`;
      });

      let spokesSvg = '';
      for (let i = 0; i < count; i++) {
        const pt = getCoord(i, radius);
        spokesSvg += `<line x1="${cx}" y1="${cy}" x2="${pt.x.toFixed(1)}" y2="${pt.y.toFixed(1)}" stroke="rgba(${strokeBase}, 0.24)" stroke-width="0.9" />`;
      }

      const dataPoints = [];
      const vertexDots = [];
      const labelsSvg = [];

      parsedStats.forEach((stat, i) => {
        const ratio = Math.max(0.08, Math.min(1.0, stat.current / (stat.max || baseCap)));
        const pt = getCoord(i, radius * ratio);
        dataPoints.push(`${pt.x.toFixed(1)},${pt.y.toFixed(1)}`);

        vertexDots.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="3.2" fill="${primaryColor}" stroke="${isPaper ? '#faf6ee' : '#ffffff'}" stroke-width="1.2" />`);

        const outerPt = getCoord(i, radius + 15);
        let anchor = 'middle';
        const cos = Math.cos(outerPt.angle);
        if (cos > 0.35) anchor = 'start';
        else if (cos < -0.35) anchor = 'end';

        const sin = Math.sin(outerPt.angle);
        let dy = '0.35em';
        if (sin < -0.6) dy = '-0.15em';
        else if (sin > 0.6) dy = '0.85em';

        labelsSvg.push(`
          <text x="${outerPt.x.toFixed(1)}" y="${outerPt.y.toFixed(1)}" text-anchor="${anchor}" dy="${dy}" fill="${labelTextFill}" font-size="9" font-weight="700" class="select-none tracking-tight">
            ${escapeHtml(stat.key)} <tspan fill="${primaryColor}" font-weight="800">${stat.current}</tspan><tspan fill="${maxTextFill}" font-size="7.5">/${stat.max}</tspan>
          </text>
        `);
      });

      container.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" class="w-full h-auto overflow-visible select-none">
          <defs>
            <radialGradient id="honeycombGradient" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="${primaryColor}" stop-opacity="0.48" />
              <stop offset="100%" stop-color="${primaryColor}" stop-opacity="0.12" />
            </radialGradient>
          </defs>
          ${gridSvg}
          ${spokesSvg}
          <polygon points="${dataPoints.join(' ')}" fill="url(#honeycombGradient)" stroke="${primaryColor}" stroke-width="2" stroke-linejoin="round" />
          ${vertexDots.join('')}
          ${labelsSvg.join('')}
        </svg>
      `;
    }

    // ===== HUD 渲染引擎（完全由蓝图生成）=====
    // 右栏没有任何静态 section 标记：面板与 section 都按蓝图现场生成，
    // 内部元素用 data-ref 定位而不是 id，因此同一类型可以有任意多个实例
    // （例如同时存在「功法」和「法宝」两个列表面板）。

    function q(root, ref) {
      return (root && root.querySelector) ? root.querySelector(`[data-ref="${ref}"]`) : null;
    }

    const SECTION_TEMPLATES = {
      // 角色卡内部结构固定为四个"槽位容器"：大标题 / 左右徽章 / 字段格 / 外貌段。
      // 具体哪些字段进哪个槽位完全由蓝图决定（见 renderProfile），这里只预留容器，
      // 因此这个渲染器不必再随字段增减而改动。
      profile: () => `
        <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800/90 space-y-2.5 shadow-sm">
          <div class="flex items-center justify-between border-b border-slate-800/70 pb-2">
            <div>
              <div class="flex flex-wrap gap-1.5 mt-1" data-ref="badgesLeft"></div>
            </div>
            <div class="text-right" data-ref="badgesRight"></div>
          </div>
          <div class="grid grid-cols-2 gap-2 text-[11px] text-slate-400" data-ref="fields"></div>
          <div class="space-y-1" data-ref="appearanceBlock">
            <div class="flex items-center justify-between text-[10px] text-slate-500 uppercase tracking-wider">
              <span data-ref="appearanceLabel">外貌与着装特征</span>
              <button type="button" class="text-purple-400 hover:text-purple-300 hidden text-[10px] underline" data-ref="toggleAppearance">展开全文</button>
            </div>
            <p class="text-[11px] text-slate-300/90 leading-relaxed bg-slate-900/40 p-2 rounded border border-slate-800/50 line-clamp-2 transition-all" data-ref="appearance">暂无外貌描述。</p>
          </div>
        </div>`,

      location: () => `
        <div class="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="text-[10px] text-slate-500 uppercase tracking-wider">地点</span>
            <span class="text-slate-200 font-medium truncate max-w-[150px]" data-ref="location">未知域</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[10px] text-slate-500 uppercase tracking-wider">环境与时间</span>
            <span class="text-slate-400 truncate max-w-[150px]" data-ref="time">未开局</span>
          </div>
        </div>`,

      bars: () => `
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-semibold text-slate-300" data-ref="title">生存状态</span>
            <span class="text-[10px] text-slate-500" data-ref="badge">0 项</span>
          </div>
          <div class="space-y-2" data-ref="body"></div>
        </div>`,

      stats: () => `
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5">
              <span class="text-[11px] font-semibold text-slate-300" data-ref="title">基础属性</span>
              <button type="button" data-ref="capBtn" class="text-[10px] text-purple-400 hover:text-purple-300 px-1.5 py-0.5 rounded bg-purple-950/40 border border-purple-800/50 transition" title="设定属性成长上限">
                上限: <span data-ref="capValue">20</span> ⚙️
              </button>
            </div>
            <span class="text-[10px] text-slate-500" data-ref="badge">0 项</span>
          </div>
          <div class="p-2 rounded-lg bg-slate-950/80 border border-slate-800/80 flex flex-col items-center justify-center min-h-[210px] relative overflow-hidden" data-ref="radar"></div>
        </div>`,

      tiers: () => `
        <div class="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 space-y-2">
          <div class="flex items-center justify-between text-[11px]">
            <span class="font-semibold text-slate-300" data-ref="title">熟练度</span>
          </div>
          <div class="grid grid-cols-1 gap-1.5" data-ref="body"></div>
        </div>`,

      tags: () => `
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-semibold text-slate-300" data-ref="title">状态效果</span>
            <span class="text-[10px] text-slate-500" data-ref="badge">0 项</span>
          </div>
          <div class="flex flex-wrap gap-1.5" data-ref="body"></div>
        </div>`,

      entities: () => `
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
              <span>👥</span><span data-ref="title">关系与情感</span>
            </span>
            <span class="text-[10px] text-purple-400 font-mono" data-ref="badge">0 人</span>
          </div>
          <div class="space-y-3" data-ref="body"></div>
        </div>`,

      listGrid: () => `
        <div class="space-y-2.5">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-semibold text-slate-300" data-ref="title">列表</span>
            <span class="text-[10px] text-slate-500 font-mono" data-ref="badge">0 件</span>
          </div>
          <div class="hidden p-2.5 rounded-lg bg-slate-950 border border-purple-500/50 space-y-1.5 shadow-lg transition-all" data-ref="detail">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5">
                <span class="text-sm" data-ref="detailIcon">📦</span>
                <span class="font-bold text-slate-100 text-[11px]" data-ref="detailName">物品名称</span>
              </div>
              <span class="text-[10px] text-purple-300 font-mono px-1.5 py-0.5 rounded bg-purple-950/80 border border-purple-800/60" data-ref="detailQty">数量: 1</span>
            </div>
            <p class="text-[10px] text-slate-400 leading-relaxed" data-ref="detailDesc"></p>
          </div>
          <div class="grid grid-cols-4 gap-1.5" data-ref="body"></div>
        </div>`,

      listCards: () => `
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
              <span>✨</span><span data-ref="title">列表</span>
            </span>
            <span class="text-[10px] text-cyan-400" data-ref="badge">0 项</span>
          </div>
          <div class="space-y-2" data-ref="body"></div>
        </div>`,

      skills: () => `
        <div class="pt-2 border-t border-slate-800 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-semibold text-slate-300" data-ref="title">技能掌握</span>
          </div>
          <div class="flex flex-wrap gap-1.5" data-ref="body"></div>
        </div>`
    };

    function templateKeyFor(sec) {
      if (sec.type === 'list') return sec.layout === 'cards' ? 'listCards' : 'listGrid';
      return sec.type;
    }

    let hudSectionEls = {};   // "tabId/sectionId" -> section 根元素

    // ===== 世界蓝图面板 =====
    let schemaModalPresetId = 'generic-fantasy';
    let schemaDraft = null;   // 面板里编辑中的蓝图副本

    const SECTION_TYPE_LABELS = {
      profile: '角色档案', location: '地点', bars: '资源条', stats: '数值属性',
      tiers: '阶梯等级', tags: '状态标签', list: '条目列表', entities: '关系实体', skills: '技能标签'
    };

    // ===== 面板折叠（蓝图可配）=====
    //   none    不折叠
    //   items   逐项折叠：每个条目只显示标题，点开才看详情（只有 entities 支持）
    //   section 整块折叠：整个面板只留标题行，点标题展开
    // 默认：entities 走 items（P7 起的行为），其余 none。
    const SECTION_COLLAPSE_MODES = { none: '不折叠', items: '逐项折叠', section: '整块折叠' };
    const SECTION_COLLAPSE_SHORT = { none: '不折叠', items: '逐项', section: '整块' };

    function sectionCollapseOf(sec) {
      const m = sec && sec.collapse;
      if (m && SECTION_COLLAPSE_MODES[m]) return m;
      return (sec && sec.type === 'entities') ? 'items' : 'none';
    }

    // 已展开的面板（键是 tabId/sectionId）。
    // buildHudFromSchema 只在蓝图变化时重建外壳，但状态下不能挂在 DOM 上：
    // 重建后要按它还原，跟 NPC 逐项折叠是同一个思路。
    const expandedSectionKeys = new Set();

    // 从标题元素往上找到"直接挂在 section 根节点下的那一行"（也就是标题行）。
    // 不能简单地取 title.parentElement —— stats 的标题外面还套了一层
    // （标题 + 上限按钮），要是拿内层当标题行，收起时会把徽章一起藏掉。
    function sectionHeaderRow(el, titleEl) {
      let n = titleEl;
      while (n && n.parentElement && n.parentElement !== el) n = n.parentElement;
      return (n && n.parentElement === el) ? n : null;
    }

    function applySectionCollapse(el, sec, key) {
      const mode = sectionCollapseOf(sec);
      if (mode !== 'section') return;
      const titleEl = q(el, 'title');
      if (!titleEl) return;   // profile / location 没有标题行，整块折叠对它们没意义
      const header = sectionHeaderRow(el, titleEl);
      if (!header) return;

      const bodies = [...el.children].filter(c => c !== header);
      const open = expandedSectionKeys.has(key);

      const chev = document.createElement('span');
      chev.className = 'text-[10px] text-slate-500 shrink-0';
      chev.setAttribute('data-sec-chevron', '');
      chev.textContent = open ? '▾' : '▸';
      header.insertBefore(chev, header.firstChild);
      header.classList.add('cursor-pointer');
      header.setAttribute('role', 'button');
      header.setAttribute('tabindex', '0');
      header.setAttribute('aria-expanded', open ? 'true' : 'false');
      header.title = '展开 / 收起该面板';

      const render = (isOpen) => {
        bodies.forEach(b => b.classList.toggle('hidden', !isOpen));
        chev.textContent = isOpen ? '▾' : '▸';
        header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      };
      render(open);

      const toggle = () => {
        const next = !expandedSectionKeys.has(key);
        if (next) expandedSectionKeys.add(key); else expandedSectionKeys.delete(key);
        render(next);
      };
      header.addEventListener('click', toggle);
      // 键盘也能开合（role=button 就该能用 Enter/空格）
      header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    }

    // 依蓝图重建整个右栏（蓝图一变就重建，因此增删面板/字段都是即时的）
    function buildHudFromSchema() {
      const container = document.getElementById('hudScrollContainer');
      if (!container) return;
      const schema = getWorldSchema();

      container.innerHTML = '';
      hudSectionEls = {};

      schema.tabs.forEach(tab => {
        const panel = document.createElement('div');
        panel.dataset.tabPanel = tab.id;
        panel.className = tab.panelClass || 'space-y-4';

        (tab.sections || []).forEach(sec => {
          const tpl = SECTION_TEMPLATES[templateKeyFor(sec)];
          if (!tpl) return;

          const holder = document.createElement('div');
          holder.innerHTML = tpl(sec).trim();
          const el = holder.firstElementChild;
          if (!el) return;

          el.dataset.section = sec.id;
          el.__sec = sec;
          const titleEl = q(el, 'title');
          if (titleEl) {
            titleEl.textContent = sec.label || '';
            // 保留 data-section-title，方便外部（测试/调试）按 section 定位标题
            titleEl.dataset.sectionTitle = sec.id;
          }

          applySectionCollapse(el, sec, tab.id + '/' + sec.id);

          panel.appendChild(el);
          hudSectionEls[tab.id + '/' + sec.id] = el;
        });

        container.appendChild(panel);
      });

      applySchema();
    }

    const SECTION_RENDERERS = {
      profile: (el, sec) => renderProfile(el, sec),
      location: (el, sec) => renderLocation(el, sec),
      bars: (el, sec) => renderVitalsBars(el, sec),
      stats: (el, sec) => renderAttrsStats(el, sec),
      tiers: (el, sec) => renderWeaponMastery(el, sec),
      tags: (el, sec) => renderStatusEffects(el, sec),
      entities: (el, sec) => renderNpcCodex(el, sec),
      list: (el, sec) => renderList(el, sec),
      skills: (el, sec) => renderSkills(el, sec)
    };

    function renderHud() {
      // 渲染全部 section（而非只渲染当前页签）：
      // 只渲染当前页签会留下"隐藏面板内容过期"的隐患（例如重置后切回行囊仍显示旧物品）。
      // section 都是轻量 DOM，全量渲染的开销可以忽略。
      const schema = getWorldSchema();
      schema.tabs.forEach(tab => {
        (tab.sections || []).forEach(sec => {
          const el = hudSectionEls[tab.id + '/' + sec.id];
          const fn = SECTION_RENDERERS[sec.type];
          if (!el || !fn) return;
          try {
            fn(el, sec);
          } catch (e) {
            // 单个 section 渲染失败不能拖垮整个面板
            console.error(`[奇点] 渲染 section「${sec.label || sec.id}」(${sec.type}) 失败:`, e);
          }
        });
      });
      if (typeof syncHighlightedElementsAndBar === 'function') {
        syncHighlightedElementsAndBar();
      }
    }

    // ---- 各类型 section 的渲染 ----

    // ---- 角色卡字段的「槽位」(slot) ----
    // 蓝图不只决定字段叫什么，还决定它落在角色卡的哪个位置：
    //   title      顶部大标题（可多个）
    //   badge      徽章（前两个在标题下方，第三个在右上角，第 4 个起追加到左侧换行容器）
    //   field      两列字段小格（默认）
    //   appearance 底部外貌段落（只有第一个生效，多出来的降级进字段格）
    const PROFILE_SLOTS = ['title', 'badge', 'field', 'appearance'];
    const PROFILE_SLOT_LABELS = { title: '大标题', badge: '徽章', field: '字段格', appearance: '外貌段' };

    // 老存档 / 老预设的字段没有 slot。按 key 推出与「改造前写死的版式」完全一致的位置，
    // 保证默认蓝图与既有世界包的渲染结果一字不变。
    const LEGACY_PROFILE_SLOT = {
      name: 'title', race: 'badge', class: 'badge', identity: 'badge', appearance: 'appearance'
    };
    const LEGACY_PROFILE_EMPTY = {
      name: '未命名角色', race: '未定种族', class: '未定职业',
      identity: '无身份记录', appearance: '暂无外貌描述。'
    };
    // 徽章配色沿用改造前的 slate / purple / amber；第 4 个起复用第一个的样式
    const PROFILE_BADGE_CLASS = [
      'px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700/60',
      'px-1.5 py-0.5 rounded text-[10px] bg-purple-950/60 text-purple-300 border border-purple-800/60',
      'px-1.5 py-0.5 rounded text-[10px] bg-slate-800/80 text-amber-300/90 border border-amber-900/40'
    ];

    function profileSlotOf(f) {
      const s = f && f.slot;
      if (PROFILE_SLOTS.indexOf(s) >= 0) return s;
      return LEGACY_PROFILE_SLOT[(f && f.key) || ''] || 'field';
    }

    function profileEmptyOf(f) {
      const t = f && f.emptyText;
      if (typeof t === 'string' && t) return t;
      return LEGACY_PROFILE_EMPTY[(f && f.key) || ''] || '-';
    }

    function renderProfile(el) {
      const profile = AppState.hudState.character_profile || {};
      const schema = getWorldSchema();
      const fields = (schema.profileFields || []).filter(f => f && f.key);

      // 先给每个字段定好落点。同一槽位允许声明多个字段；appearance 只吃第一个，
      // 多出来的（以及任何未知槽位）降级进字段格 —— 保证没有字段会凭空消失。
      const placed = fields.map(f => ({ f, slot: profileSlotOf(f) }));
      const appEntry = placed.find(x => x.slot === 'appearance') || null;
      const inGrid = placed.filter(x => x.slot === 'field' || (x.slot === 'appearance' && x !== appEntry));

      // 1) 顶部大标题。刻意不给它加包裹层：新标题直接插到徽章容器前面，
      //    这样默认蓝图渲染出的 DOM 与改造前逐字节一致（快照守卫得以保持最严格）。
      const badgesLeft = q(el, 'badgesLeft');
      const titleHost = badgesLeft ? badgesLeft.parentElement : null;
      if (titleHost && badgesLeft) {
        while (titleHost.firstChild && titleHost.firstChild !== badgesLeft) {
          titleHost.removeChild(titleHost.firstChild);
        }
        placed.filter(x => x.slot === 'title').forEach(({ f }) => {
          const d = document.createElement('div');
          d.className = 'font-bold text-slate-100 text-sm tracking-wide';
          d.textContent = profile[f.key] || profileEmptyOf(f);
          titleHost.insertBefore(d, badgesLeft);
        });
      }

      // 2) 徽章：第 3 个沿用原设计的右上角位置，其余进左侧换行容器
      const leftBox = badgesLeft;
      const rightBox = q(el, 'badgesRight');
      if (leftBox) leftBox.innerHTML = '';
      if (rightBox) rightBox.innerHTML = '';
      placed.filter(x => x.slot === 'badge').forEach(({ f }, i) => {
        const span = document.createElement('span');
        span.className = PROFILE_BADGE_CLASS[i < PROFILE_BADGE_CLASS.length ? i : 0];
        span.textContent = profile[f.key] || profileEmptyOf(f);
        const box = (i === 2) ? rightBox : leftBox;
        if (box) box.appendChild(span);
      });

      // 3) 字段小格
      const grid = q(el, 'fields');
      if (grid) {
        grid.innerHTML = '';
        inGrid.forEach(({ f }) => {
          const row = document.createElement('div');
          row.className = 'flex items-center justify-between bg-slate-900/60 px-2 py-1 rounded border border-slate-800/60';

          const lab = document.createElement('span');
          lab.className = 'text-slate-500';
          lab.textContent = f.label;

          const val = document.createElement('span');
          val.className = 'text-slate-200 font-medium';
          val.textContent = profile[f.key] || profileEmptyOf(f);

          row.append(lab, val);
          grid.appendChild(row);
        });
      }

      // 4) 外貌段落：蓝图给它留了字段才显示。
      //    兜底：蓝图没留但模型仍在写 appearance 时照旧显示，免得好好的存档数据凭空不见。
      const block = q(el, 'appearanceBlock');
      const appLabel = q(el, 'appearanceLabel');
      const appEl = q(el, 'appearance');
      const toggleAppBtn = q(el, 'toggleAppearance');
      const appField = appEntry ? appEntry.f : null;
      const rawApp = appField ? profile[appField.key] : profile.appearance;
      const showApp = !!appField || (typeof rawApp === 'string' && rawApp.trim() !== '');

      if (block) block.classList.toggle('hidden', !showApp);
      if (appLabel && appField) appLabel.textContent = appField.label;

      const appDesc = rawApp || (appField ? profileEmptyOf(appField) : '暂无外貌描述。');
      if (appEl) appEl.textContent = appDesc;
      if (toggleAppBtn) {
        toggleAppBtn.textContent = '展开全文';
        toggleAppBtn.classList.toggle('hidden', !(appDesc.length > 50));
        toggleAppBtn.onclick = () => {
          if (!appEl) return;
          const isClamped = appEl.classList.contains('line-clamp-2');
          appEl.classList.toggle('line-clamp-2', !isClamped);
          toggleAppBtn.textContent = isClamped ? '收起' : '展开全文';
        };
      }
    }

    function renderLocation(el) {
      const hud = AppState.hudState;
      const loc = q(el, 'location');
      if (loc) loc.textContent = hud.location || '未知域';
      const tm = q(el, 'time');
      if (tm) tm.textContent = hud.time || '未开局';
    }

    function renderVitalsBars(el, sec) {
      const container = q(el, 'body');
      if (!container) return;

      const bars = AppState.hudState.bars || [];
      const badge = q(el, 'badge');
      if (badge) badge.textContent = `${bars.length} 项`;

      container.innerHTML = '';
      const barFields = Array.isArray(sec && sec.fields) ? sec.fields : [];

      bars.forEach((bar, bi) => {
        const current = Number(bar.current) || 0;
        const max = Number(bar.max) || 100;
        const percent = Math.min(100, Math.max(0, Math.round((current / max) * 100)));

        const matched = barFields.find(f => f && (f.label === bar.label || f.key === bar.label || f.key === bar.key))
          || barFields[bi];
        const tone = bar.color || (matched && matched.tone) || 'violet';
        const fillClass = BAR_TONE_GRADIENT[tone] || 'from-purple-600 to-indigo-500';

        const div = document.createElement('div');
        div.className = 'p-2 rounded-lg bg-slate-950/70 border border-slate-800/80 space-y-1';
        div.innerHTML = `
          <div class="flex justify-between items-center text-[11px]">
            <span class="font-medium text-slate-300">${escapeHtml(bar.label)}</span>
            <span class="font-mono font-medium text-slate-200">${current} / ${max}</span>
          </div>
          <div class="w-full bg-slate-800 h-2 rounded-full overflow-hidden border border-slate-800 p-[1px]">
            <div class="h-full rounded-full bar-fill bg-gradient-to-r ${fillClass}" style="width: ${percent}%"></div>
          </div>
        `;
        container.appendChild(div);
      });
    }

    function renderAttrsStats(el) {
      const hud = AppState.hudState;
      const attrs = hud.attributes || {};
      const keys = Object.keys(attrs);

      const badge = q(el, 'badge');
      if (badge) badge.textContent = `${keys.length} 项`;

      const capValue = q(el, 'capValue');
      if (capValue) capValue.textContent = hud.attribute_cap || 20;

      const capBtn = q(el, 'capBtn');
      if (capBtn) {
        capBtn.onclick = () => {
          document.getElementById('attributeCapInput').value = AppState.hudState.attribute_cap || 20;
          document.getElementById('attributeCapModal').classList.remove('hidden');
        };
      }

      const radar = q(el, 'radar');
      if (radar) renderAttributesHoneycomb(radar, attrs);
    }

    // 各世界类型的「角色创建」配置：问什么、投什么骰、初始数值怎么算
    const PRESET_CREATION = {
      xianxia: {
        attributes: ['根骨', '悟性', '神识', '气运', '心性'],
        nameLabel: '道号', classLabel: '宗门', identityLabel: '身份',
        appearanceLabel: '容貌与随身法器', appearancePlaceholder: '容貌气质、道袍样式与随身法器...',
        namePlaceholder: '例如：清虚子',
        dice: { key: '气运', label: '先天命格随机投骰 (D6)', sides: 6, base: 2, map: { 1: -1, 2: 0, 3: 1, 4: 1, 5: 2, 6: 3 } },
        derived: [
          { label: '气血', cardLabel: '气血', tone: 'rose', formula: '20 + 根骨 * 8' },
          { label: '灵力', cardLabel: '灵力', tone: 'cyan', formula: '悟性 * 6' },
          { label: '神识', cardLabel: '神识', tone: 'violet', formula: '神识 * 5' }
        ]
      },
      cyberpunk: {
        attributes: ['体格', '反应', '技术', '感知', '意志'],
        nameLabel: '代号', classLabel: '义体型号', identityLabel: '所属势力',
        appearanceLabel: '外观与改造特征', appearancePlaceholder: '发型、义体部位、着装与随身装备...',
        namePlaceholder: '例如：V-704',
        dice: { key: '人脉', label: '街头人脉随机投骰 (D6)', sides: 6, base: 2, map: { 1: -1, 2: 0, 3: 1, 4: 1, 5: 2, 6: 3 } },
        derived: [
          { label: '生命', cardLabel: '生命', tone: 'rose', formula: '20 + 体格 * 6' },
          { label: '体力', cardLabel: '体力', tone: 'emerald', formula: '10 + 意志 * 4' }
        ]
      },
      cthulhu: {
        attributes: ['力量', '敏捷', '体质', '智力', '意志', '教育'],
        nameLabel: '姓名', classLabel: '职业', identityLabel: '社会身份',
        appearanceLabel: '外貌与随身物品', appearancePlaceholder: '外貌、衣着与随身携带的调查工具...',
        dice: { key: '幸运', label: '幸运值随机投骰 (D6)', sides: 6, base: 2, map: { 1: -1, 2: 0, 3: 1, 4: 1, 5: 2, 6: 3 } },
        derived: [
          { label: '生命', cardLabel: '生命', tone: 'rose', formula: '10 + 体质 * 5' },
          { label: '理智 (SAN)', cardLabel: '理智', tone: 'violet', formula: '意志 * 5' }
        ]
      },
      modern: {
        attributes: ['体能', '敏捷', '智力', '感知', '魅力'],
        nameLabel: '姓名', classLabel: '职业', identityLabel: '社会身份',
        appearanceLabel: '外貌与随身物品', appearancePlaceholder: '外貌、着装与随身物品...',
        dice: { key: '人望', label: '人望随机投骰 (D6)', sides: 6, base: 2, map: { 1: -1, 2: 0, 3: 1, 4: 1, 5: 2, 6: 3 } },
        derived: [
          { label: '体力', cardLabel: '体力', tone: 'rose', formula: '10 + 体能 * 5' },
          { label: '精力', cardLabel: '精力', tone: 'cyan', formula: '智力 * 5' }
        ]
      },
      campus: {
        attributes: ['学力', '体力', '社交', '艺术', '意志'],
        nameLabel: '姓名', classLabel: '社团', identityLabel: '身份',
        ageLabel: '年龄', ageValue: 17,
        appearanceLabel: '外貌与随身物品', appearancePlaceholder: '外貌、校服与随身物品...',
        dice: { key: '人缘', label: '人缘随机投骰 (D6)', sides: 6, base: 2, map: { 1: -1, 2: 0, 3: 1, 4: 1, 5: 2, 6: 3 } },
        derived: [
          { label: '体力', cardLabel: '体力', tone: 'emerald', formula: '10 + 体力 * 5' },
          { label: '心情', cardLabel: '心情', tone: 'rose', formula: '10 + 社交 * 5' }
        ]
      }
    };

    // 依据预设差异生成完整的创建配置（未指定的部分沿用默认）
    function presetCreation(o) {
      const c = PRESET_CREATION[o.id];
      if (!c) return undefined;
      const base = defaultCreationConfig();
      const rows = base.rows.map(r => ({ cols: r.cols, fields: r.fields.map(f => Object.assign({}, f)) }));

      const nameF = rows[0].fields[0];
      if (c.nameLabel) nameF.label = c.nameLabel;
      if (c.nameCardLabel || c.nameLabel) nameF.cardLabel = c.nameCardLabel || c.nameLabel;
      if (c.namePlaceholder) nameF.placeholder = c.namePlaceholder;
      if (c.ageLabel) rows[0].fields[2].label = c.ageLabel;
      if (c.ageValue !== undefined) rows[0].fields[2].value = c.ageValue;

      if (c.classLabel) rows[1].fields[1].label = c.classLabel;
      if (c.identityLabel) rows[1].fields[2].label = c.identityLabel;

      const appF = rows[2].fields[0];
      if (c.appearanceLabel) appF.label = c.appearanceLabel;
      if (c.appearancePlaceholder) appF.placeholder = c.appearancePlaceholder;

      return {
        attributes: c.attributes,
        rows,
        dice: c.dice || base.dice,
        derived: c.derived || base.derived
      };
    }

    // ===== 世界类型预设 =====
    // 纯靠 AI 从零生成蓝图质量不稳定，所以先给一套可用骨架，
    // 再让 AI 依据具体世界观微调（也可只用预设、完全不调 AI）。
    function presetSchema(o) {
      const sections = [
        { id: 'profile', type: 'profile', label: '角色档案' },
        { id: 'location', type: 'location', label: '地点' },
        { id: 'vitals', type: 'bars', label: o.vitalsLabel, source: 'bars', fields: o.bars },
        { id: 'attrs', type: 'stats', label: o.statsLabel, source: 'attributes', radar: o.radar !== false }
      ];
      if (o.ladder) {
        sections.push({
          id: 'mastery', type: 'tiers', label: o.ladderLabel, source: 'weapon_mastery',
          ladder: o.ladder, emptyText: `暂无${o.ladderLabel}记录`
        });
      }
      sections.push({
        id: 'states', type: 'tags', label: '状态效果', source: 'status_effects',
        emptyText: '正常 (无特殊状态)'
      });

      const tabs = [{ id: 'stats', label: o.statsTabLabel || '属性', sections }];

      if (o.dims && o.dims.length) {
        tabs.push({
          id: 'npc', label: o.npcTabLabel || 'NPC',
          sections: [{
            id: 'codex', type: 'entities', label: o.entitiesLabel, source: 'npc_codex',
            badgeKey: o.badgeKey || 'love_type', infoFields: o.infoFields, dimensions: o.dims,
            emptyText: o.npcEmpty || '当前尚未结识任何 NPC。\n产生互动后将自动记录图鉴。'
          }]
        });
      }

      tabs.push({
        id: 'bag', label: o.bagTabLabel || '行囊',
        sections: [{ id: 'items', type: 'list', label: o.bagLabel, source: 'inventory', layout: 'grid' }]
      });

      if (o.artsLabel) {
        tabs.push({
          id: 'spells', label: o.artsTabLabel || '技能',
          sections: [
            {
              id: 'spells', type: 'list', label: o.artsLabel, source: 'spells', layout: 'cards',
              costKey: o.artsCostKey || 'mp', costLabel: o.artsCostLabel || 'MP', tagKey: o.artsTagKey || 'ring',
              action: { label: o.artsAction || '施展', template: o.artsTemplate || '【技能检定】施展【{name}】(消耗 {cost} MP)。' },
              emptyText: o.artsEmpty || '暂未掌握任何技能'
            },
            { id: 'skills', type: 'skills', label: '技能掌握', source: 'skills', emptyText: '暂无技能记录' }
          ]
        });
      }

      return { version: 1, preset: o.id, name: o.name, profileFields: o.profileFields, creation: o.creation || presetCreation(o), tabs };
    }

    const WORLD_PRESETS = [
      {
        id: 'generic-fantasy', name: '通用奇幻', desc: '剑与魔法、种族职业、HP / MP',
        build: () => defaultWorldSchema()
      },
      {
        id: 'xianxia', name: '修仙仙侠', desc: '根骨悟性、境界阶梯、灵力神识',
        build: () => presetSchema({
          id: 'xianxia', name: '修仙仙侠',
          profileFields: [
            { key: 'name', label: '道号' }, { key: 'race', label: '种族' }, { key: 'class', label: '宗门' },
            { key: 'identity', label: '身份' }, { key: 'gender', label: '性别' }, { key: 'age', label: '骨龄' },
            { key: 'appearance', label: '容貌' }
          ],
          vitalsLabel: '修为状态',
          bars: [
            { key: '气血', label: '气血', max: 100, tone: 'rose' },
            { key: '灵力', label: '灵力', max: 100, tone: 'cyan' },
            { key: '神识', label: '神识', max: 100, tone: 'violet' },
            { key: '心魔', label: '心魔', max: 50, tone: 'amber' }
          ],
          statsLabel: '根基', statsTabLabel: '根基',
          ladderLabel: '境界', ladder: ['凡人', '炼气', '筑基', '金丹', '元婴', '化神', '渡劫', '大乘'],
          entitiesLabel: '人情因果', npcTabLabel: '人情',
          dims: [
            { key: 'favor', deltaKey: 'favorDelta', label: '情分', max: 100, tone: 'rose' },
            { key: 'trust', deltaKey: 'trustDelta', label: '信重', max: 100, tone: 'cyan' },
            { key: 'fear', deltaKey: 'fearDelta', label: '忌惮', max: 100, tone: 'violet' }
          ],
          npcEmpty: '尚无因果牵扯。', bagLabel: '储物袋', bagTabLabel: '储物袋',
          artsLabel: '功法神通', artsTabLabel: '功法', artsTagKey: 'tier', artsCostKey: 'mp', artsCostLabel: '灵力',
          artsAction: '施展', artsTemplate: '【施展】{name}（消耗 {cost} 灵力）。', artsEmpty: '尚未习得任何功法'
        })
      },
      {
        id: 'cyberpunk', name: '赛博朋克', desc: '义体改造、神经参数、人际网络',
        build: () => presetSchema({
          id: 'cyberpunk', name: '赛博朋克',
          profileFields: [
            { key: 'name', label: '代号' }, { key: 'race', label: '出身' }, { key: 'class', label: '义体型号' },
            { key: 'identity', label: '所属势力' }, { key: 'gender', label: '性别' }, { key: 'age', label: '年龄' },
            { key: 'appearance', label: '外观特征' }
          ],
          vitalsLabel: '生命体征',
          bars: [
            { key: '生命', label: '生命', max: 100, tone: 'rose' },
            { key: '体力', label: '体力', max: 100, tone: 'emerald' },
            { key: '理智', label: '理智', max: 100, tone: 'violet' },
            { key: '通缉度', label: '通缉度', max: 100, tone: 'amber' }
          ],
          statsLabel: '神经参数', statsTabLabel: '档案',
          ladderLabel: '义体同步率', ladder: ['排斥', '磨合', '适配', '同步', '共鸣', '超载'],
          entitiesLabel: '人际网络', npcTabLabel: '人际', badgeKey: 'faction',
          infoFields: [{ key: 'faction', label: '势力' }, { key: 'personality', label: '性格' }],
          dims: [
            { key: 'trust', deltaKey: 'trustDelta', label: '信任', max: 100, tone: 'cyan' },
            { key: 'fear', deltaKey: 'fearDelta', label: '畏惧', max: 100, tone: 'violet' },
            { key: 'debt', deltaKey: 'debtDelta', label: '人情债', max: 50, tone: 'amber' }
          ],
          npcEmpty: '尚未建立人际网络。', bagLabel: '随身装备', bagTabLabel: '装备',
          artsLabel: '植入体程序', artsTabLabel: '程序', artsTagKey: 'level', artsCostKey: 'ram', artsCostLabel: 'RAM',
          artsAction: '执行', artsTemplate: '【执行】{name}（占用 {cost} RAM）。', artsEmpty: '尚未安装任何程序'
        })
      },
      {
        id: 'cthulhu', name: '克苏鲁恐怖', desc: '理智值、神话知识、调查线索',
        build: () => presetSchema({
          id: 'cthulhu', name: '克苏鲁恐怖',
          profileFields: [
            { key: 'name', label: '姓名' }, { key: 'race', label: '国籍' }, { key: 'class', label: '职业' },
            { key: 'identity', label: '社会身份' }, { key: 'gender', label: '性别' }, { key: 'age', label: '年龄' },
            { key: 'appearance', label: '外貌' }
          ],
          vitalsLabel: '身心状态',
          bars: [
            { key: '生命', label: '生命', max: 100, tone: 'rose' },
            { key: '理智', label: '理智 (SAN)', max: 100, tone: 'violet' },
            { key: '幸运', label: '幸运', max: 100, tone: 'amber' },
            { key: '魔力', label: '魔力', max: 50, tone: 'cyan' }
          ],
          statsLabel: '调查属性', statsTabLabel: '属性',
          ladderLabel: '神话知识', ladder: ['无知', '耳闻', '涉猎', '通晓', '深陷', '疯狂'],
          entitiesLabel: '相关人物', npcTabLabel: '人物', badgeKey: 'attitude',
          infoFields: [{ key: 'attitude', label: '态度' }, { key: 'personality', label: '性格' }],
          dims: [
            { key: 'trust', deltaKey: 'trustDelta', label: '信任', max: 100, tone: 'cyan' },
            { key: 'suspicion', deltaKey: 'suspicionDelta', label: '怀疑', max: 100, tone: 'amber' },
            { key: 'bond', deltaKey: 'bondDelta', label: '羁绊', max: 100, tone: 'rose' }
          ],
          npcEmpty: '尚未结识任何人。', bagLabel: '随身物品', bagTabLabel: '物品',
          artsLabel: '已习得法术', artsTabLabel: '法术', artsTagKey: 'cost', artsCostKey: 'mp', artsCostLabel: '魔力',
          artsAction: '施放', artsTemplate: '【施放】{name}（消耗 {cost} 魔力与理智）。', artsEmpty: '尚未习得任何法术'
        })
      },
      {
        id: 'modern', name: '现代都市', desc: '人脉声望、专业能力、随身物品',
        build: () => presetSchema({
          id: 'modern', name: '现代都市',
          profileFields: [
            { key: 'name', label: '姓名' }, { key: 'race', label: '籍贯' }, { key: 'class', label: '职业' },
            { key: 'identity', label: '社会身份' }, { key: 'gender', label: '性别' }, { key: 'age', label: '年龄' },
            { key: 'appearance', label: '外貌' }
          ],
          vitalsLabel: '身体状态',
          bars: [
            { key: '体力', label: '体力', max: 100, tone: 'rose' },
            { key: '精力', label: '精力', max: 100, tone: 'cyan' },
            { key: '压力', label: '压力', max: 100, tone: 'amber' }
          ],
          statsLabel: '能力数值', statsTabLabel: '能力',
          ladderLabel: '专业技能', ladder: ['门外汉', '入门', '熟练', '专精', '专家', '权威'],
          entitiesLabel: '人脉关系', npcTabLabel: '人脉', badgeKey: 'relation',
          infoFields: [{ key: 'relation', label: '关系' }, { key: 'personality', label: '性格' }],
          dims: [
            { key: 'trust', deltaKey: 'trustDelta', label: '信任', max: 100, tone: 'cyan' },
            { key: 'favor', deltaKey: 'favorDelta', label: '好感', max: 100, tone: 'rose' },
            { key: 'leverage', deltaKey: 'leverageDelta', label: '把柄', max: 50, tone: 'violet' }
          ],
          npcEmpty: '尚未建立人脉。', bagLabel: '随身物品', bagTabLabel: '物品',
          artsLabel: null
        })
      },
      {
        id: 'campus', name: '校园日常', desc: '学业社团、好感度、轻量数值',
        build: () => presetSchema({
          id: 'campus', name: '校园日常',
          profileFields: [
            { key: 'name', label: '姓名' }, { key: 'race', label: '年级' }, { key: 'class', label: '社团' },
            { key: 'identity', label: '身份' }, { key: 'gender', label: '性别' }, { key: 'age', label: '年龄' },
            { key: 'appearance', label: '外貌' }
          ],
          vitalsLabel: '当前状态',
          bars: [
            { key: '体力', label: '体力', max: 100, tone: 'emerald' },
            { key: '心情', label: '心情', max: 100, tone: 'rose' },
            { key: '学业压力', label: '学业压力', max: 100, tone: 'amber' }
          ],
          statsLabel: '个人能力', statsTabLabel: '能力',
          ladderLabel: '科目掌握', ladder: ['不及格', '及格', '良好', '优秀', '满分'],
          entitiesLabel: '同学与关系', npcTabLabel: '同学',
          dims: [
            { key: 'affection', deltaKey: 'affDelta', label: '好感度', max: 100, tone: 'rose' },
            { key: 'trust', deltaKey: 'trustDelta', label: '信任度', max: 100, tone: 'cyan' },
            { key: 'friendship', deltaKey: 'friendshipDelta', label: '亲密度', max: 100, tone: 'amber' }
          ],
          npcEmpty: '还没有认识什么人。', bagLabel: '随身物品', bagTabLabel: '随身',
          artsLabel: null
        })
      }
    ];

    function getPreset(id) {
      return WORLD_PRESETS.find(p => p.id === id) || null;
    }

    // ===== 蓝图引擎 =====
    const ALLOWED_SECTION_TYPES = ['profile', 'location', 'bars', 'stats', 'tiers', 'tags', 'list', 'entities', 'skills'];

    // 蓝图校验/修复。模型生成或外部导入的蓝图必须先过这里，
    // 畸形结构绝不允许进渲染层（失败则整体回退默认蓝图）。
    function normalizeWorldSchema(raw) {
      const fallback = defaultWorldSchema();
      if (!raw || typeof raw !== 'object') return fallback;

      // id 只保留安全字符：它会被拼进 querySelector，必须杜绝选择器注入
      const safeId = (v, fb) => {
        const s = String(v == null ? '' : v).replace(/[^A-Za-z0-9_-]/g, '');
        return s || fb;
      };

      try {
        const tabs = Array.isArray(raw.tabs) ? raw.tabs : [];
        const cleanTabs = tabs.slice(0, 10).map((tab, ti) => {
          const tabId = safeId(tab && tab.id, `tab${ti}`);
          const sections = (Array.isArray(tab && tab.sections) ? tab.sections : [])
            .filter(s => s && ALLOWED_SECTION_TYPES.includes(s.type))
            .slice(0, 12)
            .map((s, si) => {
              const out = Object.assign({}, s, {
                id: safeId(s.id, `${tabId}_s${si}`),
                label: String(s.label || s.id || '')
              });
              // collapse 只认白名单，非法值直接丢掉（读取时 sectionCollapseOf 还会再兜一层）
              if (out.collapse && !SECTION_COLLAPSE_MODES[out.collapse]) delete out.collapse;
              return out;
            });
          return {
            id: tabId,
            label: String((tab && tab.label) || tabId),
            sections
          };
        }).filter(t => t.sections.length > 0);

        if (cleanTabs.length === 0) return fallback;

        let profileFields = (Array.isArray(raw.profileFields) && raw.profileFields.length
          ? raw.profileFields.slice(0, 12)
          : fallback.profileFields
        ).map(f => {
          const key = String((f && f.key) || '');          const out = { key, label: String((f && f.label) || key || '') };
          // slot / emptyText 是字段的可选属性，必须原样带过：老版这里只保留 key 与 label，
          // 结果世界包一存一读，版式配置就被悄悄抹掉了。
          if (f && PROFILE_SLOTS.indexOf(f.slot) >= 0) out.slot = f.slot;
          if (f && typeof f.emptyText === 'string' && f.emptyText) out.emptyText = String(f.emptyText).slice(0, 24);
          return out;
        })
          .filter(f => f.key);

        if (profileFields.length === 0) profileFields = fallback.profileFields;

        return {
          version: 1,
          preset: String(raw.preset || 'custom'),
          name: String(raw.name || '自定义世界'),
          profileFields,
          creation: (raw.creation && typeof raw.creation === 'object') ? raw.creation : undefined,
          tabs: cleanTabs
        };
      } catch (e) {
        console.warn('[奇点] 世界蓝图校验失败，已回退默认蓝图:', e);
        return fallback;
      }
    }

    function getWorldSchema() {
      const s = AppState.worldSchema;
      if (!s || !Array.isArray(s.tabs) || s.tabs.length === 0) return defaultWorldSchema();
      return s;
    }

    function findSchemaSection(sectionId) {
      const schema = getWorldSchema();
      for (const tab of schema.tabs) {
        for (const sec of (tab.sections || [])) {
          if (sec.id === sectionId) return sec;
        }
      }
      return null;
    }

    // 按类型找第一个 section（蓝图里的 id 可以由模型自定义，不能只认写死的 id）
    function findSectionByType(type) {
      for (const tab of getWorldSchema().tabs) {
        for (const sec of (tab.sections || [])) {
          if (sec.type === type) return sec;
        }
      }
      return null;
    }

    // NPC 关系的数值维度：优先用传入的 section（同一类型可有多个实例），
    // 否则回落到蓝图里第一个 entities section，再回落默认蓝图
    function getNpcDimensions(sec) {
      const own = sec && Array.isArray(sec.dimensions) ? sec.dimensions.filter(d => d && d.key) : null;
      if (own && own.length) return own;
      const found = findSchemaSection('codex') || findSectionByType('entities');
      const dims = found && Array.isArray(found.dimensions) ? found.dimensions.filter(d => d && d.key) : null;
      if (dims && dims.length) return dims;
      const defSec = defaultWorldSchema().tabs.flatMap(t => t.sections).find(s => s.type === 'entities');
      return defSec.dimensions;
    }

    // NPC 的"静态字段"（默认蓝图里是种族 / 性格）与"关系定位"徽章键，同样全部来自蓝图。
    // 与 getNpcDimensions 的关键区别：**只看传进来的那个 section**，不回落到别的同类 section ——
    // 蓝图支持同类型多实例（功法 / 法宝），A 面板声明的字段不该漏到 B 面板去。
    // 只有不传 sec 时才回落到"第一个 entities 面板 → 默认蓝图"。
    function npcEntitiesSection(sec) {
      if (sec) return sec;
      return findSectionByType('entities')
        || defaultWorldSchema().tabs.flatMap(t => t.sections).find(s => s.type === 'entities')
        || null;
    }

    function getNpcInfoFields(sec) {
      const s = npcEntitiesSection(sec);
      const list = (s && Array.isArray(s.infoFields)) ? s.infoFields : [];
      return list
        .filter(f => f && typeof f.key === 'string' && f.key.trim())
        .map(f => ({
          key: f.key.trim(),
          label: (typeof f.label === 'string' && f.label.trim()) ? f.label.trim() : f.key.trim()
        }));
    }

    function getNpcBadgeKey(sec) {
      const s = npcEntitiesSection(sec);
      const k = (s && typeof s.badgeKey === 'string') ? s.badgeKey.trim() : '';
      return k || 'love_type';
    }

    // 一份"静态键"清单给三处共用：applyGameState 收数据、NPC 卡渲染、提示词契约。
    // 以前这三处各写各的（前两处写死 race / personality / love_type），
    // 于是蓝图里一改字段，模型就再也收不到数据、界面永远空着 —— 与当年
    // character_profile 写死 7 个键是同一类病。
    function npcStaticFields(sec) {
      const fields = getNpcInfoFields(sec).slice();
      const badgeKey = getNpcBadgeKey(sec);
      if (!fields.some(f => f.key === badgeKey)) fields.push({ key: badgeKey, label: '关系定位' });
      return fields;
    }

    // 新建 NPC 时的占位文案（沿用改造前界面的措辞），只在蓝图确实声明了这几个键时才用到
    const NPC_STATIC_PLACEHOLDER = { race: '未知', personality: '尚未深入了解', love_type: '未知关系' };

    // 维度色调 → 进度条渐变（蓝图画的是语义色调，具体色值由渲染器负责）
    const NPC_TONE_GRADIENT = {
      rose: 'from-pink-600 to-rose-500',
      cyan: 'from-cyan-600 to-sky-500',
      violet: 'from-purple-600 to-fuchsia-500',
      amber: 'from-amber-600 to-yellow-500',
      emerald: 'from-emerald-600 to-teal-500',
      sky: 'from-sky-600 to-blue-500',
      slate: 'from-slate-600 to-slate-400'
    };

    // 状态条的色调 → 渐变（与原实现保持一致的语义配色，另补几种常用色）
    const BAR_TONE_GRADIENT = {
      rose: 'from-red-600 to-rose-500',
      cyan: 'from-cyan-600 to-sky-500',
      emerald: 'from-emerald-600 to-teal-500',
      amber: 'from-amber-600 to-yellow-500',
      violet: 'from-purple-600 to-fuchsia-500',
      sky: 'from-sky-600 to-blue-500',
      lime: 'from-lime-600 to-green-500',
      slate: 'from-slate-500 to-slate-400'
    };

    // 阶梯等级（熟练度/境界/同步率…）由蓝图定义
    function getLadderLevels(sec) {
      const own = sec && Array.isArray(sec.ladder) ? sec.ladder.filter(Boolean) : null;
      if (own && own.length) return own;
      const found = findSchemaSection('mastery') || findSectionByType('tiers');
      const ladder = found && Array.isArray(found.ladder) ? found.ladder.filter(Boolean) : null;
      if (ladder && ladder.length) return ladder;
      const defSec = defaultWorldSchema().tabs.flatMap(t => t.sections).find(s => s.type === 'tiers');
      return defSec.ladder;
    }

    function escapeRegExp(s) {
      return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // 该 section 是否处于"当前可见"状态（存在 + 所属页签正被激活）
    function isSectionVisible(sectionId) {
      const sec = findSchemaSection(sectionId);
      if (!sec) return false;
      const tab = getWorldSchema().tabs.find(t => (t.sections || []).some(s => s.id === sectionId));
      return !!tab && tab.id === AppState.activeHudTab;
    }

    // 把蓝图应用到 HUD：重建页签栏、显隐与排序 section、套用标题
    function applySchema() {
      const schema = getWorldSchema();
      const tabs = schema.tabs;
      const tabIds = new Set(tabs.map(t => t.id));

      if (!tabIds.has(AppState.activeHudTab)) AppState.activeHudTab = tabs[0].id;
      // 1) 页签栏（数量由蓝图决定，超出可横向滚动）
      const bar = document.getElementById('hudTabBar');
      if (bar) {
        bar.innerHTML = '';
        tabs.forEach(tab => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.dataset.tab = tab.id;
          const active = tab.id === AppState.activeHudTab;
          // flex-1 让少数页签等宽排布（等价于原来的 grid-cols-4），页签多时可横向滚动
          btn.className = `hud-tab-btn flex-1 min-w-[3rem] py-1 font-medium rounded text-center transition whitespace-nowrap ${active ? 'bg-slate-800 text-slate-100 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`;
          btn.textContent = tab.label || tab.id;
          bar.appendChild(btn);
        });
      }

      // 2) 页签面板显隐（有的面板同时就是一个 section）
      document.querySelectorAll('[data-tab-panel]').forEach(panel => {
        const tabId = panel.dataset.tabPanel;
        const secAttr = panel.getAttribute('data-section');
        const visible = tabIds.has(tabId)
          && tabId === AppState.activeHudTab
          && (!secAttr || !!findSchemaSection(secAttr));
        panel.classList.toggle('hidden', !visible);
      });

      // 3) 当前页签内各 section 的显隐（一个 section 可能由多个元素组成）。
      //    非当前页签的 section 不做处理 —— 整块已由其所属面板的 hidden 负责，
      //    逐个加 hidden 只是徒增噪音，还会让结构对比失真。
      document.querySelectorAll('[data-section]').forEach(el => {
        if (el.hasAttribute('data-tab-panel')) return;   // 已在第 2 步处理
        const panel = el.closest('[data-tab-panel]');
        const tabId = panel ? panel.dataset.tabPanel : AppState.activeHudTab;
        if (tabId !== AppState.activeHudTab) return;
        el.classList.toggle('hidden', !findSchemaSection(el.dataset.section));
      });

      // 4) 套用蓝图里的标题
      document.querySelectorAll('[data-section-title]').forEach(el => {
        const sec = findSchemaSection(el.dataset.sectionTitle);
        if (sec && sec.label) el.textContent = sec.label;
      });

      // 5) 按蓝图顺序重排面板内的直接子节点（顺序未变时等同于原地不动）
      tabs.forEach(tab => {
        const panel = document.querySelector(`[data-tab-panel="${tab.id}"]`);
        if (!panel) return;
        const order = new Map((tab.sections || []).map((s, i) => [s.id, i]));
        const kids = Array.from(panel.children);
        const keyed = kids.map((el, i) => {
          const sid = el.getAttribute('data-section');
          const k = (sid !== null && order.has(sid)) ? order.get(sid) : kids.length + i;
          return { el, k, i };
        });
        keyed.sort((a, b) => (a.k - b.k) || (a.i - b.i));
        keyed.forEach(x => panel.appendChild(x.el));
      });
    }

    function switchHudTab(tabKey) {
      AppState.activeHudTab = tabKey;
      applySchema();
      // renderHud 按页签惰性渲染，所以切页签后必须补渲染一次
      renderHud();
    }

    // ===== 蓝图应用与生成 =====

    function applyWorldSchema(schema, opts) {
      const next = normalizeWorldSchema(schema);
      AppState.worldSchema = next;
      // 页签 id 可能全变，回到第一个页签，避免停留在已不存在的页签上
      AppState.activeHudTab = next.tabs[0].id;
      buildHudFromSchema();
      renderHud();
      renderContextPanel();
      saveCurrentSlotToStorage();
      if (!opts || !opts.silent) showToast(`已应用世界蓝图：${next.name}`, 'success');
      return next;
    }

    function applyPresetSchema(presetId, opts) {
      const p = getPreset(presetId);
      if (!p) return null;
      const built = p.build();
      const next = applyWorldSchema(built, opts);
      // 预设同时定义创建规则的属性表，保证派生公式里的变量名真的存在
      if (built.creation && Array.isArray(built.creation.attributes) && built.creation.attributes.length) {
        AppState.wizardConfig.attributes = built.creation.attributes.slice();
        saveCurrentSlotToStorage();
      }
      return next;
    }

    // 把模型返回的蓝图"贴"回骨架：结构（id / type / source）一律以骨架为准，
    // 模型只能改标签、字段定义、维度与阶梯 —— 从代码层面保证 AI 改不坏界面。
    function mergeSchemaOntoSkeleton(parsed, skeleton) {
      const out = JSON.parse(JSON.stringify(skeleton));
      if (!parsed || typeof parsed !== 'object') return out;

      // 标签一律走 textContent 渲染，这里再剥掉尖括号，避免模型塞进来的 HTML 变成可见乱码
      const cleanLabel = (v, max) => String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, max);

      if (parsed.name) out.name = cleanLabel(parsed.name, 40);

      if (Array.isArray(parsed.profileFields) && parsed.profileFields.length) {
        const skelFields = Array.isArray(skeleton.profileFields) ? skeleton.profileFields : [];
        const pf = parsed.profileFields
          .filter(f => f && f.key)
          .slice(0, 12)
          .map(f => {
            const key = cleanLabel(f.key, 24);
            const sk = skelFields.find(s => s && s.key === key) || null;
            const out = { key, label: cleanLabel(f.label || f.key, 16) };

            // slot 属于"内容"（版式），模型可以改；但只认白名单里的四个值，编不出第五个槽位。
            // 模型没提 slot 时沿用骨架里的设置（可能是用户刚在面板里调的），
            // 骨架也没有才退回按 key 推出的老版式 —— 避免"微调一次就把自定义版式冲掉"。
            const slot = String(f.slot == null ? '' : f.slot);
            if (PROFILE_SLOTS.indexOf(slot) >= 0) out.slot = slot;
            else if (sk && PROFILE_SLOTS.indexOf(sk.slot) >= 0) out.slot = sk.slot;
            else out.slot = LEGACY_PROFILE_SLOT[key] || 'field';

            const empty = cleanLabel(f.emptyText, 24) || (sk ? String(sk.emptyText || '') : '');
            if (empty) out.emptyText = empty.slice(0, 24);
            return out;
          })
          .filter(f => f.key);
        if (pf.length) out.profileFields = pf;
      }

      const pTabs = Array.isArray(parsed.tabs) ? parsed.tabs : [];
      out.tabs.forEach((tab, ti) => {
        const pTab = pTabs.find(t => t && t.id === tab.id) || pTabs[ti];
        if (!pTab) return;
        const tabLabel = cleanLabel(pTab.label, 12);
        if (tabLabel) tab.label = tabLabel;

        const pSecs = Array.isArray(pTab.sections) ? pTab.sections : [];
        tab.sections.forEach((sec, si) => {
          const pSec = pSecs.find(s => s && s.id === sec.id) || pSecs[si];
          if (!pSec) return;
          if (typeof pSec.label === 'string') sec.label = cleanLabel(pSec.label, 20);

          if (sec.type === 'entities' && Array.isArray(pSec.dimensions) && pSec.dimensions.length) {
            const dims = pSec.dimensions.filter(d => d && (d.key || d.label)).slice(0, 6).map((d, i) => {
              const key = String(d.key || ('dim' + i)).replace(/[^A-Za-z0-9_]/g, '') || ('dim' + i);
              return {
                key,
                deltaKey: key + 'Delta',
                label: String(d.label || d.key).slice(0, 12),
                max: Number(d.max) > 0 ? Number(d.max) : 100,
                tone: String(d.tone || 'violet').slice(0, 12)
              };
            });
            if (dims.length) sec.dimensions = dims;
          }

          if (sec.type === 'tiers' && Array.isArray(pSec.ladder) && pSec.ladder.length) {
            const ladder = pSec.ladder.map(x => String(x).slice(0, 12)).filter(Boolean).slice(0, 12);
            if (ladder.length) sec.ladder = ladder;
          }

          if (sec.type === 'bars' && Array.isArray(pSec.fields) && pSec.fields.length) {
            const fields = pSec.fields.filter(f => f && (f.key || f.label)).slice(0, 8).map((f, i) => ({
              key: String(f.key || f.label || ('bar' + i)),
              label: String(f.label || f.key).slice(0, 12),
              max: Number(f.max) > 0 ? Number(f.max) : 100,
              tone: String(f.tone || 'violet').slice(0, 12)
            }));
            if (fields.length) sec.fields = fields;
          }
        });
      });

      // creation 段：只允许改"内容"（标签 / 选项 / 占位符 / 投骰参数 / 派生公式），
      // 字段的 key 与 type 仍以骨架为准 —— 与右栏遵循同一条"AI 改内容不改结构"原则
      if (out.creation && parsed.creation && typeof parsed.creation === 'object') {
        const pc = parsed.creation;
        const pFields = (Array.isArray(pc.rows) ? pc.rows : [])
          .flatMap(r => (r && Array.isArray(r.fields)) ? r.fields : []);

        (out.creation.rows || []).forEach((row, ri) => {
          (row.fields || []).forEach((f, fi) => {
            const pf = pFields.find(x => x && x.key === f.key) || pFields[fi];
            if (!pf) return;
            if (pf.label) f.label = cleanLabel(pf.label, 16);
            if (pf.cardLabel) f.cardLabel = cleanLabel(pf.cardLabel, 16);
            if (pf.placeholder) f.placeholder = cleanLabel(pf.placeholder, 80);
            if (f.type === 'select' && Array.isArray(pf.options) && pf.options.length) {
              const opts = pf.options.slice(0, 8).map(o => cleanLabel(o, 12)).filter(Boolean);
              if (opts.length) f.options = opts;
            }
          });
        });

        if (pc.dice && out.creation.dice) {
          const d = out.creation.dice;
          if (pc.dice.label) d.label = cleanLabel(pc.dice.label, 30);
          if (pc.dice.key) d.key = cleanLabel(pc.dice.key, 12);
          const sides = Number(pc.dice.sides);
          if (Number.isFinite(sides) && sides >= 2 && sides <= 100) d.sides = Math.round(sides);
          const base = Number(pc.dice.base);
          if (Number.isFinite(base)) d.base = base;
          if (pc.dice.map && typeof pc.dice.map === 'object') {
            const m = {};
            Object.keys(pc.dice.map).slice(0, 100).forEach(k => {
              const kn = Number(k), v = Number(pc.dice.map[k]);
              if (Number.isFinite(kn) && Number.isFinite(v)) m[kn] = v;
            });
            if (Object.keys(m).length) d.map = m;
          }
        }

        if (Array.isArray(pc.derived) && pc.derived.length) {
          const list = pc.derived.slice(0, 6)
            .filter(x => x && (x.label || x.formula))
            .map((x, i) => {
              const lb = cleanLabel(x.label || ('数值' + (i + 1)), 12);
              return {
                label: lb,
                cardLabel: cleanLabel(x.cardLabel || lb, 12),
                tone: cleanLabel(x.tone || 'violet', 12) || 'violet',
                // 公式交给 evalFormula 安全求值（纯算术，无副作用）
                formula: String(x.formula == null ? '0' : x.formula).slice(0, 80)
              };
            });
          if (list.length) out.creation.derived = list;
        }
      }

      return out;
    }

    function parseLooseJson(raw) {
      let parsed = null;
      const block = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (block) { try { parsed = JSON.parse(block[1].trim()); } catch (e) { /* 继续尝试 */ } }
      if (!parsed) {
        const direct = raw.match(/\{[\s\S]*\}/);
        if (direct) { try { parsed = JSON.parse(direct[0]); } catch (e) { /* 交给调用方报错 */ } }
      }
      return parsed;
    }

    // 让模型依据世界观设定，在预设骨架上微调出专属蓝图。
    // 返回的是"骨架结构 + 模型内容"，因此无论模型多离谱都不会破坏界面。
    async function generateWorldSchemaWithApi(presetId) {
      if (!hasApiCredential()) {
        showToast('请先配置 API Key 才能让 AI 生成蓝图', 'error');
        document.getElementById('openApiSettingsBtn').click();
        throw new Error('NO_API_KEY');
      }
      const loreFull = (AppState.lore.world || '').trim();
      if (!loreFull) {
        showToast('请先在左侧填写「世界法则 / 模组背景设定」', 'info');
        throw new Error('NO_LORE');
      }
      // 以前这里静默截断到 12000 字（比分析那条 30000 还短），长设定只生效一半却毫无提示
      if (loreFull.length > LORE_PROMPT_LIMIT) {
        showToast(`世界观共 ${loreFull.length} 字，超出单次上限，本次仅用前 ${LORE_PROMPT_LIMIT} 字`, 'info');
      }
      const lore = loreFull.slice(0, LORE_PROMPT_LIMIT);

      const base = (getPreset(presetId) || getPreset('generic-fantasy')).build();

      const prompt = `你是 TRPG 系统设计师。下面给你一个「世界蓝图」骨架 JSON，请依据世界观设定把它改造成最贴合该世界的版本。

改造规则（务必遵守）：
1. 只能修改这些内容：tabs[].label、sections[].label、profileFields、entities 的 dimensions、tiers 的 ladder、bars 的 fields。
2. 严禁改动任何 id、type、source 字段，也不要增删页签或 section —— 结构必须与骨架完全一致。
3. dimensions：key 用简短英文标识，label 用中文；数量 2~5 个；max 为整数；tone 从 rose/cyan/violet/amber/emerald/sky/slate 中选。
4. bars.fields 同理，label 用该世界真正会消耗的资源名。
5. ladder 为阶梯等级名称数组，6~9 项，从低到高。
6. 若某概念在该世界不存在（例如没有法术），保留结构，把 label 改成该世界最接近的说法；实在没有对应就把 label 设为空字符串。
7. profileFields：可以改 label、emptyText（字段没数据时显示的占位文字），以及每个字段的 slot
   来决定它摆在角色卡的什么位置 —— title（顶部大标题）/ badge（徽章）/ field（两列小格）/
   appearance（底部外貌长文段）。不要增删字段，也不要改 key；slot 只能从这四个值里选。
8. creation 段：可以改各字段的 label / cardLabel / placeholder、select 字段的 options、
   dice 的 label / key / sides / base / map、以及 derived 各项的 label / formula（公式只能用
   数字、属性名与 + - * / ( ) 以及 min/max/floor/ceil/round/abs）。
   不得改动字段的 key 与 type，也不要增删字段。
9. 只输出一个合法 JSON 对象，不要任何解释、注释或代码块之外的文字。

【世界观设定】
${lore}

【蓝图骨架】
${JSON.stringify(base, null, 2)}`;

      const raw = await callLlmApi(
        [{ role: 'user', text: prompt }],
        '你是严谨的 TRPG 系统设计师，只输出符合要求的合法 JSON，不做任何额外解释。'
      );

      const parsed = parseLooseJson(raw || '');
      if (!parsed) throw new Error('未能从模型返回中解析出蓝图 JSON');

      const merged = mergeSchemaOntoSkeleton(parsed, base);
      const applied = applyWorldSchema(merged, { silent: true });
      showToast(`AI 已生成专属蓝图：${applied.name}`, 'success');
      return applied;
    }

    function renderPresetGrid() {
      const grid = document.getElementById('presetGrid');
      if (!grid) return;
      grid.innerHTML = '';
      WORLD_PRESETS.forEach(p => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.preset = p.id;
        const active = p.id === schemaModalPresetId;
        btn.className = `p-2 rounded-xl border text-left transition ${active ? 'border-purple-500 bg-purple-950/30' : 'border-slate-800 bg-slate-950 hover:border-slate-700'}`;

        const t = document.createElement('div');
        t.className = 'text-[11px] font-semibold text-slate-200';
        t.textContent = p.name;

        const d = document.createElement('div');
        d.className = 'text-[10px] text-slate-500 mt-0.5 leading-snug';
        d.textContent = p.desc;

        btn.append(t, d);
        grid.appendChild(btn);
      });
    }

    function renderSchemaModal() {
      // 编辑用的副本：所有结构操作先改副本，再整体提交
      schemaDraft = JSON.parse(JSON.stringify(getWorldSchema()));
      const schema = schemaDraft;
      const badge = document.getElementById('schemaCurrentBadge');
      if (badge) badge.textContent = schema.name || schema.preset || '自定义';
      const ta = document.getElementById('schemaJsonTextarea');
      if (ta) ta.value = JSON.stringify(schema, null, 2);
      renderPresetGrid();
      renderSchemaTree();
      renderProfileTree();
      renderCreationTree();
    }

    // ---- 结构编辑器：增删面板 / 改名 / 排序 ----
    function defaultSectionFor(type, index) {
      const id = 'sec' + Date.now().toString(36) + index;
      const base = { id, type, label: SECTION_TYPE_LABELS[type] || type };
      const src = 'custom_' + id;
      if (type === 'list') return Object.assign(base, { source: src, layout: 'cards', emptyText: '暂无内容' });
      if (type === 'entities') {
        return Object.assign(base, {
          source: src, badgeKey: 'relation',
          dimensions: [{ key: 'trust', deltaKey: 'trustDelta', label: '信任', max: 100, tone: 'cyan' }],
          emptyText: '暂无记录'
        });
      }
      if (type === 'tiers') return Object.assign(base, { source: src, ladder: ['未入门', '入门', '熟练', '精通', '大师'], emptyText: '暂无记录' });
      if (type === 'bars') return Object.assign(base, { source: src, fields: [{ key: 'hp', label: '生命', max: 100, tone: 'rose' }] });
      if (type === 'tags') return Object.assign(base, { source: src, emptyText: '正常' });
      if (type === 'stats') return Object.assign(base, { source: 'attributes', radar: true });
      if (type === 'skills') return Object.assign(base, { source: 'skills', emptyText: '暂无技能记录' });
      return base;   // profile / location 无 source
    }

    // ---- 编辑器通用的拖拽排序 ----
    // 三个编辑器（结构 / 角色卡版式 / 创建表单）原本只有 ↑↓ 按钮。这里加一层通用拖拽：
    // 行用 data-drag-row 标记，把一行拖到另一行上，就移动到那一行的位置。
    //
    // 刻意保留 ↑↓ 按钮而不是"取代"：键盘与无鼠标场景仍然需要它们，
    // 而且 jsdom 没有布局，拖拽的命中判定与视觉反馈只能靠人眼验证 ——
    // 按钮才是可被自动化测试覆盖的那条路。两条路共用同一份重排逻辑。
    //
    // 只允许在同一个父容器内换位（创建表单里就是"同一字段行之内"）。
    function enableDragReorder(box, onReorder) {
      if (!box) return;
      let dragRow = null;

      const rowFrom = (target) => {
        if (!target || typeof target.closest !== 'function') return null;
        const row = target.closest('[data-drag-row]');
        return (row && box.contains(row)) ? row : null;
      };
      const siblingsOf = (row) => [...row.parentElement.children].filter(c => c.hasAttribute('data-drag-row'));

      box.addEventListener('dragstart', (e) => {
        const row = rowFrom(e.target);
        if (!row) return;
        dragRow = row;
        row.classList.add('opacity-50');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          // 有些环境不 setData 就不肯真的开始拖拽
          try { e.dataTransfer.setData('text/plain', ''); } catch (err) { /* 忽略 */ }
        }
      });

      box.addEventListener('dragover', (e) => {
        const row = rowFrom(e.target);
        if (!dragRow || !row || row === dragRow) return;
        if (row.parentElement !== dragRow.parentElement) return;
        // 不 preventDefault 就永远不会触发 drop
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      });

      box.addEventListener('drop', (e) => {
        const from = dragRow;
        const row = rowFrom(e.target);
        dragRow = null;
        if (from) from.classList.remove('opacity-50');
        if (!from || !row || row === from) return;
        const parent = from.parentElement;
        if (!parent || row.parentElement !== parent) return;
        e.preventDefault();
        const list = siblingsOf(from);
        const fi = list.indexOf(from);
        const ti = list.indexOf(row);
        if (fi < 0 || ti < 0 || fi === ti) return;
        onReorder(fi, ti, parent);
      });

      box.addEventListener('dragend', () => {
        if (dragRow) dragRow.classList.remove('opacity-50');
        dragRow = null;
      });
    }

    // 数组内换位：把 from 处的元素挪到 to 处（与 ↑↓ 按钮用的是同一套语义）
    function moveInArray(arr, from, to) {
      if (!Array.isArray(arr)) return false;
      if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return false;
      arr.splice(to, 0, arr.splice(from, 1)[0]);
      return true;
    }

    function markDraggable(row) {
      row.setAttribute('data-drag-row', '1');
      row.draggable = true;
      row.classList.add('cursor-grab');
      return row;
    }

    function renderSchemaTree() {
      const box = document.getElementById('schemaTree');
      if (!box || !schemaDraft) return;
      box.innerHTML = '';

      const mkBtn = (label, action, extra) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.act = action;
        if (extra) Object.entries(extra).forEach(([k, v]) => { b.dataset[k] = String(v); });
        b.className = 'px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] leading-none';
        b.textContent = label;
        return b;
      };

      schemaDraft.tabs.forEach((tab, ti) => {
        const tabBox = document.createElement('div');
        tabBox.className = 'p-2 rounded-lg bg-slate-900/60 border border-slate-800 space-y-1.5';
        tabBox.dataset.ti = String(ti);   // 拖拽排序时用来定位是哪个页签

        const head = document.createElement('div');
        head.className = 'flex items-center gap-1.5';

        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.value = tab.label || '';
        labelInput.dataset.act = 'rename-tab';
        labelInput.dataset.ti = String(ti);
        labelInput.className = 'flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-[11px]';
        head.appendChild(labelInput);

        head.appendChild(mkBtn('＋面板', 'add-sec', { ti }));
        head.appendChild(mkBtn('✕', 'del-tab', { ti }));
        tabBox.appendChild(head);

        (tab.sections || []).forEach((sec, si) => {
          const row = document.createElement('div');
          row.className = 'flex items-center gap-1.5 pl-3';
          markDraggable(row);

          const typeTag = document.createElement('span');
          typeTag.className = 'text-[9px] px-1.5 py-0.5 rounded bg-purple-950/70 text-purple-300 border border-purple-800/60 shrink-0 w-16 text-center';
          typeTag.textContent = SECTION_TYPE_LABELS[sec.type] || sec.type;
          row.appendChild(typeTag);

          const secInput = document.createElement('input');
          secInput.type = 'text';
          secInput.value = sec.label || '';
          secInput.dataset.act = 'rename-sec';
          secInput.dataset.ti = String(ti);
          secInput.dataset.si = String(si);
          secInput.dataset.sid = sec.id;
          secInput.className = 'flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-[11px]';
          row.appendChild(secInput);

          // 折叠方式：不折叠 / 逐项折叠 / 整块折叠（逐项只对 entities 有意义）
          const collapseSel = document.createElement('select');
          collapseSel.dataset.act = 'sec-collapse';
          collapseSel.dataset.ti = String(ti);
          collapseSel.dataset.si = String(si);
          collapseSel.className = 'bg-slate-950 border border-slate-800 rounded px-1 py-1 text-slate-300 text-[10px] shrink-0';
          collapseSel.title = '折叠方式：整块折叠会只留标题行，点标题展开';
          // 「逐项折叠」只有 entities 真正实现，别的面板就别给这个选项了
          const modeChoices = (sec.type === 'entities')
            ? SECTION_COLLAPSE_SHORT
            : { none: SECTION_COLLAPSE_SHORT.none, section: SECTION_COLLAPSE_SHORT.section };
          Object.entries(modeChoices).forEach(([v, l]) => {
            const o = document.createElement('option');
            o.value = v; o.textContent = l;
            if (sectionCollapseOf(sec) === v) o.selected = true;
            collapseSel.appendChild(o);
          });
          row.appendChild(collapseSel);

          row.appendChild(mkBtn('↑', 'sec-up', { ti, si }));
          row.appendChild(mkBtn('↓', 'sec-down', { ti, si }));
          row.appendChild(mkBtn('✕', 'del-sec', { ti, si }));
          tabBox.appendChild(row);
        });

        box.appendChild(tabBox);
      });

      // 每个页签末尾的"添加面板"需要一个类型选择
      const pickerRow = document.createElement('div');
      pickerRow.className = 'flex items-center gap-1.5 pt-1';
      const picker = document.createElement('select');
      picker.id = 'addSectionType';
      picker.className = 'flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-[11px]';
      Object.entries(SECTION_TYPE_LABELS).forEach(([v, l]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = l;
        picker.appendChild(o);
      });
      pickerRow.appendChild(picker);
      const addBtn = mkBtn('＋ 添加到最后一个页签', 'add-sec-last', {});
      addBtn.className = 'px-2 py-1 rounded bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 text-[10px]';
      pickerRow.appendChild(addBtn);
      box.appendChild(pickerRow);
    }

    // ---- 角色卡字段版式编辑器（slot）----
    function renderProfileTree() {
      const box = document.getElementById('profileTree');
      if (!box || !schemaDraft) return;
      box.innerHTML = '';
      const fields = Array.isArray(schemaDraft.profileFields) ? schemaDraft.profileFields : [];

      const mkBtn = (label, action, extra, cls) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.act = action;
        if (extra) Object.entries(extra).forEach(([k, v]) => { b.dataset[k] = String(v); });
        b.className = cls || 'px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] leading-none';
        b.textContent = label;
        return b;
      };
      const mkInput = (value, action, extra, cls, ph) => {
        const el = document.createElement('input');
        el.type = 'text';
        el.value = value == null ? '' : String(value);
        el.dataset.act = action;
        if (extra) Object.entries(extra).forEach(([k, v]) => { el.dataset[k] = String(v); });
        el.className = cls || 'flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-[11px]';
        if (ph) el.placeholder = ph;
        return el;
      };

      if (!fields.length) {
        const tip = document.createElement('div');
        tip.className = 'text-[10px] text-slate-500';
        tip.textContent = '当前蓝图没有角色卡字段，将使用默认字段。';
        box.appendChild(tip);
      }

      fields.forEach((f, fi) => {
        const rowBox = document.createElement('div');
        rowBox.className = 'p-2 rounded-lg bg-slate-900/60 border border-slate-800 space-y-1.5';
        markDraggable(rowBox);

        const line = document.createElement('div');
        line.className = 'flex items-center gap-1.5';

        const sel = document.createElement('select');
        sel.dataset.act = 'p-slot';
        sel.dataset.fi = String(fi);
        sel.className = 'bg-slate-950 border border-slate-800 rounded px-1 py-1 text-slate-300 text-[10px] shrink-0';
        Object.entries(PROFILE_SLOT_LABELS).forEach(([v, l]) => {
          const o = document.createElement('option');
          o.value = v; o.textContent = l;
          if (profileSlotOf(f) === v) o.selected = true;
          sel.appendChild(o);
        });
        line.appendChild(sel);
        line.appendChild(mkInput(f.label, 'p-rename', { fi }));
        line.appendChild(mkBtn('↑', 'p-up', { fi }));
        line.appendChild(mkBtn('↓', 'p-down', { fi }));
        line.appendChild(mkBtn('✕', 'p-del', { fi }));
        rowBox.appendChild(line);

        const line2 = document.createElement('div');
        line2.className = 'flex items-center gap-1.5 pl-2';
        const keyTag = document.createElement('span');
        keyTag.className = 'text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/60 font-mono shrink-0';
        keyTag.textContent = f.key;
        keyTag.title = '数据键：模型输出 character_profile 时用的键名，不可更改';
        line2.appendChild(keyTag);
        line2.appendChild(mkInput(f.emptyText || '', 'p-empty', { fi },
          'flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-500 text-[10px]',
          '无数据时显示的占位文字'));
        rowBox.appendChild(line2);

        box.appendChild(rowBox);
      });

      const addRow = document.createElement('div');
      addRow.className = 'flex items-center gap-1.5';
      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.id = 'addProfileKey';
      keyInput.placeholder = '英文键名';
      keyInput.className = 'w-24 shrink-0 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-[11px]';
      addRow.appendChild(keyInput);
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.id = 'addProfileLabel';
      labelInput.placeholder = '显示名称';
      labelInput.className = 'flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-[11px]';
      addRow.appendChild(labelInput);
      addRow.appendChild(mkBtn('＋ 添加字段', 'p-add', {}, 'px-2 py-1 rounded bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 text-[10px] shrink-0'));
      box.appendChild(addRow);

      const tip = document.createElement('div');
      tip.className = 'text-[10px] text-slate-500 leading-relaxed';
      tip.textContent = '列表顺序决定同槽位内的先后（第 3 个徽章固定在右上角）。新增字段后，模型会按该键名填充数据。';
      box.appendChild(tip);
    }

    // ---- 创建表单结构编辑器 ----
    const CREATION_TYPES = { text: '文本', number: '数字', select: '下拉', textarea: '长文本', chips: '胶囊' };
    const CHIP_SOURCES = { races: '种族', classes: '职业', identities: '身份' };
    const DICE_FACES = [4, 6, 8, 10, 12, 20];

    function defaultCreationFieldFor(type, index) {
      const key = 'f' + Date.now().toString(36) + index;
      const base = { key, label: (CREATION_TYPES[type] || '字段') + (index + 1), type };
      if (type === 'chips') return Object.assign(base, { source: 'races' });
      if (type === 'select') return Object.assign(base, { options: ['选项一', '选项二'] });
      if (type === 'number') return Object.assign(base, { value: 1 });
      if (type === 'textarea') return Object.assign(base, { rows: 2, placeholder: '' });
      return Object.assign(base, { placeholder: '' });
    }

    function renderCreationTree() {
      const box = document.getElementById('creationTree');
      if (!box) return;
      box.innerHTML = '';
      const creation = (schemaDraft && schemaDraft.creation) || null;

      if (!creation) {
        const tip = document.createElement('div');
        tip.className = 'text-[10px] text-slate-500';
        tip.textContent = '当前蓝图没有 creation 段，将使用默认创建表单。';
        box.appendChild(tip);
        return;
      }

      const mkBtn = (label, action, extra, cls) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.act = action;
        if (extra) Object.entries(extra).forEach(([k, v]) => { b.dataset[k] = String(v); });
        b.className = cls || 'px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] leading-none';
        b.textContent = label;
        return b;
      };
      const mkInput = (value, action, extra, cls) => {
        const el = document.createElement('input');
        el.type = 'text';
        el.value = value == null ? '' : String(value);
        el.dataset.act = action;
        if (extra) Object.entries(extra).forEach(([k, v]) => { el.dataset[k] = String(v); });
        el.className = cls || 'flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-[11px]';
        return el;
      };

      // 1) 字段行
      (creation.rows || []).forEach((row, ri) => {
        const rowBox = document.createElement('div');
        rowBox.className = 'p-2 rounded-lg bg-slate-900/60 border border-slate-800 space-y-1.5';
        rowBox.dataset.ri = String(ri);   // 拖拽排序时用来定位是第几个字段行

        const head = document.createElement('div');
        head.className = 'flex items-center gap-1.5';
        const colsInput = mkInput(row.cols || 'grid-cols-1', 'c-cols', { ri }, 'flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-400 font-mono text-[10px]');
        head.appendChild(colsInput);
        head.appendChild(mkBtn('＋项', 'c-add-field', { ri }));
        head.appendChild(mkBtn('✕行', 'c-del-row', { ri }));
        rowBox.appendChild(head);

        (row.fields || []).forEach((f, fi) => {
          const line = document.createElement('div');
          line.className = 'flex items-center gap-1.5 pl-2';
          markDraggable(line);

          const typeTag = document.createElement('span');
          typeTag.className = 'text-[9px] px-1.5 py-0.5 rounded bg-cyan-950/70 text-cyan-300 border border-cyan-800/60 shrink-0 w-12 text-center';
          typeTag.textContent = CREATION_TYPES[f.type] || f.type;
          line.appendChild(typeTag);

          line.appendChild(mkInput(f.label, 'c-rename', { ri, fi }));

          if (f.type === 'chips') {
            const sel = document.createElement('select');
            sel.dataset.act = 'c-source';
            sel.dataset.ri = String(ri);
            sel.dataset.fi = String(fi);
            sel.className = 'bg-slate-950 border border-slate-800 rounded px-1 py-1 text-slate-300 text-[10px] shrink-0';
            Object.entries(CHIP_SOURCES).forEach(([v, l]) => {
              const o = document.createElement('option');
              o.value = v; o.textContent = l;
              if ((f.source || 'races') === v) o.selected = true;
              sel.appendChild(o);
            });
            line.appendChild(sel);
          }

          line.appendChild(mkBtn('↑', 'c-up', { ri, fi }));
          line.appendChild(mkBtn('↓', 'c-down', { ri, fi }));
          line.appendChild(mkBtn('✕', 'c-del-field', { ri, fi }));
          rowBox.appendChild(line);

          // 第二行：select 的选项内容 / 文本类的占位提示。
          // 以前这两样只能去 JSON 里改，而"选项有哪些"恰恰是最高频的调整。
          const editable = (f.type === 'select') ? 'options'
            : ((f.type === 'text' || f.type === 'textarea') ? 'placeholder' : null);
          if (editable) {
            const line2 = document.createElement('div');
            line2.className = 'flex items-center gap-1.5 pl-2';

            const tag = document.createElement('span');
            tag.className = 'text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/60 shrink-0 w-12 text-center';
            tag.textContent = editable === 'options' ? '选项' : '占位';
            tag.title = editable === 'options'
              ? '下拉选项，用逗号分隔'
              : '输入框里显示的灰色提示文字';
            line2.appendChild(tag);

            if (editable === 'options') {
              line2.appendChild(mkInput((f.options || []).join('，'), 'c-options', { ri, fi },
                'flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-[10px]'));
            } else {
              line2.appendChild(mkInput(f.placeholder || '', 'c-placeholder', { ri, fi },
                'flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-400 text-[10px]'));
            }
            rowBox.appendChild(line2);
          } else if (f.type === 'chips') {
            const hint = document.createElement('div');
            hint.className = 'text-[9px] text-slate-500 pl-2';
            hint.textContent = '胶囊内容来自「创建配置」里的种族 / 职业 / 身份列表';
            rowBox.appendChild(hint);
          }
        });

        box.appendChild(rowBox);
      });

      // 添加字段 / 行
      const addRow = document.createElement('div');
      addRow.className = 'flex items-center gap-1.5';
      const typeSel = document.createElement('select');
      typeSel.id = 'addCreationType';
      typeSel.className = 'flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-[11px]';
      Object.entries(CREATION_TYPES).forEach(([v, l]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = l;
        typeSel.appendChild(o);
      });
      addRow.appendChild(typeSel);
      addRow.appendChild(mkBtn('＋ 添加创建项', 'c-add-field-last', {}, 'px-2 py-1 rounded bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 text-[10px]'));
      addRow.appendChild(mkBtn('＋ 新字段行', 'c-add-row', {}, 'px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]'));
      box.appendChild(addRow);

      // 2) 投骰
      const dice = creation.dice;
      if (dice) {
        const dBox = document.createElement('div');
        dBox.className = 'p-2 rounded-lg bg-slate-900/60 border border-slate-800 space-y-1.5';
        const t = document.createElement('div');
        t.className = 'text-[10px] text-slate-400 font-semibold';
        t.textContent = '投骰项';
        dBox.appendChild(t);

        const line = document.createElement('div');
        line.className = 'flex items-center gap-1.5';
        line.appendChild(mkInput(dice.label, 'c-dice-label', {}, 'flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-[11px]'));

        const keyInput = mkInput(dice.key, 'c-dice-key', {}, 'w-16 shrink-0 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-300 text-[11px]');
        keyInput.title = '结果并入属性的名称';
        line.appendChild(keyInput);

        const faceSel = document.createElement('select');
        faceSel.dataset.act = 'c-dice-sides';
        faceSel.className = 'bg-slate-950 border border-slate-800 rounded px-1 py-1 text-slate-300 text-[10px] shrink-0';
        DICE_FACES.forEach(n => {
          const o = document.createElement('option');
          o.value = String(n); o.textContent = 'D' + n;
          if (Number(dice.sides) === n) o.selected = true;
          faceSel.appendChild(o);
        });
        line.appendChild(faceSel);
        dBox.appendChild(line);
        box.appendChild(dBox);
      }

      // 3) 派生初始数值
      const derived = creation.derived || [];
      const vBox = document.createElement('div');
      vBox.className = 'p-2 rounded-lg bg-slate-900/60 border border-slate-800 space-y-1.5';
      const vt = document.createElement('div');
      vt.className = 'text-[10px] text-slate-400 font-semibold';
      vt.textContent = '初始数值（公式可引用属性名，支持 + - * / ( ) 与 min/max/floor）';
      vBox.appendChild(vt);

      derived.forEach((d, di) => {
        const line = document.createElement('div');
        line.className = 'flex items-center gap-1.5';
        line.appendChild(mkInput(d.label, 'c-drv-label', { di }, 'w-20 shrink-0 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-[11px]'));

        const eq = document.createElement('span');
        eq.className = 'text-slate-500 text-[11px]';
        eq.textContent = '=';
        line.appendChild(eq);

        line.appendChild(mkInput(d.formula, 'c-drv-formula', { di }, 'flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-amber-200/90 font-mono text-[11px]'));
        line.appendChild(mkBtn('✕', 'c-drv-del', { di }));
        vBox.appendChild(line);
      });

      vBox.appendChild(mkBtn('＋ 添加初始数值', 'c-drv-add', {}, 'px-2 py-1 rounded bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 text-[10px]'));
      box.appendChild(vBox);
    }

    function commitSchemaDraft() {
      if (!schemaDraft) return;
      applyWorldSchema(schemaDraft, { silent: true });
      const ta = document.getElementById('schemaJsonTextarea');
      if (ta) ta.value = JSON.stringify(getWorldSchema(), null, 2);
      const badge = document.getElementById('schemaCurrentBadge');
      if (badge) badge.textContent = getWorldSchema().name || '自定义';
      renderSchemaTree();
      renderProfileTree();
      renderCreationTree();
    }

    // 蓝图里所有 section 的数据键（用于提示词契约 + game_state 落库）
    function collectSchemaSources() {
      const out = [];
      getWorldSchema().tabs.forEach(tab => (tab.sections || []).forEach(sec => {
        if (sec && sec.source) out.push({ source: sec.source, type: sec.type, label: sec.label, sec });
      }));
      return out;
    }

    // 已由专用逻辑处理的键（走原有解析/合并流程，不能被通用落库覆盖）
    const HANDLED_SOURCES = new Set([
      'character_profile', 'location', 'time', 'bars', 'attributes', 'attribute_cap',
      'weapon_mastery', 'npc_codex', 'spells', 'skills', 'status_effects',
      'inventory'
    ]);

    // 依蓝图生成数据契约：这样新增的面板才会真的从模型拿到数据
    function buildSchemaDataContract() {
      const srcs = collectSchemaSources()
        .filter(s => !['profile', 'location', 'skills'].includes(s.type));

      const seen = new Set();
      const lines = [];
      srcs.forEach(s => {
        if (HANDLED_SOURCES.has(s.source) || seen.has(s.source)) return;
        seen.add(s.source);
        const label = s.label || s.source;
        if (s.type === 'bars') lines.push(`- ${s.source}: 数组 [{label,current,max,color}]　（${label}）`);
        else if (s.type === 'tags') lines.push(`- ${s.source}: 数组 [{name,type,desc}]，type 取 buff/debuff/neutral　（${label}）`);
        else if (s.type === 'tiers') lines.push(`- ${s.source}: 对象 {"名称":{level,exp}}，level 必须取自该面板的阶梯名称　（${label}）`);
        else if (s.type === 'entities') {
          const keys = ['name'].concat(npcStaticFields(s).map(f => f.key));
          lines.push(`- ${s.source}: 数组 [{${keys.join(',')}}]　（${label}）`);
        }
        else if (s.type === 'list') {
          const extra = [s.sec.tagKey, s.sec.costKey].filter(Boolean).join(',');
          lines.push(`- ${s.source}: 数组 [{name${extra ? ',' + extra : ''},desc}]　（${label}）`);
        }
      });

      if (!lines.length) return '';
      return '【本世界专属数据键】\n' +
        '本世界蓝图额外声明了下列数据键，必须出现在 game_state 中（没有内容时给空数组/空对象）：\n' +
        lines.join('\n');
    }

    function buildVitalsContract() {
      const sec = findSchemaSection('vitals') || findSectionByType('bars');
      const fields = (sec && Array.isArray(sec.fields)) ? sec.fields.filter(f => f && (f.label || f.key)) : [];
      if (!fields.length) return '';
      const list = fields
        .map(f => `${f.label || f.key}（上限 ${Number(f.max) || 100}，color: ${f.tone || 'violet'}）`)
        .join('；');
      return '【本世界固定状态条】\n' +
        '必须始终在 game_state 的 bars 中输出以下状态条，名称与上限不得改动：\n' + list;
    }

    // 角色卡字段同样必须由蓝图派生：否则蓝图里新增或改名的字段永远不会被模型填充，
    // 界面上就出现"永远显示空占位"的死字段（和当年四个 HUD 页签全空白是同一类问题）。
    function schemaProfileFields() {
      return (getWorldSchema().profileFields || []).filter(f => f && f.key);
    }

    // game_state.character_profile 的示例对象：键取自蓝图，值用字段标签当占位说明
    function buildProfileExample() {
      const out = {};
      schemaProfileFields().forEach(f => { out[f.key] = f.label || f.key; });
      return out;
    }

    // 说明：以前还有个 buildProfileFieldList()，用来在正文里罗列「角色卡区块」的字段行。
    // 正文不再要求输出机制清单（数值全部走 game_state.character_profile）后它成了死代码。
    // 角色卡字段的蓝图派生仍由 buildProfileExample() 承担，界面渲染另走 slot 布局。

    // game_state 里 npc_codex 的示例：静态字段 + 蓝图声明的每个关系维度（含变动键）。
    // 关系数值以前**只能**从正文的「情感状态列表」解析（§4.2），所以正文里必须留一块
    // 机制清单、与【叙事口吻】正面冲突；现在数值直接走数据块，正文彻底不用写机制。
    // 键名仍然全部由蓝图派生：蓝图里改维度名/增删维度，契约与界面同步跟着变。
    function buildNpcCodexExample() {
      const out = buildNpcStaticExample();
      const samples = [50, 40, 20, 30];
      getNpcDimensions().forEach((d, i) => {
        out[d.key] = samples[i % samples.length];
        out[d.deltaKey || (d.key + 'Delta')] = i === 0 ? 2 : 0;
      });
      return out;
    }

    // game_state 里 npc_codex 的静态字段示例：键与标签同样取自蓝图。
    // 写死的话，蓝图新增的静态字段（势力 / 物种 / 态度…）模型永远不知道要输出，
    // 界面上就是永远空的格子 —— 与当年 character_profile 写死 7 个键是同一类病。
    function buildNpcStaticExample() {
      const out = { name: '角色名' };
      npcStaticFields().forEach(f => { out[f.key] = f.label; });
      return out;
    }

    // 把当前 HUD 数值压成一段紧凑文本塞进 system prompt。
    // 以前模型完全看不到 HUD，只能靠正文里的角色卡区块自己推，长团必然数值漂移。
    function buildHudDigest() {
      const hud = AppState.hudState || {};
      const lines = [];
      const p = hud.character_profile || {};
      if (p.name) lines.push(`角色：${p.name}（${p.race || '?'} / ${p.class || '?'} / ${p.identity || '?'}）`);

      if (Array.isArray(hud.bars) && hud.bars.length) {
        lines.push('状态条：' + hud.bars.map(b => `${b.label} ${b.current}/${b.max}`).join('，'));
      }

      const attrs = hud.attributes || {};
      const attrKeys = Object.keys(attrs);
      if (attrKeys.length) {
        lines.push('属性：' + attrKeys.map(k => {
          const v = attrs[k];
          return `${k} ${(v && typeof v === 'object') ? (v.current ?? '?') : v}`;
        }).join('，'));
      }

      const inv = (hud.inventory || []).map(i => {
        if (typeof i === 'string') return i;
        return `${i.name || '?'}${Number(i.qty) > 1 ? '×' + i.qty : ''}`;
      });
      if (inv.length) lines.push('行囊：' + inv.join('，'));

      const spells = (hud.spells || []).map(s => (typeof s === 'string' ? s : `${s.name || '?'}(${Number(s.mp) || 0}MP)`));
      if (spells.length) lines.push('法术：' + spells.join('，'));

      const known = hud.skills && Array.isArray(hud.skills.known) ? hud.skills.known : [];
      if (known.length) lines.push('已掌握技能：' + known.join('，'));

      const effects = (hud.status_effects || []).map(s => (typeof s === 'string' ? s : (s.name || '?')));
      if (effects.length) lines.push('当前状态效果：' + effects.join('，'));

      // 维度名称同样走蓝图：写死"好感/信任/深度"时，自定义蓝图（信任/畏惧/人情债）
      // 会把错误的标签交给模型，还会漏掉一半维度
      const npcDims = getNpcDimensions();
      const npcs = (hud.npc_codex || []).slice(0, 15).map(n => {
        const parts = npcDims.map(d => `${d.label}${Number(n[d.key]) || 0}`).join('/');
        return parts ? `${n.name}（${parts}）` : String(n.name);
      });
      if (npcs.length) lines.push('已知 NPC 关系：' + npcs.join('，'));

      if (hud.location) lines.push(`当前地点：${hud.location}`);
      if (hud.time) lines.push(`当前时间：${hud.time}`);
      return lines.join('\n');
    }

    // 默认的沉浸式口语叙事与教练规则。
    // 用户在左栏填写自定义规则时会整体替换此默认值。
    const DEFAULT_GM_RULES = [
      '【核心口语教学与沉浸式叙事准则】',
      '1. 沉浸式情境英语推演：',
      '   · NPC 对话与核心情境互动使用自然、地道的现代英语（匹配学习者 CEFR 等级），环境铺垫可辅以简练中文说明以降低认知负荷。',
      '   · 对话要像母语者在真实职场、校园或跨文化场景中的交流，有真实语气、情绪反应与潜台词。',
      '   · 在正文中用 Markdown 加粗（**核心短语/习语**）标注 1~2 个值得顺便习得的地道表达。',
      '2. AI 口语导师（按需触发，严禁在正文中直接剧透建议）：',
      '   · 正常对话回合中，只输出纯粹的剧中人物对话与情境描写，不要直接给出 AI 纠错建议或下一轮回复示范，把独立开口思考的空间完整留给玩家（玩家需要时会自己点击「💡 获取 AI 导师建议」按钮）。',
      '   · 仅当玩家消息以 [AI Tutor] / [Ask AI Tutor] / [AI Summary] 开头主动求助时，才在回复中提供针对性的地道润色（Recast）与分级英文表达示范。',
      '3. 目标词汇迷宫与实战激活：',
      '   · 关注面板中「待解锁/待激活词汇（skills.unknown）」与「核心句型卡（spells）」，在 NPC 对话中自然复现这些词汇。',
      '   · 一旦玩家在回复中主动且正确地使用了目标词汇或核心句型，立即在末尾 game_state 中将其移入「已掌握（skills.known）」，并适当提升流利度/自信度数值。',
      '',
      '【文风要求】',
      '· 叙事与对话自然流畅，拒绝电报体省略与堆砌形容词；不要在正文里给建议或列选项（用户需要 AI 建议时会主动点击按钮获取）。'
    ].join('\n');

    function buildSystemInstruction() {
      const fence = String.fromCharCode(96, 96, 96);
      return [
        '你是实时生成式英语口语互动文游引擎与 AI 口语教练。',
        '你的使命是将沉浸式情境故事体验、按需口语私教与目标词汇实战解锁融为一体，让学习者在真实、有温度的跨文化语境中自然习得地道英语表达。',
        '',
        '【叙事口吻（硬性要求，作用于「你怎么讲」，不限制「故事里有什么」）】',
        '· 不要用客服、策划、说明书的旁白口吻说话：不出现「免费」「新手礼」「不扣积分」「礼包」「领取」这类运营/菜单用语。玩家在故事里，不在菜单里。',
        '· 若世界观里本身有「系统」或「AI 语伴助手」这类剧中存在，让它按设定正常说话与引导，不要写成哑巴；但旁白本身不要变成机械播报。',
        '· 角色对话鲜活地道：NPC 的英语台词必须符合其身份、性格与语境（包含自然的口语连接词、语气词与习语），不要写成枯燥的教材阅读理解或说明书腔。',
        '· 引导而不越俎代庖（AI 建议按需触发）：在正常对话回合中，不要替玩家做决定（不写「建议你」「你可以选择」这类机械选项列表），也不要在正文中直接给出 AI 导师建议或纠错点评（用户需要建议时会自己点击界面上的「💡 获取 AI 导师建议」按钮）。仅当用户消息中明确包含 [AI Tutor] / [Ask AI Tutor] / [AI Summary] 求助指令时，才输出口语指导与示范。',
        '· 正文里不直接罗列 HUD 字段名与机械数值（如 HP、属性、好感度数值清单）：所有数值只写在末尾的 game_state 数据块里。',
        '',
        '【核心世界观设定】',
        AppState.lore.world || '未指定特定世界观（请根据玩家的开场发言构建一个真实的跨文化英语交流场景）',
        '',
        '【玩家角色档案】',
        AppState.lore.character || '未指定具体档案（默认按 CEFR B1-B2 英语学习者进行互动与引导）',
        '',
        '【世界记忆锚点 (AI Memory 学习与剧情长期记忆)】',
        AppState.lore.memoryPins || '暂无特殊长期记忆记录。',
        '',
        '【主持风格与游戏法则】',
        AppState.lore.rules || DEFAULT_GM_RULES,
        '',
        '【地道表达与关键线索高亮规范】',
        '在正文中出现地道英语习语、高频母语搭配（Collocations）、Word Maze 目标词汇或关键剧情线索时，请主动使用 Markdown 加粗格式（**重要表达/信息**），以便前端高亮胶囊渲染。',
        '',
        '【中文提示与剧透遮罩规范】',
        '当需要提供中文翻译参考或口语表达脚手架提示（且希望学习者先尝试盲读英语、鼠标悬停再看提示）时，请用 [[敏感]] 与 [[/敏感]] 成对包裹该段文字。',
        '',
        '【关键数值一律走数据块】',
        '角色卡字段、状态条、属性，以及 NPC 的关系数值（' +
          getNpcDimensions().map(d => d.label).join(' / ') +
          '）全部只写在 game_state 里。正文里一个数值都不要写，也不要输出任何字段清单。',
        '',
        '【数值与状态分离格式】',
        '在回复末尾附加标准的 JSON 数据块，用 ' + fence + 'game_state 和 ' + fence + ' 包裹。',
        '下列字段必须全部输出（确实没有内容时给空数组 / 空对象），前端 HUD 完全依赖该数据块刷新：',
        fence + 'game_state',
        JSON.stringify({
          location: "当前场景/地点",
          time: "时间/情境氛围",
          character_profile: buildProfileExample(),
          bars: [
            { label: "流利度 (Fluency)", current: 80, max: 100, color: "emerald" },
            { label: "表达自信 (Confidence)", current: 75, max: 100, color: "cyan" }
          ],
          attributes: {
            "流利度": { current: 14, max: 20 },
            "词汇量": { current: 15, max: 20 }
          },
          weapon_mastery: {
            "职场沟通": { level: "中级", exp: 40 }
          },
          spells: [
            { name: "核心句型/地道表达", ring: "B2 进阶", mp: 5, desc: "适用语境与例句简述" }
          ],
          skills: {
            known: ["已实战激活掌握的词汇 (Mastered)"],
            unknown: ["本场景待激活的目标词汇 (Word Maze Target)"]
          },
          inventory: [
            { name: "情境道具/话题线索", qty: 1, icon: "🗂️", desc: "道具或线索说明" }
          ],
          status_effects: [
            { name: "语感渐入佳境", type: "buff", desc: "连续使用地道连接词，口语流利度表现提升" }
          ],
          npc_codex: [
            buildNpcCodexExample()
          ]
        }, null, 2),
        fence,
        '',
        'weapon_mastery 的 level 请取当前世界蓝图阶梯名称（默认：生疏 / 初级 / 中级 / 精通 / 大师 / 宗师 / 传说）。',
        'bars 的 color 只能取：rose / cyan / emerald / amber。',
        'status_effects 的 type 只能取：buff / debuff / neutral。',
        '正文里不要复述字段名与数值，保持沉浸式叙事与精炼的 AI Tutor 反馈。',
        ...(buildSchemaDataContract() ? ['', buildSchemaDataContract()] : []),
        ...(buildVitalsContract() ? ['', buildVitalsContract()] : []),
        '',
        '===== 以下为每回合变化的动态信息 =====',
        '（把动态内容放在最末尾是刻意为之：上面全部是稳定内容，DeepSeek 的上下文缓存按前缀命中，' +
        '这样可以最大化缓存复用、显著降低输入费用。）',
        '【前情提要 (AI Summary 阶段学习与剧情摘要)】',
        AppState.contextSummary || '（暂无。剧情尚未超出上下文窗口，或尚未触发压缩。）',
        '',
        '【系统记录的当前数值（权威，以此为准）】',
        buildHudDigest() || '（尚未建立角色数据）',
        '以上数值由系统权威记录。你的叙事与反馈必须与之一致；若要变更，必须在 game_state 数据块中声明，不要凭空改动数值。',
        '（历史消息里附带的 game_state 是那一回合的状态快照；与本节数值冲突时，一律以本节为准。）',
        '',
        '===== 输出格式硬性要求（最高优先级，每次回复都必须满足）=====',
        '1. 每次回复的最后必须紧跟一个 game_state 代码块，即使这一回合数值毫无变化也要输出。',
        '2. 缺少该数据块视为回复不合格：前端无法刷新角色面板，玩家会看到界面停在上一幕。',
        '3. 正文写完后立刻补上该块，字段名必须与上面【数值与状态分离格式】里的示例完全一致。',
        '4. 数据块只放数据：正文里不出现任何字段名与数值（HP、属性、好感度…），也不要用正文解释这个块。',
        fence + 'game_state',
        '{"location":"…","time":"…","character_profile":{…},"bars":[…],"attributes":{…}}',
        fence
      ].join('\n');
    }

    const LLM_IDLE_TIMEOUT_MS = 90000;
    let currentAbortController = null;

    // ===== 自定义端点（第三方 / 自建 OpenAI 兼容服务）=====
    // 内置协议只为 DeepSeek / Gemini 准备；OpenRouter、硅基流动、公司内网网关这类地址
    // 既不在原来的 CSP 白名单里，路径也未必是 <base>/chat/completions。
    // 单独给一个 custom 协议：地址可以填到 /v1，也可以填完整 endpoint；
    // 另外允许注入额外请求体参数与请求头（如 OpenRouter 的 HTTP-Referer / X-Title）。
    const HTTP_HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

    // 自定义端点允许无鉴权（本机 Ollama / vLLM / 内网网关很常见）。
    // 其它协议仍然必须有 Key —— 所有调用入口都从这里判断，避免几处各写一套。
    function hasApiCredential(cfg) {
      const conf = cfg || AppState.apiConfig || {};
      if (typeof conf.apiKey === 'string' && conf.apiKey.trim()) return true;
      return conf.provider === 'custom';
    }

    function sanitizeHeaderValue(value) {
      return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
    }

    // 返回 { ok, value, error }：value 一定是普通对象，调用方不用再判类型。
    function parseJsonObjectText(text, label) {
      const raw = (text || '').trim();
      if (!raw) return { ok: true, value: {} };
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return { ok: false, error: `${label}不是合法 JSON：${e.message}` };
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: `${label}必须是 JSON 对象（形如 {"key": value}）` };
      }
      return { ok: true, value: parsed };
    }

    // 用户常常只填 openrouter.ai/api/v1（不带协议）：补协议比发一个非法 URL 好，
    // 但绝不改写域名 —— 只有「缺协议」这一种情况会被补全。
    // 本机地址（localhost / 127.0.0.1）按 http 补：本地推理服务几乎都是明文。
    function endpointBaseWithScheme(raw) {
      const t = (raw || '').trim();
      if (!t) return '';
      if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//.test(t)) return t;
      if (/^(localhost|127\.0\.0\.1)([:/]|$)/i.test(t)) return 'http://' + t;
      return 'https://' + t;
    }

    // 解析实际要请求的地址（纯函数，UI 里的「实际请求地址」预览也用它，保证永远一致）。
    // 规则：custom + 勾选「完整地址」→ 原样；已经是 .../completions → 原样；
    //       其余情况在末尾补 /chat/completions（query 串保持在原位）。
    function resolveChatEndpoint(cfg) {
      const provider = cfg.provider;
      const raw = endpointBaseWithScheme(cfg.baseUrl) || 'https://api.deepseek.com';
      const isCustom = provider === 'custom';

      if (isCustom && cfg.customFullEndpoint) return raw;

      try {
        const url = new URL(raw);
        const path = url.pathname.replace(/\/+$/, '');
        // 已经是完整 completions 地址：两种协议都原样使用（老用户可能早就填了完整地址，
        // 以前那样会拼成 .../chat/completions/chat/completions 直接 404）
        if (/\/(chat\/)?completions$/.test(path)) {
          url.pathname = path;
          return url.toString();
        }
        url.pathname = path + '/chat/completions';
        return url.toString();
      } catch (e) {
        // 非法 URL：原样拼接后交给 fetch 报错，比在这里猜一个「看起来能用」的地址更诚实
        return raw.replace(/\/+$/, '') + '/chat/completions';
      }
    }

    // 额外参数 / 请求头只在 custom 协议下生效：
    // 切回内置协议时它们原样留在配置里（切回去还能用），但不会混进 DeepSeek / Gemini 的请求。
    function applyCustomRequestOverrides(body, headers, cfg) {
      if (!cfg || cfg.provider !== 'custom') return;
      const params = (cfg.extraParams && typeof cfg.extraParams === 'object' && !Array.isArray(cfg.extraParams)) ? cfg.extraParams : {};
      Object.keys(params).forEach(k => { body[k] = params[k]; });
      const extraHeaders = (cfg.extraHeaders && typeof cfg.extraHeaders === 'object' && !Array.isArray(cfg.extraHeaders)) ? cfg.extraHeaders : {};
      Object.keys(extraHeaders).forEach(k => {
        if (!HTTP_HEADER_NAME_RE.test(k)) return;   // 非法头名跳过，否则 fetch 会直接抛 TypeError
        headers[k] = sanitizeHeaderValue(extraHeaders[k]);
      });
    }

    function getLlmEndpoint() {
      const cfg = AppState.apiConfig;
      if (cfg.provider === 'gemini') {
        const model = cfg.model || 'gemini-2.5-flash';
        return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
      }
      return resolveChatEndpoint(cfg);
    }

    function buildLlmRequest(promptHistory, systemPromptOverride) {
      const cfg = AppState.apiConfig;
      const systemPrompt = systemPromptOverride || buildSystemInstruction();

      if (cfg.provider === 'gemini') {
        const genConfig = { temperature: cfg.temperature || 0.8 };
        if (cfg.maxTokens && cfg.maxTokens > 0) genConfig.maxOutputTokens = cfg.maxTokens;
        return {
          url: getLlmEndpoint(),
          // 用 x-goog-api-key 请求头而不是 ?key=：避免密钥出现在 URL、日志与代理记录里
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
          body: {
            contents: promptHistory.map(item => ({
              role: item.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: item.text }]
            })),
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: genConfig
          }
        };
      }

      const body = {
        model: cfg.model || 'deepseek-flash',
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          ...promptHistory.map(item => ({
            role: item.role === 'assistant' ? 'assistant' : 'user',
            content: item.text
          }))
        ],
        temperature: cfg.temperature || 0.8
      };
      if (cfg.maxTokens && cfg.maxTokens > 0) body.max_tokens = cfg.maxTokens;

      // DeepSeek 的思考模式默认开启，而官方明确说明开启后 temperature 等参数会被静默忽略。
      // 只对 DeepSeek 端点下发 thinking 字段，避免 Ollama / OpenRouter 等后端因未知参数报错。
      let endpointHost = '';
      try { endpointHost = new URL(getLlmEndpoint()).hostname.toLowerCase(); } catch (e) { /* 非法 URL，按非 DeepSeek 处理 */ }
      if (endpointHost === 'api.deepseek.com' || endpointHost.endsWith('.deepseek.com')) {
        body.thinking = { type: cfg.thinkingEnabled ? 'enabled' : 'disabled' };
        if (cfg.thinkingEnabled) delete body.temperature;
      }

      // 自定义端点：用户给的额外请求体参数 / 请求头在最后合并，优先级高于上面的默认值
      const headers = { 'Content-Type': 'application/json' };
      if (cfg.apiKey && cfg.apiKey.trim()) headers.Authorization = `Bearer ${cfg.apiKey.trim()}`;
      applyCustomRequestOverrides(body, headers, cfg);

      return {
        url: getLlmEndpoint(),
        headers,
        body
      };
    }

    function extractChunkText(json, provider) {
      try {
        if (provider === 'gemini') {
          return json.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
        }
        return json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || '';
      } catch (e) {
        return '';
      }
    }

    // 流式调用：onDelta(delta, fullText) 会在每个增量到达时被调用。
    // 附带 AbortSignal，便于超时与手动取消。
    async function callLlmApiStream(promptHistory, onDelta, signal, systemPromptOverride) {
      if (!hasApiCredential()) {
        throw new Error('NO_API_KEY');
      }
      const provider = AppState.apiConfig.provider;
      const req = buildLlmRequest(promptHistory, systemPromptOverride);

      const res = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal
      });

      if (!res.ok) {
        let detail = '';
        try {
          const err = await res.json();
          detail = (err && err.error && err.error.message) || '';
        } catch (e) { /* 错误体不是 JSON，忽略 */ }
        throw new Error(detail || `接口请求失败 (${res.status})`);
      }

      const contentType = res.headers.get('content-type') || '';

      // 后端不支持 SSE（或直接返回整包 JSON）时降级为一次性读取
      if (!res.body || contentType.includes('application/json')) {
        const data = await res.json();
        const text = provider === 'gemini'
          ? (data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '')
          : (data.choices?.[0]?.message?.content || '');
        if (text) onDelta(text, text);
        return text;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let full = '';

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;

          let json;
          try {
            json = JSON.parse(payload);
          } catch (e) {
            continue; // SSE 偶发半包，跳过即可
          }
          const deltaText = extractChunkText(json, provider);
          if (deltaText) {
            full += deltaText;
            onDelta(deltaText, full);
          }
        }
      }
      return full;
    }

    // 非流式调用（世界观分析、剧情摘要等一次性请求）
    async function callLlmApi(promptHistory, systemPromptOverride) {
      return callLlmApiStream(promptHistory, () => {}, undefined, systemPromptOverride);
    }

    // 只发送最近 N 回合，更早的剧情由 contextSummary 承载。
    // 旧实现每次把完整历史都发出去，长团必然撞上下文窗口，且 token 消耗是 O(n²)。
    function buildPromptHistory() {
      const history = AppState.narrativeHistory || [];
      const cfg = AppState.contextConfig || defaultContextConfig();
      const keepEntries = Math.max(4, (Number(cfg.recentTurns) || 12) * 2);

      let start = Math.max(0, history.length - keepEntries);
      // 必须以 user 消息开头，否则部分接口会拒绝
      while (start < history.length && history[start].role !== 'user') start++;

      return history.slice(start).map(item => ({ role: item.role, text: assistantMessageText(item) }));
    }

    // 回放助手消息时，把当时的 game_state 数据块一并带上。
    // 起因：以前历史里只留正文，模型每回合看到的「自己上一轮」都是不带数据块的文本，
    // 而正文里的角色卡 / 情感状态区块照旧保留 —— 等于每回合都在用上下文教它
    // 「把机制写进正文、别写数据块」，system 提示里再怎么强调也压不过这个既成示范
    //（这正是 repairMissingGameState 那类兜底存在的土壤）。现在示范与规则一致了。
    // 代价：这些 JSON 逐条稳定，前面的在下一回合仍吃前缀缓存，只有最新一条不吃缓存。
    function assistantMessageText(item) {
      if (!item || item.role !== 'assistant' || !item.state || typeof item.state !== 'object') {
        return (item && item.text) || '';
      }
      let json = '';
      try { json = JSON.stringify(item.state); } catch (e) { return item.text || ''; }
      const fence = String.fromCharCode(96, 96, 96);
      return (item.text || '') + '\n\n' + fence + 'game_state\n' + json + '\n' + fence;
    }

    // 用于 UI 展示的上下文占用估算
    function estimateContextChars() {
      const sys = buildSystemInstruction();
      const hist = buildPromptHistory();
      return sys.length + hist.reduce((n, i) => n + (i.text ? i.text.length : 0), 0);
    }

    let isSummarizing = false;

    // 把「已滑出窗口、且尚未压缩」的那段剧情交给模型压缩，并入前情提要
    async function maybeSummarizeContext() {
      const cfg = AppState.contextConfig || defaultContextConfig();
      if (!cfg.autoSummary || isSummarizing || AppState.isGenerating) return;
      if (!hasApiCredential()) return;

      const history = AppState.narrativeHistory || [];
      const keepEntries = Math.max(4, (Number(cfg.recentTurns) || 12) * 2);
      const cutoff = history.length - keepEntries;
      const from = Math.max(0, Number(AppState.summarizedUpTo) || 0);

      const pending = cutoff - from;
      const trigger = Math.max(2, (Number(cfg.summaryTriggerTurns) || 8) * 2);
      if (pending < trigger) return;

      const chunk = history.slice(from, cutoff);
      if (chunk.length === 0) return;

      isSummarizing = true;
      try {
        const transcript = chunk
          .map(i => `${i.role === 'user' ? '玩家' : 'GM'}：${i.text}`)
          .join('\n')
          .slice(0, 24000);

        const prompt = `你是口语课程与剧情记录员。请把下面这段互动记录压缩成不超过 500 字的中文「前情提要」。

要求：
1. 保留【剧情与人际进展】：关键人物及其关系与立场、已达成或待完成的交际目标、重要线索与场景推进。
2. 保留【口语学习进展】：学习者在对话中展现的高频表达优势、被纠错的关键语法/语用点、已成功激活掌握的核心词汇。
3. 丢弃：琐碎寒暄、环境修辞细节、已被推翻的临时状态。
4. 不要编造，不要寒暄，只输出提要正文。

【已有前情提要】
${AppState.contextSummary || '（无）'}

【本次需要并入的新记录】
${transcript}`;

        // 摘要不需要世界观人设，用精简 system prompt，省 token 也避免被角色扮演带偏
        const summary = await callLlmApi(
          [{ role: 'user', text: prompt }],
          '你是一名严谨的课程与战役记录员（AI Summary），只做客观事实与学习表现压缩，不进行任何角色扮演。'
        );

        const clean = (summary || '').trim();
        if (clean) {
          AppState.contextSummary = clean.slice(0, 4000);
          AppState.summarizedUpTo = cutoff;
          saveCurrentSlotToStorage();
          renderContextPanel();
          console.log(`[奇点] 已压缩 ${chunk.length} 条早期剧情为前情提要`);
          showToast('早期剧情已自动压缩为前情提要', 'success');
        }
      } catch (e) {
        // 摘要失败不影响正常游戏，下回合会重试
        console.warn('[奇点] 自动摘要失败，将在下回合重试:', e);
      } finally {
        isSummarizing = false;
      }
    }

    // game_state 里可能出现的键。用来在"围栏标签不标准"时判断一个 JSON 块是不是 game_state。
    const GAME_STATE_KEYS = ['location', 'time', 'character_profile', 'bars', 'attributes',
      'weapon_mastery', 'spells', 'skills', 'inventory', 'status_effects', 'npc_codex'];

    // 兜底解析：模型偶尔会把围栏标成 ```json（甚至只写 ```），
    // 而只认 'game_state' 标签会导致**整个 HUD 永远不刷新** —— 玩家只会看到
    // "场景都推进了，右边的数值和按钮一动不动"，却完全不知道原因。
    // 这里再扫一遍所有围栏块，挑第一个"能解析成对象、且含已知 HUD 键"的。
    function findGameStateBlock(text) {
      const re = /```[a-zA-Z_-]*\s*([\s\S]*?)```/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const body = m[1].trim();
        if (!body.startsWith('{')) continue;
        let obj = null;
        try { obj = JSON.parse(body); } catch (e) { continue; }
        if (obj && typeof obj === 'object' && !Array.isArray(obj)
          && Object.keys(obj).some(k => GAME_STATE_KEYS.includes(k))) {
          return { json: obj, raw: m[0] };
        }
      }
      return null;
    }

    // 从一段模型输出里把 game_state 对象捞出来（先认标准围栏，再走内容识别兜底）
    function pickGameStateFromText(text) {
      const src = String(text == null ? '' : text);
      const m = src.match(/```game_state\s*([\s\S]*?)```/i);
      if (m) {
        try {
          const o = JSON.parse(m[1].trim());
          if (o && typeof o === 'object' && !Array.isArray(o)) return o;
        } catch (e) { /* 落到下面的内容识别 */ }
      }
      const alt = findGameStateBlock(src);
      return alt ? alt.json : null;
    }

    // 模型（尤其 flash 这类小模型）经常忘记输出 game_state，导致整个 HUD 停在上一幕，
    // 而且以前是静默的、玩家根本不知道原因。这里做一次**自动补救**：
    // 只补一次、只请求数据块，拿到就应用；失败也只是本回合不刷新，绝不影响已经写好的正文。
    async function repairMissingGameState(narrative) {
      try {
        const ask = [
          '你刚才的回复漏掉了 game_state 数据块。',
          '下面是你刚才写的正文：',
          '---',
          String(narrative || '').slice(-4000),
          '---',
          '请只输出一个 game_state 代码块（字段与格式见系统提示中的要求），',
          '内容依据上面这段正文与系统记录的当前数值。',
          '不要重复正文，不要任何解释、不要开场白。'
        ].join('\n');
        const raw = await callLlmApi([{ role: 'user', text: ask }]);
        return pickGameStateFromText(raw);
      } catch (e) {
        console.warn('[奇点] 自动补 game_state 失败:', e);
        return null;
      }
    }

    function applyGameState(stateJson) {
      if (!stateJson || typeof stateJson !== 'object') return;
      const hud = AppState.hudState;

      if (typeof stateJson.location === 'string' && stateJson.location) hud.location = stateJson.location;
      if (typeof stateJson.time === 'string' && stateJson.time) hud.time = stateJson.time;
      if (Array.isArray(stateJson.bars) && stateJson.bars.length) hud.bars = stateJson.bars;
      if (stateJson.attributes && typeof stateJson.attributes === 'object') hud.attributes = stateJson.attributes;
      if (stateJson.weapon_mastery && typeof stateJson.weapon_mastery === 'object') hud.weapon_mastery = stateJson.weapon_mastery;

      // 以下四类此前没有任何代码写入，导致 HUD 的法术/技能/行囊/状态效果四个页签永远是空的
      if (Array.isArray(stateJson.spells)) hud.spells = stateJson.spells;
      if (stateJson.skills && typeof stateJson.skills === 'object') {
        const prevKnown = (hud.skills && Array.isArray(hud.skills.known)) ? hud.skills.known : [];
        const incomingKnown = Array.isArray(stateJson.skills.known) ? stateJson.skills.known.slice() : [];
        const incomingUnknown = Array.isArray(stateJson.skills.unknown) ? stateJson.skills.unknown.slice() : [];
        // 已被玩家实战解锁进 known 的词汇，不允许被同回合模型滞后的 unknown 列表退回未掌握状态
        const finalUnknown = [];
        incomingUnknown.forEach(u => {
          const alreadyMastered = prevKnown.some(pk => doesHighlightTermEqual(pk, u))
            || incomingKnown.some(ik => doesHighlightTermEqual(ik, u));
          if (alreadyMastered) {
            if (!incomingKnown.some(ik => doesHighlightTermEqual(ik, u))) {
              incomingKnown.push(u);
            }
          } else {
            finalUnknown.push(u);
          }
        });
        hud.skills = {
          known: incomingKnown,
          unknown: finalUnknown
        };
      }
      if (Array.isArray(stateJson.inventory)) hud.inventory = stateJson.inventory;
      if (Array.isArray(stateJson.status_effects)) hud.status_effects = stateJson.status_effects;

      if (Array.isArray(stateJson.npc_codex)) {
        if (!Array.isArray(hud.npc_codex)) hud.npc_codex = [];
        // 静态字段与数值维度都按蓝图建。以前这里写死 race/personality/love_type + 固定四维，
        // 于是自定义蓝图（势力 / 物种 / 态度…）的字段永远落不了库，界面上就是空格子。
        const staticFields = npcStaticFields();
        const dims = getNpcDimensions();
        // 关系数值现在也由 game_state 提供（契约见 buildNpcCodexExample）：正文不再要求
        // 输出「情感状态列表」，所以这里必须把模型给的数值与变动落库，否则右侧四维永远是 0。
        // 仅在模型确实给了该键时才覆盖：老模型/老存档不带这些键时，不能把已有数值清零。
        // 兼容顺序：parseNpcEmotionsFromText() 在 applyGameState() 之前跑，两者都有值时
        // 以 game_state 为准（它是结构化的，与提示词末尾的权威数值摘要同源）。
        const applyNpcDims = (target, incoming) => {
          dims.forEach(d => {
            const valueKey = d.key;
            const deltaKey = d.deltaKey || (d.key + 'Delta');
            const raw = incoming[valueKey];
            if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
              const num = parseInt(raw, 10);
              if (Number.isFinite(num)) target[valueKey] = num;
            } else if (target[valueKey] === undefined) {
              target[valueKey] = 0;
            }
            const rawDelta = incoming[deltaKey];
            if (rawDelta !== undefined && rawDelta !== null && String(rawDelta).trim() !== '') {
              const dnum = parseInt(rawDelta, 10);
              if (Number.isFinite(dnum)) target[deltaKey] = dnum;
            } else if (target[deltaKey] === undefined) {
              target[deltaKey] = 0;
            }
          });
        };
        const recordNpcEvent = (target, incoming) => {
          if (!Array.isArray(target.recent_events)) target.recent_events = [];
          const changes = [];
          dims.forEach(d => {
            const deltaKey = d.deltaKey || (d.key + 'Delta');
            const dnum = parseInt(incoming[deltaKey], 10);
            if (Number.isFinite(dnum) && dnum !== 0) {
              changes.push(`${d.label}${dnum > 0 ? '+' : ''}${dnum}`);
            }
          });
          if (changes.length) {
            const loc = hud.location || '当前场景';
            const stamp = `${loc}：${changes.join('，')}`;
            if (target.recent_events[target.recent_events.length - 1] !== stamp) {
              target.recent_events.push(stamp);
              if (target.recent_events.length > 5) target.recent_events.shift();
            }
          }
        };
        stateJson.npc_codex.forEach(incoming => {
          if (!incoming || !incoming.name) return;
          const existing = hud.npc_codex.find(n => n.name === incoming.name);
          if (existing) {
            // 静态描述只补不空（模型没提的字段保持原值）
            staticFields.forEach(f => {
              const v = incoming[f.key];
              if (v != null && String(v).trim() !== '') existing[f.key] = v;
            });
            applyNpcDims(existing, incoming);
            recordNpcEvent(existing, incoming);
          } else {
            const fresh = { name: incoming.name, intimacy: null, recent_events: [] };
            staticFields.forEach(f => {
              const v = incoming[f.key];
              fresh[f.key] = (v != null && String(v).trim() !== '')
                ? v
                : (NPC_STATIC_PLACEHOLDER[f.key] || '');
            });
            // 新 NPC：蓝图声明的每个维度都先备好初值（模型没给就是 0）
            applyNpcDims(fresh, incoming);
            recordNpcEvent(fresh, incoming);
            hud.npc_codex.push(fresh);
          }
        });
      }

      if (stateJson.character_profile && typeof stateJson.character_profile === 'object') {
        hud.character_profile = Object.assign(hud.character_profile, stateJson.character_profile);
      }

      // 蓝图声明的自定义数据键：按 section 类型直接落库，
      // 这样用户自己新增的面板（例如「法宝」「义体」）也能拿到模型输出
      collectSchemaSources().forEach(({ source, type }) => {
        if (HANDLED_SOURCES.has(source)) return;
        const v = stateJson[source];
        if (v === undefined) return;
        if (type === 'list' || type === 'entities' || type === 'tags' || type === 'bars') {
          if (Array.isArray(v)) hud[source] = v;
        } else if (type === 'tiers') {
          if (v && typeof v === 'object' && !Array.isArray(v)) hud[source] = v;
        }
      });
    }

    async function executePlayerTurn() {
      const inputEl = document.getElementById('playerInput');
      const text = inputEl.value.trim();

      if (!text) {
        showToast('请输入您的行动指令', 'info');
        return;
      }
      if (!hasApiCredential()) {
        showToast('未配置 API Key，无法开始推演！', 'error');
        document.getElementById('openApiSettingsBtn').click();
        return;
      }
      if (AppState.isGenerating) return;

      const spinnerSvg = '<svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path></svg>';
      const sendSvg = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>';

      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (typeof processUsedHighlightWordsInTurn === 'function') {
        processUsedHighlightWordsInTurn(text);
      }
      AppState.narrativeHistory.push({ role: 'user', text, time: timeStr });
      inputEl.value = '';
      inputEl.style.height = 'auto';
      if (typeof updateActiveHighlightBarMatch === 'function') {
        updateActiveHighlightBarMatch();
      }
      document.getElementById('diceRollBadge').classList.add('hidden');

      AppState.isGenerating = true;
      const sendBtn = document.getElementById('sendActionBtn');
      const sendBtnText = document.getElementById('sendBtnText');
      const sendBtnIconSlot = document.getElementById('sendBtnIconSlot');

      // 推演期间把按钮变成"取消"，避免请求挂起后只能重启应用
      sendBtn.disabled = false;
      sendBtn.onclick = () => { if (currentAbortController) currentAbortController.abort(); };
      sendBtnText.textContent = '取消推演';
      sendBtnIconSlot.innerHTML = spinnerSvg;

      renderAllNarratives(true);
      const streamBlock = appendStreamingBlock();
      const container = document.getElementById('narrativeContainer');

      const controller = new AbortController();
      currentAbortController = controller;
      let idleTimer = setTimeout(() => controller.abort(), LLM_IDLE_TIMEOUT_MS);
      let streamedText = '';
      let renderQueued = false;
      let turnSucceeded = false;

      const scheduleStreamRender = () => {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => {
          renderQueued = false;
          updateStreamingBlock(streamBlock, streamedText);
          container.scrollTop = container.scrollHeight;
        });
      };

      try {
        const rawResponse = await callLlmApiStream(buildPromptHistory(), (delta, full) => {
          streamedText = full;
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => controller.abort(), LLM_IDLE_TIMEOUT_MS);
          scheduleStreamRender();
        }, controller.signal);

        const finalText = (rawResponse || streamedText || '').trim();
        if (!finalText) throw new Error('模型返回了空内容');

        let narrative = finalText;
        let stateJson = null;
        const match = finalText.match(/```game_state\s*([\s\S]*?)```/i);
        if (match) {
          narrative = finalText.replace(match[0], '').trim();
          try {
            stateJson = JSON.parse(match[1].trim());
          } catch (e) {
            console.warn('[奇点] game_state JSON 解析失败，本回合 HUD 不更新:', e);
          }
        }
        if (!stateJson || typeof stateJson !== 'object') {
          // 标签写错（```json / ``` ）时也认，否则整个 HUD 会永远停在原地
          const alt = findGameStateBlock(finalText);
          if (alt) {
            stateJson = alt.json;
            narrative = finalText.replace(alt.raw, '').trim();
            console.warn('[奇点] game_state 的围栏标签不标准，已按内容识别并采用');
          }
        }

        // 兼容路径：正文里已不再要求这两块（数值走 game_state），但老存档/老模型仍可能输出，
        // 顺序上它们在 applyGameState 之前跑，所以结构化数据永远覆盖正文里解析出来的值。
        parseNpcEmotionsFromText(narrative);
        parseCharacterCardFromText(narrative);

        const turnTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        // 本回合的 game_state 一起存进历史（见 assistantMessageText）：下一回合模型能看到
        // 自己上一轮真实的数据块长什么样，而不是只看到一段不带数据块的正文。
        const assistantEntry = { role: 'assistant', text: narrative, time: turnTime };
        if (stateJson && typeof stateJson === 'object') assistantEntry.state = stateJson;
        AppState.narrativeHistory.push(assistantEntry);

        // 没有可用 game_state 时，HUD 的数值维持原状是合理的（不该因为模型少写一个块
        // 就把生命值清空），但必须明确告诉玩家"界面为什么没动" ——
        // 这个失败以前是完全静默的，表现为"场景推进了、右边一动不动"，根本无从排查。
        const hasState = !!(stateJson && typeof stateJson === 'object');

        applyGameState(stateJson);

        sounds.playTurnBeep();
        // 直接把流式占位块"转正"，不再整段重渲染
        finalizeStreamingBlock(streamBlock, narrative);
        renderedNarrativeCount = AppState.narrativeHistory.length;
        renderHud();
        saveCurrentSlotToStorage();
        turnSucceeded = true;
        if (AppState.voiceConfig && AppState.voiceConfig.autoPlayNpc) {
          speakEnglishText(narrative);
        }
        // 到了设定的间隔就顺带刷新长线记忆锚点（不阻塞本回合的收尾）
        maybeAutoUpdateMemoryPins();

        // 模型漏了 game_state → 自动补一次。放在正文落地之后，所以不会拖慢正文显示；
        // 内部已吞掉异常，绝不会把一次成功的推演变成"推演中断"。
        if (!hasState) {
          const repaired = await repairMissingGameState(narrative);
          if (repaired) {
            // 补出来的数据块也写回历史，否则这条助手消息在后续上下文里依然是「没有数据块」的示范
            const lastEntry = AppState.narrativeHistory[AppState.narrativeHistory.length - 1];
            if (lastEntry && lastEntry.role === 'assistant') lastEntry.state = repaired;
            applyGameState(repaired);
            renderHud();
            saveCurrentSlotToStorage();
            showToast('模型漏了 game_state，已自动补全并刷新右侧面板', 'success');
          } else {
            showToast('模型漏了 game_state，自动补全也没成功；本回合右侧数值未刷新', 'error');
          }
        }

      } catch (err) {
        removeStreamingBlock(streamBlock);

        if (err.name === 'AbortError') {
          const partial = streamedText.trim();
          if (partial) {
            // 已生成的内容不丢弃，标记为中断后存档
            const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            AppState.narrativeHistory.push({ role: 'assistant', text: `${partial}\n\n> ⏹ 推演被中断，以上为已生成的部分内容。`, time: t });
            renderAllNarratives(true, true);
            saveCurrentSlotToStorage();
            showToast('已中止推演，已保留生成的部分内容', 'info');
          } else {
            // 什么都没收到：回滚本回合的玩家输入，避免下一轮重复发送
            const last = AppState.narrativeHistory[AppState.narrativeHistory.length - 1];
            if (last && last.role === 'user') AppState.narrativeHistory.pop();
            renderAllNarratives(true, true);
            saveCurrentSlotToStorage();
            showToast('已取消推演', 'info');
          }
        } else {
          showToast(err.message === 'NO_API_KEY' ? '请配置有效 API Key' : `推演中断: ${err.message}`, 'error');
          saveCurrentSlotToStorage();
        }

      } finally {
        clearTimeout(idleTimer);
        currentAbortController = null;
        AppState.isGenerating = false;
        sendBtn.disabled = false;
        sendBtn.onclick = executePlayerTurn;
        sendBtnText.textContent = '行动推演';
        sendBtnIconSlot.innerHTML = sendSvg;
        // 放在 finally 里、且 isGenerating 已复位之后：压缩是后台任务，不阻塞按钮恢复
        if (turnSucceeded) maybeSummarizeContext();
      }
    }

    // 把 LLM 返回的 Markdown 转成安全 HTML。这是阻断 <img onerror=...> 注入的关键一跳。
    function renderNarrativeMarkdown(text) {
      let html;
      try {
        html = sanitizeHtml(marked.parse(text || ''));
      } catch (e) {
        console.error('[奇点] Markdown 渲染失败，退化为纯文本:', e);
        return escapeHtml(text || '');
      }
      // 敏感段落标记 → 可脱敏元素。此处只包裹已净化内容的 span，不引入新的不可信 HTML。
      return html.replace(/\[\[敏感\]\]([\s\S]*?)\[\[\/敏感\]\]/g, '<span class="privacy-sensitive">$1</span>');
    }

    function buildNarrativeNode(item) {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'space-y-1.5 break-words narrative-msg';
      const timeLabel = escapeHtml(item.time || '');

      if (item.role === 'user') {
        const head = document.createElement('div');
        head.className = 'flex items-center justify-end gap-2 text-[11px] text-slate-500 font-mono';
        head.textContent = `玩家行动 ${item.time || ''}`;

        const wrap = document.createElement('div');
        wrap.className = 'flex justify-end';
        const balloon = document.createElement('div');
        balloon.className = 'user-balloon max-w-2xl bg-purple-900/40 border border-purple-700/60 text-slate-100 px-4 py-3 rounded-2xl rounded-tr-none text-sm leading-relaxed shadow-lg break-words';
        balloon.textContent = item.text;

        wrap.appendChild(balloon);
        msgDiv.append(head, wrap);
      } else {
        msgDiv.innerHTML = `
          <div class="flex items-center justify-between text-[11px] text-slate-500 font-mono">
            <span class="flex items-center gap-1 text-purple-400 font-semibold"><span>✦</span><span>世界运转</span></span>
            <div class="flex items-center gap-1.5 flex-wrap">
              <button type="button" data-action="speak-message" class="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-[10px] transition">🔊 朗读口语</button>
              <button type="button" data-action="toggle-sentence-studio" class="px-2 py-0.5 rounded bg-emerald-950/70 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-800/60 text-[10px] transition">🎧 逐句精听 / 点词</button>
              <button type="button" data-action="ask-tutor-advice" class="px-2 py-0.5 rounded bg-purple-950/70 hover:bg-purple-900/80 text-purple-200 border border-purple-800/60 text-[10px] transition">💡 AI 建议</button>
              <span>${timeLabel}</span>
            </div>
          </div>
          <div class="bg-slate-900/80 border border-slate-800 text-slate-200 px-4 py-4 rounded-2xl rounded-tl-none text-sm leading-relaxed prose prose-invert max-w-none shadow-md overflow-x-auto break-words">
            ${renderNarrativeMarkdown(item.text)}
          </div>
          <div data-sentence-studio class="hidden p-3 rounded-lg bg-slate-950/90 border border-slate-800 space-y-2 text-xs"></div>
        `;
      }
      return msgDiv;
    }

    // 流式阶段的占位气泡
    function appendStreamingBlock() {
      const container = document.getElementById('narrativeContainer');
      const block = document.createElement('div');
      block.className = 'space-y-1.5 break-words';
      block.innerHTML = `
        <div class="flex items-center justify-between text-[11px] text-slate-500 font-mono">
          <span class="flex items-center gap-1 text-purple-400 font-semibold"><span>✦</span><span>世界运转</span></span>
          <div class="flex items-center gap-1.5 flex-wrap">
            <button type="button" data-action="speak-message" class="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-[10px] transition">🔊 朗读口语</button>
            <button type="button" data-action="toggle-sentence-studio" class="px-2 py-0.5 rounded bg-emerald-950/70 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-800/60 text-[10px] transition">🎧 逐句精听 / 点词</button>
            <button type="button" data-action="ask-tutor-advice" class="px-2 py-0.5 rounded bg-purple-950/70 hover:bg-purple-900/80 text-purple-200 border border-purple-800/60 text-[10px] transition">💡 AI 建议</button>
            <span class="stream-time"></span>
          </div>
        </div>
        <div class="stream-body bg-slate-900/80 border border-slate-800 text-slate-200 px-4 py-4 rounded-2xl rounded-tl-none text-sm leading-relaxed prose prose-invert max-w-none shadow-md overflow-x-auto break-words">
          <span class="inline-flex items-center gap-2 text-slate-400 text-xs"><span class="w-2 h-2 rounded-full animate-pulse-dot" style="background-color: var(--hl-color, #8b5cf6);"></span>命运之轮转动中，正在推演世界反馈...</span>
        </div>
        <div data-sentence-studio class="hidden p-3 rounded-lg bg-slate-950/90 border border-slate-800 space-y-2 text-xs"></div>
      `;
      container.appendChild(block);
      container.scrollTop = container.scrollHeight;
      return block;
    }

    function updateStreamingBlock(block, text) {
      // __streamDone 守卫：最后一个分片排队的 rAF 可能在 finalize 之后才执行，
      // 若不拦住会把已经清理好的正文重新覆盖成带 game_state 的原始流
      if (!block || !block.isConnected || block.__streamDone) return;
      const body = block.querySelector('.stream-body');
      if (body) body.innerHTML = renderNarrativeMarkdown(text) + '<span class="stream-caret">▍</span>';
    }

    function finalizeStreamingBlock(block, text) {
      if (!block || !block.isConnected) return;
      block.__streamDone = true;
      triggerThreeStagePulse(1.4);
      const timeEl = block.querySelector('.stream-time');
      if (timeEl) timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const body = block.querySelector('.stream-body');
      if (body) body.innerHTML = renderNarrativeMarkdown(text);
      block.classList.add('narrative-msg');
      if (typeof syncHighlightedElementsAndBar === 'function') {
        syncHighlightedElementsAndBar();
      }
    }

    // ===== 英语语音 API 引擎（TTS 朗读 & STT 语音识别输入）=====
    let currentTtsAudio = null;
    let currentSpeechRecognition = null;
    let currentMediaRecorder = null;
    let recordedAudioChunks = [];
    let isRecordingVoice = false;

    function extractEnglishForSpeech(rawText) {
      let cleaned = String(rawText || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/\[\[敏感\]\][\s\S]*?\[\[\/敏感\]\]/g, ' ')
        .replace(/[*_~`#>]/g, ' ')
        .replace(/（[^）]*[\u4e00-\u9fff]+[^）]*）/g, ' ')
        .replace(/\([^)]*[\u4e00-\u9fff]+[^)]*\)/g, ' ');

      // 提取包含英文单词的句子，过滤掉纯中文旁白段落，让朗读更自然连贯
      const segments = cleaned
        .split(/\n+/)
        .map(line => line.replace(/[\u4e00-\u9fff]+/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(line => /[A-Za-z]{2,}/.test(line));

      const joined = segments.join('. ').replace(/\.\s*\./g, '.').trim();
      return (joined || cleaned.trim()).slice(0, 2500);
    }

    // ===== 逐句精听 + 点词入生词本 + 跟读发音评测工坊 (借鉴 SpeakHub / Good-Scriber / VocaLogue) =====
    function extractEnglishSentences(rawText) {
      const base = extractEnglishForSpeech(rawText);
      if (!base) return [];
      return base
        .split(/(?<=[.!?])\s+/)
        .map(s => s.replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '').trim())
        .filter(s => s.length >= 6 && /[A-Za-z]{2,}/.test(s))
        .slice(0, 12);
    }

    function collectOrMasterWord(rawWord) {
      const word = String(rawWord || '').replace(/^[^A-Za-z0-9\u4e00-\u9fa5]+|[^A-Za-z0-9\u4e00-\u9fa5)'"）\]]+$/g, '').trim();
      if (!word || word.length < 2) return;
      if (!AppState.hudState.skills || typeof AppState.hudState.skills !== 'object') {
        AppState.hudState.skills = { known: [], unknown: [] };
      }
      const skills = AppState.hudState.skills;
      if (!Array.isArray(skills.known)) skills.known = [];
      if (!Array.isArray(skills.unknown)) skills.unknown = [];

      const idxUnknown = skills.unknown.findIndex(w => doesHighlightTermEqual(w, word));
      const idxKnown = skills.known.findIndex(w => doesHighlightTermEqual(w, word));
      const coreToSpeak = extractHighlightEnglishCore(word);

      speakEnglishText(coreToSpeak || word);

      if (idxUnknown !== -1) {
        const original = skills.unknown.splice(idxUnknown, 1)[0];
        if (idxKnown === -1) skills.known.push(original);
        if (Array.isArray(AppState.hudState.bars) && AppState.hudState.bars.length > 0) {
          const b0 = AppState.hudState.bars[0];
          b0.current = Math.min(Number(b0.max) || 100, (Number(b0.current) || 0) + 1);
        }
        renderHud();
        saveCurrentSlotToStorage();
        showToast(`🎉 已将「${original}」激活为已掌握技能/词汇！（流利度 +1）`, 'success');
      } else if (idxKnown !== -1) {
        const inp = document.getElementById('playerInput');
        if (inp) {
          inp.value = (inp.value ? inp.value.trimEnd() + ' ' : '') + coreToSpeak + ' ';
          inp.focus();
          updateActiveHighlightBarMatch();
        }
        showToast(`🔊 已朗读「${coreToSpeak}」并填入输入框`, 'info');
      } else {
        skills.unknown.push(word);
        renderHud();
        saveCurrentSlotToStorage();
        showToast(`📌 已将「${word}」收入右侧【技能】待激活生词本（再次点击或造句使用即可解锁掌握）`, 'success');
      }
    }

    function evaluateShadowingScore(targetSentence, spokenText) {
      const tokenize = (s) => String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9'\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);

      const targetTokens = tokenize(targetSentence);
      const spokenTokens = tokenize(spokenText);
      if (targetTokens.length === 0) {
        return { accuracy: 0, completeness: 0, overall: 0, grade: 'C', wordResults: [] };
      }

      const spokenSet = new Set(spokenTokens);
      let matchedCount = 0;
      const wordResults = targetTokens.map(tw => {
        const hit = spokenSet.has(tw) || spokenTokens.some(sw => {
          if (Math.abs(sw.length - tw.length) > 2) return false;
          return sw.startsWith(tw.slice(0, Math.max(3, tw.length - 1))) || tw.startsWith(sw.slice(0, Math.max(3, sw.length - 1)));
        });
        if (hit) matchedCount++;
        return { word: tw, hit };
      });

      const completeness = Math.round((matchedCount / targetTokens.length) * 100);
      const lengthRatio = Math.min(1.15, spokenTokens.length / Math.max(1, targetTokens.length));
      const accuracy = Math.min(100, Math.round(completeness * 0.85 + Math.min(100, lengthRatio * 100) * 0.15));
      const overall = Math.round(accuracy * 0.6 + completeness * 0.4);
      const grade = overall >= 90 ? 'S' : overall >= 80 ? 'A' : overall >= 65 ? 'B' : 'C';

      return { accuracy, completeness, overall, grade, wordResults };
    }

    function applyShadowingResultToRow(rowEl, targetSentence, spokenText) {
      const resBox = rowEl ? rowEl.querySelector('[data-shadow-result]') : null;
      if (!resBox) return;
      const res = evaluateShadowingScore(targetSentence, spokenText);

      // 跟读高分奖励：联动 HUD 状态条与生词解锁
      if (res.overall >= 80 && AppState.hudState) {
        if (Array.isArray(AppState.hudState.bars) && AppState.hudState.bars.length > 0) {
          const bar0 = AppState.hudState.bars[0];
          bar0.current = Math.min(Number(bar0.max) || 100, (Number(bar0.current) || 0) + 2);
        }
        const skills = AppState.hudState.skills;
        if (skills && Array.isArray(skills.unknown) && Array.isArray(skills.known)) {
          const lowerSpoken = String(spokenText || '').toLowerCase();
          for (let i = skills.unknown.length - 1; i >= 0; i--) {
            const w = String(skills.unknown[i]);
            if (lowerSpoken.includes(w.toLowerCase())) {
              skills.unknown.splice(i, 1);
              if (!skills.known.includes(w)) skills.known.push(w);
            }
          }
        }
        renderHud();
        saveCurrentSlotToStorage();
      }

      const wordsHtml = res.wordResults.map(item => item.hit
        ? `<span class="px-1 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 font-mono text-[10px]">✓ ${escapeHtml(item.word)}</span>`
        : `<button type="button" data-action="collect-word" data-word="${escapeHtml(item.word)}" class="px-1 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-800/60 font-mono text-[10px]" title="漏读或发音偏差 · 点击听发音并加入生词本">✗ ${escapeHtml(item.word)}</button>`
      ).join(' ');

      resBox.classList.remove('hidden');
      resBox.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-slate-800">
          <span class="font-bold text-purple-300">🎙️ 跟读评测评级：${res.grade}（综合 ${res.overall} 分）</span>
          <span class="font-mono text-[10px] text-slate-400">准确度 ${res.accuracy}% · 完整度 ${res.completeness}%</span>
        </div>
        <div class="text-[10px] text-slate-400">识别内容：<span class="text-slate-200 font-mono">${escapeHtml(spokenText)}</span></div>
        <div class="flex flex-wrap gap-1 pt-0.5">${wordsHtml}</div>
      `;
    }

    function runShadowingAssessment(btnEl, targetSentence) {
      const rowEl = btnEl ? btnEl.closest('[data-sentence-row]') : null;
      if (!rowEl || !targetSentence) return;

      const SpeechRec = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
      if (SpeechRec) {
        try {
          const rec = new SpeechRec();
          rec.lang = 'en-US';
          rec.interimResults = false;
          rec.maxAlternatives = 1;
          btnEl.textContent = '⏺ 请跟读...';
          showToast('🎙️ 请对着麦克风朗读该句英语...', 'info');
          rec.onresult = (ev) => {
            const transcript = ev.results?.[0]?.[0]?.transcript || '';
            btnEl.textContent = '🎙️ 跟读评分';
            if (transcript) {
              applyShadowingResultToRow(rowEl, targetSentence, transcript);
            }
          };
          rec.onerror = () => {
            btnEl.textContent = '🎙️ 跟读评分';
            const fallback = document.getElementById('playerInput')?.value.trim() || targetSentence;
            applyShadowingResultToRow(rowEl, targetSentence, fallback);
          };
          rec.onend = () => {
            btnEl.textContent = '🎙️ 跟读评分';
          };
          rec.start();
          return;
        } catch (e) {}
      }

      // 无麦克风环境或离线测试：优先读取底部输入框中的跟读文本进行量化评测
      const playerInp = document.getElementById('playerInput');
      const spoken = (playerInp && playerInp.value.trim()) ? playerInp.value.trim() : targetSentence;
      applyShadowingResultToRow(rowEl, targetSentence, spoken);
      showToast('已完成单句跟读发音与流利度评测', 'success');
    }

    function toggleSentenceStudio(msgNode) {
      if (!msgNode) return;
      const box = msgNode.querySelector('[data-sentence-studio]');
      const proseEl = msgNode.querySelector('.prose');
      if (!box || !proseEl) return;

      if (!box.classList.contains('hidden')) {
        box.classList.add('hidden');
        return;
      }

      const sentences = extractEnglishSentences(proseEl.textContent || '');
      if (sentences.length === 0) {
        showToast('本条消息中未提取到可分句精听的英文句子', 'info');
        return;
      }

      box.innerHTML = `
        <div class="flex items-center justify-between border-b border-slate-800 pb-1.5">
          <span class="font-bold text-purple-300">🎧 逐句精听 · 点词入库 · 跟读评分工坊</span>
          <span class="text-[10px] text-slate-400 font-mono">点击句中任意单词即可朗读并收入【技能】生词本</span>
        </div>
        <div class="space-y-2">
          ${sentences.map((sent, idx) => {
            const tokenizedHtml = sent.split(/\s+/).map(token => {
              const clean = token.replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, '');
              if (clean.length >= 3) {
                return `<button type="button" data-action="collect-word" data-word="${escapeHtml(clean)}" class="px-1 py-0.5 rounded hover:bg-purple-950/60 text-slate-100 hover:text-purple-300 border border-transparent hover:border-purple-800/60 transition" title="点击朗读「${escapeHtml(clean)}」并收入右侧技能/生词本">${escapeHtml(token)}</button>`;
              }
              return `<span>${escapeHtml(token)}</span>`;
            }).join(' ');

            return `
              <div data-sentence-row class="p-2 rounded bg-slate-900/90 border border-slate-800 space-y-1.5">
                <div class="flex items-start justify-between gap-2">
                  <div class="flex-1 leading-relaxed text-xs flex flex-wrap items-center gap-0.5">
                    <span class="text-[10px] font-mono text-purple-400 mr-1">0${idx + 1}.</span>
                    ${tokenizedHtml}
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <button type="button" data-action="speak-text" data-speech="${escapeHtml(sent)}" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[10px]">🔊 精听</button>
                    <button type="button" data-action="shadow-sentence" data-sentence="${escapeHtml(sent)}" class="px-2 py-0.5 rounded bg-purple-950/80 hover:bg-purple-900 text-purple-200 border border-purple-800/60 text-[10px]">🎙️ 跟读评分</button>
                  </div>
                </div>
                <div data-shadow-result class="hidden p-2 rounded bg-slate-950 border border-slate-800 space-y-1 text-[11px]"></div>
              </div>
            `;
          }).join('')}
        </div>
      `;
      box.classList.remove('hidden');
    }

    function renderTacticsSessionStats() {
      const box = document.getElementById('tacticsSessionStats');
      if (!box) return;
      const history = AppState.narrativeHistory || [];
      const userTurns = history.filter(h => h && h.role === 'user');
      let totalEnglishWords = 0;
      userTurns.forEach(u => {
        const matches = String(u.text || '').match(/[A-Za-z]{2,}/g);
        if (matches) totalEnglishWords += matches.length;
      });
      const known = (AppState.hudState?.skills?.known) || [];
      const unknown = (AppState.hudState?.skills?.unknown) || [];

      box.innerHTML = `
        <div class="flex items-center justify-between border-b border-slate-800 pb-1">
          <span class="font-bold text-purple-300">📊 本局口语实战与词汇复盘统计</span>
          <span class="text-[10px] font-mono text-slate-400">实时同步自当前战报与技能栏</span>
        </div>
        <div class="grid grid-cols-4 gap-1.5 text-center pt-0.5">
          <div class="p-1.5 rounded bg-slate-900 border border-slate-800">
            <div class="text-[10px] text-slate-400">开口回合</div>
            <div class="text-xs font-bold font-mono text-slate-100">${userTurns.length}</div>
          </div>
          <div class="p-1.5 rounded bg-slate-900 border border-slate-800">
            <div class="text-[10px] text-slate-400">累计英文词数</div>
            <div class="text-xs font-bold font-mono text-purple-300">${totalEnglishWords}</div>
          </div>
          <div class="p-1.5 rounded bg-slate-900 border border-slate-800">
            <div class="text-[10px] text-slate-400">已掌握词汇</div>
            <div class="text-xs font-bold font-mono text-emerald-300">${known.length}</div>
          </div>
          <div class="p-1.5 rounded bg-slate-900 border border-slate-800">
            <div class="text-[10px] text-slate-400">待激活生词</div>
            <div class="text-xs font-bold font-mono text-amber-300">${unknown.length}</div>
          </div>
        </div>
      `;
    }

    // ===== 高亮词汇跨模块全功能联动引擎 (Interactive Highlight Linkage Engine) =====
    let activeHighlightPopoverState = {
      term: '',
      coreTerm: '',
      contextSentence: '',
      anchorEl: null
    };

    function extractHighlightEnglishCore(rawTerm) {
      const s = String(rawTerm || '')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/（[^）]*）/g, ' ')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const engMatch = s.match(/[A-Za-z][A-Za-z0-9'\-\s….]*[A-Za-z0-9]/);
      if (engMatch && engMatch[0].trim().length >= 2) {
        return engMatch[0].replace(/\.{2,}|…/g, '').trim();
      }
      return s || String(rawTerm || '').trim();
    }

    function doesHighlightTermEqual(a, b) {
      const rawA = String(a || '').trim().toLowerCase();
      const rawB = String(b || '').trim().toLowerCase();
      if (!rawA || !rawB) return false;
      if (rawA === rawB) return true;
      const coreA = extractHighlightEnglishCore(a).toLowerCase();
      const coreB = extractHighlightEnglishCore(b).toLowerCase();
      return Boolean(coreA && coreB && coreA.length >= 2 && coreA === coreB);
    }

    function getHighlightTermState(term) {
      const skills = (AppState.hudState && AppState.hudState.skills) || { known: [], unknown: [] };
      const known = Array.isArray(skills.known) ? skills.known : [];
      const unknown = Array.isArray(skills.unknown) ? skills.unknown : [];
      const knownMatch = known.find(k => doesHighlightTermEqual(k, term));
      if (knownMatch) return { state: 'known', matchedEntry: knownMatch };
      const unknownMatch = unknown.find(u => doesHighlightTermEqual(u, term));
      if (unknownMatch) return { state: 'unknown', matchedEntry: unknownMatch };
      return { state: 'new', matchedEntry: null };
    }

    function doesPlayerInputMatchTerm(inputText, term) {
      const textLower = String(inputText || '').toLowerCase();
      if (!textLower.trim()) return false;
      const core = extractHighlightEnglishCore(term).toLowerCase();
      if (!core || core.length < 2) return false;
      if (textLower.includes(core)) return true;
      // 处理包含省略号或可变宾语的短语（例如 "wrap my head around" -> 匹配前两个核心实词）
      const words = core.split(/\s+/).filter(w => w.length >= 3);
      if (words.length >= 2) {
        const prefix = words.slice(0, 2).join(' ');
        if (prefix.length >= 6 && textLower.includes(prefix)) return true;
      }
      return false;
    }

    function extractContextSentenceFromStrong(strongEl) {
      if (!strongEl) return '';
      const term = (strongEl.textContent || '').trim();
      const block = strongEl.closest('p, li, blockquote, div.prose') || strongEl.parentElement;
      if (!block) return term;
      const fullText = String(block.textContent || '').replace(/\s+/g, ' ').trim();
      if (!fullText) return term;
      const pieces = fullText.split(/(?<=[.!?。！？])\s+/);
      const hit = pieces.find(s => s.includes(term));
      return (hit || fullText).slice(0, 220).trim();
    }

    function syncHighlightedElementsAndBar() {
      const container = document.getElementById('narrativeContainer');
      const latestStoryTerms = [];
      if (container) {
        const strongEls = container.querySelectorAll('.prose strong, .prose b');
        strongEls.forEach(el => {
          const term = (el.textContent || '').trim();
          if (!term) return;
          el.dataset.hlTerm = term;
          const { state } = getHighlightTermState(term);
          if (state === 'known') {
            el.dataset.hlState = 'known';
            el.title = '✓ 已掌握表达 · 点击打开词汇联动面板（朗读 / 造句 / AI语境拆解 / 钉入记忆）';
          } else if (state === 'unknown') {
            el.dataset.hlState = 'unknown';
            el.title = '🎯 待激活目标词 · 点击打开词汇联动面板（在下方输入框造句使用可直接解锁！）';
          } else {
            delete el.dataset.hlState;
            el.title = '✦ 剧情高亮词 · 点击打开词汇联动面板（发音 / 填入造句 / 收入技能栏 / AI语境拆解）';
          }
        });

        // 收集最近一条 AI 消息中的高亮词
        const msgNodes = container.querySelectorAll('.narrative-msg .prose');
        const lastProse = msgNodes.length ? msgNodes[msgNodes.length - 1] : container.querySelector('.prose');
        if (lastProse) {
          lastProse.querySelectorAll('strong, b').forEach(el => {
            const t = (el.textContent || '').trim();
            if (t && t.length <= 60 && !latestStoryTerms.some(x => doesHighlightTermEqual(x, t))) {
              latestStoryTerms.push(t);
            }
          });
        }
      }

      // 渲染底部操控台的高亮词联动条 #activeHighlightBar
      const barEl = document.getElementById('activeHighlightBar');
      if (!barEl) return;

      const unknownList = (AppState.hudState && AppState.hudState.skills && Array.isArray(AppState.hudState.skills.unknown))
        ? AppState.hudState.skills.unknown
        : [];

      const combinedTerms = [];
      latestStoryTerms.forEach(t => {
        if (!combinedTerms.some(x => doesHighlightTermEqual(x, t))) combinedTerms.push(t);
      });
      unknownList.forEach(u => {
        if (combinedTerms.length < 8 && !combinedTerms.some(x => doesHighlightTermEqual(x, u))) {
          combinedTerms.push(u);
        }
      });

      if (combinedTerms.length === 0) {
        barEl.classList.add('hidden');
        barEl.classList.remove('flex');
        barEl.innerHTML = '';
        return;
      }

      barEl.classList.remove('hidden');
      barEl.classList.add('flex');

      const chipsHtml = combinedTerms.slice(0, 8).map(term => {
        const { state } = getHighlightTermState(term);
        const core = extractHighlightEnglishCore(term);
        const badgeIcon = state === 'known' ? '✓' : (state === 'unknown' ? '🎯' : '✦');
        return `<button type="button" data-action="hl-chip-click" data-hl-chip="${escapeHtml(term)}" data-hl-core="${escapeHtml(core)}" data-hl-chip-state="${state}" class="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-[10px] font-mono transition flex items-center gap-1" title="左键点击：填入输入框并查看联动卡片 | 在输入框中造句命中此词可自动亮灯并激活掌握">${badgeIcon} <span>${escapeHtml(core)}</span></button>`;
      }).join('');

      barEl.innerHTML = `
        <span class="text-[10px] font-bold text-amber-300 shrink-0 flex items-center gap-1">
          <span>✦ 本幕高亮词联动</span>
          <span class="text-[10px] text-slate-400 font-normal hidden sm:inline">（点词联动 / 造句命中亮灯即解锁）：</span>
        </span>
        <div class="flex flex-wrap items-center gap-1">${chipsHtml}</div>
      `;

      updateActiveHighlightBarMatch();
    }

    function updateActiveHighlightBarMatch() {
      const barEl = document.getElementById('activeHighlightBar');
      if (!barEl || barEl.classList.contains('hidden')) return;
      const inp = document.getElementById('playerInput');
      const val = inp ? inp.value : '';

      barEl.querySelectorAll('[data-hl-chip]').forEach(btn => {
        const term = btn.dataset.hlChip || '';
        const core = btn.dataset.hlCore || extractHighlightEnglishCore(term);
        const state = btn.dataset.hlChipState || 'new';
        const matched = doesPlayerInputMatchTerm(val, term);

        if (matched) {
          btn.className = 'px-2 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-500 text-[10px] font-mono font-bold transition flex items-center gap-1 shadow-sm';
          btn.innerHTML = `🔥 <span>${escapeHtml(core)}</span> <span class="text-[9px] text-emerald-200">(已命中·发送即激活)</span>`;
        } else if (state === 'known') {
          btn.className = 'px-2 py-0.5 rounded bg-emerald-950/40 hover:bg-emerald-950/70 text-emerald-300 border border-emerald-800/60 text-[10px] font-mono transition flex items-center gap-1';
          btn.innerHTML = `✓ <span>${escapeHtml(core)}</span>`;
        } else if (state === 'unknown') {
          btn.className = 'px-2 py-0.5 rounded bg-amber-950/50 hover:bg-amber-950/80 text-amber-300 border border-amber-800/60 text-[10px] font-mono transition flex items-center gap-1';
          btn.innerHTML = `🎯 <span>${escapeHtml(core)}</span>`;
        } else {
          btn.className = 'px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-[10px] font-mono transition flex items-center gap-1';
          btn.innerHTML = `✦ <span>${escapeHtml(core)}</span>`;
        }
      });
    }

    function refreshHighlightPopoverHeaderState() {
      const term = activeHighlightPopoverState.term;
      if (!term) return;
      const badgeEl = document.getElementById('hlPopoverStatusBadge');
      const collectTextEl = document.getElementById('hlPopoverCollectText');
      const { state } = getHighlightTermState(term);

      if (badgeEl) {
        if (state === 'known') {
          badgeEl.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60';
          badgeEl.textContent = '✓ 已掌握技能词汇';
        } else if (state === 'unknown') {
          badgeEl.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60';
          badgeEl.textContent = '🎯 待激活目标词 (Word Maze)';
        } else {
          badgeEl.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800/60';
          badgeEl.textContent = '✦ 剧情高亮表达';
        }
      }

      if (collectTextEl) {
        if (state === 'known') {
          collectTextEl.textContent = '已在掌握词库 (点击朗读并填入)';
        } else if (state === 'unknown') {
          collectTextEl.textContent = '立即解锁为已掌握 (流利度 +1)';
        } else {
          collectTextEl.textContent = '收入右侧【技能】生词本';
        }
      }
    }

    function openHighlightWordPopover(strongEl, customTerm, customContext) {
      const pop = document.getElementById('highlightWordPopover');
      if (!pop) return;
      const term = (customTerm || (strongEl && strongEl.textContent) || '').trim();
      if (!term) return;
      const coreTerm = extractHighlightEnglishCore(term);
      const contextSentence = customContext !== undefined
        ? customContext
        : extractContextSentenceFromStrong(strongEl);

      activeHighlightPopoverState = {
        term,
        coreTerm,
        contextSentence,
        anchorEl: strongEl || null
      };

      const termEl = document.getElementById('hlPopoverTerm');
      const ctxEl = document.getElementById('hlPopoverContext');
      const explainBox = document.getElementById('hlPopoverExplainBox');
      const explainBtnText = document.getElementById('hlPopoverExplainBtnText');

      if (termEl) termEl.textContent = term;
      if (ctxEl) {
        ctxEl.textContent = contextSentence
          ? `原句语境："${contextSentence}"`
          : '点击下方功能键即可朗读发音、填入造句、收入技能词库或钉入长线记忆。';
      }
      if (explainBox) {
        explainBox.classList.add('hidden');
        explainBox.innerHTML = '';
      }
      if (explainBtnText) {
        explainBtnText.textContent = 'AI 语境释义与地道造句示范';
      }

      refreshHighlightPopoverHeaderState();
      pop.classList.remove('hidden');

      // 计算浮层坐标，确保不超出视口边界
      let left = Math.round(window.innerWidth / 2 - 160);
      let top = Math.round(window.innerHeight / 2 - 120);
      if (strongEl && typeof strongEl.getBoundingClientRect === 'function') {
        const rect = strongEl.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          const popWidth = 320;
          left = Math.max(12, Math.min(window.innerWidth - popWidth - 12, Math.round(rect.left)));
          const spaceBelow = window.innerHeight - rect.bottom;
          if (spaceBelow < 240 && rect.top > 240) {
            top = Math.max(12, Math.round(rect.top - 225));
          } else {
            top = Math.min(window.innerHeight - 230, Math.round(rect.bottom + 8));
          }
        }
      }
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
    }

    function closeHighlightWordPopover() {
      const pop = document.getElementById('highlightWordPopover');
      if (pop) pop.classList.add('hidden');
    }

    function insertHighlightTermIntoInput(termToInsert) {
      const core = extractHighlightEnglishCore(termToInsert || activeHighlightPopoverState.coreTerm || activeHighlightPopoverState.term);
      if (!core) return;
      const inp = document.getElementById('playerInput');
      if (!inp) return;
      const cur = inp.value;
      const needsSpace = cur.length > 0 && !/\s$/.test(cur);
      inp.value = cur + (needsSpace ? ' ' : '') + core + ' ';
      inp.focus();
      updateActiveHighlightBarMatch();
      showToast(`✍️ 已将「${core}」填入开口输入框，结合剧情造句发送即可实战激活！`, 'info');
    }

    function pinHighlightTermToMemory() {
      const term = activeHighlightPopoverState.term;
      if (!term) return;
      const ctx = activeHighlightPopoverState.contextSentence;
      const pinLine = `• [重点表达锚点] ${term}${ctx && ctx !== term ? `（语境例句："${ctx}"）` : ''}`;
      const pinsInput = document.getElementById('memoryPinsInput');
      const currentPins = (pinsInput ? pinsInput.value : (AppState.lore.memoryPins || '')).trim();
      if (currentPins.includes(term)) {
        showToast(`🧠「${term}」已在长线记忆锚点中，AI 会在后续对话中自然复现`, 'info');
        return;
      }
      const nextPins = currentPins ? `${currentPins}\n${pinLine}` : pinLine;
      if (pinsInput) pinsInput.value = nextPins;
      AppState.lore.memoryPins = nextPins;
      saveCurrentSlotToStorage();
      updateRailIndicator();
      showToast(`🧠 已将「${term}」钉入左侧【记忆锚点】，AI 将在后续剧情中主动复现并考察！`, 'success');
    }

    async function explainHighlightTermInContext() {
      const term = activeHighlightPopoverState.term;
      const core = activeHighlightPopoverState.coreTerm || extractHighlightEnglishCore(term);
      const ctx = activeHighlightPopoverState.contextSentence || '';
      const explainBox = document.getElementById('hlPopoverExplainBox');
      const explainBtnText = document.getElementById('hlPopoverExplainBtnText');
      if (!explainBox || !term) return;

      explainBox.classList.remove('hidden');

      const s1 = `Actually, regarding "${core}", I think we can apply that right away in our next step.`;
      const s2 = `That's a great point—let me follow up on "${core}" and share my perspective.`;

      if (!hasApiCredential()) {
        explainBox.innerHTML = `
          <div class="font-semibold text-purple-300">💡 语境速览与开口造句脚手架（离线模式）</div>
          <div class="text-slate-300">核心表达：<strong class="text-amber-300">${escapeHtml(core)}</strong></div>
          ${ctx ? `<div class="text-slate-400">原句对照：${escapeHtml(ctx)}</div>` : ''}
          <div class="pt-1 text-slate-400">👇 点击下方示范句可直接填入输入框开口回应：</div>
          <div class="space-y-1 pt-0.5">
            <button type="button" data-action="use-suggestion" data-suggestion="${escapeHtml(s1)}" class="w-full text-left p-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-emerald-300 transition">💬 "${escapeHtml(s1)}"</button>
            <button type="button" data-action="use-suggestion" data-suggestion="${escapeHtml(s2)}" class="w-full text-left p-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-cyan-300 transition">💬 "${escapeHtml(s2)}"</button>
          </div>
        `;
        return;
      }

      if (explainBtnText) explainBtnText.textContent = 'AI 正在拆解语境...';
      explainBox.innerHTML = '<div class="text-slate-400 animate-pulse">🎓 AI 导师正在结合当前剧情拆解该表达并生成造句示范...</div>';

      try {
        const prompt = [
          `请针对英语口语互动剧情中的高亮表达「${term}」（原句语境："${ctx || '当前对话场景'}"）提供极简实战拆解。`,
          '请严格输出 JSON 格式：{"meaning":"中文地道释义与语气色彩（35字内）","nuance":"母语者使用窍门（35字内）","examples":["可直接用于下一句回复 NPC 的自然英文造句1（必须包含该表达）","可直接用于下一句回复 NPC 的自然英文造句2（必须包含该表达）"]}'
        ].join('\n');
        const raw = await callLlmApi(
          [{ role: 'user', text: prompt }],
          '你是精炼的英语口语私教，只输出合法 JSON。'
        );
        const parsed = parseLooseJson(raw || '') || {};
        const meaning = parsed.meaning || `地道表达「${core}」，常用于自然衔接观点或推进对话。`;
        const nuance = parsed.nuance || '可搭配主观看法（I feel / From my angle）让语气更自然。';
        const exList = (Array.isArray(parsed.examples) && parsed.examples.length) ? parsed.examples.slice(0, 2) : [s1, s2];

        explainBox.innerHTML = `
          <div class="text-purple-300 font-semibold">🎯 释义：${escapeHtml(meaning)}</div>
          <div class="text-slate-400">💡 窍门：${escapeHtml(nuance)}</div>
          <div class="pt-1 text-slate-400">👇 点击示范句直接填入输入框实战使用：</div>
          <div class="space-y-1 pt-0.5">
            ${exList.map(ex => `<button type="button" data-action="use-suggestion" data-suggestion="${escapeHtml(ex)}" class="w-full text-left p-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-emerald-300 transition">💬 "${escapeHtml(ex)}"</button>`).join('')}
          </div>
        `;
      } catch (e) {
        explainBox.innerHTML = `
          <div class="text-amber-300">⚡ 已生成本地造句模板（点击直接填入）：</div>
          <div class="space-y-1 pt-1">
            <button type="button" data-action="use-suggestion" data-suggestion="${escapeHtml(s1)}" class="w-full text-left p-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-emerald-300 transition">💬 "${escapeHtml(s1)}"</button>
            <button type="button" data-action="use-suggestion" data-suggestion="${escapeHtml(s2)}" class="w-full text-left p-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-cyan-300 transition">💬 "${escapeHtml(s2)}"</button>
          </div>
        `;
      } finally {
        if (explainBtnText) explainBtnText.textContent = 'AI 语境释义与地道造句示范';
      }
    }

    function processUsedHighlightWordsInTurn(playerText) {
      if (!playerText || !playerText.trim()) return [];
      if (!AppState.hudState) return [];
      if (!AppState.hudState.skills) AppState.hudState.skills = { known: [], unknown: [] };
      const skills = AppState.hudState.skills;
      if (!Array.isArray(skills.known)) skills.known = [];
      if (!Array.isArray(skills.unknown)) skills.unknown = [];

      const activatedTerms = [];

      // 1) 检查待激活生词本 skills.unknown
      for (let i = skills.unknown.length - 1; i >= 0; i--) {
        const uTerm = skills.unknown[i];
        if (doesPlayerInputMatchTerm(playerText, uTerm)) {
          skills.unknown.splice(i, 1);
          if (!skills.known.some(k => doesHighlightTermEqual(k, uTerm))) {
            skills.known.push(uTerm);
          }
          activatedTerms.push(extractHighlightEnglishCore(uTerm));
        }
      }

      // 2) 检查当前叙事面板中的高亮词 (.prose strong, .prose b)
      const container = document.getElementById('narrativeContainer');
      if (container) {
        container.querySelectorAll('.prose strong, .prose b').forEach(el => {
          const hTerm = (el.textContent || '').trim();
          if (!hTerm || hTerm.length > 60) return;
          if (doesPlayerInputMatchTerm(playerText, hTerm)) {
            const { state, matchedEntry } = getHighlightTermState(hTerm);
            if (state === 'unknown' && matchedEntry) {
              const idx = skills.unknown.indexOf(matchedEntry);
              if (idx !== -1) skills.unknown.splice(idx, 1);
              if (!skills.known.some(k => doesHighlightTermEqual(k, matchedEntry))) {
                skills.known.push(matchedEntry);
              }
              activatedTerms.push(extractHighlightEnglishCore(matchedEntry));
            } else if (state === 'new') {
              skills.known.push(hTerm);
              activatedTerms.push(extractHighlightEnglishCore(hTerm));
            }
          }
        });
      }

      if (activatedTerms.length > 0) {
        const uniqueActivated = [...new Set(activatedTerms)];
        const bonus = uniqueActivated.length * 2;
        let barLabel = '流利度';
        if (Array.isArray(AppState.hudState.bars) && AppState.hudState.bars.length > 0) {
          const b0 = AppState.hudState.bars[0];
          b0.current = Math.min(Number(b0.max) || 100, (Number(b0.current) || 0) + bonus);
          barLabel = b0.label || barLabel;
        }
        renderHud();
        saveCurrentSlotToStorage();
        showToast(`🎉 实战造句命中高亮表达【${uniqueActivated.join(' / ')}】！已自动解锁至「技能掌握」且 ${barLabel} +${bonus}！`, 'success');
      }

      return activatedTerms;
    }

    function syncVoiceWaveVisualizer(active) {
      const waveEl = document.getElementById('voiceWaveBars');
      if (waveEl) {
        waveEl.classList.toggle('hidden', !active);
        waveEl.classList.toggle('flex', !!active);
      }
      threeStageState.voiceEnergy = active ? 0.85 : 0;
    }

    function setVoicePlayIndicator(playing) {
      const stopBtn = document.getElementById('stopVoicePlayBtn');
      if (stopBtn) stopBtn.classList.toggle('hidden', !playing);
      syncVoiceWaveVisualizer(playing || isRecordingVoice);
    }

    function stopVoicePlayback() {
      if (currentTtsAudio) {
        try {
          currentTtsAudio.pause();
          currentTtsAudio.src = '';
        } catch (e) {}
        currentTtsAudio = null;
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
      setVoicePlayIndicator(false);
    }

    function speakWithBrowserTts(englishText) {
      if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
        showToast('当前环境不支持浏览器原生语音合成，请在 API 设置中配置 OpenAI 兼容 TTS 接口', 'error');
        setVoicePlayIndicator(false);
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(englishText);
        utter.lang = 'en-US';
        utter.rate = Number(AppState.voiceConfig?.speechRate) || 1.0;
        const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
        const preferred = voices.find(v => /en[-_]US/i.test(v.lang) && /(Natural|Neural|Aria|Jenny|Guy|Google|Samantha)/i.test(v.name))
          || voices.find(v => /^en/i.test(v.lang));
        if (preferred) utter.voice = preferred;
        utter.onstart = () => setVoicePlayIndicator(true);
        utter.onend = () => setVoicePlayIndicator(false);
        utter.onerror = () => setVoicePlayIndicator(false);
        setVoicePlayIndicator(true);
        window.speechSynthesis.speak(utter);
      } catch (e) {
        setVoicePlayIndicator(false);
        showToast('语音朗读启动失败: ' + e.message, 'error');
      }
    }

    async function speakEnglishText(rawText) {
      const englishText = extractEnglishForSpeech(rawText);
      if (!englishText || !/[A-Za-z]/.test(englishText)) {
        showToast('未检测到可朗读的英文句子', 'info');
        return;
      }
      stopVoicePlayback();
      const vcfg = AppState.voiceConfig || {};
      if (vcfg.ttsProvider === 'openai_tts') {
        const apiKey = (vcfg.apiKey && vcfg.apiKey.trim()) || (AppState.apiConfig.apiKey && AppState.apiConfig.apiKey.trim());
        if (!apiKey) {
          showToast('未配置语音 API Key，已自动使用浏览器原生美音朗读', 'info');
          speakWithBrowserTts(englishText);
          return;
        }
        const baseUrl = (vcfg.apiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        try {
          setVoicePlayIndicator(true);
          const res = await fetch(`${baseUrl}/audio/speech`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: vcfg.ttsModel || 'tts-1',
              input: englishText,
              voice: vcfg.ttsVoice || 'nova',
              speed: Number(vcfg.speechRate) || 1.0
            })
          });
          if (!res.ok) throw new Error(`TTS 接口返回 ${res.status}`);
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          currentTtsAudio = audio;
          audio.onended = () => {
            URL.revokeObjectURL(url);
            currentTtsAudio = null;
            setVoicePlayIndicator(false);
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            currentTtsAudio = null;
            setVoicePlayIndicator(false);
          };
          await audio.play();
          return;
        } catch (e) {
          console.warn('[奇点] 云端 TTS 朗读失败，已降级为浏览器原生美音:', e);
          showToast(`云端 TTS 不可用 (${e.message})，已切换为浏览器原生美音`, 'info');
          speakWithBrowserTts(englishText);
          return;
        }
      }
      speakWithBrowserTts(englishText);
    }

    function setVoiceRecordingUi(recording) {
      isRecordingVoice = recording;
      syncVoiceWaveVisualizer(recording);
      const btn = document.getElementById('voiceInputBtn');
      const icon = document.getElementById('voiceInputIcon');
      const text = document.getElementById('voiceInputText');
      if (!btn || !icon || !text) return;
      if (recording) {
        btn.className = 'px-3 py-2 rounded-xl bg-rose-900/80 hover:bg-rose-800 text-rose-100 border border-rose-500 text-xs font-medium flex flex-col items-center justify-center gap-0.5 shrink-0 transition animate-pulse';
        icon.textContent = '⏹';
        text.textContent = '结束识别';
      } else {
        btn.className = 'px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex flex-col items-center justify-center gap-0.5 shrink-0 transition';
        icon.textContent = '🎙️';
        text.textContent = '语音开口';
      }
    }

    async function toggleVoiceInput() {
      if (isRecordingVoice) {
        if (currentSpeechRecognition) {
          try { currentSpeechRecognition.stop(); } catch (e) {}
          currentSpeechRecognition = null;
        }
        if (currentMediaRecorder && currentMediaRecorder.state !== 'inactive') {
          try { currentMediaRecorder.stop(); } catch (e) {}
        }
        setVoiceRecordingUi(false);
        return;
      }

      const vcfg = AppState.voiceConfig || {};
      const inputEl = document.getElementById('playerInput');

      if (vcfg.sttProvider === 'openai_stt') {
        const apiKey = (vcfg.apiKey && vcfg.apiKey.trim()) || (AppState.apiConfig.apiKey && AppState.apiConfig.apiKey.trim());
        if (!apiKey) {
          showToast('请先在 API 设置中配置语音或主 API Key，或切换为浏览器实时语音识别', 'error');
          return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          showToast('当前环境不支持麦克风录音接口', 'error');
          return;
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          recordedAudioChunks = [];
          const recorder = new MediaRecorder(stream);
          currentMediaRecorder = recorder;
          recorder.ondataavailable = (ev) => {
            if (ev.data && ev.data.size > 0) recordedAudioChunks.push(ev.data);
          };
          recorder.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());
            setVoiceRecordingUi(false);
            if (!recordedAudioChunks.length) return;
            const audioBlob = new Blob(recordedAudioChunks, { type: 'audio/webm' });
            const baseUrl = (vcfg.apiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
            const formData = new FormData();
            formData.append('file', audioBlob, 'speech.webm');
            formData.append('model', vcfg.sttModel || 'whisper-1');
            formData.append('language', 'en');
            showToast('正在通过语音 API 识别您的英语口语...', 'info');
            try {
              const res = await fetch(`${baseUrl}/audio/transcriptions`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}` },
                body: formData
              });
              if (!res.ok) throw new Error(`STT 接口返回 ${res.status}`);
              const data = await res.json();
              const transcript = (data && data.text ? data.text : '').trim();
              if (transcript && inputEl) {
                inputEl.value = (inputEl.value ? inputEl.value.trim() + ' ' : '') + transcript;
                inputEl.focus();
                showToast('英语语音识别完成', 'success');
              } else {
                showToast('未识别到清晰语音，请重试', 'info');
              }
            } catch (err) {
              showToast(`云端语音识别失败: ${err.message}`, 'error');
            }
          };
          recorder.start();
          setVoiceRecordingUi(true);
          showToast('🎙️ 正在录音，请用英语开口表达，说完后再次点击按钮结束', 'info');
          return;
        } catch (err) {
          showToast('无法访问麦克风: ' + err.message, 'error');
          setVoiceRecordingUi(false);
          return;
        }
      }

      // 浏览器 Web Speech API 实时语音识别
      const SpeechRec = (typeof window !== 'undefined') && (window.SpeechRecognition || window.webkitSpeechRecognition);
      if (!SpeechRec) {
        showToast('当前浏览器内核不支持 Web Speech 识别，请在【API 设置】中将 STT 切换为 Whisper 兼容 API', 'error');
        return;
      }
      try {
        const rec = new SpeechRec();
        currentSpeechRecognition = rec;
        rec.lang = 'en-US';
        rec.continuous = true;
        rec.interimResults = false;
        rec.onresult = (event) => {
          let phrase = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              phrase += event.results[i][0].transcript + ' ';
            }
          }
          if (phrase.trim() && inputEl) {
            inputEl.value = (inputEl.value ? inputEl.value.trim() + ' ' : '') + phrase.trim();
            inputEl.focus();
          }
        };
        rec.onerror = (ev) => {
          setVoiceRecordingUi(false);
          currentSpeechRecognition = null;
          if (ev && ev.error !== 'aborted') {
            showToast(`语音识别中断 (${ev.error})，可重试或在 API 设置中切换 Whisper 接口`, 'info');
          }
        };
        rec.onend = () => {
          setVoiceRecordingUi(false);
          currentSpeechRecognition = null;
        };
        rec.start();
        setVoiceRecordingUi(true);
        showToast('🎙️ 正在聆听英语口语，说完后点击按钮即可结束', 'info');
      } catch (e) {
        setVoiceRecordingUi(false);
        showToast('启动语音识别失败: ' + e.message, 'error');
      }
    }

    // ===== 按需获取 AI 导师口语建议（用户点击按钮才触发，不主动剧透）=====
    let isRequestingTutorAdvice = false;

    async function requestTutorAdvice() {
      const panel = document.getElementById('tutorAdvicePanel');
      const bodyEl = document.getElementById('tutorAdviceBody');
      const btnText = document.getElementById('requestTutorAdviceText');
      if (!panel || !bodyEl) return;

      if (!hasApiCredential()) {
        showToast('请先配置 API Key 后再获取 AI 导师建议', 'error');
        document.getElementById('openApiSettingsBtn')?.click();
        return;
      }
      if (isRequestingTutorAdvice) return;

      panel.classList.remove('hidden');
      isRequestingTutorAdvice = true;
      if (btnText) btnText.textContent = '导师分析中...';
      bodyEl.innerHTML = '<div class="text-slate-400 py-2">🎓 AI Tutor 正在结合当前语境与您的上一轮发言生成地道口语建议...</div>';

      try {
        const recent = (AppState.narrativeHistory || []).slice(-4);
        const contextStr = recent.length
          ? recent.map(m => `${m.role === 'user' ? 'Learner (玩家)' : 'Story World / NPC'}:\n${m.text}`).join('\n\n---\n\n')
          : '（尚未开始对话，请根据下方场景设定给出开场第一句破冰英语建议）';
        const targetWords = (AppState.hudState?.skills?.unknown || []).slice(0, 6).join(', ') || '无特定待解锁词';

        const tutorPrompt = [
          '你是专属英语口语私教（AI Speaking Tutor）。玩家刚才主动点击了「💡 获取 AI 导师建议」按钮。',
          '请根据下方的最新对话上下文与待激活目标词汇（Word Maze），输出 JSON 格式的口语诊断与下一轮回答建议：',
          '{',
          '  "recast": "针对玩家上一句话的母语级地道润色（Recast）与简短语用点评；若玩家尚未发言，请简要点拨当前 NPC 台词里的地道表达亮点。",',
          '  "options": [',
          '    { "level": "B1 自然基础", "en": "一句简洁清晰的英文回应", "zh": "中文意思与适用语境说明" },',
          '    { "level": "B2 进阶流利", "en": "一句结合场景逻辑与高频搭配的英文回应", "zh": "中文意思与亮点词块解析" },',
          '    { "level": "C1 母语地道 (含目标词汇)", "en": "一句自然融入目标词汇的地道母语级英文回应", "zh": "中文意思与地道习语说明" }',
          '  ]',
          '}',
          '只输出纯 JSON 对象，不要代码块以外的多余解释。',
          '',
          `【当前待激活目标词汇】：${targetWords}`,
          `【当前场景设定摘要】：${(AppState.lore.world || '').slice(0, 1200)}`,
          `【最近对话记录】：\n${contextStr}`
        ].join('\n');

        const raw = await callLlmApi(
          [{ role: 'user', text: tutorPrompt }],
          '你是专业英语口语教练，严格输出合法的 JSON 对象。'
        );

        let parsed = null;
        try {
          const cleaned = String(raw || '').replace(/```json\s*/gi, '').replace(/```/g, '').trim();
          const firstBrace = cleaned.indexOf('{');
          const lastBrace = cleaned.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace > firstBrace) {
            parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
          }
        } catch (e) { /* 解析失败则退回 Markdown 渲染 */ }

        if (parsed && Array.isArray(parsed.options)) {
          const recastHtml = parsed.recast
            ? `<div class="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200"><span class="text-amber-300 font-semibold">✨ 上一轮口语润色 (Recast)：</span>${escapeHtml(parsed.recast)}</div>`
            : '';
          const optionsHtml = parsed.options.map(opt => {
            const en = String(opt.en || '').trim();
            const zh = String(opt.zh || '').trim();
            const lv = String(opt.level || '地道建议').trim();
            return `
              <div class="p-2 rounded-lg bg-slate-900/90 border border-slate-800 hover:border-purple-500/60 transition space-y-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800/60">${escapeHtml(lv)}</span>
                  <div class="flex items-center gap-1.5">
                    <button type="button" data-action="speak-text" data-speech="${escapeHtml(en)}" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] transition">🔊 跟读</button>
                    <button type="button" data-action="use-suggestion" data-suggestion="${escapeHtml(en)}" class="px-2 py-0.5 rounded bg-purple-700 hover:bg-purple-600 text-white text-[10px] font-medium transition">填入输入框</button>
                  </div>
                </div>
                <div class="text-slate-100 font-medium">${escapeHtml(en)}</div>
                <div class="text-[11px] text-slate-400">${escapeHtml(zh)}</div>
              </div>
            `;
          }).join('');
          bodyEl.innerHTML = recastHtml + `<div class="space-y-1.5">${optionsHtml}</div>`;
        } else {
          bodyEl.innerHTML = `<div class="prose prose-invert max-w-none text-xs">${renderNarrativeMarkdown(raw || '未能生成建议，请重试。')}</div>`;
        }
      } catch (err) {
        bodyEl.innerHTML = `<div class="text-rose-400">获取 AI 导师建议失败：${escapeHtml(err.message || String(err))}</div>`;
      } finally {
        isRequestingTutorAdvice = false;
        if (btnText) btnText.textContent = '获取 AI 导师建议';
      }
    }

    function removeStreamingBlock(block) {
      if (!block) return;
      block.__streamDone = true;
      if (block.isConnected) block.remove();
    }

    // 增量渲染：正常回合只追加新增的消息。
    // 旧实现每次都清空并重新 marked.parse 全部历史，是 O(n²)，长团会明显卡顿。
    // 空状态节点一旦被 container.innerHTML = '' 摘除，后续 getElementById 就再也找不到它。
    // 原实现在"先玩几回合、再重置"时会走到 appendChild(null) 直接抛异常，这里改为长期持有引用。
    let emptyNoticeEl = null;

    function showEmptyNotice(container) {
      if (!emptyNoticeEl || !emptyNoticeEl.isConnected) {
        const found = document.getElementById('emptyStoryNotice');
        if (found) emptyNoticeEl = found;
      }
      container.innerHTML = '';
      if (emptyNoticeEl) container.appendChild(emptyNoticeEl);
      else container.textContent = '世界之门尚未开启';
    }

    function renderAllNarratives(forceScrollBottom = true, forceFullRebuild = false) {
      const container = document.getElementById('narrativeContainer');
      const history = AppState.narrativeHistory;

      if (history.length === 0) {
        showEmptyNotice(container);
        renderedNarrativeCount = 0;
        return;
      }

      const needsRebuild = forceFullRebuild
        || renderedNarrativeCount > history.length
        || !container.querySelector('.narrative-msg');

      if (needsRebuild) {
        container.innerHTML = '';
        renderedNarrativeCount = 0;
      }

      for (let i = renderedNarrativeCount; i < history.length; i++) {
        container.appendChild(buildNarrativeNode(history[i]));
      }
      renderedNarrativeCount = history.length;
      if (typeof syncHighlightedElementsAndBar === 'function') {
        syncHighlightedElementsAndBar();
      }

      if (forceScrollBottom) {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      }
    }

    function escapeHtml(str) {
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // 净化 LLM 输出与导入文件产生的 HTML，阻断 <img onerror=...> 一类注入。
    // 注入脚本可读取 localStorage 中的 API Key，因此这里是关键防线。
    function sanitizeHtml(html) {
      if (typeof DOMPurify === 'undefined') {
        console.warn('[奇点] DOMPurify 未加载，已退化为纯文本渲染（不会执行任何 HTML）');
        return escapeHtml(html);
      }
      return DOMPurify.sanitize(html, {
        FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'link', 'meta', 'base'],
        FORBID_ATTR: ['style']
      });
    }

    function applyTactic(text) {
      const input = document.getElementById('playerInput');
      input.value = text;
      input.focus();
      document.getElementById('tacticsModal').classList.add('hidden');
    }

    function executeDiceRoll(sides) {
      sounds.playDiceRoll();
      triggerThreeStagePulse(2.0);
      const result = Math.floor(Math.random() * sides) + 1;
      const badge = document.getElementById('diceRollBadge');
      badge.textContent = `🎲 d${sides} => ${result}`;
      badge.classList.remove('hidden');

      const input = document.getElementById('playerInput');
      input.value = `[骰点检定 d${sides}: ${result}] `;
      input.focus();
    }

    let pendingDiceSides = null;

    function rollDice(sides = 20) {
      const input = document.getElementById('playerInput');
      const val = input.value.trim();
      if (val.length > 0 && !/^\[骰点检定 d\d+:\s*\d+\]\s*$/.test(val)) {
        pendingDiceSides = sides;
        document.getElementById('diceConfirmModal').classList.remove('hidden');
      } else {
        executeDiceRoll(sides);
      }
    }

    function startWizardOpening() {
      // 每次打开都依当前蓝图重建表单（不同世界的创建项完全不同）
      renderWizardFromSchema();
      document.getElementById('wizardModal').classList.remove('hidden');
    }

    function renderSlotsList() {
      const container = document.getElementById('slotsListContainer');
      if (!container) return;
      container.innerHTML = '';

      container.onclick = (e) => {
        const btn = e.target.closest('button[data-slot-action]');
        if (!btn) return;
        if (btn.dataset.slotAction === 'switch') switchSlot(btn.dataset.slotId);
        else if (btn.dataset.slotAction === 'delete') deleteSlot(btn.dataset.slotId);
      };

      AppState.slots.forEach(s => {
        const isCurrent = s.id === AppState.currentSlotId;
        const row = document.createElement('div');
        row.className = `p-2.5 rounded-xl border flex items-center justify-between transition ${isCurrent ? 'border-purple-500 bg-purple-950/30' : 'border-slate-800 bg-slate-950 hover:border-slate-700'}`;
        row.innerHTML = `
          <div>
            <div class="font-bold text-slate-100">${escapeHtml(s.name)} ${isCurrent ? '<span class="text-[10px] text-purple-400 font-mono ml-1">● 当前</span>' : ''}</div>
            <div class="text-[10px] text-slate-500">${escapeHtml(s.desc || '自定义世界')}</div>
          </div>
          <div class="flex items-center gap-1.5">
            <button type="button" data-slot-id="${escapeHtml(s.id)}" data-slot-action="switch" class="px-2.5 py-1 rounded text-[11px] font-medium transition ${isCurrent ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">
              ${isCurrent ? '已激活' : '切换'}
            </button>
            ${AppState.slots.length > 1 ? `
            <button type="button" data-slot-id="${escapeHtml(s.id)}" data-slot-action="delete" class="px-2 py-1 rounded text-[11px] font-medium bg-red-950/50 hover:bg-red-900 text-red-300 border border-red-800/40 transition" title="删除该世界">
              ✕
            </button>` : ''}
          </div>
        `;
        container.appendChild(row);
      });
    }

    function switchSlot(slotId) {
      saveCurrentSlotToStorage();
      loadSlotState(slotId);
      document.getElementById('slotModal').classList.add('hidden');
      showToast(`已切换至世界：${AppState.slots.find(s => s.id === slotId)?.name}`, 'success');
    }

    function deleteSlot(slotId) {
      if (AppState.slots.length <= 1) {
        showToast('至少保留一个世界', 'info');
        return;
      }
      const slotName = (AppState.slots.find(s => s.id === slotId) || {}).name || slotId;
      AppState.slots = AppState.slots.filter(s => s.id !== slotId);

      // 清理该世界的存档键，否则删掉的世界仍占着 localStorage 配额
      let removedKeys = 0;
      try {
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith(`chronicle_${slotId}_`)) { localStorage.removeItem(k); removedKeys++; }
        });
      } catch (e) {
        console.warn('[奇点] 清理旧存档键失败:', e);
      }

      if (AppState.currentSlotId === slotId) {
        AppState.currentSlotId = AppState.slots[0].id;
        loadSlotState(AppState.currentSlotId);
      }
      saveCurrentSlotToStorage();
      renderSlotsList();
      showToast(`已删除世界「${slotName}」及其 ${removedKeys} 项存档`, 'info');
    }

    const BUILTIN_SPEAKING_PACKS = {
      'silicon-valley': {
        worldName: '硅谷路演与咖啡馆口语实战',
        desc: '旧金山 SoMa 创业社交、极客共创与投资人电梯路演英语口语实战剧场',
        lore: {
          world: '【沉浸式口语剧场：旧金山 SoMa 创业脉搏 (San Francisco Startup Pulse)】\n\n一、场景定位与跨文化背景（Story World Setting）\n这里是美国旧金山南市场区（SoMa, San Francisco）——全球 AI 创业者、投资人与产品极客密度最高的街区。清晨的阳光洒进 Mint Plaza 街角的 Blue Bottle Coffee，浓缩咖啡机的蒸汽声与周围用英语激烈讨论 LLM Agent、Product-Market Fit 的交谈声交织在一起。\n\n你作为一名刚抵达旧金山的 AI 开发者 / 产品创造者，正在带着自己打磨的「AI 实时生成英语口语互动引擎」原型参加本周的创始人咖啡社交（Founder Coffee Chat）与 Demo Day 预热路演。你的目标是跨越语言障碍，用自然、地道、有说服力的英语与当地的工程师、投资人和创作者建立真实连接。\n\n二、核心常驻语伴与人物（NPC Personas）\n1. **Elena Vance**（早期风投合伙人 / Seed Partner at Horizon Ventures）\n   · 性格与说话风格：语速干脆、直奔主题（direct & analytical），喜欢听具体的数据与用户痛点，讨厌空洞的行业黑话。\n   · 英语口语对练定位：商务路演（Elevator Pitch）、产品价值阐述、应对尖锐追问（Q&A Handling）。\n   · 常用地道表达："What\'s your unfair advantage?" / "Walk me through the user journey." / "That\'s a crowded space—what makes it sticky?"\n\n2. **Marcus Chen**（旧金山 AI 创业公司高级工程师 / Senior AI Engineer）\n   · 性格与说话风格：热情健谈、充满技术好奇心（warm & geeky），正在吧台旁调试一套多智能体工作流（Multi-Agent Workflow）。\n   · 英语口语对练定位：技术交流（Tech Talk）、Prompt Engineering 经验分享、职场同行破冰（Networking）。\n   · 常用地道表达："We hit a latency bottleneck yesterday." / "How are you handling context window drift?" / "Let\'s bounce some ideas around."\n\n3. **Maya Lin**（精品咖啡师兼独立播客主理人 / Barista & Indie Podcaster）\n   · 性格与说话风格：松弛幽默、地道美式西海岸口语（casual & idiomatic），擅长用日常俚语和温暖寒暄让人放松下来。\n   · 英语口语对练定位：日常点单与闲聊（Small Talk）、生活故事分享、克服开口紧张感。\n   · 常用地道表达："You look like you could use an extra shot of espresso!" / "No worries, take your time." / "What brings you to the Bay Area?"\n\n三、目标词库（Target Vocabulary）\n鼓励学习者在本世界互动中自然激活以下高频地道表达（当玩家主动准确使用时，系统会自动将其移入「已掌握词汇」列表）：\n- **pain point**（核心痛点）\n- **traction**（产品增长势头 / 用户验证数据）\n- **bottleneck**（瓶颈 / 卡点）\n- **game-changer**（颠覆性创新 / 破局点）\n- **on the same page**（达成共识 / 理解一致）\n- **flesh out**（充实细节 / 具体展开说说）\n- **resonate with**（引起共鸣）\n- **low-hanging fruit**（容易快速见效的切入点）\n- **scalable**（可扩展的 / 可规模化的）\n\n四、三条递进式情境主线（Scenario Missions）\n· **Stage 1 · Coffee Shop Icebreaker（吧台破冰与点单闲聊）**：在 Blue Bottle 与 Maya 完成地道点单与 Small Talk，并与邻座调试代码的 Marcus 搭话破冰。\n· **Stage 2 · Technical Brainstorm（极客共创与词汇实战）**：与 Marcus 探讨如何将大模型变成有温度的 AI 口语语伴，在对话中实战激活至少 3 个目标词汇。\n· **Stage 3 · The 3-Minute Pitch（硅谷投资人闪电路演）**：抓住 Elena 喝咖啡的黄金 10 分钟，用流畅英文向她演示你的产品愿景并赢得下周 Office Hours 的深度面谈邀约。',
          character: '【角色卡—Alex】\n姓名：Alex / 文化背景：双语AI创造者 / 角色定位：AI Engineer & Builder / 英语等级：CEFR B2 (进阶实战)\n性别：不限 / 年龄：22\n外貌与随身特征：背着装有实时口语互动文游引擎 Demo 的笔记本电脑，手里拿着刚记满地道表达笔记的随身手卡，眼神专注而充满好奇。\n属性：流利度：14 / 词汇量：14 / 语法准确：15 / 语用得体：14 / 逻辑说服：15\n流利度 (Fluency)：78 / 表达自信 (Confidence)：75 / 语用得体度 (Pragmatics)：76',
          rules: '【双核驱动法则：沉浸式情境叙事 + 按需口语教练】\n\n1. **沉浸式双语/全英分层叙事**：\n   · 剧中 NPC 的所有台词必须使用地道、自然的美式英语（匹配 CEFR B1-C1 真实硅谷语境）。\n   · 场景动作与环境氛围描写以英文为主（或关键处附简练中文情境提示），让玩家身临其境地感受旧金山咖啡馆与路演现场。\n   · 在正文中主动用 **Markdown 加粗** 标记 1~2 个值得习得的地道短语或习语（Collocations / Idioms）。\n   · 绝不替玩家做决定，不在正文末尾列出机械的 A/B/C 选项；每次把对话话筒自然交给玩家。\n\n2. **AI 建议按需触发（严禁在正文中直接给出建议）**：\n   · 正常对话回合中，只输出纯粹的剧中人物对话与情境反应，不要在正文中直接给出 AI 导师纠错建议或下一轮回复选项，把独立思考和开口表达的空间完整留给玩家（玩家需要建议时会自行点击界面上的「💡 获取 AI 导师建议」按钮）。\n   · 仅当玩家消息以 [AI Tutor] / [Ask AI Tutor] / [AI Summary] 开头主动求助时，才在回复中提供针对性的地道润色（Recast）与分级英文回应示范。\n\n3. **词汇迷宫动态激励**：\n   · 当玩家在英文回复中主动用出「待激活词汇（unknown）」中的词或短语时，在末尾数据块中将该词移入「已掌握词汇（known）」，同时为流利度/表达自信状态条 +3~+5。',
          memoryPins: '- 学习者当前等级为 CEFR B2，目标是提升在真实硅谷职场与跨文化社交中的英语口语流利度与地道感。\n- 当前身处旧金山 SoMa 区的 Blue Bottle Coffee，随身携带着「AI 实时口语互动文游引擎」原型 Demo。\n- 待实战激活的核心词汇：traction, bottleneck, game-changer, on the same page, flesh out, resonate with。\n- 口语导师重点关注：帮助学习者用自然连接词（Well, Actually, The way I see it）替代生硬停顿，并用具体动词短语替代笼统的 make/do。'
        },
        wizardConfig: {
          races: ['双语AI创造者', '国际交换学者', '硅谷初创极客', '跨国远程开发者', '独立产品设计师'],
          classes: ['AI Engineer', 'Product Manager', 'Startup Founder', 'UX Researcher', 'Full-Stack Builder'],
          identities: ['CEFR B1 (日常流利)', 'CEFR B2 (职场实战)', 'CEFR C1 (母语级表达)', 'Pitch 路演挑战者'],
          attributes: ['流利度', '词汇量', '语法准确', '语用得体', '逻辑说服'],
          pointBudget: 25,
          maxPerStat: 8
        },
        hudState: {
          character_profile: {
            name: 'Alex',
            gender: '美式通用 (General American)',
            age: '1.0x 自然常速',
            race: '双语AI创造者',
            class: 'AI Engineer',
            identity: 'CEFR B2 (职场实战)',
            appearance: '带着「AI 实时生成英语口语互动引擎」Demo 来到旧金山 SoMa，希望通过真实场景对话打磨地道表达与产品 Pitch 能力。'
          },
          location: 'Blue Bottle Coffee · Mint Plaza (SF)',
          time: '上午 09:30 · 阳光明媚的咖啡社交时刻',
          bars: [
            { label: '流利度 (Fluency)', current: 78, max: 100, color: 'emerald' },
            { label: '表达自信 (Confidence)', current: 75, max: 100, color: 'cyan' },
            { label: '语用得体度 (Pragmatics)', current: 76, max: 100, color: 'amber' }
          ],
          attribute_cap: 20,
          attributes: {
            '流利度': { current: 14, max: 20 },
            '词汇量': { current: 14, max: 20 },
            '语法准确': { current: 15, max: 20 },
            '语用得体': { current: 14, max: 20 },
            '逻辑说服': { current: 15, max: 20 }
          },
          weapon_mastery: {
            'Small Talk (破冰闲聊)': { level: 'B2 职场', exp: 60 },
            'Tech Discussion (技术探讨)': { level: 'B2 职场', exp: 55 },
            'Elevator Pitch (产品路演)': { level: 'B1 日常', exp: 40 }
          },
          npc_codex: [
            { name: 'Maya Lin', race: 'Barista & Indie Podcaster', personality: 'Warm, casual, West Coast idiomatic', love_type: '破冰语伴 (Icebreaker)', affection: 65, affDelta: 0, trust: 60, trustDelta: 0, depth: 35, depthDelta: 0 },
            { name: 'Marcus Chen', race: 'Senior AI Engineer', personality: 'Geeky, collaborative, curious about LLMs', love_type: '技术同行 (Tech Peer)', affection: 55, affDelta: 0, trust: 55, trustDelta: 0, depth: 40, depthDelta: 0 },
            { name: 'Elena Vance', race: 'Seed Partner @ Horizon VC', personality: 'Sharp, fast-paced, values clarity & traction', love_type: '路演导师 (Investor)', affection: 45, affDelta: 0, trust: 50, trustDelta: 0, depth: 30, depthDelta: 0 }
          ],
          spells: [
            { name: "I couldn't help noticing...", ring: 'B2 破冰', mp: 1, desc: '自然切入他人话题："I couldn\'t help noticing your laptop screen—are you building an AI agent workflow?"' },
            { name: "The core pain point we're solving is...", ring: 'B2 路演', mp: 2, desc: '一针见血阐述产品价值："The core pain point we\'re solving is that traditional language apps lack real situational context."' },
            { name: "Just to make sure we're on the same page...", ring: 'B2 确认', mp: 1, desc: '职场与技术讨论中的礼貌对齐："Just to make sure we\'re on the same page, are you suggesting we optimize latency first?"' },
            { name: 'To flesh that out a bit...', ring: 'C1 进阶', mp: 3, desc: '展开补充细节的高分连接词："To flesh that out a bit, our engine combines Story Worlds with real-time AI Tutor recasts."' }
          ],
          skills: {
            known: ['pain point (核心痛点)', 'seamless (无缝丝滑的)', 'iterate (快速迭代)'],
            unknown: ['traction (增长验证)', 'bottleneck (性能/业务瓶颈)', 'game-changer (破局点)', 'on the same page (达成共识)', 'flesh out (充实展开细节)', 'resonate with (引起共鸣)', 'low-hanging fruit (易见效切入点)', 'scalable (可规模化的)']
          },
          status_effects: [
            { name: 'Morning Espresso Boost', type: 'buff', desc: '身处旧金山 SoMa 创业氛围中，开口意愿与语感敏锐度提升' }
          ],
          inventory: [
            { name: 'Story Worlds 引擎原型平板', qty: 1, icon: '💻', desc: '装有你开发的 AI 实时口语互动文游引擎 Demo，随时可向 Marcus 或 Elena 现场演示。' },
            { name: 'Blue Bottle 手冲咖啡券', qty: 2, icon: '☕', desc: '可在吧台点单，或请邻座的工程师/投资人喝一杯手冲咖啡自然破冰。' },
            { name: '硅谷核心表达手卡', qty: 1, icon: '📇', desc: '记录着硅谷 Coffee Chat 与 Pitch 常用句型脚手架的随身卡片。' }
          ]
        }
      },
      'ivy-campus': {
        worldName: '常春藤校园研讨与社团破冰',
        desc: '北美名校 Seminar 研讨课发言、草坪社团招新与教授 Office Hours 英语口语实战剧场',
        lore: {
          world: '【沉浸式口语剧场：常春藤秋季学期 · 学术研讨与校园社交 (Ivy League Campus Life)】\n\n一、场景定位与跨文化背景（Story World Setting）\n金秋九月，阳光穿过古老的红砖钟楼与银杏树叶，洒在北美顶尖学府的中央草坪（Memorial Glade）上。下课钟声敲响，来自世界各地的学生抱着笔记本电脑穿梭在研讨室、学生中心咖啡吧与草坪社团招新摊位之间。\n\n你作为一名刚开启本学期课程的国际交换生 / 访问研究生，正面临北美校园生活中最核心的三大英语口语挑战：在节奏飞快的 Seminar 研讨课上抢过话筒清晰表达观点、在热闹的草坪社团招新派对（Club Mixer）中与本土同学自然破冰闲聊、以及在教授的办公时间（Office Hours）一对一探讨研究课题与助研（RA）机会。\n\n二、核心常驻语伴与人物（NPC Personas）\n1. **Chloe Miller**（大二传媒系主修 & 创客社团会长 / Sophomore Media Major & Club President）\n   · 性格与说话风格：阳光外向、语速轻快，大量使用地道北美校园俚语与日常习语（casual, energetic & idiomatic），非常乐意带新同学融入社交圈。\n   · 英语口语对练定位：校园破冰寒暄（Campus Small Talk）、社团活动交流、周末聚会邀约、地道美式俚语运用。\n   · 常用地道表达："Have you settled into your dorm yet?" / "I\'ve been totally swamped with readings this week!" / "We really hit it off—you should totally come to our mixer tonight!"\n\n2. **Liam O\'Connor**（计算机与认知科学博士助教 / PhD Teaching Assistant）\n   · 性格与说话风格：思维敏锐、风趣健谈（witty & analytical），主持每周五的 Seminar 小组讨论，喜欢用苏格拉底式追问激发同学把观点说深说透。\n   · 英语口语对练定位：课堂讨论插话（Jumping in）、礼貌反驳与辩证思考（Playing devil\'s advocate）、逻辑展开与举例论证。\n   · 常用地道表达："That\'s an intriguing angle—could you unpack that a bit?" / "If I may play devil\'s advocate here..." / "How does that tie back to our main hypothesis?"\n\n3. **Prof. Arthur Pendelton**（认知科学与人工智能伦理终身教授 / Tenured Professor）\n   · 性格与说话风格：温文尔雅但学术标准严谨（warm yet rigorous），欣赏有独立思考、表达简洁有条理的学生，最怕学生支支吾吾不敢开口。\n   · 英语口语对练定位：学术口语汇报（Academic Pitching）、Office Hours 课题请教、争取实验室研究机会。\n   · 常用地道表达："What\'s the core question you\'re trying to shed light on?" / "That\'s a compelling argument, provided you can back it up." / "Let\'s touch base again next Tuesday."\n\n三、目标词库（Target Vocabulary）\n鼓励学习者在本校园世界的互动中主动运用以下高频地道表达（当玩家准确使用时，系统自动将其移入「已掌握词汇」）：\n- **build on that**（在此观点基础上补充延伸）\n- **play devil\'s advocate**（故意唱反调 / 从反面进行辩证推演）\n- **swamped with**（被课业或事务忙得不可开交）\n- **shed light on**（阐明 / 揭示某个复杂问题）\n- **hit it off**（一见如故 / 聊得非常投机）\n- **compelling**（令人信服的 / 引人入胜的）\n- **wrap my head around**（弄懂、理解某个复杂的概念）\n- **touch base**（简短碰头沟通 / 跟进近况）\n\n四、三条递进式情境主线（Scenario Missions）\n· **Stage 1 · Campus Quad Club Mixer（中央草坪社团招新破冰）**：在社团招新摊位前与学姐 Chloe 自然搭话，聊聊开学第一周的适应情况并用校园地道口语完成破冰。\n· **Stage 2 · The Seminar Debate（研讨课思想交锋）**：走进 12 人圆桌研讨室，在助教 Liam 的引导下围绕「AI 是否会重塑人类创造力」主动抢话发言、补充他人观点或礼貌反驳。\n· **Stage 3 · Professor\'s Office Hours（教授办公室深度面谈）**：敲开 Pendelton 教授办公室的门，在 10 分钟内清晰阐述你的期末研究构想，赢得教授认可并加入他的课题组。',
          character: '【角色卡—Lin】\n学习者：Lin / 背景：国际交换生 / 学术方向：Cognitive Science & AI / 英语等级：CEFR B2 (校园与学术进阶)\n偏好口音：美式通用 (General American) / 练习语速：1.0x 自然常速\n外貌与随身特征：背着双肩包、手里拿着冰美式与《AI & Human Mind》研讨课讲义，怀着期待又略带紧张的心情走进校园中央草坪。\n属性：流利度：14 / 词汇量：14 / 语法准确：15 / 语用得体：14 / 学术思辨：15\n流利度 (Fluency)：76 / 表达自信 (Confidence)：74 / 语用得体度 (Pragmatics)：78',
          rules: '【校园篇双核驱动法则：沉浸式校园英语叙事 + 按需口语教练】\n\n1. **沉浸式北美校园英语叙事**：\n   · 剧中同学、助教与教授的所有台词必须使用真实、鲜活的美式英语（区分草坪社交的轻松俚语与研讨课/办公室的得体学术口语）。\n   · 场景过渡与神态描写自然流畅，并在正文中用 **Markdown 加粗** 标记 1~2 个值得顺便习得的校园或学术地道短语（Collocations / Idioms）。\n   · 绝不替玩家做决定，不在正文末尾列出机械的 A/B/C 选项；每次把对话话筒自然交给玩家。\n\n2. **AI 建议按需触发（严禁在正文中直接给出建议）**：\n   · 正常对话回合中，只输出纯粹的校园场景与 NPC 英语对话，不要在正文中直接给出 AI 导师建议、语法纠错或下一轮回复选项，把独立开口思考的空间完整留给玩家（由玩家自行决定是否点击界面上的「💡 获取 AI 导师建议」按钮）。\n   · 仅当玩家消息以 [AI Tutor] / [Ask AI Tutor] / [AI Summary] 开头主动求助时，才在回复中提供针对性的地道润色（Recast）与分级英文回应示范。\n\n3. **词汇迷宫动态激励**：\n   · 当玩家在英文回复中主动且恰当地使用了「待激活词汇（unknown）」中的短语时，在末尾数据块中将该词移入「已掌握词汇（known）」，并为流利度与表达自信状态条 +3~+5。',
          memoryPins: '- 学习者当前等级为 CEFR B2，目标是攻克北美大学校园社交（Small Talk）与研讨课学术发言（Seminar & Office Hours）。\n- 当前身处校园中央草坪（Memorial Glade）的社团招新现场，稍后将参加 Liam 的研讨课与 Pendelton 教授的 Office Hours。\n- 待实战激活的目标词汇：build on that, play devil\'s advocate, swamped with, shed light on, hit it off, compelling, wrap my head around, touch base。'
        },
        wizardConfig: {
          races: ['国际交换本科生', '访问硕士研究生', '跨学科博士新生', '奖学金访问学者', '校园创客社团成员'],
          classes: ['Cognitive Science & AI', 'Computer Science', 'Media & Communication', 'Economics & Business', 'Digital Humanities'],
          identities: ['CEFR B1 (日常校园交流)', 'CEFR B2 (研讨课流利发言)', 'CEFR C1 (学术辩论与发表)', 'Office Hours 挑战者'],
          attributes: ['流利度', '词汇量', '语法准确', '语用得体', '学术思辨'],
          pointBudget: 25,
          maxPerStat: 8
        },
        hudState: {
          character_profile: {
            name: 'Lin',
            gender: '美式通用 (General American)',
            age: '1.0x 自然常速',
            race: '国际交换本科生',
            class: 'Cognitive Science & AI',
            identity: 'CEFR B2 (研讨课流利发言)',
            appearance: '背着装有 Seminar 论文讲义的双肩包走在秋季阳光下的中央草坪，准备先在社团招新摊位破冰，再去参加研讨课与教授 Office Hours。'
          },
          location: 'Memorial Glade 中央草坪 · 社团招新现场',
          time: '周五下午 13:45 · 研讨课开始前 30 分钟',
          bars: [
            { label: '流利度 (Fluency)', current: 76, max: 100, color: 'emerald' },
            { label: '表达自信 (Confidence)', current: 74, max: 100, color: 'cyan' },
            { label: '语用得体度 (Pragmatics)', current: 78, max: 100, color: 'amber' }
          ],
          attribute_cap: 20,
          attributes: {
            '流利度': { current: 14, max: 20 },
            '词汇量': { current: 14, max: 20 },
            '语法准确': { current: 15, max: 20 },
            '语用得体': { current: 14, max: 20 },
            '学术思辨': { current: 15, max: 20 }
          },
          weapon_mastery: {
            'Campus Social (社团破冰)': { level: 'B2 积极发言', exp: 55 },
            'Seminar Discussion (课堂交锋)': { level: 'B1 破冰', exp: 45 },
            'Office Hours (教授面谈)': { level: 'B1 破冰', exp: 40 }
          },
          npc_codex: [
            { name: 'Chloe Miller', race: 'Sophomore & Club President', personality: 'Energetic, friendly, uses campus slang', love_type: '社团学姐 (Club Peer)', affection: 65, affDelta: 0, trust: 60, trustDelta: 0, depth: 35, depthDelta: 0 },
            { name: "Liam O'Connor", race: 'PhD Teaching Assistant', personality: 'Witty, Socratic, loves critical debate', love_type: '研讨课助教 (Seminar TA)', affection: 55, affDelta: 0, trust: 55, trustDelta: 0, depth: 40, depthDelta: 0 },
            { name: 'Prof. Arthur Pendelton', race: 'Cognitive Science Professor', personality: 'Warm, rigorous, values clear hypotheses', love_type: '学术导师 (Advisor)', affection: 50, affDelta: 0, trust: 50, trustDelta: 0, depth: 30, depthDelta: 0 }
          ],
          spells: [
            { name: 'If I could just jump in and build on...', ring: 'B2 研讨抢话', mp: 1, desc: '在 Seminar 课堂自然插话并补充同学观点："If I could just jump in and build on what Liam said, I think..."' },
            { name: "To play devil's advocate for a second...", ring: 'C1 辩证反驳', mp: 2, desc: '礼貌提出反面论点而不显得冒犯："I see your point, but to play devil\'s advocate for a second, what if...?"' },
            { name: "I've been trying to wrap my head around...", ring: 'B2 学术请教', mp: 2, desc: '在 Office Hours 向教授请教难点："Professor, I\'ve been trying to wrap my head around this paper\'s methodology."' },
            { name: "I've been pretty swamped with..., but...", ring: 'B2 校园寒暄', mp: 1, desc: '与同学拉近距离的地道日常表达："I\'ve been pretty swamped with readings this week, but I\'d love to check out the club mixer!"' }
          ],
          skills: {
            known: ['settle in (安顿适应下来)', 'unpack (深入拆解分析)', 'hands-on (亲自动手实践的)'],
            unknown: ['build on that (在此基础上补充)', "play devil's advocate (唱反调/辩证思考)", 'swamped with (忙得不可开交)', 'shed light on (阐明/揭示)', 'hit it off (一见如故/聊得投机)', 'compelling (有说服力的)', 'wrap my head around (理解复杂概念)', 'touch base (简短碰头沟通)']
          },
          status_effects: [
            { name: 'Autumn Campus Vibe', type: 'buff', desc: '沉浸在开放包容的常春藤校园氛围中，跨文化交流好奇心与表达欲提升' }
          ],
          inventory: [
            { name: '《AI & Human Creativity》研讨课讲义', qty: 1, icon: '📑', desc: '空白处写满了你用英文做的批注与两个待探讨的研究问题。' },
            { name: '创客社团招新传单 & 冰美式', qty: 1, icon: '🥤', desc: 'Chloe 刚递给你的社团 Mixer 邀请函，上面印着今晚披萨夜的时间地点。' },
            { name: 'Office Hours 研究构想提纲', qty: 1, icon: '📝', desc: '准备在 Pendelton 教授办公室汇报的一页纸 Research Proposal。' }
          ]
        }
      }
    };

    function loadBuiltinWorldPack(packKey) {
      const pack = BUILTIN_SPEAKING_PACKS[packKey];
      if (!pack) return;
      const loreObj = pack.lore;
      document.getElementById('worldLoreInput').value = loreObj.world || '';
      document.getElementById('characterLoreInput').value = loreObj.character || '';
      document.getElementById('rulesInput').value = loreObj.rules || '';
      document.getElementById('memoryPinsInput').value = loreObj.memoryPins || '';

      AppState.lore = {
        world: loreObj.world || '',
        character: loreObj.character || '',
        rules: loreObj.rules || '',
        memoryPins: loreObj.memoryPins || ''
      };

      const curSlot = AppState.slots.find(s => s.id === AppState.currentSlotId);
      if (curSlot) {
        curSlot.name = pack.worldName;
        curSlot.desc = pack.desc;
        const badgeEl = document.getElementById('headerSlotNameDisplay');
        if (badgeEl) badgeEl.textContent = pack.worldName;
      }

      if (pack.wizardConfig) {
        AppState.wizardConfig = JSON.parse(JSON.stringify(pack.wizardConfig));
      }
      if (pack.hudState) {
        AppState.hudState = Object.assign(defaultHudState(), JSON.parse(JSON.stringify(pack.hudState)));
        renderHud();
      }
      saveCurrentSlotToStorage();
      updateRailIndicator();
      syncWizardOptionsAndChips();
      showToast(`已载入「${pack.worldName}」口语世界！可直接用英语发送第一句话或点击「口语档案向导」开局`, 'success');
      const playerInput = document.getElementById('playerInput');
      if (playerInput) playerInput.focus();
    }

    function handleLoreFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target.result;
        try {
          if (file.name.endsWith('.json')) {
            const parsed = JSON.parse(content);
            if (parsed.world || parsed.character || parsed.lore) {
              const loreObj = parsed.lore || parsed;
              document.getElementById('worldLoreInput').value = loreObj.world || '';
              document.getElementById('characterLoreInput').value = loreObj.character || '';
              document.getElementById('rulesInput').value = loreObj.rules || '';
              document.getElementById('memoryPinsInput').value = loreObj.memoryPins || '';

              AppState.lore = {
                world: loreObj.world || '',
                character: loreObj.character || '',
                rules: loreObj.rules || '',
                memoryPins: loreObj.memoryPins || ''
              };

              if (parsed.worldSchema && typeof parsed.worldSchema === 'object') {
                applyWorldSchema(parsed.worldSchema, { silent: true });
              }
              if (parsed.hudState && typeof parsed.hudState === 'object') {
                AppState.hudState = Object.assign(defaultHudState(), parsed.hudState);
                renderHud();
              }
              if (parsed.wizardConfig) {
                AppState.wizardConfig = Object.assign(AppState.wizardConfig, parsed.wizardConfig);
              } else {
                analyzeWorldLoreWithApi(AppState.lore.world, true);
              }

              saveCurrentSlotToStorage();
              updateRailIndicator();
              syncWizardOptionsAndChips();
              showToast(`成功解析并载入设定集: ${file.name}`, 'success');
              return;
            }
          }
        } catch (err) {
          // 不是有效 JSON 就按纯文本导入，但至少留下痕迹，免得用户以为文件被正确解析了
          console.warn('[奇点] 设定文件不是有效 JSON，已按纯文本导入:', err.message);
        }

        document.getElementById('worldLoreInput').value = content;
        AppState.lore.world = content;
        analyzeWorldLoreWithApi(content, false);
        saveCurrentSlotToStorage();
        updateRailIndicator();
        syncWizardOptionsAndChips();
        showToast(`已将文件【${file.name}】导入并提交 API 分析世界观`, 'success');
      };
      reader.readAsText(file);
    }

    // GM 规则的导入通道：**只替换规则栏**，不碰世界法则 / 主角卡 / 长线锚点。
    // 与 handleLoreFile 的区别是这里不做 API 分析 —— 规则是用户自己定的约束，
    // 没有"让模型提取一遍"这回事；整包 JSON 也走上面那个世界设定落点。
    function handleRulesFile(file) {
      if (!file) return;

      const applyRules = (text, okMessage) => {
        const value = String(text == null ? '' : text);
        const input = document.getElementById('rulesInput');
        if (input) input.value = value;
        AppState.lore.rules = value;
        saveCurrentSlotToStorage();
        updateRailIndicator();
        showToast(okMessage, 'success');
      };

      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = String(ev.target.result == null ? '' : ev.target.result);

        if (/\.json$/i.test(file.name)) {
          let parsed = null;
          try {
            parsed = JSON.parse(content);
          } catch (err) {
            // 不是有效 JSON 就按纯文本导入，但留下痕迹
            console.warn('[奇点] GM 规则文件不是有效 JSON，已按纯文本导入:', err.message);
          }

          if (parsed) {
            const rules = (parsed.lore && parsed.lore.rules) || parsed.rules;
            if (typeof rules === 'string' && rules.trim()) {
              applyRules(rules, `已从【${file.name}】导入 GM 规则`);
            } else {
              // 别把一整个 JSON 灌进规则栏：整包导入有它自己的落点
              showToast(`【${file.name}】里没有 GM 规则字段；要导入整个世界包，请拖到上方的世界设定区`, 'error');
            }
            return;
          }
        }

        applyRules(content, `已将【${file.name}】导入 GM 规则栏`);
      };
      reader.onerror = () => showToast(`读取文件【${file.name}】失败`, 'error');
      reader.readAsText(file);
    }

    // 模态框可访问性：补上 dialog 语义、Esc 关闭、以及焦点陷阱
    // （此前 9 个弹窗都是裸 div：键盘无法关闭，Tab 会跑到弹窗背后的界面上去）
    const MODAL_IDS = ['wizardModal', 'slotModal', 'tacticsModal', 'apiModal', 'settingsModal', 'attributeCapModal', 'resetConfirmModal', 'diceConfirmModal', 'manualHudModal', 'schemaModal'];
    const BACKDROP_CLOSABLE = ['tacticsModal', 'apiModal', 'settingsModal', 'attributeCapModal'];

    const FOCUSABLE_SEL = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    // 弹窗的显隐全都是到处直接 classList.toggle('hidden')，与其改二十个调用点，
    // 不如用 MutationObserver 盯住这个 class：变可见 → 焦点进弹窗，全关掉 → 焦点还回去。
    function topOpenModal() {
      const open = MODAL_IDS.filter(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
      });
      // 所有弹窗 z-index 相同，因此 DOM 里靠后的那个盖在上面
      return open.length ? document.getElementById(open[open.length - 1]) : null;
    }

    // jsdom 没有布局（offsetParent 恒为 null），不能用它判断可见性。
    // 这里沿 DOM 往上查本项目实际使用的两种隐藏方式：Tailwind 的 hidden 类与内联 display:none。
    function isShownWithin(el, modal) {
      let node = el;
      while (node && node !== modal) {
        if (node.classList && node.classList.contains('hidden')) return false;
        if (node.style && node.style.display === 'none') return false;
        if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') return false;
        node = node.parentElement;
      }
      return true;
    }

    function modalFocusables(modal) {
      return [...modal.querySelectorAll(FOCUSABLE_SEL)]
        .filter(el => el.type !== 'hidden')
        .filter(el => isShownWithin(el, modal));
    }

    let focusBeforeModal = null;
    let lastTopModal = null;

    function initModalA11y() {
      MODAL_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');

        // 只让"取消即等价于关闭"的弹窗支持点遮罩关闭，避免误关角色向导丢输入
        if (BACKDROP_CLOSABLE.includes(id)) {
          el.addEventListener('mousedown', (e) => {
            if (e.target === el) el.classList.add('hidden');
          });
        }
      });

      const syncFocus = (prevTop, nextTop) => {
        if (!prevTop && nextTop) {
          // 第一个弹窗打开：记住原焦点，并把焦点移进弹窗
          focusBeforeModal = document.activeElement;
          nextTop.focus();
        } else if (prevTop && !nextTop) {
          // 全部关掉：把焦点还给打开弹窗之前的位置
          const back = focusBeforeModal;
          focusBeforeModal = null;
          if (back && back !== document.body && document.contains(back) && typeof back.focus === 'function') back.focus();
        } else if (nextTop && nextTop !== prevTop) {
          // 弹窗叠弹窗：焦点跟着最上面那个走
          nextTop.focus();
        }
      };

      if (typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver(() => {
          const next = topOpenModal();
          if (next === lastTopModal) return;
          const prev = lastTopModal;
          lastTopModal = next;
          syncFocus(prev, next);
        });
        MODAL_IDS.forEach(id => {
          const el = document.getElementById(id);
          if (el) observer.observe(el, { attributes: true, attributeFilter: ['class'] });
        });
      }

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          const modal = topOpenModal();
          if (!modal) return;
          const list = modalFocusables(modal);
          const idx = list.indexOf(document.activeElement);
          if (e.shiftKey) {
            // 已经在第一个（或焦点还停在弹窗容器上）→ 绕到最后一个
            if (idx <= 0) {
              e.preventDefault();
              (list.length ? list[list.length - 1] : modal).focus();
            }
          } else if (idx === -1 || idx === list.length - 1) {
            e.preventDefault();
            (list.length ? list[0] : modal).focus();
          }
          return;
        }
        if (e.key !== 'Escape') return;
        const modal = topOpenModal();
        if (modal) modal.classList.add('hidden');
      });
    }

    // 替代原先 13 处内联 onclick —— 内联事件处理器会被 CSP 的 script-src 'self' 拦掉
    function initActionDelegation() {
      document.addEventListener('click', (e) => {
        const el = e.target.closest('[data-action]');
        if (!el) return;
        switch (el.dataset.action) {
          case 'start-wizard': startWizardOpening(); break;
          case 'expand-lore': document.getElementById('railExpandBtn').click(); break;
          case 'load-builtin-pack': loadBuiltinWorldPack(el.dataset.pack || ''); break;
          case 'roll-dice': rollDice(parseInt(el.dataset.sides, 10) || 20); break;
          case 'roll-charisma': rollWizardD6Charisma(); break;
          case 'apply-tactic': applyTactic(el.dataset.tactic || ''); break;
          case 'speak-message': {
            const msgNode = el.closest('.narrative-msg') || el.parentElement?.parentElement?.parentElement;
            const proseEl = msgNode ? msgNode.querySelector('.prose') : null;
            speakEnglishText(proseEl ? proseEl.textContent : (msgNode ? msgNode.textContent : ''));
            break;
          }
          case 'ask-tutor-advice':
            requestTutorAdvice();
            break;
          case 'speak-text':
            speakEnglishText(el.dataset.speech || '');
            break;
          case 'toggle-sentence-studio': {
            const msgNode = el.closest('.narrative-msg') || el.parentElement?.parentElement?.parentElement;
            toggleSentenceStudio(msgNode);
            break;
          }
          case 'collect-word':
            collectOrMasterWord(el.dataset.word || '');
            break;
          case 'shadow-sentence':
            runShadowingAssessment(el, el.dataset.sentence || '');
            break;
          case 'use-suggestion': {
            const inp = document.getElementById('playerInput');
            if (inp) {
              inp.value = el.dataset.suggestion || '';
              inp.focus();
              updateActiveHighlightBarMatch();
            }
            break;
          }
          case 'hl-pop-speak': {
            const term = activeHighlightPopoverState.coreTerm || activeHighlightPopoverState.term;
            const ctx = activeHighlightPopoverState.contextSentence;
            speakEnglishText(ctx && ctx !== term ? `${term}. ${ctx}` : term);
            break;
          }
          case 'hl-pop-insert': {
            insertHighlightTermIntoInput(activeHighlightPopoverState.term);
            break;
          }
          case 'hl-pop-collect': {
            if (activeHighlightPopoverState.term) {
              collectOrMasterWord(activeHighlightPopoverState.term);
              refreshHighlightPopoverHeaderState();
              syncHighlightedElementsAndBar();
            }
            break;
          }
          case 'hl-pop-pin': {
            pinHighlightTermToMemory();
            break;
          }
          case 'hl-pop-explain': {
            explainHighlightTermInContext();
            break;
          }
          case 'hl-chip-click': {
            const chipTerm = el.dataset.hlChip || '';
            if (chipTerm) {
              insertHighlightTermIntoInput(chipTerm);
              openHighlightWordPopover(el, chipTerm, '');
            }
            break;
          }
          case 'set-art-style': {
            const sid = el.dataset.styleId || 'acid';
            applyArtStyle(sid, { silent: false });
            renderArtStyleGrid();
            break;
          }
          case 'cycle-art-style': {
            e.stopPropagation();
            cycleArtStyle();
            break;
          }
          case 'pulse-3d-stage': {
            triggerThreeStagePulse(2.2);
            if (threeStageState.renderer && threeStageState.scene && threeStageState.camera) {
              threeStageState.renderer.render(threeStageState.scene, threeStageState.camera);
            }
            break;
          }
        }
      });
    }

    // 拖拽导入的落点路由：
    //   拖到 GM 规则块上 → 只替换规则栏；拖到左侧栏其它位置 → 按整份世界设定导入（原行为）
    // ⚠️ 打包后的 Windows 应用里，下面这些 HTML5 事件能不能触发**取决于 tauri.conf.json 的
    //    "dragDropEnabled": false**。默认 true 时 wry 会为窗口装一个原生 IDropTarget，
    //    并调用 WebView2 的 SetAllowExternalDrop(false)（wry 源码注释原文：
    //    "Disable file drops, so our handler can capture it"），渲染进程永远收不到 drop ——
    //    文件导入与编辑器内的拖拽排序都会静默失效。这层原生宿主在 jsdom 里不存在，
    //    所以那条配置由 verify-app.js 静态守住，别只靠这里的代码。
    function initLoreDragAndDrop() {
      const leftSidebarEl = document.getElementById('leftSidebar');
      const sidebarDropOverlay = document.getElementById('sidebarDropOverlay');
      const loreDropZone = document.getElementById('loreDropZone');
      const loreFileInputEl = document.getElementById('loreFileInput');
      const rulesDropBlock = document.getElementById('rulesDropBlock');

      if (loreDropZone && loreFileInputEl) {
        loreDropZone.addEventListener('click', () => loreFileInputEl.click());
      }

      // 不 preventDefault 的话，文件丢在窗口任何位置都会让 WebView 直接导航到该文件
      // （等于把当前这一局从界面上顶掉）
      window.addEventListener('dragover', (e) => e.preventDefault());
      window.addEventListener('drop', (e) => e.preventDefault());

      const dropKindAt = (target) =>
        (rulesDropBlock && target && rulesDropBlock.contains(target)) ? 'rules' : 'lore';

      const resetDropUI = () => {
        if (sidebarDropOverlay) sidebarDropOverlay.classList.add('hidden');
        if (rulesDropBlock) rulesDropBlock.removeAttribute('data-drop-active');
      };

      let dragCounter = 0;
      if (leftSidebarEl && sidebarDropOverlay) {
        leftSidebarEl.addEventListener('dragenter', (e) => {
          e.preventDefault();
          dragCounter++;
        });
        // 落点由 dragover 判定：它会持续在指针下的那个元素上触发，
        // 比 dragenter/dragleave 计数更不容易被进出子元素搞乱
        leftSidebarEl.addEventListener('dragover', (e) => {
          e.preventDefault();
          const kind = dropKindAt(e.target);
          if (rulesDropBlock) {
            if (kind === 'rules') rulesDropBlock.setAttribute('data-drop-active', '1');
            else rulesDropBlock.removeAttribute('data-drop-active');
          }
          // 拖到规则栏时不再显示"导入世界设定"的整栏遮罩，免得误导落点
          sidebarDropOverlay.classList.toggle('hidden', kind === 'rules');
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        });
        leftSidebarEl.addEventListener('dragleave', (e) => {
          e.preventDefault();
          dragCounter--;
          if (dragCounter <= 0) {
            dragCounter = 0;
            resetDropUI();
          }
        });
        leftSidebarEl.addEventListener('drop', (e) => {
          e.preventDefault();
          dragCounter = 0;
          const kind = dropKindAt(e.target);
          // 先把高亮/遮罩收起来：drop 之后不会再有 dragover 来收尾，
          // 不在这里清就会在界面上留下一层不消失的遮罩
          resetDropUI();
          const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (!file) return;
          if (kind === 'rules') handleRulesFile(file);
          else handleLoreFile(file);
        });
      }

      // 选文件导入：两个世界设定入口 + GM 规则入口。
      // 读完就把 input 清空，否则连续选同一个文件不会再触发 change。
      const onLorePicked = (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        handleLoreFile(file);
      };
      document.getElementById('loreFileInput')?.addEventListener('change', onLorePicked);
      document.getElementById('loreFileInputRail')?.addEventListener('change', onLorePicked);
      document.getElementById('rulesFileInput')?.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        handleRulesFile(file);
      });
    }

    function renderArtStyleGrid() {}

    // 单独抽出：换主题只需重画色卡，不必重建整个设置面板的全部事件处理器
    function renderThemeGrid() {
      const themeGrid = document.getElementById('themePresetsGrid');
      if (!themeGrid) return;
      themeGrid.innerHTML = '';
      THEME_PRESETS.forEach(theme => {
        const active = AppState.themeTone === theme.id;
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `p-2.5 rounded-lg border text-left transition flex items-start gap-2.5 ${active ? 'border-purple-500 bg-purple-950/30 shadow-sm' : 'border-slate-800 bg-slate-950 hover:border-slate-700'}`;

        const swatchWrap = document.createElement('div');
        swatchWrap.className = 'flex items-center -space-x-1.5 shrink-0 mt-0.5';

        const paperDot = document.createElement('span');
        paperDot.className = 'w-4 h-4 rounded-full border border-black/30 shadow-sm';
        paperDot.style.backgroundColor = theme.bgMain;

        const primaryDot = document.createElement('span');
        primaryDot.className = 'w-4 h-4 rounded-full border border-white/30 shadow-sm';
        primaryDot.style.backgroundColor = theme.primary;

        swatchWrap.append(paperDot, primaryDot);

        const textWrap = document.createElement('div');
        textWrap.className = 'min-w-0 flex-1';

        const label = document.createElement('div');
        label.className = 'text-xs text-slate-100 font-bold truncate';
        label.textContent = theme.name;

        const sub = document.createElement('div');
        sub.className = 'text-[10px] text-slate-400 truncate mt-0.5';
        sub.textContent = theme.subtitle || '';

        textWrap.append(label, sub);
        card.append(swatchWrap, textWrap);

        card.onclick = () => {
          applyThemeTone(theme.id, { silent: false });
          renderThemeGrid();
        };
        themeGrid.appendChild(card);
      });
    }

    function initSettingsModalUI() {
      document.querySelectorAll('#settingsAccordionContainer .accordion-trigger').forEach(btn => {
        btn.onclick = () => {
          const targetId = btn.getAttribute('data-target');
          const panel = document.getElementById(targetId);
          const arrow = btn.querySelector('.accordion-arrow');
          const isHidden = panel.classList.contains('hidden');

          document.querySelectorAll('#settingsAccordionContainer [id^="accordion"]').forEach(p => p.classList.add('hidden'));
          document.querySelectorAll('#settingsAccordionContainer .accordion-arrow').forEach(a => a.style.transform = 'rotate(0deg)');

          if (isHidden) {
            panel.classList.remove('hidden');
            if (arrow) arrow.style.transform = 'rotate(180deg)';
          }
        };
      });

      renderArtStyleGrid();
      renderThemeGrid();

      const presetGrid = document.getElementById('presetColorGrid');
      if (presetGrid) {
        presetGrid.innerHTML = '';
        HIGHLIGHT_PRESETS.forEach(preset => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'p-2 rounded-lg border border-slate-800 bg-slate-950/80 hover:border-slate-700 flex items-center gap-2 transition text-left';
          btn.innerHTML = `
            <span class="w-3.5 h-3.5 rounded-full shrink-0 border border-white/20 shadow-sm" style="background-color: ${preset.color}"></span>
            <span class="text-[11px] text-slate-300 font-medium">${preset.name}</span>
          `;
          btn.onclick = () => {
            AppState.highlightConfig.color = preset.color;
            document.getElementById('customColorPicker').value = preset.color;
            document.getElementById('customColorHexInput').value = preset.color.toUpperCase();
            applyHighlightConfig(AppState.highlightConfig);
          };
          presetGrid.appendChild(btn);
        });
      }

      document.querySelectorAll('#styleModeOptions .style-mode-btn').forEach(btn => {
        btn.onclick = () => {
          const style = btn.getAttribute('data-style');
          AppState.highlightConfig.style = style;
          applyHighlightConfig(AppState.highlightConfig);
          document.querySelectorAll('#styleModeOptions .style-mode-btn').forEach(b => {
            const active = b.getAttribute('data-style') === style;
            b.className = `style-mode-btn px-2 py-1.5 rounded-lg border text-xs font-medium text-center transition ${active ? 'border-purple-500 bg-purple-950/40 text-purple-200 shadow-sm' : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'}`;
          });
          const summary = document.getElementById('previewHighlightTagSummary');
          const map = { tag: '胶囊微光', marker: '荧光记号', neon: '霓虹发光' };
          if (summary) summary.textContent = map[style] || '胶囊微光';
        };
      });

      const picker = document.getElementById('customColorPicker');
      const hexInp = document.getElementById('customColorHexInput');
      if (picker && hexInp) {
        picker.oninput = (e) => {
          AppState.highlightConfig.color = e.target.value;
          hexInp.value = e.target.value.toUpperCase();
          applyHighlightConfig(AppState.highlightConfig);
        };
        hexInp.oninput = (e) => {
          let val = e.target.value.trim();
          if (!val.startsWith('#')) val = '#' + val;
          if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
            AppState.highlightConfig.color = val;
            picker.value = val;
            applyHighlightConfig(AppState.highlightConfig);
          }
        };
      }
    }

    window.addEventListener('load', () => {
      try {
        const savedApi = localStorage.getItem('chronicle_api_config');
        if (savedApi) AppState.apiConfig = Object.assign(AppState.apiConfig, JSON.parse(savedApi));
        // 安全存储里的 Key 优先于（已不再写入的）localStorage 明文，并顺手完成老存档迁移
        loadApiKeyFromSecureStore();
        const savedSlots = localStorage.getItem('chronicle_user_slots');
        if (savedSlots) {
          const parsedSlots = JSON.parse(savedSlots);
          // 防御：空数组或损坏结构会让 AppState.slots[0] 变成 undefined，启动即报错白屏
          if (Array.isArray(parsedSlots) && parsedSlots.length > 0) AppState.slots = parsedSlots;
        }
        const savedTheme = localStorage.getItem('chronicle_theme_tone');
        if (savedTheme) AppState.themeTone = savedTheme;
        const savedArtStyle = localStorage.getItem('chronicle_art_style_v2');
        if (savedArtStyle) AppState.artStyle = savedArtStyle;
        const savedHighlight = localStorage.getItem('chronicle_highlight_config');
        if (savedHighlight) AppState.highlightConfig = Object.assign(AppState.highlightConfig, JSON.parse(savedHighlight));
        const savedPrivacy = localStorage.getItem('chronicle_privacy_shield');
        if (savedPrivacy) AppState.privacyShield = JSON.parse(savedPrivacy);
        // 音效配置以前只写不读，每次重启都会丢
        const savedSound = localStorage.getItem('chronicle_sound_config');
        if (savedSound) AppState.soundConfig = Object.assign(AppState.soundConfig, JSON.parse(savedSound));
        const savedVoice = localStorage.getItem('chronicle_voice_config');
        if (savedVoice) AppState.voiceConfig = Object.assign(AppState.voiceConfig, JSON.parse(savedVoice));
      } catch (e) {
        console.error('[奇点] 读取本地配置失败，已回退默认值:', e);
        showToast('本地配置读取失败，已使用默认设置', 'error');
      }

      if (!Array.isArray(AppState.slots) || AppState.slots.length === 0) {
        AppState.slots = [{ id: 'slot_custom_1', name: '我的世界', desc: '自由自定义世界观与法则' }];
      }

      initThreeStage();
      applyThemeTone(AppState.themeTone, { silent: true });
      applyHighlightConfig(AppState.highlightConfig);
      initSettingsModalUI();
      initLoreDragAndDrop();
      initModalA11y();
      initActionDelegation();

      const stageFocusBtn = document.getElementById('toggleStageFocusBtn');
      if (stageFocusBtn) stageFocusBtn.onclick = () => toggleStageFocus();

      if (AppState.privacyShield) {
        document.body.classList.add('privacy-shield-active');
        const sum = document.getElementById('privacyStatusSummary');
        if (sum) sum.textContent = '开启';
      }

      refreshApiStatusBadge();
      maybeHintThinkingMode();

      // 页签栏由蓝图动态生成，因此改用事件委托
      const hudTabBar = document.getElementById('hudTabBar');
      if (hudTabBar) {
        hudTabBar.addEventListener('click', (e) => {
          const btn = e.target.closest('.hud-tab-btn');
          if (btn && btn.dataset.tab) switchHudTab(btn.dataset.tab);
        });
      }
      buildHudFromSchema();

      document.getElementById('railExpandBtn').onclick = () => {
        document.getElementById('leftSidebar').classList.remove('hidden');
        document.getElementById('sidebarRail').classList.add('hidden');
      };
      document.getElementById('railExpandTextBtn').onclick = document.getElementById('railExpandBtn').onclick;
      document.getElementById('collapseSidebarBtn').onclick = () => {
        document.getElementById('leftSidebar').classList.add('hidden');
        document.getElementById('sidebarRail').classList.remove('hidden');
      };

      document.getElementById('openWizardBtn').onclick = startWizardOpening;
      document.getElementById('closeWizardModalBtn').onclick = () => document.getElementById('wizardModal').classList.add('hidden');
      document.getElementById('cancelWizardBtn').onclick = () => document.getElementById('wizardModal').classList.add('hidden');
      document.getElementById('completeWizardBtn').onclick = completeCharacterCreation;

      const toggleWizCfg = document.getElementById('toggleWizardConfigBtn');
      if (toggleWizCfg) {
        toggleWizCfg.onclick = () => {
          document.getElementById('wizardConfigPanel')?.classList.toggle('hidden');
        };
      }

      const autoExtractBtn = document.getElementById('autoExtractWizardRulesBtn');
      if (autoExtractBtn) {
        autoExtractBtn.onclick = () => {
          analyzeWorldLoreWithApi(document.getElementById('worldLoreInput').value, false);
        };
      }

      const saveWizCfgBtn = document.getElementById('saveWizardConfigBtn');
      if (saveWizCfgBtn) {
        saveWizCfgBtn.onclick = () => {
          const parseList = (val) => val.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
          const races = parseList(document.getElementById('cfgRacesInput').value);
          const classes = parseList(document.getElementById('cfgClassesInput').value);
          const identities = parseList(document.getElementById('cfgIdentitiesInput').value);
          const attributes = parseList(document.getElementById('cfgAttributesInput').value);
          const points = parseInt(document.getElementById('cfgPointsPoolInput').value, 10) || 25;
          const maxStat = parseInt(document.getElementById('cfgMaxPerStatInput').value, 10) || 8;

          if (races.length > 0) AppState.wizardConfig.races = races;
          if (classes.length > 0) AppState.wizardConfig.classes = classes;
          if (identities.length > 0) AppState.wizardConfig.identities = identities;
          if (attributes.length > 0) AppState.wizardConfig.attributes = attributes;
          AppState.wizardConfig.pointBudget = points;
          AppState.wizardConfig.maxPerStat = maxStat;

          syncWizardOptionsAndChips();
          initWizardAllocators();
          document.getElementById('wizardConfigPanel')?.classList.add('hidden');
          saveCurrentSlotToStorage();
          showToast('角色创建规则已更新，向导选项已刷新', 'success');
        };
      }

      const analyzeLoreBtn = document.getElementById('analyzeLoreBtn');
      if (analyzeLoreBtn) {
        analyzeLoreBtn.onclick = () => {
          analyzeWorldLoreWithApi(document.getElementById('worldLoreInput').value, false);
        };
      }

      document.getElementById('openSlotModalBtn').onclick = () => {
        renderSlotsList();
        document.getElementById('slotModal').classList.remove('hidden');
      };
      document.getElementById('closeSlotModalBtn').onclick = () => document.getElementById('slotModal').classList.add('hidden');
      document.getElementById('closeSlotBtn').onclick = () => document.getElementById('slotModal').classList.add('hidden');

      document.getElementById('addNewSlotBtn').onclick = () => {
        const inp = document.getElementById('newSlotNameInput');
        const name = inp.value.trim();
        if (!name) { showToast('请输入世界名称', 'info'); return; }
        const newId = `slot_custom_${Date.now()}`;
        AppState.slots.push({ id: newId, name, desc: '用户自建世界观' });
        inp.value = '';
        saveCurrentSlotToStorage();
        switchSlot(newId);
      };

      document.getElementById('openTacticsModalBtn').onclick = () => {
        renderTacticsSessionStats();
        document.getElementById('tacticsModal').classList.remove('hidden');
      };
      document.getElementById('closeTacticsModalBtn').onclick = () => document.getElementById('tacticsModal').classList.add('hidden');
      document.getElementById('closeTacticsBtn').onclick = () => document.getElementById('tacticsModal').classList.add('hidden');

      const reqTutorBtn = document.getElementById('requestTutorAdviceBtn');
      if (reqTutorBtn) reqTutorBtn.onclick = () => requestTutorAdvice();
      const refreshTutorBtn = document.getElementById('refreshTutorAdviceBtn');
      if (refreshTutorBtn) refreshTutorBtn.onclick = () => requestTutorAdvice();
      const closeTutorBtn = document.getElementById('closeTutorAdviceBtn');
      if (closeTutorBtn) closeTutorBtn.onclick = () => document.getElementById('tutorAdvicePanel')?.classList.add('hidden');

      const voiceInBtn = document.getElementById('voiceInputBtn');
      if (voiceInBtn) voiceInBtn.onclick = () => toggleVoiceInput();
      const stopVoiceBtn = document.getElementById('stopVoicePlayBtn');
      if (stopVoiceBtn) stopVoiceBtn.onclick = () => stopVoicePlayback();
      const testTtsBtn = document.getElementById('testVoiceTtsBtn');
      if (testTtsBtn) {
        testTtsBtn.onclick = () => {
          const vcfg = AppState.voiceConfig || {};
          vcfg.ttsProvider = document.getElementById('voiceTtsProviderSelect')?.value || 'browser';
          vcfg.apiBaseUrl = document.getElementById('voiceApiBaseUrlInput')?.value.trim() || 'https://api.openai.com/v1';
          vcfg.apiKey = document.getElementById('voiceApiKeyInput')?.value.trim() || '';
          vcfg.ttsModel = document.getElementById('voiceTtsModelInput')?.value.trim() || 'tts-1';
          vcfg.ttsVoice = document.getElementById('voiceTtsVoiceSelect')?.value || 'nova';
          vcfg.speechRate = parseFloat(document.getElementById('voiceSpeechRateSelect')?.value) || 1.0;
          speakEnglishText('Welcome to our interactive story world! Let us practice natural spoken English together.');
        };
      }

      // 自定义端点：地址预览用与真实请求同一个纯函数，避免"面板上写一套、发出去另一套"
      const CUSTOM_PROVIDER_HINT = '自定义端点：地址可以只填到 <code class="text-slate-400">/v1</code>（自动补 <code class="text-slate-400">/chat/completions</code>），也可以勾选「完整请求地址」后原样请求。应用已放开任意 HTTPS 连接；明文 http 只放行 localhost / 127.0.0.1。';
      const COMPAT_PROVIDER_HINT = '兼容协议把地址填到 <code class="text-slate-400">/v1</code> 为止即可（自动补 <code class="text-slate-400">/chat/completions</code>）。除 DeepSeek / OpenAI / 本地地址外，其它域名请把上面的协议切成「自定义」。';

      const updateCustomEndpointPreview = () => {
        const el = document.getElementById('customEndpointPreview');
        if (!el) return;
        if (document.getElementById('apiProviderSelect').value !== 'custom') return;
        const baseUrl = document.getElementById('apiBaseUrlInput').value.trim();
        if (!baseUrl) {
          el.textContent = '实际请求地址：（请先填写 Base URL）';
          return;
        }
        let endpoint = '';
        try {
          endpoint = resolveChatEndpoint({
            provider: 'custom',
            baseUrl,
            customFullEndpoint: !!document.getElementById('customFullEndpointCheckbox').checked
          });
        } catch (e) {
          endpoint = '';
        }
        el.textContent = endpoint ? ('实际请求地址：' + endpoint) : '实际请求地址：无法解析该地址';
      };

      const syncProviderRows = () => {
        const provider = document.getElementById('apiProviderSelect').value;
        const isGemini = provider === 'gemini';
        const isCustom = provider === 'custom';
        const isCompat = provider === 'openai_compatible';
        document.getElementById('baseUrlRow').classList.toggle('hidden', isGemini);
        const customRows = document.getElementById('customEndpointRows');
        if (customRows) customRows.classList.toggle('hidden', !isCustom);
        const thinkRow = document.getElementById('thinkingModeRow');
        // 思考模式是 DeepSeek 私有字段：自定义端点由用户自己在「额外请求参数」里下发，不显示这个开关
        if (thinkRow) thinkRow.classList.toggle('hidden', !isCompat);
        const hint = document.getElementById('baseUrlHint');
        if (hint) hint.innerHTML = isCustom ? CUSTOM_PROVIDER_HINT : COMPAT_PROVIDER_HINT;
        updateCustomEndpointPreview();
      };

      const syncVoiceCloudBox = () => {
        const ttsProv = document.getElementById('voiceTtsProviderSelect')?.value;
        const sttProv = document.getElementById('voiceSttProviderSelect')?.value;
        const cloudBox = document.getElementById('voiceCloudApiBox');
        if (cloudBox) {
          cloudBox.classList.toggle('hidden', ttsProv !== 'openai_tts' && sttProv !== 'openai_stt');
        }
      };
      document.getElementById('voiceTtsProviderSelect')?.addEventListener('change', syncVoiceCloudBox);
      document.getElementById('voiceSttProviderSelect')?.addEventListener('change', syncVoiceCloudBox);

      document.getElementById('openApiSettingsBtn').onclick = () => {
        document.getElementById('apiProviderSelect').value = AppState.apiConfig.provider;
        document.getElementById('apiKeyInput').value = AppState.apiConfig.apiKey;
        refreshApiKeyStorageNote();
        const selfTestBtn = document.getElementById('secureStorageSelfTestBtn');
        if (selfTestBtn) {
          selfTestBtn.onclick = () => runSecureStorageSelfTest(document.getElementById('secureStorageSelfTestResult'));
        }
        document.getElementById('apiBaseUrlInput').value = AppState.apiConfig.baseUrl || '';
        document.getElementById('apiModelInput').value = AppState.apiConfig.model;
        document.getElementById('tempSlider').value = AppState.apiConfig.temperature;
        document.getElementById('tempValueDisplay').textContent = AppState.apiConfig.temperature;
        const isUnlimited = AppState.apiConfig.maxTokens === 0;
        document.getElementById('unlimitedTokensCheckbox').checked = isUnlimited;
        document.getElementById('maxTokensInput').disabled = isUnlimited;
        document.getElementById('maxTokensInput').value = isUnlimited ? '' : AppState.apiConfig.maxTokens;
        const thinkEl = document.getElementById('settingThinkingMode');
        if (thinkEl) thinkEl.checked = !!AppState.apiConfig.thinkingEnabled;

        // 自定义端点：回填完整地址开关 / 额外参数 / 额外请求头（存档里没有就留空）
        const customFullEl = document.getElementById('customFullEndpointCheckbox');
        if (customFullEl) customFullEl.checked = !!AppState.apiConfig.customFullEndpoint;
        const extraParamsEl = document.getElementById('customExtraParamsInput');
        if (extraParamsEl) {
          const p = AppState.apiConfig.extraParams;
          extraParamsEl.value = (p && typeof p === 'object' && Object.keys(p).length) ? JSON.stringify(p, null, 2) : '';
        }
        const extraHeadersEl = document.getElementById('customExtraHeadersInput');
        if (extraHeadersEl) {
          const h = AppState.apiConfig.extraHeaders;
          extraHeadersEl.value = (h && typeof h === 'object' && Object.keys(h).length) ? JSON.stringify(h, null, 2) : '';
        }

        const vcfg = AppState.voiceConfig || {};
        if (document.getElementById('voiceTtsProviderSelect')) document.getElementById('voiceTtsProviderSelect').value = vcfg.ttsProvider || 'browser';
        if (document.getElementById('voiceSttProviderSelect')) document.getElementById('voiceSttProviderSelect').value = vcfg.sttProvider || 'browser';
        if (document.getElementById('voiceApiBaseUrlInput')) document.getElementById('voiceApiBaseUrlInput').value = vcfg.apiBaseUrl || 'https://api.openai.com/v1';
        if (document.getElementById('voiceApiKeyInput')) document.getElementById('voiceApiKeyInput').value = vcfg.apiKey || '';
        if (document.getElementById('voiceTtsModelInput')) document.getElementById('voiceTtsModelInput').value = vcfg.ttsModel || 'tts-1';
        if (document.getElementById('voiceTtsVoiceSelect')) document.getElementById('voiceTtsVoiceSelect').value = vcfg.ttsVoice || 'nova';
        if (document.getElementById('voiceSttModelInput')) document.getElementById('voiceSttModelInput').value = vcfg.sttModel || 'whisper-1';
        if (document.getElementById('voiceAutoPlayCheckbox')) document.getElementById('voiceAutoPlayCheckbox').checked = !!vcfg.autoPlayNpc;
        if (document.getElementById('voiceSpeechRateSelect')) document.getElementById('voiceSpeechRateSelect').value = String(vcfg.speechRate || 1);

        syncProviderRows();
        syncVoiceCloudBox();
        document.getElementById('apiModal').classList.remove('hidden');
      };
      document.getElementById('closeApiModalBtn').onclick = () => document.getElementById('apiModal').classList.add('hidden');
      document.getElementById('cancelApiModalBtn').onclick = () => document.getElementById('apiModal').classList.add('hidden');

      document.getElementById('apiProviderSelect').onchange = (e) => {
        // 切换协议时把明显不匹配的地址/模型换成对应默认值，避免用户留着 Gemini 的地址配 DeepSeek
        const v = e.target.value;
        const baseUrlEl = document.getElementById('apiBaseUrlInput');
        const modelEl = document.getElementById('apiModelInput');
        if (v === 'gemini') {
          if (!baseUrlEl.value.trim() || baseUrlEl.value.includes('deepseek')) baseUrlEl.value = 'https://generativelanguage.googleapis.com';
          if (!modelEl.value.trim() || modelEl.value.startsWith('deepseek')) modelEl.value = 'gemini-2.5-flash';
        } else if (v === 'custom') {
          // 自定义端点是用户的地址：只清掉明显属于内置 Gemini 的值，绝不替用户猜一个第三方域名
          if (baseUrlEl.value.includes('googleapis')) baseUrlEl.value = '';
          if (modelEl.value.startsWith('gemini')) modelEl.value = '';
        } else {
          if (!baseUrlEl.value.trim() || baseUrlEl.value.includes('googleapis')) baseUrlEl.value = 'https://api.deepseek.com';
          if (!modelEl.value.trim() || modelEl.value.startsWith('gemini')) modelEl.value = 'deepseek-flash';
        }
        syncProviderRows();
      };
      document.getElementById('toggleApiKeyVisibility').onclick = () => {
        const inp = document.getElementById('apiKeyInput');
        inp.type = inp.type === 'password' ? 'text' : 'password';
      };
      document.getElementById('unlimitedTokensCheckbox').onchange = (e) => {
        document.getElementById('maxTokensInput').disabled = e.target.checked;
      };
      document.getElementById('tempSlider').oninput = (e) => {
        document.getElementById('tempValueDisplay').textContent = e.target.value;
      };

      // 地址 / 完整地址开关一变，就同步「实际请求地址」预览（用户不用保存就能确认会打到哪）
      document.getElementById('apiBaseUrlInput').addEventListener('input', updateCustomEndpointPreview);
      const customFullCheckbox = document.getElementById('customFullEndpointCheckbox');
      if (customFullCheckbox) customFullCheckbox.addEventListener('change', updateCustomEndpointPreview);

      // 用「当前填写的表单值」真发一次最小请求，把 HTTP 状态与服务端原话直接显示出来。
      // 起因：中转站回 503/403 时用户只看到"接口请求失败"，根本分不清是 Key、模型名、
      // 地址填错，还是站方没开渠道。这个按钮就是为了把这类问题一次说清楚。
      const testApiConnection = async () => {
        const btn = document.getElementById('testApiConnBtn');
        const out = document.getElementById('apiTestResult');
        if (!out) return;
        const say = (text, tone) => {
          out.className = 'text-[11px] leading-snug break-all ' + (
            tone === 'ok' ? 'text-emerald-400' : tone === 'bad' ? 'text-rose-400' : 'text-slate-400');
          out.textContent = text;
          return text;
        };

        const provider = document.getElementById('apiProviderSelect').value;
        const apiKey = document.getElementById('apiKeyInput').value.trim();
        const model = document.getElementById('apiModelInput').value.trim();
        const baseUrl = document.getElementById('apiBaseUrlInput').value.trim();
        const prompt = 'Say hello in one short sentence.';

        let url = '';
        const headers = { 'Content-Type': 'application/json' };
        let body = null;
        try {
          if (provider === 'gemini') {
            if (!apiKey) return say('请先填写 Gemini API Key', 'bad');
            url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || 'gemini-2.5-flash')}:generateContent`;
            headers['x-goog-api-key'] = apiKey;
            body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 32 } };
          } else {
            if (!baseUrl) return say('请先填写 Base URL', 'bad');
            const paramsEl = document.getElementById('customExtraParamsInput');
            const headersEl = document.getElementById('customExtraHeadersInput');
            const parsedParams = parseJsonObjectText(paramsEl ? paramsEl.value : '', '额外请求参数');
            if (!parsedParams.ok) return say(parsedParams.error, 'bad');
            const parsedHeaders = parseJsonObjectText(headersEl ? headersEl.value : '', '自定义请求头');
            if (!parsedHeaders.ok) return say(parsedHeaders.error, 'bad');
            url = resolveChatEndpoint({
              provider: provider === 'custom' ? 'custom' : 'openai_compatible',
              baseUrl,
              customFullEndpoint: !!document.getElementById('customFullEndpointCheckbox').checked
            });
            if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
            body = { model: model || 'deepseek-flash', messages: [{ role: 'user', content: prompt }], stream: false };
            if (provider === 'custom') {
              Object.keys(parsedHeaders.value).forEach(k => {
                if (HTTP_HEADER_NAME_RE.test(k)) headers[k] = sanitizeHeaderValue(parsedHeaders.value[k]);
              });
              Object.keys(parsedParams.value).forEach(k => {
                if (k !== 'stream') body[k] = parsedParams.value[k];
              });
            }
          }
        } catch (e) {
          return say('构造请求失败：' + ((e && e.message) || e), 'bad');
        }

        btn.disabled = true;
        btn.textContent = '测试中…';
        say('正在请求 ' + url + ' …', 'info');
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 20000);
          let res;
          try {
            res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
          } finally {
            clearTimeout(timer);
          }
          const raw = await res.text();
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch (e) { /* 非 JSON 响应，保留原文 */ }
          if (!res.ok) {
            const detail = (parsed && parsed.error && (parsed.error.message || parsed.error.code))
              || (parsed && parsed.message)
              || raw.slice(0, 240)
              || '(无错误正文)';
            return say(`HTTP ${res.status}：${detail}`, 'bad');
          }
          const content = provider === 'gemini'
            ? (((parsed && parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content && parsed.candidates[0].content.parts) || [])
              .map(p => p.text || '').join(''))
            : (((parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content)) || '');
          if (content) return say(`✅ 连接成功（HTTP ${res.status}）：${content.slice(0, 80)}`, 'ok');
          return say(`HTTP ${res.status} 但响应里没有正文：${raw.slice(0, 160)}`, 'info');
        } catch (e) {
          if (e && e.name === 'AbortError') return say('超时：20 秒内没有响应（地址不可达或站方无渠道）', 'bad');
          return say('网络错误：' + ((e && e.message) || e), 'bad');
        } finally {
          btn.disabled = false;
          btn.textContent = '🔌 测试连接';
        }
      };
      const testApiConnBtn = document.getElementById('testApiConnBtn');
      if (testApiConnBtn) testApiConnBtn.onclick = () => testApiConnection();

      document.getElementById('saveApiConfigBtn').onclick = () => {
        const provider = document.getElementById('apiProviderSelect').value;
        const fallbackModel = provider === 'gemini' ? 'gemini-2.5-flash' : 'deepseek-flash';
        const rawBaseUrl = document.getElementById('apiBaseUrlInput').value.trim();
        const customFullEl = document.getElementById('customFullEndpointCheckbox');
        const customFullEndpoint = !!(customFullEl && customFullEl.checked);
        let extraParams = AppState.apiConfig.extraParams || {};
        let extraHeaders = AppState.apiConfig.extraHeaders || {};

        if (provider === 'custom') {
          if (!rawBaseUrl) {
            showToast('自定义端点需要填写请求地址（Base URL）', 'error');
            document.getElementById('apiBaseUrlInput').focus();
            return;
          }
          const parsedParams = parseJsonObjectText(document.getElementById('customExtraParamsInput')?.value, '额外请求参数');
          if (!parsedParams.ok) { showToast(parsedParams.error, 'error'); return; }
          const parsedHeaders = parseJsonObjectText(document.getElementById('customExtraHeadersInput')?.value, '自定义请求头');
          if (!parsedHeaders.ok) { showToast(parsedHeaders.error, 'error'); return; }
          const badHeader = Object.keys(parsedHeaders.value).find(k => !HTTP_HEADER_NAME_RE.test(k));
          if (badHeader !== undefined) {
            showToast(`自定义请求头名不合法：「${badHeader}」，只能用字母 / 数字 / - _ 这类常规头部字符`, 'error');
            return;
          }
          const badHeaderValue = Object.keys(parsedHeaders.value).find(k => {
            const v = parsedHeaders.value[k];
            return v !== null && typeof v === 'object';
          });
          if (badHeaderValue !== undefined) {
            showToast(`自定义请求头「${badHeaderValue}」的值必须是字符串或数字`, 'error');
            return;
          }
          const cleanedHeaders = {};
          Object.keys(parsedHeaders.value).forEach(k => { cleanedHeaders[k] = sanitizeHeaderValue(parsedHeaders.value[k]); });
          extraParams = parsedParams.value;
          extraHeaders = cleanedHeaders;
        }

        AppState.apiConfig.apiKey = document.getElementById('apiKeyInput').value.trim();
        AppState.apiConfig.provider = provider;
        AppState.apiConfig.baseUrl = rawBaseUrl;
        AppState.apiConfig.model = document.getElementById('apiModelInput').value.trim() || fallbackModel;
        AppState.apiConfig.temperature = parseFloat(document.getElementById('tempSlider').value);
        AppState.apiConfig.thinkingEnabled = document.getElementById('settingThinkingMode').checked;
        AppState.apiConfig.customFullEndpoint = customFullEndpoint;
        AppState.apiConfig.extraParams = extraParams;
        AppState.apiConfig.extraHeaders = extraHeaders;
        const unlimited = document.getElementById('unlimitedTokensCheckbox').checked;
        AppState.apiConfig.maxTokens = unlimited ? 0 : (parseInt(document.getElementById('maxTokensInput').value, 10) || 4096);

        AppState.voiceConfig = {
          ttsProvider: document.getElementById('voiceTtsProviderSelect')?.value || 'browser',
          sttProvider: document.getElementById('voiceSttProviderSelect')?.value || 'browser',
          apiBaseUrl: document.getElementById('voiceApiBaseUrlInput')?.value.trim() || 'https://api.openai.com/v1',
          apiKey: document.getElementById('voiceApiKeyInput')?.value.trim() || '',
          ttsModel: document.getElementById('voiceTtsModelInput')?.value.trim() || 'tts-1',
          ttsVoice: document.getElementById('voiceTtsVoiceSelect')?.value || 'nova',
          sttModel: document.getElementById('voiceSttModelInput')?.value.trim() || 'whisper-1',
          autoPlayNpc: !!document.getElementById('voiceAutoPlayCheckbox')?.checked,
          speechRate: parseFloat(document.getElementById('voiceSpeechRateSelect')?.value) || 1.0
        };
        try { localStorage.setItem('chronicle_voice_config', JSON.stringify(AppState.voiceConfig)); } catch (e) {}

        saveCurrentSlotToStorage();
        document.getElementById('apiModal').classList.add('hidden');

        const badge = document.getElementById('apiStatusBadge');
        const text = document.getElementById('apiStatusText');
        if (hasApiCredential()) {
          badge.className = 'flex items-center space-x-1.5 text-xs px-2.5 py-1.5 rounded-full border border-emerald-800/50 bg-emerald-950/40 text-emerald-300';
          badge.querySelector('span').className = 'w-2 h-2 rounded-full bg-emerald-400';
          text.textContent = `已激活: ${AppState.apiConfig.model}`;
          showToast('API 设置已保存', 'success');
        } else {
          badge.className = 'flex items-center space-x-1.5 text-xs px-2.5 py-1.5 rounded-full border border-red-800/50 bg-red-950/40 text-red-300';
          badge.querySelector('span').className = 'w-2 h-2 rounded-full bg-red-500 animate-ping';
          text.textContent = '未配置 API Key';
          showToast('已清除 API Key', 'info');
        }
      };

      document.getElementById('openSettingsModalBtn').onclick = () => {
        document.getElementById('settingPrivacyShield').checked = AppState.privacyShield;
        document.getElementById('privacyStatusSummary').textContent = AppState.privacyShield ? '开启' : '关闭';
        document.getElementById('settingDiceSound').checked = AppState.soundConfig.diceSound;
        document.getElementById('settingTurnSound').checked = AppState.soundConfig.turnSound;
        renderContextPanel();
        document.getElementById('settingsModal').classList.remove('hidden');
      };
      document.getElementById('closeSettingsModalBtn').onclick = () => document.getElementById('settingsModal').classList.add('hidden');
      document.getElementById('cancelSettingsModalBtn').onclick = () => document.getElementById('settingsModal').classList.add('hidden');

      document.getElementById('saveSettingsConfigBtn').onclick = () => {
        AppState.privacyShield = document.getElementById('settingPrivacyShield').checked;
        document.body.classList.toggle('privacy-shield-active', AppState.privacyShield);
        AppState.soundConfig.diceSound = document.getElementById('settingDiceSound').checked;
        AppState.soundConfig.turnSound = document.getElementById('settingTurnSound').checked;
        saveCurrentSlotToStorage();
        document.getElementById('settingsModal').classList.add('hidden');
        showToast('设置已保存', 'success');
      };

      const saveCtxBtn = document.getElementById('saveContextConfigBtn');
      if (saveCtxBtn) {
        saveCtxBtn.onclick = () => {
          const cfg = AppState.contextConfig || defaultContextConfig();
          cfg.recentTurns = Math.min(60, Math.max(2, parseInt(document.getElementById('cfgRecentTurnsInput').value, 10) || 12));
          cfg.summaryTriggerTurns = Math.min(40, Math.max(2, parseInt(document.getElementById('cfgSummaryTriggerInput').value, 10) || 8));
          cfg.autoSummary = document.getElementById('settingAutoSummary').checked;
          AppState.contextConfig = cfg;

          const ta = document.getElementById('contextSummaryTextarea');
          if (ta) AppState.contextSummary = ta.value.trim();

          saveCurrentSlotToStorage();
          renderContextPanel();
          showToast('上下文设置已保存', 'success');
        };
      }

      const clearCtxBtn = document.getElementById('clearContextSummaryBtn');
      if (clearCtxBtn) {
        clearCtxBtn.onclick = () => {
          AppState.contextSummary = '';
          AppState.summarizedUpTo = 0;
          saveCurrentSlotToStorage();
          renderContextPanel();
          showToast('前情提要已清空，下回合会重新压缩', 'info');
        };
      }

      // ---- 世界蓝图面板 ----
      const hideSchemaModal = () => document.getElementById('schemaModal').classList.add('hidden');

      const openSchemaBtn = document.getElementById('openSchemaModalBtn');
      if (openSchemaBtn) {
        openSchemaBtn.onclick = () => {
          schemaModalPresetId = getWorldSchema().preset || 'generic-fantasy';
          renderSchemaModal();
          const status = document.getElementById('schemaAiStatus');
          if (status) status.textContent = '';
          document.getElementById('schemaModal').classList.remove('hidden');
        };
      }
      document.getElementById('closeSchemaModalBtn').onclick = hideSchemaModal;
      document.getElementById('cancelSchemaBtn').onclick = hideSchemaModal;

      const presetGrid = document.getElementById('presetGrid');
      if (presetGrid) {
        presetGrid.onclick = (e) => {
          const btn = e.target.closest('button[data-preset]');
          if (!btn) return;
          schemaModalPresetId = btn.dataset.preset;
          applyPresetSchema(schemaModalPresetId, { silent: true });
          renderSchemaModal();
        };
      }

      const aiSchemaBtn = document.getElementById('aiGenerateSchemaBtn');
      if (aiSchemaBtn) {
        aiSchemaBtn.onclick = async () => {
          const status = document.getElementById('schemaAiStatus');
          aiSchemaBtn.disabled = true;
          if (status) status.textContent = '生成中…（这可能需要十几秒）';
          try {
            await generateWorldSchemaWithApi(schemaModalPresetId);
            renderSchemaModal();
            if (status) status.textContent = '✅ 已生成';
          } catch (e) {
            if (status) status.textContent = '❌ ' + e.message;
            if (e.message !== 'NO_API_KEY' && e.message !== 'NO_LORE') {
              showToast(`蓝图生成失败：${e.message}`, 'error');
            }
          } finally {
            aiSchemaBtn.disabled = false;
          }
        };
      }

      const applySchemaBtn = document.getElementById('applySchemaBtn');
      if (applySchemaBtn) {
        applySchemaBtn.onclick = () => {
          const ta = document.getElementById('schemaJsonTextarea');
          let parsed;
          try {
            parsed = JSON.parse(ta.value);
          } catch (e) {
            showToast('蓝图 JSON 格式不合法：' + e.message, 'error');
            return;
          }
          applyWorldSchema(parsed);
          hideSchemaModal();
        };
      }

      const resetSchemaBtn = document.getElementById('resetSchemaBtn');
      if (resetSchemaBtn) {
        resetSchemaBtn.onclick = () => {
          schemaModalPresetId = 'generic-fantasy';
          applyWorldSchema(defaultWorldSchema(), { silent: true });
          renderSchemaModal();
          showToast('已恢复默认蓝图', 'info');
        };
      }

      // ---- 结构编辑器：增删面板 / 改名 / 排序 ----
      const schemaTreeBox = document.getElementById('schemaTree');
      if (schemaTreeBox) {
        // 拖拽排序：同一个页签内换位
        enableDragReorder(schemaTreeBox, (fi, ti, parent) => {
          if (!schemaDraft) return;
          const pti = parseInt(parent.dataset.ti, 10);
          const tab = Number.isInteger(pti) ? schemaDraft.tabs[pti] : null;
          if (tab && moveInArray(tab.sections, fi, ti)) commitSchemaDraft();
        });
        schemaTreeBox.addEventListener('click', (e) => {
          const el = e.target.closest('[data-act]');
          if (!el || !schemaDraft) return;
          if (el.tagName === 'INPUT' || el.tagName === 'SELECT') return;

          const ti = parseInt(el.dataset.ti, 10);
          const si = parseInt(el.dataset.si, 10);
          const tab = Number.isInteger(ti) ? schemaDraft.tabs[ti] : null;
          const act = el.dataset.act;

          if (act === 'add-sec' && tab) {
            tab.sections.push(defaultSectionFor('list', tab.sections.length));
          } else if (act === 'add-sec-last') {
            const picker = document.getElementById('addSectionType');
            const lastTab = schemaDraft.tabs[schemaDraft.tabs.length - 1];
            if (lastTab && picker) lastTab.sections.push(defaultSectionFor(picker.value, lastTab.sections.length));
          } else if (act === 'del-tab' && schemaDraft.tabs.length > 1) {
            schemaDraft.tabs.splice(ti, 1);
          } else if (act === 'del-sec' && tab) {
            tab.sections.splice(si, 1);
          } else if (act === 'sec-up' && tab && si > 0) {
            const moved = tab.sections.splice(si, 1)[0];
            tab.sections.splice(si - 1, 0, moved);
          } else if (act === 'sec-down' && tab && si < tab.sections.length - 1) {
            const moved = tab.sections.splice(si, 1)[0];
            tab.sections.splice(si + 1, 0, moved);
          } else {
            return;
          }
          commitSchemaDraft();
        });

        // 改名走 input 事件：不重建树，避免丢失输入焦点
        schemaTreeBox.addEventListener('input', (e) => {
          const el = e.target;
          if (!el.dataset || !el.dataset.act || !schemaDraft) return;
          const ti = parseInt(el.dataset.ti, 10);
          const si = parseInt(el.dataset.si, 10);

          if (el.dataset.act === 'rename-tab' && schemaDraft.tabs[ti]) {
            schemaDraft.tabs[ti].label = el.value;
          } else if (el.dataset.act === 'rename-sec') {
            const tab = schemaDraft.tabs[ti];
            if (tab && tab.sections[si]) tab.sections[si].label = el.value;
          } else {
            return;
          }
          applyWorldSchema(schemaDraft, { silent: true });
          const ta = document.getElementById('schemaJsonTextarea');
          if (ta) ta.value = JSON.stringify(getWorldSchema(), null, 2);
        });

        // 折叠方式走 change（<select> 的变更）
        schemaTreeBox.addEventListener('change', (e) => {
          const el = e.target;
          if (!el.dataset || el.dataset.act !== 'sec-collapse' || !schemaDraft) return;
          const ti = parseInt(el.dataset.ti, 10);
          const si = parseInt(el.dataset.si, 10);
          const tab = schemaDraft.tabs[ti];
          if (!tab || !tab.sections[si] || !SECTION_COLLAPSE_MODES[el.value]) return;
          // 显式写进去，'none' 也要写 —— 否则 entities 会回落到它自己的默认值 items
          tab.sections[si].collapse = el.value;
          commitSchemaDraft();
        });
      }

      const addTabBtn = document.getElementById('addTabBtn');
      if (addTabBtn) {
        addTabBtn.onclick = () => {
          if (!schemaDraft) return;
          schemaDraft.tabs.push({
            id: 'tab' + Date.now().toString(36),
            label: '新页签',
            sections: [defaultSectionFor('list', 0)]
          });
          commitSchemaDraft();
        };
      }

      // ---- 创建表单结构编辑器 ----
      const profileTreeBox = document.getElementById('profileTree');
      if (profileTreeBox) {
        // 拖拽排序：角色卡字段整行换位（顺序决定同槽位内的先后）
        enableDragReorder(profileTreeBox, (fi, ti) => {
          if (!schemaDraft || !moveInArray(schemaDraft.profileFields, fi, ti)) return;
          commitSchemaDraft();
        });
        const PROFILE_ACTS = new Set(['p-add', 'p-del', 'p-up', 'p-down']);

        profileTreeBox.addEventListener('click', (e) => {
          const el = e.target.closest('[data-act]');
          if (!el || !schemaDraft || !PROFILE_ACTS.has(el.dataset.act)) return;
          const fields = schemaDraft.profileFields;
          if (!Array.isArray(fields)) return;
          const fi = parseInt(el.dataset.fi, 10);
          const act = el.dataset.act;

          if (act === 'p-add') {
            const kEl = document.getElementById('addProfileKey');
            const lEl = document.getElementById('addProfileLabel');
            // 键名会拼进 character_profile 的属性名，限制成安全字符
            const key = String((kEl && kEl.value) || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 24);
            if (!key) { showToast('请先填写字段的英文键名（字母/数字/下划线）', 'info'); return; }
            if (fields.some(f => f && f.key === key)) { showToast('该键名已存在', 'error'); return; }
            fields.push({ key, label: String((lEl && lEl.value) || '').trim().slice(0, 16) || key, slot: 'field' });
          } else if (act === 'p-del') {
            fields.splice(fi, 1);
          } else if (act === 'p-up' && fi > 0) {
            fields.splice(fi - 1, 0, fields.splice(fi, 1)[0]);
          } else if (act === 'p-down' && fi < fields.length - 1) {
            fields.splice(fi + 1, 0, fields.splice(fi, 1)[0]);
          } else return;
          commitSchemaDraft();
        });

        // 文本改动走 input：不重建树，避免丢焦点
        profileTreeBox.addEventListener('input', (e) => {
          const el = e.target;
          if (!el.dataset || !el.dataset.act || !schemaDraft) return;
          const fields = schemaDraft.profileFields;
          const fi = parseInt(el.dataset.fi, 10);
          const f = (Array.isArray(fields) && Number.isInteger(fi)) ? fields[fi] : null;
          if (!f) return;

          if (el.dataset.act === 'p-rename') f.label = el.value;
          else if (el.dataset.act === 'p-empty') {
            if (el.value) f.emptyText = el.value.slice(0, 24);
            else delete f.emptyText;
          } else return;

          applyWorldSchema(schemaDraft, { silent: true });
          const ta = document.getElementById('schemaJsonTextarea');
          if (ta) ta.value = JSON.stringify(getWorldSchema(), null, 2);
        });

        // 槽位改动走 change：位置变了，整棵树可以安全重建
        profileTreeBox.addEventListener('change', (e) => {
          const el = e.target;
          if (!el.dataset || el.dataset.act !== 'p-slot' || !schemaDraft) return;
          const fields = schemaDraft.profileFields;
          const fi = parseInt(el.dataset.fi, 10);
          const f = Array.isArray(fields) ? fields[fi] : null;
          if (!f) return;
          f.slot = el.value;
          commitSchemaDraft();
        });
      }

      const creationTreeBox = document.getElementById('creationTree');
      if (creationTreeBox) {
        // 拖拽排序：同一字段行内的创建项换位
        enableDragReorder(creationTreeBox, (fi, ti, parent) => {
          const ri = parseInt(parent.dataset.ri, 10);
          const rows = schemaDraft && schemaDraft.creation ? schemaDraft.creation.rows : null;
          const row = (Array.isArray(rows) && Number.isInteger(ri)) ? rows[ri] : null;
          if (row && moveInArray(row.fields, fi, ti)) commitSchemaDraft();
        });
        const CREATION_ACTIONS = new Set(['c-add-field', 'c-del-row', 'c-add-field-last', 'c-add-row',
          'c-up', 'c-down', 'c-del-field', 'c-drv-del', 'c-drv-add']);

        creationTreeBox.addEventListener('click', (e) => {
          const el = e.target.closest('[data-act]');
          if (!el || !schemaDraft || !CREATION_ACTIONS.has(el.dataset.act)) return;
          const c = schemaDraft.creation;
          if (!c || !Array.isArray(c.rows)) return;

          const ri = parseInt(el.dataset.ri, 10);
          const fi = parseInt(el.dataset.fi, 10);
          const row = Number.isInteger(ri) ? c.rows[ri] : null;
          const act = el.dataset.act;

          if (act === 'c-add-field' && row) {
            row.fields.push(defaultCreationFieldFor('text', row.fields.length));
          } else if (act === 'c-add-field-last') {
            const picker = document.getElementById('addCreationType');
            const last = c.rows[c.rows.length - 1];
            if (last && picker) last.fields.push(defaultCreationFieldFor(picker.value, last.fields.length));
          } else if (act === 'c-add-row') {
            c.rows.push({ cols: 'grid-cols-1 sm:grid-cols-2', fields: [defaultCreationFieldFor('text', 0)] });
          } else if (act === 'c-del-row' && c.rows.length > 1) {
            c.rows.splice(ri, 1);
          } else if (act === 'c-del-field' && row) {
            row.fields.splice(fi, 1);
          } else if (act === 'c-up' && row && fi > 0) {
            row.fields.splice(fi - 1, 0, row.fields.splice(fi, 1)[0]);
          } else if (act === 'c-down' && row && fi < row.fields.length - 1) {
            row.fields.splice(fi + 1, 0, row.fields.splice(fi, 1)[0]);
          } else if (act === 'c-drv-del') {
            const di = parseInt(el.dataset.di, 10);
            if (Array.isArray(c.derived)) c.derived.splice(di, 1);
          } else if (act === 'c-drv-add') {
            if (!Array.isArray(c.derived)) c.derived = [];
            c.derived.push({ label: '新数值', cardLabel: '新数值', tone: 'violet', formula: '10' });
          } else {
            return;
          }
          commitSchemaDraft();
        });

        // 文本类改动走 input：不重建树，避免丢焦点
        creationTreeBox.addEventListener('input', (e) => {
          const el = e.target;
          if (!el.dataset || !el.dataset.act || !schemaDraft || !schemaDraft.creation) return;
          const c = schemaDraft.creation;
          const ri = parseInt(el.dataset.ri, 10);
          const fi = parseInt(el.dataset.fi, 10);
          const di = parseInt(el.dataset.di, 10);
          const row = Number.isInteger(ri) && c.rows ? c.rows[ri] : null;
          const field = row && Number.isInteger(fi) ? row.fields[fi] : null;

          if (el.dataset.act === 'c-rename' && field) field.label = el.value;
          else if (el.dataset.act === 'c-cols' && row) row.cols = el.value;
          else if (el.dataset.act === 'c-options' && field) {
            // 逗号/顿号/顿号都给过，顺手去空、限个数与长度，
            // 免得一个手滑贴进来的长文本把下拉框撑爆
            const opts = el.value.split(/[,，、]/).map(s => s.trim()).filter(Boolean)
              .slice(0, 16).map(s => s.slice(0, 20));
            field.options = opts.length ? opts : ['选项一'];
          } else if (el.dataset.act === 'c-placeholder' && field) {
            field.placeholder = el.value.slice(0, 80);
          } else if (el.dataset.act === 'c-dice-label' && c.dice) c.dice.label = el.value;
          else if (el.dataset.act === 'c-dice-key' && c.dice) c.dice.key = el.value;
          else if (el.dataset.act === 'c-drv-label' && c.derived && c.derived[di]) {
            c.derived[di].label = el.value;
            c.derived[di].cardLabel = el.value;
          } else if (el.dataset.act === 'c-drv-formula' && c.derived && c.derived[di]) c.derived[di].formula = el.value;
          else return;

          applyWorldSchema(schemaDraft, { silent: true });
          const ta = document.getElementById('schemaJsonTextarea');
          if (ta) ta.value = JSON.stringify(getWorldSchema(), null, 2);
        });

        // 下拉改动走 change
        creationTreeBox.addEventListener('change', (e) => {
          const el = e.target;
          if (!el.dataset || !el.dataset.act || !schemaDraft || !schemaDraft.creation) return;
          const c = schemaDraft.creation;
          const ri = parseInt(el.dataset.ri, 10);
          const fi = parseInt(el.dataset.fi, 10);

          if (el.dataset.act === 'c-source') {
            const row = c.rows && c.rows[ri];
            const field = row && row.fields[fi];
            if (field) field.source = el.value;
          } else if (el.dataset.act === 'c-dice-sides') {
            if (c.dice) c.dice.sides = parseInt(el.value, 10) || 6;
          } else return;
          commitSchemaDraft();
        });
      }

      document.getElementById('sendActionBtn').onclick = executePlayerTurn;
      document.getElementById('playerInput').onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          executePlayerTurn();
        }
      };
      document.getElementById('playerInput').addEventListener('input', () => {
        updateActiveHighlightBarMatch();
      });

      const closeHlPopBtn = document.getElementById('closeHlPopoverBtn');
      if (closeHlPopBtn) {
        closeHlPopBtn.onclick = () => closeHighlightWordPopover();
      }

      document.addEventListener('click', (e) => {
        const strongTarget = e.target.closest('#narrativeContainer .prose strong, #narrativeContainer .prose b, #highlightPreviewBox strong');
        if (strongTarget) {
          e.stopPropagation();
          openHighlightWordPopover(strongTarget);
          return;
        }
        const pop = document.getElementById('highlightWordPopover');
        if (pop && !pop.classList.contains('hidden')) {
          if (!pop.contains(e.target) && !e.target.closest('[data-action="hl-chip-click"]')) {
            closeHighlightWordPopover();
          }
        }
      });

      document.getElementById('cancelDiceBtn').onclick = () => document.getElementById('diceConfirmModal').classList.add('hidden');
      document.getElementById('confirmDiceBtn').onclick = () => {
        if (pendingDiceSides) executeDiceRoll(pendingDiceSides);
        document.getElementById('diceConfirmModal').classList.add('hidden');
      };

      document.getElementById('saveLoreBtn').onclick = () => {
        AppState.lore.world = document.getElementById('worldLoreInput').value.trim();
        AppState.lore.character = document.getElementById('characterLoreInput').value.trim();
        AppState.lore.rules = document.getElementById('rulesInput').value.trim();
        AppState.lore.memoryPins = document.getElementById('memoryPinsInput').value.trim();
        saveCurrentSlotToStorage();
        updateRailIndicator();
        showToast('世界设定与长线记忆已保存', 'success');
      };

      document.getElementById('extractPinsBtn').onclick = () => extractMemoryPins(false);

      // 自动刷新间隔是全局偏好（不属于某个世界），所以单独存一个键
      const pinsIntervalInput = document.getElementById('pinsAutoIntervalInput');
      if (pinsIntervalInput) {
        pinsIntervalInput.value = String(getPinsAutoInterval());
        pinsIntervalInput.onchange = () => {
          const v = setPinsAutoInterval(parseInt(pinsIntervalInput.value, 10));
          showToast(v > 0 ? `已开启：每 ${v} 回合自动刷新长线记忆锚点` : '已关闭自动刷新（仍可手动点按钮）', 'info');
        };
      }

      document.getElementById('clearLoreBtn').onclick = () => {
        document.getElementById('worldLoreInput').value = '';
        document.getElementById('characterLoreInput').value = '';
        document.getElementById('rulesInput').value = '';
        document.getElementById('memoryPinsInput').value = '';
        AppState.lore = { world: '', character: '', rules: '', memoryPins: '' };
        saveCurrentSlotToStorage();
        updateRailIndicator();
        showToast('设定框已清空', 'info');
      };

      document.getElementById('newSessionBtn').onclick = () => document.getElementById('resetConfirmModal').classList.remove('hidden');
      document.getElementById('cancelResetBtn').onclick = () => document.getElementById('resetConfirmModal').classList.add('hidden');
      document.getElementById('confirmResetBtn').onclick = () => {
        AppState.narrativeHistory = [];
        resetHudDefaults();
        saveCurrentSlotToStorage();
        renderAllNarratives(true);
        renderHud();
        document.getElementById('resetConfirmModal').classList.add('hidden');
        showToast('已重置本局推演与角色数值', 'info');
      };

      // 属性上限按钮现在由 renderAttrsStats 按 section 实例绑定，这里只留弹窗自身的按钮
      document.getElementById('cancelCapModalBtn').onclick = () => document.getElementById('attributeCapModal').classList.add('hidden');
      document.getElementById('saveCapModalBtn').onclick = () => {
        const val = parseInt(document.getElementById('attributeCapInput').value, 10) || 20;
        AppState.hudState.attribute_cap = val;
        renderHud();
        saveCurrentSlotToStorage();
        document.getElementById('attributeCapModal').classList.add('hidden');
        showToast(`属性上限已更新为 ${val}`, 'success');
      };

      document.getElementById('toggleEditHudBtn').onclick = () => {
        document.getElementById('rawHudJsonTextarea').value = JSON.stringify(AppState.hudState, null, 2);
        document.getElementById('manualHudModal').classList.remove('hidden');
      };
      document.getElementById('cancelManualHudBtn').onclick = () => document.getElementById('manualHudModal').classList.add('hidden');
      document.getElementById('saveManualHudBtn').onclick = () => {
        try {
          const parsed = JSON.parse(document.getElementById('rawHudJsonTextarea').value);
          AppState.hudState = parsed;
          saveCurrentSlotToStorage();
          renderHud();
          document.getElementById('manualHudModal').classList.add('hidden');
          showToast('HUD 数据已手动同步', 'success');
        } catch (e) {
          showToast('JSON 格式不合法', 'error');
        }
      };

      // 「展开全文」现在由 renderProfile 在每个 profile section 实例上绑定

      // ---- 统一的世界包格式 ----
      // 旧代码里「导出对局」写 title、「导出当前世界」写 worldName，而导入只认 worldName，
      // 导致导出对局的产物导入后世界名退化成文件名、且丢失 desc。现在统一为一个 schema。
      const WORLD_PACK_FORMAT = 'singularity-world-pack';
      const WORLD_PACK_VERSION = 2;

      function buildWorldPack(includeHistory) {
        const s = AppState.slots.find(x => x.id === AppState.currentSlotId) || AppState.slots[0] || { name: '未命名世界', desc: '' };
        return {
          format: WORLD_PACK_FORMAT,
          version: WORLD_PACK_VERSION,
          worldName: s.name,
          desc: s.desc || '',
          exportedAt: new Date().toISOString(),
          lore: AppState.lore,
          wizardConfig: AppState.wizardConfig,
          hudState: AppState.hudState,
          worldSchema: AppState.worldSchema,
          contextSummary: AppState.contextSummary,
          summarizedUpTo: AppState.summarizedUpTo,
          contextConfig: AppState.contextConfig,
          history: includeHistory ? AppState.narrativeHistory : []
        };
      }

      function downloadJson(data, filename) {
        try {
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* 已释放 */ } }, 1000);
          return true;
        } catch (e) {
          console.error('[奇点] 导出失败:', e);
          showToast(`导出失败：${e.message}`, 'error');
          return false;
        }
      }

      document.getElementById('exportSessionBtn').onclick = () => {
        const pack = buildWorldPack(true);
        if (downloadJson(pack, `singularity_${pack.worldName}_${Date.now()}.json`)) {
          showToast(`对局存档已导出（含 ${pack.history.length} 条推演记录）`, 'success');
        }
      };

      document.getElementById('exportCurrentSlotBtn').onclick = () => {
        // 纯设定包：不含推演记录，便于分享世界观
        const pack = buildWorldPack(false);
        if (downloadJson(pack, `world_${pack.worldName}_${Date.now()}.json`)) {
          showToast('当前世界设定包已导出（不含推演记录）', 'success');
        }
      };

      document.getElementById('importSlotJsonBtn').onclick = () => document.getElementById('slotJsonFileInput').click();
      document.getElementById('slotJsonFileInput').onchange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          let parsed;
          try {
            parsed = JSON.parse(ev.target.result);
          } catch (err) {
            showToast('世界包 JSON 解析失败', 'error');
            return;
          }
          try {
            const newId = `slot_import_${Date.now()}`;
            // 兼容三种来源：新统一格式 / 旧「导出对局」(title) / 旧「导出世界」(worldName)
            const name = parsed.worldName || parsed.title || file.name.replace(/\.json$/i, '');
            const history = Array.isArray(parsed.history) ? parsed.history : [];
            AppState.slots.push({ id: newId, name, desc: parsed.desc || '导入的自定义世界包' });

            const ctx = {
              summary: typeof parsed.contextSummary === 'string' ? parsed.contextSummary : '',
              summarizedUpTo: Number(parsed.summarizedUpTo) || 0,
              config: Object.assign(defaultContextConfig(), parsed.contextConfig || {})
            };

            // 关键修复：必须先把导入数据写进「新槽位自己的」存储键，再切换过去。
            // 旧实现直接改 AppState 后 save()，而 save() 写的是 currentSlotId（还是旧槽位），
            // 于是既覆盖了当前世界的数据，切过去后又读到空数据，导入完全失效。
            localStorage.setItem('chronicle_user_slots', JSON.stringify(AppState.slots));
            localStorage.setItem(getSlotStorageKey(newId, 'lore'), JSON.stringify(parsed.lore || { world: '', character: '', rules: '', memoryPins: '' }));
            localStorage.setItem(getSlotStorageKey(newId, 'wizard_cfg'), JSON.stringify(parsed.wizardConfig || defaultWizardConfig()));
            localStorage.setItem(getSlotStorageKey(newId, 'hud'), JSON.stringify(parsed.hudState || defaultHudState()));
            localStorage.setItem(getSlotStorageKey(newId, 'story'), JSON.stringify(history));
            localStorage.setItem(getSlotStorageKey(newId, 'ctx'), JSON.stringify(ctx));
            // 蓝图随世界包携带；旧包没有该字段 → 回退默认蓝图
            localStorage.setItem(getSlotStorageKey(newId, 'schema'), JSON.stringify(normalizeWorldSchema(parsed.worldSchema)));

            switchSlot(newId);
            showToast(history.length
              ? `已导入世界「${name}」及其 ${history.length} 条推演记录`
              : `已导入世界「${name}」（纯设定包，无推演记录）`, 'success');
          } catch (err) {
            console.error('[奇点] 导入世界包失败:', err);
            showToast(`世界包导入失败：${err.message}`, 'error');
          }
        };
        reader.readAsText(file);
      };

      const storedSlotId = localStorage.getItem('chronicle_active_slot_id');
      const initialSlot = AppState.slots.some(s => s.id === storedSlotId) ? storedSlotId : AppState.slots[0].id;
      loadSlotState(initialSlot);
    });
  