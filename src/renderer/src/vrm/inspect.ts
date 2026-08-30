/**
 * VRM 模型体检器（渲染进程侧，主窗口内解析——主进程无 DOM 无法跑 GLTF 纹理管线）
 * 上传的 .vrm → 结构化健康报告：骨骼完整性 / 表情能力 / 物理 / 性能 / T·A-pose 判定
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { VRMLoaderPlugin } from '@pixiv/three-vrm'

export interface VrmReportItem {
  key: string
  label: string
  level: 'ok' | 'warn' | 'fail'
  detail: string
}

export interface VrmReport {
  ok: boolean // 是否建议应用
  metaVersion: string
  humanoidMissing: string[]
  expressions: string[]
  springJoints: number
  triangles: number
  meshes: number
  textures: number
  maxTextureSize: number
  fileSizeMB: number
  /** 上臂 rest 姿态欧拉 z（度）：|z|>15 视为 A-pose；动画层用于自动补偿 */
  armRestZ: { left: number; right: number }
  poseType: 'T-pose' | 'A-pose' | '未知'
  items: VrmReportItem[]
}

const HUMANOID_REQUIRED: [string, string][] = [
  ['hips', '髋'], ['spine', '脊柱'], ['head', '头'],
  ['leftUpperArm', '左上臂'], ['rightUpperArm', '右上臂'],
  ['leftLowerArm', '左前臂'], ['rightLowerArm', '右前臂'],
  ['leftHand', '左手'], ['rightHand', '右手'],
  ['leftUpperLeg', '左大腿'], ['rightUpperLeg', '右大腿'],
  ['leftLowerLeg', '左小腿'], ['rightLowerLeg', '右小腿'],
  ['leftFoot', '左脚'], ['rightFoot', '右脚']
]

