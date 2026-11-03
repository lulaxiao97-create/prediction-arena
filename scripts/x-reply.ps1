param(
  [Parameter(Mandatory = $true)][string]$TweetUrl,
  [Parameter(Mandatory = $true)][string]$TextFile,
  [string]$ImagePath = "",
  [switch]$DryRun
)

# Reply under one specific tweet, through the signed-in Chrome window, located with UI Automation.
#
# This is the cold-start interceptor's hands. It never decides WHAT to reply to - the monitor does
# that and hands over a tweet URL plus a UTF-8 text file - it only opens the tweet, clicks Reply,
# pastes and submits.
#
# Two things make this different from x-poster.ps1 (which posts a fresh tweet with the 'n' shortcut):
#   * the composer opens as a modal after clicking the tweet's own Reply button, so the submit button
#     has to be picked from the buttons BELOW the editor, not from the page's action bars;
#   * the page keeps its other Reply buttons in the accessibility tree, so "first match wins" would
#     click the wrong one. Every candidate is filtered by position relative to the editor.
#
# Output is one line per stage, ending in "posted_attempted" or a reason it stopped. The caller
# verifies the result by re-reading the tweet's reply count, not by trusting this output.

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RW {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
"@
[void][RW]::SetProcessDPIAware()

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Click-Center([System.Windows.Automation.AutomationElement]$el) {
  $r = $el.Current.BoundingRectangle
  if ($r.Width -lt 2 -or $r.Height -lt 2) { return $false }
  $x = [int]($r.X + $r.Width / 2)
  $y = [int]($r.Y + $r.Height / 2)
  [void][RW]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 220
  [RW]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [RW]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 600
  return $true
}

function Invoke-Or-Click([System.Windows.Automation.AutomationElement]$el) {
  try {
    $p = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $p.Invoke()
    return "invoked"
  } catch {
    [void](Click-Center $el)
    return "clicked"
  }
}

function Find-ByName([string]$name, [int]$minY, [int]$maxWidth, [switch]$Like) {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
  if ($Like) {
    # X renames controls between builds ("Reply", "Reply to …"); a substring match survives that.
    $cond2 = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond2) | Where-Object { $_.Current.Name -like "*$name*" }
  }
  $best = $null
  $bestY = 1e9
  foreach ($el in $all) {
    if (-not $el.Current.IsEnabled) { continue }
    if ($el.Current.IsOffscreen) { continue }
    $r = $el.Current.BoundingRectangle
    if ($r.Width -lt 12 -or $r.Height -lt 8) { continue }
    if ($maxWidth -gt 0 -and $r.Width -gt $maxWidth) { continue }
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
Start-Sleep -Milliseconds 900

$text = (Get-Content $TextFile -Raw -Encoding UTF8).TrimEnd()
if ([string]::IsNullOrWhiteSpace($text)) { Write-Output "empty_text"; exit 4 }

# 1. Open the tweet. Ctrl+L + URL is size/zoom independent, unlike clicking a timeline card.
[void]$ws.AppActivate([int]$chrome.Id)
Start-Sleep -Milliseconds 400
$ws.SendKeys("^l")
Start-Sleep -Milliseconds 400
Set-Clipboard -Value $TweetUrl
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Seconds 9

# 2. The tweet's own Reply button. Page action bars start below the sticky header (~y 150).
# The page can take 15-20s on a cold profile or a slow RPC-backed timeline; a fixed 9s wait is why the
# first real attempt logged "no_reply_button" and stopped. Poll up to ~28s, exact name first, then a
# substring match, and if it still fails dump what buttons ARE on screen so the next run is diagnosable.
$replyBtn = $null
for ($i = 0; $i -lt 10; $i++) {
  $replyBtn = Find-ByName -name "Reply" -minY 150 -maxWidth 200
  if ($replyBtn) { break }
  Start-Sleep -Seconds 2
}
if (-not $replyBtn) {
  $replyBtn = Find-ByName -name "Reply" -minY 150 -maxWidth 260 -Like
}
if (-not $replyBtn) {
  $root0 = [System.Windows.Automation.AutomationElement]::RootElement
  $btnType = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
  $names = @()
  foreach ($b in $root0.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnType)) {
    if ($b.Current.Name) { $names += $b.Current.Name }
    if ($names.Count -ge 18) { break }
  }
  Write-Output ("no_reply_button · visible buttons: " + ($names -join " | "))
  exit 5
}
$rb = $replyBtn.Current.BoundingRectangle
Write-Output ("reply_button at " + [int]$rb.X + "," + [int]$rb.Y)
$how = Invoke-Or-Click $replyBtn
Write-Output ("reply_button " + $how)
Start-Sleep -Seconds 3

# 3. The modal editor. X names it "Post text" in both the composer and the reply dialog; older
#    builds say "Post your reply", so both are tried before giving up.
$editor = Find-ByName -name "Post text" -minY 0 -maxWidth 0
if (-not $editor) { $editor = Find-ByName -name "Post your reply" -minY 0 -maxWidth 0 }
if (-not $editor) {
  Start-Sleep -Seconds 2
  $editor = Find-ByName -name "Post text" -minY 0 -maxWidth 0
}
if (-not $editor) { Write-Output "no_editor"; exit 6 }
[void](Click-Center $editor)
Start-Sleep -Milliseconds 400

Set-Clipboard -Value $text
Start-Sleep -Milliseconds 250
[System.Windows.Forms.SendKeys]::SendWait("^a")
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Seconds 6
[System.Windows.Forms.SendKeys]::SendWait("{ESC}")   # dismiss the @mention typeahead
Start-Sleep -Milliseconds 800

# 3b. Attach the market card when one is handed over. The clipboard image is pasted into the same
#     editor; X uploads it and the text stays. A failed attach is not fatal - the reply is still worth
#     posting without a picture, so this only reports and continues.
if ($ImagePath -and (Test-Path $ImagePath)) {
  try {
    $img = [System.Drawing.Image]::FromFile($ImagePath)
    [System.Windows.Forms.Clipboard]::SetImage($img)
    Start-Sleep -Milliseconds 400
    [void](Click-Center $editor)
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait("^v")
    Start-Sleep -Seconds 5
    $img.Dispose()
    Write-Output "image_pasted"
  } catch {
    Write-Output ("image_failed: " + $_.Exception.Message)
  }
}

if ($DryRun) { Write-Output "dry_run: reply text is in the modal, not submitted"; exit 0 }

# 4. Submit. The modal's button is named "Reply" and sits BELOW the editor; the page's own Reply
#    buttons are above it, so anything at or above the editor's y is the wrong control.
$er = $editor.Current.BoundingRectangle
$submit = Find-ByName -name "Reply" -minY ([int]($er.Y + $er.Height)) -maxWidth 160
if (-not $submit) { Write-Output "no_submit_button"; exit 7 }
$sr = $submit.Current.BoundingRectangle
Write-Output ("submit at " + [int]$sr.X + "," + [int]$sr.Y)
$how2 = Invoke-Or-Click $submit
Write-Output ("submit " + $how2)
Start-Sleep -Seconds 5
Write-Output "posted_attempted"
