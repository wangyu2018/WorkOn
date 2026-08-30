# -*- coding: utf-8 -*-
"""动作库/积分：ipc + preload + index 积分任务"""
import io

def repl(path, old, new, count=1):
    t = io.open(path, encoding='utf-8', newline='').read()
    eol = '\r\n' if '\r\n' in t else '\n'
    o = old.replace('\n', eol)
    n = new.replace('\n', eol)
    c = t.count(o)
    assert c == count, path + ': x' + str(c) + ': ' + old[:70]
    io.open(path, 'w', encoding='utf-8', newline='').write(t.replace(o, n))
    print('OK', path, '|', old.strip().splitlines()[0][:48])

# ── ipc.ts ──
repl('src/main/ipc.ts',
     "import { screenContextForWindow } from './report/ocrCollector'",
     "import { screenContextForWindow } from './report/ocrCollector'\nimport {\n  listMotions, getMotionData, saveMotion, removeMotion, setMotionCost, redeemMotion,\n  getPoints, addPoints\n} from './motions'\nimport { createMotionWindow } from './windows'")

repl('src/main/ipc.ts',
     """  // P0 截图问答：按时间窗召回 ocrShots/ocrSnapshots 脱敏摘要注入上下文（默认最近 30 分钟）""",
     """  // ── 动作库 + 积分（第三批：动作工坊） ──
  ipcMain.handle('motions:list', () => listMotions())
  ipcMain.handle('motions:data', (_e, id: string) => getMotionData(id))
  ipcMain.handle('motions:save', (_e, payload: { name: string; duration: number; fps: number; data: unknown; coverDataUrl?: string; cost?: number }) => {
    const meta = saveMotion(payload as { name: string; duration: number; fps: number; data: never; coverDataUrl?: string; cost?: number })
    return meta
  })
  ipcMain.handle('motions:remove', (_e, id: string) => removeMotion(id))
  ipcMain.handle('motions:setCost', (_e, id: string, cost: number) => setMotionCost(id, cost))
  ipcMain.handle('motions:redeem', (_e, id: string) => redeemMotion(id))
  ipcMain.handle('motions:play', (_e, id: string) => {
    sendTo('pet', 'pet:play-motion', { id })
    return true
  })
  ipcMain.on('motion-studio:open', () => createMotionWindow())
  ipcMain.handle('points:get', () => getPoints())
  ipcMain.handle('points:add', (_e, delta: number, reason: string) => addPoints(delta, reason))

  // P0 截图问答：按时间窗召回 ocrShots/ocrSnapshots 脱敏摘要注入上下文（默认最近 30 分钟）""")

# ── preload ──
repl('src/preload/index.ts',
     "  askQAWithShots: (q: string, windowMin?: number) => ipcRenderer.invoke('qa:askWithShots', q, windowMin),",
     """  askQAWithShots: (q: string, windowMin?: number) => ipcRenderer.invoke('qa:askWithShots', q, windowMin),

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
  pointsAdd: (delta: number, reason: string) => ipcRenderer.invoke('points:add', delta, reason),""")

# ── index.ts：专注赚积分（每 30 分钟结算一次） ──
repl('src/main/index.ts',
     "import { startInputProbe } from './recognition/inputProbe'",
     "import { startInputProbe } from './recognition/inputProbe'\nimport { addPoints } from './motions'")
repl('src/main/index.ts',
     """  // 欢迎气泡
  setTimeout(() => {
    bus.setPet({ message: '今天也一起加油吧~', workState: bus.pet.workState })
    sendTo('pet', 'pet:update', bus.pet)
  }, 3000)""",
     """  // 欢迎气泡
  setTimeout(() => {
    bus.setPet({ message: '今天也一起加油吧~', workState: bus.pet.workState })
    sendTo('pet', 'pet:update', bus.pet)
  }, 3000)

  // 积分：每 30 分钟按专注/工作分钟数自动加分（1 分钟 = 1 积分，封顶 30/轮）
  setInterval(() => {
    try {
      const end = Date.now()
      const start = end - 30 * 60000
      const recs = listActivitiesRange(start, end).filter(
        (r) => r.active && WORK_LIKE_STATES.includes(r.state)
      )
      let minutes = 0
      const seen = new Set<number>()
      for (const r of recs) {
        const segStart = Math.max(r.startTs ?? r.ts, start)
        const segEnd = Math.min(r.ts, end)
        // 双屏并行只记一次：按起始秒去重
        const secKey = Math.floor(segStart / 1000)
        if (segEnd <= segStart || seen.has(secKey)) continue
        seen.add(secKey)
        minutes += (segEnd - segStart) / 60000
      }
      const pts = Math.min(30, Math.round(minutes))
      if (pts >= 5) addPoints(pts, 'focus')
    } catch (e) {
      console.warn('[points] 结算失败', e)
    }
  }, 30 * 60 * 1000)""")

repl('src/main/index.ts',
     "import type { UserHabits, PlanItem } from '@shared/types'",
     "import type { UserHabits, PlanItem } from '@shared/types'\nimport { WORK_LIKE_STATES } from '@shared/stateMeta'")
import re
t = io.open('src/main/index.ts', encoding='utf-8', newline='').read()
m = re.search(r"import \{ listActivities, insertInto, col, updateIn \} from './db'", t)
if m:
    t = t.replace(m.group(0), "import { listActivities, listActivitiesRange, insertInto, col, updateIn } from './db'")
    io.open('src/main/index.ts', 'w', encoding='utf-8', newline='').write(t)
    print('OK index db import')
else:
    print('WARN index db import pattern differs — check')
print('motions ipc done')
