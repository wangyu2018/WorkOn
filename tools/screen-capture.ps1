# screen-capture.ps1 <out.png> [x y w h]：BitBlt SRCCOPY|CAPTUREBLT 抓屏（包含 layered 窗口，如桌宠透明窗）
param(
  [string]$out = 'C:\Users\zhhch\wangyu\screen-cap.png',
  [int]$x = 0,
  [int]$y = 0,
  [int]$w = 1440,
  [int]$h = 900
)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class GDI {
  [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr hdcDest, int x, int y, int w, int h, IntPtr hdcSource, int xSrc, int ySrc, int rop);
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hdc);
  public const int SRCCOPY = 0x00CC0020;
  public const int CAPTUREBLT = unchecked((int)0x40000000);
}
'@

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$screenDc = [GDI]::GetDC([IntPtr]::Zero)
$destDc = $g.GetHdc()
[GDI]::BitBlt($destDc, 0, 0, $w, $h, $screenDc, $x, $y, [GDI]::SRCCOPY -bor [GDI]::CAPTUREBLT) | Out-Null
$g.ReleaseHdc($destDc)
[GDI]::ReleaseDC([IntPtr]::Zero, $screenDc) | Out-Null
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "saved $out ($w x $h @ $x,$y)"
