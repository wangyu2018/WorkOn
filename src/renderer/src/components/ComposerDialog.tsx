/**
 * 右侧常驻侧栏（参考 Qoder 海外版：对话 + 内置浏览器同屏）
 * - 对话：问一问 / 派发 Agent
 * - 浏览器：应用内 Chromium，登录态持久，Agent 可直接读取 / 点击 / 填表 / 截图
 * - 左边缘可拖动调宽；关闭后收成右下角胶囊
 */
import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { AssistantCardView } from './assistant/AssistantCardView'
import { A2uiSurfaceView } from './a2ui/A2uiSurfaceView'
import { extractA2uiFromText, type A2uiSurface } from '@shared/a2ui'
import type { AssistantCard, AssistantIntentResult } from '@shared/assistant'
import type { WebTestProgress, WebTestReport, WebTestStep } from '@shared/webtest'
import { WORKFLOW_NODE_CATALOG, type WorkflowDef } from '@shared/workflow'
import { WATCH_INTERVAL_OPTIONS, WATCH_MAX_POINTS, type WatchTask } from '@shared/watch'
import type { ChatSession } from '@shared/types'
import { useAppStore } from '../stores/appStore'
import { todayKey } from './utils'

interface AgentLite {
  id: string
  name: string
  protocol: string
  enabled: boolean
  status?: string
}

interface BrowserRead {
  ok: boolean
  title?: string
  url?: string
  text?: string
  items?: { tag: string; text: string; selector: string }[]
  error?: string
}

interface WebviewElement extends HTMLElement {
  getURL(): string
  getTitle(): string
  getWebContentsId(): number
  loadURL(url: string): Promise<void>
}

type Mode = 'ask' | 'dispatch'
type Tab = 'chat' | 'browser'
type BrowserKind = 'embedded' | 'chrome'

interface ChromeTabInfo {
  id: number
  title: string
  url: string
  active: boolean
}

interface ChatMsg {
  id: string
  role: 'user' | 'ai'
  text: string
  ts: number
  error?: boolean
  /** 本地助手意图产出的结构化卡片 */
  card?: AssistantCard
  /** A2UI 声明式卡片（P1/P2） */
  surface?: A2uiSurface
  /** 思考链：与最终回答分开展示 */
  thinking?: string
  /** 思考是否结束（结束即自动收起） */
  thinkingDone?: boolean
}

/** 编排草稿（按「会话 id:消息时间」存 localStorage，重启后确认卡仍在） */
interface StoredWfDraft {
  def: WorkflowDef
  description: string
  state: 'draft' | 'created' | 'discarded'
}

/** 盯守卡：一句话拆成多个盯点，确认后建任务；状态同样按会话消息存 localStorage */
interface StoredWatchCard {
  title: string
  intent: string
  intervalMin: number
  points: { url: string; label: string }[]
  state: 'draft' | 'created' | 'discarded'
  taskId?: string
  sourceKind?: 'web-links' | 'browser-page'
  sourceLabel?: string
  sinks?: {
    knowledge?: boolean
    persona?: boolean
    plan?: boolean
    projectId?: string
    workflowId?: string
  }
  projectName?: string
  workflowName?: string
}

const WIDTH_KEY = 'workon:dock-width'
const TAB_KEY = 'workon:dock-tab'
const URL_KEY = 'workon:browser-url'
/** 只接受 http(s)：历史里若存过 bitbrowser:// 等自定义协议，重开时别再交给系统 */
function safeBrowserUrl(raw: string | null): string {
  return raw && /^https?:\/\//i.test(raw) ? raw : 'https://www.bing.com'
}
const KIND_KEY = 'workon:browser-mode'
/** 旧版单线程对话（仅用于一次性迁移） */
const CHAT_KEY = 'workon:chat-messages'
const MIGRATED_KEY = 'workon:chat-migrated'
/** 全局会话：当前选中的会话 id（跨窗口/重启记住） */
const ACTIVE_SESSION_KEY = 'workon:global-session'
/** 编排草稿表：key = `${sessionId}:${aiMessageTime}` */
const DRAFT_KEY = 'workon:wf-drafts'
/** 盯守卡表：key 同上 */
const WATCH_CARD_KEY = 'workon:watch-cards'
const DEFAULT_WIDTH = 430

function loadDrafts(): Record<string, StoredWfDraft> {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as unknown
    return raw && typeof raw === 'object' ? (raw as Record<string, StoredWfDraft>) : {}
  } catch {
    return {}
  }
}

function loadWatchCards(): Record<string, StoredWatchCard> {
  try {
    const raw = JSON.parse(localStorage.getItem(WATCH_CARD_KEY) ?? '{}') as unknown
    return raw && typeof raw === 'object' ? (raw as Record<string, StoredWatchCard>) : {}
  } catch {
    return {}
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function hhmm(ts?: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 从一句话里解析巡检周期（分钟） */
function parseIntervalMin(t: string): number {
  const every = /每\s*(\d+)\s*(分钟|分|小时|h)/i.exec(t)
  let intervalMin = 60
  if (/半\s*小时/.test(t)) intervalMin = 30
  else if (every) intervalMin = /小时|h/i.test(every[2]) ? Number(every[1]) * 60 : Number(every[1])
  else if (/每小时|每个小时/.test(t)) intervalMin = 60
  else if (/早中晚/.test(t)) intervalMin = 240
  return Math.min(24 * 60, Math.max(5, Math.round(intervalMin)))
}

/** 盯守意图：拆出「盯哪些源 + 多快看一次」；问用法/原理不误触 */
function parseWatchAsk(q: string): { title: string; intervalMin: number; urls: string[] } | null {
  const t = q.trim()
  if (!t) return null
  if (!/(盯着|盯一下|盯住|帮我盯|帮我关注|持续关注|盯守|监控)/.test(t)) return null
  if (/(有什么用|能干嘛|能干什么|怎么用|如何使用|为什么|是什么|介绍|说明|教程)/.test(t)) return null
  const urls = Array.from(t.matchAll(/https?:\/\/[^\s，。；、）)\]】"'<>]+/g))
    .map((m) => m[0].replace(/[.,;:!?]+$/, ''))
    .slice(0, WATCH_MAX_POINTS)
  const sourceHint = /(这些|这个|几个|我的|关注|情报|信息源|网站|网页|页面|新闻|博客|媒体)/.test(t)
  if (!urls.length && !sourceHint) return null
  const cleaned = t
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(帮我|请|麻烦|我要|我想|能不能|可以)/g, '')
    .replace(/(盯着|盯一下|盯住|盯守|帮我关注|持续关注|监控|关注)/g, ' ')
    .split(/[，。；\n]/)[0]
    .replace(/\s+/g, ' ')
    .trim()
  return { title: (cleaned || '盯守任务').slice(0, 24), intervalMin: parseIntervalMin(t), urls }
}

/** 抖音类任务：账号 + 要什么数据 + 存哪儿；默认读「喜欢」 */
function parseDouyinAsk(q: string): {
  title: string
  intervalMin: number
  urls: string[]
  sourceLabel: string
  sinks: { knowledge: boolean; persona: boolean; plan: boolean; projectName?: string; workflowName?: string }
} | null {
  const t = q.trim()
  if (!t || !/抖音|douyin/i.test(t)) return null
  if (/(怎么|如何|为什么|是什么|介绍|教程|有什么用|能干嘛)/.test(t) && !/(账号|数据|喜欢|收藏|作品)/.test(t)) return null
  const named = (kw: string): string | undefined => {
    const m = new RegExp(`${kw}[：:\\s]*([^\\s，。；、]{2,20})`).exec(t)
    return m?.[1]?.trim()
  }
  const sinks = {
    knowledge: /知识库|知识清单|沉淀|整理|存起来/.test(t),
    persona: /喜好|偏好|画像|兴趣/.test(t),
    plan: /计划|待办|清单|今日/.test(t),
    projectName: /项目/.test(t) ? named('项目') : undefined,
    workflowName: /工作流/.test(t) ? named('工作流') : undefined
  }
  // 什么都没说时，默认沉淀到知识库
  if (!sinks.knowledge && !sinks.persona && !sinks.plan && !sinks.projectName && !sinks.workflowName) {
    sinks.knowledge = true
  }
  const urlMatch = t.match(/https?:\/\/[^\s，。；、）)\]]*douyin\.com[^\s，。；、）)\]]*/i)
  const self = /我的|自己|我账号|我的账号/.test(t)
  let url = urlMatch?.[0]?.replace(/[.,;:!?]+$/, '') ?? ''
  if (!url && self) url = 'https://www.douyin.com/user/self'
  const tab = /收藏/.test(t) ? 'collection' : /作品|发布/.test(t) ? 'post' : 'like'
  const dataLabel = tab === 'collection' ? '收藏' : tab === 'post' ? '作品' : '喜欢'
  let sourceLabel = `抖音 · ${self ? '我的' : ''}${dataLabel}`
  if (url) {
    try {
      const u = new URL(url)
      if (!u.searchParams.get('showTab')) u.searchParams.set('showTab', tab)
      url = u.toString()
      const handle = u.pathname.match(/\/user\/([^/]+)/)?.[1] ?? ''
      if (handle && handle !== 'self') sourceLabel = `抖音 · ${handle.slice(0, 10)} 的${dataLabel}`
    } catch {
      url = ''
    }
  }
  return {
    title: sourceLabel,
    intervalMin: parseIntervalMin(t),
    urls: url ? [url] : [],
    sourceLabel,
    sinks
  }
}

function clampWidth(w: number): number {
  const max = Math.max(360, Math.min(680, window.innerWidth - 480))
  return Math.min(max, Math.max(320, Math.round(w)))
}

function storedWidth(): number {
  const raw = Number(localStorage.getItem(WIDTH_KEY))
  return clampWidth(Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_WIDTH)
}

const NODE_LABEL: Record<string, string> = Object.fromEntries(
  WORKFLOW_NODE_CATALOG.map((n) => [n.kind, n.label])
)

/** 编排意图：查节点 / 查已有工作流 / 一句话生成 */
type WorkflowAsk = { type: 'nodes' } | { type: 'list' } | { type: 'generate'; description: string }

function parseWorkflowAsk(q: string): WorkflowAsk | null {
  const t = q.trim()
  if (!t) return null
  if (/节点/.test(t) && /(哪些|有什么|支持|列表|类型|介绍|看看)/.test(t)) return { type: 'nodes' }
  if (/(工作流|编排)/.test(t) && /(哪些|几个|列表|多少|有什么|哪几|几种)/.test(t)) return { type: 'list' }
  // 问效果 / 问用法 / 问原理，不当作「要生成」，避免把提问编排成一张垃圾图
  const observe = /(怎么样|怎么用|如何用|如何使用|为什么|是什么|介绍|说明|效果)/.test(t)
  const create = /(生成|创建|新建|搭建|做一个|做一版|加一个|帮我编|给我编|编排[:：]|设计一?个|配置一?个)/.test(t)
  if (observe && !create) return null
  const wants =
    /(编排|工作流|流程图)/i.test(t) ||
    /(加|新增|添加|创建|新建|生成|搭|做)(一|个|一个|一下)?(配置|节点|流程)/.test(t)
  return wants ? { type: 'generate', description: t } : null
}