export async function inspectVrmBuffer(
  buffer: ArrayBuffer,
  fileSizeMB: number,
  dracoDecoderPath = './draco/'
): Promise<VrmReport> {
  const loader = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath(dracoDecoderPath)
  loader.setDRACOLoader(draco)
  loader.register((parser) => new VRMLoaderPlugin(parser))

  const gltf = await loader.parseAsync(buffer.slice(0), '')
  const vrm = gltf.userData.vrm
  if (!vrm) throw new Error('文件不是有效的 VRM（缺少 VRM 元数据）')

  const items: VrmReportItem[] = []
  const metaVersion = String(vrm.meta?.metaVersion ?? '1')

  // ── humanoid 完整性 ──
  const humanoidMissing: string[] = []
  for (const [bone, label] of HUMANOID_REQUIRED) {
    if (!vrm.humanoid?.getNormalizedBoneNode(bone as never)) humanoidMissing.push(label)
  }
  items.push(
    humanoidMissing.length === 0
      ? { key: 'humanoid', label: '人形骨骼', level: 'ok', detail: '标准人形骨骼完整，支持全部动画' }
      : {
          key: 'humanoid',
          label: '人形骨骼',
          level: humanoidMissing.length > 6 ? 'fail' : 'warn',
          detail: `缺少 ${humanoidMissing.length} 处关键骨骼：${humanoidMissing.join('、')}${humanoidMissing.length > 6 ? '（无法播放动画）' : '（部分动作可能不自然）'}`
        }
  )

  // ── T/A-pose 判定（rest 上臂下垂角） ──
  const armZ = (side: 'left' | 'right'): number => {
    const node = vrm.humanoid?.getNormalizedBoneNode(side === 'left' ? 'leftUpperArm' : 'rightUpperArm')
    if (!node) return 0
    const e = new THREE.Euler().setFromQuaternion(node.quaternion, 'XYZ')
    return Math.round(THREE.MathUtils.radToDeg(Math.abs(e.z)))
  }
  const armRestZ = { left: armZ('left'), right: armZ('right') }
  const poseType =
    armRestZ.left > 15 || armRestZ.right > 15 ? 'A-pose' : armRestZ.left <= 2 && armRestZ.right <= 2 ? 'T-pose' : '未知'
  items.push(
    poseType === 'T-pose'
      ? { key: 'pose', label: '绑定姿势', level: 'ok', detail: '标准 T-pose，动画兼容性最佳' }
      : {
          key: 'pose',
          label: '绑定姿势',
          level: poseType === 'A-pose' ? 'warn' : 'warn',
          detail:
            poseType === 'A-pose'
              ? `检测到 A-pose（上臂下垂 ${armRestZ.left}/${armRestZ.right}°）。应用后将自动补偿，动画表现正常`
              : '非标准绑定姿势，动画将自动尽量补偿'
        }
  )

  // ── 表情 ──
  const em = vrm.expressionManager
  const expressions: string[] = em
    ? (em.expressions.map((x: { expressionName: string }) => x.expressionName) ?? [])
    : []
  const hasBlink = expressions.includes('blink')
  const hasMouth = expressions.some((x) => ['aa', 'ih', 'ou'].includes(x))
  const hasEmote = expressions.some((x) => ['happy', 'sad', 'angry', 'relaxed', 'surprised'].includes(x))
  items.push(
    hasBlink && hasEmote
      ? { key: 'expr', label: '表情系统', level: 'ok', detail: `可用表情 ${expressions.length} 项（眨眼/情绪/口型齐全）` }
      : {
          key: 'expr',
          label: '表情系统',
          level: hasBlink ? 'warn' : 'warn',
          detail: hasBlink
            ? `表情不全：缺${[!hasEmote && '情绪表情', !hasMouth && '口型'].filter(Boolean).join('、')}（AI 回复的表情联动会受限）`
            : '该模型没有任何表情预设：不会眨眼、AI 表情联动无效（这是模型本身的限制）'
        }
  )

  // ── 物理（SpringBone） ──
  const springJoints = vrm.springBoneManager ? vrm.springBoneManager.joints.length : 0
  items.push(
    springJoints > 0
      ? { key: 'spring', label: '头发/裙摆物理', level: 'ok', detail: `SpringBone 关节 ${springJoints} 处，发丝裙摆会自然摆动` }
      : { key: 'spring', label: '头发/裙摆物理', level: 'warn', detail: '无 SpringBone 物理：头发裙摆静止（不影响功能）' }
  )

  // ── 性能统计 ──
  let triangles = 0
  let meshes = 0
  let maxTextureSize = 0
  let textures = 0
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    meshes++
    const geo = mesh.geometry as THREE.BufferGeometry
    if (geo.index) triangles += geo.index.count / 3
    else if (geo.attributes.position) triangles += geo.attributes.position.count / 3
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      const mat = m as THREE.MeshStandardMaterial & { map?: THREE.Texture }
      for (const tex of [mat.map, mat.normalMap, mat.roughnessMap, (mat as unknown as { emissiveMap?: THREE.Texture }).emissiveMap]) {
        if (tex?.image) {
          textures++
          maxTextureSize = Math.max(maxTextureSize, tex.image.width ?? 0)
        }
      }
    }
  })
  const perfLevel: VrmReportItem =
    fileSizeMB > 60 || triangles > 120000
      ? { key: 'perf', label: '性能预估', level: 'warn', detail: `模型较大（${triangles.toLocaleString()} 面 / ${fileSizeMB}MB）：加载偏慢，建议用 VRoid/Blender 减面压缩后再上传` }
      : fileSizeMB > 25 || triangles > 60000
        ? { key: 'perf', label: '性能预估', level: 'warn', detail: `中等规模（${triangles.toLocaleString()} 面 / ${fileSizeMB}MB）：smooth 档可流畅运行` }
        : { key: 'perf', label: '性能预估', level: 'ok', detail: `轻量模型（${triangles.toLocaleString()} 面 / ${fileSizeMB}MB），任意档位流畅` }
  items.push(perfLevel)

  const humanoidFail = humanoidMissing.length > 6
  const report: VrmReport = {
    ok: !humanoidFail,
    metaVersion,
    humanoidMissing,
    expressions,
    springJoints,
    triangles: Math.round(triangles),
    meshes,
    textures,
    maxTextureSize,
    fileSizeMB,
    armRestZ,
    poseType,
    items
  }
  return report
}

