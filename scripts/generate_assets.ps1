Add-Type -AssemblyName System.Drawing

function Create-RoundedRectanglePath {
    param(
        [float]$x,
        [float]$y,
        [float]$width,
        [float]$height,
        [float]$radius
    )
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $radius * 2
    $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
    $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
    $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function Generate-BrandMark {
    param(
        [int]$size,
        [bool]$opaqueBackground = $false,
        [System.Drawing.Color]$bgFill = [System.Drawing.Color]::FromArgb(14, 20, 17)
    )

    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    if ($opaqueBackground) {
        $bgBrush = New-Object System.Drawing.SolidBrush($bgFill)
        $g.FillRectangle($bgBrush, 0, 0, $size, $size)
        $bgBrush.Dispose()
    } else {
        $g.Clear([System.Drawing.Color]::Transparent)
    }

    # Brand mark proportions:
    # Padding: 8% on each side if square icon, or fill
    $pad = [float]($size * 0.08)
    $boxSize = [float]($size - ($pad * 2))
    $radius = [float]($boxSize * 0.233)

    $rectPath = Create-RoundedRectanglePath $pad $pad $boxSize $boxSize $radius

    # Mint fill: #b8e4ce -> RGB(184, 228, 206)
    $mintColor = [System.Drawing.Color]::FromArgb(184, 228, 206)
    $mintBrush = New-Object System.Drawing.SolidBrush($mintColor)
    $g.FillPath($mintBrush, $rectPath)
    $mintBrush.Dispose()

    # Draw lowercase monospace 'm': #15251c -> RGB(21, 37, 28)
    $darkColor = [System.Drawing.Color]::FromArgb(21, 37, 28)
    $darkBrush = New-Object System.Drawing.SolidBrush($darkColor)

    # Font sizing
    $fontSize = [float]($boxSize * 0.70)
    $fontFamilies = @("Consolas", "Cascadia Code", "Courier New", "Lucida Console")
    $font = $null
    foreach ($fam in $fontFamilies) {
        try {
            $font = New-Object System.Drawing.Font($fam, $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
            break
        } catch { }
    }
    if ($null -eq $font) {
        $font = New-Object System.Drawing.Font([System.Drawing.FontFamily]::GenericMonospace, $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    }

    $stringFormat = New-Object System.Drawing.StringFormat
    $stringFormat.Alignment = [System.Drawing.StringAlignment]::Center
    $stringFormat.LineAlignment = [System.Drawing.StringAlignment]::Center

    # Slight vertical offset adjustment for monospace lowercase 'm' to visually center perfectly
    $textYOffset = [float](-$boxSize * 0.04)
    $textRect = New-Object System.Drawing.RectangleF($pad, ($pad + $textYOffset), $boxSize, $boxSize)

    $g.DrawString("m", $font, $darkBrush, $textRect, $stringFormat)

    # Cleanup
    $font.Dispose()
    $darkBrush.Dispose()
    $stringFormat.Dispose()
    $rectPath.Dispose()
    $g.Dispose()

    return $bmp
}

function Generate-Banner {
    param([int]$width = 1200, [int]$height = 630)

    $bmp = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # Background gradient: very dark green/charcoal #0c110e to #131d17
    $rect = New-Object System.Drawing.Rectangle(0, 0, $width, $height)
    $c1 = [System.Drawing.Color]::FromArgb(12, 17, 14)
    $c2 = [System.Drawing.Color]::FromArgb(19, 29, 23)
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 45.0)
    $g.FillRectangle($bgBrush, $rect)
    $bgBrush.Dispose()

    # Subtle grid accent line at border
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(40, 60, 48), 2)
    $g.DrawRectangle($borderPen, 1, 1, $width - 2, $height - 2)
    $borderPen.Dispose()

    # Draw Brand Mark Icon at (100, 215) size 200x200
    $iconSize = 190
    $iconX = 110
    $iconY = 220
    $iconPad = 0
    $iconBox = $iconSize
    $iconRadius = [float]($iconBox * 0.233)

    $iconPath = Create-RoundedRectanglePath $iconX $iconY $iconBox $iconBox $iconRadius
    $mintColor = [System.Drawing.Color]::FromArgb(184, 228, 206)
    $mintBrush = New-Object System.Drawing.SolidBrush($mintColor)
    $g.FillPath($mintBrush, $iconPath)
    $mintBrush.Dispose()
    $iconPath.Dispose()

    # Draw "m" in icon
    $darkColor = [System.Drawing.Color]::FromArgb(21, 37, 28)
    $darkBrush = New-Object System.Drawing.SolidBrush($darkColor)
    $iconFont = New-Object System.Drawing.Font("Consolas", ($iconBox * 0.70), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $textRect = New-Object System.Drawing.RectangleF($iconX, ($iconY - ($iconBox * 0.04)), $iconBox, $iconBox)
    $g.DrawString("m", $iconFont, $darkBrush, $textRect, $sf)
    $iconFont.Dispose()
    $darkBrush.Dispose()
    $sf.Dispose()

    # Text Block starting at X=340
    $textX = 345

    # "MergeMint" Title
    $titleFont = New-Object System.Drawing.Font("Segoe UI", 84, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(231, 236, 233))
    $g.DrawString("MergeMint", $titleFont, $whiteBrush, $textX, 200)

    # "BETA" Pill badge
    $badgeX = $textX + 465
    $badgeY = 222
    $badgeW = 74
    $badgeH = 34
    $badgePath = Create-RoundedRectanglePath $badgeX $badgeY $badgeW $badgeH 6
    $badgeBgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(36, 55, 43))
    $badgeBorderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70, 105, 85), 1.5)
    $g.FillPath($badgeBgBrush, $badgePath)
    $g.DrawPath($badgeBorderPen, $badgePath)
    $badgeFont = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $badgeTextBrush = New-Object System.Drawing.SolidBrush($mintColor)
    $badgeSf = New-Object System.Drawing.StringFormat
    $badgeSf.Alignment = [System.Drawing.StringAlignment]::Center
    $badgeSf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString("BETA", $badgeFont, $badgeTextBrush, (New-Object System.Drawing.RectangleF($badgeX, $badgeY, $badgeW, $badgeH)), $badgeSf)
    $badgePath.Dispose()
    $badgeBgBrush.Dispose()
    $badgeBorderPen.Dispose()
    $badgeFont.Dispose()
    $badgeTextBrush.Dispose()
    $badgeSf.Dispose()

    # Tagline
    $subtitleFont = New-Object System.Drawing.Font("Segoe UI", 30, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $mutedBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(160, 185, 172))
    $g.DrawString("GitHub-native bounties. Clear work. Canton settlement.", $subtitleFont, $mutedBrush, $textX, 310)

    # Feature tags strip
    $tagFont = New-Object System.Drawing.Font("Segoe UI", 20, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $tagBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120, 150, 135))
    $g.DrawString("Canton LocalNet  ·  Daml CIP-56 Holdings  ·  Groq AI Scout  ·  Verified PR Evidence", $tagFont, $tagBrush, $textX, 375)

    $titleFont.Dispose()
    $whiteBrush.Dispose()
    $subtitleFont.Dispose()
    $mutedBrush.Dispose()
    $tagFont.Dispose()
    $tagBrush.Dispose()
    $g.Dispose()

    return $bmp
}