/** 去掉动作词后还剩多少有效描述（太短就只回答「要编排什么」，不乱生成） */
function workflowDetail(q: string): string {
  return q
    .replace(/(帮我|请|麻烦|我要|我想|能不能|可以|直接)/g, '')
    .replace(/(加|新增|添加|创建|新建|生成|做|搭|编排|配置|节点|工作流|流程)/g, '')
    .replace(/[\s，。,.、:：!！?？]/g, '')
}

function nodeCatalogText(): string {
  return WORKFLOW_NODE_CATALOG.map((n) => `· ${n.label}（${n.kind}）：${n.hint}`).join('\n')
}

function wfSummary(def: WorkflowDef): string {
  return `生成好了「${def.name}」：${def.nodes.length} 个节点 / ${def.edges.length} 条连线。\n目标：${def.goal || def.name}\n确认后保存并打开编排页；不满意可以重新生成。`
}

/** 思考链：流式时展开，思考结束自动收起，也可手动再展开 */
function ThinkingBlock({ text, done }: { text: string; done?: boolean }): JSX.Element {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    setOpen(!done)
  }, [done])
  const body = text.trim()
  return (
    <div
      className="w-full max-w-full overflow-hidden rounded-xl"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
    >
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-2xs"
        style={{ color: 'var(--text-3)' }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? '收起思考过程' : '展开思考过程'}
      >
        <Icon name="chevronRight" size={10} className={open ? 'shrink-0 rotate-90' : 'shrink-0'} />
        <span>{done ? '思考过程' : '正在思考…'}</span>
        {done && body ? <span className="opacity-60">· {body.length} 字</span> : null}
        <span className="ml-auto opacity-60">{open ? '收起' : '展开'}</span>
      </button>
      {open ? (
        <pre
          className="max-h-48 overflow-auto whitespace-pre-wrap px-2.5 pb-2 text-2xs leading-relaxed"
          style={{ color: 'var(--text-3)' }}
        >
          {body || '…'}
        </pre>
      ) : null}
    </div>
  )
}

/** 时间文本 → 当天分钟数（21:00 / 晚上9点 / 9点半） */
function clockMinuteOf(s: string): number | undefined {
  const a = /(\d{1,2})\s*[:：]\s*(\d{2})/.exec(s)
  if (a) {
    const h = Number(a[1])
    const m = Number(a[2])
    if (h < 24 && m < 60) return h * 60 + m
  }
  const b = /(上午|下午|中午|晚上|今晚|明晚|早上)?\s*(\d{1,2})\s*点\s*(半|(\d{1,2})\s*分?)?/.exec(s)
  if (!b) return undefined
  let h = Number(b[2])
  const m = b[3] === '半' ? 30 : b[4] ? Number(b[4]) : 0
  if (/下午|中午|晚上|今晚|明晚/.test(b[1] ?? '') && h < 12) h += 12
  return h < 24 && m < 60 ? h * 60 + m : undefined
}

/**
 * 本地兜底：用户明确要建计划、但模型只口头说「已预览」却没调 create_plan 时，
 * 从回复/问题里解析一份草稿，仍给用户一张可确认的预览卡。
 */
function planDraftFromAsk(question: string, reply: string): { title: string; startMin?: number } | null {
  const q = question.replace(/^（关于我引用的内容：[\s\S]*?）\s*/, '').trim()
  if (!q) return null
  // 只兜底「计划/待办/提醒」；「项目」走本地项目通道，绝不当成计划
  const asks = /(建|创建|新建|增加|添加|安排|加)(一下|一个|一条|一项|个)?[^，。；\n]{0,16}(计划|待办|提醒)/
  if (!asks.test(q) || /(怎么|如何|为什么|教程)/.test(q)) return null
  const quoted =
    /[「『“"]([^」』”"]{2,30})[」』”"]/.exec(reply) ??
    /[「『“"]([^」』”"]{2,30})[」』”"]/.exec(q)
  const cleaned = q
    .split(/[，。；\n]/)[0]
    .replace(/(帮我|请|麻烦|我想|我要|想要|给我|能不能|可以)/g, '')
    .replace(/(增加|添加|新建|创建|安排|建立|建|加)(一下|一个|一条|一项|个)?/g, '')
    .trim()
  const title = (quoted?.[1] ?? cleaned).trim().slice(0, 30)
  if (!title || /^(项目|计划|待办|提醒|任务|新计划|一个计划)$/.test(title)) return null
  return { title, startMin: clockMinuteOf(reply) ?? clockMinuteOf(q) }
}

