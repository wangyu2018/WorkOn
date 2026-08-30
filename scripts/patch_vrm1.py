# -*- coding: utf-8 -*-
"""VRM 方案一：体检式上传 + rest 姿态补偿（A-pose 自动适配）"""
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

# ── 1) inspect.ts 修缮（去 VRMUtils 占位/unknown 级别） ──
repl('src/renderer/src/vrm/inspect.ts',
     "import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'",
     "import { VRMLoaderPlugin } from '@pixiv/three-vrm'")
repl('src/renderer/src/vrm/inspect.ts',
     "\n// 保持 VRMUtils 引用（副作用导入：规格化工具注册）\nvoid VRMUtils\n",
     "\n")
repl('src/renderer/src/vrm/inspect.ts',
     "          level: poseType === 'A-pose' ? 'warn' : 'unknown' as never,",
     "          level: poseType === 'A-pose' ? 'warn' : 'warn',")

# ── 2) ipc：selectVrm 拆成 pick-inspect + apply ──
repl('src/main/ipc.ts',
     """  ipcMain.handle('pet:selectVrm', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({""",
     """  // VRM 方案一：选择 → 返回文件缓冲给渲染层体检，确认后再应用
  ipcMain.handle('pet:vrmPickInspect', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择 VRM 模型',
      filters: [
        { name: 'VRM 模型', extensions: ['vrm'] },
        { name: 'glTF 模型', extensions: ['gltf', 'glb'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (canceled || !filePaths.length) return null
    const srcPath = filePaths[0]
    const destDir = path.join(app.getPath('userData'), 'vrm-custom')
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    const pendingPath = path.join(destDir, `pending-${Date.now()}${path.extname(srcPath)}`)
    fs.copyFileSync(srcPath, pendingPath)
    const sizeMB = Math.round((fs.statSync(pendingPath).size / 1024 / 1024) * 10) / 10
    const buffer = fs.readFileSync(pendingPath)
    return {
      pendingPath,
      name: path.basename(srcPath),
      sizeMB,
      buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    }
  })

  ipcMain.handle('pet:vrmApply', async (_e, pendingPath: string) => {
    if (!pendingPath || !fs.existsSync(pendingPath)) return false
    setSettings({ petVrmPath: pendingPath } as Partial<AppSettings>)
    sendTo('pet', 'pet:reloadVrm', pendingPath)
    return true
  })

  ipcMain.handle('pet:selectVrm', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({""")

# ── 3) preload：新通道 ──
repl('src/preload/index.ts',
     "  selectVrmFile: () => ipcRenderer.invoke('pet:selectVrm'),",
     """  selectVrmFile: () => ipcRenderer.invoke('pet:selectVrm'),
  vrmPickInspect: () => ipcRenderer.invoke('pet:vrmPickInspect'),
  vrmApply: (pendingPath: string) => ipcRenderer.invoke('pet:vrmApply', pendingPath),""")

print('vrm ipc done')
