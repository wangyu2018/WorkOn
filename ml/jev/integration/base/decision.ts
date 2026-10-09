/**
 * 融合决策层 —— 规则引擎 + 小模型的双管道仲裁
 *
 * 优先级（高 → 低）：
 *   1. 用户纠偏规则（宁漏勿误三条件全中，最高业务优先级）
 *   2. 系统空闲 idleSec > AWAY_AFTER_SEC → away
 *   3. 会议检测 / 媒体粘性（presence 引擎内部维持，决策层只提供基础判定）
 *   4. model_first 模式且模型置信度 ≥ MODEL_PROB_THRESHOLD → 采用映射后的模型态
 *   5. APP_RULES 规则表兜底，未命中 'focus'
 *
 * 三种模式：
 *   rules       纯规则，等价旧行为，不碰模型不记账
 *   shadow      规则结果即时返回；激活屏异步向模型要一个答案，全部记入 recognition_log
 *   model_first 同步等模型（限时），高置信才覆盖规则结果
 */
import type { CorrectionRule, RecognitionMode, WorkState } from '@shared/types'
import { AWAY_AFTER_SEC, identifyApp, MODEL_LABEL_TO_STATE } from '@shared/stateMeta'
import { col, insertRecognitionLog } from '../db'
import { getSettings } from '../settings'
import type {
  ActionFeatures, ModelPrediction, RecognitionInput,
  RecognitionResult, RecognitionSource
} from './types'
import { buildFeatures } from './featureBuilder'
import { getModelClient } from './modelClient'
import { getBehaviorWindow } from './inputProbe'

/** model_first 下模型置信度门槛（低于此值不覆盖规则） */
export const MODEL_PROB_THRESHOLD = 0.75

/** 纠偏规则（与 monitor 原实现一致：三条件全满足才命中，宁漏勿误） */
function applyCorrectionRules(
  screen: number, app: string, title: string
): { app: string; title: string; stateOverride?: WorkState } {
  const rules = col<CorrectionRule>('rules').filter((r) => r.enabled)
  for (const r of rules) {
    if (r.screen !== screen) continue
    if (r.matchApp && app.toLowerCase() !== r.matchApp.toLowerCase()) continue
    if (r.matchTitleContains && !title.toLowerCase().includes(r.matchTitleContains.toLowerCase())) continue
    return {
      app: r.setApp ?? app,
      title,
      stateOverride: r.setState
    }
  }
  return { app, title }
}

function logRecord(
  input: RecognitionInput,
  mode: RecognitionMode,
  features: ActionFeatures,
  ruleState: WorkState,
  finalSource: RecognitionSource,
  pred: ModelPrediction | null
): void {
  try {
    insertRecognitionLog({
      ts: input.ts,
      screen: input.screen,
      app: input.app,
      title: input.title.slice(0, 300),
      mode,
      featuresJson: JSON.stringify(features),
      ruleState,
      finalState: ruleState,
      finalSource,
      modelLabel: pred?.label ?? null,
      modelProb: pred ? Math.round(pred.prob * 1000) / 1000 : null,
      modelState: pred ? (MODEL_LABEL_TO_STATE[pred.label] ?? 'focus') : null
    })
  } catch (e) {
    console.warn('[recognition] 记账失败:', e)
  }
}

/**
 * 单轮识别。shadow 下同步返回规则结果、模型预测后台补记；
 * model_first 下最多等待一次推理往返再返回。
 * 非激活屏 / 空闲离开 / rules 模式：纯规则直返，不进模型。
 */
export async function recognize(input: RecognitionInput): Promise<RecognitionResult> {
  const mode: RecognitionMode = getSettings().recognitionMode ?? 'shadow'
  const corrected = applyCorrectionRules(input.screen, input.app, input.title)
  const identified = identifyApp(corrected.app, corrected.title)

  let state: WorkState = corrected.stateOverride ?? identified.state
  let source: RecognitionSource = corrected.stateOverride ? 'correction' : 'rule'
  let confidence = 1

  // 空闲：直接判 away；非激活屏：纯规则（背景窗口不是用户当下的动作语境）
  if (input.idleSec > AWAY_AFTER_SEC || !input.active || mode === 'rules') {
    if (input.idleSec > AWAY_AFTER_SEC) {
      state = 'away'
      source = 'idle'
    }
    return { app: corrected.app, title: corrected.title, appName: identified.appName, state, source, confidence }
  }

  // ── 激活屏 × shadow / model_first：进模型管道（特征只构建一次；注入行为聚合） ──
  const features = buildFeatures({ ...input, behavior: getBehaviorWindow() })
  const client = getModelClient()

  if (mode === 'shadow') {
    // 异步要答案，拿到后补记账；本轮状态仍由规则决定，即时返回
    void client.predict(features).then((pred) => {
      logRecord(input, mode, features, state, source, pred)
    })
  } else {
    const pred = await client.predict(features)
    if (pred && pred.prob >= MODEL_PROB_THRESHOLD) {
      const mapped = MODEL_LABEL_TO_STATE[pred.label]
      if (mapped) {
        state = mapped
        source = 'model'
        confidence = pred.prob
      }
    }
    logRecord(input, mode, features, state, source, pred)
  }

  return { app: corrected.app, title: corrected.title, appName: identified.appName, state, source, confidence }
}
