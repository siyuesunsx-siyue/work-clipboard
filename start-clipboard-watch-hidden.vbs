Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
watchScript = fso.BuildPath(scriptDir, "clipboard-watch.ps1")
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File " & Chr(34) & watchScript & Chr(34)
shell.Run cmd, 0, False
