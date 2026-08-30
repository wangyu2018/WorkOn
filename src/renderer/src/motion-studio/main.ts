/**
 * 动作工坊：视频/摄像头 → MediaPipe 姿态估计 → 关节角重定向 → 动作资产 → 预览/入库
 * - 模型：pose_landmarker_lite（本地 ./mediapipe/，5.7MB）
 * - 重定向 v1：关节向量 → setFromUnitVectors 四元数（肘/膝为相对弯曲，规避骨架朝向猜测）
 * - 产出：MotionClipData（模型空间四元数关键帧），保存后桌宠可直接播放
 */
import * as THREE from 'three'
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { Stage } from '../pet/scene/Stage'
import { Lighting } from '../pet/scene/Lighting'
import { VrmCharacter } from '../pet/character/VrmCharacter'
import { buildClipFromMotionData } from '../pet/anim/AnimationManager'
import type { MotionClipData, MotionFrame } from '@shared/types'

const { api } = window as unknown as { api: Record<string, (...a: unknown[]) => Promise<unknown>> & Record<string, { on: (e: string, cb: (p: unknown) => void) => void }> }

// ── DOM 骨架 ──
document.body.style.cssText = 'margin:0;background:#0B1220;color:#e2e8f0;font:14px "Microsoft YaHei",sans-serif'
const app = document.createElement('div')
app.style.cssText = 'display:flex;gap:18px;padding:18px;box-sizing:border-box;height:100vh'
app.innerHTML = `
  <div id="left" style="flex:1.1;display:flex;flex-direction:column;gap:10px;min-width:0">
    <div style="font-size:16px;font-weight:700">🎬 动作工坊 <span style="font-size:11px;color:#64748b">视频/摄像头 → 动作 → 桌宠</span></div>
    <div id="videoWrap" style="position:relative;background:#0f172a;border-radius:12px;overflow:hidden;aspect-ratio:16/9">
      <video id="vid" style="width:100%;height:100%;object-fit:contain" playsinline muted></video>
      <canvas id="overlay" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></canvas>
      <div id="hint" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#64748b">选择视频文件或打开摄像头</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button id="btnFile" class="btn">📁 选择视频</button>
      <button id="btnCam" class="btn">📷 摄像头</button>
      <button id="btnCap" class="btn primary" disabled>● 开始捕捉</button>
      <input id="fileIn" type="file" accept="video/mp4,video/webm,video/quicktime" style="display:none" />
    </div>
    <div style="display:flex;align-items:center;gap:10px">
      <div style="flex:1;height:6px;border-radius:3px;background:#1e293b;overflow:hidden">
        <div id="capBar" style="height:100%;width:0%;background:linear-gradient(90deg,#8B5CF6,#22D3EE)"></div>
      </div>
      <span id="capText" style="font-size:12px;color:#64748b">帧 0</span>
    </div>
    <div id="log" style="font-size:12px;color:#94a3b8;min-height:36px;line-height:1.6">① 准备好含全身动作的短视频（建议 ≤15s）→ ② 开始捕捉 → ③ 预览满意后保存</div>
  </div>
  <div id="right" style="flex:1;display:flex;flex-direction:column;gap:10px;min-width:0">
    <div style="font-size:13px;color:#94a3b8">预览（真实佩戴你的 VRM 模型）</div>
    <div id="prevWrap" style="flex:1;border-radius:12px;overflow:hidden;background:#0f172a;min-height:300px"></div>
    <div style="display:flex;gap:8px;align-items:center">
      <input id="nameIn" placeholder="动作名称（如：机械舞）" maxlength="24"
        style="flex:1;background:#101a30;border:1px solid #1e293b;border-radius:8px;padding:8px 10px;color:#e2e8f0;outline:none" />
      <label style="font-size:12px;color:#64748b">价格
        <input id="costIn" type="number" min="0" value="0"
          style="width:64px;background:#101a30;border:1px solid #1e293b;border-radius:8px;padding:8px;color:#e2e8f0;outline:none" />
      </label>
      <button id="btnSave" class="btn primary" disabled>💾 保存到动作库</button>
    </div>
    <div style="font-size:11px;color:#475569">保存后自动出现在「桌搭 · 动作库」，点播放即可让桌宠做这个动作。设置积分价格后，其他视角的积分系统可兑换解锁（本地闭环）。</div>
  </div>
`
document.body.appendChild(app)

