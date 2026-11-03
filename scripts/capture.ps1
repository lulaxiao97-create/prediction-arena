# Screen/window capture — the ONLY sanctioned way to take a screenshot in this project.
#
# Rule: automated screenshots and image-recognition caches never go on the Windows Desktop or in the
# repo root. They land in <repo>/tmp/shots/ and are deleted when the run finishes.
#
# Usage (from PowerShell):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\capture.ps1 -Name x-compose
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\capture.ps1 -Name chrome -Process chrome
#
# Prints the absolute path of the PNG on stdout (one line), so callers can Read-Host/parse it.
param(
  [Parameter(Mandatory = $true)][string]$Name,
  # Capture only the main window of this process name (e.g. chrome, Telegram). Omit for full screen.
  [string]$Process,
  # Delete every other capture in the shots dir first — keeps the tmp dir bounded.
  [switch]$Clean
)

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CAPAPI {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[void][CAPAPI]::SetProcessDPIAware()

$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "tmp\shots"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
if ($Clean) { Get-ChildItem $dir -Filter *.png -ErrorAction SilentlyContinue | Remove-Item -Force }

$rect = New-Object CAPAPI+RECT
$bounds = $null
if ($Process) {
  $p = Get-Process -Name $Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($p) {
    [void][CAPAPI]::GetWindowRect($p.MainWindowHandle, [ref]$rect)
    $bounds = New-Object System.Drawing.Rectangle($rect.Left, $rect.Top, ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top))
  }
}
if (-not $bounds -or $bounds.Width -le 0) {
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
}

$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$path = Join-Path $dir ("{0}-{1}.png" -f $Name, (Get-Date -Format "HHmmss"))
$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output $path
