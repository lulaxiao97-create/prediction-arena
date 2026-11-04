# UIA helpers for consoles with no API: list edits/buttons with screen rects, set an edit's value,
# click a button. ASCII-only (PowerShell 5.1 reads BOM-less files as ANSI).
#   powershell -File scripts\uia_form.ps1 -List
#   powershell -File scripts\uia_form.ps1 -SetEdit 1 -Value "example.com"
#   powershell -File scripts\uia_form.ps1 -ClickName "Continue" -MinX 900
param(
  [switch]$List,
  [int]$SetEdit = -1,
  [string]$Value = "",
  [string]$ClickName = "",
  [int]$MinX = -1,
  [string]$Process = "chrome"
)

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$proc = Get-Process -Name $Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Error "no $Process window"; exit 2 }
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $proc.Id)
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
$all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.Condition]::TrueCondition)

$edits = @(); $buttons = @()
foreach ($el in $all) {
  $ct = $el.Current.ControlType.ProgrammaticName
  $r = $el.Current.BoundingRectangle
  if ($ct -eq "ControlType.Edit" -and $r.Width -gt 20) {
    $edits += [pscustomobject]@{ El = $el; X = [int]($r.X + $r.Width / 2); Y = [int]($r.Y + $r.Height / 2); W = [int]$r.Width; Name = $el.Current.Name }
  }
  if ($ct -eq "ControlType.Button" -and $r.Width -gt 10) {
    $buttons += [pscustomobject]@{ El = $el; X = [int]($r.X + $r.Width / 2); Y = [int]($r.Y + $r.Height / 2); Name = $el.Current.Name }
  }
}

if ($List) {
  Write-Output ("edits=" + $edits.Count + " buttons=" + $buttons.Count)
  for ($i = 0; $i -lt $edits.Count; $i++) { Write-Output ("  E{0} ({1},{2}) w={3} name={4}" -f $i, $edits[$i].X, $edits[$i].Y, $edits[$i].W, $edits[$i].Name) }
  for ($i = 0; $i -lt $buttons.Count; $i++) { Write-Output ("  B{0} ({1},{2}) name={3}" -f $i, $buttons[$i].X, $buttons[$i].Y, $buttons[$i].Name) }
  exit 0
}

if ($SetEdit -ge 0 -and $SetEdit -lt $edits.Count) {
  $e = $edits[$SetEdit]
  try {
    $vp = $e.El.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $vp.SetValue($Value)
    Write-Output ("set E{0} = {1}" -f $SetEdit, $Value)
  } catch {
    Write-Output ("SetValue failed, clicking instead: " + $_.Exception.Message)
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type @"
using System; using System.Runtime.InteropServices;
public class M2 { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint d,IntPtr e); }
"@
    [M2]::SetCursorPos($e.X, $e.Y) | Out-Null; Start-Sleep -Milliseconds 150
    [M2]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero); [M2]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 250
    [System.Windows.Forms.SendKeys]::SendWait($Value)
    Write-Output ("typed into E{0}" -f $SetEdit)
  }
}

if ($ClickName) {
  # exact name first (a toolbar bookmark called "Google Gemini" must not shadow the dialog's "Google")
  $ordered = @()
  foreach ($b in $buttons) { if ($b.Name -eq $ClickName -and ($MinX -lt 0 -or $b.X -ge $MinX)) { $ordered += $b } }
  foreach ($b in $buttons) { if ($b.Name -like "*$ClickName*" -and $b.Name -ne $ClickName -and ($MinX -lt 0 -or $b.X -ge $MinX)) { $ordered += $b } }
  foreach ($b in $ordered) {
    try {
      $ip = $b.El.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $ip.Invoke(); Write-Output ("clicked B ({0},{1}) {2}" -f $b.X, $b.Y, $b.Name); exit 0
    } catch { Write-Output ("invoke failed: " + $_.Exception.Message); exit 1 }
  }
  Write-Output "no button matched"
  exit 1
}
