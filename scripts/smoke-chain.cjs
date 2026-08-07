var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/electron-stub.cjs
var require_electron_stub = __commonJS({
  "scripts/electron-stub.cjs"(exports2, module2) {
    var noop = () => {
    };
    var Stub = class {
      constructor() {
        return new Proxy(this, { get: () => noop });
      }
      static getInstance() {
        return null;
      }
    };
    var appStub = {
      getPath: () => require("path").join(process.env.APPDATA || ".", "workon"),
      on: noop,
      whenReady: () => Promise.resolve(),
      getName: () => "workon-smoke",
      isPackaged: false
    };
    module2.exports = new Proxy(
      { app: appStub },
      {
        get: (t, k) => k in t ? t[k] : Stub
      }
    );
  }
});

// src/main/db.ts
var import_electron3 = __toESM(require_electron_stub());
var import_fs = __toESM(require("fs"));
var import_path = __toESM(require("path"));

// src/shared/stateMeta.ts
var WORK_STATES = {
  focus: { label: "\u4E13\u6CE8", color: "#10B981", emoji: "\u{1F3AF}" },
  coding: { label: "\u7F16\u7A0B", color: "#3B82F6", emoji: "\u{1F4BB}" },
  aidev: { label: "AI\u5F00\u53D1", color: "#6366F1", emoji: "\u{1F916}" },
  aiqa: { label: "AI\u95EE\u7B54", color: "#A78BFA", emoji: "\u{1F4AC}" },
  writing: { label: "\u5199\u6587\u6863", color: "#22D3EE", emoji: "\u{1F4DD}" },
  meeting: { label: "\u4F1A\u8BAE", color: "#F59E0B", emoji: "\u{1F465}" },
  slack: { label: "\u6478\u9C7C", color: "#EF4444", emoji: "\u{1F41F}" },
  relax: { label: "\u653E\u677E", color: "#94A3B8", emoji: "\u{1F3B5}" },
  idle: { label: "\u7A7A\u95F2", color: "#64748B", emoji: "\u2601\uFE0F" },
  break: { label: "\u4F11\u606F", color: "#FBBF24", emoji: "\u2615" },
  lunch: { label: "\u5348\u4F11", color: "#FB923C", emoji: "\u{1F35A}" },
  remote: { label: "\u8FDC\u7A0B\u534F\u4F5C", color: "#38BDF8", emoji: "\u{1F517}" },
  away: { label: "\u79BB\u5F00", color: "#475569", emoji: "\u{1F6B6}" }
};
var STATE_LABEL = Object.fromEntries(
  Object.entries(WORK_STATES).map(([k, v]) => [k, v.label])
);
var ALL_STATES = Object.keys(WORK_STATES);
var WORK_LIKE_STATES = ["focus", "coding", "aidev", "aiqa", "writing", "meeting", "remote"];

