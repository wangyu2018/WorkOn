# -*- coding: utf-8 -*-
"""rest 姿态补偿：任何 T/A-pose 模型都能正确播现有动画"""
import io

BS = chr(92)

def repl(path, old, new, count=1):
    t = io.open(path, encoding='utf-8', newline='').read()
    eol = '\r\n' if '\r\n' in t else '\n'
    o = old.replace('\n', eol)
    n = new.replace('\n', eol)
    c = t.count(o)
    assert c == count, path + ': x' + str(c) + ': ' + old[:70]
    io.open(path, 'w', encoding='utf-8', newline='').write(t.replace(o, n))
    print('OK', path, '|', old.strip().splitlines()[0][:48])

# ── VrmCharacter：捕获 rest 姿态 ──
repl('src/renderer/src/pet/character/VrmCharacter.ts',
     """  private hipsProxy = new THREE.Group()
  private dummies = new Map<string, THREE.Group>()""",
     """  private hipsProxy = new THREE.Group()
  private dummies = new Map<string, THREE.Group>()
  /** 各骨骼 rest 局部旋转（模型绑定姿态）：T-pose≈单位四元数；A-pose 模型非零。
   *  动画层写入时以此为基准做补偿，任何绑定姿势的模型都能正确播放动画 */
  private restQuats = new Map<string, THREE.Quaternion>()""")

repl('src/renderer/src/pet/character/VrmCharacter.ts',
     """    // 旧配件骨替身（狐耳/金铃：VRM 无对应件，微行为写旋转不报错即可）
    const headNode = vrm.humanoid?.getNormalizedBoneNode('head')
    for (const name of ['foxEar_L', 'foxEar_R', 'bell_L', 'bell_R']) {
      const d = new THREE.Group()
      d.name = name
      if (headNode) headNode.add(d)
      this.dummies.set(name, d)
    }""",
     """    // 旧配件骨替身（狐耳/金铃：VRM 无对应件，微行为写旋转不报错即可）
    const headNode = vrm.humanoid?.getNormalizedBoneNode('head')
    for (const name of ['foxEar_L', 'foxEar_R', bell_L, bell_R] as const) {
      const d = new THREE.Group()
      d.name = name
      if (headNode) headNode.add(d)
      this.dummies.set(name, d)
    }

    // 捕获 rest 姿态（必须在任何动画写入前）：新/旧两套键都注册
    for (const [oldName, vrmName] of Object.entries(BONE_ALIAS)) {
      const node = vrm.humanoid?.getNormalizedBoneNode(vrmName)
      if (node) {
        const q = node.quaternion.clone()
        this.restQuats.set(oldName, q)
        this.restQuats.set(vrmName, q)
      }
    }""")

# bell_L/bell_R 在原文件里是字符串字面量，上面写法会引用未定义变量——修正回字符串
t = io.open('src/renderer/src/pet/character/VrmCharacter.ts', encoding='utf-8', newline='').read()
bad = "for (const name of ['foxEar_L', 'foxEar_R', bell_L, bell_R] as const) {"
good = "for (const name of ['foxEar_L', 'foxEar_R', 'bell_L', 'bell_R']) {"
assert bad in t
t = t.replace(bad, good)
io.open('src/renderer/src/pet/character/VrmCharacter.ts', 'w', encoding='utf-8', newline='').write(t)
print('OK bell literals fixed')

# accessor
repl('src/renderer/src/pet/character/VrmCharacter.ts',
     """  bone(name: string): THREE.Object3D {""",
     """  /** 骨骼 rest 四元数（旧名或 VRM 名均可；未注册返回单位四元数） */
  restQuatOf(name: string): THREE.Quaternion {
    return this.restQuats.get(name) ?? IDENTITY_QUAT
  }

  bone(name: string): THREE.Object3D {""")

repl('src/renderer/src/pet/character/VrmCharacter.ts',
     "const _v1 = new THREE.Vector3()",
     """const IDENTITY_QUAT = new THREE.Quaternion()
const _v1 = new THREE.Vector3()""")

# ── Animator：姿态写入改为 rest ⊗ euler ──
repl('src/renderer/src/pet/anim/Animator.ts',
     """  private poseValue(pose: PoseEntry, bone: BoneName): THREE.Vector3 {
    const e = pose.bones[bone] ?? DEFAULT_POSE.bones[bone] ?? [0, 0, 0]
    return new THREE.Vector3(e[0], e[1], e[2])
  }""",
     """  private poseValue(pose: PoseEntry, bone: BoneName): THREE.Vector3 {
    const e = pose.bones[bone] ?? DEFAULT_POSE.bones[bone] ?? [0, 0, 0]
    return new THREE.Vector3(e[0], e[1], e[2])
  }

  /** 写骨骼旋转：rest（模型绑定姿态）⊗ 姿态欧拉 —— A-pose 模型自动补偿 */
  private writeBoneRot(bone: string, x: number, y: number, z: number): void {
    const node = this.char.bone(bone)
    _e.set(D2R(x), D2R(y), D2R(z), 'XYZ')
    _q.setFromEuler(_e)
    node.quaternion.copy(this.char.restQuatOf(bone)).multiply(_q)
  }""")

