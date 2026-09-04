Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class ZProbe {
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int m);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@
$p = New-Object ZProbe+POINT
$p.X = 1605; $p.Y = 660
$hw = [ZProbe]::WindowFromPoint($p)
$pid2 = 0
[ZProbe]::GetWindowThreadProcessId($hw, [ref]$pid2) | Out-Null
$proc = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
$sb = New-Object System.Text.StringBuilder 128
[ZProbe]::GetWindowText($hw, $sb, 128) | Out-Null
Write-Output ("TOPMOST_AT_POINT: hwnd={0} pid={1} proc={2} title='{3}'" -f $hw, $pid2, $proc.ProcessName, $sb.ToString())
