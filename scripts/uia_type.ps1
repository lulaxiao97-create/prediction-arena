# Type into whatever has focus after a mouse click: click-xy + SendKeys, both via Win32.
#   powershell -File scripts\uia_type.ps1 -X 1176 -Y 670 -Text "predictionarena.online"
#   powershell -File scripts\uia_type.ps1 -X 1146 -Y 766 -ClickOnly
# ASCII-only (PowerShell 5.1 reads BOM-less files as ANSI).
param(
  [int]$X, [int]$Y,
  [string]$Text = "",
  [switch]$ClickOnly,
  [switch]$Enter
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MOUSEAPI {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, IntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
[MOUSEAPI]::SetCursorPos($X, $Y) | Out-Null
Start-Sleep -Milliseconds 150
[MOUSEAPI]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)   # left down
[MOUSEAPI]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)   # left up
Start-Sleep -Milliseconds 350
if (-not $ClickOnly -and $Text) {
  [System.Windows.Forms.SendKeys]::SendWait($Text)
  Start-Sleep -Milliseconds 250
}
if ($Enter) {
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
}
Write-Output ("clicked " + $X + "," + $Y + " text=" + $Text)
