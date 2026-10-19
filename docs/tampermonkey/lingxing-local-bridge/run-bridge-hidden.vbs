Option Explicit

' Run the local Node.js bridge without creating a console window.
' Keep supervising Node so an unexpected exit is recovered after one minute.
Dim shell, fileSystem, scriptDirectory, nodePath, bridgePath, command, exitCode
Dim restartDelayMs

nodePath = "C:\Program Files\nodejs\node.exe"

Set fileSystem = CreateObject("Scripting.FileSystemObject")
scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
bridgePath = fileSystem.BuildPath(scriptDirectory, "bridge.cjs")
If Not fileSystem.FileExists(nodePath) Then WScript.Quit 2
If Not fileSystem.FileExists(bridgePath) Then WScript.Quit 3

command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & bridgePath & Chr(34)
Set shell = CreateObject("WScript.Shell")
restartDelayMs = 60000

Do
  exitCode = shell.Run(command, 0, True)
  WScript.Sleep restartDelayMs
Loop
