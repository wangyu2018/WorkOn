/**
 * 预加载桥：向渲染进程暴露 window.api（contextIsolation）
 */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { AppSettings, PetState, PlanStatus } from '@shared/types'

function on<T>(channel: string) {
  return (cb: (payload: T) => void) => {
    const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

const api = {
  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:set', patch),
  setConsent: (v: 'granted' | 'declined') => ipcRenderer.invoke('consent:set', v),
  // 提醒中心（v10）
  listReminders: () => ipcRenderer.invoke('reminders:list'),
  addReminder: (input: { title: string; recurring: 'daily' | 'once'; atHHMM?: string; atTs?: number }) =>
    ipcRenderer.invoke('reminders:add', input),
  removeReminder: (id: string) => ipcRenderer.invoke('reminders:remove', id),
  onReminderFired: on<{ id: string; title: string; recurring: 'daily' | 'once'; atHHMM?: string }>('reminder:fired'),

  // 实时状态
  getPresence: () => ipcRenderer.invoke('presence:get'),
  getFocusChain: () => ipcRenderer.invoke('chain:get'),
  // 归属引擎 / 目录监控 / 状态卡（v7 项目循环）
  getAttribution: () => ipcRenderer.invoke('attr:get'),
  listBindings: () => ipcRenderer.invoke('attr:bindings'),
  bindProject: (projectId: string, patch: { apps?: string[]; keywords?: string[]; dirs?: string[] }) =>
    ipcRenderer.invoke('attr:bind', projectId, patch),
  unbindProject: (projectId: string) => ipcRenderer.invoke('attr:unbind', projectId),
  setBinding: (projectId: string, next: { apps?: string[]; keywords?: string[]; dirs?: string[] }) =>
    ipcRenderer.invoke('attr:bindSet', projectId, next),
  answerAttribution: (fp: string, answer: string, payload?: { projectId?: string; projectName?: string; apps?: string[] }) =>
    ipcRenderer.invoke('attr:answer', fp, answer, payload),
  getTodayActivity: (projectId: string) => ipcRenderer.invoke('attr:todayActivity', projectId),
  buildStatusCard: (projectId: string) => ipcRenderer.invoke('statuscard:build', projectId),
  parseStatusCard: (md: string) => ipcRenderer.invoke('statuscard:parse', md),
  applyCardDiff: (diff: unknown) => ipcRenderer.invoke('statuscard:apply', diff),
  summarizeStatusCard: (projectId: string, text: string) =>
    ipcRenderer.invoke('statuscard:summarize', projectId, text),
  toggleTodoWidget: () => ipcRenderer.invoke('todoWidget:toggle'),
  setTodoWidgetLayer: (onTop: boolean) => ipcRenderer.invoke('todoWidget:layer', onTop),
  setTodoWidgetCollapsed: (v: boolean) => ipcRenderer.invoke('todoWidget:setCollapsed', v),
  applyTodoDesktopPin: () => ipcRenderer.invoke('todoWidget:applyPin'),
  applyWidgetDesktopPin: () => ipcRenderer.invoke('widget:applyPin'),
  onTodoWidgetStyle: on<{ glass: boolean; opacity: number }>('todoWidget:style'),
  onTodoWidgetContentOpacity: on('todoWidget:content-opacity'),
  onTodoWidgetCollapsed: on<{ collapsed: boolean }>('todoWidget:collapsed'),
  onTodoWidgetDesktopPinResult: on<{ ok: boolean; reason?: string; pinned?: boolean }>('todoWidget:desktop-pin-result'),
  onAppearanceUpdate: on<{ appearanceMode?: 'auto' | 'light' | 'dark'; darkTone?: string }>('appearance:update'),
  // MotionLab 自动化（v7）
  listAutomations: () => ipcRenderer.invoke('automations:list'),
  saveAutomation: (rule: unknown) => ipcRenderer.invoke('automations:save', rule),
  removeAutomation: (id: string) => ipcRenderer.invoke('automations:remove', id),
  toggleAutomation: (id: string, enabled: boolean) => ipcRenderer.invoke('automations:toggle', id, enabled),
  // 星图逻辑层（v6）
  getStarGraph: (days?: number) => ipcRenderer.invoke('star:graph', days),
  onNotify: on('notify'),
  onWidgetPenetration: on('widget:penetration'),
  onTodoPenetration: on('todoWidget:penetration'),
  getLoadStatus: () => ipcRenderer.invoke('load:getStatus'),
  onLoadEco: on('load:eco'),
  onNotifyExpired: on('notify-expired'),
  notifyAction: (id: string, action: string) => ipcRenderer.invoke('notify:action', id, action),
  getRecentRecognition: () => ipcRenderer.invoke('recognition:recent'),
  onPresence: on('presence:update'),
  getDesktop: () => ipcRenderer.invoke('desktop:get'),

  // 天气（wttr.in，按城市名查询）
  getWeather: (city?: string) => ipcRenderer.invoke('weather:get', city),
  getWeatherNext: (hours: number, city?: string) => ipcRenderer.invoke('weather:next', hours, city),
  exportWeatherBrief: (city?: string) => ipcRenderer.invoke('weather:exportBrief', city),

  // 轨迹 / 日历 / 计划
  getTrail: (date?: string) => ipcRenderer.invoke('trail:get', date),
  updateTrail: (startTs: number, patch: { title?: string }) => ipcRenderer.invoke('trail:update', startTs, patch),
  assignSegmentPlan: (segStartTs: number, planId: string | null) => ipcRenderer.invoke('trail:assignPlan', segStartTs, planId),
  getSegmentPlans: (date?: string) => ipcRenderer.invoke('trail:getSegmentPlans', date),
  getAppVisuals: () => ipcRenderer.invoke('appVisuals:get'),
  getPerfStats: () => ipcRenderer.invoke('perf:stats'),
  listEntries: (date: string) => ipcRenderer.invoke('entries:list', date),
  saveEntry: (entry: unknown) => ipcRenderer.invoke('entries:save', entry),
  removeEntry: (id: string) => ipcRenderer.invoke('entries:remove', id),
  listPlans: (date?: string) => ipcRenderer.invoke('plans:list', date),
  savePlan: (plan: unknown) => ipcRenderer.invoke('plans:save', plan),
  removePlan: (id: string) => ipcRenderer.invoke('plans:remove', id),
  setPlanStatus: (id: string, status: PlanStatus) => ipcRenderer.invoke('plans:setStatus', id, status),
  planVsActual: (date?: string) => ipcRenderer.invoke('plans:vsActual', date),
  dedupeBurstPlans: () => ipcRenderer.invoke('plans:dedupeBurst'),

  // 粘贴分拣
  peekClipboard: () => ipcRenderer.invoke('clipboard:peek'),
  writeClipboard: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  ocrRecognizePng: (b64: string) => ipcRenderer.invoke('ocr:recognizePng', b64),
  extractPasteTodos: (text: string) => ipcRenderer.invoke('paste:extractTodos', text),

  // 知识库 / 过程
  listKnowledge: () => ipcRenderer.invoke('knowledge:list'),
  addKnowledge: (p: unknown) => ipcRenderer.invoke('knowledge:add', p),
  updateKnowledge: (id: string, patch: unknown) => ipcRenderer.invoke('knowledge:update', id, patch),
  removeKnowledge: (id: string) => ipcRenderer.invoke('knowledge:remove', id),
  sedimentMemoToKnowledge: (p: unknown) => ipcRenderer.invoke('knowledge:sedimentMemo', p),
  importKnowledgeFiles: (p?: unknown) => ipcRenderer.invoke('knowledge:importFiles', p),
  pickKnowledgeFileContent: () => ipcRenderer.invoke('knowledge:pickFileContent'),
  getOpenProcessDraft: () => ipcRenderer.invoke('process:getOpenDraft'),
  appendProcessNote: (p: unknown) => ipcRenderer.invoke('process:appendNote', p),
  suggestProcessCategory: (text: string, projectId?: string) =>
    ipcRenderer.invoke('process:suggestCategory', text, projectId),
  ensureProcessCategory: (projectId: string, name: string) =>
    ipcRenderer.invoke('process:ensureCategory', projectId, name),
  previewProcessMerge: (draftId?: string) => ipcRenderer.invoke('process:previewMerge', draftId),
  confirmProcessSediment: (p?: unknown) => ipcRenderer.invoke('process:confirmSediment', p),

  // 项目 AI 开发管理
  listProjects: () => ipcRenderer.invoke('projects:list'),
  saveProject: (p: unknown) => ipcRenderer.invoke('projects:save', p),
  removeProject: (id: string) => ipcRenderer.invoke('projects:remove', id),
  listProjectTasks: (projectId: string) => ipcRenderer.invoke('projects:tasks', projectId),
  saveProjectTask: (t: unknown) => ipcRenderer.invoke('projects:saveTask', t),
  removeProjectTask: (id: string) => ipcRenderer.invoke('projects:removeTask', id),
  aiBreakdown: (projectId: string, req: string) => ipcRenderer.invoke('projects:aiBreakdown', projectId, req),
  linkAppToProject: (projectId: string | null, app: string) => ipcRenderer.invoke('projects:linkApp', projectId, app),
  getProjectLinkedApps: () => ipcRenderer.invoke('projects:linkedApps'),
  getDayProjectLinks: (date?: string) => ipcRenderer.invoke('projects:dayLinks', date),
  getProjectLinks: (projectId: string) => ipcRenderer.invoke('projects:links', projectId),
  projectTimeForTrail: (projectId: string, trail: unknown) => ipcRenderer.invoke('projects:timeForTrail', projectId, trail),
  aiSchedule: () => ipcRenderer.invoke('projects:aiSchedule'),
  aiProjectReview: (projectId: string, trailMinutes: number) => ipcRenderer.invoke('projects:aiReview', projectId, trailMinutes),
  aiDevAdvice: (ctx: unknown) => ipcRenderer.invoke('projects:aiDevAdvice', ctx),

  // AI 分析 / 问答
  getAnalysis: (date?: string) => ipcRenderer.invoke('analysis:get', date),
  refreshAnalysis: () => ipcRenderer.invoke('analysis:refresh'),
  getTodos: () => ipcRenderer.invoke('analysis:todos'),
  getTips: () => ipcRenderer.invoke('analysis:tips'),
  askQA: (q: string) => ipcRenderer.invoke('qa:ask', q),
  askQAWithShots: (q: string, windowMin?: number) => ipcRenderer.invoke('qa:askWithShots', q, windowMin),

  // 动作库 + 积分
  motionsList: () => ipcRenderer.invoke('motions:list'),
  motionsData: (id: string) => ipcRenderer.invoke('motions:data', id),
  motionsSave: (payload: { name: string; duration: number; fps: number; data: unknown; coverDataUrl?: string; cost?: number }) =>
    ipcRenderer.invoke('motions:save', payload),
  motionsRemove: (id: string) => ipcRenderer.invoke('motions:remove', id),
  motionsSetCost: (id: string, cost: number) => ipcRenderer.invoke('motions:setCost', id, cost),
  motionsRedeem: (id: string) => ipcRenderer.invoke('motions:redeem', id),
  motionsPlay: (id: string) => ipcRenderer.invoke('motions:play', id),
  motionStudioOpen: () => ipcRenderer.send('motion-studio:open'),
  onPetPlayMotion: on('pet:play-motion'),
  pointsGet: () => ipcRenderer.invoke('points:get'),
  pointsAdd: (delta: number, reason: string) => ipcRenderer.invoke('points:add', delta, reason),
  askQAStream: (q: string) => ipcRenderer.invoke('qa:askStream', q),
  onAIStreamChunk: on('ai:streamChunk'),
  onAIStreamDone: on('ai:streamDone'),
  onAIStreamError: on('ai:streamError'),
  onAIStreamReset: on('ai:streamReset'),
  onAIStreamTool: on('ai:streamTool'),
  listQA: () => ipcRenderer.invoke('qa:list'),
  pruneQA: (keepIds: string[]) => ipcRenderer.invoke('qa:prune', keepIds),
  listMemos: () => ipcRenderer.invoke('memos:list'),
  addMemo: (text: string) => ipcRenderer.invoke('memos:add', text),
  usageToday: () => ipcRenderer.invoke('usage:today'),

  // 轻问诊
  sendFeedback: (payload: { qid: string; ctx: string; question: string; answer: 'yes' | 'no' }) =>
    ipcRenderer.invoke('feedback:send', payload),
  getQuestion: () => ipcRenderer.invoke('question:get'),
  onQuestion: on('question:update'),
  genQuestion: (ctx: string) => ipcRenderer.invoke('question:gen', ctx),
  listFeedbacks: () => ipcRenderer.invoke('feedbacks:list'),

  // 纠错 / 规则
  listCorrections: () => ipcRenderer.invoke('corrections:list'),
  addCorrection: (c: unknown) => ipcRenderer.invoke('corrections:add', c),
  removeCorrection: (id: string) => ipcRenderer.invoke('corrections:remove', id),
  listRules: () => ipcRenderer.invoke('rules:list'),
  saveRule: (rule: unknown) => ipcRenderer.invoke('rules:save', rule),
  removeRule: (id: string) => ipcRenderer.invoke('rules:remove', id),

  // 桌宠
  getPet: () => ipcRenderer.invoke('pet:get'),
  setPet: (patch: Partial<PetState>) => ipcRenderer.invoke('pet:set', patch),
  onPet: on('pet:update'),
  petHit: (over: boolean) => ipcRenderer.send('pet:hit', over),
  petModal: (active: boolean) => ipcRenderer.send('pet:modal', active),
  petAffection: () => ipcRenderer.invoke('pet:affection'),
  petRestore: () => ipcRenderer.send('pet:restore'),
  onPetRestore: on('pet:restore'),
  petHide: () => ipcRenderer.send('pet:hide'),
  petIntroReplay: () => ipcRenderer.send('pet:introReplay'),
  onPetIntroReplay: on('pet:introReplay'),
  onPetSettings: on('pet:settings'),
  pageSwitch: () => ipcRenderer.send('page-switch'),
  onPageSwitch: on('page-switch'),
  testAI: () => ipcRenderer.invoke('ai:test'),
  getAIModels: () => ipcRenderer.invoke('ai:models'),
  petAsk: (q: string) => ipcRenderer.invoke('pet:ask', q),
  petAskStream: (q: string) => ipcRenderer.invoke('pet:askStream', q),
  petStats: (stats: unknown) => ipcRenderer.send('pet:stats', stats),
  onPetStats: on('pet:stats'),
  // VRM 角色上传
  selectVrmFile: () => ipcRenderer.invoke('pet:selectVrm'),
  vrmPickInspect: () => ipcRenderer.invoke('pet:vrmPickInspect'),
  vrmApply: (pendingPath: string) => ipcRenderer.invoke('pet:vrmApply', pendingPath),
  resetVrm: () => ipcRenderer.invoke('pet:resetVrm'),
  onReloadVrm: on('pet:reloadVrm'),
  // v3.0 文件夹
  selectFolders: () => ipcRenderer.invoke('folders:select'),
  setFolders: (dirs: string[]) => ipcRenderer.invoke('folders:set', dirs),
  scanFolders: () => ipcRenderer.invoke('folders:scan'),
  onScanProgress: on('folders:scanProgress'),
  confirmQuestion: (payload: {
    qid: string
    ctx: string
    question: string
    answer: 'yes' | 'no'
    browserInfo?: { app: string; title: string }
  }) => ipcRenderer.invoke('question:confirm', payload),
  listCategories: () => ipcRenderer.invoke('categories:list'),
  createCategory: (c: { label: string; color: string; emoji: string; stateHints?: string[] }) =>
    ipcRenderer.invoke('categories:create', c),
  updateCategory: (c: unknown) => ipcRenderer.invoke('categories:update', c),
  deleteCategory: (id: string) => ipcRenderer.invoke('categories:delete', id),
  suggestOtherApps: (days?: number) => ipcRenderer.invoke('categories:suggestOtherApps', days),
  getInferences: (date?: string) => ipcRenderer.invoke('inferences:get', date),
  getForecast: (date?: string) => ipcRenderer.invoke('plans:forecast', date),
  updatePlanProgress: (id: string, ratio: number) => ipcRenderer.invoke('plans:updateProgress', id, ratio),
  delayPlan: (id: string, targetDate: string, reason?: string) => ipcRenderer.invoke('plans:delay', id, targetDate, reason),
  onPlanUpdated: on('plan-updated'),
  onBrowserPlanConfirm: on('browser-plan-confirm'),
  confirmBrowserPlan: (planId: string, answer: 'yes' | 'no') => ipcRenderer.invoke('browser-plan:confirm', planId, answer),
  meetingApply: (payload: { mode: 'stealth' | 'quiet' | 'assist'; active: boolean; sinceTs?: number }) =>
    ipcRenderer.send('meeting:apply', payload),
  onMeetingDetected: on('meeting-detected'),
  onMeetingEnded: on('meeting-ended'),
  onPetMeeting: on('pet:meeting'),

  // 窗口
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  closeWindow: () => ipcRenderer.send('win:close'),
  toggleWidget: () => ipcRenderer.send('win:toggleWidget'),
  togglePet: () => ipcRenderer.send('win:togglePet'),
  hidePet: () => ipcRenderer.send('pet:hide'),
  showPet: () => ipcRenderer.send('pet:show'),
  openMain: () => ipcRenderer.send('win:openMain'),
  setWidgetOpacity: (v: number) => ipcRenderer.send('widget:opacity', v),
  setWidgetPenetration: (v: boolean) => ipcRenderer.send('widget:penetration', v),
  widgetResize: (w: number, h: number) => ipcRenderer.send('widget:resize', w, h),
  widgetResizeTransient: (w: number, h: number) => ipcRenderer.send('widget:resizeTransient', w, h),
  widgetSetMode: (mode: 'mini' | 'compact' | 'full') => ipcRenderer.send('widget:setMode', mode),
  dragWidget: (dx: number, dy: number) => ipcRenderer.send('widget:drag', dx, dy),
  beginWidgetDrag: () => ipcRenderer.send('widget:dragBegin'),
  endWidgetDrag: () => ipcRenderer.send('widget:dragEnd'),
  widgetHit: (over: boolean) => ipcRenderer.send('widget:hit', over),
  onWidgetDock: on('widget:dock'),
  onWidgetSettings: on('settings:update'),
  onAiAssistUpdate: on('ai-assist:update'),
  onWidgetAccent: on('widget:accent'),
  onWelcomeBack: on('welcome-back'),
  onErrorBanner: on('error-banner'),
  onRulesApplied: on('rules:applied'),
  onNavView: on('nav:view'),

  // oner
  onerSync: () => ipcRenderer.invoke('oner:sync'),

  // OCR 资源 / 用户画像
  getOcrStats: () => ipcRenderer.invoke('ocr:stats'),
  clearOcrCache: (keepRecentDays?: number) => ipcRenderer.invoke('ocr:clear', keepRecentDays),
  exportOcrDataset: () => ipcRenderer.invoke('dev:ocrExport'),
  runOcrBatch: (limit?: number) => ipcRenderer.invoke('dev:ocrBatch', limit),
  exportAiPrompts: () => ipcRenderer.invoke('dev:prompts'),
  getUserProfile: () => ipcRenderer.invoke('profile:get'),
  getPrivacyStats: () => ipcRenderer.invoke('privacy:stats'),
  clearAppPrivacy: (appName: string) => ipcRenderer.invoke('privacy:clearApp', appName),
  getPromptLayers: () => ipcRenderer.invoke('ai:promptLayers'),
  getAITools: () => ipcRenderer.invoke('ai:tools'),
  getHabits: () => ipcRenderer.invoke('habits:get'),

  // v2.6 注意力评分 / 成就
  todayAttention: () => ipcRenderer.invoke('attention:today'),
  rangeAttention: (days: number) => ipcRenderer.invoke('attention:range', days),
  setUserType: (type: string) => ipcRenderer.invoke('attention:setUserType', type),
  attentionStrategy: () => ipcRenderer.invoke('attention:strategy'),

  // UIAutomation 深度模式
  getFocusedElement: () => ipcRenderer.invoke('uia:getFocused'),
  getUITree: () => ipcRenderer.invoke('uia:getTree'),
  listAchievements: () => ipcRenderer.invoke('achievements:list'),
  onAchievementUnlocked: on('achievement-unlocked'),

  // v2.6.1 作业链路
  todayChains: () => ipcRenderer.invoke('chain:today'),
  dayChains: (date: string) => ipcRenderer.invoke('chain:day', date),

  // v2.7 用户画像 / AI 访问日志
  getPersona: () => ipcRenderer.invoke('persona:get'),
  refreshPersona: () => ipcRenderer.invoke('persona:refresh'),
  updatePersonaField: (path: string, value: unknown) => ipcRenderer.invoke('persona:update', path, value),
  confirmPersonaField: (path: string) => ipcRenderer.invoke('persona:confirm', path),
  removePersonaTag: (kind: 'interest' | 'skill', name: string) => ipcRenderer.invoke('persona:removeTag', kind, name),
  setPersonaPrivacy: (patch: { L0?: boolean; L1?: boolean; L2?: boolean; L3?: boolean }) =>
    ipcRenderer.invoke('persona:setPrivacy', patch),
  exportPersona: () => ipcRenderer.invoke('persona:export'),
  listAccessLogs: (days?: number) => ipcRenderer.invoke('accessLogs:list', days),
  clearAccessLogs: () => ipcRenderer.invoke('accessLogs:clear'),

  // v2.9 报表基础能力层
  generateReport: (date: string, templateId?: string, enableAI?: boolean) =>
    ipcRenderer.invoke('report:generate', date, templateId, enableAI),
  generateWeekReport: (startDate: string, templateId?: string, enableAI?: boolean) =>
    ipcRenderer.invoke('report:generateWeek', startDate, templateId, enableAI),
  listReportTemplates: () => ipcRenderer.invoke('report:templates'),
  saveReportTemplate: (t: unknown) => ipcRenderer.invoke('report:saveTemplate', t),
  removeReportTemplate: (id: string) => ipcRenderer.invoke('report:removeTemplate', id),
  setDefaultReportTemplate: (id: string) => ipcRenderer.invoke('report:setDefault', id),
  confirmReportEntry: (date: string, entryId: string, patch: unknown, templateId?: string) =>
    ipcRenderer.invoke('report:confirmEntry', date, entryId, patch, templateId),
  reportPatchesList: (date: string) => ipcRenderer.invoke('report:patches:list', date),
  parseReportTemplate: (raw: string) => ipcRenderer.invoke('report:parseTemplate', raw)
}

export type WorkOnApi = typeof api

contextBridge.exposeInMainWorld('api', api)