const style = document.createElement('style')
style.textContent = `
  .btn { background:#101a30;border:1px solid #263452;border-radius:8px;padding:8px 14px;color:#e2e8f0;cursor:pointer;font-size:13px }
  .btn:hover { border-color:#3b82f6 }
  .btn.primary { background:#8B5CF622;border-color:#8B5CF655;color:#c4b5fd }
  .btn:disabled { opacity:0.4;cursor:not-allowed }
`
document.head.appendChild(style)

const $ = (id: string): HTMLElement => document.getElementById(id)!
const vid = $('vid') as HTMLVideoElement
const overlay = $('overlay') as HTMLCanvasElement
const log = (msg: string): void => {
  ($('log') as HTMLElement).textContent = msg
}

// ── 预览场景：加载同款 VRM ──
let char: VrmCharacter | null = null
let mixer: THREE.AnimationMixer | null = null
let previewAction: THREE.AnimationAction | null = null
const stage = new Stage()
const lighting = new Lighting(stage.scene, null)
lighting.attachRenderer(stage.renderer)
$('prevWrap').appendChild(stage.renderer.domElement)
stage.renderer.domElement.style.width = '100%'
stage.renderer.domElement.style.height = '100%'

void (async () => {
  const s = (await api.getSettings?.()) as { petVrmPath?: string } | undefined
  char = await VrmCharacter.load(s?.petVrmPath || './vrm/peier-compressed.vrm').catch(() => VrmCharacter.load('./vrm/peier.vrm'))
  stage.scene.add(char.root)
  char.root.position.y = -char.height * 0.35
  char.attachLookTarget(stage.scene)
  mixer = new THREE.AnimationMixer(char.vrm.scene)
  stage.onFrame((dt) => {
    mixer?.update(dt)
    char!.update(dt)
  })
})()

// ── 媒体源 ──
let usingCamera = false
let cameraStream: MediaStream | null = null

async function openFile(): Promise<void> {
  const fileIn = $('fileIn') as HTMLInputElement
  fileIn.onchange = () => {
    const f = fileIn.files?.[0]
    if (!f) return
    stopCamera()
    vid.srcObject = null
    vid.src = URL.createObjectURL(f)
    vid.loop = false
    log(`已载入视频 ${f.name}（${(f.size / 1024 / 1024).toFixed(1)}MB），点击「开始捕捉」`)
    ;($('btnCap') as HTMLButtonElement).disabled = false
  }
  fileIn.click()
}

async function openCamera(): Promise<void> {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
    vid.srcObject = cameraStream
    vid.src = ''
    vid.loop = true
    await vid.play()
    usingCamera = true
    log('摄像头已开启。对镜头做动作，点击「开始捕捉」实时录制')
    ;($('btnCap') as HTMLButtonElement).disabled = false
  } catch (e) {
    log('摄像头打开失败：' + (e as Error).message)
  }
}

function stopCamera(): void {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop())
    cameraStream = null
    usingCamera = false
  }
}

// ── MediaPipe ──
let landmarker: PoseLandmarker | null = null
let modelFailed = false

async function ensureLandmarker(): Promise<PoseLandmarker | null> {
  if (landmarker) return landmarker
  if (modelFailed) return null
  try {
    log('正在加载姿态模型（5.7MB，本地缓存）…')
    const fileset = await FilesetResolver.forVisionTasks('./mediapipe/wasm/')
    landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: './mediapipe/pose_landmarker_lite.task', delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1
    })
    log('姿态模型就绪 ✓')
    return landmarker
  } catch (e) {
    modelFailed = true
    log('姿态模型加载失败：' + (e as Error).message + '（检查网络或 assets/pose-model）')
    return null
  }
}

// ── 重定向 v1：标定参考系 + 关节向量 setFromUnitVectors ──
interface Calib { up: THREE.Vector3; la: THREE.Vector3; ra: THREE.Vector3; leg: THREE.Vector3 }
let calib: Calib | null = null

const V = (lm: { x: number; y: number; z: number }): THREE.Vector3 =>
  new THREE.Vector3(lm.x, lm.y, lm.z)
const norm = (v: THREE.Vector3): THREE.Vector3 => v.clone().normalize()
const qBetween = (a: THREE.Vector3, b: THREE.Vector3): [number, number, number, number] => {
  const q = new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize())
  return [q.x, q.y, q.z, q.w]
}

