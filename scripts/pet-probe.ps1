param([string]$mode = 'shot', [int]$px = 0, [int]$py = 0, [string]$out = 'D:\AI\WorkOn\workonv0.2-6\workon\scripts\pet-shot.png')
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class PetWin {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int m);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint b, UIntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<Tuple<long, string, int, int, int, int>> Hits = new List<Tuple<long, string, int, int, int, int>>();
  public static uint TargetPid;
  public static void Collect() {
    Hits.Clear();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == TargetPid && IsWindowVisible(h)) {
        var sb = new StringBuilder(64); GetWindowText(h, sb, 64);
        RECT r; GetWindowRect(h, out r);
        Hits.Add(Tuple.Create(h.ToInt64(), sb.ToString(), r.Right - r.Left, r.Bottom - r.Top, r.Left, r.Top));
      }
      return true;
    }, IntPtr.Zero);
  }
}
"@
# 找 electron 主进程（有 WorkOn Pet 窗口的那个）
$procs = Get-Process electron -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id
$petHwnd = [IntPtr]::Zero
foreach ($p in $procs) {
  [PetWin]::TargetPid = [uint32]$p
  [PetWin]::Collect()
  $m = [PetWin]::Hits | Where-Object { $_.Item2 -eq 'WorkOn Pet' } | Select-Object -First 1
  if ($m) { $petHwnd = [IntPtr]$m.Item1; break }
}
if ($petHwnd -eq [IntPtr]::Zero) { Write-Output 'NOPET'; exit 1 }

[PetWin]::Collect()
$m = [PetWin]::Hits | Where-Object { $_.Item1 -eq $petHwnd.ToInt64() } | Select-Object -First 1
$w = $m.Item3; $h = $m.Item4; $left = $m.Item5; $top = $m.Item6
Write-Output "PET ${w}x${h} @ $left,$top"

if ($mode -eq 'rclick') {
  # 桌宠窗口是全屏覆盖层：屏幕逻辑坐标 = left + px, top + py
  [PetWin]::SetCursorPos($left + $px, $top + $py) | Out-Null
  Start-Sleep -Milliseconds 350
  [PetWin]::mouse_event(8, 0, 0, 0, [UIntPtr]::Zero)   # RIGHTDOWN
  [PetWin]::mouse_event(16, 0, 0, 0, [UIntPtr]::Zero)  # RIGHTUP
  Start-Sleep -Milliseconds 800
  Write-Output "RCLICK $px,$py"
}

$bmp = New-Object System.Drawing.Bitmap -ArgumentList @([int]$w, [int]$h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [PetWin]::PrintWindow($petHwnd, $hdc, 2)
$g.ReleaseHdc($hdc)
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "SAVED $out ($ok)"
