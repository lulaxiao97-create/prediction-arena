param([string]$Match, [switch]$List)
# Find elements anywhere on the desktop whose accessible name matches $Match and invoke them.
# Chrome's own bubbles (OAuth account chooser, permission prompts) ignore synthetic mouse clicks,
# but they still implement InvokePattern, so this is the only way in.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$hits = 0
foreach ($el in $all) {
  try { $name = $el.Current.Name } catch { continue }
  if (-not $name) { continue }
  if ($name -notmatch $Match) { continue }
  $ct = $el.Current.ControlType.ProgrammaticName
  $r = $el.Current.BoundingRectangle
  Write-Output ("FOUND " + $ct + " [" + $name + "] at " + [int]$r.X + "," + [int]$r.Y)
  $hits++
  if (-not $List) {
    try {
      $ip = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $ip.Invoke()
      Write-Output "INVOKED"
      break
    } catch {
      try {
        $sel = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
        $sel.Select()
        Write-Output "SELECTED"
        break
      } catch { Write-Output "no pattern" }
    }
  }
  if ($hits -gt 12) { break }
}
if ($hits -eq 0) { Write-Output "no match" }
