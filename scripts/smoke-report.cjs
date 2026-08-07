var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
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

// src/shared/stateMeta.ts
function identifyApp(exe, title) {
  const key = exe.toLowerCase();
  for (const rule of APP_RULES) {
    if (rule.match.test(key)) {
      let appName = rule.name;
      if (rule.name === "Terminal") {
        const pathMatch = title.match(/([A-Za-z]:[\\/][^\s"']+)|((?:~|\/)[^\s"']+)/);
        if (pathMatch) {
          const folder = pathMatch[0].replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop();
          if (folder && folder.length > 0 && folder.length <= 30 && !/^[A-Za-z]:$/.test(folder)) {
            appName = `Terminal \xB7 ${folder}`;
          }
        }
      }
      if (rule.titleState) {
        for (const ts of rule.titleState) {
          if (ts.match.test(title)) return { appName, state: ts.state };
        }
      }
      return { appName, state: rule.state };
    }
  }
  if (/开发|代码|编程|调试|bug|jira|需求|review|deploy|debug|coding|commit|merge|branch/i.test(title)) {
    return { appName: exe.replace(/\.exe$/i, ""), state: "coding" };
  }
  return { appName: exe.replace(/\.exe$/i, ""), state: "focus" };
}
var WORK_STATES, STATE_LABEL, ALL_STATES, WORK_LIKE_STATES, RELAX_STATES, INPUT_REQUIRED_STATES, APP_RULES;
var init_stateMeta = __esm({
  "src/shared/stateMeta.ts"() {
    WORK_STATES = {
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
    STATE_LABEL = Object.fromEntries(
      Object.entries(WORK_STATES).map(([k, v]) => [k, v.label])
    );
    ALL_STATES = Object.keys(WORK_STATES);
    WORK_LIKE_STATES = ["focus", "coding", "aidev", "aiqa", "writing", "meeting", "remote"];
    RELAX_STATES = ["relax", "slack", "break", "lunch"];
    INPUT_REQUIRED_STATES = ["focus", "coding", "aidev", "aiqa", "writing"];
    APP_RULES = [
      {
        match: /^(code|code - insiders)\.exe$/,
        name: "VSCode",
        state: "coding",
        titleState: [
          { match: /copilot|chatgpt|claude|通义|文心|kim/i, state: "aidev" },
          { match: /\.md\b|readme/i, state: "writing" }
        ]
      },
      { match: /^(devenv)\.exe$/i, name: "Visual Studio", state: "coding" },
      { match: /^(rider64)\.exe$/i, name: "Rider", state: "coding" },
      {
        match: /^(idea64|webstorm64|goland64|pycharm64|clion64|rubymine|phpstorm|studio)\.exe$/i,
        name: "IntelliJ",
        state: "coding",
        titleState: [
          { match: /debug|调试/i, state: "coding" },
          { match: /terminal|console/i, state: "coding" }
        ]
      },
      {
        match: /^cursor\.exe$/i,
        name: "Cursor",
        state: "aidev",
        titleState: [
          { match: /chat|composer/i, state: "aiqa" },
          { match: /\.md\b|readme/i, state: "writing" }
        ]
      },
      { match: /^(windsurf)\.exe$/i, name: "Windsurf", state: "aidev" },
      { match: /^(trae)\.exe$/i, name: "Trae", state: "aidev" },
      {
        match: /^chrome\.exe$/,
        name: "Chrome",
        state: "focus",
        titleState: [
          { match: /bilibili|youtube|抖音|douyin|腾讯视频|iqiyi|爱奇艺|netflix/i, state: "relax" },
          { match: /weibo|微博|知乎|zhihu|贴吧|x\.com|twitter|reddit/i, state: "slack" },
          { match: /chatgpt|claude|gemini|copilot|kimi|通义|文心|豆包/i, state: "aiqa" },
          { match: /docs\.google|notion|飞书|语雀|confluence/i, state: "writing" },
          { match: /meet\.google|zoom\.us|teams\.microsoft/i, state: "meeting" },
          // 堡垒机/远程运维/金融终端/OA 系统 → 工作
          { match: /堡垒机|bastionhost|bastion|rdp|mstsc|远程桌面|citrix|vmware|horizon|ssh|xshell|vpn|ssl vpn|金证|恒生|同花顺|东方财富|wind|choice|oa系统|oa 系统|pansoft|泛微|致远/i, state: "focus" },
          // 开发类网页 → 编程
          { match: /github|gitlab|gitee|stackoverflow|掘金|juejin|csdn|npmjs|pypi|maven|dockerhub|k8s|jenkins|jira|confluence|postman|swagger|apifox/i, state: "coding" }
        ]
      },
      {
        match: /^(msedge|firefox|opera|brave|arc)\.exe$/i,
        name: "Browser",
        state: "focus",
        titleState: [
          { match: /bilibili|youtube|抖音|腾讯视频|爱奇艺|netflix/i, state: "relax" },
          { match: /weibo|微博|知乎|贴吧|twitter|reddit/i, state: "slack" },
          { match: /chatgpt|claude|kimi|copilot/i, state: "aiqa" },
          { match: /堡垒机|bastionhost|bastion|rdp|mstsc|远程桌面|citrix|vmware|horizon|ssh|vpn|ssl vpn|金证|恒生|同花顺|东方财富|wind|choice|oa系统|oa 系统|pansoft|泛微|致远/i, state: "focus" },
          { match: /github|gitlab|gitee|stackoverflow|掘金|juejin|csdn|npmjs|pypi|jenkins|jira|postman|swagger|apifox/i, state: "coding" }
        ]
      },
      { match: /^(wechat|weixin)\.exe$/i, name: "WeChat", state: "slack", titleState: [{ match: /会议|meeting/i, state: "meeting" }] },
      { match: /^(qq|tim)\.exe$/i, name: "QQ", state: "slack" },
      { match: /^(dingtalk|钉钉)\.exe$/i, name: "DingTalk", state: "remote" },
      { match: /^(feishu|lark)\.exe$/i, name: "Feishu", state: "remote", titleState: [{ match: /会议|meeting|视频/i, state: "meeting" }] },
      { match: /^(teams|zoom|腾讯会议|wemeet|voov meeting)\.exe$/i, name: "Meeting", state: "meeting" },
      { match: /^(winword|excel|powerpnt|wps|et|wpp)\.exe$/i, name: "Office", state: "writing" },
      { match: /^(notion|obsidian|typora|siyuan|yuque)\.exe$/i, name: "Notes", state: "writing" },
      { match: /^(cloudmusic|qqmusic|spotify|foobar2000|netease)\.exe$/i, name: "Music", state: "relax" },
      { match: /^(potplayer|vlc|mpv|iina|kmplayer|thunderplayer)\.exe$/i, name: "Video", state: "relax" },
      { match: /^(bilibili|acfun|youku|qiyvideo|tencentvideo)\.exe$/i, name: "VideoSite", state: "relax" },
      { match: /^(steam|epicgameslauncher|origin|uplay|leagueclient|genshinimpact|hoyoplay)/i, name: "Game", state: "slack" },
      {
        match: /^(terminal|windowsterminal|wt|cmd|powershell|pwsh|bash|mingw64|alacritty|wezterm)\.exe$/i,
        name: "Terminal",
        state: "coding",
        titleState: [
          // CLI AI 工具 → AI 开发
          { match: /opencode|claude[ -]?code|codex|aider|cursor-agent|kimi|copilot-cli/i, state: "aidev" },
          // 开发命令 → 编程
          { match: /npm|pnpm|yarn|bun|deno|node|python|pip|poetry|docker|kubectl|helm|git|cargo|mvn|gradle|go\s|make|cmake|pytest|jest|vitest|webpack|vite/i, state: "coding" },
          // 远程连接 → 远程协作
          { match: /ssh |mstsc|rdp |telnet /i, state: "remote" }
        ]
      },
      { match: /^(postman|apifox|insomnia|fiddler|charles|wireshark|navicat|datagrip|dbeaver|tableplus|redis|mongodb)/i, name: "DevTool", state: "coding" },
      { match: /^(filezilla|winscp|mobaxterm|xshell|securecrt|putty|kitty|windterm)/i, name: "Transfer/SSH", state: "coding" },
      { match: /^(everything|listary|utools|wox|powerlauncher)/i, name: "Launcher", state: "focus" },
      { match: /^(obs64|obs|bandicam|camtasia|screenflow)/i, name: "Recorder", state: "focus" },
      { match: /^(jmeter|apipost|loadrunner|k6)/i, name: "PerfTest", state: "coding" },
      { match: /^(figma|sketch|photoshop|illustrator|blender|ae|pr|canva)\.exe$/i, name: "Design", state: "focus" },
      { match: /^(explorer)\.exe$/i, name: "Explorer", state: "idle" },
      { match: /^(workon)\.exe$/i, name: "WorkOn", state: "idle" }
    ];
  }
});

// src/shared/trail.ts
var trail_exports = {};
__export(trail_exports, {
  buildMergedTrail: () => buildMergedTrail,
  dateKey: () => dateKey
});
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
var SEG_GAP_MS, SEG_CAP_MS;
var init_trail = __esm({
  "src/shared/trail.ts"() {
    init_stateMeta();
    SEG_GAP_MS = 60 * 1e3;
    SEG_CAP_MS = 60 * 60 * 1e3;
  }
});

// src/shared/types.ts
function genId(prefix = "id") {
  idSeq = (idSeq + 1) % 1e4;
  return `${prefix}_${Date.now().toString(36)}_${idSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
var DEFAULT_SETTINGS, idSeq;
var init_types = __esm({
  "src/shared/types.ts"() {
    DEFAULT_SETTINGS = {
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
    idSeq = 0;
  }
});

// src/main/settings.ts
function getSettings() {
  return current;
}
var import_electron, current;
var init_settings = __esm({
  "src/main/settings.ts"() {
    import_electron = __toESM(require_electron_stub());
    init_types();
    current = { ...DEFAULT_SETTINGS };
  }
});

// src/main/windows.ts
function sendTo(page, channel, ...args) {
  const win = page === "main" ? mainWindow : page === "widget" ? widgetWindow : petWindow;
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}
var import_electron2, mainWindow, widgetWindow, petWindow, isDev;
var init_windows = __esm({
  "src/main/windows.ts"() {
    import_electron2 = __toESM(require_electron_stub());
    init_settings();
    mainWindow = null;
    widgetWindow = null;
    petWindow = null;
    isDev = !!process.env.ELECTRON_RENDERER_URL;
  }
});

// src/main/db.ts
var db_exports = {};
__export(db_exports, {
  col: () => col,
  deleteActivitiesByApp: () => deleteActivitiesByApp,
  flushNow: () => flushNow,
  initDb: () => initDb,
  insertActivity: () => insertActivity,
  insertInto: () => insertInto,
  listActivities: () => listActivities,
  listActivitiesRange: () => listActivitiesRange,
  removeFrom: () => removeFrom,
  updateIn: () => updateIn
});
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
function insertActivity(r) {
  const rec = { ...r, id: actIdSeq++ };
  activities.push(rec);
  try {
    import_fs.default.appendFileSync(actFile, JSON.stringify(rec) + "\n", "utf-8");
  } catch (e) {
    console.warn("[db] \u6D3B\u52A8\u8FFD\u52A0\u5931\u8D25", e);
    sendTo("main", "error-banner", `\u6D3B\u52A8\u8BB0\u5F55\u5199\u5165\u5931\u8D25\uFF1A${e.message}\uFF08\u8BF7\u68C0\u67E5\u78C1\u76D8\u7A7A\u95F4\uFF09`);
  }
  return rec;
}
function listActivities(date) {
  return activities.filter((r) => dateKey(r.ts) === date);
}
function listActivitiesRange(fromTs, toTs) {
  return activities.filter((r) => r.ts >= fromTs && r.ts <= toTs);
}
function deleteActivitiesByApp(appName) {
  const before = activities.length;
  activities = activities.filter((r) => (r.appName ?? r.app) !== appName);
  const removed = before - activities.length;
  if (removed > 0) {
    try {
      import_fs.default.writeFileSync(actFile, activities.map((r) => JSON.stringify(r)).join("\n") + (activities.length ? "\n" : ""), "utf-8");
    } catch (e) {
      console.warn("[db] \u6E05\u7406\u5E94\u7528\u8BB0\u5F55\u91CD\u5199\u5931\u8D25", e);
    }
  }
  return removed;
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
function updateIn(name, id, patch) {
  const arr = data[name];
  const idx = arr.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  arr[idx] = { ...arr[idx], ...patch };
  scheduleFlush();
  return arr[idx];
}
function removeFrom(name, id) {
  const arr = data[name];
  const idx = arr.findIndex((i) => i.id === id);
  if (idx < 0) return false;
  arr.splice(idx, 1);
  scheduleFlush();
  return true;
}
var import_electron3, import_fs, import_path, EMPTY, dir, jsonFile, actFile, data, activities, actIdSeq, flushTimer, actDirty;
var init_db = __esm({
  "src/main/db.ts"() {
    import_electron3 = __toESM(require_electron_stub());
    import_fs = __toESM(require("fs"));
    import_path = __toESM(require("path"));
    init_trail();
    init_settings();
    init_windows();
    EMPTY = {
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
      ocrSnapshots: []
    };
    dir = "";
    jsonFile = "";
    actFile = "";
    data = { ...EMPTY };
    activities = [];
    actIdSeq = 1;
    flushTimer = null;
    actDirty = false;
  }
});

// scripts/smoke-report.ts
init_db();

// src/main/report/engine.ts
init_types();
init_trail();

// src/shared/industryVocab.ts
var INDUSTRY_VOCABS = {
  it: {
    industryCode: "it",
    industryName: "IT/\u4E92\u8054\u7F51",
    stateMappings: {
      meeting: [
        { label: "\u9700\u6C42\u8BC4\u5BA1", keywords: ["\u9700\u6C42", "\u8BC4\u5BA1", "PRD"] },
        { label: "\u6280\u672F\u65B9\u6848\u8BA8\u8BBA", keywords: ["\u65B9\u6848", "\u67B6\u6784", "\u8BBE\u8BA1"] },
        { label: "\u7AD9\u4F1A", keywords: ["\u7AD9\u4F1A", "standup", "daily"] },
        { label: "\u4EE3\u7801\u8BC4\u5BA1", keywords: ["code review", "CR", "\u4EE3\u7801"] }
      ],
      writing: [
        { label: "\u6280\u672F\u6587\u6863", keywords: ["\u6587\u6863", "README", "\u8BBE\u8BA1\u7A3F"] },
        { label: "\u9700\u6C42\u6587\u6863", keywords: ["PRD", "\u9700\u6C42", "\u89C4\u683C"] }
      ],
      coding: [
        { label: "\u529F\u80FD\u5F00\u53D1", keywords: ["feature", "\u529F\u80FD", "\u5B9E\u73B0"] },
        { label: "Bug\u4FEE\u590D", keywords: ["bug", "fix", "\u4FEE\u590D"] },
        { label: "\u91CD\u6784\u4F18\u5316", keywords: ["refactor", "\u91CD\u6784", "\u4F18\u5316"] }
      ],
      remote: [
        { label: "\u670D\u52A1\u5668\u90E8\u7F72", keywords: ["deploy", "\u90E8\u7F72", "publish"] },
        { label: "\u73AF\u5883\u914D\u7F6E", keywords: ["config", "\u914D\u7F6E", "docker"] },
        { label: "\u6570\u636E\u5E93\u64CD\u4F5C", keywords: ["mysql", "redis", "sql"] }
      ]
    },
    keywords: {
      subjectPatterns: ["\u4EA7\u54C1", "\u6D4B\u8BD5", "\u8BBE\u8BA1", "\u8FD0\u7EF4", "\u540E\u7AEF", "\u524D\u7AEF", "PM"],
      projectPatterns: ["\u9879\u76EE", "\u6A21\u5757", "\u7CFB\u7EDF", "\u5E73\u53F0", "\u670D\u52A1"],
      locationPatterns: ["\u670D\u52A1\u5668", "\u96C6\u7FA4", "\u5BB9\u5668", "\u4E91", "Git"],
      outputPatterns: ["\u4EE3\u7801", "\u6587\u6863", "\u914D\u7F6E", "\u811A\u672C", "\u63A5\u53E3"]
    },
    appMappings: {
      Cursor: { state: "aidev", contentTag: "AI\u8F85\u52A9\u5F00\u53D1", outputType: "code" },
      Docker: { state: "remote", contentTag: "\u5BB9\u5668\u7BA1\u7406", outputType: "config" },
      Postman: { state: "coding", contentTag: "\u63A5\u53E3\u6D4B\u8BD5", outputType: "other" }
    }
  },
  legal: {
    industryCode: "legal",
    industryName: "\u6CD5\u5F8B",
    stateMappings: {
      meeting: [
        { label: "\u5BA2\u6237\u54A8\u8BE2", keywords: ["\u54A8\u8BE2", "\u9762\u8C08", "\u63A5\u5F85"] },
        { label: "\u5EAD\u5BA1", keywords: ["\u5EAD\u5BA1", "\u5F00\u5EAD", "\u5BA1\u7406"] },
        { label: "\u8C03\u89E3", keywords: ["\u8C03\u89E3", "\u548C\u89E3"] }
      ],
      writing: [
        { label: "\u5408\u540C\u8D77\u8349", keywords: ["\u5408\u540C", "\u534F\u8BAE", "\u8D77\u8349"] },
        { label: "\u6CD5\u5F8B\u610F\u89C1\u4E66", keywords: ["\u610F\u89C1\u4E66", "\u6CD5\u5F8B\u610F\u89C1"] },
        { label: "\u8D77\u8BC9\u72B6", keywords: ["\u8D77\u8BC9", "\u8BC9\u72B6"] }
      ],
      coding: [],
      remote: []
    },
    keywords: {
      subjectPatterns: ["\u5F53\u4E8B\u4EBA", "\u59D4\u6258\u4EBA", "\u5BA2\u6237", "\u539F\u544A", "\u88AB\u544A"],
      projectPatterns: ["\u6848\u4EF6", "\u9879\u76EE", "\u7EA0\u7EB7", "\u4E8B\u52A1"],
      locationPatterns: ["\u6CD5\u9662", "\u4EF2\u88C1\u59D4", "\u516C\u8BC1\u5904", "Alpha\u7CFB\u7EDF"],
      outputPatterns: ["\u5408\u540C", "\u610F\u89C1\u4E66", "\u8D77\u8BC9\u72B6", "\u7B54\u8FA9\u72B6", "\u5907\u5FD8\u5F55"]
    },
    appMappings: {
      Alpha: { state: "writing", contentTag: "\u6848\u4EF6\u7BA1\u7406", outputType: "document" },
      \u65E0\u8BBC: { state: "writing", contentTag: "\u6CD5\u5F8B\u68C0\u7D22", outputType: "document" }
    }
  },
  sales: {
    industryCode: "sales",
    industryName: "\u9500\u552E/\u5546\u52A1",
    stateMappings: {
      meeting: [
        { label: "\u5BA2\u6237\u62DC\u8BBF", keywords: ["\u62DC\u8BBF", "\u9762\u8BBF", "\u4E0A\u95E8"] },
        { label: "\u5546\u52A1\u8C08\u5224", keywords: ["\u8C08\u5224", "\u62A5\u4EF7", "\u5408\u540C"] },
        { label: "\u4EA7\u54C1\u6F14\u793A", keywords: ["\u6F14\u793A", "demo", "\u5C55\u793A"] }
      ],
      writing: [
        { label: "\u65B9\u6848\u64B0\u5199", keywords: ["\u65B9\u6848", "proposal", "\u6807\u4E66"] },
        { label: "\u62A5\u4EF7\u5355", keywords: ["\u62A5\u4EF7", "quotation", "\u4EF7\u683C"] }
      ],
      coding: [],
      remote: []
    },
    keywords: {
      subjectPatterns: ["\u5BA2\u6237", "\u7532\u65B9", "prospects", "lead"],
      projectPatterns: ["\u9879\u76EE", "\u5546\u673A", "\u8BA2\u5355", "\u5408\u540C"],
      locationPatterns: ["CRM", "ERP", "\u5BA2\u6237\u7CFB\u7EDF"],
      outputPatterns: ["\u65B9\u6848", "\u62A5\u4EF7\u5355", "\u5408\u540C", "PPT", "\u90AE\u4EF6"]
    },
    appMappings: {
      Salesforce: { state: "writing", contentTag: "CRM\u7BA1\u7406", outputType: "data" },
      \u9489\u9489: { state: "meeting", contentTag: "\u5BA2\u6237\u6C9F\u901A", outputType: "communication" }
    }
  },
  education: {
    industryCode: "education",
    industryName: "\u6559\u80B2",
    stateMappings: {
      meeting: [
        { label: "\u5907\u8BFE\u8BA8\u8BBA", keywords: ["\u5907\u8BFE", "\u6559\u7814", "\u8BA8\u8BBA"] },
        { label: "\u5BB6\u957F\u6C9F\u901A", keywords: ["\u5BB6\u957F", "\u6C9F\u901A"] },
        { label: "\u5B66\u672F\u4F1A\u8BAE", keywords: ["\u5B66\u672F", "\u7814\u8BA8", "\u8BBA\u575B"] }
      ],
      writing: [
        { label: "\u6559\u6848\u64B0\u5199", keywords: ["\u6559\u6848", "\u8BFE\u4EF6", "PPT"] },
        { label: "\u8BD5\u5377\u7F16\u5199", keywords: ["\u8BD5\u5377", "\u9898\u76EE", "\u51FA\u9898"] },
        { label: "\u8BBA\u6587\u5199\u4F5C", keywords: ["\u8BBA\u6587", "paper", "\u671F\u520A"] }
      ],
      coding: [],
      remote: []
    },
    keywords: {
      subjectPatterns: ["\u5B66\u751F", "\u5BB6\u957F", "\u540C\u4E8B", "\u5BFC\u5E08", "\u8BC4\u59D4"],
      projectPatterns: ["\u8BFE\u7A0B", "\u8BFE\u9898", "\u9879\u76EE", "\u73ED\u7EA7"],
      locationPatterns: ["\u6559\u52A1\u7CFB\u7EDF", "\u5B9E\u9A8C\u5BA4", "\u56FE\u4E66\u9986", "LMS"],
      outputPatterns: ["\u6559\u6848", "\u8BFE\u4EF6", "\u8BD5\u5377", "\u8BBA\u6587", "\u62A5\u544A"]
    },
    appMappings: {}
  },
  finance: {
    industryCode: "finance",
    industryName: "\u8D22\u52A1/\u91D1\u878D",
    stateMappings: {
      meeting: [
        { label: "\u5BA1\u8BA1\u4F1A\u8BAE", keywords: ["\u5BA1\u8BA1", "\u6838\u7B97", "\u76D8\u70B9"] },
        { label: "\u8D22\u62A5\u5206\u6790", keywords: ["\u8D22\u62A5", "\u5206\u6790", "\u9884\u7B97"] }
      ],
      writing: [
        { label: "\u62A5\u8868\u7F16\u5236", keywords: ["\u62A5\u8868", "\u53F0\u8D26", "\u51ED\u8BC1"] },
        { label: "\u9884\u7B97\u7F16\u5236", keywords: ["\u9884\u7B97", "forecast", "\u9884\u6D4B"] }
      ],
      coding: [],
      remote: []
    },
    keywords: {
      subjectPatterns: ["\u5BA2\u6237", "\u5BA1\u8BA1\u5BF9\u8C61", "\u90E8\u95E8", "\u5B50\u516C\u53F8"],
      projectPatterns: ["\u9879\u76EE", "\u5BA1\u8BA1", "\u62A5\u8868", "\u9884\u7B97"],
      locationPatterns: ["\u91D1\u8776", "\u7528\u53CB", "SAP", "\u94F6\u884C\u7CFB\u7EDF"],
      outputPatterns: ["\u62A5\u8868", "\u51ED\u8BC1", "\u62A5\u544A", "\u5E95\u7A3F", "\u53F0\u8D26"]
    },
    appMappings: {}
  }
};
var USER_TYPE_INDUSTRY = {
  office_worker: "it",
  freelancer: "it",
  entrepreneur: "sales",
  creator: "education",
  student: "education",
  exam_candidate: "education"
};
function detectIndustry(userType, topApps) {
  const hits = {};
  for (const [code, vocab] of Object.entries(INDUSTRY_VOCABS)) {
    const appNames = Object.keys(vocab.appMappings);
    if (appNames.length === 0) continue;
    hits[code] = topApps.filter((app5) => appNames.some((name) => app5.toLowerCase().includes(name.toLowerCase()))).length;
  }
  const best = Object.entries(hits).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] > 0) return INDUSTRY_VOCABS[best[0]];
  const fallback = userType && USER_TYPE_INDUSTRY[userType] || "it";
  return INDUSTRY_VOCABS[fallback];
}

// src/main/report/engine.ts
init_db();
init_settings();

// src/shared/attention.ts
init_stateMeta();
var USER_TYPE_META = {
  office_worker: {
    label: "\u529E\u516C\u65CF",
    emoji: "\u{1F4BC}",
    desc: "9-6 \u5236\u5F0F\u5DE5\u4F5C\uFF0C\u4F1A\u8BAE\u7A7F\u63D2\uFF1B\u76EE\u6807\u662F\u9AD8\u6548\u5B8C\u6210\u5F53\u65E5\u4EFB\u52A1\u3001\u51C6\u65F6\u4E0B\u73ED",
    weights: { depth: 0.15, sustain: 0.3, resist: 0.2, rhythm: 0.2, recover: 0.15 },
    targetWorkMin: 420,
    targetPomodoros: 12
  },
  exam_candidate: {
    label: "\u8003\u7814\u515A",
    emoji: "\u{1F4D6}",
    desc: "\u81EA\u6211\u9A71\u52A8\u578B\u9AD8\u538B\u5B66\u4E60\uFF0C\u6709\u660E\u786E\u622A\u6B62\u65E5\u671F\uFF1B\u76EE\u6807\u662F\u5728\u6709\u9650\u65F6\u95F4\u5185\u6700\u5927\u5316\u77E5\u8BC6\u5438\u6536",
    weights: { depth: 0.35, sustain: 0.2, resist: 0.25, rhythm: 0.1, recover: 0.1 },
    targetWorkMin: 480,
    targetPomodoros: 16
  },
  freelancer: {
    label: "\u81EA\u7531\u804C\u4E1A",
    emoji: "\u{1F54A}",
    desc: "\u5F39\u6027\u65F6\u95F4\u3001\u9879\u76EE\u9A71\u52A8\uFF1B\u76EE\u6807\u662F\u6309\u671F\u4EA4\u4ED8\u5E76\u4FDD\u6301\u5DE5\u4F5C\u751F\u6D3B\u5E73\u8861",
    weights: { depth: 0.2, sustain: 0.25, resist: 0.15, rhythm: 0.25, recover: 0.15 },
    targetWorkMin: 360,
    targetPomodoros: 10
  },
  student: {
    label: "\u5B66\u751F\u515A",
    emoji: "\u{1F392}",
    desc: "\u8BFE\u8868\u7EA6\u675F\u52A0\u8BFE\u4F59\u81EA\u4E60\uFF1B\u76EE\u6807\u662F\u65E5\u5E38\u8DDF\u4E0A\u8BFE\u7A0B\u3001\u8003\u8BD5\u5468\u51B2\u523A",
    weights: { depth: 0.25, sustain: 0.15, resist: 0.2, rhythm: 0.25, recover: 0.15 },
    targetWorkMin: 300,
    targetPomodoros: 10
  },
  creator: {
    label: "\u521B\u4F5C\u8005",
    emoji: "\u{1F3A8}",
    desc: "\u7075\u611F\u9A71\u52A8\u3001\u72B6\u6001\u6CE2\u52A8\u5927\uFF1B\u76EE\u6807\u662F\u9AD8\u8D28\u91CF\u4EA7\u51FA\u5E76\u4FDD\u62A4\u521B\u9020\u529B",
    weights: { depth: 0.25, sustain: 0.15, resist: 0.15, rhythm: 0.2, recover: 0.25 },
    targetWorkMin: 300,
    targetPomodoros: 8
  },
  entrepreneur: {
    label: "\u521B\u4E1A\u8005",
    emoji: "\u{1F680}",
    desc: "\u9AD8\u5F3A\u5EA6\u591A\u7EBF\u7A0B\u3001\u4F1A\u8BAE\u5BC6\u96C6\uFF1B\u76EE\u6807\u662F\u591A\u9879\u76EE\u5E76\u884C\u63A8\u8FDB\u4E0E\u5FEB\u901F\u51B3\u7B56",
    weights: { depth: 0.2, sustain: 0.3, resist: 0.2, rhythm: 0.15, recover: 0.15 },
    targetWorkMin: 540,
    targetPomodoros: 14
  }
};
var DEEP_WORK_STATES = ["focus", "coding", "aidev", "aiqa", "writing"];
var DISTRACTION_STATES = ["slack", "relax"];
var DEEP_RUN_MIN = 20;
var RUN_GAP_TOLERANCE_MIN = 5;
var MIN_DATA_MIN = 30;
var SOCIAL_APP_KEYWORDS = ["\u5FAE\u4FE1", "wechat", "qq", "\u5FAE\u535A", "weibo", "\u6296\u97F3", "douyin", "tiktok", "bilibili", "\u54D4\u54E9", "\u5C0F\u7EA2\u4E66", "\u77E5\u4E4E", "zhihu", "\u8D34\u5427", "twitter", "reddit", "instagram", "facebook", "telegram"];
var r1 = (n) => Math.round(n * 10) / 10;
var r2 = (n) => Math.round(n * 100) / 100;
var clamp100 = (n) => Math.min(100, Math.max(0, n));
var mean = (ns) => ns.reduce((a, b) => a + b, 0) / ns.length;
function collectRuns(segments, states) {
  const runs = [];
  let cur = null;
  for (const s of segments) {
    const hit = !s.glance && states.includes(s.mainState);
    if (!hit) {
      if (cur) {
        runs.push(cur);
        cur = null;
      }
      continue;
    }
    if (cur && (s.startTs - cur.endTs) / 6e4 > RUN_GAP_TOLERANCE_MIN) {
      runs.push(cur);
      cur = null;
    }
    if (!cur) cur = { startTs: s.startTs, endTs: s.endTs, durationMin: 0 };
    cur.durationMin += s.durationMin;
    cur.endTs = s.endTs;
  }
  if (cur) runs.push(cur);
  return runs;
}
function workLikeMinOf(trail) {
  let m = 0;
  for (const s of WORK_LIKE_STATES) m += trail.stateMinutes[s] ?? 0;
  return m;
}
function hourlyMinutes(trail) {
  const work = new Array(24).fill(0);
  const covered = new Array(24).fill(0);
  for (const s of trail.segments) {
    if (s.glance) continue;
    const h = new Date(s.startTs).getHours();
    covered[h] += s.durationMin;
    if (WORK_LIKE_STATES.includes(s.mainState)) work[h] += s.durationMin;
  }
  return { work, covered };
}
function top3Hours(hourly) {
  return hourly.map((m, h) => ({ m, h })).sort((a, b) => b.m - a.m).slice(0, 3).map((e) => e.h);
}
function calcFiveDimensions(trail, goals, recentTrails) {
  const targetWorkMin = Math.max(1, goals.targetWorkMin);
  const targetPomodoros = Math.max(1, goals.targetPomodoros);
  if (trail.totalMin < MIN_DATA_MIN) {
    return {
      dimensions: { depth: 0, sustain: 0, resist: 0, rhythm: 0, recover: 0 },
      rawSignals: {
        deepFocusTotalMin: 0,
        deepFocusMaxStreak: 0,
        deepFocusCount: 0,
        effectiveWorkMin: 0,
        targetWorkMin,
        distractionCount: 0,
        distractionAvgMin: 0,
        recoveryAvgMin: 0,
        socialDistractionRatio: 0,
        pomodoroCompleted: 0,
        pomodoroTarget: targetPomodoros,
        rhythmStability: 0,
        restQuality: 0,
        recoveryAfterBreak: 0,
        fatigue3hDecay: 0,
        weeklyVariance: 0
      }
    };
  }
  const segments = trail.segments;
  const workLikeMin = workLikeMinOf(trail);
  const deepRuns = collectRuns(segments, DEEP_WORK_STATES).filter((r) => r.durationMin >= DEEP_RUN_MIN);
  const deepFocusTotalMin = deepRuns.reduce((a, r) => a + r.durationMin, 0);
  const deepFocusMaxStreak = deepRuns.reduce((a, r) => Math.max(a, r.durationMin), 0);
  const deepFocusCount = deepRuns.length;
  const depth = clamp100(
    (workLikeMin > 0 ? deepFocusTotalMin / workLikeMin : 0) * 50 + Math.min(deepFocusMaxStreak / 90, 1) * 30 + Math.min(deepFocusCount / 3, 1) * 20
  );
  const effectiveWorkMin = workLikeMin;
  const workRuns = collectRuns(segments, WORK_LIKE_STATES);
  const avgWorkRunMin = workRuns.length > 0 ? mean(workRuns.map((r) => r.durationMin)) : 0;
  const workRatio = trail.totalMin > 0 ? effectiveWorkMin / trail.totalMin : 0;
  const sustain = clamp100(
    Math.min(effectiveWorkMin / targetWorkMin, 1) * 60 + Math.min(avgWorkRunMin / 45, 1) * 25 + Math.min(workRatio / 0.7, 1) * 15
  );
  const slackRuns = collectRuns(segments, DISTRACTION_STATES);
  const distractionCount = slackRuns.length;
  const slackTotalMin = slackRuns.reduce((a, r) => a + r.durationMin, 0);
  const distractionAvgMin = distractionCount > 0 ? slackTotalMin / distractionCount : 0;
  const distractionFreq = effectiveWorkMin > 0 ? distractionCount / (effectiveWorkMin / 60) : 0;
  const recoveries = [];
  for (const run of slackRuns) {
    const nextWork = segments.find((s) => !s.glance && s.startTs >= run.endTs && WORK_LIKE_STATES.includes(s.mainState));
    if (nextWork) recoveries.push((nextWork.startTs - run.endTs) / 6e4);
  }
  const recoveryAvgMin = recoveries.length > 0 ? mean(recoveries) : 0;
  let socialMin = 0;
  for (const s of segments) {
    if (s.glance || !DISTRACTION_STATES.includes(s.mainState)) continue;
    const app5 = s.mainApp.toLowerCase();
    if (SOCIAL_APP_KEYWORDS.some((k) => app5.includes(k))) socialMin += s.durationMin;
  }
  const socialDistractionRatio = slackTotalMin > 0 ? socialMin / slackTotalMin : 0;
  const resist = clamp100(
    (1 - Math.min(distractionFreq / 3, 1)) * 35 + (1 - Math.min(distractionAvgMin / 15, 1)) * 30 + (1 - Math.min(recoveryAvgMin / 5, 1)) * 20 + (1 - Math.min(socialDistractionRatio / 0.5, 1)) * 15
  );
  const pomodoroCompleted = workRuns.filter((r) => r.durationMin >= 25 && r.durationMin <= 45).length;
  let rhythmStability = 0.5;
  if (workRuns.length >= 2) {
    const ds = workRuns.map((r) => r.durationMin);
    const m = mean(ds);
    const sd = Math.sqrt(mean(ds.map((d) => (d - m) ** 2)));
    rhythmStability = m > 0 ? 1 - Math.min(sd / m, 1) : 0.5;
  }
  const breaks = segments.filter((s) => !s.glance && s.mainState === "break");
  const restQuality = breaks.length > 0 ? breaks.filter((b) => b.durationMin >= 5 && b.durationMin <= 10).length / breaks.length : 0.5;
  const todayHourly = hourlyMinutes(trail);
  let peakOverlap = 0.5;
  if (recentTrails.length > 0) {
    const hist = new Array(24).fill(0);
    for (const t of recentTrails) {
      const h = hourlyMinutes(t).work;
      for (let i = 0; i < 24; i++) hist[i] += h[i] / recentTrails.length;
    }
    const histTop3 = top3Hours(hist);
    peakOverlap = top3Hours(todayHourly.work).filter((h) => histTop3.includes(h)).length / 3;
  }
  const rhythm = clamp100(
    Math.min(pomodoroCompleted / targetPomodoros, 1) * 30 + rhythmStability * 30 + restQuality * 20 + peakOverlap * 20
  );
  const NON_WORK_STATES = ["slack", "relax", "idle", "break", "away", "lunch"];
  const dips = collectRuns(segments, NON_WORK_STATES).filter((r) => r.durationMin > 30);
  const dipRecoveries = [];
  for (const dip of dips) {
    const back = segments.find((s) => !s.glance && s.startTs >= dip.endTs && WORK_LIKE_STATES.includes(s.mainState) && s.durationMin >= 10);
    if (back) dipRecoveries.push((back.startTs - dip.endTs) / 6e4);
  }
  const recoverTimeAvg = dipRecoveries.length > 0 ? mean(dipRecoveries) : 10;
  const lunchSegs = segments.filter((s) => !s.glance && s.mainState === "lunch");
  let recoveryAfterBreak = 0.5;
  if (lunchSegs.length > 0) {
    const ratios = lunchSegs.map((l) => {
      const winEnd = l.endTs + 60 * 6e4;
      let work = 0;
      let span = 0;
      for (const s of segments) {
        if (s.glance || s.endTs <= l.endTs || s.startTs >= winEnd) continue;
        const mins = (Math.min(s.endTs, winEnd) - Math.max(s.startTs, l.endTs)) / 6e4;
        span += mins;
        if (WORK_LIKE_STATES.includes(s.mainState)) work += mins;
      }
      return span > 0 ? work / span : 0;
    });
    recoveryAfterBreak = mean(ratios);
  }
  const hourWorkRatio = todayHourly.work.map((m) => Math.min(1, m / 60));
  const decays = [];
  for (let h = 0; h + 3 < 24; h++) {
    if (hourWorkRatio[h] >= 0.5 && hourWorkRatio[h + 1] >= 0.5 && hourWorkRatio[h + 2] >= 0.5 && todayHourly.covered[h + 3] > 0) {
      const base = (hourWorkRatio[h] + hourWorkRatio[h + 1] + hourWorkRatio[h + 2]) / 3;
      decays.push(Math.max(0, base - hourWorkRatio[h + 3]));
    }
  }
  const fatigue3hDecay = decays.length > 0 ? mean(decays) : 0.2;
  let weeklyVariance = 0;
  if (recentTrails.length >= 2) {
    const ds = recentTrails.map((t) => workLikeMinOf(t));
    const m = mean(ds);
    const sd = Math.sqrt(mean(ds.map((d) => (d - m) ** 2)));
    weeklyVariance = m > 0 ? Math.min(sd / m, 1) : 0;
  }
  const recover = clamp100(
    (1 - Math.min(recoverTimeAvg / 20, 1)) * 30 + recoveryAfterBreak * 25 + (1 - Math.min(fatigue3hDecay / 0.4, 1)) * 25 + (1 - Math.min(weeklyVariance, 1)) * 20
  );
  return {
    dimensions: {
      depth: Math.round(depth),
      sustain: Math.round(sustain),
      resist: Math.round(resist),
      rhythm: Math.round(rhythm),
      recover: Math.round(recover)
    },
    rawSignals: {
      deepFocusTotalMin: r1(deepFocusTotalMin),
      deepFocusMaxStreak: r1(deepFocusMaxStreak),
      deepFocusCount,
      effectiveWorkMin: r1(effectiveWorkMin),
      targetWorkMin,
      distractionCount,
      distractionAvgMin: r1(distractionAvgMin),
      recoveryAvgMin: r1(recoveryAvgMin),
      socialDistractionRatio: r2(socialDistractionRatio),
      pomodoroCompleted,
      pomodoroTarget: targetPomodoros,
      rhythmStability: r2(rhythmStability),
      restQuality: r2(restQuality),
      recoveryAfterBreak: r2(recoveryAfterBreak),
      fatigue3hDecay: r2(fatigue3hDecay),
      weeklyVariance: r2(weeklyVariance)
    }
  };
}
function compositeScore(dimensions, userType, bonus) {
  const w = USER_TYPE_META[userType].weights;
  const weightedScore = r1(
    dimensions.depth * w.depth + dimensions.sustain * w.sustain + dimensions.resist * w.resist + dimensions.rhythm * w.rhythm + dimensions.recover * w.recover
  );
  const streakBonus = bonus.streakDays >= 100 ? 30 : bonus.streakDays >= 30 ? 15 : bonus.streakDays >= 7 ? 5 : 0;
  const planBonus = bonus.planAchievement > 0.95 ? 20 : bonus.planAchievement > 0.8 ? 10 : 0;
  const milestoneBonus = 0;
  const finalScore = Math.min(1e3, Math.round(weightedScore * 10) + streakBonus + planBonus + milestoneBonus);
  return {
    weightedScore,
    finalScore,
    grade: gradeOf(finalScore),
    bonus: {
      streakDays: bonus.streakDays,
      streakBonus,
      planAchievement: bonus.planAchievement,
      planBonus,
      milestoneBonus
    }
  };
}
function gradeOf(finalScore) {
  if (finalScore >= 950) return "S+";
  if (finalScore >= 900) return "S";
  if (finalScore >= 800) return "A";
  if (finalScore >= 700) return "B";
  if (finalScore >= 600) return "C";
  if (finalScore >= 500) return "D";
  return "F";
}

// src/main/attention.ts
init_trail();

// src/shared/planAnalysis.ts
init_stateMeta();
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
function categoryStateHints(category, categories) {
  const custom = categories?.find((c) => c.id === category);
  if (custom?.stateHints) return custom.stateHints;
  return CATEGORY_STATE_HINT[category] ?? [];
}
function planVsActual(plans, trail, categories) {
  const dayPlans = plans.filter((p) => p.date === trail.date && p.status !== "cancelled" && p.status !== "delayed");
  const actualWorkMin = WORK_LIKE_STATES.reduce((a, s) => a + (trail.stateMinutes[s] ?? 0), 0);
  const items = dayPlans.map((plan) => {
    const hints = categoryStateHints(plan.category, categories);
    let coveredMin = 0;
    for (const seg of trail.segments) {
      if (plan.startMin != null && plan.endMin != null) {
        const segDate = new Date(seg.startTs);
        const segMin = segDate.getHours() * 60 + segDate.getMinutes();
        if (segMin >= plan.startMin && segMin < plan.endMin && hints.includes(seg.mainState)) {
          coveredMin += seg.durationMin;
        }
      } else if (hints.includes(seg.mainState)) {
        coveredMin += seg.durationMin;
      }
    }
    const plannedMin2 = plan.durationMin ?? (plan.startMin != null && plan.endMin != null ? plan.endMin - plan.startMin : 0);
    return { plan, coveredMin: Math.min(coveredMin, plannedMin2 || coveredMin), matched: coveredMin >= Math.max(10, plannedMin2 * 0.5) };
  });
  const plannedMin = dayPlans.reduce((a, p) => a + (p.durationMin ?? (p.startMin != null && p.endMin != null ? p.endMin - p.startMin : 0)), 0);
  const achievement = plannedMin > 0 ? Math.min(100, Math.round(actualWorkMin / plannedMin * 100)) : 0;
  return {
    date: trail.date,
    plannedMin,
    actualWorkMin: Math.round(actualWorkMin),
    achievement,
    matchedCount: items.filter((i) => i.matched).length,
    deviationMin: Math.round(actualWorkMin - plannedMin),
    items
  };
}

// src/main/attention.ts
init_db();
init_settings();
init_windows();
var mean2 = (ns) => ns.reduce((a, b) => a + b, 0) / ns.length;
function shiftDate(date, deltaDays) {
  const [y, m, d] = date.split("-").map(Number);
  return dateKey(new Date(y, m - 1, d + deltaDays, 12).getTime());
}
var autoTypeCache = null;
function effectiveUserType() {
  return getSettings().userType ?? autoTypeCache ?? "office_worker";
}
function upsertScore(score) {
  const arr = col("attentionScores");
  const idx = arr.findIndex((s) => s.date === score.date);
  if (idx >= 0) arr.splice(idx, 1);
  insertInto("attentionScores", score);
}
function streakDaysOf(date) {
  const dates = new Set(col("attentionScores").map((s) => s.date));
  let streak = 1;
  let cur = shiftDate(date, -1);
  while (dates.has(cur)) {
    streak++;
    cur = shiftDate(cur, -1);
  }
  return streak;
}
function planAchievementOf(date, trail) {
  const dayPlans = col("plans").filter((p) => p.date === date);
  if (dayPlans.length === 0 || trail.totalMin <= 0) return 0;
  return planVsActual(dayPlans, trail, col("categories")).achievement / 100;
}
function computeDailyScore(date) {
  const userType = effectiveUserType();
  const s = getSettings();
  const meta = USER_TYPE_META[userType];
  const goals = {
    targetWorkMin: s.targetWorkMin ?? meta.targetWorkMin,
    targetPomodoros: s.targetPomodoros ?? meta.targetPomodoros
  };
  const trail = buildMergedTrail(listActivities(date), date);
  const recentTrails = Array.from({ length: 7 }, (_, i) => {
    const d = shiftDate(date, -(i + 1));
    return buildMergedTrail(listActivities(d), d);
  });
  const { dimensions, rawSignals } = calcFiveDimensions(trail, goals, recentTrails);
  const streakDays = streakDaysOf(date);
  const planAchievement = planAchievementOf(date, trail);
  const comp = compositeScore(dimensions, userType, { streakDays, planAchievement });
  const scores = col("attentionScores");
  const yesterday = scores.find((x) => x.date === shiftDate(date, -1));
  const weekDates = new Set(Array.from({ length: 7 }, (_, i) => shiftDate(date, -(i + 1))));
  const weekScores = scores.filter((x) => weekDates.has(x.date) && x.date !== date);
  const score = {
    date,
    userType,
    dimensions,
    rawSignals,
    weightedScore: comp.weightedScore,
    finalScore: comp.finalScore,
    grade: comp.grade,
    bonus: comp.bonus,
    vsYesterday: yesterday ? comp.finalScore - yesterday.finalScore : 0,
    vsLastWeekAvg: weekScores.length > 0 ? Math.round(comp.finalScore - mean2(weekScores.map((x) => x.finalScore))) : 0,
    ts: Date.now()
  };
  upsertScore(score);
  return score;
}
function todayScore() {
  return computeDailyScore(dateKey(Date.now()));
}
function recentScores(days) {
  return [...col("attentionScores")].sort((a, b) => a.date.localeCompare(b.date)).slice(-days);
}
function lastNDaysBelow(n, threshold) {
  const r = recentScores(n);
  if (r.length < n) return false;
  for (let i = 1; i < r.length; i++) {
    if (shiftDate(r[i - 1].date, 1) !== r[i].date) return false;
  }
  return r.every((s) => s.finalScore < threshold);
}
function getScoreStrategy() {
  const today = dateKey(Date.now());
  const rec = col("attentionScores").find((s) => s.date === today);
  const finalScore = rec?.finalScore ?? 700;
  const vsYesterday = rec?.vsYesterday ?? 0;
  let band = finalScore >= 900 ? "challenge" : finalScore >= 700 ? "standard" : finalScore >= 500 ? "gentle" : "care";
  const ut = effectiveUserType();
  if (ut === "exam_candidate" && lastNDaysBelow(3, 600)) band = "care";
  if (ut === "creator" && finalScore < 600) band = "care";
  if (ut === "entrepreneur" && finalScore > 900) band = "standard";
  const p = finalScore > 850 ? 0.1 : finalScore < 600 ? band === "gentle" ? -0.05 : -0.1 : 0;
  const a = vsYesterday > 200 ? 0.15 : vsYesterday < -200 ? 0.05 : 0;
  const d = finalScore > 850 ? 0.1 : finalScore < 600 ? -0.15 : 0;
  const slackReminderMin = band === "challenge" ? 20 : band === "standard" ? 15 : band === "gentle" ? 10 : 5;
  return { band, padOffset: { p, a, d }, slackReminderMin };
}

// src/main/report/stats.ts
init_stateMeta();
init_trail();
init_db();
var SLOT_DEFS = [
  { slot: "morning", label: "\u4E0A\u5348", from: 6, to: 12 },
  { slot: "afternoon", label: "\u4E0B\u5348", from: 12, to: 18 },
  { slot: "evening", label: "\u665A\u4E0A", from: 18, to: 24 },
  { slot: "night", label: "\u51CC\u6668", from: 0, to: 6 }
];
function slotOfHour(hour) {
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18) return "evening";
  return "night";
}
function isSlackLike(s) {
  return s === "slack" || s === "relax";
}
function calculateReportStats(date, depth = 0) {
  const trail = buildMergedTrail(listActivities(date), date);
  const totalMin = trail.totalMin;
  const sm = trail.stateMinutes;
  const workMin = WORK_LIKE_STATES.reduce((a, s) => a + (sm[s] ?? 0), 0);
  const slackMin = (sm.slack ?? 0) + (sm.relax ?? 0);
  const stateBreakdown = Object.keys(WORK_STATES).map((state) => {
    const minutes = sm[state] ?? 0;
    return {
      state,
      label: WORK_STATES[state].label,
      minutes: Math.round(minutes),
      percentage: totalMin > 0 ? Math.round(minutes / totalMin * 100) : 0,
      color: WORK_STATES[state].color
    };
  }).filter((x) => x.minutes > 0).sort((a, b) => b.minutes - a.minutes);
  const appMin = /* @__PURE__ */ new Map();
  const appStateMin = /* @__PURE__ */ new Map();
  for (const seg of trail.segments) {
    if (seg.glance || !seg.mainApp) continue;
    appMin.set(seg.mainApp, (appMin.get(seg.mainApp) ?? 0) + seg.durationMin);
    const m = appStateMin.get(seg.mainApp) ?? /* @__PURE__ */ new Map();
    m.set(seg.mainState, (m.get(seg.mainState) ?? 0) + seg.durationMin);
    appStateMin.set(seg.mainApp, m);
  }
  const appRanking = [...appMin.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([app5, minutes]) => {
    const topState = [...appStateMin.get(app5)?.entries() ?? []].sort((a, b) => b[1] - a[1])[0];
    return {
      app: app5,
      minutes: Math.round(minutes),
      percentage: totalMin > 0 ? Math.round(minutes / totalMin * 100) : 0,
      primaryState: topState?.[0] ?? "idle"
    };
  });
  const slotBreakdown = SLOT_DEFS.map((def) => {
    let w = 0;
    let s = 0;
    for (const seg of trail.segments) {
      if (seg.glance) continue;
      if (slotOfHour(new Date(seg.startTs).getHours()) !== def.slot) continue;
      if (WORK_LIKE_STATES.includes(seg.mainState)) w += seg.durationMin;
      else if (isSlackLike(seg.mainState)) s += seg.durationMin;
    }
    return {
      slot: def.slot,
      label: def.label,
      workMin: Math.round(w),
      slackMin: Math.round(s),
      focusScore: w + s > 0 ? Math.round(w / (w + s) * 100) : 0
    };
  });
  const focusScore = totalMin > 0 ? Math.round(workMin / totalMin * 100) : 0;
  const hourWork = new Array(24).fill(0);
  const hourTotal = new Array(24).fill(0);
  for (const seg of trail.segments) {
    if (seg.glance) continue;
    const h = new Date(seg.startTs).getHours();
    hourTotal[h] += seg.durationMin;
    if (WORK_LIKE_STATES.includes(seg.mainState)) hourWork[h] += seg.durationMin;
  }
  const focusTrend = hourWork.map((w, h) => hourTotal[h] > 0 ? Math.round(w / hourTotal[h] * 100) : 0);
  const stats = {
    totalWorkMin: Math.round(workMin),
    totalSlackMin: Math.round(slackMin),
    workSlackRatio: slackMin > 0 ? Math.round(workMin / slackMin * 100) / 100 : workMin > 0 ? 999 : 0,
    stateBreakdown,
    appRanking,
    slotBreakdown,
    focusScore,
    focusTrend
  };
  if (depth === 0) {
    const dayMs = 864e5;
    const base = (/* @__PURE__ */ new Date(`${date}T00:00:00`)).getTime();
    const yesterday = calculateReportStats(dateKey(base - dayMs), 1);
    if (yesterday.totalWorkMin + yesterday.totalSlackMin >= 30 || sumTotal(yesterday) >= 30) {
      stats.vsYesterday = {
        workMinDelta: stats.totalWorkMin - yesterday.totalWorkMin,
        focusDelta: stats.focusScore - yesterday.focusScore,
        slackDelta: stats.totalSlackMin - yesterday.totalSlackMin
      };
    }
    const lastWeek = calculateReportStats(dateKey(base - 7 * dayMs), 1);
    if (sumTotal(lastWeek) >= 30) {
      stats.vsLastWeekSameDay = {
        workMinDelta: stats.totalWorkMin - lastWeek.totalWorkMin,
        focusDelta: stats.focusScore - lastWeek.focusScore
      };
    }
  }
  return stats;
}
function sumTotal(s) {
  return s.stateBreakdown.reduce((a, b) => a + b.minutes, 0);
}

// src/main/report/planMatcher.ts
function segMinRange(seg) {
  const d = new Date(seg.startTs);
  const startMin = d.getHours() * 60 + d.getMinutes();
  return { startMin, endMin: startMin + seg.durationMin };
}
function overlapMin(a, b) {
  return Math.max(0, Math.min(a.endMin, b.endMin) - Math.max(a.startMin, b.startMin));
}
function matchPlanByTime(segment, plans) {
  const segRange = segMinRange(segment);
  const segLen = segRange.endMin - segRange.startMin;
  let bestMatch = null;
  let bestOverlap = 0;
  for (const plan of plans) {
    if (plan.startMin == null || plan.endMin == null) continue;
    const overlap = overlapMin(segRange, { startMin: plan.startMin, endMin: plan.endMin });
    const ratio = segLen > 0 ? overlap / segLen : 0;
    if (ratio > 0.5 && ratio > bestOverlap) {
      bestMatch = plan;
      bestOverlap = ratio;
    }
  }
  if (bestMatch) return bestMatch;
  const title = segment.mainTitle ?? "";
  if (title) {
    for (const plan of plans) {
      if (plan.startMin != null && plan.endMin != null) continue;
      if (plan.title.length >= 2 && title.includes(plan.title)) return plan;
    }
  }
  return null;
}
function calculatePlanAchievements(segments, plans) {
  return plans.map((plan) => {
    const related = segments.filter((s) => matchPlanByTime(s, [plan]) !== null);
    const actualMin = related.reduce((sum, s) => sum + s.durationMin, 0);
    const plannedMin = plan.durationMin ?? (plan.startMin != null && plan.endMin != null ? plan.endMin - plan.startMin : 60);
    const rate = plannedMin > 0 ? actualMin / plannedMin : 0;
    let status;
    if (rate > 1.2) status = "overtime";
    else if (rate >= 1) status = "completed";
    else if (rate >= 0.5) status = "partial";
    else if (actualMin === 0) status = "missed";
    else status = "partial";
    return {
      planId: plan.id,
      title: plan.title,
      plannedMin: Math.round(plannedMin),
      actualMin: Math.round(actualMin),
      achievementRate: Math.min(rate, 1),
      status,
      relatedSegmentIds: related.map((s) => s.id ?? "")
    };
  });
}
function overlayTimeEntries(segments, entries) {
  return entries.map((entry) => {
    const timeMatched = segments.find((s) => {
      const r = segMinRange(s);
      return overlapMin(r, { startMin: entry.startMin, endMin: entry.endMin }) > 0;
    });
    if (timeMatched) return { entry, matchedSegmentId: timeMatched.id, matchType: "time" };
    const keywordMatched = segments.find((s) => s.mainTitle && entry.title && s.mainTitle.includes(entry.title));
    if (keywordMatched) return { entry, matchedSegmentId: keywordMatched.id, matchType: "title" };
    return { entry, matchType: "none" };
  });
}

// src/main/report/rulesEngine.ts
var builtinRules = [
  // ─── 文档类 ───
  {
    id: "doc-with-subject",
    pattern: /(.+?)[\-—_\s]+(.+?)\.(docx?|pdf|xlsx?|pptx?|md|txt)/i,
    extract: (m) => ({
      subject: { name: m[1], type: "client", confidence: 0.85 },
      output: { type: "document", name: m[0], confidence: 0.9 }
    }),
    priority: 10,
    enabled: true
  },
  {
    id: "doc-generic",
    pattern: /(.+?)\.(docx?|pdf|xlsx?|pptx?|md|txt)/i,
    extract: (m) => ({
      output: { type: "document", name: m[0], confidence: 0.7 }
    }),
    priority: 5,
    enabled: true
  },
  // ─── 通信类 ───
  {
    id: "meeting-app",
    pattern: /(.+?)\s*[—\-]\s*(腾讯会议|Zoom|Teams|钉钉|飞书|Google Meet)/,
    extract: (m) => ({
      subject: { name: m[1], type: "team", confidence: 0.7 },
      location: { target: m[2], type: "system", confidence: 0.9 },
      contentTag: { category: "\u89C6\u9891\u4F1A\u8BAE", confidence: 0.85 }
    }),
    priority: 10,
    enabled: true
  },
  {
    id: "chat-with-person",
    pattern: /与(.+?)[的]?(微信|电话|视频|会议|邮件)/,
    extract: (m) => ({
      subject: { name: m[1], type: "person", confidence: 0.85 },
      contentTag: { category: m[2] + "\u6C9F\u901A", confidence: 0.8 }
    }),
    priority: 8,
    enabled: true
  },
  {
    id: "wechat-contact",
    appFilter: ["WeChat", "\u5FAE\u4FE1"],
    pattern: /^(.+?)$/,
    extract: (m) => {
      const title = m[0].trim();
      if (title.length > 1 && title.length < 20 && !title.includes("-")) {
        return {
          subject: { name: title, type: "person", confidence: 0.6 },
          contentTag: { category: "\u5FAE\u4FE1\u6C9F\u901A", confidence: 0.7 }
        };
      }
      return {};
    },
    priority: 3,
    enabled: true
  },
  // ─── IDE/编辑器类 ───
  {
    id: "ide-workspace",
    appFilter: ["Code", "VSCode", "Cursor", "WebStorm", "Sublime", "Vim", "Visual Studio", "Rider", "IntelliJ", "Windsurf", "Trae"],
    pattern: /^(.+?)\s*[—\-]\s*(.+)$/,
    extract: (m) => ({
      // 注：规格中 project 带 source:'workspace' 标记，shared 类型无该字段，故略去
      project: { name: m[1], confidence: 0.75 },
      output: { type: "code", name: m[2], confidence: 0.7 }
    }),
    priority: 8,
    enabled: true
  },
  {
    id: "cursor-aidev",
    appFilter: ["Cursor", "Windsurf", "Trae"],
    pattern: /.*/,
    extract: () => ({
      contentTag: { category: "AI\u8F85\u52A9\u5F00\u53D1", confidence: 0.8 }
    }),
    priority: 2,
    enabled: true
  },
  // ─── 终端/SSH类 ───
  {
    id: "ssh-target",
    appFilter: ["Terminal", "iTerm", "Windows Terminal", "PuTTY", "Tabby", "Transfer/SSH"],
    pattern: /(.+?)@([\w\-.]+):/,
    extract: (m) => ({
      location: { target: m[2], type: "server", confidence: 0.9 },
      subject: { name: m[1], type: "unknown", confidence: 0.7 }
    }),
    priority: 10,
    enabled: true
  },
  {
    id: "ssh-command",
    appFilter: ["Terminal", "iTerm", "Windows Terminal", "Transfer/SSH"],
    pattern: /(ssh|scp|rsync)\s+.*@([\w\-.]+)/,
    extract: (m) => ({
      location: { target: m[2], type: "server", confidence: 0.95 },
      contentTag: { category: "\u8FDC\u7A0B\u90E8\u7F72", confidence: 0.85 }
    }),
    priority: 12,
    enabled: true
  },
  {
    id: "docker-command",
    appFilter: ["Terminal", "iTerm", "Windows Terminal"],
    pattern: /docker\s+(build|run|push|pull|compose)/,
    extract: () => ({
      contentTag: { category: "\u5BB9\u5668\u7BA1\u7406", confidence: 0.85 },
      output: { type: "config", name: "docker", confidence: 0.7 }
    }),
    priority: 8,
    enabled: true
  },
  // ─── 浏览器类 ───
  {
    id: "jira-ticket",
    appFilter: ["Chrome", "Edge", "Firefox", "Safari", "Browser"],
    pattern: /([A-Z]+[-]\d+)/,
    extract: (m) => ({
      project: { name: m[1], confidence: 0.6 },
      contentTag: { category: "\u4EFB\u52A1\u8DDF\u8E2A", confidence: 0.7 }
    }),
    priority: 6,
    enabled: true
  },
  {
    id: "github-repo",
    appFilter: ["Chrome", "Edge", "Firefox", "Safari", "Browser"],
    pattern: /github\.com[\/:]([\w\-]+)\/([\w\-]+)/,
    extract: (m) => ({
      project: { name: m[2], confidence: 0.8 },
      location: { target: "GitHub", type: "repository", confidence: 0.9 }
    }),
    priority: 8,
    enabled: true
  },
  // ─── 项目关键词匹配 ───
  {
    id: "project-keyword",
    pattern: /([一-龥]+)[\-—_\s]*项目/,
    extract: (m) => ({
      project: { name: m[1] + "\u9879\u76EE", confidence: 0.8 }
    }),
    priority: 7,
    enabled: true
  }
];
var appContentMap = {
  Cursor: { state: "aidev", contentTag: "AI\u8F85\u52A9\u5F00\u53D1", outputType: "code" },
  Code: { state: "coding", contentTag: "\u4EE3\u7801\u5F00\u53D1", outputType: "code" },
  VSCode: { state: "coding", contentTag: "\u4EE3\u7801\u5F00\u53D1", outputType: "code" },
  WebStorm: { state: "coding", contentTag: "\u4EE3\u7801\u5F00\u53D1", outputType: "code" },
  Word: { state: "writing", contentTag: "\u6587\u6863\u64B0\u5199", outputType: "document" },
  WPS: { state: "writing", contentTag: "\u6587\u6863\u64B0\u5199", outputType: "document" },
  Office: { state: "writing", contentTag: "\u6587\u6863\u64B0\u5199", outputType: "document" },
  Excel: { state: "writing", contentTag: "\u8868\u683C\u5904\u7406", outputType: "data" },
  PowerPoint: { state: "writing", contentTag: "PPT\u5236\u4F5C", outputType: "document" },
  // 注：规格原文设计类应用状态为 design，本项目 WorkState 无该态，就近映射为 focus
  Figma: { state: "focus", contentTag: "UI\u8BBE\u8BA1", outputType: "design" },
  Design: { state: "focus", contentTag: "UI\u8BBE\u8BA1", outputType: "design" },
  Photoshop: { state: "focus", contentTag: "\u56FE\u50CF\u5904\u7406", outputType: "design" },
  Postman: { state: "coding", contentTag: "\u63A5\u53E3\u6D4B\u8BD5", outputType: "other" },
  Docker: { state: "remote", contentTag: "\u5BB9\u5668\u7BA1\u7406", outputType: "config" },
  \u817E\u8BAF\u4F1A\u8BAE: { state: "meeting", contentTag: "\u89C6\u9891\u4F1A\u8BAE", outputType: "communication" },
  Zoom: { state: "meeting", contentTag: "\u89C6\u9891\u4F1A\u8BAE", outputType: "communication" },
  Meeting: { state: "meeting", contentTag: "\u89C6\u9891\u4F1A\u8BAE", outputType: "communication" },
  WeChat: { state: "meeting", contentTag: "\u5373\u65F6\u901A\u8BAF", outputType: "communication" },
  \u5FAE\u4FE1: { state: "meeting", contentTag: "\u5373\u65F6\u901A\u8BAF", outputType: "communication" },
  \u9489\u9489: { state: "meeting", contentTag: "\u5373\u65F6\u901A\u8BAF", outputType: "communication" },
  DingTalk: { state: "meeting", contentTag: "\u5373\u65F6\u901A\u8BAF", outputType: "communication" },
  \u98DE\u4E66: { state: "meeting", contentTag: "\u5373\u65F6\u901A\u8BAF", outputType: "communication" },
  Feishu: { state: "meeting", contentTag: "\u5373\u65F6\u901A\u8BAF", outputType: "communication" },
  Outlook: { state: "meeting", contentTag: "\u90AE\u4EF6\u5904\u7406", outputType: "communication" },
  Foxmail: { state: "meeting", contentTag: "\u90AE\u4EF6\u5904\u7406", outputType: "communication" },
  Terminal: { state: "remote", contentTag: "\u547D\u4EE4\u884C\u64CD\u4F5C", outputType: "config" },
  "Windows Terminal": { state: "remote", contentTag: "\u547D\u4EE4\u884C\u64CD\u4F5C", outputType: "config" },
  Notion: { state: "writing", contentTag: "\u6587\u6863\u7F16\u8F91", outputType: "document" },
  Notes: { state: "writing", contentTag: "\u6587\u6863\u7F16\u8F91", outputType: "document" },
  Obsidian: { state: "writing", contentTag: "\u7B14\u8BB0\u6574\u7406", outputType: "document" },
  // 注：规格原文 Chrome 状态为 research，本项目 WorkState 无该态，就近映射为 focus
  Chrome: { state: "focus", contentTag: "\u4FE1\u606F\u68C0\u7D22", outputType: "other" },
  Browser: { state: "focus", contentTag: "\u4FE1\u606F\u68C0\u7D22", outputType: "other" },
  // ── 以下为对齐本项目 identifyApp 实际友好名的补充（stateMeta APP_RULES）──
  QQ: { state: "meeting", contentTag: "\u5373\u65F6\u901A\u8BAF", outputType: "communication" },
  "Visual Studio": { state: "coding", contentTag: "\u4EE3\u7801\u5F00\u53D1", outputType: "code" },
  Rider: { state: "coding", contentTag: "\u4EE3\u7801\u5F00\u53D1", outputType: "code" },
  IntelliJ: { state: "coding", contentTag: "\u4EE3\u7801\u5F00\u53D1", outputType: "code" },
  Windsurf: { state: "aidev", contentTag: "AI\u8F85\u52A9\u5F00\u53D1", outputType: "code" },
  Trae: { state: "aidev", contentTag: "AI\u8F85\u52A9\u5F00\u53D1", outputType: "code" },
  DevTool: { state: "coding", contentTag: "\u5F00\u53D1\u5DE5\u5177", outputType: "other" },
  "Transfer/SSH": { state: "remote", contentTag: "\u8FDC\u7A0B\u64CD\u4F5C", outputType: "config" },
  PerfTest: { state: "coding", contentTag: "\u6027\u80FD\u6D4B\u8BD5", outputType: "other" },
  Launcher: { state: "focus", contentTag: "\u5DE5\u5177\u4F7F\u7528", outputType: "other" },
  Recorder: { state: "focus", contentTag: "\u5C4F\u5E55\u5F55\u5236", outputType: "other" }
};
function enrichSegment(segment, context) {
  const result = {};
  const app5 = segment.mainApp ?? "";
  const title = segment.mainTitle ?? "";
  const appMapping = appContentMap[app5] ?? appContentMap[app5.split(" \xB7 ")[0]];
  if (appMapping) {
    result.contentTag = { category: appMapping.contentTag, confidence: 0.9 };
  }
  const applicableRules = builtinRules.filter((r) => r.enabled).filter((r) => !r.appFilter || r.appFilter.some((a) => app5.includes(a))).sort((a, b) => b.priority - a.priority);
  for (const rule of applicableRules) {
    const match = title.match(rule.pattern);
    if (match) {
      const extracted = rule.extract(match, context);
      mergeEnrichment(result, extracted);
    }
  }
  const vocab = context.industryVocab;
  if (vocab && title) {
    if (!result.project) {
      const hit = vocab.keywords.projectPatterns.find((p) => title.includes(p));
      if (hit) result.project = { name: hit, confidence: 0.75 };
    }
    if (!result.contentTag) {
      const hit = vocab.keywords.outputPatterns.find((p) => title.includes(p));
      if (hit) result.contentTag = { category: hit, confidence: 0.7 };
    }
  }
  if (context.recentPlans.length > 0) {
    const matchedPlan = matchPlanByTime(segment, context.recentPlans);
    if (matchedPlan) {
      result.project = { name: matchedPlan.title, confidence: 0.9 };
    }
  }
  return result;
}
function mergeEnrichment(base, addon) {
  if (!base.subject && addon.subject) base.subject = addon.subject;
  if (!base.contentTag && addon.contentTag) base.contentTag = addon.contentTag;
  if (!base.project && addon.project) base.project = addon.project;
  if (!base.location && addon.location) base.location = addon.location;
  if (!base.output && addon.output) base.output = addon.output;
}

// src/main/report/aggregator.ts
init_stateMeta();
init_trail();
init_types();
var defaultConfig = {
  minSegmentMin: 5,
  mergeGapMin: 3,
  mergeSameApp: true,
  mergeSimilarTitle: true,
  titleSimilarityThreshold: 0.7
};
function aggregateTrail(segments, enriched, config = defaultConfig) {
  let working = segments.filter((s) => !s.glance).map((s) => ({ ...s }));
  working = filterFragments(working, config.minSegmentMin);
  working = mergeAdjacentSameState(working, config.mergeGapMin);
  if (config.mergeSameApp) {
    working = mergeSameAppSegs(working);
  }
  if (config.mergeSimilarTitle) {
    working = mergeSimilarTitles(working, config.titleSimilarityThreshold);
  }
  return working.map((seg) => {
    const enrichment = seg.id && enriched.get(seg.id) || {};
    return segmentToReportEntry(seg, enrichment);
  });
}
function filterFragments(segs, minMin) {
  const out = [];
  for (const seg of segs) {
    if (seg.durationMin < minMin && (out.length > 0 || segs.length > 1)) {
      const prev2 = out[out.length - 1];
      if (prev2) {
        prev2.endTs = Math.max(prev2.endTs, seg.endTs);
        prev2.durationMin += seg.durationMin;
        continue;
      }
      out.push(seg);
      continue;
    }
    const prev = out[out.length - 1];
    if (prev && prev.durationMin < minMin) {
      seg.startTs = Math.min(seg.startTs, prev.startTs);
      seg.durationMin += prev.durationMin;
      out[out.length - 1] = seg;
      continue;
    }
    out.push(seg);
  }
  return out;
}
function mergeInto(prev, cur) {
  const keepCur = (cur.mainTitle?.length ?? 0) > (prev.mainTitle?.length ?? 0);
  prev.endTs = Math.max(prev.endTs, cur.endTs);
  prev.startTs = Math.min(prev.startTs, cur.startTs);
  prev.durationMin += cur.durationMin;
  if (keepCur) {
    prev.mainTitle = cur.mainTitle;
    prev.mainApp = cur.mainApp;
  }
}
function mergeAdjacentSameState(segs, gapMin) {
  const out = [];
  for (const seg of segs) {
    const prev = out[out.length - 1];
    if (prev && prev.mainState === seg.mainState && seg.startTs - prev.endTs < gapMin * 6e4) {
      mergeInto(prev, seg);
      continue;
    }
    out.push(seg);
  }
  return out;
}
function mergeSameAppSegs(segs) {
  const out = [];
  for (const seg of segs) {
    const prev = out[out.length - 1];
    if (prev && prev.mainState === seg.mainState && prev.mainApp === seg.mainApp) {
      mergeInto(prev, seg);
      continue;
    }
    out.push(seg);
  }
  return out;
}
function mergeSimilarTitles(segs, threshold) {
  const out = [];
  for (const seg of segs) {
    const prev = out[out.length - 1];
    if (prev && prev.mainState === seg.mainState && prev.mainTitle && seg.mainTitle && titleSimilarity(prev.mainTitle, seg.mainTitle) >= threshold) {
      mergeInto(prev, seg);
      continue;
    }
    out.push(seg);
  }
  return out;
}
function titleSimilarity(a, b) {
  if (!a || !b) return 0;
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLength = Math.max(a.length, b.length);
  return 1 - distance / maxLength;
}
function levenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[b.length][a.length];
}
function slotOfHour2(hour) {
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18) return "evening";
  return "night";
}
function segmentToReportEntry(seg, enrichment) {
  const confs = [
    enrichment.subject?.confidence,
    enrichment.contentTag?.confidence,
    enrichment.project?.confidence,
    enrichment.location?.confidence,
    enrichment.output?.confidence
  ].filter((c) => c != null);
  const confidence = confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : 0.5;
  return {
    id: seg.id ?? genId("entry"),
    date: dateKey(seg.startTs),
    startTs: seg.startTs,
    endTs: seg.endTs,
    durationMin: Math.round(seg.durationMin),
    timeSlot: slotOfHour2(new Date(seg.startTs).getHours()),
    state: seg.mainState,
    stateLabel: WORK_STATES[seg.mainState]?.label ?? seg.mainState,
    app: seg.mainApp,
    subject: enrichment.subject?.name,
    subjectType: enrichment.subject?.type,
    contentTag: enrichment.contentTag?.category,
    project: enrichment.project?.name,
    location: enrichment.location?.target,
    output: enrichment.output?.name,
    outputType: enrichment.output?.type,
    dataSource: ["auto"],
    confidence: Math.round(confidence * 100) / 100,
    needsReview: confidence < 0.6,
    ts: Date.now()
  };
}

// src/main/report/ocrCollector.ts
init_types();
init_trail();
init_db();
init_settings();

// src/main/ocrWorker.ts
var import_electron4 = __toESM(require_electron_stub());
var import_sharp = __toESM(require("sharp"));
init_settings();

// src/main/presence.ts
var import_events = require("events");
init_stateMeta();

// src/shared/focusMeta.ts
init_stateMeta();
var STATE_FOCUS_BASE = {
  focus: 80,
  coding: 90,
  aidev: 88,
  aiqa: 70,
  writing: 82,
  meeting: 60,
  remote: 55,
  slack: 12,
  relax: 25,
  idle: 15,
  break: 30,
  lunch: 30,
  away: 5
};

// src/main/presence.ts
var STICKY_MAX_MS = 10 * 60 * 1e3;
var SCREEN_STALE_MS = 35 * 60 * 1e3;
var IDLE_DOWNGRADE_SEC = 60;
var PresenceEngine = class extends import_events.EventEmitter {
  screens = /* @__PURE__ */ new Map();
  lastActiveScreen = 0;
  slackSince = null;
  focusSince = null;
  snapshot;
  _ocrContext;
  /** 最近一次前台窗口矩形（仅主屏样本更新，60s 无更新失效） */
  winRect;
  winRectTs = 0;
  /** 当前前台应用是否被隐私排除（ocrWorker 据此跳过本轮截屏） */
  excludedActive = false;
  constructor() {
    super();
    this.snapshot = this.build(Date.now(), 0);
  }
  /** 设置 OCR 上下文（由 ocrWorker 写入） */
  setOcrContext(ctx) {
    this._ocrContext = ctx;
  }
  /** 推入一轮采样（monitor 调用）。mediaSticky: 该屏样本来自媒体类应用 */
  push(sample) {
    const { screen: screen2, ts } = sample;
    const identified = identifyApp(sample.app, sample.title);
    const isMediaApp = /^(Music|Video|VideoSite)$/.test(identified.appName);
    let sp = this.screens.get(screen2);
    const changed = !sp || sp.app !== sample.app || sp.title !== sample.title || sp.state !== identified.state;
    if (!sp || changed) {
      const sticky = sp?.stickyRelax && (isMediaApp || !sample.active) && ts - sp.sinceTs < STICKY_MAX_MS;
      sp = {
        screen: screen2,
        state: sticky ? "relax" : identified.state,
        app: sample.app,
        appName: identified.appName,
        title: sample.title,
        sinceTs: changed ? ts : sp?.sinceTs ?? ts,
        stickyRelax: sticky || isMediaApp && identified.state === "relax"
      };
      this.screens.set(screen2, sp);
    } else {
      sp.active = sample.active;
      if (sp.stickyRelax && sample.active && WORK_LIKE_STATES.includes(identified.state)) {
        sp.stickyRelax = false;
        sp.state = identified.state;
        sp.app = sample.app;
        sp.appName = identified.appName;
        sp.title = sample.title;
        sp.sinceTs = ts;
      }
    }
    if (sample.active) this.lastActiveScreen = screen2;
    if (sample.winRect) {
      this.winRect = sample.winRect;
      this.winRectTs = ts;
    }
    this.snapshot = this.build(ts, sample.idleSec);
    this.emit("update", this.snapshot);
    return this.snapshot;
  }
  getSnapshot() {
    return this.snapshot;
  }
  build(ts, idleSec) {
    for (const [idx, sp] of this.screens) {
      if (ts - sp.sinceTs > SCREEN_STALE_MS) this.screens.delete(idx);
    }
    const list = [...this.screens.values()].sort((a, b) => a.screen - b.screen);
    let main2 = list.find((s) => s.screen === this.lastActiveScreen);
    if (main2 && RELAX_STATES.includes(main2.state) && main2.state !== "break") {
      const work = list.find((s) => WORK_LIKE_STATES.includes(s.state));
      if (work) main2 = work;
    }
    if (!main2) main2 = list.find((s) => WORK_LIKE_STATES.includes(s.state)) ?? list[0];
    let state;
    const meetingLike = main2?.state === "meeting" || main2?.state === "remote";
    if (idleSec > 300 && !meetingLike) {
      state = "away";
    } else if (idleSec > IDLE_DOWNGRADE_SEC && main2 && INPUT_REQUIRED_STATES.includes(main2.state)) {
      state = "idle";
    } else {
      state = main2?.state ?? "idle";
    }
    const aux = list.find((s) => s.screen !== main2?.screen);
    const context = aux ? `dual-${state}-${aux.state}` : `single-${state}`;
    if (state === "slack") {
      if (!this.slackSince) this.slackSince = ts;
      this.focusSince = null;
    } else if (WORK_LIKE_STATES.includes(state)) {
      if (!this.focusSince) this.focusSince = ts;
      this.slackSince = null;
    } else if (state === "idle") {
      this.slackSince = null;
    } else {
      this.slackSince = null;
      this.focusSince = null;
    }
    let focus = STATE_FOCUS_BASE[state];
    if (WORK_LIKE_STATES.includes(state)) {
      const contMin = this.focusSince ? (ts - this.focusSince) / 6e4 : 0;
      focus = Math.min(100, focus + Math.min(15, contMin * 0.5));
    }
    if (idleSec > IDLE_DOWNGRADE_SEC && state !== "away") focus = Math.min(focus, 40);
    return {
      ts,
      state,
      focusLevel: Math.round(focus),
      context,
      screens: list.map((s) => ({ ...s })),
      mainScreen: main2?.screen ?? 0,
      continuousSlackSec: this.slackSince ? Math.round((ts - this.slackSince) / 1e3) : 0,
      continuousFocusSec: this.focusSince ? Math.round((ts - this.focusSince) / 1e3) : 0,
      idleSec,
      ocrContext: this._ocrContext,
      winRect: ts - this.winRectTs < 6e4 ? this.winRect : void 0
    };
  }
};
var presence = new PresenceEngine();

// src/main/ocrWorker.ts
var OCR_SAME_WINDOW_SKIP_MS = 3 * 6e4;

// src/main/report/ocrCollector.ts
var ALL_VOCAB_KEYWORDS = (() => {
  const set = /* @__PURE__ */ new Set();
  for (const vocab of Object.values(INDUSTRY_VOCABS)) {
    for (const p of vocab.keywords.subjectPatterns) set.add(p);
    for (const p of vocab.keywords.projectPatterns) set.add(p);
    for (const p of vocab.keywords.outputPatterns) set.add(p);
  }
  return [...set];
})();
function ocrEnrichmentForWindow(startTs, endTs, date) {
  const relevant = col("ocrSnapshots").filter(
    (s) => dateKey(s.ts) === date && s.ts >= startTs && s.ts <= endTs
  );
  if (!relevant.length) return null;
  const allDocs = relevant.flatMap((s) => s.documentNames);
  const allPersons = relevant.flatMap((s) => s.personNames);
  const allKeywords = relevant.flatMap((s) => s.keywords);
  const result = {};
  if (allDocs.length > 0) {
    result.output = { type: "document", name: allDocs[0], confidence: 0.75 };
  }
  if (allPersons.length > 0) {
    result.subject = { name: allPersons[0], type: "person", confidence: 0.7 };
  }
  if (allKeywords.length > 0) {
    result.contentTag = { category: allKeywords.slice(0, 3).join("/"), confidence: 0.6 };
  }
  return result;
}
function attachOcrToEntries(entries, date) {
  for (const entry of entries) {
    const patch = ocrEnrichmentForWindow(entry.startTs, entry.endTs, date);
    if (!patch) continue;
    let hit = false;
    if (!entry.output && patch.output) {
      entry.output = patch.output.name;
      entry.outputType = patch.output.type;
      hit = true;
    }
    if (!entry.subject && patch.subject) {
      entry.subject = patch.subject.name;
      entry.subjectType = patch.subject.type;
      hit = true;
    }
    if (!entry.contentTag && patch.contentTag) {
      entry.contentTag = patch.contentTag.category;
      hit = true;
    }
    if (hit && !entry.dataSource.includes("ocr")) entry.dataSource.push("ocr");
  }
}

// src/main/report/patterns.ts
init_stateMeta();
init_trail();
init_db();
var PEAK_THRESHOLD = 60;
var DIP_THRESHOLD = 40;
function hourOf(seg) {
  return new Date(seg.startTs).getHours();
}
function dayMinOf(seg) {
  const d = new Date(seg.startTs);
  return d.getHours() * 60 + d.getMinutes();
}
function avg(xs) {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function stddev(xs) {
  if (xs.length < 2) return 0;
  const m = avg(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / xs.length);
}
function consistencyOf(xs) {
  if (xs.length < 2) return xs.length === 1 ? 1 : 0;
  return Math.round((1 - Math.min(stddev(xs) / 60, 1)) * 100) / 100;
}
var pad2 = (n) => `${n}`.padStart(2, "0");
var minToSlot = (startMin, endMin) => `${pad2(Math.floor(startMin / 60))}:${pad2(startMin % 60)}-${pad2(Math.floor(endMin / 60))}:${pad2(endMin % 60)}`;
function dayFocusScore(trail) {
  const work = WORK_LIKE_STATES.reduce((a, s) => a + (trail.stateMinutes[s] ?? 0), 0);
  return trail.totalMin > 0 ? work / trail.totalMin * 100 : 0;
}
function detectPatterns(dates) {
  const trails = dates.map((d) => buildMergedTrail(listActivities(d), d)).filter((t) => t.totalMin > 0);
  if (trails.length < 3) return null;
  const hourWork = new Array(24).fill(0);
  const hourTotal = new Array(24).fill(0);
  const hourStates = new Array(24);
  for (let h = 0; h < 24; h++) hourStates[h] = /* @__PURE__ */ new Map();
  for (const trail of trails) {
    for (const seg of trail.segments) {
      if (seg.glance) continue;
      const h = hourOf(seg);
      hourTotal[h] += seg.durationMin;
      if (WORK_LIKE_STATES.includes(seg.mainState)) hourWork[h] += seg.durationMin;
      hourStates[h].set(seg.mainState, (hourStates[h].get(seg.mainState) ?? 0) + seg.durationMin);
    }
  }
  const hourScore = hourWork.map((w, h) => hourTotal[h] > 0 ? w / hourTotal[h] * 100 : -1);
  const topStateOf = (hours) => {
    const acc = /* @__PURE__ */ new Map();
    for (const h of hours) for (const [st, m] of hourStates[h]) acc.set(st, (acc.get(st) ?? 0) + m);
    const top = [...acc.entries()].sort((a, b) => b[1] - a[1])[0];
    return top?.[0] ?? "focus";
  };
  const peakHours = [];
  const dipHours = [];
  let run = [];
  const flushPeak = () => {
    if (run.length >= 3) {
      peakHours.push({
        slot: minToSlot(run[0] * 60, (run[run.length - 1] + 1) * 60),
        avgFocusScore: Math.round(avg(run.map((h) => hourScore[h]))),
        primaryState: topStateOf(run),
        confidence: Math.min(1, Math.round(trails.length / 7 * 100) / 100)
        // 历史天数越多越可信
      });
    }
    run = [];
  };
  for (let h = 0; h < 24; h++) {
    if (hourScore[h] > PEAK_THRESHOLD) run.push(h);
    else flushPeak();
  }
  flushPeak();
  let dipRun = [];
  const flushDip = () => {
    if (dipRun.length >= 2) {
      const slackMin = dipRun.reduce((a, h) => a + (hourStates[h].get("slack") ?? 0) + (hourStates[h].get("relax") ?? 0), 0);
      const meetingMin = dipRun.reduce((a, h) => a + (hourStates[h].get("meeting") ?? 0), 0);
      dipHours.push({
        slot: minToSlot(dipRun[0] * 60, (dipRun[dipRun.length - 1] + 1) * 60),
        avgFocusScore: Math.round(avg(dipRun.map((h) => hourScore[h]))),
        primaryReason: slackMin >= meetingMin && slackMin > 0 ? "slack" : meetingMin > 0 ? "meeting" : "fragmented",
        confidence: Math.min(1, Math.round(trails.length / 7 * 100) / 100)
      });
    }
    dipRun = [];
  };
  for (let h = 0; h < 24; h++) {
    if (hourScore[h] >= 0 && hourScore[h] < DIP_THRESHOLD) dipRun.push(h);
    else flushDip();
  }
  flushDip();
  const workStarts = [];
  const workEnds = [];
  for (const trail of trails) {
    const workSegs = trail.segments.filter((s) => !s.glance && WORK_LIKE_STATES.includes(s.mainState));
    if (workSegs.length > 0) {
      workStarts.push(dayMinOf(workSegs[0]));
      workEnds.push(dayMinOf(workSegs[workSegs.length - 1]) + workSegs[workSegs.length - 1].durationMin);
    }
  }
  const workStartAvg = Math.round(avg(workStarts));
  const workEndAvg = Math.round(avg(workEnds));
  let totalSwitches = 0;
  let totalSegs = 0;
  let totalSegMin = 0;
  for (const trail of trails) {
    const segs = trail.segments.filter((s) => !s.glance);
    totalSegs += segs.length;
    totalSegMin += segs.reduce((a, s) => a + s.durationMin, 0);
    for (let i = 1; i < segs.length; i++) {
      if (segs[i].mainApp !== segs[i - 1].mainApp) totalSwitches++;
    }
  }
  const dailySwitches = totalSwitches / trails.length;
  const avgSegmentLength = totalSegs > 0 ? totalSegMin / totalSegs : 0;
  const switchScore = Math.min(dailySwitches / 50, 1) * 50;
  const lengthScore = Math.max(0, 1 - avgSegmentLength / 30) * 50;
  const fragmentationScore = Math.round(switchScore + lengthScore);
  const weekdayScores = Array.from({ length: 7 }, () => []);
  for (const trail of trails) {
    const wd = (/* @__PURE__ */ new Date(`${trail.date}T00:00:00`)).getDay();
    weekdayScores[wd].push(dayFocusScore(trail));
  }
  const weekdayAvg = weekdayScores.map((xs) => avg(xs));
  const bestWeekday = weekdayAvg.indexOf(Math.max(...weekdayAvg));
  const worstWeekday = weekdayAvg.indexOf(Math.min(...weekdayAvg));
  const allDayScores = trails.map(dayFocusScore);
  const weekdayConsistency = Math.round((1 - Math.min(stddev(allDayScores) / 50, 1)) * 100) / 100;
  const result = {
    peakHours,
    dipHours,
    workStartAvg,
    workEndAvg,
    workStartConsistency: consistencyOf(workStarts),
    workEndConsistency: consistencyOf(workEnds),
    fragmentationScore,
    contextSwitches: Math.round(dailySwitches),
    avgSegmentLength: Math.round(avgSegmentLength * 10) / 10,
    bestWeekday,
    worstWeekday,
    weekdayConsistency,
    patternTags: []
  };
  const tags = [];
  if (result.workStartAvg > 0 && result.workStartAvg < 9 * 60 && result.workStartConsistency > 0.7) {
    tags.push("\u6668\u578B\u4EBA");
  } else if (result.workStartAvg > 11 * 60) {
    tags.push("\u591C\u578B\u4EBA");
  }
  if (result.fragmentationScore > 60) tags.push("\u788E\u7247\u5316\u4E25\u91CD");
  else if (result.fragmentationScore < 25) tags.push("\u6DF1\u5EA6\u4E13\u6CE8\u578B");
  if (result.dipHours.some((d) => d.slot.startsWith("14") || d.slot.startsWith("13"))) tags.push("\u4E0B\u5348\u4F4E\u8C37");
  if (result.workStartConsistency > 0.8) tags.push("\u4F5C\u606F\u89C4\u5F8B");
  else if (result.workStartConsistency < 0.4) tags.push("\u4F5C\u606F\u4E0D\u89C4\u5F8B");
  result.patternTags = tags;
  return result;
}

// src/main/report/templates.ts
init_db();
var DESIGN_STATE = "design";
var PRESET_TEMPLATES = [
  // 模板1: 标准时间线日报（最通用）
  {
    id: "preset-timeline",
    name: "\u65F6\u95F4\u7EBF\u65E5\u62A5",
    type: "daily",
    source: "preset",
    sections: [
      {
        id: "overview",
        title: "\u4ECA\u65E5\u6982\u89C8",
        type: "metric_summary",
        fields: [
          { key: "totalWork", label: "\u5DE5\u4F5C\u65F6\u957F", required: true },
          { key: "focusScore", label: "\u4E13\u6CE8\u5EA6", required: true },
          { key: "slackTime", label: "\u6478\u9C7C\u65F6\u957F", required: false },
          { key: "planRate", label: "\u8BA1\u5212\u8FBE\u6210\u7387", required: false }
        ],
        repeatable: false
      },
      {
        id: "morning",
        title: "\u4E0A\u5348\u5DE5\u4F5C",
        type: "time_block",
        timeRange: { start: "06:00", end: "12:00" },
        groupBy: "time",
        sortBy: "chronological",
        fields: [
          { key: "time", label: "\u65F6\u95F4", required: true, format: "{start}-{end} ({duration})" },
          { key: "stateLabel", label: "\u7C7B\u578B", required: true },
          { key: "subject", label: "\u5BF9\u8C61", required: false, fallback: "\u2014" },
          { key: "contentTag", label: "\u5185\u5BB9", required: true },
          { key: "project", label: "\u9879\u76EE", required: false, fallback: "\u2014" },
          { key: "output", label: "\u4EA7\u51FA", required: false, fallback: "\u2014" }
        ],
        repeatable: true,
        filter: { minDuration: 5 }
      },
      {
        id: "afternoon",
        title: "\u4E0B\u5348\u5DE5\u4F5C",
        type: "time_block",
        timeRange: { start: "12:00", end: "18:00" },
        groupBy: "time",
        sortBy: "chronological",
        fields: [
          { key: "time", label: "\u65F6\u95F4", required: true, format: "{start}-{end} ({duration})" },
          { key: "stateLabel", label: "\u7C7B\u578B", required: true },
          { key: "subject", label: "\u5BF9\u8C61", required: false, fallback: "\u2014" },
          { key: "contentTag", label: "\u5185\u5BB9", required: true },
          { key: "project", label: "\u9879\u76EE", required: false, fallback: "\u2014" },
          { key: "output", label: "\u4EA7\u51FA", required: false, fallback: "\u2014" }
        ],
        repeatable: true,
        filter: { minDuration: 5 }
      },
      {
        id: "summary",
        title: "\u4ECA\u65E5\u5C0F\u7ED3",
        type: "free_text",
        fields: [{ key: "notes", label: "\u5907\u6CE8", required: false }],
        repeatable: false
      }
    ],
    usageCount: 0,
    userCorrections: 0,
    isDefault: true,
    ts: 0
  },
  // 模板2: 按项目分组日报（适合多项目并行）
  {
    id: "preset-project",
    name: "\u9879\u76EE\u5206\u7EC4\u65E5\u62A5",
    type: "daily",
    source: "preset",
    sections: [
      {
        id: "overview",
        title: "\u4ECA\u65E5\u6982\u89C8",
        type: "metric_summary",
        fields: [
          { key: "totalWork", label: "\u5DE5\u4F5C\u65F6\u957F", required: true },
          { key: "focusScore", label: "\u4E13\u6CE8\u5EA6", required: true }
        ],
        repeatable: false
      },
      {
        id: "projects",
        title: "\u9879\u76EE\u8FDB\u5C55",
        type: "project_summary",
        groupBy: "project",
        sortBy: "duration",
        fields: [
          { key: "project", label: "\u9879\u76EE", required: true },
          { key: "duration", label: "\u6295\u5165\u65F6\u957F", required: true },
          { key: "contentTag", label: "\u5DE5\u4F5C\u5185\u5BB9", required: true },
          { key: "output", label: "\u4EA7\u51FA", required: false },
          { key: "planStatus", label: "\u8BA1\u5212\u72B6\u6001", required: false }
        ],
        repeatable: true
      },
      {
        id: "meetings",
        title: "\u4F1A\u8BAE\u8BB0\u5F55",
        type: "meeting_log",
        groupBy: "time",
        filter: { states: ["meeting"] },
        fields: [
          { key: "time", label: "\u65F6\u95F4", required: true },
          { key: "subject", label: "\u4F1A\u8BAE\u4E3B\u9898", required: true },
          { key: "duration", label: "\u65F6\u957F", required: true }
        ],
        repeatable: true
      }
    ],
    usageCount: 0,
    userCorrections: 0,
    isDefault: false,
    ts: 0
  },
  // 模板3: 按状态分类日报（适合汇报型）
  {
    id: "preset-category",
    name: "\u5206\u7C7B\u65E5\u62A5",
    type: "daily",
    source: "preset",
    sections: [
      {
        id: "overview",
        title: "\u4ECA\u65E5\u6570\u636E",
        type: "metric_summary",
        fields: [
          { key: "totalWork", label: "\u603B\u5DE5\u65F6", required: true },
          { key: "focusScore", label: "\u4E13\u6CE8\u8BC4\u5206", required: true },
          { key: "slackTime", label: "\u975E\u5DE5\u4F5C\u65F6\u957F", required: false }
        ],
        repeatable: false
      },
      {
        id: "meetings",
        title: "\u4F1A\u8BAE\u6C9F\u901A",
        type: "category_group",
        filter: { states: ["meeting"] },
        fields: [
          { key: "time", label: "\u65F6\u95F4", required: true },
          { key: "subject", label: "\u5BF9\u8C61", required: true },
          { key: "contentTag", label: "\u5185\u5BB9", required: true },
          { key: "duration", label: "\u65F6\u957F", required: true }
        ],
        repeatable: true
      },
      {
        id: "development",
        title: "\u5F00\u53D1\u5DE5\u4F5C",
        type: "category_group",
        filter: { states: ["coding", "aidev"] },
        fields: [
          { key: "time", label: "\u65F6\u95F4", required: true },
          { key: "project", label: "\u9879\u76EE", required: true },
          { key: "contentTag", label: "\u5185\u5BB9", required: true },
          { key: "output", label: "\u4EA7\u51FA", required: false },
          { key: "duration", label: "\u65F6\u957F", required: true }
        ],
        repeatable: true
      },
      {
        id: "documents",
        title: "\u6587\u6863\u4E0E\u5199\u4F5C",
        type: "category_group",
        filter: { states: ["writing", DESIGN_STATE] },
        fields: [
          { key: "time", label: "\u65F6\u95F4", required: true },
          { key: "output", label: "\u6587\u6863", required: true },
          { key: "duration", label: "\u65F6\u957F", required: true }
        ],
        repeatable: true
      },
      {
        id: "ops",
        title: "\u8FD0\u7EF4\u4E0E\u90E8\u7F72",
        type: "category_group",
        filter: { states: ["remote"] },
        fields: [
          { key: "time", label: "\u65F6\u95F4", required: true },
          { key: "location", label: "\u76EE\u6807", required: true },
          { key: "contentTag", label: "\u64CD\u4F5C", required: true },
          { key: "duration", label: "\u65F6\u957F", required: true }
        ],
        repeatable: true
      }
    ],
    usageCount: 0,
    userCorrections: 0,
    isDefault: false,
    ts: 0
  },
  // 模板4: 简版日报（适合快速打卡）
  {
    id: "preset-simple",
    name: "\u7B80\u7248\u65E5\u62A5",
    type: "daily",
    source: "preset",
    sections: [
      {
        id: "stats",
        title: "",
        type: "metric_summary",
        fields: [
          { key: "totalWork", label: "\u5DE5\u65F6", required: true },
          { key: "focusScore", label: "\u4E13\u6CE8", required: true },
          { key: "topApp", label: "\u4E3B\u8981\u5E94\u7528", required: false },
          { key: "topProject", label: "\u4E3B\u8981\u9879\u76EE", required: false }
        ],
        repeatable: false
      },
      {
        id: "top3",
        title: "\u4ECA\u65E5Top3",
        type: "achievement",
        // 注：规格原文 groupBy:'duration'，shared 类型 groupBy 无该值；排序由 sortBy 承担
        sortBy: "duration",
        fields: [
          { key: "contentTag", label: "\u5DE5\u4F5C\u5185\u5BB9", required: true },
          { key: "duration", label: "\u65F6\u957F", required: true }
        ],
        repeatable: true,
        filter: { minDuration: 15 }
      }
    ],
    usageCount: 0,
    userCorrections: 0,
    isDefault: false,
    ts: 0
  }
];
function getDefaultTemplate() {
  const userDefault = col("reportTemplates").find((t) => t.isDefault);
  return userDefault ?? PRESET_TEMPLATES[0];
}
function findTemplate(id) {
  return PRESET_TEMPLATES.find((t) => t.id === id) ?? col("reportTemplates").find((t) => t.id === id) ?? null;
}

// src/main/report/aiEnhancement.ts
init_settings();

// src/main/state.ts
var import_events2 = require("events");
init_settings();
var clamp1 = (n) => Math.min(1, Math.max(-1, n));
var PAD_BY_STATE = {
  focus: { p: 0.5, a: 0.3, d: 0.4 },
  coding: { p: 0.55, a: 0.4, d: 0.5 },
  aidev: { p: 0.6, a: 0.45, d: 0.5 },
  aiqa: { p: 0.5, a: 0.35, d: 0.3 },
  writing: { p: 0.45, a: 0.25, d: 0.35 },
  meeting: { p: 0.3, a: 0.4, d: 0.2 },
  remote: { p: 0.3, a: 0.35, d: 0.2 },
  slack: { p: 0.35, a: 0.5, d: -0.2 },
  relax: { p: 0.55, a: 0.1, d: -0.1 },
  idle: { p: 0.1, a: -0.2, d: -0.2 },
  break: { p: 0.5, a: -0.1, d: 0 },
  lunch: { p: 0.5, a: -0.1, d: 0 },
  away: { p: 0, a: -0.5, d: -0.3 }
};
var StateBus = class extends import_events2.EventEmitter {
  pet;
  question = null;
  lastPresence = null;
  constructor() {
    super();
    const s = getSettings();
    this.pet = {
      workState: "idle",
      emotion: { pleasure: 0.2, arousal: 0.2, dominance: 0 },
      energy: 1,
      intimacy: 1,
      message: null,
      characterId: s.petCharacter || "ling",
      visible: s.petEnabled
    };
    presence.on("update", (snap) => {
      this.lastPresence = snap;
      const pad = PAD_BY_STATE[snap.state] ?? { p: 0.2, a: 0.2, d: 0 };
      let emotion = { pleasure: pad.p, arousal: pad.a, dominance: pad.d };
      if (getSettings().scorePetAdapt) {
        const { padOffset } = getScoreStrategy();
        emotion = {
          pleasure: clamp1(emotion.pleasure + padOffset.p),
          arousal: clamp1(emotion.arousal + padOffset.a),
          dominance: clamp1(emotion.dominance + padOffset.d)
        };
      }
      this.pet = {
        ...this.pet,
        workState: snap.state,
        emotion
      };
      this.emit("presence", snap);
      this.emit("desktop-state", this.desktopState());
      this.emit("pet", this.pet);
    });
  }
  setPet(patch) {
    this.pet = { ...this.pet, ...patch };
    this.emit("pet", this.pet);
    this.emit("desktop-state", this.desktopState());
    return this.pet;
  }
  setQuestion(q) {
    this.question = q;
    this.emit("question", q);
  }
  desktopState() {
    const snap = this.lastPresence ?? presence.getSnapshot();
    return {
      ts: Date.now(),
      presence: snap,
      pet: this.pet,
      todayMin: 0,
      // 由 integration 广播前填充（避免循环依赖）
      planAchievement: null
    };
  }
};
var bus = new StateBus();

// src/main/ai.ts
init_types();
init_stateMeta();
init_trail();
init_db();
init_settings();

// src/main/qa/questionGenerator.ts
init_db();
init_settings();
init_types();

// src/main/desensitize.ts
init_types();
init_db();

// src/main/persona.ts
init_stateMeta();
init_trail();

// src/shared/personaMeta.ts
function fieldFilled(f) {
  return !!f && (f.userConfirmed || f.confidence >= 0.3);
}
function completenessOf(p) {
  let score = 0;
  if (p.basicInfo.nickname) score += 0.05;
  if (p.basicInfo.userType) score += 0.05;
  if (p.basicInfo.timezone) score += 0.05;
  if (fieldFilled(p.identity.occupation)) score += 0.04;
  if (fieldFilled(p.identity.industry)) score += 0.04;
  if (fieldFilled(p.identity.experienceLevel)) score += 0.04;
  if (fieldFilled(p.identity.workMode)) score += 0.03;
  if (fieldFilled(p.preferences.workStyle)) score += 0.03;
  if (fieldFilled(p.preferences.communicationStyle)) score += 0.03;
  if (fieldFilled(p.preferences.interventionTolerance)) score += 0.04;
  if (p.behavioral.dailyRhythm.peakHours.length > 0) score += 0.1;
  if (p.behavioral.appUsagePattern.primaryApps.length > 0) score += 0.1;
  if (p.interests.detectedInterests.length > 0) score += 0.05;
  if (p.interests.hobbies.length > 0 || p.interests.learningTopics.length > 0) score += 0.05;
  if (p.capabilities.skillTags.length > 0) score += 0.1;
  if (p.psychological.confidence > 0.5) score += 0.1;
  if (p.relationship.totalInteractions > 10) score += 0.1;
  return Math.round(score * 100);
}

// src/main/persona.ts
init_db();
init_settings();
function buildDefaultPersona() {
  const now = Date.now();
  const acts = listActivitiesRange(0, now);
  const days = new Set(acts.map((a) => dateKey(a.ts)));
  const registrationTs = acts.length ? Math.min(...acts.map((a) => a.ts)) : now;
  const intimacy = bus.pet.intimacy;
  return {
    id: "me",
    // 单机版固定 id
    completeness: 0,
    lastUpdated: now,
    basicInfo: {
      nickname: "\u6211",
      userType: effectiveUserType(),
      avatarId: "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
      language: "zh-CN",
      // 主进程无 navigator，单机版固定中文
      registrationTs,
      daysActive: days.size
    },
    identity: {},
    preferences: {},
    behavioral: {
      dailyRhythm: { peakHours: [], lowEnergyHours: [], averageStart: "", averageEnd: "", weekendPattern: "mixed" },
      appUsagePattern: { primaryApps: [], appSwitchFrequency: 0, deepWorkAppCategories: [], distractionAppCategories: [] },
      focusStreakHistory: { bestStreak: 0, avgDailyFocusMin: 0, focusTrend: "stable" }
    },
    interests: { detectedInterests: [], learningTopics: [], hobbies: [] },
    capabilities: { skillTags: [], learningGoals: [] },
    psychological: {
      stressTolerance: 0,
      motivationType: "mixed",
      attentionStyle: "sustained",
      energyCycle: "morning",
      burnoutRisk: 0,
      resilienceScore: 0,
      confidence: 0,
      lastAnalyzed: 0
    },
    relationship: {
      intimacyLevel: intimacy,
      intimacyScore: intimacy * 20,
      // 等级 ×20 简化折算百分制
      daysTogether: days.size,
      totalInteractions: 0,
      interactionPattern: { avgDailyInteractions: 0, responseRate: 0, dismissRate: 0 },
      emotionalHistory: { dominantEmotions: [], emotionStability: 0, recentTrend: "neutral" }
    },
    // 规格 §2.2 中 L3 默认关闭；本地单机务实取舍：数据不出本机，默认全开，
    // 用户可在设置里逐层关闭（L4 永远关闭，不建模开关）
    privacySettings: { aiAccess: { L0: true, L1: true, L2: true, L3: true } },
    ts: now
  };
}
function savePersona(p) {
  const next = { ...p, completeness: completenessOf(p), lastUpdated: Date.now() };
  updateIn("personas", "me", next);
  return next;
}
function getPersona() {
  const p = col("personas").find((x) => x.id === "me");
  if (!p) {
    const created = buildDefaultPersona();
    insertInto("personas", created);
    return savePersona(created);
  }
  return savePersona(p);
}

// src/main/desensitize.ts
var DAY_MS = 864e5;
var FIELD_LAYER = {
  basicInfo: "L0",
  identity: "L1",
  preferences: "L1",
  behavioral: "L2",
  interests: "L2",
  capabilities: "L2",
  psychological: "L3",
  relationship: "L3"
};
var LAYER_FIELDS = {
  L0: ["basicInfo"],
  L1: ["identity", "preferences"],
  L2: ["behavioral", "interests", "capabilities"],
  L3: ["psychological", "relationship"]
};
function fieldState(f) {
  if (!f) return "skip";
  if (f.userConfirmed) return "ok";
  if (f.confidence < 0.3) return "skip";
  return f.confidence < 0.5 ? "maybe" : "ok";
}
function buildL0(p) {
  return [
    { field: "basicInfo.userType", value: `\u4F60\u662F${USER_TYPE_META[p.basicInfo.userType].label}\u7528\u6237` },
    { field: "basicInfo.daysActive", value: `\u4F60\u5DF2\u4F7F\u7528 WorkOn ${p.basicInfo.daysActive} \u5929` }
  ];
}
var EXP_DESC = {
  junior: (o) => `\u521D\u5165\u884C\u7684${o}`,
  mid: (o) => `\u6709\u51E0\u5E74\u7ECF\u9A8C\u7684\u4E2D\u7EA7${o}`,
  senior: (o) => `\u8D44\u6DF1${o}`,
  expert: (o) => `\u4E13\u5BB6\u7EA7${o}`
};
var WORK_MODE_LABEL = { office: "\u5750\u73ED", remote: "\u8FDC\u7A0B", hybrid: "\u6DF7\u5408" };
var WORKSTYLE_DESC = { pomodoro: "\u756A\u8304\u949F\u5DE5\u4F5C\u6CD5", flow: "\u5FC3\u6D41\u5F0F\u6DF1\u5EA6\u5DE5\u4F5C", flexible: "\u5F39\u6027\u5DE5\u4F5C\u8282\u594F", structured: "\u7ED3\u6784\u5316\u8BA1\u5212\u5DE5\u4F5C" };
var COMM_DESC = { direct: "\u76F4\u63A5\u7B80\u6D01", encouraging: "\u9F13\u52B1\u5F0F", minimal: "\u5C11\u6253\u6270" };
var TOLERANCE_DESC = { high: "\u53EF\u4EE5\u63A5\u53D7\u8F83\u9AD8\u7684\u5E72\u9884\u9891\u7387", medium: "\u5E0C\u671B\u4FDD\u6301\u9002\u5EA6\u7684\u5E72\u9884", low: "\u5E0C\u671B\u5C3D\u91CF\u5C11\u88AB\u6253\u6270" };
function buildIdentity(p) {
  const out = [];
  const id = p.identity;
  const occ = fieldState(id.occupation);
  const exp = fieldState(id.experienceLevel);
  if (occ !== "skip" && id.occupation) {
    const maybe = occ === "maybe" || exp === "maybe" ? "\u53EF\u80FD" : "";
    const desc = exp !== "skip" && id.experienceLevel ? EXP_DESC[id.experienceLevel.value](id.occupation.value) : id.occupation.value;
    out.push({ field: "identity.occupation", value: `\u4F60${maybe}\u662F${desc}` });
  }
  const ind = fieldState(id.industry);
  if (ind !== "skip" && id.industry) {
    out.push({ field: "identity.industry", value: `\u4F60${ind === "maybe" ? "\u53EF\u80FD" : ""}\u5728${id.industry.value}\u884C\u4E1A\u5DE5\u4F5C` });
  }
  const wm = fieldState(id.workMode);
  if (wm !== "skip" && id.workMode) {
    out.push({ field: "identity.workMode", value: `\u4F60\u7684\u5DE5\u4F5C\u6A21\u5F0F${wm === "maybe" ? "\u53EF\u80FD" : ""}\u662F${WORK_MODE_LABEL[id.workMode.value]}` });
  }
  return out;
}
function buildPreferences(p) {
  const out = [];
  const pref = p.preferences;
  const ws = fieldState(pref.workStyle);
  if (ws !== "skip" && pref.workStyle) {
    out.push({ field: "preferences.workStyle", value: `\u4F60${ws === "maybe" ? "\u53EF\u80FD" : ""}\u504F\u597D${WORKSTYLE_DESC[pref.workStyle.value]}` });
  }
  const cs = fieldState(pref.communicationStyle);
  if (cs !== "skip" && pref.communicationStyle) {
    out.push({ field: "preferences.communicationStyle", value: `\u4F60\u7684\u6C9F\u901A\u504F\u597D${cs === "maybe" ? "\u53EF\u80FD" : ""}\u662F${COMM_DESC[pref.communicationStyle.value]}` });
  }
  const it = fieldState(pref.interventionTolerance);
  if (it !== "skip" && pref.interventionTolerance) {
    out.push({ field: "preferences.interventionTolerance", value: `\u4F60${it === "maybe" ? "\u53EF\u80FD" : ""}${TOLERANCE_DESC[pref.interventionTolerance.value]}` });
  }
  if (pref.preferredWorkHours?.start && pref.preferredWorkHours.end) {
    out.push({ field: "preferences.preferredWorkHours", value: `\u4F60\u7684\u504F\u597D\u5DE5\u4F5C\u65F6\u6BB5\u662F ${pref.preferredWorkHours.start}-${pref.preferredWorkHours.end}` });
  }
  return out;
}
function buildBehavioral(p) {
  const out = [];
  const b = p.behavioral;
  if (b.dailyRhythm.peakHours.length) {
    out.push({ field: "behavioral.peakHours", value: `\u4F60\u7684\u9AD8\u6548\u65F6\u6BB5\u96C6\u4E2D\u5728${b.dailyRhythm.peakHours.join("\u3001")}` });
  }
  if (b.appUsagePattern.primaryApps.length) {
    const focusH = Math.round(b.focusStreakHistory.avgDailyFocusMin / 60 * 10) / 10;
    out.push({ field: "behavioral.appUsage", value: `\u4F60\u4E3B\u8981\u4F7F\u7528${b.appUsagePattern.primaryApps[0].category}\u7C7B\u5E94\u7528\u5DE5\u4F5C\uFF0C\u65E5\u5747\u4E13\u6CE8\u7EA6${focusH}\u5C0F\u65F6` });
  }
  if (b.dailyRhythm.weekendPattern === "work") {
    out.push({ field: "behavioral.weekend", value: "\u4F60\u5468\u672B\u901A\u5E38\u4E5F\u4FDD\u6301\u5DE5\u4F5C\u8282\u594F" });
  }
  return out;
}
function buildInterests(p) {
  const out = [];
  const tags = p.interests.detectedInterests.filter((d) => d.userConfirmed || d.confidence >= 0.3).sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  if (tags.length) {
    const maybe = tags.every((t) => !t.userConfirmed && t.confidence < 0.5) ? "\u53EF\u80FD" : "";
    out.push({ field: "interests.tags", value: `\u4F60${maybe}\u5BF9${tags.map((t) => t.tag).join("\u3001")}\u9886\u57DF\u6709\u5173\u6CE8` });
  }
  const learning = p.interests.learningTopics.find((t) => t.progress === "learning" || t.progress === "exploring");
  if (learning) out.push({ field: "interests.learning", value: `\u4F60\u6700\u8FD1\u5728\u5B66\u4E60${learning.topic}` });
  return out;
}
function buildCapabilities(p) {
  const skills = p.capabilities.skillTags.filter((s) => s.userConfirmed || s.confidence >= 0.3).sort((a, b) => b.proficiency - a.proficiency).slice(0, 3);
  if (!skills.length) return [];
  const parts = skills.map((s) => s.proficiency >= 60 ? `\u64C5\u957F${s.name}` : s.proficiency >= 30 ? `\u6709${s.name}\u57FA\u7840` : `\u63A5\u89E6\u8FC7${s.name}`);
  const maybe = skills.every((s) => !s.userConfirmed && s.confidence < 0.5) ? "\u53EF\u80FD" : "";
  return [{ field: "capabilities.skills", value: `\u4F60${maybe}${parts.join("\uFF0C")}` }];
}
function buildPsyStrategy(p) {
  const psy = p.psychological;
  if (psy.confidence <= 0) return null;
  const d = {};
  if (psy.burnoutRisk >= 60) {
    d.suggestBreak = true;
    d.avoidChallenge = true;
  }
  if (psy.stressTolerance < 40) {
    d.reduceIntervention = true;
    d.increaseGentleness = 0.3;
  }
  return Object.keys(d).length ? JSON.stringify(d) : null;
}
function buildRelStrategy(p) {
  const rel = p.relationship;
  const d = { intimacyLevel: rel.intimacyLevel };
  if (rel.interactionPattern.dismissRate > 0.5) d.reduceIntervention = true;
  if (rel.emotionalHistory.recentTrend === "negative") d.recentNegativeTrend = true;
  return JSON.stringify(d);
}
function requestPersonaData(req) {
  const p = getPersona();
  const now = Date.now();
  const fields = req.fields.length ? req.fields : req.layers.flatMap((l) => LAYER_FIELDS[l] ?? []);
  const data2 = [];
  let firstLogId = "";
  const log = (layer, field, ruleApplied, output) => {
    const id = genId("log");
    insertInto("accessLogs", {
      id,
      ts: now,
      requester: req.requester,
      layer,
      fields: [field],
      desensitized: ruleApplied !== "raw" && ruleApplied !== "denied",
      ruleApplied,
      output: output.slice(0, 200)
    });
    if (!firstLogId) firstLogId = id;
    return id;
  };
  if (req.layers.includes("L4")) log("L4", req.fields.join(",") || "*", "denied", "");
  for (const f of new Set(fields)) {
    const layer = FIELD_LAYER[f];
    if (!layer || layer === "L4") continue;
    if (!req.layers.includes(layer)) continue;
    if (p.privacySettings.aiAccess[layer] === false) {
      log(layer, f, "denied", "");
      continue;
    }
    let entries = [];
    let rule = "raw";
    switch (f) {
      case "basicInfo":
        entries = buildL0(p);
        rule = "raw";
        break;
      case "identity":
        entries = buildIdentity(p);
        rule = "summary";
        break;
      case "preferences":
        entries = buildPreferences(p);
        rule = "summary";
        break;
      case "behavioral":
        entries = buildBehavioral(p);
        rule = "aggregation";
        break;
      case "interests":
        entries = buildInterests(p);
        rule = "aggregation";
        break;
      case "capabilities":
        entries = buildCapabilities(p);
        rule = "aggregation";
        break;
      case "psychological": {
        const s = buildPsyStrategy(p);
        if (s) entries = [{ field: "psychological.strategy", value: s }];
        rule = "strategy_directive";
        break;
      }
      case "relationship": {
        const s = buildRelStrategy(p);
        if (s) entries = [{ field: "relationship.strategy", value: s }];
        rule = "strategy_directive";
        break;
      }
      default:
        break;
    }
    for (const e of entries) {
      const logId = log(layer, e.field, rule, e.value);
      data2.push({ layer, field: e.field, logId, summary: e.value, value: e.value });
    }
  }
  const cutoff = now - 30 * DAY_MS;
  const logs = col("accessLogs");
  for (let i = logs.length - 1; i >= 0; i--) if (logs[i].ts < cutoff) logs.splice(i, 1);
  return { granted: data2.length > 0, data: data2, logId: firstLogId };
}

// src/main/ai.ts
var MODEL_COST_PER_1K = {
  "gpt-4o-mini": 3e-4,
  "gpt-4o": 5e-3,
  default: 1e-3
};
function trackUsage(model, tokens, isQA) {
  const date = dateKey(Date.now());
  const usages = col("usages");
  const found = usages.find((u) => u.date === date && u.model === model);
  const cost = tokens / 1e3 * (MODEL_COST_PER_1K[model] ?? MODEL_COST_PER_1K.default);
  if (found) {
    updateIn("usages", found.id, {
      tokens: found.tokens + tokens,
      qaCount: found.qaCount + (isQA ? 1 : 0),
      costUsd: found.costUsd + cost
    });
  } else {
    insertInto("usages", { id: genId("usage"), date, model, tokens, qaCount: isQA ? 1 : 0, costUsd: cost });
  }
}
async function llmChat(messages, timeoutMs = 45e3) {
  const s = getSettings();
  if (!s.aiEnabled || !s.aiApiKey) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${s.aiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.aiApiKey}` },
      body: JSON.stringify({ model: s.aiModel, messages, temperature: 0.4 }),
      signal: ctrl.signal
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    trackUsage(s.aiModel, json.usage?.total_tokens ?? 800, false);
    return json.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (e) {
    console.warn("[ai] LLM \u8C03\u7528\u5931\u8D25\uFF0C\u56DE\u9000\u89C4\u5219\u5206\u6790:", e.message);
    return null;
  } finally {
    clearTimeout(t);
  }
}
function extractJson(text) {
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const trimmed = text.trim();
  const direct = tryParse(trimmed);
  if (direct !== null) return direct;
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  if (unfenced !== trimmed) {
    const fenced = tryParse(unfenced);
    if (fenced !== null) return fenced;
  }
  const iArr = trimmed.indexOf("[");
  const iObj = trimmed.indexOf("{");
  if (iArr !== -1 && (iObj === -1 || iArr < iObj)) {
    const j = trimmed.lastIndexOf("]");
    if (j > iArr) return tryParse(trimmed.slice(iArr, j + 1));
  } else if (iObj !== -1) {
    const j = trimmed.lastIndexOf("}");
    if (j > iObj) return tryParse(trimmed.slice(iObj, j + 1));
  }
  return null;
}

// src/main/report/aiEnhancement.ts
var CACHE_TTL = 36e5;
var cache = /* @__PURE__ */ new Map();
function fingerprint(entries) {
  const s = entries.map((e) => `${e.id}:${e.confidence}`).join("|");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i) | 0;
  return h.toString(36);
}
function collectPending(entries) {
  return entries.filter((e) => e.confidence < 0.6 || !e.contentSummary || !e.output);
}
var pad22 = (n) => `${n}`.padStart(2, "0");
var hhmm = (ts) => {
  const d = new Date(ts);
  return `${pad22(d.getHours())}:${pad22(d.getMinutes())}`;
};
function buildPrompt(batch, ctx) {
  let persona = "\uFF08\u6682\u65E0\u753B\u50CF\u6570\u636E\uFF09";
  try {
    const { data: data2 } = requestPersonaData({
      requester: "report",
      layers: ["L0", "L1", "L2"],
      fields: [],
      intent: "report_enrich"
    });
    if (data2.length) persona = data2.map((d) => d.value).join("\uFF1B");
  } catch {
  }
  const planLines = ctx.plans.length ? ctx.plans.map((p) => `- ${p.title}`).join("\n") : "\uFF08\u4ECA\u65E5\u65E0\u8BA1\u5212\uFF09";
  const vocab = ctx.industryVocab;
  const vocabLines = vocab ? `\u884C\u4E1A\uFF1A${vocab.industryName}
\u5BF9\u8C61\u8BCD\uFF1A${vocab.keywords.subjectPatterns.join("\u3001")}
\u9879\u76EE\u8BCD\uFF1A${vocab.keywords.projectPatterns.join("\u3001")}
\u4F4D\u7F6E\u8BCD\uFF1A${vocab.keywords.locationPatterns.join("\u3001")}
\u4EA7\u51FA\u8BCD\uFF1A${vocab.keywords.outputPatterns.join("\u3001")}` : "\uFF08\u65E0\u884C\u4E1A\u8BCD\u5E93\uFF09";
  const segLines = batch.map((e) => {
    const dims = [
      e.subject && `\u5BF9\u8C61=${e.subject}`,
      e.contentTag && `\u7C7B\u522B=${e.contentTag}`,
      e.contentSummary && `\u6458\u8981=${e.contentSummary}`,
      e.project && `\u9879\u76EE=${e.project}`,
      e.location && `\u4F4D\u7F6E=${e.location}`,
      e.output && `\u4EA7\u51FA=${e.output}`
    ].filter(Boolean).join("\uFF0C");
    return `- id=${e.id}\uFF5C\u65F6\u95F4=${hhmm(e.startTs)}-${hhmm(e.endTs)}\uFF08${Math.round(e.durationMin)}\u5206\u949F\uFF09\uFF5C\u5E94\u7528=${e.app ?? "\u672A\u77E5"}\uFF5C\u6807\u9898=${e.stateLabel}${dims ? `\uFF5C\u5DF2\u6709\uFF1A${dims}` : ""}`;
  }).join("\n");
  return `\u4F60\u662F\u4E00\u4E2A\u529E\u516C\u884C\u4E3A\u5206\u6790\u52A9\u624B\u3002\u6839\u636E\u4EE5\u4E0B\u539F\u59CB\u76D1\u63A7\u6570\u636E\uFF0C\u63A8\u65AD\u6BCF\u4E2A\u65F6\u95F4\u6BB5\u7684\u8BE6\u7EC6\u4FE1\u606F\u3002

## \u7528\u6237\u753B\u50CF
${persona}

## \u4ECA\u65E5\u8BA1\u5212
${planLines}

## \u884C\u4E1A\u8BCD\u5E93
${vocabLines}

## \u5F85\u5BCC\u5316\u7684\u65F6\u95F4\u6BB5\u6570\u636E
${segLines}

## \u63A8\u65AD\u89C4\u5219
1. \u4ECE\u7A97\u53E3\u6807\u9898\u4E2D\u63D0\u53D6\u5BF9\u8C61\u540D\uFF08\u4EBA\u540D/\u5BA2\u6237\u540D/\u56E2\u961F\u540D\uFF09
2. \u4ECE\u5E94\u7528\u7EC4\u5408\u63A8\u65AD\u5DE5\u4F5C\u5185\u5BB9\u7C7B\u522B
3. \u4ECE\u6587\u4EF6\u8DEF\u5F84\u63A8\u65AD\u9879\u76EE\u540D
4. \u4ECE\u7EC8\u7AEF\u547D\u4EE4\u63A8\u65AD\u64CD\u4F5C\u76EE\u6807\u548C\u4F4D\u7F6E
5. \u6BCF\u4E2A\u63A8\u65AD\u6807\u6CE8\u7F6E\u4FE1\u5EA6(0-1)\uFF0C\u4F4E\u4E8E0.6\u7684\u6807\u8BB0\u4E3A"\u9700\u786E\u8BA4"
6. \u4E0D\u8981\u731C\u6D4B\u5177\u4F53\u5185\u5BB9\u7EC6\u8282\uFF0C\u53EA\u505A\u7C7B\u522B\u7EA7\u63A8\u65AD

## \u8F93\u51FA\u683C\u5F0F
\u53EA\u8F93\u51FA JSON \u6570\u7EC4\uFF0C\u4E0D\u8981\u4EFB\u4F55\u5176\u4ED6\u6587\u5B57\u3002\u6BCF\u4E2A\u5143\u7D20\u5BF9\u5E94\u4E00\u4E2A\u65F6\u95F4\u6BB5\uFF1A
[{"id":"\u6761\u76EEid","subject":"\u5BF9\u8C61","contentTag":"\u5185\u5BB9\u7C7B\u522B","contentSummary":"\u4E00\u53E5\u8BDD\u6458\u8981","project":"\u9879\u76EE\u540D","location":"\u4F4D\u7F6E","output":"\u4EA7\u51FA","confidence":0.0-1.0}]
\u65E0\u6CD5\u63A8\u65AD\u7684\u5B57\u6BB5\u7701\u7565\u8BE5\u952E\uFF1B\u65E0\u6CD5\u63A8\u65AD\u7684\u6761\u76EE\u6574\u6761\u7701\u7565\u3002`;
}
var FIVE_DIM_KEYS = ["subject", "contentTag", "project", "location", "output"];
function mergeAIItem(entry, item) {
  const locked = entry.confidence >= 0.8;
  for (const k of FIVE_DIM_KEYS) {
    const v = item[k];
    if (typeof v !== "string" || !v.trim()) continue;
    if (!entry[k]) entry[k] = v.trim();
    else if (!locked) entry[k] = v.trim();
  }
  if (!entry.contentSummary && typeof item.contentSummary === "string" && item.contentSummary.trim()) {
    entry.contentSummary = item.contentSummary.trim();
  }
  const aiConf = typeof item.confidence === "number" ? Math.min(1, Math.max(0, item.confidence)) : 0.6;
  entry.confidence = Math.max(entry.confidence, aiConf);
  entry.needsReview = entry.confidence < 0.6;
  if (!entry.dataSource.includes("ai_inferred")) entry.dataSource.push("ai_inferred");
}
async function enhanceWithAI(entries, ctx) {
  const s = getSettings();
  if (!s.aiEnabled || !s.aiApiKey) return null;
  const pending = collectPending(entries);
  if (pending.length === 0) return entries;
  const cacheKey = `${ctx.date}:${fingerprint(entries)}`;
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.ts >= CACHE_TTL) cache.delete(k);
  const hit = cache.get(cacheKey);
  if (hit && now - hit.ts < CACHE_TTL) {
    return hit.result.map((e) => ({ ...e, dataSource: [...e.dataSource] }));
  }
  const working = entries.map((e) => ({ ...e, dataSource: [...e.dataSource] }));
  const byId = new Map(working.map((e) => [e.id, e]));
  for (let i = 0; i < pending.length; i += 20) {
    const batch = pending.slice(i, i + 20);
    const text = await llmChat(
      [{ role: "user", content: buildPrompt(batch, ctx) }],
      45e3
    );
    const parsed = text ? extractJson(text) : null;
    if (!parsed || !Array.isArray(parsed)) {
      console.warn("[report] AI \u589E\u5F3A\u6279\u6B21\u5931\u8D25\uFF08\u8C03\u7528\u6216\u89E3\u6790\uFF09\uFF0C\u6574\u4F53\u964D\u7EA7\u57FA\u7840\u5C42");
      return null;
    }
    for (const item of parsed) {
      if (!item || typeof item.id !== "string") continue;
      const entry = byId.get(item.id);
      if (entry) mergeAIItem(entry, item);
    }
  }
  cache.set(cacheKey, { ts: now, result: working });
  return working;
}

// src/main/report/engine.ts
var pad23 = (n) => `${n}`.padStart(2, "0");
var hhmm2 = (ts) => {
  const d = new Date(ts);
  return `${pad23(d.getHours())}:${pad23(d.getMinutes())}`;
};
var fmtDuration = (min) => {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)}h${pad23(m % 60)}m` : `${m}m`;
};
async function generateReport(date, templateId, enableAI) {
  const trail = buildMergedTrail(listActivities(date), date);
  const segments = trail.segments.filter((s) => !s.glance);
  const stats = calculateReportStats(date);
  const plans = col("plans").filter((p) => p.date === date);
  const vocab = detectIndustry(getSettings().userType, stats.appRanking.slice(0, 5).map((a) => a.app));
  const enriched = new Map(
    segments.map((s) => [s.id ?? "", enrichSegment(s, { recentPlans: plans, industryVocab: vocab })])
  );
  const entries = aggregateTrail(segments, enriched);
  attachOcrToEntries(entries, date);
  for (const entry of entries) {
    const plan = matchPlanByTime({ startTs: entry.startTs, durationMin: entry.durationMin }, plans);
    if (plan) entry.planItemId = plan.id;
  }
  const dayTimeEntries = col("entries").filter((e) => e.date === date);
  const overlays = overlayTimeEntries(segments, dayTimeEntries);
  const calendarSegIds = new Set(overlays.filter((o) => o.matchType !== "none").map((o) => o.matchedSegmentId));
  for (const entry of entries) {
    const hit = calendarSegIds.has(entry.id) || overlays.some((o) => {
      if (o.matchType === "none") return false;
      const startMin = new Date(entry.startTs).getHours() * 60 + new Date(entry.startTs).getMinutes();
      const endMin = startMin + entry.durationMin;
      return Math.min(endMin, o.entry.endMin) - Math.max(startMin, o.entry.startMin) > 0;
    });
    if (hit && !entry.dataSource.includes("calendar")) entry.dataSource.push("calendar");
  }
  const achievements = calculatePlanAchievements(segments, plans);
  const base = (/* @__PURE__ */ new Date(`${date}T00:00:00`)).getTime();
  const recentDates = Array.from({ length: 14 }, (_, i) => dateKey(base - i * 864e5));
  const patterns = detectPatterns(recentDates);
  const template = templateId && findTemplate(templateId) || getDefaultTemplate();
  const sections = fillTemplate(template, { date, entries, stats, achievements, plans });
  let finalEntries = entries;
  let aiStatus = "disabled";
  const wantAI = enableAI ?? getSettings().smartReportAI;
  if (wantAI) {
    try {
      const enhanced = await enhanceWithAI(entries, { date, stats, plans, industryVocab: vocab });
      if (enhanced) {
        finalEntries = enhanced;
        aiStatus = "enhanced";
      } else {
        aiStatus = "fallback_to_base";
      }
    } catch (e) {
      console.warn("[report] AI \u589E\u5F3A\u5F02\u5E38\uFF0C\u964D\u7EA7\u57FA\u7840\u5C42", e);
      aiStatus = "fallback_to_base";
    }
  }
  const FIELD_KEYS = [
    "subject",
    "contentTag",
    "project",
    "location",
    "output",
    "app",
    "stateLabel",
    "planItemId"
  ];
  const filled = finalEntries.reduce((a, e) => a + FIELD_KEYS.filter((k) => e[k] != null && e[k] !== "").length, 0);
  const coverage = finalEntries.length > 0 ? Math.round(filled / (finalEntries.length * FIELD_KEYS.length) * 100) / 100 : 0;
  const pendingReview = finalEntries.filter((e) => e.needsReview);
  if (template.source !== "preset") {
    updateIn("reportTemplates", template.id, {
      usageCount: template.usageCount + 1,
      lastUsed: Date.now()
    });
  }
  return {
    templateId: template.id,
    date,
    sections,
    entries: finalEntries,
    stats,
    achievements,
    patterns,
    aiStatus,
    coverage,
    pendingReview
  };
}
var COVER_FIELD_KEYS = [
  "subject",
  "contentTag",
  "project",
  "location",
  "output",
  "app",
  "stateLabel",
  "planItemId"
];
function coverageOf(entries) {
  const filled = entries.reduce((a, e) => a + COVER_FIELD_KEYS.filter((k) => e[k] != null && e[k] !== "").length, 0);
  return entries.length > 0 ? Math.round(filled / (entries.length * COVER_FIELD_KEYS.length) * 100) / 100 : 0;
}
function mergeAchievements(list) {
  const byId = /* @__PURE__ */ new Map();
  for (const a of list) {
    const prev = byId.get(a.planId);
    if (!prev) {
      byId.set(a.planId, { ...a, relatedSegmentIds: [...a.relatedSegmentIds] });
      continue;
    }
    prev.actualMin += a.actualMin;
    prev.relatedSegmentIds.push(...a.relatedSegmentIds);
    const rate = prev.plannedMin > 0 ? prev.actualMin / prev.plannedMin : 0;
    prev.achievementRate = Math.min(rate, 1);
    prev.status = rate > 1.2 ? "overtime" : rate >= 1 ? "completed" : prev.actualMin === 0 ? "missed" : "partial";
  }
  return [...byId.values()];
}
async function generateWeeklyReport(startDate, templateId, enableAI) {
  const base = (/* @__PURE__ */ new Date(`${startDate}T00:00:00`)).getTime();
  const dates = Array.from({ length: 7 }, (_, i) => dateKey(base + i * 864e5));
  const endDate = dates[dates.length - 1];
  const days = [];
  const allEntries = [];
  let templateIdUsed = templateId ?? getDefaultTemplate().id;
  let aiStatus = "disabled";
  for (const date of dates) {
    const r = await generateReport(date, templateId, enableAI);
    templateIdUsed = r.templateId;
    days.push({ date, entries: r.entries, stats: r.stats, achievements: r.achievements });
    allEntries.push(...r.entries);
    if (r.aiStatus === "enhanced") aiStatus = "enhanced";
    else if (r.aiStatus === "fallback_to_base" && aiStatus !== "enhanced") aiStatus = "fallback_to_base";
  }
  const withData = days.filter((d) => d.entries.length > 0);
  const totalWorkMin = days.reduce((a, d) => a + d.stats.totalWorkMin, 0);
  const totalSlackMin = days.reduce((a, d) => a + d.stats.totalSlackMin, 0);
  const weekStats = {
    totalWorkMin,
    totalSlackMin,
    workSlackRatio: totalSlackMin > 0 ? Math.round(totalWorkMin / totalSlackMin * 100) / 100 : totalWorkMin > 0 ? 999 : 0,
    daysWithData: withData.length,
    avgFocusScore: withData.length > 0 ? Math.round(withData.reduce((a, d) => a + d.stats.focusScore, 0) / withData.length) : 0
  };
  const endBase = (/* @__PURE__ */ new Date(`${endDate}T00:00:00`)).getTime();
  const recentDates = Array.from({ length: 14 }, (_, i) => dateKey(endBase - i * 864e5));
  const patterns = detectPatterns(recentDates);
  return {
    startDate: dates[0],
    endDate,
    templateId: templateIdUsed,
    days,
    weekStats,
    achievements: mergeAchievements(days.flatMap((d) => d.achievements)),
    patterns,
    aiStatus,
    coverage: coverageOf(allEntries),
    pendingReview: allEntries.filter((e) => e.needsReview)
  };
}
function rawValuesOf(entry, ctx) {
  const achievement = entry.planItemId ? ctx.achievements.find((a) => a.planId === entry.planItemId) : void 0;
  const planStatusLabel = achievement ? { completed: "\u5DF2\u5B8C\u6210", partial: "\u90E8\u5206\u5B8C\u6210", missed: "\u672A\u5B8C\u6210", overtime: "\u8D85\u65F6\u5B8C\u6210" }[achievement.status] : "";
  return {
    start: hhmm2(entry.startTs),
    end: hhmm2(entry.endTs),
    time: `${hhmm2(entry.startTs)}-${hhmm2(entry.endTs)} (${fmtDuration(entry.durationMin)})`,
    duration: fmtDuration(entry.durationMin),
    stateLabel: entry.stateLabel,
    app: entry.app ?? "",
    subject: entry.subject ?? "",
    contentTag: entry.contentTag ?? "",
    contentSummary: entry.contentSummary ?? "",
    project: entry.project ?? "",
    location: entry.location ?? "",
    output: entry.output ?? "",
    planStatus: planStatusLabel,
    notes: ""
  };
}
function metricValues(ctx) {
  const { stats, achievements, entries, date } = ctx;
  let planRate = 0;
  if (achievements.length > 0) {
    if (date === dateKey(Date.now())) {
      try {
        planRate = Math.round(todayScore().bonus.planAchievement * 100);
      } catch {
        planRate = Math.round(achievements.reduce((a, x) => a + x.achievementRate, 0) / achievements.length * 100);
      }
    } else {
      planRate = Math.round(achievements.reduce((a, x) => a + x.achievementRate, 0) / achievements.length * 100);
    }
  }
  const projMin = /* @__PURE__ */ new Map();
  for (const e of entries) {
    if (e.project) projMin.set(e.project, (projMin.get(e.project) ?? 0) + e.durationMin);
  }
  const topProject = [...projMin.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  return {
    totalWork: fmtDuration(stats.totalWorkMin),
    focusScore: `${stats.focusScore}\u5206`,
    slackTime: fmtDuration(stats.totalSlackMin),
    planRate: `${planRate}%`,
    topApp: stats.appRanking[0]?.app ?? "",
    topProject
  };
}
function filterEntries(section, entries) {
  let out = entries;
  const f = section.filter;
  if (f?.states?.length) out = out.filter((e) => f.states.includes(e.state));
  if (f?.timeSlot?.length) out = out.filter((e) => f.timeSlot.includes(e.timeSlot));
  if (f?.minDuration != null) out = out.filter((e) => e.durationMin >= f.minDuration);
  if (section.timeRange) {
    const [sh, sm] = section.timeRange.start.split(":").map(Number);
    const [eh, em] = section.timeRange.end.split(":").map(Number);
    const from = sh * 60 + sm;
    const to = eh * 60 + em;
    out = out.filter((e) => {
      const d = new Date(e.startTs);
      const m = d.getHours() * 60 + d.getMinutes();
      return m >= from && m < to;
    });
  }
  return out;
}
function sortEntries(section, entries) {
  const out = [...entries];
  if (section.sortBy === "duration") out.sort((a, b) => b.durationMin - a.durationMin);
  else out.sort((a, b) => a.startTs - b.startTs);
  if (section.groupBy === "project") {
    out.sort((a, b) => (a.project ?? "").localeCompare(b.project ?? ""));
    if (section.sortBy === "duration") out.sort((a, b) => b.durationMin - a.durationMin);
  }
  return out;
}
function buildGeneratedEntry(entry, section, ctx) {
  const raw = rawValuesOf(entry, ctx);
  const fieldValues = {};
  for (const field of section.fields) {
    let value = field.format ? field.format.replace(/\{(\w+)\}/g, (_, k) => raw[k] ?? "") : raw[field.key] ?? "";
    if (!value && field.fallback) value = field.fallback;
    fieldValues[field.key] = { value, confidence: entry.confidence, source: entry.dataSource.join("+") };
  }
  return { reportEntry: entry, fieldValues, needsReview: entry.needsReview };
}
function buildMetricEntry(section, ctx) {
  const metrics = metricValues(ctx);
  const fieldValues = {};
  for (const field of section.fields) {
    let value = metrics[field.key] ?? "";
    if (!value && field.fallback) value = field.fallback;
    if (value) fieldValues[field.key] = { value, confidence: 1, source: "stats" };
  }
  const stub = {
    id: `${section.id}-metrics`,
    date: ctx.date,
    startTs: (/* @__PURE__ */ new Date(`${ctx.date}T00:00:00`)).getTime(),
    endTs: (/* @__PURE__ */ new Date(`${ctx.date}T00:00:00`)).getTime(),
    durationMin: ctx.stats.totalWorkMin,
    timeSlot: "morning",
    state: "focus",
    stateLabel: "\u6982\u89C8",
    dataSource: ["auto"],
    confidence: 1,
    needsReview: false,
    ts: Date.now()
  };
  return { reportEntry: stub, fieldValues, needsReview: false };
}
function buildPlanTomorrowEntries(section, ctx) {
  const tomorrow = dateKey((/* @__PURE__ */ new Date(`${ctx.date}T00:00:00`)).getTime() + 864e5);
  const tomorrowPlans = col("plans").filter((p) => p.date === tomorrow && p.status !== "cancelled");
  const unfinished = ctx.plans.filter((p) => p.status === "planned" || p.status === "in_progress" || p.status === "partial");
  const toEntry = (p, tag) => {
    const dayBase = (/* @__PURE__ */ new Date(`${p.date}T00:00:00`)).getTime();
    const startTs = p.startMin != null ? dayBase + p.startMin * 6e4 : dayBase + 9 * 36e5;
    const dur = p.durationMin ?? (p.startMin != null && p.endMin != null ? p.endMin - p.startMin : 60);
    const stub = {
      id: p.id,
      date: p.date,
      startTs,
      endTs: startTs + dur * 6e4,
      durationMin: dur,
      timeSlot: "morning",
      state: "focus",
      stateLabel: tag,
      contentTag: p.title,
      project: p.title,
      dataSource: ["calendar"],
      confidence: 1,
      needsReview: false,
      planItemId: p.id,
      ts: Date.now()
    };
    return buildGeneratedEntry(stub, section, ctx);
  };
  return [
    ...tomorrowPlans.map((p) => toEntry(p, "\u660E\u65E5\u8BA1\u5212")),
    ...unfinished.map((p) => toEntry(p, "\u672A\u5B8C\u6210\u8BA1\u5212"))
  ];
}
function fillTemplate(template, ctx) {
  return template.sections.map((section) => {
    let genEntries = [];
    if (section.type === "metric_summary") {
      genEntries = [buildMetricEntry(section, ctx)];
    } else if (section.type === "plan_tomorrow") {
      genEntries = buildPlanTomorrowEntries(section, ctx);
    } else if (section.type === "free_text") {
      genEntries = [];
    } else {
      let pool = filterEntries(section, ctx.entries);
      pool = sortEntries(section, pool);
      if (section.type === "achievement") pool = pool.slice(0, 3);
      genEntries = pool.map((e) => buildGeneratedEntry(e, section, ctx));
    }
    const unfilledFields = section.fields.filter((f) => f.required && !f.fallback && genEntries.every((ge) => !ge.fieldValues[f.key]?.value)).map((f) => f.key);
    return { sectionId: section.id, title: section.title, entries: genEntries, unfilledFields };
  });
}

// scripts/smoke-report.ts
var fmtDate = (d) => `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
async function main() {
  initDb();
  if (process.argv[2] === "week") {
    const startDate = process.argv[3] ?? fmtDate(new Date(Date.now() - 6 * 864e5));
    const report2 = await generateWeeklyReport(startDate, void 0, false);
    console.log(
      "=== week:",
      report2.startDate,
      "~",
      report2.endDate,
      "| aiStatus:",
      report2.aiStatus,
      "| coverage:",
      report2.coverage.toFixed(2),
      "| pendingReview:",
      report2.pendingReview.length
    );
    console.log(
      "=== weekStats: work",
      Math.round(report2.weekStats.totalWorkMin),
      "min | slack",
      Math.round(report2.weekStats.totalSlackMin),
      "min | daysWithData",
      report2.weekStats.daysWithData,
      "| avgFocus",
      report2.weekStats.avgFocusScore
    );
    console.log("=== achievements:", report2.achievements.length, report2.achievements.map((a) => `${a.status}:${a.title}`).join(" | ") || "(\u65E0\u8BA1\u5212)");
    console.log("=== patterns:", report2.patterns ? report2.patterns.patternTags.join(",") + " | \u788E\u7247\u5316 " + report2.patterns.fragmentationScore : "null");
    for (const d of report2.days) {
      console.log(`  ${d.date} entries=${d.entries.length} work=${Math.round(d.stats.totalWorkMin)}m slack=${Math.round(d.stats.totalSlackMin)}m focus=${d.stats.focusScore}`);
    }
    return;
  }
  const y = new Date(Date.now() - 864e5);
  const date = process.argv[2] ?? fmtDate(y);
  const report = await generateReport(date, void 0, false);
  console.log("=== aiStatus:", report.aiStatus, "| coverage:", report.coverage.toFixed(2), "| entries:", report.entries.length, "| pendingReview:", report.pendingReview.length);
  console.log("=== stats: work", Math.round(report.stats.totalWorkMin), "min | slack", Math.round(report.stats.totalSlackMin), "min | focus", Math.round(report.stats.focusScore));
  console.log("=== achievements:", report.achievements.length, report.achievements.map((a) => `${a.status}:${a.title}`).join(" | ") || "(\u65E0\u8BA1\u5212)");
  console.log("=== patterns:", report.patterns ? report.patterns.patternTags.join(",") + " | \u788E\u7247\u5316 " + report.patterns.fragmentationScore : "null");
  console.log("=== sections:", report.sections.map((s) => `${s.title}(${s.entries.length})`).join(" "));
  for (const e of report.entries.slice(0, 12)) {
    console.log(
      `  [${e.timeSlot}] ${e.stateLabel} ${Math.round(e.durationMin)}m conf=${e.confidence.toFixed(2)} src=${e.dataSource.join("+")} | app=${e.app ?? "-"} subject=${e.subject ?? "-"} content=${e.contentTag ?? "-"} project=${e.project ?? "-"} location=${e.location ?? "-"} output=${e.output ?? "-"}${e.planItemId ? " plan\u2713" : ""}`
    );
  }
  const { buildMergedTrail: buildMergedTrail2 } = await Promise.resolve().then(() => (init_trail(), trail_exports));
  const { listActivities: listActivities2 } = await Promise.resolve().then(() => (init_db(), db_exports));
  const trail = buildMergedTrail2(listActivities2(date), date);
  console.log("=== raw segments:", trail.segments.length);
  for (const s of trail.segments.filter((s2) => !s2.glance).slice(0, 10)) {
    console.log(`  seg ${s.mainState} app=${s.mainApp ?? "-"} title=${(s.mainTitle ?? "-").slice(0, 50)}`);
  }
}
main().catch((e) => {
  console.error("SMOKE_FAIL", e);
  process.exit(1);
});