/** 对话里的编排确认卡：节点清单 + 确认 / 重新生成 / 放弃 */
function WfDraftCard({
  draft,
  busy,
  onConfirm,
  onRegenerate,
  onDiscard
}: {
  draft: StoredWfDraft
  busy: boolean
  onConfirm: () => void
  onRegenerate: () => void
  onDiscard: () => void
}): JSX.Element {
  return (
    <div
      className="w-full rounded-xl p-2.5 text-2xs"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-slate-300">
          {draft.def.nodes.length} 节点 · {draft.def.edges.length} 连线
        </span>
        <span className="ml-auto min-w-0 truncate text-slate-600">{draft.def.name}</span>
      </div>
      <div className="flex flex-col gap-1">
        {draft.def.nodes.map((n) => (
          <div key={n.id} className="flex items-start gap-1.5">
            <span
              className="shrink-0 rounded px-1 py-px"
              style={{ background: 'var(--surface-3)', color: 'var(--accent)' }}
            >
              {NODE_LABEL[n.kind] ?? n.kind}
            </span>
            <span className="min-w-0 flex-1 text-slate-300">
              {n.title}
              {n.duty ? (
                <span className="text-slate-500">
                  ：{n.duty.slice(0, 36)}
                  {n.duty.length > 36 ? '…' : ''}
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      {draft.state === 'draft' ? (
        <div className="mt-2 flex items-center gap-1.5">
          <button className="glass-btn primary px-2 py-0.5 text-2xs" disabled={busy} onClick={onConfirm}>
            确认创建
          </button>
          <button className="glass-btn px-2 py-0.5 text-2xs" disabled={busy} onClick={onRegenerate}>
            重新生成
          </button>
          <button className="glass-btn px-2 py-0.5 text-2xs" disabled={busy} onClick={onDiscard}>
            算了
          </button>
        </div>
      ) : (
        <div className="mt-1.5 text-slate-500">
          {draft.state === 'created' ? '已创建并打开编排页' : '已放弃'}
        </div>
      )}
    </div>
  )
}

/** 盯守确认卡：盯点清单 + 独立巡检说明 + 确认 / 调整周期 / 暂停 */
function WatchCard({
  card,
  task,
  busy,
  onConfirm,
  onDiscard,
  onInterval,
  onToggle,
  onRun
}: {
  card: StoredWatchCard
  task?: WatchTask
  busy: boolean
  onConfirm: () => void
  onDiscard: () => void
  onInterval: (min: number) => void
  onToggle: () => void
  onRun: () => void
}): JSX.Element {
  const created = card.state === 'created' && !!task
  const statusText =
    card.state === 'discarded' ? '已放弃' : created ? (task!.status === 'paused' ? '已暂停' : '盯守中') : '待确认'
  const intervalOptions = Array.from(new Set<number>([...WATCH_INTERVAL_OPTIONS, card.intervalMin])).sort(
    (a, b) => a - b
  )
  const sinkText = [
    card.sinks?.knowledge ? '知识库' : '',
    card.sinks?.persona ? '偏好画像' : '',
    card.sinks?.plan ? '今日计划' : '',
    card.sinks?.projectId ? `项目${card.projectName ? ` · ${card.projectName}` : ''}` : '',
    card.sinks?.workflowId ? `工作流${card.workflowName ? ` · ${card.workflowName}` : ''}` : ''
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div
      className="w-full max-w-full rounded-xl p-2.5 text-2xs"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', minWidth: 240 }}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="min-w-0 truncate text-slate-300">盯守 · {card.title}</span>
        <span
          className="ml-auto shrink-0"
          style={{ color: created && task?.status === 'active' ? 'var(--accent)' : 'var(--text-3)' }}
        >
          {statusText}
        </span>
      </div>
      {card.sourceKind === 'browser-page' ? (
        <div className="mb-1.5 text-slate-500">
          来源：{card.sourceLabel || '浏览器页面'} · 后台读取，需在内置浏览器登录一次
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        {card.points.map((p) => {
          const ps = task?.points.find((x) => x.url === p.url)
          const host = hostOf(p.url)
          const label = ps?.label || p.label
          return (
            <div key={p.url} className="flex items-center gap-1.5">
              <span
                className="shrink-0 rounded px-1 py-px"
                style={{ background: 'var(--surface-3)', color: 'var(--accent)' }}
              >
                {host}
              </span>
              {label && label !== host ? (
                <span className="min-w-0 flex-1 truncate text-slate-300">{label}</span>
              ) : (
                <span className="min-w-0 flex-1" />
              )}
              <span className="shrink-0 text-slate-500">
                {created
                  ? ps?.lastError
                    ? '上次失败'
                    : ps?.lastCheckedAt
                      ? `上次 ${hhmm(ps.lastCheckedAt)}`
                      : '待检查'
                  : `${card.intervalMin} 分钟`}
              </span>
            </div>
          )
        })}
      </div>
      {created && task?.latest ? (
        <div className="mt-1.5 truncate text-slate-400">最新：{task.latest.title}</div>
      ) : null}
      <div className="mt-1.5 text-slate-500">
        {created
          ? `各盯点独立巡检、按 URL 去重；已发现 ${task!.findingsCount} 条。`
          : card.sourceKind === 'browser-page'
            ? '首次读档会回填已有内容做分析；之后只处理新增。'
            : '各盯点独立巡检、按 URL 去重；首次只建基线，有新内容才通知。'}
      </div>
      {sinkText ? <div className="mt-1 truncate text-slate-500">写入：{sinkText}</div> : null}
      {card.state === 'draft' ? (
        <>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="text-slate-500">巡检间隔</span>
            {intervalOptions.map((min) => (
              <button
                key={min}
                type="button"
                className="rounded px-1.5 py-0.5"
                style={{
                  background: card.intervalMin === min ? 'var(--accent)' : 'var(--surface-3)',
                  color: card.intervalMin === min ? 'var(--bg-deep)' : 'var(--text-3)'
                }}
                disabled={busy}
                onClick={() => onInterval(min)}
              >
                {min < 60 ? `${min} 分钟` : `${min / 60} 小时`}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <button className="glass-btn primary px-2 py-0.5 text-2xs" disabled={busy} onClick={onConfirm}>
              确认盯守
            </button>
            <button className="glass-btn px-2 py-0.5 text-2xs" disabled={busy} onClick={onDiscard}>
              算了
            </button>
          </div>
        </>
      ) : null}
      {created ? (
        <div className="mt-2 flex items-center gap-1.5">
          <button className="glass-btn px-2 py-0.5 text-2xs" disabled={busy} onClick={onRun}>
            立即检查
          </button>
          <button className="glass-btn px-2 py-0.5 text-2xs" disabled={busy} onClick={onToggle}>
            {task!.status === 'paused' ? '继续' : '暂停'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function ComposerDialog({
  open,
  onOpen,
  onClose,
  variant = 'side'
}: {
  open: boolean
  onOpen: () => void
  onClose: () => void
  /** page = 会话整页；float = 全局会话悬浮窗（保留对话/浏览器标签） */
  variant?: 'side' | 'page' | 'float'
}): JSX.Element {
  const isPage = variant === 'page'
  const isFloat = variant === 'float'
  const isFull = isPage || isFloat
  const [tab, setTab] = useState<Tab>(() =>
    variant === 'page' ? 'chat' : localStorage.getItem(TAB_KEY) === 'browser' ? 'browser' : 'chat'
  )
  const [width, setWidth] = useState<number>(storedWidth)
  const [mode, setMode] = useState<Mode>('ask')
  const [text, setText] = useState('')
  /** 引用芯片：把某条消息（或其中选中的一段）作为上下文，发送前可编辑 */
  const [quote, setQuote] = useState<{ from: string; text: string } | null>(null)
  /** 按下「引用」时的选区文本（点击后选区会消失，先存下来） */
  const quoteSelRef = useRef('')
  /** 全局会话：最近会话列表 + 当前会话（数据落 chatSessions，跨天保留） */
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeId, setActiveId] = useState('')
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  /** 编排草稿表（确认卡按会话消息时间定位） */
  const [drafts, setDrafts] = useState<Record<string, StoredWfDraft>>(loadDrafts)
  const [watchCards, setWatchCards] = useState<Record<string, StoredWatchCard>>(loadWatchCards)
  const [watchTasks, setWatchTasks] = useState<WatchTask[]>([])
  const [watchBusy, setWatchBusy] = useState(false)
  const [toolHint, setToolHint] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [wfBusy, setWfBusy] = useState(false)
  const [agents, setAgents] = useState<AgentLite[]>([])
  const [agentId, setAgentId] = useState('')
  const [confirm, setConfirm] = useState(false)

  // 浏览器
  const [url, setUrl] = useState(() => safeBrowserUrl(localStorage.getItem(URL_KEY)))
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [attached, setAttached] = useState(false)
  const [browserError, setBrowserError] = useState('')
  const [reading, setReading] = useState(false)
  const [read, setRead] = useState<BrowserRead | null>(null)
  // 浏览器来源：embedded=应用内，chrome=本机 Chrome（扩展连接器）
  const [kind, setKind] = useState<BrowserKind>(() => (localStorage.getItem(KIND_KEY) === 'chrome' ? 'chrome' : 'embedded'))
  const [chromeOn, setChromeOn] = useState(false)
  const [chromeVersion, setChromeVersion] = useState('')
  const [chromeTabs, setChromeTabs] = useState<ChromeTabInfo[]>([])
  // Web 测试
  const [testOpen, setTestOpen] = useState(false)
  const [testGoal, setTestGoal] = useState('')
  const [testKinds, setTestKinds] = useState<{ flow: boolean; inspect: boolean; form: boolean }>({
    flow: true,
    inspect: true,
    form: true
  })
  const [testBusy, setTestBusy] = useState(false)
  const [testProgress, setTestProgress] = useState('')
  const [testSteps, setTestSteps] = useState<WebTestStep[]>([])
  const [testReport, setTestReport] = useState<WebTestReport | null>(null)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const webviewRef = useRef<WebviewElement | null>(null)
  const resizeRef = useRef<{ sx: number; ow: number } | null>(null)
  const streamOffsRef = useRef<Array<() => void>>([])
  /** 会话启动只跑一次（StrictMode 双执行保护） */
  const bootedRef = useRef(false)
  /** 本窗口收到过几次计划预览（判断模型是否真的调了 create_plan） */
  const proposalCountRef = useRef(0)

  useEffect(() => {
    const off = window.api?.onPlanProposal?.(() => { proposalCountRef.current += 1 })
    return () => off?.()
  }, [])

  useEffect(() => {
    try { localStorage.setItem(WIDTH_KEY, String(width)) } catch { /* ignore */ }
  }, [width])
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)) } catch { /* ignore */ }
  }, [drafts])
  useEffect(() => {
    try { localStorage.setItem(WATCH_CARD_KEY, JSON.stringify(watchCards)) } catch { /* ignore */ }
  }, [watchCards])
  // 盯守任务状态：进入时取一次，任务变化时刷新；卡片展示最近检查与发现数
  useEffect(() => {
    const load = (): void => {
      void window.api
        .getWatchSnapshot?.()
        .then((s) => setWatchTasks(((s as { tasks?: WatchTask[] } | undefined)?.tasks ?? [])))
        .catch(() => undefined)
    }
    load()
    const off = window.api.onWatchChanged?.(() => load())
    const t = setInterval(load, 60_000)
    return () => {
      off?.()
      clearInterval(t)
    }
  }, [])
  // 顶栏「对话」/ ⌘K / 左侧会话点击 → 聚焦输入框（面板常驻，不再开关）
  useEffect(() => {
    const focus = (): void => inputRef.current?.focus()
    window.addEventListener('workon:focus-composer', focus)
    return () => window.removeEventListener('workon:focus-composer', focus)
  }, [])
  // 命令条：默认一行，输入多行时向上生长（最多约 5 行）
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [text, tab, open])

  // 全局会话：加载会话列表 + 一次性迁移旧版单线程对话
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    void (async () => {
      try {
        let list = ((await window.api.listSessions()) as ChatSession[]) ?? []
        if (localStorage.getItem(MIGRATED_KEY) !== '1') {
          localStorage.setItem(MIGRATED_KEY, '1')
          try {
            const legacy = JSON.parse(localStorage.getItem(CHAT_KEY) ?? '[]') as ChatMsg[]
            const valid = (Array.isArray(legacy) ? legacy : []).filter((m) => String(m.text ?? '').trim())
            if (valid.length) {
              const first = valid[0]
              const created = (await window.api.createSession({
                title: '全局会话（历史）',
                target: { kind: 'local' },
                first: { role: first.role, text: first.text, time: first.ts }
              })) as ChatSession
              for (const m of valid.slice(1)) {
                await window.api.addSessionItem(created.id, { role: m.role, text: m.text, time: m.ts })
              }
              list = [created, ...list]
            }
          } catch { /* 迁移失败不阻塞 */ }
        }
        setSessions(list)
        const remembered = localStorage.getItem(ACTIVE_SESSION_KEY) || ''
        const pick = list.find((s) => s.id === remembered)
        if (pick) {
          setActiveId(pick.id)
          setMessages(sessionMessages(pick))
        }
      } catch { /* 会话不可用时保持空 */ }
    })()
  }, [])
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])
  useEffect(() => {
    return () => {
      for (const off of streamOffsRef.current) off()
      streamOffsRef.current = []
    }
  }, [])
  useEffect(() => {
    try { localStorage.setItem(TAB_KEY, tab) } catch { /* ignore */ }
  }, [tab])
  useEffect(() => {
    try { localStorage.setItem(KIND_KEY, kind) } catch { /* ignore */ }
    void window.api.browserSetMode?.(kind)
  }, [kind])

  // 本机 Chrome 连接状态 + 标签页（只在 Chrome 模式且侧栏展开时轮询）
  useEffect(() => {
    if (!open || kind !== 'chrome') return
    let alive = true
    const tick = async (): Promise<void> => {
      try {
        const st = (await window.api.chromeStatus?.()) as { connected?: boolean; version?: string } | undefined
        if (!alive) return
        setChromeOn(!!st?.connected)
        setChromeVersion(st?.version ?? '')
        if (!st?.connected) {
          setChromeTabs([])
          return
        }
        const list = (await window.api.chromeTabs?.()) as ChromeTabInfo[] | undefined
        if (alive && Array.isArray(list)) setChromeTabs(list)
      } catch { /* ignore */ }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 4000)
    const off = window.api.onChromeStatus?.((s) => {
      setChromeOn(!!s?.connected)
      setChromeVersion(s?.version ?? '')
    })
    return () => {
      alive = false
      window.clearInterval(timer)
      off?.()
    }
  }, [open, kind])

  useEffect(() => {
    if (!open) return
    setError('')
    if (tab === 'chat') window.setTimeout(() => inputRef.current?.focus(), 60)
    // 切到浏览器时把键盘焦点交给网页，避免按键落在对话输入框/无焦点上
    else window.setTimeout(() => webviewRef.current?.focus(), 120)
    void (async () => {
      try {
        const res = (await window.api.listAgents?.()) as { agents?: AgentLite[] } | undefined
        const list = (res?.agents ?? []).filter((a) => a.enabled && ['cli', 'acp', 'http'].includes(a.protocol))
        setAgents(list)
        setAgentId((prev) => prev || list[0]?.id || '')
      } catch {
        setAgents([])
      }
    })()
  }, [open, tab])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Agent / 工作流要操作网页时，自动展开右侧栏并切到浏览器标签
  useEffect(() => {
    const off = window.api.onBrowserEnsure?.(() => {
      onOpen()
      setTab('browser')
    })
    return () => off?.()
  }, [onOpen])

  // 闭环助手把建议交给对话框：展开 + 预填提示词，用户可直接发送
  useEffect(() => {
    const off = window.api.onComposerAsk?.((payload) => {
      const prompt = typeof payload === 'string' ? payload : ''
      if (!prompt.trim()) return
      setTab('chat')
      setMode('ask')
      setText(prompt)
      onOpen()
      window.setTimeout(() => inputRef.current?.focus(), 80)
    })
    return () => off?.()
  }, [onOpen])

  useEffect(() => {
    const onResize = (): void => setWidth((w) => clampWidth(w))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 创建内嵌浏览器（首次切到「浏览器」时挂载，之后保持存活，切标签不丢页面）
  useEffect(() => {
    if (!open || tab !== 'browser' || kind !== 'embedded' || webviewRef.current) return
    const host = hostRef.current
    if (!host) return
    const wv = document.createElementNS('http://www.w3.org/1999/xhtml', 'webview') as unknown as WebviewElement
    wv.setAttribute('src', safeBrowserUrl(localStorage.getItem(URL_KEY)))
    wv.setAttribute('partition', 'persist:workon-browser')
    wv.setAttribute('allowpopups', 'false')
    wv.style.width = '100%'
    wv.style.height = '100%'
    wv.style.display = 'flex'
    host.appendChild(wv)
    webviewRef.current = wv

    const sync = (): void => {
      try {
        const next = wv.getURL()
        setUrl(next)
        if (/^https?:\/\//i.test(next)) localStorage.setItem(URL_KEY, next)
        setTitle(wv.getTitle())
      } catch { /* ignore */ }
    }
    const onReady = (): void => {
      try {
        void window.api.browserAttach(wv.getWebContentsId()).then((r) => setAttached(!!(r as { ok?: boolean })?.ok))
      } catch {
        setAttached(false)
      }
      sync()
    }
    const onStart = (): void => setLoading(true)
    const onStop = (): void => { setLoading(false); sync() }
    const onFail = (e: Event): void => {
      const d = e as Event & { errorDescription?: string; validatedURL?: string }
      setBrowserError(`加载失败：${d.errorDescription ?? '网络错误'}`)
    }

    wv.addEventListener('dom-ready', onReady)
    wv.addEventListener('did-navigate', sync)
    wv.addEventListener('did-navigate-in-page', sync)
    wv.addEventListener('page-title-updated', sync)
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('did-fail-load', onFail)
  }, [open, tab, kind])

  // 卸载时只清理一次（切标签/收起不销毁，保留页面）
  useEffect(() => {
    return () => {
      window.api.browserDetach?.()
      webviewRef.current?.remove()
      webviewRef.current = null
    }
  }, [])

  const startResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    resizeRef.current = { sx: e.clientX, ow: width }
    const move = (ev: PointerEvent): void => {
      const d = resizeRef.current
      if (!d) return
      setWidth(clampWidth(d.ow - (ev.clientX - d.sx)))
    }
    const up = (): void => {
      resizeRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const pushMsg = (m: ChatMsg): void => setMessages((prev) => [...prev.slice(-199), m])
  const patchMsg = (id: string, patch: Partial<ChatMsg>): void =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))

  /** 会话 items → 消息视图（id 用「下标_时间」，稳定且可定位） */
  const sessionMessages = (s: ChatSession | undefined): ChatMsg[] =>
    (s?.items ?? []).map((m, i) => ({ id: `s${i}_${m.time}`, role: m.role, text: m.text, ts: m.time }))

  const reloadSessions = async (): Promise<ChatSession[]> => {
    const list = ((await window.api.listSessions()) as ChatSession[]) ?? []
    setSessions(list)
    window.dispatchEvent(new CustomEvent('workon:sessions-changed'))
    return list
  }

  /** 切换历史会话（列表从库里重取一次，拿到最新 items） */
  const openSession = (id: string): void => {
    setActiveId(id)
    setSessionsOpen(false)
    setError('')
    try { localStorage.setItem(ACTIVE_SESSION_KEY, id) } catch { /* ignore */ }
    const s = sessions.find((x) => x.id === id)
    if (s) setMessages(sessionMessages(s))
    void reloadSessions().then((list) => {
      const fresh = list.find((x) => x.id === id)
      if (fresh) setMessages(sessionMessages(fresh))
    })
  }

  /** 新会话：清空当前视图，首条消息到达时再落库（不制造空会话） */
  const newChat = (): void => {
    setActiveId('')
    setMessages([])
    setSessionsOpen(false)
    setError('')
    try { localStorage.removeItem(ACTIVE_SESSION_KEY) } catch { /* ignore */ }
  }

  // 与左侧会话栏联动：点会话 / 新建，不依赖组件重新挂载
  useEffect(() => {
    const onOpen = (e: Event): void => {
      const id = (e as CustomEvent<string>).detail
      if (typeof id === 'string' && id) openSession(id)
    }
    const onNew = (): void => newChat()
    window.addEventListener('workon:open-session', onOpen)
    window.addEventListener('workon:new-chat', onNew)
    return () => {
      window.removeEventListener('workon:open-session', onOpen)
      window.removeEventListener('workon:new-chat', onNew)
    }
  })

  // 当前会话变化 → 通知左栏高亮
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('workon:active-session', { detail: activeId }))
  }, [activeId])

  /** AI/用户消息落库（会话历史跨天、可在托盘/编排页共享） */
  const persistItem = (sid: string, role: 'user' | 'ai', text: string, time: number): void => {
    if (!sid || !text.trim()) return
    void window.api
      .addSessionItem(sid, { role, text, time })
      .then(() => reloadSessions())
      .catch(() => undefined)
  }

  const setDraft = (key: string, draft: StoredWfDraft | null): void => {
    setDrafts((prev) => {
      const next = { ...prev }
      if (draft) next[key] = draft
      else delete next[key]
      return next
    })
  }

  const setWatchCard = (key: string, card: StoredWatchCard | null): void => {
    setWatchCards((prev) => {
      const next = { ...prev }
      if (card) next[key] = card
      else delete next[key]
      return next
    })
  }

  const reloadWatch = async (): Promise<void> => {
    try {
      const s = (await window.api.getWatchSnapshot?.()) as { tasks?: WatchTask[] } | undefined
      setWatchTasks(s?.tasks ?? [])
    } catch {
      /* 状态读取失败不影响对话 */
    }
  }

  /** 确认盯守：建任务后卡片转为实时状态 */
  const confirmWatch = async (key: string): Promise<void> => {
    const card = watchCards[key]
    if (!card || card.state !== 'draft' || watchBusy) return
    setWatchBusy(true)
    setError('')
    try {
      const r = (await window.api.createWatchTask({
        title: card.title,
        intent: card.intent,
        intervalMin: card.intervalMin,
        points: card.points,
        sourceKind: card.sourceKind,
        sourceLabel: card.sourceLabel,
        sinks: card.sinks
      })) as WatchTask | undefined
      if (!r?.id) {
        setError('创建盯守失败')
        return
      }
      setWatchCard(key, { ...card, state: 'created', taskId: r.id })
      setWatchTasks((prev) => [r, ...prev.filter((t) => t.id !== r.id)])
      const ts = Number(key.split(':')[1] || 0)
      setMessages((prev) =>
        prev.map((m) =>
          m.ts === ts
            ? { ...m, text: `已开始盯守「${card.title}」：${card.points.length} 个盯点，各自独立巡检。` }
            : m
        )
      )
    } catch (e) {
      setError((e as Error).message || '创建盯守失败')
    } finally {
      setWatchBusy(false)
    }
  }

  const discardWatch = (key: string): void => {
    const card = watchCards[key]
    if (!card) return
    setWatchCard(key, { ...card, state: 'discarded' })
    const ts = Number(key.split(':')[1] || 0)
    setMessages((prev) => prev.map((m) => (m.ts === ts ? { ...m, text: '已放弃这次盯守。' } : m)))
  }

  const changeWatchInterval = (key: string, min: number): void => {
    const card = watchCards[key]
    if (!card || card.state !== 'draft') return
    setWatchCard(key, { ...card, intervalMin: min })
  }

  const toggleWatch = async (task: WatchTask): Promise<void> => {
    setWatchBusy(true)
    try {
      await window.api.patchWatchTask(task.id, { status: task.status === 'active' ? 'paused' : 'active' })
      await reloadWatch()
    } finally {
      setWatchBusy(false)
    }
  }

  const runWatch = async (task: WatchTask): Promise<void> => {
    setWatchBusy(true)
    try {
      await window.api.runWatchNow(task.id)
      await reloadWatch()
    } catch (e) {
      setError((e as Error).message || '检查失败')
    } finally {
      setWatchBusy(false)
    }
  }

  const send = async (): Promise<void> => {
    const raw = text.trim()
    if (!raw || busy) return
    // 引用作为上下文附在问题前；引文长度做上限，避免提示词被长消息塞满
    const q = quote?.text.trim()
      ? `（关于我引用的内容：「${quote.text.trim().slice(0, 400)}」）\n\n${raw}`
      : raw
    /** 本轮是否已有真实计划预览（模型调了 create_plan） */
    const proposalBefore = proposalCountRef.current
    setError('')
    setText('')
    setQuote(null)
    setBusy(true)
    setToolHint('')
    const now = Date.now()
    const aiTs = now + 1
    const aiId = `a${aiTs}`
    // 没有当前会话：首条消息到达时新建一条（标题由首条用户消息生成）
    let sid = activeId
    if (!sid) {
      try {
        const created = (await window.api.createSession({
          title: raw.slice(0, 20),
          target: { kind: 'local' },
          first: { role: 'user', text: q, time: now }
        })) as ChatSession
        sid = created.id
        setActiveId(sid)
        setSessions((prev) => [created, ...prev])
        try { localStorage.setItem(ACTIVE_SESSION_KEY, sid) } catch { /* ignore */ }
        setMessages([
          { id: `s0_${now}`, role: 'user', text: q, ts: now },
          { id: aiId, role: 'ai', text: '', ts: aiTs }
        ])
      } catch (e) {
        setError(`建会话失败：${(e as Error).message}`)
        setBusy(false)
        return
      }
    } else {
      pushMsg({ id: `u${now}`, role: 'user', text: q, ts: now })
      pushMsg({ id: aiId, role: 'ai', text: '', ts: aiTs })
      persistItem(sid, 'user', q, now)
    }
    const sessionId = sid
    /** 本地/分支回答：显示 + 落库（同一条 AI 消息只落一次） */
    const say = (content: string, isError = false): void => {
      patchMsg(aiId, { text: content, error: isError })
      persistItem(sessionId, 'ai', content, aiTs)
    }
    /** 编排草稿 key：会话 id + 这条 AI 消息的时间 */
    const draftKey = `${sessionId}:${aiTs}`

    if (mode === 'dispatch') {
      if (!agentId) {
        setError('还没有可派发的 Agent，请先在 Agent 页接入')
        say('没有可派发的 Agent。', true)
        setBusy(false)
        return
      }
      if (!confirm) {
        setError('真实派发会执行代码，请先勾选确认')
        say('未勾选「允许真实执行代码」，已取消派发。', true)
        setBusy(false)
        return
      }
      try {
        const r = await window.api.dispatchAgent(agentId, q, undefined, true)
        say(r?.ok ? r.output || '（执行完成，无输出）' : r?.output || r?.error || '派发失败', !r?.ok)
        if (!r?.ok) setError(r?.error ?? '派发失败')
      } catch (e) {
        say((e as Error).message, true)
      } finally {
        setBusy(false)
      }
      return
    }

    // 抖音类：账号 + 要什么数据 + 存哪儿；后台读页面、分析、落到指定位置
    const douyinAsk = parseDouyinAsk(raw)
    if (douyinAsk) {
      if (!douyinAsk.urls.length) {
        say(
          '我需要在抖音里定位到你：把主页链接发我一次（或直接说「我的抖音」用当前登录账号）。之后只需要说「我的抖音」。'
        )
        setBusy(false)
        return
      }
      let projectId: string | undefined
      let workflowId: string | undefined
      try {
        if (douyinAsk.sinks.projectName) {
          const list = ((await window.api.listProjects?.()) as Array<{ id: string; name: string }>) ?? []
          const hit = list.find(
            (p) => p.name.includes(douyinAsk.sinks.projectName!) || douyinAsk.sinks.projectName!.includes(p.name)
          )
          projectId = hit?.id
        }
        if (douyinAsk.sinks.workflowName) {
          const res = (await window.api.workflowList?.()) as
            | { workflows?: Array<{ id: string; name: string }> }
            | undefined
          const hit = (res?.workflows ?? []).find(
            (w) => w.name.includes(douyinAsk.sinks.workflowName!) || douyinAsk.sinks.workflowName!.includes(w.name)
          )
          workflowId = hit?.id
        }
      } catch {
        /* 名称匹配失败不阻塞建任务 */
      }
      const sinks = {
        knowledge: douyinAsk.sinks.knowledge,
        persona: douyinAsk.sinks.persona,
        plan: douyinAsk.sinks.plan,
        projectId,
        workflowId
      }
      say(
        `收到：后台盯「${douyinAsk.sourceLabel}」，每 ${douyinAsk.intervalMin} 分钟读一次页面；第一次把已有内容读档做偏好分析，之后只处理新增。${projectId ? '知识会挂到你指定的项目；' : ''}${workflowId ? '有新内容会触发工作流。' : ''}需要你在内置浏览器登录抖音一次，登录态会自动复用。`
      )
      setWatchCard(draftKey, {
        title: douyinAsk.title,
        intent: raw.slice(0, 300),
        intervalMin: douyinAsk.intervalMin,
        points: douyinAsk.urls.map((u) => ({ url: u, label: douyinAsk.sourceLabel })),
        state: 'draft',
        sourceKind: 'browser-page',
        sourceLabel: douyinAsk.sourceLabel,
        sinks,
        projectName: douyinAsk.sinks.projectName,
        workflowName: douyinAsk.sinks.workflowName
      })
      setBusy(false)
      return
    }

    // 问一问：盯守——把一句话拆成多个独立盯点，确认后建任务
    const watchAsk = parseWatchAsk(raw)
    if (watchAsk) {
      let points = watchAsk.urls.map((u) => ({ url: u, label: hostOf(u) }))
      if (!points.length) {
        try {
          const st = (await window.api.getIntelState?.()) as
            | { watch?: Array<{ url: string; title: string; enabled?: boolean }> }
            | undefined
          const list = (st?.watch ?? []).filter((w) => w.enabled !== false)
          const named = list.filter((w) => raw.includes(w.title) || raw.includes(hostOf(w.url)))
          const pick = named.length ? named : /(这些|关注列表|情报源|我的源|所有源)/.test(raw) ? list : []
          points = pick.slice(0, WATCH_MAX_POINTS).map((w) => ({ url: w.url, label: w.title || hostOf(w.url) }))
        } catch {
          /* 情报源不可用时按无源处理 */
        }
      }
      if (!points.length) {
        say(
          '要盯哪些源？给我网址就行，例如：\n「盯着 https://sspai.com 和 https://36kr.com，每 30 分钟看一次，有新文章就提醒我」\n也可以先把网站加进情报关注列表，再对我说「盯着我的情报源」。'
        )
        setBusy(false)
        return
      }
      const title = watchAsk.title || `${points[0].label} 盯守`
      say(
        `把「${title}」拆成 ${points.length} 个盯点：各自独立巡检、独立去重，每 ${watchAsk.intervalMin} 分钟一轮；首次只建基线，之后有新内容才通知。`
      )
      setWatchCard(draftKey, {
        title,
        intent: raw.slice(0, 300),
        intervalMin: watchAsk.intervalMin,
        points,
        state: 'draft'
      })
      setBusy(false)
      return
    }

    // 问一问：编排（查节点 / 查已有工作流 / 一句话生成）
    const wfAsk = parseWorkflowAsk(q)
    if (wfAsk) {
      if (wfAsk.type === 'nodes') {
        let content = `当前可用的编排节点：\n${nodeCatalogText()}`
        try {
          const res = (await window.api.workflowList()) as { workflows?: WorkflowDef[] } | undefined
          const wfs = res?.workflows ?? []
          if (wfs.length) {
            content += `\n现有工作流 ${wfs.length} 条：\n${wfs.slice(0, 8).map((w) => `· ${w.name}（${w.nodes.length} 节点）`).join('\n')}`
          }
        } catch { /* 列表不可用不影响节点说明 */ }
        say(`${content}\n\n说「帮我编排：每天下班前收集今日轨迹 → 生成日报 → 存到知识库」，我直接生成一张图。`)
        setBusy(false)
        return
      }
      if (wfAsk.type === 'list') {
        try {
          const res = (await window.api.workflowList()) as { workflows?: WorkflowDef[] } | undefined
          const wfs = res?.workflows ?? []
          say(
            wfs.length
              ? `现有工作流 ${wfs.length} 条：\n${wfs.map((w) => `· ${w.name}（${w.nodes.length} 节点 / ${w.edges.length} 连线）`).join('\n')}\n\n说「帮我编排：…」可以新建一条。`
              : '还没有工作流——说「帮我编排：每天下班前收集今日轨迹 → 生成日报 → 存到知识库」我直接生成一条。'
          )
        } catch (e) {
          say(`读取工作流失败：${(e as Error).message}`, true)
        }
        setBusy(false)
        return
      }
      if (workflowDetail(q).length < 4) {
        say(`要编排什么？一句话说清目标和步骤，比如：\n「每天 18:00 收集今日轨迹 → 生成日报 → 存入知识库」\n\n可用节点：\n${nodeCatalogText()}`)
        setBusy(false)
        return
      }
      patchMsg(aiId, { text: '正在拆节点和连线…' })
      try {
        const r = (await window.api.workflowGenerate(q)) as
          | { ok?: boolean; workflow?: WorkflowDef; error?: string; referenceCount?: number }
          | undefined
        if (!r?.ok || !r.workflow) {
          say(`生成失败：${r?.error ?? '未知错误'}`, true)
        } else {
          const refNote = r.referenceCount ? `已参考 ${r.referenceCount} 条其他产品输出。\n\n` : ''
          say(refNote + wfSummary(r.workflow))
          setDraft(draftKey, { def: r.workflow, description: q, state: 'draft' })
        }
      } catch (e) {
        say(`生成失败：${(e as Error).message}`, true)
      } finally {
        setBusy(false)
      }
      return
    }

    // 问一问：数据在本机的先走本地意图（待办梳理 / 列表 / 天气 / 应用接管）
    try {
      const local = (await window.api.assistantIntent?.(q)) as AssistantIntentResult | undefined
      if (local?.matched) {
        patchMsg(aiId, { text: local.text ?? '', card: local.card })
        persistItem(sessionId, 'ai', local.text ?? '', aiTs)
        setBusy(false)
        return
      }
    } catch { /* 意图失败继续走 LLM */ }

    // 问一问：优先流式，事件丢失时用返回值/超时兜底
    let acc = ''
    let settled = false
    let guard = 0
    const cleanup = (): void => {
      for (const off of streamOffsRef.current) off()
      streamOffsRef.current = []
    }
    const finish = (content: string, isError = false): void => {
      if (settled) return
      settled = true
      cleanup()
      window.clearTimeout(guard)
      // A2UI：抽出卡片 JSON；校验失败原文保留（markdown 降级）
      const parsed = extractA2uiFromText(content)
      patchMsg(aiId, {
        text: parsed.surface && !parsed.text ? '' : parsed.text || '（没有回答）',
        surface: parsed.surface ?? undefined,
        error: isError,
        thinkingDone: true
      })
      persistItem(sessionId, 'ai', parsed.text || content || '（没有回答）', aiTs)
      // 本地兜底：用户明确要建计划、模型却没真正调 create_plan → 仍弹预览卡
      if (!isError && proposalCountRef.current === proposalBefore) {
        const draft = planDraftFromAsk(raw, parsed.text || content)
        if (draft) {
          void window.api.proposePlan?.({
            title: draft.title,
            date: todayKey(),
            startMin: draft.startMin,
            category: 'other'
          })
        }
      }
      setBusy(false)
      setToolHint('')
    }
    guard = window.setTimeout(() => finish(acc || '回答超时，请重试', true), 120000)
    const offChunk = window.api.onAIStreamChunk?.((p) => {
      const full = (p as { full?: string })?.full ?? ''
      acc = full
      // 最终回答开始到达 → 思考结束，思考链自动收起
      patchMsg(aiId, { text: full, thinkingDone: true })
    })
    const offReasoning = window.api.onAIStreamReasoning?.((p) => {
      const full = (p as { full?: string })?.full ?? ''
      if (!full) return
      patchMsg(aiId, { thinking: full, thinkingDone: false })
    })
    const offTool = window.api.onAIStreamTool?.((p) => {
      const tool = (p as { tool?: string })?.tool
      if (tool) {
        setToolHint(`正在使用 ${tool}…`)
        patchMsg(aiId, { thinkingDone: true })
      }
    })
    const offDone = window.api.onAIStreamDone?.((raw) => {
      const content =
        typeof raw === 'string' ? raw : ((raw as { content?: string })?.content ?? acc)
      finish(content || acc || '（没有回答）')
    })
    const offErr = window.api.onAIStreamError?.((p) => {
      finish(`回答失败：${(p as { error?: string })?.error ?? '未知错误'}`, true)
    })
    streamOffsRef.current = [offChunk, offReasoning, offTool, offDone, offErr].filter(Boolean) as Array<() => void>

    try {
      const r = (await window.api.askQAStream?.(q)) as { content?: string | null } | undefined
      if (!settled) finish(r?.content || acc || '（没有回答）')
    } catch (e) {
      finish(`回答失败：${(e as Error).message}`, true)
    }
  }

  /** 确认编排草稿：保存 → 切到编排页并定位到这条新工作流 */
  const confirmWf = async (key: string): Promise<void> => {
    const wf = drafts[key]
    if (!wf || wf.state !== 'draft' || wfBusy) return
    setWfBusy(true)
    setError('')
    const ts = Number(key.split(':')[1] || 0)
    try {
      const r = (await window.api.workflowSave(wf.def)) as { ok?: boolean; error?: string } | undefined
      if (!r?.ok) {
        setError(r?.error ?? '保存失败')
        return
      }
      setDraft(key, { ...wf, state: 'created' })
      setMessages((prev) =>
        prev.map((m) => (m.ts === ts ? { ...m, text: `已创建「${wf.def.name}」，正在打开编排页…` } : m))
      )
      useAppStore.getState().setView('workflow')
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('workon:workflow-generated', { detail: wf.def.id }))
      }, 120)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setWfBusy(false)
    }
  }

  /** 重新生成同一条需求 */
  const regenerateWf = async (key: string): Promise<void> => {
    const wf = drafts[key]
    if (!wf || wfBusy) return
    setWfBusy(true)
    setError('')
    const ts = Number(key.split(':')[1] || 0)
    setMessages((prev) => prev.map((m) => (m.ts === ts ? { ...m, text: '正在重新拆节点和连线…' } : m)))
    try {
      const r = (await window.api.workflowGenerate(wf.description)) as
        | { ok?: boolean; workflow?: WorkflowDef; error?: string }
        | undefined
      if (!r?.ok || !r.workflow) {
        setMessages((prev) =>
          prev.map((m) => (m.ts === ts ? { ...m, text: `重新生成失败：${r?.error ?? '未知错误'}`, error: true } : m))
        )
      } else {
        const def = r.workflow
        setDraft(key, { def, description: wf.description, state: 'draft' })
        setMessages((prev) =>
          prev.map((m) => (m.ts === ts ? { ...m, text: wfSummary(def), error: false } : m))
        )
      }
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) => (m.ts === ts ? { ...m, text: `重新生成失败：${(e as Error).message}`, error: true } : m))
      )
    } finally {
      setWfBusy(false)
    }
  }

  const discardWf = (key: string): void => {
    const wf = drafts[key]
    if (!wf) return
    setDraft(key, { ...wf, state: 'discarded' })
    const ts = Number(key.split(':')[1] || 0)
    setMessages((prev) =>
      prev.map((m) => (m.ts === ts ? { ...m, text: `已放弃「${wf.def.name}」。要重新来一次就说一声。` } : m))
    )
  }

  // Web 测试进度事件
  useEffect(() => {
    const off = window.api.onWebTestProgress?.((payload: unknown) => {
      const evt = payload as WebTestProgress
      if (!evt) return
      if (evt.message && evt.phase !== 'step') setTestProgress(evt.message)
      if (evt.phase === 'step' && evt.step) {
        const step = evt.step
        setTestSteps((prev) => [...prev.filter((s) => s.index !== step.index), step].sort((a, b) => a.index - b.index))
        if (evt.total) setTestProgress(`执行 ${evt.index}/${evt.total}`)
      }
      if (evt.phase === 'done' || evt.phase === 'error') {
        if (evt.report) setTestReport(evt.report)
        if (evt.phase === 'error' && evt.message) setTestProgress(`中断：${evt.message}`)
        setTestBusy(false)
      }
    })
    return () => off?.()
  }, [])

  const startWebTest = async (): Promise<void> => {
    if (testBusy) return
    setTestBusy(true)
    setTestProgress('准备中…')
    setTestSteps([])
    setTestReport(null)
    try {
      const kinds = (Object.keys(testKinds) as ('flow' | 'inspect' | 'form')[]).filter((k) => testKinds[k])
      const r = (await window.api.runWebTest({ url, goal: testGoal.trim(), kinds, maxSteps: 8 })) as WebTestReport
      setTestReport(r)
    } catch (e) {
      setTestProgress((e as Error).message)
    } finally {
      setTestBusy(false)
    }
  }

  const refreshChrome = async (): Promise<void> => {
    try {
      const list = (await window.api.chromeTabs?.()) as ChromeTabInfo[] | undefined
      if (Array.isArray(list)) setChromeTabs(list)
      const st = (await window.api.browserState?.()) as { url?: string; title?: string } | undefined
      if (st?.url) {
        setUrl(st.url)
        setTitle(st.title ?? '')
      }
    } catch { /* ignore */ }
  }

  const go = async (): Promise<void> => {
    setBrowserError('')
    const r = (await window.api.browserNavigate(url)) as { ok?: boolean; error?: string }
    if (!r?.ok) {
      setBrowserError(r?.error ?? '打开失败')
      return
    }
    if (kind === 'chrome') window.setTimeout(() => void refreshChrome(), 500)
  }

  const nav = async (which: 'back' | 'forward' | 'reload'): Promise<void> => {
    const fn = which === 'back' ? window.api.browserBack : which === 'forward' ? window.api.browserForward : window.api.browserReload
    await fn()
    if (kind === 'chrome') window.setTimeout(() => void refreshChrome(), 500)
  }

  const pickTab = async (tabId: number): Promise<void> => {
    setBrowserError('')
    const r = (await window.api.chromeActivate?.(tabId)) as { ok?: boolean; error?: string } | null
    if (r && r.ok === false) setBrowserError(r.error ?? '切换标签失败')
    window.setTimeout(() => void refreshChrome(), 300)
  }

  const openExtFolder = async (): Promise<void> => {
    setBrowserError('')
    const r = (await window.api.chromeOpenExtension?.()) as { ok?: boolean; error?: string } | undefined
    if (!r?.ok) setBrowserError(r?.error ?? '打开扩展目录失败')
  }

  const readPage = async (): Promise<void> => {
    setReading(true)
    setBrowserError('')
    try {
      const r = (await window.api.browserRead()) as BrowserRead
      if (!r.ok) setBrowserError(r.error ?? '读取失败')
      else setRead(r)
    } finally {
      setReading(false)
    }
  }

  const lastAiText = [...messages].reverse().find((m) => m.role === 'ai' && m.text.trim())?.text ?? ''
  const activeSession = sessions.find((s) => s.id === activeId)
  /** 归档会话不在切换列表出现；当前会话仍可继续查看 */
  const switchableSessions = sessions.filter((s) => !s.archived)
  /** 编排草稿按「当前会话 + 消息时间」取 */
  const wfKeyOf = (m: ChatMsg): string => `${activeId}:${m.ts}`

  return (
    <>
      {!open && !isPage && !isFloat ? (
        <button
          type="button"
          onClick={onOpen}
          className="glass-card fixed bottom-5 right-5 z-[60] flex h-11 max-w-[340px] items-center gap-2.5 px-2.5 text-left"
          style={{ borderRadius: 999, boxShadow: 'var(--shadow-lg)' }}
          title="打开右侧对话 / 浏览器（⌘K）"
        >
          <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}>
            <Icon name="sparkles" size={13} />
            <span className="absolute -inset-0.5 animate-pulse rounded-full border" style={{ borderColor: 'var(--accent)', opacity: 0.35 }} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-2xs leading-3 text-slate-500">姵儿 · WorkOn</span>
            <span className="max-w-[240px] truncate text-xs leading-4 text-slate-200">
              {lastAiText ? lastAiText.replace(/\s+/g, ' ').slice(0, 40) : '今天要做什么？'}
            </span>
          </span>
        </button>
      ) : null}

      <aside
        className="relative flex h-full min-h-0 shrink-0 flex-col"
        style={{
          width: isFull ? '100%' : width,
          display: open || isPage ? 'flex' : 'none',
          background: 'var(--bg-deep)',
          borderLeft: isFull ? 'none' : '1px solid var(--line)'
        }}
      >
      {/* 左边缘调宽（整页 / 浮窗形态不需要） */}
      {!isFull ? (
        <div
          onPointerDown={startResize}
          title="拖动调整侧栏宽度"
          className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-[var(--accent)]"
          style={{ opacity: 0.35 }}
        />
      ) : null}

      {/* 顶部：对话 / 浏览器 标签（整页形态只留聊天） */}
      {!isPage ? (
      <div className="flex shrink-0 items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--line)' }}>
        <span
          className="inline-flex h-6 w-6 items-center justify-center rounded-full"
          style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}
        >
          <Icon name="sparkles" size={12} />
        </span>
        <span className="shrink-0 text-xs font-medium text-[var(--text-2)]">全局会话</span>
        <div className="flex rounded-lg p-0.5" style={{ background: 'var(--surface-2)' }}>
          {(['chat', 'browser'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-md px-2.5 py-1 text-xs ${
                tab === t
                  ? 'bg-[var(--surface-3)] text-[var(--text-1)]'
                  : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
              }`}
            >
              {t === 'chat' ? '对话' : '浏览器'}
            </button>
          ))}
        </div>

        {/* 命令条工具：会话切换 / 新建 / 问一问·派发统一收进头部 */}
        <div className="relative ml-auto flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => { setSessionsOpen((v) => !v); void reloadSessions() }}
            className="flex min-w-0 max-w-[280px] items-center gap-1.5 rounded-lg px-2 py-1 text-2xs"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
            title="切换历史会话"
          >
            <Icon name="message" size={11} className="shrink-0 opacity-60" />
            <span className="min-w-0 truncate text-left text-[var(--text-2)]">{activeSession?.title || '新会话'}</span>
            <span className="shrink-0 text-[var(--text-3)]">会话 {switchableSessions.length} ▾</span>
          </button>
          {sessionsOpen ? (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setSessionsOpen(false)} />
              <div
                className="absolute right-0 top-full z-40 mt-1 max-h-72 w-72 overflow-auto rounded-xl p-1"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)' }}
              >
                {switchableSessions.length === 0 ? (
                  <div className="px-2 py-1.5 text-2xs text-[var(--text-3)]">还没有会话，发一句就开始</div>
                ) : null}
                {switchableSessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => openSession(s.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-2xs ${
                      s.id === activeId
                        ? 'bg-[var(--surface-3)] text-[var(--text-1)]'
                        : 'text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{s.title || '未命名会话'}</span>
                    <span className="shrink-0 text-[var(--text-3)]">{s.items.length} 条</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <button type="button" className="glass-btn shrink-0 px-2 py-1 text-2xs" onClick={newChat} title="新建会话">
          ＋ 新会话
        </button>
        {isFloat ? null : (
          <>
            <button
              className="ui-icon-btn"
              style={{ border: '1px solid var(--line)', color: 'var(--text-2)' }}
              onClick={onClose}
              title="收起为胶囊"
              aria-label="收起"
            >
              <Icon name="minimize" size={12} />
            </button>
            <button
              className="ui-icon-btn"
              style={{ border: '1px solid var(--line)', color: 'var(--text-2)' }}
              onClick={() => { onClose(); setText(''); setError('') }}
              title="关闭"
              aria-label="关闭侧栏"
            >
              <Icon name="x" size={12} />
            </button>
          </>
        )}
      </div>
      ) : null}

      {/* 对话面板：Qoder 式消息流，切到浏览器时只隐藏不卸载 */}
      <div
        className="min-h-0 flex-1 flex-col"
        style={{
          display: tab === 'chat' ? 'flex' : 'none',
          ...(isPage ? { width: '100%', maxWidth: 860, margin: '0 auto' } : null)
        }}
      >
          {/* 整页形态没有头部，会话切换与模式仍放在输入区上方 */}
          {isPage ? (
            <>
              <div className="relative flex shrink-0 items-center gap-1.5 px-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setSessionsOpen((v) => !v); void reloadSessions() }}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1 text-2xs"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                  title="切换历史会话"
                >
                  <Icon name="message" size={11} className="shrink-0 opacity-60" />
                  <span className="min-w-0 flex-1 truncate text-left text-[var(--text-2)]">
                    {activeSession?.title || '新会话'}
                  </span>
                  <span className="shrink-0 text-[var(--text-3)]">会话 {switchableSessions.length} ▾</span>
                </button>
                <button type="button" className="glass-btn shrink-0 px-2 py-1 text-2xs" onClick={newChat} title="新建会话">
                  ＋ 新会话
                </button>
                {sessionsOpen ? (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setSessionsOpen(false)} />
                    <div
                      className="absolute left-3 right-3 top-full z-40 mt-1 max-h-72 overflow-auto rounded-xl p-1"
                      style={{ background: 'var(--bg-surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)' }}
                    >
                      {switchableSessions.length === 0 ? (
                        <div className="px-2 py-1.5 text-2xs text-[var(--text-3)]">还没有会话，发一句就开始</div>
                      ) : null}
                      {switchableSessions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => openSession(s.id)}
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-2xs ${
                            s.id === activeId
                              ? 'bg-[var(--surface-3)] text-[var(--text-1)]'
                              : 'text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">{s.title || '未命名会话'}</span>
                          <span className="shrink-0 text-[var(--text-3)]">{s.items.length} 条</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            </>
          ) : null}

          <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3 py-3">
            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <span
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full"
                  style={{ background: 'var(--accent-softer, var(--surface-3))', color: 'var(--accent)' }}
                >
                  <Icon name="sparkles" size={18} />
                </span>
                <div className="text-xs text-slate-500">问点什么，或者让我去操作浏览器</div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {['今天做了什么？', '我有哪些节点', '帮我编排一个工作流', '测一下当前网页有没有问题'].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { setText(s); inputRef.current?.focus() }}
                      className="rounded-full px-2.5 py-1 text-2xs text-slate-400 hover:text-slate-200"
                      style={{ background: 'var(--surface-2)' }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => {
                // 历史消息里的 A2UI 围栏也在渲染时抽出来（旧消息不重写库也能显示成卡片）
                const parsedA2 = m.role === 'ai' && !m.surface ? extractA2uiFromText(m.text) : null
                const displayText = parsedA2 ? parsedA2.text : m.text
                const surface = m.surface ?? parsedA2?.surface ?? null
                const watchCard = activeId ? watchCards[wfKeyOf(m)] : undefined
                const watchTask = watchCard?.taskId
                  ? watchTasks.find((t) => t.id === watchCard.taskId)
                  : undefined
                return (
                <div key={m.id} className={`group flex items-end gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  {m.role === 'ai' ? (
                    <span
                      className="mb-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                      style={{ background: 'var(--accent-softer, var(--surface-3))', color: 'var(--accent)' }}
                    >
                      <Icon name="sparkles" size={11} />
                    </span>
                  ) : null}
                  <div className={`flex min-w-0 flex-col gap-1 ${m.role === 'ai' ? 'max-w-[92%] items-start' : 'max-w-[86%] items-end'}`}>
                    {m.role === 'ai' && m.thinking ? (
                      <ThinkingBlock text={m.thinking} done={m.thinkingDone} />
                    ) : null}
                    {displayText || (busy && m.role === 'ai' && !surface && !m.thinking) ? (
                    <div
                      className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-xs leading-relaxed ${m.role === 'user' ? 'rounded-br-sm' : 'rounded-bl-sm'}`}
                      style={{
                        background: m.role === 'user' ? 'var(--accent)' : 'var(--surface-2)',
                        color: m.role === 'user' ? 'var(--bg-deep)' : m.error ? '#fda4af' : 'var(--text-2, #cbd5e1)',
                        border: m.role === 'ai' ? '1px solid var(--line)' : 'none'
                      }}
                    >
                      {displayText || '思考中…'}
                    </div>
                    ) : null}
                    <button
                      type="button"
                      className={`text-2xs opacity-0 transition-opacity group-hover:opacity-100 ${m.role === 'ai' ? 'self-start' : 'self-end'}`}
                      style={{ color: 'var(--text-3)' }}
                      title="引用这条消息（选中一段则只引用选中的文字）"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        quoteSelRef.current = window.getSelection()?.toString().trim() ?? ''
                      }}
                      onClick={() => {
                        const picked = quoteSelRef.current
                        quoteSelRef.current = ''
                        setQuote({
                          from: m.role === 'ai' ? 'AI' : '我',
                          text: picked && displayText.includes(picked) ? picked : displayText
                        })
                      }}
                    >
                      引用
                    </button>
                    {activeId && drafts[wfKeyOf(m)] ? (
                      <WfDraftCard
                        draft={drafts[wfKeyOf(m)]}
                        busy={wfBusy}
                        onConfirm={() => void confirmWf(wfKeyOf(m))}
                        onRegenerate={() => void regenerateWf(wfKeyOf(m))}
                        onDiscard={() => discardWf(wfKeyOf(m))}
                      />
                    ) : null}
                    {activeId && watchCard ? (
                      <WatchCard
                        card={watchCard}
                        task={watchTask}
                        busy={watchBusy}
                        onConfirm={() => void confirmWatch(wfKeyOf(m))}
                        onDiscard={() => discardWatch(wfKeyOf(m))}
                        onInterval={(min) => changeWatchInterval(wfKeyOf(m), min)}
                        onToggle={() => {
                          if (watchTask) void toggleWatch(watchTask)
                        }}
                        onRun={() => {
                          if (watchTask) void runWatch(watchTask)
                        }}
                      />
                    ) : null}
                    {m.card ? <div className="w-full"><AssistantCardView card={m.card} /></div> : null}
                    {surface ? <div className="w-full"><A2uiSurfaceView surface={surface} /></div> : null}
                  </div>
                </div>
                )
              })
            )}
          </div>

          {error ? (
            <div className="mx-3 mb-2 shrink-0 rounded-lg px-3 py-2 text-xs text-rose-300" style={{ background: 'rgba(244,63,94,0.12)' }}>{error}</div>
          ) : null}
          {busy && toolHint ? (
            <div className="shrink-0 px-3 pb-1 text-2xs" style={{ color: 'var(--accent)' }}>{toolHint}</div>
          ) : null}

          <div className="shrink-0 p-3 pt-2" style={{ borderTop: '1px solid var(--line)' }}>
            {quote ? (
              <div className="mb-2 rounded-xl p-2" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <div className="mb-1 flex items-center gap-1.5 text-2xs" style={{ color: 'var(--text-3)' }}>
                  <Icon name="message" size={11} />
                  <span>引用 · {quote.from} · 可编辑</span>
                  <span className="flex-1" />
                  <button type="button" className="ui-icon-btn" aria-label="清除引用" title="清除引用" onClick={() => setQuote(null)}>
                    <Icon name="x" size={11} />
                  </button>
                </div>
                <textarea
                  value={quote.text}
                  onChange={(e) => setQuote((qq) => (qq ? { ...qq, text: e.target.value } : qq))}
                  rows={2}
                  className="w-full resize-none bg-transparent text-xs leading-relaxed outline-none"
                  style={{ color: 'var(--text-2)', maxHeight: 90 }}
                />
              </div>
            ) : null}
            {mode === 'dispatch' ? (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <select
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  className="min-w-0 rounded-lg px-2 py-1.5 text-xs text-[var(--text-1)] outline-none"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                >
                  {agents.length === 0 ? <option value="">暂无可派发 Agent</option> : null}
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} · {a.protocol.toUpperCase()}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-2xs text-[var(--text-3)]">
                  <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                  允许真实执行代码
                </label>
              </div>
            ) : null}
            <div
              className="ui-field-shell flex items-end gap-2 rounded-xl px-2 py-1.5"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
            >
              <div className="flex shrink-0 self-center rounded-lg p-0.5" style={{ background: 'var(--surface-3)' }}>
                {(['ask', 'dispatch'] as Mode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setMode(m); setError('') }}
                    className={`rounded-md px-1.5 py-0.5 text-2xs transition-colors ${
                      mode === m
                        ? 'bg-[var(--bg-surface)] text-[var(--text-1)]'
                        : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
                    }`}
                  >
                    {m === 'ask' ? '问一问' : '派发'}
                  </button>
                ))}
              </div>
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as KeyboardEvent).isComposing) {
                    e.preventDefault()
                    void send()
                  }
                }}
                rows={1}
                placeholder={
                  mode === 'ask'
                    ? '问点什么…（Enter 发送 · Shift+Enter 换行）'
                    : '写给 Agent 的任务…（Enter 派发）'
                }
                className="min-h-[26px] flex-1 resize-none overflow-y-auto bg-transparent px-1 py-1 text-sm text-[var(--text-1)] outline-none"
                style={{ maxHeight: 120 }}
              />
              <button
                type="button"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40"
                style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}
                disabled={busy || !text.trim()}
                title={busy ? '处理中…' : mode === 'ask' ? '发送（Enter）' : '派发（Enter）'}
                aria-label={busy ? '处理中' : mode === 'ask' ? '发送' : '派发'}
                onClick={() => void send()}
              >
                <Icon name="send" size={13} />
              </button>
            </div>
          </div>
      </div>

      {/* 浏览器面板：保持挂载，切标签不丢页面（整页形态不挂） */}
      {!isPage ? (
      <div className="min-h-0 flex-1 flex-col" style={{ display: tab === 'browser' ? 'flex' : 'none' }}>
          {/* 浏览器工具栏 */}
          <div className="flex shrink-0 items-center gap-1 px-2 py-1.5" style={{ borderBottom: '1px solid var(--line)' }}>
            <button className="ui-icon-btn" title="后退" onClick={() => void nav('back')}>
              <Icon name="chevronLeft" size={13} />
            </button>
            <button className="ui-icon-btn" title="前进" onClick={() => void nav('forward')}>
              <Icon name="chevronRight" size={13} />
            </button>
            <button className="ui-icon-btn" title="刷新" onClick={() => void nav('reload')}>
              <Icon name="refresh" size={12} />
            </button>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void go() }}
              spellCheck={false}
              placeholder="输入网址或搜索词"
              className="min-w-0 flex-1 rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
            />
            <button className="ui-icon-btn" title="读取页面（Agent 同款）" onClick={() => void readPage()}>
              <Icon name={reading ? 'refresh' : 'eye'} size={13} />
            </button>
            <button
              className="ui-icon-btn"
              title="Web 测试（巡检 / 流程 / 表单）"
              onClick={() => setTestOpen((v) => !v)}
              style={{ color: testOpen ? 'var(--accent)' : undefined }}
            >
              <Icon name="scan" size={13} />
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-2 px-2 py-1 text-2xs text-slate-600" style={{ borderBottom: '1px solid var(--line)' }}>
            <div className="flex shrink-0 rounded-md p-0.5" style={{ background: 'var(--surface-2)' }}>
              {(['embedded', 'chrome'] as BrowserKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setBrowserError(''); setKind(k) }}
                  className={`rounded px-1.5 py-0.5 ${kind === k ? 'bg-[var(--surface-3)] text-slate-100' : 'text-slate-500'}`}
                  title={k === 'embedded' ? '应用内 Chromium，登录态独立' : '操作你本机真实 Chrome 的标签页'}
                >
                  {k === 'embedded' ? '内置' : '本机 Chrome'}
                </button>
              ))}
            </div>
            <span className="truncate">{loading ? '加载中…' : title || '空白页'}</span>
            <span className="ml-auto shrink-0" style={{ color: (kind === 'chrome' ? chromeOn : attached) ? 'var(--accent)' : 'var(--text-4, #6b7280)' }}>
              {kind === 'chrome'
                ? chromeOn
                  ? `已连接${chromeVersion ? ` · v${chromeVersion}` : ''}`
                  : '未连接扩展'
                : attached
                  ? 'Agent 可读取'
                  : '连接中…'}
            </span>
          </div>

          {browserError ? (
            <div className="shrink-0 px-3 py-1.5 text-2xs text-rose-300" style={{ background: 'rgba(244,63,94,0.12)' }}>{browserError}</div>
          ) : null}

          {/* 内置浏览器：保持挂载，切到 Chrome 模式只隐藏 */}
          <div ref={hostRef} className="min-h-0 flex-1" style={{ display: kind === 'embedded' ? 'block' : 'none' }} />

          {/* 本机 Chrome 面板 */}
          <div className="min-h-0 flex-1 flex-col gap-2 overflow-auto p-2.5" style={{ display: kind === 'chrome' ? 'flex' : 'none' }}>
            {!chromeOn ? (
              <div className="rounded-lg p-3" style={{ background: 'var(--surface-2)' }}>
                <div className="mb-1 text-xs text-slate-200">连接本机 Chrome</div>
                <ol className="list-decimal space-y-1 pl-4 text-2xs leading-relaxed text-slate-400">
                  <li>点下方「打开扩展目录」，或直接打开 <span className="text-slate-300">workon/browser-extension</span></li>
                  <li>Chrome 打开 <span className="text-slate-300">chrome://extensions</span>，开启右上角「开发者模式」</li>
                  <li>点「加载已解压的扩展程序」，选择该目录</li>
                  <li>扩展会自动连接 WorkOn 本地桥（127.0.0.1），无需额外配置</li>
                </ol>
                <div className="mt-2 flex items-center gap-2">
                  <button className="glass-btn px-2 py-1 text-2xs" onClick={() => void openExtFolder()}>打开扩展目录</button>
                  <button className="glass-btn px-2 py-1 text-2xs" onClick={() => void refreshChrome()}>重新检测</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-2xs text-slate-400" style={{ background: 'var(--surface-2)' }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
                已连接本机 Chrome，操作的是你真实浏览器里的标签页
                <button className="ml-auto shrink-0 text-slate-500 hover:text-slate-200" onClick={() => void openExtFolder()}>扩展目录</button>
              </div>
            )}

            <div className="flex items-center gap-2 text-2xs text-slate-500">
              <span>标签页 {chromeTabs.length ? `· ${chromeTabs.length}` : ''}</span>
              <button className="ml-auto text-slate-500 hover:text-slate-200" onClick={() => void refreshChrome()}>刷新</button>
              <button
                className="text-slate-500 hover:text-slate-200"
                onClick={async () => {
                  const r = (await window.api.chromeOpen?.(url)) as { ok?: boolean; error?: string } | null
                  if (r && r.ok === false) setBrowserError(r.error ?? '打开标签失败')
                  window.setTimeout(() => void refreshChrome(), 500)
                }}
              >
                新标签打开当前网址
              </button>
            </div>

            <div className="flex flex-col gap-1">
              {chromeTabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => void pickTab(t.id)}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-2xs"
                  style={{ background: t.active ? 'var(--surface-3)' : 'var(--surface-2)' }}
                  title={t.url}
                >
                  <span className="min-w-0 flex-1 truncate text-slate-300">{t.title || t.url}</span>
                  {t.active ? <span className="shrink-0" style={{ color: 'var(--accent)' }}>当前</span> : null}
                </button>
              ))}
              {chromeOn && chromeTabs.length === 0 ? (
                <div className="px-1 py-2 text-2xs text-slate-600">没有可操作的标签页，先在 Chrome 打开一个网页</div>
              ) : null}
            </div>
          </div>


          {/* Web 测试抽屉 */}
          {testOpen ? (
            <div
              className="flex max-h-[56%] shrink-0 flex-col gap-2 overflow-auto p-2.5"
              style={{ borderTop: '1px solid var(--line)', background: 'var(--surface-2)' }}
            >
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-2xs text-slate-300">Web 测试</span>
                <span className="min-w-0 truncate text-2xs text-slate-600">{url}</span>
                <button className="ml-auto shrink-0 text-2xs text-slate-500 hover:text-slate-200" onClick={() => setTestOpen(false)}>
                  收起
                </button>
              </div>
              <textarea
                value={testGoal}
                onChange={(e) => setTestGoal(e.target.value)}
                rows={2}
                placeholder="测试目标，例如：登录后进入个人中心并检查昵称；留空则只做页面巡检"
                className="w-full shrink-0 resize-none rounded-lg px-2 py-1.5 text-2xs text-slate-200 outline-none"
                style={{ background: 'var(--surface-1, var(--bg-deep))', border: '1px solid var(--line)' }}
              />
              <div className="flex shrink-0 flex-wrap items-center gap-2 text-2xs text-slate-400">
                {([
                  ['flow', '流程回归'],
                  ['inspect', '页面巡检'],
                  ['form', '表单边界']
                ] as ['flow' | 'inspect' | 'form', string][]).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={testKinds[k]}
                      onChange={(e) => setTestKinds((prev) => ({ ...prev, [k]: e.target.checked }))}
                    />
                    {label}
                  </label>
                ))}
                <button
                  className="glass-btn primary ml-auto px-2 py-1 text-2xs"
                  disabled={testBusy}
                  onClick={() => void startWebTest()}
                >
                  {testBusy ? '测试中…' : '开始测试'}
                </button>
              </div>
              {testProgress ? <div className="text-2xs" style={{ color: 'var(--accent)' }}>{testProgress}</div> : null}
              {testSteps.length ? (
                <div className="flex flex-col gap-1">
                  {testSteps.map((s) => (
                    <div key={s.index} className="flex items-start gap-1.5 text-2xs">
                      <span style={{ color: s.status === 'pass' ? 'var(--accent)' : '#f87171' }}>
                        {s.status === 'pass' ? '✓' : '✕'}
                      </span>
                      <span className="shrink-0 text-slate-500">{s.index}. {s.action}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-400">{s.note || s.target || s.expect}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {testReport ? (
                <div className="flex flex-col gap-1.5 rounded-lg p-2" style={{ background: 'var(--surface-3)' }}>
                  <div className="flex items-center gap-2 text-2xs">
                    <span style={{ color: 'var(--accent)' }}>通过 {testReport.summary.pass}</span>
                    <span className="text-rose-300">失败 {testReport.summary.fail}</span>
                    <span className="text-slate-500">问题 {testReport.issues.length}</span>
                    <span className="ml-auto text-slate-600">{Math.round(testReport.durationMs / 1000)}s</span>
                  </div>
                  {testReport.issues.map((it, i) => (
                    <div key={i} className="text-2xs">
                      <span
                        style={{
                          color: it.level === 'high' ? '#f87171' : it.level === 'medium' ? '#fbbf24' : '#94a3b8'
                        }}
                      >
                        ●
                      </span>
                      <span className="text-slate-300"> {it.title}</span>
                      {it.detail ? (
                        <div className="pl-3 text-slate-600">{it.detail.split('\n')[0].slice(0, 120)}</div>
                      ) : null}
                    </div>
                  ))}
                  {testReport.conclusion ? (
                    <pre className="whitespace-pre-wrap text-2xs leading-relaxed text-slate-400">{testReport.conclusion}</pre>
                  ) : null}
                  {testReport.reportPath ? (
                    <div className="truncate text-2xs text-slate-600">报告：{testReport.reportPath}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {read ? (
            <div className="flex max-h-[42%] shrink-0 flex-col gap-1.5 overflow-auto p-2.5" style={{ borderTop: '1px solid var(--line)', background: 'var(--surface-2)' }}>
              <div className="flex items-center gap-2">
                <span className="truncate text-2xs text-slate-400">{read.title || read.url}</span>
                <button className="ml-auto text-2xs text-slate-500 hover:text-slate-200" onClick={() => setRead(null)}>收起</button>
              </div>
              <pre className="whitespace-pre-wrap text-2xs leading-relaxed text-slate-400">{read.text?.slice(0, 3000)}</pre>
              {read.items?.length ? (
                <div className="flex flex-wrap gap-1">
                  {read.items.slice(0, 20).map((it, i) => (
                    <button
                      key={`${it.selector}-${i}`}
                      type="button"
                      title={it.selector}
                      onClick={async () => {
                        const r = (await window.api.browserClick(it.selector)) as { ok?: boolean; error?: string }
                        if (!r?.ok) setBrowserError(r?.error ?? '点击失败')
                      }}
                      className="rounded-md px-1.5 py-0.5 text-2xs text-slate-400"
                      style={{ background: 'var(--surface-3)' }}
                    >
                      {it.tag} · {it.text.slice(0, 18)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
      </div>
      ) : null}
      </aside>
    </>
  )
}
