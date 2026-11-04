' Launch PowerShell with NO console window, so automation never steals focus from Chrome.
' Usage: wscript.exe //nologo run-hidden.vbs "-File C:\path\to\script.ps1 -Arg value"
' Every argument is joined into one command line; quote paths that contain spaces.
Dim sh, cmd, i, args
Set sh = CreateObject("WScript.Shell")
args = ""
For i = 0 To WScript.Arguments.Count - 1
  If i > 0 Then args = args & " "
  args = args & WScript.Arguments(i)
Next
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass " & args
sh.Run cmd, 0, False
