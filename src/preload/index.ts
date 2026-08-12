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

  // 实时状态
  getPresence: () => ipcRenderer.invoke('presence:get'),
  onPresence: on('presence:update'),
  getDesktop: () => ipcRenderer.invoke('desktop:get'),

  // 轨迹 / 日历 / 计划
  getTrail: (date?: string) => ipcRenderer.invoke('trail:get', date),
  updateTrail: (startTs: number, patch: { title?: string }) => ipcRenderer.invoke('trail:update', startTs, patch),
  listEntries: (date: string) => ipcRenderer.invoke('entries:list', date),
  saveEntry: (entry: unknown) => ipcRenderer.invoke('entries:save', entry),
  removeEntry: (id: string) => ipcRenderer.invoke('entries:remove', id),
  listPlans: (date?: string) => ipcRenderer.invoke('plans:list', date),
  savePlan: (plan: unknown) => ipcRenderer.invoke('plans:save', plan),
  removePlan: (id: string) => ipcRenderer.invoke('plans:remove', id),
  setPlanStatus: (id: string, status: PlanStatus) => ipcRenderer.invoke('plans:setStatus', id, status),
  planVsActual: (date?: string) => ipcRenderer.invoke('plans:vsActual', date),

  // AI 分析 / 问答
  getAnalysis: (date?: string) => ipcRenderer.invoke('analysis:get', date),
  refreshAnalysis: () => ipcRenderer.invoke('analysis:refresh'),
  getTodos: () => ipcRenderer.invoke('analysis:todos'),
  getTips: () => ipcRenderer.invoke('analysis:tips'),
  askQA: (q: string) => ipcRenderer.invoke('qa:ask', q),
  askQAStream: (q: string) => ipcRenderer.invoke('qa:askStream', q),
  onAIStreamChunk: on('ai:streamChunk'),
  onAIStreamDone: on('ai:streamDone'),
  onAIStreamError: on('ai:streamError'),
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
  petIntroReplay: () => ipcRenderer.send('pet:introReplay'),
  onPetIntroReplay: on('pet:introReplay'),
  onPetSettings: on('pet:settings'),
  pageSwitch: () => ipcRenderer.send('page-switch'),
  onPageSwitch: on('page-switch'),
  testAI: () => ipcRenderer.invoke('ai:test'),
  getAIModels: () => ipcRenderer.invoke('ai:models'),
  petAsk: (q: string) => ipcRenderer.invoke('pet:ask', q),
  petAskStream: (q: string) => ipcRenderer.invoke('pet:askStream', q),
  petUserSay: (text: string) => ipcRenderer.send('pet:userSay', text),
  onPetUserSay: on('pet:userSay'),
  petStats: (stats: unknown) => ipcRenderer.send('pet:stats', stats),
  onPetStats: on('pet:stats'),
  // VRM 角色上传
  selectVrmFile: () => ipcRenderer.invoke('pet:selectVrm'),
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
  widgetResize: (w: number, h: number) => ipcRenderer.send('widget:resize', w, h),
  dragWidget: (dx: number, dy: number) => ipcRenderer.send('widget:drag', dx, dy),
  onOpenPalette: on('open-palette'),
  onWelcomeBack: on('welcome-back'),
  onErrorBanner: on('error-banner'),
  onRulesApplied: on('rules:applied'),
  onNavView: on('nav:view'),

  // oner
  onerSync: () => ipcRenderer.invoke('oner:sync'),

  // OCR 资源 / 用户画像
  getOcrStats: () => ipcRenderer.invoke('ocr:stats'),
  clearOcrCache: (keepRecentDays?: number) => ipcRenderer.invoke('ocr:clear', keepRecentDays),
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
  parseReportTemplate: (raw: string) => ipcRenderer.invoke('report:parseTemplate', raw)
}

export type WorkOnApi = typeof api

contextBridge.exposeInMainWorld('api', api)
