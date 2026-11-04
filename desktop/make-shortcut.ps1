# Makes the FestiVille shortcuts (desktop and Start menu) that open the desktop app.
# Run by "Install FestiVille app.bat"; safe to run again (it just remakes them).
$ErrorActionPreference = 'Stop'
$desktopDir = $PSScriptRoot
$root = Split-Path -Parent $desktopDir
$exe = Join-Path $desktopDir 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $exe)) {
  Write-Host "Electron isn't installed yet. Run 'Install FestiVille app.bat' first."
  exit 1
}
$shell = New-Object -ComObject WScript.Shell
$places = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
foreach ($dir in $places) {
  if (-not $dir -or -not (Test-Path $dir)) { continue }
  $path = Join-Path $dir 'FestiVille.lnk'
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $exe
  $lnk.Arguments = '"' + $desktopDir + '"'
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = (Join-Path $desktopDir 'festiville.ico') + ',0'
  $lnk.Description = 'FestiVille: the festival game, with its server built in'
  $lnk.Save()
  Write-Host "  Made $path"
}
