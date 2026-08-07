/**
 * VRM 姿态巡览页：逐个展示 POSES 全部姿态并自动截图上传（防穿模 QA）
 * 浏览器打开后自动跑完一轮：每个姿态 正面 + 半侧 各一张
 */
import * as THREE from 'three'
import { Stage } from './pet/scene/Stage'
import { Lighting } from './pet/scene/Lighting'
import { VrmCharacter } from './pet/character/VrmCharacter'
import { Animator } from './pet/anim/Animator'
import { POSES } from './pet/character/poses'

const status = document.getElementById('status')!
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const stage = new Stage()

let anim: Animator | null = null
let charRoot: THREE.Group | null = null
let capturing = false
let calibMode = false

async function run(): Promise<void> {
  const char = await VrmCharacter.load('./vrm/peier.vrm')
  charRoot = char.root
  // 巡览放大：角色占屏高约 62%
  const s = (window.innerHeight * 0.62) / char.height
  char.root.scale.setScalar(s)
  char.root.position.set(0, -window.innerHeight * 0.31, 0)
  stage.scene.add(char.root)
  char.attachLookTarget(stage.scene)

  const lighting = new Lighting(stage.scene, char.root)
  anim = new Animator(char)

  stage.onFrame((dt) => {
    if (!calibMode) anim!.update(dt) // 标定模式下直接写骨骼，避免被 Animator 覆盖
    char.update(dt)
    lighting.update(dt)
  })
  stage.start()

  // 标定模式：?calib=z 逐档渲染 upperarm z 角度（验证大角度旋转行为）
  const calib = new URLSearchParams(location.search).get('calib')
  if (calib) {
    calibMode = true
    const l = char.bone('upperarm_L')
    const r = char.bone('upperarm_R')
    const fl = char.bone('forearm_L')
    const fr = char.bone('forearm_R')
    const D2R = THREE.MathUtils.degToRad
    if (calib === 'y') {
      // 手臂下垂(z=90)状态下 y 轴摆动方向 + 肘弯方向
      for (const a of [-90, -45, 0, 45, 90]) {
        status.textContent = `calib y=${a}`
        l.rotation.set(0, D2R(a), D2R(90))
        r.rotation.set(0, D2R(-a), D2R(-90))
        fl.rotation.set(0, D2R(a * 0.6), 0)
        fr.rotation.set(0, D2R(-a * 0.6), 0)
        await sleep(120)
        await upload(`calib-y${a}`, 'front')
      }
    } else if (calib === 'zn') {
      // 负 z：举手方向验证（左臂取 z 值，右臂镜像）
      for (const z of [-45, -90, -135]) {
        status.textContent = `calib zn=${z}`
        l.rotation.set(0, 0, D2R(z))
        r.rotation.set(0, 0, D2R(-z))
        await sleep(120)
        await upload(`calib-zn${-z}`, 'front')
      }
    } else {
      for (const z of [0, 45, 90, 135, 160, 180]) {
        status.textContent = `calib z=${z}`
        l.rotation.set(0, 0, D2R(z))
        r.rotation.set(0, 0, D2R(-z))
        await sleep(120)
        await upload(`calib-z${z}`, 'front')
      }
    }
    status.textContent = 'calib 完成'
    return
  }

  // 逐姿态截图
  const names = Object.keys(POSES)
  for (const name of names) {
    capturing = true
    status.textContent = `姿态 ${names.indexOf(name) + 1}/${names.length}：${name}`
    anim!.setPose(name, 0.35)
    charRoot.rotation.y = 0
    await sleep(900)
    await upload(name, 'front')
    charRoot.rotation.y = 0.7
    await sleep(150)
    await upload(name, 'angle')
    capturing = false
  }
  status.textContent = '巡览完成'
}

async function upload(pose: string, view: string): Promise<void> {
  if (!charRoot) return
  const canvas = stage.renderer.domElement
  // Stage 未开 preserveDrawingBuffer：同步先渲一帧再立刻抓
  stage.renderer.render(stage.scene, stage.camera)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (blob) {
    await fetch(`/save-shot?name=${encodeURIComponent(`pose-${pose}-${view}`)}`, {
      method: 'POST',
      body: blob
    })
  }
}

run().catch((e) => {
  status.textContent = `失败：${e instanceof Error ? e.message : String(e)}`
})
