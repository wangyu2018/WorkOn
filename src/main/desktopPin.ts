/**
 * Windows：把 Electron 窗挂到桌面图标层（SHELLDLL_DefView），
 * 「显示桌面」后仍可见。挂错 WorkerW（壁纸层）会整窗消失。
 * 非 Win 平台为 no-op。
 *
 * 注意：只用 BrowserWindow.getNativeWindowHandle()，不要 GetAncestor 爬到更外层——
 * 会把 Electron 宿主壳挂走，表现为「待办打开了但看不见」。
 */
import type { BrowserWindow } from 'electron'
import koffi from 'koffi'

const WM_SPAWN_WORKER = 0x052c
const SMTO_NORMAL = 0
const SWP_SHOWWINDOW = 0x0040
const SWP_NOACTIVATE = 0x0010
const SWP_FRAMECHANGED = 0x0020
const HWND_TOP = 0
const SW_SHOW = 5

type Hwnd = unknown

type DesktopApis = {
  FindWindowW: (cls: string | null, name: string | null) => Hwnd
  FindWindowExW: (parent: Hwnd, childAfter: Hwnd, cls: string | null, name: string | null) => Hwnd
  SetParent: (child: Hwnd, parent: Hwnd) => Hwnd
  SetWindowPos: (
    hwnd: Hwnd,
    insertAfter: Hwnd | number,
    x: number,
    y: number,
    cx: number,
    cy: number,
    flags: number
  ) => number
  ScreenToClient: (hwnd: Hwnd, pt: Buffer) => number
  ShowWindow: (hwnd: Hwnd, cmd: number) => number
  IsWindowVisible: (hwnd: Hwnd) => number
  SendMessageTimeoutW: (
    hwnd: Hwnd,
    msg: number,
    wParam: number,
    lParam: number,
    flags: number,
    timeout: number,
    result: Hwnd
  ) => number
  EnumWindows: (cb: unknown, lParam: number) => boolean
  enumProcType: ReturnType<typeof koffi.proto>
}

let apis: DesktopApis | null = null

const attached = new WeakSet<BrowserWindow>()

function loadApis(): DesktopApis | null {
  if (apis) return apis
  if (process.platform !== 'win32') return null
  try {
    const user32 = koffi.load('user32.dll')
    const enumProcType = koffi.proto('bool __stdcall EnumWindowsProc(void *hwnd, intptr_t lParam)')
    apis = {
      FindWindowW: user32.func('FindWindowW', 'void *', ['str16', 'str16']),
      FindWindowExW: user32.func('FindWindowExW', 'void *', ['void *', 'void *', 'str16', 'str16']),
      SetParent: user32.func('SetParent', 'void *', ['void *', 'void *']),
      SetWindowPos: user32.func('SetWindowPos', 'bool', ['void *', 'void *', 'int', 'int', 'int', 'int', 'uint']),
      ScreenToClient: user32.func('ScreenToClient', 'bool', ['void *', 'void *']),
      ShowWindow: user32.func('ShowWindow', 'bool', ['void *', 'int']),
      IsWindowVisible: user32.func('IsWindowVisible', 'bool', ['void *']),
      SendMessageTimeoutW: user32.func('SendMessageTimeoutW', 'intptr', [
        'void *',
        'uint',
        'uintptr',
        'intptr',
        'uint',
        'uint',
        'void *'
      ]),
      EnumWindows: user32.func('EnumWindows', 'bool', [koffi.pointer(enumProcType), 'intptr']),
      enumProcType
    }
    return apis
  } catch (e) {
    console.warn('[desktopPin] load user32 failed', e)
    return null
  }
}

function readHwnd(win: BrowserWindow): Hwnd | null {
  try {
    const buf = win.getNativeWindowHandle()
    if (!buf?.length) return null
    return process.arch === 'ia32' ? buf.readUInt32LE(0) : buf.readBigUInt64LE(0)
  } catch {
    return null
  }
}

function spawnDesktopWorker(a: DesktopApis, progman: Hwnd): void {
  a.SendMessageTimeoutW(progman, WM_SPAWN_WORKER, 0, 0, SMTO_NORMAL, 1000, null)
  a.SendMessageTimeoutW(progman, WM_SPAWN_WORKER, 0x0d, 0, SMTO_NORMAL, 1000, null)
  a.SendMessageTimeoutW(progman, WM_SPAWN_WORKER, 0x0d, 1, SMTO_NORMAL, 1000, null)
}

/**
 * 桌面图标层：优先 SHELLDLL_DefView（和桌面图标同层）。
 * 切勿挂到「壁纸 WorkerW」，否则窗会沉到壁纸下——看起来像「点完就没了」。
 */
