/**
 * 预加载桥：向渲染进程暴露 window.api（contextIsolation）
 */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { AppSettings, PetState, PlanStatus, RemoteNodeInfo, SessionTarget } from '@shared/types'
import type { TraceEvent, TraceEvalCaseInput } from '@shared/trace'
import type { CommitmentRecord, JobPolicy, JobPlan, JobTarget, JobTrigger } from '@shared/job'
import type { CoachActionKey, CoachCard, CoachState } from '@shared/coach'
import type { WorkflowRunRecord } from '@shared/workflow'
import type { PlanProposal } from '@shared/assistant'
import type { DeliverableProgress } from '@shared/deliverable/audit'
import type { DeliverableFormat, DeliverableTemplate, DraftSpec } from '@shared/deliverable/spec'

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
  addReminder: (input: { title: string; recurring: 'daily' | 'once'; atHHMM?: string; atTs?: number; origin?: 'user' | 'system'; confirmKeywords?: string[] }) =>
    ipcRenderer.invoke('reminders:add', input),
  removeReminder: (id: string) => ipcRenderer.invoke('reminders:remove', id),
  snoozeReminder: (id: string, minutes?: number) => ipcRenderer.invoke('reminders:snooze', id, minutes),
  doneReminder: (id: string) => ipcRenderer.invoke('reminders:done', id),
  updateReminder: (id: string, patch: Record<string, unknown>) => ipcRenderer.invoke('reminders:update', id, patch),
  onReminderFired: on<{ id: string; title: string; recurring: 'daily' | 'once'; atHHMM?: string; origin?: string; confirmed?: boolean }>('reminder:fired'),
  // 会话（v10）
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  createSession: (input: { title?: string; topic?: string; target?: SessionTarget; first?: { role: 'user' | 'ai'; text: string; time: number } }) =>
    ipcRenderer.invoke('sessions:create', input),
  addSessionItem: (id: string, item: { role: 'user' | 'ai'; text: string; time: number }) =>
    ipcRenderer.invoke('sessions:addItem', id, item),
  removeSession: (id: string) => ipcRenderer.invoke('sessions:remove', id),
  removeSessionItem: (id: string, index: number) => ipcRenderer.invoke('sessions:removeItem', id, index),
  renameSession: (id: string, title: string) => ipcRenderer.invoke('sessions:rename', id, title),
  archiveSession: (id: string, archived: boolean) => ipcRenderer.invoke('sessions:archive', id, archived),
  addSessionParticipant: (id: string, agentId: string) => ipcRenderer.invoke('sessions:addParticipant', id, agentId),
  removeSessionParticipant: (id: string, agentId: string) => ipcRenderer.invoke('sessions:removeParticipant', id, agentId),
  forkSession: (id: string, agentId?: string) => ipcRenderer.invoke('sessions:fork', id, agentId),
  // 工作台拆出（v10）
  detachWorkbench: () => ipcRenderer.invoke('workbench:detach'),
  listApps: () => ipcRenderer.invoke('apps:list'),
  generateSandbox: (srcText: string, ask?: string) => ipcRenderer.invoke('sandbox:generate', srcText, ask),
  openApp: (query: string) => ipcRenderer.invoke('apps:open', query),
  attachWorkbench: () => ipcRenderer.invoke('workbench:attach'),
  workbenchState: () => ipcRenderer.invoke('workbench:state'),
  onWorkbenchState: on<{ detached: boolean }>('workbench:state'),
  onMessageIncoming: on<{ app: string; label?: string; unread: number; via?: string; text: string; messages?: Array<{ sender?: string; text: string }>; ts: number }>('message:incoming'),
  detachPanes: () => ipcRenderer.invoke('panes:detach'),
  attachPanes: () => ipcRenderer.invoke('panes:attach'),
  setPaneIgnore: (ignore: boolean) => ipcRenderer.send('panes:setIgnore', ignore),
  panesState: () => ipcRenderer.invoke('panes:state'),
  winMinimize: () => ipcRenderer.invoke('win:minimize'),
  winHideMain: () => ipcRenderer.invoke('win:hideMain'),
  winHideWorkbench: () => ipcRenderer.invoke('win:hideWorkbench'),
  snapPanes: () => ipcRenderer.invoke('panes:snap'),
  collapsePane: (which: 'ask' | 'paper') => ipcRenderer.invoke('panes:collapse', which),
  expandPane: (which: 'ask' | 'paper') => ipcRenderer.invoke('panes:expand', which),
  setPaneTop: (which: 'ask' | 'paper', on: boolean) => ipcRenderer.invoke('panes:setTop', which, on),
  musicControl: (action: 'next' | 'prev' | 'toggle') => ipcRenderer.invoke('music:control', action),
  onMessageHint: on<{ app: string }>('message:hint'),
  recentMessages: () => ipcRenderer.invoke('messages:recent'),
  // EdgeDock
  dockGet: (edge: string) => ipcRenderer.invoke('edgedock:get', edge),
  dockAdd: (edge: string, appKey: string, label: string, icon: string) => ipcRenderer.invoke('edgedock:add', edge, appKey, label, icon),
  dockRemove: (edge: string, id: string) => ipcRenderer.invoke('edgedock:remove', edge, id),
  dockReorder: (edge: string, ids: string[]) => ipcRenderer.invoke('edgedock:reorder', edge, ids),
  dockRename: (edge: string, title: string) => ipcRenderer.invoke('edgedock:rename', edge, title),
  dockLaunchItem: (edge: string, id: string) => ipcRenderer.invoke('edgedock:launchItem', edge, id),
  dockLaunchGroup: (edge: string) => ipcRenderer.invoke('edgedock:launchGroup', edge),
  dockShow: (edge: string) => ipcRenderer.invoke('edgedock:show', edge),
  dockHide: (edge?: string) => ipcRenderer.invoke('edgedock:hide', edge),
  onDockStatus: on<{ edge: string; running: string[]; aiBusy: string[] }>('edgedock:status'),
  onMusicChanged: on<{ name: string; artist: string; playing: boolean }>('music:changed'),
  onAiAssist: on<{ enabled: boolean; items: Array<{ key: string; label?: string; status: string; title?: string; doneUntil?: number; busySince?: number }> }>('ai-assist:update'),

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
  /** AI 建计划的预览草稿（确认后才由渲染端 savePlan 落库） */
  onPlanProposal: on<PlanProposal>('plan:proposal'),
  /** 本地兜底：模型没调工具时，渲染端解析出草稿后广播预览卡 */
  proposePlan: (draft: { title: string; date?: string; startMin?: number; category?: string }) =>
    ipcRenderer.invoke('plans:propose', draft),
  planVsActual: (date?: string) => ipcRenderer.invoke('plans:vsActual', date),
  dedupeBurstPlans: () => ipcRenderer.invoke('plans:dedupeBurst'),
  /** 今日时间块重排建议（只读，不写库） */
  replanSuggest: (nowMin?: number) => ipcRenderer.invoke('plans:replanSuggest', nowMin),
  /** 立即跑一次重排预览（仍不写库） */
  replanNow: () => ipcRenderer.invoke('plans:replanNow'),

  // 人生预期轨迹（v10 人生规划模拟）
  listGoals: () => ipcRenderer.invoke('goals:list'),
  decomposeGoal: (sourceText: string, hint?: string) => ipcRenderer.invoke('goals:decompose', sourceText, hint),
  decomposeGoalTree: (sourceText: string, hint?: string, deadlineOverride?: string) =>
    ipcRenderer.invoke('goals:decomposeTree', sourceText, hint, deadlineOverride),
  applyGoalTree: (sourceText: string, draft: unknown, deadlineOverride?: string) =>
    ipcRenderer.invoke('goals:applyTree', sourceText, draft, deadlineOverride),
  createGoal: (input: unknown) => ipcRenderer.invoke('goals:create', input),
  updateGoal: (id: string, patch: unknown) => ipcRenderer.invoke('goals:update', id, patch),
  removeGoal: (id: string) => ipcRenderer.invoke('goals:remove', id),

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
  // 收藏网址 / 情报流
  getIntelState: () => ipcRenderer.invoke('intel:state'),
  listBookmarkSources: () => ipcRenderer.invoke('intel:sources'),
  listBookmarkSites: (sourceId: string, limit?: number) => ipcRenderer.invoke('intel:sites', sourceId, limit),
  importBookmarkSource: (sourceId: string, limit?: number) => ipcRenderer.invoke('intel:importSource', sourceId, limit),
  addIntelWatch: (url: string, title?: string) => ipcRenderer.invoke('intel:addWatch', url, title),
  removeIntelWatch: (id: string) => ipcRenderer.invoke('intel:removeWatch', id),
  getVaultStatus: () => ipcRenderer.invoke('intel:vaultStatus'),
  listVaultSites: () => ipcRenderer.invoke('intel:vaultList'),
  removeVaultSite: (id: string) => ipcRenderer.invoke('intel:vaultRemove', id),
  hideWatchToVault: (id: string) => ipcRenderer.invoke('intel:watchToVault', id),
  scanIntel: () => ipcRenderer.invoke('intel:scan'),
  ingestIntel: (id: string, target: string) => ipcRenderer.invoke('intel:ingest', id, target),
  setIntelConfig: (patch: unknown) => ipcRenderer.invoke('intel:setConfig', patch),
  setAgentQuota: (agentId: string, value: number, note?: string) => ipcRenderer.invoke('intel:setQuota', agentId, value, note),
  listIntelProviders: () => ipcRenderer.invoke('intel:providers'),
  // 动态 Agent 连接器
  listAgents: () => ipcRenderer.invoke('agents:list'),
  addAgent: (input: unknown) => ipcRenderer.invoke('agents:add', input),
  updateAgent: (id: string, input: unknown) => ipcRenderer.invoke('agents:update', id, input),
  removeAgent: (id: string) => ipcRenderer.invoke('agents:remove', id),
  probeAgent: (id: string) => ipcRenderer.invoke('agents:probe', id),
  dispatchAgent: (id: string, prompt: string, cwd?: string, confirm?: boolean) =>
    ipcRenderer.invoke('agents:dispatch', id, prompt, cwd, confirm),
  listAgentRuns: (agentId?: string) => ipcRenderer.invoke('agents:runs', agentId),
  setAgentRunReference: (runId: string, reference: boolean) =>
    ipcRenderer.invoke('agents:setRunReference', runId, reference),
  // 可视化工作流
  workflowList: () => ipcRenderer.invoke('workflow:list'),
  /** 下一次编排会参考哪些真实输出（摘要） */
  listWorkflowReferences: () => ipcRenderer.invoke('workflow:references'),
  /** 一句话生成编排：直接保存并返回新工作流 */
  workflowGenerate: (description: string, model?: string) =>
    ipcRenderer.invoke('workflow:generate', description, model),
  workflowSave: (def: unknown) => ipcRenderer.invoke('workflow:save', def),
  workflowRemove: (id: string) => ipcRenderer.invoke('workflow:remove', id),
  workflowModels: (force?: boolean) => ipcRenderer.invoke('workflow:models', force),
  workflowRun: (req: unknown) => ipcRenderer.invoke('workflow:run', req),
  workflowRuns: (id?: string) => ipcRenderer.invoke('workflow:runs', id),
  workflowRunById: (id: string, input?: string) => ipcRenderer.invoke('workflow:runById', id, input),
  onWorkflowRunDone: on<WorkflowRunRecord>('workflow:runDone'),
  // 关联图谱（P1/P2/P3）
  graphGet: () => ipcRenderer.invoke('graph:get'),
  graphRebuild: () => ipcRenderer.invoke('graph:rebuild'),
  graphNeighbors: (id: string, depth?: number) => ipcRenderer.invoke('graph:neighbors', id, depth),
  graphAnalyze: () => ipcRenderer.invoke('graph:analyze'),
  workflowCancel: () => ipcRenderer.invoke('workflow:cancel'),
  workflowOcr: (dataUrl: string) => ipcRenderer.invoke('workflow:ocr', dataUrl),
  workflowCollect: () => ipcRenderer.invoke('workflow:collect'),
  workflowAutomation: () => ipcRenderer.invoke('workflow:automation'),
  workflowVideo: (input: { url?: string; langs?: string; maxChars?: number }) =>
    ipcRenderer.invoke('workflow:video', input),
  workflowFeed: (input: { url?: string; limit?: number }) => ipcRenderer.invoke('workflow:feed', input),
  // 工作闭环助手（监控 → 提示 → 行动 → 验证）
  coachList: () => ipcRenderer.invoke('coach:list') as Promise<CoachState>,
  coachAct: (id: string, action: CoachActionKey) => ipcRenderer.invoke('coach:act', id, action) as Promise<CoachState>,
  coachEvaluate: (force?: boolean) => ipcRenderer.invoke('coach:evaluate', force) as Promise<CoachCard | null>,
  coachSnooze: (minutes?: number) => ipcRenderer.invoke('coach:snooze', minutes) as Promise<CoachState>,
  coachClear: () => ipcRenderer.invoke('coach:clear') as Promise<CoachState>,
  onCoachCard: on<CoachCard>('coach:card'),
  onCoachUpdate: on<CoachCard>('coach:update'),
  onComposerAsk: on<string>('composer:ask'),
  // 应用内浏览器
  browserAttach: (id: number) => ipcRenderer.invoke('browser:attach', id),
  browserDetach: () => ipcRenderer.invoke('browser:detach'),
  browserNavigate: (url: string) => ipcRenderer.invoke('browser:navigate', url),
  browserBack: () => ipcRenderer.invoke('browser:back'),
  browserForward: () => ipcRenderer.invoke('browser:forward'),
  browserReload: () => ipcRenderer.invoke('browser:reload'),
  browserState: () => ipcRenderer.invoke('browser:state'),
  browserRead: () => ipcRenderer.invoke('browser:read'),
  browserClick: (target: string) => ipcRenderer.invoke('browser:click', target),
  browserFill: (selector: string, text: string) => ipcRenderer.invoke('browser:fill', selector, text),
  browserAsk: (input: {
    site?: 'deepseek' | 'doubao' | 'qwen' | 'chatglm' | 'wenxin' | 'yuanbao' | 'kimi' | 'custom'
    url?: string
    question: string
    answerSelector?: string
    timeoutMs?: number
  }) => ipcRenderer.invoke('browser:ask', input),
  browserScreenshot: () => ipcRenderer.invoke('browser:screenshot'),
  browserOpenExternal: (url: string) => ipcRenderer.invoke('browser:openExternal', url),
  onBrowserEnsure: on('browser:ensure'),
  // 浏览器模式：embedded=应用内 webview，chrome=本机 Chrome（扩展连接器）
  browserSetMode: (mode: 'embedded' | 'chrome') => ipcRenderer.invoke('browser:setMode', mode),
  browserGetMode: () => ipcRenderer.invoke('browser:getMode'),
  chromeStatus: () => ipcRenderer.invoke('chrome:status'),
  chromeTabs: () => ipcRenderer.invoke('chrome:tabs'),
  chromeActivate: (tabId: number) => ipcRenderer.invoke('chrome:activate', tabId),
  chromeOpen: (url: string) => ipcRenderer.invoke('chrome:open', url),
  chromeExtensionPath: () => ipcRenderer.invoke('chrome:extensionPath'),
  chromeOpenExtension: () => ipcRenderer.invoke('chrome:openExtension'),
  onChromeStatus: on<{ connected: boolean; version?: string; browser?: string }>('chrome:status'),
  // Web 测试
  runWebTest: (input: { url: string; goal?: string; kinds?: string[]; maxSteps?: number }) =>
    ipcRenderer.invoke('webtest:run', input),
  lastWebTest: () => ipcRenderer.invoke('webtest:last'),
  onWebTestProgress: on<unknown>('webtest:progress'),
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

  // 一分钟校对（待确认队列）
  reviewPending: (date?: string) => ipcRenderer.invoke('review:pending', date),
  reviewSummary: (date?: string) => ipcRenderer.invoke('review:summary', date),
  reviewConfirm: (app: string, projectId: string | null, date?: string) =>
    ipcRenderer.invoke('review:confirm', app, projectId, date),
  reviewIgnore: (app: string, date?: string) => ipcRenderer.invoke('review:ignore', app, date),
  reviewProjects: () => ipcRenderer.invoke('review:projects'),

  // AI 分析 / 问答
  getAnalysis: (date?: string) => ipcRenderer.invoke('analysis:get', date),
  refreshAnalysis: () => ipcRenderer.invoke('analysis:refresh'),
  getTodos: () => ipcRenderer.invoke('analysis:todos'),
  getTips: () => ipcRenderer.invoke('analysis:tips'),
  askQA: (q: string, useSuperAgent?: boolean) => ipcRenderer.invoke('qa:ask', q, useSuperAgent),
  runSuperAgent: (q: string) => ipcRenderer.invoke('superAgent:run', q),
  askQAWithShots: (q: string, windowMin?: number) => ipcRenderer.invoke('qa:askWithShots', q, windowMin),
  ocrShots: (startTs: number, endTs: number, keyword?: string) => ipcRenderer.invoke('ocr:shots', startTs, endTs, keyword),
  ocrShotImage: (file: string) => ipcRenderer.invoke('ocr:shotImage', file),
  assistantIntent: (q: string) => ipcRenderer.invoke('assistant:intent', q),

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
  askQAStream: (q: string, useSuperAgent?: boolean) => ipcRenderer.invoke('qa:askStream', q, useSuperAgent),
  onAIStreamChunk: on('ai:streamChunk'),
  onAIStreamReasoning: on('ai:streamReasoning'),
  onAIStreamDone: on('ai:streamDone'),
  onAIStreamError: on('ai:streamError'),
  onAIStreamReset: on('ai:streamReset'),
  onAIStreamTool: on('ai:streamTool'),
  onAITrace: on<TraceEvent>('ai:trace'),
  getAITrace: (traceId: string) => ipcRenderer.invoke('ai:getTrace', traceId),
  listAITraces: (limit?: number) => ipcRenderer.invoke('ai:listTraces', limit),
  getAITraceMetrics: () => ipcRenderer.invoke('ai:traceMetrics'),
  listTraceEvalCases: () => ipcRenderer.invoke('ai:traceEvalList'),
  saveTraceEvalCase: (input: TraceEvalCaseInput) => ipcRenderer.invoke('ai:traceEvalSave', input),
  removeTraceEvalCase: (id: string) => ipcRenderer.invoke('ai:traceEvalRemove', id),
  runTraceEvalCase: (id: string) => ipcRenderer.invoke('ai:traceEvalRun', id),
  previewTraceExport: () => ipcRenderer.invoke('ai:traceExportPreview'),
  saveTraceExport: (previewId: string, confirmed: boolean) => ipcRenderer.invoke('ai:traceExportSave', previewId, confirmed),
  // 节点模式（P0）：外部电脑配对与状态
  listNodes: () => ipcRenderer.invoke('nodes:list'),
  createNodePairing: () => ipcRenderer.invoke('nodes:pairing'),
  revokeNode: (id: string) => ipcRenderer.invoke('nodes:revoke', id),
  onNodesChanged: on<RemoteNodeInfo[]>('nodes:changed'),
  // 事务 / 长任务（个人 Agent）
  getJobSnapshot: () => ipcRenderer.invoke('jobs:snapshot'),
  saveCommitment: (input: {
    id?: string
    title: string
    intent: string
    plan: JobPlan
    trigger: JobTrigger
    policy?: JobPolicy
    target?: JobTarget
    status?: CommitmentRecord['status']
  }) => ipcRenderer.invoke('jobs:saveCommitment', input),
  patchCommitment: (id: string, patch: Partial<CommitmentRecord>) =>
    ipcRenderer.invoke('jobs:patchCommitment', id, patch),
  removeCommitment: (id: string) => ipcRenderer.invoke('jobs:removeCommitment', id),
  runCommitment: (id: string, confirmed?: boolean) => ipcRenderer.invoke('jobs:run', id, confirmed),
  cancelJob: (jobId: string) => ipcRenderer.invoke('jobs:cancel', jobId),
  approveJob: (jobId: string) => ipcRenderer.invoke('jobs:approve', jobId),
  listJobEvents: (jobId: string, limit?: number) => ipcRenderer.invoke('jobs:events', jobId, limit),
  onJobChanged: on<{ jobId?: string }>('job:changed'),
  // 盯守：多盯点独立增量（不是定时批量）
  getWatchSnapshot: () => ipcRenderer.invoke('watch:list'),
  createWatchTask: (input: {
    title?: string
    intent?: string
    intervalMin?: number
    points: Array<{ url: string; label?: string }>
    sourceKind?: 'web-links' | 'browser-page'
    sourceLabel?: string
    sinks?: {
      knowledge?: boolean
      persona?: boolean
      plan?: boolean
      projectId?: string
      workflowId?: string
    }
  }) => ipcRenderer.invoke('watch:create', input),
  patchWatchTask: (id: string, patch: { status?: 'active' | 'paused'; intervalMin?: number }) =>
    ipcRenderer.invoke('watch:patch', id, patch),
  removeWatchTask: (id: string) => ipcRenderer.invoke('watch:remove', id),
  runWatchNow: (taskId?: string) => ipcRenderer.invoke('watch:run', taskId),
  onWatchChanged: on<{ taskId?: string }>('watch:changed'),
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
  testAI: (ov?: { aiApiKey?: string; aiBaseUrl?: string; aiModel?: string }) => ipcRenderer.invoke('ai:test', ov),
  probeOllama: (baseUrl?: string) => ipcRenderer.invoke('ai:ollama', baseUrl),
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
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  onWindowMaxState: on<boolean>('win:maxState'),
  closeWindow: () => ipcRenderer.send('win:close'),
  toggleWidget: () => ipcRenderer.send('win:toggleWidget'),
  togglePet: () => ipcRenderer.send('win:togglePet'),
  hidePet: () => ipcRenderer.send('pet:hide'),
  showPet: () => ipcRenderer.send('pet:show'),
  openMain: (view?: string) => ipcRenderer.send('win:openMain', view),
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
  /** 托盘「切换会话」：把已打开的问玻璃切到指定会话 */
  onQAFocusSession: on<string>('qa:focus-session'),
  onSettingsUpdate: on('settings:update'),

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
  parseReportTemplate: (raw: string) => ipcRenderer.invoke('report:parseTemplate', raw),

  // v3.x 交付物：草案 → 确认 → 审计 → 渲染（闸门在主编排器）
  exportReport: (date: string, format?: DeliverableFormat, template?: DeliverableTemplate, templateId?: string) =>
    ipcRenderer.invoke('report:export', date, format, template, templateId),
  startDeliverableDraft: (input: { template?: DeliverableTemplate; title?: string; date?: string; goal?: string }) =>
    ipcRenderer.invoke('deliverable:draft', input),
  confirmDeliverableDraft: (jobId: string, patch?: Partial<DraftSpec>) =>
    ipcRenderer.invoke('deliverable:confirmDraft', jobId, patch),
  buildDeliverable: (jobId: string) => ipcRenderer.invoke('deliverable:build', jobId),
  confirmDeliverableSpec: (jobId: string) => ipcRenderer.invoke('deliverable:confirmSpec', jobId),
  renderDeliverableJob: (jobId: string, format: DeliverableFormat) =>
    ipcRenderer.invoke('deliverable:render', jobId, format),
  getDeliverableJob: (jobId: string) => ipcRenderer.invoke('deliverable:job', jobId),
  listDeliverableJobs: (limit?: number) => ipcRenderer.invoke('deliverable:list', limit),
  cancelDeliverableJob: (jobId: string) => ipcRenderer.invoke('deliverable:cancel', jobId),
  revertDeliverableJob: (jobId: string, revision: number) =>
    ipcRenderer.invoke('deliverable:revert', jobId, revision),
  exportFlow: (input: {
    title?: string
    nodes: Array<{ id: string; label: string; kind?: string }>
    edges: Array<{ from: string; to: string; label?: string }>
  }) => ipcRenderer.invoke('deliverable:exportFlow', input),
  onDeliverableProgress: on<DeliverableProgress>('deliverable:progress'),

  // v3.x 记忆
  searchMemory: (q: string, opts?: { start?: number; end?: number; limit?: number }) =>
    ipcRenderer.invoke('memory:search', q, opts),
  memoryStats: () => ipcRenderer.invoke('memory:stats'),
  ocrStats: () => ipcRenderer.invoke('ocr:stats'),
  captureOcrOnce: () => ipcRenderer.invoke('ocr:captureOnce'),
  openOcrPermission: () => ipcRenderer.invoke('ocr:openPermission'),

  // v3.x 远程节点写入（先预览后确认）
  nodeWritePreview: (nodeId: string, filePath: string, content: string) =>
    ipcRenderer.invoke('nodes:writePreview', nodeId, filePath, content),
  nodeWrite: (nodeId: string, filePath: string, content: string, confirmed: boolean) =>
    ipcRenderer.invoke('nodes:write', nodeId, filePath, content, confirmed),

  // v3.x 日历（ICS）
  listCalendarFeeds: () => ipcRenderer.invoke('calendar:feeds'),
  addCalendarFeed: (input: { name?: string; url: string }) => ipcRenderer.invoke('calendar:addFeed', input),
  removeCalendarFeed: (id: string) => ipcRenderer.invoke('calendar:removeFeed', id),
  listCalendarEvents: (startTs: number, endTs: number) => ipcRenderer.invoke('calendar:events', startTs, endTs),
  upsertCalendarEvent: (input: { title: string; startTs: number; endTs: number; location?: string }) =>
    ipcRenderer.invoke('calendar:upsert', input),
  calendarBusy: (date: string) => ipcRenderer.invoke('calendar:busy', date),

  // v3.x 本地 MCP Server
  mcpStatus: () => ipcRenderer.invoke('mcp:status'),
  startMcp: () => ipcRenderer.invoke('mcp:start'),
  stopMcp: () => ipcRenderer.invoke('mcp:stop')
}

export type WorkOnApi = typeof api

contextBridge.exposeInMainWorld('api', api)
