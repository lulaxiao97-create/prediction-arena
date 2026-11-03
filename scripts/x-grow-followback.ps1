param(
  [Parameter(Mandatory = $true)][string]$TweetUrl,
  [int]$Max = 15,
  [int]$Scrolls = 4
)

# Follow the people who are already talking in a thread we care about.
#
# This is the only follower-growth mechanic that works at three followers without money: go where the
# audience already is (the replies under a big prediction-market or airdrop post), follow the ones who
# look like participants, and let the follow-back rate do the work. It types nothing, opens no composer
# and never replies - it only presses buttons whose accessible name starts with "Follow @", so a wrong
# click cannot post on the account's behalf.
#
#   powershell -File scripts\x-grow-followback.ps1 -TweetUrl "https://x.com/Polymarket/status/..." -Max 15
#
# Output: one line per follow attempt, then a summary. The caller counts "followed=" in the output.

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FBW {
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
[void][FBW]::SetProcessDPIAware()
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

function Click-Center([System.Windows.Automation.AutomationElement]$el) {
  $r = $el.Current.BoundingRectangle
  if ($r.Width -lt 2 -or $r.Height -lt 2) { return $false }
  [void][FBW]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
  Start-Sleep -Milliseconds 180
  [FBW]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [FBW]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 450
  return $true
}

$chrome = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object -First 1
if (-not $chrome) { Write-Output "no_chrome"; exit 2 }
if ([bool](Get-Process LogonUI -ErrorAction SilentlyContinue)) { Write-Output "locked"; exit 3 }

$ws = New-Object -ComObject WScript.Shell
[void]$ws.AppActivate([int]$chrome.Id)
Start-Sleep -Milliseconds 500
$fg = [FBW]::GetForegroundWindow()
$fgT = [FBW]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
$me = [FBW]::GetCurrentThreadId()
[void][FBW]::AttachThreadInput($me, $fgT, $true)
[void][FBW]::ShowWindow($chrome.MainWindowHandle, 9)
[void][FBW]::SetForegroundWindow($chrome.MainWindowHandle)
[void][FBW]::AttachThreadInput($me, $fgT, $false)
Start-Sleep -Milliseconds 700

$ws.SendKeys("^l"); Start-Sleep -Milliseconds 320
Set-Clipboard -Value $TweetUrl
Start-Sleep -Milliseconds 180
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 220
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 1200
# A pending draft in the composer makes Chrome ask "Leave site?" before navigating. Enter accepts the
# default (Leave) when that dialog is up, and is a no-op on the URL bar when it is not.
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Seconds 9

# Skip the tweet's own author: following the account we are already reading is not growth, and its
# Follow button sits at the top of the page where it would be the first thing clicked.
$author = ""
if ($TweetUrl -match "x\.com/([^/]+)/status/") { $author = $Matches[1] }
# Replies only get Follow buttons once the thread is expanded and scrolled into view.
[System.Windows.Forms.SendKeys]::SendWait("{PGDN}")
Start-Sleep -Seconds 2
[System.Windows.Forms.SendKeys]::SendWait("{PGDN}")
Start-Sleep -Seconds 2

$root = [System.Windows.Automation.AutomationElement]::RootElement
$followed = 0
$seen = @{}
$tried = 0

for ($s = 0; $s -lt $Scrolls -and $followed -lt $Max; $s++) {
  $btns = @()
  foreach ($ct in @([System.Windows.Automation.ControlType]::Button)) {
    $c = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ct)
    foreach ($el in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $c)) {
      $n = $el.Current.Name
      # "Follow @handle" in the web build; some builds expose just "Follow". Never touch "Following".
      if ($n -and ($n.StartsWith("Follow @") -or $n -eq "Follow") -and $el.Current.IsEnabled -and -not $el.Current.IsOffscreen) { $btns += $el }
    }
  }
  if (-not $btns.Count) {
    # Nothing to follow on screen: scroll the feed down and look again.
    [System.Windows.Forms.SendKeys]::SendWait("{PGDN}")
    Start-Sleep -Seconds 2
    continue
  }
  foreach ($b in ($btns | Sort-Object { $_.Current.BoundingRectangle.Y })) {
    if ($followed -ge $Max) { break }
    $handle = $b.Current.Name -replace '^Follow @?', ''
    if (-not $handle) { continue }
    if ($author -and $handle -ieq $author) { continue }
    if ($seen.ContainsKey($handle)) { continue }
    $seen[$handle] = $true
    $tried++
    [void](Click-Center $b)
    Start-Sleep -Milliseconds 900
    $followed++
    Write-Output ("followed=@" + $handle)
    if ($followed -ge $Max) { break }
  }
  [System.Windows.Forms.SendKeys]::SendWait("{PGDN}")
  Start-Sleep -Seconds 2
}

Write-Output ("done followed=" + $followed + " attempted=" + $tried)
