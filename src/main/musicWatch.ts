/**
 * 音乐信号（v10 signals·音乐信号源，SIGNALS 文档第一批）：
 * mac 用 osascript 查 Music/Spotify 播放状态；切歌/播放暂停变化 → 折下轻通知。
 * Windows 用 SMTC 的方案挂后续（当前返回空）。
 */
import { exec } from 'child_process'
import { getSettings } from './settings'
import { sendTo } from './windows'

export interface MusicInfo {
  name: string
  artist: string
  playing: boolean
}

let timer: NodeJS.Timeout | null = null
let last: string | null = null

const APPLESCRIPT = `
tell application "System Events"
  set musicApps to {"Music", "Spotify", "网易云音乐"}
end tell
`

function queryMac(): Promise<MusicInfo | null> {
  return new Promise((resolve) => {
    // 先看 Music，再看 Spotify（一次 osascript 多查几个目标，空即无）
    const script = `
      tell application "System Events"
        set runningApps to name of every process
      end tell
      if (runningApps contains "Music") then
        tell application "Music"
          if player state is playing then
            return (name of current track) & "||" & (artist of current track) & "||play"
          end if
        end tell
      end if
      if (runningApps contains "Spotify") then
        tell application "Spotify"
          if player state is playing then
            return (name of current track) & "||" & (artist of current track) & "||play"
          end if
        end tell
      end if
      return ""
    `
    exec(`osascript -e ${JSON.stringify(script)}`, { timeout: 5_000 }, (err, stdout) => {
      if (err) return resolve(null)
      const out = (stdout || '').trim()
      if (!out) return resolve(null)
      const [name, artist, st] = out.split('||')
      resolve({ name: name ?? '', artist: artist ?? '', playing: st === 'play' })
    })
  })
}

function poll(): void {
  const s = getSettings()
  if (!s.musicWatchEnabled) return
  if (process.platform !== 'darwin') return
  void queryMac().then((info) => {
    if (!info) return
    const key = `${info.name}|${info.artist}`
    if (key === last) return
    const had = last !== null
    last = key
    if (had) {
      // 切歌才通知（首次启动静默）
      sendTo('main', 'music:changed', info)
      for (const cb of listeners) cb(info)
    }
  })
}

const listeners: Array<(info: MusicInfo) => void> = []

export function stopMusicWatch(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function startMusicWatch(onChange?: (info: MusicInfo) => void): void {
  if (timer) return
  if (onChange) listeners.push(onChange)
  timer = setInterval(poll, 20_000)
}
