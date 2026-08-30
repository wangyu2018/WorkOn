# -*- coding: utf-8 -*-
"""审计修复批次 C2：main/intro/SpatialController + 性能四件套"""
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

# ── intro.ts：animMgr 进依赖与驱动循环 ──
repl('src/renderer/src/pet/intro.ts',
     """interface IntroDeps {
  stage: Stage
  char: VrmCharacter
  anim: Animator
  micro: MicroBehaviors
  spatial: SpatialController
  particles: ParticleSystem
  bubble: Bubble
}""",
     """interface IntroDeps {
  stage: Stage
  char: VrmCharacter
  anim: Animator
  micro: MicroBehaviors
  spatial: SpatialController
  particles: ParticleSystem
  bubble: Bubble
  animMgr?: { update(dt: number): void } | null
}""")
repl('src/renderer/src/pet/intro.ts',
     "export async function playIntroCG(deps: IntroDeps): Promise<void> {\n  const { stage, char, anim, micro, spatial, particles, bubble } = deps",
     "export async function playIntroCG(deps: IntroDeps): Promise<void> {\n  const { stage, char, anim, micro, spatial, particles, bubble, animMgr } = deps")
repl('src/renderer/src/pet/intro.ts',
     "    anim.update(dt)\n    micro.update(dt)\n    char.update(dt)",
     "    anim.update(dt)\n    animMgr?.update(dt) // CG 期间若 clip 被拉起，mixer 不喂会僵在首帧\n    micro.update(dt)\n    char.update(dt)")

# ── main.ts ──
# 1) 加载失败路径：清进度条 + DOM 错误提示，不再静默卡"加载中"
repl('src/renderer/src/pet/main.ts',
     """  let char = await VrmCharacter.load(vrmPath, reportProgress).catch(async (err) => {
    console.warn('[pet] VRM 加载失败，回退默认角色:', err)
    return VrmCharacter.load('./vrm/peier.vrm')
  })
  reportProgress(1)
  window.setTimeout(() => progressEl.remove(), 250)""",
     """  let char: VrmCharacter
  try {
    char = await VrmCharacter.load(vrmPath, reportProgress)
  } catch (err) {
    console.warn('[pet] VRM 加载失败，回退默认角色:', err)
    try {
      char = await VrmCharacter.load('./vrm/peier.vrm', reportProgress)
    } catch (err2) {
      console.error('[pet] 默认角色也加载失败:', err2)
      progressEl.remove()
      const errEl = document.createElement('div')
      errEl.style.cssText =
        'position:fixed;left:50%;top:45%;transform:translateX(-50%);color:#F87171;' +
        'font:14px "Microsoft YaHei",sans-serif;z-index:60;pointer-events:none'
      errEl.textContent = '角色加载失败，请重启应用'
      document.body.appendChild(errEl)
      return
    }
  }
  reportProgress(1)
  window.setTimeout(() => progressEl.remove(), 250)""")

# 2) 表情反馈初始值对齐互动开关默认（false）
repl('src/renderer/src/pet/main.ts',
     """  const anim = new Animator(char)
  const animMgr = new AnimationManager(char, anim)
  anim.attachClipManager(animMgr)""",
     """  const anim = new Animator(char)
  anim.emotionEnabled = false // 与互动开关默认一致（settings 就绪后由 applyInteractions 覆盖）
  const animMgr = new AnimationManager(char, anim)
  anim.attachClipManager(animMgr)""")

# 3) intro 期间关游荡 + 传 animMgr（两处 playIntroCG）
repl('src/renderer/src/pet/main.ts',
     """      const { playIntroCG } = await import('./intro')
      await playIntroCG({ stage, char, anim, micro, spatial, particles, bubble })
      // CG 后接 3 步气泡引导（小白上手：点我 / 右键聊我 / 拖我）""",
     """      const { playIntroCG } = await import('./intro')
      spatial.setRoamEnabled(false) // CG 期间游荡会拉起 clip 打断分镜
      await playIntroCG({ stage, char, anim, micro, spatial, particles, bubble, animMgr })
      // CG 后接 3 步气泡引导（小白上手：点我 / 右键聊我 / 拖我）""")

# ── SpatialController.ts ──
# 4) dock 后 pendingState 不得执行（收纳被绕过的洞）
repl('src/renderer/src/pet/spatial/SpatialController.ts',
     """    // 收纳锁：dock/undock 通过 restore/dock/undock 直接操作，不走这条路径
    if (this._docked && !fromPending) return""",
     """    // 收纳锁：收纳期间任何状态切换都不执行（pending 到期也一并作废）
    if (this._docked) {
      if (fromPending) this.pendingState = null
      return
    }""")

# 5) 游荡移动中停 clip（防太空步：位移了但腿不摆）
repl('src/renderer/src/pet/spatial/SpatialController.ts',
     "        this.micro.setLocomotion(upd.mode, upd.mode === 'run' ? 1.2 : 1)",
     """        if (this.anim.clipMode) this.anim.stopClip(0.15) // 移动中 clip 会让腿僵住（太空步）
        this.micro.setLocomotion(upd.mode, upd.mode === 'run' ? 1.2 : 1)""")

# ── 性能 P-c：trail 缓存（plans:forecast 每次建 8 天轨迹，78k 记录下开销显著） ──
repl('src/shared/trail.ts',
     "export function buildMergedTrail(records: ActivityRecord[], date: string): MergedTrail {\n  const sorted = [...records].sort((a, b) => a.ts - b.ts)",
     """// 同日+同记录尾 → 直接复用上一次结果（78k 记录下每次重建 ~几十 ms，plans:forecast 单次调用要建 8 天）
const _trailCache = new Map<string, { key: string; trail: MergedTrail }>()

export function buildMergedTrail(records: ActivityRecord[], date: string): MergedTrail {
  const last = records.length ? records[records.length - 1] : null
  const cacheKey = records.length + ':' + (last ? last.id + ':' + last.ts : 'empty')
  const hit = _trailCache.get(date)
  if (hit && hit.key === cacheKey) return hit.trail
  const built = buildMergedTrailInner(records, date)
  _trailCache.set(date, { key: cacheKey, trail: built })
  if (_trailCache.size > 12) {
    const oldest = _trailCache.keys().next().value
    if (oldest !== undefined) _trailCache.delete(oldest)
  }
  return built
}

function buildMergedTrailInner(records: ActivityRecord[], date: string): MergedTrail {
  const sorted = [...records].sort((a, b) => a.ts - b.ts)""")

# ── 性能 P-d：state.json 内容不变不落盘（每 5s 一次的同步写） ──
repl('src/main/integration.ts',
     """function writeSnapshot(): void {
  if (!getSettings().stateSnapshot) return
  try {
    const file = path.join(app.getPath('userData'), 'state.json')
    fs.writeFileSync(file, JSON.stringify(bus.desktopState(), null, 2), 'utf-8')
  } catch (e) {
    console.warn('[integration] state.json 写入失败', e)
  }
}""",
     """let lastSnapshotJson = ''
function writeSnapshot(): void {
  if (!getSettings().stateSnapshot) return
  try {
    const json = JSON.stringify(bus.desktopState(), null, 2)
    if (json === lastSnapshotJson) return // 内容没变不写盘（原为每 5s 无条件同步写）
    lastSnapshotJson = json
    const file = path.join(app.getPath('userData'), 'state.json')
    fs.writeFileSync(file, json, 'utf-8')
  } catch (e) {
    console.warn('[integration] state.json 写入失败', e)
  }
}""")

print('batch C2 done')
