/** 窗口标题 → 工作区/路径线索（Cursor 等多开 IDE 分段用） */

const IDE_HINT = /cursor|code|idea|webstorm|pycharm|goland|trae|windsurf|zed|sublime|visual studio/i

export function extractPathHint(title: string): string | null {
  const t = (title || '').trim()
  if (!t) return null
  const win = t.match(/[A-Za-z]:\\[^\s—–\-|]+/)
  if (win) return win[0].replace(/\\+$/, '').slice(0, 96)
  const unix = t.match(/\/(?:Users|home|var|opt|mnt)\/[^\s—–\-|]+/)
  if (unix) return unix[0].slice(0, 96)
  const emParts = t.split(/\s*[—–|·]\s*/)
  if (emParts.length >= 2) {
    const head = emParts[0].trim()
    if (head.length >= 2 && head.length <= 48 && !IDE_HINT.test(head)) return head
  }
  const dash = t.split(/\s+-\s+/)
  if (dash.length >= 3) {
    const mid = dash[dash.length - 2]?.trim()
    if (mid && mid.length >= 2 && mid.length <= 48 && !IDE_HINT.test(mid)) return mid
  }
  return null
}

export function isIdeApp(app: string): boolean {
  const a = (app || '').replace(/\.exe$/i, '').toLowerCase()
  return (
    /^(cursor|code|code - insiders|devenv|idea64|webstorm64|pycharm64|goland64|trae|windsurf|zed|sublime_text|notepad\+\+)$/i.test(
      a
    ) || IDE_HINT.test(a)
  )
}
