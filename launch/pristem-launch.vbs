' ============================================================================
'  pristem - console-free launcher
'
'  The desktop binary is a console-subsystem program, so starting it straight
'  from Explorer leaves a black window behind the app. The shortcuts point at
'  wscript.exe + this file instead: it runs pristem.cmd with window style 0,
'  so a double-click is pure GUI while build/error handling stays in one script.
'
'  Installed by launch\install-shortcuts.ps1 (desktop + Start Menu).
' ============================================================================
Option Explicit

Dim fso, sh, launchDir, root, launcher, comspec, cmdLine
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

launchDir = fso.GetParentFolderName(WScript.ScriptFullName)
root = fso.GetParentFolderName(launchDir)
launcher = fso.BuildPath(root, "pristem.cmd")

If Not fso.FileExists(launcher) Then
    MsgBox "Launcher not found:" & vbCrLf & launcher, vbCritical, "pristem"
    WScript.Quit 1
End If

comspec = sh.ExpandEnvironmentStrings("%ComSpec%")

' cmd /c ""<launcher>" hidden" - the outer quotes keep paths with spaces intact.
' Window style 0 = hidden, False = do not wait: the hidden cmd lives as long as
' the app, and nothing is ever shown.
cmdLine = """" & comspec & """ /c """ & """" & launcher & """ hidden"""

sh.Run cmdLine, 0, False
