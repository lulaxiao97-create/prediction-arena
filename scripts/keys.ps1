param([string]$Keys)
# Focus Chrome, then send keystrokes. Run through run-hidden.vbs so the console never appears.
# Example: wscript run-hidden.vbs "-File scripts\keys.ps1 -Keys ^lhttps://dappradar.com/{ENTER}"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class K {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
}
"@
$p = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($null -eq $p) { Write-Output "no chrome"; exit 1 }
[K]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
[K]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait($Keys)
Write-Output ("keys: " + $Keys)
