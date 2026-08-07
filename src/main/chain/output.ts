/**
 * v2.6.1 产出闭环检测器（spec §4.4 移植，适配 TrailSegment 字段与 APP_RULES 友好名口径）
 * 从段序列末尾向前扫描，识别产出信号：Git 提交 / 邮件发送 / 沟通交付 / 文档标题变化 / 上传提交
 */
import type { ChainOutputType } from '@shared/chain'
import type { TrailSegment } from '@shared/types'

export interface OutputSignal {
  type: ChainOutputType
  app: string
  ts: number
  confidence: number
}

export const NO_OUTPUT: OutputSignal = { type: 'none', app: '', ts: 0, confidence: 0 }

/** 生产力应用（友好名口径）：产出"上一个环节"是否为有效加工 */
export function isProductivityApp(appName: string): boolean {
  return /vscode|visual studio|intellij|rider|cursor|windsurf|trae|office|word|excel|powerpoint|wps|notes|notion|obsidian|typora|design|figma|photoshop|devtool/i.test(
    appName
  )
}

/** 产出闭环检测：从后向前扫描段序列，返回最强的产出信号（无则 type=none） */
export function detectOutput(segments: TrailSegment[]): OutputSignal {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]
    const app = seg.mainApp ?? ''
    const title = seg.mainTitle ?? ''

    // Git 提交（终端友好名，可能带 "Terminal · 目录" 后缀）
    if (/^terminal|git/i.test(app) && /commit|push/i.test(title)) {
      return { type: 'code', app, ts: seg.endTs, confidence: 0.95 }
    }

    // 邮件发送
    if (/outlook|foxmail|邮件|mail/i.test(app) && /发送|send|回复|reply/i.test(title)) {
      return { type: 'email', app, ts: seg.endTs, confidence: 0.9 }
    }

    // 沟通工具发送（交付动作）：前一段是生产力工具，最后切到沟通工具，大概率是交付
    if (/^(WeChat|QQ|DingTalk|Feishu)$|微信|钉钉|飞书|slack|teams/i.test(app)) {
      if (i > 0 && isProductivityApp(segments[i - 1].mainApp ?? '')) {
        return { type: 'message', app, ts: seg.endTs, confidence: 0.7 }
      }
    }

    // 文档保存（窗口标题变化检测）：同应用前一段标题不同，视为产出
    if (/office|word|excel|powerpoint|wps|notes|notion|obsidian|typora/i.test(app)) {
      const prevSameApp = segments
        .slice(0, i)
        .reverse()
        .find((s) => (s.mainApp ?? '') === app)
      if (prevSameApp && (prevSameApp.mainTitle ?? '') !== title && title !== '') {
        return { type: 'document', app, ts: seg.endTs, confidence: 0.6 }
      }
    }

    // 文件上传/提交
    if (/上传|提交|upload|submit/i.test(title)) {
      return { type: 'file_upload', app, ts: seg.endTs, confidence: 0.85 }
    }
  }

  return { ...NO_OUTPUT }
}
