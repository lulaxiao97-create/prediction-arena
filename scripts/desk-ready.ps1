# Is the desk safe to drive? Prints exactly one token on stdout: ready | busy | locked
#
# The X daemon runs this before typing into the browser. Kept as a .ps1 file instead of an inline
# -Command string because the inline here-string quoting kept collapsing: powershell.exe would exit 0
# with no output, `tail -1` then returned an empty string, and the daemon skipped forever with a log
# line that read "skip: " and told nobody anything.
param([int]$IdleRequired = 300)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DESKIDLE {
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  [DllImport("kernel32.dll")] public static extern uint GetTickCount();
}
"@

function Get-IdleSeconds {
  $info = New-Object DESKIDLE+LASTINPUTINFO
  $info.cbSize = [uint32]8
  if (-not [DESKIDLE]::GetLastInputInfo([ref]$info)) { return $null }
  $tick = [DESKIDLE]::GetTickCount()
  # GetTickCount wraps every 49.7 days; treat a negative delta as a fresh boot rather than "idle forever".
  $delta = ($tick - $info.dwTime)
  if ($delta -lt 0) { return 0 }
  return [math]::Round($delta / 1000, 0)
}

$locked = [bool](Get-Process LogonUI -ErrorAction SilentlyContinue)
$session = (Get-Process -Id $PID).SessionId
$idle = Get-IdleSeconds

$verdict = if ($locked) { 'locked' } elseif ($null -eq $idle) { 'unknown' } elseif ($idle -lt $IdleRequired) { 'busy' } else { 'ready' }

# One line on stdout, nothing else: the caller greps for the token, so extra furniture breaks it.
# Diagnostics go to stderr, where they cannot be mistaken for the answer.
Write-Output $verdict
[Console]::Error.WriteLine("desk-ready: idle=${idle}s locked=$locked session=$session")
exit 0
