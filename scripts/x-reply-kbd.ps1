param(
  [Parameter(Mandatory = $true)][string]$TweetUrl,
  [Parameter(Mandatory = $true)][string]$TextFile,
  [switch]$DryRun
)

# Reply using the keyboard only: navigate, press "r", paste, Ctrl+Enter.
#
# The mouse version kept failing in a way that was hard to diagnose: UIA would find the Reply control,
# the click would land somewhere else (a window context menu came up on the title bar), and the run
# ended by dumping taskbar button names. Keyboard shortcuts do not have coordinates, so there is
# nothing to land on the wrong window: "r" opens the reply composer for the focused tweet, Ctrl+Enter
# submits. Both are documented X shortcuts and both work while the composer has focus.
#
# Output: "posted_attempted" or a reason. The caller verifies with the tweet's reply count.

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class KBW {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@
[void][KBW]::SetProcessDPIAware()
Add-Type -AssemblyName System.Windows.Forms

$chrome = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object -First 1
if (-not $chrome) { Write-Output "no_chrome"; exit 2 }
if ([bool](Get-Process LogonUI -ErrorAction SilentlyContinue)) { Write-Output "locked"; exit 3 }

$text = (Get-Content $TextFile -Raw -Encoding UTF8).TrimEnd()
if ([string]::IsNullOrWhiteSpace($text)) { Write-Output "empty_text"; exit 4 }

$ws = New-Object -ComObject WScript.Shell
[void]$ws.AppActivate([int]$chrome.Id)
Start-Sleep -Milliseconds 500
$fg = [KBW]::GetForegroundWindow()
$fgT = [KBW]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
$me = [KBW]::GetCurrentThreadId()
[void][KBW]::AttachThreadInput($me, $fgT, $true)
[void][KBW]::ShowWindow($chrome.MainWindowHandle, 9)
[void][KBW]::SetForegroundWindow($chrome.MainWindowHandle)
[void][KBW]::AttachThreadInput($me, $fgT, $false)
Start-Sleep -Milliseconds 800

# 1. Go to the tweet.
$ws.SendKeys("^l"); Start-Sleep -Milliseconds 320
Set-Clipboard -Value $TweetUrl
Start-Sleep -Milliseconds 180
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 220
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 1200
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")   # accepts "Leave site?" if a draft is pending
Start-Sleep -Seconds 9

# 2. "r" opens the reply composer on the focused tweet.
[System.Windows.Forms.SendKeys]::SendWait("r")
Start-Sleep -Seconds 3

# 3. Paste. The editor is already focused by the shortcut.
Set-Clipboard -Value $text
Start-Sleep -Milliseconds 250
[System.Windows.Forms.SendKeys]::SendWait("^a")
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Seconds 5
# Collapse the mention typeahead without ESC (ESC closes the composer on this build).
[System.Windows.Forms.SendKeys]::SendWait(" ")
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait("{BACKSPACE}")
Start-Sleep -Milliseconds 600

if ($DryRun) { Write-Output "dry_run: text is in the reply composer, Ctrl+Enter not sent"; exit 0 }

# 4. Ctrl+Enter submits a post/reply in X.
[System.Windows.Forms.SendKeys]::SendWait("^{ENTER}")
Start-Sleep -Seconds 5
Write-Output "posted_attempted"
