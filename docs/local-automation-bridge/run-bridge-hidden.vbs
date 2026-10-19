Option Explicit

' Run the local Node.js bridge without a console window.
' Supervise Node so an unexpected exit is recovered after one minute.
Dim shell, fileSystem, scriptDirectory, nodePath, bridgePath, command, exitCode
Dim restartDelayMs, configuredNode

Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

configuredNode = shell.ExpandEnvironmentStrings("%LOCAL_AUTOMATION_BRIDGE_NODE%")
If configuredNode <> "%LOCAL_AUTOMATION_BRIDGE_NODE%" Then
  nodePath = configuredNode
Else
  nodePath = fileSystem.BuildPath(shell.ExpandEnvironmentStrings("%ProgramFiles%"), "nodejs\node.exe")
  If Not fileSystem.FileExists(nodePath) Then
    nodePath = fileSystem.BuildPath(shell.ExpandEnvironmentStrings("%LOCALAPPDATA%"), "Programs\nodejs\node.exe")
  End If
End If

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
bridgePath = fileSystem.BuildPath(scriptDirectory, "bridge.cjs")
If Not fileSystem.FileExists(nodePath) Then WScript.Quit 2
If Not fileSystem.FileExists(bridgePath) Then WScript.Quit 3

command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & bridgePath & Chr(34)
restartDelayMs = 60000

Do
  exitCode = shell.Run(command, 0, True)
  WScript.Sleep restartDelayMs
Loop
