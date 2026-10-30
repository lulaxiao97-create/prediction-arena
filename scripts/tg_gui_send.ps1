param(
  [Parameter(Mandatory = $true)][string]$Jobs,
  [int]$Limit = 3,
  [int]$GapSeconds = 6
)

# Telegram Desktop GUI transport.
#
# Why the GUI: Bot API cannot open a conversation, and extracting the tdata session is not portable
# (this Desktop build's key layout is newer than every public tdata parser). The account that is
# already signed in on this machine can send, so the sender drives that window: deep link → paste →
# Enter.
#
# The one hard rule: when Windows is locked, LogonUI owns the secure desktop and every synthesized
# keystroke is refused with "Access denied". So this script *checks first* and exits 3 instead of
# half-sending, and the cron that calls it simply tries again later. No prompts, no waiting on a human.

$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
"@

function Test-Unlocked {
  # A locked session has no foreground window on WinSta0\Default.
  return ([FG]::GetForegroundWindow() -ne [IntPtr]::Zero)
}

$tg = Get-Process -Name Telegram -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $tg) { Write-Output '{"ok":false,"status":"no_app","detail":"Telegram Desktop is not running"}'; exit 2 }

if (-not (Test-Unlocked)) {
  Write-Output '{"ok":false,"status":"locked","detail":"desktop locked — LogonUI owns input; will retry"}'
  exit 3
}

$queue = Get-Content -Path $Jobs -Raw -Encoding UTF8 | ConvertFrom-Json
$ws = New-Object -ComObject WScript.Shell
$sent = 0

foreach ($job in $queue) {
  if ($sent -ge $Limit) { break }
  if (-not (Test-Unlocked)) { Write-Output '{"ok":false,"status":"locked","detail":"locked mid-run"}'; exit 3 }

  $user = [string]$job.username
  $text = [string]$job.text
  if ([string]::IsNullOrWhiteSpace($user) -or [string]::IsNullOrWhiteSpace($text)) {
    Write-Output ('{"ok":false,"status":"invalid","username":' + ($user | ConvertTo-Json) + '}')
    continue
  }

  try {
    Start-Process -FilePath ("tg://resolve?domain=" + $user) -ErrorAction Stop
  } catch {
    & explorer.exe ("tg://resolve?domain=" + $user)
  }
  Start-Sleep -Milliseconds 2600

  # Only paste into the right chat. Telegram puts the chat name in the window title, so a mismatch
  # means the deep link opened a profile card (or the wrong chat) — pasting there would send the pitch
  # to nobody and mark it as delivered.
  $tg.Refresh()
  $title = [string]$tg.MainWindowTitle
  $expect = @([string]$job.username, [string]$job.title) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  $matched = $false
  foreach ($e in $expect) { if ($title -and ($title.IndexOf($e, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)) { $matched = $true; break } }
  if (-not $matched) {
    Write-Output ('{"ok":false,"status":"wrong_chat","username":' + ($user | ConvertTo-Json) + ',"title":' + ($title | ConvertTo-Json) + '}')
    continue
  }

  # Only paste into Telegram, never into whatever else happens to be focused.
  $activated = $ws.AppActivate([int]$tg.Id)
  if (-not $activated) {
    Write-Output ('{"ok":false,"status":"not_focused","username":' + ($user | ConvertTo-Json) + '}')
    continue
  }
  Start-Sleep -Milliseconds 600
  Set-Clipboard -Value $text
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Milliseconds 500
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  Start-Sleep -Milliseconds 400

  $sent++
  Write-Output ('{"ok":true,"status":"sent","username":' + ($user | ConvertTo-Json) + ',"chars":' + $text.Length + '}')
  Start-Sleep -Seconds $GapSeconds
}

Write-Output ('{"ok":true,"status":"done","sent":' + $sent + '}')
exit 0