/** 标定：前几帧取平均，建立"上/左臂/右臂/腿向下"参考方向 */
function calibrate(wl: { x: number; y: number; z: number }[]): void {
  const sm = V(wl[11]).add(V(wl[12])).multiplyScalar(0.5)
  const hm = V(wl[23]).add(V(wl[24])).multiplyScalar(0.5)
  const up = norm(sm.sub(hm))
  const la = norm(V(wl[11]).sub(V(wl[12]))) // 肩左-肩右 = 指向左肩的水平方向
  la.sub(up.clone().multiplyScalar(la.dot(up))).normalize()
  const ra = la.clone().negate()
  calib = { up, la, ra, leg: up.clone().negate() }
  log('已标定站姿参考系 ✓')
}

/** 一帧世界关键点 → 骨骼四元数（模型空间） */
function retarget(wl: { x: number; y: number; z: number }[]): MotionFrame['rot'] {
  if (!calib) return {}
  const rot: MotionFrame['rot'] = {}
  const sm = V(wl[11]).add(V(wl[12])).multiplyScalar(0.5)
  const hm = V(wl[23]).add(V(wl[24])).multiplyScalar(0.5)
  // 躯干
  rot.spine = qBetween(calib.up, norm(sm.clone().sub(hm)))
  // 头（鼻子相对肩中）
  rot.head = qBetween(calib.up, norm(V(wl[0]).sub(sm)))
  // 上臂：从水平参考转到当前上臂方向
  rot.leftUpperArm = qBetween(calib.la, norm(V(wl[13]).sub(V(wl[11]))))
  rot.rightUpperArm = qBetween(calib.ra, norm(V(wl[14]).sub(V(wl[12]))))
  // 前臂：上臂方向 → 前臂方向（弯曲角，天然不受抬臂影响）
  rot.leftLowerArm = qBetween(norm(V(wl[11]).sub(V(wl[13]))), norm(V(wl[15]).sub(V(wl[13]))))
  rot.rightLowerArm = qBetween(norm(V(wl[12]).sub(V(wl[14]))), norm(V(wl[16]).sub(V(wl[14]))))
  // 腿
  rot.leftUpperLeg = qBetween(calib.leg, norm(V(wl[25]).sub(V(wl[23]))))
  rot.rightUpperLeg = qBetween(calib.leg, norm(V(wl[26]).sub(V(wl[24]))))
  rot.leftLowerLeg = qBetween(norm(V(wl[23]).sub(V(wl[25]))), norm(V(wl[27]).sub(V(wl[25]))))
  rot.rightLowerLeg = qBetween(norm(V(wl[24]).sub(V(wl[26]))), norm(V(wl[28]).sub(V(wl[26]))))
  return rot
}

/** 骨架叠加绘制 */
function drawSkeleton(wl: { x: number; y: number; z: number }[]): void {
  const ctx = overlay.getContext('2d')!
  const W = (overlay.width = overlay.clientWidth)
  const H = (overlay.height = overlay.clientHeight)
  ctx.clearRect(0, 0, W, H)
  if (!wl.length) return
  // 用可见 landmark 的包围盒投影（x∈[0,1] 相对画面近似）
  const pts = wl.map((p) => ({ x: (1 - p.x / 2) * W * 0.5 + W / 2 - (p.x * W) / 4, y: H / 2 - p.y * H * 0.45 }))
  const BONES: [number, number][] = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
    [0, 11], [0, 12]
  ]
  ctx.strokeStyle = '#22D3EE'
  ctx.lineWidth = 2
  ctx.beginPath()
  for (const [a, b] of BONES) {
    const pa = pts[a], pb = pts[b]
    if (!pa || !pb) continue
    ctx.moveTo(pa.x, pa.y)
    ctx.lineTo(pb.x, pb.y)
  }
  ctx.stroke()
  ctx.fillStyle = '#8B5CF6'
  for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    if (!pts[i]) continue
    ctx.beginPath()
    ctx.arc(pts[i].x, pts[i].y, 3, 0, Math.PI * 2)
    ctx.fill()
  }
}

// ── 捕捉状态机 ──
let capturing = false
let frames: MotionFrame[] = []
let capStartTs = 0
let lastSampleT = -1
const MAX_SEC = 20
const SAMPLE_FPS = 30

