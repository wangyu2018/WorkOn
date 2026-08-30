/**
 * 动作库 + 积分系统 v1（本地闭环，schema 为云端同步预留）
 * - 动作：userData/motions/{id}.json（MotionClipData）+ db motions 元信息（含积分价/解锁态）
 * - 积分：pointsLedger 流水，余额=Σdelta；来源：专注分钟自动累积；消耗：动作兑换
 */
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { MotionClipData, MotionMeta, PointsEntry } from '@shared/types'
import { genId } from '@shared/types'
import { col, insertInto, updateIn } from './db'

export function motionsDir(): string {
  return path.join(app.getPath('userData'), 'motions')
}

function motionFile(id: string): string {
  return path.join(motionsDir(), `${id}.json`)
}

// ── 动作库 ──

export function listMotions(): MotionMeta[] {
  return col<MotionMeta>('motions')
}

export function getMotionData(id: string): MotionClipData | null {
  try {
    const file = motionFile(id)
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as MotionClipData
  } catch {
    return null
  }
}

export function saveMotion(payload: {
  name: string
  duration: number
  fps: number
  data: MotionClipData
  coverDataUrl?: string
  cost?: number
}): MotionMeta | null {
  const cleanName = String(payload.name || '').trim().slice(0, 24) || '未命名动作'
  const id = genId('mo')
  try {
    const dir = motionsDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(motionFile(id), JSON.stringify(payload.data), 'utf-8')
    if (payload.coverDataUrl?.startsWith('data:image/png;base64,')) {
      const coverDir = path.join(motionsDir(), 'covers')
      fs.mkdirSync(coverDir, { recursive: true })
      fs.writeFileSync(
        path.join(coverDir, `${id}.png`),
        Buffer.from(payload.coverDataUrl.split(',')[1] ?? '', 'base64')
      )
    }
    const meta: MotionMeta = {
      id,
      name: cleanName,
      duration: Math.round(payload.duration * 100) / 100,
      fps: payload.fps,
      createdAt: Date.now(),
      cost: Math.max(0, Math.round(payload.cost ?? 0)),
      owned: true // 创建者默认已解锁
    }
    insertInto<MotionMeta>('motions', meta)
    return meta
  } catch (e) {
    console.warn('[motions] 保存失败:', e)
    return null
  }
}

export function removeMotion(id: string): boolean {
  try {
    for (const f of [motionFile(id), path.join(motionsDir(), 'covers', `${id}.png`)]) {
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
  } catch { /* ignore */ }
  return col<MotionMeta>('motions').some((m) => m.id === id)
    ? (updateIn<MotionMeta>('motions', id, { name: '__deleted__' }), removeFromMotion(id), true)
    : false
}

// removeFromMotion 需要独立实现（db.removeFrom 通用）
import { removeFrom } from './db'
function removeFromMotion(id: string): boolean {
  return removeFrom('motions', id)
}

export function setMotionCost(id: string, cost: number): MotionMeta | null {
  return updateIn<MotionMeta>('motions', id, { cost: Math.max(0, Math.round(cost)) })
}

// ── 积分 ──

export function getPoints(): { balance: number; ledger: PointsEntry[] } {
  const ledger = col<PointsEntry>('pointsLedger')
  const balance = ledger.reduce((s, e) => s + e.delta, 0)
  return { balance, ledger: ledger.slice(-30).reverse() }
}

export function addPoints(delta: number, reason: string): PointsEntry {
  const entry: PointsEntry = { id: genId('pt'), ts: Date.now(), delta: Math.round(delta), reason }
  insertInto<PointsEntry>('pointsLedger', entry)
  return entry
}

/** 兑换扣分：余额不足返回 false */
export function spendPoints(amount: number, reason: string): boolean {
  const amount2 = Math.max(1, Math.round(amount))
  const balance = col<PointsEntry>('pointsLedger').reduce((s, e) => s + e.delta, 0)
  if (balance < amount2) return false
  addPoints(-amount2, reason)
  return true
}

export function redeemMotion(id: string): { ok: boolean; error?: string; meta?: MotionMeta } {
  const meta = col<MotionMeta>('motions').find((m) => m.id === id)
  if (!meta) return { ok: false, error: '动作不存在' }
  if (meta.owned || meta.cost <= 0) return { ok: true, meta }
  if (!spendPoints(meta.cost, `redeem:${meta.name}`)) return { ok: false, error: '积分不足' }
  const updated = updateIn<MotionMeta>('motions', id, { owned: true })
  return { ok: true, meta: updated ?? meta }
}
