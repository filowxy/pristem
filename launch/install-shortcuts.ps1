# =============================================================================
#  pristem - install / remove the Desktop + Start Menu shortcuts
#
#    powershell -ExecutionPolicy Bypass -File launch\install-shortcuts.ps1
#    powershell -ExecutionPolicy Bypass -File launch\install-shortcuts.ps1 -Remove
#
#  The shortcut targets wscript.exe + pristem-launch.vbs (no console window) and
#  uses the app icon from pristem-desktop\assets\pristem.ico.
#
#  Kept ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less .ps1 files
#  as ANSI, so non-ASCII text here would be mangled on zh-CN systems.
# =============================================================================
[CmdletBinding()]
param(
    [switch]$Remove,
    [switch]$NoDesktop,
    [switch]$NoStartMenu
)

$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $PSScriptRoot
$vbs     = Join-Path $PSScriptRoot 'pristem-launch.vbs'
$ico     = Join-Path $root 'pristem-desktop\assets\pristem.ico'
$exe     = Join-Path $root 'pristem-desktop\shell\target\debug\pristem-desktop.exe'
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'

if (-not (Test-Path $vbs)) { throw "missing launcher: $vbs" }

$targets = @()
if (-not $NoDesktop) {
    $targets += ,@('Desktop',   (Join-Path ([Environment]::GetFolderPath('Desktop')) 'pristem.lnk'))
}
if (-not $NoStartMenu) {
    $startPrograms = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    $targets += ,@('Start Menu', (Join-Path $startPrograms 'pristem.lnk'))
}

if ($Remove) {
    foreach ($t in $targets) {
        if (Test-Path $t[1]) {
            Remove-Item -LiteralPath $t[1] -Force
            Write-Output ("removed  {0,-12} {1}" -f $t[0], $t[1])
        }
    }
    return
}

if (-not (Test-Path $exe)) {
    Write-Warning "no build yet at $exe - the shortcut will build on first launch."
}
if (-not (Test-Path $ico)) {
    Write-Warning "no icon at $ico - shortcut will use the wscript icon. Run: python pristem-desktop\assets\make-app-icon.py"
}

$shell = New-Object -ComObject WScript.Shell
foreach ($t in $targets) {
    $path = $t[1]
    $dir  = Split-Path -Parent $path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    $lnk = $shell.CreateShortcut($path)
    $lnk.TargetPath        = $wscript
    $lnk.Arguments         = '"' + $vbs + '"'
    $lnk.WorkingDirectory  = $root
    $lnk.Description       = 'pristem - resident agent desktop'
    $lnk.WindowStyle       = 1
    if (Test-Path $ico) { $lnk.IconLocation = $ico + ',0' }
    $lnk.Save()

    Write-Output ("created  {0,-12} {1}" -f $t[0], $path)
}

Write-Output ''
Write-Output 'Tip: right-click the shortcut -> "Pin to taskbar" to make it a one-click app.'
