param(
  [Parameter(Mandatory = $true)][string]$TextFile,
  [switch]$DryRun
)

# Post to X through the signed-in Chrome window — no relaunch, no new tab beyond the composer.
#
# Encoding: the copy files are UTF-8 without BOM. `Get-Content -Raw` alone decodes them as ANSI on
# Windows PowerShell 5.1, so emoji and arrows reach the composer as mojibake ("🔥" → "鍞戞暩").
# Always pass -Encoding UTF8.
#
# Duplicate guard: X refuses identical text with "Whoops! You already said that." — if the composer
# stays open with that toast, the earlier attempt already published. Check the profile before retrying.
#
# What was measured on this machine (2026-10-30), because each of these cost an attempt:
#   · Chrome must be the *running* session; launching it with --remote-debugging-port on the default
#     profile is refused by Chrome 136+, and launching it at all drops the X session, so this script
#     only ever drives what is already open.
#   · The left-nav "Post" button opens /compose/post (a page, not a modal) and the composer there
#     accepts a clipboard paste.
#   · ENTER / Ctrl+Enter do not publish. The button is the only thing that does.
#   · When the market link expands into a card the button moves down, so the click is retried at both
#     heights; the second one is a no-op if the first already published (the composer is gone).

$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System; using System.Runtime.InteropServices;
public class XW {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[void][XW]::SetProcessDPIAware()

function Click-At([int]$x, [int]$y) {
  [void][XW]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 180
  [XW]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 70
  [XW]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 400
}

if ([XW]::GetForegroundWindow() -eq [IntPtr]::Zero) { Write-Output "locked"; exit 3 }

$chrome = Get-Process -Name chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object -First 1
if (-not $chrome) { Write-Output "no_chrome"; exit 2 }
$ws = New-Object -ComObject WScript.Shell
[void]$ws.AppActivate([int]$chrome.Id)
Start-Sleep -Milliseconds 700

$r = New-Object XW+RECT
[void][XW]::GetWindowRect($chrome.MainWindowHandle, [ref]$r)
$w = $r.Right - $r.Left
$h = $r.Bottom - $r.Top
Write-Output ("window=" + $w + "x" + $h + " at " + $r.Left + "," + $r.Top)

$text = (Get-Content $TextFile -Raw -Encoding UTF8).TrimEnd()
if ([string]::IsNullOrWhiteSpace($text)) { Write-Output "empty_text"; exit 4 }

# 1. Open the composer from the left nav (the pill sits at a fixed spot in this layout).
Click-At ([int]($r.Left + $w * 0.217)) ([int]($r.Top + $h * 0.813))
Start-Sleep -Milliseconds 2500

# 2. Paste into the composer.
Click-At ([int]($r.Left + $w * 0.367)) ([int]($r.Top + $h * 0.28))
Start-Sleep -Milliseconds 400
Set-Clipboard -Value $text
Start-Sleep -Milliseconds 250
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 2000

# Optional image: put the PNG on the clipboard and paste it into the composer. X accepts a pasted
# bitmap the same way it accepts a picked file, and this avoids the Win32 file dialog entirely
# (which needs its own coordinates and steals focus from the page).
if ($Image -ne "") {
  if (-not (Test-Path $Image)) { Write-Output ("image_missing: " + $Image); exit 5 }
  Add-Type -AssemblyName System.Drawing
  $img = [System.Drawing.Image]::FromFile($Image)
  [System.Windows.Forms.Clipboard]::SetImage($img)
  $img.Dispose()
  Start-Sleep -Milliseconds 400
  Click-At ([int]($r.Left + $w * 0.367)) ([int]($r.Top + $h * 0.28))
  Start-Sleep -Milliseconds 300
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Milliseconds 6000   # upload + preview
  Write-Output "image_pasted"
}

if ($DryRun) { Write-Output "dry_run: text is in the composer"; exit 0 }
if ($ComposeOnly) { Write-Output "composed: text + image waiting for the Post click"; exit 0 }

# 3. Publish. The button sits at the composer's bottom-right, not at a fixed height: an empty
# composer puts it at ~0.40h, a five-line post with a link card at ~0.67h. Measured 2026-11-02 on a
# 1936x1056 window: 0.625/0.672 hit it, 0.63/0.63 and 0.63/0.872 both missed (which is how a draft
# gets "saved" instead of posted). Try the measured spot first, then the two older fallbacks.
Click-At ([int]($r.Left + $w * 0.625)) ([int]($r.Top + $h * 0.672))
Start-Sleep -Milliseconds 8000
# One click only. The old script clicked three times "to be safe"; after a successful post those
# extra clicks land on whatever is under the cursor in the timeline (a tweet, a follow button).
# A missed click leaves a draft, which is recoverable; a stray click is not.

# If X answers "Whoops! You already said that.", the earlier attempt published: check the profile
# before retrying. A photo/file attach is still manual — this script only drives text + link cards.
Write-Output "posted_attempted"
