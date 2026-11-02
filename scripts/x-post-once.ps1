param(
  [Parameter(Mandatory = $true)][string]$TextFile,
  [int]$WaitSeconds = 10
)
# One-shot: focus the open composer, paste, wait for the card, then invoke the composer's Post button.
# Diagnostic-first: prints the state at each step so a failure is readable rather than a mystery.

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms

$root = [System.Windows.Automation.AutomationElement]::RootElement
function ByName($name) {
  $c = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
  return $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $c)
}

$editor = ByName "Post text" | Select-Object -First 1
if (-not $editor) { Write-Output "no_editor"; exit 3 }
$r = $editor.Current.BoundingRectangle
Write-Output ("editor " + [int]$r.X + "," + [int]$r.Y)

# focus it by setting keyboard focus through UIA (no click geometry involved)
try { $editor.SetFocus() } catch { Write-Output "focus_failed" }
Start-Sleep -Milliseconds 400

$text = (Get-Content $TextFile -Raw -Encoding UTF8).TrimEnd()
Set-Clipboard -Value $text
Start-Sleep -Milliseconds 250
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Seconds $WaitSeconds

$posts = ByName "Post"
foreach ($e in $posts) {
  $b = $e.Current.BoundingRectangle
  Write-Output ("post? " + [int]$b.X + "," + [int]$b.Y + " " + [int]$b.Width + "x" + [int]$b.Height + " en=" + $e.Current.IsEnabled)
}

$done = $false
foreach ($e in $posts) {
  $b = $e.Current.BoundingRectangle
  if (-not $e.Current.IsEnabled) { continue }
  if ($b.Width -lt 40 -or $b.Width -gt 140) { continue }
  if ($b.Y -lt 200) { continue }
  try {
    $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    $done = $true
    Write-Output "INVOKED"
    break
  } catch { Write-Output ("invoke_err " + $_.Exception.Message) }
}
if (-not $done) { Write-Output "no_enabled_post"; exit 5 }
Start-Sleep -Seconds 6
Write-Output "done"
