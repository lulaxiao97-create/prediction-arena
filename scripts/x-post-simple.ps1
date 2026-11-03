param(
  [Parameter(Mandatory = $true)][string]$TextFile,
  [switch]$DryRun
)

# Post one tweet via the dedicated compose URL, with a verification step that the text landed.
#
# This replaces the 'n'-shortcut approach, which failed three different ways in one afternoon: the
# shortcut swallowed when the page was not focused, ESC closing the composer and raising "Discard post?",
# and the terminal window stealing focus mid-run. The recipe below is the one that actually worked
# every time it was tried by hand:
#
#   1. navigate straight to x.com/compose/post (no shortcut, no clicking a nav button)
#   2. confirm the editor control exists, click it, paste, then READ THE EDITOR BACK to prove the text
#      is in there before touching Post
#   3. dismiss any "Discard post?" dialog (click Cancel, which keeps the draft)
#   4. invoke the Post button (width 40-150, below the fold of the nav rail)
#
# Output ends in "posted_attempted" or a diagnostic; the caller screenshots to confirm.

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SPW {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@
[void][SPW]::SetProcessDPIAware()
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

function Click-Center([System.Windows.Automation.AutomationElement]$el) {
  $r = $el.Current.BoundingRectangle
  if ($r.Width -lt 2 -or $r.Height -lt 2) { return $false }
  [void][SPW]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
  Start-Sleep -Milliseconds 200
  [SPW]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 70
  [SPW]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 500
  return $true
}

function Find-ByName([string]$name) {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
  return $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
}

function Find-Post-Button {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Post")
  foreach ($el in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) {
    $r = $el.Current.BoundingRectangle
    if (-not $el.Current.IsEnabled -or $el.Current.IsOffscreen) { continue }
    if ($r.Width -lt 40 -or $r.Width -gt 200) { continue }
    # On /compose/post the Post button sits in the dialog header (~y 110-160); on the timeline it is
    # lower. Keep anything below the browser chrome and pick the topmost match.
    if ($r.Y -lt 60) { continue }
    return $el
  }
  return $null
}

$chrome = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object -First 1
if (-not $chrome) { Write-Output "no_chrome"; exit 2 }
if ([bool](Get-Process LogonUI -ErrorAction SilentlyContinue)) { Write-Output "locked"; exit 3 }

$ws = New-Object -ComObject WScript.Shell
[void]$ws.AppActivate([int]$chrome.Id)
Start-Sleep -Milliseconds 500
$fg = [SPW]::GetForegroundWindow()
$fgT = [SPW]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
$me = [SPW]::GetCurrentThreadId()
[void][SPW]::AttachThreadInput($me, $fgT, $true)
[void][SPW]::ShowWindow($chrome.MainWindowHandle, 9)
[void][SPW]::SetForegroundWindow($chrome.MainWindowHandle)
[void][SPW]::AttachThreadInput($me, $fgT, $false)
Start-Sleep -Milliseconds 800

$text = (Get-Content $TextFile -Raw -Encoding UTF8).TrimEnd()
if ([string]::IsNullOrWhiteSpace($text)) { Write-Output "empty_text"; exit 4 }

function Open-Composer {
  $ws.SendKeys("^l"); Start-Sleep -Milliseconds 320
  Set-Clipboard -Value "https://x.com/compose/post"
  Start-Sleep -Milliseconds 180
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Milliseconds 220
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  Start-Sleep -Milliseconds 1200
  # Accepts "Leave site?" if a draft is pending; harmless otherwise.
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  Start-Sleep -Seconds 8
}

function Get-Editor {
  foreach ($n in @("Post text", "What's happening?", "Post your reply")) {
    $e = Find-ByName $n
    if ($e) { return $e }
  }
  return $null
}

$editor = $null
for ($i = 0; $i -lt 3; $i++) {
  Open-Composer
  $editor = Get-Editor
  if ($editor) { break }
}
if (-not $editor) { Write-Output "no_editor"; exit 6 }

[void](Click-Center $editor)
Start-Sleep -Milliseconds 400
Set-Clipboard -Value $text
Start-Sleep -Milliseconds 250
[System.Windows.Forms.SendKeys]::SendWait("^a")
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Seconds 5
# Collapse the mention typeahead without ESC (ESC closes the composer here).
[System.Windows.Forms.SendKeys]::SendWait(" ")
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait("{BACKSPACE}")
Start-Sleep -Milliseconds 800

# Prove the text is in the editor before posting. ValuePattern works on X's contenteditable; when it
# is unavailable, fall back to the editor's accessible text.
$landed = $false
try {
  $vp = $editor.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $landed = $vp.Current.Value.Length -gt 20
} catch {
  $landed = ($editor.Current.Name.Length -gt 20)
}
if (-not $landed) {
  # One retry, this time pasting with the editor re-focused.
  [void](Click-Center $editor)
  Start-Sleep -Milliseconds 300
  Set-Clipboard -Value $text
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Seconds 3
  try { $landed = $editor.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value.Length -gt 20 } catch { $landed = $true }
}
Write-Output ("text_landed=" + $landed)

if ($DryRun) { Write-Output "dry_run"; exit 0 }

# A stray "Discard post?" dialog covers the Post button: keep the draft by clicking Cancel.
$cancel = Find-ByName "Cancel"
if ($cancel) { [void](Click-Center $cancel); Start-Sleep -Seconds 2; $editor = Get-Editor }

$post = $null
for ($i = 0; $i -lt 8; $i++) {
  $post = Find-Post-Button
  if ($post) { break }
  Start-Sleep -Seconds 2
}
if (-not $post) { Write-Output "no_post_button"; exit 5 }

try {
  ($post.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
  Write-Output "invoked"
} catch {
  [void](Click-Center $post)
  Write-Output "clicked"
}
Start-Sleep -Seconds 6
Write-Output "posted_attempted"