async function startCapture(): Promise<void> {
  const lm = await ensureLandmarker()
  if (!lm) return
  if (vid.readyState < 2) { log('媒体还没准备好'); return }
  capturing = true
  frames = []
  capStartTs = performance.now()
  lastSampleT = -1
  calib = null
  ;($('btnCap') as HTMLButtonElement).textContent = '■ 停止捕捉'
  log('捕捉中…（对镜头/视频做动作）')
  if (!usingCamera) {
    vid.currentTime = 0
    await vid.play().catch(() => undefined)
  }
  const loop = async (): Promise<void> => {
    if (!capturing) return
    const now = performance.now()
    const elapsed = (now - capStartTs) / 1000
    const mediaT = vid.currentTime
    if (lastSampleT < 0 || mediaT - lastSampleT >= 1 / SAMPLE_FPS) {
      lastSampleT = mediaT
      try {
        const res = landmarker!.detectForVideo(vid, now)
        const wl = res.worldLandmarks?.[0]
        if (wl?.length) {
          drawSkeleton(wl)
          if (!calib && frames.length >= 5) calibrate(wl)
          if (calib) frames.push({ t: Number(mediaT.toFixed(3)), rot: retarget(wl) })
        }
        ;($('capBar') as HTMLElement).style.width = `${Math.min(100, (elapsed / MAX_SEC) * 100)}%`
        ;($('capText') as HTMLElement).textContent = `帧 ${frames.length} · ${elapsed.toFixed(1)}s`
      } catch { /* 单帧失败忽略 */ }
      if (elapsed >= MAX_SEC || (!usingCamera && vid.ended)) {
        stopCapture()
        return
      }
    }
    requestAnimationFrame(() => void loop())
  }
  void loop()
}

function stopCapture(): void {
  capturing = false
  ;($('btnCap') as HTMLButtonElement).textContent = '● 重新捕捉'
  if (!usingCamera) vid.pause()
  overlay.getContext('2d')!.clearRect(0, 0, overlay.width, overlay.height)
  if (frames.length < 10) {
    log(`捕捉帧太少（${frames.length}），请确保人物全身入镜后再试`)
    return
  }
  previewResult()
  ;($('btnSave') as HTMLButtonElement).disabled = false
  log(`捕捉完成：${frames.length} 帧 / ${frames[frames.length - 1].t.toFixed(1)}s ✓ 可预览后保存`)
}

let captured: MotionClipData | null = null
let coverDataUrl: string | undefined

function previewResult(): void {
  const duration = frames[frames.length - 1].t
  const fps = Math.round(frames.length / Math.max(0.5, duration))
  captured = { version: 1, fps, duration, frames }
  if (!char || !mixer) return
  const clip = buildClipFromMotionData(char, captured)
  previewAction?.stop()
  previewAction = mixer.clipAction(clip)
  previewAction.reset()
  previewAction.setLoop(THREE.LoopOnce, 1)
  previewAction.clampWhenFinished = true
  previewAction.play()
  // 封面：视频当前帧
  const c = document.createElement('canvas')
  c.width = 320; c.height = 180
  c.getContext('2d')!.drawImage(vid, 0, 0, 320, 180)
  coverDataUrl = c.toDataURL('image/png')
}

async function saveMotion(): Promise<void> {
  if (!captured) return
  const name = (($('nameIn') as HTMLInputElement).value || '').trim()
  const cost = Number(($('costIn') as HTMLInputElement).value || 0)
  const meta = (await api.motionsSave?.({
    name: name || '未命名动作',
    duration: captured.duration,
    fps: captured.fps,
    data: captured,
    coverDataUrl,
    cost
  })) as { name?: string } | null
  if (meta) {
    log(`已保存「${meta.name}」到动作库 ✓ 打开 桌搭 → 动作库 即可播放`)
    ;($('btnSave') as HTMLButtonElement).disabled = true
  } else {
    log('保存失败，请重试')
  }
}

// ── 事件绑定 ──
$('btnFile').addEventListener('click', () => void openFile())
$('btnCam').addEventListener('click', () => void openCamera())
$('btnCap').addEventListener('click', () => (capturing ? stopCapture() : void startCapture()))
$('btnSave').addEventListener('click', () => void saveMotion())
// resize 由 Stage 内部监听