function findDesktopIconHost(): Hwnd | null {
  const a = loadApis()
  if (!a) return null
  try {
    const progman = a.FindWindowW('Progman', null)
    if (progman) spawnDesktopWorker(a, progman)

    if (progman) {
      const underProgman = a.FindWindowExW(progman, null, 'SHELLDLL_DefView', null)
      if (underProgman) return underProgman
    }

    let defView: Hwnd | null = null
    const cb = koffi.register((hwnd: Hwnd) => {
      const shell = a.FindWindowExW(hwnd, null, 'SHELLDLL_DefView', null)
      if (shell) {
        defView = shell
        return false
      }
      return true
    }, koffi.pointer(a.enumProcType))

    try {
      a.EnumWindows(cb, 0)
    } finally {
      koffi.unregister(cb)
    }

    if (defView) return defView
    return progman || null
  } catch (e) {
    console.warn('[desktopPin] findDesktopIconHost failed', e)
    return null
  }
}

function screenToParentClient(
  a: DesktopApis,
  parent: Hwnd,
  screenX: number,
  screenY: number
): { x: number; y: number } {
  const pt = Buffer.alloc(8)
  pt.writeInt32LE(Math.round(screenX), 0)
  pt.writeInt32LE(Math.round(screenY), 4)
  try {
    a.ScreenToClient(parent, pt)
    return { x: pt.readInt32LE(0), y: pt.readInt32LE(4) }
  } catch {
    return { x: Math.round(screenX), y: Math.round(screenY) }
  }
}

function restackAndShow(
  a: DesktopApis,
  child: Hwnd,
  bounds: { x: number; y: number; width: number; height: number },
  parent?: Hwnd | null
): void {
  let x = Math.round(bounds.x)
  let y = Math.round(bounds.y)
  // SetParent 之后坐标相对父窗；屏幕坐标需换成客户区，避免瞬移
  if (parent) {
    const c = screenToParentClient(a, parent, bounds.x, bounds.y)
    x = c.x
    y = c.y
  }
  a.SetWindowPos(
    child,
    HWND_TOP,
    x,
    y,
    Math.round(bounds.width),
    Math.round(bounds.height),
    SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_NOACTIVATE
  )
  a.ShowWindow(child, SW_SHOW)
}

function rollbackAttach(
  a: DesktopApis,
  win: BrowserWindow,
  child: Hwnd,
  bounds: Electron.Rectangle
): void {
  try { a.SetParent(child, null) } catch { /* ignore */ }
  attached.delete(win)
  try {
    win.setBounds(bounds, false)
    win.show()
  } catch { /* ignore */ }
}

function electronLooksAlive(win: BrowserWindow): boolean {
  try {
    if (win.isDestroyed()) return false
    if (!win.isVisible()) return false
    const b = win.getBounds()
    return b.width >= 40 && b.height >= 24
  } catch {
    return false
  }
}

/** 钉到桌面图标层；成功返回 true */
export function attachWindowToDesktop(win: BrowserWindow): boolean {
  if (process.platform !== 'win32') return false
  if (!win || win.isDestroyed()) return false

  const a = loadApis()
  if (!a) return false
  const child = readHwnd(win)
  if (!child) {
    console.warn('[desktopPin] missing child hwnd')
    return false
  }

  const bounds = win.getBounds()

  if (attached.has(win)) {
    const parent = findDesktopIconHost()
    restackAndShow(a, child, bounds, parent)
    try { win.showInactive() } catch { win.show() }
    return electronLooksAlive(win)
  }

  const parent = findDesktopIconHost()
  if (!parent) {
    console.warn('[desktopPin] missing desktop host')
    return false
  }

  try {
    win.setAlwaysOnTop(false)
    a.SetParent(child, parent)
    attached.add(win)
    // 只用客户区坐标摆位，勿再 setBounds(屏幕坐标) 否则会再次偏移
    restackAndShow(a, child, bounds, parent)
    try { win.showInactive() } catch { win.show() }

    const nativeOk = !!a.IsWindowVisible(child)
    const electronOk = electronLooksAlive(win)
    if (!nativeOk || !electronOk) {
      console.warn('[desktopPin] attached but not visibly alive, detaching', { nativeOk, electronOk })
      rollbackAttach(a, win, child, bounds)
      return false
    }
    return true
  } catch (e) {
    console.warn('[desktopPin] SetParent attach failed', e)
    rollbackAttach(a, win, child, bounds)
    return false
  }
}

/** 从桌面层拆下，恢复为普通顶层窗 */
export function detachWindowFromDesktop(win: BrowserWindow): boolean {
  if (process.platform !== 'win32') return false
  if (!win || win.isDestroyed()) return false
  if (!attached.has(win)) return true
  const a = loadApis()
  if (!a) return false
  const child = readHwnd(win)
  if (!child) return false
  const bounds = win.getBounds()
  try {
    a.SetParent(child, null)
    attached.delete(win)
    restackAndShow(a, child, bounds, null)
    try {
      win.setBounds(bounds, false)
      win.showInactive()
    } catch { /* ignore */ }
    return true
  } catch (e) {
    console.warn('[desktopPin] SetParent detach failed', e)
    return false
  }
}

export function isWindowDesktopPinned(win: BrowserWindow): boolean {
  return attached.has(win)
}

export function isDesktopPinSupported(): boolean {
  return process.platform === 'win32' && !!loadApis()
}
