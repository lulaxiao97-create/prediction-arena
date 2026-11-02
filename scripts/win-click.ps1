param(
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y,
  [int]$DelayMs = 900
)
# Click at PHYSICAL screen coordinates.
#
# This exists because the ad-hoc one-liners were not DPI-aware: on a 125% display SetCursorPos takes
# logical units, so a click aimed at a screenshot pixel lands ~20% up and to the left (which is how
# a "Post" click opened the profile banner, the taskbar, and a FTMO ad). Marking the process
# DPI-aware first makes the coordinates mean the same thing as the screenshot.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PIDPI {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
"@
[void][PIDPI]::SetProcessDPIAware()
[void][PIDPI]::SetCursorPos($X, $Y)
Start-Sleep -Milliseconds 220
[PIDPI]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 80
[PIDPI]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds $DelayMs
Write-Output ("clicked " + $X + "," + $Y)
