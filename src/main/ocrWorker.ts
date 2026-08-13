/**
 * OCR 深度模式：截图 → 落盘 → OCR 引擎识别 → 关键词提取 → 增强状态推断
 * 支持 Tesseract.js（默认回退）和 RapidOCR-json（5x 提速）
 * 仅在 deepMode 开启时运行，变化驱动采样 + 每应用自适应频率
 */
import { desktopCapturer, app } from 'electron'
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { getSettings } from './settings'
import { presence } from './presence'
import { getActiveEngine, recognizeWithRapidOCR } from './ocrEngine'
import type { WorkState } from '@shared/types'

// v2.9 报表 OCR 采集订阅：每次 OCR 产出文本行时广播给订阅者（ocrCollector 落库结构化快照）
export type OcrLinesListener = (lines: string[], app: string, state: WorkState) => void
const ocrLinesListeners = new Set<OcrLinesListener>()

/** 订阅 OCR 文本产出；返回取消订阅函数 */
export function onOcrLines(cb: OcrLinesListener): () => void {
  ocrLinesListeners.add(cb)
  return () => ocrLinesListeners.delete(cb)
}

// 动态导入 tesseract（避免阻塞启动）
let recognizeFn: typeof import('tesseract.js').recognize | null = null
let workerLoading = false

async function ensureRecognize(): Promise<typeof import('tesseract.js').recognize> {
  if (recognizeFn) return recognizeFn
  if (workerLoading) {
    for (let i = 0; i < 50 && !recognizeFn; i++) {
      await new Promise((r) => setTimeout(r, 200))
    }
    if (recognizeFn) return recognizeFn
    throw new Error('OCR worker 加载超时')
  }
  workerLoading = true
  try {
    const mod = await import('tesseract.js')
    // Electron 主进程 CJS 兼容：取 default 或直接使用
    recognizeFn = (mod as { recognize?: typeof import('tesseract.js').recognize; default?: { recognize: typeof import('tesseract.js').recognize } }).recognize
      ?? (mod as { default: { recognize: typeof import('tesseract.js').recognize } }).default.recognize
    console.log('[ocr] Tesseract worker 已就绪')
    return recognizeFn!
  } finally {
    workerLoading = false
  }
}

/** 截图落盘目录 */
function shotsDir(): string {
  return path.join(app.getPath('userData'), 'screenshots')
}

/** 从桌面截图提取文字关键词 */
export async function ocrScreen(): Promise<string[]> {
  try {
    // 隐私联动：当前前台应用被标记排除时，本轮不截屏
    if (presence.excludedActive) return []

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 960, height: 540 }
    })
    if (!sources.length) return []

    const source = sources[0]
    const png = source.thumbnail.toPNG()

    // 落盘截图（OCR 资源管理统计用；自动压缩开启时存 jpg，节省约 50% 空间）
    try {
      const dir = shotsDir()
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const compress = getSettings().ocrAutoCompress
      const file = path.join(dir, `shot-${Date.now()}.${compress ? 'jpg' : 'png'}`)
      if (compress) {
        fs.writeFileSync(file, await sharp(png).jpeg({ quality: 60 }).toBuffer())
      } else {
        fs.writeFileSync(file, png)
      }
      // 只保留最近 N 张（缓存上限可配）
      const limit = Math.max(50, getSettings().ocrCacheLimit || 200)
      const files = fs.readdirSync(dir).filter((f) => /\.(png|jpg)$/.test(f)).sort()
      if (files.length > limit) {
        for (const f of files.slice(0, files.length - limit)) {
          try { fs.unlinkSync(path.join(dir, f)) } catch { /* ignore */ }
        }
      }
    } catch { /* 落盘失败不影响 OCR */ }

    // 缩小 + 灰度化（OCR 更快更准）
    const engine = getActiveEngine()
    let text: string

    if (engine === 'rapidocr') {
      // RapidOCR: 保留彩色（它有自己的预处理），只 resize
      const processed = await sharp(png)
        .resize(800, 450, { fit: 'inside' })
        .toBuffer()
      const result = await recognizeWithRapidOCR(processed)
      text = result.text
    } else {
      // Tesseract.js: 灰度化 + 归一化
      const recognize = await ensureRecognize()
      const processed = await sharp(png)
        .resize(800, 450, { fit: 'inside' })
        .grayscale()
        .normalize()
        .toBuffer()

      const { data } = await recognize(processed, 'chi_sim+eng', {
        // @ts-expect-error tesseract options
        tessedit_pageseg_mode: '6',
        workerPath: path.join(app.getAppPath(), 'assets', 'tesseractWorker.js'),
        langPath: path.join(app.getAppPath(), 'assets'),
        gzip: false,
        cacheMethod: 'read'
      })
      text = data.text || ''
    }
    if (!text.trim()) return []

    // 提取关键词：按行分割，过滤短行和纯数字/符号
    const lines = text
      .split(/\n/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 2 && !/^[\d\s.,;:!?()（）\-—…·""''«»\[\]{}/\\|@#$%^&*+=~`]+$/.test(l))
      .slice(0, 20)

    return lines
  } catch (e) {
    console.warn('[ocr] 截图 OCR 失败:', (e as Error).message)
    return []
  }
}

