// WorkOn macOS 窗口采集器（winInfo 的 darwin 等价物）
// 用法：
//   wininfo-mac loop <sleepMs>   常驻模式：每 sleepMs 输出一行 JSON（前台+鼠标点+各屏顶层）
//   wininfo-mac check            权限检查：{"ax":bool,"screen":bool}
// 坐标输出为 Electron 习惯（左上原点）；只记元数据（app/标题/矩形），永不读内容。
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

struct Win: Codable {
    let app: String
    let title: String
    let x: Int, y: Int, width: Int, height: Int
    let screen: Int
    let exePath: String?
}

struct Payload: Codable {
    let fg: Win?
    let pointer: Win?
    let tops: [Win]
    let ax: Bool
    let screen: Bool
}

func checkPermissions() -> (Bool, Bool) {
    let ax = AXIsProcessTrusted()
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
    let named = windows.filter { ($0[kCGWindowName as String] as? String)?.isEmpty == false }
    return (ax, !named.isEmpty)
}

// CG 窗口矩形（全局点坐标，左下原点）→ Electron 左上原点
func toElectronRect(_ b: CGRect) -> (x: Int, y: Int, w: Int, h: Int) {
    let primaryHeight = NSScreen.screens.first?.frame.maxY ?? 0
    return (Int(b.origin.x), Int(primaryHeight - b.origin.y - b.height), Int(b.width), Int(b.height))
}

// 屏幕索引：矩形中心落在哪个 NSScreen（顺序与 Electron getAllDisplays 一致）
func screenIndex(ofX x: Int, y: Int, w: Int, h: Int) -> Int {
    let cx = Double(x) + Double(w) / 2
    let cyTop = Double(y) + Double(h) / 2 // 左上原点系
    for (i, s) in NSScreen.screens.enumerated() {
        let f = s.frame
        let top = Double(NSScreen.screens.first!.frame.maxY - f.maxY)
        if cx >= f.minX && cx <= f.maxX && cyTop >= top && cyTop <= top + f.height { return i }
    }
    return 0
}

func makeWin(pid: Int, bounds: CGRect, fallbackApp: String) -> Win? {
    if bounds.width < 40 || bounds.height < 40 { return nil }
    let app = NSRunningApplication(processIdentifier: pid_t(pid))
    let name = app?.localizedName ?? fallbackApp
    if name.isEmpty { return nil }
    let r = toElectronRect(bounds)
    let title = "" // 由调用方按权限填充
    return Win(app: name, title: title, x: r.x, y: r.y, width: r.w, height: r.h,
               screen: screenIndex(ofX: r.x, y: r.y, w: r.w, h: r.h),
               exePath: app?.bundleURL?.path)
}

// 屏幕录制权限可用时从 CGWindowList 拿标题；辅助功能可用时优先 AX（前台窗口）
func axTitle(pid: Int) -> String? {
    var value: CFTypeRef?
    let el: AXUIElement = AXUIElementCreateApplication(pid_t(pid))
    guard AXUIElementCopyAttributeValue(el, kAXMainWindowAttribute as CFString, &value) == .success,
          let win = value else { return nil }
    value = nil
    guard AXUIElementCopyAttributeValue(win as! AXUIElement, kAXTitleAttribute as CFString, &value) == .success,
          let t = value as? String else { return nil }
    return t
}

func cgTitle(windowDict: [String: Any]) -> String? {
    windowDict[kCGWindowName as String] as? String
}

func snapshot() -> Payload {
    let (ax, screen) = checkPermissions()
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] ?? []

    var wins: [(pid: Int, bounds: CGRect, dict: [String: Any], layer: Int)] = []
    for d in list {
        guard let pid = d[kCGWindowOwnerPID as String] as? Int,
              let b = d[kCGWindowBounds as String],
              let rect = CGRect(dictionaryRepresentation: b as! CFDictionary) else { continue }
        let layer = d[kCGWindowLayer as String] as? Int ?? 9999
        guard layer == 0 else { continue }
        wins.append((pid, rect, d, layer))
    }

    func build(_ w: (pid: Int, bounds: CGRect, dict: [String: Any], layer: Int), useAX: Bool) -> Win? {
        guard var win = makeWin(pid: w.pid, bounds: w.bounds, fallbackApp: "") else { return nil }
        var title = ""
        if useAX, ax, let t = axTitle(pid: w.pid) { title = t }
        else if screen, let t = cgTitle(windowDict: w.dict) { title = t }
        win = Win(app: win.app, title: title, x: win.x, y: win.y, width: win.width, height: win.height,
                  screen: win.screen, exePath: win.exePath)
        return win
    }

    // 前台窗口 = frontmost app 的第一个可见窗口（Windows 的 GetForegroundWindow 对应物）
    var fg: Win?
    if let front = NSWorkspace.shared.frontmostApplication {
        let cand = wins.filter { $0.pid == front.processIdentifier }
        if let first = cand.first {
            fg = build(first, useAX: true)
            if fg == nil, let second = cand.dropFirst().first { fg = build(second, useAX: true) }
        }
    }

    // 鼠标下窗口：包含鼠标点的可见 layer0 窗口中 z 序最前者
    var pointer: Win?
    let mouse = NSEvent.mouseLocation // 左下原点
    let mouseCG = CGPoint(x: mouse.x, y: mouse.y)
    if let hit = wins.first(where: { w in NSMouseInRect(mouseCG, w.bounds, false) }) {
        pointer = build(hit, useAX: false)
    }

    // 各屏中心顶层：bounds 含该屏中心的第一个窗口
    var tops: [Win] = []
    for s in NSScreen.screens {
        let f = s.frame
        let centerYBottom = f.midY
        let center = CGPoint(x: f.midX, y: centerYBottom)
        if let hit = wins.first(where: { w in NSMouseInRect(center, w.bounds, false) }) {
            if let win = build(hit, useAX: false) { tops.append(win) }
        }
    }

    return Payload(fg: fg, pointer: pointer, tops: tops, ax: ax, screen: screen)
}

func emit(_ p: Payload) {
    if let data = try? JSONEncoder().encode(p), let line = String(data: data, encoding: .utf8) {
        print(line)
        fflush(stdout) // 管道不支持 synchronizeFile，行缓冲+fflush 足够
    }
}

let args = CommandLine.arguments
if args.count >= 2 && args[1] == "check" {
    let (ax, screen) = checkPermissions()
    print("{\"ax\":\(ax),\"screen\":\(screen)}")
    exit(0)
}
if args.count >= 3 && args[1] == "loop" {
    let sleepMs = Double(args[2]) ?? 1000
    // 管道场景 stdout 换行即冲刷；禁用缓冲保证 Electron 侧实时读
    setvbuf(stdout, nil, _IOLBF, 0)
    while true {
        emit(snapshot())
        usleep(useconds_t(sleepMs * 1000))
    }
}
emit(snapshot())
exit(0)