repl('src/renderer/src/pet/anim/Animator.ts',
     """    for (const b of BLEND_BONES) {
      const node = this.char.bone(b)
      if (poseDone && noAdditive) {
        const c = this.poseValue(this.toPose, b)
        node.rotation.set(D2R(c.x), D2R(c.y), D2R(c.z))
        continue
      }
      const a = this.poseValue(this.fromPose, b)
      const c = this.poseValue(this.toPose, b)
      const add = this.additive.get(b)
      const x = a.x + (c.x - a.x) * pt + (add?.x ?? 0)
      const y = a.y + (c.y - a.y) * pt + (add?.y ?? 0)
      const z = a.z + (c.z - a.z) * pt + (add?.z ?? 0)
      node.rotation.set(D2R(x), D2R(y), D2R(z))
    }""",
     """    for (const b of BLEND_BONES) {
      if (poseDone && noAdditive) {
        const c = this.poseValue(this.toPose, b)
        this.writeBoneRot(b, c.x, c.y, c.z)
        continue
      }
      const a = this.poseValue(this.fromPose, b)
      const c = this.poseValue(this.toPose, b)
      const add = this.additive.get(b)
      const x = a.x + (c.x - a.x) * pt + (add?.x ?? 0)
      const y = a.y + (c.y - a.y) * pt + (add?.y ?? 0)
      const z = a.z + (c.z - a.z) * pt + (add?.z ?? 0)
      this.writeBoneRot(b, x, y, z)
    }""")

# 模块级临时变量（Animator 底部若无则加）
t = io.open('src/renderer/src/pet/anim/Animator.ts', encoding='utf-8', newline='').read()
if '_e used' not in t and 'const _e = new THREE.Euler()' not in t:
    t += "\nconst _e = new THREE.Euler()\nconst _q = new THREE.Quaternion()\n"
    io.open('src/renderer/src/pet/anim/Animator.ts', 'w', encoding='utf-8', newline='').write(t)
    print('OK animator temps')

# ── AnimationManager：程序化/动作数据 premultiply rest ──
repl('src/renderer/src/pet/anim/AnimationManager.ts',
     """            _euler.set(D2R(x), D2R(y), D2R(z), 'XYZ')
            _quat.setFromEuler(_euler)
            values.push(
              isVrm0 ? -_quat.x : _quat.x,
              _quat.y,
              isVrm0 ? -_quat.z : _quat.z,
              _quat.w
            )""",
     """            _euler.set(D2R(x), D2R(y), D2R(z), 'XYZ')
            _quat.setFromEuler(_euler)
            // premultiply rest：A-pose 模型的绑定偏移也参与最终姿态
            _quat.premultiply(this.char.restQuatOf(vrmBone))
            values.push(
              isVrm0 ? -_quat.x : _quat.x,
              _quat.y,
              isVrm0 ? -_quat.z : _quat.z,
              _quat.w
            )""")

repl('src/renderer/src/pet/anim/AnimationManager.ts',
     """export function buildClipFromMotionData(vrm: VrmCharacter, data: MotionClipData): THREE.AnimationClip {
  const isVrm0 = vrm.vrm.meta.metaVersion === '0'
  const times = data.frames.map((f) => f.t)
  const bones = Object.keys(data.frames[0]?.rot ?? {})
  const rotation = new Map<VRMHumanBoneName, THREE.QuaternionKeyframeTrack>()
  for (const bone of bones) {
    const values: number[] = []
    for (const f of data.frames) {
      const q = f.rot[bone] ?? [0, 0, 0, 1]
      values.push(isVrm0 ? -q[0] : q[0], q[1], isVrm0 ? -q[2] : q[2], q[3])
    }
    rotation.set(bone as VRMHumanBoneName, new THREE.QuaternionKeyframeTrack('__motion__', times, values))
  }""",
     """export function buildClipFromMotionData(vrm: VrmCharacter, data: MotionClipData): THREE.AnimationClip {
  const isVrm0 = vrm.vrm.meta.metaVersion === '0'
  const times = data.frames.map((f) => f.t)
  const bones = Object.keys(data.frames[0]?.rot ?? {})
  const rotation = new Map<VRMHumanBoneName, THREE.QuaternionKeyframeTrack>()
  for (const bone of bones) {
    const rest = vrm.restQuatOf(bone)
    const values: number[] = []
    for (const f of data.frames) {
      const q = f.rot[bone] ?? [0, 0, 0, 1]
      const qq = new THREE.Quaternion(q[0], q[1], q[2], q[3]).premultiply(rest)
      values.push(isVrm0 ? -qq.x : qq.x, qq.y, isVrm0 ? -qq.z : qq.z, qq.w)
    }
    rotation.set(bone as VRMHumanBoneName, new THREE.QuaternionKeyframeTrack('__motion__', times, values))
  }""")
print('rest compensation done')
