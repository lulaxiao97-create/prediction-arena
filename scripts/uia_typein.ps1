param([string]$Name, [string]$Text, [switch]$NoEnter)
# Focus a field by accessible name, type into it with real keystrokes, optionally press Enter.
# Needed for places where pointer clicks do not reach (Chrome's own bubbles, portal popovers).
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
$root = [System.Windows.Automation.AutomationElement]::RootElement
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$target = $null
foreach ($el in $all) {
  try { $n = $el.Current.Name } catch { continue }
  if ($n -eq $Name -and $el.Current.ControlType.ProgrammaticName -match "Edit|Document") { $target = $el; break }
}
if (-not $target) { Write-Output ("no field named " + $Name); exit 1 }
$target.SetFocus()
Start-Sleep -Milliseconds 400
# The field keeps its text after Enter adds a tag, so always clear before typing or the
# next word lands glued to the previous one ("CryptoWeb3Fintech").
[System.Windows.Forms.SendKeys]::SendWait("^a")
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait($Text)
Start-Sleep -Milliseconds 600
if (-not $NoEnter) { [System.Windows.Forms.SendKeys]::SendWait("{ENTER}") }
Write-Output ("typed into [" + $Name + "]: " + $Text)
