param([int]$px = 1605, [int]$py = 660, [string]$mode = 'shot', [string]$out = 'D:\AI\WorkOn\workonv0.2-6\workon\scripts\desk-shot.png')
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Desk {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint b, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
}
"@
$w = [Desk]::GetSystemMetrics(0); $h = [Desk]::GetSystemMetrics(1)
Write-Output "DESKTOP ${w}x${h}"
if ($mode -eq 'rclick') {
  [Desk]::SetCursorPos($px, $py) | Out-Null
  Start-Sleep -Milliseconds 400
  [Desk]::mouse_event(8, 0, 0, 0, [UIntPtr]::Zero)
  [Desk]::mouse_event(16, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 900
  Write-Output "RCLICK $px,$py"
}
$bmp = New-Object System.Drawing.Bitmap -ArgumentList @([int]$w, [int]$h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size($w, $h)))
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "SAVED $out"