/** 根据 OCR 文本推断浏览器内容类别 */
export function classifyOcrText(lines: string[]): string | null {
  const text = lines.join(' ').toLowerCase()

  const rules: { match: RegExp; label: string }[] = [
    { match: /bilibili|哔哩|b站|番剧|鬼畜|舞蹈|直播/, label: 'B站/视频' },
    { match: /youtube|油管|订阅/, label: 'YouTube' },
    { match: /抖音|douyin|推荐|关注|直播/, label: '抖音' },
    { match: /斗鱼|douyu|虎牙|huya|twitch/, label: '直播' },
    { match: /淘宝|taobao|天猫|tmall|购物车|订单|收藏/, label: '淘宝/购物' },
    { match: /京东|jd\.com|商品|plus/, label: '京东' },
    { match: /微博|weibo|热搜|超话/, label: '微博' },
    { match: /知乎|zhihu|回答|赞同|关注问题/, label: '知乎' },
    { match: /贴吧|tieba|帖子|楼主|回复/, label: '贴吧' },
    { match: /reddit|r\/|upvote|comment/, label: 'Reddit' },
    { match: /twitter|x\.com|转发|推文/, label: 'Twitter/X' },
    { match: /github|pull request|issue|repository|commit|clone|push/, label: 'GitHub' },
    { match: /stackoverflow|stack overflow|answers|votes/, label: 'StackOverflow' },
    { match: /掘金|juejin|点赞|收藏|关注|沸点/, label: '掘金' },
    { match: /csdn|blog|博客|原创|转载/, label: 'CSDN/博客' },
    { match: /chatgpt|openai|claude|gemini|copilot|kimi|通义|文心|豆包/, label: 'AI助手' },
    { match: /notion|飞书|语雀|confluence|文档|doc/, label: '文档协作' },
    { match: /figma|设计|sketch|组件|画板/, label: '设计工具' },
    { match: /jira|看板|sprint|backlog|story/, label: 'JIRA/项目管理' },
    { match: /gmail|outlook|收件箱|邮件|inbox/, label: '邮件' },
    { match: /vscode|code|terminal|console|npm|import|export|function|class|const/, label: '编程/开发' },
    { match: /会议|meeting|zoom|teams|加入|静音|视频|共享/, label: '会议' },
    { match: /腾讯视频|爱奇艺|iqiyi|netflix|播放|剧集|电影/, label: '视频/追剧' },
    { match: /微信|wechat|聊天|消息|朋友圈/, label: '微信/聊天' },
    { match: /qq|消息|好友|群聊/, label: 'QQ' },
  ]

  for (const rule of rules) {
    if (rule.match.test(text)) return rule.label
  }

  return text.length > 20 ? null : null // 文字太少，无法判断
}

let ocrTimer: NodeJS.Timeout | null = null
let lastOcrText = ''
let ocrRunning = false
let lastOcrSig = ''            // 最近一次前台窗口签名（app|title），用于检测窗口切换
let lastOcrAt = 0              // 最近一次真正执行 OCR 的时间戳，用于防抖节流
let lastShotHash = ''          // 最近一次屏幕感知哈希，用于画面内容变化检测
const OCR_MIN_INTERVAL = 1500  // 两次 OCR 之间最小间隔，防滚动抖动触发 OCR 风暴
const HASH_DIM = 8             // 感知哈希维度 8x8 = 64bit
const HASH_CHANGE_THRESHOLD = 5 // 64bit 中差异位数 >= 该值视为画面变化
// —— P1 自适应频率 ——
const DELAY_ACTIVE_MS = 1000   // 前台 app 高频变化时探测间隔（高帧率）
const DELAY_IDLE_MS = 8000     // 前台 app 稳定时探测间隔（低帧率）
const APP_ACTIVITY_ALPHA = 0.2 // 活跃度 EMA 系数（0~1，越大越快学习）
const appActivity: Record<string, number> = {}  // 应用变化活跃度 EMA，0~1，默认 0.5（中性）

/** 汉明距离：两个等長二进制串的差异位数 */
function hamming(a: string, b: string): number {
  let d = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++
  return d
}

