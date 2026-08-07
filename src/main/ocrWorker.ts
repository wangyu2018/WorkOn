/**
 * OCR 深度模式：截图 → 落盘 → OCR 引擎识别 → 关键词提取 → 增强状态推断
 * 支持 Tesseract.js（默认回退）和 RapidOCR-json（5x 提速）
 * 仅在 deepMode 开启时运行，每 30s 执行一次（避免过热）
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
/** 上次 OCR 时的前台窗口签名（app+title）与时间：窗口没变就不重复截屏识别，
 *  避免 desktopCapturer 每 30s 全屏捕获造成的周期性系统卡顿 */
let lastOcrSig = ''
let lastOcrAt = 0
const OCR_SAME_WINDOW_SKIP_MS = 3 * 60_000

/** 启动 OCR 周期任务（deepMode 开启后调用） */
export function startOcr(): void {
  if (ocrTimer) return
  console.log('[ocr] 深度模式已启动，每 30s 分析屏幕内容')
  void runOcr()
  ocrTimer = setInterval(() => {
    void runOcr()
  }, 30_000)
}

/** 停止 OCR */
export function stopOcr(): void {
  if (ocrTimer) { clearInterval(ocrTimer); ocrTimer = null }
  console.log('[ocr] 深度模式已停止')
}

/** 执行一次 OCR 并返回分类结果 */
async function runOcr(): Promise<void> {
  if (ocrRunning) return
  // 前台窗口签名未变化且距上次识别 <3min → 跳过（内容分类沿用上次结果）
  const snap = presence.getSnapshot()
  const main = snap.screens.find((s) => s.screen === snap.mainScreen)
  const sig = main ? `${main.app}|${main.title}` : ''
  if (sig && sig === lastOcrSig && Date.now() - lastOcrAt < OCR_SAME_WINDOW_SKIP_MS) return
  ocrRunning = true
  try {
    const lines = await ocrScreen()
    lastOcrSig = sig
    lastOcrAt = Date.now()
    if (lines.length > 0) {
      const classified = classifyOcrText(lines)
      lastOcrText = lines.slice(0, 5).join(' | ')
      if (classified) {
        console.log(`[ocr] 内容识别: ${classified} (${lastOcrText})`)
      }
      // 广播给订阅者（v2.9 报表 OCR 采集）；订阅者异常不阻塞 OCR 主流程
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
