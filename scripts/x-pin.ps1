param(
  [string]$ProfileUrl = "https://x.com/Predict065",
  [switch]$DryRun
)

# Pin the newest post on our own profile, through the signed-in Chrome window (UIA, no pixel guessing).
#
# X's profile timeline exposes the per-post overflow button with the accessible name "More". Clicking it
# opens a menu whose pin entry reads "Pin to your profile" (older builds: "Pin to profile"), and X then
# asks for confirmation in a dialog whose button is "Pin". Every step is a named control, so the same
# script survives layout changes that would break coordinate clicking.
#
# Output ends in "pinned_attempted" or a diagnostic line. The caller checks the profile's pinned slot
# by eye or by re-reading the account; this script does not claim success on its own.

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PINW {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
"@
[void][PINW]::SetProcessDPIAware()
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

function Click-Center([System.Windows.Automation.AutomationElement]$el) {
  $r = $el.Current.BoundingRectangle
  if ($r.Width -lt 2 -or $r.Height -lt 2) { return $false }
  [void][PINW]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
  Start-Sleep -Milliseconds 200
  [PINW]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 70
  [PINW]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 600
  return $true
}

function Find-Name([string]$name, [int]$minY, [switch]$Like) {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
  if ($Like) {
    $btn = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btn) | Where-Object { $_.Current.Name -like "*$name*" }
  }
  $best = $null; $bestY = 1e9
  foreach ($el in $all) {
    if (-not $el.Current.IsEnabled -or $el.Current.IsOffscreen) { continue }
    $r = $el.Current.BoundingRectangle
    if ($r.Width -lt 8 -or $r.Height -lt 8) { continue }
    if ($r.Y -lt $minY) { continue }
    if ($r.Y -lt $bestY) { $best = $el; $bestY = $r.Y }
  }
  return $best
}

$chrome = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object -First 1
if (-not $chrome) { Write-Output "no_chrome"; exit 2 }
if ([bool](Get-Process LogonUI -ErrorAction SilentlyContinue)) { Write-Output "locked"; exit 3 }

$ws = New-Object -ComObject WScript.Shell
[void]$ws.AppActivate([int]$chrome.Id)
Start-Sleep -Milliseconds 800
$ws.SendKeys("^l"); Start-Sleep -Milliseconds 350
Set-Clipboard -Value $ProfileUrl
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 250
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Seconds 10

$more = $null
for ($i = 0; $i -lt 8; $i++) {
  $more = Find-Name -name "More" -minY 220
  if ($more) { break }
  Start-Sleep -Seconds 2
}
if (-not $more) { Write-Output "no_more_button"; exit 5 }

$r = $more.Current.BoundingRectangle
Write-Output ("more_button at " + [int]$r.X + "," + [int]$r.Y)
[void](Click-Center $more)
Start-Sleep -Seconds 2

$pin = Find-Name -name "Pin to your profile" -minY 0
if (-not $pin) { $pin = Find-Name -name "Pin to profile" -minY 0 }
if (-not $pin) { $pin = Find-Name -name "Pin" -minY 0 -Like }
if (-not $pin) { Write-Output "no_pin_menu_item"; exit 6 }
[void](Click-Center $pin)
Start-Sleep -Seconds 2

if ($DryRun) { Write-Output "dry_run: pin menu opened, not confirmed"; exit 0 }

# Confirmation dialog ("Pin post?" → "Pin").
$confirm = Find-Name -name "Pin" -minY 0
if ($confirm) {
  [void](Click-Center $confirm)
  Start-Sleep -Seconds 3
}
Write-Output "pinned_attempted"
