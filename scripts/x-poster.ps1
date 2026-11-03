param(
  [Parameter(Mandatory = $true)][string]$TextFile,
  [switch]$DryRun,
  [int]$PreviewWaitMs = 7000
)

# Post one tweet through the signed-in Chrome window, locating controls with UI Automation instead of
# guessing pixel offsets.
#
# Why UIA: on this 125%-scaled display the ad-hoc clicks were ~20% off (a "Post" click opened the
# profile banner, the taskbar, an ad). UIA gives the button's real bounding box every time, and the
# click that follows is DPI-aware, so the coordinates mean the same thing as the screenshot.
#
# Composer is opened with the 'n' keyboard shortcut rather than the left-nav button: the shortcut is
# independent of window size, zoom level and which page is loaded.

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PW {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
"@
[void][PW]::SetProcessDPIAware()

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

function Click-Center([System.Windows.Automation.AutomationElement]$el) {
  $r = $el.Current.BoundingRectangle
  if ($r.Width -lt 2 -or $r.Height -lt 2) { return $false }
  $x = [int]($r.X + $r.Width / 2)
  $y = [int]($r.Y + $r.Height / 2)
  [void][PW]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 220
  [PW]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [PW]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 700
  return $true
}

$chrome = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object -First 1
if (-not $chrome) { Write-Output "no_chrome"; exit 2 }
$ws = New-Object -ComObject WScript.Shell
# AppActivate alone is unreliable: Windows only lets the foreground process hand focus over, and this
# powershell was launched from a terminal that is itself in front. AttachThreadInput to the current
# foreground window first, then SetForegroundWindow, is what actually moves focus.
[void]$ws.AppActivate([int]$chrome.Id)
Start-Sleep -Milliseconds 500
$fg = [PW]::GetForegroundWindow()
$fgThread = [PW]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
$me = [PW]::GetCurrentThreadId()
[void][PW]::AttachThreadInput($me, $fgThread, $true)
[void][PW]::ShowWindow($chrome.MainWindowHandle, 9)   # SW_RESTORE
[void][PW]::SetForegroundWindow($chrome.MainWindowHandle)
[void][PW]::AttachThreadInput($me, $fgThread, $false)
Start-Sleep -Milliseconds 900

if ([bool](Get-Process LogonUI -ErrorAction SilentlyContinue)) { Write-Output "locked"; exit 3 }

$text = (Get-Content $TextFile -Raw -Encoding UTF8).TrimEnd()
if ([string]::IsNullOrWhiteSpace($text)) { Write-Output "empty_text"; exit 4 }

$root = [System.Windows.Automation.AutomationElement]::RootElement

# 1. Get to a known page first. The 'n' shortcut only works when the app is focused on a page that
#    owns the key handler; after another script left the browser on a profile with text selected, it
#    silently does nothing and the composer never opens (that is the "no_post_button" failure).
[void]$ws.AppActivate([int]$chrome.Id)
Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait("{ESC}")
Start-Sleep -Milliseconds 200
$ws.SendKeys("^l")
Start-Sleep -Milliseconds 350
Set-Clipboard -Value "https://x.com/home"
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 250
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Seconds 7
[System.Windows.Forms.SendKeys]::SendWait("{ESC}")

# 2. Open the composer with 'n', and fall back to the nav Post button when the shortcut is swallowed.
$editorCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Post text")
$editor = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editorCond)
if (-not $editor) {
  $ws.SendKeys("n")
  Start-Sleep -Seconds 3
  $editor = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editorCond)
}
if (-not $editor) {
  $postNavCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Post")
  foreach ($el in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $postNavCond)) {
    $rr = $el.Current.BoundingRectangle
    if ($rr.Width -gt 160 -and $rr.Width -lt 400 -and $el.Current.IsEnabled) { [void](Click-Center $el); break }
  }
  Start-Sleep -Seconds 3
  $editor = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editorCond)
}
if (-not $editor) { Start-Sleep -Seconds 2; $editor = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editorCond) }
if ($editor) { [void](Click-Center $editor) } else { Write-Output "no_editor"; exit 8 }
Start-Sleep -Milliseconds 400

# 3. Paste, then wait for X to expand the link card (the Post button moves when it does).
Set-Clipboard -Value $text
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds $PreviewWaitMs
# Do NOT send ESC here. In this X build ESC closes the whole composer and raises "Discard post?",
# which then covers the Post button and the run fails with no_post_button while the draft sits behind
# a modal. A space + backspace collapses the @mention typeahead without touching the composer.
[System.Windows.Forms.SendKeys]::SendWait(" ")
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait("{BACKSPACE}")
Start-Sleep -Milliseconds 800

if ($DryRun) { Write-Output "dry_run: text is in the composer"; exit 0 }

# 4. Find the composer's Post button (the nav one sits at Y<200 and is a different control).
# The link card loads asynchronously and pushes the button down, so a single read can point at the
# old position (that is how a "Post" click became a "close composer" click). Poll until the button's
# rectangle is stable for three consecutive samples, then click that.
# Wait out the link-card expansion before sampling: the card arrives ~2-6s after the paste, and if
# the loop starts too early it sees a "stable" pre-card position and clicks where the button used to be.
Start-Sleep -Seconds 6

$postCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Post")
$target = $null
$lastKey = ""
$stable = 0
for ($i = 0; $i -lt 30; $i++) {
  $posts = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $postCond)
  $cand = $null
  foreach ($el in $posts) {
    $r = $el.Current.BoundingRectangle
    if (-not $el.Current.IsEnabled) { continue }
    if ($r.Y -lt 200) { continue }
    if ($r.Width -lt 40) { continue }
    if ($r.Width -gt 140) { continue }   # the left-nav "Post" pill is ~210 wide; the composer button ~61
    $cand = $el
    break
  }
  if ($cand) {
    $r = $cand.Current.BoundingRectangle
    $key = ([int]$r.X).ToString() + "," + ([int]$r.Y).ToString() + "," + ([int]$r.Width).ToString()
    if ($key -eq $lastKey) { $stable++ } else { $stable = 0; $lastKey = $key }
    $target = $cand
    if ($stable -ge 2) { break }
  }
  Start-Sleep -Milliseconds 900
}
if (-not $target) { Write-Output "no_post_button (over limit or composer not ready)"; exit 5 }

$rect = $target.Current.BoundingRectangle
Write-Output ("post_button at " + [int]$rect.X + "," + [int]$rect.Y + " " + [int]$rect.Width + "x" + [int]$rect.Height)

# Invoke the control rather than clicking its pixels. UIA's InvokePattern is what a screen reader
# uses; it does not care where the button is, whether a card pushed it down, or what the DPI scale
# is. The click is only a fallback for builds where the pattern is unavailable.
$invoked = $false
try {
  $pattern = $target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $pattern.Invoke()
  $invoked = $true
  Write-Output "invoked"
} catch {
  Write-Output ("invoke_failed: " + $_.Exception.Message)
}
if (-not $invoked) { [void](Click-Center $target) }
Start-Sleep -Seconds 6
Write-Output "posted_attempted"
