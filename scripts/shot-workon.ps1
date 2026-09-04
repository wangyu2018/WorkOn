Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class WinShot3 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<Tuple<long, string, int, int>> Found = new List<Tuple<long, string, int, int>>();
  public static uint TargetPid;
  public static void Collect() {
    Found.Clear();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == TargetPid && IsWindowVisible(h)) {
        var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
        RECT r; GetWindowRect(h, out r);
        int w = r.Right - r.Left, ht = r.Bottom - r.Top;
        if (w > 0 && ht > 0) Found.Add(Tuple.Create(h.ToInt64(), sb.ToString(), w, ht));
      }
      return true;
    }, IntPtr.Zero);
  }
  public static bool Print(IntPtr h, IntPtr hdc) { return PrintWindow(h, hdc, 2); }
}
"@
[WinShot3]::TargetPid = [uint32]31168
[WinShot3]::Collect()
$best = [IntPtr]::Zero; $bw = 0; $bh = 0
foreach ($f in [WinShot3]::Found) {
  Write-Output ("CAND {0} '{1}' {2}x{3}" -f $f.Item1, $f.Item2, $f.Item3, $f.Item4)
}
$main = [WinShot3]::Found | Where-Object { $_.Item2 -eq 'WorkOn' } | Select-Object -First 1
if ($main) { $best = [IntPtr]$main.Item1; $bw = $main.Item3; $bh = $main.Item4 }
else {
  foreach ($f in [WinShot3]::Found) {
    if ($f.Item3 * $f.Item4 -gt $bw * $bh) { $bw = $f.Item3; $bh = $f.Item4; $best = [IntPtr]$f.Item1 }
  }
}
if ($best -eq [IntPtr]::Zero) { Write-Output 'NOWINDOW'; exit 1 }
if ($bw -lt 300) {
  Write-Output 'RESTORE (window minimized)'
  [WinShot3]::ShowWindow($best, 9) | Out-Null
  Start-Sleep -Milliseconds 1200
  [WinShot3]::Collect()
  foreach ($f in [WinShot3]::Found) {
    if ($f.Item1 -eq $best.ToInt64()) { $bw = $f.Item3; $bh = $f.Item4 }
  }
  Write-Output "RESTORED ${bw}x${bh}"
}

$bmp = New-Object System.Drawing.Bitmap($bw, $bh)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [WinShot3]::Print($best.ToInt64(), $hdc)
$g.ReleaseHdc($hdc)
Write-Output "PRINTWINDOW $ok ${bw}x${bh}"
$out = 'D:\AI\WorkOn\workonv0.2-6\workon\scripts\aura-shot-home.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "SAVED $out"