// src/shared/trail.ts
var SEG_GAP_MS = 60 * 1e3;
var SEG_CAP_MS = 60 * 60 * 1e3;
function dateKey(ts) {
  const d = new Date(ts);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function buildMergedTrail(records, date) {
  const sorted = [...records].sort((a, b) => a.ts - b.ts);
  const segments = [];
  const screenMinutes = {};
  const stateMinutes = {};
  let dualMin = 0;
  let dualWorkSlackMin = 0;
  let glanceMin = 0;
  const mainStateCount = {};
  const auxStateCount = {};
  let cur = null;
  const buckets = [];
  for (const r of sorted) {
    if (!cur || r.ts - cur.endTs > SEG_GAP_MS) {
      if (cur) buckets.push(cur);
      cur = { startTs: r.ts, endTs: r.ts, byScreen: /* @__PURE__ */ new Map() };
    }
    const list = cur.byScreen.get(r.screen) ?? [];
    list.push(r);
    cur.byScreen.set(r.screen, list);
    cur.endTs = Math.max(cur.endTs, r.ts);
  }
  if (cur) buckets.push(cur);
  for (const b of buckets) {
    let bucketStart = Infinity;
    let bucketEnd = 0;
    const screenSpan = /* @__PURE__ */ new Map();
    for (const [screen2, rs] of b.byScreen) {
      const start = rs[0].startTs ?? rs[0].ts;
      const end = rs[rs.length - 1].ts;
      const top2 = rs.reduce((a, c) => c.ts - (c.startTs ?? c.ts) > a.ts - (a.startTs ?? a.ts) ? c : a, rs[0]);
      screenSpan.set(screen2, { start, end, top: top2 });
      bucketStart = Math.min(bucketStart, start);
      bucketEnd = Math.max(bucketEnd, end);
    }
    let spanMs = Math.min(bucketEnd - bucketStart, SEG_CAP_MS);
    if (spanMs < 0) spanMs = 0;
    const spanMin = spanMs / 6e4;
    const activeEntry = [...screenSpan.values()].find((s) => s.top.active) ?? [...screenSpan.values()][0];
    const main2 = activeEntry.top;
    const aux = [...screenSpan.entries()].find(([s]) => s !== main2.screen)?.[1] ?? null;
    const isDual = screenSpan.size > 1;
    if (isDual) {
      dualMin += spanMin;
      const mainWork = WORK_LIKE_STATES.includes(main2.state);
      const auxSlack = aux ? !WORK_LIKE_STATES.includes(aux.top.state) : false;
      if (mainWork && auxSlack) dualWorkSlackMin += spanMin;
    }
    for (const [screen2, s] of screenSpan) {
      screenMinutes[screen2] = (screenMinutes[screen2] ?? 0) + Math.min(s.end - s.start, SEG_CAP_MS) / 6e4;
    }
    const glance = spanMin < 0.5;
    if (glance) {
      glanceMin += spanMin;
    } else {
      stateMinutes[main2.state] = (stateMinutes[main2.state] ?? 0) + spanMin;
      mainStateCount[main2.state] = (mainStateCount[main2.state] ?? 0) + spanMin;
    }
    if (aux) auxStateCount[aux.top.state] = (auxStateCount[aux.top.state] ?? 0) + spanMin;
    segments.push({
      id: `s${bucketStart}`,
      startTs: bucketStart,
      endTs: bucketEnd,
      durationMin: spanMin,
      mainState: main2.state,
      auxState: aux ? aux.top.state : null,
      mainApp: main2.appName ?? main2.app,
      auxApp: aux ? aux.top.appName ?? aux.top.app : null,
      mainTitle: main2.title,
      auxTitle: aux ? aux.top.title : void 0,
      screens: [...screenSpan.keys()],
      glance
    });
  }
  const totalMin = segments.reduce((a, s) => a + s.durationMin, 0);
  const top = (c) => {
    const e = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    return e ? e[0] : null;
  };
  return {
    date,
    totalMin,
    dualMin,
    dualRatio: totalMin > 0 ? dualMin / totalMin : 0,
    screenMinutes,
    mainState: top(mainStateCount) ?? "idle",
    auxTopState: top(auxStateCount),
    dualWorkSlackMin,
    glanceMin,
    segments,
    stateMinutes
  };
}

// src/main/settings.ts
var import_electron = __toESM(require_electron_stub());

// src/shared/types.ts
var DEFAULT_SETTINGS = {
  monitorInterval: 5e3,
  monitorSmart: false,
  deepMode: false,
  activityRetentionDays: 60,
  aiAutoRefreshMin: 30,
  devMode: false,
  calAnalysisBands: false,
  reportExcludeSlack: false,
  reportTemplate: "",
  planForecastEnabled: true,
  theme: "cyan",
  appearanceMode: "dark",
  aiEnabled: false,
  aiApiKey: "",
  aiBaseUrl: "https://api.openai.com/v1",
  aiModel: "gpt-4o-mini",
  aiAutoRefresh: true,
  onerEndpoint: "",
  onerToken: "",
  onerAutoSyncMin: 0,
  wsEnabled: true,
  wsPort: 18765,
  stateSnapshot: true,
  meetingMode: "ask",
  petEnabled: true,
  petCharacter: "ling",
  petClickThrough: true,
  petScale: 1,
  petRoam: false,
  suppressTransitionOnPageSwitch: true,
  petFpsTier: "smooth",
  petGuideShown: false,
  introPlayed: false,
  petRememberPos: true,
  petReturnMin: 30,
  petPosX: -1,
  petPosY: -1,
  petInteractions: { click: true, drag: true, dragPhysics: false, follow: false, costume: false, emotion: false, chat: true },
  ocrCleanupDays: 14,
  ocrAutoCompress: false,
  ocrCacheLimit: 200,
  privacyExcludedApps: [],
  workChains: [],
  widgetVisible: false,
  // 悬浮卡片默认隐藏（设置里可手动开启），状态由桌宠对话泡泡提供
  widgetOpacity: 0.92,
  launchAtLogin: false,
  slackHideSec: 180,
  slackAutoHide: true,
  cmdPaletteEnabled: true,
  // v2.6：userType/targetWorkMin/targetPomodoros 留空 = 自动识别 / 用类型默认值
  userTypeAuto: true,
  scorePetAdapt: true,
  smartReportAI: true
};
var idSeq = 0;
function genId(prefix = "id") {
  idSeq = (idSeq + 1) % 1e4;
  return `${prefix}_${Date.now().toString(36)}_${idSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// src/main/settings.ts
var current = { ...DEFAULT_SETTINGS };
function getSettings() {
  return current;
}

// src/main/windows.ts
var import_electron2 = __toESM(require_electron_stub());
var isDev = !!process.env.ELECTRON_RENDERER_URL;

// src/main/db.ts
var EMPTY = {
  entries: [],
  screenshots: [],
  memos: [],
  plans: [],
  analyses: [],
  usages: [],
  corrections: [],
  rules: [],
  feedbacks: [],
  qa: [],
  categories: [],
  attentionScores: [],
  achievements: [],
  accessLogs: [],
  personas: [],
  reportTemplates: [],
  ocrSnapshots: [],
  chains: []
};
var dir = "";
var jsonFile = "";
var actFile = "";
var data = { ...EMPTY };
var activities = [];
var actIdSeq = 1;
var flushTimer = null;
var actDirty = false;
function initDb() {
  dir = import_electron3.app.getPath("userData");
  jsonFile = import_path.default.join(dir, "db.json");
  actFile = import_path.default.join(dir, "activities.jsonl");
  try {
    import_fs.default.mkdirSync(dir, { recursive: true });
    import_fs.default.accessSync(dir, import_fs.default.constants.W_OK);
  } catch (e) {
    console.error("[db] userData \u76EE\u5F55\u4E0D\u53EF\u5199:", dir, e);
    import_electron3.dialog.showErrorBox(
      "WorkOn \u6570\u636E\u76EE\u5F55\u4E0D\u53EF\u5199",
      `\u65E0\u6CD5\u5199\u5165\u6570\u636E\u76EE\u5F55\uFF1A
${dir}

\u6D3B\u52A8\u8BB0\u5F55\u5C06\u65E0\u6CD5\u4FDD\u5B58\u3002\u8BF7\u68C0\u67E5\u78C1\u76D8\u7A7A\u95F4\u6216\u76EE\u5F55\u6743\u9650\u540E\u91CD\u542F\u5E94\u7528\u3002`
    );
  }
  try {
    if (import_fs.default.existsSync(jsonFile)) data = { ...EMPTY, ...JSON.parse(import_fs.default.readFileSync(jsonFile, "utf-8")) };
  } catch (e) {
    console.warn("[db] db.json \u8BFB\u53D6\u5931\u8D25\uFF0C\u4F7F\u7528\u7A7A\u5E93", e);
  }
  try {
    if (import_fs.default.existsSync(actFile)) {
      const retainDays = Math.max(7, getSettings().activityRetentionDays || 60);
      const cutoff = Date.now() - retainDays * 864e5;
      const lines = import_fs.default.readFileSync(actFile, "utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const r = JSON.parse(line);
          if (r.ts >= cutoff) {
            activities.push(r);
            if (r.id && r.id >= actIdSeq) actIdSeq = r.id + 1;
          }
        } catch {
        }
      }
      import_fs.default.writeFileSync(actFile, activities.map((r) => JSON.stringify(r)).join("\n") + (activities.length ? "\n" : ""), "utf-8");
      console.log(`[db] activities.jsonl: \u5DF2\u52A0\u8F7D ${activities.length} \u6761\uFF08\u4FDD\u7559 ${retainDays} \u5929\uFF09`);
    } else {
      console.log("[db] activities.jsonl: \u9996\u6B21\u8FD0\u884C\uFF0C\u65B0\u5EFA\u6D3B\u52A8\u65E5\u5FD7");
    }
  } catch (e) {
    console.warn("[db] activities.jsonl \u8BFB\u53D6\u5931\u8D25", e);
  }
}
function scheduleFlush() {
  actDirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushNow();
  }, 3e3);
}
function flushNow() {
  if (!jsonFile) return;
  try {
    import_fs.default.writeFileSync(jsonFile, JSON.stringify(data), "utf-8");
  } catch (e) {
    console.warn("[db] db.json \u843D\u76D8\u5931\u8D25", e);
  }
  if (actDirty) {
    actDirty = false;
    try {
      import_fs.default.mkdirSync(dir, { recursive: true });
    } catch {
    }
  }
}
function listActivities(date) {
  return activities.filter((r) => dateKey(r.ts) === date);
}
function col(name) {
  return data[name];
}
function insertInto(name, item) {
  const arr = data[name];
  arr.push(item);
  if (name === "qa" && arr.length > 500) arr.splice(0, arr.length - 500);
  scheduleFlush();
  return item;
}

// src/shared/planAnalysis.ts
var BUILTIN_CATEGORIES = [
  { id: "ai-dev", label: "AI \u5F00\u53D1", color: "#8B5CF6", emoji: "\u{1F916}", stateHints: ["aidev", "aiqa", "coding"], isBuiltIn: true, ts: 0 },
  { id: "work-customer", label: "\u5BA2\u6237\u5DE5\u4F5C", color: "#3B82F6", emoji: "\u{1F4BC}", stateHints: ["meeting", "remote", "writing", "focus"], isBuiltIn: true, ts: 0 },
  { id: "leader", label: "\u7BA1\u7406\u6C9F\u901A", color: "#F59E0B", emoji: "\u{1F465}", stateHints: ["meeting", "remote"], isBuiltIn: true, ts: 0 },
  { id: "personal", label: "\u4E2A\u4EBA\u4E8B\u52A1", color: "#10B981", emoji: "\u{1F3E0}", stateHints: ["relax", "break", "writing"], isBuiltIn: true, ts: 0 },
  { id: "other", label: "\u5176\u4ED6", color: "#64748B", emoji: "\u{1F4CB}", stateHints: [], isBuiltIn: true, ts: 0 }
];
var CATEGORY_STATE_HINT = Object.fromEntries(
  BUILTIN_CATEGORIES.map((c) => [c.id, c.stateHints ?? []])
);

// src/main/attention.ts
var autoTypeCache = null;
function effectiveUserType() {
  return getSettings().userType ?? autoTypeCache ?? "office_worker";
}

// src/main/chain/templates.ts
var TITLE_PATTERNS = {
  // 沟通工具上下文判定
  COMMUNICATION_CONTEXT: {
    app: "^(WeChat|QQ|DingTalk|Feishu)$|\u5FAE\u4FE1|\u9489\u9489|\u98DE\u4E66|\u4F01\u4E1A\u5FAE\u4FE1|Slack|Teams",
    patterns: [
      // 工作上下文
      { regex: /(总|经理|主管|老板|领导|主任|老师|教授)/i, context: "work", role: "intake" },
      { regex: /(项目|需求|任务|方案|报告|评审|会议)/i, context: "work", role: "communication" },
      { regex: /(工作群|项目群|部门|团队)/i, context: "work", role: "communication" },
      // 摸鱼上下文
      { regex: /(水群|摸鱼|快乐|闲聊|吹水|八卦)/i, context: "slacking", role: null },
      { regex: /(朋友圈|视频号|看一看)/i, context: "slacking", role: null }
    ]
  },
  // 浏览器上下文判定
  BROWSER_CONTEXT: {
    app: "^(Chrome|Browser)$|Edge|Firefox|Safari|\u6D4F\u89C8\u5668",
    patterns: [
      // 工作搜索
      { regex: /(google|baidu|bing).*[?&](q|wd|search)=(.+)/i, context: "search", role: "intake" },
      { regex: /(stackoverflow|github|掘金|csdn|知乎.*技术)/i, context: "work", role: "intake" },
      { regex: /(mdn|文档|docs|api)/i, context: "work", role: "intake" },
      // 学习搜索
      { regex: /(考研|真题|复习|课程|教程|网课)/i, context: "study", role: "intake" },
      // 创作素材
      { regex: /(pinterest|behance|dribbble|unsplash|花瓣)/i, context: "creative", role: "intake" },
      // 摸鱼
      { regex: /(微博|抖音|快手|小红书|bilibili.*娱乐|淘宝|京东)/i, context: "slacking", role: null },
      { regex: /(游戏|直播|视频.*娱乐)/i, context: "slacking", role: null }
    ]
  },
  // 会议软件上下文判定
  MEETING_CONTEXT: {
    app: "^Meeting$|\u817E\u8BAF\u4F1A\u8BAE|Zoom|Teams|\u98DE\u4E66\u4F1A\u8BAE|\u9489\u9489\u4F1A\u8BAE",
    patterns: [
      { regex: /(会议|Meeting|周会|评审|站会|standup|review)/i, context: "meeting", role: "communication" },
      { regex: /(闲聊|聊天)/i, context: "slacking", role: null }
    ]
  },
  // 终端上下文判定（友好名可能带 "Terminal · 目录" 后缀）
  TERMINAL_CONTEXT: {
    app: "^Terminal|PowerShell|CMD|iTerm|Windows Terminal",
    patterns: [
      { regex: /(root|ssh|deploy|build|test|git|docker|kubectl)/i, context: "devops", role: "process" },
      { regex: /(.+)@(.+):/i, context: "remote", role: "process" }
      // SSH 远程
    ]
  },
  // B站特殊判定（独立客户端友好名 VideoSite；网页版由 BROWSER_CONTEXT 覆盖）
  BILIBILI_CONTEXT: {
    app: "^VideoSite$|bilibili|B\u7AD9",
    patterns: [
      { regex: /(教程|课程|讲解|教学|lecture|tutorial)/i, context: "study", role: "intake" },
      { regex: /(搞笑|娱乐|综艺|鬼畜)/i, context: "slacking", role: null }
    ]
  }
};
function parseWindowTitle(appName, windowTitle) {
  for (const config of Object.values(TITLE_PATTERNS)) {
    if (new RegExp(config.app, "i").test(appName)) {
      for (const pattern of config.patterns) {
        if (pattern.regex.test(windowTitle)) {
          return { context: pattern.context, role: pattern.role, isSlacking: pattern.context === "slacking" };
        }
      }
    }
  }
  return { context: "unknown", role: null, isSlacking: false };
}
var COMM = "^(WeChat|QQ|DingTalk|Feishu)$";
var OFFICE = "^Office$";
var NOTES = "^Notes$";
var IDE = "^(VSCode|Visual Studio|Rider|IntelliJ|Cursor|Windsurf|Trae)$";
var AI_IDE = "^(Cursor|Windsurf|Trae)$";
var TERMINAL = "^Terminal|Transfer/SSH";
var MEETING = "^Meeting$";
var BROWSER = "^(Chrome|Browser)$";
var DESIGN = "^Design$";
var MAIL = "outlook|foxmail|mail|\u90AE\u4EF6";
var ANKI = "anki|\u8BB0\u5FC6";
var CHAT_EXCLUDE = ["\u6C34\u7FA4", "\u6478\u9C7C", "\u95F2\u804A", "\u5439\u6C34", "\u516B\u5366", "\u670B\u53CB\u5708", "\u89C6\u9891\u53F7", "\u770B\u4E00\u770B"];
var OFFICE_WORKER_TEMPLATES = [
  {
    id: "office-leader-task",
    name: "\u9886\u5BFC\u4EFB\u52A1\u6267\u884C\u94FE",
    type: "task_assigned",
    userType: "office_worker",
    requireOutput: true,
    steps: [
      { appPattern: COMM, role: "intake", titleExclude: CHAT_EXCLUDE },
      { appPattern: `${OFFICE}|${NOTES}`, role: "process" },
      { appPattern: AI_IDE, role: "process" },
      { appPattern: `${OFFICE}|${NOTES}`, role: "output" },
      { appPattern: COMM, role: "output", titleExclude: CHAT_EXCLUDE }
    ]
  },
  {
    id: "office-meeting-exec",
    name: "\u4F1A\u8BAE\u6267\u884C\u94FE",
    type: "meeting",
    userType: "office_worker",
    requireOutput: false,
    steps: [
      { appPattern: MEETING, role: "communication", minDurationMin: 15 },
      { appPattern: `${NOTES}|${OFFICE}`, role: "process" },
      { appPattern: `${IDE}|${OFFICE}|DevTool`, role: "process" }
    ]
  },
  {
    id: "office-doc-solo",
    name: "\u6587\u6863\u72EC\u7ACB\u4EA7\u51FA\u94FE",
    type: "self_driven",
    userType: "office_worker",
    requireOutput: false,
    steps: [
      { appPattern: OFFICE, role: "process", minDurationMin: 20 },
      { appPattern: `${MAIL}|${COMM}`, role: "output" }
    ]
  },
  {
    id: "office-dev",
    name: "\u4EE3\u7801\u5F00\u53D1\u94FE",
    type: "self_driven",
    userType: "office_worker",
    requireOutput: false,
    steps: [
      { appPattern: IDE, role: "process" },
      { appPattern: TERMINAL, role: "process" },
      { appPattern: TERMINAL, role: "output", titleKeywords: ["git", "push", "deploy", "build", "commit"] }
    ]
  }
];
var EXAM_CANDIDATE_TEMPLATES = [
  {
    id: "exam-course",
    name: "\u7F51\u8BFE\u5B66\u4E60\u94FE",
    type: "learning",
    userType: "exam_candidate",
    requireOutput: false,
    steps: [
      { appPattern: `${BROWSER}|^VideoSite$`, role: "intake", titleKeywords: ["\u8BFE\u7A0B", "\u6559\u7A0B", "\u7F51\u8BFE", "\u8003\u7814", "\u8BB2\u89E3", "\u6559\u5B66", "lecture", "tutorial"] },
      { appPattern: `${NOTES}|${OFFICE}`, role: "process" },
      { appPattern: ANKI, role: "process" }
    ]
  },
  {
    id: "exam-practice",
    name: "\u5237\u9898\u94FE",
    type: "learning",
    userType: "exam_candidate",
    requireOutput: false,
    steps: [
      { appPattern: BROWSER, role: "intake", titleKeywords: ["\u771F\u9898", "\u8BD5\u9898", "\u6A21\u62DF", "\u9898\u5E93", ".pdf"] },
      { appPattern: `${NOTES}|${OFFICE}`, role: "process" },
      { appPattern: `${NOTES}|${OFFICE}`, role: "review", titleKeywords: ["\u9519\u9898", "\u7B14\u8BB0"] }
    ]
  },
  {
    id: "exam-memorize",
    name: "\u80CC\u8BF5\u8BB0\u5FC6\u94FE",
    type: "learning",
    userType: "exam_candidate",
    requireOutput: false,
    steps: [
      { appPattern: ANKI, role: "process", minDurationMin: 15 },
      { appPattern: NOTES, role: "review" }
    ]
  },
  {
    id: "exam-review",
    name: "\u590D\u4E60\u6574\u7406\u94FE",
    type: "learning",
    userType: "exam_candidate",
    requireOutput: false,
    steps: [
      { appPattern: NOTES, role: "process", minDurationMin: 20 },
      { appPattern: BROWSER, role: "review", titleKeywords: [".pdf", "pdf", "\u6559\u6750", "\u8BB2\u4E49"] },
      { appPattern: NOTES, role: "output" }
    ]
  }
];
var FREELANCER_TEMPLATES = [
  {
    id: "free-design-deliver",
    name: "\u8BBE\u8BA1\u4EA4\u4ED8\u94FE",
    type: "creative",
    userType: "freelancer",
    requireOutput: false,
    steps: [
      { appPattern: DESIGN, role: "process" },
      { appPattern: COMM, role: "communication", titleExclude: CHAT_EXCLUDE },
      { appPattern: BROWSER, role: "output", titleKeywords: ["\u4EA4\u4ED8", "\u4E0A\u4F20", "\u53D1\u5E03", "upload", "behance", "\u7AD9\u9177"] }
    ]
  },
  {
    id: "free-dev-deliver",
    name: "\u5F00\u53D1\u4EA4\u4ED8\u94FE",
    type: "self_driven",
    userType: "freelancer",
    requireOutput: false,
    steps: [
      { appPattern: IDE, role: "process" },
      { appPattern: TERMINAL, role: "process" },
      { appPattern: TERMINAL, role: "output", titleKeywords: ["git", "push", "deploy"] },
      { appPattern: COMM, role: "output", titleExclude: CHAT_EXCLUDE }
    ]
  },
  {
    id: "free-client-comm",
    name: "\u5BA2\u6237\u6C9F\u901A\u94FE",
    type: "task_assigned",
    userType: "freelancer",
    requireOutput: true,
    steps: [
      { appPattern: COMM, role: "intake", titleExclude: CHAT_EXCLUDE },
      { appPattern: `${IDE}|${OFFICE}|${NOTES}|${DESIGN}`, role: "process" },
      { appPattern: COMM, role: "output", titleExclude: CHAT_EXCLUDE }
    ]
  }
];
var STUDENT_TEMPLATES = [
  {
    id: "stu-homework",
    name: "\u8BFE\u7A0B\u4F5C\u4E1A\u94FE",
    type: "task_assigned",
    userType: "student",
    requireOutput: false,
    steps: [
      { appPattern: `${BROWSER}|^VideoSite$`, role: "intake", titleKeywords: ["\u8BFE\u7A0B", "\u8BFE\u4EF6", "\u7F51\u8BFE", "\u6559\u7A0B", "mooc", "\u6155\u8BFE"] },
      { appPattern: OFFICE, role: "process" },
      { appPattern: BROWSER, role: "output", titleKeywords: ["\u63D0\u4EA4", "\u4E0A\u4F20", "submit", "upload", "\u4F5C\u4E1A"] }
    ]
  },
  {
    id: "stu-self-study",
    name: "\u81EA\u4E60\u590D\u4E60\u94FE",
    type: "learning",
    userType: "student",
    requireOutput: false,
    steps: [
      { appPattern: BROWSER, role: "intake", titleKeywords: [".pdf", "pdf", "\u6559\u6750", "\u8BB2\u4E49", "\u8BFE\u4EF6"] },
      { appPattern: `${NOTES}|${OFFICE}`, role: "process" },
      { appPattern: BROWSER, role: "process", titleKeywords: ["\u7EC3\u4E60", "\u9898\u5E93", "\u8BD5\u9898"] }
    ]
  },
  {
    id: "stu-lab-report",
    name: "\u5B9E\u9A8C\u62A5\u544A\u94FE",
    type: "self_driven",
    userType: "student",
    requireOutput: false,
    steps: [
      { appPattern: "matlab|spss|python|^VSCode$|^IntelliJ$", role: "process" },
      { appPattern: OFFICE, role: "process", titleKeywords: ["\u5B9E\u9A8C\u62A5\u544A", "\u62A5\u544A", "\u5B9E\u9A8C"] },
      { appPattern: BROWSER, role: "output", titleKeywords: ["\u63D0\u4EA4", "\u4E0A\u4F20", "submit"] }
    ]
  }
];
var CREATOR_TEMPLATES = [
  {
    id: "creator-video",
    name: "\u89C6\u9891\u521B\u4F5C\u94FE",
    type: "creative",
    userType: "creator",
    requireOutput: false,
    steps: [
      { appPattern: BROWSER, role: "intake", titleKeywords: ["pinterest", "behance", "dribbble", "unsplash", "\u82B1\u74E3", "\u7D20\u6750", "bilibili", "youtube"] },
      { appPattern: DESIGN, role: "process" },
      { appPattern: `${BROWSER}|^VideoSite$`, role: "output", titleKeywords: ["\u53D1\u5E03", "\u4E0A\u4F20", "upload", "publish", "\u6295\u7A3F"] }
    ]
  },
  {
    id: "creator-design",
    name: "\u5E73\u9762\u8BBE\u8BA1\u94FE",
    type: "creative",
    userType: "creator",
    requireOutput: false,
    steps: [
      { appPattern: BROWSER, role: "intake", titleKeywords: ["pinterest", "behance", "dribbble", "unsplash", "\u82B1\u74E3", "\u7D20\u6750"] },
      { appPattern: DESIGN, role: "process" },
      { appPattern: BROWSER, role: "output", titleKeywords: ["\u53D1\u5E03", "\u4E0A\u4F20", "upload", "\u5BFC\u51FA"] }
    ]
  },
  {
    id: "creator-writing",
    name: "\u6587\u5B57\u521B\u4F5C\u94FE",
    type: "creative",
    userType: "creator",
    requireOutput: false,
    steps: [
      { appPattern: BROWSER, role: "intake" },
      { appPattern: `${NOTES}|${OFFICE}`, role: "process", minDurationMin: 20 },
      { appPattern: BROWSER, role: "output", titleKeywords: ["\u53D1\u5E03", "\u516C\u4F17\u53F7", "\u77E5\u4E4E", "\u6295\u7A3F", "upload"] }
    ]
  }
];
var ENTREPRENEUR_TEMPLATES = [
  {
    id: "ent-decision",
    name: "\u51B3\u7B56\u6267\u884C\u94FE",
    type: "self_driven",
    userType: "entrepreneur",
    requireOutput: false,
    steps: [
      { appPattern: OFFICE, role: "process" },
      { appPattern: `${NOTES}|${OFFICE}`, role: "process" },
      { appPattern: COMM, role: "output", titleExclude: CHAT_EXCLUDE }
    ]
  },
  {
    id: "ent-multi-project",
    name: "\u591A\u9879\u76EE\u5E76\u884C\u94FE",
    type: "self_driven",
    userType: "entrepreneur",
    requireOutput: false,
    steps: [
      { appPattern: `${IDE}|${OFFICE}|${NOTES}|${DESIGN}|DevTool`, role: "process", minDurationMin: 15 },
      { appPattern: `${IDE}|${OFFICE}|${NOTES}|${DESIGN}|DevTool`, role: "process" },
      { appPattern: COMM, role: "communication", titleExclude: CHAT_EXCLUDE }
    ]
  },
  {
    id: "ent-roadshow",
    name: "\u878D\u8D44/\u8DEF\u6F14\u94FE",
    type: "task_assigned",
    userType: "entrepreneur",
    requireOutput: false,
    steps: [
      { appPattern: OFFICE, role: "process", titleKeywords: ["\u8DEF\u6F14", "BP", "\u878D\u8D44", "\u5546\u4E1A\u8BA1\u5212"] },
      { appPattern: COMM, role: "communication", titleExclude: CHAT_EXCLUDE },
      { appPattern: MEETING, role: "output" }
    ]
  }
];
var SLACK_TITLE_KEYWORDS = ["\u5FAE\u535A", "weibo", "\u6296\u97F3", "douyin", "\u5FEB\u624B", "\u5C0F\u7EA2\u4E66", "\u6DD8\u5B9D", "\u4EAC\u4E1C", "\u5929\u732B", "\u7231\u5947\u827A", "\u817E\u8BAF\u89C6\u9891", "\u4F18\u9177", "\u7EFC\u827A", "\u5A31\u4E50", "\u641E\u7B11", "\u76F4\u64AD"];
var USER_CHAIN_CONFIGS = {
  office_worker: {
    userType: "office_worker",
    templates: OFFICE_WORKER_TEMPLATES,
    primaryDistractions: ["^VideoSite$", "^Video$", "^Music$", "^Game$"],
    conditionalDistractions: [
      { appPattern: BROWSER, condition: "title_contains", slackingKeywords: SLACK_TITLE_KEYWORDS },
      { appPattern: "^(WeChat|QQ)$", condition: "title_contains", slackingKeywords: CHAT_EXCLUDE },
      { appPattern: "^(DingTalk|Feishu)$", condition: "title_contains", slackingKeywords: ["\u95F2\u804A", "\u6478\u9C7C", "\u6C34\u7FA4", "\u516B\u5366"] }
    ]
  },
  exam_candidate: {
    userType: "exam_candidate",
    templates: EXAM_CANDIDATE_TEMPLATES,
    primaryDistractions: ["^Game$", "^Video$", "^Music$", "^(WeChat|QQ)$"],
    conditionalDistractions: [
      { appPattern: "^VideoSite$", condition: "title_contains", slackingKeywords: ["\u641E\u7B11", "\u5A31\u4E50", "\u7EFC\u827A", "\u9B3C\u755C", "\u6E38\u620F", "\u76F4\u64AD"] },
      { appPattern: BROWSER, condition: "title_contains", slackingKeywords: SLACK_TITLE_KEYWORDS }
    ]
  },
  freelancer: {
    userType: "freelancer",
    templates: FREELANCER_TEMPLATES,
    primaryDistractions: ["^Video$", "^VideoSite$", "^Music$", "^Game$"],
    conditionalDistractions: [
      { appPattern: COMM, condition: "title_contains", slackingKeywords: CHAT_EXCLUDE },
      { appPattern: BROWSER, condition: "title_contains", slackingKeywords: SLACK_TITLE_KEYWORDS }
    ]
  },
  student: {
    userType: "student",
    templates: STUDENT_TEMPLATES,
    primaryDistractions: ["^Game$", "^Video$", "^Music$", "^(WeChat|QQ)$"],
    conditionalDistractions: [
      { appPattern: "^VideoSite$", condition: "title_contains", slackingKeywords: ["\u641E\u7B11", "\u7EFC\u827A", "\u5A31\u4E50", "\u9B3C\u755C", "\u6E38\u620F"] },
      { appPattern: BROWSER, condition: "title_contains", slackingKeywords: SLACK_TITLE_KEYWORDS }
    ]
  },
  creator: {
    userType: "creator",
    templates: CREATOR_TEMPLATES,
    primaryDistractions: ["^Game$", "^Video$", "^Music$"],
    conditionalDistractions: [
      { appPattern: "^(WeChat|QQ)$", condition: "title_contains", slackingKeywords: CHAT_EXCLUDE },
      { appPattern: BROWSER, condition: "title_contains", slackingKeywords: SLACK_TITLE_KEYWORDS }
    ]
  },
  entrepreneur: {
    userType: "entrepreneur",
    templates: ENTREPRENEUR_TEMPLATES,
    primaryDistractions: ["^Game$", "^Video$", "^VideoSite$", "^Music$"],
    conditionalDistractions: [
      { appPattern: BROWSER, condition: "title_contains", slackingKeywords: SLACK_TITLE_KEYWORDS },
      { appPattern: COMM, condition: "title_contains", slackingKeywords: CHAT_EXCLUDE }
    ]
  }
};

// src/main/chain/output.ts
var NO_OUTPUT = { type: "none", app: "", ts: 0, confidence: 0 };
function isProductivityApp(appName) {
  return /vscode|visual studio|intellij|rider|cursor|windsurf|trae|office|word|excel|powerpoint|wps|notes|notion|obsidian|typora|design|figma|photoshop|devtool/i.test(
    appName
  );
}
function detectOutput(segments) {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    const app4 = seg.mainApp ?? "";
    const title = seg.mainTitle ?? "";
    if (/^terminal|git/i.test(app4) && /commit|push/i.test(title)) {
      return { type: "code", app: app4, ts: seg.endTs, confidence: 0.95 };
    }
    if (/outlook|foxmail|邮件|mail/i.test(app4) && /发送|send|回复|reply/i.test(title)) {
      return { type: "email", app: app4, ts: seg.endTs, confidence: 0.9 };
    }
    if (/^(WeChat|QQ|DingTalk|Feishu)$|微信|钉钉|飞书|slack|teams/i.test(app4)) {
      if (i > 0 && isProductivityApp(segments[i - 1].mainApp ?? "")) {
        return { type: "message", app: app4, ts: seg.endTs, confidence: 0.7 };
      }
    }
    if (/office|word|excel|powerpoint|wps|notes|notion|obsidian|typora/i.test(app4)) {
      const prevSameApp = segments.slice(0, i).reverse().find((s) => (s.mainApp ?? "") === app4);
      if (prevSameApp && (prevSameApp.mainTitle ?? "") !== title && title !== "") {
        return { type: "document", app: app4, ts: seg.endTs, confidence: 0.6 };
      }
    }
    if (/上传|提交|upload|submit/i.test(title)) {
      return { type: "file_upload", app: app4, ts: seg.endTs, confidence: 0.85 };
    }
  }
  return { ...NO_OUTPUT };
}

// src/main/chain/matcher.ts
function stepMatches(step, seg) {
  const app4 = seg.mainApp ?? "";
  const title = (seg.mainTitle ?? "").toLowerCase();
  if (!new RegExp(step.appPattern, "i").test(app4)) return false;
  if (step.titleKeywords && !step.titleKeywords.some((kw) => title.includes(kw.toLowerCase()))) return false;
  if (step.titleExclude && step.titleExclude.some((ex) => title.includes(ex.toLowerCase()))) return false;
  if (step.minDurationMin && seg.durationMin < step.minDurationMin) return false;
  return true;
}
function matchChain(segments, template) {
  let stepIndex = 0;
  const matchedSegs = [];
  const matchedStepTpls = [];
  for (const seg of segments) {
    const step = template.steps[stepIndex];
    if (!step) break;
    if (stepMatches(step, seg)) {
      matchedSegs.push(seg);
      matchedStepTpls.push(step);
      stepIndex++;
    }
  }
  const matchRatio = matchedSegs.length / template.steps.length;
  if (matchRatio < 0.6) return null;
  if (new Set(matchedSegs.map((s) => s.mainApp)).size < 2) return null;
  const outputSignal = detectOutput(matchedSegs);
  const hasOutput = outputSignal.type !== "none";
  const titleHits = matchedStepTpls.filter((s) => s.titleKeywords && s.titleKeywords.length > 0).length;
  let confidence = matchRatio * 0.4 + titleHits / template.steps.length * 0.3 + (hasOutput ? 0.3 : 0);
  if (template.requireOutput && !hasOutput) confidence *= 0.6;
  const steps = matchedSegs.map((seg, i) => ({
    segmentId: seg.id ?? `s${seg.startTs}`,
    app: seg.mainApp ?? "",
    role: matchedStepTpls[i].role,
    durationMin: seg.durationMin,
    title: seg.mainTitle ?? "",
    startTs: seg.startTs,
    endTs: seg.endTs
  }));
  return { template, steps, segments: matchedSegs, matchRatio, confidence, hasOutput, outputSignal };
}

// src/main/chain/engine.ts
var CLUSTER_GAP_MS = 30 * 60 * 1e3;
var MICRO_SWITCH_MIN = 3;
var TODAY_CACHE_TTL_MS = 5 * 60 * 1e3;
var todayCache = /* @__PURE__ */ new Map();
function splitClusters(segments) {
  const clusters = [];
  let cur = [];
  for (const seg of segments) {
    const prev = cur[cur.length - 1];
    if (prev && seg.startTs - prev.endTs > CLUSTER_GAP_MS) {
      clusters.push(cur);
      cur = [];
    }
    cur.push(seg);
  }
  if (cur.length) clusters.push(cur);
  return clusters;
}
function bestMatch(cluster, config) {
  let best = null;
  for (const tpl of config.templates) {
    const m = matchChain(cluster, tpl);
    if (m && m.confidence >= 0.3 && (!best || m.confidence > best.confidence)) best = m;
  }
  return best;
}
function toWorkChain(m, date, userType) {
  const startTs = m.steps[0].startTs;
  const endTs = m.steps[m.steps.length - 1].endTs;
  const totalMin = (endTs - startTs) / 6e4;
  const productiveMin = m.steps.reduce((a, s) => a + s.durationMin, 0);
  let switchCount = 0;
  for (let i = 1; i < m.steps.length; i++) if (m.steps[i].app !== m.steps[i - 1].app) switchCount++;
  return {
    id: genId("chain"),
    userType,
    date,
    type: m.template.type,
    templateId: m.template.id,
    templateName: m.template.name,
    status: m.confidence > 0.6 ? m.hasOutput ? "completed" : "active" : "tentative",
    steps: m.steps,
    startTs,
    endTs,
    totalMin,
    productiveMin,
    switchCount,
    hasOutput: m.hasOutput,
    outputType: m.outputSignal.type,
    switchEfficiency: totalMin > 0 ? productiveMin / totalMin : 1,
    confidence: m.confidence
  };
}
function isDistractionCandidate(seg, config) {
  const app4 = seg.mainApp ?? "";
  const title = seg.mainTitle ?? "";
  if (config.primaryDistractions.some((p) => new RegExp(p, "i").test(app4))) return true;
  for (const cd of config.conditionalDistractions) {
    if (!new RegExp(cd.appPattern, "i").test(app4)) continue;
    if (cd.condition === "in_chain") return true;
    if (cd.condition === "title_contains") {
      const t = title.toLowerCase();
      if ((cd.slackingKeywords ?? []).some((kw) => t.includes(kw.toLowerCase()))) return true;
    }
  }
  return parseWindowTitle(app4, title).isSlacking;
}
function labelUnchained(seg, config) {
  if (!isDistractionCandidate(seg, config)) return "neutral";
  if (seg.durationMin <= MICRO_SWITCH_MIN) return "neutral";
  if (detectOutput([seg]).type !== "none") return "neutral";
  return "distracted";
}
function aggregateMetrics(chains, labels, segMin) {
  const withOutput = chains.filter((c) => c.hasOutput).length;
  const totalMin = chains.reduce((a, c) => a + c.totalMin, 0);
  const productiveMin = chains.reduce((a, c) => a + c.productiveMin, 0);
  let distractedMin = 0;
  let neutralMin = 0;
  for (const l of labels) {
    if (l.label === "productive") continue;
    const m = segMin.get(l.segmentId) ?? 0;
    if (l.label === "distracted") distractedMin += m;
    else neutralMin += m;
  }
  return {
    chainCount: chains.length,
    chainOutputRate: chains.length > 0 ? withOutput / chains.length : 0,
    avgChainMin: chains.length > 0 ? totalMin / chains.length : 0,
    switchEfficiency: totalMin > 0 ? productiveMin / totalMin : 0,
    chainDiversity: new Set(chains.map((c) => c.type)).size,
    distractedMin,
    neutralMin
  };
}
function analyzeTrailSegments(date, userType, segments) {
  const config = USER_CHAIN_CONFIGS[userType];
  const chains = [];
  const labels = [];
  const segMin = /* @__PURE__ */ new Map();
  const chainedSegIds = /* @__PURE__ */ new Set();
  for (const cluster of splitClusters(segments)) {
    const m = bestMatch(cluster, config);
    if (!m) continue;
    const chain = toWorkChain(m, date, userType);
    chains.push(chain);
    for (const step of chain.steps) {
      chainedSegIds.add(step.segmentId);
      labels.push({ segmentId: step.segmentId, chainId: chain.id, chainRole: step.role, label: "productive" });
    }
  }
  for (const seg of segments) {
    const segId = seg.id ?? `s${seg.startTs}`;
    segMin.set(segId, seg.durationMin);
    if (chainedSegIds.has(segId)) continue;
    labels.push({ segmentId: segId, chainId: null, label: labelUnchained(seg, config) });
  }
  chains.sort((a, b) => a.startTs - b.startTs);
  return { date, userType, chains, labels, metrics: aggregateMetrics(chains, labels, segMin), ts: Date.now() };
}
function computeDayChains(date) {
  const trail = buildMergedTrail(listActivities(date), date);
  const segments = trail.segments.filter((s) => !s.glance && s.mainApp);
  return analyzeTrailSegments(date, effectiveUserType(), segments);
}
function analyzeDayChains(date) {
  const today = dateKey(Date.now());
  if (date === today) {
    const c = todayCache.get(date);
    if (c && Date.now() - c.ts < TODAY_CACHE_TTL_MS) return c.report;
  } else {
    const stored = col("chains").find((r) => r.date === date);
    if (stored) return stored;
  }
  const report = computeDayChains(date);
  if (report.labels.length > 0) {
    const arr = col("chains");
    const idx = arr.findIndex((r) => r.date === date);
    if (idx >= 0) arr.splice(idx, 1);
    insertInto("chains", report);
  }
  if (date === today) todayCache.set(date, { ts: Date.now(), report });
  return report;
}

// scripts/smoke-chain.ts
var fmtDate = (d) => `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
var hhmm = (ts) => {
  const d = new Date(ts);
  return `${`${d.getHours()}`.padStart(2, "0")}:${`${d.getMinutes()}`.padStart(2, "0")}`;
};
function printReport(r) {
  const m = r.metrics;
  console.log(`=== ${r.date} userType=${r.userType} | \u94FE\u8DEF\u6570 ${m.chainCount} | distracted ${Math.round(m.distractedMin)}min | neutral ${Math.round(m.neutralMin)}min`);
  for (const c of r.chains) {
    console.log(
      `  [${c.type}/${c.templateName}] ${hhmm(c.startTs)}-${hhmm(c.endTs)} ${Math.round(c.totalMin)}m conf=${c.confidence.toFixed(2)} status=${c.status} output=${c.hasOutput ? c.outputType : "none"} switchEff=${(c.switchEfficiency * 100).toFixed(0)}%`
    );
    console.log(`    steps: ${c.steps.map((s) => `${s.app}(${s.role})`).join(" \u2192 ")}`);
  }
  console.log(
    `  metrics: chainCount=${m.chainCount} outputRate=${m.chainOutputRate.toFixed(2)} avgChainMin=${m.avgChainMin.toFixed(0)} switchEff=${m.switchEfficiency.toFixed(2)} diversity=${m.chainDiversity} distractedMin=${m.distractedMin.toFixed(1)} neutralMin=${m.neutralMin.toFixed(1)}`
  );
}
function main() {
  initDb();
  const dates = process.argv[2] ? [process.argv[2]] : [fmtDate(/* @__PURE__ */ new Date()), fmtDate(new Date(Date.now() - 864e5))];
  for (const d of dates) printReport(analyzeDayChains(d));
  const day = /* @__PURE__ */ new Date();
  const at = (h, m) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
  const seg = (app4, title, start, min) => ({
    id: `syn${start}`,
    startTs: start,
    endTs: start + min * 6e4,
    durationMin: min,
    mainState: "focus",
    auxState: null,
    mainApp: app4,
    auxApp: null,
    mainTitle: title,
    screens: [0]
  });
  const syn = [
    seg("WeChat", "\u738B\u603B", at(9, 15), 12),
    // 领导派单 intake
    seg("Office", "Q3\u6570\u636E\u6C47\u603B.xlsx - Excel", at(9, 28), 40),
    // 处理
    seg("Cursor", "analyze.py \u2014 Cursor", at(10, 10), 15),
    // AI 辅助
    seg("Office", "Q3\u6570\u636E\u6C47\u603Bv2.xlsx - Excel", at(10, 27), 18),
    // 汇总（标题变化→产出信号）
    seg("WeChat", "\u738B\u603B", at(10, 47), 8),
    // 交付
    seg("Browser", "\u6296\u97F3 - Microsoft Edge", at(11, 30), 25),
    // 链路外分心
    seg("Video", "PotPlayer", at(12, 10), 2)
    // 微切换 <3min → neutral
  ];
  console.log("=== synthetic office_worker \u573A\u666F ===");
  printReport(analyzeTrailSegments(fmtDate(day), "office_worker", syn));
}
main();