# Output Paths
$outDir = Join-Path (Get-Location) "public"
if (!(Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

Write-Host "Generating MergeMint Visual Assets..."

# 1. 512x512 PNG (Transparent app mark)
$logo512 = Generate-BrandMark -size 512 -opaqueBackground $false
$logo512Path = Join-Path $outDir "logo.png"
$logo512.Save($logo512Path, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Created: $logo512Path (512x512 PNG)"

# Also copy to root for easy user discovery for AppsFactory upload
$rootLogoPath = Join-Path (Get-Location) "logo.png"
$logo512.Save($rootLogoPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Created: $rootLogoPath"

# 2. 512x512 JPG (Opaque dark background)
$logoJpg = Generate-BrandMark -size 512 -opaqueBackground $true
$logoJpgPath = Join-Path $outDir "logo.jpg"
$logoJpg.Save($logoJpgPath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
Write-Host "Created: $logoJpgPath (512x512 JPG)"

$rootJpgPath = Join-Path (Get-Location) "logo.jpg"
$logoJpg.Save($rootJpgPath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
Write-Host "Created: $rootJpgPath"

# 3. 180x180 Apple Touch Icon
$appleIcon = Generate-BrandMark -size 180 -opaqueBackground $false
$appleIconPath = Join-Path $outDir "apple-icon.png"
$appleIcon.Save($appleIconPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Created: $appleIconPath (180x180 PNG)"

# 4. 32x32 Favicon PNG
$icon32 = Generate-BrandMark -size 32 -opaqueBackground $false
$icon32Path = Join-Path $outDir "icon.png"
$icon32.Save($icon32Path, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Created: $icon32Path (32x32 PNG)"

# 5. Copy icon.png to src/app/icon.png for Next.js App Router dynamic icon handler
$srcAppDir = Join-Path (Get-Location) "src\app"
$srcAppIcon = Join-Path $srcAppDir "icon.png"
$icon32.Save($srcAppIcon, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Created: $srcAppIcon (Next.js App Router icon)"

# 6. Favicon ICO (standard 32x32)
$favIconPath = Join-Path $outDir "favicon.ico"
$iconH = $icon32.GetHicon()
$iconObj = [System.Drawing.Icon]::FromHandle($iconH)
$fileStream = New-Object System.IO.FileStream($favIconPath, [System.IO.FileMode]::Create)
$iconObj.Save($fileStream)
$fileStream.Close()
$iconObj.Dispose()
Write-Host "Created: $favIconPath (ICO)"

# 7. 1200x630 OpenGraph Banner
$banner = Generate-Banner -width 1200 -height 630
$bannerPath = Join-Path $outDir "logo-banner.png"
$banner.Save($bannerPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Created: $bannerPath (1200x630 OpenGraph Banner)"

# Clean up bitmaps
$logo512.Dispose()
$logoJpg.Dispose()
$appleIcon.Dispose()
$icon32.Dispose()
$banner.Dispose()

Write-Host "All assets generated successfully!"
