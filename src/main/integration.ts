/**
 * 本地集成服务
 * 依据：PRD.md F15「监听 127.0.0.1:18765，实时广播 DesktopState；双向回写 pet/memo；state.json 快照」
 */
import { WebSocketServer, WebSocket } from 'ws'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { WsInboundMessage } from '@shared/types'
import { genId } from '@shared/types'
import { bus } from './state'
import { getSettings } from './settings'
import { insertInto } from './db'

let wss: WebSocketServer | null = null
let snapshotTimer: NodeJS.Timeout | null = null

function broadcast(payload: unknown): void {
  if (!wss) return
  const text = JSON.stringify(payload)
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(text)
  }
}

function writeSnapshot(): void {
  if (!getSettings().stateSnapshot) return
  try {
    const file = path.join(app.getPath('userData'), 'state.json')
    fs.writeFileSync(file, JSON.stringify(bus.desktopState(), null, 2), 'utf-8')
  } catch (e) {
    console.warn('[integration] state.json 写入失败', e)
  }
}

export function startIntegration(): void {
  const s = getSettings()
  if (!s.wsEnabled) return
  stopIntegration()
  try {
    wss = new WebSocketServer({ host: '127.0.0.1', port: s.wsPort })
    wss.on('listening', () => console.log(`[integration] WS 已监听 127.0.0.1:${s.wsPort}`))
    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'hello', state: bus.desktopState() }))
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as WsInboundMessage
          if (msg.type === 'pet') {
            bus.setPet(msg.patch)
          } else if (msg.type === 'memo') {
            insertInto('memos', { id: genId('memo'), text: msg.text, source: 'import', ts: Date.now() })
          }
        } catch {
          console.warn('[integration] 无法解析的 WS 消息')
        }
      })
    })
    wss.on('error', (e) => console.warn('[integration] WS 错误:', e.message))

    bus.on('desktop-state', (state) => broadcast({ type: 'state', state }))
    snapshotTimer = setInterval(writeSnapshot, 5000)
  } catch (e) {
    console.warn('[integration] 启动失败:', e)
  }
}

export function stopIntegration(): void {
  if (snapshotTimer) clearInterval(snapshotTimer)
  snapshotTimer = null
  if (wss) {
    try { wss.close() } catch { /* ignore */ }
    wss = null
  }
}
