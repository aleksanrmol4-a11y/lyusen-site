# Генерирует assets/og-image.png (1200x630) для превью в соцсетях/мессенджерах.
# Запуск: powershell -ExecutionPolicy Bypass -File tools\make-og-image.ps1
Add-Type -AssemblyName System.Drawing

$repo = Split-Path $PSScriptRoot -Parent
$logoPath = Join-Path $repo "assets\logo.png"
$outPath  = Join-Path $repo "assets\og-image.png"

$W = 1200; $H = 630
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'HighQuality'
$g.InterpolationMode = 'HighQualityBicubic'
$g.PixelOffsetMode = 'HighQuality'
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# Фон — диагональный градиент как в hero
$rect = New-Object System.Drawing.Rectangle(0, 0, $W, $H)
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $rect,
  [System.Drawing.Color]::FromArgb(255, 255, 246, 232),
  [System.Drawing.Color]::FromArgb(255, 255, 215, 181),
  35)
$g.FillRectangle($grad, $rect)

# Мягкий оранжевый круг за логотипом
$circ = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(40, 255, 138, 30))
$g.FillEllipse($circ, 690, -190, 660, 660)
$circ2 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(28, 255, 196, 46))
$g.FillEllipse($circ2, 580, 380, 420, 420)

# Логотип справа
$logo = [System.Drawing.Image]::FromFile($logoPath)
$g.DrawImage($logo, 780, 125, 380, 380)
$logo.Dispose()

# Текст слева
$ink    = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 21, 21, 27))
$orange = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 184, 77, 0))
$muted  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 95, 95, 105))

$fEyebrow = New-Object System.Drawing.Font("Segoe UI", 26, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fHead    = New-Object System.Drawing.Font("Segoe UI", 54, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fSub     = New-Object System.Drawing.Font("Segoe UI", 30, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

$g.DrawString("МАРКЕТИНГОВОЕ АГЕНТСТВО В ИЖЕВСКЕ", $fEyebrow, $orange, 78, 118)

$rectHead = New-Object System.Drawing.RectangleF(74, 180, 660, 300)
$g.DrawString("Приводим клиентов из рекламы и соцсетей — под ключ", $fHead, $ink, $rectHead)

$g.DrawString("lyusen18.ru   ·   Работаем по KPI", $fSub, $muted, 78, 522)

$g.Dispose()
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("Saved: " + $outPath + " (" + (Get-Item $outPath).Length + " bytes)")
