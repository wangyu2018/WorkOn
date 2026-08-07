# win-capture.ps1 <title> <out.png>：EnumWindows 按 Win32 标题找窗口，AttachThreadInput 强制置前后 CopyFromScreen
param(
  [string]$title = 'WorkOn',
  [string]$out = 'C:\Users\zhhch\wangyu\win-capture.png'
)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class U32Cap2 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  public static IntPtr FindByTitle(string exact) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;
      var sb = new StringBuilder(256);
      GetWindowText(hWnd, sb, 256);
      if (sb.ToString() == exact) { found = hWnd; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static void ForceForeground(IntPtr hWnd) {
    ShowWindow(hWnd, 9); // SW_RESTORE
    var fg = GetForegroundWindow();
    uint fgPid, curPid;
    var fgTid = GetWindowThreadProcessId(fg, out fgPid);
    var curTid = GetCurrentThreadId();
    var tgtTid = GetWindowThreadProcessId(hWnd, out curPid);
    AttachThreadInput(curTid, fgTid, true);
    AttachThreadInput(curTid, tgtTid, true);
    BringWindowToTop(hWnd);
    SetForegroundWindow(hWnd);
    AttachThreadInput(curTid, fgTid, false);
    AttachThreadInput(curTid, tgtTid, false);
  }
}
'@

$hwnd = [U32Cap2]::FindByTitle($title)
if ($hwnd -eq [IntPtr]::Zero) { Write-Error "window not found: $title"; exit 1 }

[U32Cap2]::ForceForeground($hwnd)
Start-Sleep -Milliseconds 800

$rect = New-Object U32Cap2+RECT
[U32Cap2]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) { Write-Error "bad rect"; exit 1 }

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size $w, $h))
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "saved $out ($w x $h)"
