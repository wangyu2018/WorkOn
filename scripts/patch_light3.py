# -*- coding: utf-8 -*-
"""角色光照去染色 v3：独立中性光层（layer 1），彩色氛围光/状态光不再触碰角色"""
import io

def repl(path, old, new, count=1):
    t = io.open(path, encoding='utf-8', newline='').read()
    eol = '\r\n' if '\r\n' in t else '\n'
    o = old.replace('\n', eol)
    n = new.replace('\n', eol)
    c = t.count(o)
    assert c == count, path + ': x' + str(c) + ': ' + old[:70]
    io.open(path, 'w', encoding='utf-8', newline='').write(t.replace(o, n))
    print('OK |', old.strip().splitlines()[0][:52])

p = 'src/renderer/src/pet/scene/Lighting.ts'

# 1) 字段：角色专属中性光
repl(p,
     """export class Lighting {
  private key: THREE.DirectionalLight
  private fill: THREE.DirectionalLight
  private rim: THREE.SpotLight | null = null
  private hemi: THREE.HemisphereLight
  private ambient: THREE.AmbientLight
  private status: THREE.PointLight | null = null""",
     """export class Lighting {
  private key: THREE.DirectionalLight
  private fill: THREE.DirectionalLight
  private rim: THREE.SpotLight | null = null
  private hemi: THREE.HemisphereLight
  private ambient: THREE.AmbientLight
  private status: THREE.PointLight | null = null
  /** 角色专属中性光（layer 1）：纯白恒定，昼夜/情绪彩色光永不染肤色 */
  private charKey: THREE.DirectionalLight
  private charFill: THREE.DirectionalLight
  private charAmbient: THREE.AmbientLight""")

# 2) constructor：中性角色光（layer 1）+ 彩色氛围光留在 layer 0
repl(p,
     """    // 中性环境光地板：MToon 材质对光源颜色极敏感，纯蓝夜光会把肤色染成深蓝；
    // 一层微弱白光保证任何时段肤色都有中性基准
    this.ambient = new THREE.AmbientLight('#FFFFFF', 0.18)
    scene.add(this.ambient)

    if (characterRoot) this.attachCharacterRoot(characterRoot)""",
     """    // 中性环境光地板：MToon 材质对光源颜色极敏感，纯蓝夜光会把肤色染成深蓝；
    // 一层微弱白光保证任何时段肤色都有中性基准
    this.ambient = new THREE.AmbientLight('#FFFFFF', 0.18)
    scene.add(this.ambient)

    // 角色专属中性光组（layer 1）：纯白恒定，昼夜/情绪彩色光永不染肤色
    this.charKey = new THREE.DirectionalLight('#FFFFFF', 0.95)
    this.charKey.position.set(-300, 450, 350)
    this.charKey.layers.set(1)
    scene.add(this.charKey)
    this.charFill = new THREE.DirectionalLight('#FFFFFF', 0.4)
    this.charFill.position.set(320, -120, 260)
    this.charFill.layers.set(1)
    scene.add(this.charFill)
    this.charAmbient = new THREE.AmbientLight('#FFFFFF', 0.32)
    this.charAmbient.layers.set(1)
    scene.add(this.charAmbient)

    // 彩色氛围光（key/fill/hemi/status/rim）只作用于 layer 0 的场景装饰
    if (characterRoot) this.attachCharacterRoot(characterRoot)""")

# 3) attachCharacterRoot：角色网格迁 layer 1，不再挂 rim/status
repl(p,
     """  /** 角色加载后挂载 Rim/Status 光源到角色根节点（幂等） */
  attachCharacterRoot(root: THREE.Object3D): void {
    if (this.rim) return
    const phase = PHASES[this.currentPhase]
    // Rim：SpotLight，正后方
    this.rim = new THREE.SpotLight(phase.rimColor, phase.rimIntensity, 900, Math.PI / 4, 0.5, 1)
    this.rim.position.set(0, 260, -320)
    const rimTarget = new THREE.Object3D()
    rimTarget.position.set(0, 140, 0)
    root.add(rimTarget)
    this.rim.target = rimTarget
    root.add(this.rim)

    // Status：PointLight 挂角色根
    this.status = new THREE.PointLight(STATUS_COLORS.idle.color, STATUS_COLORS.idle.intensity, 500, 1.2)
    this.status.position.set(0, 150, 80)
    root.add(this.status)
  }""",
     """  /** 角色加载后：角色全部网格迁到 layer 1（只受中性白光，彩色氛围光不再染肤色） */
  attachCharacterRoot(root: THREE.Object3D): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) mesh.layers.set(1)
    })
  }""")

# 4) setMood：保留接口（status 光已移除，不再染色）
repl(p,
     """  setMood(mood: StatusMood): void {
    const s = STATUS_COLORS[mood]
    this.statusTarget.set(s.color)
    this.statusIntensityTarget = s.intensity
  }""",
     """  setMood(mood: StatusMood): void {
    // 状态情绪光已随彩色光照系统移出角色（不再染皮肤），保留接口兼容
    void mood
  }""")

# 5) update()：状态光脉冲删除
repl(p,
     """  update(dt: number): void {
    this.time += dt
    // 昼夜过渡
    this.updatePhaseLerp(dt)
    // 状态光
    if (!this.status) return
    const k = 1 - Math.exp(-dt / 0.25)
    this.status.color.lerp(this.statusTarget, k)
    const pulse = 1 + Math.sin(this.time * (Math.PI * 2) / 1.5) * 0.12
    const cur = this.status.intensity + (this.statusIntensityTarget - this.status.intensity) * k
    this.status.intensity = cur * pulse
  }""",
     """  update(dt: number): void {
    this.time += dt
    // 昼夜过渡（仅影响场景氛围光；角色由中性光层独立照明）
    this.updatePhaseLerp(dt)
  }""")
