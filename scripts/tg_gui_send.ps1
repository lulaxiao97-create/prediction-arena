param(
  [Parameter(Mandatory = $true)][string]$Jobs,
  [int]$Limit = 3,
  [int]$GapSeconds = 8
)

# Telegram Desktop GUI transport — send from the account that is already signed in.
#
# What works, measured on this box: a deep link that carries the text
# (tg://resolve?domain=<handle>&text=<urlencoded>) opens the chat with the message already in the
# composer and the composer focused, so a single {ENTER} sends it. Clipboard + Ctrl+V was tried and
# does not reach the composer (focus stays in the chat view), which produced exactly the worst
# outcome: "sent" in the log, nothing in the chat. So text travels inside the link.
#
# Two guards remain, both learned the hard way:
#   · locked desktop (LogonUI owns input) → abort the run, exit 3, let the next tick retry;
#   · window title mismatch → log it as sent_unverified instead of silently claiming delivery.

$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[void][FG]::SetProcessDPIAware()

function Test-Unlocked { return ([FG]::GetForegroundWindow() -ne [IntPtr]::Zero) }

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

  $user = ([string]$job.username).Trim()
  $text = [string]$job.text
  if ([string]::IsNullOrWhiteSpace($user) -or [string]::IsNullOrWhiteSpace($text)) {
    Write-Output ('{"ok":false,"status":"invalid","username":' + ($user | ConvertTo-Json) + '}')
    continue
  }

  # Windows caps a command line at ~8191 characters; a Chinese DM triples when URL-encoded.
  $encoded = [uri]::EscapeDataString($text)
  if ($encoded.Length -gt 6000) {
    Write-Output ('{"ok":false,"status":"too_long","username":' + ($user | ConvertTo-Json) + ',"encoded":' + $encoded.Length + '}')
    continue
  }

  try { Start-Process -FilePath ("tg://resolve?domain=" + $user + "&text=" + $encoded) -ErrorAction Stop }
  catch { & explorer.exe ("tg://resolve?domain=" + $user + "&text=" + $encoded) }
  Start-Sleep -Milliseconds 3000

  $tg.Refresh()
  $title = [string]$tg.MainWindowTitle
  $activate = $ws.AppActivate([int]$tg.Id)
  Start-Sleep -Milliseconds 900

  # Send by clicking the paper-plane, not by pressing Enter.
  # Measured on this install: the deep link fills the composer, but {ENTER} and Ctrl+Enter both leave
  # it as a draft — Telegram only sends when the button is clicked. The button sits at a fixed offset
  # from the window's bottom-right corner, so the click is computed from the live window rect.
  $rect = New-Object FG+RECT
  [void][FG]::GetWindowRect($tg.MainWindowHandle, [ref]$rect)
  $bx = $rect.Right - 39
  $by = $rect.Bottom - 31
  [void][FG]::SetCursorPos($bx, $by)
  Start-Sleep -Milliseconds 150
  [FG]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [FG]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 1600
  # Clear any draft left behind (a failed click would otherwise sit in the box and be sent later by
  # somebody else's Enter).
  [System.Windows.Forms.SendKeys]::SendWait("^(a)")
  [System.Windows.Forms.SendKeys]::SendWait("{BACKSPACE}")
  Start-Sleep -Milliseconds 300

  $expect = @($user, [string]$job.title) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  $matched = $false
  foreach ($e in $expect) { if ($title -and ($title.IndexOf($e, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)) { $matched = $true; break } }

  $sent++
  $status = if ($matched) { "sent" } else { "sent_unverified" }
  Write-Output ('{"ok":true,"status":"' + $status + '","username":' + ($user | ConvertTo-Json) + ',"title":' + ($title | ConvertTo-Json) + ',"activate":' + ($activate.ToString().ToLower()) + ',"chars":' + $text.Length + '}')
  Start-Sleep -Seconds $GapSeconds
}

Write-Output ('{"ok":true,"status":"done","sent":' + $sent + '}')
exit 0
