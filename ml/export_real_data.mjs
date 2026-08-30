#!/usr/bin/env node
/**
 * 从 WorkOn 的 recognition_log.jsonl（影子模式记账）导出重训数据。
 *
 * 用法：
 *   node ml/export_real_data.mjs [--days 7] [--out data/real_actions.jsonl]
 *        [--target state|action] [--gold-only]
 *
 * 数据源：%APPDATA%/workon/recognition_log.jsonl（Windows 默认）
 * 输出：9 特征字段 + label，直接可喂 ml/train.py。
 *
 * 标签口径（二选一）：
 *   --target state   默认。label = 规则引擎输出的 13 态 WorkState；
 *                    用真实特征训一个"窗口上下文 → WorkState"分类器，这是二期主力模型方向
 *   --target action  label = WorkState 反向映射回旧模型 8 动作类；无法唯一映射的行跳过
 *
 * --gold-only：只导出高置信行（finalSource 为 correction 的用户纠偏 = 金标准）。
 */

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
function argOf(name, def) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def
}
const hasFlag = (name) => args.includes(name)

const days = parseInt(argOf('--days', '7'), 10)
const outPath = path.resolve(argOf('--out', 'data/real_actions.jsonl'))
const target = argOf('--target', 'state')
const goldOnly = hasFlag('--gold-only')

if (target !== 'state' && target !== 'action') {
  console.error('--target 只能是 state 或 action')
  process.exit(1)
}

/** WorkState → 8 动作类的保守反向映射；仅保留单一指向的项 */
const STATE_TO_ACTION = {
  coding: 'code',
  aidev: 'code',
  writing: 'write',
  meeting: 'communicate',
  remote: 'communicate',
  aiqa: 'communicate'
  // focus/browse/search/manage/data_entry/other 在 13 态下无法区分，不进入 action 目标
}

const candidates = [
  process.env.WORKON_USER_DATA,
  path.join(process.env.APPDATA || '', 'workon'),
  path.join(process.env.HOME || '', '.config', 'workon')
].filter(Boolean)

const dir = candidates.find((c) => fs.existsSync(path.join(c, 'recognition_log.jsonl')))
if (!dir) {
  console.error('未找到 recognition_log.jsonl，找过：\n' + candidates.join('\n'))
  process.exit(1)
}
const logFile = path.join(dir, 'recognition_log.jsonl')

const cutoff = Date.now() - days * 86400_000
const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean)

let written = 0
let skipped = 0
let goldCount = 0
fs.mkdirSync(path.dirname(outPath), { recursive: true })
const chunks = []

for (const line of lines) {
  let r
  try { r = JSON.parse(line) } catch { continue }
  if (r.ts < cutoff) continue
  const features = (() => { try { return JSON.parse(r.featuresJson) } catch { return null } })()
  if (!features) continue

  const isGold = r.finalSource === 'correction'
  if (goldOnly && !isGold) continue

  const stateLabel = r.ruleState ?? r.finalState
  let label = null
  if (target === 'state') {
    label = stateLabel
  } else {
    label = STATE_TO_ACTION[stateLabel] ?? null
    if (!label) { skipped++; continue }
  }
  if (isGold) goldCount++

  chunks.push(JSON.stringify({ ...features, label }) + '\n')
  written++
}

fs.writeFileSync(outPath, chunks.join(''), 'utf-8')
console.log(`导出完成: ${written} 条 → ${outPath}`)
console.log(`目标体系: ${target === 'state' ? '13 态 WorkState（二期推荐）' : '8 类动作（旧口径）'}${skipped ? `，跳过不可映射 ${skipped} 条` : ''}`)
console.log(`其中用户纠偏金标行: ${goldCount} 条`)
console.log('训练命令示例:')
console.log(`  python train.py --data ${outPath} --output models/action_model_real.json`)
console.log('去泄漏对照实验请加: --drop-cols field action_type（详见 EXPERIMENTS.md）')
