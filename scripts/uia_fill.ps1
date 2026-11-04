param(
  [int]$X,
  [int]$Y,
  [string]$Text = "",
  [switch]$NoClear
)
# Focus Chrome, click the coordinate, optionally clear the field, then type.
# Runs hidden so the PowerShell console never steals foreground from the page.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, int e);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  public const uint DOWN = 0x02, UP = 0x04;
}
"@
$p = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($null -eq $p) { Write-Output "no chrome window"; exit 1 }
[W]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
[W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 350
[W]::SetCursorPos($X, $Y) | Out-Null
Start-Sleep -Milliseconds 120
[W]::mouse_event([W]::DOWN, 0, 0, 0, 0)
Start-Sleep -Milliseconds 60
[W]::mouse_event([W]::UP, 0, 0, 0, 0)
# A click that arrives while the window is not yet active is swallowed by the window manager
# (it only raises the window). The first real click has to be the second one.
Start-Sleep -Milliseconds 220
[W]::mouse_event([W]::DOWN, 0, 0, 0, 0)
Start-Sleep -Milliseconds 60
[W]::mouse_event([W]::UP, 0, 0, 0, 0)
Start-Sleep -Milliseconds 250
if (-not $NoClear) {
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  Start-Sleep -Milliseconds 120
}
if ($Text.Length -gt 0) {
  [System.Windows.Forms.SendKeys]::SendWait($Text)
}
Write-Output ("typed at {0},{1}: {2}" -f $X, $Y, $Text)