/** 轻量截图并算感知哈希（aHash）。不落盘、不识别文字，仅用于变化检测，开销极小。 */
async function captureHash(): Promise<string> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 320, height: 180 }
  })
  if (!sources.length) return ''
  const buf = sources[0].thumbnail.toPNG()
  const { data } = await sharp(buf)
    .resize(HASH_DIM, HASH_DIM, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const avg = data.reduce((s: number, v: number) => s + v, 0) / data.length
  let bits = ''
  for (const v of data) bits += v >= avg ? '1' : '0'
  return bits
}

/** 活跃度指数滑动平均：hit=1 本拍画面/窗口有变化，0 本拍无变化；返回 0~1 */
function appEma(prev: number | undefined, hit: number): number {
  const p = prev ?? 0.5
  return p + APP_ACTIVITY_ALPHA * (hit - p)
}

/** 根据当前前台 app 的活跃度算下一次探测延迟：活跃度高→密（高帧率），稳定→稀（低帧率） */
function nextPollDelay(): number {
  const snap = presence.getSnapshot()
  const main = snap.screens.find((s) => s.screen === snap.mainScreen)
  const app = main?.app ?? ''
  const act = appActivity[app] ?? 0.5
  return Math.round(DELAY_IDLE_MS + (DELAY_ACTIVE_MS - DELAY_IDLE_MS) * act)
}

/** 轻量探测：窗口切换 OR 画面哈希变化 → 才触发全截 OCR；否则零成本跳过 */
async function detectAndMaybeOcr(): Promise<void> {
  if (ocrRunning) return
  if (presence.excludedActive) { lastShotHash = ''; return }
  const snap = presence.getSnapshot()
  const main = snap.screens.find((s) => s.screen === snap.mainScreen)
  const sig = main ? `${main.app}|${main.title}` : ''
  const app = main?.app ?? ''
  let hash = ''
  try { hash = await captureHash() } catch { /* 截图失败则按窗口变化兜底 */ }
  const windowChanged = sig !== lastOcrSig
  const hashChanged = !!hash && !!lastShotHash && hamming(hash, lastShotHash) >= HASH_CHANGE_THRESHOLD
  lastOcrSig = sig
  lastShotHash = hash
  // P1：更新本应用变化活跃度（EMA）—— 画面/窗口有变化记为 1，否则 0
  const hit = windowChanged || hashChanged ? 1 : 0
  appActivity[app] = appEma(appActivity[app], hit)
  if (!windowChanged && !hashChanged) return
  if (Date.now() - lastOcrAt < OCR_MIN_INTERVAL) return
  void runOcr()
}

/** 自调度探测循环：每次探测完成后，按前台 app 活跃度计算下一次延迟并递归 setTimeout */
function scheduleNext(): void {
  if (!ocrTimer) return
  ocrTimer = setTimeout(() => {
    void detectAndMaybeOcr().finally(scheduleNext)
  }, nextPollDelay())
}

/** 启动 OCR 周期任务（deepMode 开启后调用） */
export function startOcr(): void {
  if (ocrTimer) return
  console.log('[ocr] 深度模式已启动：变化驱动 + 每应用自适应频率')
  ocrTimer = setTimeout(() => {
    void detectAndMaybeOcr().finally(scheduleNext)
  }, 0)
}

/** 停止 OCR */
export function stopOcr(): void {
  if (ocrTimer) { clearTimeout(ocrTimer); ocrTimer = null }
  console.log('[ocr] 深度模式已停止')
}

/** 执行一次 OCR 并返回分类结果 */
async function runOcr(): Promise<void> {
  if (ocrRunning) return
  ocrRunning = true
  try {
    const lines = await ocrScreen()
    lastOcrAt = Date.now()
    if (lines.length > 0) {
      const classified = classifyOcrText(lines)
      lastOcrText = lines.slice(0, 5).join(' | ')
      if (classified) {
        console.log(`[ocr] 内容识别: ${classified} (${lastOcrText})`)
      }
      // 广播给订阅者（v2.9 报表 OCR 采集）；订阅者异常不阻塞 OCR 主流程
      const snap = presence.getSnapshot()
      const main = snap.screens.find((s) => s.screen === snap.mainScreen)
      for (const cb of ocrLinesListeners) {
        try {
          cb(lines, main?.app ?? '', snap.state)
        } catch { /* ignore */ }
      }
    }
  } catch (e) {
    // 静默失败，不阻塞监控
  } finally {
    ocrRunning = false
  }
}

/** 获取最近一次 OCR 结果（供 presence 使用） */
export function getLastOcrContext(): { text: string; lines: string[] } | null {
  if (!lastOcrText) return null
  return { text: lastOcrText, lines: lastOcrText.split(' | ') }
}
