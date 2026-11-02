#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# X funnel daemon — one post a day, only when the desk is idle.
#
# The desktop is the boss's machine, so the rule is: never touch it while he is using it. Every five
# minutes this loop asks Windows two questions — is the session locked, and has there been input in
# the last five minutes — and only when both answers are "safe" does it post the day's funnel tweet
# through the UIA poster (no pixel guessing, no window stealing while typing).
#
# One post per day, tracked in .data/x-daemon-state.json. The copy comes from
# .data/daily-funnel.txt, which the marketing engine refreshes every six hours.
#
#   bash scripts/x-daemon.sh            # foreground (cron/@reboot keeps it alive)
#   tail -f logs/x-daemon.log
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
LOG="logs/x-daemon.log"
STATE=".data/x-daemon-state.json"
COPY=".data/daily-funnel.txt"
POSTER="C:\\Users\\Administrator\\prediction-arena\\scripts\\x-poster.ps1"
COPY_WIN="C:\\Users\\Administrator\\prediction-arena\\.data\\daily-funnel.txt"
IDLE_REQUIRED="${IDLE_REQUIRED:-300}"   # seconds of no input before we are allowed to type
mkdir -p logs .data
say() { echo "[$(date -Is)] $*" >>"$LOG"; }

# Single instance (flock: the pgrep variant matches the wrapper that launched it).
exec 9>".data/x-daemon.lock"
if ! flock -n 9; then echo "x daemon already running"; exit 0; fi

say "x daemon start pid=$$ (idle≥${IDLE_REQUIRED}s)"

while true; do
  TODAY="$(date +%F)"
  POSTED="$(bun -e 'try{console.log(require("./.data/x-daemon-state.json").lastPosted ?? "")}catch{console.log("")}' 2>/dev/null || echo "")"
  if [[ "$POSTED" == "$TODAY" ]]; then
    sleep 900
    continue
  fi
  if [[ ! -s "$COPY" ]]; then
    say "no copy at $COPY — waiting"
    sleep 900
    continue
  fi

  READY="$(powershell.exe -NoProfile -Command "
    Add-Type @'
using System; using System.Runtime.InteropServices;
public class IDLE { [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport(\"user32.dll\")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  [DllImport(\"kernel32.dll\")] public static extern uint GetTickCount(); }
'@
    \$i = New-Object IDLE+LASTINPUTINFO; \$i.cbSize = [uint32]8; [void][IDLE]::GetLastInputInfo([ref]\$i)
    \$idle = ([IDLE]::GetTickCount() - \$i.dwTime) / 1000
    \$locked = [bool](Get-Process LogonUI -ErrorAction SilentlyContinue)
    Write-Output (\$(if(\$locked){'locked'}elseif(\$idle -lt $IDLE_REQUIRED){'busy'}else{'ready'}))
  " 2>/dev/null | tr -d '\r' | tail -1)"

  if [[ "$READY" != "ready" ]]; then
    say "skip: $READY"
    sleep 300
    continue
  fi

  say "posting daily funnel (desk idle)"
  OUT="$(powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "$POSTER" -TextFile "$COPY_WIN" 2>&1 | tr -d '\r' | tail -3)"
  say "poster: $OUT"
  if echo "$OUT" | grep -q "posted_attempted"; then
    bun -e "require('node:fs').writeFileSync('.data/x-daemon-state.json', JSON.stringify({lastPosted: '$TODAY', at: new Date().toISOString()}, null, 2) + '\n')"
    say "marked posted for $TODAY"
    # verify the composer is gone (the poster returns 'done' only when the InvokePattern fired)
    sleep 60
  fi
  sleep 1800
done
