param(
  [Parameter(Mandatory = $true)][string]$Group,
  [Parameter(Mandatory = $true)][string]$TextFile
)

# Post one message into one public Telegram group, from the signed-in desktop account.
#
# Called once per group by the caller (bash), which keeps the PowerShell surface tiny: no JSON, no
# loops, no array marshalling — the thing PowerShell is worst at.
#
# Steps: open the group → click JOIN if we are not a member (same spot is the composer if we are) →
# click the composer → paste → click the paper-plane → clear a leftover draft.

$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class GU {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[void][GU]::SetProcessDPIAware()

function Click-At([int]$x, [int]$y) {
  [void][GU]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 150
  [GU]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [GU]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 250
}

$tg = Get-Process -Name Telegram -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $tg) { Write-Output 'no_app'; exit 2 }
if ([GU]::GetForegroundWindow() -eq [IntPtr]::Zero) { Write-Output 'locked'; exit 3 }

$text = Get-Content -Path $TextFile -Raw -Encoding UTF8
if ([string]::IsNullOrWhiteSpace($text)) { Write-Output 'empty_text'; exit 4 }

try { Start-Process -FilePath ("tg://resolve?domain=" + $Group) -ErrorAction Stop }
catch { & explorer.exe ("tg://resolve?domain=" + $Group) }
Start-Sleep -Milliseconds 3200

$r = New-Object GU+RECT
[void][GU]::GetWindowRect($tg.MainWindowHandle, [ref]$r)
Click-At ([int](($r.Left + $r.Right) / 2)) ($r.Bottom - 62)
Start-Sleep -Milliseconds 2000

[void][GU]::GetWindowRect($tg.MainWindowHandle, [ref]$r)
Click-At ([int]($r.Left + ($r.Right - $r.Left) * 0.45)) ($r.Bottom - 44)
Start-Sleep -Milliseconds 300
Set-Clipboard -Value $text
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 900

[void][GU]::GetWindowRect($tg.MainWindowHandle, [ref]$r)
Click-At ($r.Right - 39) ($r.Bottom - 31)
Start-Sleep -Milliseconds 1800

# If the send did not take, the draft would sit in the composer and get posted later by accident.
[System.Windows.Forms.SendKeys]::SendWait("^(a)")
Start-Sleep -Milliseconds 120
[System.Windows.Forms.SendKeys]::SendWait("{BACKSPACE}")
Start-Sleep -Milliseconds 300

Write-Output ('posted ' + $Group + ' (' + $text.Length + ' chars)')
