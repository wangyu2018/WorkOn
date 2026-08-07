// montage.js <front|angle>：把姿态截图拼成网格大图（内嵌 PowerShell，base64 传递避免引号问题）
const { execSync } = require('child_process')
const view = process.argv[2] || 'front'

const ps = `
Add-Type -AssemblyName System.Drawing;
$dir = 'C:\\Users\\zhhch\\wangyu\\workon';
$files = Get-ChildItem $dir -Filter "vrm-preview-pose-*-${view}.png" | Where-Object { $_.Name -notmatch 'calib' } | Sort-Object Name;
$cols = 5; $cellW = 430; $cellH = 231; $labelH = 18;
$rows = [Math]::Ceiling($files.Count / $cols);
$w = $cols * $cellW; $h = $rows * ($cellH + $labelH);
$bmp = New-Object System.Drawing.Bitmap $w, $h;
$g = [System.Drawing.Graphics]::FromImage($bmp);
$g.Clear([System.Drawing.Color]::FromArgb(11, 18, 32));
$font = New-Object System.Drawing.Font('Consolas', 10);
for ($i = 0; $i -lt $files.Count; $i++) {
  $img = [System.Drawing.Image]::FromFile($files[$i].FullName);
  $x = ($i % $cols) * $cellW;
  $y = [Math]::Floor($i / $cols) * ($cellH + $labelH);
  $g.DrawImage($img, $x, $y, $cellW, $cellH);
  $label = $files[$i].Name -replace 'vrm-preview-pose-', '' -replace '-${view}\\.png$', '';
  $g.DrawString($label, $font, [System.Drawing.Brushes]::LightGreen, ($x + 4), ($y + $cellH + 2));
  $img.Dispose();
}
$out = Join-Path $dir 'montage-${view}.png';
$bmp.Save($out);
$g.Dispose(); $bmp.Dispose();
Write-Output ("saved " + $out + " cells=" + $files.Count);
`

// PowerShell -EncodedCommand 需要 UTF-16LE base64
const b64 = Buffer.from(ps, 'utf16le').toString('base64')
execSync(`powershell -NoProfile -EncodedCommand ${b64}`, { stdio: 'inherit' })
