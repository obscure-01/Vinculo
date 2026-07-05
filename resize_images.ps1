param(
    [string]$fullLogoPath,
    [string]$symbolLogoPath,
    [string]$outputDir
)

Add-Type -AssemblyName System.Drawing

function Resize-Image {
    param(
        [string]$sourcePath,
        [string]$destPath,
        [int]$maxWidth,
        [int]$maxHeight,
        [bool]$isFavicon
    )
    
    $img = [System.Drawing.Image]::FromFile($sourcePath)
    
    # Calculate new dimensions keeping aspect ratio
    $ratioX = [double]$maxWidth / $img.Width
    $ratioY = [double]$maxHeight / $img.Height
    $ratio = [Math]::Min($ratioX, $ratioY)
    
    if ($isFavicon) {
        # For favicon/apple touch icon from the JPG symbol, it should be square.
        # It's already 1024x1024. We just scale it.
        $newWidth = $maxWidth
        $newHeight = $maxHeight
    } else {
        $newWidth = [int]($img.Width * $ratio)
        $newHeight = [int]($img.Height * $ratio)
    }
    
    $newImg = New-Object System.Drawing.Bitmap($newWidth, $newHeight)
    $graphics = [System.Drawing.Graphics]::FromImage($newImg)
    
    # High quality resizing
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    
    $graphics.DrawImage($img, 0, 0, $newWidth, $newHeight)
    
    # If the dest is .ico, we can just save it as PNG but rename to .ico or save as ICON? 
    # System.Drawing.Icon doesn't have an easy way to save high quality from bitmap. 
    # But a web favicon.ico can just be a PNG file renamed to .ico, browsers support this!
    $newImg.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
    
    $graphics.Dispose()
    $newImg.Dispose()
    $img.Dispose()
    
    Write-Host "Created $destPath"
}

# Ensure directories exist
$assetsDir = Join-Path $outputDir "assets\logo"
if (-not (Test-Path $assetsDir)) { New-Item -ItemType Directory -Path $assetsDir | Out-Null }

# 1. Full Logos
$fullLogoDest1 = Join-Path $assetsDir "vinculo-logo.png"
Copy-Item -Path $fullLogoPath -Destination $fullLogoDest1 -Force
Write-Host "Copied $fullLogoDest1"

Resize-Image -sourcePath $fullLogoPath -destPath (Join-Path $assetsDir "vinculo-logo-512.png") -maxWidth 512 -maxHeight 512 -isFavicon $false
Resize-Image -sourcePath $fullLogoPath -destPath (Join-Path $assetsDir "vinculo-logo-256.png") -maxWidth 256 -maxHeight 256 -isFavicon $false

# 2. Favicons
Resize-Image -sourcePath $symbolLogoPath -destPath (Join-Path $outputDir "favicon.ico") -maxWidth 32 -maxHeight 32 -isFavicon $true
Resize-Image -sourcePath $symbolLogoPath -destPath (Join-Path $outputDir "favicon-16x16.png") -maxWidth 16 -maxHeight 16 -isFavicon $true
Resize-Image -sourcePath $symbolLogoPath -destPath (Join-Path $outputDir "favicon-32x32.png") -maxWidth 32 -maxHeight 32 -isFavicon $true
Resize-Image -sourcePath $symbolLogoPath -destPath (Join-Path $outputDir "apple-touch-icon.png") -maxWidth 180 -maxHeight 180 -isFavicon $true

Write-Host "Done!"
