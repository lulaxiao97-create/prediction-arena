# Click a Chrome element by name via UIA (for consoles with no API: GSC / Bing Webmaster).
#   powershell -File scripts\uia_click.ps1 -Name "Add site"
#   powershell -File scripts\uia_click.ps1 -Name "Add site" -List   # list matches, do not click
# ASCII-only on purpose: PowerShell 5.1 reads BOM-less files as ANSI and mangles CJK.
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [switch]$List,
  [string]$Process = "chrome"
)

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$proc = Get-Process -Name $Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Error "no $Process window"; exit 2 }

$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $proc.Id)
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if (-not $win) { Write-Error "no top-level window for pid $($proc.Id)"; exit 2 }

$all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.Condition]::TrueCondition)
$hits = @()
foreach ($el in $all) {
  $n = $el.Current.Name
  if ($n -and $n -like "*$Name*") { $hits += $el }
}
Write-Output "win=$($win.Current.Name) matches=$($hits.Count)"
if ($List -or $hits.Count -eq 0) {
  foreach ($h in $hits) { Write-Output ("  [{0}] {1}" -f $h.Current.ControlType.ProgrammaticName, $h.Current.Name) }
  if ($hits.Count -eq 0) {
    foreach ($el in $all) {
      if ($el.Current.ControlType.ProgrammaticName -eq "ControlType.Button" -and $el.Current.Name) {
        Write-Output ("  BTN: " + $el.Current.Name)
      }
    }
  }
  exit 0
}
$target = $hits[0]
foreach ($h in $hits) { if ($h.Current.ControlType.ProgrammaticName -eq "ControlType.Button") { $target = $h; break } }
try {
  $p = $target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $p.Invoke()
  Write-Output ("clicked: " + $target.Current.Name)
} catch {
  Write-Output ("invoke failed: " + $_.Exception.Message)
  exit 1
}
